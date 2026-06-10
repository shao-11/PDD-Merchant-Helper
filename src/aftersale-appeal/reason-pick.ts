import { pickAfterSaleRow } from './api-unwrap';
import type { AftersaleAppealSnapshot } from './types';

export type AppealReasonOption = {
  parentReasonCode: number;
  parentReasonCodeDesc: string;
  subReasonCode: number;
  subReasonDesc: string;
};

const SAME_IMAGE_OTHER_ORDER_RE = /与其他.*订单相同|凭证与其他|同图.*其他.*订单/i;

const UNREASONABLE_RE =
  /恶意|威胁|敲诈|仅退款|空包|调包|已签收.*退|不退货|骗|虚假|无理取闹|辱骂/i;
const AGREE_RE = /协商|同意|认可|可以退|已说明/i;
const WRONG_ITEM_RE =
  /错发|发错|不是我|不对版|不对款|不是这款|不是这个|发的不对|货不对|品种不对|规格不对|颜色不对|款式不对|型号不对|买的不对|发成|发成了别的/i;
const MISSING_QTY_RE =
  /少发|漏发|缺件|空包裹|空包少件|里面没有|少一件|数量少|没发全|漏了|少给了|件数不对/i;
const SHIPPED_RE = /已发货|已签收|签收|派件|投递/i;
const NET_IMAGE_RE = /网图|盗图|百度|小红书|同款图|假图/i;
const QUALITY_ISSUE_RE =
  /质量|味道|口感|碎|沫|太小|破损|坏了|不好|不符|假|变质|有问题|不满意|不像/i;

function norm(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

function allowSameImageOtherOrderReason(snapshot: AftersaleAppealSnapshot): boolean {
  const text = [
    ...snapshot.chatRows.map((r) => r.content),
    ...snapshot.afterSales.map((a) => a.afterSalesReasonDesc ?? ''),
    ...snapshot.afterSales.map((a) => a.afterSalesTitle ?? ''),
  ].join('\n');
  return /同图|与其他.*订单|别的订单.*一样|相同凭证|重复.*凭证|其他售后.*相同/i.test(text);
}

function eligibleOptions(
  options: AppealReasonOption[],
  snapshot: AftersaleAppealSnapshot,
): AppealReasonOption[] {
  if (allowSameImageOtherOrderReason(snapshot)) return options;
  const filtered = options.filter((o) => !SAME_IMAGE_OTHER_ORDER_RE.test(o.subReasonDesc));
  return filtered.length ? filtered : options;
}

function findByPatterns(
  options: AppealReasonOption[],
  patterns: RegExp[],
): AppealReasonOption | undefined {
  for (const re of patterns) {
    const hit = options.find((o) => re.test(o.subReasonDesc));
    if (hit) return hit;
  }
  return undefined;
}

function scoreOption(opt: AppealReasonOption, snapshot: AftersaleAppealSnapshot): number {
  const after = pickAfterSaleRow(
    snapshot.afterSales,
    snapshot.orderSn,
    snapshot.afterSalesId,
  );
  const cr = String(after?.afterSalesReasonDesc ?? snapshot.canAppealItem?.reasonDesc ?? '');
  const chat = snapshot.chatRows.map((r) => r.content).join('\n');
  const logistics = (snapshot.logistics?.traces ?? []).map((t) => t.content ?? '').join('\n');
  const d = opt.subReasonDesc;
  let s = 0;

  if (SAME_IMAGE_OTHER_ORDER_RE.test(d)) return -100;

  if (/破损|污渍|质量|描述不符/.test(cr) && /质量|破损|不符|假货/.test(d)) s += 20;
  if (QUALITY_ISSUE_RE.test(cr + chat) && /质量.*凭证不足|凭证不足/.test(d)) s += 24;
  if (MISSING_QTY_RE.test(cr + chat) && /空包|少件|漏件/.test(d)) s += 20;
  if (WRONG_ITEM_RE.test(cr + chat) && /错发/.test(d)) s += 22;
  if (NET_IMAGE_RE.test(chat) && /网图/.test(d)) s += 18;
  if ((/未收到|没收到/.test(cr + chat) || /未收到/.test(chat)) && /未收到.*签收/.test(d)) s += 16;
  if (/打开|看到|拆了|签收|收到了|收到/.test(chat) && /未收到.*签收/.test(d)) s += 14;
  if (SHIPPED_RE.test(logistics) && /未收到.*签收/.test(d)) s += 8;
  if (/^其他原因$|^其他$/.test(cr)) {
    if (/网图/.test(d)) s += 6;
    if (/凭证不足/.test(d)) s += 4;
    if (/未收到/.test(d)) s += 3;
  }
  if (UNREASONABLE_RE.test(chat) && /不实|恶意|不合理/.test(d)) s += 5;
  if (AGREE_RE.test(chat) && /协商|一致/.test(d)) s += 4;

  return s;
}

/** 仅从 checkAppeal 返回的平台可选原因里挑选（与弹窗下拉一致） */
export function pickAppealReason(
  snapshot: AftersaleAppealSnapshot,
  options: AppealReasonOption[],
): AppealReasonOption {
  const opts = eligibleOptions(options, snapshot);
  if (opts.length === 0) {
    return {
      parentReasonCode: 0,
      subReasonCode: 0,
      subReasonDesc: '',
      parentReasonCodeDesc: '',
    };
  }

  let best = opts[0]!;
  let bestScore = -Infinity;
  for (const o of opts) {
    const sc = scoreOption(o, snapshot);
    if (sc > bestScore) {
      bestScore = sc;
      best = o;
    }
  }
  if (bestScore > 0) return best;

  const after = pickAfterSaleRow(
    snapshot.afterSales,
    snapshot.orderSn,
    snapshot.afterSalesId,
  );
  const cr = String(after?.afterSalesReasonDesc ?? snapshot.canAppealItem?.reasonDesc ?? '');
  const chat = snapshot.chatRows.map((r) => r.content).join('\n');

  if (WRONG_ITEM_RE.test(cr + chat)) {
    const hit = findByPatterns(opts, [/错发/]);
    if (hit) return hit;
  }
  if (MISSING_QTY_RE.test(cr + chat)) {
    const hit = findByPatterns(opts, [/空包|少件|漏件/]);
    if (hit) return hit;
  }
  if (/破损|污渍|质量|描述不符/.test(cr)) {
    const hit = findByPatterns(opts, [/质量问题.*凭证不足/, /假货.*正品/]);
    if (hit) return hit;
  }
  if (/^其他原因$|^其他$/.test(cr)) {
    if (NET_IMAGE_RE.test(chat)) {
      const hit = findByPatterns(opts, [/凭证为网图|网图/]);
      if (hit) return hit;
    }
    if (QUALITY_ISSUE_RE.test(chat)) {
      const hit = findByPatterns(opts, [/质量问题.*凭证不足/, /凭证不足/]);
      if (hit) return hit;
    }
    if (WRONG_ITEM_RE.test(chat)) {
      const hit = findByPatterns(opts, [/错发/]);
      if (hit) return hit;
    }
    if (MISSING_QTY_RE.test(chat)) {
      const hit = findByPatterns(opts, [/空包|少件|漏件/]);
      if (hit) return hit;
    }
    const hit = findByPatterns(opts, [
      /凭证不足/,
      /未收到.*签收/,
      /错发/,
      /空包|少件/,
    ]);
    if (hit) return hit;
  }

  return opts.find((o) => !SAME_IMAGE_OTHER_ORDER_RE.test(o.subReasonDesc)) ?? opts[0]!;
}

function normDesc(s: string): string {
  return norm(s);
}

/** 填入前：把推荐原因对齐到平台列表中的完整文案 */
export function resolvePlatformReason(
  rec: Pick<AppealReasonOption, 'subReasonCode' | 'subReasonDesc' | 'parentReasonCode' | 'parentReasonCodeDesc'>,
  options: AppealReasonOption[],
  snapshot: AftersaleAppealSnapshot,
  ruleFallback = true,
): AppealReasonOption {
  const opts = eligibleOptions(options, snapshot);
  if (!opts.length) {
    return { parentReasonCode: 0, parentReasonCodeDesc: '', subReasonCode: 0, subReasonDesc: '' };
  }

  const byCode = opts.find((o) => o.subReasonCode === rec.subReasonCode && rec.subReasonCode > 0);
  if (byCode) return byCode;

  const want = normDesc(rec.subReasonDesc);
  if (want) {
    const exact = opts.find((o) => normDesc(o.subReasonDesc) === want);
    if (exact) return exact;
    const partial = opts.find((o) => {
      const d = normDesc(o.subReasonDesc);
      return d.includes(want) || want.includes(d);
    });
    if (partial) return partial;
  }

  if (ruleFallback) {
    return pickAppealReason(snapshot, opts);
  }

  return {
    parentReasonCode: rec.parentReasonCode ?? 0,
    parentReasonCodeDesc: rec.parentReasonCodeDesc ?? '',
    subReasonCode: rec.subReasonCode ?? 0,
    subReasonDesc: rec.subReasonDesc ?? '',
  };
}

export function isAppealReasonAllowed(
  subReasonDesc: string,
  snapshot: AftersaleAppealSnapshot,
): boolean {
  if (!SAME_IMAGE_OTHER_ORDER_RE.test(subReasonDesc)) return true;
  return allowSameImageOtherOrderReason(snapshot);
}

/** 弹窗下拉可见项与 API 不一致时，从可见文案里按规则打分选最优 */
export function pickBestFromVisibleLabels(
  snapshot: AftersaleAppealSnapshot,
  labels: string[],
): string {
  const uniq = [...new Set(labels.map((s) => s.trim()).filter(Boolean))];
  if (!uniq.length) return '';
  const options: AppealReasonOption[] = uniq.map((desc, i) => ({
    parentReasonCode: 0,
    parentReasonCodeDesc: '',
    subReasonCode: i + 1,
    subReasonDesc: desc,
  }));
  return pickAppealReason(snapshot, options).subReasonDesc;
}
