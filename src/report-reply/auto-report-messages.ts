/** background ↔ report-reply content 自动任务消息（与评价分析、活动助手隔离） */
export const MSG_AUTO_REPORT_RUN = 'DTX_AUTO_REPORT_RUN';
export const MSG_AUTO_REPLY_RUN = 'DTX_AUTO_REPLY_RUN';
/** 设置页手动触发一轮（举报完成后回复） */
export const MSG_AUTO_REPORT_TRIGGER_NOW = 'DTX_AUTO_REPORT_TRIGGER_NOW';
/** 登录成功后执行一轮（由 local-auth 在写 session 后发送） */
export const MSG_AUTO_REPORT_AFTER_LOGIN = 'DTX_AUTO_REPORT_AFTER_LOGIN';

export const AUTO_REPORT_EVALUATION_URL = 'https://mms.pinduoduo.com/goods/evaluation/index';

/** 拉取最近 N 天 1～3 星（自动举报） */
export const AUTO_REPORT_FETCH_DAYS = 3;
/** 拉取最近 N 天 4～5 星（自动回复，先 5 星后 4 星） */
export const AUTO_REPLY_FETCH_DAYS = 3;

/** 同一标签内：举报阶段结束后再开始回复，降低接口撞车 */
export const AUTO_REPORT_REPLY_GAP_MS = 4000;

/** 自动举报定时间隔（秒）。7200 = 2 小时；<60 才走 setInterval */
export const AUTO_REPORT_INTERVAL_SECONDS = 7200;

export const AUTO_REPORT_ALARM_NAME = 'dtx-auto-report';

/** 设置页展示用，与 AUTO_REPORT_INTERVAL_SECONDS 一致 */
export function formatAutoTaskInterval(seconds = AUTO_REPORT_INTERVAL_SECONDS): string {
  if (seconds < 60) return `每 ${seconds} 秒`;
  if (seconds < 3600) return `每 ${Math.round(seconds / 60)} 分钟`;
  const h = seconds / 3600;
  return Number.isInteger(h) ? `每 ${h} 小时` : `每 ${(seconds / 3600).toFixed(1)} 小时`;
}

export type AutoReportRunPayload = {
  type: typeof MSG_AUTO_REPORT_RUN;
  days: number;
  reason: 'startup' | 'alarm' | 'manual';
};

export type AutoReportLastResult = {
  at: number;
  reason: string;
  ok: boolean;
  message: string;
  total?: number;
  unreported?: number;
  reportedOk?: number;
  reportedFail?: number;
};

export type AutoReportPageResult = {
  total: number;
  unreported: number;
  reportedOk: number;
  reportedFail: number;
  skipped: boolean;
  message?: string;
};

export type AutoReplyRunPayload = {
  type: typeof MSG_AUTO_REPLY_RUN;
  days: number;
  reason: 'startup' | 'alarm' | 'manual';
};

export type AutoReplyLastResult = {
  at: number;
  reason: string;
  ok: boolean;
  message: string;
  total?: number;
  unreplied?: number;
  repliedOk?: number;
  repliedFail?: number;
  /** 成功回复中由 AI 生成文案的条数 */
  aiGeneratedOk?: number;
  /** 成功回复中因 AI 失败而使用默认文案的条数 */
  aiFallbackOk?: number;
};

export type AutoReplyPageResult = {
  total: number;
  unreplied: number;
  repliedOk: number;
  repliedFail: number;
  skipped: boolean;
  message?: string;
  aiGeneratedOk?: number;
  aiFallbackOk?: number;
};
