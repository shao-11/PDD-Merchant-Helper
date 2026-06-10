/**
 * 评价列表「本地展示」纯函数：搜索、差评关键词、排序、汇总。
 * 仅处理已捕获的 ReviewItem，不触碰接口与注入脚本。
 */
import type { ReviewItem } from '../types/reviews';
import { parseSpecs } from './specs';

/** 内置负面词（子串匹配，不区分大小写） */
export const DEFAULT_NEGATIVE_KEYWORDS = [
  '差',
  '烂',
  '假',
  '不好',
  '劣质',
  '骗人',
  '退货',
  '差评',
  '难吃',
  '破损',
];

export function reviewCommentMatchesNegative(comment: string | undefined, words: string[]): boolean {
  if (!comment?.trim()) return false;
  const t = comment.toLowerCase();
  return words.some((w) => {
    const x = w.trim().toLowerCase();
    return x.length > 0 && t.includes(x);
  });
}

export function filterReviewsBySearch(rows: ReviewItem[], q: string): ReviewItem[] {
  const query = q.trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((r) => {
    const hay = [
      r.orderSn,
      r.goodsId != null ? String(r.goodsId) : '',
      r.goodsName,
      r.comment,
      r.name,
      parseSpecs(r.specs),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return hay.includes(query);
  });
}

export function filterReviewsByNegative(rows: ReviewItem[], enabled: boolean, words: string[]): ReviewItem[] {
  if (!enabled) return rows;
  return rows.filter((r) => reviewCommentMatchesNegative(r.comment, words));
}

/** 举报筛选：依赖接口返回的 reportResult 文案/status，仅本地匹配 */
export type ReportStatusFilterMode = 'all' | 'not_reported' | 'report_success';

function joinReportText(r: ReviewItem): string {
  const rr = r.reportResult;
  if (!rr) return '';
  return [rr.desc, rr.clientDesc].filter(Boolean).join(' ').trim();
}

/** 未被举报：无举报信息，或文案/状态表明未举报 */
export function isReviewNotReported(r: ReviewItem): boolean {
  const rr = r.reportResult;
  if (!rr) return true;
  const text = joinReportText(r);
  if (/未被举报|未举报|无举报|尚未举报/i.test(text)) return true;
  if (!text && rr.status === 99) return true;
  return false;
}

/** 举报成功：文案命中成功类表述（平台措辞变化时可扩充正则） */
export function isReviewReportSuccess(r: ReviewItem): boolean {
  const rr = r.reportResult;
  if (!rr) return false;
  const text = joinReportText(r);
  if (
    /举报成功|已成功举报|举报已通过|受理成功|举报受理成功|处理完成|已通过举报|举报.*成功/i.test(text)
  ) {
    return true;
  }
  return false;
}

export function filterReviewsByReportStatus(
  rows: ReviewItem[],
  mode: ReportStatusFilterMode
): ReviewItem[] {
  if (mode === 'all') return rows;
  if (mode === 'not_reported') return rows.filter(isReviewNotReported);
  return rows.filter(isReviewReportSuccess);
}

export type ReviewSortMode = 'timeDesc' | 'timeAsc' | 'orderSnAsc' | 'goodsNameAsc';

export function sortReviews(rows: ReviewItem[], mode: ReviewSortMode): ReviewItem[] {
  const arr = [...rows];
  const cmpTime = (a: ReviewItem, b: ReviewItem) => (a.createTime ?? 0) - (b.createTime ?? 0);
  const cmpOrder = (a: ReviewItem, b: ReviewItem) => (a.orderSn ?? '').localeCompare(b.orderSn ?? '', 'zh-CN');
  const cmpGoods = (a: ReviewItem, b: ReviewItem) => (a.goodsName ?? '').localeCompare(b.goodsName ?? '', 'zh-CN');
  switch (mode) {
    case 'timeDesc':
      arr.sort((a, b) => -cmpTime(a, b));
      break;
    case 'timeAsc':
      arr.sort(cmpTime);
      break;
    case 'orderSnAsc':
      arr.sort(cmpOrder);
      break;
    case 'goodsNameAsc':
      arr.sort(cmpGoods);
      break;
    default:
      break;
  }
  return arr;
}

export function summarizeReviews(rows: ReviewItem[]): {
  count: number;
  minTime: number | undefined;
  maxTime: number | undefined;
  withPicCount: number;
  withPicPct: number | null;
} {
  if (rows.length === 0) {
    return { count: 0, minTime: undefined, maxTime: undefined, withPicCount: 0, withPicPct: null };
  }
  let minT: number | undefined;
  let maxT: number | undefined;
  let withPic = 0;
  for (const r of rows) {
    const t = r.createTime;
    if (typeof t === 'number') {
      if (minT === undefined || t < minT) minT = t;
      if (maxT === undefined || t > maxT) maxT = t;
    }
    if ((r.pictures?.length ?? 0) > 0) withPic++;
  }
  return {
    count: rows.length,
    minTime: minT,
    maxTime: maxT,
    withPicCount: withPic,
    withPicPct: rows.length ? Math.round((withPic * 1000) / rows.length) / 10 : null,
  };
}
