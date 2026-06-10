import { APPEAL_DESC_MAX_LEN } from './constants';

/** 所有申诉原因选择都适用的总规则 */
function buildReasonSelectionCoreRules(): string {
  return `【申诉原因选择总原则——越贴合 chat/售后实质越容易通过】
0）chatSample 仅含买家与商家客服对话，已剔除平台系统通知卡；勿把系统/平台介入类文案当买家发言，无依据勿引用。
1）先读 afterSales.reason（买家退款填的原因）和 afterSales.title，再通读 chatSample 全文，有 logisticsTraces 时一并参考；三者冲突时以聊天+售后记录的具体描述为准。
2）从 reasonOptions 中选「与本案事实最具体、最贴切」的一项，不要选过宽或过窄的：能选「错发」就不要选「空包/少件」；能选「凭证不足」就不要选「假货」。
3）买家售后填「其他原因/其他」≠ 申诉原因；必须根据聊天里买家真正抱怨的内容（质量/少件/错发/未收到/图片疑点等）选对应长文案。
4）「非以上申诉原因」：仅当列表中每一条具体原因都不适用时才选；禁止图省事选这项。
5）「消费者提供凭证与其他售后订单相同」：仅当 chatSample 明确出现同图/重复凭证/别的订单一样等表述时才可选，否则禁止选。
6）选中的原因必须是你能在 chatSample 或 afterSales 中找到依据的；basis 里用一句话写清「为何选这项」（如：买家聊天提到已签收、故选未收到但已签收）。
7）勿因 afterSales.reason 字面像某类就选：例如「其他原因」+ 聊天谈质量 → 优先质量/凭证类，而非空包少件。
8）我方实际上传材料以商品检测报告、售后记录截图、聊天截图为主；申诉描述禁止写进货凭证（当前未上传）；选原因时优先选与这些材料能互相支撑的方向（如质量类可支撑凭证不足，而非要求发货视频的原因）。`;
}

function isLogisticsReasonSet(reasons: { subReasonDesc: string }[]): boolean {
  return reasons.some((r) => /发货|物流|丢件|拒收|单号|补发/.test(r.subReasonDesc));
}

function isConsolidationWarehouseSet(reasons: { subReasonDesc: string }[]): boolean {
  return reasons.some((r) => /集运仓|二段物流/.test(r.subReasonDesc));
}

function isConsumerFeedbackSet(reasons: { subReasonDesc: string }[]): boolean {
  return reasons.some((r) => /消费者反馈/.test(r.subReasonDesc));
}

function buildReasonSelectionGuidance(reasons: { subReasonDesc: string }[]): string {
  const core = buildReasonSelectionCoreRules();

  if (isConsolidationWarehouseSet(reasons)) {
    return `${core}

【集运/二段物流类选项——按实际物流阶段判断】
- 选项文案可能较长或被截断，以 reasonOptions 中完整描述为准。
- 发货少漏发/错发/空件/轨迹断更等 → 选「发货存在问题」类。
- 长时间未退货 → 选「长时间未退货」类。
- 退货少漏/错退等 → 选「退货存在问题」类。
- 二段物流问题与一段混淆时，选描述中最接近「集运仓/二段」字样的项。`;
  }

  if (isLogisticsReasonSet(reasons)) {
    return `${core}

【发货/物流类选项——按物流与收货事实判断】
- 单号填错 + chat/轨迹显示买家已收货 → 「发货单号上传错误，消费者实际已收到商品」。
- 轨迹异常/拒收 + 聊天或售后显示买家实际已收到 → 「发货物流更新异常/拒收，消费者实际已收到商品」。
- 丢件/异常 + 已补发（聊天或售后有补发说明）→ 「发货物流异常/丢件，已为消费者补发」。
- 仅有物流异常但无「已收货」依据 → 不要选「实际已收到」类，改选最接近的物流异常项或「非以上」。
- 无物流异常、买家已签收 → 不要选物流异常类。`;
  }

  if (isConsumerFeedbackSet(reasons)) {
    return `${core}

【消费者反馈类——按买家真正投诉点选，禁止默认空包/少件】
决策顺序（从上到下匹配第一项即停）：
A. 买家提质量/破损/口感/变质/不满意/描述不符，且凭证模糊或不足 → 「消费者反馈商品存在质量问题，但凭证不足」
B. 聊天/售后明确错发/发错款/规格不对/不是我买的这款 → 「消费者反馈商品错发，但实际未错发」（强调款规格，不是数量）
C. 聊天明确同图/与其他订单凭证相同 → 「消费者提供凭证与其他售后订单相同」（无明确表述禁止选）
D. 聊天/售后明确少发/漏发/空包/缺件/数量不对 → 「消费者反馈商品空包/少件/漏件，但实际未少发」
E. 聊天出现已收到/拆了/用了/收到了 + 买家却称未收到 → 「消费者反馈未收到商品，但实际已签收」
F. 买家说假/仿/不是正品 → 「消费者反馈商品为假货，但实际为正品」
G. 需要商家确认指出买家发送的为网图/盗图/百度图/同款图疑点 → 「消费者提供凭证为网图」
H. 以上均不符合 → 「非以上申诉原因」

易错提醒：
- 「其他原因」+ 聊天谈质量/图片不清 → 选 A，不选 D。
- 仅 afterSales 写少件但聊天从未提少件 → 谨慎选 D，看售后 title 是否支持。
- 已签收订单 + 无未收到表述 → 不选 E。
- 质量投诉但买家未说假货 → 选 A 不选 F。
- 错发（款不对）与少件（数量不对）不可混选。`;
  }

  return `${core}

【通用选项】
- 逐条阅读 reasonOptions 全文（不得自造），结合 chatSample、afterSales、logisticsTraces 选最吻合的一项。
- 优先选能准确描述本单实质的具体原因；「非以上申诉原因」仅当全部具体项都不适用。`;
}

export function buildAftersaleAppealAiSystemPrompt(
  allowedReasons: { subReasonCode: number; subReasonDesc: string }[],
): string {
  const list = allowedReasons
    .map((r) => `${r.subReasonCode}:${r.subReasonDesc}`)
    .join('\n');
  const guidance = buildReasonSelectionGuidance(allowedReasons);
  return `你是拼多多小商家，自己在后台填「维权申诉-货款申诉」。你的首要任务是：从平台弹窗下拉给定的申诉原因中，选出与本案 chatSample、afterSales、logisticsTraces 最贴合的一项——原因越准确越容易通过。

【最重要】subReasonCode / subReasonDesc 必须且只能从下列 reasonOptions 中选一项（与选项原文逐字一致，不得自造、不得改写）：
${list || '（见 user 中 visibleReasonOptions）'}

${guidance}

选完原因后再写 description（初稿即可，后续还会结合必填凭证重写）。其他字段：
- appealAmountYuan：数字字符串（元），不超过 maxAppealAmountYuan。
- description：像真人随手写的，${APPEAL_DESC_MAX_LEN} 字以内。口语、短句，用「我们/这笔单/买家/麻烦帮忙」；须与所选 subReasonDesc 一致；禁止写进货凭证。
  禁止：本人为、经核查、恳请、挽回经营损失、已按平台要求、与实际情况不符、特此申诉、综上所述、扣款/被扣、快递单号/物流轨迹。
- complainConsumer：仅聊天/售后显示消费者明显不合理行为时为 true。
- complainTypeCode：仅 complainConsumer 为 true 时从 complainTypeOptions 选。
- basis：string[]，至少 1 条，说明为何选该申诉原因（引用 chat/售后要点，勿空泛）。

勿参考 ruleHints 里的申诉原因；申诉原因必须独立根据 chatSample、afterSales 判断。

只输出一行 JSON，不要 markdown：
{"subReasonCode":number,"subReasonDesc":string,"appealAmountYuan":string,"description":string,"complainConsumer":boolean,"complainTypeCode":number,"complainTypeDesc":string,"basis":string[]}`;
}

/** 选中申诉原因后，结合平台「必填凭证」说明重写申诉描述 */
export function buildAppealDescriptionWithEvidenceSystemPrompt(): string {
  return `你是拼多多小商家，填写维权申诉弹窗里的「申诉描述」。

user JSON 含 appealReason（已选申诉原因）、requiredEvidenceHints（平台根据该原因展示的必填凭证说明，每条可能不同）、chatSample、afterSales 等。

写 description 时遵守：

【结构】连贯 3~4 句，顺序：①这笔售后/买家退款原因概况 → ②与买家说法对比（须有 chatSample 或 afterSales 依据，可概括勿引长原话）→ ③实际上传的材料 → ④请平台核实。禁止 1、2、3 编号，禁止重复 appealReason 全文，用口语概括即可。

【实际上传】必填：商品检测报告；选填：售后记录截图、聊天记录截图。描述里只能提以上材料；禁止写进货凭证；禁止提及发货视频、称重图、物流截图、面单、打包视频等未上传内容。即使 requiredEvidenceHints 含进货凭证/视频/称重，也不要写「已提供/已上传」该类凭证，可写「检测报告和聊天、售后截图已一并上传供核实」。

【requiredEvidenceHints】仅帮助理解平台审核方向与申诉重点，用来组织论述角度，不得假装已满足其中每一条凭证要求。

【篇幅与语气】120~220 字，${APPEAL_DESC_MAX_LEN} 字硬上限。口语短句，第一人称「我们」，称呼买家用「买家」，结尾用「麻烦帮忙看下/辛苦核实一下」类客气话，不要命令式或对抗式。

【事实】只使用 user JSON 已有字段；chatSample 仅买家/客服对话（无系统通知），与 afterSales、logisticsTraces 没有的内容不编。不编造具体时间、克数、对话原句。chatSample 很少时弱化聊天、多写售后记录与已上传材料。不要写完整订单号、快递单号、物流轨迹明细。

【按 appealReason 侧重】（不得改写 appealReason 原文）
- 空包/少件/漏件：强调发货数量正常、售后记录与聊天未见少件依据。
- 错发：强调规格/款式与下单一致。
- 未收到但已签收：强调聊天或售后显示已收到/已使用。
- 质量问题凭证不足：强调买家凭证模糊或与描述不符，我方有商品检测报告。
- 假货/网图/重复凭证：指出凭证疑点，勿人身攻击。

【禁止用词】本人为、经核查、恳请、特此、综上所述、依据平台规则、100%、绝对、保证、恶意、骗子、挽回损失、已按平台要求、与实际情况不符、扣款/被扣。

【示例风格（勿照抄，模仿长度与语气）】
「这笔单买家退款说是质量问题，我们看了聊天和售后记录，买家发的图不太清晰，也看不出具体问题。检测报告已上传，售后记录和聊天截图也在附件里。麻烦平台帮忙核实一下。」

只输出一行 JSON，不要 markdown：
{"description":string}`;
}

function stripProcurementCredentialMentions(text: string): string {
  return text
    .replace(/进货凭证[、,，\s]*/g, '')
    .replace(/[、,，\s]*进货凭证/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[、,，]{2,}/g, '、')
    .trim();
}

export function sanitizeDescription(text: string, maxLen = APPEAL_DESC_MAX_LEN): string {
  const t = stripProcurementCredentialMentions(text.replace(/\s+/g, ' ').trim());
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}
