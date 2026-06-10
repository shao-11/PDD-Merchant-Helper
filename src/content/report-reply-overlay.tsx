/**
 * 一键举报（回复）— 独立 content script，仅评价管理页。
 * 不修改 overlay-entry / 评价分析 / 活动助手。
 */
import '../content/install-webrequest-anti-bridge';
import React, { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import resetCssText from 'antd/dist/reset.css';
import { isSessionValid, type AuthSession } from '../auth/local-auth';
import { STORAGE_AUTH_SESSION } from '../auth/storage-keys';
import { STORAGE_REPORT_REPLY_MODULE_ENABLED } from '../constants/storage-keys';
import { rrLog } from '../report-reply/debug-log';
import { ReportReplyPanel } from '../report-reply/ReportReplyPanel';
import {
  MSG_AUTO_REPLY_RUN,
  MSG_AUTO_REPORT_RUN,
  type AutoReplyRunPayload,
  type AutoReportRunPayload,
} from '../report-reply/auto-report-messages';
import { runAutoReportInPage } from '../report-reply/run-auto-report';
import { runAutoReplyInPage } from '../report-reply/run-auto-reply';
import {
  EVALUATION_INDEX_PATH,
  FLOAT_BTN_REPLY_ID,
  FLOAT_BTN_REPORT_ID,
  FLOAT_WRAP_ID,
  OVERLAY_WRAP_ID,
} from '../report-reply/constants';

function isEvaluationIndexPage(): boolean {
  try {
    return window.location.pathname.includes(EVALUATION_INDEX_PATH);
  } catch {
    return false;
  }
}

let overlayRoot: Root | null = null;
let overlayMode: 'report' | 'reply' | null = null;
let overlayMountKey = 0;
let bodyScrollLock = 0;

function lockBodyScroll(): void {
  bodyScrollLock += 1;
  if (bodyScrollLock === 1) document.body.style.overflow = 'hidden';
}

function unlockBodyScroll(): void {
  bodyScrollLock = Math.max(0, bodyScrollLock - 1);
  if (bodyScrollLock === 0) document.body.style.overflow = '';
}

function removeOverlay(): void {
  overlayRoot?.unmount();
  overlayRoot = null;
  overlayMode = null;
  document.getElementById(OVERLAY_WRAP_ID)?.remove();
  unlockBodyScroll();
}

/** 面板「关闭」：收起浮层并刷新评价页，恢复商家后台列表状态 */
function closeOverlayAndReload(): void {
  removeOverlay();
  rrLog('overlay', 'info', '关闭面板并刷新页面');
  window.location.reload();
}

function openOverlay(mode: 'report' | 'reply'): void {
  if (document.getElementById(OVERLAY_WRAP_ID)) {
    if (overlayMode === mode) {
      removeOverlay();
      return;
    }
    removeOverlay();
  }

  const wrap = document.createElement('div');
  wrap.id = OVERLAY_WRAP_ID;
  wrap.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'background:rgba(0,0,0,.45)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'box-sizing:border-box',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:#fff',
    'border-radius:18px',
    'max-height:90vh',
    'overflow:auto',
    'box-shadow:0 4px 24px rgba(15,23,42,.12),0 1px 3px rgba(15,23,42,.06)',
    'border:1px solid rgba(22,119,255,.08)',
    'font-family:system-ui,-apple-system,sans-serif',
  ].join(';');

  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) removeOverlay();
  });

  const mount = document.createElement('div');
  card.appendChild(mount);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  lockBodyScroll();

  overlayMode = mode;
  overlayMountKey += 1;
  rrLog('overlay', 'info', `打开浮层`, { mode, mountKey: overlayMountKey });
  overlayRoot = createRoot(mount);
  overlayRoot.render(
    <StrictMode>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          <ReportReplyPanel key={`rr-panel-${overlayMountKey}`} mode={mode} onClose={closeOverlayAndReload} />
        </AntApp>
      </ConfigProvider>
    </StrictMode>
  );
}

function injectResetStyle(): void {
  if (document.getElementById('dtx-report-reply-ant-reset')) return;
  const el = document.createElement('style');
  el.id = 'dtx-report-reply-ant-reset';
  el.textContent = resetCssText;
  document.documentElement.appendChild(el);
}

function mountFloatingButtons(): void {
  if (document.getElementById(FLOAT_WRAP_ID)) return;

  const wrap = document.createElement('div');
  wrap.id = FLOAT_WRAP_ID;
  wrap.setAttribute('role', 'toolbar');
  wrap.setAttribute('aria-label', '一键举报回复');
  /** 与「评价分析」同侧（right:24px）；bottom 留出约 2 枚按钮 + 间距，避免与评价分析重叠 */
  wrap.style.cssText = [
    'position:fixed',
    'bottom:120px',
    'right:24px',
    'z-index:2147483647',
    'display:flex',
    'flex-direction:column',
    'align-items:flex-end',
    'gap:10px',
    'font-family:system-ui,-apple-system,sans-serif',
  ].join(';');

  const baseStyle = [
    'padding:10px 16px',
    'border-radius:8px',
    'border:none',
    'cursor:pointer',
    'font-size:14px',
    'color:#fff',
    'box-shadow:0 4px 12px rgba(0,0,0,.15)',
    'white-space:nowrap',
  ].join(';');

  const btnReport = document.createElement('button');
  btnReport.id = FLOAT_BTN_REPORT_ID;
  btnReport.type = 'button';
  btnReport.textContent = '一键举报';
  btnReport.title = '打开一键举报面板';
  btnReport.style.cssText = `${baseStyle};background:#cf1322;`;

  const btnReply = document.createElement('button');
  btnReply.id = FLOAT_BTN_REPLY_ID;
  btnReply.type = 'button';
  btnReply.textContent = '一键回复';
  btnReply.title = '打开一键回复面板';
  btnReply.style.cssText = `${baseStyle};background:#1677ff;`;

  const openReport = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    openOverlay('report');
  };
  const openReply = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    openOverlay('reply');
  };
  btnReport.addEventListener('click', openReport);
  btnReply.addEventListener('click', openReply);

  wrap.appendChild(btnReport);
  wrap.appendChild(btnReply);
  document.body.appendChild(wrap);
}

function removeFloatingButtons(): void {
  removeOverlay();
  document.getElementById(FLOAT_WRAP_ID)?.remove();
}

function applyVisibility(): void {
  if (!isEvaluationIndexPage()) {
    removeFloatingButtons();
    return;
  }

  chrome.storage.local.get(
    [STORAGE_AUTH_SESSION, STORAGE_REPORT_REPLY_MODULE_ENABLED],
    (raw) => {
      if (chrome.runtime.lastError) return;
      const session = raw[STORAGE_AUTH_SESSION] as AuthSession | undefined;
      if (!isSessionValid(session)) {
        removeFloatingButtons();
        return;
      }
      const enabled = raw[STORAGE_REPORT_REPLY_MODULE_ENABLED] !== false;
      if (!enabled) {
        removeFloatingButtons();
        return;
      }
      if (document.body) {
        rrLog('overlay', 'info', '悬浮按钮已挂载', { path: window.location.pathname });
        mountFloatingButtons();
      }
    }
  );
}

function ensureOnBody(): void {
  if (!isEvaluationIndexPage()) return;
  if (document.body) {
    applyVisibility();
    return;
  }
  const obs = new MutationObserver(() => {
    if (document.body) {
      obs.disconnect();
      applyVisibility();
    }
  });
  obs.observe(document.documentElement, { childList: true });
}

injectResetStyle();
ensureOnBody();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes[STORAGE_AUTH_SESSION] ||
    changes[STORAGE_REPORT_REPLY_MODULE_ENABLED]
  ) {
    applyVisibility();
  }
});

let lastPath = window.location.pathname;
const routeObs = new MutationObserver(() => {
  if (window.location.pathname === lastPath) return;
  lastPath = window.location.pathname;
  applyVisibility();
});
routeObs.observe(document.documentElement, { subtree: true, childList: true });

window.addEventListener('popstate', applyVisibility);
window.addEventListener('hashchange', applyVisibility);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as AutoReportRunPayload | AutoReplyRunPayload;
  const type = msg?.type;
  if (type !== MSG_AUTO_REPORT_RUN && type !== MSG_AUTO_REPLY_RUN) return;
  if (!isEvaluationIndexPage()) {
    sendResponse({ ok: false, error: '当前不是评价管理页' });
    return;
  }
  void (async () => {
    try {
      const days = msg.days ?? 3;
      const result =
        type === MSG_AUTO_REPORT_RUN
          ? await runAutoReportInPage(days)
          : await runAutoReplyInPage(days);
      sendResponse({ ok: true, result });
    } catch (e) {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
  return true;
});
