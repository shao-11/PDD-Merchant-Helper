/** 拼多多商家后台首页（保活目标页） */
export const KEEP_ALIVE_HOME_URL = 'https://mms.pinduoduo.com/home';

/** chrome.alarms 名称（与其它模块隔离） */
export const KEEP_ALIVE_ALARM_NAME = 'DTX_KEEP_ALIVE_PULSE';

/** 保活随机间隔下限：10 分钟 */
export const KEEP_ALIVE_INTERVAL_MIN_MS = 10 * 60 * 1000;

/** 保活随机间隔上限：30 分钟 */
export const KEEP_ALIVE_INTERVAL_MAX_MS = 30 * 60 * 1000;

/** 设置页展示的间隔文案 */
export function formatKeepAliveIntervalLabel(): string {
  const minSec = Math.round(KEEP_ALIVE_INTERVAL_MIN_MS / 1000);
  const maxSec = Math.round(KEEP_ALIVE_INTERVAL_MAX_MS / 1000);
  if (minSec === maxSec) return `${minSec} 秒`;
  if (minSec >= 60 && maxSec >= 60) {
    return `${Math.round(minSec / 60)}～${Math.round(maxSec / 60)} 分钟`;
  }
  return `${minSec}～${maxSec} 秒`;
}
