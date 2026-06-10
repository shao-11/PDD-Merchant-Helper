import { MSG_HUICE_QUERY_SKU } from '../negative-appeal/huice/constants';
import { looksLikeTradeQueryJson } from '../negative-appeal/huice/huice-debug';
import {
  parseHuiceRawResponse,
  type HuiceSkuQueryResult,
} from '../negative-appeal/huice/trade-query';

const HUICE_TAB_URLS = ['https://erp.huice.com/*', 'https://*.huice.com/*'];
type RawFetchPayload = {
  ok?: boolean;
  channel?: string;
  status?: number;
  text?: string;
  error?: string;
  meta?: { href?: string; origin?: string; path?: string };
};

function mergeLogs(base: string[], extra?: string[]): string[] {
  return [...base, ...(extra ?? [])];
}

function scoreCandidate(c: RawFetchPayload & { frameMeta?: string }): number {
  let s = 0;
  const href = c.meta?.href ?? '';
  if (href.includes('micro-app-new') || href.includes('erpx-web')) s += 30;
  if (looksLikeTradeQueryJson(String(c.text ?? ''))) s += 50;
  return s;
}

async function findHuiceTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: HUICE_TAB_URLS });
  return tabs.find((t) => t.id && t.status !== 'unloaded');
}

/** 在旺店通页 MAIN 世界发 fetch（与控制台一致） */
async function queryViaMainWorldInject(
  tabId: number,
  orderSn: string,
  preferredSkuCodes?: string[],
  preferredGoodsText?: string,
): Promise<HuiceSkuQueryResult> {
  const sn = orderSn.trim();
  const requestId = `huice-${Date.now()}`;
  const logs: string[] = [`[1] MAIN 代发 · tabId=${tabId} · orderSn=${sn}`];
  if (preferredSkuCodes?.length) logs.push(`[1] 目标货品编码 · ${preferredSkuCodes.join('；')}`);
  if (preferredGoodsText) logs.push(`[1] 目标货品关键词 · ${preferredGoodsText}`);

  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: (rid: string, osn: string, codes?: string[]) => {
      return new Promise<RawFetchPayload>((resolve) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', onMsg);
          resolve({ ok: false, channel: 'main', error: 'MAIN 代发超时(12s)' });
        }, 12000);

        const onMsg = (ev: MessageEvent): void => {
          const d = ev.data as RawFetchPayload & { type?: string; requestId?: string };
          if (d?.type !== 'DTX_HUICE_QUERY_RESULT' || d.requestId !== rid) return;
          window.clearTimeout(timeout);
          window.removeEventListener('message', onMsg);
          resolve(d);
        };

        window.addEventListener('message', onMsg);
        window.postMessage(
          { type: 'DTX_HUICE_QUERY', requestId: rid, orderSn: osn, preferredSkuCodes: codes ?? [] },
          '*',
        );
      });
    },
    args: [requestId, sn, preferredSkuCodes ?? []],
  });

  const candidates = (frames ?? []).map((f) => ({
    ...(f.result as RawFetchPayload),
    frameMeta: `frame=${String(f.frameId ?? '?')}`,
  }));

  logs.push(`[2] MAIN 收到 ${candidates.length} 个 frame 回复`);

  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  let best: HuiceSkuQueryResult | null = null;

  for (const c of ranked) {
    if (!c.ok) {
      logs.push(`frame 失败 · ${c.frameMeta} · ${c.error ?? 'unknown'}`);
      continue;
    }
    const meta = `${c.frameMeta} · ${c.meta?.href ?? ''}`;
    const parsed = parseHuiceRawResponse(
      String(c.text ?? ''),
      sn,
      c.status ?? 200,
      'main',
      meta,
      preferredSkuCodes,
      preferredGoodsText,
    );
    logs.push(...(parsed.logs ?? []));
    if (parsed.ok) {
      return { ...parsed, logs: mergeLogs(logs, parsed.logs), debug: mergeLogs(logs, [parsed.debug ?? '']).join('\n') };
    }
    if (!best || (parsed.debug?.length ?? 0) > (best.debug?.length ?? 0)) {
      best = { ...parsed, logs: mergeLogs(logs, parsed.logs) };
    }
  }

  if (best) {
    return {
      ...best,
      debug: mergeLogs(logs, [best.debug ?? '']).join('\n'),
      error: best.error ?? 'MAIN 代发未解析到 skuName',
    };
  }

  return {
    ok: false,
    orderSn: sn,
    skuNames: [],
    error: '旺店通 MAIN 代发无有效回复，请刷新旺店通页面后重试',
    debug: logs.join('\n'),
    logs,
  };
}

/** content script 通道（隔离世界，部分环境 Cookie 弱于 MAIN） */
async function queryViaContentScript(
  tabId: number,
  orderSn: string,
  preferredSkuCodes?: string[],
  preferredGoodsText?: string,
): Promise<HuiceSkuQueryResult> {
  const sn = orderSn.trim();
  const logs: string[] = [`[CS] content script · tabId=${tabId}`];

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: MSG_HUICE_QUERY_SKU, orderSn: sn, preferredSkuCodes, preferredGoodsText },
      (res) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          orderSn: sn,
          skuNames: [],
          error: `content 通信失败：${chrome.runtime.lastError.message}`,
          debug: logs.join('\n'),
          logs,
        });
        return;
      }
      const r = res as HuiceSkuQueryResult | undefined;
      if (!r) {
        resolve({
          ok: false,
          orderSn: sn,
          skuNames: [],
          error: 'content 无响应',
          debug: logs.join('\n'),
          logs,
        });
        return;
      }
      resolve({
        ...r,
        logs: mergeLogs(logs, r.logs),
        debug: mergeLogs(logs, [r.debug ?? '']).join('\n'),
      });
      },
    );
  });
}

async function queryViaHuiceTab(
  orderSn: string,
  preferredSkuCodes?: string[],
  preferredGoodsText?: string,
): Promise<HuiceSkuQueryResult> {
  const sn = orderSn.trim();
  const allLogs: string[] = [`旺店通查询开始 · orderSn=${sn}`];
  if (preferredSkuCodes?.length) allLogs.push(`目标货品编码 · ${preferredSkuCodes.join('；')}`);
  if (preferredGoodsText) allLogs.push(`目标货品关键词 · ${preferredGoodsText}`);

  const tab = await findHuiceTab();
  if (!tab?.id) {
    return {
      ok: false,
      orderSn: sn,
      skuNames: [],
      error:
        '未找到已打开的旺店通标签页。请先打开 https://erp.huice.com 并登录，再回拼多多分析。',
      debug: allLogs.join('\n'),
      logs: allLogs,
    };
  }

  allLogs.push(`命中标签页 · id=${tab.id} · url=${tab.url ?? ''}`);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['huice-inject.js'],
    });
  } catch {
    /* 可能已注入 */
  }

  let mainResult = await queryViaMainWorldInject(tab.id, sn, preferredSkuCodes, preferredGoodsText);
  allLogs.push(...(mainResult.logs ?? []));

  if (mainResult.ok) {
    return { ...mainResult, logs: allLogs, debug: [...allLogs, mainResult.debug ?? ''].join('\n') };
  }

  allLogs.push(`MAIN 未成功：${mainResult.error ?? ''}，尝试 content script…`);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['huice-content.js'],
    });
    await new Promise((r) => setTimeout(r, 200));
  } catch {
    /* ignore */
  }

  const csResult = await queryViaContentScript(tab.id, sn, preferredSkuCodes, preferredGoodsText);
  allLogs.push(...(csResult.logs ?? []));

  if (csResult.ok) {
    return { ...csResult, logs: allLogs, debug: [...allLogs, csResult.debug ?? ''].join('\n') };
  }

  return {
    ok: false,
    orderSn: sn,
    skuNames: [],
    error: csResult.error ?? mainResult.error ?? '旺店通查询失败',
    debug: [...allLogs, mainResult.debug ?? '', csResult.debug ?? ''].filter(Boolean).join('\n'),
    logs: allLogs,
  };
}

export function registerHuiceProxy(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: {
        type?: string;
        orderSn?: string;
        preferredSkuCodes?: string[];
        preferredGoodsText?: string;
      },
      _s,
      sendResponse,
    ) => {
    if (message?.type !== MSG_HUICE_QUERY_SKU) return;

      void queryViaHuiceTab(
        String(message.orderSn ?? ''),
        message.preferredSkuCodes,
        String(message.preferredGoodsText ?? '').trim(),
      ).then(sendResponse);
    return true;
    },
  );
}
