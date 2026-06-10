/** Offscreen 文档：代扩展后台 fetch 本机 127.0.0.1（部分 Chrome 下 SW 无法直连 loopback） */
export const MSG_OLLAMA_OFFSCREEN_FETCH = 'NA_OLLAMA_OFFSCREEN_FETCH';

export type OffscreenFetchRequest = {
  type: typeof MSG_OLLAMA_OFFSCREEN_FETCH;
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function normalizeHeaders(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

export type OffscreenFetchResponse =
  | { ok: true; status: number; text: string }
  | { ok: false; error: string };

const OFFSCREEN_PATH = 'ollama-offscreen.html';

export async function ensureOllamaOffscreen(): Promise<void> {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('当前 Chrome 版本不支持 offscreen，请升级 Chrome');
  }
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Fetch local Ollama HTTP proxy for negative appeal AI',
  });
}

export async function offscreenHttpRequest(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text: string }> {
  await ensureOllamaOffscreen();
  const body =
    init.body != null && typeof init.body !== 'string'
      ? JSON.stringify(init.body)
      : (init.body as string | undefined);

  const headers = normalizeHeaders(init.headers);

  const payload: OffscreenFetchRequest = {
    type: MSG_OLLAMA_OFFSCREEN_FETCH,
    url,
    method: init.method ?? 'GET',
    body: body ?? undefined,
    headers,
    timeoutMs,
  };

  let lastErr = 'Offscreen 桥接无响应';
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
    try {
      const result = (await chrome.runtime.sendMessage(payload)) as OffscreenFetchResponse | undefined;
      if (!result) {
        lastErr = 'Offscreen 桥接无响应（请重载扩展）';
        continue;
      }
      if (!result.ok) {
        throw new Error(result.error || 'Offscreen fetch 失败');
      }
      return { ok: result.status >= 200 && result.status < 300, status: result.status, text: result.text };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (lastErr.includes('Receiving end does not exist')) continue;
      throw e;
    }
  }
  throw new Error(lastErr);
}
