/**
 * 旺店通 · 隔离世界 content script（备用通道 + 转发 MAIN 结果日志）
 */
import { MSG_HUICE_QUERY_SKU } from '../negative-appeal/huice/constants';
import { buildTradeQueryBody, parseHuiceRawResponse, type HuiceSkuQueryResult } from '../negative-appeal/huice/trade-query';

const HUICE_TRADE_QUERY_URL = 'https://erp.huice.com/api/main/oms/tradeQuery/query';

const HUICE_HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'content-type': 'application/json',
  'app-code': 'web',
  'app-product-code': 'jisu',
  'app-version': '1.0.640',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
};

export async function fetchHuiceSkuInPage(
  orderSn: string,
  preferredSkuCodes?: string[],
  preferredGoodsText?: string,
): Promise<HuiceSkuQueryResult> {
  const sn = orderSn.trim();
  if (!sn) return { ok: false, orderSn: '', skuNames: [], error: '订单号为空' };

  const logs: string[] = [`content fetch · href=${location.href}`];

  if (!location.href.includes('micro-app-new') && !location.href.includes('erpx-web')) {
    return {
      ok: false,
      orderSn: sn,
      skuNames: [],
      error: '当前 frame 非订单微应用，已跳过（请依赖 micro-app-new iframe）',
      debug: logs.join('\n'),
      logs,
    };
  }

  try {
    const res = await fetch(HUICE_TRADE_QUERY_URL, {
      method: 'POST',
      headers: HUICE_HEADERS,
      referrer: 'https://erp.huice.com/micro-app-new/erpx-web',
      body: JSON.stringify(buildTradeQueryBody(sn)),
      credentials: 'include',
      mode: 'cors',
      cache: 'no-cache',
    });

    const text = await res.text();
    const parsed = parseHuiceRawResponse(
      text,
      sn,
      res.status,
      'content-script',
      `href=${location.href}`,
      preferredSkuCodes,
      preferredGoodsText,
    );
    return {
      ...parsed,
      logs: [...logs, ...(parsed.logs ?? [])],
      debug: [...logs, parsed.debug ?? ''].join('\n'),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      orderSn: sn,
      skuNames: [],
      error: msg,
      debug: [...logs, `异常：${msg}`].join('\n'),
      logs,
    };
  }
}

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
    void fetchHuiceSkuInPage(
      String(message.orderSn ?? ''),
      message.preferredSkuCodes,
      String(message.preferredGoodsText ?? '').trim(),
    ).then(sendResponse);
  return true;
  },
);
