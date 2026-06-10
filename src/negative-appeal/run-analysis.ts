import { buildRecommendation } from './ollama-client';
import { fetchAppealSnapshotViaPage } from './fetch-bridge';
import { enrichSnapshotWithHuice } from './huice/enrich-snapshot';
import type { AppealRecommendation, AppealSnapshot } from './types';

export type AppealAnalysisResult = {
  snapshot: AppealSnapshot;
  recommendation: AppealRecommendation;
  fetchLogs: AppealSnapshot['fetchLogs'];
};

/** 拉取四要素 + 规则/AI 推荐（与面板「开始分析」一致） */
export async function runFullAppealAnalysis(
  ticketSn: string,
  orderSn = '',
): Promise<AppealAnalysisResult> {
  const ts = ticketSn.trim();
  if (!ts) throw new Error('请填写工单号');
  let snap = await fetchAppealSnapshotViaPage(ts, orderSn.trim());
  snap = await enrichSnapshotWithHuice(snap);
  const recommendation = await buildRecommendation(snap);
  const fetchLogs = [...(snap.fetchLogs ?? []), ...(recommendation.ollamaLogs ?? [])];
  return { snapshot: snap, recommendation, fetchLogs };
}
