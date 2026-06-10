/**
 * 负向申诉 · MAIN world：轻量 fetch 监听（仅缓存 anti / 页面已发的 tuju）+ 代发已确认接口。
 */
import { parseChatHistoryResponse } from '../utils/chat-history-parse';
import { normalizeReviewsResponse } from '../content/normalize-reviews-response';
import { unwrapAfterSalesList, unwrapTujuDetail } from './api-unwrap';
import { resolveSupportedReasons } from './platform-reasons';
import { createFetchLogger } from './fetch-log';
import type { ReviewItem } from '../types/reviews';
import {
  ANTI_MAX_AGE_MS,
  API_AFTER_SALES_LIST,
  API_CHAT_HISTORY,
  API_REVIEWS_LIST,
  API_TUJU_DETAIL,
  LS_CHAT_HDR_KEY,
  LS_MMS_ANTI_KEY,
  MMS_CHAT_REFERER_AI,
  NA_MSG_FETCH_RESULT,
  NA_MSG_SOURCE_CONTENT,
  NA_MSG_SOURCE_INJECT,
  NA_MSG_UPLOAD_APPEAL_FILES,
  NA_MSG_UPLOAD_APPEAL_RESULT,
} from './constants';
import { isNaFetchRequest } from './messages';
import { findAppealSubmitModal, uploadAppealEvidenceImages } from './platform-form-fill';
import { payloadToFiles } from './upload-bridge';
import type { AppealSnapshot, TujuDetail } from './types';

const LS_NA_LAST_TUJU = 'pdd_na_last_tuju_v1';

(function naInjectFetch(): void {
  const g = globalThis as typeof globalThis & { __PDD_DTX_NA_INJECT__?: boolean };
  if (g.__PDD_DTX_NA_INJECT__) return;
  g.__PDD_DTX_NA_INJECT__ = true;

  const originalFetch = window.fetch.bind(window);

  function extractUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  function persistAnti(ac: string, et?: string): void {
    if (!ac) return;
    try {
      localStorage.setItem(
        LS_MMS_ANTI_KEY,
        JSON.stringify({ ac, ts: Date.now() }),
      );
      localStorage.setItem(
        LS_CHAT_HDR_KEY,
        JSON.stringify({ ac, et: et ?? '', ts: Date.now() }),
      );
    } catch {
      /* ignore */
    }
  }

  function readChatHeaders(): { ac: string; et: string } {
    let ac = '';
    let et = '';
    try {
      const raw = localStorage.getItem(LS_CHAT_HDR_KEY);
      if (raw) {
        const o = JSON.parse(raw) as { ac?: string; et?: string; ts?: number };
        if (o.ts && Date.now() - o.ts <= ANTI_MAX_AGE_MS) {
          if (o.ac) ac = o.ac;
          if (o.et) et = o.et;
        }
      }
    } catch {
      /* ignore */
    }
    return { ac, et };
  }

  function readMmsAnti(): string {
    try {
      const raw = localStorage.getItem(LS_MMS_ANTI_KEY);
      if (!raw) return '';
      const o = JSON.parse(raw) as { ac?: string; token?: string; ts?: number };
      if (o.ts && Date.now() - o.ts > ANTI_MAX_AGE_MS) return '';
      const ac = typeof o.ac === 'string' ? o.ac : typeof o.token === 'string' ? o.token : '';
      return ac.trim();
    } catch {
      return '';
    }
  }

  function getCombinedAnti(): { anti: string; et: string; source: string } {
    const chat = readChatHeaders();
    const mms = readMmsAnti();
    if (mms) return { anti: mms, et: chat.et, source: 'mms_anti_cache' };
    if (chat.ac) return { anti: chat.ac, et: chat.et, source: 'chat_hdr_cache' };
    return { anti: '', et: chat.et, source: 'none' };
  }

  function cacheHeadersFromInit(url: string, init?: RequestInit): void {
    if (!url.includes('mms.pinduoduo.com')) return;
    const pick = (h: Headers): void => {
      const ac = h.get('anti-content') || h.get('Anti-Content') || '';
      const et = h.get('etag') || h.get('ETag') || '';
      if (ac) persistAnti(ac, et);
    };
    try {
      if (init?.headers) pick(new Headers(init.headers as HeadersInit));
    } catch {
      /* ignore */
    }
  }

  window.fetch = function naPatchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = extractUrl(input);
    cacheHeadersFromInit(url, init);

    const p = originalFetch(input, init);
    if (url.includes('colombo/tuju/detail')) {
      return p.then(async (res) => {
        try {
          const text = await res.clone().text();
          localStorage.setItem(LS_NA_LAST_TUJU, text);
        } catch {
          /* ignore */
        }
        return res;
      });
    }
    return p;
  };

  function buildHeaders(extra: Record<string, string>): Record<string, string> {
    const { anti, et } = getCombinedAnti();
    const h: Record<string, string> = {
      accept: '*/*',
      'content-type': 'application/json',
      ...extra,
    };
    if (anti) h['anti-content'] = anti;
    if (et) h.etag = et;
    return h;
  }

  function readCachedTujuText(): string | null {
    try {
      return localStorage.getItem(LS_NA_LAST_TUJU);
    } catch {
      return null;
    }
  }

  async function postJson(url: string, body: unknown, referer: string): Promise<unknown> {
    const res = await originalFetch(url, {
      method: 'POST',
      headers: buildHeaders({ Referer: referer }),
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
      throw new Error(`非 JSON · HTTP ${res.status} · ${text.slice(0, 120)}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} · ${text.slice(0, 200)}`);
    }
    return json;
  }

  async function fetchTuju(ticketSn: string, referer: string, log: ReturnType<typeof createFetchLogger>['log']): Promise<TujuDetail> {
    try {
      const json = await postJson(API_TUJU_DETAIL, { ticketSn }, referer);
      const detail = unwrapTujuDetail(json);
      if (detail.orderSn || detail.explanation || detail.supportedAppealReason?.length) {
        const rawN = detail.supportedAppealReason?.length ?? 0;
        const { list: visibleReasons, filteredHidden } = resolveSupportedReasons(detail);
        const hiddenNote = filteredHidden?.length
          ? ` · 已剔除弹窗未展示 ${filteredHidden.length} 项`
          : '';
        log(
          '负向详情',
          'ok',
          '接口拉取成功',
          `orderSn=${detail.orderSn ?? '—'} · 接口返回 ${rawN} 项 · 可选用 ${visibleReasons.length} 项${hiddenNote}`,
        );
        return detail;
      }
      throw new Error('响应已解析但缺少 orderSn / explanation 等字段');
    } catch (e) {
      const cached = readCachedTujuText();
      if (cached) {
        try {
          const detail = unwrapTujuDetail(JSON.parse(cached));
          if (detail.orderSn || detail.explanation) {
            log('负向详情', 'warn', '代发失败，已用页面刚加载时的缓存', String(e));
            return detail;
          }
        } catch {
          /* ignore */
        }
      }
      throw e;
    }
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    const raw = e.data as {
      source?: string;
      type?: string;
      requestId?: string;
      files?: { name: string; mime: string; base64: string }[];
    };
    if (raw?.source === NA_MSG_SOURCE_CONTENT && raw?.type === NA_MSG_UPLOAD_APPEAL_FILES) {
      void (async () => {
        const requestId = raw.requestId ?? '';
        try {
          const modal = findAppealSubmitModal();
          if (!modal) throw new Error('MAIN：未找到「发起申诉」弹窗');
          const fileList = payloadToFiles(raw.files ?? []);
          const step = await uploadAppealEvidenceImages(modal, fileList);
          window.postMessage(
            {
              source: NA_MSG_SOURCE_INJECT,
              type: NA_MSG_UPLOAD_APPEAL_RESULT,
              requestId,
              step,
              debug: step.diagnostics,
            },
            '*',
          );
        } catch (err) {
          window.postMessage(
            {
              source: NA_MSG_SOURCE_INJECT,
              type: NA_MSG_UPLOAD_APPEAL_RESULT,
              requestId,
              error: err instanceof Error ? err.message : String(err),
            },
            '*',
          );
        }
      })();
      return;
    }

    if (!isNaFetchRequest(e.data)) return;
    const { requestId, ticketSn, orderSn: orderSnIn } = e.data;
    const referer = window.location.href;
    const { log, logs } = createFetchLogger();

    void (async () => {
      const antiInfo = getCombinedAnti();
      log(
        '校验头',
        antiInfo.anti ? 'ok' : 'warn',
        antiInfo.anti ? `已缓存 anti（${antiInfo.source}）` : '暂无 anti-content，评价接口可能失败',
        antiInfo.anti ? `长度 ${antiInfo.anti.length}` : '请在本页多点几次或打开客服聊天/评价页后再试',
      );

      try {
        let tuju: TujuDetail;
        try {
          tuju = await fetchTuju(ticketSn, referer, log);
        } catch (err) {
          log('负向详情', 'error', err instanceof Error ? err.message : String(err));
          tuju = {};
        }

        const orderSn =
          String(orderSnIn || tuju.orderSn || '').trim() || '';
        if (!orderSn) {
          throw new Error('无法确定订单号：详情接口无 orderSn，请确认详情页已加载完成');
        }
        log('订单号', 'ok', orderSn);

        let chatRows: AppealSnapshot['chatRows'] = [];
        let chatError: string | undefined;
        try {
          const nowSec = Math.floor(Date.now() / 1000);
          const startSec = nowSec - 180 * 24 * 3600;
          const res = await originalFetch(API_CHAT_HISTORY, {
            method: 'POST',
            headers: buildHeaders({ Referer: MMS_CHAT_REFERER_AI }),
            body: JSON.stringify({
              startTime: startSec,
              endTime: nowSec,
              orderSn,
              pageSize: 50,
              pageNum: 0,
            }),
            credentials: 'include',
            mode: 'cors',
            cache: 'no-cache',
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const chat = parseChatHistoryResponse(text);
          chatRows = chat.rows;
          if (chat.outcome === 'failed') {
            chatError = chat.failureDetail ?? '聊天解析失败';
            log('聊天记录', 'error', chatError);
          } else {
            log('聊天记录', 'ok', `共 ${chatRows.length} 条`, chat.summaryLine);
          }
        } catch (err) {
          chatError = err instanceof Error ? err.message : String(err);
          log('聊天记录', 'error', chatError);
        }

        let afterSales: AppealSnapshot['afterSales'] = [];
        let afterSalesError: string | undefined;
        try {
          const json = await postJson(
            API_AFTER_SALES_LIST,
            { pageSize: 10, searchText: orderSn, pageNumber: 1, orderByCreatedAtDesc: true },
            'https://mms.pinduoduo.com/aftersales/aftersale_list?msfrom=mms_sidenav',
          );
          afterSales = unwrapAfterSalesList(json);
          log(
            '售后列表',
            afterSales.length > 0 ? 'ok' : 'warn',
            afterSales.length > 0 ? `共 ${afterSales.length} 条` : '接口成功但该订单无售后单',
          );
        } catch (err) {
          afterSalesError = err instanceof Error ? err.message : String(err);
          log('售后列表', 'error', afterSalesError);
        }

        let reviews: ReviewItem[] = [];
        let reviewsError: string | undefined;
        const { anti } = getCombinedAnti();
        if (!anti) {
          reviewsError = '缺少 anti-content：请刷新本页或打开评价管理页/客服页后再分析';
          log('商品评价', 'warn', reviewsError);
        } else {
          try {
            const endTime = Math.floor(Date.now() / 1000);
            const startTime = endTime - 90 * 24 * 3600;
            const json = await postJson(
              API_REVIEWS_LIST,
              {
                startTime,
                endTime,
                pageNo: 1,
                pageSize: 40,
                orderSn,
                descScore: ['1', '2', '3', '4', '5'],
              },
              'https://mms.pinduoduo.com/goods/evaluation/index',
            );
            const norm = normalizeReviewsResponse(json);
            if (norm._error) throw new Error(norm._error);
            const rows = norm.data ?? [];
            reviews = rows.filter((r) => String(r.orderSn ?? '').trim() === orderSn);
            log(
              '商品评价',
              reviews.length > 0 ? 'ok' : 'warn',
              reviews.length > 0 ? `命中 ${reviews.length} 条` : '接口成功但未筛到该订单评价',
            );
          } catch (err) {
            reviewsError = err instanceof Error ? err.message : String(err);
            log('商品评价', 'error', reviewsError);
          }
        }

        const snapshot: AppealSnapshot = {
          ticketSn,
          orderSn,
          fetchedAt: Date.now(),
          tuju: Object.keys(tuju).length ? tuju : null,
          chatRows,
          chatError,
          afterSales,
          afterSalesError,
          reviews,
          reviewsError,
          fetchLogs: logs,
          hasAntiContent: Boolean(getCombinedAnti().anti),
        };

        log('完成', 'ok', '四要素采集结束');

        window.postMessage(
          {
            source: NA_MSG_SOURCE_INJECT,
            type: NA_MSG_FETCH_RESULT,
            requestId,
            ok: true,
            snapshot,
          },
          '*',
        );
      } catch (err) {
        log('失败', 'error', err instanceof Error ? err.message : String(err));
        window.postMessage(
          {
            source: NA_MSG_SOURCE_INJECT,
            type: NA_MSG_FETCH_RESULT,
            requestId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            fetchLogs: logs,
          },
          '*',
        );
      }
    })();
  });
})();
