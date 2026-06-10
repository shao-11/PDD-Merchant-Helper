import type { ReviewItem } from '../types/reviews';

/** 列表 reportResult 举报状态分类 */
export type ReportStatusBucket = 'unreported' | 'pending' | 'success' | 'failed' | 'other';

export type ReportStatusStats = {
  total: number;
  unreported: number;
  pending: number;
  success: number;
  failed: number;
  other: number;
  /** 已走过举报流程（待审核 + 成功 + 失败 + 其他） */
  reported: number;
  unreportedIds: string[];
};

/**
 * 依据 reportResult.status / desc 分类（与商家后台展示对齐）
 * - 99 / 未被举报 → 未举报
 * - 0 / 待审核 → 待审核
 * - 8 / 举报成功 → 成功
 * - 9 / 举报失败 → 失败
 */
export function classifyReportStatus(item: ReviewItem): ReportStatusBucket {
  const rr = item.reportResult;
  if (!rr || typeof rr !== 'object') return 'unreported';

  const st = rr.status;
  const desc = String(rr.desc ?? rr.clientDesc ?? '').trim();

  if (st === 99 || /未被举报/.test(desc)) return 'unreported';
  if (st === 0 || /待审核|审核中/.test(desc)) return 'pending';
  if (st === 8 || /举报成功/.test(desc)) return 'success';
  if (st === 9 || /举报失败/.test(desc)) return 'failed';

  if (typeof st === 'number' && st > 0 && st !== 99) return 'other';
  if (/已举报/.test(desc)) return 'other';

  return 'unreported';
}

/** 是否已举报（非「未被举报」均可视为已提交过举报） */
export function isReviewReported(item: ReviewItem): boolean {
  return classifyReportStatus(item) !== 'unreported';
}

export function summarizeReportStats(items: ReviewItem[]): ReportStatusStats {
  const unreportedIds: string[] = [];
  let unreported = 0;
  let pending = 0;
  let success = 0;
  let failed = 0;
  let other = 0;

  for (const it of items) {
    const id = String(it.reviewId ?? '').trim();
    if (!id) continue;

    const bucket = classifyReportStatus(it);
    switch (bucket) {
      case 'unreported':
        unreported += 1;
        unreportedIds.push(id);
        break;
      case 'pending':
        pending += 1;
        break;
      case 'success':
        success += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      default:
        other += 1;
        break;
    }
  }

  const reported = pending + success + failed + other;
  return {
    total: reported + unreported,
    unreported,
    pending,
    success,
    failed,
    other,
    reported,
    unreportedIds,
  };
}

export function partitionReviews(items: ReviewItem[]): {
  reported: ReviewItem[];
  unreported: ReviewItem[];
} {
  const reported: ReviewItem[] = [];
  const unreported: ReviewItem[] = [];
  for (const it of items) {
    if (isReviewReported(it)) reported.push(it);
    else unreported.push(it);
  }
  return { reported, unreported };
}
