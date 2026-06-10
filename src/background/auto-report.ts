import { isSessionValid, type AuthSession } from '../auth/local-auth';
import { STORAGE_AUTH_SESSION } from '../auth/storage-keys';
import {
  STORAGE_AUTO_REPLY_ENABLED,
  STORAGE_AUTO_REPLY_LAST_RESULT,
  STORAGE_AUTO_REPORT_ENABLED,
  STORAGE_AUTO_REPORT_LAST_RESULT,
  STORAGE_AUTO_REPORT_RUNNING,
  STORAGE_REPORT_REPLY_MODULE_ENABLED,
} from '../constants/storage-keys';
import {
  AUTO_REPORT_ALARM_NAME,
  AUTO_REPORT_INTERVAL_SECONDS,
  AUTO_REPORT_EVALUATION_URL,
  AUTO_REPORT_FETCH_DAYS,
  AUTO_REPORT_REPLY_GAP_MS,
  AUTO_REPLY_FETCH_DAYS,
  MSG_AUTO_REPORT_RUN,
  MSG_AUTO_REPLY_RUN,
  type AutoReportLastResult,
  type AutoReportPageResult,
  type AutoReplyLastResult,
  type AutoReplyPageResult,
  type AutoReportRunPayload,
  type AutoReplyRunPayload,
} from '../report-reply/auto-report-messages';

function storageGet<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (raw) => {
      resolve((raw ?? {}) as T);
    });
  });
}

function storageSet(obj: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

let testIntervalId: ReturnType<typeof globalThis.setInterval> | null = null;
let lastBootstrapAt = 0;
/** 登录/打开插件等多路触发合并为一次 */
const BOOTSTRAP_DEBOUNCE_MS = 15_000;
let autoReportJobInFlight: Promise<void> | null = null;

/** 补跑 startup（MV3 下 popup 不会自动拉起后台） */
export function bootstrapAutoReport(): void {
  const now = Date.now();
  if (now - lastBootstrapAt < BOOTSTRAP_DEBOUNCE_MS) {
    console.info('[auto-task] bootstrap 防抖跳过');
    return;
  }
  lastBootstrapAt = now;
  void runAutoReportJob('startup');
}

function periodMatches(stored: number | undefined, expected: number): boolean {
  if (stored == null || !Number.isFinite(stored)) return false;
  return Math.abs(stored - expected) < 0.001;
}

/** 注册/校准 2 小时周期闹钟（勿在 SW 每次唤醒时无脑 clear，否则会永远等不满周期） */
export function scheduleAutoReportAlarm(): void {
  if (testIntervalId != null) {
    globalThis.clearInterval(testIntervalId);
    testIntervalId = null;
  }

  const sec = AUTO_REPORT_INTERVAL_SECONDS;

  /** 联调：<60s 用 setInterval（Chrome 周期闹钟最小 1 分钟，且 SW 休眠后 setInterval 会停） */
  if (sec < 60) {
    void chrome.alarms.clear(AUTO_REPORT_ALARM_NAME);
    testIntervalId = globalThis.setInterval(() => {
      void runAutoReportJob('alarm');
    }, sec * 1000);
    console.info('[auto-task] 使用 setInterval', { intervalMs: sec * 1000 });
    return;
  }

  const periodInMinutes = sec / 60;

  chrome.alarms.get(AUTO_REPORT_ALARM_NAME, (existing) => {
    if (chrome.runtime.lastError) {
      console.warn('[auto-task] alarms.get 失败，重建闹钟', chrome.runtime.lastError.message);
    } else if (existing && periodMatches(existing.periodInMinutes, periodInMinutes)) {
      const next =
        existing.scheduledTime != null
          ? new Date(existing.scheduledTime).toLocaleString('zh-CN')
          : '未知';
      console.info('[auto-task] 周期闹钟已存在，保留原计划', {
        periodInMinutes,
        nextFire: next,
      });
      return;
    }

    void chrome.alarms.clear(AUTO_REPORT_ALARM_NAME, () => {
      chrome.alarms.create(AUTO_REPORT_ALARM_NAME, { periodInMinutes });
      console.info('[auto-task] 已创建/更新周期闹钟', {
        periodInMinutes,
        intervalSec: sec,
        note: '首次约在 periodInMinutes 后触发，之后每 2 小时重复',
      });
    });
  });
}

function waitTabComplete(tabId: number, timeoutMs = 50_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('评价页加载超时'));
    }, timeoutMs);

    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (id !== tabId || info.status !== 'complete') return;
      globalThis.clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === 'complete') {
        globalThis.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    });
  });
}

function sendMessageToTab<T>(
  tabId: number,
  payload: AutoReportRunPayload | AutoReplyRunPayload,
  failLabel: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || `无法连接评价页脚本（${failLabel}）`));
        return;
      }
      const r = response as { ok?: boolean; result?: T; error?: string };
      if (!r?.ok || !r.result) {
        reject(new Error(r?.error || `${failLabel}执行失败`));
        return;
      }
      resolve(r.result);
    });
  });
}

async function sendRunToTabWithRetry(
  tabId: number,
  payload: AutoReportRunPayload | AutoReplyRunPayload,
  failLabel: string
): Promise<AutoReportPageResult | AutoReplyPageResult> {
  try {
    return await sendMessageToTab(tabId, payload, failLabel);
  } catch (firstErr) {
    console.warn(`[auto-task] ${failLabel} 首次通信失败，重试`, firstErr);
    await new Promise((r) => setTimeout(r, 2500));
    return await sendMessageToTab(tabId, payload, failLabel);
  }
}

type TaskPrefs = {
  reportEnabled: boolean;
  replyEnabled: boolean;
};

async function readTaskPrefs(): Promise<TaskPrefs> {
  const raw = await storageGet<Record<string, unknown>>([
    STORAGE_AUTO_REPORT_ENABLED,
    STORAGE_AUTO_REPLY_ENABLED,
  ]);
  return {
    reportEnabled: raw[STORAGE_AUTO_REPORT_ENABLED] !== false,
    replyEnabled: raw[STORAGE_AUTO_REPLY_ENABLED] !== false,
  };
}

async function canRunAutoTask(
  reason: 'startup' | 'alarm' | 'manual',
  prefs: TaskPrefs
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!prefs.reportEnabled && !prefs.replyEnabled) {
    return { ok: false, reason: '自动举报与自动回复均已关闭' };
  }

  const raw = await storageGet<Record<string, unknown>>([
    STORAGE_REPORT_REPLY_MODULE_ENABLED,
    STORAGE_AUTO_REPORT_RUNNING,
    STORAGE_AUTH_SESSION,
  ]);

  if (raw[STORAGE_REPORT_REPLY_MODULE_ENABLED] === false) {
    return { ok: false, reason: '一键举报模块未开启' };
  }
  if (raw[STORAGE_AUTO_REPORT_RUNNING] === true) {
    return { ok: false, reason: '已有自动任务进行中' };
  }

  const session = raw[STORAGE_AUTH_SESSION] as AuthSession | undefined;
  if (!isSessionValid(session)) {
    return { ok: false, reason: '扩展未登录' };
  }

  void reason;
  return { ok: true };
}

async function saveReportLastResult(
  reason: string,
  ok: boolean,
  message: string,
  detail?: Partial<AutoReportPageResult>
): Promise<void> {
  const payload: AutoReportLastResult = {
    at: Date.now(),
    reason,
    ok,
    message,
    total: detail?.total,
    unreported: detail?.unreported,
    reportedOk: detail?.reportedOk,
    reportedFail: detail?.reportedFail,
  };
  await storageSet({ [STORAGE_AUTO_REPORT_LAST_RESULT]: payload });
}

async function saveReplyLastResult(
  reason: string,
  ok: boolean,
  message: string,
  detail?: Partial<AutoReplyPageResult>
): Promise<void> {
  const payload: AutoReplyLastResult = {
    at: Date.now(),
    reason,
    ok,
    message,
    total: detail?.total,
    unreplied: detail?.unreplied,
    repliedOk: detail?.repliedOk,
    repliedFail: detail?.repliedFail,
    aiGeneratedOk: detail?.aiGeneratedOk,
    aiFallbackOk: detail?.aiFallbackOk,
  };
  await storageSet({ [STORAGE_AUTO_REPLY_LAST_RESULT]: payload });
}

/**
 * 后台静默：开一页 → 自动举报（若开启）→ 间隔 → 自动回复（若开启）→ 关页
 */
export async function runAutoReportJob(reason: 'startup' | 'alarm' | 'manual'): Promise<void> {
  if (autoReportJobInFlight) {
    console.info('[auto-task] 跳过', reason, '已有任务在执行');
    return autoReportJobInFlight;
  }

  autoReportJobInFlight = (async () => {
  const prefs = await readTaskPrefs();
  const gate = await canRunAutoTask(reason, prefs);
  if (!gate.ok) {
    console.info('[auto-task] 跳过', reason, gate.reason);
    return;
  }

  await storageSet({ [STORAGE_AUTO_REPORT_RUNNING]: true });
  let tabId: number | null = null;

  try {
    const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
      chrome.tabs.create(
        { url: AUTO_REPORT_EVALUATION_URL, active: false },
        (created) => {
          if (chrome.runtime.lastError || !created?.id) {
            reject(new Error(chrome.runtime.lastError?.message || '无法打开评价页'));
            return;
          }
          resolve(created);
        }
      );
    });

    tabId = tab.id ?? null;
    if (!tabId) throw new Error('评价页标签无效');

    await waitTabComplete(tabId);
    await new Promise((r) => setTimeout(r, 1500));

    if (prefs.reportEnabled) {
      try {
        const reportPayload: AutoReportRunPayload = {
          type: MSG_AUTO_REPORT_RUN,
          days: AUTO_REPORT_FETCH_DAYS,
          reason,
        };
        const reportResult = (await sendRunToTabWithRetry(
          tabId,
          reportPayload,
          '自动举报'
        )) as AutoReportPageResult;
        const msg = reportResult.message ?? (reportResult.skipped ? '已跳过' : '完成');
        await saveReportLastResult(reason, !reportResult.skipped, msg, reportResult);
        console.info('[auto-task] 举报完成', reason, reportResult);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await saveReportLastResult(reason, false, msg);
        console.error('[auto-task] 举报失败', reason, msg);
      }
    } else {
      console.info('[auto-task] 跳过举报（已关闭）', reason);
    }

    if (prefs.replyEnabled) {
      if (prefs.reportEnabled) {
        console.info(`[auto-task] 举报与回复间隔 ${AUTO_REPORT_REPLY_GAP_MS}ms`);
        await new Promise((r) => setTimeout(r, AUTO_REPORT_REPLY_GAP_MS));
      }

      try {
        const replyPayload: AutoReplyRunPayload = {
          type: MSG_AUTO_REPLY_RUN,
          days: AUTO_REPLY_FETCH_DAYS,
          reason,
        };
        const replyResult = (await sendRunToTabWithRetry(
          tabId,
          replyPayload,
          '自动回复'
        )) as AutoReplyPageResult;
        const msg = replyResult.message ?? (replyResult.skipped ? '已跳过' : '完成');
        await saveReplyLastResult(reason, !replyResult.skipped, msg, replyResult);
        console.info('[auto-task] 回复完成', reason, replyResult);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await saveReplyLastResult(reason, false, msg);
        console.error('[auto-task] 回复失败', reason, msg);
      }
    } else {
      console.info('[auto-task] 跳过回复（已关闭）', reason);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (prefs.reportEnabled) await saveReportLastResult(reason, false, msg);
    if (prefs.replyEnabled) await saveReplyLastResult(reason, false, msg);
    console.error('[auto-task] 任务失败', reason, msg);
  } finally {
    if (tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab 可能已被用户关闭 */
      }
    }
    await storageSet({ [STORAGE_AUTO_REPORT_RUNNING]: false });
  }
  })();

  try {
    await autoReportJobInFlight;
  } finally {
    autoReportJobInFlight = null;
  }
}

export function resetAutoReportRunningFlag(): Promise<void> {
  return storageSet({ [STORAGE_AUTO_REPORT_RUNNING]: false });
}

export function initAutoReportScheduler(): void {
  void resetAutoReportRunningFlag();

  /** 先挂监听，避免闹钟触发时 SW 刚启动尚未注册 onAlarm */
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_REPORT_ALARM_NAME) return;
    console.info('[auto-task] 周期闹钟触发', {
      scheduledTime: alarm.scheduledTime
        ? new Date(alarm.scheduledTime).toLocaleString('zh-CN')
        : undefined,
    });
    void runAutoReportJob('alarm');
  });

  scheduleAutoReportAlarm();

  /**
   * 浏览器启动/扩展安装：仅「确保闹钟存在且周期正确」，不自动跑任务。
   * 与 SW 每次冷启动共用 scheduleAutoReportAlarm，已存在则不会重置 2 小时倒计时。
   */
  const onEnsureAlarm = (): void => {
    scheduleAutoReportAlarm();
  };

  chrome.runtime.onStartup.addListener(onEnsureAlarm);
  chrome.runtime.onInstalled.addListener(onEnsureAlarm);
}
