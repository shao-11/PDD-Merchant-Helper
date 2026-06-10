import { randomReportIntervalMs, sleepMs } from './report-delay';
import { rrLog } from './debug-log';
import type { AutoReplyPageResult } from './auto-report-messages';
import { fetchFiveStarReviews, warmReportReplyAnti } from './rpc';
import { replyOneReviewWithAi } from './reply-with-ai';

const ANTI_RETRY_WAIT_MS = 6000;

/**
 * 在已打开的评价管理页执行自动回复（须在自动举报之后、同一标签内调用）。
 */
export async function runAutoReplyInPage(days: number): Promise<AutoReplyPageResult> {
  rrLog('auto-reply', 'info', '自动回复任务开始', { days });

  let warm = await warmReportReplyAnti();
  if (!warm.hasAnti) {
    await sleepMs(ANTI_RETRY_WAIT_MS);
    warm = await warmReportReplyAnti();
  }
  if (!warm.hasAnti) {
    return {
      total: 0,
      unreplied: 0,
      repliedOk: 0,
      repliedFail: 0,
      skipped: true,
      message: '缺少 anti-content，请确认商家后台已登录且评价列表能正常打开',
    };
  }

  const summary = await fetchFiveStarReviews(days);
  const items =
    summary.unrepliedItems?.length > 0
      ? [...summary.unrepliedItems]
      : summary.unrepliedIds.map((id) => ({ reviewId: id, comment: '', goodsName: '', star: 5 }));
  if (items.length === 0) {
    return {
      total: summary.total,
      unreplied: 0,
      repliedOk: 0,
      repliedFail: 0,
      skipped: false,
      message: '没有待回复的 4～5 星好评',
    };
  }

  let repliedOk = 0;
  let repliedFail = 0;
  let aiGeneratedOk = 0;
  let aiFallbackOk = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    try {
      const res = await replyOneReviewWithAi(item);
      for (const r of res.results) {
        if (r.ok) {
          repliedOk += 1;
          if (res.aiGenerated) aiGeneratedOk += 1;
          else aiFallbackOk += 1;
        } else repliedFail += 1;
      }
    } catch (e) {
      repliedFail += 1;
      rrLog('auto-reply', 'error', '单条回复失败', {
        reviewId: item.reviewId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
    if (i < items.length - 1) {
      await sleepMs(randomReportIntervalMs());
    }
  }

  rrLog('auto-reply', 'info', '自动回复任务结束', {
    total: summary.total,
    unreplied: summary.unreplied,
    repliedOk,
    repliedFail,
    aiGeneratedOk,
    aiFallbackOk,
  });

  const fallbackHint =
    aiFallbackOk > 0 ? `（其中 ${aiFallbackOk} 条 AI 失败已用默认文案）` : '';

  return {
    total: summary.total,
    unreplied: summary.unreplied,
    repliedOk,
    repliedFail,
    skipped: false,
    message: `完成：成功 ${repliedOk} 条，失败 ${repliedFail} 条${fallbackHint}`,
    aiGeneratedOk,
    aiFallbackOk,
  };
}
