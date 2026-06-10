import { MSG_HUICE_QUERY_SKU } from './constants';
import type { HuiceSkuQueryResult } from './trade-query';

export async function fetchHuiceSkuNamesByOrder(
  orderSn: string,
  preferredSkuCodes?: string[],
  preferredGoodsText?: string,
): Promise<HuiceSkuQueryResult> {
  const sn = orderSn.trim();
  if (!sn) {
    return { ok: false, orderSn: '', skuNames: [], error: '订单号为空' };
  }

  if (!chrome?.runtime?.sendMessage) {
    return {
      ok: false,
      orderSn: sn,
      skuNames: [],
      error: '扩展 runtime 不可用',
    };
  }

  const res = await chrome.runtime.sendMessage({
    type: MSG_HUICE_QUERY_SKU,
    orderSn: sn,
    preferredSkuCodes,
    preferredGoodsText,
  });

  if (!res || typeof res !== 'object') {
    return {
      ok: false,
      orderSn: sn,
      skuNames: [],
      error: '旺店通查询无响应（请重载扩展或先在浏览器登录旺店通）',
    };
  }

  return res as HuiceSkuQueryResult;
}
