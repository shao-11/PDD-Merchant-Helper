import { unwrapAfterSalesList } from '../negative-appeal/api-unwrap';
import type { AfterSalesListItem } from '../negative-appeal/types';
import { parseMaxCargoAppealFenFromModal } from './page-context';
import { APPEAL_SUB_TYPE_CARGO, APPEAL_SUB_TYPE_FREIGHT, DEFAULT_CHECK_APPEAL_SUB_TYPES } from './constants';
import type {
  CanAppealInfoItem,
  CheckAppealResult,
  CheckAppealSubItem,
  ComplainTypeItem,
  ParentReasonOption,
  SubReasonOption,
} from './types';

export { unwrapAfterSalesList };

export function unwrapCanAppealList(json: unknown): CanAppealInfoItem[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  const arr =
    o.queryCanAppealInfoDetails ??
    (o.result as Record<string, unknown> | undefined)?.queryCanAppealInfoDetails ??
    o.list;
  if (!Array.isArray(arr)) return [];
  return arr as CanAppealInfoItem[];
}

function normalizeSubReasons(raw: unknown): SubReasonOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === 'object' && (r as SubReasonOption).subReasonCode != null)
    .map((r) => r as SubReasonOption);
}

export function flattenReasonOptions(
  check: CheckAppealResult | null | undefined,
  filterSubTypes?: number[],
): {
  appealSubTypeCode: number;
  parentReasonCode: number;
  parentReasonCodeDesc: string;
  subReasonCode: number;
  subReasonDesc: string;
}[] {
  const out: {
    appealSubTypeCode: number;
    parentReasonCode: number;
    parentReasonCodeDesc: string;
    subReasonCode: number;
    subReasonDesc: string;
  }[] = [];
  const list = check?.checkList ?? [];
  for (const item of list) {
    const appealSubTypeCode = Number(item.code) || 0;
    if (filterSubTypes?.length && appealSubTypeCode && !filterSubTypes.includes(appealSubTypeCode)) {
      continue;
    }
    const parents = item.parentReasonVoList ?? [];
    for (const p of parents as ParentReasonOption[]) {
      const subs = normalizeSubReasons(p.subReasonVoList);
      for (const s of subs) {
        out.push({
          appealSubTypeCode,
          parentReasonCode: Number(p.parentReasonCode) || 0,
          parentReasonCodeDesc: String(p.parentReasonCodeDesc ?? ''),
          subReasonCode: Number(s.subReasonCode),
          subReasonDesc: String(s.subReasonDesc ?? ''),
        });
      }
    }
    const flatSubs = normalizeSubReasons(item.subReasonList);
    for (const s of flatSubs) {
      out.push({
        appealSubTypeCode,
        parentReasonCode: 0,
        parentReasonCodeDesc: '',
        subReasonCode: Number(s.subReasonCode),
        subReasonDesc: String(s.subReasonDesc ?? ''),
      });
    }
  }
  return out;
}

function normReasonLabel(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

export function allowedAppealSubTypesFromCanAppeal(item?: CanAppealInfoItem | null): number[] {
  const map = item?.subAppealForbiddenReasonDescMap;
  if (!map || typeof map !== 'object') return [...DEFAULT_CHECK_APPEAL_SUB_TYPES];
  const allowed: number[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (String(v).includes('允许')) {
      const n = Number(k);
      if (Number.isFinite(n) && n > 0) allowed.push(n);
    }
  }
  return allowed.length ? allowed : [...DEFAULT_CHECK_APPEAL_SUB_TYPES];
}

export function appealSubTypeCodeFromModalLabel(label: string): number | undefined {
  const t = label.replace(/\s+/g, '');
  if (t.includes('货款')) return APPEAL_SUB_TYPE_CARGO;
  if (t.includes('运费')) return APPEAL_SUB_TYPE_FREIGHT;
  return undefined;
}

export function reasonOptionsFromVisibleLabels(labels: string[]): ReturnType<typeof flattenReasonOptions> {
  return labels
    .map((desc) => desc.trim())
    .filter(Boolean)
    .map((subReasonDesc, i) => ({
      appealSubTypeCode: 0,
      parentReasonCode: 0,
      parentReasonCodeDesc: '',
      subReasonCode: 900001 + i,
      subReasonDesc,
    }));
}

export function mergeReasonOptions(
  apiOptions: ReturnType<typeof flattenReasonOptions>,
  visibleLabels: string[],
): ReturnType<typeof flattenReasonOptions> {
  const merged = [...apiOptions];
  const known = new Set(merged.map((o) => normReasonLabel(o.subReasonDesc)));
  for (const raw of visibleLabels) {
    const subReasonDesc = raw.trim();
    if (!subReasonDesc) continue;
    const key = normReasonLabel(subReasonDesc);
    if (known.has(key)) continue;
    merged.push({
      appealSubTypeCode: 0,
      parentReasonCode: 0,
      parentReasonCodeDesc: '',
      subReasonCode: 910000 + merged.length,
      subReasonDesc,
    });
    known.add(key);
  }
  return merged;
}

export function reasonLabelMatches(a: string, b: string): boolean {
  const x = normReasonLabel(a);
  const y = normReasonLabel(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 12 && y.includes(x)) return true;
  if (y.length >= 12 && x.includes(y)) return true;
  return false;
}

export function findReasonOptionByDesc(
  desc: string,
  options: ReturnType<typeof flattenReasonOptions>,
): ReturnType<typeof flattenReasonOptions>[number] | undefined {
  return options.find((o) => reasonLabelMatches(desc, o.subReasonDesc));
}

export function unwrapCheckAppeal(json: unknown): CheckAppealResult {
  if (!json || typeof json !== 'object') return {};
  const o = json as Record<string, unknown>;
  if (o.success === false) {
    throw new Error(String(o.errorMsg ?? o.error_msg ?? 'checkAppeal 业务失败'));
  }
  const result = (o.result ?? o.data ?? o) as CheckAppealResult;
  if (Array.isArray(result.checkList)) return result;
  if (Array.isArray(o.checkList)) return { checkList: o.checkList as CheckAppealSubItem[] };
  return result;
}

export function unwrapComplainTypes(json: unknown): ComplainTypeItem[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  const raw =
    o.complainTypeList ??
    (o.result as Record<string, unknown> | undefined)?.complainTypeList ??
    o.list;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const x = item as ComplainTypeItem;
    return {
      ...x,
      complainType: Number(x.complainType ?? x.typeId ?? 0) || undefined,
      complainTypeDesc: String(x.complainTypeDesc ?? x.typeName ?? '').trim() || undefined,
    };
  });
}

export function unwrapOrderDetail(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== 'object') return {};
  const o = json as Record<string, unknown>;
  if (o.success === false) {
    throw new Error(String(o.errorMsg ?? o.error_msg ?? '订单详情失败'));
  }
  const inner = o.result ?? o.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return o;
}

export function unwrapLogisticsTrack(json: unknown): {
  trackingNumber?: string;
  traces: { time?: string; status?: string; content?: string }[];
} {
  if (!json || typeof json !== 'object') {
    return { traces: [] };
  }
  const o = json as Record<string, unknown>;
  const result = (o.result ?? o.data ?? o) as Record<string, unknown>;
  const traces: { time?: string; status?: string; content?: string }[] = [];
  const rawList =
    result.traceList ??
    result.traces ??
    result.trace_list ??
    (result.shipping as Record<string, unknown> | undefined)?.traceList;
  if (Array.isArray(rawList)) {
    for (const t of rawList) {
      if (!t || typeof t !== 'object') continue;
      const row = t as Record<string, unknown>;
      const content = String(
        row.info ??
          row.content ??
          row.desc ??
          row.remark ??
          row.traceInfo ??
          row.trace_info ??
          '',
      ).trim();
      const status = String(row.status ?? row.statusDesc ?? row.subStatus ?? '').trim();
      traces.push({
        time: String(row.time ?? row.acceptTime ?? row.datetime ?? row.accept_time ?? ''),
        status,
        content: content || status,
      });
    }
  }
  return {
    trackingNumber: String(result.tracking_number ?? result.trackingNumber ?? ''),
    traces,
  };
}

export function fenToYuan(fen: unknown): string {
  const n = typeof fen === 'number' ? fen : Number(fen);
  if (!Number.isFinite(n)) return '0';
  return (n / 100).toFixed(2);
}

function pickPositiveFen(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export type ReverseLogisticsInfo = {
  reverseTrackingNumber?: string;
  orderTrackingNumber?: string;
  shippingStatusDesc?: string;
  /** true=在途，false=否，null=平台未返回 */
  reverseLogisticOnWay: boolean | null;
  onWayLabel: string;
};

function pickNonEmptyString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return undefined;
}

/** 从可申诉列表 / 售后列表 / 订单详情合并退货单号与在途状态 */
export function extractReverseLogisticsInfo(snapshot: {
  orderSn: string;
  afterSalesId: number;
  canAppealItem?: CanAppealInfoItem | null;
  afterSales?: AfterSalesListItem[];
  orderDetail?: Record<string, unknown> | null;
}): ReverseLogisticsInfo {
  const after = pickAfterSaleRow(snapshot.afterSales ?? [], snapshot.orderSn, snapshot.afterSalesId);
  const base = snapshot.canAppealItem ?? undefined;
  const od = snapshot.orderDetail ?? {};

  const reverseTrackingNumber = pickNonEmptyString(
    after?.reverseTrackingNumber,
    od.reverse_tracking_number,
    od.reverseTrackingNumber,
  );
  const orderTrackingNumber = pickNonEmptyString(
    after?.orderTrackingNumber,
    od.tracking_number,
    od.trackingNumber,
  );
  const shippingStatusDesc = pickNonEmptyString(
    after?.sellerAfterSalesShippingStatusDesc,
    base?.sellerAfterSalesShippingStatusDesc,
    od.seller_after_sales_shipping_status_desc,
    od.sellerAfterSalesShippingStatusDesc,
  );

  let reverseLogisticOnWay: boolean | null = null;
  if (base?.reverseLogisticOnWay === true) reverseLogisticOnWay = true;
  else if (base?.reverseLogisticOnWay === false) reverseLogisticOnWay = false;
  else if (shippingStatusDesc) {
    if (/在途|运输中|退回中|寄回中|退货中/.test(shippingStatusDesc)) reverseLogisticOnWay = true;
    else if (/已签收|已入库|未退货|无需退货|无退货|未寄回/.test(shippingStatusDesc)) {
      reverseLogisticOnWay = false;
    }
  }

  const onWayLabel =
    reverseLogisticOnWay === true
      ? '在途'
      : reverseLogisticOnWay === false
        ? '否'
        : reverseTrackingNumber
          ? '有单号（状态未知）'
          : '—';

  return {
    reverseTrackingNumber,
    orderTrackingNumber,
    shippingStatusDesc,
    reverseLogisticOnWay,
    onWayLabel,
  };
}

export function pickAfterSaleRow(
  list: AfterSalesListItem[],
  orderSn: string,
  afterSalesId: number,
): AfterSalesListItem | undefined {
  if (afterSalesId > 0) {
    const byId = list.find((a) => Number(a.id) === afterSalesId);
    if (byId) return byId;
  }
  const sn = orderSn.trim();
  if (sn) {
    const bySn = list.find((a) => String(a.orderSn ?? '').trim() === sn);
    if (bySn) return bySn;
  }
  return list[0];
}

/** 可申诉列表未命中时，用售后列表 / 订单详情补全金额与商品信息 */
export function effectiveCanAppealItem(snapshot: {
  orderSn: string;
  afterSalesId: number;
  canAppealItem?: CanAppealInfoItem | null;
  afterSales?: AfterSalesListItem[];
  orderDetail?: Record<string, unknown> | null;
}): CanAppealInfoItem | null {
  const base = snapshot.canAppealItem ?? undefined;
  const after = pickAfterSaleRow(snapshot.afterSales ?? [], snapshot.orderSn, snapshot.afterSalesId);
  const ar = (after ?? {}) as Record<string, unknown>;
  const od = snapshot.orderDetail ?? {};

  const refundAmount = pickPositiveFen(
    base?.refundAmount,
    ar.refundAmount,
    od.refund_amount,
    od.refundAmount,
  );
  const receiveAmount = pickPositiveFen(
    base?.receiveAmount,
    ar.receiveAmount,
    ar.orderAmount,
    od.receive_amount,
    od.receiveAmount,
    od.order_amount,
    od.orderAmount,
  );
  // 货款申诉上限：只用 canCargo，勿用 receiveAmount（订单实收，常大于可申诉额）
  const canCargoAppealAmount = pickPositiveFen(
    base?.canCargoAppealAmount,
    ar.canCargoAppealAmount,
    od.can_cargo_appeal_amount,
    od.canCargoAppealAmount,
  );

  if (!base && !after && !canCargoAppealAmount && !refundAmount) return null;

  return {
    ...base,
    orderSn: snapshot.orderSn,
    afterSalesId: snapshot.afterSalesId || Number(after?.id) || base?.afterSalesId,
    goodsName:
      String(after?.goodsName ?? base?.goodsName ?? od.goods_name ?? od.goodsName ?? '').trim() ||
      undefined,
    goodsSpec:
      String(after?.goodsSpec ?? base?.goodsSpec ?? od.goods_spec ?? od.goodsSpec ?? '').trim() ||
      undefined,
    reasonDesc:
      String(after?.afterSalesReasonDesc ?? base?.reasonDesc ?? '').trim() || undefined,
    refundAmount: refundAmount ?? base?.refundAmount,
    receiveAmount: receiveAmount ?? base?.receiveAmount,
    canCargoAppealAmount: canCargoAppealAmount ?? base?.canCargoAppealAmount ?? null,
    sellerAfterSalesShippingStatusDesc:
      after?.sellerAfterSalesShippingStatusDesc ?? base?.sellerAfterSalesShippingStatusDesc,
  };
}

export function maxAppealFen(snapshot: Parameters<typeof effectiveCanAppealItem>[0]): number {
  const item = effectiveCanAppealItem(snapshot);
  const fromData = pickPositiveFen(item?.canCargoAppealAmount, item?.refundAmount) ?? 0;
  const fromModal = parseMaxCargoAppealFenFromModal();
  if (fromModal != null && fromModal > 0) {
    return fromData > 0 ? Math.min(fromData, fromModal) : fromModal;
  }
  return fromData;
}
