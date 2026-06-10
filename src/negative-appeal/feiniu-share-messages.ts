/** 工具箱 / background → 飞牛分享页 content：触发同步 */
export const MSG_FEINIU_SYNC_RUN = 'DTX_FEINIU_SYNC_RUN';

/** popup → background：打开分享页并执行同步 */
export const MSG_FEINIU_OPEN_AND_SYNC = 'DTX_FEINIU_OPEN_AND_SYNC';

export type FeiniuSyncContentResult = {
  ok: boolean;
  message: string;
  rowCount?: number;
  imageCount?: number;
};

export type FeiniuOpenAndSyncResult = FeiniuSyncContentResult & {
  tabId?: number;
};
