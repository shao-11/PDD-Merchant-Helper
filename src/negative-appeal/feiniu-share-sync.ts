import {
  FEINIU_QC_FOLDER,
  FEINIU_QC_FOLDER_FILE_ID,
  FEINIU_SHARE_PAGE_URL,
  QC_CATALOG_SOURCE_ID,
  parseShareIdFromUrl,
} from './feiniu-share-constants';
import { fetchBatchDownloadViaInject, fetchParallelDownloadViaInject } from './feiniu-share-batch';
import { base64DecodedBytes, formatBytes, MIN_QC_IMAGE_BYTES } from './feiniu-image-size';
import { loadImageFromShareDom } from './feiniu-share-dom';
import { groupFilesBySpec, parseSpecFromFeiniuFileName, type FeiniuShareFileEntry } from './feiniu-share-parse';
import type { QcSheetCatalog, QcSheetCatalogRow, QcSheetStoredImage } from './qc-sheet-types';

export type FnShareProbe = {
  shareId: string;
  files: FeiniuShareFileEntry[];
  lastListAt: number;
  hasAuth: boolean;
};

export type FnShareSyncDiag = {
  lines: string[];
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  ok(msg: string): void;
};

function createDiag(): FnShareSyncDiag {
  const lines: string[] = [];
  const log = (tag: string, msg: string) => {
    lines.push(`${tag} ${msg}`);
    console.info(`[滇同学][飞牛分享] ${msg}`);
  };
  return {
    lines,
    info: (m) => log('·', m),
    warn: (m) => log('!', m),
    error: (m) => log('✗', m),
    ok: (m) => log('✓', m),
  };
}

export class FeiniuShareSyncError extends Error {
  readonly diag: FnShareSyncDiag;

  constructor(short: string, diag: FnShareSyncDiag) {
    const body = diag.lines.slice(-30).join('\n');
    super(body ? `${short}\n\n${body}` : short);
    this.name = 'FeiniuShareSyncError';
    this.diag = diag;
  }
}

function imageId(path: string, fileId: number): string {
  return `fn-${fileId}-${path.length}`;
}

async function probeSharePage(win: Window, diag: FnShareSyncDiag): Promise<FnShareProbe> {
  const doc = win.document;
  doc.documentElement.removeAttribute('data-dtx-fn-share');
  win.dispatchEvent(new Event('dtx-fn-share-probe'));

  await new Promise<void>((resolve) => {
    const done = () => {
      win.removeEventListener('dtx-fn-share-probe-done', done);
      resolve();
    };
    win.addEventListener('dtx-fn-share-probe-done', done, { once: true });
    win.setTimeout(resolve, 800);
  });

  const raw = doc.documentElement.getAttribute('data-dtx-fn-share') ?? '';
  if (!raw) {
    diag.warn('未读到分享页缓存，请刷新页面后重试');
    return { shareId: '', files: [], lastListAt: 0, hasAuth: false };
  }

  try {
    return JSON.parse(raw) as FnShareProbe;
  } catch {
    return { shareId: '', files: [], lastListAt: 0, hasAuth: false };
  }
}

function toStoredImage(
  file: FeiniuShareFileEntry,
  packed: { mime: string; dataBase64: string },
): QcSheetStoredImage {
  return {
    id: imageId(file.path, file.fileId),
    mime: packed.mime,
    dataBase64: packed.dataBase64,
    fileName: file.fileName,
    sourceUrl: file.path,
  };
}

/** 优先 download 原图；缩略图过小会丢弃，避免上传拼多多后看不清 */
async function loadImageForFile(
  win: Window,
  file: FeiniuShareFileEntry,
  diag: FnShareSyncDiag,
): Promise<QcSheetStoredImage | null> {
  const fromDl = await downloadViaPage(win, file, diag);
  if (fromDl?.dataBase64) {
    const kb = base64DecodedBytes(fromDl.dataBase64);
    if (kb >= MIN_QC_IMAGE_BYTES) {
      diag.ok(`${file.fileName} ← 原图下载（${formatBytes(kb)}）`);
      return fromDl;
    }
    diag.warn(`${file.fileName} 下载仅 ${formatBytes(kb)}，偏小，尝试其他途径…`);
  }

  const fromDom = await loadImageFromShareDom(win.document, file.fileName);
  if (fromDom?.dataBase64) {
    const kb = base64DecodedBytes(fromDom.dataBase64);
    if (kb >= MIN_QC_IMAGE_BYTES) {
      diag.ok(`${file.fileName} ← 页面图片（${formatBytes(kb)}）`);
      return toStoredImage(file, fromDom);
    }
    diag.warn(`${file.fileName} 列表缩略图仅 ${formatBytes(kb)}，过模糊已跳过`);
  }

  if (fromDl?.dataBase64) {
    diag.warn(`${file.fileName} 已用偏小下载图，建议刷新分享页后重新同步`);
    return fromDl;
  }

  return null;
}

async function downloadViaPage(
  win: Window,
  file: FeiniuShareFileEntry,
  diag: FnShareSyncDiag,
): Promise<QcSheetStoredImage | null> {
  const requestId = `r${Date.now()}-${file.fileId}`;
  const doc = win.document;

  return new Promise((resolve) => {
    const done = () => {
      win.removeEventListener('dtx-fn-share-download-done', onDone);
      const raw = doc.documentElement.getAttribute(`data-dtx-fn-dl-${requestId}`) ?? '';
      doc.documentElement.removeAttribute(`data-dtx-fn-dl-${requestId}`);
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        const r = JSON.parse(raw) as {
          ok: boolean;
          mime?: string;
          dataBase64?: string;
          error?: string;
          via?: string;
        };
        if (!r.ok || !r.dataBase64) {
          if (r.error) diag.warn(`${file.fileName} download: ${r.error}`);
          resolve(null);
          return;
        }
        resolve({
          id: imageId(file.path, file.fileId),
          mime: r.mime || 'image/png',
          dataBase64: r.dataBase64,
          fileName: file.fileName,
          sourceUrl: file.path,
        });
      } catch {
        resolve(null);
      }
    };

    const onDone = (ev: Event) => {
      const rid = (ev as CustomEvent).detail?.requestId;
      if (rid === requestId) done();
    };

    win.addEventListener('dtx-fn-share-download-done', onDone);
    win.dispatchEvent(
      new CustomEvent('dtx-fn-share-download', {
        detail: { requestId, file },
      }),
    );
    win.setTimeout(done, 12000);
  });
}

/** 在已打开的飞牛分享页 window 上同步（须由 content script 传入当前 window） */
export async function syncFeiniuShareFromWindow(
  win: Window = window,
  href = win.location.href,
): Promise<{ catalog: QcSheetCatalog; warnings: string[]; diag: FnShareSyncDiag }> {
  const diag = createDiag();
  const warnings: string[] = [];
  const shareId = parseShareIdFromUrl(href) ?? '';

  diag.info(`开始同步飞牛分享；shareId=${shareId || '?'}`);

  const probe = await probeSharePage(win, diag);
  let files = filterQcImageFiles(probe.files);

  diag.info(`Hook 缓存 ${probe.files.length} 个文件，质检图 ${files.length} 个；auth=${probe.hasAuth ? '有' : '无'}`);

  if (!files.length) {
    diag.warn('Hook 无缓存，由页面脚本代发 /api/v1/share/list（带 auth）…');
    const listed = await fetchShareListViaInject(win, diag);
    files = filterQcImageFiles(listed);
    if (files.length) diag.ok(`list 接口获取 ${files.length} 张图`);
  }

  if (!files.length) {
    throw new FeiniuShareSyncError(
      '未获取到质检报告图片列表。请打开分享页进入「质检报告」文件夹，等文件列表显示后再同步',
      diag,
    );
  }

  const bySpec = groupFilesBySpec(files);
  if (!bySpec.size) {
    throw new FeiniuShareSyncError(
      '有图片但文件名不符合规则。请命名为：滇同学-云南黑糖-100克袋-1.png（末尾 -1/-2 为序号）',
      diag,
    );
  }

  diag.ok(`解析出 ${bySpec.size} 个规格`);

  const batchMap = new Map<string, QcSheetStoredImage>();
  diag.info(`批量拉取 ${files.length} 张原图（ZIP 或并行 API）…`);
  const batchHit = await fetchBatchDownloadViaInject(win, files, FEINIU_QC_FOLDER, diag);
  if (batchHit?.size) {
    diag.ok(`已获取 ${batchHit.size}/${files.length} 张`);
    for (const [k, v] of batchHit) batchMap.set(k, v);
  }

  const missingAfterBatch = files.filter((f) => !batchMap.has(f.fileName));
  if (missingAfterBatch.length) {
    diag.info(`并行补拉 ${missingAfterBatch.length} 张…`);
    const extra = await fetchParallelDownloadViaInject(win, missingAfterBatch, diag);
    if (extra?.size) {
      for (const [k, v] of extra) batchMap.set(k, v);
      diag.ok(`补拉后共 ${batchMap.size}/${files.length} 张`);
    }
    try {
      win.dispatchEvent(new CustomEvent('dtx-fn-share-clear-selection'));
    } catch {
      /* ignore */
    }
  }

  const rows: QcSheetCatalogRow[] = [];

  for (const [specName, specFiles] of bySpec) {
    const images: QcSheetStoredImage[] = [];
    const ordered = [...specFiles].sort(
      (a, b) => (parseSpecFromFeiniuFileName(a.fileName)?.index ?? 0) - (parseSpecFromFeiniuFileName(b.fileName)?.index ?? 0),
    );
    for (const f of ordered.slice(0, 4)) {
      const cached = batchMap.get(f.fileName);
      if (cached) {
        images.push(cached);
        continue;
      }
      let im = await loadImageForFile(win, f, diag);
      if (im) images.push(im);
      else warnings.push(`「${specName}」${f.fileName} 读取失败`);
    }
    if (!images.length) warnings.push(`「${specName}」无可用图片`);
    rows.push({ specName, images });
  }

  const withImg = rows.filter((r) => r.images.length > 0);
  if (!withImg.length) {
    throw new FeiniuShareSyncError(
      '规格已识别但原图全部获取失败（多为 download 签名无效）。请刷新分享页 → 在列表里手动点一次「下载」→ 再点「同步质检图」',
      diag,
    );
  }

  diag.ok(`完成：${withImg.length} 行规格，${withImg.reduce((n, r) => n + r.images.length, 0)} 张图`);

  return {
    catalog: {
      docId: QC_CATALOG_SOURCE_ID,
      syncedAt: Date.now(),
      rowCount: withImg.length,
      rows: withImg,
    },
    warnings,
    diag,
  };
}

function filterQcImageFiles(list: FeiniuShareFileEntry[]): FeiniuShareFileEntry[] {
  return list.filter(
    (f) =>
      /\.(png|jpe?g|webp)/i.test(f.fileName) &&
      (f.path.includes('质检') || f.fileName.includes('克袋')),
  );
}

/** 在 MAIN 世界代发 list（须带页面 Hook 到的 auth/authx） */
async function fetchShareListViaInject(
  win: Window,
  diag: FnShareSyncDiag,
): Promise<FeiniuShareFileEntry[]> {
  const requestId = `list-${Date.now()}`;
  const doc = win.document;

  return new Promise((resolve) => {
    const finish = () => {
      win.removeEventListener('dtx-fn-share-list-done', onDone);
      const raw = doc.documentElement.getAttribute(`data-dtx-fn-list-${requestId}`) ?? '';
      doc.documentElement.removeAttribute(`data-dtx-fn-list-${requestId}`);
      if (!raw) {
        diag.warn('list 请求无响应');
        resolve([]);
        return;
      }
      try {
        const r = JSON.parse(raw) as {
          ok: boolean;
          files?: FeiniuShareFileEntry[];
          error?: string;
          hasAuth?: boolean;
        };
        if (r.hasAuth === false) {
          diag.warn('auth 未捕获：请刷新分享页，进入「质检报告」等列表出现后再点同步');
        }
        if (!r.ok) {
          if (r.error) diag.warn(r.error);
          resolve([]);
          return;
        }
        resolve(r.files ?? []);
      } catch {
        resolve([]);
      }
    };

    const onDone = (ev: Event) => {
      if ((ev as CustomEvent).detail?.requestId === requestId) finish();
    };

    win.addEventListener('dtx-fn-share-list-done', onDone);
    win.dispatchEvent(
      new CustomEvent('dtx-fn-share-list', {
        detail: {
          requestId,
          folderPath: FEINIU_QC_FOLDER,
          folderFileId: FEINIU_QC_FOLDER_FILE_ID,
        },
      }),
    );
    win.setTimeout(finish, 12000);
  });
}

export const FEINIU_SHARE_HELP_URL = FEINIU_SHARE_PAGE_URL;
