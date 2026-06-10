/**
 * 售后维权申诉 · MAIN world：缓存 anti、可申诉列表、checkAppeal，并代发采集接口。
 */
import { parseChatHistoryResponse } from '../utils/chat-history-parse';
import { normalizeReviewsResponse } from '../content/normalize-reviews-response';
import { createFetchLogger } from '../negative-appeal/fetch-log';
import type { ReviewItem } from '../types/reviews';
import {
  ANTI_MAX_AGE_MS,
  API_AFTER_SALES_LIST,
  API_CHAT_HISTORY,
  API_CHECK_APPEAL,
  API_COMPLAIN_TYPE,
  API_LOGISTICS_TRACK,
  API_ORDER_DETAIL,
  API_QUERY_CAN_APPEAL_LIST,
  API_REVIEWS_LIST,
  DEFAULT_CHECK_APPEAL_SUB_TYPES,
  ASA_MSG_FETCH_RESULT,
  ASA_MSG_SOURCE_CONTENT,
  ASA_MSG_SOURCE_INJECT,
  ASA_MSG_UPLOAD_FILES,
  ASA_MSG_UPLOAD_RESULT,
  LS_CHAT_HDR_KEY,
  LS_MMS_ANTI_KEY,
  MMS_CHAT_REFERER_AI,
} from './constants';
import { isAsaFetchRequest } from './messages';
import {
  cacheCanAppealList,
  cacheCheckAppeal,
  cacheComplainTypes,
  writeActiveOrder,
} from './order-context';
import {
  unwrapCanAppealList,
  unwrapCheckAppeal,
  unwrapComplainTypes,
  unwrapLogisticsTrack,
  unwrapOrderDetail,
  unwrapAfterSalesList,
  allowedAppealSubTypesFromCanAppeal,
} from './api-unwrap';
import { findRightsAppealModal } from './page-context';
import { uploadAftersaleEvidenceImages } from './platform-form-fill';
import { payloadToFiles } from '../negative-appeal/upload-bridge';
import type { AftersaleAppealSnapshot, CanAppealInfoItem } from './types';

(function asaInjectFetch(): void {
  const g = globalThis as typeof globalThis & { __PDD_DTX_ASA_INJECT__?: boolean };
  if (g.__PDD_DTX_ASA_INJECT__) return;
  g.__PDD_DTX_ASA_INJECT__ = true;

  const originalFetch = window.fetch.bind(window);

  function extractUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  function persistAnti(ac: string, et?: string): void {
    if (!ac) return;
    try {
      localStorage.setItem(LS_MMS_ANTI_KEY, JSON.stringify({ ac, ts: Date.now() }));
      localStorage.setItem(LS_CHAT_HDR_KEY, JSON.stringify({ ac, et: et ?? '', ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  function readMmsAnti(): { anti: string; et: string } {
    let anti = '';
    let et = '';
    try {
      const raw = localStorage.getItem(LS_MMS_ANTI_KEY);
      if (raw) {
        const o = JSON.parse(raw) as { ac?: string; ts?: number };
        if (o.ts && Date.now() - o.ts <= ANTI_MAX_AGE_MS && o.ac) anti = o.ac;
      }
      const chat = localStorage.getItem(LS_CHAT_HDR_KEY);
      if (chat) {
        const o = JSON.parse(chat) as { ac?: string; et?: string; ts?: number };
        if (o.ts && Date.now() - o.ts <= ANTI_MAX_AGE_MS) {
          if (o.ac && !anti) anti = o.ac;
          if (o.et) et = o.et;
        }
      }
    } catch {
      /* ignore */
    }
    return { anti, et };
  }

  function cacheHeadersFromInit(url: string, init?: RequestInit): void {
    if (!url.includes('mms.pinduoduo.com')) return;
    try {
      if (init?.headers) {
        const h = new Headers(init.headers as HeadersInit);
        const ac = h.get('anti-content') || h.get('Anti-Content') || '';
        const et = h.get('etag') || h.get('ETag') || '';
        if (ac) persistAnti(ac, et);
      }
    } catch {
      /* ignore */
    }
  }

  function tryCaptureRequestBody(url: string, init?: RequestInit): void {
    if (!init?.body || typeof init.body !== 'string') return;
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (url.includes('queryCanAppealInfoList')) {
        /* 响应在 then 里处理 */
        return;
      }
      if (url.includes('checkAppeal') || url.includes('appeal/preCheck')) {
        const orderSn = String(body.orderSn ?? '').trim();
        const afterSalesId = Number(body.afterSalesId) || 0;
        if (orderSn) {
          writeActiveOrder({
            orderSn,
            afterSalesId,
            updatedAt: Date.now(),
            source: 'checkAppeal',
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = extractUrl(input);
    cacheHeadersFromInit(url, init);
    tryCaptureRequestBody(url, init);

    const p = originalFetch(input, init);

    if (url.includes('queryCanAppealInfoList')) {
      return p.then(async (res) => {
        try {
          const json = JSON.parse(await res.clone().text()) as unknown;
          const items = unwrapCanAppealList(json);
          if (items.length) cacheCanAppealList(items);
        } catch {
          /* ignore */
        }
        return res;
      });
    }

    if (url.includes('checkAppeal')) {
      return p.then(async (res) => {
        try {
          const text = await res.clone().text();
          const json = JSON.parse(text) as unknown;
          const bodyStr = typeof init?.body === 'string' ? init.body : '';
          const req = bodyStr ? (JSON.parse(bodyStr) as Record<string, unknown>) : {};
          const orderSn = String(req.orderSn ?? '').trim();
          const afterSalesId = Number(req.afterSalesId) || 0;
          if (orderSn && afterSalesId) cacheCheckAppeal(orderSn, afterSalesId, json);
        } catch {
          /* ignore */
        }
        return res;
      });
    }

    if (url.includes('complain/complainType')) {
      return p.then(async (res) => {
        try {
          const json = JSON.parse(await res.clone().text()) as unknown;
          cacheComplainTypes(json);
        } catch {
          /* ignore */
        }
        return res;
      });
    }

    return p;
  };

  function buildHeaders(extra: Record<string, string>): Record<string, string> {
    const { anti, et } = readMmsAnti();
    const h: Record<string, string> = {
      accept: '*/*',
      'content-type': 'application/json',
      ...extra,
    };
    if (anti) h['anti-content'] = anti;
    if (et) h.etag = et;
    return h;
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
      throw new Error(`非 JSON · HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} · ${text.slice(0, 200)}`);
    return json;
  }

  function pickCanAppealItem(
    items: CanAppealInfoItem[],
    orderSn: string,
    afterSalesId = 0,
  ): CanAppealInfoItem | null {
    // 同订单可能有多条可申诉商品：必须优先按当前售后单 afterSalesId 精确命中
    if (afterSalesId > 0) {
      const byId = items.find((x) => Number(x.afterSalesId) === afterSalesId);
      if (byId) return byId;
    }
    const sn = orderSn.trim();
    if (sn) {
      const hit = items.find((x) => String(x.orderSn ?? '').trim() === sn);
      if (hit) return hit;
    }
    return null;
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    const raw = e.data as {
      source?: string;
      type?: string;
      requestId?: string;
      files?: { name: string; mime: string; base64: string }[];
    };

    if (raw?.source === ASA_MSG_SOURCE_CONTENT && raw?.type === ASA_MSG_UPLOAD_FILES) {
      void (async () => {
        const requestId = raw.requestId ?? '';
        try {
          const modal = findRightsAppealModal();
          if (!modal) throw new Error('未找到「维权申诉」弹窗');
          const files = payloadToFiles(raw.files ?? []);
          const step = await uploadAftersaleEvidenceImages(modal, files);
          window.postMessage(
            {
              source: ASA_MSG_SOURCE_INJECT,
              type: ASA_MSG_UPLOAD_RESULT,
              requestId,
              step,
            },
            '*',
          );
        } catch (err) {
          window.postMessage(
            {
              source: ASA_MSG_SOURCE_INJECT,
              type: ASA_MSG_UPLOAD_RESULT,
              requestId,
              error: err instanceof Error ? err.message : String(err),
            },
            '*',
          );
        }
      })();
      return;
    }

    if (!isAsaFetchRequest(e.data)) return;
    const { requestId, orderSn: orderSnIn, afterSalesId: afterSalesIdIn } = e.data;
    const referer = window.location.href;
    const { log, logs } = createFetchLogger();

    void (async () => {
      const antiInfo = readMmsAnti();
      log(
        '校验头',
        antiInfo.anti ? 'ok' : 'warn',
        antiInfo.anti ? '已缓存 anti-content' : '暂无 anti，部分接口可能失败',
      );

      try {
        const orderSn = String(orderSnIn ?? '').trim();
        let afterSalesId = Math.floor(Number(afterSalesIdIn)) || 0;
        if (!orderSn) throw new Error('缺少订单号：请先点击「发起申诉」打开弹窗，或在面板填写订单号');

        let canAppealItem: CanAppealInfoItem | null = null;
        try {
          const listJson = await postJson(
            API_QUERY_CAN_APPEAL_LIST,
            {
              needCheckAppeal: true,
              pageIndex: 1,
              pageSize: 50,
              subAppealQueryType: 1,
              orderByPreCheckResultDesc: true,
              searchWillExpire: false,
              filterNoAppealMarkAndLowPass: true,
            },
            referer,
          );
          const items = unwrapCanAppealList(listJson);
          cacheCanAppealList(items);
          canAppealItem = pickCanAppealItem(items, orderSn, afterSalesId);
          log(
            '可申诉列表',
            canAppealItem ? 'ok' : 'warn',
            canAppealItem
              ? `命中订单 · 可申诉货款 ${canAppealItem.canCargoAppealAmount != null ? (Number(canAppealItem.canCargoAppealAmount) / 100).toFixed(2) : '—'} 元`
              : '列表中未找到该订单（仍继续拉售后/聊天）',
          );
        } catch (err) {
          log('可申诉列表', 'warn', err instanceof Error ? err.message : String(err));
        }

        if (!afterSalesId && canAppealItem?.afterSalesId) {
          afterSalesId = Number(canAppealItem.afterSalesId);
        }
        if (!afterSalesId) throw new Error('缺少售后单号 afterSalesId：请先在列表点击「发起申诉」打开弹窗');

        writeActiveOrder({
          orderSn,
          afterSalesId,
          updatedAt: Date.now(),
          source: 'manual',
          canAppealItem: canAppealItem ?? undefined,
        });

        let checkAppeal = null;
        try {
          const appealSubTypes = canAppealItem
            ? allowedAppealSubTypesFromCanAppeal(canAppealItem)
            : [...DEFAULT_CHECK_APPEAL_SUB_TYPES];
          const ckJson = await postJson(
            API_CHECK_APPEAL,
            {
              orderSn,
              afterSalesId,
              checkAppealSource: 1000,
              needCheckAppealSubTypes: appealSubTypes,
              checkMustPass: false,
              appealSubTypes,
            },
            referer,
          );
          checkAppeal = unwrapCheckAppeal(ckJson);
          cacheCheckAppeal(orderSn, afterSalesId, ckJson);
          log('申诉校验', 'ok', '已拉取申诉原因树（checkAppeal）');
        } catch (err) {
          log('申诉校验', 'warn', err instanceof Error ? err.message : String(err));
        }

        let complainTypes: AftersaleAppealSnapshot['complainTypes'] = [];
        try {
          const ctJson = await postJson(API_COMPLAIN_TYPE, {}, referer);
          complainTypes = unwrapComplainTypes(ctJson);
          cacheComplainTypes(ctJson);
          log('投诉类型', complainTypes.length ? 'ok' : 'warn', `共 ${complainTypes.length} 项`);
        } catch (err) {
          log('投诉类型', 'warn', err instanceof Error ? err.message : String(err));
        }

        let afterSales: AftersaleAppealSnapshot['afterSales'] = [];
        let afterSalesError: string | undefined;
        try {
          const asJson = await postJson(
            API_AFTER_SALES_LIST,
            {
              pageSize: 10,
              searchText: orderSn,
              pageNumber: 1,
              orderByCreatedAtDesc: true,
            },
            'https://mms.pinduoduo.com/aftersales/aftersale_list?msfrom=mms_sidenav',
          );
          afterSales = unwrapAfterSalesList(asJson);
          log('售后列表', afterSales.length ? 'ok' : 'warn', `共 ${afterSales.length} 条`);
        } catch (err) {
          afterSalesError = err instanceof Error ? err.message : String(err);
          log('售后列表', 'error', afterSalesError);
        }

        let orderDetail: Record<string, unknown> | null = null;
        let orderDetailError: string | undefined;
        try {
          const odJson = await postJson(
            API_ORDER_DETAIL,
            { orderSn, source: 'MMS' },
            `https://mms.pinduoduo.com/aftersales-ssr/detail?id=${afterSalesId}&orderSn=${orderSn}`,
          );
          orderDetail = unwrapOrderDetail(odJson);
          log('订单详情', 'ok', String(orderDetail.order_status_str ?? orderDetail.order_sn ?? ''));
        } catch (err) {
          orderDetailError = err instanceof Error ? err.message : String(err);
          log('订单详情', 'warn', orderDetailError);
        }

        let logistics: AftersaleAppealSnapshot['logistics'] = null;
        let logisticsError: string | undefined;
        try {
          const trUrl = `${API_LOGISTICS_TRACK}?orderSn=${encodeURIComponent(orderSn)}&source=MMS_TRACK_STATUS`;
          const trJson = await originalFetch(trUrl, {
            method: 'GET',
            headers: buildHeaders({
              Referer: referer,
            }),
            credentials: 'include',
          }).then(async (res) => {
            const text = await res.text();
            return JSON.parse(text) as unknown;
          });
          const tr = unwrapLogisticsTrack(trJson);
          logistics = {
            trackingNumber:
              tr.trackingNumber ||
              String(orderDetail?.tracking_number ?? canAppealItem?.orderSn ?? ''),
            traces: tr.traces,
            raw: trJson,
          };
          log(
            '物流轨迹',
            tr.traces.length ? 'ok' : 'warn',
            tr.traces.length ? `共 ${tr.traces.length} 条` : '无轨迹或接口未返回',
          );
        } catch (err) {
          logisticsError = err instanceof Error ? err.message : String(err);
          log('物流轨迹', 'warn', logisticsError);
        }

        let chatRows: AftersaleAppealSnapshot['chatRows'] = [];
        let chatError: string | undefined;
        try {
          const nowSec = Math.floor(Date.now() / 1000);
          const res = await originalFetch(API_CHAT_HISTORY, {
            method: 'POST',
            headers: buildHeaders({ Referer: MMS_CHAT_REFERER_AI }),
            body: JSON.stringify({
              startTime: nowSec - 180 * 24 * 3600,
              endTime: nowSec,
              orderSn,
              pageSize: 50,
              pageNum: 0,
            }),
            credentials: 'include',
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const chat = parseChatHistoryResponse(text);
          chatRows = chat.rows;
          if (chat.outcome === 'failed') {
            chatError = chat.failureDetail ?? '聊天解析失败';
            log('聊天记录', 'error', chatError);
          } else {
            log('聊天记录', 'ok', `共 ${chatRows.length} 条`);
          }
        } catch (err) {
          chatError = err instanceof Error ? err.message : String(err);
          log('聊天记录', 'error', chatError);
        }

        let reviews: ReviewItem[] = [];
        let reviewsError: string | undefined;
        if (!antiInfo.anti) {
          reviewsError = '缺少 anti-content';
          log('商品评价', 'warn', reviewsError);
        } else {
          try {
            const endTime = Math.floor(Date.now() / 1000);
            const json = await postJson(
              API_REVIEWS_LIST,
              {
                startTime: endTime - 90 * 24 * 3600,
                endTime,
                pageNo: 1,
                pageSize: 40,
                orderSn,
                descScore: ['1', '2', '3', '4', '5'],
              },
              'https://mms.pinduoduo.com/goods/evaluation/index',
            );
            const norm = normalizeReviewsResponse(json);
            reviews = (norm.data ?? []).filter((r) => String(r.orderSn ?? '').trim() === orderSn);
            log('商品评价', reviews.length ? 'ok' : 'warn', `命中 ${reviews.length} 条`);
          } catch (err) {
            reviewsError = err instanceof Error ? err.message : String(err);
            log('商品评价', 'error', reviewsError);
          }
        }

        const snapshot: AftersaleAppealSnapshot = {
          orderSn,
          afterSalesId,
          fetchedAt: Date.now(),
          canAppealItem,
          checkAppeal,
          complainTypes,
          afterSales,
          afterSalesError,
          orderDetail,
          orderDetailError,
          logistics,
          logisticsError,
          chatRows,
          chatError,
          reviews,
          reviewsError,
          fetchLogs: logs,
          hasAntiContent: Boolean(antiInfo.anti),
        };

        log('完成', 'ok', '售后申诉数据采集结束');

        window.postMessage(
          {
            source: ASA_MSG_SOURCE_INJECT,
            type: ASA_MSG_FETCH_RESULT,
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
            source: ASA_MSG_SOURCE_INJECT,
            type: ASA_MSG_FETCH_RESULT,
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
