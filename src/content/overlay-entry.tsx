/**
 * Content Script 入口（孤立世界）：消息桥接 + 页面内悬浮 React 面板。
 * 不能使用 iframe 加载 chrome-extension 页面：拼多多等站的 CSP 会拦截 frame-src，导致「此页面已被 Chrome 屏蔽」。
 */
import './install-webrequest-anti-bridge';
import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import resetCssText from 'antd/dist/reset.css';
import { ActivityAssistantPanel } from '../activity-assistant/ActivityAssistantPanel';
import { parseGoodsIdsFromActivityPage } from '../activity-assistant/auto-fill-from-page';
import { parseActivityConfirmGoodsIdsFromDom } from '../activity-assistant/parse-activity-page';
import {
  ACTIVITY_MSG_SOURCE,
  ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE,
  ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE_RESULT,
  ACTIVITY_MSG_TYPE_PREPARED_CONSUMED,
  ACTIVITY_MSG_TYPE_WARM_MMS_ANTI,
  SESSION_STORAGE_ACTIVITY_UNCHECK_AFTER_RELOAD,
} from '../activity-assistant/constants';
import {
  installActivityConfirmCheckboxDistAlign,
  runActivityConfirmUncheckProtocolBoxes,
} from '../activity-assistant/uncheck-confirm-page';
import { ReviewsTable } from '../popup/pages/ReviewsTable';
import { isSessionValid, type AuthSession } from '../auth/local-auth';
import { STORAGE_AUTH_SESSION } from '../auth/storage-keys';
import {
  STORAGE_ACTIVITY_ASSIST_ENABLED,
  STORAGE_ACTIVITY_COST_TEMPLATE_ID,
  STORAGE_ACTIVITY_COST_TEMPLATE_NAME,
  STORAGE_ACTIVITY_GOODS_IDS_CSV,
  STORAGE_ACTIVITY_DEBUG_LOGS,
  STORAGE_ACTIVITY_PREPARED_GOODS_FP,
  STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID,
  STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME,
  STORAGE_REVIEWS_AUTO_FETCH_ALL,
  STORAGE_REVIEWS_MODULE_ENABLED,
  STORAGE_REVIEWS_CAPTURE,
  STORAGE_REVIEWS_MAX_FETCH_PAGES,
  STORAGE_REVIEWS_MERGE_PAGES,
  STORAGE_REVIEWS_REQUEST_PAGE_SIZE,
} from '../constants/storage-keys';
import type { ReviewsCaptureState, ReviewsListResponse } from '../types/reviews';
import { mergeReviewRows } from '../utils/merge-review-rows';
import { normalizeReviewsResponse } from './normalize-reviews-response';
import { alertOnce, errorStep, logStep, warnStep } from './logger';

const MSG_SOURCE = 'PDD_REVIEW_ANALYZER';

/** 创建模板：未收到 PREPARE_TEMPLATE_RESULT 时恢复按钮 */
let activityPrepareResultWatchdog = 0;
function clearActivityPrepareResultWatchdog(): void {
  if (activityPrepareResultWatchdog) {
    window.clearTimeout(activityPrepareResultWatchdog);
    activityPrepareResultWatchdog = 0;
  }
}

type ActivityDebugPayload = {
  ts: number;
  level: string;
  message: string;
  detail?: string;
};

/** MAIN 注入脚本 emitActivityDebug → 写入本地，供活动助手面板展示 */
function appendActivityInjectDebugLog(payload: ActivityDebugPayload): void {
  try {
    chrome.storage.local.get(STORAGE_ACTIVITY_DEBUG_LOGS, (r) => {
      if (chrome.runtime.lastError) return;
      const prev = (r[STORAGE_ACTIVITY_DEBUG_LOGS] as ActivityDebugPayload[] | undefined) ?? [];
      const next = [...prev, payload].slice(-200);
      chrome.storage.local.set({ [STORAGE_ACTIVITY_DEBUG_LOGS]: next });
    });
  } catch {
    /* ignore */
  }
}

window.addEventListener('message', (ev: MessageEvent) => {
  /** MAIN 注入脚本发来的 DEBUG_LOG：勿用 source===window，Chrome 下常与 isolated world 的 window 不相等 */
  if (ev.origin !== window.location.origin) return;
  const d = ev.data as { source?: string; type?: string; payload?: ActivityDebugPayload };
  if (d?.source !== ACTIVITY_MSG_SOURCE || d.type !== 'DEBUG_LOG' || !d.payload) return;
  appendActivityInjectDebugLog(d.payload);
});

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.origin !== window.location.origin) return;
  const d = ev.data as {
    source?: string;
    type?: string;
    ok?: boolean;
    error?: string;
    templateId?: number;
    templateName?: string;
    goodsFingerprint?: string;
  };
  if (d?.source !== ACTIVITY_MSG_SOURCE) return;

  if (d.type === ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE_RESULT) {
    clearActivityPrepareResultWatchdog();
    const prepareBtn = getPrepareTemplateButton();
    if (prepareBtn) {
      prepareBtn.disabled = false;
      prepareBtn.textContent = '创建模板';
    }
    if (!d.ok) {
      logStep('activity-prepare', `创建模板失败：${d.error ?? 'unknown'}`);
      alertOnce('activity-prepare-fail', `创建模板失败：${d.error ?? 'unknown'}`);
      return;
    }
    const tid = Math.floor(Number(d.templateId)) || 0;
    const tname = String(d.templateName ?? '');
    const gfp = String(d.goodsFingerprint ?? '');
    chrome.storage.local.set(
      {
        [STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID]: tid,
        [STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME]: tname,
        [STORAGE_ACTIVITY_PREPARED_GOODS_FP]: gfp,
        [STORAGE_ACTIVITY_COST_TEMPLATE_ID]: tid,
        [STORAGE_ACTIVITY_COST_TEMPLATE_NAME]: tname,
      },
      () => {
        if (chrome.runtime.lastError) {
          errorStep('activity-prepare', '写入 storage 失败', chrome.runtime.lastError.message);
          return;
        }
        try {
          sessionStorage.setItem(SESSION_STORAGE_ACTIVITY_UNCHECK_AFTER_RELOAD, '1');
        } catch {
          /* ignore */
        }
        logStep('activity-prepare', '创建模板成功，即将刷新页面', { tid, tname });
        syncActivityAssistantConfig();
        window.location.reload();
      }
    );
    return;
  }

  if (d.type === ACTIVITY_MSG_TYPE_PREPARED_CONSUMED) {
    chrome.storage.local.remove(
      [
        STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID,
        STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME,
        STORAGE_ACTIVITY_PREPARED_GOODS_FP,
      ],
      () => {
        if (!chrome.runtime.lastError) syncActivityAssistantConfig();
      }
    );
  }
});
const STORAGE_KEY = STORAGE_REVIEWS_CAPTURE;
const OVERLAY_WRAP_ID = 'pdd-review-analyzer-overlay';
const ANT_STYLE_ID = 'pdd-review-analyzer-antd-reset';
/** 仅在此路径展示「评价分析」浮动按钮（query 任意） */
const GOODS_EVALUATION_INDEX_PATH = '/goods/evaluation/index';
/** 仅在此路径展示「活动助手」浮动按钮（query 任意） */
const ACT_GOODS_PRICE_CONFIRM_PATH = '/act/goods_price/confirm';
/** 批量报名成功页：同样展示活动助手按钮，便于查看调试日志 */
const ACT_SIGN_SUCCESS_BATCH_PATH = '/act/sign/success_batch';
const FLOAT_BTN_REVIEW_ID = 'pdd-review-analyzer-float-btn';
const FLOAT_WRAP_ACTIVITY_ID = 'pdd-activity-assistant-float-wrap';
const FLOAT_BTN_PREPARE_TEMPLATE_ID = 'pdd-activity-assistant-prepare-btn';
const FLOAT_BTN_ACTIVITY_ID = 'pdd-activity-assistant-float-btn';
const OVERLAY_WRAP_ACTIVITY_ID = 'pdd-activity-assistant-overlay';
/** 确认页底部「确认提交」左侧内联「创建模板」包裹标记 */
const CONFIRM_PREPARE_BTN_WRAP_ATTR = 'data-pdd-activity-assistant-prepare-wrap';
const CONFIRM_PREPARE_INLINE_STYLE_ID = 'pdd-activity-assistant-prepare-inline-style';

let activityConfirmPrepareObserver: MutationObserver | null = null;

/**
 * 活动助手 **CONFIG** 需广播到各 frame 的 MAIN（报名跟单在子 iframe）。
 * **创建模板** 与副本一致：仅对当前 `window` postMessage，由**挂载浮动按钮的同一 frame** 执行，避免多 frame 抢跑与长时间等签。
 */
function broadcastActivityAssistantMainMessage(payload: Record<string, unknown>): void {
  const seen = new Set<Window>();
  const post = (w: Window | null | undefined) => {
    if (!w || seen.has(w)) return;
    seen.add(w);
    try {
      w.postMessage(payload, '*');
    } catch {
      /* ignore */
    }
  };
  post(window);
  try {
    const top = window.top;
    if (top) {
      if (top !== window) post(top);
      for (let i = 0; i < top.length; i++) {
        try {
          post(top[i] as Window);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

let savedBodyOverflow = '';
/** 多层悬浮层时递增，避免提前还原页面滚动 */
let bodyScrollLockDepth = 0;

function lockBodyScroll(): void {
  if (bodyScrollLockDepth === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLockDepth++;
}

function unlockBodyScroll(): void {
  bodyScrollLockDepth = Math.max(0, bodyScrollLockDepth - 1);
  if (bodyScrollLockDepth === 0) {
    document.body.style.overflow = savedBodyOverflow;
  }
}

let reviewOverlayEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
let reviewOverlayReactRoot: Root | null = null;
let activityOverlayEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
let activityOverlayReactRoot: Root | null = null;
/** 活动确认页：与 dist 一致的 XPath 协议纠偏 + MutationObserver；离开页面时卸载 */
let activityCheckboxDistUnmount: (() => void) | null = null;
let historyNavigationPatched = false;

function normalizedPathname(pathname: string): string {
  if (pathname === '/' || pathname === '') return '/';
  return pathname.replace(/\/+$/, '');
}

/**
 * 兼容：pathname 直出、hash 路由（#/act/...）、以及路径出现在 pathname+hash 拼接中的情况。
 * 商家后台部分内容跑在 iframe 内，需配合 manifest `all_frames` 注入。
 */
function urlIndicatesPagePath(pagePath: string): boolean {
  const tail = normalizedPathname(pagePath);
  const needle = tail.startsWith('/') ? tail : `/${tail}`;

  const normSeg = (raw: string): string => normalizedPathname(raw.split('?')[0] ?? '');

  const pathnameHit = (): boolean => {
    const p = normSeg(window.location.pathname);
    return p === tail || p.endsWith(needle);
  };

  if (pathnameHit()) return true;

  const hashRaw = window.location.hash.replace(/^#/, '');
  const hashPathOnly = hashRaw.split('?')[0] ?? '';
  if (hashPathOnly) {
    const hp = normSeg(hashPathOnly);
    if (hp === tail || hp.endsWith(needle)) return true;
  }

  return `${window.location.pathname}${window.location.hash}`.includes(needle);
}

function isGoodsEvaluationIndexPage(): boolean {
  return urlIndicatesPagePath(GOODS_EVALUATION_INDEX_PATH);
}

function isActGoodsPriceConfirmPage(): boolean {
  return urlIndicatesPagePath(ACT_GOODS_PRICE_CONFIRM_PATH);
}

function isActSignSuccessBatchPage(): boolean {
  return urlIndicatesPagePath(ACT_SIGN_SUCCESS_BATCH_PATH);
}

/** 活动价确认页或批量报名成功页：显示浮动工具栏、可打开面板看日志 */
function isActivityAssistantToolbarPage(): boolean {
  return isActGoodsPriceConfirmPage() || isActSignSuccessBatchPage();
}

function removeReviewFloatingButton(): void {
  document.getElementById(FLOAT_BTN_REVIEW_ID)?.remove();
}

function getPrepareTemplateButton(): HTMLButtonElement | null {
  return document.getElementById(FLOAT_BTN_PREPARE_TEMPLATE_ID) as HTMLButtonElement | null;
}

function bindPrepareTemplateClick(prepareBtn: HTMLButtonElement): void {
  prepareBtn.addEventListener('click', () => {
    logStep('button-activity-prepare', '点击创建模板按钮');
    chrome.storage.local.get(
      [STORAGE_ACTIVITY_ASSIST_ENABLED, STORAGE_ACTIVITY_GOODS_IDS_CSV],
      (r) => {
        if (chrome.runtime.lastError) {
          alertOnce('prepare-storage', `读取配置失败：${chrome.runtime.lastError.message}`);
          return;
        }
        if (r[STORAGE_ACTIVITY_ASSIST_ENABLED] === false) {
          alertOnce('prepare-off', '请先启用活动助手（打开面板打开开关并保存到本地）。');
          return;
        }
        const fromStorage = String(r[STORAGE_ACTIVITY_GOODS_IDS_CSV] ?? '').trim();
        const fromDomCsv = parseActivityConfirmGoodsIdsFromDom(document).join(',');
        const mergedCsv = fromStorage || fromDomCsv;
        if (!mergedCsv) {
          alertOnce(
            'prepare-csv',
            '未找到商品 ID：请在活动助手面板填写并保存，或确认本页表格能显示「商品 ID」后再点创建模板。'
          );
          return;
        }
        prepareBtn.disabled = true;
        prepareBtn.textContent = '创建中…';
        clearActivityPrepareResultWatchdog();
        activityPrepareResultWatchdog = window.setTimeout(() => {
          activityPrepareResultWatchdog = 0;
          const b = getPrepareTemplateButton();
          if (b && b.disabled && b.textContent === '创建中…') {
            warnStep(
              'activity-prepare',
              '35s 内未收到创建结果：请重新加载扩展并刷新页面。若活动页在子框架内，需 activity-inject 注入到该 frame（manifest 已改为 all_frames）。'
            );
            b.disabled = false;
            b.textContent = '创建模板';
          }
        }, 35000);
        window.postMessage(
          {
            source: ACTIVITY_MSG_SOURCE,
            type: ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE,
            goodsIdsCsvForPrepare: mergedCsv,
          },
          '*'
        );
      }
    );
  });
}

function createPrepareTemplateButton(): HTMLButtonElement {
  const prepareBtn = document.createElement('button');
  prepareBtn.id = FLOAT_BTN_PREPARE_TEMPLATE_ID;
  prepareBtn.type = 'button';
  prepareBtn.textContent = '创建模板';
  prepareBtn.title =
    '按活动页抓包调用 cost_template/create 并 batch 换绑；确认报名后由助手在 enrollV2 检测后 300~500ms 内随机时刻发起 updateV2（先 upsert）';
  prepareBtn.setAttribute('aria-label', '创建模板换绑并刷新');
  bindPrepareTemplateClick(prepareBtn);
  return prepareBtn;
}

/** 活动价确认页底部「确认提交」按钮，用于在其左侧插入「创建模板」 */
function findActivityConfirmSubmitAnchor(): HTMLElement | null {
  const precise = Array.from(
    document.querySelectorAll(
      'button[data-tracking-click-viewid="submit_shared"][data-testid="beast-core-button"]'
    )
  );
  for (const btn of precise) {
    if (!(btn instanceof HTMLElement)) continue;
    if (String(btn.textContent || '').includes('确认提交')) return btn;
  }
  const list = Array.from(document.querySelectorAll('button[data-tracking-click-viewid="submit_shared"]'));
  for (const btn of list) {
    if (!(btn instanceof HTMLElement)) continue;
    if (String(btn.textContent || '').includes('确认提交')) return btn;
  }
  return null;
}

function injectActivityConfirmPrepareButtonStyles(): void {
  if (document.getElementById(CONFIRM_PREPARE_INLINE_STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = CONFIRM_PREPARE_INLINE_STYLE_ID;
  tag.textContent = `
    [${CONFIRM_PREPARE_BTN_WRAP_ATTR}="1"] {
      display: inline-flex;
      align-items: flex-start;
      vertical-align: top;
      margin-right: 10px;
    }
    [${CONFIRM_PREPARE_BTN_WRAP_ATTR}="1"] button {
      box-sizing: border-box;
      border: 1px solid #1677ff;
      border-radius: 8px;
      margin-top: 6px;
      width: auto;
      min-width: 120px;
      height: 40px;
      padding: 0 14px;
      font-size: 16px;
      font-weight: 500;
      line-height: 38px;
      white-space: nowrap;
      text-align: center;
      cursor: pointer;
      background: #fff;
      color: #1677ff;
    }
    [${CONFIRM_PREPARE_BTN_WRAP_ATTR}="1"] button:hover {
      background: #f0f7ff;
    }
    [${CONFIRM_PREPARE_BTN_WRAP_ATTR}="1"] button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
  `;
  document.documentElement.appendChild(tag);
}

function ensureActivityConfirmPrepareButton(): void {
  if (!isActGoodsPriceConfirmPage()) return;
  const targetBtn = findActivityConfirmSubmitAnchor();
  if (!(targetBtn instanceof HTMLElement) || !targetBtn.parentElement) {
    removeActivityConfirmPrepareButton();
    return;
  }
  injectActivityConfirmPrepareButtonStyles();
  const parent = targetBtn.parentElement;
  let wrap = document.querySelector(`[${CONFIRM_PREPARE_BTN_WRAP_ATTR}="1"]`);
  if (wrap && (wrap.parentElement !== parent || targetBtn.previousElementSibling !== wrap)) {
    wrap.remove();
    wrap = null;
  }
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.setAttribute(CONFIRM_PREPARE_BTN_WRAP_ATTR, '1');
    const prepareBtn = createPrepareTemplateButton();
    wrap.appendChild(prepareBtn);
    parent.insertBefore(wrap, targetBtn);
  }
}

function removeActivityConfirmPrepareButton(): void {
  document.querySelector(`[${CONFIRM_PREPARE_BTN_WRAP_ATTR}="1"]`)?.remove();
}

function stopActivityConfirmPrepareObserver(): void {
  activityConfirmPrepareObserver?.disconnect();
  activityConfirmPrepareObserver = null;
}

function startActivityConfirmPrepareObserver(): void {
  if (activityConfirmPrepareObserver) return;
  activityConfirmPrepareObserver = new MutationObserver(() => {
    if (!isActGoodsPriceConfirmPage()) return;
    ensureActivityConfirmPrepareButton();
  });
  activityConfirmPrepareObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function syncActivityFloatPrepareButton(): void {
  const wrap = document.getElementById(FLOAT_WRAP_ACTIVITY_ID);
  if (!wrap) return;
  const existingPrepare = document.getElementById(FLOAT_BTN_PREPARE_TEMPLATE_ID);
  const inFloat = existingPrepare?.parentElement === wrap;
  const showInFloat = !isActGoodsPriceConfirmPage();

  if (showInFloat && !inFloat) {
    const prepareBtn = createPrepareTemplateButton();
    const activityBtn = document.getElementById(FLOAT_BTN_ACTIVITY_ID);
    if (activityBtn) wrap.insertBefore(prepareBtn, activityBtn);
    else wrap.appendChild(prepareBtn);
    prepareBtn.style.cssText = [
      'padding:10px 14px',
      'border-radius:8px',
      'cursor:pointer',
      'font-size:14px',
      'box-shadow:0 4px 12px rgba(0,0,0,.15)',
      'border:1px solid #1677ff',
      'background:#fff',
      'color:#1677ff',
      'font-weight:500',
    ].join(';');
  } else if (!showInFloat && inFloat) {
    existingPrepare?.remove();
  }
}

function removeActivityFloatingButton(): void {
  stopActivityConfirmPrepareObserver();
  removeActivityConfirmPrepareButton();
  document.getElementById(FLOAT_WRAP_ACTIVITY_ID)?.remove();
  document.getElementById(FLOAT_BTN_ACTIVITY_ID)?.remove();
  const prepare = document.getElementById(FLOAT_BTN_PREPARE_TEMPLATE_ID);
  if (prepare?.parentElement?.id === FLOAT_WRAP_ACTIVITY_ID) prepare.remove();
}

/** 监听商家后台 SPA 切换路由，离开对应页时收起按钮与悬浮层 */
function patchHistoryNavigationForFloatingButtons(): void {
  if (historyNavigationPatched) return;
  historyNavigationPatched = true;

  const scheduleSync = (): void => {
    queueMicrotask(() => applyFloatingButtonVisibility());
  };

  const wrap = (name: 'pushState' | 'replaceState'): void => {
    const original = history[name].bind(history) as (...args: Parameters<History[typeof name]>) => void;
    history[name] = ((...args: Parameters<History[typeof name]>) => {
      original(...args);
      scheduleSync();
    }) as History[typeof name];
  };

  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', scheduleSync);
  window.addEventListener('hashchange', scheduleSync);
}

function injectAntdResetOnce(): void {
  if (document.getElementById(ANT_STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = ANT_STYLE_ID;
  tag.textContent = resetCssText;
  document.head.appendChild(tag);
  logStep('boot', '已注入 Ant Design reset 样式（一次性）');
}

class OverlayErrorBoundary extends Component<
  { children: React.ReactNode; toolLabel?: string },
  { err: Error | null }
> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    errorStep('react', '界面渲染异常（ErrorBoundary）', { err, info: info.componentStack });
  }

  render(): React.ReactNode {
    if (this.state.err) {
      const label = this.props.toolLabel ?? '评价分析';
      return (
        <div style={{ padding: 24 }}>
          <p style={{ fontWeight: 600 }}>{label}界面加载失败</p>
          <p style={{ color: '#cf1322', fontSize: 13 }}>{String(this.state.err.message)}</p>
          <p style={{ fontSize: 12, color: '#666', marginTop: 12 }}>
            请打开扩展「错误」日志，并搜索前缀 [评价分析]。扩展更新后请刷新本页面。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

type PendingCapture = { payload: ReviewsListResponse; capturedAt: number; httpStatus?: number };

/** 多次 REVIEWS_RESPONSE 几乎同时到达时，异步 get/set 会交错，错误包可能在「合并写入」之前读到旧 prev，从而把 rows 写成 0 —— 必须串行写存储 */
const captureSaveQueue: PendingCapture[] = [];
let captureSaveBusy = false;

function flushCaptureSaveQueue(): void {
  if (captureSaveBusy || captureSaveQueue.length === 0) return;
  captureSaveBusy = true;
  const job = captureSaveQueue.shift()!;
  try {
    if (!chrome.runtime?.id) {
      warnStep('storage', '跳过保存：chrome.runtime.id 不存在（扩展上下文可能已失效）');
      captureSaveBusy = false;
      flushCaptureSaveQueue();
      return;
    }
    void chrome.storage.local.get([STORAGE_KEY, STORAGE_REVIEWS_MERGE_PAGES], (raw) => {
      if (chrome.runtime.lastError) {
        errorStep('storage', '读取旧缓存失败', chrome.runtime.lastError.message);
        captureSaveBusy = false;
        flushCaptureSaveQueue();
        return;
      }
      const mergeEnabled = raw[STORAGE_REVIEWS_MERGE_PAGES] !== false;
      const prev = raw[STORAGE_KEY] as ReviewsCaptureState | undefined;
      let finalPayload = job.payload;

      if (
        mergeEnabled &&
        prev?.payload &&
        !job.payload._error &&
        (job.payload.data?.length ?? 0) > 0
      ) {
        const merged = mergeReviewRows(prev.payload.data, job.payload.data ?? []);
        finalPayload = { ...job.payload, data: merged };
        logStep('storage', '翻页累积合并', {
          prevRows: prev.payload.data?.length ?? 0,
          incomingRows: job.payload.data?.length ?? 0,
          mergedRows: merged.length,
        });
      }

      if (
        mergeEnabled &&
        (finalPayload.data?.length ?? 0) === 0 &&
        prev?.payload?.data &&
        prev.payload.data.length > 0
      ) {
        const errHint = finalPayload._error;
        finalPayload = {
          ...prev.payload,
          data: prev.payload.data,
          ...(errHint ? { _error: errHint } : {}),
        };
        logStep('storage', '保留已有累积数据（本次响应无有效列表）', {
          keptRows: prev.payload.data.length,
          ...(errHint ? { lastError: errHint } : {}),
        });
      }

      const finishSet = (payloadToStore: ReviewsListResponse): void => {
        try {
          const state = JSON.parse(
            JSON.stringify({
              payload: payloadToStore,
              capturedAt: job.capturedAt,
              httpStatus: job.httpStatus,
            } satisfies ReviewsCaptureState)
          ) as ReviewsCaptureState;
          void chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
            if (chrome.runtime.lastError) {
              errorStep('storage', '写入 chrome.storage.local 失败', chrome.runtime.lastError.message);
            } else {
              logStep('storage', '已写入本地缓存 reviewsCapture', {
                capturedAt: job.capturedAt,
                rows: state.payload?.data?.length ?? 0,
                httpStatus: job.httpStatus,
              });
            }
            captureSaveBusy = false;
            flushCaptureSaveQueue();
          });
        } catch (e) {
          errorStep('storage', '序列化或保存异常', e);
          captureSaveBusy = false;
          flushCaptureSaveQueue();
        }
      };

      /** 写入前再读一次存储：同一队列内连续 job 时，极少数环境下首次 get 的 prev 仍落后于上一笔 set */
      if (mergeEnabled && (finalPayload.data?.length ?? 0) === 0) {
        void chrome.storage.local.get(STORAGE_KEY, (snapRaw) => {
          let toWrite = finalPayload;
          if (chrome.runtime.lastError) {
            finishSet(toWrite);
            return;
          }
          const snap = snapRaw[STORAGE_KEY] as ReviewsCaptureState | undefined;
          const snapLen = snap?.payload?.data?.length ?? 0;
          if (snapLen > 0) {
            toWrite = {
              ...snap!.payload,
              data: snap!.payload.data,
              ...(finalPayload._error ? { _error: finalPayload._error } : {}),
            };
            logStep('storage', '写入前二次读取：用存储中的有效行避免写成 0 行', { snapLen });
          }
          finishSet(toWrite);
        });
        return;
      }

      finishSet(finalPayload);
    });
  } catch (e) {
    errorStep('storage', '序列化或保存异常', e);
    captureSaveBusy = false;
    flushCaptureSaveQueue();
  }
}

function saveCapture(payload: ReviewsListResponse, capturedAt: number, httpStatus?: number): void {
  try {
    if (!chrome.runtime?.id) {
      warnStep('storage', '跳过保存：chrome.runtime.id 不存在（扩展上下文可能已失效）');
      return;
    }
    captureSaveQueue.push({ payload, capturedAt, httpStatus });
    flushCaptureSaveQueue();
  } catch (e) {
    errorStep('storage', '入队保存异常', e);
  }
}

function parsePayload(data: Record<string, unknown>): ReviewsListResponse {
  const rawJson = data.payloadJson;
  if (typeof rawJson === 'string' && rawJson.length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      logStep('hook-msg', '已解析 payloadJson', { bytes: rawJson.length });
      return normalizeReviewsResponse(parsed, (msg, detail) => logStep('hook-msg', msg, detail));
    } catch (e) {
      errorStep('hook-msg', 'JSON.parse(payloadJson) 失败', e);
      return { _error: '解析 payloadJson 失败', data: [] };
    }
  }
  const legacy = data.payload;
  if (legacy && typeof legacy === 'object') {
    logStep('hook-msg', '使用兼容字段 payload（对象）');
    return normalizeReviewsResponse(legacy, (msg, detail) => logStep('hook-msg', msg, detail));
  }
  warnStep('hook-msg', '无有效 payload/payloadJson');
  return {};
}

function handlePageMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin) return;
  const data = event.data as Record<string, unknown>;
  if (!data || data.source !== MSG_SOURCE) return;

  if (data.type === 'REVIEWS_RESPONSE') {
    logStep('hook-msg', '收到 REVIEWS_RESPONSE');
    const capturedAt = Date.now();
    const payload = parsePayload(data);
    const pj = data.payloadJson;
    if (
      (payload.data?.length ?? 0) === 0 &&
      typeof pj === 'string' &&
      pj.length > 400 &&
      !payload._error
    ) {
      try {
        const peek = JSON.parse(pj) as unknown;
        logStep('hook-msg', 'normalize 后仍为 0 行，排查：顶层键', {
          keys: peek && typeof peek === 'object' ? Object.keys(peek as object).slice(0, 45) : [],
          payloadBytes: pj.length,
        });
      } catch {
        /* ignore */
      }
    }
    saveCapture(payload, capturedAt, data.httpStatus as number | undefined);
    return;
  }

  if (data.type === 'REVIEWS_ERROR') {
    warnStep('hook-msg', '收到 REVIEWS_ERROR', data.message);
    const capturedAt = Date.now();
    saveCapture(
      { _error: (data.message as string) ?? '未知错误', data: [] },
      capturedAt,
      data.httpStatus as number | undefined
    );
  }
}

function removeReviewOverlay(): void {
  const existed = Boolean(document.getElementById(OVERLAY_WRAP_ID) || reviewOverlayReactRoot);
  logStep('overlay', '关闭悬浮层');
  try {
    reviewOverlayReactRoot?.unmount();
  } catch (e) {
    warnStep('overlay', 'unmount React 根时异常（可忽略）', e);
  }
  reviewOverlayReactRoot = null;
  document.getElementById(OVERLAY_WRAP_ID)?.remove();
  if (reviewOverlayEscapeHandler) {
    document.removeEventListener('keydown', reviewOverlayEscapeHandler);
    reviewOverlayEscapeHandler = null;
  }
  if (existed) unlockBodyScroll();
}

function removeActivityOverlay(): void {
  const existed = Boolean(document.getElementById(OVERLAY_WRAP_ACTIVITY_ID) || activityOverlayReactRoot);
  logStep('overlay-activity', '关闭活动助手悬浮层');
  try {
    activityOverlayReactRoot?.unmount();
  } catch (e) {
    warnStep('overlay-activity', 'unmount React 根时异常（可忽略）', e);
  }
  activityOverlayReactRoot = null;
  document.getElementById(OVERLAY_WRAP_ACTIVITY_ID)?.remove();
  if (activityOverlayEscapeHandler) {
    document.removeEventListener('keydown', activityOverlayEscapeHandler);
    activityOverlayEscapeHandler = null;
  }
  if (existed) unlockBodyScroll();
}

function openReviewOverlay(): void {
  if (!isGoodsEvaluationIndexPage()) {
    warnStep('overlay', '当前不是商品评价管理页，已取消打开悬浮层');
    return;
  }

  if (!chrome.runtime?.id) {
    errorStep('overlay', '扩展上下文无效');
    alertOnce(
      'ctx',
      '扩展上下文无效（常见于扩展刚「重新加载」后）。\n请先刷新本页面（F5 或 Ctrl+R），再点「评价分析」。'
    );
    return;
  }

  if (document.getElementById(OVERLAY_WRAP_ID)) {
    removeReviewOverlay();
    return;
  }

  logStep('overlay', '打开悬浮层（同页 React 挂载，非 iframe）');

  try {
    injectAntdResetOnce();

    const wrap = document.createElement('div');
    wrap.id = OVERLAY_WRAP_ID;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', '评价分析');
    wrap.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483646',
      'background:rgba(15,23,42,.45)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:12px',
      'box-sizing:border-box',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(1100px,calc(100vw - 24px))',
      'height:min(780px,calc(100vh - 24px))',
      'max-height:calc(100vh - 24px)',
      'background:#fff',
      'border-radius:12px',
      'overflow:hidden',
      'display:flex',
      'flex-direction:column',
      'box-shadow:0 16px 48px rgba(0,0,0,.25)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText =
      'flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #f0f0f0;background:#fafafa;';
    const title = document.createElement('span');
    title.textContent = '评价分析 · 对照查看（同页悬浮）';
    title.style.cssText = 'font-weight:600;font-size:15px;color:#1f1f1f';
    const headerBtns = document.createElement('div');
    headerBtns.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const hint = document.createElement('span');
    hint.textContent = '打开后按所选时间范围自动拉取';
    hint.style.cssText = 'font-size:12px;color:#8c8c8c;margin-right:8px;display:none';
    if (window.matchMedia('(min-width:640px)').matches) {
      hint.style.display = 'inline';
    }
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText =
      'cursor:pointer;padding:4px 14px;border-radius:6px;border:1px solid #d9d9d9;background:#fff;font-size:14px;';
    closeBtn.addEventListener('click', removeReviewOverlay);

    headerBtns.appendChild(hint);
    headerBtns.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(headerBtns);

    const reactMount = document.createElement('div');
    reactMount.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';

    panel.appendChild(header);
    panel.appendChild(reactMount);
    wrap.appendChild(panel);

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) removeReviewOverlay();
    });

    lockBodyScroll();

    reviewOverlayEscapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') removeReviewOverlay();
    };
    document.addEventListener('keydown', reviewOverlayEscapeHandler);

    document.body.appendChild(wrap);

    reviewOverlayReactRoot = createRoot(reactMount);
    reviewOverlayReactRoot.render(
      <StrictMode>
        <ConfigProvider locale={zhCN}>
          <AntApp style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <OverlayErrorBoundary>
                <ReviewsTable compact={false} embedded />
              </OverlayErrorBoundary>
            </div>
          </AntApp>
        </ConfigProvider>
      </StrictMode>
    );
    logStep('react', 'React 根已 render（ReviewsTable embedded）');
  } catch (e) {
    errorStep('react', '创建悬浮层失败', e);
    alertOnce('overlay-fail', `悬浮面板加载失败。\n\n${String(e)}\n\n请查看控制台 [评价分析] 前缀日志。`);
    removeReviewOverlay();
  }
}

function openActivityOverlay(): void {
  if (!isActivityAssistantToolbarPage()) {
    warnStep('overlay-activity', '当前不是活动助手支持页，已取消打开悬浮层');
    return;
  }

  if (!chrome.runtime?.id) {
    errorStep('overlay-activity', '扩展上下文无效');
    alertOnce(
      'ctx-activity',
      '扩展上下文无效（常见于扩展刚「重新加载」后）。\n请先刷新本页面（F5 或 Ctrl+R），再点「活动助手」。'
    );
    return;
  }

  if (document.getElementById(OVERLAY_WRAP_ACTIVITY_ID)) {
    removeActivityOverlay();
    return;
  }

  logStep('overlay-activity', '打开活动助手悬浮层');

  try {
    injectAntdResetOnce();

    const wrap = document.createElement('div');
    wrap.id = OVERLAY_WRAP_ACTIVITY_ID;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', '活动助手');
    wrap.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483646',
      'background:rgba(15,23,42,.45)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:12px',
      'box-sizing:border-box',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(860px,calc(100vw - 24px))',
      'height:min(640px,calc(100vh - 24px))',
      'max-height:calc(100vh - 24px)',
      'background:#fff',
      'border-radius:12px',
      'overflow:hidden',
      'display:flex',
      'flex-direction:column',
      'box-shadow:0 16px 48px rgba(0,0,0,.25)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText =
      'flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #f0f0f0;background:#fafafa;';
    const title = document.createElement('span');
    title.textContent = '活动助手';
    title.style.cssText = 'font-weight:600;font-size:15px;color:#1f1f1f';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText =
      'cursor:pointer;padding:4px 14px;border-radius:6px;border:1px solid #d9d9d9;background:#fff;font-size:14px;';
    closeBtn.addEventListener('click', removeActivityOverlay);

    header.appendChild(title);
    header.appendChild(closeBtn);

    const reactMount = document.createElement('div');
    reactMount.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto';

    panel.appendChild(header);
    panel.appendChild(reactMount);
    wrap.appendChild(panel);

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) removeActivityOverlay();
    });

    lockBodyScroll();

    activityOverlayEscapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') removeActivityOverlay();
    };
    document.addEventListener('keydown', activityOverlayEscapeHandler);

    document.body.appendChild(wrap);

    activityOverlayReactRoot = createRoot(reactMount);
    activityOverlayReactRoot.render(
      <StrictMode>
        <ConfigProvider locale={zhCN}>
          <AntApp style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <OverlayErrorBoundary toolLabel="活动助手">
                <ActivityAssistantPanel />
              </OverlayErrorBoundary>
            </div>
          </AntApp>
        </ConfigProvider>
      </StrictMode>
    );
    logStep('react', 'React 根已 render（ActivityAssistantPanel）');
  } catch (e) {
    errorStep('react', '创建活动助手悬浮层失败', e);
    alertOnce('overlay-activity-fail', `活动助手面板加载失败。\n\n${String(e)}\n\n请查看控制台 [评价分析] 前缀日志。`);
    removeActivityOverlay();
  }
}

function mountReviewFloatingButton(): void {
  if (document.getElementById(FLOAT_BTN_REVIEW_ID)) return;

  const btn = document.createElement('button');
  btn.id = FLOAT_BTN_REVIEW_ID;
  btn.type = 'button';
  btn.textContent = '评价分析';
  btn.title = '在本页打开悬浮分析面板（与拼多多列表对照）';
  btn.setAttribute('aria-label', '打开评价分析悬浮面板');
  btn.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:2147483647',
    'padding:10px 16px',
    'border-radius:8px',
    'border:none',
    'background:#1677ff',
    'color:#fff',
    'cursor:pointer',
    'font-size:14px',
    'font-family:system-ui,-apple-system,sans-serif',
    'box-shadow:0 4px 12px rgba(0,0,0,.15)',
  ].join(';');

  btn.addEventListener('click', () => {
    logStep('button', '点击浮动按钮');
    try {
      openReviewOverlay();
    } catch (e) {
      errorStep('button', 'openReviewOverlay 异常', e);
      try {
        logStep('panel-fallback', '尝试通知后台打开独立标签 panel.html');
        void chrome.runtime.sendMessage({ type: 'OPEN_PANEL' });
      } catch (e2) {
        errorStep('panel-fallback', 'OPEN_PANEL 也失败，请刷新页面后重试', e2);
        alertOnce('fallback-fail', '无法打开分析界面。\n请刷新拼多多商家后台页面，并在 chrome://extensions 中重新加载本扩展。');
      }
    }
  });

  document.body.appendChild(btn);
  logStep('button', '已挂载右下角「评价分析」按钮');
}

function mountActivityFloatingButton(): void {
  const baseBtnStyle = [
    'padding:10px 14px',
    'border-radius:8px',
    'cursor:pointer',
    'font-size:14px',
    'box-shadow:0 4px 12px rgba(0,0,0,.15)',
  ].join(';');

  const existingWrap = document.getElementById(FLOAT_WRAP_ACTIVITY_ID);
  if (existingWrap) {
    syncActivityFloatPrepareButton();
    if (isActGoodsPriceConfirmPage()) ensureActivityConfirmPrepareButton();
    return;
  }

  const wrap = document.createElement('div');
  wrap.id = FLOAT_WRAP_ACTIVITY_ID;
  wrap.setAttribute('role', 'toolbar');
  wrap.setAttribute('aria-label', '活动助手工具栏');
  wrap.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:2147483647',
    'display:flex',
    'flex-direction:row',
    'align-items:center',
    'gap:10px',
    'font-family:system-ui,-apple-system,sans-serif',
  ].join(';');

  if (!isActGoodsPriceConfirmPage()) {
    const prepareBtn = createPrepareTemplateButton();
    prepareBtn.style.cssText = `${baseBtnStyle};border:1px solid #1677ff;background:#fff;color:#1677ff;font-weight:500;`;
    wrap.appendChild(prepareBtn);
  }

  const btn = document.createElement('button');
  btn.id = FLOAT_BTN_ACTIVITY_ID;
  btn.type = 'button';
  btn.textContent = '活动助手';
  btn.title = '在本页打开活动助手面板';
  btn.setAttribute('aria-label', '打开活动助手悬浮面板');
  btn.style.cssText = `${baseBtnStyle};border:none;background:#1677ff;color:#fff;`;

  btn.addEventListener('click', () => {
    logStep('button-activity', '点击活动助手浮动按钮');
    try {
      openActivityOverlay();
    } catch (e) {
      errorStep('button-activity', 'openActivityOverlay 异常', e);
      alertOnce('activity-fail', '无法打开活动助手面板，请刷新页面后重试。');
    }
  });

  wrap.appendChild(btn);
  document.body.appendChild(wrap);
  if (isActGoodsPriceConfirmPage()) ensureActivityConfirmPrepareButton();
  logStep('button-activity', '已挂载活动助手浮动按钮组');
}

function ensureReviewFloatingButton(): void {
  if (!isGoodsEvaluationIndexPage()) return;
  if (document.body) {
    mountReviewFloatingButton();
    return;
  }
  const obs = new MutationObserver(() => {
    if (document.body) {
      obs.disconnect();
      if (isGoodsEvaluationIndexPage()) mountReviewFloatingButton();
    }
  });
  obs.observe(document.documentElement, { childList: true });
}

/** 进入活动确认页后由 MAIN 轻触列表/刷新，与 `pdd-page-anti-hook` / webRequest 一起提前灌签 */
let activityAntiWarmOnceTimer: number | undefined;
function scheduleActivityPageAntiWarm(): void {
  if (!isActGoodsPriceConfirmPage()) return;
  if (activityAntiWarmOnceTimer !== undefined) return;
  const send = (): void => {
    try {
      window.postMessage(
        { source: ACTIVITY_MSG_SOURCE, type: ACTIVITY_MSG_TYPE_WARM_MMS_ANTI },
        '*'
      );
    } catch {
      /* ignore */
    }
  };
  activityAntiWarmOnceTimer = window.setTimeout(() => {
    activityAntiWarmOnceTimer = undefined;
    send();
    window.setTimeout(send, 2600);
  }, 500) as unknown as number;
}

function ensureActivityFloatingButton(): void {
  if (!isActivityAssistantToolbarPage()) return;
  if (document.body) {
    mountActivityFloatingButton();
    scheduleActivityPageAntiWarm();
    return;
  }
  const obs = new MutationObserver(() => {
    if (document.body) {
      obs.disconnect();
      if (isActivityAssistantToolbarPage()) {
        mountActivityFloatingButton();
        scheduleActivityPageAntiWarm();
      }
    }
  });
  obs.observe(document.documentElement, { childList: true });
}

function scheduleActivityConfirmUncheckAfterReload(): void {
  if (!isActGoodsPriceConfirmPage()) return;
  let flag = '';
  try {
    flag = sessionStorage.getItem(SESSION_STORAGE_ACTIVITY_UNCHECK_AFTER_RELOAD) ?? '';
  } catch {
    return;
  }
  if (flag !== '1') return;

  const runAttempt = (delayMs: number, label: string): void => {
    window.setTimeout(() => {
      try {
        if (sessionStorage.getItem(SESSION_STORAGE_ACTIVITY_UNCHECK_AFTER_RELOAD) !== '1') return;
        const n = runActivityConfirmUncheckProtocolBoxes();
        logStep('activity-uncheck', `${label} 尝试取消勾选`, { approxToggled: n });
        if (n >= 2) sessionStorage.removeItem(SESSION_STORAGE_ACTIVITY_UNCHECK_AFTER_RELOAD);
      } catch (e) {
        warnStep('activity-uncheck', '取消勾选异常', e);
      }
    }, delayMs);
  };

  runAttempt(0, 't0');
  runAttempt(800, 't800');
  runAttempt(2000, 't2000');
  runAttempt(4000, 't4000');
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_ACTIVITY_UNCHECK_AFTER_RELOAD);
    } catch {
      /* ignore */
    }
  }, 12000);
}

/** 未登录或会话过期：收起商家后台全部悬浮入口（与模块开关关闭时一致） */
function hideAllFloatingToolUi(): void {
  removeReviewFloatingButton();
  removeReviewOverlay();
  if (activityAntiWarmOnceTimer !== undefined) {
    window.clearTimeout(activityAntiWarmOnceTimer);
    activityAntiWarmOnceTimer = undefined;
  }
  activityCheckboxDistUnmount?.();
  activityCheckboxDistUnmount = null;
  stopActivityConfirmPrepareObserver();
  removeActivityConfirmPrepareButton();
  removeActivityFloatingButton();
  removeActivityOverlay();
}

function applyFloatingButtonVisibility(): void {
  chrome.storage.local.get(
    [STORAGE_AUTH_SESSION, STORAGE_REVIEWS_MODULE_ENABLED, STORAGE_ACTIVITY_ASSIST_ENABLED],
    (raw) => {
      if (chrome.runtime.lastError) return;
      const session = raw[STORAGE_AUTH_SESSION] as AuthSession | undefined;
      if (!isSessionValid(session)) {
        hideAllFloatingToolUi();
        return;
      }
      const reviewsModuleOn = raw[STORAGE_REVIEWS_MODULE_ENABLED] !== false;
      const activityModuleOn = raw[STORAGE_ACTIVITY_ASSIST_ENABLED] !== false;

      if (!isGoodsEvaluationIndexPage() || !reviewsModuleOn) {
        removeReviewFloatingButton();
        removeReviewOverlay();
      } else {
        ensureReviewFloatingButton();
      }

      if (!isActivityAssistantToolbarPage() || !activityModuleOn) {
        if (activityAntiWarmOnceTimer !== undefined) {
          window.clearTimeout(activityAntiWarmOnceTimer);
          activityAntiWarmOnceTimer = undefined;
        }
        activityCheckboxDistUnmount?.();
        activityCheckboxDistUnmount = null;
        removeActivityFloatingButton();
        removeActivityOverlay();
      } else {
        if (isActGoodsPriceConfirmPage()) {
          if (!activityCheckboxDistUnmount) {
            activityCheckboxDistUnmount = installActivityConfirmCheckboxDistAlign();
          }
          ensureActivityConfirmPrepareButton();
          startActivityConfirmPrepareObserver();
        } else {
          activityCheckboxDistUnmount?.();
          activityCheckboxDistUnmount = null;
          stopActivityConfirmPrepareObserver();
          removeActivityConfirmPrepareButton();
        }
        ensureActivityFloatingButton();
        maybeAutoFillActivityAssistantFromPage();
        scheduleActivityConfirmUncheckAfterReload();
      }
    }
  );
}

/** 从当前活动确认页写入「报名商品 ID」：空白则填；确认页上与 DOM 不一致则**覆盖**（避免 session/旧 storage 残留）。 */
function maybeAutoFillActivityAssistantFromPage(): void {
  try {
    if (!isActivityAssistantToolbarPage()) return;
    const href = window.location.href;
    const goodsFromPage = parseGoodsIdsFromActivityPage(href);
    if (goodsFromPage.length === 0) return;
    const pageDigits = String(goodsFromPage[0]).replace(/\D/g, '');
    if (!pageDigits) return;
    const onConfirm = isActGoodsPriceConfirmPage();

    chrome.storage.local.get([STORAGE_ACTIVITY_GOODS_IDS_CSV], (r) => {
      if (chrome.runtime.lastError) return;
      const curDigits = String(r[STORAGE_ACTIVITY_GOODS_IDS_CSV] ?? '')
        .trim()
        .replace(/\D/g, '');
      const fillEmpty = curDigits.length === 0;
      const mismatchOnConfirm = onConfirm && curDigits.length > 0 && curDigits !== pageDigits;
      if (!fillEmpty && !mismatchOnConfirm) return;

      const patch: Record<string, string> = {
        [STORAGE_ACTIVITY_GOODS_IDS_CSV]: pageDigits,
      };

      chrome.storage.local.set(patch, () => {
        if (chrome.runtime.lastError) return;
        logStep(
          'activity-autofill',
          mismatchOnConfirm
            ? '活动确认页：检测到商品 ID 与本地不一致，已用当前页 DOM 覆盖 storage'
            : '已从当前页写入活动助手商品 ID（仅填空）',
          patch
        );
        syncActivityAssistantConfig();
      });
    });
  } catch {
    /* ignore */
  }
}

function syncActivityAssistantConfig(): void {
  try {
    chrome.storage.local.get(
      [
        STORAGE_ACTIVITY_ASSIST_ENABLED,
        STORAGE_ACTIVITY_COST_TEMPLATE_ID,
        STORAGE_ACTIVITY_COST_TEMPLATE_NAME,
        STORAGE_ACTIVITY_GOODS_IDS_CSV,
        STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID,
        STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME,
        STORAGE_ACTIVITY_PREPARED_GOODS_FP,
      ],
      (r) => {
        if (chrome.runtime.lastError) return;
        broadcastActivityAssistantMainMessage({
          source: ACTIVITY_MSG_SOURCE,
          type: 'CONFIG',
          enabled: r[STORAGE_ACTIVITY_ASSIST_ENABLED] !== false,
          costTemplateId: Number(r[STORAGE_ACTIVITY_COST_TEMPLATE_ID]) || 0,
          templateName: String(r[STORAGE_ACTIVITY_COST_TEMPLATE_NAME] ?? ''),
          goodsIdsCsv: String(r[STORAGE_ACTIVITY_GOODS_IDS_CSV] ?? ''),
          preparedTemplateId: Number(r[STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID]) || 0,
          preparedTemplateName: String(r[STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME] ?? ''),
          preparedGoodsFingerprint: String(r[STORAGE_ACTIVITY_PREPARED_GOODS_FP] ?? ''),
        });
      }
    );
  } catch {
    /* ignore */
  }
}

function syncInjectConfig(): void {
  try {
    chrome.storage.local.get(
      [STORAGE_REVIEWS_AUTO_FETCH_ALL, STORAGE_REVIEWS_MAX_FETCH_PAGES, STORAGE_REVIEWS_REQUEST_PAGE_SIZE],
      (r) => {
        if (chrome.runtime.lastError) return;
        const rawPs = Number(r[STORAGE_REVIEWS_REQUEST_PAGE_SIZE]);
        let listPageSize = 0;
        if (Number.isFinite(rawPs)) {
          if (rawPs === 0) listPageSize = 0;
          else if (rawPs >= 10 && rawPs <= 200) listPageSize = Math.floor(rawPs);
        }
        window.postMessage(
          {
            source: MSG_SOURCE,
            type: 'CONFIG',
            autoFetchAll: r[STORAGE_REVIEWS_AUTO_FETCH_ALL] === true,
            maxPages: Math.min(50000, Math.max(20, Number(r[STORAGE_REVIEWS_MAX_FETCH_PAGES]) || 1000)),
            delayMs: 280,
            listPageSize: 0,
          },
          '*'
        );
      }
    );
  } catch {
    /* ignore */
  }
}

logStep('boot', 'overlay-entry 启动：postMessage + 页面内浮动按钮（评价页 / 活动确认页）');
window.addEventListener('message', handlePageMessage);
syncInjectConfig();
syncActivityAssistantConfig();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes[STORAGE_AUTH_SESSION] ||
    changes[STORAGE_REVIEWS_MODULE_ENABLED] ||
    changes[STORAGE_ACTIVITY_ASSIST_ENABLED]
  ) {
    applyFloatingButtonVisibility();
  }
  if (
    changes[STORAGE_REVIEWS_AUTO_FETCH_ALL] ||
    changes[STORAGE_REVIEWS_MAX_FETCH_PAGES] ||
    changes[STORAGE_REVIEWS_REQUEST_PAGE_SIZE]
  ) {
    syncInjectConfig();
  }
  if (
    changes[STORAGE_ACTIVITY_ASSIST_ENABLED] ||
    changes[STORAGE_ACTIVITY_COST_TEMPLATE_ID] ||
    changes[STORAGE_ACTIVITY_COST_TEMPLATE_NAME] ||
    changes[STORAGE_ACTIVITY_GOODS_IDS_CSV] ||
    changes[STORAGE_ACTIVITY_PREPARED_TEMPLATE_ID] ||
    changes[STORAGE_ACTIVITY_PREPARED_TEMPLATE_NAME] ||
    changes[STORAGE_ACTIVITY_PREPARED_GOODS_FP]
  ) {
    syncActivityAssistantConfig();
  }
});
patchHistoryNavigationForFloatingButtons();
applyFloatingButtonVisibility();
/** SPA 晚于 content script 更新地址时补一次挂载（含 iframe 内路由） */
for (const ms of [80, 350, 1200, 2200, 4000]) {
  window.setTimeout(() => applyFloatingButtonVisibility(), ms);
}
