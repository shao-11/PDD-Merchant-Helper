import { MSG_OLLAMA_OFFSCREEN_FETCH, type OffscreenFetchRequest } from './ollama-offscreen';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as OffscreenFetchRequest;
  if (msg?.type !== MSG_OLLAMA_OFFSCREEN_FETCH) return;

  const timeoutMs = msg.timeoutMs ?? 12000;
  const headers: Record<string, string> = { ...(msg.headers ?? {}) };
  if (msg.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  void fetch(msg.url, {
    method: msg.method ?? 'GET',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: msg.body,
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(async (res) => {
      const text = await res.text();
      sendResponse({ ok: true, status: res.status, text });
    })
    .catch((e: unknown) => {
      const err = e instanceof Error ? e.message : String(e);
      sendResponse({ ok: false, error: err });
    });

  return true;
});
