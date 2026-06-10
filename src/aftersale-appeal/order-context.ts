import type { CanAppealInfoItem, AftersaleAppealRecommendation, AftersaleAppealSnapshot } from './types';
import {
  LS_ASA_ACTIVE_ORDER,
  LS_ASA_CAN_APPEAL_LIST,
  LS_ASA_CHECK_APPEAL,
  LS_ASA_COMPLAIN_TYPES,
  LS_ASA_LAST_ANALYSIS,
} from './constants';
import { parseOrderFromRightsAppealModal } from './page-context';

export type ActiveAppealOrder = {
  orderSn: string;
  afterSalesId: number;
  updatedAt: number;
  source: 'modal' | 'checkAppeal' | 'list' | 'manual';
  canAppealItem?: CanAppealInfoItem;
};

export function readActiveOrder(): ActiveAppealOrder | null {
  try {
    const raw = localStorage.getItem(LS_ASA_ACTIVE_ORDER);
    if (!raw) return null;
    const o = JSON.parse(raw) as ActiveAppealOrder;
    if (!o?.orderSn) return null;
    return o;
  } catch {
    return null;
  }
}

export function writeActiveOrder(ctx: ActiveAppealOrder): void {
  try {
    localStorage.setItem(LS_ASA_ACTIVE_ORDER, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
}

export function syncActiveOrderFromModal(): ActiveAppealOrder | null {
  const parsed = parseOrderFromRightsAppealModal();
  if (!parsed?.orderSn) return null;
  const prev = readActiveOrder();
  const item = findCanAppealItem(parsed.orderSn) ?? prev?.canAppealItem;
  const ctx: ActiveAppealOrder = {
    orderSn: parsed.orderSn,
    afterSalesId: parsed.afterSalesId || prev?.afterSalesId || item?.afterSalesId || 0,
    updatedAt: Date.now(),
    source: 'modal',
    canAppealItem: item ?? undefined,
  };
  writeActiveOrder(ctx);
  return ctx;
}

export function cacheCanAppealList(items: CanAppealInfoItem[]): void {
  try {
    localStorage.setItem(LS_ASA_CAN_APPEAL_LIST, JSON.stringify({ items, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function findCanAppealItem(orderSn: string): CanAppealInfoItem | null {
  try {
    const raw = localStorage.getItem(LS_ASA_CAN_APPEAL_LIST);
    if (!raw) return null;
    const o = JSON.parse(raw) as { items?: CanAppealInfoItem[] };
    const hit = (o.items ?? []).find((x) => String(x.orderSn ?? '').trim() === orderSn.trim());
    return hit ?? null;
  } catch {
    return null;
  }
}

export function cacheCheckAppeal(orderSn: string, afterSalesId: number, data: unknown): void {
  try {
    localStorage.setItem(
      LS_ASA_CHECK_APPEAL,
      JSON.stringify({ orderSn, afterSalesId, data, ts: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function readCachedCheckAppeal(orderSn: string, afterSalesId: number): unknown | null {
  try {
    const raw = localStorage.getItem(LS_ASA_CHECK_APPEAL);
    if (!raw) return null;
    const o = JSON.parse(raw) as { orderSn?: string; afterSalesId?: number; data?: unknown };
    if (o.orderSn !== orderSn || Number(o.afterSalesId) !== afterSalesId) return null;
    return o.data ?? null;
  } catch {
    return null;
  }
}

export function cacheComplainTypes(list: unknown): void {
  try {
    localStorage.setItem(LS_ASA_COMPLAIN_TYPES, JSON.stringify({ list, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function readCachedComplainTypes(): unknown[] {
  try {
    const raw = localStorage.getItem(LS_ASA_COMPLAIN_TYPES);
    if (!raw) return [];
    const o = JSON.parse(raw) as { list?: unknown };
    if (Array.isArray(o.list)) return o.list;
    const nested = o.list as { complainTypeList?: unknown[] };
    if (Array.isArray(nested?.complainTypeList)) return nested.complainTypeList;
    return [];
  } catch {
    return [];
  }
}

const DEFAULT_ANALYSIS_CACHE_MS = 60 * 60 * 1000;

export function cacheLastAnalysis(
  orderSn: string,
  afterSalesId: number,
  snapshot: AftersaleAppealSnapshot,
  recommendation: AftersaleAppealRecommendation,
): void {
  try {
    localStorage.setItem(
      LS_ASA_LAST_ANALYSIS,
      JSON.stringify({
        orderSn,
        afterSalesId,
        snapshot,
        recommendation,
        ts: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

export function readCachedAnalysis(
  orderSn: string,
  afterSalesId: number,
  maxAgeMs = DEFAULT_ANALYSIS_CACHE_MS,
): {
  snapshot: AftersaleAppealSnapshot;
  recommendation: AftersaleAppealRecommendation;
} | null {
  try {
    const raw = localStorage.getItem(LS_ASA_LAST_ANALYSIS);
    if (!raw) return null;
    const o = JSON.parse(raw) as {
      orderSn?: string;
      afterSalesId?: number;
      snapshot?: AftersaleAppealSnapshot;
      recommendation?: AftersaleAppealRecommendation;
      ts?: number;
    };
    if (o.orderSn !== orderSn || Number(o.afterSalesId) !== afterSalesId) return null;
    if (!o.snapshot || !o.recommendation) return null;
    if (maxAgeMs > 0 && o.ts && Date.now() - o.ts > maxAgeMs) return null;
    return { snapshot: o.snapshot, recommendation: o.recommendation };
  } catch {
    return null;
  }
}

/** 解析当前应分析的订单：优先弹窗，其次缓存的活跃订单 */
export function resolveAnalysisTarget(
  orderSnIn = '',
  afterSalesIdIn = 0,
): { orderSn: string; afterSalesId: number } | null {
  const manualSn = orderSnIn.trim();
  if (manualSn) {
    const item = findCanAppealItem(manualSn);
    const id =
      afterSalesIdIn > 0
        ? afterSalesIdIn
        : item?.afterSalesId ?? readActiveOrder()?.afterSalesId ?? 0;
    return { orderSn: manualSn, afterSalesId: id };
  }

  const fromModal = syncActiveOrderFromModal();
  if (fromModal?.orderSn) {
    return {
      orderSn: fromModal.orderSn,
      afterSalesId: fromModal.afterSalesId || fromModal.canAppealItem?.afterSalesId || 0,
    };
  }

  const active = readActiveOrder();
  if (active?.orderSn) {
    return {
      orderSn: active.orderSn,
      afterSalesId: active.afterSalesId || active.canAppealItem?.afterSalesId || 0,
    };
  }

  return null;
}
