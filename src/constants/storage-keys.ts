/** chrome.storage.local 键名（content / popup 共用） */
/** 为 false 时商家后台不挂载「评价分析」浮动入口（面板仍可从弹窗打开） */
export const STORAGE_REVIEWS_MODULE_ENABLED = 'reviewsModuleEnabled';
export const STORAGE_REVIEWS_CAPTURE = 'reviewsCapture';
/** 为 true（默认）时，多次捕获的评价行会合并去重，便于翻页累积 */
export const STORAGE_REVIEWS_MERGE_PAGES = 'reviewsCaptureMergePages';
/** 为 true（默认）时，inject 在拿到第一页后按相同请求模板自动请求后续页 */
export const STORAGE_REVIEWS_AUTO_FETCH_ALL = 'reviewsCaptureAutoFetchAll';
/** 自动拉取的最大页数上限（含末页），防止总量过大时请求过久 */
export const STORAGE_REVIEWS_MAX_FETCH_PAGES = 'reviewsCaptureMaxFetchPages';
/** 改写接口请求体中的 pageSize（如 50、100），单次返回更多条以加快拉取 */
export const STORAGE_REVIEWS_REQUEST_PAGE_SIZE = 'reviewsCaptureRequestPageSize';
/** 评价分析按时间拉取：7 / 30 / 90 / 180（天） */
export const STORAGE_REVIEWS_FETCH_RANGE_DAYS = 'reviewsCaptureFetchRangeDays';
/** 曾打开聊天记录且接口为「无数据」(1000000 约定) 的订单号，表格不再展示「聊天记录」入口 */
export const STORAGE_CHAT_EMPTY_ORDER_SN_MAP = 'reviewsChatEmptyOrderSnMap';

/** 活动助手：确认提交后延迟跟单（mangosteen→updateV2），不拦截 enrollV2（内蒙古不包邮） */
/** 为 false 时评价管理页不挂载「一键举报（回复）」浮动按钮 */
export const STORAGE_REPORT_REPLY_MODULE_ENABLED = 'reportReplyModuleEnabled';
/** 为 false 时申诉详情页不显示「自动申诉」按钮 */
export const STORAGE_NEGATIVE_APPEAL_MODULE_ENABLED = 'negativeAppealModuleEnabled';
/** 为 false 时售后申诉列表页不显示浮动按钮 */
export const STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED = 'aftersaleAppealModuleEnabled';
/** 负向申诉：阿里云百炼 / DashScope API Key（仅本地 storage，勿提交仓库） */
export const STORAGE_NA_BAILIAN_API_KEY = 'naBailianApiKey';
/** 负向申诉：百炼模型名，默认 qwen-turbo */
export const STORAGE_NA_BAILIAN_MODEL = 'naBailianModel';
/** 质检图：飞牛分享 PNG 同步后的「规格名 → 图片」缓存 */
export const STORAGE_QC_SHEET_CATALOG = 'naQcSheetCatalog';
/** 自动举报（Chrome 运行期间定时）；未写入时视为 true */
export const STORAGE_AUTO_REPORT_ENABLED = 'autoReportEnabled';
/** 自动回复；未写入时视为 true */
export const STORAGE_AUTO_REPLY_ENABLED = 'autoReplyEnabled';
/** 自动任务（举报+回复）进行中，避免重叠 */
export const STORAGE_AUTO_REPORT_RUNNING = 'autoReportRunning';
/** 最近一次自动举报结果摘要 */
export const STORAGE_AUTO_REPORT_LAST_RESULT = 'autoReportLastResult';
/** 最近一次自动回复结果摘要 */
export const STORAGE_AUTO_REPLY_LAST_RESULT = 'autoReplyLastResult';
/** 一键/自动回复：百炼 API Key（未填则回退负向申诉 Key） */
export const STORAGE_RR_BAILIAN_API_KEY = 'rrBailianApiKey';
/** 一键/自动回复：百炼模型，默认 qwen-max */
export const STORAGE_RR_BAILIAN_MODEL = 'rrBailianModel';

export const STORAGE_ACTIVITY_ASSIST_ENABLED = 'activityAssistEnabled';
/** 运费模板数字 id，与 orders/order/carriage/edit?id= 一致 */
export const STORAGE_ACTIVITY_COST_TEMPLATE_ID = 'activityAssistCostTemplateId';
/** 与商家后台该模板名称完全一致，用于 updateV2 */
export const STORAGE_ACTIVITY_COST_TEMPLATE_NAME = 'activityAssistCostTemplateName';
/** 逗号分隔的商品 ID，报名接口解析不到时兜底（与报错里的商品 ID 一致） */
export const STORAGE_ACTIVITY_GOODS_IDS_CSV = 'activityAssistGoodsIdsCsv';
/** 活动助手：MAIN 注入脚本经 postMessage 写入的调试日志（环形队列由写入端截断） */
export const STORAGE_ACTIVITY_DEBUG_LOGS = 'activityAssistDebugLogs';
/** 分步模式：提前 create+batch① 后的模板 ID（确认提交后跟单 upsert→updateV2→batch②，不拦截 enroll） */
export const STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID = 'activityAssistPreparedTemplateId';
export const STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME = 'activityAssistPreparedTemplateName';
/** 与报名时 goods 指纹一致才走分步后半段，逗号分隔排序后的 goods id */
export const STORAGE_ACTIVITY_PREPARED_GOODS_FP = 'activityAssistPreparedGoodsFingerprint';

/** 防账号掉线：为 false 时关闭；未写入时视为 true（默认开启） */
export const STORAGE_KEEP_ALIVE_ENABLED = 'keepAliveEnabled';
/** 扩展维护的专用保活标签页 id */
export const STORAGE_KEEP_ALIVE_TAB_ID = 'keepAliveTabId';
/** 最近一次保活执行摘要 */
export const STORAGE_KEEP_ALIVE_LAST_RESULT = 'keepAliveLastResult';
/** 浏览器密码列表中选第几个（0=第一条，通常已高亮） */
export const STORAGE_KEEP_ALIVE_MMS_CREDENTIAL_INDEX = 'keepAliveMmsCredentialIndex';
/** 自动填充失败时兜底填入的 MMS 账号（可选） */
export const STORAGE_KEEP_ALIVE_MMS_USERNAME = 'keepAliveMmsUsername';
/** 自动填充失败时兜底填入的 MMS 密码（可选，仅本地 storage） */
export const STORAGE_KEEP_ALIVE_MMS_PASSWORD = 'keepAliveMmsPassword';
