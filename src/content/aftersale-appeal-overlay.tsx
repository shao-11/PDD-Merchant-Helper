/**
 * 售后维权申诉 — 独立 content script（仅售后申诉列表页）
 */
import '../content/install-webrequest-anti-bridge';
import React, { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App as AntApp, ConfigProvider, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import resetCssText from 'antd/dist/reset.css';
import panelCssText from '../aftersale-appeal/aftersale-appeal-panel.css';
import { isSessionValid, type AuthSession } from '../auth/local-auth';
import { STORAGE_AUTH_SESSION } from '../auth/storage-keys';
import { STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED } from '../constants/storage-keys';
import { AftersaleAppealPanel } from '../aftersale-appeal/AftersaleAppealPanel';
import { runAutoFillAftersaleAppeal } from '../aftersale-appeal/auto-fill-flow';
import {
  FLOAT_BTN_AUTOFILL_ID,
  FLOAT_BTN_ID,
  OVERLAY_WRAP_ID,
} from '../aftersale-appeal/constants';
import { isAftersaleAppealListPage } from '../aftersale-appeal/page-context';
import { syncActiveOrderFromModal } from '../aftersale-appeal/order-context';

function isModuleEnabled(cb: (on: boolean) => void): void {
  chrome.storage.local.get([STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED], (raw) => {
    cb(raw[STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED] !== false);
  });
}

function isLoggedIn(cb: (ok: boolean) => void): void {
  chrome.storage.local.get([STORAGE_AUTH_SESSION], (raw) => {
    cb(isSessionValid(raw[STORAGE_AUTH_SESSION] as AuthSession | undefined));
  });
}

let overlayRoot: Root | null = null;
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
  message.destroy();
  overlayRoot?.unmount();
  overlayRoot = null;
  document.getElementById(OVERLAY_WRAP_ID)?.remove();
  unlockBodyScroll();
}

function openOverlay(): void {
  if (document.getElementById(OVERLAY_WRAP_ID)) {
    removeOverlay();
    return;
  }

  const wrap = document.createElement('div');
  wrap.id = OVERLAY_WRAP_ID;
  wrap.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;';

  const card = document.createElement('div');
  card.id = 'dtx-aftersale-appeal-overlay-card';
  card.style.cssText =
    'background:#fff;border-radius:18px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 4px 24px rgba(15,23,42,.12);';

  const shell = document.createElement('div');
  shell.className = 'dtx-asa-overlay-shell';
  card.appendChild(shell);
  wrap.appendChild(card);
  document.documentElement.appendChild(wrap);

  const style = document.createElement('style');
  style.textContent = `${resetCssText}\n${panelCssText}`;
  wrap.appendChild(style);

  lockBodyScroll();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) removeOverlay();
  });

  overlayRoot = createRoot(shell);
  overlayRoot.render(
    <StrictMode>
      <ConfigProvider locale={zhCN}>
        <AntApp style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <AftersaleAppealPanel onClose={removeOverlay} />
        </AntApp>
      </ConfigProvider>
    </StrictMode>,
  );
}

const TOAST_ID = 'dtx-aftersale-appeal-toast';

function showPageToast(text: string, tone: 'info' | 'ok' | 'err' = 'info'): void {
  let el = document.getElementById(TOAST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TOAST_ID;
    el.style.cssText =
      'position:fixed;right:24px;bottom:200px;z-index:2147483647;max-width:320px;padding:12px 16px;border-radius:12px;font-size:13px;color:#fff;pointer-events:none;';
    document.documentElement.appendChild(el);
  }
  el.style.background = tone === 'ok' ? '#16a34a' : tone === 'err' ? '#dc2626' : 'rgba(15,23,42,.88)';
  el.textContent = text;
}

function makeFloatBtn(id: string, label: string, bottomPx: number, gradient: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.textContent = label;
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

function ensureFloatButtons(): void {
  if (!document.getElementById(FLOAT_BTN_ID)) {
    const btn = makeFloatBtn(
      FLOAT_BTN_ID,
      '售后申诉',
      120,
      'linear-gradient(135deg,#1677ff,#0958d9)',
    );
    btn.addEventListener('click', () => {
      isLoggedIn((ok) => {
        if (!ok) {
          window.alert('请先在扩展弹窗登录滇同学账号');
          return;
        }
        syncActiveOrderFromModal();
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
        const ctx = syncActiveOrderFromModal();
        if (!ctx?.orderSn) {
          window.alert('请先在列表点击「发起申诉」打开弹窗，或打开「售后申诉」面板填写订单号');
          return;
        }
        autofillRunning = true;
        autofillBtn.disabled = true;
        showPageToast('开始自动分析并填入…');
        void runAutoFillAftersaleAppeal(ctx.orderSn, ctx.afterSalesId, (p) => {
          if (p.phase !== 'error') showPageToast(p.message);
        })
          .then(({ steps }) => {
            // 便于现场排查上传失败：在控制台完整打印自动填入步骤
            console.groupCollapsed('[售后自动填入] 执行结果');
            console.table(
              steps.map((s) => ({
                step: s.step,
                ok: s.ok,
                detail: s.detail ?? '',
              })),
            );
            console.groupEnd();
            const bad = steps.filter((s) => !s.ok);
            showPageToast(
              bad.length
                ? `部分未完成：${formatFailedSteps(bad)}`
                : '自动填入完成，请核对后提交',
              bad.length ? 'err' : 'ok',
            );
          })
          .catch((e) => {
            showPageToast(e instanceof Error ? e.message : String(e), 'err');
          })
          .finally(() => {
            autofillRunning = false;
            autofillBtn.disabled = false;
          });
      });
    });
    document.documentElement.appendChild(autofillBtn);
  }
}

function boot(): void {
  if (!isAftersaleAppealListPage()) return;
  isModuleEnabled((on) => {
    if (on) ensureFloatButtons();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

const obs = new MutationObserver(() => {
  if (isAftersaleAppealListPage()) {
    isModuleEnabled((on) => {
      if (on) ensureFloatButtons();
    });
  }
});
obs.observe(document.documentElement, { childList: true, subtree: true });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED]) return;
  if (changes[STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED].newValue === false) {
    document.getElementById(FLOAT_BTN_ID)?.remove();
    document.getElementById(FLOAT_BTN_AUTOFILL_ID)?.remove();
    removeOverlay();
  } else if (isAftersaleAppealListPage()) {
    ensureFloatButtons();
  }
});
