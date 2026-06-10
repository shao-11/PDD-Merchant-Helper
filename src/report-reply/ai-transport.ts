import {
  MSG_RR_AI_CHAT,
  MSG_RR_GENERATE_REPLY,
  type RrAiChatRequest,
  type RrAiChatResponse,
  type RrAiChatResult,
  type RrGenerateReplyResult,
} from './ai-messages';
import { getReportReplyAiConfig, REPORT_REPLY_AI_MODEL_DEFAULT } from './ai-config';
import type { UnrepliedReviewItem } from './review-reply-status';
import { rrLog } from './debug-log';

function sendBgMessage<T>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) {
      reject(new Error('扩展 runtime 不可用'));
      return;
    }
    try {
      chrome.runtime.sendMessage(payload, (result) => {
        const err = chrome.runtime.lastError;
        if (err?.message) {
          reject(new Error(err.message));
          return;
        }
        if (result === undefined) {
          reject(new Error('后台无响应（请重载扩展后刷新评价页）'));
          return;
        }
        resolve(result as T);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function sendBgChat(body: RrAiChatRequest): Promise<RrAiChatResult> {
  return sendBgMessage<RrAiChatResult>({ type: MSG_RR_AI_CHAT, body });
}

function extractText(data: RrAiChatResponse): string {
  const choice = data.choices?.[0] as { message?: { content?: string }; text?: string } | undefined;
  return (
    choice?.message?.content?.trim() ??
    (typeof choice?.text === 'string' ? choice.text.trim() : '') ??
    data.message?.content?.trim() ??
    ''
  );
}

export async function requestReportReplyAi(body: RrAiChatRequest): Promise<string> {
  const result = await sendBgChat(body);
  if (!result.ok) {
    throw new Error(result.error ?? 'AI 请求失败');
  }
  const text = extractText(result.data);
  if (!text) throw new Error('AI 返回空内容');
  return text;
}

/** 在 background 内完成 prompt 组装 + 百炼调用（评价页 content script 专用） */
export async function requestGenerateReplyContent(item: UnrepliedReviewItem): Promise<string> {
  const result = await sendBgMessage<RrGenerateReplyResult>({
    type: MSG_RR_GENERATE_REPLY,
    item,
  });
  if (!result.ok) {
    throw new Error(result.error ?? 'AI 生成失败');
  }
  const text = String(result.content ?? '').trim();
  if (!text) throw new Error('AI 返回空内容');
  return text;
}

export async function probeReportReplyAi(): Promise<{ ok: boolean; model: string; error?: string }> {
  const { apiKey, model } = await getReportReplyAiConfig();
  if (!apiKey) {
    return { ok: false, model, error: '未配置 API Key' };
  }
  try {
    await requestReportReplyAi({
      model: model || REPORT_REPLY_AI_MODEL_DEFAULT,
      stream: false,
      messages: [{ role: 'user', content: '只回复OK' }],
    });
    return { ok: true, model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rrLog('reply-ai', 'warn', 'AI 探测失败', { msg });
    return { ok: false, model, error: msg };
  }
}
