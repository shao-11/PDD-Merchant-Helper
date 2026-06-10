import { buildChatSampleForAi } from '../utils/chat-history-parse';
import {
  APPEAL_TEXT_MAX_LEN,
  buildAppealAiSystemPrompt,
  sanitizeAppealText,
} from './appeal-ai-prompt';
import { appealTextForCode } from './appeal-templates';
import { getBailianAiConfig } from './ai-config';
import { APPEAL_AI_MODEL_DEFAULT } from './constants';
import type { FetchStepLog } from './fetch-log';
import { resolveSupportedReasons } from './platform-reasons';
import { extractOllamaText, requestOllamaChat, requestOllamaDiagnose } from './ollama-transport';
import type { AppealRecommendation, AppealSnapshot } from './types';
import { recommendAppeal } from './rules';

function clampToPlatform(
  snapshot: AppealSnapshot,
  code: number,
  base: AppealRecommendation,
  appealTextFromAi?: string,
): AppealRecommendation {
  const { list } = resolveSupportedReasons(snapshot.tuju);
  const reason = list.find((r) => r.appealReasonCode === code);
  if (!reason) return base;
  const aiText = appealTextFromAi?.trim();
  const appealText =
    aiText && aiText.length > 0
      ? sanitizeAppealText(aiText)
      : appealTextForCode(reason.appealReasonCode, reason.appealDesc);
  return {
    ...base,
    appealReasonCode: reason.appealReasonCode,
    appealReasonDesc: reason.appealReasonDesc,
    appealText,
  };
}

function mergeLogs(...parts: FetchStepLog[][]): FetchStepLog[] {
  return parts.flat();
}

/** Ollama 只在平台原因码内重选 */
async function refineWithOllama(
  snapshot: AppealSnapshot,
  base: AppealRecommendation,
  diagLogs: FetchStepLog[],
): Promise<AppealRecommendation> {
  const { list, fromApi, filteredHidden } = resolveSupportedReasons(snapshot.tuju);
  const allowedCodes = list.map((r) => r.appealReasonCode);

  if (allowedCodes.length === 0) {
    return {
      ...base,
      ollamaLogs: diagLogs,
      basis: [
        ...base.basis,
        filteredHidden?.length
          ? `剔除弹窗未展示项后无可选原因（已排除：${filteredHidden.map((h) => h.appealReasonDesc).join('、')}），跳过 AI`
          : '无平台原因列表，跳过 AI，仅使用规则结果',
      ],
    };
  }

  const summary = {
    orderSn: snapshot.orderSn,
    compensation: snapshot.tuju?.compensationReason,
    explanation: snapshot.tuju?.explanation,
    chatSample: buildChatSampleForAi(snapshot.chatRows, 20),
    afterSales: snapshot.afterSales.map(
      (a) =>
        `[${a.afterSalesTypeName ?? ''}] ${a.afterSalesTitle ?? ''} 原因:${a.afterSalesReasonDesc ?? ''} 退款分:${a.refundAmount ?? ''}`,
    ),
    reviews: snapshot.reviews.map((r) => r.comment ?? '').filter(Boolean),
    platformDeduction: {
      compensationReason: snapshot.tuju?.compensationReason ?? '',
      explanation: snapshot.tuju?.explanation ?? '',
      note: 'appealReason 应解释/compensation 是否成立，或是否已通过 chat/售后 解决',
    },
    platformReasonsOnly: list.map((r) => ({
      appealReasonCode: r.appealReasonCode,
      appealReasonDesc: r.appealReasonDesc,
      appealDesc: r.appealDesc ?? '',
    })),
    ruleSuggestion: {
      appealReasonCode: base.appealReasonCode,
      appealReasonDesc: base.appealReasonDesc,
      appealText: base.appealText,
    },
    merchantNote:
      '实际上传凭证以聊天截图、商品质检报告为主（自动填入流程匹配）；appealText 禁止写进货凭证，勿写发货视频等未上传材料',
  };

  const { model: storedModel } = await getBailianAiConfig();
  const body = {
    model: storedModel || APPEAL_AI_MODEL_DEFAULT,
    stream: false as const,
    messages: [
      {
        role: 'system',
        content: buildAppealAiSystemPrompt(allowedCodes),
      },
      { role: 'user', content: JSON.stringify(summary) },
    ],
  };

  let chatLogs: FetchStepLog[] = [];

  try {
    const { data: json, logs } = await requestOllamaChat(body);
    chatLogs = logs;
    const text = extractOllamaText(json);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`模型未返回 JSON（原文：${text.slice(0, 80)}）`);
    const parsed = JSON.parse(match[0]) as {
      appealReasonCode?: number;
      appealReasonDesc?: string;
      appealText?: string;
      basis?: string[];
    };
    const code = Number(parsed.appealReasonCode);
    if (!Number.isFinite(code) || !allowedCodes.includes(code)) {
      return {
        ...base,
        ollamaLogs: mergeLogs(diagLogs, chatLogs),
        basis: [...base.basis, `AI 返回 code=${String(parsed.appealReasonCode)} 不在平台列表，已保留规则推荐`],
      };
    }
    const platformReason = list.find((r) => r.appealReasonCode === code);
    const descFromAi = String(parsed.appealReasonDesc ?? '').trim();
    if (descFromAi && platformReason && descFromAi !== platformReason.appealReasonDesc) {
      return {
        ...base,
        ollamaLogs: mergeLogs(diagLogs, chatLogs),
        basis: [
          ...base.basis,
          `AI 返回原因名「${descFromAi}」与平台 code=${code} 不一致，已保留规则推荐`,
        ],
      };
    }
    const rawText = String(parsed.appealText ?? '').trim();
    if (!rawText) {
      return {
        ...base,
        ollamaLogs: mergeLogs(diagLogs, chatLogs),
        basis: [...base.basis, 'AI 未返回 appealText，已保留规则推荐与固定话术'],
      };
    }
    if (rawText.length > APPEAL_TEXT_MAX_LEN) {
      chatLogs.push({
        step: 'AI-话术',
        level: 'warn',
        message: `话术超长 ${rawText.length} 字，已截断至 ${APPEAL_TEXT_MAX_LEN} 字`,
        at: Date.now(),
      });
    }
    const picked = clampToPlatform(snapshot, code, base, rawText);
    return {
      ...picked,
      ollamaLogs: mergeLogs(diagLogs, chatLogs),
      confidence: 'medium',
      basis: [
        ...(Array.isArray(parsed.basis) ? parsed.basis.map(String) : []),
        `AI 已从 tuju/detail 平台原因列表中选择，并生成申诉话术（≤${APPEAL_TEXT_MAX_LEN} 字）`,
        fromApi ? '原因列表来自 colombo/tuju/detail（已剔除弹窗未展示项）' : '原因列表为内置兜底，请与平台弹窗核对后再提交',
        filteredHidden?.length
          ? `已排除弹窗未展示：${filteredHidden.map((h) => h.appealReasonDesc).join('、')}`
          : null,
      ].filter((x): x is string => Boolean(x)),
      aiUsed: true,
      platformReasonFromApi: fromApi,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const diagSummary = diagLogs.find((l) => l.step === 'AI-结论')?.message;

    return {
      ...base,
      ollamaLogs: mergeLogs(diagLogs, chatLogs),
      basis: [
        ...base.basis,
        `AI 调用失败：${detail}`,
        diagSummary ? `诊断：${diagSummary}` : null,
        detail.includes('API Key') || detail.includes('401') || detail.includes('403')
          ? '处理：在申诉助手顶部保存百炼 API Key → 点「检测 AI」→ 再分析'
          : '已回退为规则推荐',
      ].filter((x): x is string => Boolean(x)),
    };
  }
}

export async function buildRecommendation(snapshot: AppealSnapshot): Promise<AppealRecommendation> {
  const base = recommendAppeal(snapshot);

  let diagLogs: FetchStepLog[] = [];
  try {
    const diag = await requestOllamaDiagnose();
    diagLogs = diag.logs;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagLogs = [
      {
        step: 'AI-诊断',
        level: 'error',
        message: `无法执行后台诊断：${msg}`,
        at: Date.now(),
      },
    ];
  }

  return refineWithOllama(snapshot, base, diagLogs);
}
