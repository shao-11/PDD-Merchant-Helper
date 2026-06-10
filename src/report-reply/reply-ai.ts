import type { UnrepliedReviewItem } from './review-reply-status';
import { requestGenerateReplyContent } from './ai-transport';
import { rrLog } from './debug-log';
import {
  fallbackReplyContent,
  hasBuyerTextComment,
  resolveReplyStar,
  sanitizeReplyText,
} from './reply-ai-prompt';

export type GenerateReplyResult = {
  content: string;
  aiGenerated: boolean;
  error?: string;
};

export async function generateAiReplyContent(item: UnrepliedReviewItem): Promise<GenerateReplyResult> {
  const star = resolveReplyStar(item.star);

  rrLog('reply-ai', 'info', '生成回复文案', {
    reviewId: item.reviewId,
    goodsName: item.goodsName,
    star,
    hasComment: hasBuyerTextComment(item.comment),
  });

  try {
    const raw = await requestGenerateReplyContent(item);
    const content = sanitizeReplyText(raw, item.star);
    if (!content) throw new Error('AI 返回空文案');
    rrLog('reply-ai', 'info', 'AI 文案已生成', {
      reviewId: item.reviewId,
      preview: content.slice(0, 60),
    });
    return { content, aiGenerated: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rrLog('reply-ai', 'warn', 'AI 生成失败，使用默认文案', {
      reviewId: item.reviewId,
      err: msg,
    });
    return {
      content: fallbackReplyContent(star),
      aiGenerated: false,
      error: msg,
    };
  }
}

// 兼容旧引用
export { NO_TEXT_COMMENT, hasBuyerTextComment, isPlatformPlaceholderComment } from './reply-ai-prompt';
