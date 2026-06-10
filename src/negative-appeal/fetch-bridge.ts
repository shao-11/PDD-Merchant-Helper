import { NA_MSG_FETCH, NA_MSG_SOURCE_CONTENT } from './constants';
import { isNaFetchResult } from './messages';
import type { AppealSnapshot } from './types';

export function fetchAppealSnapshotViaPage(
  ticketSn: string,
  orderSn: string,
  timeoutMs = 120000,
): Promise<AppealSnapshot> {
  const requestId = `na-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('采集超时，请刷新详情页后重试'));
    }, timeoutMs);

    const onMsg = (e: MessageEvent): void => {
      if (e.source !== window || !isNaFetchResult(e.data) || e.data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      if (!e.data.ok || !e.data.snapshot) {
        const err = new Error(e.data.error || '采集失败') as Error & {
          fetchLogs?: AppealSnapshot['fetchLogs'];
        };
        err.fetchLogs = e.data.fetchLogs;
        reject(err);
        return;
      }
      resolve(e.data.snapshot);
    };

    window.addEventListener('message', onMsg);
    window.postMessage(
      {
        source: NA_MSG_SOURCE_CONTENT,
        type: NA_MSG_FETCH,
        requestId,
        ticketSn,
        orderSn,
      },
      '*',
    );
  });
}
