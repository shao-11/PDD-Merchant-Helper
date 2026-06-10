/**
 * Desktop dist：background 用 webRequest 从 MMS 请求头读取 anti-content → tabs.sendMessage。
 * 本扩展 activity-inject 在 MAIN world，无法监听 chrome.runtime；
 * 由孤立世界 content 转成 window.postMessage（与 pdd-page-anti-hook / inject-enroll-hook 约定一致）。
 */
export function installWebRequestAntiBridge(): void {
  const g = globalThis as typeof globalThis & { __PDD_DTX_WEBREQUEST_ANTI_BRIDGE__?: boolean };
  if (g.__PDD_DTX_WEBREQUEST_ANTI_BRIDGE__) return;
  g.__PDD_DTX_WEBREQUEST_ANTI_BRIDGE__ = true;

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const m = message as {
      __dtx__?: boolean;
      type?: string;
      token?: unknown;
      source?: unknown;
    };
    if (!m || m.__dtx__ !== true || m.type !== 'dtxAntiContent') return;
    const token = typeof m.token === 'string' ? m.token.trim() : '';
    if (!token) return;
    try {
      window.postMessage(
        {
          __dtx__: true,
          type: 'dtxAntiContent',
          token,
          source: String(m.source ?? 'webRequest'),
        },
        window.location.origin
      );
    } catch {
      /* ignore */
    }
  });
}

installWebRequestAntiBridge();
