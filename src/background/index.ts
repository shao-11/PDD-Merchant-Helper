import {
  bootstrapAutoReport,
  initAutoReportScheduler,
  resetAutoReportRunningFlag,
  runAutoReportJob,
} from './auto-report';
import { initKeepAliveScheduler, runKeepAlivePulse } from '../keep-alive/scheduler';
import { MSG_KEEP_ALIVE_TRIGGER_NOW } from '../keep-alive/messages';
import {
  MSG_AUTO_REPORT_AFTER_LOGIN,
  MSG_AUTO_REPORT_TRIGGER_NOW,
} from '../report-reply/auto-report-messages';
import { registerOllamaProxy } from './ollama-proxy';
import { registerReportReplyAiProxy } from './report-reply-ai-proxy';
import { registerHuiceProxy } from './huice-proxy';
import { runOpenAndSyncFeiniuQc } from './feiniu-sync';
import { MSG_FEINIU_OPEN_AND_SYNC } from '../negative-appeal/feiniu-share-messages';

initAutoReportScheduler();
initKeepAliveScheduler();
registerOllamaProxy();
registerReportReplyAiProxy();
registerHuiceProxy();

/**
 * 兜底：从新标签打开面板（悬浮 iframe 为主路径，一般不走这里）。
 * chrome.tabs.create 需 tabs 权限；包裹 try/catch 避免异常导致 Service Worker 崩溃。
 */
chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === MSG_KEEP_ALIVE_TRIGGER_NOW) {
    void runKeepAlivePulse('manual').then((r) => sendResponse({ ok: r.ok, message: r.message }));
    return true;
  }

  if (message?.type === MSG_AUTO_REPORT_AFTER_LOGIN) {
    bootstrapAutoReport();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === MSG_AUTO_REPORT_TRIGGER_NOW) {
    void (async () => {
      await resetAutoReportRunningFlag();
      await runAutoReportJob('manual');
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === MSG_FEINIU_OPEN_AND_SYNC) {
    void runOpenAndSyncFeiniuQc()
      .then((r) => sendResponse(r))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        sendResponse({ ok: false, message: msg });
      });
    return true;
  }

  if (message?.type !== 'OPEN_PANEL') return;

  try {
    const url = chrome.runtime.getURL('panel.html');
    void chrome.tabs.create({ url }, () => {
      if (chrome.runtime.lastError) {
        console.error('[评价分析] 打开标签失败', chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.error('[评价分析] OPEN_PANEL 异常', e);
  }
});

/** 与 Desktop dist/background.js 一致：任意 MMS 带签请求一出，全 tab 的 content 可立刻喂给 MAIN */
const MMS_PREFIX = 'https://mms.pinduoduo.com/';
const ACTIVITY_CONFIRM_PAGE = 'https://mms.pinduoduo.com/act/goods_price/confirm';

function findHeaderValue(
  headers: chrome.webRequest.HttpHeader[] | undefined,
  targetName: string
): string {
  if (!Array.isArray(headers)) return '';
  const target = String(targetName || '').toLowerCase();
  for (const h of headers) {
    if (!h || typeof h.name !== 'string') continue;
    if (h.name.toLowerCase() === target) return String(h.value ?? '');
  }
  return '';
}

function pickAntiParams(url: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  try {
    const u = new URL(String(url || ''));
    for (const [k, v] of u.searchParams.entries()) {
      if (String(k).toLowerCase().includes('anti')) out[k] = v;
    }
  } catch {
    return null;
  }
  return Object.keys(out).length > 0 ? out : null;
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    try {
      if (!details?.url?.startsWith(MMS_PREFIX)) return;
      const anti = findHeaderValue(details.requestHeaders, 'anti-content');
      if (!anti) return;
      const payload = {
        __dtx__: true as const,
        type: 'dtxAntiContent' as const,
        token: anti,
        source: 'webRequest' as const,
        url: details.url,
        method: details.method ?? '',
        antiParams: pickAntiParams(details.url),
        ts: Date.now(),
      };
      if (details.tabId && details.tabId > 0) {
        chrome.tabs.sendMessage(details.tabId, payload, () => {
          void chrome.runtime.lastError;
        });
      }
      void chrome.tabs.query({ url: `${ACTIVITY_CONFIRM_PAGE}*` }, (tabs) => {
        for (const tab of tabs ?? []) {
          if (!tab?.id) continue;
          if (details.tabId && details.tabId === tab.id) continue;
          chrome.tabs.sendMessage(tab.id, payload, () => {
            void chrome.runtime.lastError;
          });
        }
      });
    } catch {
      /* ignore */
    }
  },
  { urls: [`${MMS_PREFIX}*`] },
  ['requestHeaders', 'extraHeaders']
);

