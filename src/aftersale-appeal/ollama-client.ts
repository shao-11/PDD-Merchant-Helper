import { buildChatSampleForAi } from '../utils/chat-history-parse';
import { getBailianAiConfig } from '../negative-appeal/ai-config';
import { BAILIAN_MODEL_DEFAULT } from '../negative-appeal/constants';
import type { FetchStepLog } from '../negative-appeal/fetch-log';
import { extractOllamaText, requestOllamaChat, requestOllamaDiagnose } from '../negative-appeal/ollama-transport';
import {
  effectiveCanAppealItem,
  flattenReasonOptions,
  fenToYuan,
  maxAppealFen,
  findReasonOptionByDesc,
  reasonLabelMatches,
  reasonOptionsFromVisibleLabels,
} from './api-unwrap';
import {
  buildAftersaleAppealAiSystemPrompt,
  buildAppealDescriptionWithEvidenceSystemPrompt,
  sanitizeDescription,
} from './appeal-ai-prompt';
import { isAppealReasonAllowed, resolvePlatformReason } from './reason-pick';
import { recommendAftersaleAppeal } from './rules';
import type { AftersaleAppealRecommendation, AftersaleAppealSnapshot } from './types';

function mergeLogs(...parts: FetchStepLog[][]): FetchStepLog[] {
  return parts.flat();
}

function normReason(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

function recommendationMatchesVisible(desc: string, visibleLabels: string[]): string | undefined {
  if (!desc?.trim()) return undefined;
  const exact = visibleLabels.find((v) => normReason(v) === normReason(desc));
  if (exact) return exact;
  return visibleLabels.find((v) => reasonLabelMatches(desc, v));
}

function resolveHitFromVisibleOptions(
  visibleLabels: string[],
  visibleOptions: ReturnType<typeof reasonOptionsFromVisibleLabels>,
  code: number,
  descFromAi: string,
): ReturnType<typeof reasonOptionsFromVisibleLabels>[number] | undefined {
  const hit =
    matchAiReason(visibleOptions, code, descFromAi) ??
    (descFromAi ? findReasonOptionByDesc(descFromAi, visibleOptions) : undefined);
  if (hit) {
    const exact = visibleLabels.find((v) => normReason(v) === normReason(hit.subReasonDesc));
    if (exact) return { ...hit, subReasonDesc: exact };
    return hit;
  }

  const want = normReason(descFromAi);
  if (!want) return undefined;

  for (const label of visibleLabels) {
    const d = normReason(label);
    if (d === want || reasonLabelMatches(label, descFromAi)) {
      return visibleOptions.find((o) => normReason(o.subReasonDesc) === d) ?? {
        appealSubTypeCode: 0,
        parentReasonCode: 0,
        parentReasonCodeDesc: '',
        subReasonCode: visibleOptions.find((o) => normReason(o.subReasonDesc) === d)?.subReasonCode ?? 0,
        subReasonDesc: label,
      };
    }
    if (want.length >= 10 && (d.startsWith(want) || want.startsWith(d))) {
      const opt = visibleOptions.find((o) => normReason(o.subReasonDesc) === d);
      if (opt) return { ...opt, subReasonDesc: label };
    }
  }
  return undefined;
}

async function refineWithVisibleOnly(
  snapshot: AftersaleAppealSnapshot,
  base: AftersaleAppealRecommendation,
  visibleLabels: string[],
  diagLogs: FetchStepLog[],
): Promise<AftersaleAppealRecommendation> {
  const visibleOptions = reasonOptionsFromVisibleLabels(visibleLabels);
  const maxYuan = Number(fenToYuan(maxAppealFen(snapshot)));
  const canAppeal = effectiveCanAppealItem(snapshot);
  const chatSample = buildChatSampleForAi(snapshot.chatRows);

  const summary = {
    orderSn: snapshot.orderSn,
    afterSalesId: snapshot.afterSalesId,
    canAppeal,
    afterSales: snapshot.afterSales.map((a) => ({
      type: a.afterSalesTypeName,
      reason: a.afterSalesReasonDesc,
      title: a.afterSalesTitle,
      refundFen: a.refundAmount,
    })),
    orderStatus: snapshot.orderDetail?.order_status_str,
    chatSample,
    logisticsTraces: (snapshot.logistics?.traces ?? []).slice(-6).map((t) => t.content),
    visibleReasonOptions: visibleOptions,
    note: '【硬性要求】subReasonDesc 必须与 visibleReasonOptions 中某一项原文完全一致，不得改写、不得自造。若选「非以上申诉原因」，subReasonDesc 填该项原文。',
    maxAppealAmountYuan: maxYuan,
  };

  const { model } = await getBailianAiConfig();
  const body = {
    model: model || BAILIAN_MODEL_DEFAULT,
    stream: false as const,
    messages: [
      { role: 'system', content: buildAftersaleAppealAiSystemPrompt(visibleOptions) },
      { role: 'user', content: JSON.stringify(summary) },
    ],
  };

  const { data: json, logs } = await requestOllamaChat(body);
  const text = extractOllamaText(json);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 未能根据弹窗下拉选项确定申诉原因');

  const parsed = JSON.parse(match[0]) as {
    subReasonCode?: number;
    subReasonDesc?: string;
    appealAmountYuan?: string;
    description?: string;
  };

  const code = Number(parsed.subReasonCode);
  const descFromAi = String(parsed.subReasonDesc ?? '').trim();
  const hit = resolveHitFromVisibleOptions(visibleLabels, visibleOptions, code, descFromAi);

  if (!hit) {
    throw new Error(
      `AI 返回的申诉原因不在弹窗下拉中（desc=${descFromAi || '—'}），可见项：${visibleLabels.slice(0, 3).join('；')}`,
    );
  }

  let amount = String(parsed.appealAmountYuan ?? base.appealAmountYuan).trim();
  const amountNum = Number(amount);
  if (Number.isFinite(amountNum) && maxYuan > 0 && amountNum > maxYuan) {
    amount = maxYuan.toFixed(2);
  }

  const desc = sanitizeDescription(String(parsed.description ?? base.description));

  return {
    ...base,
    parentReasonCode: hit.parentReasonCode,
    subReasonCode: hit.subReasonCode,
    subReasonDesc: hit.subReasonDesc,
    appealAmountYuan: amount,
    description: desc || base.description,
    confidence: 'medium',
    basis: [
      ...(base.basis ?? []),
      `AI 根据弹窗下拉 ${visibleLabels.length} 项选择：${hit.subReasonDesc}`,
    ],
    aiUsed: true,
    aiLogs: mergeLogs(diagLogs, logs),
    visibleReasonLabels: visibleLabels,
  };
}

/** 自动填入：仅从弹窗下拉可见项中由 AI 选择申诉原因 */
export async function buildAftersaleRecommendationFromVisible(
  snapshot: AftersaleAppealSnapshot,
  visibleLabels: string[],
): Promise<AftersaleAppealRecommendation> {
  const labels = [...new Set(visibleLabels.map((s) => s.trim()).filter(Boolean))];
  if (!labels.length) {
    throw new Error('未能读取申诉原因下拉选项，请确认「维权申诉」弹窗已打开');
  }

  const base = recommendAftersaleAppeal(snapshot);
  let diagLogs: FetchStepLog[] = [];
  try {
    const diag = await requestOllamaDiagnose();
    diagLogs = diag.logs;
  } catch (e) {
    diagLogs = [
      {
        step: 'AI-诊断',
        level: 'warn',
        message: e instanceof Error ? e.message : String(e),
        at: Date.now(),
      },
    ];
  }
  return refineWithVisibleOnly(snapshot, base, labels, diagLogs);
}

/** 分析结果与弹窗下拉不一致时，用可见项让 AI 重新对齐 */
export async function alignRecommendationToVisibleOptions(
  snapshot: AftersaleAppealSnapshot,
  recommendation: AftersaleAppealRecommendation,
  visibleLabels: string[],
): Promise<AftersaleAppealRecommendation> {
  const labels = [...new Set(visibleLabels.map((s) => s.trim()).filter(Boolean))];
  if (!labels.length) return recommendation;

  const matched = recommendationMatchesVisible(recommendation.subReasonDesc, labels);
  if (matched) {
    return { ...recommendation, subReasonDesc: matched };
  }

  let diagLogs: FetchStepLog[] = recommendation.aiLogs ?? [];
  try {
    const diag = await requestOllamaDiagnose();
    diagLogs = mergeLogs(diagLogs, diag.logs);
  } catch {
    /* ignore */
  }

  return refineWithVisibleOnly(snapshot, recommendation, labels, diagLogs);
}

function matchAiReason(
  reasonOptions: ReturnType<typeof flattenReasonOptions>,
  code: number,
  descFromAi: string,
) {
  return (
    reasonOptions.find((r) => r.subReasonCode === code && code > 0) ??
    (descFromAi
      ? reasonOptions.find(
          (r) =>
            r.subReasonDesc === descFromAi ||
            r.subReasonDesc.includes(descFromAi) ||
            descFromAi.includes(r.subReasonDesc),
        )
      : undefined)
  );
}

async function refineWithAi(
  snapshot: AftersaleAppealSnapshot,
  base: AftersaleAppealRecommendation,
  diagLogs: FetchStepLog[],
): Promise<AftersaleAppealRecommendation> {
  const reasonOptions = flattenReasonOptions(snapshot.checkAppeal ?? undefined);
  if (reasonOptions.length === 0) {
    throw new Error('未拉取到平台申诉原因列表（checkAppeal），请重新打开「发起申诉」弹窗后再试');
  }

  const maxYuan = Number(fenToYuan(maxAppealFen(snapshot)));
  const canAppeal = effectiveCanAppealItem(snapshot);

  const chatSample = buildChatSampleForAi(snapshot.chatRows);
  const summary = {
    orderSn: snapshot.orderSn,
    afterSalesId: snapshot.afterSalesId,
    canAppeal,
    afterSales: snapshot.afterSales.map((a) => ({
      type: a.afterSalesTypeName,
      reason: a.afterSalesReasonDesc,
      title: a.afterSalesTitle,
      refundFen: a.refundAmount,
    })),
    orderStatus: snapshot.orderDetail?.order_status_str,
    chatSample,
    chatCount: chatSample.length,
    logisticsTraces: (snapshot.logistics?.traces ?? []).slice(-6).map((t) => t.content),
    reasonOptions,
    complainTypeOptions: (snapshot.complainTypes ?? []).map((t) => ({
      code: t.complainType,
      desc: t.complainTypeDesc,
    })),
    maxAppealAmountYuan: maxYuan,
    ruleHints: {
      appealAmountYuan: base.appealAmountYuan,
      note: '申诉原因勿参考此项，必须根据 chatSample 与 afterSales 自行从 reasonOptions 选择',
    },
  };

  const { model } = await getBailianAiConfig();
  const body = {
    model: model || BAILIAN_MODEL_DEFAULT,
    stream: false as const,
    messages: [
      { role: 'system', content: buildAftersaleAppealAiSystemPrompt(reasonOptions) },
      { role: 'user', content: JSON.stringify(summary) },
    ],
  };

  const { data: json, logs } = await requestOllamaChat(body);
  const text = extractOllamaText(json);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 未返回有效 JSON，无法确定申诉原因');

  const parsed = JSON.parse(match[0]) as {
    subReasonCode?: number;
    subReasonDesc?: string;
    appealAmountYuan?: string;
    description?: string;
    complainConsumer?: boolean;
    complainTypeCode?: number;
    complainTypeDesc?: string;
    basis?: string[];
  };

  const code = Number(parsed.subReasonCode);
  const descFromAi = String(parsed.subReasonDesc ?? '').trim();
  const hit = matchAiReason(reasonOptions, code, descFromAi);

  if (!hit) {
    throw new Error(
      `AI 返回的申诉原因不在平台列表中（code=${code || '—'}，desc=${descFromAi || '—'}），请重试或人工选择`,
    );
  }

  const platform = resolvePlatformReason(hit, reasonOptions, snapshot, false);

  let amount = String(parsed.appealAmountYuan ?? base.appealAmountYuan).trim();
  const amountNum = Number(amount);
  if (Number.isFinite(amountNum) && maxYuan > 0 && amountNum > maxYuan) {
    amount = maxYuan.toFixed(2);
  }

    const desc = sanitizeDescription(String(parsed.description ?? base.description));
  const reasonNote = !isAppealReasonAllowed(hit.subReasonDesc, snapshot)
    ? `AI 选择了「${platform.subReasonDesc}」，请核对聊天是否支持该原因`
    : `AI 根据聊天记录从平台选项中选择：${platform.subReasonDesc}`;

  return {
    ...base,
    parentReasonCode: platform.parentReasonCode,
    subReasonCode: platform.subReasonCode,
    subReasonDesc: platform.subReasonDesc,
    appealAmountYuan: amount,
    description: desc || base.description,
    complainConsumer: Boolean(parsed.complainConsumer),
    complainTypeCode: parsed.complainConsumer ? Number(parsed.complainTypeCode) || undefined : undefined,
    complainTypeDesc: parsed.complainConsumer
      ? String(parsed.complainTypeDesc ?? base.complainTypeDesc ?? '')
      : undefined,
    confidence: 'medium',
    basis: [...(Array.isArray(parsed.basis) ? parsed.basis.map(String) : []), reasonNote],
    aiUsed: true,
    aiLogs: mergeLogs(diagLogs, logs),
  };
}

/** 选中申诉原因并读取「必填凭证」说明后，重写申诉描述 */
export async function refineAppealDescriptionWithEvidence(
  snapshot: AftersaleAppealSnapshot,
  rec: AftersaleAppealRecommendation,
  evidenceHints: string[],
): Promise<{ description: string; aiLogs: FetchStepLog[] }> {
  const hints = [...new Set(evidenceHints.map((s) => s.trim()).filter(Boolean))];
  if (!hints.length) {
    return { description: rec.description, aiLogs: [] };
  }

  const summary = {
    orderSn: snapshot.orderSn,
    afterSalesId: snapshot.afterSalesId,
    appealReason: rec.subReasonDesc,
    requiredEvidenceHints: hints,
    afterSales: snapshot.afterSales.map((a) => ({
      type: a.afterSalesTypeName,
      reason: a.afterSalesReasonDesc,
      title: a.afterSalesTitle,
    })),
    chatSample: buildChatSampleForAi(snapshot.chatRows),
    logisticsTraces: (snapshot.logistics?.traces ?? []).slice(-6).map((t) => t.content),
    draftDescription: rec.description,
  };

  const { model } = await getBailianAiConfig();
  const body = {
    model: model || BAILIAN_MODEL_DEFAULT,
    stream: false as const,
    messages: [
      { role: 'system', content: buildAppealDescriptionWithEvidenceSystemPrompt() },
      { role: 'user', content: JSON.stringify(summary) },
    ],
  };

  const { data: json, logs } = await requestOllamaChat(body);
  const text = extractOllamaText(json);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { description: rec.description, aiLogs: logs };
  }

  try {
    const parsed = JSON.parse(match[0]) as { description?: string };
    const desc = sanitizeDescription(String(parsed.description ?? rec.description));
    return { description: desc || rec.description, aiLogs: logs };
  } catch {
    return { description: rec.description, aiLogs: logs };
  }
}

export async function buildAftersaleRecommendation(
  snapshot: AftersaleAppealSnapshot,
): Promise<AftersaleAppealRecommendation> {
  const base = recommendAftersaleAppeal(snapshot);
  let diagLogs: FetchStepLog[] = [];
  try {
    const diag = await requestOllamaDiagnose();
    diagLogs = diag.logs;
  } catch (e) {
    diagLogs = [
      {
        step: 'AI-诊断',
        level: 'warn',
        message: e instanceof Error ? e.message : String(e),
        at: Date.now(),
      },
    ];
  }
  return refineWithAi(snapshot, base, diagLogs);
}
