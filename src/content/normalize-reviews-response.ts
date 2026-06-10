import type { ReviewItem, ReviewsListResponse } from '../types/reviews';

type LogDetail = (msg: string, detail?: unknown) => void;

const LIST_KEYS = [
  'data',
  'list',
  'records',
  'items',
  'reviewList',
  'reviewVOList',
  'voList',
  'rows',
  'mallReviewList',
  'commentList',
  'reviewDetails',
  'reviewDetailList',
  'contentList',
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function looksLikeReviewRow(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const idLike = v.reviewId != null || v.orderSn != null;
  const bodyLike = v.comment != null || v.goodsName != null || v.goodsId != null;
  return idLike && bodyLike;
}

function findReviewLikeArrays(obj: unknown, depth: number, basePath: string): { path: string; arr: ReviewItem[] }[] {
  if (depth <= 0 || obj == null) return [];
  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];
    if (looksLikeReviewRow(obj[0])) {
      return [{ path: `${basePath}`, arr: obj as ReviewItem[] }];
    }
    return [];
  }
  if (!isRecord(obj)) return [];
  const out: { path: string; arr: ReviewItem[] }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    out.push(...findReviewLikeArrays(v, depth - 1, `${basePath}.${k}`));
  }
  return out;
}

function collectRoots(raw: unknown, log?: LogDetail): { root: Record<string, unknown>; label: string }[] {
  const out: { root: Record<string, unknown>; label: string }[] = [];

  if (raw == null) return out;

  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) {
      log?.('normalize: 根为字符串且非 JSON 形态', { head: t.slice(0, 80) });
      return out;
    }
    try {
      return collectRoots(JSON.parse(t) as unknown, log);
    } catch {
      log?.('normalize: 根字符串 JSON.parse 失败');
      return out;
    }
  }

  if (!isRecord(raw)) {
    log?.('normalize: 根不是对象', typeof raw);
    return out;
  }

  const o = raw;
  out.push({ root: o, label: 'root' });

  const pushObj = (obj: unknown, label: string) => {
    if (isRecord(obj)) out.push({ root: obj, label });
  };

  pushObj(o.result, 'result');
  pushObj(o.payload, 'payload');

  if (isRecord(o.data)) {
    pushObj(o.data, 'root.data');
  }

  const tryParseString = (v: unknown, label: string) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (!/^[\[{]/.test(t)) return;
    try {
      const p = JSON.parse(t) as unknown;
      if (isRecord(p)) pushObj(p, label);
    } catch {
      /* ignore */
    }
  };

  tryParseString(o.result, 'parse(result)');
  tryParseString(o.data, 'parse(data)');
  tryParseString(o.payload, 'parse(payload)');
  tryParseString(o.body, 'parse(body)');

  return out;
}

function gatherArrayCandidates(top: Record<string, unknown>): { path: string; arr: ReviewItem[] }[] {
  const out: { path: string; arr: ReviewItem[] }[] = [];

  const visit = (rec: Record<string, unknown>, base: string) => {
    for (const k of LIST_KEYS) {
      if (!(k in rec)) continue;
      const v = rec[k];
      if (Array.isArray(v)) {
        out.push({ path: `${base}.${k}`, arr: v as ReviewItem[] });
      }
    }
  };

  visit(top, 'root');

  const nest = (obj: unknown, base: string) => {
    if (isRecord(obj)) {
      visit(obj, base);
    }
  };

  nest(top.result, 'result');
  nest(top.data, 'root.data');
  nest(top.payload, 'payload');

  return out;
}

/** 拼多多等接口：HTTP 200 但 body 里 success:false + errorMsg（无列表字段） */
type FailureCandidate = { code: unknown; msg: string; path: string };

function collectApiFailures(
  raw: unknown,
  seen: WeakSet<object>,
  path: string,
  depth: number
): FailureCandidate[] {
  if (depth > 8 || raw == null) return [];
  if (!isRecord(raw)) return [];
  if (seen.has(raw)) return [];
  seen.add(raw);

  const out: FailureCandidate[] = [];
  const code = raw.error_code ?? raw.errorCode;
  const msgRaw = raw.errorMsg ?? raw.error_message;
  const msg = typeof msgRaw === 'string' ? msgRaw.trim() : '';
  /** success 缺省时仅用 error_code 判断失败；成功列表常为顶层 totalNum + data[]（无 success 字段） */
  const explicitFail = raw.success === false;
  const codeNum = code == null ? NaN : Number(code);
  const implicitFail =
    raw.success !== true && code != null && !Number.isNaN(codeNum) && codeNum !== 0;
  if (explicitFail || implicitFail) {
    if (code != null || msg.length > 0) {
      out.push({ code, msg, path });
    }
  }

  for (const key of ['result', 'data', 'payload'] as const) {
    const child = raw[key];
    if (isRecord(child)) {
      out.push(...collectApiFailures(child, seen, `${path}.${key}`, depth + 1));
    }
  }

  return out;
}

function isGenericFailureMsg(msg: string): boolean {
  const t = msg.trim();
  if (t.length <= 6) return true;
  return /^(系统异常|系统错误|请求异常|操作失败|失败)$/u.test(t);
}

/** 同一响应里可能有多层 success:false（外层 2000018 泛化、内层 40010 权限说明），取信息量最大的一条 */
function pickBestApiFailureMessage(raw: unknown): string | undefined {
  const cands = collectApiFailures(raw, new WeakSet(), 'root', 0);
  if (cands.length === 0) return undefined;
  if (cands.length === 1) {
    const only = cands[0]!;
    const parts: string[] = [];
    if (only.code != null) parts.push(`错误码 ${String(only.code)}`);
    if (only.msg) parts.push(only.msg);
    return parts.length ? `接口未返回评价列表：${parts.join(' · ')}` : undefined;
  }

  const score = (c: FailureCandidate): number => {
    let s = c.msg.length * 3;
    if (isGenericFailureMsg(c.msg)) s -= 2000;
    const codeStr = String(c.code ?? '');
    if (codeStr === '40010') s += 2500;
    else if (codeStr.startsWith('400')) s += 1200;
    else if (codeStr === '2000018') s -= 400;
    return s;
  };

  const sorted = [...cands].sort((a, b) => score(b) - score(a));
  const best = sorted[0]!;
  const parts: string[] = [];
  if (best.code != null) parts.push(`错误码 ${String(best.code)}`);
  if (best.msg) parts.push(best.msg);
  return parts.length ? `接口未返回评价列表：${parts.join(' · ')}` : undefined;
}

function pickTotalNum(...objs: (Record<string, unknown> | undefined)[]): number | undefined {
  for (const o of objs) {
    if (!o) continue;
    if (typeof o.totalNum === 'number') return o.totalNum;
    if (typeof o.totalRows === 'number') return o.totalRows;
    if (typeof o.reviewNum === 'number') return o.reviewNum;
    const r = o.result;
    if (isRecord(r)) {
      if (typeof r.totalNum === 'number') return r.totalNum;
      if (typeof r.totalRows === 'number') return r.totalRows;
    }
  }
  return undefined;
}

function mergeMeta(o: Record<string, unknown>, data: ReviewItem[]): ReviewsListResponse {
  const totalNum = pickTotalNum(o) ?? (o as ReviewsListResponse).totalNum;

  return {
    ...(o as unknown as ReviewsListResponse),
    data,
    totalNum,
  };
}

/** 任意分支若最终 data 为空，仍应带上业务失败说明（例如 success:false 且 data:[] 时原先会漏掉 _error） */
function withEmptyDataError(res: ReviewsListResponse, raw: unknown): ReviewsListResponse {
  if ((res.data?.length ?? 0) > 0) return res;
  if (res._error) return res;
  const msg = pickBestApiFailureMessage(raw);
  return msg ? { ...res, _error: msg } : res;
}

export function normalizeReviewsResponse(raw: unknown, log?: LogDetail): ReviewsListResponse {
  const roots = collectRoots(raw, log);
  if (roots.length === 0) {
    return withEmptyDataError({ data: [] }, raw);
  }

  const candidates: { path: string; arr: ReviewItem[] }[] = [];

  for (const { root, label } of roots) {
    const part = gatherArrayCandidates(root);
    for (const c of part) {
      candidates.push({ path: `${label}>${c.path}`, arr: c.arr });
    }
  }

  if (candidates.length === 0) {
    for (const { root, label } of roots) {
      candidates.push(...findReviewLikeArrays(root, 6, label).map((c) => ({ path: c.path, arr: c.arr })));
    }
  }

  const primary = roots[0]!.root;

  if (candidates.length === 0) {
    const apiFail = pickBestApiFailureMessage(raw);
    if (Object.keys(primary).length === 0) {
      log?.('normalize: 顶层 JSON 无字段（可能为 {} 或异常体），请对比 Network 中该次 reviews/list 原文', {
        rawIsObject: isRecord(raw),
      });
    }
    log?.('normalize: 未识别列表字段', {
      topKeys: Object.keys(primary).slice(0, 35),
      totalNum: primary.totalNum,
      totalRows: primary.totalRows,
      success: primary.success,
      error_code: primary.error_code ?? primary.errorCode,
      ...(apiFail ? { apiFailure: apiFail } : {}),
    });
    const merged = mergeMeta(primary, []);
    const withErr = apiFail ? { ...merged, _error: apiFail } : merged;
    return withEmptyDataError(withErr, raw);
  }

  /** 与 /saturn/reviews/list 成功响应一致时优先顶层 data（文本文档示例：totalNum + data[]） */
  candidates.sort((a, b) => {
    const len = b.arr.length - a.arr.length;
    if (len !== 0) return len;
    const preferData = (p: string) =>
      p.includes('>root.data') || p.endsWith('root.data') || /\.data$/.test(p) ? 1 : 0;
    return preferData(b.path) - preferData(a.path);
  });
  const best = candidates[0]!;
  log?.('normalize: 选用列表', {
    path: best.path,
    len: best.arr.length,
    candidates: candidates.length,
  });

  if (best.arr.length === 0) {
    log?.('normalize: 候选数组均为空，尝试启发式扫描', {
      paths: candidates.map((c) => `${c.path}(${c.arr.length})`).slice(0, 15),
    });
    const fallback: { path: string; arr: ReviewItem[] }[] = [];
    for (const { root, label } of roots) {
      fallback.push(...findReviewLikeArrays(root, 8, label));
    }
    fallback.sort((a, b) => b.arr.length - a.arr.length);
    if (fallback.length > 0 && fallback[0]!.arr.length > 0) {
      log?.('normalize: 启发式命中', { path: fallback[0]!.path, len: fallback[0]!.arr.length });
      return withEmptyDataError(mergeMeta(primary, fallback[0]!.arr), raw);
    }
  }

  return withEmptyDataError(mergeMeta(primary, best.arr), raw);
}
