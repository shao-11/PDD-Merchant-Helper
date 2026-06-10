import React, { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatHistoryThread } from '../popup/ChatHistoryThread';
import { captureElementToBlob, waitForRemoteImages } from './capture-screenshot';
import {
  fillAppealForm,
  uploadAppealEvidenceImages,
  waitForAppealModal,
  type FormFillStep,
} from './platform-form-fill';
import { loadMatchedQcReportFiles } from './qc-report-load';
import { buildProductMatchText } from './qc-report-match';
import { runFullAppealAnalysis } from './run-analysis';
import type { AppealSnapshot } from './types';

export type AutoFillProgress = {
  phase: 'analyze' | 'modal' | 'capture' | 'fill' | 'done' | 'error';
  message: string;
};

export type AutoFillResult = {
  steps: FormFillStep[];
  snapshot: AppealSnapshot;
};

async function renderChatForCapture(rows: AppealSnapshot['chatRows']): Promise<{
  host: HTMLDivElement;
  unmount: () => void;
}> {
  const host = document.createElement('div');
  host.className = 'dtx-na-autofill-chat-capture';
  host.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:0',
    'width:520px',
    'padding:0',
    'background:#fff',
    'border:1px solid #f0f0f0',
    'border-radius:0',
    'z-index:-1',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(host);

  let root: Root | null = createRoot(host);
  await new Promise<void>((resolve) => {
    root!.render(
      <StrictMode>
        <ChatHistoryThread rows={rows} layout="mms" />
      </StrictMode>,
    );
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  return {
    host,
    unmount: () => {
      root?.unmount();
      root = null;
      host.remove();
    },
  };
}

/**
 * 一键：分析 → 打开/定位申诉弹窗 → 勾选原因、填说明 → 逐张上传凭证（最多3张）
 */
export async function runAutoFillAppeal(
  ticketSn: string,
  orderSn: string,
  onProgress?: (p: AutoFillProgress) => void,
): Promise<AutoFillResult> {
  const progress = (phase: AutoFillProgress['phase'], message: string): void => {
    onProgress?.({ phase, message });
  };

  const steps: FormFillStep[] = [];

  try {
    progress('analyze', '正在拉取数据并 AI 分析…');
    const { snapshot, recommendation } = await runFullAppealAnalysis(ticketSn, orderSn);

    progress('modal', '正在定位「发起申诉」弹窗…');
    const modal = await waitForAppealModal();

    const evidenceFiles: File[] = [];
    if (snapshot.chatRows.length) {
      progress('capture', '正在生成聊天记录截图…');
      const { host, unmount } = await renderChatForCapture(snapshot.chatRows);
      try {
        await new Promise((r) => setTimeout(r, 500));
        await waitForRemoteImages(host);
        const blob = await captureElementToBlob(host);
        if (!blob.size) throw new Error('聊天截图生成为空，请重试');
        evidenceFiles.push(
          new File([blob], `聊天-${snapshot.orderSn || 'order'}.png`, { type: 'image/png' }),
        );
      } finally {
        unmount();
      }
    } else {
      steps.push({
        step: '聊天截图',
        ok: true,
        detail: '无聊天记录，已跳过聊天截图上传',
      });
    }

    progress('fill', '正在填入申诉原因与说明…');
    steps.push(...fillAppealForm(modal, recommendation));

    const productText = buildProductMatchText(snapshot);
    progress('fill', '正在匹配质检报告…');
    try {
      const qc = await loadMatchedQcReportFiles(snapshot);
      if (qc.files.length && qc.match) {
        evidenceFiles.push(...qc.files);
        steps.push({
          step: '质检匹配',
          ok: true,
          detail: `${qc.match.detail} → ${qc.match.files.join('、')}`,
        });
      } else {
        steps.push({
          step: '质检匹配',
          ok: true,
          detail: evidenceFiles.length
            ? `未匹配到规则，仅上传聊天截图（${productText.slice(0, 40) || '—'}）`
            : `未匹配到规则，无聊天截图可上传（${productText.slice(0, 40) || '—'}）`,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      steps.push({ step: '质检匹配', ok: false, detail: msg });
    }

    progress('fill', '正在上传凭证图片…');
    await new Promise((r) => setTimeout(r, 280));
    if (evidenceFiles.length) {
      steps.push(await uploadAppealEvidenceImages(modal, evidenceFiles));
    } else {
      steps.push({
        step: '上传凭证图片',
        ok: true,
        detail: '无聊天记录且未匹配质检报告，已跳过凭证上传',
      });
    }

    const failed = steps.filter((s) => !s.ok);
    if (failed.length > 0) {
      const failedDetail = failed
        .map((f) => `${f.step}${f.detail ? `（${f.detail}）` : ''}`)
        .join('；');
      progress('done', `部分未完成：${failedDetail}，请人工核对`);
    } else {
      progress('done', '已填入并上传凭证，请核对后自行提交');
    }

    return { steps, snapshot };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    progress('error', msg);
    throw e;
  }
}
