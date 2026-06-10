/**
 * specs 字段在接口里常为 JSON 字符串，如 [{"spec_key":"颜色","spec_value":"红"}]
 */
export function parseSpecs(specs: string | undefined | null): string {
  if (!specs || typeof specs !== 'string') return '—';
  try {
    const arr = JSON.parse(specs) as Array<{ spec_key?: string; spec_value?: string }>;
    if (!Array.isArray(arr)) return specs;
    return arr
      .map((x) => {
        const k = x.spec_key ?? '';
        const v = x.spec_value ?? '';
        return k && v ? `${k}:${v}` : v || k;
      })
      .filter(Boolean)
      .join('；') || '—';
  } catch {
    return specs;
  }
}
