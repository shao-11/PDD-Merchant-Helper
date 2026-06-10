import type { AppealRecommendation } from './types';

export type FormFillStep = {
  step: string;
  ok: boolean;
  detail?: string;
};

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 查找已打开的「发起申诉」弹窗 */
export function findAppealSubmitModal(): HTMLElement | null {
  const modals = document.querySelectorAll<HTMLElement>('[data-testid="beast-core-modal"]');
  for (const modal of modals) {
    const header = modal.querySelector('.MDL_header_5-163-0, [class*="MDL_header"]');
    const title = (header?.textContent ?? modal.textContent ?? '').trim();
    if (title.includes('发起申诉')) return modal;
  }
  return null;
}

/** 尝试点击详情页上的「我要申诉」等按钮以打开弹窗 */
export function clickOpenAppealButton(): boolean {
  const candidates = document.querySelectorAll<HTMLElement>('button, a, span, div[role="button"]');
  for (const el of candidates) {
    const t = (el.textContent ?? '').replace(/\s+/g, '');
    if (/我要申诉|发起申诉|去申诉/.test(t) && t.length < 20) {
      el.click();
      return true;
    }
  }
  return false;
}

export async function waitForAppealModal(timeoutMs = 12000): Promise<HTMLElement> {
  const start = Date.now();
  if (!findAppealSubmitModal()) clickOpenAppealButton();
  while (Date.now() - start < timeoutMs) {
    const modal = findAppealSubmitModal();
    if (modal) return modal;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('未找到「发起申诉」弹窗，请先在详情页点击「我要申诉」打开弹窗后再试');
}

function getModalForm(modal: HTMLElement): HTMLElement {
  return modal.querySelector('.RefundsAppealSubmitModal_modal__oEjcA form') ?? modal;
}

/** 在弹窗内按可见文案点击单选（beast-core-radio） */
export function selectRadioByLabelText(
  root: ParentNode,
  labelText: string,
  partial = true,
): boolean {
  const want = normalizeLabel(labelText);
  const radios = root.querySelectorAll<HTMLLabelElement>('label[data-testid="beast-core-radio"]');
  for (const label of radios) {
    const textEl = label.querySelector('[class*="RD_textWrapper"], [class*="RD_prevRadio"]');
    const got = normalizeLabel(textEl?.textContent ?? label.textContent ?? '');
    const match = partial
      ? got === want || got.includes(want) || want.includes(got)
      : got === want;
    if (match) {
      label.click();
      const input = label.querySelector<HTMLInputElement>('input[type="radio"]');
      input?.click();
      return true;
    }
  }
  return false;
}

/** 弹窗 radio 文案与 tuju 返回的 appealReasonDesc 可能略有差异 */
export function selectAppealReasonRadio(root: ParentNode, reasonDesc: string): boolean {
  if (selectRadioByLabelText(root, reasonDesc, true)) return true;
  const d = normalizeLabel(reasonDesc);
  const rules: { test: RegExp; radioLabel: string }[] = [
    { test: /未表达|非商品问题/, radioLabel: '消费者未表达商品问题' },
    { test: /误解/, radioLabel: '消费者误解商品信息' },
    { test: /核验不存在|不存在|无问题/, radioLabel: '消费者所述问题经核验不存在' },
  ];
  for (const { test, radioLabel } of rules) {
    if (test.test(d) && selectRadioByLabelText(root, radioLabel, false)) return true;
  }
  return false;
}

export function fillAppealForm(
  modal: HTMLElement,
  rec: AppealRecommendation,
): FormFillStep[] {
  const steps: FormFillStep[] = [];
  const form = getModalForm(modal);

  if (selectRadioByLabelText(form, '可以提供凭证')) {
    steps.push({ step: '凭证选项', ok: true, detail: '已选「可以提供凭证」' });
  } else {
    steps.push({ step: '凭证选项', ok: false, detail: '未找到「可以提供凭证」单选' });
  }

  const reasonOk = selectAppealReasonRadio(form, rec.appealReasonDesc);
  steps.push({
    step: '申诉原因',
    ok: reasonOk,
    detail: reasonOk ? rec.appealReasonDesc : `未匹配到：${rec.appealReasonDesc}`,
  });

  const ta =
    form.querySelector<HTMLTextAreaElement>('[data-testid="beast-core-textArea-htmlInput"]') ??
    form.querySelector<HTMLTextAreaElement>('textarea');
  if (ta && rec.appealText.trim()) {
    setReactInputValue(ta, rec.appealText.trim());
    steps.push({ step: '申诉说明', ok: true, detail: `${rec.appealText.trim().length} 字` });
  } else {
    steps.push({ step: '申诉说明', ok: false, detail: ta ? '说明为空' : '未找到说明输入框' });
  }

  return steps;
}

const MAX_APPEAL_IMAGES = 3;

/** 逐张上传间隔（平台需处理上一张后再传下一张，过短易失败） */
const UPLOAD_PER_FILE_GAP_MS = 450;
const UPLOAD_INJECT_WAIT_MS = 380;
const UPLOAD_ADD_SLOT_MS = 150;

function isVideoFileInput(inp: HTMLInputElement): boolean {
  const accept = (inp.getAttribute('accept') ?? '').toLowerCase();
  return accept.includes('video') || accept.includes('mp4') || accept.includes('.mov');
}

/** 在整颗弹窗内查找图片上传 input（不限于 form，凭证区常在选单选后才挂载） */
function listAppealImageFileInputs(root: ParentNode): HTMLInputElement[] {
  const scope = root instanceof HTMLElement ? root : document.body;
  const selectors = [
    'input[data-testid="beast-core-upload-input"][type="file"]',
    'input[type="file"]',
  ];
  const seen = new Set<HTMLInputElement>();
  const out: HTMLInputElement[] = [];

  for (const sel of selectors) {
    for (const inp of scope.querySelectorAll<HTMLInputElement>(sel)) {
      if (seen.has(inp) || isVideoFileInput(inp)) continue;
      seen.add(inp);
      const accept = (inp.getAttribute('accept') ?? '').toLowerCase();
      if (
        accept.includes('image') ||
        accept.includes('jpg') ||
        accept.includes('jpeg') ||
        accept.includes('png') ||
        accept === '' ||
        !accept
      ) {
        out.push(inp);
      }
    }
  }

  if (out.length > 0) return out;

  for (const inp of scope.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    if (!seen.has(inp) && !isVideoFileInput(inp)) {
      seen.add(inp);
      out.push(inp);
    }
  }
  return out;
}

function findImageUploadDropZone(input: HTMLInputElement | null, modal: HTMLElement): HTMLElement | null {
  if (input) {
    const zone =
      input.closest<HTMLElement>('[data-testid*="upload"], [class*="Upload"], [class*="upload"]') ??
      input.parentElement;
    if (zone) return zone;
  }
  for (const el of modal.querySelectorAll<HTMLElement>('*')) {
    const t = (el.textContent ?? '').replace(/\s+/g, '');
    if (t.includes('上传图片') && t.includes('最多') && t.length < 80) {
      return (
        el.closest<HTMLElement>('[data-testid*="upload"], [class*="Upload"], [class*="upload"]') ??
        el.parentElement ??
        el
      );
    }
  }
  return null;
}

function isUploadPreviewImage(img: HTMLImageElement): boolean {
  const src = (img.getAttribute('src') ?? '').trim();
  if (!src || src === 'about:blank' || src.endsWith('.svg')) return false;
  if (/placeholder|icon|logo/i.test(src)) return false;
  if (src.startsWith('blob:') || src.startsWith('data:')) return true;
  if (/^https?:\/\//i.test(src)) {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    return w >= 48 || h >= 48 || w === 0;
  }
  return false;
}

/** 统计申诉弹窗内已上传图片预览（含 blob/data 缩略图，与平台 beast-upload 一致） */
function countUploadPreviewImages(modal: HTMLElement): number {
  const seen = new Set<HTMLImageElement>();
  let n = 0;

  for (const img of modal.querySelectorAll<HTMLImageElement>('img[src]')) {
    if (!isUploadPreviewImage(img) || seen.has(img)) continue;
    seen.add(img);
    n += 1;
  }

  for (const box of modal.querySelectorAll<HTMLElement>(
    '[data-testid="beast-core-upload"] [class*="item"], [class*="Upload"] [class*="item"], [class*="upload-list"] li, [class*="uploadList"] li',
  )) {
    const hasRemove =
      box.querySelector('[class*="close"], [class*="delete"], [aria-label*="删除"], [aria-label*="移除"]') !=
      null;
    const hasImg = box.querySelector('img[src]') != null;
    if (hasRemove && hasImg) {
      n = Math.max(n, seen.size);
    }
  }

  return Math.max(n, seen.size);
}

async function waitForUploadPreviewReady(
  modal: HTMLElement,
  previewBefore: number,
  expectCount: number,
  timeoutMs = 8000,
): Promise<number> {
  const start = Date.now();
  let best = previewBefore;
  while (Date.now() - start < timeoutMs) {
    const n = countUploadPreviewImages(modal);
    if (n > best) best = n;
    if (n >= expectCount || n > previewBefore) {
      await new Promise((r) => setTimeout(r, 280));
      const again = countUploadPreviewImages(modal);
      return Math.max(n, again);
    }
    await new Promise((r) => setTimeout(r, 220));
  }
  return countUploadPreviewImages(modal);
}

function uploadPreviewIncreased(modal: HTMLElement, previewBefore: number): boolean {
  return countUploadPreviewImages(modal) > previewBefore;
}

function assignFilesToInput(input: HTMLInputElement, files: File[]): boolean {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (desc?.set) desc.set.call(input, dt.files);
    else input.files = dt.files;
  } catch {
    return false;
  }
  input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  return (input.files?.length ?? 0) >= files.length;
}

function dropFilesOnZone(zone: HTMLElement, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  const init: DragEventInit = { bubbles: true, cancelable: true, dataTransfer: dt };
  zone.dispatchEvent(new DragEvent('dragenter', init));
  zone.dispatchEvent(new DragEvent('dragover', init));
  zone.dispatchEvent(new DragEvent('drop', init));
}

/** 选「可以提供凭证」后上传区可能异步挂载，轮询等待 */
export async function waitForAppealImageUploadInputs(
  modal: HTMLElement,
  timeoutMs = 8000,
): Promise<HTMLInputElement[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const inputs = listAppealImageFileInputs(modal);
    if (inputs.length > 0) return inputs;
    await new Promise((r) => setTimeout(r, 200));
  }
  return listAppealImageFileInputs(modal);
}

export type UploadDiagnostics = {
  inputCount: number;
  accepts: string[];
  previewBefore: number;
  previewAfter: number;
  inputFilesAfter: number;
  strategies: string[];
  fileSizes: number[];
  note?: string;
};

/** 平台「最多3张」时，上传第2/3张前有时需点继续添加 */
function clickAddAnotherImageSlot(modal: HTMLElement): void {
  const candidates = modal.querySelectorAll<HTMLElement>(
    'button, a, span[role="button"], div[role="button"]',
  );
  for (const el of candidates) {
    const t = (el.textContent ?? '').replace(/\s+/g, '');
    if (/继续上传|添加图片|再传|上传图片/.test(t) && t.length <= 12) {
      el.click();
      return;
    }
  }
}

async function tryInjectSingleFile(
  modal: HTMLElement,
  input: HTMLInputElement | null,
  dropZone: HTMLElement | null,
  file: File,
  diag: UploadDiagnostics,
  previewBefore: number,
  label: string,
): Promise<boolean> {
  const one = [file];
  if (input && assignFilesToInput(input, one)) {
    diag.strategies.push(`${label}:assign`);
    await new Promise((r) => setTimeout(r, UPLOAD_INJECT_WAIT_MS));
    if (uploadPreviewIncreased(modal, previewBefore)) return true;
    return true;
  }
  if (dropZone) {
    dropFilesOnZone(dropZone, one);
    diag.strategies.push(`${label}:drop`);
    await new Promise((r) => setTimeout(r, 450));
    if (uploadPreviewIncreased(modal, previewBefore)) return true;
  }
  if (input) {
    try {
      input.click();
      diag.strategies.push(`${label}:click`);
    } catch {
      /* ignore */
    }
    assignFilesToInput(input, one);
    await new Promise((r) => setTimeout(r, 450));
    if (uploadPreviewIncreased(modal, previewBefore)) return true;
  }
  return false;
}

/** 逐张上传（与最初只传聊天截图一致：每次 change 只带 1 个 File） */
async function uploadFilesOneByOne(
  modal: HTMLElement,
  files: File[],
  diag: UploadDiagnostics,
): Promise<{ uploaded: number; names: string[] }> {
  const batch = files.slice(0, MAX_APPEAL_IMAGES);
  const names: string[] = [];
  let uploaded = 0;
  let lastPreview = countUploadPreviewImages(modal);

  for (let i = 0; i < batch.length; i++) {
    const file = batch[i]!;
    if (i > 0) {
      clickAddAnotherImageSlot(modal);
      await new Promise((r) => setTimeout(r, UPLOAD_ADD_SLOT_MS));
    }

    const inputs = await waitForAppealImageUploadInputs(modal, i === 0 ? 4000 : 1500);
    const input = inputs[inputs.length - 1] ?? inputs[0] ?? null;
    const dropZone = findImageUploadDropZone(input, modal);
    const previewBefore = lastPreview;

    const injected = await tryInjectSingleFile(
      modal,
      input,
      dropZone,
      file,
      diag,
      previewBefore,
      `file${i + 1}`,
    );
    await new Promise((r) => setTimeout(r, UPLOAD_PER_FILE_GAP_MS));
    lastPreview = countUploadPreviewImages(modal);
    if (injected || lastPreview > previewBefore) {
      uploaded += 1;
      names.push(file.name);
    }
  }

  return { uploaded, names };
}

/**
 * 向「上传图片」逐张注入（平台最多 3 张：聊天截图 + 质检报告）。
 */
export async function uploadAppealEvidenceImages(
  modal: HTMLElement,
  files: File[],
): Promise<FormFillStep & { diagnostics?: UploadDiagnostics }> {
  const batch = files.slice(0, MAX_APPEAL_IMAGES);
  if (batch.length === 0) {
    return { step: '上传凭证图片', ok: false, detail: '无待上传文件' };
  }

  const previewBefore = countUploadPreviewImages(modal);
  const inputs = await waitForAppealImageUploadInputs(modal);
  const input = inputs[0] ?? null;
  const dropZone = findImageUploadDropZone(input, modal);

  const diagnostics: UploadDiagnostics = {
    inputCount: inputs.length,
    accepts: inputs.map((i) => i.getAttribute('accept') ?? ''),
    previewBefore,
    previewAfter: previewBefore,
    inputFilesAfter: 0,
    strategies: [],
    fileSizes: batch.map((f) => f.size),
  };

  if (!input && !dropZone) {
    diagnostics.note = '未找到 file input；请确认已选「可以提供凭证」';
    return {
      step: '上传凭证图片',
      ok: false,
      detail: '未找到上传控件，请确认已选「可以提供凭证」',
      diagnostics,
    };
  }

  diagnostics.strategies.push('one-by-one');
  const { uploaded, names: uploadedNames } = await uploadFilesOneByOne(modal, batch, diagnostics);

  diagnostics.previewAfter = await waitForUploadPreviewReady(
    modal,
    previewBefore,
    batch.length,
  );
  diagnostics.inputFilesAfter = input?.files?.length ?? 0;

  const previewDelta = diagnostics.previewAfter - previewBefore;
  const visualOk = previewDelta >= batch.length || diagnostics.previewAfter >= batch.length;
  const injectOk = uploaded >= batch.length;

  if (!visualOk && previewDelta <= 0 && uploaded === 0) {
    return {
      step: '上传凭证图片',
      ok: false,
      detail: `未能上传凭证（0/${batch.length}），请手动点「上传图片」`,
      diagnostics,
    };
  }

  const ok = visualOk || injectOk || previewDelta > 0;
  const count = Math.max(diagnostics.previewAfter - previewBefore, uploaded, previewDelta);
  return {
    step: '上传凭证图片',
    ok,
    detail: ok
      ? `已上传 ${Math.min(batch.length, count || batch.length)} 张：${uploadedNames.length ? uploadedNames.join('、') : batch.map((f) => f.name).join('、')}`
      : `上传结果不明`,
    diagnostics,
  };
}
