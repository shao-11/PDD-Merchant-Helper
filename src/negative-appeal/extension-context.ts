export function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export const EXTENSION_INVALID_MSG =
  '扩展上下文已失效。请重载扩展后刷新飞牛分享页，再点「同步质检图」。';
