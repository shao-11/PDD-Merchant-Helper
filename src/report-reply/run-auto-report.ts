import { randomReportIntervalMs, sleepMs } from './report-delay';
import { rrLog } from './debug-log';
import type { AutoReportPageResult } from './auto-report-messages';
import { batchReportReviews, fetchLowStarReviews, warmReportReplyAnti } from './rpc';

const PAGE_WARMUP_MS = 3500;
const ANTI_RETRY_WAIT_MS = 6000;

/**
 * 在已打开的评价管理页执行自动举报（由 content 脚本调用）。
 */
export async function runAutoReportInPage(days: number): Promise<AutoReportPageResult> {
  rrLog('auto-report', 'info', '自动举报任务开始', { days });
  await sleepMs(PAGE_WARMUP_MS);

  let warm = await warmReportReplyAnti();
  if (!warm.hasAnti) {
    rrLog('auto-report', 'warn', '首次无 anti，等待后重试', { waitMs: ANTI_RETRY_WAIT_MS });
    await sleepMs(ANTI_RETRY_WAIT_MS);
    warm = await warmReportReplyAnti();
  }
  if (!warm.hasAnti) {
    return {
      total: 0,
      unreported: 0,
      reportedOk: 0,
      reportedFail: 0,
      skipped: true,
      message: '缺少 anti-content，请确认商家后台已登录且评价列表能正常打开',
    };
  }

  const summary = await fetchLowStarReviews(days);
  const ids = [...summary.unreportedIds];
  if (ids.length === 0) {
    return {
      total: summary.total,
      unreported: 0,
      reportedOk: 0,
      reportedFail: 0,
      skipped: false,
      message: '没有待举报的低星评价',
    };
  }

  let reportedOk = 0;
  let reportedFail = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!;
    try {
      const res = await batchReportReviews([id]);
      for (const r of res.results) {
        if (r.ok) reportedOk += 1;
        else reportedFail += 1;
      }
    } catch (e) {
      reportedFail += 1;
      rrLog('auto-report', 'error', '单条举报失败', {
        reviewId: id,
        err: e instanceof Error ? e.message : String(e),
      });
    }
    if (i < ids.length - 1) {
      await sleepMs(randomReportIntervalMs());
    }
  }

  rrLog('auto-report', 'info', '自动举报任务结束', {
    total: summary.total,
    unreported: summary.unreported,
    reportedOk,
    reportedFail,
  });

  return {
    total: summary.total,
    unreported: summary.unreported,
    reportedOk,
    reportedFail,
    skipped: false,
    message: `完成：成功 ${reportedOk} 条，失败 ${reportedFail} 条`,
  };
}
