/**
 * 旺店通 MAIN 世界：与控制台 fetch 一致（referrer + credentials）。
 */
(function huiceInjectMain(): void {
  const g = globalThis as typeof globalThis & { __DTX_HUICE_INJECT__?: boolean };
  if (g.__DTX_HUICE_INJECT__) return;
  g.__DTX_HUICE_INJECT__ = true;

  const URL = 'https://erp.huice.com/api/main/oms/tradeQuery/query';
  const MSG_QUERY = 'DTX_HUICE_QUERY';
  const MSG_RESULT = 'DTX_HUICE_QUERY_RESULT';

  function buildBody(orderSn: string): Record<string, unknown> {
    return {
      logisticsStatusWaringFast: 0,
      strcTidsList: [String(orderSn || '').trim()],
      containSkuSuiteType: 0,
      containSkuSuiteGoodsType: 0,
      excludeSkuSuiteType: 0,
      noSearchField: 0,
      noSearchType: 0,
      isIncludeAbnormal: true,
      containRemarkType: 3,
      containMessageType: 3,
      suiteSearchField: 0,
      suiteSearchType: 0,
      anchorSearchField: 0,
      anchorSearchType: 1,
      excludeAnchorSearchField: 0,
      excludeAnchorSearchType: 1,
      containRemarkFlag: 1,
      remarkFlagList: [],
      pageTab: 'ALL_ORDER',
      containSkuIdList: [],
      containSuiteIdList: [],
      manualExcludeSkuIdList: [],
      manualExcludeSuiteIdList: [],
      remarkContainMultiContent: true,
      abnormalIdFastList: [],
      calcTotalCount: false,
      currentPage: 1,
      pageSize: 50,
    };
  }

  function isErpxOrderFrame(): boolean {
    const h = location.href;
    return h.includes('micro-app-new') || h.includes('erpx-web');
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    const d = ev.data as {
      type?: string;
      requestId?: string;
      orderSn?: string;
    };
    if (d?.type !== MSG_QUERY || !d.requestId) return;

    /** 仅订单微应用 iframe 代发，避免父页 #/app/order/list、插件 iframe 抢答并返回无关 JSON */
    if (!isErpxOrderFrame()) return;

    const sn = String(d.orderSn ?? '').trim();
    const requestId = d.requestId;

    void (async () => {
      const meta = {
        href: location.href,
        origin: location.origin,
        path: location.pathname,
      };
      try {
        const res = await fetch(URL, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'zh-CN,zh;q=0.9',
            'content-type': 'application/json',
            'app-code': 'web',
            'app-product-code': 'jisu',
            'app-version': '1.0.640',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
          },
          referrer: 'https://erp.huice.com/micro-app-new/erpx-web',
          body: JSON.stringify(buildBody(sn)),
          credentials: 'include',
          mode: 'cors',
          cache: 'no-cache',
        });
        const text = await res.text();
        window.postMessage(
          {
            type: MSG_RESULT,
            requestId,
            ok: true,
            channel: 'main',
            status: res.status,
            text,
            meta,
            apiUrl: URL,
          },
          '*',
        );
      } catch (e) {
        window.postMessage(
          {
            type: MSG_RESULT,
            requestId,
            ok: false,
            channel: 'main',
            error: e instanceof Error ? e.message : String(e),
            meta,
          },
          '*',
        );
      }
    })();
  });
})();
