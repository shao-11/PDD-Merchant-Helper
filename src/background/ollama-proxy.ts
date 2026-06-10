import { getBailianAiConfig, maskApiKey } from '../negative-appeal/ai-config';
import { BAILIAN_CHAT_URL, BAILIAN_MODEL_DEFAULT } from '../negative-appeal/constants';
import type { FetchStepLog } from '../negative-appeal/fetch-log';
import {
  MSG_NA_OLLAMA_CHAT,
  MSG_NA_OLLAMA_DIAGNOSE,
  type NaOllamaChatRequest,
  type NaOllamaChatResponse,
  type NaOllamaDiagnoseResult,
  type OllamaDiagLog,
} from '../negative-appeal/ollama-messages';
import { offscreenHttpRequest } from './ollama-offscreen';
import { localFetch } from './ollama-local-fetch';

const PROBE_TIMEOUT_MS = 15000;
const CHAT_TIMEOUT_MS = 90000;

function logStep(
  logs: OllamaDiagLog[],
  step: string,
  level: FetchStepLog['level'],
  message: string,
  detail?: string,
): void {
  logs.push({ step, level, message, detail, at: Date.now() });
}

function extractApiErrorBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    const j = JSON.parse(trimmed) as {
      error?: { message?: string; code?: string };
      message?: string;
      code?: string;
    };
    if (j.error?.message) {
      return j.error.code ? `${j.error.message}（${j.error.code}）` : j.error.message;
    }
    if (j.message) return j.code ? `${j.message}（${j.code}）` : j.message;
  } catch {
    /* 非 JSON */
  }
  return trimmed.slice(0, 280);
}

function formatHttpError(status: number, text: string): string {
  const apiMsg = extractApiErrorBody(text);
  if (status === 401) {
    return `HTTP 401：API Key 无效${apiMsg ? ` — ${apiMsg}` : ''}`;
  }
  if (status === 403) {
    const hint = apiMsg.includes('FreeTier') || apiMsg.includes('quota')
      ? '（免费额度用尽或模型未开通）'
      : '（Key 无权限或模型未开通）';
    return `HTTP 403${hint}${apiMsg ? ` — ${apiMsg}` : ''}`;
  }
  if (status === 400 && apiMsg) {
    return `HTTP 400 — ${apiMsg}`;
  }
  return apiMsg ? `HTTP ${status} — ${apiMsg}` : `HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ''}`;
}

function formatFetchError(e: unknown): string {
  const err = e instanceof Error ? e : new Error(String(e));
  const cause = err.cause instanceof Error ? err.cause.message : '';
  return cause ? `${err.message}（${cause}）` : err.message;
}

function isPublicHttps(url: string): boolean {
  return url.startsWith('https://');
}

async function httpRequest(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text: string }> {
  const bodyStr =
    init.body != null && typeof init.body !== 'string' ? JSON.stringify(init.body) : (init.body as string | undefined);

  const requestInit: RequestInit = { method: init.method, headers: init.headers, body: bodyStr };

  if (isPublicHttps(url)) {
    try {
      const res = await fetch(url, { ...requestInit, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (directErr) {
      const dirMsg = directErr instanceof Error ? directErr.message : String(directErr);
      throw new Error(`公网请求失败: ${dirMsg}`);
    }
  }

  try {
    const viaOff = await offscreenHttpRequest(url, requestInit, timeoutMs);
    return viaOff;
  } catch (offscreenErr) {
    const offMsg = offscreenErr instanceof Error ? offscreenErr.message : String(offscreenErr);
    try {
      const res = await localFetch(url, {
        ...requestInit,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (directErr) {
      const dirMsg = directErr instanceof Error ? directErr.message : String(directErr);
      throw new Error(`Offscreen: ${offMsg}；本机直连: ${dirMsg}`);
    }
  }
}

function normalizeNative(native: NaOllamaChatResponse): NaOllamaChatResponse {
  if (native.message?.content && !native.choices?.length) {
    return { choices: [{ message: { content: native.message.content } }] };
  }
  return native;
}

function parseChatResponse(text: string): NaOllamaChatResponse {
  const json = JSON.parse(text) as NaOllamaChatResponse;
  if (json.error?.message) {
    throw new Error(json.error.message);
  }
  return normalizeNative(json);
}

async function postChat(
  logs: OllamaDiagLog[],
  step: string,
  url: string,
  body: NaOllamaChatRequest,
  headers: Record<string, string>,
): Promise<NaOllamaChatResponse | null> {
  const hasAuth = Boolean(headers.Authorization?.trim());
  logStep(
    logs,
    step,
    'info',
    hasAuth ? '请求头已带 Authorization' : '警告：未带 Authorization，将 401',
    url,
  );

  try {
    const r = await httpRequest(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      },
      CHAT_TIMEOUT_MS,
    );
    if (!r.ok) {
      logStep(logs, step, 'error', formatHttpError(r.status, r.text), url);
      return null;
    }
    const json = parseChatResponse(r.text);
    logStep(logs, step, 'ok', `POST 成功 HTTP ${r.status}`, `model=${body.model}`);
    return json;
  } catch (e) {
    logStep(logs, step, 'error', `POST 失败：${formatFetchError(e)}`, url);
    return null;
  }
}

function modelHintForAppeal(model: string): string | null {
  if (/math/i.test(model)) {
    return 'qwen-math-turbo 为数学解题模型，申诉场景请改用 qwen-turbo 或 qwen-plus，并在百炼控制台确认模型为「已开通」';
  }
  return null;
}

async function probeBailianModel(
  logs: OllamaDiagLog[],
  apiKey: string,
  model: string,
  step: string,
): Promise<boolean> {
  const mini: NaOllamaChatRequest = {
    model,
    stream: false,
    messages: [{ role: 'user', content: '只回复OK两个字母' }],
  };
  const viaCloud = await postChat(logs, step, BAILIAN_CHAT_URL, mini, {
    Authorization: `Bearer ${apiKey}`,
  });
  return Boolean(viaCloud);
}

async function runBailianDiagnostics(
  apiKey: string,
  model: string,
): Promise<NaOllamaDiagnoseResult> {
  const logs: OllamaDiagLog[] = [];
  logStep(logs, 'AI-环境', 'info', '使用阿里云百炼云端（不占用本机 Ollama）');
  logStep(
    logs,
    'AI-百炼',
    'info',
    `当前模型: ${model}；Key ${maskApiKey(apiKey)}（长度 ${apiKey.length}）`,
  );
  if (!apiKey.startsWith('sk-')) {
    logStep(logs, 'AI-百炼', 'warn', 'API Key 通常以 sk- 开头，请确认从百炼控制台完整复制');
  }

  const mathHint = modelHintForAppeal(model);
  if (mathHint) {
    logStep(logs, 'AI-百炼', 'warn', mathHint);
  }

  if (await probeBailianModel(logs, apiKey, model, 'AI-百炼试聊')) {
    const summary = `百炼云端 AI 可用（模型 ${model}）`;
    logStep(logs, 'AI-结论', 'ok', summary);
    return { ok: true, logs, summary, provider: 'bailian' };
  }

  const lastTry = logs.find((l) => l.step === 'AI-百炼试聊' && l.level === 'error');
  const apiDetail = lastTry?.message ?? '';

  if (model !== BAILIAN_MODEL_DEFAULT) {
    logStep(
      logs,
      'AI-百炼',
      'warn',
      `模型 ${model} 不可用，自动改用 ${BAILIAN_MODEL_DEFAULT} 重试…`,
      apiDetail,
    );
    if (await probeBailianModel(logs, apiKey, BAILIAN_MODEL_DEFAULT, 'AI-百炼试聊(兜底)')) {
      const summary = `百炼可用：请将模型改为 ${BAILIAN_MODEL_DEFAULT}（当前 ${model} 未开通或不适合申诉）`;
      logStep(logs, 'AI-结论', 'ok', summary);
      return { ok: true, logs, summary, provider: 'bailian' };
    }
  }

  let summary = apiDetail
    ? `百炼失败：${apiDetail}`
    : '百炼调用失败：请检查 API Key、模型名与账户余额';
  if (mathHint) summary += `。${mathHint}`;
  else if (apiDetail.includes('403') || apiDetail.includes('未开通') || apiDetail.includes('Access')) {
    summary += '。请到百炼控制台 → 模型用量，将所用模型设为「已开通」';
  }
  logStep(logs, 'AI-结论', 'error', summary, apiDetail);
  return { ok: false, logs, summary, provider: 'bailian' };
}

async function chatViaBailian(
  apiKey: string,
  model: string,
  body: NaOllamaChatRequest,
  logs: OllamaDiagLog[],
): Promise<NaOllamaChatResponse> {
  logStep(logs, 'AI-申诉分析', 'info', '请求百炼云端进行原因码重选…');
  const payload: NaOllamaChatRequest = { ...body, model };
  const result = await postChat(logs, 'AI-百炼', BAILIAN_CHAT_URL, payload, {
    Authorization: `Bearer ${apiKey}`,
  });
  if (result) {
    logStep(logs, 'AI-申诉分析', 'ok', '百炼返回成功');
    return result;
  }
  throw new Error('百炼请求失败，见技术日志 AI-百炼 步骤');
}

export async function runOllamaDiagnostics(): Promise<NaOllamaDiagnoseResult> {
  const { apiKey, model } = await getBailianAiConfig();

  if (!apiKey) {
    const logs: OllamaDiagLog[] = [];
    logStep(logs, 'AI-环境', 'warn', '未配置百炼 API Key');
    const summary = '请在申诉助手顶部填写并保存百炼 API Key（不再使用本机 Ollama）';
    logStep(logs, 'AI-结论', 'error', summary);
    return { ok: false, logs, summary, provider: 'none' };
  }

  return runBailianDiagnostics(apiKey, model);
}

async function chatWithConfiguredAi(body: NaOllamaChatRequest, logs: OllamaDiagLog[]): Promise<NaOllamaChatResponse> {
  const { apiKey, model } = await getBailianAiConfig();
  if (!apiKey) {
    throw new Error('未配置百炼 API Key，请在申诉助手顶部保存 Key 后重试');
  }
  return chatViaBailian(apiKey, model, body, logs);
}

export function registerOllamaProxy(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MSG_NA_OLLAMA_DIAGNOSE) {
      void runOllamaDiagnostics().then((r) => sendResponse(r));
      return true;
    }

    if (message?.type !== MSG_NA_OLLAMA_CHAT) return;

    void (async () => {
      const logs: OllamaDiagLog[] = [];
      try {
        const body = message.body as NaOllamaChatRequest;
        if (!body?.model || !Array.isArray(body.messages)) {
          sendResponse({ ok: false, error: '无效的 AI 请求体', logs });
          return;
        }
        const { model: storedModel } = await getBailianAiConfig();
        const reqBody: NaOllamaChatRequest = {
          ...body,
          model: storedModel || body.model || BAILIAN_MODEL_DEFAULT,
        };
        const data = await chatWithConfiguredAi(reqBody, logs);
        sendResponse({ ok: true, data, logs });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendResponse({ ok: false, error: msg, logs });
      }
    })();

    return true;
  });
}
