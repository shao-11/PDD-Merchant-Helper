import { ACTIVITY_MSG_SOURCE } from './constants';

export type ActivityDebugLevel = 'info' | 'warn' | 'error';

/** MAIN 世界：控制台 + postMessage，由 content 脚本写入 storage 供面板展示 */
export function emitActivityDebug(
  level: ActivityDebugLevel,
  message: string,
  detail?: unknown
): void {
  let detailStr: string | undefined;
  try {
    if (detail !== undefined) {
      if (typeof detail === 'string') {
        detailStr = detail.length > 1200 ? `${detail.slice(0, 1200)}…` : detail;
      } else {
        const s = JSON.stringify(detail);
        detailStr = s.length > 1200 ? `${s.slice(0, 1200)}…` : s;
      }
    }
  } catch {
    detailStr = String(detail);
  }

  const tag = '[活动助手][inject]';
  if (level === 'error') console.error(tag, message, detail ?? '');
  else if (level === 'warn') console.warn(tag, message, detail ?? '');
  else console.info(tag, message, detail ?? '');

  try {
    window.postMessage(
      {
        source: ACTIVITY_MSG_SOURCE,
        type: 'DEBUG_LOG',
        payload: {
          ts: Date.now(),
          level,
          message,
          detail: detailStr,
        },
      },
      '*'
    );
  } catch {
    /* ignore */
  }
}
