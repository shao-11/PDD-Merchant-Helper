import type { AppealSnapshot } from './types';

export type QcReportMatch = {
  ruleId: string;
  files: string[];
  detail: string;
  source?: 'sheet';
  sheetSpecName?: string;
};

function normalizeProductText(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** 合并旺店通 skuName、tuju、售后、评价，供本地质检表模糊匹配（旺店通名优先） */
export function buildProductMatchText(snapshot: AppealSnapshot): string {
  const parts: string[] = [];
  if (snapshot.huiceSkuNames?.length) {
    parts.push(...snapshot.huiceSkuNames);
  }
  const t = snapshot.tuju;
  if (t?.goodsName) parts.push(String(t.goodsName));
  if (t?.explanation) parts.push(String(t.explanation));

  for (const a of snapshot.afterSales ?? []) {
    if (a.goodsName) parts.push(String(a.goodsName));
    if (a.goodsSpec) parts.push(String(a.goodsSpec));
    if (a.afterSalesTitle) parts.push(String(a.afterSalesTitle));
  }

  for (const r of snapshot.reviews ?? []) {
    if (r.goodsName) parts.push(String(r.goodsName));
    if (r.specs) parts.push(String(r.specs));
  }

  return normalizeProductText(parts.join(' '));
}
