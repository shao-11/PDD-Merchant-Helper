import { FEINIU_QC_FOLDER } from './feiniu-share-constants';

const ENTER_FOLDER_TIMEOUT_MS = 20_000;
const AFTER_ENTER_SETTLE_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 是否已在「质检报告」目录内（能看到 PNG 或面包屑当前项为质检报告） */
export function isInsideQcFolder(doc: Document): boolean {
  const rows = [...doc.querySelectorAll('[role="row"][data-row-key]')];
  const hasImageRow = rows.some((r) => {
    const key = r.getAttribute('data-row-key') ?? '';
    return /\.(png|jpe?g|webp)$/i.test(key) || key.includes('克袋');
  });
  if (hasImageRow) return true;

  const onlyRootFolder =
    rows.length === 1 &&
    (rows[0]?.getAttribute('data-row-key') === FEINIU_QC_FOLDER ||
      (rows[0]?.textContent ?? '').includes('质检报告'));
  if (onlyRootFolder) return false;

  const activeCrumb = doc.querySelector('.semi-breadcrumb-item-active');
  if (activeCrumb?.textContent?.includes('质检报告')) return true;

  if (rows.length > 0 && !onlyRootFolder) return true;

  return false;
}

/** MAIN 世界模拟点击文件夹行（与页面 React 表格同一 DOM） */
function enterFolderViaInject(win: Window): Promise<boolean> {
  const requestId = `enter-${Date.now()}`;
  const doc = win.document;

  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      win.removeEventListener('dtx-fn-share-enter-done', onDone);
      doc.documentElement.removeAttribute(`data-dtx-fn-enter-${requestId}`);
      resolve(ok);
    };

    const onDone = (ev: Event) => {
      if ((ev as CustomEvent).detail?.requestId !== requestId) return;
      const raw = doc.documentElement.getAttribute(`data-dtx-fn-enter-${requestId}`) ?? '';
      let ok = false;
      try {
        ok = Boolean(JSON.parse(raw).ok);
      } catch {
        ok = false;
      }
      finish(ok);
    };

    win.addEventListener('dtx-fn-share-enter-done', onDone);
    win.dispatchEvent(
      new CustomEvent('dtx-fn-share-enter-folder', {
        detail: { requestId, folderKey: FEINIU_QC_FOLDER },
      }),
    );
    win.setTimeout(() => finish(false), 8000);
  });
}

async function waitForInsideQcFolder(win: Window, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isInsideQcFolder(win.document)) {
      await sleep(AFTER_ENTER_SETTLE_MS);
      return;
    }
    await sleep(350);
  }
  throw new Error('未能自动进入「质检报告」文件夹，请手动点进该文件夹后再同步');
}

/**
 * 若当前在分享根目录，自动点进「质检报告」并等待文件列表出现。
 */
export async function ensureEnteredQcFolder(win: Window = window): Promise<void> {
  if (isInsideQcFolder(win.document)) return;

  const clicked = await enterFolderViaInject(win);
  if (!clicked) {
    const row =
      win.document.querySelector(`[role="row"][data-row-key="${FEINIU_QC_FOLDER}"]`) ??
      win.document.querySelector(`[data-row-key="${FEINIU_QC_FOLDER}"]`);
    if (row) {
      (row as HTMLElement).click();
    } else {
      throw new Error('页面上未找到「质检报告」文件夹，请确认分享链接未变');
    }
  }

  await waitForInsideQcFolder(win, ENTER_FOLDER_TIMEOUT_MS);
}
