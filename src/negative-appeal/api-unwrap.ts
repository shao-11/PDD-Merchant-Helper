import { extractSupportedReasons } from './platform-reasons';
import type { AfterSalesListItem, TujuDetail } from './types';

export function unwrapTujuDetail(json: unknown): TujuDetail {
  if (!json || typeof json !== 'object') return {};
  const o = json as Record<string, unknown>;
  if (o.success === false) {
    const msg = String(o.errorMsg ?? o.error_msg ?? o.message ?? '负向详情接口业务失败');
    throw new Error(msg);
  }
  let detail: TujuDetail = {};
  const inner = o.result ?? o.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    detail = inner as TujuDetail;
  } else if (typeof o.orderSn === 'string' || typeof o.ticketSn === 'string' || o.supportedAppealReason) {
    detail = o as TujuDetail;
  }
  if (!detail.supportedAppealReason?.length) {
    const reasons = extractSupportedReasons(json);
    if (reasons?.length) detail = { ...detail, supportedAppealReason: reasons };
  }
  return detail;
}

export function unwrapAfterSalesList(json: unknown): AfterSalesListItem[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  if (o.success === false) {
    throw new Error(String(o.errorMsg ?? o.error_msg ?? '售后列表接口业务失败'));
  }
  const result = o.result as { list?: AfterSalesListItem[] } | undefined;
  if (Array.isArray(result?.list)) return result.list;
  if (Array.isArray(o.list)) return o.list as AfterSalesListItem[];
  return [];
}
