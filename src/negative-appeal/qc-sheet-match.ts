import { buildProductMatchText } from './qc-report-match';
import type { QcReportMatch } from './qc-report-match';
import {
  extractCoreMatchTokens,
  extractWeightKey,
  normalizeForMatch,
  tokenizeForMatch,
} from './qc-sheet-text-utils';
import type { AppealSnapshot } from './types';
import type { QcSheetCatalog, QcSheetCatalogRow } from './qc-sheet-types';

const HEADER_SKIP_RE = /规格名称|质检报道|工作表|质检表/i;
const MATCH_SCORE_THRESHOLD = 80;
const MIN_SCORE_GAP = 20;

export function normalizeSpecName(s: string): string {
  return normalizeForMatch(s);
}

export { extractWeightKey };

function scoreAgainstPreferredGoods(
  huiceName: string,
  preferredGoodsTokens: string[],
): number {
  if (!preferredGoodsTokens.length) return 0;
  const ht = extractCoreMatchTokens(huiceName);
  if (!ht.length) return 0;
  let hit = 0;
  for (const t of ht) {
    if (
      preferredGoodsTokens.some(
        (p) => p === t || (t.length >= 3 && p.includes(t)) || (p.length >= 3 && t.includes(p)),
      )
    ) {
      hit += 1;
    }
  }
  return hit;
}

function prioritizedHuiceTexts(snapshot: AppealSnapshot): string[] {
  const huiceTexts = (snapshot.huiceSkuNames ?? []).map((s) => s.trim()).filter(Boolean);
  if (!huiceTexts.length) return [];

  const preferredGoods = [
    String(snapshot.tuju?.goodsName ?? '').trim(),
    ...snapshot.afterSales.map((a) => String(a.goodsName ?? '').trim()).filter(Boolean),
  ]
    .filter(Boolean)
    .join(' ');
  const preferredGoodsTokens = extractCoreMatchTokens(preferredGoods);
  if (!preferredGoodsTokens.length) return huiceTexts;

  return [...huiceTexts].sort((a, b) => {
    const sa = scoreAgainstPreferredGoods(a, preferredGoodsTokens);
    const sb = scoreAgainstPreferredGoods(b, preferredGoodsTokens);
    if (sb !== sa) return sb - sa;
    return b.length - a.length;
  });
}

function tokenOverlapScore(productNorm: string, specNorm: string): number {
  const pt = tokenizeForMatch(productNorm);
  const st = tokenizeForMatch(specNorm);
  if (!pt.length || !st.length) return 0;

  let hit = 0;
  for (const t of pt) {
    if (t.length < 2) continue;
    if (st.some((s) => s === t || s.includes(t) || t.includes(s))) hit += 1;
  }

  const union = new Set([...pt, ...st]).size;
  const ratio = hit / Math.max(pt.length, 1);
  return Math.round(ratio * 420 + hit * 35 + (union > 0 ? (hit / union) * 80 : 0));
}

function countCoreTokenHits(productText: string, specName: string): number {
  const pt = extractCoreMatchTokens(productText);
  const st = extractCoreMatchTokens(specName);
  if (!pt.length || !st.length) return 0;

  let hit = 0;
  for (const t of pt) {
    if (st.some((s) => s === t || (t.length >= 3 && s.includes(t)) || (s.length >= 3 && t.includes(s)))) {
      hit += 1;
    }
  }
  return hit;
}

/** 旺店通 skuName ↔ 飞牛质检图规格名（须品类核心词一致，禁止仅靠「云南」等通用词） */
export function scoreSpecMatch(productText: string, specName: string): number {
  const p = normalizeForMatch(productText);
  const s = normalizeForMatch(specName);
  if (!p || !s || HEADER_SKIP_RE.test(s)) return 0;

  const coreHits = countCoreTokenHits(productText, specName);
  if (coreHits === 0) return 0;

  const pWeight = extractWeightKey(p);
  const sWeight = extractWeightKey(s);
  if (pWeight && sWeight && pWeight !== sWeight) return 0;

  if (p === s) return 1000;
  if (p.includes(s)) return 850 + Math.min(s.length, 40);
  if (s.includes(p) && p.length >= 4) return 720 + Math.min(p.length, 40);

  const overlap = tokenOverlapScore(p, s);
  if (overlap >= 120) return overlap;

  return 0;
}

export function buildMatchCandidateTexts(snapshot: AppealSnapshot): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string): void => {
    const t = raw.trim();
    if (!t) return;
    const n = normalizeForMatch(t);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(t);
  };

  if (snapshot.huiceSkuNames?.length) {
    [...snapshot.huiceSkuNames]
      .sort((a, b) => b.length - a.length)
      .forEach((name) => push(name));
  }

  push(buildProductMatchText(snapshot));
  if (snapshot.tuju?.goodsName) push(String(snapshot.tuju.goodsName));

  return out;
}

export function matchQcSheetRow(productText: string, rows: QcSheetCatalogRow[]): QcSheetCatalogRow | null {
  return matchQcSheetRowWithScore(productText, rows)?.row ?? null;
}

export function matchQcSheetRowWithScore(
  productText: string,
  rows: QcSheetCatalogRow[],
): { row: QcSheetCatalogRow; score: number } | null {
  const ranked: { row: QcSheetCatalogRow; score: number }[] = [];
  for (const row of rows) {
    const hasImage = row.images.some((im) => im.dataBase64 || im.sourceUrl);
    if (!hasImage) continue;
    const sc = scoreSpecMatch(productText, row.specName);
    if (sc > 0) ranked.push({ row, score: sc });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < MATCH_SCORE_THRESHOLD) return null;
  if (second && best.score - second.score < MIN_SCORE_GAP) return null;
  return best;
}

function pickBestMatchForTexts(
  texts: string[],
  rows: QcSheetCatalogRow[],
): { row: QcSheetCatalogRow; score: number; via: string } | null {
  let best: { row: QcSheetCatalogRow; score: number; via: string } | null = null;
  for (const text of texts) {
    const hit = matchQcSheetRowWithScore(text, rows);
    if (!hit) continue;
    if (!best || hit.score > best.score) {
      best = { row: hit.row, score: hit.score, via: text };
    }
  }
  return best;
}

export function matchQcSheetRowForSnapshot(
  snapshot: AppealSnapshot,
  rows: QcSheetCatalogRow[],
): { row: QcSheetCatalogRow; score: number; via: string } | null {
  const huiceTexts = prioritizedHuiceTexts(snapshot);

  // 有旺店通规格时：只用旺店通匹配，避免评价/商品长标题里的「云南」「菌」误配到黑糖
  if (huiceTexts.length) {
    return pickBestMatchForTexts(huiceTexts, rows);
  }

  const texts = buildMatchCandidateTexts(snapshot);
  return pickBestMatchForTexts(texts, rows);
}

export function rankQcSheetRowsForSnapshot(
  snapshot: AppealSnapshot,
  rows: QcSheetCatalogRow[],
  limit = 4,
): { specName: string; score: number; hasImages: boolean }[] {
  const huiceTexts = prioritizedHuiceTexts(snapshot);
  const texts = huiceTexts.length ? huiceTexts : buildMatchCandidateTexts(snapshot);
  const bestByRow = new Map<string, number>();

  for (const text of texts) {
    for (const row of rows) {
      const sc = scoreSpecMatch(text, row.specName);
      const prev = bestByRow.get(row.specName) ?? 0;
      if (sc > prev) bestByRow.set(row.specName, sc);
    }
  }

  return [...bestByRow.entries()]
    .map(([specName, score]) => ({
      specName,
      score,
      hasImages:
        rows.find((r) => r.specName === specName)?.images.some((im) => im.dataBase64 || im.sourceUrl) ??
        false,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function matchQcReportsFromSheet(
  snapshot: AppealSnapshot,
  catalog: QcSheetCatalog,
): QcReportMatch | null {
  const hit = matchQcSheetRowForSnapshot(snapshot, catalog.rows);
  if (!hit) return null;
  return {
    ruleId: 'feiniu-share',
    files: hit.row.images.map((im) => im.fileName),
    detail: `质检表：${hit.row.specName}（${hit.row.images.length} 张）← ${hit.via}`,
    source: 'sheet',
    sheetSpecName: hit.specName,
  };
}
