import { BAILIAN_MODEL_DEFAULT } from './constants';
import {
  STORAGE_NA_BAILIAN_API_KEY,
  STORAGE_NA_BAILIAN_MODEL,
} from '../constants/storage-keys';

export type BailianAiConfig = {
  apiKey: string;
  model: string;
};

function readStorage(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (raw) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(raw ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

export async function getBailianAiConfig(): Promise<BailianAiConfig> {
  const raw = await readStorage([STORAGE_NA_BAILIAN_API_KEY, STORAGE_NA_BAILIAN_MODEL]);
  const apiKey = String(raw[STORAGE_NA_BAILIAN_API_KEY] ?? '').trim();
  if (!apiKey) {
    throw new Error('PDD API Key not configured. Please set it in the extension popup.');
  }
  const model = String(raw[STORAGE_NA_BAILIAN_MODEL] ?? '').trim() || BAILIAN_MODEL_DEFAULT;
  return { apiKey, model };
}

export async function setBailianAiConfig(patch: Partial<BailianAiConfig>): Promise<void> {
  const obj: Record<string, string> = {};
  if (patch.apiKey !== undefined) obj[STORAGE_NA_BAILIAN_API_KEY] = patch.apiKey.trim();
  if (patch.model !== undefined) obj[STORAGE_NA_BAILIAN_MODEL] = patch.model.trim() || BAILIAN_MODEL_DEFAULT;
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

export function maskApiKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return k ? '***' : '';
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}
