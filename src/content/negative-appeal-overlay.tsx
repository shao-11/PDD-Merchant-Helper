/**
 * 负向反馈申诉 — 独立 content script，仅申诉详情页。
 */
import '../content/install-webrequest-anti-bridge';
import React, { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App as AntApp, ConfigProvider, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import resetCssText from 'antd/dist/reset.css';
import { isSessionValid, type AuthSession } from '../auth/local-auth';
import { STORAGE_AUTH_SESSION } from '../auth/storage-keys';
import { STORAGE_NEGATIVE_APPEAL_MODULE_ENABLED } from '../constants/storage-keys';
import { runAutoFillAppeal } from '../negative-appeal/auto-fill-flow';
import { FLOAT_BTN_AUTOFILL_ID, FLOAT_BTN_ID, OVERLAY_WRAP_ID } from '../negative-appeal/constants';
import { NegativeAppealPanel } from '../negative-appeal/NegativeAppealPanel';
import { isAppealDetailPage, parseTicketSnFromUrl } from '../negative-appeal/page-context';

function isModuleEnabled(cb: (on: boolean) => void): void {
  chrome.storage.local.get([STORAGE_NEGATIVE_APPEAL_MODULE_ENABLED], (raw) => {
    if (chrome.runtime.lastError) {
      cb(true);
      return;
    }
    cb(raw[STORAGE_NEGATIVE_APPEAL_MODULE_ENABLED] !== false);
  });
}

function isLoggedIn(cb: (ok: boolean) => void): void {
  chrome.storage.local.get([STORAGE_AUTH_SESSION], (raw) => {
    const session = raw[STORAGE_AUTH_SESSION] as AuthSession | undefined;
    cb(isSessionValid(session));
  });
}

let overlayRoot: Root | null = null;
let bodyScrollLock = 0;
let escListener: ((e: KeyboardEvent) => void) | null = null;

const OVERLAY_CARD_ID = 'dtx-negative-appeal-overlay-card';

function lockBodyScroll(): void {
  bodyScrollLock += 1;
  if (bodyScrollLock === 1) document.body.style.overflow = 'hidden';
}

function unlockBodyScroll(): void {
  bodyScrollLock = Math.max(0, bodyScrollLock - 1);
  if (bodyScrollLock === 0) document.body.style.overflow = '';
}

function removeOverlay(): void {
  message.destroy();
  overlayRoot?.unmount();
  overlayRoot = null;
  document.getElementById(OVERLAY_WRAP_ID)?.remove();
  if (escListener) {
    window.removeEventListener('keydown', escListener);
    escListener = null;
  }
  unlockBodyScroll();
}

function openOverlay(): void {
  if (document.getElementById(OVERLAY_WRAP_ID)) {
    removeOverlay();
    return;
  }

  const ticketSn = parseTicketSnFromUrl();
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
  card.id = OVERLAY_CARD_ID;
  card.style.cssText = [
    'background:#fff',
    'border-radius:18px',
    'width:min(560px,96vw)',
    'height:min(88vh,720px)',
    'min-height:min(480px,85vh)',
    'max-height:min(88vh,720px)',
    'overflow:hidden',
    'display:flex',
    'flex-direction:column',
    'padding:0',
    'box-shadow:0 4px 24px rgba(15,23,42,.12)',
    'border:1px solid rgba(22,119,255,.08)',
    'box-sizing:border-box',
  ].join(';');

  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) removeOverlay();
  });
  card.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  const shell = document.createElement('div');
  shell.className = 'dtx-na-overlay-shell';
  card.appendChild(shell);
  wrap.appendChild(card);
  document.documentElement.appendChild(wrap);

  message.config({
    getContainer: () => wrap,
    top: 72,
    maxCount: 3,
  });

  const toastStyle = document.createElement('style');
  toastStyle.textContent = `
    #${OVERLAY_WRAP_ID} .ant-message,
    #${OVERLAY_WRAP_ID} .ant-message-notice-wrapper {
      z-index: 2147483647 !important;
      pointer-events: none;
    }
    #${OVERLAY_WRAP_ID} .ant-message-notice-content {
      pointer-events: auto;
    }
  `;
  wrap.appendChild(toastStyle);

  lockBodyScroll();

  escListener = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') removeOverlay();
  };
  window.addEventListener('keydown', escListener);

  const style = document.createElement('style');
  style.textContent = resetCssText;
  wrap.appendChild(style);

  overlayRoot = createRoot(shell);
  overlayRoot.render(
    <StrictMode>
      <ConfigProvider locale={zhCN}>
        <AntApp
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            flex: 1,
          }}
        >
          <NegativeAppealPanel initialTicketSn={ticketSn} onClose={removeOverlay} />
        </AntApp>
      </ConfigProvider>
    </StrictMode>,
  );
}

const TOAST_ID = 'dtx-negative-appeal-toast';

function showPageToast(text: string, tone: 'info' | 'ok' | 'err' = 'info'): void {
  let el = document.getElementById(TOAST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TOAST_ID;
    el.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:200px',
      'z-index:2147483647',
      'max-width:320px',
      'padding:12px 16px',
      'border-radius:12px',
      'font-size:13px',
      'line-height:1.5',
      'color:#fff',
      'box-shadow:0 6px 20px rgba(15,23,42,.2)',
      'pointer-events:none',
    ].join(';');
    document.documentElement.appendChild(el);
  }
  const bg =
    tone === 'ok' ? '#16a34a' : tone === 'err' ? '#dc2626' : 'rgba(15,23,42,.88)';
  el.style.background = bg;
  el.textContent = text;
}

function makeFloatBtn(
  id: string,
  label: string,
  bottomPx: number,
  gradient: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.textContent = label;
  btn.title = '滇同学·负向反馈申诉';
  btn.style.cssText = [
    'position:fixed',
    'right:24px',
    `bottom:${bottomPx}px`,
    'z-index:2147483646',
    'padding:10px 16px',
    'border:none',
    'border-radius:999px',
    `background:${gradient}`,
    'color:#fff',
    'font-size:14px',
    'font-weight:600',
    'cursor:pointer',
    'box-shadow:0 4px 14px rgba(22,119,255,.35)',
  ].join(';');
  return btn;
}

function formatFailedSteps(
  bad: Array<{ step: string; detail?: string }>,
  maxLen = 180,
): string {
  const text = bad
    .map((b) => `${b.step}${b.detail ? `（${b.detail}）` : ''}`)
    .join('；');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

let autofillRunning = false;

function ensureFloatButton(): void {
  if (!isAppealDetailPage()) return;

  if (!document.getElementById(FLOAT_BTN_ID)) {
    const btn = makeFloatBtn(
      FLOAT_BTN_ID,
      '自动申诉',
      120,
      'linear-gradient(135deg,#1677ff,#0958d9)',
    );
    btn.addEventListener('click', () => {
      isLoggedIn((ok) => {
        if (!ok) {
          window.alert('请先在扩展弹窗登录滇同学账号');
          return;
        }
        openOverlay();
      });
    });
    document.documentElement.appendChild(btn);
  }

  if (!document.getElementById(FLOAT_BTN_AUTOFILL_ID)) {
    const autofillBtn = makeFloatBtn(
      FLOAT_BTN_AUTOFILL_ID,
      '自动填入',
      64,
      'linear-gradient(135deg,#059669,#047857)',
    );
    autofillBtn.addEventListener('click', () => {
      if (autofillRunning) return;
      isLoggedIn((ok) => {
        if (!ok) {
          window.alert('请先在扩展弹窗登录滇同学账号');
          return;
        }
        const ticketSn = parseTicketSnFromUrl();
        if (!ticketSn) {
          window.alert('未识别到工单号，请确认在申诉详情页');
          return;
        }
        autofillRunning = true;
        autofillBtn.disabled = true;
        autofillBtn.style.opacity = '0.75';
        showPageToast('开始自动分析并填入…');
        void runAutoFillAppeal(ticketSn, '', (p) => {
          if (p.phase !== 'error') showPageToast(p.message);
        })
          .then(({ steps }) => {
            console.groupCollapsed('[负向自动填入] 执行结果');
            console.table(
              steps.map((s) => ({
                step: s.step,
                ok: s.ok,
                detail: s.detail ?? '',
              })),
            );
            console.groupEnd();
            const bad = steps.filter((s) => !s.ok);
            if (bad.length === 0) {
              showPageToast('自动填入完成，请核对弹窗后提交', 'ok');
            } else {
              showPageToast(
                `已填入，但以下未成功：${formatFailedSteps(bad)}，请人工核对`,
                'err',
              );
            }
          })
          .catch((e) => {
            showPageToast(e instanceof Error ? e.message : String(e), 'err');
          })
          .finally(() => {
            autofillRunning = false;
            autofillBtn.disabled = false;
            autofillBtn.style.opacity = '1';
          });
      });
    });
    document.documentElement.appendChild(autofillBtn);
  }
}

function boot(): void {
  if (!isAppealDetailPage()) return;
  isModuleEnabled((on) => {
    if (!on) return;
    ensureFloatButton();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

const obs = new MutationObserver(() => {
  if (isAppealDetailPage()) ensureFloatButton();
});
obs.observe(document.documentElement, { childList: true, subtree: true });
