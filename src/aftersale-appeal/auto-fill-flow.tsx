import { captureAftersaleRecordFile, captureChatRecordFile } from './evidence-capture';
import { loadMatchedQcForAftersale } from './qc-adapter';
import { buildAftersaleRecommendationFromVisible } from './ollama-client';
import {
  fillAftersaleAppealFormAsync,
  peekVisibleReasonLabels,
  uploadAftersaleEvidenceBySection,
  waitForRightsAppealModal,
} from './platform-form-fill';
import { updateManualReviewHint } from './manual-review-hint';
import { findRightsAppealModal } from './page-context';
import { fetchEnrichedAftersaleSnapshot } from './run-analysis';
import type { AftersaleAppealSnapshot } from './types';

export type AutoFillProgress = {
  phase: 'analyze' | 'modal' | 'capture' | 'fill' | 'done' | 'error';
  message: string;
};

export type AutoFillResult = {
  steps: import('./platform-form-fill').FormFillStep[];
  snapshot: AftersaleAppealSnapshot;
};

export async function runAutoFillAftersaleAppeal(
  orderSn = '',
  afterSalesId = 0,
  onProgress?: (p: AutoFillProgress) => void,
): Promise<AutoFillResult> {
  const progress = (phase: AutoFillProgress['phase'], message: string): void => {
    onProgress?.({ phase, message });
  };

  const steps: AutoFillResult['steps'] = [];

  progress('modal', '正在定位「维权申诉」弹窗…');
  const modal = await waitForRightsAppealModal();

  progress('modal', '正在读取申诉原因下拉选项…');
  const visibleLabels = await peekVisibleReasonLabels(modal);
  if (!visibleLabels.length) {
    throw new Error('未能读取申诉原因下拉选项，请确认弹窗已打开且申诉原因字段可点击');
  }

  progress('analyze', `已读取 ${visibleLabels.length} 项下拉，正在拉取聊天/售后数据…`);
  const snapshot = await fetchEnrichedAftersaleSnapshot(orderSn, afterSalesId);

  progress('analyze', 'AI 根据下拉选项与聊天记录分析…');
  const recommendation = await buildAftersaleRecommendationFromVisible(snapshot, visibleLabels);

  if (!recommendation.aiUsed || !recommendation.subReasonDesc) {
    throw new Error('AI 未能根据弹窗下拉确定申诉原因，请检查 AI 配置或稍后重试');
  }

  progress('fill', '正在填入申诉原因、金额、描述…');
  const fillModal = findRightsAppealModal() ?? modal;
  const fillSteps = await fillAftersaleAppealFormAsync(fillModal, recommendation, snapshot);
  steps.push(...fillSteps);

  const reasonStep = fillSteps.find((s) => s.step === '申诉原因');
  if (!reasonStep?.ok) {
    throw new Error(reasonStep?.detail ?? '申诉原因未选中，请手动选择后重试');
  }

  const manualHint = updateManualReviewHint(fillModal, recommendation.subReasonDesc);
  steps.push({
    step: '人工判断提示',
    ok: true,
    detail: manualHint.shown
      ? '已在弹窗底部显示「需要人工判断」'
      : '申诉原因为「消费者反馈商品存在质量问题，但凭证不足」，无需人工复核',
  });

  progress('capture', '正在生成售后记录与聊天截图…');
  const afterFile = await captureAftersaleRecordFile(snapshot);
  const chatFile = await captureChatRecordFile(snapshot);

  const requiredFiles: File[] = [];
  try {
    const qc = await loadMatchedQcForAftersale(snapshot);
    if (qc.files.length) {
      requiredFiles.push(...qc.files.slice(0, 2));
      const loadedNames = qc.files.map((f) => f.name);
      steps.push({
        step: '质检匹配',
        ok: true,
        detail:
          [
            qc.match?.detail ?? `已匹配 ${Math.min(2, qc.files.length)} 张`,
            `质检缓存命中 ${qc.files.length} 张，必填将上传 ${Math.min(2, qc.files.length)} 张`,
            loadedNames.length ? `文件：${loadedNames.slice(0, 3).join('、')}${loadedNames.length > 3 ? '…' : ''}` : null,
          ]
            .filter(Boolean)
            .join('；'),
      });
    } else {
      steps.push({
        step: '质检匹配',
        ok: false,
        detail: qc.matchHint ?? '未匹配质检图，仅上传售后记录',
      });
    }
  } catch (e) {
    steps.push({
      step: '质检匹配',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  const optionalFiles: File[] = [afterFile, chatFile];

  progress('fill', '正在上传必填凭证（质检）与选填凭证（售后记录+聊天截图）…');
  await new Promise((r) => setTimeout(r, 400));
  const uploadModal = findRightsAppealModal() ?? fillModal;
  steps.push(...(await uploadAftersaleEvidenceBySection(uploadModal, requiredFiles, optionalFiles)));

  updateManualReviewHint(uploadModal, recommendation.subReasonDesc);

  const bad = steps.filter((s) => !s.ok);
  const badSummary = bad
    .map((b) => `${b.step}${b.detail ? `（${b.detail}）` : ''}`)
    .join('；');
  progress(
    'done',
    bad.length ? `部分未完成：${badSummary}` : '已填入，请核对后提交',
  );

  return { steps, snapshot };
}
