/** 一键回复默认文案（AI 失败时兜底） */
export const DEFAULT_FIVE_STAR_REPLY_CONTENT =
  '感谢亲亲五星好评！您的满意是我们最大动力，小店品质售后在线，期待您再次光临，祝您生活愉快～';

export const DEFAULT_FOUR_STAR_REPLY_CONTENT =
  '感谢亲亲的认可与支持！我们会继续努力把品质和口感做好，吃得放心～有问题随时找客服，期待您再次光临！';

export function getDefaultReplyContent(star?: number): string {
  return star === 4 ? DEFAULT_FOUR_STAR_REPLY_CONTENT : DEFAULT_FIVE_STAR_REPLY_CONTENT;
}

export function buildReplySubmitBody(
  reviewId: string,
  content?: string,
  star?: number,
): Record<string, unknown> {
  const fallback = getDefaultReplyContent(star);
  return {
    content: (content ?? fallback).trim() || fallback,
    reviewId,
    userType: 1,
    insistSend: false,
  };
}
