import type { AftersaleAppealSnapshot } from './types';
import {
  ASA_MSG_FETCH,
  ASA_MSG_FETCH_RESULT,
  ASA_MSG_SOURCE_CONTENT,
  ASA_MSG_SOURCE_INJECT,
} from './constants';

export type AsaFetchRequest = {
  source: typeof ASA_MSG_SOURCE_CONTENT;
  type: typeof ASA_MSG_FETCH;
  requestId: string;
  orderSn: string;
  afterSalesId: number;
};

export type AsaFetchResult = {
  source: typeof ASA_MSG_SOURCE_INJECT;
  type: typeof ASA_MSG_FETCH_RESULT;
  requestId: string;
  ok: boolean;
  snapshot?: AftersaleAppealSnapshot;
  error?: string;
  fetchLogs?: AftersaleAppealSnapshot['fetchLogs'];
};

export function isAsaFetchRequest(data: unknown): data is AsaFetchRequest {
  const d = data as AsaFetchRequest;
  return (
    d?.source === ASA_MSG_SOURCE_CONTENT &&
    d?.type === ASA_MSG_FETCH &&
    typeof d.requestId === 'string' &&
    typeof d.orderSn === 'string' &&
    Number.isFinite(d.afterSalesId)
  );
}

export function isAsaFetchResult(data: unknown): data is AsaFetchResult {
  const d = data as AsaFetchResult;
  return d?.source === ASA_MSG_SOURCE_INJECT && d?.type === ASA_MSG_FETCH_RESULT;
}
