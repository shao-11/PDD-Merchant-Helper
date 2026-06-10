import {
  STORAGE_NA_BAILIAN_API_KEY,
  STORAGE_RR_BAILIAN_API_KEY,
  STORAGE_RR_BAILIAN_MODEL,
} from '../constants/storage-keys';

export const REPORT_REPLY_AI_MODEL_DEFAULT = 'qwen-max';

/** 鍐呯疆榛樿 Key锛堜釜浜洪儴缃诧紱鏂版祻瑙堝櫒/鏂板畨瑁呮椂鑷姩鍐欏叆 storage锛?*/
const REPORT_REPLY_BUILTIN_API_KEY = 'REPLACE_ME_WITH_YOUR_KEY';

export type ReportReplyAiConfig = {
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

/** 鍥炲涓撶敤鐧剧偧閰嶇疆锛氫紭鍏堣鍥炲 Key锛屽惁鍒欏鐢ㄨ礋鍚戠敵璇?Key */
export async function getReportReplyAiConfig(): Promise<ReportReplyAiConfig> {
  const raw = await readStorage([
    STORAGE_RR_BAILIAN_API_KEY,
    STORAGE_RR_BAILIAN_MODEL,
    STORAGE_NA_BAILIAN_API_KEY,
  ]);
  const rrKey = String(raw[STORAGE_RR_BAILIAN_API_KEY] ?? '').trim();
  const naKey = String(raw[STORAGE_NA_BAILIAN_API_KEY] ?? '').trim();
  const apiKey = rrKey || naKey || REPORT_REPLY_BUILTIN_API_KEY;
  const model =
    String(raw[STORAGE_RR_BAILIAN_MODEL] ?? '').trim() || REPORT_REPLY_AI_MODEL_DEFAULT;
  return { apiKey, model };
}

/** 棣栨瀹夎鎴?storage 鏃?Key 鏃跺啓鍏ラ粯璁ら厤缃紙璁剧疆椤靛彲鐪嬪埌宸插～鍏咃級 */
export async function ensureDefaultReportReplyAiConfig(): Promise<void> {
  const raw = await readStorage([STORAGE_RR_BAILIAN_API_KEY, STORAGE_RR_BAILIAN_MODEL]);
  const patch: Partial<ReportReplyAiConfig> = {};
  if (!String(raw[STORAGE_RR_BAILIAN_API_KEY] ?? '').trim()) {
    patch.apiKey = REPORT_REPLY_BUILTIN_API_KEY;
  }
  if (!String(raw[STORAGE_RR_BAILIAN_MODEL] ?? '').trim()) {
    patch.model = REPORT_REPLY_AI_MODEL_DEFAULT;
  }
  if (Object.keys(patch).length > 0) {
    await setReportReplyAiConfig(patch);
  }
}

export async function setReportReplyAiConfig(
  patch: Partial<ReportReplyAiConfig>,
): Promise<void> {
  const obj: Record<string, string> = {};
  if (patch.apiKey !== undefined) obj[STORAGE_RR_BAILIAN_API_KEY] = patch.apiKey.trim();
  if (patch.model !== undefined) {
    obj[STORAGE_RR_BAILIAN_MODEL] = patch.model.trim() || REPORT_REPLY_AI_MODEL_DEFAULT;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}
