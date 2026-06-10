const CDP_VERSION = '1.3';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function dispatchKey(
  target: chrome.debugger.Debuggee,
  key: string,
  code: string,
  keyCode: number
): Promise<void> {
  const base = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  };
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...base,
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...base,
  });
}

/**
 * 向页面发送真实按键，用于在 Chrome 已保存密码下拉里选择条目（非网页 DOM，普通脚本事件无效）。
 */
export async function pickBrowserPasswordViaDebugger(
  tabId: number,
  pickIndex: number
): Promise<{ ok: boolean; message: string }> {
  const target: chrome.debugger.Debuggee = { tabId };
  const attached = await new Promise<boolean>((resolve) => {
    chrome.debugger.attach(target, CDP_VERSION, () => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });

  if (!attached) {
    return {
      ok: false,
      message: chrome.runtime.lastError?.message ?? '无法附加调试器（可能被其他扩展占用）',
    };
  }

  try {
    await sleep(500);
    for (let i = 0; i < pickIndex; i++) {
      await dispatchKey(target, 'ArrowDown', 'ArrowDown', 40);
      await sleep(180);
    }
    await dispatchKey(target, 'Enter', 'Enter', 13);
    await sleep(500);
    if (pickIndex === 0) {
      await dispatchKey(target, 'Enter', 'Enter', 13);
    }
    return { ok: true, message: '已通过调试器发送选密码按键' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  } finally {
    await new Promise<void>((resolve) => {
      chrome.debugger.detach(target, () => resolve());
    });
  }
}
