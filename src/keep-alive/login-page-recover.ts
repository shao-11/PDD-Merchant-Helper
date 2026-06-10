import {
  STORAGE_KEEP_ALIVE_MMS_CREDENTIAL_INDEX,
  STORAGE_KEEP_ALIVE_MMS_PASSWORD,
  STORAGE_KEEP_ALIVE_MMS_USERNAME,
} from '../constants/storage-keys';
import { pickBrowserPasswordViaDebugger } from './login-page-debugger-keys';

/** 拼多多商家后台登录页（会话失效时跳转） */
export const MMS_LOGIN_URL_PREFIX = 'https://mms.pinduoduo.com/login';

export type LoginPageRecoverResult = {
  onLoginPage: boolean;
  ok: boolean;
  message: string;
};

function storageGet<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (raw) => {
      resolve((raw ?? {}) as T);
    });
  });
}

export function isMmsLoginUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'mms.pinduoduo.com') return false;
    const path = u.pathname.replace(/\/$/, '') || '/';
    return path === '/login';
  } catch {
    return /mms\.pinduoduo\.com\/login/i.test(url);
  }
}

type PrepareLoginPageResult = {
  onLoginPage: boolean;
  ok: boolean;
  message: string;
  usernameFocused: boolean;
};

type FinishLoginPageResult = {
  onLoginPage: boolean;
  ok: boolean;
  message: string;
  passwordFilled: boolean;
};

/** 阶段一：点「账号登录」并聚焦账号框 */
async function prepareLoginPage(tabId: number): Promise<PrepareLoginPageResult> {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (): Promise<PrepareLoginPageResult> => {
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });

      const path = globalThis.location.pathname.replace(/\/$/, '') || '/';
      const onLogin =
        path === '/login' ||
        Boolean(document.querySelector('.login-center')) ||
        Boolean(document.querySelector('#usernameId'));

      if (!onLogin) {
        return { onLoginPage: false, ok: true, message: '当前不在登录页', usernameFocused: false };
      }

      const clickEl = (el: Element | null | undefined): boolean => {
        if (!el || !(el instanceof HTMLElement)) return false;
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
        return true;
      };

      const findByExactText = (text: string): HTMLElement | null => {
        const norm = text.trim();
        const candidates = document.querySelectorAll(
          '.Common_item__3diIn, [class*="Common_item"], div, span'
        );
        for (const el of candidates) {
          if (!(el instanceof HTMLElement)) continue;
          if ((el.textContent || '').trim() !== norm) continue;
          if (el.querySelector('.Common_item__3diIn, [class*="Common_item"]')) continue;
          return el;
        }
        return null;
      };

      const getUsernameInput = (): HTMLInputElement | null =>
        (document.querySelector('#usernameId') as HTMLInputElement | null) ??
        (document.querySelector(
          'input[placeholder*="账号"], input[placeholder*="手机号"]'
        ) as HTMLInputElement | null);

      const accountTab = findByExactText('账号登录');
      if (!clickEl(accountTab)) {
        return {
          onLoginPage: true,
          ok: false,
          message: '登录页未找到「账号登录」标签',
          usernameFocused: false,
        };
      }

      await sleep(2000);

      const usernameInput = getUsernameInput();
      if (!usernameInput) {
        return {
          onLoginPage: true,
          ok: false,
          message: '登录页未找到账号输入框',
          usernameFocused: false,
        };
      }

      clickEl(usernameInput);
      usernameInput.focus();
      usernameInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      usernameInput.click();

      await sleep(700);

      return {
        onLoginPage: true,
        ok: true,
        message: '已聚焦账号框',
        usernameFocused: true,
      };
    },
  });

  return (
    (result as PrepareLoginPageResult | undefined) ?? {
      onLoginPage: false,
      ok: false,
      message: '登录页准备脚本无返回',
      usernameFocused: false,
    }
  );
}

/** 阶段三：兜底填表 + 点登录 */
async function finishLoginPage(
  tabId: number,
  fbUsername: string,
  fbPassword: string,
  pickHint: string
): Promise<FinishLoginPageResult> {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [fbUsername, fbPassword, pickHint],
    func: async (
      fbUser: string,
      fbPass: string,
      hint: string
    ): Promise<FinishLoginPageResult> => {
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });

      const setReactInputValue = (input: HTMLInputElement | null, value: string): void => {
        if (!input || !value) return;
        input.focus();
        const proto = Object.getPrototypeOf(input) as HTMLInputElement;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) {
          desc.set.call(input, value);
        } else {
          input.value = value;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const getUsernameInput = (): HTMLInputElement | null =>
        (document.querySelector('#usernameId') as HTMLInputElement | null) ??
        (document.querySelector(
          'input[placeholder*="账号"], input[placeholder*="手机号"]'
        ) as HTMLInputElement | null);

      const getPasswordInput = (): HTMLInputElement | null =>
        (document.querySelector('#passwordId') as HTMLInputElement | null) ??
        (document.querySelector(
          'input[type="password"], input[placeholder*="密码"]'
        ) as HTMLInputElement | null);

      const passwordFilled = (): boolean => {
        const pwd = getPasswordInput();
        return Boolean(pwd && pwd.value.length > 0);
      };

      if (!passwordFilled() && fbUser) {
        setReactInputValue(getUsernameInput(), fbUser);
        if (fbPass) setReactInputValue(getPasswordInput(), fbPass);
      }

      await sleep(400);

      const clickEl = (el: Element | null | undefined): boolean => {
        if (!el || !(el instanceof HTMLElement)) return false;
        el.click();
        return true;
      };

      const pwdSection = document.querySelector('.password-section');
      let loginBtn =
        (pwdSection?.querySelector(
          'button[data-testid="beast-core-button"]'
        ) as HTMLButtonElement | null) ?? null;

      if (!loginBtn) {
        const buttons = document.querySelectorAll('button[data-testid="beast-core-button"]');
        for (const btn of buttons) {
          const label = (btn.textContent || '').replace(/\s/g, '');
          if (label === '登录') {
            loginBtn = btn as HTMLButtonElement;
            break;
          }
        }
      }

      if (!clickEl(loginBtn)) {
        return {
          onLoginPage: true,
          ok: false,
          message: '登录页未找到「登录」按钮',
          passwordFilled: passwordFilled(),
        };
      }

      const filled = passwordFilled();
      return {
        onLoginPage: true,
        ok: true,
        message: filled
          ? `检测到登录页：${hint}，已点击登录`
          : `检测到登录页：${hint}，已点击登录（密码未填入，请在「防账号掉线」中保存兜底账号密码）`,
        passwordFilled: filled,
      };
    },
  });

  return (
    (result as FinishLoginPageResult | undefined) ?? {
      onLoginPage: false,
      ok: false,
      message: '登录页收尾脚本无返回',
      passwordFilled: false,
    }
  );
}

/**
 * 登录页：账号登录 → 聚焦账号框 → 调试器选 Chrome 已存密码（或 storage 兜底）→ 点登录。
 */
export async function tryRecoverOnLoginPage(tabId: number): Promise<LoginPageRecoverResult> {
  const raw = await storageGet<Record<string, unknown>>([
    STORAGE_KEEP_ALIVE_MMS_CREDENTIAL_INDEX,
    STORAGE_KEEP_ALIVE_MMS_USERNAME,
    STORAGE_KEEP_ALIVE_MMS_PASSWORD,
  ]);

  const credentialPickIndex =
    typeof raw[STORAGE_KEEP_ALIVE_MMS_CREDENTIAL_INDEX] === 'number'
      ? Math.max(0, Math.floor(raw[STORAGE_KEEP_ALIVE_MMS_CREDENTIAL_INDEX] as number))
      : 0;
  const fallbackUsername =
    typeof raw[STORAGE_KEEP_ALIVE_MMS_USERNAME] === 'string'
      ? raw[STORAGE_KEEP_ALIVE_MMS_USERNAME].trim()
      : '';
  const fallbackPassword =
    typeof raw[STORAGE_KEEP_ALIVE_MMS_PASSWORD] === 'string'
      ? raw[STORAGE_KEEP_ALIVE_MMS_PASSWORD]
      : '';

  const prepared = await prepareLoginPage(tabId);
  if (!prepared.onLoginPage) {
    return { onLoginPage: false, ok: prepared.ok, message: prepared.message };
  }
  if (!prepared.ok || !prepared.usernameFocused) {
    return { onLoginPage: true, ok: false, message: prepared.message };
  }

  const pickHint =
    credentialPickIndex === 0
      ? '已尝试选择浏览器密码列表第 1 条'
      : `已尝试选择浏览器密码列表第 ${credentialPickIndex + 1} 条`;

  let autofillNote = '';

  if (fallbackUsername && fallbackPassword) {
    autofillNote = '使用扩展内保存的账号密码';
  } else {
    const keyResult = await pickBrowserPasswordViaDebugger(tabId, credentialPickIndex);
    autofillNote = keyResult.ok ? pickHint : `${pickHint}（调试器：${keyResult.message}）`;
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 1200);
    });
  }

  const finished = await finishLoginPage(
    tabId,
    fallbackUsername,
    fallbackPassword,
    autofillNote
  );

  return {
    onLoginPage: finished.onLoginPage,
    ok: finished.ok,
    message: finished.message,
  };
}
