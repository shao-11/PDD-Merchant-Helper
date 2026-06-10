/**
 * 活动价确认页等：从 DOM 提取商品 ID（与 inject MAIN、content overlay 共用）。
 * 须优先「商品信息」主区域，避免全页 tr / URL 旧参数拿到其它商品 ID。
 * 若 MAIN 已从 leekmms rule 接口写入 session，在**无法从「商品信息」卡片读到 ID 时**作为兜底（与 enroll 体一致）。
 */

import { readActivityRuleGoodsIdsFromSession } from './activity-rule-goods-cache';

function pushUnique(out: string[], seen: Set<string>, raw: string): void {
  const t = raw.replace(/\D/g, '');
  if (t.length < 6 || t.length > 15) return;
  if (seen.has(t)) return;
  seen.add(t);
  out.push(t);
}

/** 从文本行提取「ID: / 商品ID」后的数字 */
function extractIdFromLabelText(txt: string): string | null {
  const compact = txt.replace(/\s+/g, ' ').trim();
  const m =
    compact.match(/(?:商品)?ID[：:\s]*(\d{6,15})\b/i) ||
    compact.match(/goods[_\s-]?id[：:\s]*(\d{6,15})\b/i);
  return m ? m[1] : null;
}

function isLikelyVisible(el: HTMLElement): boolean {
  try {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch {
    return true;
  }
}

/**
 * 活动确认页「商品信息」标题附近的卡片根节点（含当前行商品 ID）。
 * 找不到时返回 null，由调用方退回全页扫描。
 */
export function findActivityGoodsInfoRoot(doc: Document): HTMLElement | null {
  const markers = doc.querySelectorAll('div,span,h2,h3,h4,p,section,header');
  for (let i = 0; i < markers.length; i++) {
    const el = markers[i] as HTMLElement;
    if (!isLikelyVisible(el)) continue;
    const raw = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (raw.length > 48) continue;
    if (!/^商品信息/.test(raw) && raw !== '商品信息' && !/^商品基本信息/.test(raw)) continue;
    let p: HTMLElement | null = el;
    for (let up = 0; up < 16 && p; up++) {
      const txt = String(p.textContent || '');
      if (txt.length > 14000) break;
      if (/ID[：:\s]*\d{6,15}/i.test(txt)) return p;
      p = p.parentElement;
    }
  }
  return null;
}

function collectGoodsIdTextsUnder(container: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const selectors = [
    'div[class*="columns_id__"]',
    '[class*="columns_id"]',
    '[class*="ColumnsId"]',
    '[data-field*="goods"]',
    '[data-testid*="goods"]',
  ];
  for (const sel of selectors) {
    try {
      container.querySelectorAll(sel).forEach((node) => {
        const txt = String(node.textContent || '');
        const hit = extractIdFromLabelText(txt);
        if (hit) pushUnique(out, seen, hit);
      });
    } catch {
      /* ignore */
    }
  }

  try {
    container.querySelectorAll('tr, [role="row"], .ant-table-row').forEach((row) => {
      const txt = String(row.textContent || '');
      if (txt.length > 4000) return;
      if (!/ID/i.test(txt)) return;
      const hit = extractIdFromLabelText(txt);
      if (hit) pushUnique(out, seen, hit);
    });
  } catch {
    /* ignore */
  }

  return out;
}

/**
 * 从当前 document 收集商品 ID 字符串（去重、顺序尽量稳定）。
 * 优先仅在「商品信息」区域内解析，避免与列表中其它商品、URL 残留 id 混用。
 */
function asActivityDocument(root?: Pick<Document | HTMLElement, 'querySelectorAll'>): Document {
  if (!root) return document;
  if (root instanceof Document) return root;
  try {
    return (root as HTMLElement).ownerDocument ?? document;
  } catch {
    return document;
  }
}

/** 仅从「商品信息」卡片区域解析 ID（最贴近当前行，不读全页、不读 rule 缓存） */
export function parseGoodsIdsFromActivityGoodsInfoCard(doc: Document): number[] {
  const scope = findActivityGoodsInfoRoot(doc);
  if (!scope) return [];
  const texts = collectGoodsIdTextsUnder(scope);
  const nums = texts.map((t) => Math.floor(Number(t))).filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)];
}

export function parseActivityConfirmGoodsIdTextsFromDom(
  root: Pick<Document | HTMLElement, 'querySelectorAll'> = document
): string[] {
  if (root === document || root === document.documentElement) {
    const scope = findActivityGoodsInfoRoot(document);
    if (scope) {
      const scoped = collectGoodsIdTextsUnder(scope);
      if (scoped.length > 0) return scoped;
    }
  }
  const base: Element =
    root instanceof Document ? (root.body ?? root.documentElement) : (root as Element);
  return collectGoodsIdTextsUnder(base);
}

/**
 * 数字数组（正数、去重）。
 * **顺序**：先「商品信息」卡片 DOM（与当前页表格行一致）→ 再 rule 接口写入 session（与 enroll 体一致，作兜底）→ 最后全页扫描。
 * 曾优先 session 会导致换商品后仍沿用旧 goods_id（与页面 ID 不一致）。
 */
export function parseActivityConfirmGoodsIdsFromDom(
  root?: Pick<Document | HTMLElement, 'querySelectorAll'>
): number[] {
  const doc = asActivityDocument(root);
  const fromGoodsInfo = parseGoodsIdsFromActivityGoodsInfoCard(doc);
  if (fromGoodsInfo.length > 0) return fromGoodsInfo;

  const fromRule = readActivityRuleGoodsIdsFromSession();
  if (fromRule.length > 0) return fromRule;

  const texts = parseActivityConfirmGoodsIdTextsFromDom(root ?? doc);
  const nums = texts.map((t) => Math.floor(Number(t))).filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)];
}
