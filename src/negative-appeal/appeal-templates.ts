/**
 * 固定申诉说明（可按公司「订单申诉」话术文档继续补充）。
 * key 为平台 appealReasonCode。
 */
export const APPEAL_TEXT_BY_CODE: Record<number, string> = {
  18: '消费者反馈的商品问题，我方已与消费者积极沟通并达成一致，消费者认可处理结果。详见聊天与售后凭证。',
  19: '消费者反馈的商品问题，我方已通过售后/小额打款等方式完成补偿，与消费者协商一致。详见凭证。',
  20: '消费者未在聊天或售后中反馈商品质量问题，反馈内容为非商品问题或咨询类内容。详见聊天记录与售后记录。',
  21: '消费者反馈内容属于主观感受或非质量问题误解，我方已解释说明。详见聊天记录；如有质检报告一并附上。',
  99: '负向体验判定与实际情况不符，请平台复核。详见附件凭证。',
};

export function appealTextForCode(code: number, platformDesc?: string): string {
  const fixed = APPEAL_TEXT_BY_CODE[code];
  if (fixed) return fixed;
  return platformDesc ? `请补充：${platformDesc}` : '请根据订单实际情况填写申诉说明。';
}
