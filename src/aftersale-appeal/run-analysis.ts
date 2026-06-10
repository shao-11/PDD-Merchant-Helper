import { enrichSnapshotWithHuice } from '../negative-appeal/huice/enrich-snapshot';
import type { AppealSnapshot } from '../negative-appeal/types';
import { buildAftersaleRecommendation } from './ollama-client';
import { fetchAftersaleAppealSnapshotViaPage } from './fetch-bridge';
import { cacheLastAnalysis, readCachedAnalysis, resolveAnalysisTarget } from './order-context';
import { pickAfterSaleRow } from './api-unwrap';
import type { AftersaleAppealRecommendation, AftersaleAppealSnapshot } from './types';

export type AftersaleAnalysisResult = {
  snapshot: AftersaleAppealSnapshot;
  recommendation: AftersaleAppealRecommendation;
  fetchLogs: AftersaleAppealSnapshot['fetchLogs'];
  fromCache?: boolean;
};

async function enrichHuiceForAftersale(
  snapshot: AftersaleAppealSnapshot,
): Promise<AftersaleAppealSnapshot> {
  const after = pickAfterSaleRow(snapshot.afterSales, snapshot.orderSn, snapshot.afterSalesId);
  const skuCodeRegex = /\bSKU[0-9A-Z-]{4,}\b/gi;
  const skuFieldRegex =
    /sku(no|_no|code|_code)?|goods(no|_no|code|_code)|spec(no|_no|code|_code)|spSkuNo|outerSkuNo/i;
  const preferredSkuCodesSet = new Set<string>();
  const collectFrom = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!skuFieldRegex.test(k)) continue;
      const text = String(v ?? '');
      const m = text.match(skuCodeRegex);
      if (m) m.forEach((x) => preferredSkuCodesSet.add(x.toUpperCase()));
    }
  };
  collectFrom(snapshot.canAppealItem);
  collectFrom(after);
  const preferredSkuCodes = [...preferredSkuCodesSet];
  const preferredGoodsParts = [
    String(after?.goodsName ?? '').trim(),
    String(after?.goodsSpec ?? '').trim(),
    String(snapshot.canAppealItem?.goodsName ?? '').trim(),
    String(snapshot.canAppealItem?.goodsSpec ?? '').trim(),
  ].filter(Boolean);
  const preferredGoodsText = [...new Set(preferredGoodsParts)].join(' ');

  const wrap: AppealSnapshot = {
    ticketSn: '',
    orderSn: snapshot.orderSn,
    fetchedAt: snapshot.fetchedAt,
    tuju: {
      ...(snapshot.canAppealItem ?? {}),
      ...(snapshot.orderDetail ?? {}),
      goodsName: after?.goodsName ?? snapshot.canAppealItem?.goodsName,
      goodsSpec: after?.goodsSpec ?? snapshot.canAppealItem?.goodsSpec,
    },
    chatRows: snapshot.chatRows,
    afterSales: snapshot.afterSales,
    reviews: snapshot.reviews,
    fetchLogs: snapshot.fetchLogs,
    hasAntiContent: snapshot.hasAntiContent,
    huicePreferredSkuCodes: preferredSkuCodes,
    huicePreferredGoodsText: preferredGoodsText,
  };
  const enriched = await enrichSnapshotWithHuice(wrap);
  return {
    ...snapshot,
    huiceSkuNames: enriched.huiceSkuNames,
    huiceError: enriched.huiceError,
    fetchLogs: enriched.fetchLogs ?? snapshot.fetchLogs,
  };
}

export async function fetchEnrichedAftersaleSnapshot(
  orderSn = '',
  afterSalesId = 0,
): Promise<AftersaleAppealSnapshot> {
  let snap = await fetchAftersaleAppealSnapshotViaPage(orderSn, afterSalesId);
  snap = await enrichHuiceForAftersale(snap);
  return snap;
}

export async function runFullAftersaleAppealAnalysis(
  orderSn = '',
  afterSalesId = 0,
  options?: { forceRefresh?: boolean },
): Promise<AftersaleAnalysisResult> {
  const resolved = resolveAnalysisTarget(orderSn, afterSalesId);
  if (resolved && !options?.forceRefresh) {
    const cached = readCachedAnalysis(resolved.orderSn, resolved.afterSalesId);
    if (cached) {
      return {
        snapshot: cached.snapshot,
        recommendation: cached.recommendation,
        fetchLogs: cached.snapshot.fetchLogs ?? [],
        fromCache: true,
      };
    }
  }

  let snap = await fetchEnrichedAftersaleSnapshot(orderSn, afterSalesId);
  const recommendation = await buildAftersaleRecommendation(snap);
  const fetchLogs = [...(snap.fetchLogs ?? []), ...(recommendation.aiLogs ?? [])];
  cacheLastAnalysis(snap.orderSn, snap.afterSalesId, snap, recommendation);
  return { snapshot: snap, recommendation, fetchLogs, fromCache: false };
}
