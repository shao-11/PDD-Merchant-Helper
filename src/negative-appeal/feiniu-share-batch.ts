import JSZip from 'jszip';
import { base64DecodedBytes, formatBytes, MIN_QC_IMAGE_BYTES } from './feiniu-image-size';
import type { FeiniuShareFileEntry } from './feiniu-share-parse';
export type FnShareSyncDiag = {
  info(msg: string): void;
  warn(msg: string): void;
  ok(msg: string): void;
};
import type { QcSheetStoredImage } from './qc-sheet-types';

export type FnBatchDownloadResult = {
  ok: boolean;
  images?: Record<string, { mime: string; dataBase64: string }>;
  zipBase64?: string;
  via?: string;
  error?: string;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      const i = s.indexOf('base64,');
      resolve(i >= 0 ? s.slice(i + 7) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function unpackZipBase64ToImages(zipB64: string): Promise<Record<string, { mime: string; dataBase64: string }>> {
  const zip = await JSZip.loadAsync(zipB64, { base64: true });
  const out: Record<string, { mime: string; dataBase64: string }> = {};

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.(png|jpe?g|webp)$/i.test(path)) continue;
    const blob = await entry.async('blob');
    if (blob.size < MIN_QC_IMAGE_BYTES) continue;
    const fileName = path.split('/').pop() || path;
    out[fileName] = {
      mime: blob.type || 'image/png',
      dataBase64: await blobToBase64(blob),
    };
  }
  return out;
}

export function batchResultToStoredImages(
  fileList: FeiniuShareFileEntry[],
  raw: Record<string, { mime: string; dataBase64: string }>,
): Map<string, QcSheetStoredImage> {
  const map = new Map<string, QcSheetStoredImage>();
  for (const f of fileList) {
    const packed = raw[f.fileName];
    if (!packed?.dataBase64) continue;
    map.set(f.fileName, {
      id: `fn-batch-${f.fileName}`,
      mime: packed.mime,
      dataBase64: packed.dataBase64,
      fileName: f.fileName,
      sourceUrl: f.path,
    });
  }
  return map;
}

/** 解析 inject 返回的批量下载结果 */
export async function resolveBatchDownloadPayload(
  payload: FnBatchDownloadResult,
  fileList: FeiniuShareFileEntry[],
  diag: FnShareSyncDiag,
): Promise<Map<string, QcSheetStoredImage> | null> {
  if (!payload.ok && !payload.zipBase64 && !payload.images) {
    if (payload.error) diag.warn(payload.error);
    return null;
  }
  if (!payload.ok && payload.error) diag.warn(payload.error);

  let raw = payload.images ?? {};

  if (payload.zipBase64) {
    diag.info('正在解压批量下载的 ZIP…');
    raw = await unpackZipBase64ToImages(payload.zipBase64);
  }

  const map = batchResultToStoredImages(fileList, raw);
  if (!map.size) return null;

  for (const [name, im] of map) {
    const kb = base64DecodedBytes(im.dataBase64 ?? '');
    diag.ok(`${name} ← 批量${payload.via ?? ''}（${formatBytes(kb)}）`);
  }

  return map;
}

export async function fetchBatchDownloadViaInject(
  win: Window,
  fileList: FeiniuShareFileEntry[],
  folderPath: string,
  diag: FnShareSyncDiag,
): Promise<Map<string, QcSheetStoredImage> | null> {
  const requestId = `batch-${Date.now()}`;
  const doc = win.document;

  return new Promise((resolve) => {
    const finish = () => {
      win.removeEventListener('dtx-fn-share-batch-done', onDone);
      const raw = doc.documentElement.getAttribute(`data-dtx-fn-batch-${requestId}`) ?? '';
      doc.documentElement.removeAttribute(`data-dtx-fn-batch-${requestId}`);
      if (!raw) {
        diag.warn('批量下载无响应');
        resolve(null);
        return;
      }
      try {
        const payload = JSON.parse(raw) as FnBatchDownloadResult;
        void resolveBatchDownloadPayload(payload, fileList, diag).then(resolve);
      } catch {
        resolve(null);
      }
    };

    const onDone = (ev: Event) => {
      if ((ev as CustomEvent).detail?.requestId === requestId) finish();
    };

    win.addEventListener('dtx-fn-share-batch-done', onDone);
    win.dispatchEvent(
      new CustomEvent('dtx-fn-share-batch', {
        detail: { requestId, files: fileList, folderPath },
      }),
    );
    win.setTimeout(finish, 40000);
  });
}

/** 并行 API 补拉缺失文件（不走 UI 勾选） */
export async function fetchParallelDownloadViaInject(
  win: Window,
  fileList: FeiniuShareFileEntry[],
  diag: FnShareSyncDiag,
): Promise<Map<string, QcSheetStoredImage> | null> {
  if (!fileList.length) return new Map();
  const requestId = `par-${Date.now()}`;
  const doc = win.document;

  return new Promise((resolve) => {
    const finish = () => {
      win.removeEventListener('dtx-fn-share-parallel-done', onDone);
      const raw = doc.documentElement.getAttribute(`data-dtx-fn-parallel-${requestId}`) ?? '';
      doc.documentElement.removeAttribute(`data-dtx-fn-parallel-${requestId}`);
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        const payload = JSON.parse(raw) as FnBatchDownloadResult;
        void resolveBatchDownloadPayload(payload, fileList, diag).then(resolve);
      } catch {
        resolve(null);
      }
    };

    const onDone = (ev: Event) => {
      if ((ev as CustomEvent).detail?.requestId === requestId) finish();
    };

    win.addEventListener('dtx-fn-share-parallel-done', onDone);
    win.dispatchEvent(
      new CustomEvent('dtx-fn-share-parallel', {
        detail: { requestId, files: fileList },
      }),
    );
    win.setTimeout(finish, 25000);
  });
}
