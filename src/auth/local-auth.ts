import { AUTH_API_BASE } from './api-config';
import { MSG_AUTO_REPORT_AFTER_LOGIN } from '../report-reply/auto-report-messages';
import { STORAGE_AUTH_SESSION } from './storage-keys';

/** 登录有效时长：30 天（扩展本地会话，与库内账号无关）*/
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthSession = {
  username: string;
  loggedInAt: number;
  expiresAt: number;
};

type LoginApiResponse = {
  ok?: boolean;
  username?: string;
  message?: string;
};

export function isSessionValid(session: AuthSession | null | undefined, now = Date.now()): boolean {
  if (!session || typeof session !== 'object') return false;
  if (!String(session.username ?? '').trim()) return false;
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) return false;
  return true;
}

export function createSession(username: string, now = Date.now()): AuthSession {
  const name = username.trim();
  return {
    username: name,
    loggedInAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS,
  };
}

export function readAuthSession(): Promise<AuthSession | null> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_AUTH_SESSION, (raw) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const s = raw[STORAGE_AUTH_SESSION] as AuthSession | undefined;
        resolve(s ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export function writeAuthSession(session: AuthSession): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [STORAGE_AUTH_SESSION]: session }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

export function clearAuthSession(): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove(STORAGE_AUTH_SESSION, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

export async function getValidAuthSession(): Promise<AuthSession | null> {
  const session = await readAuthSession();
  if (!isSessionValid(session)) {
    if (session) await clearAuthSession();
    return null;
  }
  return session!;
}

/**
 * 本地验证账号密码（仅用于快速测试）。
 * 生产环境建议连接 server/ 部署的认证服务。
 */
export async function loginWithCredentials(username: string, password: string): Promise<boolean> {
  const trimmedUser = username.trim();
  if (!trimmedUser || !password) return false;

  // 快速登录：任意非空账号+密码即可通过本地验证
  // 实际使用时请连接远程认证服务或使用后端验证
  const session = createSession(trimmedUser);
  await writeAuthSession(session);
  try {
    chrome.runtime.sendMessage({ type: MSG_AUTO_REPORT_AFTER_LOGIN }, () => void chrome.runtime.lastError);
  } catch {
    /* 非扩展环境 */
  }
  return true;
}
