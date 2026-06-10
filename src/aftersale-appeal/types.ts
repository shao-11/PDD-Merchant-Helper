import type { AfterSalesListItem } from '../negative-appeal/types';
import type { ChatHistoryRow } from '../utils/chat-history-parse';
import type { ReviewItem } from '../types/reviews';
import type { FetchStepLog } from '../negative-appeal/fetch-log';

export type CanAppealInfoItem = {
  afterSalesId?: number;
  orderSn?: string;
  afterSalesType?: number;
  afterSalesStatus?: number;
  refundAmount?: number;
  receiveAmount?: number;
  canCargoAppealAmount?: number | null;
  canFreightAppealAmount?: number | null;
  reasonCode?: number;
  reasonDesc?: string;
  goodsName?: string;
  goodsSpec?: string;
  sellerAfterSalesShippingStatusDesc?: string;
  subAppealForbiddenReasonDescMap?: Record<string, string>;
  reverseLogisticOnWay?: boolean | null;
  [key: string]: unknown;
};

export type SubReasonOption = {
  subReasonCode: number;
  subReasonDesc: string;
  mustProofVOList?: unknown;
  optionalProofVOList?: unknown;
};

export type ParentReasonOption = {
  parentReasonCode: number;
  parentReasonCodeDesc: string;
  subReasonVoList?: SubReasonOption[];
};

export type CheckAppealSubItem = {
  code?: number;
  name?: string;
  parentReasonVoList?: ParentReasonOption[];
  subReasonList?: SubReasonOption[];
  [key: string]: unknown;
};

export type CheckAppealResult = {
  checkList?: CheckAppealSubItem[];
  [key: string]: unknown;
};

export type ComplainTypeItem = {
  complainType?: number;
  complainTypeDesc?: string;
  typeId?: number;
  typeName?: string;
  [key: string]: unknown;
};

export type LogisticsTraceItem = {
  time?: string;
  status?: string;
  content?: string;
  [key: string]: unknown;
};

export type AftersaleAppealSnapshot = {
  orderSn: string;
  afterSalesId: number;
  fetchedAt: number;
  canAppealItem?: CanAppealInfoItem | null;
  checkAppeal?: CheckAppealResult | null;
  complainTypes?: ComplainTypeItem[];
  afterSales: AfterSalesListItem[];
  afterSalesError?: string;
  orderDetail?: Record<string, unknown> | null;
  orderDetailError?: string;
  logistics?: {
    trackingNumber?: string;
    shippingName?: string;
    traces?: LogisticsTraceItem[];
    raw?: unknown;
  } | null;
  logisticsError?: string;
  chatRows: ChatHistoryRow[];
  chatError?: string;
  reviews: ReviewItem[];
  reviewsError?: string;
  fetchLogs: FetchStepLog[];
  hasAntiContent: boolean;
  huiceSkuNames?: string[];
  huiceError?: string;
};

export type AftersaleAppealRecommendation = {
  appealSubTypeCode: number;
  appealSubTypeLabel: string;
  parentReasonCode: number;
  subReasonCode: number;
  subReasonDesc: string;
  /** 填入弹窗的金额（元，字符串如 19.80） */
  appealAmountYuan: string;
  description: string;
  complainConsumer: boolean;
  complainTypeCode?: number;
  complainTypeDesc?: string;
  confidence: 'high' | 'medium' | 'low';
  basis: string[];
  aiUsed: boolean;
  aiLogs?: FetchStepLog[];
  /** 自动填入时从弹窗下拉读取的可见项（用于填入阶段精确匹配） */
  visibleReasonLabels?: string[];
};
