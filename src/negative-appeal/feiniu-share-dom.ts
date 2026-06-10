import { MIN_QC_IMAGE_BYTES } from './feiniu-image-size';
import type { FeiniuShareFileEntry } from './feiniu-share-parse';

/** 从分享页列表 DOM 读取图片（多为缩略图，仅作 download 失败时的兜底） */
export async function loadImageFromShareDom(  doc: Document,
  fileName: string,
): Promise<{ mime: string; dataBase64: string } | null> {
  const src = findPreviewSrcForFileName(doc, fileName);
  if (!src) return null;

  try {
    const res = await fetch(src, { credentials: 'include', mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size < MIN_QC_IMAGE_BYTES) return null;
    const mime = blob.type || guessMime(fileName);
    if (!/^image\//i.test(mime) && !/\.(png|jpe?g|webp)/i.test(fileName)) return null;
    return { mime: mime.startsWith('image/') ? mime : guessMime(fileName), dataBase64: await blobToB64(blob) };
  } catch {
    return null;
  }
}

function guessMime(fileName: string): string {
  if (/\.jpe?g$/i.test(fileName)) return 'image/jpeg';
  if (/\.webp$/i.test(fileName)) return 'image/webp';
  return 'image/png';
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      const i = s.indexOf('base64,');
      resolve(i >= 0 ? s.slice(i + 7) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function findPreviewSrcForFileName(doc: Document, fileName: string): string | null {
  const base = fileName.replace(/\.(png|jpe?g|webp|gif)$/i, '');
  const candidates: Element[] = [];

  for (const el of doc.querySelectorAll('tr, li, [class*="file"], [class*="row"], [role="row"]')) {
    const text = el.textContent?.replace(/\s+/g, '') ?? '';
    if (text.includes(fileName.replace(/\s+/g, '')) || text.includes(base.replace(/\s+/g, ''))) {
      candidates.push(el);
    }
  }

  for (const root of candidates.length ? candidates : [doc.body]) {
    const img = root.querySelector('img[src]') as HTMLImageElement | null;
    const src = img?.currentSrc || img?.src;
    if (src && !/^data:image\/svg/i.test(src) && src.length > 10) return src;
  }

  for (const img of doc.querySelectorAll('img[src]')) {
    const el = img as HTMLImageElement;
    const src = el.currentSrc || el.src;
    if (!src || /^data:image\/svg/i.test(src)) continue;
    const row = el.closest('tr, li, [class*="file"], [class*="row"]');
    const text = row?.textContent ?? '';
    if (text.includes(fileName) || text.includes(base)) return src;
  }

  return null;
}

export async function tryLoadFromDomBatch(
  doc: Document,
  files: FeiniuShareFileEntry[],
): Promise<Map<string, { mime: string; dataBase64: string }>> {
  const out = new Map<string, { mime: string; dataBase64: string }>();
  for (const f of files) {
    const packed = await loadImageFromShareDom(doc, f.fileName);
    if (packed) out.set(f.fileName, packed);
  }
  return out;
}
