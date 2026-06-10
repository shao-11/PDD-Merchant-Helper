import type { AppealSnapshot } from './types';
import { NA_MSG_FETCH, NA_MSG_FETCH_RESULT, NA_MSG_SOURCE_CONTENT, NA_MSG_SOURCE_INJECT } from './constants';

export type NaFetchRequest = {
  source: typeof NA_MSG_SOURCE_CONTENT;
  type: typeof NA_MSG_FETCH;
  requestId: string;
  ticketSn: string;
  orderSn: string;
};

export type NaFetchResult = {
  source: typeof NA_MSG_SOURCE_INJECT;
  type: typeof NA_MSG_FETCH_RESULT;
  requestId: string;
  ok: boolean;
  snapshot?: AppealSnapshot;
  error?: string;
  fetchLogs?: AppealSnapshot['fetchLogs'];
};

export function isNaFetchRequest(data: unknown): data is NaFetchRequest {
  const d = data as NaFetchRequest;
  return (
    d?.source === NA_MSG_SOURCE_CONTENT &&
    d?.type === NA_MSG_FETCH &&
    typeof d.requestId === 'string' &&
    typeof d.ticketSn === 'string'
  );
}

export function isNaFetchResult(data: unknown): data is NaFetchResult {
  const d = data as NaFetchResult;
  return d?.source === NA_MSG_SOURCE_INJECT && d?.type === NA_MSG_FETCH_RESULT;
}
