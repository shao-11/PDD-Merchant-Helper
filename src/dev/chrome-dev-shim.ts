/**
 * Vite 开发服务器（localhost popup/panel）下没有 chrome 扩展运行时。
 * 在 import 任何使用 chrome.* 的模块之前加载本文件，避免白屏。
 */
function isPopupOrPanelDevPage(): boolean {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname;
  return p.endsWith('popup.html') || p.endsWith('panel.html');
}

function installChromeDevShim(): void {
  if (!import.meta.env.DEV || !isPopupOrPanelDevPage()) return;
  const g = globalThis as typeof globalThis & { chrome?: typeof chrome };
  if (g.chrome?.runtime?.getURL) return;

  const store: Record<string, unknown> = {};
  const listeners: Array<
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void
  > = [];

  const notify = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void => {
    for (const fn of listeners) {
      try {
        fn(changes, 'local');
      } catch {
        /* dev shim */
      }
    }
  };

  g.chrome = {
    runtime: {
      id: 'dev-local-preview',
      getURL: (path: string) => `/${path.replace(/^\//, '')}`,
      lastError: undefined,
    },
    storage: {
      local: {
        get(
          keys: string | string[] | Record<string, unknown> | null,
          callback: (items: Record<string, unknown>) => void,
        ): void {
          const out: Record<string, unknown> = {};
          let list: string[] = [];
          if (keys === null) list = Object.keys(store);
          else if (typeof keys === 'string') list = [keys];
          else if (Array.isArray(keys)) list = keys;
          else if (typeof keys === 'object') list = Object.keys(keys);
          for (const k of list) {
            if (k in store) out[k] = store[k];
          }
          callback(out);
        },
        set(items: Record<string, unknown>, callback?: () => void): void {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: store[k], newValue: v };
            store[k] = v;
          }
          notify(changes);
          callback?.();
        },
      },
      onChanged: {
        addListener(
          callback: (
            changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
            areaName: string,
          ) => void,
        ): void {
          listeners.push(callback);
        },
        removeListener(
          callback: (
            changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
            areaName: string,
          ) => void,
        ): void {
          const i = listeners.indexOf(callback);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  } as typeof chrome;
}

installChromeDevShim();
