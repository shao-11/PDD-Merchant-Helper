import { generateAiReplyContent } from './reply-ai';
import type { UnrepliedReviewItem } from './review-reply-status';
import { batchReplyReviews, type BatchReplyResult } from './rpc';
import { rrLog } from './debug-log';

export type ReplyOneResult = BatchReplyResult & {
  aiGenerated: boolean;
  contentPreview: string;
  aiError?: string;
};

export async function replyOneReviewWithAi(item: UnrepliedReviewItem): Promise<ReplyOneResult> {
  const gen = await generateAiReplyContent(item);
  rrLog('reply-ai', 'info', '提交回复', {
    reviewId: item.reviewId,
    aiGenerated: gen.aiGenerated,
    preview: gen.content.slice(0, 80),
    error: gen.error,
  });
  const res = await batchReplyReviews([{ reviewId: item.reviewId, content: gen.content }]);
  return {
    ...res,
    aiGenerated: gen.aiGenerated,
    contentPreview: gen.content.slice(0, 80),
    aiError: gen.error,
  };
}
