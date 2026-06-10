/** 与页面 MAIN 注入脚本 postMessage 约定一致 */
export const ACTIVITY_MSG_SOURCE = 'PDD_ACTIVITY_ASSISTANT';

/** 面板触发：仅 create + batch①，成功后由 content 写 storage 并刷新 */
export const ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE = 'PREPARE_TEMPLATE';
export const ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE_RESULT = 'PREPARE_TEMPLATE_RESULT';
/** content → MAIN：进入活动确认页后尽早促发 MMS，便于点「创建模板」时缓存已有签 */
export const ACTIVITY_MSG_TYPE_WARM_MMS_ANTI = 'WARM_MMS_ANTI';
/** 报名成功后 MAIN 通知 content 清除「已准备模板」状态 */
export const ACTIVITY_MSG_TYPE_PREPARED_CONSUMED = 'PREPARED_CONSUMED';

/** 刷新后 content 尝试取消勾选协议框（sessionStorage 一次性标记） */
export const SESSION_STORAGE_ACTIVITY_UNCHECK_AFTER_RELOAD = 'pdd_activity_assist_uncheck_after_reload_v1';

/**
 * MAIN inject 从 leekmms `rule_suggest_price` / `rule_v3` 等响应写入；自动填充与跟单解析优先读此列表（与接口报名 goods 一致）。
 */
export const SESSION_STORAGE_ACTIVITY_RULE_GOODS_IDS_JSON = 'pdd_activity_assist_rule_goods_ids_json_v1';

export const ENROLL_URL_MARKER = 'lakemms/enrollV2';

export const UPSERT_SHIPPING_URL =
  'https://mms.pinduoduo.com/mangosteen/free/shipping/upsert/shipping';
export const UPSERT_SHIPPING_V4_URL =
  'https://mms.pinduoduo.com/mangosteen/free/shipping/upsert/v4';
/** 解析当前店铺运费模板列表（提交跟单时若面板未填 id 则按名称匹配商品） */
export const COST_TEMPLATE_GET_LIST_URL =
  'https://mms.pinduoduo.com/express_inf/cost_template/get_list';
export const UPDATE_COST_TEMPLATE_V2_URL =
  'https://mms.pinduoduo.com/express_inf/cost_template/updateV2';
/** 导图第一步：新建运费模板（与 updateV2 规则一致，仅不含 costTemplateId） */
export const COST_TEMPLATE_CREATE_URL =
  'https://mms.pinduoduo.com/express_inf/cost_template/create';
/** 将商品绑定到指定运费模板（导图第二步），否则商品仍挂在旧模板上，报名会报「物流模板不符合规则」 */
export const COST_TEMPLATE_BATCH_SUBMIT_URL =
  'https://mms.pinduoduo.com/guide-api/mms/cost_template/batch_submit';

/** 与 dist `MANGOSTEEN_FREE_SHIPPING_UPSERT_BODY.provinceId` 及 updateV2 第三段计费区一致；平台文档/ dist 注释对 19 的省名可能写「云南」或「内蒙古」，以 dist 脚本为准 */
export const INNER_MO_PROVINCE_ID = 19;
