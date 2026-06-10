import {
  MSG_TYPE_BATCH_REPLY,
  MSG_TYPE_BATCH_REPORT,
  MSG_TYPE_FETCH_FIVE_STAR_REVIEWS,
  MSG_TYPE_FETCH_REVIEWS,
  MSG_TYPE_WARM_ANTI,
  REPORT_REPLY_MSG_SOURCE,
  RPC_KIND_REQ,
  RPC_KIND_RES,
} from './constants';
import { rrLog } from './debug-log';
type RpcReply<T> = {
  source?: string;
  kind?: string;
  replyId?: string;
  ok?: boolean;
  result?: T;
  /** MAIN 世界用 JSON 字符串回传，避免 postMessage 结构化克隆大对象失败 */
  resultJson?: string;
  error?: string;
};

function rpcMain<T>(type: string, payload?: unknown, timeoutMs = 180_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const replyId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `rr-${Date.now()}-${Math.random()}`;

    const timer = globalThis.setTimeout(() => {
      globalThis.removeEventListener('message', onMsg);
      rrLog('rpc', 'error', `RPC 超时 (${timeoutMs}ms)`, { type, replyId });
      reject(new Error('请求超时，请刷新页面后重试'));
    }, timeoutMs);

    const onMsg = (e: MessageEvent): void => {
      const origin = typeof globalThis.location !== 'undefined' ? globalThis.location.origin : '';
      if (origin && e.origin !== origin) return;
      const d = e.data as RpcReply<T>;
      if (d?.source !== REPORT_REPLY_MSG_SOURCE || d.replyId !== replyId) return;
      // 忽略己方发出的请求（无 ok 字段会被误判为失败）
      if (d.kind !== RPC_KIND_RES && typeof d.ok !== 'boolean') return;
      globalThis.removeEventListener('message', onMsg);
      globalThis.clearTimeout(timer);
      if (d.ok) {
        try {
          const jsonLen = typeof d.resultJson === 'string' ? d.resultJson.length : 0;
          rrLog('rpc', 'info', `RPC 成功`, {
            type,
            replyId,
            resultJsonLen: jsonLen,
            hasResult: d.result != null,
          });
          if (typeof d.resultJson === 'string' && d.resultJson) {
            resolve(JSON.parse(d.resultJson) as T);
          } else {
            resolve(d.result as T);
          }
        } catch (parseErr) {
          rrLog('rpc', 'error', '解析 resultJson 失败', {
            type,
            replyId,
            err: String(parseErr),
            preview: String(d.resultJson ?? '').slice(0, 200),
          });
          reject(new Error('解析评价数据失败'));
        }
      } else {
        rrLog('rpc', 'error', `RPC 失败`, { type, replyId, error: d.error });
        reject(new Error(d.error?.trim() || '操作失败，请查看评价页 Network 中 reviews/list 响应'));
      }
    };

    rrLog('rpc', 'info', `发送 RPC`, { type, replyId, payload });
    globalThis.addEventListener('message', onMsg);
    globalThis.postMessage(
      { source: REPORT_REPLY_MSG_SOURCE, kind: RPC_KIND_REQ, type, replyId, payload },
      '*'
    );
  });
}

export function warmReportReplyAnti(): Promise<{ hasAnti: boolean }> {
  return rpcMain(MSG_TYPE_WARM_ANTI, undefined, 15_000);
}

export type FetchReviewsResult = {
  total: number;
  unreported: number;
  pending: number;
  success: number;
  failed: number;
  other: number;
  reported: number;
  unreportedIds: string[];
};

export function fetchLowStarReviews(days: number): Promise<FetchReviewsResult> {
  return rpcMain(MSG_TYPE_FETCH_REVIEWS, { days }, 180_000);
}

export type BatchReportResult = {
  results: { reviewId: string; ok: boolean; error?: string }[];
};

export function batchReportReviews(reviewIds: string[]): Promise<BatchReportResult> {
  return rpcMain(MSG_TYPE_BATCH_REPORT, { reviewIds }, 600_000);
}

export type FetchFiveStarReviewsResult = {
  total: number;
  unreplied: number;
  replied: number;
  unrepliedIds: string[];
  unrepliedItems: { reviewId: string; comment: string; goodsName: string; star: number }[];
};

export function fetchFiveStarReviews(days: number): Promise<FetchFiveStarReviewsResult> {
  return rpcMain(MSG_TYPE_FETCH_FIVE_STAR_REVIEWS, { days }, 180_000);
}

export type BatchReplyResult = {
  results: { reviewId: string; ok: boolean; error?: string }[];
};

export type ReplyBatchItem = {
  reviewId: string;
  content: string;
};

export function batchReplyReviews(items: ReplyBatchItem[]): Promise<BatchReplyResult> {
  return rpcMain(MSG_TYPE_BATCH_REPLY, { items }, 600_000);
}
