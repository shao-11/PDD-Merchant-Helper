import {
  NA_MSG_SOURCE_CONTENT,
  NA_MSG_SOURCE_INJECT,
  NA_MSG_UPLOAD_APPEAL_FILES,
  NA_MSG_UPLOAD_APPEAL_RESULT,
} from './constants';
import type { FormFillStep } from './platform-form-fill';

type FilePayload = { name: string; mime: string; base64: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    r.readAsDataURL(file);
  });
}

async function filesToPayload(files: File[]): Promise<FilePayload[]> {
  const out: FilePayload[] = [];
  for (const f of files) {
    out.push({
      name: f.name,
      mime: f.type || 'image/png',
      base64: await fileToBase64(f),
    });
  }
  return out;
}

function base64ToFile(p: FilePayload): File {
  const bin = atob(p.base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new File([buf], p.name, { type: p.mime });
}

export type UploadBridgeResult = FormFillStep & {
  debug?: Record<string, unknown>;
  via: 'isolated' | 'main';
};

/** 在页面 MAIN 环境注入文件（与 content 隔离环境相对，部分站点仅 MAIN 能触发上传） */
export function uploadAppealFilesViaMainWorld(
  files: File[],
  timeoutMs = 20000,
): Promise<UploadBridgeResult> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('MAIN 世界上传超时'));
    }, timeoutMs);

    const onMsg = (ev: MessageEvent): void => {
      const d = ev.data as {
        source?: string;
        type?: string;
        requestId?: string;
        ok?: boolean;
        step?: FormFillStep;
        debug?: Record<string, unknown>;
        error?: string;
      };
      if (d?.source !== NA_MSG_SOURCE_INJECT || d?.type !== NA_MSG_UPLOAD_APPEAL_RESULT) return;
      if (d.requestId !== requestId) return;
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      if (d.step) {
        resolve({ ...d.step, debug: d.debug, via: 'main' });
        return;
      }
      reject(new Error(d.error ?? 'MAIN 世界上传失败'));
    };

    window.addEventListener('message', onMsg);
    void filesToPayload(files).then((payloads) => {
      window.postMessage(
        {
          source: NA_MSG_SOURCE_CONTENT,
          type: NA_MSG_UPLOAD_APPEAL_FILES,
          requestId,
          files: payloads,
        },
        '*',
      );
    });
  });
}

export function payloadToFiles(payloads: FilePayload[]): File[] {
  return payloads.map(base64ToFile);
}
