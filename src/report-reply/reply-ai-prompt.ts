import { getDefaultReplyContent } from './reply-template';
import type { UnrepliedReviewItem } from './review-reply-status';

/** 平台占位文案：表示买家未填写文字评价 */
export const NO_TEXT_COMMENT = '该用户未填写文字评价';

/** 如「该用户觉得商品很好，给出了5星好评」— 无买家真实文字 */
const PLATFORM_PLACEHOLDER_COMMENT_RE =
  /该用户觉得商品很好[，,]?\s*给出了[\d一二三四五]+星好评|该用户觉得商品很好.*给出了.*星.*好评/;

/** 平台系统占位评价，不可当作真实买家文字 */
export function isPlatformPlaceholderComment(comment?: string): boolean {
  const text = String(comment ?? '').trim();
  if (!text) return true;
  if (text === NO_TEXT_COMMENT) return true;
  return PLATFORM_PLACEHOLDER_COMMENT_RE.test(text);
}

export const MAX_REPLY_CHARS = 200;

/** 滇同学食品店 — AI 回复人设与规则（一键/自动回复共用） */
export const REPLY_AI_PERSONA_RULES = `【人设】
你是「滇同学」食品店铺的客服小滇。店铺主营各类食品（干货、菌菇、零食、特产等）。
你说话真诚、温暖、像真人客服，懂产品但不夸大，关心顾客吃得是否满意。

【写作规则】
1. 根据买家星级（四星/五星）、评价内容、商品名称写一条商家回复。
2. 有文字评价：只回应买家实际提到的点，不编造内容。
3. 无文字评价（含「该用户未填写文字评价」「该用户觉得商品很好，给出了X星好评」等系统占位句）：只根据商品名称写感谢，不要假装引用评价。
4. 字数 80～150 字，最多 ${MAX_REPLY_CHARS} 字；只输出回复正文，不要引号或解释。
5. 语气亲切，「亲亲」最多用 1 次；每条回复尽量有变化，避免套话雷同。
6. 可结合食品场景提：新鲜、口感、品质、吃得放心、售后在线。
7. 严禁：加微信/电话/外链、绝对化用语、医疗功效宣传、引导改评、贬低竞品。

【四星特别说明（内部参考，勿写入回复）】
本条为 4 星评价：语气积极、真诚感谢，可轻提会持续改进品质与服务，但不要过度道歉、不要索要改评。
回复正文中严禁出现「四星」「4星」「四颗星」等字样；用「感谢您的认可/支持/好评」等自然表达即可，不要点明星级。`;

/** 设置页展示用（完整规则见 REPLY_AI_PERSONA_RULES） */
export const REPLY_AI_PERSONA_BRIEF = {
  persona: '客服小滇 · 滇同学食品店',
  scope: '干货、菌菇、零食、特产等食品',
  tags: ['4～5 星好评', '先 5 星后 4 星', '80～150 字', '四星回复不提星级'],
} as const;

export function hasBuyerTextComment(comment?: string): boolean {
  const text = String(comment ?? '').trim();
  if (!text) return false;
  if (isPlatformPlaceholderComment(text)) return false;
  return true;
}

export function resolveReplyStar(star?: number): 4 | 5 {
  return star === 4 ? 4 : 5;
}

/** 合并为单条 user 消息，兼容百炼 OpenAI 兼容接口 */
export function buildReplyAiMessages(item: UnrepliedReviewItem): { role: string; content: string }[] {
  const goodsName = String(item.goodsName ?? '').trim() || '本店商品';
  const star = resolveReplyStar(item.star);
  const starContext =
    star === 4
      ? `本条为 4 星评价（仅供你把握语气；回复里不要写「四星」「4星」等词）`
      : `买家评分为 5 星（可在回复中自然体现五星/满意，勿夸张）`;

  const taskTail =
    star === 4
      ? '请按以上人设与规则写一条商家回复，感谢认可即可，回复中不要出现任何星级字样。'
      : '请按以上人设与规则，写一条商家回复。';

  if (hasBuyerTextComment(item.comment)) {
    return [
      {
        role: 'user',
        content: `${REPLY_AI_PERSONA_RULES}

---
${starContext}
商品名称：${goodsName}
买家评价：${String(item.comment).trim()}

${taskTail}`,
      },
    ];
  }

  return [
    {
      role: 'user',
      content: `${REPLY_AI_PERSONA_RULES}

---
${starContext}
商品名称：${goodsName}
买家未填写真实文字评价（系统占位或仅有星级/图片，例如「该用户未填写文字评价」「该用户觉得商品很好，给出了5星好评」等）。

${taskTail} 仅根据商品名称写感谢，不要引用或复述上述占位句，不要假装买家说过具体评价内容。`,
    },
  ];
}

export function sanitizeReplyText(raw: string, star?: number): string {
  let text = raw.trim();
  text = text.replace(/^["'「『]|["'」』]$/g, '').trim();
  if (resolveReplyStar(star) === 4) {
    text = text
      .replace(/四星/g, '')
      .replace(/4\s*星/g, '')
      .replace(/四颗星/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (text.length > MAX_REPLY_CHARS) {
    text = text.slice(0, MAX_REPLY_CHARS).trim();
  }
  return text;
}

export function fallbackReplyContent(star?: number): string {
  return getDefaultReplyContent(resolveReplyStar(star));
}
