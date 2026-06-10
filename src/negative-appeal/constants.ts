/** 负向反馈申诉模块 — 仅使用已确认的 MMS 接口，勿随意增改 URL */

export const NA_MSG_SOURCE_CONTENT = 'PDD_DTX_NA_CONTENT';
export const NA_MSG_SOURCE_INJECT = 'PDD_DTX_NA_INJECT';

export const NA_MSG_FETCH = 'NA_FETCH';
export const NA_MSG_FETCH_RESULT = 'NA_FETCH_RESULT';
export const NA_MSG_UPLOAD_APPEAL_FILES = 'NA_UPLOAD_APPEAL_FILES';
export const NA_MSG_UPLOAD_APPEAL_RESULT = 'NA_UPLOAD_APPEAL_RESULT';

export const APPEAL_LIST_URL = 'https://mms.pinduoduo.com/aftersales/customer_complain_appeal';
export const APPEAL_DETAIL_PATH = '/aftersales/customer_complain_appeal/detail';

export const API_TUJU_DETAIL = 'https://mms.pinduoduo.com/api/colombo/tuju/detail';
export const API_CHAT_HISTORY = 'https://mms.pinduoduo.com/latitude/message/getHistoryMessage';
export const API_AFTER_SALES_LIST = 'https://mms.pinduoduo.com/mercury/mms/afterSales/queryList';
export const API_REVIEWS_LIST = 'https://mms.pinduoduo.com/saturn/reviews/list';

export const MMS_CHAT_REFERER_AI =
  'https://mms.pinduoduo.com/mms-chat/search?msfrom=mms_ai_search_function';

export const FLOAT_BTN_ID = 'dtx-negative-appeal-float-btn';
export const FLOAT_BTN_AUTOFILL_ID = 'dtx-negative-appeal-autofill-btn';
export const OVERLAY_WRAP_ID = 'dtx-negative-appeal-overlay';

export const LS_CHAT_HDR_KEY = 'pdd_ra_chat_hdr_v1';
export const LS_MMS_ANTI_KEY = 'pdd_activity_assist_mms_anti_v1';
export const ANTI_MAX_AGE_MS = 45 * 60 * 1000;

export const BAILIAN_CHAT_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
export const BAILIAN_MODEL_DEFAULT = 'qwen-turbo';
export const BAILIAN_MODEL_PRESETS = ['qwen-turbo', 'qwen-plus', 'qwen2.5-7b-instruct'] as const;

export const APPEAL_AI_MODEL_DEFAULT = BAILIAN_MODEL_DEFAULT;

export const OLLAMA_MODEL_DEFAULT = 'qwen2.5:3b';
export const OLLAMA_ENV_BAT_REL = 'scripts\\启动AI分析环境.bat';

export const APPEAL_REASON_CODES = [18, 19, 20, 21, 99] as const;

export {
  FEINIU_SHARE_PAGE_URL,
  FEINIU_SHARE_ID,
  QC_CATALOG_SOURCE_ID,
} from './feiniu-share-constants';
