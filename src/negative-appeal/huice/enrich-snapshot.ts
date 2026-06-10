import type { FetchStepLog } from '../fetch-log';
import type { AppealSnapshot } from '../types';
import { fetchHuiceSkuNamesByOrder } from './fetch-bridge';

const SKU_CODE_RE = /\bSKU[0-9A-Z-]{4,}\b/gi;
const SKU_KEY_RE =
  /sku(no|_no|code|_code)?|goods(no|_no|code|_code)|spec(no|_no|code|_code)|spSkuNo|outerSkuNo/i;

function collectSkuCodesFromText(value: unknown, out: Set<string>): void {
  if (value == null) return;
  const text = String(value);
  const m = text.match(SKU_CODE_RE);
  if (m) m.forEach((x) => out.add(x.toUpperCase()));
}

function collectSkuCodesFromObjectByKey(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (!SKU_KEY_RE.test(k)) continue;
    if (Array.isArray(v)) {
      v.forEach((x) => collectSkuCodesFromText(x, out));
      continue;
    }
    collectSkuCodesFromText(v, out);
  }
}

function extractPreferredSkuCodes(snapshot: AppealSnapshot): string[] {
  const explicit = (snapshot.huicePreferredSkuCodes ?? [])
    .map((x) => String(x ?? '').toUpperCase().trim())
    .filter((x) => /^SKU[0-9A-Z-]{4,}$/.test(x));
  if (explicit.length) return [...new Set(explicit)];

  const set = new Set<string>();
  // 只按“可能是货品编码的字段名”提取，避免把订单里其他商品的说明文本误当目标 SKU。
  collectSkuCodesFromObjectByKey(snapshot.tuju, set);
  for (const row of snapshot.afterSales ?? []) collectSkuCodesFromObjectByKey(row, set);
  return [...set];
}

function extractPreferredGoodsText(snapshot: AppealSnapshot): string {
  const explicit = String(snapshot.huicePreferredGoodsText ?? '').trim();
  if (explicit) return explicit;
  const parts = [
    String(snapshot.tuju?.goodsName ?? '').trim(),
    String((snapshot.tuju as Record<string, unknown> | undefined)?.goodsSpec ?? '').trim(),
    String((snapshot.tuju as Record<string, unknown> | undefined)?.goods_name ?? '').trim(),
  ].filter(Boolean);
  return [...new Set(parts)].join(' ');
}

export async function enrichSnapshotWithHuice(snapshot: AppealSnapshot): Promise<AppealSnapshot> {
  const orderSn = snapshot.orderSn.trim();
  if (!orderSn) return snapshot;

  const log: FetchStepLog = {
    step: '旺店通货品',
    level: 'warn',
    message: '查询中…',
    at: Date.now(),
  };

  try {
    const preferredSkuCodes = extractPreferredSkuCodes(snapshot);
    const preferredGoodsText = extractPreferredGoodsText(snapshot);
    const r = await fetchHuiceSkuNamesByOrder(orderSn, preferredSkuCodes, preferredGoodsText);
    const diag = r.debug?.trim();

    if (r.ok && r.skuNames.length) {
      log.level = 'ok';
      log.message = `已获取 ${r.skuNames.length} 个规格名`;
      log.detail = [
        preferredSkuCodes.length ? `目标货品编码：${preferredSkuCodes.join('；')}` : '目标货品编码：未提取到',
        preferredGoodsText ? `目标货品关键词：${preferredGoodsText}` : null,
        r.matchedSkuCodes?.length ? `命中货品编码：${r.matchedSkuCodes.join('；')}` : null,
        r.skuNames.join('；'),
        diag,
      ]
        .filter(Boolean)
        .join('\n');
      return {
        ...snapshot,
        huiceSkuNames: r.skuNames,
        fetchLogs: [...(snapshot.fetchLogs ?? []), log],
      };
    }

    log.level = 'warn';
    log.message = r.error ?? '未查到旺店通 skuName';
    log.detail = [
      preferredSkuCodes.length ? `目标货品编码：${preferredSkuCodes.join('；')}` : '目标货品编码：未提取到',
      preferredGoodsText ? `目标货品关键词：${preferredGoodsText}` : null,
      diag || '见上方步骤；请确认已打开 erp.huice.com 且订单号与旺店通平台单号一致',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      ...snapshot,
      huiceSkuNames: [],
      huiceError: r.error,
      fetchLogs: [...(snapshot.fetchLogs ?? []), log],
    };
  } catch (e) {
    log.level = 'error';
    log.message = e instanceof Error ? e.message : String(e);
    return {
      ...snapshot,
      huiceError: log.message,
      fetchLogs: [...(snapshot.fetchLogs ?? []), log],
    };
  }
}
