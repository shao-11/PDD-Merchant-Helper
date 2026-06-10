import {
  FEINIU_SHARE_ID,
  FEINIU_SHARE_PAGE_URL,
} from '../negative-appeal/feiniu-share-constants';
import {
  MSG_FEINIU_SYNC_RUN,
  type FeiniuOpenAndSyncResult,
  type FeiniuSyncContentResult,
} from '../negative-appeal/feiniu-share-messages';

const FEINIU_TAB_URL_PATTERN = 'http://192.168.1.40:5666/s/*';
const PAGE_READY_EXTRA_MS = 2500;
const MESSAGE_RETRY_MS = 2000;
const MESSAGE_MAX_ATTEMPTS = 4;

let openSyncInFlight: Promise<FeiniuOpenAndSyncResult> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitTabComplete(tabId: number, timeoutMs = 55_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('飞牛分享页加载超时，请确认能访问 192.168.1.40'));
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

async function findOrOpenFeiniuTab(): Promise<chrome.tabs.Tab> {
  const existing = await chrome.tabs.query({ url: FEINIU_TAB_URL_PATTERN });
  const matched =
    existing.find((t) => t.url?.includes(`/s/${FEINIU_SHARE_ID}`)) ?? existing[0];

  if (matched?.id) {
    const tab = await chrome.tabs.update(matched.id, {
      url: FEINIU_SHARE_PAGE_URL,
      active: false,
    });
    if (!tab?.id) throw new Error('无法切换到已有飞牛分享标签');
    return tab;
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: FEINIU_SHARE_PAGE_URL, active: false }, (created) => {
      if (chrome.runtime.lastError || !created?.id) {
        reject(new Error(chrome.runtime.lastError?.message || '无法打开飞牛分享页'));
        return;
      }
      resolve(created);
    });
  });
}

function sendSyncToTab(tabId: number): Promise<FeiniuSyncContentResult> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: MSG_FEINIU_SYNC_RUN }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || '无法连接飞牛分享页脚本'));
        return;
      }
      const r = response as FeiniuSyncContentResult | undefined;
      if (!r || typeof r.ok !== 'boolean') {
        reject(new Error('飞牛同步无有效响应'));
        return;
      }
      resolve(r);
    });
  });
}

async function sendSyncWithRetry(tabId: number): Promise<FeiniuSyncContentResult> {
  let lastErr: Error | null = null;
  for (let i = 0; i < MESSAGE_MAX_ATTEMPTS; i += 1) {
    try {
      return await sendSyncToTab(tabId);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < MESSAGE_MAX_ATTEMPTS - 1) {
        await sleep(MESSAGE_RETRY_MS);
      }
    }
  }
  throw lastErr ?? new Error('飞牛同步失败');
}

/**
 * 打开（或复用）飞牛分享页并执行质检图同步。
 */
export async function runOpenAndSyncFeiniuQc(): Promise<FeiniuOpenAndSyncResult> {
  if (openSyncInFlight) return openSyncInFlight;

  openSyncInFlight = (async () => {
    const tab = await findOrOpenFeiniuTab();
    const tabId = tab.id;
    if (!tabId) throw new Error('飞牛分享标签无效');

    try {
      await waitTabComplete(tabId);
      await sleep(PAGE_READY_EXTRA_MS);

      const result = await sendSyncWithRetry(tabId);
      return { ...result, tabId };
    } finally {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* 标签可能已被用户关闭 */
      }
    }
  })();

  try {
    return await openSyncInFlight;
  } finally {
    openSyncInFlight = null;
  }
}
