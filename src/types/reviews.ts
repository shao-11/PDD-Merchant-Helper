/**
 * 与 mms 商家后台 /saturn/reviews/list 响应对齐（字段尽量宽松，避免接口微变即崩溃）
 */
export interface ReportResult {
  reviewId?: number;
  status?: number;
  desc?: string;
  clientDesc?: string;
}

export interface ReviewPicture {
  url?: string;
  width?: number;
  height?: number;
}

export interface ReviewItem {
  reviewId?: string;
  goodsId?: number;
  goodsName?: string;
  comment?: string;
  orderSn?: string;
  createTime?: number;
  specs?: string;
  pictures?: ReviewPicture[];
  thumbUrl?: string;
  goodsInfoUrl?: string;
  reportResult?: ReportResult;
  name?: string;
  anonymousReview?: boolean;
}

export interface ReviewsListResponse {
  totalNum?: number;
  allReviewNum?: number;
  reviewNumToday?: number;
  totalRows?: number;
  showNum?: number;
  mallDsrPercent?: number | null;
  goodsOrMallDsr?: number | null;
  reviewNum?: number;
  data?: ReviewItem[];
  /** 非 200 或业务异常时可能由前端补上 */
  _error?: string;
}

export interface ReviewsCaptureState {
  payload: ReviewsListResponse;
  capturedAt: number;
  httpStatus?: number;
}
