/**
 * MAIN world：一键举报（回复）专用。
 * 与评价分析 inject-hook、活动助手 inject-enroll-hook 完全隔离。
 */
import { normalizeReviewsResponse } from '../content/normalize-reviews-response';
import type { ReviewItem } from '../types/reviews';
import { buildCreateReportBody } from './report-template';
import { buildReplySubmitBody } from './reply-template';
import { randomListFetchIntervalMs, randomReportIntervalMs, sleepMs } from './report-delay';
import { summarizeReplyStats, tagReviewStar } from './review-reply-status';
import { summarizeReportStats } from './review-status';
import {
  ANTI_MAX_AGE_MS,
  CREATE_REPORT_URL,
  DEFAULT_REPLY_DAYS,
  LS_MMS_ANTI_KEY,
  MSG_TYPE_BATCH_REPLY,
  MSG_TYPE_BATCH_REPORT,
  MSG_TYPE_FETCH_FIVE_STAR_REVIEWS,
  MSG_TYPE_FETCH_REVIEWS,
  DEFAULT_REPORT_DAYS,
  LIST_FETCH_CONCURRENCY,
  LIST_FETCH_PAGE_SIZE,
  MSG_TYPE_WARM_ANTI,
  REPORT_REPLY_MSG_SOURCE,
  REVIEW_REPLY_SUBMIT_URL,
  REVIEWS_LIST_URL,
  RPC_KIND_REQ,
  RPC_KIND_RES,
} from './constants';
import { rrLog } from './debug-log';

type RpcReq = {
  source?: string;
  kind?: string;
  type?: string;
  replyId?: string;
  payload?: unknown;
  ok?: boolean;
};

type ListCapture = {
  headers: Record<string, string>;
  body: Record<string, unknown>;
  ts: number;
};

const LIST_PAGE_SIZE = LIST_FETCH_PAGE_SIZE;
/** 平台评价列表最多可查约 2000 条 */
const MAX_LIST_ROWS = 2000;
const MAX_LIST_PAGES = Math.ceil(MAX_LIST_ROWS / LIST_PAGE_SIZE) + 2;
const LIST_PAGE_CONCURRENCY = LIST_FETCH_CONCURRENCY;

(function injectReportReplyMain(): void {
  try {
    const w = window as unknown as { __PDD_REPORT_REPLY_HOOK__?: boolean };
    if (w.__PDD_REPORT_REPLY_HOOK__) return;
    w.__PDD_REPORT_REPLY_HOOK__ = true;
  } catch {
    return;
  }

  let mmsAntiCache = '';
  let capturedEtag = '';
  let lastPageListCapture: ListCapture | null = null;
  let rrApiFetchInFlight = false;
  let activeReportFetchReplyId: string | null = null;
  let activeFiveStarFetchReplyId: string | null = null;

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

  function extractAntiFromHeaders(h: Headers): string {
    return (h.get('anti-content') || h.get('Anti-Content') || '').trim();
  }

  function headersToRecord(h: Headers): Record<string, string> {
    const o: Record<string, string> = {};
    h.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }

  hydrateAntiFromStorage();
  rrLog('inject', 'info', 'MAIN hook 已安装', {
    hasAnti: Boolean(mmsAntiCache),
    hasListCapture: Boolean(lastPageListCapture),
    href: window.location.href,
  });

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as { __dtx__?: boolean; type?: string; token?: string };
    if (d && d.__dtx__ === true && d.type === 'dtxAntiContent' && d.token) {
      setAnti(String(d.token));
    }
  });

  function captureMmsHeaders(h: Headers): void {
    const ac = extractAntiFromHeaders(h);
    if (ac) setAnti(ac);
    const et = (h.get('etag') || h.get('Etag') || '').trim();
    if (et) capturedEtag = et;
  }

  function captureMmsHeadersRecord(h: Record<string, string>): void {
    const ac = String(h['anti-content'] ?? h['Anti-Content'] ?? '').trim();
    if (ac) setAnti(ac);
    const et = String(h.etag ?? h.Etag ?? '').trim();
    if (et) capturedEtag = et;
  }

  async function tryCaptureListRequest(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<void> {
    if (rrApiFetchInFlight) return;
    try {
      let url = '';
      let method = 'POST';
      let headers: Record<string, string> = {};
      let bodyText = '';

      if (typeof Request !== 'undefined' && input instanceof Request) {
        url = input.url;
        method = input.method || 'POST';
        headers = headersToRecord(input.headers);
        bodyText = await input.clone().text();
      } else {
        url = extractUrl(input);
        method = (init?.method as string) || 'POST';
        if (init?.headers) {
          if (init.headers instanceof Headers) headers = headersToRecord(init.headers);
          else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) headers[k] = v;
          } else Object.assign(headers, init.headers);
        }
        if (typeof init?.body === 'string') bodyText = init.body;
      }

      if (!url.includes('/saturn/reviews/list')) return;
      captureMmsHeadersRecord(headers);
      if (!/^\s*\{/.test(bodyText)) return;
      const body = JSON.parse(bodyText) as Record<string, unknown>;
      lastPageListCapture = { headers, body, ts: Date.now() };
      rrLog('inject', 'info', '已捕获页面 reviews/list 请求模板', {
        pageSize: body.pageSize,
        descScore: body.descScore,
        hasAnti: Boolean(mmsAntiCache),
      });
    } catch {
      /* ignore */
    }
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function reportReplyFetch(...args: Parameters<typeof fetch>) {
    const url = extractUrl(args[0] as RequestInfo | URL);
    if (url.includes('mms.pinduoduo.com')) {
      try {
        const init = args[1] as RequestInit | undefined;
        if (init?.headers) {
          if (init.headers instanceof Headers) captureMmsHeaders(init.headers);
          else if (typeof init.headers === 'object' && !Array.isArray(init.headers)) {
            captureMmsHeadersRecord(init.headers as Record<string, string>);
          }
        }
        if (typeof Request !== 'undefined' && args[0] instanceof Request) {
          captureMmsHeaders(args[0].headers);
        }
        if (url.includes('/saturn/reviews/list')) {
          await tryCaptureListRequest(args[0] as RequestInfo | URL, init);
        }
      } catch {
        /* ignore */
      }
    }
    return origFetch(...args);
  };

  function extractUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof Request) return input.url;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    return String(input);
  }

  function buildHeaders(): Record<string, string> {
    const anti = mmsAntiCache.trim();
    if (!anti) {
      throw new Error('缺少 anti-content，请稍后重试或刷新评价页');
    }
    const base = lastPageListCapture?.headers ?? {};
    const h: Record<string, string> = {
      ...base,
      accept: base.accept ?? '*/*',
      'accept-language': base['accept-language'] ?? 'zh-CN,zh;q=0.9',
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      pragma: 'no-cache',
      'anti-content': anti,
    };
    const et = capturedEtag || base.etag || base.Etag;
    if (et) h.etag = String(et);
    return h;
  }

  function computeTimeRange(days: number): { startTime: number; endTime: number } {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - Math.max(1, days) * 24 * 60 * 60;
    return { startTime, endTime };
  }

  function readPositiveNum(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return 0;
  }

  /** 从列表响应读取「本次筛选可查条数」；不用 totalNum（常为全店评价总数） */
  function listMetaFromPayload(data: unknown): {
    showNum: number;
    totalRows: number;
    reviewNum: number;
  } {
    const out = { showNum: 0, totalRows: 0, reviewNum: 0 };
    if (!data || typeof data !== 'object') return out;
    const layers: Record<string, unknown>[] = [data as Record<string, unknown>];
    const nested = (data as Record<string, unknown>).result;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      layers.push(nested as Record<string, unknown>);
    }
    for (const o of layers) {
      out.showNum = Math.max(out.showNum, readPositiveNum(o.showNum));
      out.totalRows = Math.max(out.totalRows, readPositiveNum(o.totalRows));
      out.reviewNum = Math.max(out.reviewNum, readPositiveNum(o.reviewNum));
    }
    return out;
  }

  /** 分页停止条数：有 showNum/ totalRows/ reviewNum 用之；否则满页则继续翻到平台上限 */
  function listFetchCapFromPayload(data: unknown, firstPageLen: number): number {
    const meta = listMetaFromPayload(data);
    const cap = meta.showNum || meta.totalRows || meta.reviewNum;
    if (cap > 0) return Math.min(Math.max(cap, firstPageLen), MAX_LIST_ROWS);
    if (firstPageLen >= LIST_PAGE_SIZE) return MAX_LIST_ROWS;
    return firstPageLen;
  }

  function buildListBody(
    startTime: number,
    endTime: number,
    pageNo: number,
    descScore: string[]
  ): Record<string, unknown> {
    const base = { ...(lastPageListCapture?.body ?? {}) };
    delete base.startTime;
    delete base.endTime;
    delete base.pageNo;
    delete base.pageSize;
    return {
      ...base,
      startTime,
      endTime,
      pageNo,
      pageSize: LIST_PAGE_SIZE,
      descScore,
      orderSn: '',
    };
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function refreshAntiFromCache(waitMs = 0): Promise<boolean> {
    hydrateAntiFromStorage();
    if (mmsAntiCache) return true;
    if (waitMs > 0) {
      await sleep(waitMs);
      hydrateAntiFromStorage();
    }
    return Boolean(mmsAntiCache);
  }

  function unwrapListRows(data: unknown): { rows: ReviewItem[]; fetchCap: number } {
    if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>;
      if (o.success === false) {
        const code = String(o.errorCode ?? o.error_code ?? '');
        const msg = String(o.errorMsg ?? o.error_msg ?? o.message ?? '列表接口返回失败');
        if (code === '2000010') {
          throw new Error(`${msg}（可缩小时间范围；pageSize=${LIST_PAGE_SIZE} 若仍失败可改小）`);
        }
        throw new Error(msg);
      }
      if (Array.isArray(o.data)) {
        const rows = o.data as ReviewItem[];
        return { rows, fetchCap: listFetchCapFromPayload(data, rows.length) };
      }
    }
    const normalized = normalizeReviewsResponse(data);
    if (normalized._error) throw new Error(normalized._error);
    const rows = normalized.data ?? [];
    return { rows, fetchCap: listFetchCapFromPayload(normalized, rows.length) };
  }

  async function fetchListPage(
    startTime: number,
    endTime: number,
    pageNo: number,
    descScore: string[]
  ): Promise<{ rows: ReviewItem[]; fetchCap: number }> {
    const body = buildListBody(startTime, endTime, pageNo, descScore);
    rrApiFetchInFlight = true;
    try {
      const res = await origFetch(REVIEWS_LIST_URL, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(body),
        credentials: 'include',
        mode: 'cors',
        cache: 'no-cache',
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        rrLog('inject', 'error', `列表非 JSON`, { pageNo, status: res.status, preview: text.slice(0, 300) });
        throw new Error(`列表接口非 JSON（HTTP ${res.status}）`);
      }
      if (!res.ok) {
        rrLog('inject', 'error', `列表 HTTP 错误`, { pageNo, status: res.status, body: text.slice(0, 400) });
        throw new Error(`列表 HTTP ${res.status}`);
      }
      const unwrapped = unwrapListRows(json);
      rrLog('inject', 'info', `列表第 ${pageNo} 页`, {
        rows: unwrapped.rows.length,
        fetchCap: unwrapped.fetchCap,
        body: { startTime, endTime, pageSize: LIST_PAGE_SIZE },
      });
      return unwrapped;
    } finally {
      rrApiFetchInFlight = false;
    }
  }

  type ReportFetchSummary = ReturnType<typeof summarizeReportStats>;
  type ReplyFetchSummary = ReturnType<typeof summarizeReplyStats>;

  function mergeRows(
    target: ReviewItem[],
    seen: Set<string>,
    rows: ReviewItem[]
  ): { added: number; partial: boolean } {
    let added = 0;
    for (const r of rows) {
      const id = String(r.reviewId ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      target.push(r);
      added += 1;
    }
    return { added, partial: rows.length > 0 && rows.length < LIST_PAGE_SIZE };
  }

  async function fetchAllReviewsByScore(
    days: number,
    descScore: string[],
    logLabel: string
  ): Promise<ReviewItem[]> {
    await refreshAntiFromCache(0);
    rrLog('inject', 'info', `开始拉取评价（${logLabel}）`, {
      days,
      descScore,
      hasAnti: Boolean(mmsAntiCache),
      hasListCapture: Boolean(lastPageListCapture),
      antiLen: mmsAntiCache.length,
    });

    const { startTime, endTime } = computeTimeRange(days);
    rrLog('inject', 'info', '查询时间范围', {
      days,
      descScore,
      startTime,
      endTime,
      spanDays: Math.round((endTime - startTime) / 86400),
    });
    const all: ReviewItem[] = [];
    const seen = new Set<string>();

    const first = await fetchListPage(startTime, endTime, 1, descScore);
    const meta = listMetaFromPayload(first);
    const fetchCap = first.fetchCap;
    const { added: firstAdded, partial: firstPartial } = mergeRows(all, seen, first.rows);

    const plannedPages = Math.min(
      MAX_LIST_PAGES,
      Math.max(1, Math.ceil(fetchCap / LIST_PAGE_SIZE))
    );

    rrLog('inject', 'info', '分页计划', {
      fetchCap,
      plannedPages,
      pageSize: LIST_PAGE_SIZE,
      concurrency: LIST_PAGE_CONCURRENCY,
      batchGapMs: '300-500',
      meta,
      firstPageRows: first.rows.length,
      firstAdded,
    });

    if (firstPartial || first.rows.length === 0 || all.length >= fetchCap || plannedPages <= 1) {
      rrLog('inject', 'info', '拉取完成（仅首屏）', { pages: 1, rows: all.length, fetchCap });
      return all;
    }

    let pagesDone = 1;
    for (let batchStart = 2; batchStart <= plannedPages; batchStart += LIST_PAGE_CONCURRENCY) {
      const batchEnd = Math.min(plannedPages, batchStart + LIST_PAGE_CONCURRENCY - 1);
      const pageNos: number[] = [];
      for (let p = batchStart; p <= batchEnd; p += 1) pageNos.push(p);

      const results = await Promise.all(
        pageNos.map(async (pageNo) => {
          try {
            return { pageNo, page: await fetchListPage(startTime, endTime, pageNo, descScore) };
          } catch (e) {
            return {
              pageNo,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        })
      );

      results.sort((a, b) => a.pageNo - b.pageNo);
      let stopChain = false;

      for (const item of results) {
        pagesDone = Math.max(pagesDone, item.pageNo);
        if ('error' in item && item.error) {
          rrLog('inject', 'warn', `第 ${item.pageNo} 页失败`, { err: item.error });
          stopChain = true;
          break;
        }
        const page = item.page!;
        const { partial } = mergeRows(all, seen, page.rows);
        if (page.rows.length === 0 || partial || all.length >= fetchCap) {
          stopChain = true;
          break;
        }
      }

      if (stopChain || all.length >= fetchCap) break;
      if (batchEnd < plannedPages) {
        const gap = randomListFetchIntervalMs();
        rrLog('inject', 'info', `翻页批间等待 ${gap}ms`, { nextBatchFrom: batchEnd + 1 });
        await sleepMs(gap);
      }
    }

    rrLog('inject', 'info', '拉取完成', {
      pages: pagesDone,
      fetchCap,
      rows: all.length,
    });
    return all;
  }

  async function fetchAllLowStarReviews(days: number): Promise<ReportFetchSummary> {
    const all: ReviewItem[] = [];
    const seen = new Set<string>();
    for (const score of ['1', '2', '3']) {
      const rows = await fetchAllReviewsByScore(days, [score], `低星举报-${score}星`);
      for (const r of rows) {
        const id = String(r.reviewId ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        all.push(r);
      }
    }
    return summarizeReportStats(all);
  }

  async function fetchAllFiveStarReviews(days: number): Promise<ReplyFetchSummary> {
    const all: ReviewItem[] = [];
    const seen = new Set<string>();
    for (const score of ['5', '4'] as const) {
      const rows = await fetchAllReviewsByScore(days, [score], `好评回复-${score}星`);
      for (const r of rows) {
        const id = String(r.reviewId ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        all.push(tagReviewStar(r, Number(score)));
      }
    }
    return summarizeReplyStats(all);
  }

  async function submitReviewReply(reviewId: string, content?: string): Promise<void> {
    rrApiFetchInFlight = true;
    const replyContent = (content ?? '').trim();
    rrLog('inject', 'info', '提交商家回复', {
      reviewId,
      contentLen: replyContent.length,
      preview: replyContent.slice(0, 80),
    });
    try {
      const res = await origFetch(REVIEW_REPLY_SUBMIT_URL, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(buildReplySubmitBody(reviewId, content)),
        credentials: 'include',
        mode: 'cors',
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      if (!res.ok) throw new Error(`回复 HTTP ${res.status}`);
      if (json.success === false) {
        throw new Error(String(json.errorMsg ?? json.error_msg ?? json.message ?? '回复失败'));
      }
    } finally {
      rrApiFetchInFlight = false;
    }
  }

  async function createReport(reviewId: string): Promise<void> {
    rrApiFetchInFlight = true;
    try {
      const res = await origFetch(CREATE_REPORT_URL, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(buildCreateReportBody(reviewId)),
        credentials: 'include',
        mode: 'cors',
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      if (!res.ok) throw new Error(`举报 HTTP ${res.status}`);
      if (json.success === false) {
        throw new Error(String(json.errorMsg ?? json.error_msg ?? json.message ?? '举报失败'));
      }
    } finally {
      rrApiFetchInFlight = false;
    }
  }

  function postReply(replyId: string, ok: boolean, result?: unknown, error?: string): void {
    let resultJson: string | undefined;
    if (ok && result != null) {
      try {
        resultJson = JSON.stringify(result);
      } catch (e) {
        postReply(replyId, false, undefined, `数据序列化失败：${String(e)}`);
        return;
      }
    }
    rrLog('inject', ok ? 'info' : 'error', ok ? 'postReply 成功' : 'postReply 失败', {
      replyId,
      resultJsonLen: resultJson?.length ?? 0,
      error,
    });
    window.postMessage(
      {
        source: REPORT_REPLY_MSG_SOURCE,
        kind: RPC_KIND_RES,
        replyId,
        ok,
        resultJson,
        error,
      },
      '*'
    );
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as RpcReq;
    if (d?.source !== REPORT_REPLY_MSG_SOURCE || !d.replyId) return;
    if (d.kind === RPC_KIND_RES || typeof d.ok === 'boolean') return;
    if (d.kind && d.kind !== RPC_KIND_REQ) return;
    if (!d.type) return;

    const replyId = d.replyId;
    rrLog('inject', 'info', `收到 RPC`, { type: d.type, replyId, payload: d.payload });

    void (async () => {
      try {
        if (d.type === MSG_TYPE_WARM_ANTI) {
          await refreshAntiFromCache(300);
          postReply(replyId, true, { hasAnti: Boolean(mmsAntiCache) });
          return;
        }

        if (d.type === MSG_TYPE_FETCH_REVIEWS) {
          activeReportFetchReplyId = replyId;
          const days = Math.max(
            1,
            Math.floor(Number((d.payload as { days?: number })?.days ?? DEFAULT_REPORT_DAYS))
          );
          if (!mmsAntiCache) {
            rrLog('inject', 'warn', '本地无 anti，等待 800ms 后重试…');
            const ok = await refreshAntiFromCache(800);
            if (!ok) {
              throw new Error(
                '缺少 anti-content：请先在评价页点选 1～3 星或切换「近30天」等筛选，待列表刷新后再打开面板'
              );
            }
          }
          const summary = await fetchAllLowStarReviews(days);
          if (activeReportFetchReplyId !== replyId) {
            rrLog('inject', 'warn', 'FETCH 结果被丢弃（已有新请求）', { replyId });
            return;
          }
          postReply(replyId, true, summary);
          return;
        }

        if (d.type === MSG_TYPE_FETCH_FIVE_STAR_REVIEWS) {
          activeFiveStarFetchReplyId = replyId;
          const days = Math.max(
            1,
            Math.floor(Number((d.payload as { days?: number })?.days ?? DEFAULT_REPLY_DAYS))
          );
          if (!mmsAntiCache) {
            rrLog('inject', 'warn', '本地无 anti，等待 800ms 后重试…');
            const ok = await refreshAntiFromCache(800);
            if (!ok) {
              throw new Error(
                '缺少 anti-content：请先在评价页点选 4～5 星或切换时间筛选，待列表刷新后再打开面板'
              );
            }
          }
          const summary = await fetchAllFiveStarReviews(days);
          if (activeFiveStarFetchReplyId !== replyId) {
            rrLog('inject', 'warn', 'FETCH 五星结果被丢弃（已有新请求）', { replyId });
            return;
          }
          postReply(replyId, true, summary);
          return;
        }

        if (d.type === MSG_TYPE_BATCH_REPORT) {
          const ids = (d.payload as { reviewIds?: string[] })?.reviewIds ?? [];
          const results: { reviewId: string; ok: boolean; error?: string }[] = [];
          for (let i = 0; i < ids.length; i += 1) {
            const id = String(ids[i] ?? '');
            if (!id) continue;
            try {
              await createReport(id);
              results.push({ reviewId: id, ok: true });
            } catch (err) {
              results.push({
                reviewId: id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            if (i < ids.length - 1) {
              const gap = randomReportIntervalMs();
              rrLog('inject', 'info', `举报间隔 ${gap}ms`, { reviewId: id, index: i + 1 });
              await sleepMs(gap);
            }
          }
          postReply(replyId, true, { results });
          return;
        }

        if (d.type === MSG_TYPE_BATCH_REPLY) {
          const payload = (d.payload as {
            items?: { reviewId?: string; content?: string }[];
            reviewIds?: string[];
          }) ?? {};
          const rawItems = payload.items?.length
            ? payload.items
            : (payload.reviewIds ?? []).map((id) => ({ reviewId: id }));
          const results: { reviewId: string; ok: boolean; error?: string }[] = [];
          for (let i = 0; i < rawItems.length; i += 1) {
            const row = rawItems[i] ?? {};
            const id = String(row.reviewId ?? '');
            if (!id) continue;
            const content = String((row as { content?: string }).content ?? '').trim() || undefined;
            try {
              await submitReviewReply(id, content);
              results.push({ reviewId: id, ok: true });
            } catch (err) {
              results.push({
                reviewId: id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            if (i < rawItems.length - 1) {
              const gap = randomReportIntervalMs();
              rrLog('inject', 'info', `回复间隔 ${gap}ms`, { reviewId: id, index: i + 1 });
              await sleepMs(gap);
            }
          }
          postReply(replyId, true, { results });
          return;
        }

        postReply(replyId, false, undefined, `未知请求类型: ${d.type}`);
      } catch (err) {
        if (d.type === MSG_TYPE_FETCH_REVIEWS && activeReportFetchReplyId !== replyId) return;
        if (d.type === MSG_TYPE_FETCH_FIVE_STAR_REVIEWS && activeFiveStarFetchReplyId !== replyId) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        rrLog('inject', 'error', `RPC 处理异常`, { type: d.type, replyId, msg });
        postReply(replyId, false, undefined, msg);
      }
    })();
  });
})();
