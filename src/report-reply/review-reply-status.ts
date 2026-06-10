import type { ReviewItem } from '../types/reviews';

export type UnrepliedReviewItem = {
  reviewId: string;
  comment: string;
  goodsName: string;
  /** 4 或 5，用于排序与 AI 文案；默认 5 */
  star: number;
};

export type ReplyStatusStats = {
  total: number;
  unreplied: number;
  replied: number;
  unrepliedIds: string[];
  unrepliedItems: UnrepliedReviewItem[];
};

function asRecord(item: ReviewItem): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}

function hasNonEmptyReplyList(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/** 列表项是否已有商家回复（字段与商家后台 list 响应对齐，兼容多种形态） */
export function isReviewReplied(item: ReviewItem): boolean {
  const o = asRecord(item);

  if (o.canReply === true) return false;
  if (o.canReply === false) return true;

  const replyStatus = o.replyStatus ?? o.reply_status;
  if (replyStatus === 1 || replyStatus === 20) return true;
  if (replyStatus === 0) return false;

  if (o.hasReply === true || o.replied === true) return true;
  if (o.hasReply === false) return false;

  const replyNum = o.replyNum ?? o.replyCount ?? o.merchantReplyNum;
  if (typeof replyNum === 'number' && replyNum > 0) return true;

  if (
    hasNonEmptyReplyList(o.replyList) ||
    hasNonEmptyReplyList(o.merchantReplyList) ||
    hasNonEmptyReplyList(o.reviewReplyList)
  ) {
    return true;
  }

  const mr = o.merchantReply ?? o.merchantReplyVO ?? o.replyVO ?? o.mainReply;
  if (typeof mr === 'string' && mr.trim()) return true;
  if (mr && typeof mr === 'object') {
    const m = mr as Record<string, unknown>;
    if (String(m.content ?? '').trim()) return true;
    if (m.replyId != null || m.time != null) return true;
  }

  const desc = String(o.replyStatusDesc ?? o.replyDesc ?? o.replyStatusStr ?? '').trim();
  if (/未回复|待回复|尚未回复|可回复/.test(desc)) return false;
  if (/已回复|回复成功|商家已回|已追评/.test(desc)) return true;

  return false;
}

const SCORE_TAG = '__dtxStar';

/** 拉取时由 inject 写入；否则尝试读接口字段 */
export function readReviewStar(item: ReviewItem): number {
  const o = asRecord(item);
  const tagged = Number(o[SCORE_TAG]);
  if (tagged === 4 || tagged === 5) return tagged;
  const fromApi = Number(o.descScore ?? o.score ?? o.star ?? 0);
  if (fromApi === 4 || fromApi === 5) return fromApi;
  return 5;
}

export function tagReviewStar(item: ReviewItem, star: number): ReviewItem {
  return { ...item, [SCORE_TAG]: star } as ReviewItem;
}

export function summarizeReplyStats(items: ReviewItem[]): ReplyStatusStats {
  const unrepliedItems: UnrepliedReviewItem[] = [];
  let unreplied = 0;
  let replied = 0;

  for (const it of items) {
    const id = String(it.reviewId ?? '').trim();
    if (!id) continue;
    if (isReviewReplied(it)) {
      replied += 1;
    } else {
      unreplied += 1;
      unrepliedItems.push({
        reviewId: id,
        comment: String(it.comment ?? '').trim(),
        goodsName: String(it.goodsName ?? '').trim(),
        star: readReviewStar(it),
      });
    }
  }

  unrepliedItems.sort((a, b) => b.star - a.star);
  const sortedUnrepliedIds = unrepliedItems.map((x) => x.reviewId);

  return {
    total: unreplied + replied,
    unreplied,
    replied,
    unrepliedIds: sortedUnrepliedIds,
    unrepliedItems,
  };
}
