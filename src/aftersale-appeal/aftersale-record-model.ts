import type { AfterSalesListItem } from '../negative-appeal/types';
import { isLikelyChatImageUrl } from '../utils/chat-history-parse';
import type { ChatHistoryRow } from '../utils/chat-history-parse';
import {
  effectiveCanAppealItem,
  extractReverseLogisticsInfo,
  pickAfterSaleRow,
} from './api-unwrap';
import type { AftersaleAppealSnapshot } from './types';

export type AftersaleRecordDisplay = {
  afterSalesId: string;
  afterSalesType: string;
  shippingStatus: string;
  refundAmountYuan: string;
  reason: string;
  logisticsCompany: string;
  trackingNumber: string;
  chatImageUrls: string[];
  orderSn: string;
  groupTime: string;
  confirmTime: string;
  returnFreightInsurance: string;
  productThumb: string;
  productName: string;
  productSpec: string;
  goodsNumber: number;
  discountYuan: string;
  receiveAmountYuan: string;
  freeShipping: boolean;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  shopWatermark: string;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s && s !== 'undefined' && s !== 'null') return s;
  }
  return '';
}

function dashOr(value: string): string {
  return value || '—';
}

function asRecord(obj: unknown): Record<string, unknown> {
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
}

function pickFromRecords(records: Record<string, unknown>[], keys: string[]): string {
  for (const rec of records) {
    for (const key of keys) {
      const hit = pickStr(rec[key]);
      if (hit) return hit;
    }
  }
  return '';
}

function fenToYuanDisplay(fen: unknown): string {
  const n = typeof fen === 'number' ? fen : Number(fen);
  if (!Number.isFinite(n)) return '—';
  return `¥${(n / 100).toFixed(2)}`;
}

function fenToYuanPlain(fen: unknown): string {
  const n = typeof fen === 'number' ? fen : Number(fen);
  if (!Number.isFinite(n)) return '—';
  return (n / 100).toFixed(2);
}

function formatOdTime(val: unknown): string {
  if (val == null || val === '') return '—';
  if (typeof val === 'string' && /\d{4}[-/]/.test(val)) {
    return val.replace(/\//g, '-').replace(/\s+/g, ' ').trim();
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isConsumerChatRow(row: ChatHistoryRow): boolean {
  const role = row.roleLabel ?? '';
  if (/系统|平台/i.test(role)) return false;
  if (/商家|客服|店铺|卖家/i.test(role)) return false;
  return /买家|消费者|用户/i.test(role) || !/商家|客服/i.test(role);
}

function extractChatImageUrls(rows: ChatHistoryRow[]): string[] {
  const urls: string[] = [];
  for (const row of rows) {
    if (!isConsumerChatRow(row)) continue;
    const url = row.imageUrl?.trim();
    if (url && isLikelyChatImageUrl(url) && !urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, 6);
}

function extractLogisticsCompany(
  records: Record<string, unknown>[],
  logistics?: AftersaleAppealSnapshot['logistics'],
): string {
  const fromRecords = pickFromRecords(records, [
    'shipping_name',
    'shippingName',
    'express_name',
    'expressName',
    'logistics_name',
    'logisticsName',
    'shipping_company',
    'shippingCompany',
    'expressCompany',
    'express_company',
  ]);
  if (fromRecords) return fromRecords;

  const fromLogistics = logistics?.shippingName?.trim();
  if (fromLogistics) return fromLogistics;

  const raw = logistics?.raw;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const result = asRecord(r.result ?? r.data ?? r);
    const name = pickFromRecords([result], [
      'shipping_name',
      'shippingName',
      'express_name',
      'expressName',
    ]);
    if (name) return name;
  }

  return '—';
}

function extractReturnFreightInsurance(records: Record<string, unknown>[]): string {
  return (
    pickFromRecords(records, [
      'return_freight_insurance_desc',
      'returnFreightInsuranceDesc',
      'freight_insurance_desc',
      'freightInsuranceDesc',
      'return_shipping_insurance_desc',
      'returnShippingInsuranceDesc',
      'freight_insurance_status_desc',
      'freightInsuranceStatusDesc',
    ]) || '—'
  );
}

function enrichAfterSaleRow(
  item: AfterSalesListItem,
  snapshot: AftersaleAppealSnapshot,
): AfterSalesListItem {
  const logistics = extractReverseLogisticsInfo(snapshot);
  const shipNo =
    (typeof item.orderTrackingNumber === 'string' && item.orderTrackingNumber.trim()) ||
    logistics.orderTrackingNumber ||
    snapshot.logistics?.trackingNumber?.trim() ||
    undefined;
  return {
    ...item,
    orderTrackingNumber: shipNo ?? item.orderTrackingNumber,
    sellerAfterSalesShippingStatusDesc:
      item.sellerAfterSalesShippingStatusDesc || logistics.shippingStatusDesc || undefined,
  };
}

function resolveAfterSaleItem(snapshot: AftersaleAppealSnapshot): AfterSalesListItem | null {
  if (snapshot.afterSales.length) {
    const row = pickAfterSaleRow(snapshot.afterSales, snapshot.orderSn, snapshot.afterSalesId);
    return enrichAfterSaleRow(row ?? snapshot.afterSales[0]!, snapshot);
  }
  const item = effectiveCanAppealItem(snapshot);
  if (!item) return null;
  return enrichAfterSaleRow(
    {
      id: snapshot.afterSalesId || item.afterSalesId,
      orderSn: snapshot.orderSn,
      goodsName: item.goodsName,
      goodsSpec: item.goodsSpec,
      afterSalesReasonDesc: item.reasonDesc,
      refundAmount: item.refundAmount,
      sellerAfterSalesShippingStatusDesc: item.sellerAfterSalesShippingStatusDesc,
    },
    snapshot,
  );
}

export function buildAftersaleRecordDisplay(
  snapshot: AftersaleAppealSnapshot,
): AftersaleRecordDisplay | null {
  const after = resolveAfterSaleItem(snapshot);
  if (!after) return null;

  const od = asRecord(snapshot.orderDetail);
  const ar = asRecord(after);
  const canAppeal = effectiveCanAppealItem(snapshot);
  const ca = asRecord(canAppeal);
  const records = [ar, od, ca];

  const discountRaw = pickFromRecords(records, [
    'discount_amount',
    'discountAmount',
    'total_discount',
    'totalDiscount',
  ]);
  const receiveFen = pickFromRecords(records, [
    'receive_amount',
    'receiveAmount',
    'order_amount',
    'orderAmount',
  ]);
  const shippingDesc = pickFromRecords(records, ['shipping_desc', 'shippingDesc']);
  const shippingFen = Number(pickFromRecords(records, ['shipping_amount', 'shippingAmount', 'postage']) || NaN);
  const freeShipping =
    (Number.isFinite(shippingFen) && shippingFen === 0) || /免运费|包邮/.test(shippingDesc);

  return {
    afterSalesId: dashOr(String(after.id ?? snapshot.afterSalesId ?? '')),
    afterSalesType: dashOr(
      pickStr(after.afterSalesTypeName, ar.after_sales_type_name, ar.afterSalesTypeDesc),
    ),
    shippingStatus: dashOr(
      pickStr(
        after.sellerAfterSalesShippingStatusDesc,
        ca.sellerAfterSalesShippingStatusDesc,
        od.seller_after_sales_shipping_status_desc,
        od.sellerAfterSalesShippingStatusDesc,
      ),
    ),
    refundAmountYuan: fenToYuanDisplay(after.refundAmount ?? canAppeal?.refundAmount),
    reason: dashOr(pickStr(after.afterSalesReasonDesc, canAppeal?.reasonDesc)),
    logisticsCompany: extractLogisticsCompany(records, snapshot.logistics),
    trackingNumber: dashOr(
      pickStr(
        after.orderTrackingNumber,
        snapshot.logistics?.trackingNumber,
        od.tracking_number,
        od.trackingNumber,
      ),
    ),
    chatImageUrls: extractChatImageUrls(snapshot.chatRows),
    orderSn: dashOr(pickStr(after.orderSn, snapshot.orderSn, od.order_sn, od.orderSn)),
    groupTime: formatOdTime(
      pickStr(
        od.group_order_time,
        od.groupOrderTime,
        od.group_time,
        od.groupTime,
        ar.group_order_time,
        ar.groupOrderTime,
      ) || undefined,
    ),
    confirmTime: formatOdTime(
      pickStr(
        od.confirm_time,
        od.confirmTime,
        od.order_confirm_time,
        od.orderConfirmTime,
        od.pay_time,
        od.payTime,
        ar.confirm_time,
        ar.confirmTime,
      ) || undefined,
    ),
    returnFreightInsurance: extractReturnFreightInsurance(records),
    productThumb: pickStr(after.thumbUrl, ar.thumb_url, ar.thumbUrl, od.thumb_url, od.thumbUrl, od.goods_image),
    productName: dashOr(pickStr(after.goodsName, canAppeal?.goodsName, od.goods_name, od.goodsName)),
    productSpec: dashOr(pickStr(after.goodsSpec, canAppeal?.goodsSpec, od.goods_spec, od.goodsSpec)),
    goodsNumber: (() => {
      const raw = after.goodsNumber ?? od.goods_number ?? od.goodsNumber;
      if (raw == null || raw === '') return 0;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })(),
    discountYuan: discountRaw ? fenToYuanPlain(discountRaw) : '—',
    receiveAmountYuan: receiveFen ? fenToYuanPlain(receiveFen) : '—',
    freeShipping,
    recipientName: dashOr(
      pickStr(od.receiver_name, od.receiverName, od.consignee, od.receive_name, od.maskReceiver),
    ),
    recipientPhone: dashOr(
      pickStr(od.receiver_phone, od.receiverPhone, od.mobile, od.receive_phone, od.maskPhone),
    ),
    recipientAddress: dashOr(
      pickStr(
        od.receiver_address,
        od.receiverAddress,
        od.address,
        od.detail_address,
        od.detailAddress,
        od.maskAddress,
      ),
    ),
    shopWatermark: pickStr(
      od.mall_name,
      od.mallName,
      od.shop_name,
      od.shopName,
      asRecord(od.mallInfo).mallName,
      asRecord(od.mall_info).mall_name,
    ),
  };
}
