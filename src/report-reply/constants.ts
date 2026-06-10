/** postMessage 协议源（与评价分析、活动助手隔离） */
export const REPORT_REPLY_MSG_SOURCE = 'PDD_REPORT_REPLY';

/** 区分请求/响应，避免 RPC 监听器把己方发出的请求当成失败响应 */
export const RPC_KIND_REQ = 'req';
export const RPC_KIND_RES = 'res';

export const EVALUATION_INDEX_PATH = '/goods/evaluation/index';

export const REVIEWS_LIST_URL = 'https://mms.pinduoduo.com/saturn/reviews/list';
export const CREATE_REPORT_URL =
  'https://mms.pinduoduo.com/saturn/reportedReview/edit/createReportedReview';
export const REVIEW_REPLY_SUBMIT_URL = 'https://mms.pinduoduo.com/saturn/review/reply/submit';

/** 举报类型：同行恶意差评 */
export const REPORT_TYPE_PEER_MALICIOUS = '8';

/**
 * 连续举报间隔（毫秒）。过短易触发评价页「系统异常」。
 * 建议最短 ≥1200ms；20 条约 30～50 秒。
 */
export const REPORT_INTERVAL_MS_MIN = 1200;
export const REPORT_INTERVAL_MS_MAX = 2600;

/** 列表翻页：每批并发页数、批间随机间隔（毫秒） */
export const LIST_FETCH_PAGE_SIZE = 40;
export const LIST_FETCH_CONCURRENCY = 3;
export const LIST_FETCH_INTERVAL_MS_MIN = 300;
export const LIST_FETCH_INTERVAL_MS_MAX = 500;

/** 一键举报面板默认查询天数 */
export const DEFAULT_REPORT_DAYS = 7;
/** 一键回复面板默认查询天数 */
export const DEFAULT_REPLY_DAYS = 7;

export const MSG_TYPE_WARM_ANTI = 'WARM_ANTI';
export const MSG_TYPE_FETCH_REVIEWS = 'FETCH_REVIEWS';
export const MSG_TYPE_FETCH_FIVE_STAR_REVIEWS = 'FETCH_FIVE_STAR_REVIEWS';
export const MSG_TYPE_BATCH_REPORT = 'BATCH_REPORT';
export const MSG_TYPE_BATCH_REPLY = 'BATCH_REPLY';

/** 与活动助手共用 localStorage 键，便于同页复用已捕获的 anti-content */
export const LS_MMS_ANTI_KEY = 'pdd_activity_assist_mms_anti_v1';
export const ANTI_MAX_AGE_MS = 45 * 60 * 1000;

export const FLOAT_WRAP_ID = 'dtx-report-reply-float-wrap';
export const FLOAT_BTN_REPORT_ID = 'dtx-report-reply-btn-report';
export const FLOAT_BTN_REPLY_ID = 'dtx-report-reply-btn-reply';
export const OVERLAY_WRAP_ID = 'dtx-report-reply-overlay-wrap';

/** 面板 UI 开关（false=隐藏，不删逻辑；排查问题时改回 true） */
export const REPORT_PANEL_SHOW_TIPS = false;
export const REPORT_PANEL_SHOW_LOG = false;
