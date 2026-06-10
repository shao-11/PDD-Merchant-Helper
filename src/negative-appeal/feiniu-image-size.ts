/** 质检 PNG 原图通常 >90KB；列表缩略图往往 <20KB */
export const MIN_QC_IMAGE_BYTES = 48_000;

export function base64DecodedBytes(b64: string): number {
  const s = b64.replace(/\s/g, '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}
