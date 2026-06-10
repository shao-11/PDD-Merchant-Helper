/** 单张从飞牛分享下载的质检 PNG */
export type QcSheetStoredImage = {
  /** 稳定键：url 或 dataUrl 前缀哈希 */
  id: string;
  mime: string;
  /** 优先使用；申诉页未开文档时靠缓存上传 */
  dataBase64?: string;
  sourceUrl?: string;
  fileName: string;
};

export type QcSheetCatalogRow = {
  specName: string;
  images: QcSheetStoredImage[];
};

export type QcSheetCatalog = {
  docId: string;
  syncedAt: number;
  rowCount: number;
  rows: QcSheetCatalogRow[];
};
