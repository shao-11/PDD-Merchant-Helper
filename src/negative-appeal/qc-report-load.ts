import type { QcReportMatch } from './qc-report-match';
import { matchQcReportsFromSheet, rankQcSheetRowsForSnapshot } from './qc-sheet-match';
import { loadMatchedQcFilesFromSnapshot } from './qc-sheet-files';
import { formatCatalogAge, getQcSheetCatalog, getQcSheetCatalogStatus } from './qc-sheet-storage';
import type { AppealSnapshot } from './types';

export type QcLoadResult = {
  match: QcReportMatch | null;
  files: File[];
  matchHint?: string;
};

export async function loadMatchedQcReportFiles(snapshot: AppealSnapshot): Promise<QcLoadResult> {
  const status = await getQcSheetCatalogStatus();
  const catalog = await getQcSheetCatalog();

  if (!catalog?.rows.length) {
    return {
      match: null,
      files: [],
      matchHint: [
        '未匹配到质检报告',
        status.reason ?? '质检表未同步',
        snapshot.huiceSkuNames?.length ? `旺店通规格：${snapshot.huiceSkuNames.join('；')}` : null,
        '请打开飞牛分享页「质检报告」→ 点「同步质检图」',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  const sheetHit = await loadMatchedQcFilesFromSnapshot(snapshot);
  const match = matchQcReportsFromSheet(snapshot, catalog);

  if (sheetHit?.files.length && match) {
    return { match, files: sheetHit.files };
  }

  const ranked = rankQcSheetRowsForSnapshot(snapshot, catalog.rows, 4);
  const age = status.syncedAt ? formatCatalogAge(status.syncedAt) : '';

  const hintParts = [
    '未匹配到质检报告',
    snapshot.huiceSkuNames?.length ? `旺店通规格：${snapshot.huiceSkuNames.join('；')}` : null,
    snapshot.huiceSkuNames?.length
      ? '已按旺店通规格匹配：无对应品类（如菌子炒饭）时不会用评价标题牵强配到其他规格（如黑糖）'
      : null,
    `缓存：${catalog.rowCount} 行，${status.rowsWithImages} 行有图，${status.rowsWithBase64} 行已写入图片${age ? `（${age}）` : ''}`,
    status.specNames.length ? `表内规格：${status.specNames.slice(0, 6).join('；')}${status.specNames.length > 6 ? '…' : ''}` : null,
    ranked.length
      ? `匹配得分：${ranked.map((r) => `${r.specName}（${r.score}分${r.hasImages ? '' : '，无图'}）`).join('；')}`
      : null,
    sheetHit?.imageError ? `图片：${sheetHit.imageError}` : null,
    match && !sheetHit?.files.length ? `已匹配「${match.sheetSpecName}」但图片加载失败，请保持质检表页打开后重试` : null,
    !match && ranked[0]?.score >= 80 && !ranked[0]?.hasImages
      ? '得分够但未缓存图片，请重新在飞牛分享页同步'
      : null,
    status.reason,
    '同步：飞牛分享页 →「同步质检图」',
  ].filter(Boolean);

  return {
    match: match ?? null,
    files: [],
    matchHint: hintParts.join('\n'),
  };
}
