import { loadMatchedQcReportFiles } from '../negative-appeal/qc-report-load';
import type { AppealSnapshot } from '../negative-appeal/types';
import type { AftersaleAppealSnapshot } from './types';
import { pickAfterSaleRow } from './api-unwrap';

export function toQcMatchSnapshot(s: AftersaleAppealSnapshot): AppealSnapshot {
  const item = s.canAppealItem;
  const after = pickAfterSaleRow(s.afterSales, s.orderSn, s.afterSalesId);
  // 质检匹配优先使用当前售后单对应商品，避免同订单多商品时误取首条
  const currentGoodsName = after?.goodsName ?? item?.goodsName;
  const currentReason = after?.afterSalesReasonDesc ?? item?.reasonDesc;
  return {
    ticketSn: '',
    orderSn: s.orderSn,
    fetchedAt: s.fetchedAt,
    tuju: {
      goodsName: currentGoodsName,
      explanation: currentReason,
    },
    chatRows: s.chatRows,
    afterSales: s.afterSales,
    reviews: s.reviews,
    fetchLogs: [],
    hasAntiContent: s.hasAntiContent,
    huiceSkuNames: s.huiceSkuNames,
  };
}

export async function loadMatchedQcForAftersale(snapshot: AftersaleAppealSnapshot) {
  return loadMatchedQcReportFiles(toQcMatchSnapshot(snapshot));
}
