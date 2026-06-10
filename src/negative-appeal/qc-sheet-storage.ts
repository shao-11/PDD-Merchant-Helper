import { STORAGE_QC_SHEET_CATALOG } from '../constants/storage-keys';
import { QC_CATALOG_SOURCE_ID } from './feiniu-share-constants';
import { isExtensionContextValid } from './extension-context';
import type { QcSheetCatalog } from './qc-sheet-types';

const LEGACY_DOC_IDS = [
  QC_CATALOG_SOURCE_ID,
  'feiniu-xlsx',
  'e3_AUUA7gb1AJcCNODicDd9DRCuUnZsD',
] as const;

function readStorage(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([STORAGE_QC_SHEET_CATALOG], (raw) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(raw ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

function writeStorage(catalog: QcSheetCatalog): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [STORAGE_QC_SHEET_CATALOG]: catalog }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

function toLiteCatalog(catalog: QcSheetCatalog): QcSheetCatalog {
  return {
    ...catalog,
    rows: catalog.rows.map((row) => ({
      specName: row.specName,
      images: row.images.map((im) => ({
        id: im.id,
        mime: im.mime,
        sourceUrl: im.sourceUrl,
        fileName: im.fileName,
      })),
    })),
  };
}

export type QcSheetCatalogStatus = {
  ok: boolean;
  rowCount: number;
  imageCount: number;
  rowsWithImages: number;
  rowsWithBase64: number;
  syncedAt?: number;
  specNames: string[];
  reason?: string;
};

export async function getQcSheetCatalogStatus(): Promise<QcSheetCatalogStatus> {
  const cat = await getQcSheetCatalog();
  if (!cat) {
    return {
      ok: false,
      rowCount: 0,
      imageCount: 0,
      rowsWithImages: 0,
      rowsWithBase64: 0,
      specNames: [],
      reason: '未同步质检图（请打开飞牛分享页进入「质检报告」后点「同步质检图」）',
    };
  }
  const imageCount = cat.rows.reduce((n, r) => n + r.images.length, 0);
  const rowsWithImages = cat.rows.filter((r) => r.images.length > 0).length;
  const rowsWithBase64 = cat.rows.filter((r) => r.images.some((im) => im.dataBase64)).length;
  return {
    ok: rowsWithImages > 0,
    rowCount: cat.rowCount,
    imageCount,
    rowsWithImages,
    rowsWithBase64,
    syncedAt: cat.syncedAt,
    specNames: cat.rows.map((r) => r.specName),
    reason:
      rowsWithImages === 0
        ? '已同步但无图片，请检查分享目录 PNG 命名'
        : undefined,
  };
}

export async function getQcSheetCatalog(): Promise<QcSheetCatalog | null> {
  if (!isExtensionContextValid()) return null;
  const raw = await readStorage();
  const cat = raw[STORAGE_QC_SHEET_CATALOG] as QcSheetCatalog | undefined;
  if (!cat?.rows?.length) return null;
  if (!LEGACY_DOC_IDS.includes(cat.docId as (typeof LEGACY_DOC_IDS)[number])) return null;
  return cat;
}

let lastSaveUsedLite = false;

export function wasLastQcCatalogSaveLite(): boolean {
  return lastSaveUsedLite;
}

export async function saveQcSheetCatalog(catalog: QcSheetCatalog): Promise<void> {
  if (!isExtensionContextValid()) {
    throw new Error(
      '扩展上下文已失效，请在 chrome://extensions 重新加载扩展后刷新飞牛分享页再同步。',
    );
  }
  lastSaveUsedLite = false;
  try {
    await writeStorage(catalog);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/quota|QUOTA|exceeded/i.test(msg)) throw e;
    await writeStorage(toLiteCatalog(catalog));
    lastSaveUsedLite = true;
  }
}

export function formatCatalogAge(syncedAt: number): string {
  const min = Math.floor((Date.now() - syncedAt) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
