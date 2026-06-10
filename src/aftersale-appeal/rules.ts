import { APPEAL_SUB_TYPE_CARGO } from './constants';
import { flattenReasonOptions, fenToYuan, maxAppealFen, extractReverseLogisticsInfo } from './api-unwrap';
import type { AftersaleAppealRecommendation, AftersaleAppealSnapshot } from './types';

const UNREASONABLE_RE =
  /恶意|威胁|敲诈|仅退款|空包|调包|已签收.*退|不退货|骗|虚假|无理取闹|辱骂/i;

function maxAppealYuan(snapshot: AftersaleAppealSnapshot): number {
  return Number(fenToYuan(maxAppealFen(snapshot))) || 0;
}

function defaultDescription(snapshot: AftersaleAppealSnapshot, _reasonDesc: string): string {
  const orderSn = snapshot.orderSn;
  const after = snapshot.afterSales[0];
  const consumerReason =
    after?.afterSalesReasonDesc ?? snapshot.canAppealItem?.reasonDesc ?? '其他';
  const maxYuan = maxAppealYuan(snapshot);
  const amountPart = maxYuan > 0 ? `${maxYuan.toFixed(2)}元` : '相应';

  let text = `订单${orderSn}，这笔售后我们想申诉${amountPart}货款。`;
  if (after?.afterSalesTitle) {
    text += `售后情况是${after.afterSalesTitle.replace(/，/g, '、')}。`;
  }
  text += `买家退款填的是「${consumerReason}」，我们看了聊天和售后记录，情况不是他说的这样，不该商家全担。`;
  text += `相关材料都上传了，麻烦帮忙审核一下。`;
  return text;
}

export function recommendAftersaleAppeal(
  snapshot: AftersaleAppealSnapshot,
): AftersaleAppealRecommendation {
  const basis: string[] = [];
  const maxYuan = maxAppealYuan(snapshot);
  const options = flattenReasonOptions(snapshot.checkAppeal ?? undefined);
  const chatText = snapshot.chatRows.map((r) => r.content).join('\n');

  if (snapshot.canAppealItem?.subAppealForbiddenReasonDescMap?.['2'] === '允许') {
    basis.push('平台预检：货款申诉条件允许');
  } else if (snapshot.canAppealItem?.subAppealForbiddenReasonDescMap) {
    basis.push(
      `货款申诉预检：${snapshot.canAppealItem.subAppealForbiddenReasonDescMap['2'] ?? '请核对平台提示'}`,
    );
  }

  if (!options.length) {
    basis.push('未拉取到平台申诉原因列表（checkAppeal），请重新打开弹窗后再分析');
  } else {
    basis.push('申诉原因由 AI 通读聊天/售后后从平台下拉项中选择');
  }

  const reverseInfo = extractReverseLogisticsInfo(snapshot);
  if (reverseInfo.reverseLogisticOnWay === true) {
    basis.push('退货物流在途：建议签收后再提交（规则仍给出建议供参考）');
  }

  const complainConsumer = UNREASONABLE_RE.test(chatText);
  if (complainConsumer) basis.push('聊天存在不合理行为关键词，建议勾选投诉消费者');

  const complainTypes = snapshot.complainTypes ?? [];
  const complainPick = complainTypes.find((t) =>
    /恶意|不合理|退款/.test(String(t.complainTypeDesc ?? '')),
  );

  return {
    appealSubTypeCode: APPEAL_SUB_TYPE_CARGO,
    appealSubTypeLabel: '货款申诉',
    parentReasonCode: 0,
    subReasonCode: 0,
    subReasonDesc: '',
    appealAmountYuan: maxYuan > 0 ? maxYuan.toFixed(2) : '0.00',
    description: defaultDescription(snapshot, ''),
    complainConsumer,
    complainTypeCode: complainConsumer ? complainPick?.complainType : undefined,
    complainTypeDesc: complainConsumer ? complainPick?.complainTypeDesc : undefined,
    confidence: snapshot.afterSales.length && snapshot.chatRows.length ? 'medium' : 'low',
    basis,
    aiUsed: false,
  };
}
