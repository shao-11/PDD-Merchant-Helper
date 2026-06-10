import { looksLikeTradeQueryJson, summarizeHuiceJson, summarizeHuiceTextPreview } from './huice-debug';

/** 解析 tradeQuery 响应，按拼多多订单号取旺店通 skuName（与在线质检表 A 列更接近） */

export type HuiceSkuQueryResult = {
  ok: boolean;
  orderSn: string;
  skuNames: string[];
  preferredSkuCodes?: string[];
  matchedSkuCodes?: string[];
  preferredGoodsText?: string;
  error?: string;
  debug?: string;
  logs?: string[];
};

function tidMatches(itemTid: unknown, orderSn: string): boolean {
  const o = orderSn.trim();
  if (!o) return false;
  const t = String(itemTid ?? '').trim();
  if (!t) return false;
  if (t === o) return true;
  if (t.startsWith(`${o}:`)) return true;
  if (t.includes(o)) return true;
  return false;
}

function pushName(set: Set<string>, v: unknown): void {
  const s = String(v ?? '').trim();
  if (s.length >= 2) set.add(s);
}

function pushPrimaryName(set: Set<string>, item: Record<string, unknown>): void {
  const primary = String(item.skuName ?? item.spuName ?? item.suiteName ?? '').trim();
  if (primary) {
    set.add(primary);
    return;
  }
  // 兜底：没有 skuName 时再放宽
  pushName(set, item.suiteName);
  pushName(set, item.spuName);
}

function normalizeSkuCode(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

function extractSkuCodesFromItem(item: Record<string, unknown>): string[] {
  const keys = [
    'skuNo',
    'sku_no',
    'spSkuNo',
    'skuCode',
    'sku_code',
    'goodsNo',
    'goods_no',
    'outerSkuNo',
    'outer_sku_no',
  ];
  const set = new Set<string>();
  for (const k of keys) {
    const v = normalizeSkuCode(item[k]);
    if (/^SKU[0-9A-Z-]{4,}$/.test(v)) set.add(v);
  }
  return [...set];
}

function normalizeTextForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s()（）【】\[\]\-_*]+/g, '')
    .trim();
}

function tokenizeMatchText(s: string): string[] {
  const t = normalizeTextForMatch(s);
  if (!t) return [];
  const cn = t.match(/[\u4e00-\u9fa5]{1,4}/g) ?? [];
  const en = t.match(/[a-z0-9]{2,}/g) ?? [];
  return [...new Set([...cn, ...en].filter((x) => x.length >= 2))];
}

function scoreItemAgainstGoodsText(item: Record<string, unknown>, preferredGoodsText: string): number {
  const tokens = tokenizeMatchText(preferredGoodsText);
  if (!tokens.length) return 0;
  const baseText = [item.skuName, item.suiteName, item.spuName].map((v) => String(v ?? '')).join(' ');
  const norm = normalizeTextForMatch(baseText);
  const preferredNorm = normalizeTextForMatch(preferredGoodsText);
  if (!norm) return 0;
  let score = 0;
  if (preferredNorm && norm === preferredNorm) score += 120;
  else if (preferredNorm && norm.includes(preferredNorm)) score += 90;
  else if (preferredNorm && preferredNorm.includes(norm) && norm.length >= 8) score += 50;
  for (const t of tokens) {
    if (!t) continue;
    if (norm.includes(t)) score += t.length >= 3 ? 4 : 2;
  }
  if (norm.includes('+') && preferredNorm && !preferredNorm.includes('+')) score -= 4;
  return score;
}

function isTradeRecord(row: unknown): row is Record<string, unknown> {
  return Boolean(row && typeof row === 'object' && Array.isArray((row as Record<string, unknown>).orderItemList));
}

function findTradeArrayDeep(node: unknown, depth: number): { trades: Record<string, unknown>[]; hint: string } | null {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    const tradeRows = node.filter(isTradeRecord) as Record<string, unknown>[];
    if (tradeRows.length > 0) {
      return { trades: tradeRows, hint: `deep[${depth}]` };
    }
    for (const item of node) {
      const f = findTradeArrayDeep(item, depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > 0 && isTradeRecord(v[0])) {
        return { trades: v.filter(isTradeRecord) as Record<string, unknown>[], hint: `key.${k}` };
      }
      const f = findTradeArrayDeep(v, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

/** data 可能是数组，也可能是 { list: [...] } 等嵌套结构 */
export function extractTradesArray(json: unknown): { trades: Record<string, unknown>[]; hint: string } {
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const data = root.data;

  if (Array.isArray(data)) {
    const trades = data.filter(isTradeRecord) as Record<string, unknown>[];
    if (trades.length) return { trades, hint: 'data[]' };
    const any = data.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
    if (any.length) return { trades: any, hint: 'data[](loose)' };
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const k of ['list', 'records', 'rows', 'data', 'items', 'tradeList', 'dataList', 'pageData', 'result']) {
      const v = d[k];
      if (Array.isArray(v) && v.length > 0) {
        const trades = v.filter(isTradeRecord) as Record<string, unknown>[];
        if (trades.length) return { trades, hint: `data.${k}[]` };
        if (v[0] && typeof v[0] === 'object') {
          return { trades: v as Record<string, unknown>[], hint: `data.${k}[](loose)` };
        }
      }
    }
    const deep = findTradeArrayDeep(d, 0);
    if (deep) return { ...deep, hint: `data.${deep.hint}` };
    return {
      trades: [],
      hint: `data.object keys=${Object.keys(d).slice(0, 12).join(',')}`,
    };
  }

  const deepRoot = findTradeArrayDeep(root, 0);
  if (deepRoot) return deepRoot;

  return { trades: [], hint: 'no-trade-array' };
}

export function buildTradeQueryBody(orderSn: string): Record<string, unknown> {
  return {
    logisticsStatusWaringFast: 0,
    strcTidsList: [orderSn.trim()],
    containSkuSuiteType: 0,
    containSkuSuiteGoodsType: 0,
    excludeSkuSuiteType: 0,
    noSearchField: 0,
    noSearchType: 0,
    isIncludeAbnormal: true,
    containRemarkType: 3,
    containMessageType: 3,
    suiteSearchField: 0,
    suiteSearchType: 0,
    anchorSearchField: 0,
    anchorSearchType: 1,
    excludeAnchorSearchField: 0,
    excludeAnchorSearchType: 1,
    containRemarkFlag: 1,
    remarkFlagList: [],
    pageTab: 'ALL_ORDER',
    containSkuIdList: [],
    containSuiteIdList: [],
    manualExcludeSkuIdList: [],
    manualExcludeSuiteIdList: [],
    remarkContainMultiContent: true,
    abnormalIdFastList: [],
    calcTotalCount: false,
    currentPage: 1,
    pageSize: 50,
  };
}

export function parseSkuNamesFromTradeQuery(
  json: unknown,
  orderSn: string,
  opts?: {
    httpStatus?: number;
    channel?: string;
    frameMeta?: string;
    preferredSkuCodes?: string[];
    preferredGoodsText?: string;
  },
): HuiceSkuQueryResult {
  const o = orderSn.trim();
  const logs: string[] = [];
  const httpStatus = opts?.httpStatus ?? 200;
  const { trades, hint: extractHint } = extractTradesArray(json);
  const preferredSkuCodes = [...new Set((opts?.preferredSkuCodes ?? []).map(normalizeSkuCode))].filter(
    (x) => /^SKU[0-9A-Z-]{4,}$/.test(x),
  );
  const preferredGoodsText = String(opts?.preferredGoodsText ?? '').trim();
  const preferredSet = new Set(preferredSkuCodes);
  const observedSkuCodes = new Set<string>();
  const matchedSkuCodes = new Set<string>();

  logs.push(
    `解析响应 · channel=${opts?.channel ?? '?'} · ${opts?.frameMeta ?? ''} · ${summarizeHuiceJson(json, httpStatus)} · extract=${extractHint}`,
  );
  if (preferredSkuCodes.length) {
    logs.push(`按货品编码优先过滤：${preferredSkuCodes.join('；')}`);
  } else if (preferredGoodsText) {
    logs.push(`按当前商品关键词过滤：${preferredGoodsText}`);
  }

  if (!trades.length) {
    return {
      ok: false,
      orderSn: o,
      skuNames: [],
      error:
        '旺店通 JSON 中未找到 trade 列表（data 非数组或缺少 orderItemList；可能拿到了其它接口的 11268 字节配置包）',
      debug: logs.join('\n'),
      logs,
    };
  }

  const names = new Set<string>();
  for (const t of trades) {
    const before = names.size;
    const srcTids = String(t.srcTids ?? t.tid ?? '');
    const tradeRelates =
      tidMatches(t.tid, o) ||
      tidMatches(t.srcTids, o) ||
      srcTids.split(',').some((x) => tidMatches(x.trim(), o));

    const items = Array.isArray(t.orderItemList) ? t.orderItemList : [];
    const matchedItems: { item: Record<string, unknown>; skuCodes: string[]; goodsScore: number }[] = [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const itemSkuCodes = extractSkuCodesFromItem(item);
      itemSkuCodes.forEach((c) => observedSkuCodes.add(c));
      const skuCodeHit = preferredSet.size === 0 || itemSkuCodes.some((c) => preferredSet.has(c));
      const goodsScore = preferredSet.size === 0 ? scoreItemAgainstGoodsText(item, preferredGoodsText) : 0;
      const goodsHit = preferredSet.size > 0 || !preferredGoodsText || goodsScore > 0;
      const hit =
        tidMatches(item.srcTid, o) ||
        tidMatches(item.srcTids, o) ||
        tidMatches(item.srcOid, o) ||
        (tradeRelates && items.length === 1);
      if (!hit || !skuCodeHit || !goodsHit) continue;
      matchedItems.push({ item, skuCodes: itemSkuCodes, goodsScore });
    }

    if (preferredSet.size === 0 && preferredGoodsText && matchedItems.length) {
      matchedItems.sort((a, b) => b.goodsScore - a.goodsScore);
      const top = matchedItems[0]?.goodsScore ?? 0;
      const second = matchedItems[1]?.goodsScore ?? 0;
      if (top > 0) {
        const best = matchedItems[0];
        logs.push(`关键词评分：top=${top} second=${second}，锁定 1 个候选`);
        best.skuCodes.forEach((c) => matchedSkuCodes.add(c));
        pushPrimaryName(names, best.item);
      }
    } else {
      for (const row of matchedItems) {
        row.skuCodes.forEach((c) => {
          if (preferredSet.size === 0 || preferredSet.has(c)) matchedSkuCodes.add(c);
        });
        if (preferredSet.size > 0 || preferredGoodsText) {
          // 已有过滤条件时，避免 suiteName/spuName 扩散为多规格
          pushPrimaryName(names, row.item);
        } else {
          pushName(names, row.item.skuName);
          pushName(names, row.item.suiteName);
          pushName(names, row.item.spuName);
        }
      }
    }
    if (names.size === before && tradeRelates && preferredSet.size === 0 && !preferredGoodsText) {
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        pushName(names, item.skuName);
        pushName(names, item.suiteName);
      }
    }
    logs.push(
      `trade · tid=${String(t.tid ?? '').slice(0, 32)} · items=${items.length} · 累计规格=${names.size}`,
    );
  }

  if (!names.size) {
    if (preferredSet.size > 0) {
      const observedText = [...observedSkuCodes].join('；') || '（无）';
      logs.push(`按指定货品编码未命中；订单内可见编码：${observedText}`);
      return {
        ok: false,
        orderSn: o,
        skuNames: [],
        preferredSkuCodes,
        preferredGoodsText: preferredGoodsText || undefined,
        matchedSkuCodes: [],
        error: `未命中指定货品编码：${preferredSkuCodes.join('；')}`,
        debug: logs.join('\n'),
        logs,
      };
    }
    logs.push('严格匹配无 skuName，使用本批全部 orderItemList');
    for (const t of trades) {
      const items = Array.isArray(t.orderItemList) ? t.orderItemList : [];
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        pushName(names, item.skuName);
        pushName(names, item.suiteName);
      }
    }
  }

  if (!names.size) {
    return {
      ok: false,
      orderSn: o,
      skuNames: [],
      error: `旺店通有 ${trades.length} 条 trade 但未解析到 skuName`,
      debug: logs.join('\n'),
      logs,
    };
  }

  logs.push(`命中 skuName：${[...names].join('；')}`);
  return {
    ok: true,
    orderSn: o,
    skuNames: [...names],
    preferredSkuCodes: preferredSkuCodes.length ? preferredSkuCodes : undefined,
    preferredGoodsText: preferredGoodsText || undefined,
    matchedSkuCodes: [...matchedSkuCodes],
    debug: logs.join('\n'),
    logs,
  };
}

export function parseHuiceRawResponse(
  text: string,
  orderSn: string,
  httpStatus: number,
  channel: string,
  frameMeta?: string,
  preferredSkuCodes?: string[],
  preferredGoodsText?: string,
): HuiceSkuQueryResult {
  const logs: string[] = [
    `原始响应 · channel=${channel} · HTTP ${httpStatus} · len=${text.length} · ${frameMeta ?? ''}`,
  ];

  if (!text.trim()) {
    return {
      ok: false,
      orderSn,
      skuNames: [],
      error: '旺店通响应体为空',
      debug: logs.join('\n'),
      logs,
    };
  }

  if (!looksLikeTradeQueryJson(text)) {
    logs.push('跳过：响应体不含 orderItemList/skuName，非 tradeQuery 订单 JSON');
    return {
      ok: false,
      orderSn,
      skuNames: [],
      error: '非 tradeQuery 订单数据（iframe 抢答或接口地址错误）',
      debug: logs.join('\n'),
      logs,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    logs.push(`非 JSON：${summarizeHuiceTextPreview(text)}`);
    return {
      ok: false,
      orderSn,
      skuNames: [],
      error: '旺店通返回非 JSON',
      debug: logs.join('\n'),
      logs,
    };
  }

  const parsed = parseSkuNamesFromTradeQuery(json, orderSn, {
    httpStatus,
    channel,
    frameMeta,
    preferredSkuCodes,
    preferredGoodsText,
  });
  return {
    ...parsed,
    logs: [...logs, ...(parsed.logs ?? [])],
    debug: [...logs, parsed.debug ?? ''].filter(Boolean).join('\n'),
  };
}
