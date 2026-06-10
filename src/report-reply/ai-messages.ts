/** 经 background 代理请求百炼（回复专用，模型独立于负向申诉） */
export const MSG_RR_AI_CHAT = 'RR_AI_CHAT';
/** 根据评价条目生成回复文案（background 内组装 prompt） */
export const MSG_RR_GENERATE_REPLY = 'RR_GENERATE_REPLY';

export type RrAiChatRequest = {
  model: string;
  stream: false;
  messages: { role: string; content: string }[];
};

export type RrAiChatResponse = {
  choices?: { message?: { content?: string }; text?: string }[];
  message?: { content?: string };
  error?: { message?: string; code?: string };
};

export type RrAiChatResult =
  | { ok: true; data: RrAiChatResponse }
  | { ok: false; error: string };

export type RrGenerateReplyResult =
  | { ok: true; content: string }
  | { ok: false; error: string };
