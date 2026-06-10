/** 飞牛 fnOS 外链分享（质检报告 PNG） */
export const FEINIU_SHARE_PAGE_URL =
  'http://192.168.1.40:5666/s/a9f7dd9409a347a094';

export const FEINIU_SHARE_ID = 'a9f7dd9409a347a094';

export const FEINIU_SHARE_ORIGIN = 'http://192.168.1.40:5666';

/** 写入 naQcSheetCatalog 的 docId */
export const QC_CATALOG_SOURCE_ID = `feiniu-share:${FEINIU_SHARE_ID}`;

export const FEINIU_QC_FOLDER = '/质检报告';

/** 「下载全部」接口 body：files 为空表示当前分享目录全部文件 */
export const FEINIU_DOWNLOAD_ALL_FILENAME = '飞牛分享文件';

/** list 接口 body 中的 fileId（与分享页进入该文件夹时一致，一般为 2） */
export const FEINIU_QC_FOLDER_FILE_ID = 2;

export function feiniuShareApiBase(shareId = FEINIU_SHARE_ID): string {
  return `${FEINIU_SHARE_ORIGIN}/s/${shareId}`;
}

export function isFeiniuSharePage(href = window.location.href): boolean {
  try {
    const u = new URL(href);
    return u.origin === FEINIU_SHARE_ORIGIN && /\/s\/[a-z0-9]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function parseShareIdFromUrl(href: string): string | null {
  try {
    const m = new URL(href).pathname.match(/\/s\/([a-z0-9]+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
