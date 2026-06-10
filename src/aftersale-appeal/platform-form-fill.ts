import type { AftersaleAppealRecommendation, AftersaleAppealSnapshot } from './types';
import {
  appealSubTypeCodeFromModalLabel,
  flattenReasonOptions,
  unwrapCheckAppeal,
} from './api-unwrap';
import { resolvePlatformReason } from './reason-pick';
import { findRightsAppealModal, parseAppealSubTypeLabelFromModal } from './page-context';
import { readCachedCheckAppeal } from './order-context';
import { refineAppealDescriptionWithEvidence } from './ollama-client';

export type FormFillStep = {
  step: string;
  ok: boolean;
  detail?: string;
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForRightsAppealModal(timeoutMs = 15000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const modal = findRightsAppealModal();
    if (modal) return modal;
    await sleep(200);
  }
  throw new Error('未找到「维权申诉」弹窗，请先在列表点击「发起申诉」');
}

function norm(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

const OTHER_APPEAL_REASON_RE = /非以上申诉原因/;

function isInVisibleLabels(label: string, visible: string[]): boolean {
  const want = norm(label);
  if (!want) return false;
  return visible.some((v) => {
    const d = norm(v);
    return d === want || textMatchesOption(d, want, true);
  });
}

function filterReasonOptionsForModal(
  options: ReturnType<typeof flattenReasonOptions>,
  modal: HTMLElement | null,
): ReturnType<typeof flattenReasonOptions> {
  if (!modal) return options;
  const label = parseAppealSubTypeLabelFromModal(modal);
  const code = appealSubTypeCodeFromModalLabel(label);
  if (!code) return options;
  const filtered = options.filter((o) => !o.appealSubTypeCode || o.appealSubTypeCode === code);
  return filtered.length ? filtered : options;
}

function isVisible(el: Element): boolean {
  const st = getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function simulatePointerClick(el: HTMLElement): void {
  try {
    el.click();
    return;
  } catch {
    /* fallback */
  }
  const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

const DROPDOWN_ROOT_SELECTORS = [
  '[data-testid="beast-core-cascader-dropdown-contentRoot"]',
  '[data-testid="beast-core-cascader-list-wrapper"]',
  '[data-testid="beast-core-cascader-menu"]',
  '[data-testid="beast-core-menu"]',
  '[data-testid="beast-core-select-dropdown"]',
];

const DROPDOWN_OPTION_SELECTORS = [
  '[data-testid="beast-core-cascader-list-item"]',
  '[data-testid="beast-core-menu-menuItem-li"]',
  '[data-testid="beast-core-cascader-menu"] li',
  '[data-testid="beast-core-menu"] li',
  '[data-testid="beast-core-select-dropdown"] [role="option"]',
  '[data-testid="beast-core-cascader-dropdown-contentRoot"] li',
  '[class*="CSD_menu"] li',
  '[class*="CSD_list"] li',
  '[class*="list-item"]',
  '[role="menuitem"]',
];

function findOpenDropdownRoots(): HTMLElement[] {
  const roots: HTMLElement[] = [];
  for (const sel of DROPDOWN_ROOT_SELECTORS) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (isVisible(el) && !roots.includes(el)) roots.push(el);
    }
  }
  return roots;
}

function countDropdownOptions(): number {
  return collectOptionNodes(document).length;
}

function textMatchesOption(got: string, want: string, partial: boolean): boolean {
  if (!got || !want || got.length < 4) return false;
  if (!partial) return got === want;
  if (got === want) return true;
  if (want.length >= 12 && got.includes(want)) return true;
  if (got.length >= 12 && want.includes(got)) return true;
  return false;
}

function collectOptionNodes(root: ParentNode): HTMLElement[] {
  const dropdownRoots = findOpenDropdownRoots();
  const searchRoots: ParentNode[] = dropdownRoots.length ? dropdownRoots : [root];
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];

  for (const scope of searchRoots) {
    for (const sel of DROPDOWN_OPTION_SELECTORS) {
      for (const node of scope.querySelectorAll<HTMLElement>(sel)) {
        if (seen.has(node)) continue;
        const t = norm(node.textContent ?? '');
        if (t.length < 6 || t.length > 240) continue;
        if (!isVisible(node) && dropdownRoots.length === 0) continue;
        seen.add(node);
        out.push(node);
      }
    }
  }
  return out;
}

function readOptionLabelFromNode(node: HTMLElement): string {
  const title = (node.getAttribute('title') ?? '').trim();
  if (title.length >= 6) return norm(title);

  const aria = (node.getAttribute('aria-label') ?? '').trim();
  if (aria.length >= 6) return norm(aria);

  let best = '';
  const candidates = [node, ...node.querySelectorAll<HTMLElement>('span, div, label')];
  for (const el of candidates) {
    const t = norm(el.textContent ?? '');
    if (t.length > best.length && t.length >= 6 && t.length <= 240) best = t;
  }
  return best || norm(node.textContent ?? '');
}

function scrapeVisibleReasonLabels(): string[] {
  const labels: string[] = [];
  for (const node of collectOptionNodes(document)) {
    const t = readOptionLabelFromNode(node);
    if (t.length < 6) continue;
    const dup = labels.find((x) => x === t || textMatchesOption(x, t, true));
    if (!dup) labels.push(t);
  }
  return labels;
}

export function matchVisibleReasonLabel(preferred: string, visible: string[]): string {
  const want = norm(preferred);
  if (!want || !visible.length) return preferred;
  const exact = visible.find((v) => norm(v) === want);
  if (exact) return exact;
  const partial = visible.find((v) => textMatchesOption(norm(v), want, true));
  if (partial) return partial;
  if (want.length >= 10) {
    const prefix = visible.find((v) => {
      const d = norm(v);
      return d.startsWith(want) || want.startsWith(d);
    });
    if (prefix) return prefix;
  }
  return preferred;
}

async function clickCascaderOption(root: ParentNode, label: string, partial = true): Promise<boolean> {
  const want = norm(label);
  if (!want || want.length < 3) return false;

  const candidates: { el: HTMLElement; text: string }[] = [];
  for (const node of collectOptionNodes(root)) {
    const got = readOptionLabelFromNode(node);
    if (!textMatchesOption(got, want, partial)) continue;
    candidates.push({ el: node, text: got });
  }
  candidates.sort((a, b) => b.text.length - a.text.length);

  for (const { el, text } of candidates) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      /* ignore */
    }
    simulatePointerClick(el);
    const labelEl = el.querySelector<HTMLElement>(
      '[data-testid="beast-core-cascader-list-item-label"], [data-testid="beast-core-cascader-list-item"] span, [class*="list-item"] span',
    );
    if (labelEl && labelEl !== el) {
      const lt = readOptionLabelFromNode(labelEl);
      if (textMatchesOption(lt, want, partial)) simulatePointerClick(labelEl);
    }
    await sleep(360);
    return true;
  }
  return false;
}

async function clickCascaderOptionVerified(
  modal: HTMLElement,
  label: string,
  partial: boolean,
): Promise<boolean> {
  const clicked = await clickCascaderOption(document, label, partial);
  if (!clicked) return false;
  for (let i = 0; i < 10; i++) {
    await sleep(280);
    if (isReasonSelected(modal, label)) return true;
  }
  return isReasonSelected(modal);
}

async function waitCascaderMenu(timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (countDropdownOptions() > 0) return true;
    await sleep(100);
  }
  return false;
}

export async function peekVisibleReasonLabels(modal: HTMLElement): Promise<string[]> {
  const input = findReasonFieldInput(modal);
  if (!input) return [];
  closeReasonDropdown(input, modal);
  await sleep(150);
  openReasonDropdown(modal);
  await sleep(480);
  if (!(await waitCascaderMenu(4000))) {
    closeReasonDropdown(input, modal);
    return [];
  }
  const labels = scrapeVisibleReasonLabels();
  closeReasonDropdown(input, modal);
  await sleep(150);
  return labels;
}

function findReasonFieldInput(modal: HTMLElement): HTMLInputElement | null {
  const field =
    modal.querySelector('#subInfoVOS\\[0\\]\\.reason') ??
    modal.querySelector('[id="subInfoVOS[0].reason"]');
  return (
    field?.querySelector<HTMLInputElement>('[data-testid="beast-core-cascader-htmlInput"]') ??
    modal.querySelector<HTMLInputElement>('[data-testid="beast-core-cascader-htmlInput"]')
  );
}

function findReasonFieldWrap(modal: HTMLElement): HTMLElement | null {
  return (
    modal.querySelector<HTMLElement>('#subInfoVOS\\[0\\]\\.reason') ??
    modal.querySelector<HTMLElement>('[id="subInfoVOS[0].reason"]')
  );
}

function openReasonDropdown(modal: HTMLElement): boolean {
  const field = findReasonFieldWrap(modal);
  const input = findReasonFieldInput(modal);
  if (!input) return false;

  const triggers = [
    field?.querySelector<HTMLElement>('[data-testid="beast-core-input-suffix"]'),
    field?.querySelector<HTMLElement>('[data-testid="beast-core-cascader-input"]'),
    input.closest<HTMLElement>('[data-testid="beast-core-cascader-input"]'),
    input,
  ].filter(Boolean) as HTMLElement[];

  for (const el of triggers) {
    simulatePointerClick(el);
  }
  input.focus();
  return true;
}

function closeReasonDropdown(input: HTMLInputElement, modal?: HTMLElement): void {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, keyCode: 27 }),
  );
  input.blur();
  if (modal) {
    const header = modal.querySelector<HTMLElement>('.MDL_header_5-189-0, [class*="MDL_header"]');
    header?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }
}

function hasEvidenceSection(modal: HTMLElement): boolean {
  const text = modal.textContent ?? '';
  if (!text.includes('必填凭证')) return false;
  for (const inp of modal.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    const accept = (inp.getAttribute('accept') ?? '').toLowerCase();
    if (!accept.includes('video')) return true;
  }
  return false;
}

function readReasonDisplayText(modal: HTMLElement): string {
  const input = findReasonFieldInput(modal);
  const fromInput = norm(input?.value ?? input?.getAttribute('value') ?? '');
  if (fromInput && fromInput !== '请选择') return fromInput;
  const field = findReasonFieldWrap(modal);
  if (!field) return '';
  const clone = field.cloneNode(true) as HTMLElement;
  for (const lb of clone.querySelectorAll('label')) lb.remove();
  const t = norm(clone.textContent ?? '');
  if (t.includes('申诉原因')) return t.replace(/^申诉原因/, '').trim();
  return t;
}

function isReasonSelected(modal: HTMLElement, label?: string): boolean {
  const val = readReasonDisplayText(modal);
  if (label) {
    const want = norm(label);
    if (!val || val === '请选择') return false;
    if (val === want) return true;
    return textMatchesOption(val, want, true);
  }
  if (!val || val === '请选择') return false;
  return val.length >= 6;
}

async function selectReasonByKeyboard(
  modal: HTMLElement,
  input: HTMLInputElement,
  targetLabel: string,
  visible: string[],
): Promise<boolean> {
  const matched = matchVisibleReasonLabel(targetLabel, visible);
  const want = norm(matched);
  let idx = visible.findIndex((v) => norm(v) === want);
  if (idx < 0) {
    idx = visible.findIndex((v) => textMatchesOption(norm(v), want, true));
  }
  if (idx < 0) return false;

  input.focus();
  for (let i = 0; i <= idx; i += 1) {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        bubbles: true,
        keyCode: 40,
      }),
    );
    await sleep(90);
  }
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }),
  );
  await sleep(450);
  return isReasonSelected(modal, matched);
}

function enrichSnapshotForFill(snapshot: AftersaleAppealSnapshot): AftersaleAppealSnapshot {
  const options = flattenReasonOptions(snapshot.checkAppeal ?? undefined);
  if (options.length) return snapshot;
  const cached = readCachedCheckAppeal(snapshot.orderSn, snapshot.afterSalesId);
  if (!cached) return snapshot;
  try {
    const checkAppeal = unwrapCheckAppeal(cached);
    if (flattenReasonOptions(checkAppeal).length) {
      return { ...snapshot, checkAppeal };
    }
  } catch {
    /* ignore */
  }
  return snapshot;
}

function reasonOptionsForModal(
  snapshot: AftersaleAppealSnapshot,
  modal: HTMLElement,
): ReturnType<typeof flattenReasonOptions> {
  const snap = enrichSnapshotForFill(snapshot);
  const all = flattenReasonOptions(snap.checkAppeal ?? undefined);
  return filterReasonOptionsForModal(all, modal);
}

async function selectAppealReasonCascader(
  modal: HTMLElement,
  rec: AftersaleAppealRecommendation,
  snapshot: AftersaleAppealSnapshot,
  cachedVisibleLabels?: string[],
): Promise<boolean> {
  const input = findReasonFieldInput(modal);
  if (!input) return false;

  const targetLabel = rec.subReasonDesc?.trim();
  if (!targetLabel) return false;

  if (isReasonSelected(modal, targetLabel)) return true;

  closeReasonDropdown(input, modal);
  await sleep(200);
  openReasonDropdown(modal);
  await sleep(520);
  if (!(await waitCascaderMenu(4500))) {
    closeReasonDropdown(input, modal);
    return false;
  }

  let visible = scrapeVisibleReasonLabels();
  if (!visible.length && cachedVisibleLabels?.length) {
    visible = cachedVisibleLabels;
  }
  let finalLabel = matchVisibleReasonLabel(targetLabel, visible);

  if (!isInVisibleLabels(finalLabel, visible)) {
    const otherLabel = visible.find((v) => OTHER_APPEAL_REASON_RE.test(v));
    if (otherLabel && !OTHER_APPEAL_REASON_RE.test(finalLabel)) {
      await clickCascaderOption(document, otherLabel, false);
      await sleep(450);
      await waitCascaderMenu(2500);
      visible = scrapeVisibleReasonLabels();
      finalLabel = matchVisibleReasonLabel(targetLabel, visible);
    }
  }

  const snap = enrichSnapshotForFill(snapshot);
  const options = reasonOptionsForModal(snap, modal);
  const platform = resolvePlatformReason(
    rec,
    options.length ? options : flattenReasonOptions(snap.checkAppeal ?? undefined),
    snap,
    false,
  );
  const needParentStep =
    platform.parentReasonCode > 0 &&
    platform.parentReasonCodeDesc &&
    !visible.some((v) => norm(v) === norm(finalLabel));

  if (needParentStep) {
    await clickCascaderOption(document, platform.parentReasonCodeDesc, false);
    await sleep(450);
    await waitCascaderMenu(2500);
  }

  if (await clickCascaderOptionVerified(modal, finalLabel, true)) {
    closeReasonDropdown(input, modal);
    return true;
  }

  openReasonDropdown(modal);
  await sleep(400);
  await waitCascaderMenu(3000);
  if (await clickCascaderOptionVerified(modal, finalLabel, false)) {
    closeReasonDropdown(input, modal);
    return true;
  }

  openReasonDropdown(modal);
  await sleep(400);
  await waitCascaderMenu(3000);
  const kbVisible = scrapeVisibleReasonLabels();
  const kbOk = await selectReasonByKeyboard(modal, input, finalLabel, kbVisible.length ? kbVisible : visible);
  closeReasonDropdown(input, modal);
  return kbOk && (isReasonSelected(modal, finalLabel) || isReasonSelected(modal));
}

function setCheckboxChecked(label: ParentNode, text: string): boolean {
  const labels = label.querySelectorAll<HTMLLabelElement>('label[data-testid="beast-core-checkbox"]');
  for (const lb of labels) {
    if (!(lb.textContent ?? '').includes(text)) continue;
    const input = lb.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (input && !input.checked) {
      lb.click();
      input.click();
      return true;
    }
    if (!input?.checked) {
      lb.click();
      return true;
    }
    return true;
  }
  return false;
}

async function selectComplainType(modal: HTMLElement, rec: AftersaleAppealRecommendation): Promise<boolean> {
  if (!rec.complainConsumer || !rec.complainTypeDesc) return true;
  await sleep(500);
  const selects = modal.querySelectorAll<HTMLElement>(
    '[data-testid="beast-core-select"], .IPT_outerWrapper_5-189-0',
  );
  for (const sel of selects) {
    const formItem = sel.closest('[data-testid="beast-core-form-item"]');
    const label = formItem?.querySelector('label')?.textContent ?? '';
    if (!label.includes('投诉') && !label.includes('类型')) continue;
    sel.click();
    await sleep(350);
    return clickCascaderOption(document, rec.complainTypeDesc, true);
  }
  const field = modal.querySelector('[id="complainType"]');
  if (field) {
    const trigger = field.querySelector<HTMLElement>('[data-testid="beast-core-select-htmlInput"]');
    trigger?.click();
    await sleep(350);
    return clickCascaderOption(document, rec.complainTypeDesc, true);
  }
  return false;
}

export function fillAftersaleAppealForm(
  modal: HTMLElement,
  rec: AftersaleAppealRecommendation,
): FormFillStep[] {
  const steps: FormFillStep[] = [];

  const amountInput = modal.querySelector<HTMLInputElement>(
    '#subInfoVOS\\[0\\]\\.amount input, [field="subInfoVOS[0].amount"] input, [data-testid="beast-core-inputNumber-htmlInput"]',
  );
  if (amountInput && rec.appealAmountYuan) {
    setReactInputValue(amountInput, rec.appealAmountYuan);
    steps.push({ step: '申诉金额', ok: true, detail: `${rec.appealAmountYuan} 元` });
  } else {
    steps.push({ step: '申诉金额', ok: false, detail: '未找到金额输入框' });
  }

  const descTa =
    modal.querySelector<HTMLTextAreaElement>('#description textarea') ??
    modal.querySelector<HTMLTextAreaElement>('[data-testid="beast-core-textArea-htmlInput"]');
  if (descTa && rec.description.trim()) {
    const descText = rec.description.trim();
    setReactInputValue(descTa, descText);
    steps.push({ step: '申诉描述', ok: true, detail: `${descText.length} 字` });
  } else {
    steps.push({ step: '申诉描述', ok: false, detail: '未找到描述输入框' });
  }

  return steps;
}

export async function fillAftersaleAppealFormAsync(
  modal: HTMLElement,
  rec: AftersaleAppealRecommendation,
  snapshot: AftersaleAppealSnapshot,
): Promise<FormFillStep[]> {
  const steps: FormFillStep[] = [];

  const reasonOk = await selectAppealReasonCascader(
    modal,
    rec,
    snapshot,
    rec.visibleReasonLabels,
  );
  let visibleReasons: string[] = rec.visibleReasonLabels ?? [];
  if (!reasonOk && !visibleReasons.length) {
    visibleReasons = await peekVisibleReasonLabels(modal);
  }
  steps.push({
    step: '申诉原因',
    ok: reasonOk,
    detail: reasonOk
      ? rec.subReasonDesc
      : visibleReasons.length
        ? `未选中：${rec.subReasonDesc || '—'}（下拉 ${visibleReasons.length} 项：${visibleReasons.slice(0, 2).join('；')}${visibleReasons.length > 2 ? '…' : ''}）`
        : `未选中：${rec.subReasonDesc || '—'}`,
  });

  let fillRec = rec;
  if (reasonOk) {
    try {
      await waitForAftersaleEvidenceSections(modal, 8000);
      const evidenceHints = readRequiredEvidenceHintTexts(modal);
      if (evidenceHints.length) {
        const refined = await refineAppealDescriptionWithEvidence(snapshot, rec, evidenceHints);
        fillRec = { ...rec, description: refined.description };
        steps.push({
          step: '申诉描述参考',
          ok: true,
          detail: `已纳入必填凭证 ${evidenceHints.length} 条：${evidenceHints[0]?.slice(0, 36) ?? ''}${evidenceHints[0] && evidenceHints[0].length > 36 ? '…' : ''}`,
        });
      }
    } catch (e) {
      steps.push({
        step: '申诉描述参考',
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  steps.push(...fillAftersaleAppealForm(modal, fillRec));

  if (rec.complainConsumer) {
    const chk = setCheckboxChecked(modal, '投诉该订单消费者不合理行为');
    steps.push({
      step: '投诉消费者',
      ok: chk,
      detail: chk ? '已勾选' : '未找到复选框',
    });
    const typeOk = await selectComplainType(modal, rec);
    if (rec.complainTypeDesc) {
      steps.push({
        step: '投诉类型',
        ok: typeOk,
        detail: typeOk ? rec.complainTypeDesc : '未匹配投诉类型下拉',
      });
    }
  } else {
    steps.push({ step: '投诉消费者', ok: true, detail: '规则未建议勾选' });
  }

  return steps;
}

function isVideoFileInput(inp: HTMLInputElement): boolean {
  const accept = (inp.getAttribute('accept') ?? '').toLowerCase();
  return accept.includes('video') || accept.includes('mp4');
}

function listImageInputsIn(root: ParentNode): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();
  const out: HTMLInputElement[] = [];
  for (const inp of root.querySelectorAll<HTMLInputElement>(
    'input[data-testid="beast-core-upload-input"][type="file"], input[type="file"]',
  )) {
    if (seen.has(inp) || isVideoFileInput(inp)) continue;
    seen.add(inp);
    out.push(inp);
  }
  return out;
}

function uploadRootForInput(input: HTMLInputElement): HTMLElement {
  return (
    input.closest<HTMLElement>('[data-testid="beast-core-form-item"]') ??
    input.closest<HTMLElement>('[data-testid*="upload"]') ??
    input.parentElement ??
    input
  );
}

function resolveEvidenceUploadRoots(modal: HTMLElement): {
  required: HTMLElement;
  optional: HTMLElement;
} {
  const text = modal.textContent ?? '';
  const requiredSection = findEvidenceSectionRoot(modal, '必填凭证');
  const optionalSection = text.includes('选填凭证')
    ? findEvidenceSectionRoot(modal, '选填凭证')
    : requiredSection;

  // 优先在各自区块内找 input，避免“第一个/最后一个 input”在页面结构变化时串区上传
  const requiredInputs = listImageInputsIn(requiredSection);
  const optionalInputs = listImageInputsIn(optionalSection);
  const allInputs = listImageInputsIn(modal);

  const requiredInput = requiredInputs[0] ?? allInputs[0] ?? null;
  const optionalInput =
    optionalInputs[optionalInputs.length - 1] ??
    allInputs[allInputs.length - 1] ??
    requiredInput;

  return {
    required: requiredInput ? uploadRootForInput(requiredInput) : requiredSection,
    optional: optionalInput ? uploadRootForInput(optionalInput) : optionalSection,
  };
}

function summarizeUploadContext(modal: HTMLElement, requiredRoot: HTMLElement, optionalRoot: HTMLElement): string {
  const requiredInputs = listImageInputsIn(requiredRoot).length;
  const optionalInputs = listImageInputsIn(optionalRoot).length;
  const allInputs = listImageInputsIn(modal).length;
  return `input统计：必填区=${requiredInputs}，选填区=${optionalInputs}，全弹窗=${allInputs}`;
}

function findEvidenceSectionRoot(modal: HTMLElement, label: string): HTMLElement {
  const short = label.replace(/\s+/g, '');
  for (const el of modal.querySelectorAll<HTMLElement>('label, div, span, p')) {
    const t = (el.textContent ?? '').replace(/\s+/g, '');
    if (!t.includes(short) || t.length > 40) continue;
    let node: HTMLElement | null = el;
    for (let i = 0; i < 10 && node; i++) {
      if (listImageInputsIn(node).length > 0) return node;
      node = node.parentElement;
    }
  }
  return modal;
}

/** 读取选中申诉原因后，平台展示的「必填凭证」说明文案 */
export function readRequiredEvidenceHintTexts(modal: HTMLElement): string[] {
  const root = findEvidenceSectionRoot(modal, '必填凭证');
  const lines = (root.innerText ?? root.textContent ?? '')
    .split(/\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const skipRe =
    /^(上传图片|上传视频|查看示例|\(\d+\/\d+\)|请上传凭证|0\/\d)|^\*?必填凭证$|^请上传凭证图片或视频$/;
  const out: string[] = [];

  for (let line of lines) {
    if (skipRe.test(line)) continue;
    line = line.replace(/\s*查看示例\s*$/, '').trim();
    if (!line || line.length < 6) continue;

    if (/^请根据示例上传有效凭证/.test(line)) {
      out.push(line);
      continue;
    }
    if (/^以下凭证/.test(line)) {
      out.push(line);
      continue;
    }

    const numbered = line.match(/^[12][、．.]\s*(.+)$/);
    if (numbered?.[1] && numbered[1].length >= 8) {
      out.push(numbered[1].replace(/\s*查看示例\s*$/, '').trim());
    }
  }

  return [...new Set(out.filter((s) => s.length >= 6))];
}

export async function waitForAftersaleEvidenceSections(
  modal: HTMLElement,
  timeoutMs = 12000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = modal.textContent ?? '';
    if (text.includes('必填凭证') && listImageInputsIn(modal).length > 0) return;
    await sleep(200);
  }
  throw new Error('未出现凭证上传区：请先确认申诉原因已选中');
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
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return (input.files?.length ?? 0) >= files.length;
}

async function uploadFilesInSection(
  sectionRoot: HTMLElement,
  files: File[],
): Promise<{ uploaded: number; names: string[] }> {
  const names: string[] = [];
  let uploaded = 0;
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await sleep(200);
    const inputs = listImageInputsIn(sectionRoot);
    const input = inputs[inputs.length - 1] ?? inputs[0];
    if (input && assignFilesToInput(input, [files[i]!])) {
      uploaded += 1;
      names.push(files[i]!.name);
    }
    await sleep(520);
  }
  return { uploaded, names };
}

/** 必填：质检+售后记录；选填：聊天截图（需先选申诉原因后出现上传区） */
export async function uploadAftersaleEvidenceBySection(
  modal: HTMLElement,
  requiredFiles: File[],
  optionalFiles: File[],
): Promise<FormFillStep[]> {
  await waitForAftersaleEvidenceSections(modal);
  const steps: FormFillStep[] = [];
  const { required: requiredRoot, optional: optionalRoot } = resolveEvidenceUploadRoots(modal);
  const uploadCtx = summarizeUploadContext(modal, requiredRoot, optionalRoot);

  if (requiredFiles.length) {
    const { uploaded, names } = await uploadFilesInSection(requiredRoot, requiredFiles);
    steps.push({
      step: '必填凭证',
      ok: uploaded > 0,
      detail:
        uploaded > 0
          ? `已上传 ${uploaded}/${requiredFiles.length}：${names.join('、')}；${uploadCtx}`
          : `未检测到必填区上传成功（请确认质检图已匹配且弹窗必填区可上传）；待上传：${requiredFiles.map((f) => f.name).join('、')}；${uploadCtx}`,
    });
  } else {
    steps.push({
      step: '必填凭证',
      ok: false,
      detail: `无待上传文件（通常为质检匹配未命中，或质检图只同步了目录未缓存图片）；${uploadCtx}`,
    });
  }

  if (optionalFiles.length) {
    await sleep(300);
    const { uploaded, names } = await uploadFilesInSection(optionalRoot, optionalFiles);
    steps.push({
      step: '选填凭证',
      ok: uploaded > 0,
      detail:
        uploaded > 0
          ? `已上传 ${uploaded}/${optionalFiles.length}：${names.join('、')}；${uploadCtx}`
          : `未检测到选填区预览；${uploadCtx}`,
    });
  }

  return steps;
}

/** 兼容 inject 单批上传 */
export async function uploadAftersaleEvidenceImages(
  modal: HTMLElement,
  files: File[],
): Promise<FormFillStep> {
  const steps = await uploadAftersaleEvidenceBySection(modal, files.slice(0, 3), []);
  const main = steps[0];
  return main ?? { step: '上传凭证', ok: false, detail: '无文件' };
}
