import type { SupportedAppealReason } from './types';

/**
 * tuju/detail 仍可能返回，但「发起申诉」弹窗已不再展示（与页面 radio 不一致），AI/下拉须排除。
 */
export const HIDDEN_APPEAL_REASON_CODES: readonly number[] = [10248, 10268, 10265];

const HIDDEN_APPEAL_REASON_DESC: Record<number, string> = {
  10248: '已安抚并补偿过消费者',
  10268: '已解决问题不应额外补偿',
  10265: '补偿金额过高',
};

export function filterSelectableAppealReasons(list: SupportedAppealReason[]): {
  list: SupportedAppealReason[];
  removed: SupportedAppealReason[];
} {
  const hidden = new Set(HIDDEN_APPEAL_REASON_CODES);
  const removed: SupportedAppealReason[] = [];
  const kept = list.filter((r) => {
    if (hidden.has(r.appealReasonCode)) {
      removed.push(r);
      return false;
    }
    return true;
  });
  return { list: kept, removed };
}

export type ResolveSupportedReasonsResult = {
  list: SupportedAppealReason[];
  fromApi: boolean;
  /** 已从接口列表剔除、不在申诉弹窗中的项 */
  filteredHidden?: { appealReasonCode: number; appealReasonDesc: string }[];
};

/**
 * 与 colombo/tuju/detail 响应中 supportedAppealReason 一致（你提供的抓包）。
 * 仅在接口未返回列表时作下拉兜底，推荐仍须人工对照平台弹窗确认。
 */
export const DEFAULT_SUPPORTED_APPEAL_REASONS: SupportedAppealReason[] = [
  {
    appealReasonCode: 18,
    appealReasonDesc: '商品有问题，但已与消费者达成一致',
    appealDesc: '请详细描述申诉原因，如已与消费者协商一致，并得到消费者认可',
  },
  {
    appealReasonCode: 19,
    appealReasonDesc: '商品有问题，已补偿消费者',
    appealDesc: '请详细描述申诉原因，如您已与消费者协商一致，并完成补偿',
  },
  {
    appealReasonCode: 20,
    appealReasonDesc: '消费者未表达商品问题',
    appealDesc:
      '请详细描述申诉原因，如消费者反馈非收到商品相关的其他问题，或未在售后内反馈商品问题',
  },
  {
    appealReasonCode: 21,
    appealReasonDesc: '商品无问题，消费者误解',
    appealDesc: '请详细描述申诉原因，如消费者误解但已解释并获得认可等',
  },
  {
    appealReasonCode: 99,
    appealReasonDesc: '其他',
    appealDesc: '请详细描述申诉原因，如负向体验判定有误的其他场景',
  },
];

/** 从任意嵌套 JSON 中查找 supportedAppealReason 数组 */
export function extractSupportedReasons(json: unknown): SupportedAppealReason[] | undefined {
  if (!json || typeof json !== 'object') return undefined;

  const visit = (node: unknown, depth: number): SupportedAppealReason[] | undefined => {
    if (!node || typeof node !== 'object' || depth > 8) return undefined;
    const o = node as Record<string, unknown>;

    const raw = o.supportedAppealReason ?? o.supported_appeal_reason;
    if (Array.isArray(raw) && raw.length > 0) {
      const list = raw.filter(
        (r) => r && typeof r === 'object' && typeof (r as SupportedAppealReason).appealReasonCode === 'number',
      ) as SupportedAppealReason[];
      if (list.length > 0) return list;
    }

    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') {
        const found = visit(v, depth + 1);
        if (found?.length) return found;
      }
    }
    return undefined;
  };

  return visit(json, 0);
}

function finalizeReasonList(
  raw: SupportedAppealReason[],
  fromApi: boolean,
): ResolveSupportedReasonsResult {
  if (!fromApi) {
    return { list: raw, fromApi: false };
  }
  const { list, removed } = filterSelectableAppealReasons(raw);
  const filteredHidden = removed.map((r) => ({
    appealReasonCode: r.appealReasonCode,
    appealReasonDesc: r.appealReasonDesc ?? HIDDEN_APPEAL_REASON_DESC[r.appealReasonCode] ?? String(r.appealReasonCode),
  }));
  if (list.length > 0) {
    return { list, fromApi: true, filteredHidden: filteredHidden.length ? filteredHidden : undefined };
  }
  if (filteredHidden.length > 0) {
    return { list: DEFAULT_SUPPORTED_APPEAL_REASONS, fromApi: false, filteredHidden };
  }
  return { list: DEFAULT_SUPPORTED_APPEAL_REASONS, fromApi: false };
}

export function resolveSupportedReasons(
  tuju: { supportedAppealReason?: SupportedAppealReason[] } | null | undefined,
  rawJson?: unknown,
): ResolveSupportedReasonsResult {
  const fromTuju = tuju?.supportedAppealReason?.filter((r) => r?.appealReasonCode != null) ?? [];
  if (fromTuju.length > 0) return finalizeReasonList(fromTuju, true);

  const extracted = rawJson ? extractSupportedReasons(rawJson) : undefined;
  if (extracted?.length) return finalizeReasonList(extracted, true);

  return { list: DEFAULT_SUPPORTED_APPEAL_REASONS, fromApi: false };
}
