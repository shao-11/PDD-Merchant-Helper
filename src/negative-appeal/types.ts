import type { ChatHistoryRow } from '../utils/chat-history-parse';
import type { ReviewItem } from '../types/reviews';
import type { FetchStepLog } from './fetch-log';

export type SupportedAppealReason = {
  appealReasonCode: number;
  appealReasonDesc: string;
  appealDesc?: string;
  appealCertificateDesc?: string;
};

export type TujuDetail = {
  ticketSn?: string;
  orderSn?: string;
  goodsId?: string;
  goodsName?: string;
  explanation?: string;
  compensationReason?: string;
  playMoneyAmount?: number;
  supportedAppealReason?: SupportedAppealReason[];
  canAppeal?: boolean;
  [key: string]: unknown;
};

export type AfterSalesListItem = {
  id?: number;
  orderSn?: string;
  afterSalesTypeName?: string;
  afterSalesReasonDesc?: string;
  afterSalesTitle?: string;
  refundAmount?: number;
  createdAt?: number;
  goodsName?: string;
  goodsSpec?: string;
  goodsNumber?: number;
  thumbUrl?: string;
  reverseTrackingNumber?: string | null;
  orderTrackingNumber?: string | null;
  sellerAfterSalesShippingStatusDesc?: string;
  [key: string]: unknown;
};

export type AppealSnapshot = {
  ticketSn: string;
  orderSn: string;
  fetchedAt: number;
  tuju?: TujuDetail | null;
  chatRows: ChatHistoryRow[];
  chatError?: string;
  afterSales: AfterSalesListItem[];
  afterSalesError?: string;
  reviews: ReviewItem[];
  reviewsError?: string;
  fetchLogs: FetchStepLog[];
  hasAntiContent: boolean;
  /** 旺店通 tradeQuery 按订单号解析的 skuName，用于质检表匹配 */
  huiceSkuNames?: string[];
  /** 当前申诉商品的目标货品编码（如 SKU25120902），用于旺店通精确过滤 */
  huicePreferredSkuCodes?: string[];
  /** 当前申诉商品关键词（优先精确商品名），用于无 SKU 时辅助过滤 */
  huicePreferredGoodsText?: string;
  huiceError?: string;
};

export type AppealRecommendation = {
  appealReasonCode: number;
  appealReasonDesc: string;
  appealText: string;
  confidence: 'high' | 'medium' | 'low';
  basis: string[];
  aiUsed: boolean;
  /** true=接口 supportedAppealReason；false=内置兜底列表 */
  platformReasonFromApi?: boolean;
  /** AI 连通性诊断 + 请求过程日志，合并展示在技术日志 */
  ollamaLogs?: FetchStepLog[];
};

export type NaFetchResultPayload = {
  requestId: string;
  ok: boolean;
  snapshot?: AppealSnapshot;
  error?: string;
};
