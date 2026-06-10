/** 旺店通 tradeQuery 响应摘要，写入技术日志 */

export function looksLikeTradeQueryJson(text: string): boolean {
  const t = text;
  return t.includes('orderItemList') || (t.includes('"skuName"') && t.includes('srcTid'));
}

export function summarizeHuiceJson(json: unknown, httpStatus: number): string {
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const data = root.data;
  let dataInfo = 'missing';
  if (Array.isArray(data)) {
    dataInfo = `array[${data.length}]`;
    if (data.length > 0 && data[0] && typeof data[0] === 'object') {
      const t0 = data[0] as Record<string, unknown>;
      const items = Array.isArray(t0.orderItemList) ? t0.orderItemList.length : 0;
      dataInfo += ` · trade0.items=${items} · tid=${String(t0.tid ?? t0.srcTids ?? '').slice(0, 40)}`;
    }
  } else if (data != null && typeof data === 'object') {
    const keys = Object.keys(data as object).slice(0, 10).join(',');
    dataInfo = `object{${keys}}`;
  } else if (data != null) {
    dataInfo = typeof data;
  }

  const code = root.code ?? root.status ?? root.errCode ?? '';
  const msg = String(root.message ?? root.msg ?? root.error ?? root.errMsg ?? '').slice(0, 120);
  const success = root.success;

  return [
    `HTTP ${httpStatus}`,
    `data=${dataInfo}`,
    code !== '' ? `code=${String(code)}` : null,
    success !== undefined ? `success=${String(success)}` : null,
    msg ? `msg=${msg}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function summarizeHuiceTextPreview(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '(empty body)';
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
