import { ASA_MSG_FETCH, ASA_MSG_SOURCE_CONTENT } from './constants';
import { isAsaFetchResult } from './messages';
import { resolveAnalysisTarget } from './order-context';
import type { AftersaleAppealSnapshot } from './types';

export function fetchAftersaleAppealSnapshotViaPage(
  orderSn = '',
  afterSalesId = 0,
  timeoutMs = 120000,
): Promise<AftersaleAppealSnapshot> {
  const target = resolveAnalysisTarget(orderSn, afterSalesId);
  if (!target?.orderSn) {
    return Promise.reject(
      new Error(
        '未识别到订单：请在本页点击某一行的「发起申诉」打开弹窗后，再点「售后申诉」或「自动填入」；也可在面板手动填写订单号。',
      ),
    );
  }

  const requestId = `asa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('采集超时，请刷新页面后重试'));
    }, timeoutMs);

    const onMsg = (e: MessageEvent): void => {
      if (e.source !== window || !isAsaFetchResult(e.data) || e.data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      if (!e.data.ok || !e.data.snapshot) {
        const err = new Error(e.data.error || '采集失败') as Error & {
          fetchLogs?: AftersaleAppealSnapshot['fetchLogs'];
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
        source: ASA_MSG_SOURCE_CONTENT,
        type: ASA_MSG_FETCH,
        requestId,
        orderSn: target.orderSn,
        afterSalesId: target.afterSalesId,
      },
      '*',
    );
  });
}
