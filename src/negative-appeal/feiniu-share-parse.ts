import { isLikelySpecName } from './qc-sheet-text-utils';

export type FeiniuShareFileEntry = {
  /** 下载接口用的完整路径，如 /质检报告/滇同学-云南黑糖-100克袋-1.png */
  path: string;
  fileId: number;
  fileName: string;
};

const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const NAME_TAIL_RE = /^(.+)-(\d+)$/i;

/** 飞牛 list 接口单项：path 为目录，file 为文件名 */
export function entryFromFeiniuListItem(raw: Record<string, unknown>): FeiniuShareFileEntry | null {
  if (raw.isDir === 1 || raw.isDir === true) return null;

  const fileId = Number(raw.fileId ?? raw.id);
  if (!Number.isFinite(fileId)) return null;

  const dirPath = typeof raw.path === 'string' ? raw.path.trim() : '';
  const fileName =
    (typeof raw.file === 'string' ? raw.file.trim() : '') ||
    (typeof raw.fileName === 'string' ? raw.fileName.trim() : '') ||
    (typeof raw.name === 'string' ? raw.name.trim() : '');

  let fullPath = dirPath;
  if (fileName) {
    fullPath = dirPath ? (dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`) : fileName;
  }

  if (!fullPath || !IMG_EXT_RE.test(fullPath)) return null;

  const baseName = fileName || fullPath.split('/').pop() || fullPath;
  return { path: fullPath, fileId, fileName: baseName };
}

/** 文件名「滇同学-云南黑糖-100克袋-1」→ 规格名「滇同学-云南黑糖-100克/袋」 */
export function feiniuFileBaseToSpecName(baseName: string): string {
  const t = baseName.trim();
  return t.replace(/(\d+(?:\.\d+)?)克袋$/, '$1克/袋');
}

export function parseSpecFromFeiniuFileName(fileName: string): { specName: string; index: number } | null {
  const name = fileName.replace(IMG_EXT_RE, '').trim();
  const m = name.match(NAME_TAIL_RE);
  if (!m) return null;
  const specName = feiniuFileBaseToSpecName(m[1]);
  if (!isLikelySpecName(specName)) return null;
  return { specName, index: Number(m[2]) };
}

export function extractShareFilesFromJson(node: unknown, out: FeiniuShareFileEntry[]): void {
  const seen = new Set<string>();

  const pushEntry = (entry: FeiniuShareFileEntry | null): void => {
    if (!entry) return;
    const key = `${entry.fileId}:${entry.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  const walk = (val: unknown, depth: number): void => {
    if (depth > 14 || val == null) return;
    if (Array.isArray(val)) {
      for (const item of val.slice(0, 500)) walk(item, depth + 1);
      return;
    }
    if (typeof val !== 'object') return;
    const o = val as Record<string, unknown>;

    pushEntry(entryFromFeiniuListItem(o));

    // 兼容 path 已是完整文件路径的旧结构
    const pathOnly = typeof o.path === 'string' ? o.path : '';
    const fid = o.fileId ?? o.id;
    if (pathOnly && fid != null && IMG_EXT_RE.test(pathOnly) && !o.file) {
      pushEntry({
        path: pathOnly,
        fileId: Number(fid),
        fileName: pathOnly.split('/').pop() || pathOnly,
      });
    }

    if (o.data && typeof o.data === 'object') walk(o.data, depth + 1);
    if (o.files && Array.isArray(o.files)) walk(o.files, depth + 1);
    for (const v of Object.values(o).slice(0, 80)) {
      if (v === o.data || v === o.files) continue;
      walk(v, depth + 1);
    }
  };

  walk(node, 0);
}

export function groupFilesBySpec(
  files: FeiniuShareFileEntry[],
): Map<string, FeiniuShareFileEntry[]> {
  const map = new Map<string, FeiniuShareFileEntry[]>();

  for (const f of files) {
    const parsed = parseSpecFromFeiniuFileName(f.fileName);
    if (!parsed) continue;
    const list = map.get(parsed.specName) ?? [];
    list.push(f);
    map.set(parsed.specName, list);
  }

  for (const [, list] of map) {
    list.sort((a, b) => {
      const ia = parseSpecFromFeiniuFileName(a.fileName)?.index ?? 0;
      const ib = parseSpecFromFeiniuFileName(b.fileName)?.index ?? 0;
      return ia - ib;
    });
  }

  return map;
}
