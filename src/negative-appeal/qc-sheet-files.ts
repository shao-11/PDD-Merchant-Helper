import { matchQcSheetRowForSnapshot } from './qc-sheet-match';
import { getQcSheetCatalog } from './qc-sheet-storage';
import type { AppealSnapshot } from './types';
import type { QcSheetCatalogRow, QcSheetStoredImage } from './qc-sheet-types';

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export async function storedImageToFile(im: QcSheetStoredImage): Promise<File> {
  if (!im.dataBase64) {
    throw new Error(`无法加载质检图：${im.fileName}（请重新在飞牛分享页同步）`);
  }
  const blob = base64ToBlob(im.dataBase64, im.mime || 'image/png');
  return new File([blob], im.fileName, { type: im.mime || 'image/png' });
}

export async function loadSheetRowFiles(row: QcSheetCatalogRow): Promise<File[]> {
  const files: File[] = [];
  for (const im of row.images) {
    files.push(await storedImageToFile(im));
  }
  return files;
}

export async function loadMatchedQcFilesFromSnapshot(
  snapshot: AppealSnapshot,
): Promise<{ row: QcSheetCatalogRow; files: File[]; imageError?: string } | null> {
  const catalog = await getQcSheetCatalog();
  if (!catalog) return null;

  const hit = matchQcSheetRowForSnapshot(snapshot, catalog.rows);
  if (!hit) return null;

  const files: File[] = [];
  const errors: string[] = [];
  for (const im of hit.row.images) {
    try {
      files.push(await storedImageToFile(im));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (!files.length) {
    return { row: hit.row, files: [], imageError: errors.join('；') || '匹配到规格但图片未加载' };
  }
  return { row: hit.row, files };
}
