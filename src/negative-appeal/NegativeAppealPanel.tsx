import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ArrowLeftOutlined,
  CameraOutlined,
  CopyOutlined,
  FileImageOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  MessageOutlined,
  ShoppingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { loadMatchedQcReportFiles } from './qc-report-load';
import { ChatHistoryThread } from '../popup/ChatHistoryThread';
import { BAILIAN_MODEL_DEFAULT } from './constants';
import { getBailianAiConfig, maskApiKey, setBailianAiConfig } from './ai-config';
import { buildRecommendation } from './ollama-client';
import { requestOllamaDiagnose } from './ollama-transport';
import { fetchAppealSnapshotViaPage } from './fetch-bridge';
import { enrichSnapshotWithHuice } from './huice/enrich-snapshot';
import { captureElementToPng } from './capture-screenshot';
import type { FetchStepLog } from './fetch-log';
import { AfterSalesRecordView } from './AfterSalesRecordView';
import { appealTextForCode } from './appeal-templates';
import { resolveSupportedReasons } from './platform-reasons';
import type { AppealRecommendation, AppealSnapshot } from './types';
import panelCss from './negative-appeal-panel.css';

type Props = {
  initialTicketSn: string;
  onClose: () => void;
};

type StatusPill = {
  key: string;
  title: string;
  meta: string;
  tone: 'ok' | 'warn' | 'err';
};

function formatLogsText(logs: FetchStepLog[]): string {
  return logs
    .map((l) => {
      const t = new Date(l.at).toLocaleTimeString();
      return `[${t}] [${l.level}] ${l.step} —${l.message}${l.detail ? ` (${l.detail})` : ''}`;
    })
    .join('\n');
}

function buildStatusPills(s: AppealSnapshot): StatusPill[] {
  const tujuOk = Boolean(s.tuju?.explanation || s.tuju?.goodsName);
  const chatOk = s.chatRows.length > 0;
  const chatErr = Boolean(s.chatError);
  const afterOk = s.afterSales.length > 0;
  const afterErr = Boolean(s.afterSalesError);
  const reviewOk = s.reviews.length > 0;
  const reviewErr = Boolean(s.reviewsError);

  return [
    {
      key: 'tuju',
      title: '负向详情',
      meta: tujuOk ? '已获取' : '未获取到说明',
      tone: tujuOk ? 'ok' : 'warn',
    },
    {
      key: 'chat',
      title: '聊天记录',
      meta: chatErr ? '拉取异常' : chatOk ? `${s.chatRows.length} 条` : '无记录',
      tone: chatErr ? 'err' : chatOk ? 'ok' : 'warn',
    },
    {
      key: 'after',
      title: '售后记录',
      meta: afterErr ? '拉取失败' : afterOk ? `${s.afterSales.length} 条` : '无售后单',
      tone: afterErr ? 'err' : afterOk ? 'ok' : 'warn',
    },
    {
      key: 'review',
      title: '商品评价',
      meta: reviewErr ? '未获取' : reviewOk ? `${s.reviews.length} 条` : '无评价',
      tone: reviewErr ? 'warn' : reviewOk ? 'ok' : 'warn',
    },
  ];
}

function formatFen(fen: unknown): string {
  const n = typeof fen === 'number' ? fen : Number(fen);
  if (!Number.isFinite(n)) return '—';
  return `¥${(n / 100).toFixed(2)}`;
}

export function NegativeAppealPanel({ initialTicketSn, onClose }: Props): JSX.Element {
  const [ticketSn, setTicketSn] = useState(initialTicketSn);
  const [orderSn, setOrderSn] = useState('');
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<AppealSnapshot | null>(null);
  const [rec, setRec] = useState<AppealRecommendation | null>(null);
  const [appealText, setAppealText] = useState('');
  const [reasonCode, setReasonCode] = useState<number | null>(null);
  const [fetchLogs, setFetchLogs] = useState<FetchStepLog[]>([]);
  const [activeTab, setActiveTab] = useState('plan');
  const [aiApiKeyInput, setAiApiKeyInput] = useState('');
  const [aiModelInput, setAiModelInput] = useState(BAILIAN_MODEL_DEFAULT);
  const [aiKeySaved, setAiKeySaved] = useState(false);
  /** 工单/订单/AI 折叠：默认收起，点击标题展开；分析完成后也保持收起 */
  const [setupCollapseKeys, setSetupCollapseKeys] = useState<string[]>([]);
  const [qcPreviews, setQcPreviews] = useState<{ name: string; url: string }[]>([]);
  const [qcMatchDetail, setQcMatchDetail] = useState<string | null>(null);
  const [qcLoading, setQcLoading] = useState(false);

  const chatShotRef = useRef<HTMLDivElement>(null);
  const qcPreviewUrlsRef = useRef<string[]>([]);
  const afterShotRef = useRef<HTMLDivElement>(null);
  const tujuShotRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getBailianAiConfig().then(({ apiKey, model }) => {
      setAiModelInput(model);
      setAiKeySaved(Boolean(apiKey));
      if (apiKey) setAiApiKeyInput(apiKey);
    });
  }, []);

  useEffect(() => {
    if (snapshot && !loading) setSetupCollapseKeys([]);
  }, [snapshot, loading]);

  const revokeQcPreviewUrls = useCallback((): void => {
    for (const url of qcPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    qcPreviewUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (!snapshot) {
      revokeQcPreviewUrls();
      setQcPreviews([]);
      setQcMatchDetail(null);
      setQcLoading(false);
      return;
    }

    let cancelled = false;
    setQcLoading(true);
    void loadMatchedQcReportFiles(snapshot)
      .then((result) => {
        if (cancelled) return;
        revokeQcPreviewUrls();
        if (!result?.files.length) {
          setQcPreviews([]);
          setQcMatchDetail(result?.matchHint ?? null);
          return;
        }
        const previews = result.files.map((f) => {
          const url = URL.createObjectURL(f);
          qcPreviewUrlsRef.current.push(url);
          return { name: f.name, url };
        });
        setQcPreviews(previews);
        setQcMatchDetail(result.match?.detail ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        revokeQcPreviewUrls();
        setQcPreviews([]);
        setQcMatchDetail(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setQcLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot, revokeQcPreviewUrls]);

  useEffect(() => () => revokeQcPreviewUrls(), [revokeQcPreviewUrls]);

  const setupCollapseLabel = useMemo(() => {
    const parts: string[] = [];
    const ts = ticketSn.trim();
    if (ts) parts.push(`工单 ${ts.length > 14 ? `${ts.slice(0, 14)}…` : ts}`);
    const os = orderSn.trim();
    if (os) parts.push(`订单 ${os.length > 12 ? `${os.slice(0, 12)}…` : os}`);
    if (aiKeySaved) parts.push(`AI ${maskApiKey(aiApiKeyInput)} · ${aiModelInput}`);
    else parts.push('AI 未配置');
    return parts.join(' · ');
  }, [ticketSn, orderSn, aiKeySaved, aiApiKeyInput, aiModelInput]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent): void => {
      if (el.scrollHeight <= el.clientHeight + 1) return;
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [activeTab, snapshot, loading]);

  const { reasonOptions, reasonsFromApi } = useMemo(() => {
    const { list, fromApi } = resolveSupportedReasons(snapshot?.tuju);
    return { reasonOptions: list, reasonsFromApi: fromApi };
  }, [snapshot?.tuju]);

  const selectedReasonLabel = useMemo(
    () => reasonOptions.find((r) => r.appealReasonCode === reasonCode)?.appealReasonDesc,
    [reasonOptions, reasonCode],
  );

  const statusPills = useMemo(() => (snapshot ? buildStatusPills(snapshot) : []), [snapshot]);

  const aiCloudDown = useMemo(
    () => fetchLogs.some((l) => l.step === 'AI-结论' && l.level === 'error'),
    [fetchLogs],
  );

  const runAiDiagnoseOnly = useCallback(async () => {
    try {
      const d = await requestOllamaDiagnose();
      setFetchLogs((prev) => {
        const kept = prev.filter((l) => !l.step.startsWith('AI-'));
        return [...kept, ...d.logs];
      });
      void message[d.ok ? 'success' : 'warning'](d.summary);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const saveAiConfig = useCallback(async () => {
    const key = aiApiKeyInput.trim();
    if (!key) {
      void message.warning('请填写百炼 API Key');
      return;
    }
    await setBailianAiConfig({ apiKey: key, model: aiModelInput.trim() || BAILIAN_MODEL_DEFAULT });
    setAiKeySaved(true);
    void message.success('已保存，正在检测云端 AI…');
    await runAiDiagnoseOnly();
  }, [aiApiKeyInput, aiModelInput, runAiDiagnoseOnly]);

  const onReasonChange = (code: number): void => {
    setReasonCode(code);
    const found = reasonOptions.find((r) => r.appealReasonCode === code);
    if (found) setAppealText(appealTextForCode(code, found.appealDesc));
  };

  const runAnalyze = useCallback(async () => {
    const ts = ticketSn.trim();
    if (!ts) {
      void message.warning('请填写工单号');
      return;
    }
    setLoading(true);
    setSnapshot(null);
    setRec(null);
    revokeQcPreviewUrls();
    setQcPreviews([]);
    setQcMatchDetail(null);
    setFetchLogs([]);
    setActiveTab('plan');
    try {
      let snap = await fetchAppealSnapshotViaPage(ts, orderSn.trim());
      snap = await enrichSnapshotWithHuice(snap);
      setSnapshot(snap);
      setOrderSn(snap.orderSn);
      const recommendation = await buildRecommendation(snap);
      setRec(recommendation);
      setReasonCode(recommendation.appealReasonCode);
      setAppealText(recommendation.appealText);
      setFetchLogs([...(snap.fetchLogs ?? []), ...(recommendation.ollamaLogs ?? [])]);
      const errCount = [...(snap.fetchLogs ?? []), ...(recommendation.ollamaLogs ?? [])].filter(
        (l) => l.level === 'error',
      ).length;
      if (errCount > 0) {
        void message.warning('分析完成，部分数据未拉到，可在「技术日志」查看');
      } else {
        void message.success('分析完成，请查看推荐方案并下载凭证');
      }
    } catch (e) {
      const err = e as Error & { fetchLogs?: FetchStepLog[] };
      if (err.fetchLogs?.length) setFetchLogs(err.fetchLogs);
      void message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [ticketSn, orderSn, revokeQcPreviewUrls]);

  const downloadQcImage = (name: string, url: string): void => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.click();
    void message.success(`已下载 ${name}`);
  };

  const copyAppealText = (): void => {
    if (!appealText.trim()) {
      void message.warning('暂无申诉说明');
      return;
    }
    void navigator.clipboard.writeText(appealText).then(
      () => message.success('已复制申诉说明，可粘贴到平台'),
      () => message.error('复制失败'),
    );
  };

  const downloadChatShot = (): void => {
    if (!chatShotRef.current || !snapshot) return;
    void captureElementToPng(chatShotRef.current, `聊天-${snapshot.orderSn}.png`).then(() =>
      message.success('聊天记录截图已下载'),
    );
  };

  const downloadAfterShot = (): void => {
    if (!afterShotRef.current || !snapshot) return;
    void captureElementToPng(afterShotRef.current, `售后-${snapshot.orderSn}.png`).then(() =>
      message.success('售后记录截图已下载'),
    );
  };

  const downloadTujuShot = (): void => {
    if (!tujuShotRef.current || !snapshot) return;
    void captureElementToPng(tujuShotRef.current, `负向详情-${snapshot.orderSn}.png`).then(() =>
      message.success('负向详情截图已下载'),
    );
  };

  const renderTujuDescriptions = (s: AppealSnapshot): JSX.Element => (
    <Descriptions size="small" column={1} bordered>
      <Descriptions.Item label="工单号">{s.ticketSn || s.tuju?.ticketSn || '—'}</Descriptions.Item>
      <Descriptions.Item label="订单号">{s.orderSn || s.tuju?.orderSn || '—'}</Descriptions.Item>
      <Descriptions.Item label="扣款说明">{s.tuju?.explanation ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="判定依据">{s.tuju?.compensationReason ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="商品">{s.tuju?.goodsName ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="补偿金额">{formatFen(s.tuju?.playMoneyAmount)}</Descriptions.Item>
      <Descriptions.Item label="可申诉">
        {s.tuju?.canAppeal === true ? '是' : s.tuju?.canAppeal === false ? '否' : '—'}
      </Descriptions.Item>
    </Descriptions>
  );

  const planTab = snapshot && rec ? (
    <>
      <div className="dtx-na-panel__status-row">
        {statusPills.map((p) => (
          <div
            key={p.key}
            className={`dtx-na-panel__status-pill dtx-na-panel__status-pill--${p.tone}`}
          >
            <div className="dtx-na-panel__status-pill-title">{p.title}</div>
            <div className="dtx-na-panel__status-pill-meta">{p.meta}</div>
          </div>
        ))}
      </div>

      <div className="dtx-na-panel__recommend-box">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          推荐申诉原因
        </Typography.Text>
        <div className="dtx-na-panel__recommend-reason">{selectedReasonLabel ?? '—'}</div>
        <Select
          style={{ width: '100%', marginBottom: 10 }}
          value={reasonCode ?? undefined}
          onChange={onReasonChange}
          optionLabelProp="label"
          options={reasonOptions.map((r) => ({
            value: r.appealReasonCode,
            label: r.appealReasonDesc,
          }))}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          申诉说明（可复制到平台）
        </Typography.Text>
        <Input.TextArea rows={4} value={appealText} onChange={(e) => setAppealText(e.target.value)} />
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Tag color={rec.confidence === 'high' ? 'success' : rec.confidence === 'medium' ? 'processing' : 'default'}>
            置信度 {rec.confidence}
          </Tag>
          {rec.aiUsed ? <Tag color="purple">AI 辅助</Tag> : <Tag>规则推荐</Tag>}
          {!reasonsFromApi ? <Tag color="warning">原因列表为兜底</Tag> : null}
        </div>
      </div>

      {!rec.aiUsed && (!aiKeySaved || aiCloudDown) ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={!aiKeySaved ? 'AI 未配置：请填写百炼 API Key' : 'AI 未接入：百炼云端调用失败'}
          description={
            <Typography.Text style={{ fontSize: 12 }}>
              {!aiKeySaved
                ? '展开顶部「工单/订单/AI」，粘贴百炼 API Key 后点「保存并检测」。'
                : '请核对 Key、模型名与账户余额，或在百炼控制台查看调用记录。'}
            </Typography.Text>
          }
          action={
            <Button size="small" type="primary" onClick={() => void runAiDiagnoseOnly()}>
              重新检测            </Button>
          }
        />
      ) : null}

      {rec.basis.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="推荐依据"
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
              {rec.basis.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          }
        />
      ) : null}
    </>
  ) : null;

  const evidenceTab = snapshot ? (
    <>
      <Card
        size="small"
        className="dtx-na-panel__card"
        title={
          <span>
            <FileTextOutlined style={{ marginRight: 6 }} />
            负向详情
          </span>
        }
        extra={
          <Button
            size="small"
            type="link"
            icon={<CameraOutlined />}
            disabled={!snapshot.tuju?.explanation && !snapshot.tuju?.goodsName}
            onClick={downloadTujuShot}
          >
            下载截图
          </Button>
        }
      >
        <div ref={tujuShotRef} className="dtx-na-panel__tuju-wrap">
          {snapshot.tuju?.explanation || snapshot.tuju?.goodsName ? (
            renderTujuDescriptions(snapshot)
          ) : (
            <Typography.Text type="secondary">未获取到负向详情，请刷新详情页后重新分析</Typography.Text>
          )}
        </div>
      </Card>

      <Card
        size="small"
        className="dtx-na-panel__card"
        title={
          <span>
            <MessageOutlined style={{ marginRight: 6 }} />
            聊天记录
          </span>
        }
        extra={
          <Button
            size="small"
            type="link"
            icon={<CameraOutlined />}
            disabled={!snapshot.chatRows.length}
            onClick={downloadChatShot}
          >
            下载截图
          </Button>
        }
      >
        {snapshot.chatError ? <Alert type="warning" showIcon message={snapshot.chatError} style={{ marginBottom: 8 }} /> : null}
        <div ref={chatShotRef} className="dtx-na-panel__chat-wrap">
          {snapshot.chatRows.length > 0 ? (
            <ChatHistoryThread rows={snapshot.chatRows} layout="mms" />
          ) : (
            <Typography.Text type="secondary" style={{ padding: 16, display: 'block', textAlign: 'center' }}>
              无聊天记录?            </Typography.Text>
          )}
        </div>
      </Card>

      <Card
        size="small"
        className="dtx-na-panel__card"
        title={
          <span>
            <ShoppingOutlined style={{ marginRight: 6 }} />
            售后记录
          </span>
        }
        extra={
          <Button
            size="small"
            type="link"
            icon={<CameraOutlined />}
            disabled={!snapshot.afterSales.length}
            onClick={downloadAfterShot}
          >
            下载截图
          </Button>
        }
      >
        {snapshot.afterSalesError ? (
          <Alert type="error" showIcon message={snapshot.afterSalesError} style={{ marginBottom: 8 }} />
        ) : null}
        <div ref={afterShotRef} className="dtx-na-panel__after-wrap">
          {snapshot.afterSales.length === 0 ? (
            <Typography.Text type="secondary">无售后单</Typography.Text>
          ) : (
            <AfterSalesRecordView items={snapshot.afterSales} orderSn={snapshot.orderSn} />
          )}
        </div>
      </Card>

      <Card size="small" className="dtx-na-panel__card" title="商品评价">
        {snapshot.reviewsError ? (
          <Alert type="warning" showIcon message={snapshot.reviewsError} style={{ marginBottom: 8 }} />
        ) : null}
        {snapshot.reviews.length === 0 && !snapshot.reviewsError ? (
          <Typography.Text type="secondary">该订单暂无评价</Typography.Text>
        ) : (
          snapshot.reviews.map((r) => (
            <div
              key={String(r.reviewId)}
              style={{ marginBottom: 8, padding: 10, background: '#f8fafc', borderRadius: 8, fontSize: 13 }}
            >
              {r.comment ?? '（无文字）'}
            </div>
          ))
        )}
      </Card>

      <Card
        size="small"
        className="dtx-na-panel__card"
        title={
          <span>
            <FileImageOutlined style={{ marginRight: 6 }} />
            质检报告
          </span>
        }
      >
        {qcLoading ? (
          <div className="dtx-na-panel__qc-loading">
            <Spin size="small" />
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              正在匹配质检报告…
            </Typography.Text>
          </div>
        ) : null}
        {snapshot.huiceSkuNames?.length ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            旺店通规格：{snapshot.huiceSkuNames.join('；')}
          </Typography.Text>
        ) : snapshot.huiceError ? (
          <Alert
            type="warning"
            showIcon
            message={snapshot.huiceError}
            description={
              snapshot.fetchLogs?.find((l) => l.step === '旺店通货品')?.detail ? (
                <Typography.Text style={{ fontSize: 11, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {snapshot.fetchLogs.find((l) => l.step === '旺店通货品')?.detail}
                </Typography.Text>
              ) : undefined
            }
            style={{ marginBottom: 8 }}
          />
        ) : null}
        {!qcLoading && qcMatchDetail && qcPreviews.length > 0 ? (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
              {qcMatchDetail}
            </Typography.Text>
            <div className="dtx-na-panel__qc-grid">
              {qcPreviews.map((p) => (
                <div key={p.url} className="dtx-na-panel__qc-item">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.name}>
                    <img src={p.url} alt={p.name} className="dtx-na-panel__qc-thumb" />
                  </a>
                  <Typography.Text ellipsis className="dtx-na-panel__qc-name" title={p.name}>
                    {p.name}
                  </Typography.Text>
                  <Button
                    type="link"
                    size="small"
                    className="dtx-na-panel__qc-dl"
                    onClick={() => downloadQcImage(p.name, p.url)}
                  >
                    下载
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {!qcLoading && qcPreviews.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
            {qcMatchDetail && !qcPreviews.length
              ? qcMatchDetail
              : '未匹配到质检报告。有旺店通规格时仅按旺店通商品名匹配；无对应品类（如菌子炒饭）不会误配到其他规格。请先在飞牛分享页同步质检图。'}
          </Typography.Text>
        ) : null}
      </Card>
    </>
  ) : null;

  const logTab =
    fetchLogs.length > 0 ? (
      <Collapse
        size="small"
        items={[
          {
            key: 'log',
            label: `采集与 AI 诊断（${fetchLogs.length} 步，含 AI-* 前缀）`,
            children: (
              <div>
                <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => {
                    void navigator.clipboard.writeText(formatLogsText(fetchLogs)).then(() =>
                      message.success('已复制日志'),
                    );
                  }}
                  >
                    复制日志
                  </Button>
                  <Button size="small" onClick={() => void runAiDiagnoseOnly()}>
                    重新检测AI
                  </Button>
                </div>
                <pre className="dtx-na-panel__log-box">{formatLogsText(fetchLogs)}</pre>
              </div>
            ),
          },
        ]}
      />
    ) : (
      <Typography.Text type="secondary">分析后将显示技术日志</Typography.Text>
    );

  const isIdle = !loading && !snapshot;

  return (
    <div className={`dtx-na-panel${isIdle ? ' dtx-na-panel--idle' : ''}`}>
      <style>{panelCss}</style>

      <div className="dtx-na-panel__head">
        <div className="dtx-na-panel__toolbar">
          <Button type="text" icon={<ArrowLeftOutlined />} className="dtx-na-panel__back" onClick={onClose}>
            返回
          </Button>
        </div>

        <Collapse
          className="dtx-na-panel__setup-collapse"
          size="small"
          activeKey={setupCollapseKeys}
          onChange={(keys) => setSetupCollapseKeys(Array.isArray(keys) ? keys : keys ? [keys] : [])}
          items={[
            {
              key: 'setup',
              label: `工单 / 订单 / AI（${setupCollapseLabel}）`,
              children: (
                <>
                  <div className="dtx-na-panel__form-row">
                    <div>
                      <div className="dtx-na-panel__form-label">工单号</div>
                      <Input
                        value={ticketSn}
                        onChange={(e) => setTicketSn(e.target.value)}
                        placeholder="一般自动带出，可改"
                        disabled={loading}
                      />
                    </div>
                    <div>
                      <div className="dtx-na-panel__form-label">订单号（可留空自动识别）</div>
                      <Input
                        value={orderSn}
                        onChange={(e) => setOrderSn(e.target.value)}
                        placeholder="分析后自动填充"
                        disabled={loading}
                      />
                    </div>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '4px 0 8px' }}>
                    AI 设置（阿里云百炼）</Typography.Text>
                  <div className="dtx-na-panel__form-label">API Key</div>
                  <Input.Password
                    value={aiApiKeyInput}
                    onChange={(e) => setAiApiKeyInput(e.target.value)}
                    placeholder="sk- 开头，在百炼控制台创建"
                    disabled={loading}
                  />
                  <div className="dtx-na-panel__form-label" style={{ marginTop: 8 }}>
                    模型
                  </div>
                  <Input
                    value={aiModelInput}
                    onChange={(e) => setAiModelInput(e.target.value)}
                    placeholder={BAILIAN_MODEL_DEFAULT}
                    disabled={loading}
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button type="primary" size="small" onClick={() => void saveAiConfig()} disabled={loading}>
                      保存并检测                    </Button>
                    <Button size="small" onClick={() => void runAiDiagnoseOnly()} disabled={loading}>
                      仅检测                    </Button>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6, lineHeight: 1.55 }}>
                    Key 仅保存在本机浏览器。申诉推荐模型：<Typography.Text code>qwen-turbo</Typography.Text> 或{' '}
                    <Typography.Text code>qwen-plus</Typography.Text>（推荐 qwen-turbo / qwen-plus）。                  </Typography.Text>
                </>
              ),
            },
          ]}
        />
      </div>

      <div ref={bodyRef} className="dtx-na-panel__scroll">
        <div className="dtx-na-panel__scroll-inner">
        {loading ? (
          <div className="dtx-na-panel__loading">
            <Spin size="large" />
            <Typography.Paragraph style={{ marginTop: 16, color: '#64748b' }}>
              正在拉取负向详情、聊天、售后、评价…            </Typography.Paragraph>
          </div>
        ) : null}

        {isIdle ? (
          <div className="dtx-na-panel__empty">
            <FileSearchOutlined className="dtx-na-panel__empty-icon" />
            <Typography.Paragraph strong style={{ marginBottom: 4 }}>
              准备分析本单申诉材料
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>
              将自动拉取负向详情、聊天记录、售后与评价，并生成申诉建议
            </Typography.Text>
          </div>
        ) : null}

        {!loading && snapshot && !rec ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message="分析结果未生成"
            description="数据已拉取但推荐方案生成失败，请点「重新分析」或查看下方技术日志。"
          />
        ) : null}

        {!loading && snapshot && rec ? (
          <Tabs
            className="dtx-na-panel__tabs"
            activeKey={activeTab}
            onChange={setActiveTab}
            destroyInactiveTabPane
            items={[
              { key: 'plan', label: '申诉方案', children: planTab },
              { key: 'evidence', label: '凭证材料', children: evidenceTab },
              { key: 'log', label: '技术日志', children: logTab },
            ]}
          />
        ) : null}

        <div className="dtx-na-panel__footer">
        <Button
          type="primary"
          className="dtx-na-panel__footer-primary"
          icon={<ThunderboltOutlined />}
          loading={loading}
          block
          onClick={() => void runAnalyze()}
        >
          {snapshot ? '重新分析' : '开始分析'}
        </Button>
        {snapshot && rec ? (
          <div className="dtx-na-panel__footer-tools">
            <Button icon={<CopyOutlined />} onClick={copyAppealText}>
              复制说明
            </Button>
            <Button icon={<CameraOutlined />} onClick={downloadChatShot} disabled={!snapshot.chatRows.length}>
              聊天图?            </Button>
            <Button icon={<CameraOutlined />} onClick={downloadAfterShot} disabled={!snapshot.afterSales.length}>
              售后图?            </Button>
            <Button
              icon={<CameraOutlined />}
              onClick={downloadTujuShot}
              disabled={!snapshot.tuju?.explanation && !snapshot.tuju?.goodsName}
            >
              负向图?            </Button>
          </div>
        ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
