import type { ReviewItem } from '../types/reviews';

function rowKey(r: ReviewItem): string {
  if (r.reviewId != null && String(r.reviewId).length > 0) return `id:${r.reviewId}`;
  if (r.orderSn) return `sn:${r.orderSn}:${r.createTime ?? 0}`;
  return `f:${r.goodsId ?? 0}:${r.createTime ?? 0}`;
}

/**
 * 合并多页捕获的评价行，按 reviewId / 订单号 去重；新数据覆盖同键旧数据。
 */
export function mergeReviewRows(prev: ReviewItem[] | undefined, incoming: ReviewItem[]): ReviewItem[] {
  const map = new Map<string, ReviewItem>();
  for (const r of prev ?? []) {
    map.set(rowKey(r), r);
  }
  for (const r of incoming) {
    map.set(rowKey(r), r);
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => (b.createTime ?? 0) - (a.createTime ?? 0));
  return arr;
}
