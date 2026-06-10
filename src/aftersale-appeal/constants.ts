/** 售后维权申诉模块 — MMS 接口与消息协议（与负向反馈模块隔离） */

export const ASA_MSG_SOURCE_CONTENT = 'PDD_DTX_ASA_CONTENT';
export const ASA_MSG_SOURCE_INJECT = 'PDD_DTX_ASA_INJECT';

export const ASA_MSG_FETCH = 'ASA_FETCH';
export const ASA_MSG_FETCH_RESULT = 'ASA_FETCH_RESULT';
export const ASA_MSG_UPLOAD_FILES = 'ASA_UPLOAD_APPEAL_FILES';
export const ASA_MSG_UPLOAD_RESULT = 'ASA_UPLOAD_APPEAL_RESULT';

export const AFTERSALE_APPEAL_LIST_PATH = '/orders/appeals/aftersale/order';

export const API_QUERY_CAN_APPEAL_LIST =
  'https://mms.pinduoduo.com/auncel/mms/appeal/queryCanAppealInfoList';
export const API_CHECK_APPEAL = 'https://mms.pinduoduo.com/mercury/appeal/checkAppeal';
export const API_APPEAL_PRE_CHECK = 'https://mms.pinduoduo.com/auncel/appeal/preCheck';
export const API_AFTER_SALES_LIST = 'https://mms.pinduoduo.com/mercury/mms/afterSales/queryList';
export const API_ORDER_DETAIL = 'https://mms.pinduoduo.com/mangkhut/mms/orderDetail';
export const API_CHAT_HISTORY = 'https://mms.pinduoduo.com/latitude/message/getHistoryMessage';
export const API_REVIEWS_LIST = 'https://mms.pinduoduo.com/saturn/reviews/list';
export const API_LOGISTICS_TRACK = 'https://mms.pinduoduo.com/express_base/mms/track/get';
export const API_COMPLAIN_TYPE =
  'https://mms.pinduoduo.com/cambridge/api/customer/abnormal/behavior/complain/complainType';

export const MMS_CHAT_REFERER_AI =
  'https://mms.pinduoduo.com/mms-chat/search?msfrom=mms_ai_search_function';

/** 货款申诉（维权申诉弹窗默认项） */
export const APPEAL_SUB_TYPE_CARGO = 2;
/** 运费申诉 */
export const APPEAL_SUB_TYPE_FREIGHT = 1;

/** checkAppeal 常见申诉子类型（不同订单下拉项不同，需尽量全量拉取） */
export const DEFAULT_CHECK_APPEAL_SUB_TYPES = [1, 2, 3, 5, 6, 20];

export const FLOAT_BTN_ID = 'dtx-aftersale-appeal-float-btn';
export const FLOAT_BTN_AUTOFILL_ID = 'dtx-aftersale-appeal-autofill-btn';
export const OVERLAY_WRAP_ID = 'dtx-aftersale-appeal-overlay';

export const LS_ASA_ACTIVE_ORDER = 'pdd_asa_active_order_v1';
export const LS_ASA_CAN_APPEAL_LIST = 'pdd_asa_can_appeal_list_v1';
export const LS_ASA_CHECK_APPEAL = 'pdd_asa_check_appeal_v1';
export const LS_ASA_COMPLAIN_TYPES = 'pdd_asa_complain_types_v1';
export const LS_ASA_LAST_ANALYSIS = 'pdd_asa_last_analysis_v1';
export const LS_MMS_ANTI_KEY = 'pdd_activity_assist_mms_anti_v1';
export const LS_CHAT_HDR_KEY = 'pdd_ra_chat_hdr_v1';
export const ANTI_MAX_AGE_MS = 45 * 60 * 1000;

export const APPEAL_DESC_MAX_LEN = 300;

/** AI 可直接走质检凭证的申诉原因；其它原因需在弹窗底部提示人工判断 */
export const AUTO_PASS_APPEAL_REASON = '消费者反馈商品存在质量问题，但凭证不足';
export const MANUAL_REVIEW_HINT_ID = 'dtx-asa-manual-review-hint';
export const MANUAL_REVIEW_HINT_SLOT_ATTR = 'data-dtx-asa-hint-slot';
