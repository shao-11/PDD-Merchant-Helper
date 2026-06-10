/** 从 enrollV2 JSON 中递归收集 goods_id / goodsId */
export function extractGoodsIdsFromEnrollJson(text: string): number[] {
  const seen = new Set<number>();
  function walk(x: unknown): void {
    if (x === null || x === undefined) return;
    if (typeof x !== 'object') return;
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    const o = x as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'goods_id' || k === 'goodsId') && typeof v === 'number' && Number.isFinite(v)) {
        const n = Math.floor(v);
        if (n > 0) seen.add(n);
      } else {
        walk(v);
      }
    }
  }
  try {
    walk(JSON.parse(text));
  } catch {
    return [];
  }
  return [...seen];
}

export function parseGoodsIdsCsv(csv: string): number[] {
  if (!csv.trim()) return [];
  return csv
    .split(/[,，\s]+/)
    .map((x) => Math.floor(Number(x.trim())))
    .filter((n) => n > 0);
}

export function goodsIdsFingerprintFromSources(enrollBodyText: string, csv: string): string {
  const merged = [...new Set([...extractGoodsIdsFromEnrollJson(enrollBodyText), ...parseGoodsIdsCsv(csv)])];
  return merged.sort((a, b) => a - b).join(',');
}

/** enroll 体 + 面板 CSV 合并去重（顺序不保证；供流水线 gate / batch 使用） */
export function mergeGoodsIdsFromSources(enrollBodyText: string, csv: string): number[] {
  return [...new Set([...extractGoodsIdsFromEnrollJson(enrollBodyText), ...parseGoodsIdsCsv(csv)])];
}

export function goodsIdsFingerprintFromCsv(csv: string): string {
  return parseGoodsIdsCsv(csv)
    .sort((a, b) => a - b)
    .join(',');
}
