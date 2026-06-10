/**
 * 注入到页面主世界（Main World），Hook fetch / XHR，捕获 /saturn/reviews/list 的 JSON。
 * 可选：在收到第一页后自动按相同请求模板拉取剩余页（复用页面生成的 Anti-Content 等头）。
 * 与扩展通信协议：window.postMessage({ source: 'PDD_REVIEW_ANALYZER', ... })
 */
import {
  ANTI_MAX_AGE_MS,
  type ActiveFetchDeps,
  type ListCapture,
  LS_MMS_ANTI_KEY,
  fetchReviewsByDaysRange,
} from '../reviews-analyzer/review-list-fetch';

(function injectPddReviewHook() {
  try {
    const w = window as unknown as { __PDD_REVIEW_HOOK_INSTALLED?: boolean };
    if (w.__PDD_REVIEW_HOOK_INSTALLED) return;
    w.__PDD_REVIEW_HOOK_INSTALLED = true;
  } catch {
    return;
  }

  console.info('[评价分析][inject]', 'MAIN world hook 已安装');

  const SOURCE = 'PDD_REVIEW_ANALYZER';

  type RaCfg = {
    autoFetchAll?: boolean;
    maxPages?: number;
    delayMs?: number;
    /** 列表接口单次条数（默认 100，越大越快；过高可能被服务端拒绝） */
    listPageSize?: number;
  };

  function getCfg(): {
    autoFetchAll: boolean;
    maxPages: number;
    delayMs: number;
    listPageSize: number;
  } {
    const w = window as unknown as { __PDD_RA_CFG?: RaCfg };
    const c = w.__PDD_RA_CFG ?? {};
    const rawPs = c.listPageSize;
    const listPageSize =
      rawPs != null && Number(rawPs) > 0
        ? Math.min(200, Math.max(10, Math.floor(Number(rawPs))))
        : 0;
    return {
      autoFetchAll: c.autoFetchAll !== false,
      maxPages: Math.min(50000, Math.max(1, c.maxPages ?? 1000)),
      delayMs: Math.max(40, Math.min(5000, c.delayMs ?? 280)),
      /** 0：不改写 pageSize，与页面原始请求一致（不易触发 2000010） */
      listPageSize,
    };
  }

  let mmsAntiCache = '';
  let lastListCapture: ListCapture | null = null;
  let activeFetchByDaysBusy = false;
  let activeFetchByDaysToken = 0;

  function hydrateAntiFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_MMS_ANTI_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as { ac?: string; ts?: number };
      if (!o.ts || Date.now() - o.ts > ANTI_MAX_AGE_MS) {
        localStorage.removeItem(LS_MMS_ANTI_KEY);
        return;
      }
      if (o.ac) mmsAntiCache = o.ac;
    } catch {
      /* ignore */
    }
  }

  function persistAnti(): void {
    if (!mmsAntiCache) return;
    try {
      localStorage.setItem(LS_MMS_ANTI_KEY, JSON.stringify({ ac: mmsAntiCache, ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  function setAnti(ac: string): void {
    const v = ac.trim();
    if (!v) return;
    mmsAntiCache = v;
    persistAnti();
  }

  function captureMmsHeadersRecord(h: Record<string, string>): void {
    const ac = String(h['anti-content'] ?? h['Anti-Content'] ?? '').trim();
    if (ac) setAnti(ac);
  }

  function captureMmsHeaders(h: Headers): void {
    const ac = (h.get('anti-content') || h.get('Anti-Content') || '').trim();
    if (ac) setAnti(ac);
  }

  async function tryCaptureListRequest(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<void> {
    if (activeFetchByDaysBusy) return;
    try {
      let url = '';
      let method = 'POST';
      let headers: Record<string, string> = {};
      let bodyText = '';

      if (typeof Request !== 'undefined' && input instanceof Request) {
        url = input.url;
        method = input.method || 'POST';
        headers = headersToObject(input.headers);
        captureMmsHeaders(input.headers);
        bodyText = await input.clone().text();
      } else {
        url = extractUrl(input as RequestInfo);
        method = (init?.method as string) || 'POST';
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            Object.assign(headers, headersToObject(init.headers));
          } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) headers[k] = v;
          } else {
            Object.assign(headers, init.headers as Record<string, string>);
          }
        }
        if (typeof init?.body === 'string') bodyText = init.body;
      }

      if (!url.includes('/saturn/reviews/list')) return;
      captureMmsHeadersRecord(headers);
      if (!/^\s*\{/.test(bodyText)) return;
      const body = JSON.parse(bodyText) as Record<string, unknown>;
      lastListCapture = { headers, body, ts: Date.now() };
      console.info('[评价分析][inject]', '已捕获页面 reviews/list 请求模板', {
        pageSize: body.pageSize,
        descScore: body.descScore,
        hasAnti: Boolean(mmsAntiCache),
      });
    } catch {
      /* ignore */
    }
  }

  hydrateAntiFromStorage();

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as {
      source?: string;
      type?: string;
      autoFetchAll?: boolean;
      maxPages?: number;
      delayMs?: number;
      listPageSize?: number;
    };
    if (d?.source !== SOURCE || d.type !== 'CONFIG') return;
    const win = window as unknown as { __PDD_RA_CFG: RaCfg };
    win.__PDD_RA_CFG = {
      autoFetchAll: d.autoFetchAll,
      maxPages: d.maxPages,
      delayMs: d.delayMs,
      listPageSize: d.listPageSize,
    };
    console.info('[评价分析][inject]', '已更新 CONFIG', win.__PDD_RA_CFG);
  });

  function isReviewsListUrl(url: string): boolean {
    return url.includes('reviews/list');
  }

  const LIST_BODY_MAX_PAGE_SIZE = 200;

  /** listPageSize>0 时把 pageSize 提到至少该值；为 0 时不改写请求体（避免与后台默认请求不一致导致 2000010） */
  function patchReviewsListBodyText(text: string, listPageSize: number): string {
    const t = text.trim();
    if (!/^\s*\{/.test(t)) return text;
    if (listPageSize <= 0) return text;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const rawPs = o.pageSize ?? o.page_size;
      const cur = Math.floor(Number(rawPs));
      const base = Number.isFinite(cur) && cur > 0 ? cur : 10;
      const want = Math.min(LIST_BODY_MAX_PAGE_SIZE, Math.max(listPageSize, base));
      o.pageSize = want;
      if ('page_size' in o) o.page_size = want;
      if (want !== base) {
        console.info('[评价分析][inject]', '请求体 pageSize 已放大', { from: base, to: want });
      }
      return JSON.stringify(o);
    } catch {
      return text;
    }
  }

  function patchInitBodyIfJson(
    init: RequestInit | undefined,
    listPageSize: number
  ): RequestInit | undefined {
    if (!init) return init;
    const b = init.body;
    if (typeof b === 'string') {
      const next = patchReviewsListBodyText(b, listPageSize);
      return next !== b ? { ...init, body: next } : init;
    }
    return init;
  }

  async function patchFetchArgsIfReviewsList(args: Parameters<typeof fetch>): Promise<Parameters<typeof fetch>> {
    const input = args[0];
    const init = args[1] as RequestInit | undefined;
    const urlPreview = extractUrl(input as RequestInfo);
    if (!isReviewsListUrl(urlPreview)) return args;

    const listPageSize = getCfg().listPageSize;

    if (typeof input === 'string') {
      const nextInit = patchInitBodyIfJson(init, listPageSize);
      if (nextInit !== init) {
        return [input, nextInit] as Parameters<typeof fetch>;
      }
      return args;
    }

    if (typeof URL !== 'undefined' && input instanceof URL) {
      const nextInit = patchInitBodyIfJson(init, listPageSize);
      if (nextInit !== init) {
        return [input, nextInit] as Parameters<typeof fetch>;
      }
      return args;
    }

    if (typeof Request !== 'undefined' && input instanceof Request) {
      let text = '';
      try {
        text = await input.clone().text();
      } catch {
        return args;
      }
      if (!/^\s*\{/.test(text)) return args;
      const nextBody = patchReviewsListBodyText(text, listPageSize);
      if (nextBody === text) return args;
      const req = new Request(input.url, {
        method: input.method,
        headers: input.headers,
        body: nextBody,
        credentials: input.credentials,
        mode: input.mode,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal,
      });
      return [req, undefined] as Parameters<typeof fetch>;
    }

    return args;
  }

  function postReviewsPayload(payload: unknown, httpStatus: number) {
    let payloadJson: string;
    try {
      payloadJson = JSON.stringify(payload);
    } catch {
      postReviewsError('捕获结果无法序列化', httpStatus);
      return;
    }
    window.postMessage(
      {
        source: SOURCE,
        type: 'REVIEWS_RESPONSE',
        payloadJson,
        httpStatus,
      },
      '*'
    );
  }

  function postReviewsError(message: string, httpStatus?: number) {
    window.postMessage(
      {
        source: SOURCE,
        type: 'REVIEWS_ERROR',
        message,
        httpStatus,
      },
      '*'
    );
  }

  function extractUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof Request) return input.url;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    return String(input);
  }

  function headersToObject(h: Headers): Record<string, string> {
    const o: Record<string, string> = {};
    h.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }

  type RequestTemplate = { url: string; method: string; headers: Record<string, string>; bodyText: string };

  async function captureFetchTemplate(args: Parameters<typeof fetch>): Promise<RequestTemplate | null> {
    const input = args[0];
    const init = args[1] as RequestInit | undefined;
    try {
      if (input instanceof Request) {
        return {
          url: input.url,
          method: input.method,
          headers: headersToObject(input.headers),
          bodyText: await input.clone().text(),
        };
      }
      if (typeof input === 'string') {
        const url = input;
        const method = (init?.method as string) || 'GET';
        const headers: Record<string, string> = {};
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            Object.assign(headers, headersToObject(init.headers));
          } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) headers[k] = v;
          } else {
            Object.assign(headers, init.headers as Record<string, string>);
          }
        }
        let bodyText = '';
        const b = init?.body;
        if (typeof b === 'string') bodyText = b;
        else if (b instanceof URLSearchParams) bodyText = b.toString();
        return { url, method, headers, bodyText };
      }
      if (typeof URL !== 'undefined' && input instanceof URL) {
        const url = input.href;
        const method = (init?.method as string) || 'GET';
        const headers: Record<string, string> = {};
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            Object.assign(headers, headersToObject(init.headers));
          } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) headers[k] = v;
          } else {
            Object.assign(headers, init.headers as Record<string, string>);
          }
        }
        let bodyText = '';
        const b = init?.body;
        if (typeof b === 'string') bodyText = b;
        else if (b instanceof URLSearchParams) bodyText = b.toString();
        return { url, method, headers, bodyText };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function resolveUrl(url: string): string {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  /** 服务端返回 success:false（如错误码 2000018）时本页条数为 0，可与「真的没有更多评价」区分以便重试 */
  function isBizFailure(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    return (data as Record<string, unknown>).success === false;
  }

  /**
   * 与列表接口字段对齐；showNum 为平台「最多可查/可看」条数（常见 2000），超过后再分页请求易返回 2000018。
   */
  function unwrapListMeta(data: unknown): { total: number; pageLen: number; showNum: number } {
    if (!data || typeof data !== 'object') return { total: 0, pageLen: 0, showNum: 0 };
    const o = data as Record<string, unknown>;
    let total =
      typeof o.totalNum === 'number'
        ? o.totalNum
        : typeof o.totalRows === 'number'
          ? o.totalRows
          : typeof o.reviewNum === 'number'
            ? o.reviewNum
            : 0;
    let pageLen = 0;
    if (Array.isArray(o.data)) pageLen = o.data.length;
    let showNum = typeof o.showNum === 'number' && o.showNum > 0 ? o.showNum : 0;

    const result = o.result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const r = result as Record<string, unknown>;
      if (typeof r.totalNum === 'number') total = r.totalNum;
      else if (typeof r.totalRows === 'number') total = r.totalRows;
      if (Array.isArray(r.data)) pageLen = r.data.length;
      if (typeof r.showNum === 'number' && r.showNum > 0) showNum = r.showNum;
    }
    return { total, pageLen, showNum };
  }

  /** 自动拉取时走 originalFetch，避免再次进入 hook 造成递归 */
  let isAutoReplay = false;
  /** 防止 fetch / XHR 双通道同时触发两条自动链 */
  let autoChainBusy = false;

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  function numOr(v: unknown, d: number): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  }

  async function autoFetchRemainingPages(tmpl: RequestTemplate, firstPageData: unknown): Promise<void> {
    const cfg = getCfg();
    if (!cfg.autoFetchAll) return;
    if (activeFetchByDaysBusy) return;
    if (autoChainBusy) return;

    autoChainBusy = true;
    try {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(tmpl.bodyText || '{}') as Record<string, unknown>;
      } catch {
        console.warn('[评价分析][inject]', '自动拉取：请求体不是 JSON，跳过');
        return;
      }

      const pageSize = Math.max(1, Math.floor(numOr(body.pageSize, 10)));
      const startPage = Math.max(1, Math.floor(numOr(body.pageNo, 1)));
      const { total, pageLen, showNum } = unwrapListMeta(firstPageData);

      if (pageLen <= 0) {
        console.info('[评价分析][inject]', '自动拉取：本页条数为 0，跳过', { total, pageLen });
        return;
      }

      /** 接口返回的 showNum 为平台声明的可查条数上限；未返回时不设扩展侧条数上限（仅按空页 / maxPages 停止） */
      const rowStop = showNum > 0 ? showNum : Number.POSITIVE_INFINITY;

      const cap = showNum > 0 ? showNum : Number.POSITIVE_INFINITY;
      const effectiveTotalHint = Math.min(total > 0 ? total : Number.POSITIVE_INFINITY, cap);

      /** 已累计条数（仅本自动链路的各页 data 长度之和），达到 rowStop 或某页空则停 */
      let rowsAccum = pageLen;

      if (Number.isFinite(rowStop) && rowsAccum >= rowStop) {
        console.info('[评价分析][inject]', '自动拉取：首屏已达本次条数目标', { rowsAccum, rowStop });
        return;
      }

      const estimatedPages = Math.min(Math.ceil(effectiveTotalHint / pageSize), cfg.maxPages);
      console.info('[评价分析][inject]', '自动拉取开始', {
        totalNumFromApi: total,
        showNum: showNum || undefined,
        rowStop: Number.isFinite(rowStop) ? rowStop : '∞',
        pageSize,
        startPage,
        rowsAccumAfterFirst: rowsAccum,
        apiHintPages: estimatedPages,
        maxPageNo: cfg.maxPages,
        delayMs: cfg.delayMs,
      });

      for (let p = startPage + 1; p <= cfg.maxPages; p++) {
        await sleep(cfg.delayMs);
        const nextBody = { ...body, pageNo: p };
        const nextText = JSON.stringify(nextBody);
        isAutoReplay = true;
        try {
          const res = await originalFetch(tmpl.url, {
            method: tmpl.method || 'POST',
            headers: tmpl.headers,
            body: nextText,
            credentials: 'include',
            mode: 'cors',
            cache: 'no-cache',
          });
          const st = res.status;
          if (!res.ok) {
            console.warn('[评价分析][inject]', `自动拉取第 ${p} 页 HTTP ${st}，停止`);
            postReviewsError(`自动拉取在第 ${p} 页失败 HTTP ${st}`, st);
            break;
          }
          let data: unknown;
          try {
            data = await res.json();
          } catch {
            console.warn('[评价分析][inject]', `自动拉取第 ${p} 页 JSON 解析失败，停止`);
            break;
          }
          postReviewsPayload(data, st);
          let pl = unwrapListMeta(data).pageLen;
          if (pl === 0 && isBizFailure(data)) {
            console.warn(
              '[评价分析][inject]',
              `自动拉取第 ${p} 页业务失败（如 2000018），${cfg.delayMs * 5}ms 后重试同一页一次`
            );
            await sleep(cfg.delayMs * 5);
            const res2 = await originalFetch(tmpl.url, {
              method: tmpl.method || 'POST',
              headers: tmpl.headers,
              body: nextText,
              credentials: 'include',
              mode: 'cors',
              cache: 'no-cache',
            });
            const st2 = res2.status;
            if (!res2.ok) {
              console.warn('[评价分析][inject]', `自动拉取第 ${p} 页重试仍 HTTP ${st2}，停止`);
              postReviewsError(`自动拉取在第 ${p} 页重试失败 HTTP ${st2}`, st2);
              break;
            }
            try {
              data = await res2.json();
            } catch {
              console.warn('[评价分析][inject]', `自动拉取第 ${p} 页重试 JSON 解析失败，停止`);
              break;
            }
            postReviewsPayload(data, st2);
            pl = unwrapListMeta(data).pageLen;
          }
          rowsAccum += pl;
          if (pl === 0) {
            console.info('[评价分析][inject]', `自动拉取第 ${p} 页无数据，提前结束`, { rowsAccum });
            break;
          }
          console.info('[评价分析][inject]', `自动拉取进度 第${p}页（本页 ${pl} 条，累计约 ${rowsAccum}${Number.isFinite(rowStop) ? `/${rowStop}` : ''}）`);
          if (Number.isFinite(rowStop) && rowsAccum >= rowStop) {
            console.info('[评价分析][inject]', '自动拉取：已达本次条数目标', { rowsAccum, rowStop });
            break;
          }
        } catch (e) {
          console.warn('[评价分析][inject]', '自动拉取异常，停止', e);
          postReviewsError(`自动拉取异常：${String(e)}`, undefined);
          break;
        } finally {
          isAutoReplay = false;
        }
      }

      console.info('[评价分析][inject]', '自动拉取结束', {
        rowsAccum,
        rowStop: Number.isFinite(rowStop) ? rowStop : '∞',
      });
    } finally {
      autoChainBusy = false;
    }
  }

  // ----- fetch -----
  const originalFetch = window.fetch.bind(window);
  try {
    (window as unknown as { __PDD_ORIGINAL_FETCH__: typeof fetch }).__PDD_ORIGINAL_FETCH__ = originalFetch;
  } catch {
    /* ignore */
  }

  const activeFetchDeps: ActiveFetchDeps = {
    originalFetch,
    postPayload: postReviewsPayload,
    getCapture: () => lastListCapture,
    getAnti: () => mmsAntiCache,
    hydrateAnti: hydrateAntiFromStorage,
  };

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as {
      source?: string;
      type?: string;
      requestId?: string;
      days?: number;
    };
    if (d?.source !== SOURCE || d.type !== 'FETCH_REVIEWS_BY_DAYS' || !d.requestId) return;

    const requestId = String(d.requestId);
    const days = Math.min(180, Math.max(1, Math.floor(Number(d.days) || 7)));
    const token = ++activeFetchByDaysToken;
    void (async () => {
      activeFetchByDaysBusy = true;
      try {
        hydrateAntiFromStorage();
        const summary = await fetchReviewsByDaysRange(activeFetchDeps, days);
        if (token !== activeFetchByDaysToken) return;
        window.postMessage(
          {
            source: SOURCE,
            type: 'FETCH_REVIEWS_BY_DAYS_DONE',
            requestId,
            ok: true,
            rowCount: summary.rowCount,
            pages: summary.pages,
            days,
          },
          '*'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        postReviewsError(msg, undefined);
        if (token !== activeFetchByDaysToken) return;
        window.postMessage(
          {
            source: SOURCE,
            type: 'FETCH_REVIEWS_BY_DAYS_DONE',
            requestId,
            ok: false,
            error: msg,
            days,
          },
          '*'
        );
      } finally {
        if (token === activeFetchByDaysToken) activeFetchByDaysBusy = false;
      }
    })();
  });

  /** 从页面发起的 getHistoryMessage 请求里缓存 anti-content / etag，供扩展代发同接口时使用 */
  let chatAntiContentCache = '';
  let chatEtagCache = '';

  /** 与接口文档一致：聊天接口多在「客服聊天搜索」场景下发；浏览器脚本可能无法改写 Referer，仍以缓存头为准 */
  const MMS_CHAT_SEARCH_REFERER =
    'https://mms.pinduoduo.com/mms-chat/search?msfrom=mms_sidenav';

  const LS_CHAT_HDR_KEY = 'pdd_ra_chat_hdr_v1';
  const CHAT_HDR_MAX_AGE_MS = 45 * 60 * 1000;

  function hydrateChatHeadersFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_CHAT_HDR_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as { ac?: string; et?: string; ts?: number };
      if (!o.ts || Date.now() - o.ts > CHAT_HDR_MAX_AGE_MS) {
        localStorage.removeItem(LS_CHAT_HDR_KEY);
        return;
      }
      if (o.ac) chatAntiContentCache = o.ac;
      if (o.et) chatEtagCache = o.et;
    } catch {
      /* ignore */
    }
  }

  function persistChatHeaders(): void {
    if (!chatAntiContentCache && !chatEtagCache) return;
    try {
      localStorage.setItem(
        LS_CHAT_HDR_KEY,
        JSON.stringify({
          ac: chatAntiContentCache,
          et: chatEtagCache,
          ts: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
  }

  /** 聊天搜索页会调 latitude/search/message/*（如 getMessages）；与按订单的 getHistoryMessage 共用校验头场景 */
  function isLatitudeChatAuthUrl(url: string): boolean {
    return (
      url.includes('latitude/message/getHistoryMessage') ||
      url.includes('latitude/search/message/')
    );
  }

  function cacheHeadersFromLatitudeChatFetch(args: Parameters<typeof fetch>): void {
    const input = args[0];
    const init = args[1] as RequestInit | undefined;
    const url = extractUrl(input as RequestInfo);
    if (!isLatitudeChatAuthUrl(url)) return;
    const pick = (h: Headers): void => {
      const ac = h.get('anti-content') || h.get('Anti-Content');
      const et = h.get('etag') || h.get('ETag');
      if (ac) chatAntiContentCache = ac;
      if (et) chatEtagCache = et;
      persistChatHeaders();
    };
    try {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        pick(input.headers);
      } else if (init?.headers) {
        pick(new Headers(init.headers as HeadersInit));
      }
    } catch {
      /* ignore */
    }
  }

  /** 进入任意商家后台页即尝试合并其它标签页已写入的校验头缓存 */
  hydrateChatHeadersFromStorage();

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as { source?: string; type?: string; requestId?: string; orderSn?: string };
    if (d?.source !== SOURCE || d.type !== 'CHAT_HISTORY_REQUEST' || !d.requestId || !d.orderSn) return;

    void (async () => {
      hydrateChatHeadersFromStorage();
      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = nowSec - 180 * 24 * 3600;
      const bodyText = JSON.stringify({
        startTime: startSec,
        endTime: nowSec,
        orderSn: String(d.orderSn).trim(),
        pageSize: 50,
        pageNum: 0,
      });
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        Referer: MMS_CHAT_SEARCH_REFERER,
      };
      if (chatAntiContentCache) headers['anti-content'] = chatAntiContentCache;
      if (chatEtagCache) headers['etag'] = chatEtagCache;

      try {
        const res = await originalFetch('https://mms.pinduoduo.com/latitude/message/getHistoryMessage', {
          method: 'POST',
          headers,
          body: bodyText,
          credentials: 'include',
          mode: 'cors',
          cache: 'no-cache',
        });
        const text = await res.text();
        window.postMessage(
          {
            source: SOURCE,
            type: 'CHAT_HISTORY_RESPONSE',
            requestId: d.requestId,
            ok: res.ok,
            status: res.status,
            bodyText: text,
          },
          '*'
        );
      } catch (err) {
        window.postMessage(
          {
            source: SOURCE,
            type: 'CHAT_HISTORY_RESPONSE',
            requestId: d.requestId,
            ok: false,
            status: 0,
            error: String(err),
          },
          '*'
        );
      }
    })();
  });

  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const patchedArgs = isAutoReplay ? args : await patchFetchArgsIfReviewsList(args);
    try {
      cacheHeadersFromLatitudeChatFetch(patchedArgs);
    } catch {
      /* ignore */
    }
    const urlPreview = extractUrl(patchedArgs[0] as RequestInfo);
    if (!isAutoReplay && urlPreview.includes('mms.pinduoduo.com')) {
      try {
        const init = patchedArgs[1] as RequestInit | undefined;
        if (init?.headers) {
          if (init.headers instanceof Headers) captureMmsHeaders(init.headers);
          else if (typeof init.headers === 'object' && !Array.isArray(init.headers)) {
            captureMmsHeadersRecord(init.headers as Record<string, string>);
          }
        }
        if (typeof Request !== 'undefined' && patchedArgs[0] instanceof Request) {
          captureMmsHeaders(patchedArgs[0].headers);
        }
        if (isReviewsListUrl(urlPreview)) {
          await tryCaptureListRequest(patchedArgs[0] as RequestInfo | URL, init);
        }
      } catch {
        /* ignore */
      }
    }
    const templatePromise =
      !isAutoReplay && isReviewsListUrl(urlPreview) ? captureFetchTemplate(patchedArgs) : Promise.resolve(null);

    const response = await originalFetch(...patchedArgs);

    if (isAutoReplay) return response;

    try {
      if (!isReviewsListUrl(urlPreview)) return response;

      const status = response.status;
      const clone = response.clone();
      clone
        .json()
        .then(async (data: unknown) => {
          postReviewsPayload(data, status);
          const tmpl = await templatePromise;
          if (tmpl && tmpl.bodyText && /^\s*\{/.test(tmpl.bodyText)) {
            await autoFetchRemainingPages(tmpl, data);
          }
        })
        .catch(() => {
          postReviewsError('响应不是 JSON 或解析失败', status);
        });
    } catch {
      /* ignore */
    }
    return response;
  };

  // ----- XMLHttpRequest -----
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['setRequestHeader']>) {
    const [name, value] = args;
    const bag = (this as unknown as { __pdd_headers?: Record<string, string> }).__pdd_headers ?? {};
    bag[name] = value;
    (this as unknown as { __pdd_headers: Record<string, string> }).__pdd_headers = bag;
    return xhrSetRequestHeader.apply(this, args);
  };

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['open']>) {
    const url = args[1];
    const method = args[0];
    const x = this as unknown as {
      __pdd_url?: string;
      __pdd_method?: string;
      __pdd_headers?: Record<string, string>;
    };
    x.__pdd_url = typeof url === 'string' ? url : String(url);
    x.__pdd_method = typeof method === 'string' ? method : String(method);
    x.__pdd_headers = {};
    return xhrOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
    const x = this as unknown as {
      __pdd_url?: string;
      __pdd_method?: string;
      __pdd_headers?: Record<string, string>;
      __pdd_send_body?: string;
    };
    const urlRaw = x.__pdd_url ?? '';
    const urlFull = resolveUrl(urlRaw);
    let invokeArgs = args;

    if (
      isLatitudeChatAuthUrl(urlFull) ||
      isLatitudeChatAuthUrl(urlRaw) ||
      urlRaw.includes('getHistoryMessage') ||
      urlRaw.includes('getMessages')
    ) {
      this.addEventListener(
        'load',
        function () {
          const bag = x.__pdd_headers ?? {};
          const ac = bag['anti-content'] ?? bag['Anti-Content'];
          const et = bag['etag'] ?? bag['ETag'];
          if (ac) chatAntiContentCache = ac;
          if (et) chatEtagCache = et;
          persistChatHeaders();
        },
        { once: true }
      );
    }

    if (isReviewsListUrl(urlRaw) || isReviewsListUrl(urlFull)) {
      const bodyArg = args[0];
      let sendText = typeof bodyArg === 'string' ? bodyArg : '';
      if (typeof bodyArg === 'string' && /^\s*\{/.test(bodyArg)) {
        sendText = patchReviewsListBodyText(bodyArg, getCfg().listPageSize);
      }
      x.__pdd_send_body = sendText;
      if (typeof bodyArg === 'string' && sendText !== bodyArg) {
        invokeArgs = [sendText] as Parameters<XMLHttpRequest['send']>;
      }
      this.addEventListener(
        'load',
        function () {
          if (isAutoReplay) return;
          const status = this.status;
          try {
            const text = this.responseText;
            const data = JSON.parse(text) as unknown;
            postReviewsPayload(data, status);

            const tmpl: RequestTemplate = {
              url: urlFull,
              method: x.__pdd_method ?? 'POST',
              headers: { ...(x.__pdd_headers ?? {}) },
              bodyText: x.__pdd_send_body ?? '',
            };
            if (tmpl.bodyText && /^\s*\{/.test(tmpl.bodyText)) {
              void autoFetchRemainingPages(tmpl, data);
            }
          } catch {
            postReviewsError('XHR 响应解析失败', status);
          }
        },
        { once: true }
      );
    }
    return xhrSend.apply(this, invokeArgs);
  };
})();
