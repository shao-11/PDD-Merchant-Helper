import { BAILIAN_CHAT_URL } from '../negative-appeal/constants';
import type { RrAiChatRequest, RrAiChatResponse } from '../report-reply/ai-messages';
import { MSG_RR_AI_CHAT, MSG_RR_GENERATE_REPLY } from '../report-reply/ai-messages';
import {
  ensureDefaultReportReplyAiConfig,
  getReportReplyAiConfig,
  REPORT_REPLY_AI_MODEL_DEFAULT,
} from '../report-reply/ai-config';
import {
  buildReplyAiMessages,
  fallbackReplyContent,
  resolveReplyStar,
  sanitizeReplyText,
} from '../report-reply/reply-ai-prompt';
import type { UnrepliedReviewItem } from '../report-reply/review-reply-status';

const CHAT_TIMEOUT_MS = 60_000;

function parseChatResponse(text: string): RrAiChatResponse {
  const json = JSON.parse(text) as RrAiChatResponse;
  if (json.error?.message) {
    throw new Error(json.error.message);
  }
  return json;
}

function extractText(json: RrAiChatResponse): string {
  const choice = json.choices?.[0] as { message?: { content?: string }; text?: string } | undefined;
  return (
    choice?.message?.content?.trim() ??
    (typeof choice?.text === 'string' ? choice.text.trim() : '') ??
    json.message?.content?.trim() ??
    ''
  );
}

async function chatViaBailian(
  apiKey: string,
  model: string,
  body: RrAiChatRequest,
): Promise<RrAiChatResponse> {
  const payload: RrAiChatRequest = { ...body, model };
  const res = await fetch(BAILIAN_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`百炼 HTTP ${res.status}：${text.slice(0, 200)}`);
  }
  return parseChatResponse(text);
}

async function generateReplyForItem(item: UnrepliedReviewItem): Promise<string> {
  const { apiKey, model } = await getReportReplyAiConfig();
  if (!apiKey) {
    throw new Error('未配置百炼 API Key，请在「举报回复设置」中填写');
  }
  const aiModel = model || REPORT_REPLY_AI_MODEL_DEFAULT;
  const messages = buildReplyAiMessages(item);
  const data = await chatViaBailian(apiKey, aiModel, {
    model: aiModel,
    stream: false,
    messages,
  });
  const content = sanitizeReplyText(extractText(data), item.star);
  if (!content) {
    throw new Error('百炼返回空文案');
  }
  return content;
}

export function registerReportReplyAiProxy(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type as string | undefined;
    if (type !== MSG_RR_AI_CHAT && type !== MSG_RR_GENERATE_REPLY) return;

    void (async () => {
      try {
        if (type === MSG_RR_GENERATE_REPLY) {
          const item = message.item as UnrepliedReviewItem | undefined;
          if (!item?.reviewId) {
            sendResponse({ ok: false, error: '无效的评价条目' });
            return;
          }
          const content = await generateReplyForItem(item);
          sendResponse({ ok: true, content });
          return;
        }

        const body = message.body as RrAiChatRequest;
        if (!body?.model || !Array.isArray(body.messages)) {
          sendResponse({ ok: false, error: '无效的 AI 请求体' });
          return;
        }
        const { apiKey, model } = await getReportReplyAiConfig();
        if (!apiKey) {
          sendResponse({
            ok: false,
            error: '未配置百炼 API Key，请在「举报回复设置」中填写',
          });
          return;
        }
        const data = await chatViaBailian(apiKey, model, body);
        sendResponse({ ok: true, data });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (type === MSG_RR_GENERATE_REPLY) {
          const item = message.item as UnrepliedReviewItem | undefined;
          const star = resolveReplyStar(item?.star);
          sendResponse({
            ok: false,
            error: `${msg}（已可回退默认文案：${fallbackReplyContent(star).slice(0, 12)}…）`,
          });
        } else {
          sendResponse({ ok: false, error: msg });
        }
      }
    })();

    return true;
  });

  void ensureDefaultReportReplyAiConfig();
  chrome.runtime.onInstalled.addListener(() => {
    void ensureDefaultReportReplyAiConfig();
  });
}

export { extractText as extractReportReplyAiText };
