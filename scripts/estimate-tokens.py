# -*- coding: utf-8 -*-
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def est_tokens(text: str) -> int:
    cn = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    other = len(text) - cn
    return int(cn / 1.5 + other / 4)


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


reasons = [
    '消费者反馈商品空包/少件/漏件，但实际未少发',
    '消费者反馈商品错发，但实际未错发',
    '消费者反馈商品存在质量问题，但凭证不足',
    '消费者反馈未收到商品，但实际已签收',
    '消费者反馈商品为假货，但实际为正品',
    '消费者提供凭证为网图',
    '消费者提供凭证与其他售后订单相同',
    '非以上申诉原因',
]
list_str = '\n'.join(f'{i + 1}:{d}' for i, d in enumerate(reasons))

aftersale_src = read('src/aftersale-appeal/appeal-ai-prompt.ts')
neg_src = read('src/negative-appeal/appeal-ai-prompt.ts')

# 近似 buildAftersaleAppealAiSystemPrompt(consumer-feedback 分支)
i1 = aftersale_src.find('function buildReasonSelectionCoreRules')
i2 = aftersale_src.find('export function buildAppealDescriptionWithEvidenceSystemPrompt')
sys_aftersale_reason = aftersale_src[i1:i2] + '\n' + list_str

i3 = aftersale_src.find('export function buildAppealDescriptionWithEvidenceSystemPrompt')
i4 = aftersale_src.find('export function sanitizeDescription')
sys_aftersale_evidence = aftersale_src[i3:i4]

# 负向 buildAppealAiSystemPrompt 含全部 guidance
sys_negative = neg_src

chat24 = [f'[买家] 你好这个怎么少发了呀第{i}条聊天内容大概二十字左右' for i in range(24)]

user_aftersale_1 = json.dumps(
    {
        'orderSn': '240512-123456789012345',
        'afterSalesId': '123456789',
        'canAppeal': True,
        'afterSales': [{'type': '仅退款', 'reason': '质量问题', 'title': '商品与描述不符', 'refundFen': 1580}],
        'orderStatus': '已签收',
        'chatSample': chat24,
        'logisticsTraces': ['[昆明] 快件已签收', '[昆明] 派送中'] * 3,
        'visibleReasonOptions': [{'subReasonCode': i + 1, 'subReasonDesc': d} for i, d in enumerate(reasons)],
        'note': '【硬性要求】subReasonDesc 必须与 visibleReasonOptions 中某一项原文完全一致',
        'maxAppealAmountYuan': 15.8,
    },
    ensure_ascii=False,
)

user_aftersale_2 = json.dumps(
    {
        'orderSn': '240512-123456789012345',
        'afterSalesId': '123456789',
        'appealReason': reasons[2],
        'requiredEvidenceHints': ['进货凭证', '商品检测报告', '售后记录截图', '聊天记录截图'],
        'afterSales': [{'type': '仅退款', 'reason': '质量问题', 'title': '商品与描述不符'}],
        'chatSample': chat24,
        'logisticsTraces': ['[昆明] 快件已签收'] * 4,
        'draftDescription': '这笔单买家说是质量问题，我们看了聊天和售后记录，买家发的图不太清晰。进货凭证和检测报告已上传，麻烦平台核实。',
    },
    ensure_ascii=False,
)

user_negative = json.dumps(
    {
        'orderSn': '240512-123456789012345',
        'compensation': '商品质量问题导致平台扣款',
        'explanation': '平台判定商家责任，扣除体验分相关费用',
        'chatSample': chat24[:20],
        'afterSales': ['[仅退款] 商品与描述不符 原因:质量问题 退款分:1580'],
        'reviews': ['差评：质量太差了', '一星不满意'],
        'platformReasonsOnly': [
            {'appealReasonCode': c, 'appealReasonDesc': f'申诉原因选项{c}说明文字约三十字', 'appealDesc': ''}
            for c in [18, 19, 20, 21, 99]
        ],
        'ruleSuggestion': {'appealReasonCode': 19, 'appealReasonDesc': 'x', 'appealText': 'x'},
        'merchantNote': '实际上传凭证以聊天截图、商品质检报告为主',
    },
    ensure_ascii=False,
)

out1 = (
    '{"subReasonCode":3,"subReasonDesc":"消费者反馈商品存在质量问题，但凭证不足",'
    '"appealAmountYuan":"15.80","description":"这笔单买家退款说是质量问题，我们看了聊天和售后记录，买家发的图不太清晰。",'
    '"complainConsumer":false,"complainTypeCode":0,"complainTypeDesc":"","basis":["买家聊天谈质量"]}'
)
out2 = '{"description":"这笔单买家退款说是质量问题，我们看了聊天和售后记录，买家发的图不太清晰。进货凭证和检测报告已上传，麻烦平台核实。"}'
out3 = (
    '{"appealReasonCode":19,"appealReasonDesc":"已通过售后/退款/补偿等方式处理完毕",'
    '"appealText":"经核查，本单消费者曾反馈商品问题，我方已通过售后流程完成处理，消费者接受处理结果，相关退款已在售后记录中体现。'
    '聊天记录截图、商品质检报告已上传供复核。恳请平台复核并撤销本次扣款。","basis":["售后有退款","聊天已协商"]}'
)

calls = [
    ('售后-自动填入第1次(选原因+初稿)', sys_aftersale_reason, user_aftersale_1, out1),
    ('售后-填入表单第2次(重写描述)', sys_aftersale_evidence, user_aftersale_2, out2),
    ('负向申诉-分析1次', sys_negative, user_negative, out3),
]

print('=== 项目单次 AI 调用 Token 估算 ===\n')
rows = []
for name, sys_p, user_p, out_p in calls:
    ts, tu, to = est_tokens(sys_p), est_tokens(user_p), est_tokens(out_p)
    ti = ts + tu
    tot = ti + to
    rows.append((name, ts, tu, ti, to, tot))
    print(name)
    print(f'  system ~{ts} | user ~{tu} | 输入合计 ~{ti}')
    print(f'  输出 ~{to} | 总计 ~{tot} tokens\n')

full_in = rows[0][3] + rows[1][3]
full_out = rows[0][4] + rows[1][4]
print(f'售后「自动填入」2 次 AI 合计: ~{full_in + full_out} tokens (输入 ~{full_in}, 输出 ~{full_out})')
print(f'负向申诉 1 次: ~{rows[2][5]} tokens\n')

p_in, p_in_hit, p_out = 1.0, 0.02, 2.0


def cost(inp, outp, hit=False):
    return inp / 1e6 * (p_in_hit if hit else p_in) + outp / 1e6 * p_out


print('=== DeepSeek v4-flash 官方价 (deepseek-chat 非思考) ===')
print('输入未命中 1元/百万 | 缓存命中 0.02元/百万 | 输出 2元/百万\n')

for name, _, _, ti, to, _ in rows:
    print(f'{name}: ~{cost(ti, to):.5f} 元/次')

c = cost(full_in, full_out)
c_hit = cost(full_in, full_out, True)
print(f'\n售后 2 次/单: ~{c:.4f} 元 (未缓存) | ~{c_hit:.4f} 元 (system 缓存命中)')
print(f'负向 1 次/单: ~{cost(rows[2][3], rows[2][4]):.4f} 元\n')

for n in [10, 50, 100, 500]:
    print(f'{n} 单/天(售后自动填入): ~{c * n:.2f} 元/天, ~{c * n * 30:.1f} 元/月')
