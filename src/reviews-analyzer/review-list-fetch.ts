/**
 * 评价分析 · 按时间范围主动拉取（与一键举报 report-reply 模块隔离，仅参考其参数思路）
 */
import { normalizeReviewsResponse } from '../content/normalize-reviews-response';
import type { ReviewItem } from '../types/reviews';

export const REVIEWS_LIST_URL = 'https://mms.pinduoduo.com/saturn/reviews/list';

/** 与举报模块类似的翻页条数，单独常量避免耦合 */
export const REVIEW_FETCH_PAGE_SIZE = 40;
export const REVIEW_FETCH_CONCURRENCY = 3;
export const REVIEW_FETCH_INTERVAL_MS_MIN = 300;
export const REVIEW_FETCH_INTERVAL_MS_MAX = 500;

export const MAX_REVIEW_FETCH_ROWS = 2000;
export const MAX_REVIEW_FETCH_PAGES =
  Math.ceil(MAX_REVIEW_FETCH_ROWS / REVIEW_FETCH_PAGE_SIZE) + 2;

/** 与活动助手 / 举报共用页内 anti 缓存键（只读，不修改举报模块） */
export const LS_MMS_ANTI_KEY = 'pdd_activity_assist_mms_anti_v1';
export const ANTI_MAX_AGE_MS = 45 * 60 * 1000;

export type ListCapture = {
  headers: Record<string, string>;
  body: Record<string, unknown>;
  ts: number;
};

export function computeTimeRange(days: number): { startTime: number; endTime: number } {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - Math.max(1, Math.floor(days)) * 24 * 60 * 60;
  return { startTime, endTime };
}

export function randomFetchIntervalMs(): number {
  const span = REVIEW_FETCH_INTERVAL_MS_MAX - REVIEW_FETCH_INTERVAL_MS_MIN;
  return REVIEW_FETCH_INTERVAL_MS_MIN + Math.floor(Math.random() * (span + 1));
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function readPositiveNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

export function listMetaFromPayload(data: unknown): {
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

export function listFetchCapFromPayload(data: unknown, firstPageLen: number): number {
  const meta = listMetaFromPayload(data);
  const cap = meta.showNum || meta.totalRows || meta.reviewNum;
  if (cap > 0) return Math.min(Math.max(cap, firstPageLen), MAX_REVIEW_FETCH_ROWS);
  if (firstPageLen >= REVIEW_FETCH_PAGE_SIZE) return MAX_REVIEW_FETCH_ROWS;
  return firstPageLen;
}

export function buildAnalyzerListBody(
  base: Record<string, unknown> | null,
  startTime: number,
  endTime: number,
  pageNo: number
): Record<string, unknown> {
  const raw = { ...(base ?? {}) };
  delete raw.startTime;
  delete raw.endTime;
  delete raw.pageNo;
  delete raw.pageSize;
  const descScore = Array.isArray(raw.descScore) ? raw.descScore : ['1', '2', '3', '4', '5'];
  return {
    ...raw,
    startTime,
    endTime,
    pageNo,
    pageSize: REVIEW_FETCH_PAGE_SIZE,
    descScore,
    orderSn: typeof raw.orderSn === 'string' ? raw.orderSn : '',
  };
}

export function buildListHeaders(
  anti: string,
  captured: ListCapture | null
): Record<string, string> {
  const trimmed = anti.trim();
  if (!trimmed) {
    throw new Error('缺少 anti-content，请刷新评价页或稍后在列表加载完成后再试');
  }
  const base = captured?.headers ?? {};
  const h: Record<string, string> = {
    ...base,
    accept: base.accept ?? '*/*',
    'accept-language': base['accept-language'] ?? 'zh-CN,zh;q=0.9',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    pragma: 'no-cache',
    'anti-content': trimmed,
  };
  const et = base.etag ?? base.Etag;
  if (et) h.etag = String(et);
  return h;
}

export function unwrapListRows(data: unknown): { rows: ReviewItem[]; fetchCap: number } {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (o.success === false) {
      const code = String(o.errorCode ?? o.error_code ?? '');
      const msg = String(o.errorMsg ?? o.error_msg ?? o.message ?? '列表接口返回失败');
      if (code === '2000010') {
        throw new Error(`${msg}（可缩小时间范围；pageSize=${REVIEW_FETCH_PAGE_SIZE}）`);
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

export function mergeReviewRowsDedup(
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
  return { added, partial: rows.length > 0 && rows.length < REVIEW_FETCH_PAGE_SIZE };
}

export type ActiveFetchDeps = {
  originalFetch: typeof fetch;
  postPayload: (data: unknown, httpStatus: number) => void;
  getCapture: () => ListCapture | null;
  getAnti: () => string;
  hydrateAnti: () => void;
};

export async function fetchReviewsByDaysRange(
  deps: ActiveFetchDeps,
  days: number
): Promise<{ rowCount: number; pages: number }> {
  deps.hydrateAnti();
  const capture = deps.getCapture();
  const anti = deps.getAnti();
  const headers = buildListHeaders(anti, capture);
  const { startTime, endTime } = computeTimeRange(days);

  const fetchPage = async (pageNo: number): Promise<{ rows: ReviewItem[]; fetchCap: number; raw: unknown }> => {
    const body = buildAnalyzerListBody(capture?.body ?? null, startTime, endTime, pageNo);
    const res = await deps.originalFetch(REVIEWS_LIST_URL, {
      method: 'POST',
      headers,
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
      throw new Error(`列表接口非 JSON（HTTP ${res.status}）`);
    }
    if (!res.ok) {
      throw new Error(`列表 HTTP ${res.status}`);
    }
    const unwrapped = unwrapListRows(json);
    deps.postPayload(json, res.status);
    return { ...unwrapped, raw: json };
  };

  console.info('[评价分析][inject]', '按时间范围拉取开始', {
    days,
    startTime,
    endTime,
    pageSize: REVIEW_FETCH_PAGE_SIZE,
    hasCapture: Boolean(capture),
    hasAnti: Boolean(anti),
  });

  const all: ReviewItem[] = [];
  const seen = new Set<string>();

  const first = await fetchPage(1);
  const fetchCap = first.fetchCap;
  const { partial: firstPartial } = mergeReviewRowsDedup(all, seen, first.rows);

  const plannedPages = Math.min(
    MAX_REVIEW_FETCH_PAGES,
    Math.max(1, Math.ceil(fetchCap / REVIEW_FETCH_PAGE_SIZE))
  );

  let pagesDone = 1;

  if (firstPartial || first.rows.length === 0 || all.length >= fetchCap || plannedPages <= 1) {
    console.info('[评价分析][inject]', '按时间范围拉取完成（仅首屏）', {
      days,
      pages: 1,
      rows: all.length,
    });
    return { rowCount: all.length, pages: 1 };
  }

  for (let batchStart = 2; batchStart <= plannedPages; batchStart += REVIEW_FETCH_CONCURRENCY) {
    const batchEnd = Math.min(plannedPages, batchStart + REVIEW_FETCH_CONCURRENCY - 1);
    const pageNos: number[] = [];
    for (let p = batchStart; p <= batchEnd; p += 1) pageNos.push(p);

    const results = await Promise.all(
      pageNos.map(async (pageNo) => {
        try {
          return { pageNo, page: await fetchPage(pageNo) };
        } catch (e) {
          return { pageNo, error: e instanceof Error ? e.message : String(e) };
        }
      })
    );

    results.sort((a, b) => a.pageNo - b.pageNo);
    let stopChain = false;

    for (const item of results) {
      pagesDone = Math.max(pagesDone, item.pageNo);
      if ('error' in item && item.error) {
        console.warn('[评价分析][inject]', `按时间拉取第 ${item.pageNo} 页失败`, item.error);
        stopChain = true;
        break;
      }
      const page = item.page!;
      const { partial } = mergeReviewRowsDedup(all, seen, page.rows);
      if (page.rows.length === 0 || partial || all.length >= fetchCap) {
        stopChain = true;
        break;
      }
    }

    if (stopChain || all.length >= fetchCap) break;
    if (batchEnd < plannedPages) {
      const gap = randomFetchIntervalMs();
      console.info('[评价分析][inject]', `按时间拉取批间等待 ${gap}ms`);
      await sleepMs(gap);
    }
  }

  console.info('[评价分析][inject]', '按时间范围拉取完成', {
    days,
    pages: pagesDone,
    fetchCap,
    rows: all.length,
  });
  return { rowCount: all.length, pages: pagesDone };
}
