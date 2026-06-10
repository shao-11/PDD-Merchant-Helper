/**
 * 飞牛 fnOS 外链分享页：同步质检报告 PNG 到扩展缓存。
 */
import { EXTENSION_INVALID_MSG, isExtensionContextValid } from '../negative-appeal/extension-context';
import {
  FEINIU_SHARE_PAGE_URL,
  isFeiniuSharePage,
} from '../negative-appeal/feiniu-share-constants';
import {
  FeiniuShareSyncError,
  syncFeiniuShareFromWindow,
} from '../negative-appeal/feiniu-share-sync';
import {
  MSG_FEINIU_SYNC_RUN,
  type FeiniuSyncContentResult,
} from '../negative-appeal/feiniu-share-messages';
import { ensureEnteredQcFolder } from '../negative-appeal/feiniu-share-nav';
import { formatCatalogAge, getQcSheetCatalog, saveQcSheetCatalog } from '../negative-appeal/qc-sheet-storage';

const BTN_ID = 'dtx-fn-share-sync-btn';
const LOG_TOGGLE_ID = 'dtx-fn-share-log-toggle';
const TOAST_ID = 'dtx-fn-share-toast';
const LOG_ID = 'dtx-fn-share-log';

let syncing = false;
let lastDiagText = '';
let logPanelVisible = false;

function showToast(text: string, tone: 'info' | 'ok' | 'err' = 'info'): void {
  let el = document.getElementById(TOAST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TOAST_ID;
    el.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:88px', 'z-index:2147483647',
      'max-width:400px', 'padding:12px 16px', 'border-radius:10px', 'font-size:13px',
      'line-height:1.5', 'color:#fff', 'box-shadow:0 6px 20px rgba(15,23,42,.25)',
    ].join(';');
    document.documentElement.appendChild(el);
  }
  el.style.background = tone === 'ok' ? '#16a34a' : tone === 'err' ? '#dc2626' : 'rgba(15,23,42,.9)';
  el.textContent = text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function ensureLogPanel(): HTMLPreElement {
  let pre = document.getElementById(LOG_ID) as HTMLPreElement | null;
  if (!pre) {
    pre = document.createElement('pre');
    pre.id = LOG_ID;
    pre.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:148px', 'z-index:2147483645',
      'width:min(420px,92vw)', 'max-height:min(260px,38vh)', 'margin:0', 'padding:10px 12px',
      'overflow:auto', 'border-radius:10px', 'background:rgba(15,23,42,.92)', 'color:#e2e8f0',
      'font:12px/1.45 Consolas,monospace', 'white-space:pre-wrap', 'display:none',
    ].join(';');
    document.documentElement.appendChild(pre);
  }
  return pre;
}

function setLogVisible(visible: boolean): void {
  logPanelVisible = visible;
  const pre = document.getElementById(LOG_ID) as HTMLPreElement | null;
  if (pre) pre.style.display = visible ? 'block' : 'none';

  const toggle = document.getElementById(LOG_TOGGLE_ID) as HTMLButtonElement | null;
  if (toggle) {
    toggle.textContent = visible ? '隐藏日志' : '查看日志';
    toggle.title = visible ? '收起同步详情' : lastDiagText ? '展开最近一次同步日志' : '暂无日志，同步失败时会自动显示';
  }
}

/** 写入日志内容；默认不展示，仅出错或手动点开时显示 */
function storeLog(text: string, showPanel = false): void {
  lastDiagText = text;
  const pre = ensureLogPanel();
  pre.textContent = text;
  setLogVisible(showPanel);
}

function toggleLogPanel(): void {
  if (!lastDiagText) {
    storeLog('· 暂无日志\n· 同步失败时会自动显示；成功时只显示绿色提示', true);
    return;
  }
  setLogVisible(!logPanelVisible);
  if (logPanelVisible) ensureLogPanel().textContent = lastDiagText;
}

async function refreshBtn(btn: HTMLButtonElement): Promise<void> {
  const cat = await getQcSheetCatalog();
  if (cat) {
    const imgN = cat.rows.reduce((n, r) => n + r.images.length, 0);
    btn.title = `已缓存 ${cat.rowCount} 行 · ${imgN} 张 · ${formatCatalogAge(cat.syncedAt)}`;
  } else {
    btn.title = '从当前分享页下载 PNG 并写入缓存';
  }
}

function ensureUi(): void {
  if (!isFeiniuSharePage()) return;

  let btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '同步质检图';
    btn.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:24px', 'z-index:2147483646',
      'padding:10px 18px', 'border:none', 'border-radius:999px',
      'background:linear-gradient(135deg,#0ea5e9,#0369a1)', 'color:#fff',
      'font-size:14px', 'font-weight:600', 'cursor:pointer',
      'box-shadow:0 4px 14px rgba(3,105,161,.45)',
    ].join(';');
    btn.addEventListener('click', () => void runSync(btn));
    document.documentElement.appendChild(btn);

    const logBtn = document.createElement('button');
    logBtn.id = LOG_TOGGLE_ID;
    logBtn.type = 'button';
    logBtn.textContent = '查看日志';
    logBtn.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:72px', 'z-index:2147483646',
      'padding:4px 10px', 'border:1px solid rgba(148,163,184,.45)', 'border-radius:6px',
      'background:rgba(255,255,255,.95)', 'color:#475569', 'font-size:12px',
      'cursor:pointer', 'box-shadow:0 1px 4px rgba(15,23,42,.08)',
    ].join(';');
    logBtn.addEventListener('click', () => toggleLogPanel());
    document.documentElement.appendChild(logBtn);
  }
  void refreshBtn(btn);
}

/** 执行同步（页面按钮与扩展消息共用） */
export async function runFeiniuShareSync(): Promise<FeiniuSyncContentResult> {
  if (syncing) {
    return { ok: false, message: '同步进行中，请稍候' };
  }
  if (!isExtensionContextValid()) {
    return { ok: false, message: EXTENSION_INVALID_MSG };
  }
  if (!isFeiniuSharePage()) {
    return { ok: false, message: '当前不是飞牛分享页' };
  }

  syncing = true;
  setLogVisible(false);
  showToast('正在进入质检报告文件夹…');

  try {
    await ensureEnteredQcFolder(window);
    showToast('正在批量拉取原图…');
    const { catalog, warnings, diag } = await syncFeiniuShareFromWindow();
    storeLog(diag.lines.join('\n'), false);
    await saveQcSheetCatalog(catalog);
    const imgN = catalog.rows.reduce((n, r) => n + r.images.length, 0);
    const message = `已同步 ${catalog.rowCount} 行 · ${imgN} 张原图`;
    showToast(`${message}（请用新缓存重新申诉）`, 'ok');
    if (warnings[0]) showToast(warnings[0], 'info');
    const btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
    if (btn) void refreshBtn(btn);
    return { ok: true, message, rowCount: catalog.rowCount, imageCount: imgN };
  } catch (e) {
    if (e instanceof FeiniuShareSyncError) {
      storeLog(e.diag.lines.join('\n'), true);
      const short = e.message.split('\n')[0];
      showToast(short, 'err');
      return { ok: false, message: short };
    }
    const msg = e instanceof Error ? e.message : String(e);
    storeLog(msg, true);
    showToast(msg, 'err');
    return { ok: false, message: msg };
  } finally {
    syncing = false;
  }
}

async function runSync(btn?: HTMLButtonElement): Promise<void> {
  const b = btn ?? (document.getElementById(BTN_ID) as HTMLButtonElement | null);
  if (b) {
    b.disabled = true;
    b.style.opacity = '0.7';
    b.textContent = '同步中…';
  }
  await runFeiniuShareSync();
  if (b) {
    b.disabled = false;
    b.style.opacity = '1';
    b.textContent = '同步质检图';
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MSG_FEINIU_SYNC_RUN) return;
  void runFeiniuShareSync().then(sendResponse);
  return true;
});

function boot(): void {
  if (!isFeiniuSharePage()) return;
  ensureUi();
  new MutationObserver(() => ensureUi()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

console.info('[滇同学] 飞牛分享助手', FEINIU_SHARE_PAGE_URL);
