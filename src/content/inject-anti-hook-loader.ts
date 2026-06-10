/**
 * 隔离世界：MAIN 中无法使用 chrome.runtime，故由本脚本按 dist 方式注入 `pdd-page-anti-hook.js`（web_accessible_resources）。
 * 须在 document_start 尽早执行，与 activity-inject（MAIN）同帧尽早产出 postMessage 令牌。
 */
(function injectPddPageAntiHookLoader(): void {
  const id = 'pdd-dtx-page-anti-hook';
  try {
    if (document.getElementById(id)) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return;
    const url = chrome.runtime.getURL('pdd-page-anti-hook.js');
    const script = document.createElement('script');
    script.id = id;
    script.src = url;
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.onload = (): void => {
      try {
        script.remove();
      } catch {
        /* ignore */
      }
    };
  } catch {
    /* ignore */
  }
})();
