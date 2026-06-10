/**
 * 按本地日历日聚合评价条数，仅使用已有 ReviewItem.createTime（秒），不请求接口。
 */
import dayjs from 'dayjs';
import type { ReviewItem } from '../types/reviews';

export type TrendRangeDays = 1 | 30 | 90 | 180;

/** 生成从「今天往前共 rangeDays 个日历日」的日期键（YYYY-MM-DD），含今天 */
function calendarDayKeys(rangeDays: TrendRangeDays): string[] {
  const keys: string[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    keys.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
  }
  return keys;
}

/**
 * 返回与 keys 对齐的每日条数；只统计 createTime 落在窗口内的评价。
 */
export function buildDailyReviewTrend(rows: ReviewItem[], rangeDays: TrendRangeDays): { days: string[]; counts: number[] } {
  const days = calendarDayKeys(rangeDays);
  const set = new Set(days);
  const countMap = new Map<string, number>();
  for (const k of days) countMap.set(k, 0);

  for (const r of rows) {
    const t = r.createTime;
    if (t == null || !Number.isFinite(t)) continue;
    const key = dayjs.unix(t).format('YYYY-MM-DD');
    if (set.has(key)) {
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }
  }

  const counts = days.map((d) => countMap.get(d) ?? 0);
  return { days, counts };
}
