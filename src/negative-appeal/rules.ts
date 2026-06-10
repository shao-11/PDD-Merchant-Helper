import { appealTextForCode } from './appeal-templates';
import { resolveSupportedReasons } from './platform-reasons';
import type { AppealRecommendation, AppealSnapshot, SupportedAppealReason } from './types';

const SUBJECTIVE_RE =
  /不好吃|太辣|口味|不喜欢|难吃|失望|一般般|不太能|味道下滑|溢出来|散装|包装.*不好|渗油/i;
const QUALITY_RE =
  /质量|破损|污渍|坏了|有问题|不满意|描述不符|少发|发错|磨损|瑕疵|漏油|变质/i;
const AGREE_RE = /达成一致|同意|认可|好的.*退|可以退|已退|补偿|退款成功|协商一致|协商一致/i;
const COMPENSATED_RE = /已补偿|小额打款|打款|退款成功|退货退款/i;

function getPlatformReasons(snapshot: AppealSnapshot): ReturnType<typeof resolveSupportedReasons> {
  return resolveSupportedReasons(snapshot.tuju);
}

function appendHiddenReasonNote(
  basis: string[],
  filteredHidden?: { appealReasonCode: number; appealReasonDesc: string }[],
): void {
  if (!filteredHidden?.length) return;
  basis.push(
    `已排除接口返回但申诉弹窗未展示的 ${filteredHidden.length} 项：${filteredHidden.map((h) => h.appealReasonDesc).join('、')}`,
  );
}

function pickReason(list: SupportedAppealReason[], code: number): SupportedAppealReason | undefined {
  return list.find((r) => r.appealReasonCode === code);
}

/** 平台原因文案不固定时，按描述关键词匹配（如「已安抚并补偿过消费者」） */
function pickCode(
  list: SupportedAppealReason[],
  codes: Set<number>,
  opts: { descRe?: RegExp; preferCodes?: number[]; fallback?: number },
): number {
  if (opts.descRe) {
    const byDesc = list.find((r) => opts.descRe!.test(r.appealReasonDesc ?? ''));
    if (byDesc) return byDesc.appealReasonCode;
  }
  for (const c of opts.preferCodes ?? []) {
    if (codes.has(c)) return c;
  }
  return opts.fallback ?? list[0]!.appealReasonCode;
}

function buildResult(
  snapshot: AppealSnapshot,
  list: SupportedAppealReason[],
  code: number,
  confidence: AppealRecommendation['confidence'],
  basis: string[],
  fromApi: boolean,
): AppealRecommendation {
  const allowed = list.some((r) => r.appealReasonCode === code)
    ? code
    : (list.find((r) => r.appealReasonCode === 99)?.appealReasonCode ?? list[0]?.appealReasonCode ?? 99);
  if (allowed !== code) {
    basis.push(`原因码 ${code} 不在平台可选列表，已改为：${pickReason(list, allowed)?.appealReasonDesc ?? allowed}`);
  }
  const reason = pickReason(list, allowed)!;
  if (!fromApi) {
    basis.push('申诉原因列表来自内置兜底（接口未返回），请与平台「我要申诉」弹窗下拉项核对');
  } else {
    basis.push('申诉原因仅从平台 supportedAppealReason 列表中选取');
  }
  return {
    appealReasonCode: allowed,
    appealReasonDesc: reason.appealReasonDesc,
    appealText: appealTextForCode(allowed, reason.appealDesc),
    confidence,
    basis,
    aiUsed: false,
    platformReasonFromApi: fromApi,
  };
}

/** 规则引擎：只在平台已有原因码中推荐，不编造新原因 */
export function recommendAppeal(snapshot: AppealSnapshot): AppealRecommendation {
  const { list, fromApi, filteredHidden } = getPlatformReasons(snapshot);
  const codes = new Set(list.map((r) => r.appealReasonCode));
  const chatText = snapshot.chatRows.map((r) => r.content).join('\n');
  const hasChat = snapshot.chatRows.length > 0;
  const hasAfter = snapshot.afterSales.length > 0;
  const basis: string[] = [];

  appendHiddenReasonNote(basis, filteredHidden);

  if (!hasChat && !hasAfter) {
    const code = pickCode(list, codes, {
      descRe: /未表达|非商品|咨询/,
      preferCodes: [20, 99],
    });
    basis.push('聊天与售后均无数据：优先「消费者未表达商品问题」或「其他」');
    return buildResult(snapshot, list, code, 'medium', basis, fromApi);
  }

  if (hasChat && AGREE_RE.test(chatText) && hasAfter) {
    const code = pickCode(list, codes, {
      descRe: /达成一致|协商一致|认可/,
      preferCodes: [18, 19, 99],
    });
    basis.push('聊天有协商/认可表述，且存在售后：倾向「已达成一致」或「已补偿」');
    return buildResult(snapshot, list, code, 'high', basis, fromApi);
  }

  if (hasAfter && COMPENSATED_RE.test(chatText + snapshot.afterSales.map((a) => a.afterSalesTitle ?? '').join(''))) {
    const code = pickCode(list, codes, {
      descRe: /补偿|安抚|打款|退款成功/,
      preferCodes: [19, 18],
    });
    if (list.some((r) => r.appealReasonCode === code)) {
      basis.push('存在售后且聊天/售后标题含补偿完成信息：倾向「已补偿/已安抚」类原因');
      return buildResult(snapshot, list, code, 'high', basis, fromApi);
    }
  }

  if (hasChat && SUBJECTIVE_RE.test(chatText) && !AGREE_RE.test(chatText)) {
    const code = pickCode(list, codes, {
      descRe: /误解|主观|口味/,
      preferCodes: [21, 99],
    });
    basis.push('聊天偏主观/口味抱怨，未明确达成一致：倾向「消费者误解」');
    return buildResult(snapshot, list, code, 'medium', basis, fromApi);
  }

  if (hasChat && QUALITY_RE.test(chatText) && !AGREE_RE.test(chatText)) {
    const code = pickCode(list, codes, {
      descRe: /误解|质量|问题/,
      preferCodes: [21, 18, 99],
    });
    basis.push('聊天涉及质量问题但未识别为已达成一致');
    return buildResult(snapshot, list, code, 'medium', basis, fromApi);
  }

  if (hasChat && !QUALITY_RE.test(chatText)) {
    const code = pickCode(list, codes, {
      descRe: /未表达|非商品/,
      preferCodes: [20, 99],
    });
    basis.push('聊天未见明确商品质量问题：倾向「消费者未表达商品问题」');
    return buildResult(snapshot, list, code, 'medium', basis, fromApi);
  }

  const code = pickCode(list, codes, { descRe: /其他/, preferCodes: [99] });
  basis.push('未命中更细规则，建议人工对照聊天后确认');
  return buildResult(snapshot, list, code, 'low', basis, fromApi);
}
