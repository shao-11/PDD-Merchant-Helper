import { getValidAuthSession } from '../auth/local-auth';
import { STORAGE_AUTH_SESSION } from '../auth/storage-keys';
import {
  STORAGE_KEEP_ALIVE_ENABLED,
  STORAGE_KEEP_ALIVE_LAST_RESULT,
  STORAGE_KEEP_ALIVE_TAB_ID,
} from '../constants/storage-keys';
import {
  KEEP_ALIVE_ALARM_NAME,
  KEEP_ALIVE_HOME_URL,
  KEEP_ALIVE_INTERVAL_MAX_MS,
  KEEP_ALIVE_INTERVAL_MIN_MS,
} from './constants';
import { isMmsLoginUrl, tryRecoverOnLoginPage } from './login-page-recover';
import type { KeepAliveLastResult } from './messages';

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

function randomDelayMs(): number {
  const min = KEEP_ALIVE_INTERVAL_MIN_MS;
  const max = KEEP_ALIVE_INTERVAL_MAX_MS;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 未写入 storage 时视为开启（默认开启） */
export async function isKeepAliveEnabled(): Promise<boolean> {
  const raw = await storageGet<Record<string, unknown>>([STORAGE_KEEP_ALIVE_ENABLED]);
  return raw[STORAGE_KEEP_ALIVE_ENABLED] !== false;
}

/** 开关已开且已登录滇同学工具箱 */
export async function canRunKeepAlive(): Promise<boolean> {
  if (!(await isKeepAliveEnabled())) return false;
  return (await getValidAuthSession()) != null;
}

async function stopKeepAliveForAuth(): Promise<void> {
  void chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);
  await closeKeepAliveTab();
}

export function scheduleNextKeepAliveAlarm(): void {
  void chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);
  void (async () => {
    if (!(await canRunKeepAlive())) return;
    chrome.alarms.create(KEEP_ALIVE_ALARM_NAME, { when: Date.now() + randomDelayMs() });
  })();
}

async function saveLastResult(result: KeepAliveLastResult): Promise<void> {
  await storageSet({ [STORAGE_KEEP_ALIVE_LAST_RESULT]: result });
}

function tabExists(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      resolve(!chrome.runtime.lastError && Boolean(tab?.id));
    });
  });
}

async function getStoredKeepAliveTabId(): Promise<number | null> {
  const raw = await storageGet<Record<string, unknown>>([STORAGE_KEEP_ALIVE_TAB_ID]);
  const id = raw[STORAGE_KEEP_ALIVE_TAB_ID];
  if (typeof id !== 'number' || id <= 0) return null;
  if (!(await tabExists(id))) {
    await storageSet({ [STORAGE_KEEP_ALIVE_TAB_ID]: null });
    return null;
  }
  return id;
}

async function createKeepAliveTab(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: KEEP_ALIVE_HOME_URL, active: false, pinned: false }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        reject(new Error(chrome.runtime.lastError?.message ?? '无法创建保活标签页'));
        return;
      }
      void storageSet({ [STORAGE_KEEP_ALIVE_TAB_ID]: tab.id });
      resolve(tab.id);
    });
  });
}

async function ensureKeepAliveTab(): Promise<number> {
  const existing = await getStoredKeepAliveTabId();
  if (existing != null) return existing;
  return createKeepAliveTab();
}

function waitTabComplete(tabId: number, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('首页加载超时'));
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

/** 在保活专用标签页内模拟轻微交互（不刷新用户正在操作的其它 MMS 标签） */
async function nudgePageActivity(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 8, clientY: 8 }));
        const y = window.scrollY;
        window.scrollTo(0, y > 0 ? y - 1 : 1);
        window.scrollTo(0, y);
        document.dispatchEvent(new Event('visibilitychange'));
      } catch {
        /* ignore */
      }
    },
  });
}

async function closeKeepAliveTab(): Promise<void> {
  const tabId = await getStoredKeepAliveTabId();
  await storageSet({ [STORAGE_KEEP_ALIVE_TAB_ID]: null });
  if (tabId == null) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* 可能已被用户关闭 */
  }
}

/**
 * 执行一次保活：仅操作扩展维护的专用后台标签页，刷新 MMS 首页并轻量模拟交互。
 */
export async function runKeepAlivePulse(reason: 'alarm' | 'manual' | 'startup'): Promise<KeepAliveLastResult> {
  const at = Date.now();
  if (!(await isKeepAliveEnabled())) {
    const r: KeepAliveLastResult = { at, ok: false, message: '保活已关闭' };
    await saveLastResult(r);
    return r;
  }

  if (!(await getValidAuthSession())) {
    const r: KeepAliveLastResult = { at, ok: false, message: '请先登录滇同学工具箱' };
    await saveLastResult(r);
    await stopKeepAliveForAuth();
    return r;
  }

  try {
    const tabId = await ensureKeepAliveTab();
    const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t?.id) {
          reject(new Error(chrome.runtime.lastError?.message ?? '保活标签页不存在'));
          return;
        }
        resolve(t);
      });
    });

    const onHome =
      typeof tab.url === 'string' &&
      (tab.url.startsWith(KEEP_ALIVE_HOME_URL) || tab.url === 'https://mms.pinduoduo.com/home/');

    if (onHome) {
      await new Promise<void>((resolve, reject) => {
        chrome.tabs.reload(tabId, { bypassCache: false }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        chrome.tabs.update(tabId, { url: KEEP_ALIVE_HOME_URL, active: false }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
    }

    await waitTabComplete(tabId);

    const tabAfter = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t?.id) {
          reject(new Error(chrome.runtime.lastError?.message ?? '无法读取标签页状态'));
          return;
        }
        resolve(t);
      });
    });

    let pulseMessage: string;
    let pulseOk = true;

    if (isMmsLoginUrl(tabAfter.url)) {
      const recover = await tryRecoverOnLoginPage(tabId);
      pulseMessage = recover.message;
      pulseOk = recover.ok;
      if (!recover.onLoginPage) {
        pulseMessage = reason === 'manual' ? '已手动保活' : '已刷新商家后台首页';
      }
    } else {
      await nudgePageActivity(tabId);
      pulseMessage = reason === 'manual' ? '已手动保活' : '已刷新商家后台首页';
    }

    const r: KeepAliveLastResult = {
      at,
      ok: pulseOk,
      message: pulseMessage,
      tabId,
    };
    await saveLastResult(r);
    console.info('[keep-alive]', reason, r.message, 'tab', tabId);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const r: KeepAliveLastResult = { at, ok: false, message: msg };
    await saveLastResult(r);
    console.warn('[keep-alive]', reason, msg);
    return r;
  } finally {
    if (await canRunKeepAlive()) scheduleNextKeepAliveAlarm();
    else void chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);
  }
}

export function initKeepAliveScheduler(): void {
  scheduleNextKeepAliveAlarm();

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEP_ALIVE_ALARM_NAME) return;
    void runKeepAlivePulse('alarm');
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const raw = await storageGet<Record<string, unknown>>([STORAGE_KEEP_ALIVE_TAB_ID]);
      if (raw[STORAGE_KEEP_ALIVE_TAB_ID] === tabId) {
        await storageSet({ [STORAGE_KEEP_ALIVE_TAB_ID]: null });
      }
    })();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes[STORAGE_AUTH_SESSION]) {
      void (async () => {
        if (await canRunKeepAlive()) {
          scheduleNextKeepAliveAlarm();
          return;
        }
        await stopKeepAliveForAuth();
        await saveLastResult({ at: Date.now(), ok: false, message: '请先登录滇同学工具箱' });
      })();
    }

    if (!changes[STORAGE_KEEP_ALIVE_ENABLED]) return;
    const enabled = changes[STORAGE_KEEP_ALIVE_ENABLED].newValue !== false;
    if (enabled) {
      void runKeepAlivePulse('startup');
    } else {
      void chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);
      void closeKeepAliveTab();
    }
  });

  const bootstrapKeepAlive = (): void => {
    void (async () => {
      if (await canRunKeepAlive()) {
        scheduleNextKeepAliveAlarm();
        void runKeepAlivePulse('startup');
      }
    })();
  };

  chrome.runtime.onStartup.addListener(bootstrapKeepAlive);

  chrome.runtime.onInstalled.addListener(bootstrapKeepAlive);
}
