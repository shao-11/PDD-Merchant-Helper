/**
 * 从商家后台当前页 URL / 活动确认页 DOM 尽力补充活动助手参数（不覆盖已有填写）。
 * 模板名称 URL 较少带全名，优先读查询串常见键；完整名仍建议从面板核对。
 */

import { parseActivityConfirmGoodsIdsFromDom } from './parse-activity-page';

/** 合并 pathname search 与 hash 内查询串（兼容 #/path?a=1） */
export function collectUrlSearchParams(href: string): URLSearchParams {
  try {
    const u = new URL(href);
    const out = new URLSearchParams(u.search);
    const hash = u.hash.replace(/^#/, '');
    const qi = hash.indexOf('?');
    if (qi >= 0) {
      const inner = new URLSearchParams(hash.slice(qi + 1));
      inner.forEach((v, k) => {
        out.set(k, v);
      });
    }
    return out;
  } catch {
    return new URLSearchParams();
  }
}

/** 运费模板编辑类页面：…/carriage/edit、…/cost_template/edit 等，取 id / templateId */
export function parseCarriageEditTemplateId(href: string): number | null {
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    const looksFreightEdit =
      path.includes('carriage/edit') ||
      path.includes('cost_template/edit') ||
      path.includes('freight') && path.includes('/edit');
    if (!looksFreightEdit) return null;
    const params = collectUrlSearchParams(href);
    const idRaw = params.get('id') ?? params.get('templateId') ?? params.get('costTemplateId');
    if (!idRaw) return null;
    const n = Math.floor(Number(idRaw));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** 运费编辑页 URL 中偶见模板名称查询参数 */
export function parseCarriageTemplateNameFromUrl(href: string): string {
  const params = collectUrlSearchParams(href);
  const v =
    params.get('templateName') ??
    params.get('costTemplateName') ??
    params.get('name') ??
    '';
  return v.replace(/[\r\n\t]/g, '').trim().slice(0, 120);
}

const GOODS_QUERY_KEYS = [
  'goods_id',
  'goodsId',
  'goods_ids',
  'goodsIds',
  'goodsID',
  'sku_id',
  'skuId',
  'spu_id',
  'spuId',
];

function pushGoodsDigits(seen: Set<number>, raw: string): void {
  for (const part of raw.split(/[,，\s]+/)) {
    const n = Math.floor(Number(part.trim()));
    if (Number.isFinite(n) && n > 0) seen.add(n);
  }
}

/** 从查询参数 + 整段 href 正则收集商品 ID（活动确认页等） */
export function parseGoodsIdsFromPageUrl(href: string): number[] {
  const seen = new Set<number>();
  const params = collectUrlSearchParams(href);
  for (const key of GOODS_QUERY_KEYS) {
    const raw = params.get(key);
    if (raw) pushGoodsDigits(seen, raw);
  }
  try {
    const h = decodeURIComponent(href);
    const rxList = [/goods[Ii]d=(\d{6,15})\b/g, /goods_id=(\d{6,15})\b/g, /spu[Ii]d=(\d{6,15})\b/g];
    for (const rx of rxList) {
      let m: RegExpExecArray | null;
      const r = new RegExp(rx.source, rx.flags);
      while ((m = r.exec(h)) !== null) {
        const n = Math.floor(Number(m[1]));
        if (Number.isFinite(n) && n > 0) seen.add(n);
      }
    }
  } catch {
    /* ignore */
  }
  return [...seen];
}

/** 活动价确认页或批量报名成功页（与 overlay 浮动按钮路径一致） */
export function isGoodsPriceConfirmUrl(href: string): boolean {
  try {
    const u = new URL(href);
    const pl = u.pathname.toLowerCase();
    if (pl.includes('goods_price') && pl.includes('confirm')) return true;
    if (pl.includes('/act/sign/success_batch')) return true;
    return false;
  } catch {
    return false;
  }
}

/** 活动确认页 / 批量报名成功页：优先 DOM；再 URL */
export function parseGoodsIdsFromActivityPage(href: string): number[] {
  let onActivityAssistPage = false;
  try {
    const u = new URL(href);
    const pl = u.pathname.toLowerCase();
    onActivityAssistPage =
      (pl.includes('goods_price') && pl.includes('confirm')) || pl.includes('/act/sign/success_batch');
  } catch {
    return [];
  }

  if (onActivityAssistPage && typeof document !== 'undefined') {
    const fromDom = parseActivityConfirmGoodsIdsFromDom(document);
    if (fromDom.length > 0) return fromDom;
  }

  const fromUrl = parseGoodsIdsFromPageUrl(href);
  if (fromUrl.length > 0) return fromUrl;

  return [];
}
