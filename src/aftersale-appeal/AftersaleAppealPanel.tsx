import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Input,
  Select,
  Spin,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { BAILIAN_MODEL_DEFAULT } from '../negative-appeal/constants';
import { getBailianAiConfig, maskApiKey, setBailianAiConfig } from '../negative-appeal/ai-config';
import type { FetchStepLog } from '../negative-appeal/fetch-log';
import { requestOllamaDiagnose } from '../negative-appeal/ollama-transport';
import { ChatHistoryThread } from '../popup/ChatHistoryThread';
import {
  effectiveCanAppealItem,
  extractReverseLogisticsInfo,
  flattenReasonOptions,
  fenToYuan,
  maxAppealFen,
} from './api-unwrap';
import { readActiveOrder, syncActiveOrderFromModal } from './order-context';
import { runFullAftersaleAppealAnalysis } from './run-analysis';
import type { AftersaleAppealRecommendation, AftersaleAppealSnapshot } from './types';
import './aftersale-appeal-panel.css';

type Props = {
  onClose: () => void;
};

function formatLogs(logs: FetchStepLog[]): string {
  return logs
    .map((l) => {
      const t = new Date(l.at).toLocaleTimeString();
      return `[${t}] [${l.level}] ${l.step} — ${l.message}${l.detail ? ` (${l.detail})` : ''}`;
    })
    .join('\n');
}

export function AftersaleAppealPanel({ onClose }: Props): JSX.Element {
  const active = readActiveOrder();
  const [orderSn, setOrderSn] = useState(active?.orderSn ?? '');
  const [afterSalesId, setAfterSalesId] = useState(String(active?.afterSalesId ?? ''));
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<AftersaleAppealSnapshot | null>(null);
  const [rec, setRec] = useState<AftersaleAppealRecommendation | null>(null);
  const [fetchLogs, setFetchLogs] = useState<FetchStepLog[]>([]);
  const [activeTab, setActiveTab] = useState('plan');
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState(BAILIAN_MODEL_DEFAULT);

  useEffect(() => {
    void getBailianAiConfig().then((c) => {
      setAiKey(c.apiKey);
      setAiModel(c.model);
    });
    const synced = syncActiveOrderFromModal();
    if (synced?.orderSn) {
      setOrderSn(synced.orderSn);
      setAfterSalesId(String(synced.afterSalesId || ''));
    }
  }, []);

  const reasonOptions = useMemo(() => {
    if (!snapshot) return [];
    return flattenReasonOptions(snapshot.checkAppeal ?? undefined);
  }, [snapshot]);

  const appealItem = useMemo(
    () => (snapshot ? effectiveCanAppealItem(snapshot) : null),
    [snapshot],
  );

  const reverseLogistics = useMemo(
    () => (snapshot ? extractReverseLogisticsInfo(snapshot) : null),
    [snapshot],
  );

  const maxYuan = useMemo(() => {
    if (!snapshot) return '—';
    const fen = maxAppealFen(snapshot);
    return fen > 0 ? fenToYuan(fen) : '—';
  }, [snapshot]);

  const runAnalyze = useCallback(async () => {
    setLoading(true);
    setSnapshot(null);
    setRec(null);
    setFetchLogs([]);
    setActiveTab('plan');
    try {
      const asId = Math.floor(Number(afterSalesId)) || 0;
      const result = await runFullAftersaleAppealAnalysis(orderSn.trim(), asId, {
        forceRefresh: true,
      });
      setSnapshot(result.snapshot);
      setRec(result.recommendation);
      setOrderSn(result.snapshot.orderSn);
      setAfterSalesId(String(result.snapshot.afterSalesId));
      setFetchLogs(result.fetchLogs);
      void message.success('分析完成');
    } catch (e) {
      const err = e as Error & { fetchLogs?: FetchStepLog[] };
      if (err.fetchLogs?.length) setFetchLogs(err.fetchLogs);
      void message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [orderSn, afterSalesId]);

  const syncFromModal = (): void => {
    const m = syncActiveOrderFromModal();
    if (!m?.orderSn) {
      void message.warning('未检测到维权申诉弹窗，请先在列表点击「发起申诉」');
      return;
    }
    setOrderSn(m.orderSn);
    setAfterSalesId(String(m.afterSalesId || m.canAppealItem?.afterSalesId || ''));
    void message.success('已从弹窗读取订单号');
  };

  const planTab =
    snapshot && rec ? (
      <>
        <div className="dtx-asa-panel__status-row">
          <div className="dtx-asa-panel__pill dtx-asa-panel__pill--ok">
            <div>订单</div>
            <div>{snapshot.orderSn}</div>
          </div>
          <div
            className={`dtx-asa-panel__pill ${snapshot.chatRows.length ? 'dtx-asa-panel__pill--ok' : 'dtx-asa-panel__pill--warn'}`}
          >
            <div>聊天</div>
            <div>{snapshot.chatRows.length} 条</div>
          </div>
          <div
            className={`dtx-asa-panel__pill ${snapshot.afterSales.length ? 'dtx-asa-panel__pill--ok' : 'dtx-asa-panel__pill--warn'}`}
          >
            <div>售后</div>
            <div>{snapshot.afterSales.length} 条</div>
          </div>
          <div
            className={`dtx-asa-panel__pill ${snapshot.logistics?.traces?.length ? 'dtx-asa-panel__pill--ok' : 'dtx-asa-panel__pill--warn'}`}
          >
            <div>发货物流</div>
            <div>{snapshot.logistics?.traces?.length ?? 0} 条</div>
          </div>
          <div
            className={`dtx-asa-panel__pill ${
              reverseLogistics?.reverseLogisticOnWay === true
                ? 'dtx-asa-panel__pill--err'
                : reverseLogistics?.reverseTrackingNumber
                  ? 'dtx-asa-panel__pill--ok'
                  : reverseLogistics?.reverseLogisticOnWay === false
                    ? 'dtx-asa-panel__pill--ok'
                    : 'dtx-asa-panel__pill--warn'
            }`}
          >
            <div>退货</div>
            <div>{reverseLogistics?.onWayLabel ?? '—'}</div>
          </div>
        </div>
        <Card size="small" title="推荐方案" style={{ marginBottom: 12 }}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="申诉项">{rec.appealSubTypeLabel}</Descriptions.Item>
            <Descriptions.Item label="申诉原因">{rec.subReasonDesc}</Descriptions.Item>
            <Descriptions.Item label="申诉金额">{rec.appealAmountYuan} 元（上限约 {maxYuan}）</Descriptions.Item>
            <Descriptions.Item label="投诉消费者">
              {rec.complainConsumer
                ? `是 · ${rec.complainTypeDesc ?? '待选类型'}`
                : '否'}
            </Descriptions.Item>
          </Descriptions>
          {reasonOptions.length > 1 ? (
            <Select
              style={{ width: '100%', marginTop: 8 }}
              value={rec.subReasonCode}
              options={reasonOptions.map((r) => ({
                value: r.subReasonCode,
                label: r.subReasonDesc,
              }))}
              onChange={(code) => {
                const hit = reasonOptions.find((r) => r.subReasonCode === code);
                if (hit && rec) {
                  setRec({
                    ...rec,
                    subReasonCode: hit.subReasonCode,
                    subReasonDesc: hit.subReasonDesc,
                    parentReasonCode: hit.parentReasonCode,
                  });
                }
              }}
            />
          ) : null}
          <Input.TextArea
            rows={4}
            style={{ marginTop: 8 }}
            value={rec.description}
            onChange={(e) => setRec({ ...rec, description: e.target.value })}
          />
          <div style={{ marginTop: 8 }}>
            {rec.aiUsed ? <Tag color="purple">AI 辅助</Tag> : <Tag>规则推荐</Tag>}
            <Tag>置信度 {rec.confidence}</Tag>
          </div>
        </Card>
        {rec.basis.length ? (
          <Alert type="info" message="依据" description={<ul>{rec.basis.map((b) => <li key={b}>{b}</li>)}</ul>} />
        ) : null}
      </>
    ) : (
      <Typography.Text type="secondary">点击「开始分析」拉取数据并生成推荐</Typography.Text>
    );

  const dataTab = snapshot ? (
    <>
      <Card size="small" title="可申诉摘要" style={{ marginBottom: 8 }}>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="商品">{appealItem?.goodsName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="规格">{appealItem?.goodsSpec ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="售后原因">{appealItem?.reasonDesc ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="可申诉货款">
            {maxYuan !== '—' ? `${maxYuan} 元` : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="退款金额">
            {fenToYuan(appealItem?.refundAmount ?? 0)} 元
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card size="small" title="退货物流" style={{ marginBottom: 8 }}>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="退货在途">
            {reverseLogistics?.reverseLogisticOnWay === true ? (
              <Tag color="error">是 · 建议签收后再申诉</Tag>
            ) : reverseLogistics?.reverseLogisticOnWay === false ? (
              <Tag color="success">否</Tag>
            ) : (
              <Typography.Text type="secondary">{reverseLogistics?.onWayLabel ?? '—'}</Typography.Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="退货快递单号">
            {reverseLogistics?.reverseTrackingNumber ? (
              <Typography.Text copyable>{reverseLogistics.reverseTrackingNumber}</Typography.Text>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="售后发货状态">
            {reverseLogistics?.shippingStatusDesc ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="发货快递单号">
            {reverseLogistics?.orderTrackingNumber ? (
              <Typography.Text copyable>{reverseLogistics.orderTrackingNumber}</Typography.Text>
            ) : (
              '—'
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      {snapshot.chatRows.length ? (
        <Card size="small" title="聊天记录" style={{ marginBottom: 8 }}>
          <ChatHistoryThread rows={snapshot.chatRows} layout="mms" />
        </Card>
      ) : null}
      {snapshot.logistics?.traces?.length ? (
        <Card size="small" title="发货物流轨迹">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {snapshot.logistics.traces.map((t, i) => (
              <li key={i}>
                {t.time}
                {t.content ? ` · ${t.content}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  ) : null;

  return (
    <div className="dtx-asa-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={onClose}>
          关闭
        </Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          售后申诉 · AI 分析
        </Typography.Title>
      </div>

      <Collapse
        size="small"
        items={[
          {
            key: 'ai',
            label: '百炼 API（与负向反馈共用配置）',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Input.Password
                  placeholder="API Key"
                  value={aiKey}
                  onChange={(e) => setAiKey(e.target.value)}
                />
                <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="模型" />
                <Button
                  size="small"
                  onClick={() => {
                    void setBailianAiConfig({ apiKey: aiKey, model: aiModel }).then(() =>
                      message.success(`已保存 ${maskApiKey(aiKey)}`),
                    );
                  }}
                >
                  保存
                </Button>
              </div>
            ),
          },
        ]}
      />

      <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <Input
          placeholder="订单号"
          value={orderSn}
          onChange={(e) => setOrderSn(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <Input
          placeholder="售后单ID（可选）"
          value={afterSalesId}
          onChange={(e) => setAfterSalesId(e.target.value)}
          style={{ width: 140 }}
        />
        <Button onClick={syncFromModal}>从弹窗读取</Button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={() => void runAnalyze()}>
          开始分析
        </Button>
        <Button
          onClick={() => {
            void requestOllamaDiagnose().then((d) => {
              void message.info(d.summary);
            });
          }}
        >
          检测 AI
        </Button>
      </div>

      <Spin spinning={loading}>
        <div className="dtx-asa-panel__scroll">
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              { key: 'plan', label: '推荐方案', children: planTab },
              { key: 'data', label: '采集数据', children: dataTab },
              {
                key: 'log',
                label: '技术日志',
                children: (
                  <Input.TextArea
                    readOnly
                    rows={12}
                    value={formatLogs(fetchLogs)}
                    placeholder="分析后展示采集与 AI 日志"
                  />
                ),
              },
            ]}
          />
        </div>
      </Spin>
    </div>
  );
}
