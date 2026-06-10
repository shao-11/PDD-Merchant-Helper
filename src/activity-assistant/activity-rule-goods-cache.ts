import { SESSION_STORAGE_ACTIVITY_RULE_GOODS_IDS_JSON } from './constants';

const MAX_AGE_MS = 15 * 60 * 1000;

/** 从 session 读取最近一次 rule 接口解析出的商品 ID（过期则忽略） */
export function readActivityRuleGoodsIdsFromSession(): number[] {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_ACTIVITY_RULE_GOODS_IDS_JSON);
    if (!raw) return [];
    const o = JSON.parse(raw) as { ids?: unknown; ts?: number };
    if (typeof o.ts !== 'number' || Date.now() - o.ts > MAX_AGE_MS) return [];
    if (!Array.isArray(o.ids)) return [];
    const out: number[] = [];
    for (const x of o.ids) {
      const n = Math.floor(Number(x));
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return [...new Set(out)];
  } catch {
    return [];
  }
}

export function snapshotActivityRuleGoodsIdsToSession(ids: number[]): void {
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  if (uniq.length === 0) return;
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_ACTIVITY_RULE_GOODS_IDS_JSON,
      JSON.stringify({ ids: uniq, ts: Date.now() })
    );
  } catch {
    /* ignore */
  }
}
