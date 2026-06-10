import {
  MSG_NA_OLLAMA_CHAT,
  MSG_NA_OLLAMA_DIAGNOSE,
  type NaOllamaChatRequest,
  type NaOllamaChatResponse,
  type NaOllamaChatResult,
  type NaOllamaDiagnoseResult,
  type OllamaDiagLog,
} from './ollama-messages';

async function sendBg<T>(payload: Record<string, unknown>): Promise<T> {
  if (!chrome?.runtime?.sendMessage) {
    throw new Error('扩展 runtime 不可用（非扩展环境）');
  }
  const result = await chrome.runtime.sendMessage(payload);
  if (result === undefined) {
    throw new Error('后台无响应（Service Worker 可能已休眠，请重载扩展）');
  }
  return result as T;
}

export async function requestOllamaDiagnose(): Promise<NaOllamaDiagnoseResult> {
  return sendBg<NaOllamaDiagnoseResult>({ type: MSG_NA_OLLAMA_DIAGNOSE });
}

export async function requestOllamaChat(
  body: NaOllamaChatRequest,
): Promise<{ data: NaOllamaChatResponse; logs: OllamaDiagLog[] }> {
  const result = await sendBg<NaOllamaChatResult>({
    type: MSG_NA_OLLAMA_CHAT,
    body,
  });

  const logs = result.logs ?? [];

  if (!result?.ok) {
    throw new Error(result?.error ?? '扩展后台无法连接 Ollama');
  }

  return { data: result.data, logs };
}

export function extractOllamaText(json: NaOllamaChatResponse): string {
  return (
    json.choices?.[0]?.message?.content?.trim() ??
    json.message?.content?.trim() ??
    ''
  );
}
