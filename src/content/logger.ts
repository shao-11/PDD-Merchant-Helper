/** 控制台步骤前缀，便于在 chrome://extensions → 错误 / 页面控制台里对照 */

export type AnalyzeStep =
  | 'boot'
  | 'hook-msg'
  | 'storage'
  | 'overlay'
  | 'overlay-activity'
  | 'react'
  | 'panel-fallback'
  | 'button'
  | 'button-activity'
  | 'button-activity-prepare'
  | 'activity-prepare'
  | 'activity-uncheck'
  | 'activity-autofill';

const PREFIX = '[评价分析]';

export function logStep(step: AnalyzeStep, message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.info(`${PREFIX}[${step}]`, message, detail);
  } else {
    console.info(`${PREFIX}[${step}]`, message);
  }
}

export function warnStep(step: AnalyzeStep, message: string, detail?: unknown): void {
  console.warn(`${PREFIX}[${step}]`, message, detail ?? '');
}

export function errorStep(step: AnalyzeStep, message: string, detail?: unknown): void {
  console.error(`${PREFIX}[${step}]`, message, detail ?? '');
}

/** 用户可见：仅在关键阻塞时使用，避免刷屏 */
export function alertOnce(key: string, message: string): void {
  const g = globalThis as unknown as Record<string, boolean>;
  const k = `__pdd_alert_${key}`;
  if (g[k]) return;
  g[k] = true;
  window.alert(`${PREFIX}\n\n${message}`);
}
