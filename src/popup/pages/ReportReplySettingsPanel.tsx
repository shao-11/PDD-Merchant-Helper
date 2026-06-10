import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleOutlined,
  FlagTwoTone,
  MessageTwoTone,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Collapse, Input, Modal, Switch, Tag, Typography, message } from 'antd';
import {
  STORAGE_AUTO_REPLY_ENABLED,
  STORAGE_AUTO_REPLY_LAST_RESULT,
  STORAGE_AUTO_REPORT_ENABLED,
  STORAGE_AUTO_REPORT_LAST_RESULT,
  STORAGE_AUTO_REPORT_RUNNING,
  STORAGE_REPORT_REPLY_MODULE_ENABLED,
  STORAGE_RR_BAILIAN_API_KEY,
  STORAGE_RR_BAILIAN_MODEL,
} from '../../constants/storage-keys';
import {
  AUTO_REPORT_FETCH_DAYS,
  AUTO_REPLY_FETCH_DAYS,
  MSG_AUTO_REPORT_TRIGGER_NOW,
  formatAutoTaskInterval,
  type AutoReportLastResult,
  type AutoReplyLastResult,
} from '../../report-reply/auto-report-messages';
import {
  REPORT_REPLY_AI_MODEL_DEFAULT,
  ensureDefaultReportReplyAiConfig,
  setReportReplyAiConfig,
} from '../../report-reply/ai-config';
import { probeReportReplyAi, requestGenerateReplyContent } from '../../report-reply/ai-transport';
import { REPLY_AI_PERSONA_BRIEF, REPLY_AI_PERSONA_RULES } from '../../report-reply/reply-ai-prompt';

type RunStatus = {
  time: string;
  main: string;
  extra?: string;
  ok: boolean;
};

function formatRunTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReportLastRun(r: AutoReportLastResult | null): RunStatus {
  if (!r) return { time: '', main: '尚无执行记录', ok: true };
  const stat =
    r.reportedOk != null ? `成功 ${r.reportedOk} · 失败 ${r.reportedFail ?? 0}` : r.message;
  return { time: formatRunTime(r.at), main: stat, ok: r.ok };
}

function formatReplyLastRun(r: AutoReplyLastResult | null): RunStatus {
  if (!r) return { time: '', main: '尚无执行记录', ok: true };
  const main =
    r.repliedOk != null
      ? `成功 ${r.repliedOk} · 失败 ${r.repliedFail ?? 0}`
      : r.message;
  let extra: string | undefined;
  if (r.aiGeneratedOk != null && r.repliedOk != null && r.repliedOk > 0) {
    extra =
      (r.aiFallbackOk ?? 0) > 0
        ? `AI 生成 ${r.aiGeneratedOk} 条 · 默认文案 ${r.aiFallbackOk} 条`
        : `全部为 AI 生成（${r.aiGeneratedOk} 条）`;
  }
  return { time: formatRunTime(r.at), main, extra, ok: r.ok };
}

type FeatureBlockProps = {
  icon: JSX.Element;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  status: RunStatus;
};

function FeatureBlock({
  icon,
  title,
  desc,
  checked,
  onChange,
  status,
}: FeatureBlockProps): JSX.Element {
  return (
    <article className="dtx-rr-settings__block">
      <div className="dtx-rr-settings__row">
        <span className="dtx-rr-settings__tile" aria-hidden>
          {icon}
        </span>
        <div className="dtx-rr-settings__row-text">
          <Typography.Text className="dtx-rr-settings__row-title">{title}</Typography.Text>
          <Typography.Text className="dtx-rr-settings__row-desc">{desc}</Typography.Text>
        </div>
        <Switch checked={checked} onChange={onChange} className="dtx-rr-settings__switch" />
      </div>
      <div
        className={
          status.ok
            ? 'dtx-rr-settings__status'
            : 'dtx-rr-settings__status dtx-rr-settings__status--fail'
        }
      >
        {status.time ? (
          <span className="dtx-rr-settings__status-time">上次 {status.time}</span>
        ) : null}
        <span className="dtx-rr-settings__status-main">{status.main}</span>
        {status.extra ? (
          <span className="dtx-rr-settings__status-extra">{status.extra}</span>
        ) : null}
      </div>
    </article>
  );
}

const SAMPLE_REPLY_ITEM = {
  reviewId: 'sample',
  goodsName: '滇同学鸡枞菌干货',
  comment: '菌菇很新鲜，包装严实，会回购',
  star: 5 as const,
};

export function ReportReplySettingsPanel(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [autoReport, setAutoReport] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [moduleOn, setModuleOn] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastReport, setLastReport] = useState<AutoReportLastResult | null>(null);
  const [lastReply, setLastReply] = useState<AutoReplyLastResult | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState(REPORT_REPLY_AI_MODEL_DEFAULT);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiSampling, setAiSampling] = useState(false);

  const load = useCallback(() => {
    void chrome.storage.local.get(
      [
        STORAGE_AUTO_REPORT_ENABLED,
        STORAGE_AUTO_REPLY_ENABLED,
        STORAGE_REPORT_REPLY_MODULE_ENABLED,
        STORAGE_AUTO_REPORT_RUNNING,
        STORAGE_AUTO_REPORT_LAST_RESULT,
        STORAGE_AUTO_REPLY_LAST_RESULT,
        STORAGE_RR_BAILIAN_API_KEY,
        STORAGE_RR_BAILIAN_MODEL,
      ],
      (raw) => {
        if (chrome.runtime.lastError) return;
        setAutoReport(raw[STORAGE_AUTO_REPORT_ENABLED] !== false);
        setAutoReply(raw[STORAGE_AUTO_REPLY_ENABLED] !== false);
        setModuleOn(raw[STORAGE_REPORT_REPLY_MODULE_ENABLED] !== false);
        setRunning(raw[STORAGE_AUTO_REPORT_RUNNING] === true);
        setLastReport((raw[STORAGE_AUTO_REPORT_LAST_RESULT] as AutoReportLastResult) ?? null);
        setLastReply((raw[STORAGE_AUTO_REPLY_LAST_RESULT] as AutoReplyLastResult) ?? null);
        setAiApiKey(String(raw[STORAGE_RR_BAILIAN_API_KEY] ?? ''));
        setAiModel(
          String(raw[STORAGE_RR_BAILIAN_MODEL] ?? '').trim() || REPORT_REPLY_AI_MODEL_DEFAULT,
        );
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    void ensureDefaultReportReplyAiConfig().then(() => load());
    const onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return;
      if (
        changes[STORAGE_AUTO_REPORT_ENABLED] ||
        changes[STORAGE_AUTO_REPLY_ENABLED] ||
        changes[STORAGE_AUTO_REPORT_LAST_RESULT] ||
        changes[STORAGE_AUTO_REPLY_LAST_RESULT] ||
        changes[STORAGE_AUTO_REPORT_RUNNING]
      ) {
        load();
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [load]);

  const pollRunningUntilDone = useCallback(() => {
    const tick = (): void => {
      chrome.storage.local.get([STORAGE_AUTO_REPORT_RUNNING], (raw) => {
        if (chrome.runtime.lastError) return;
        if (raw[STORAGE_AUTO_REPORT_RUNNING] === true) {
          setRunning(true);
          window.setTimeout(tick, 2000);
        } else {
          setRunning(false);
          load();
        }
      });
    };
    tick();
  }, [load]);

  const saveAutoReport = (checked: boolean): void => {
    chrome.storage.local.set({ [STORAGE_AUTO_REPORT_ENABLED]: checked }, () => {
      if (chrome.runtime.lastError) {
        void message.error(`保存失败：${chrome.runtime.lastError.message}`);
        return;
      }
      setAutoReport(checked);
      void message.success(checked ? '已开启自动举报' : '已关闭自动举报');
    });
  };

  const saveAutoReply = (checked: boolean): void => {
    chrome.storage.local.set({ [STORAGE_AUTO_REPLY_ENABLED]: checked }, () => {
      if (chrome.runtime.lastError) {
        void message.error(`保存失败：${chrome.runtime.lastError.message}`);
        return;
      }
      setAutoReply(checked);
      void message.success(checked ? '已开启自动回复' : '已关闭自动回复');
    });
  };

  const handleSaveAi = (): void => {
    setAiSaving(true);
    void setReportReplyAiConfig({ apiKey: aiApiKey, model: aiModel }).then(() => {
      setAiSaving(false);
      void message.success('AI 配置已保存');
    });
  };

  const handleTestAi = (): void => {
    setAiTesting(true);
    void probeReportReplyAi().then((r) => {
      setAiTesting(false);
      if (r.ok) {
        void message.success(`百炼连接正常（${r.model}）`);
      } else {
        void message.error(r.error ?? '连接失败');
      }
    });
  };

  const handleSampleReply = (): void => {
    setAiSampling(true);
    void requestGenerateReplyContent(SAMPLE_REPLY_ITEM)
      .then((text) => {
        Modal.info({
          title: 'AI 试写回复（示例）',
          width: 480,
          content: (
            <div className="dtx-rr-settings__sample-modal">
              <Typography.Text type="secondary" className="dtx-rr-settings__sample-meta">
                商品：{SAMPLE_REPLY_ITEM.goodsName}
                <br />
                评价：{SAMPLE_REPLY_ITEM.comment}
              </Typography.Text>
              <div className="dtx-rr-settings__sample-text">{text}</div>
            </div>
          ),
          okText: '知道了',
        });
      })
      .catch((e) => {
        void message.error(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setAiSampling(false));
  };

  const handleTriggerNow = (): void => {
    if (!autoReport && !autoReply) {
      void message.info('请至少开启自动举报或自动回复之一');
      return;
    }
    setTriggering(true);
    chrome.runtime.sendMessage({ type: MSG_AUTO_REPORT_TRIGGER_NOW }, (res) => {
      setTriggering(false);
      if (chrome.runtime.lastError) {
        void message.error(chrome.runtime.lastError.message || '触发失败');
        return;
      }
      if (res?.ok) {
        void message.info('已在后台开始，请保持 Chrome 运行');
        setRunning(true);
        pollRunningUntilDone();
      }
    });
  };

  const taskEnabled = autoReport || autoReply;
  const reportStatus = formatReportLastRun(lastReport);
  const replyStatus = formatReplyLastRun(lastReply);

  const runPlan = useMemo((): string => {
    if (!taskEnabled) return '请先开启至少一项自动化任务';
    const parts: string[] = [];
    if (autoReport) parts.push(`举报近 ${AUTO_REPORT_FETCH_DAYS} 天 1～3 星`);
    if (autoReply) parts.push(`AI 回复近 ${AUTO_REPLY_FETCH_DAYS} 天 4～5 星`);
    return autoReport && autoReply ? `${parts[0]} → ${parts[1]}` : parts.join('');
  }, [autoReport, autoReply, taskEnabled]);

  if (loading) {
    return (
      <div className="dtx-toolbox__tool-panel-pad dtx-rr-settings dtx-rr-settings--loading">
        <Typography.Text type="secondary">加载中…</Typography.Text>
      </div>
    );
  }

  return (
    <div className="dtx-toolbox__tool-panel-pad dtx-rr-settings">
      <div className="dtx-rr-settings__scroll">
        {!moduleOn ? (
          <p className="dtx-rr-settings__warn" role="status">
            请先在工具箱首页打开本插件开关，评价页才会显示悬浮按钮。
          </p>
        ) : null}

        <section className="dtx-rr-settings__section">
          <div className="dtx-rr-settings__section-head">
            <span className="dtx-toolbox__hub-section-title">自动化任务</span>
          </div>
          <Typography.Text className="dtx-rr-settings__section-sub">
            {formatAutoTaskInterval()}定时执行 · 与下方「立即执行」逻辑相同
          </Typography.Text>

          <div className="dtx-rr-settings__list">
            <FeatureBlock
              icon={
                <FlagTwoTone twoToneColor={['#cf1322', '#ffa39e']} style={{ fontSize: 22 }} />
              }
              title="自动举报"
              desc={`拉取近 ${AUTO_REPORT_FETCH_DAYS} 天 1～3 星，举报未举报项`}
              checked={autoReport}
              onChange={saveAutoReport}
              status={reportStatus}
            />
            <FeatureBlock
              icon={
                <MessageTwoTone twoToneColor={['#1677ff', '#93c5fd']} style={{ fontSize: 22 }} />
              }
              title="自动回复"
              desc={`拉取近 ${AUTO_REPLY_FETCH_DAYS} 天 4～5 星（先 5 星后 4 星），AI 个性化回复`}
              checked={autoReply}
              onChange={saveAutoReply}
              status={replyStatus}
            />
          </div>
        </section>

        <section className="dtx-rr-settings__section">
          <div className="dtx-rr-settings__section-head">
            <span className="dtx-toolbox__hub-section-title">
              <RobotOutlined style={{ marginRight: 6, color: '#1677ff' }} />
              AI 智能回复
            </span>
          </div>
          <Typography.Text className="dtx-rr-settings__section-sub">
            百炼云端 · 未填 Key 时复用负向申诉中的 Key
          </Typography.Text>

          <article className="dtx-rr-settings__block dtx-rr-settings__block--ai">
            <div className="dtx-rr-settings__ai-head">
              <div>
                <Typography.Text strong className="dtx-rr-settings__ai-persona">
                  {REPLY_AI_PERSONA_BRIEF.persona}
                </Typography.Text>
                <Typography.Text type="secondary" className="dtx-rr-settings__ai-scope">
                  {REPLY_AI_PERSONA_BRIEF.scope}
                </Typography.Text>
              </div>
              <Tag icon={<CheckCircleOutlined />} color="processing" bordered={false}>
                {aiModel || REPORT_REPLY_AI_MODEL_DEFAULT}
              </Tag>
            </div>
            <div className="dtx-rr-settings__tags">
              {REPLY_AI_PERSONA_BRIEF.tags.map((t) => (
                <Tag key={t} bordered={false}>
                  {t}
                </Tag>
              ))}
            </div>

            <Collapse
              ghost
              size="small"
              className="dtx-rr-settings__rules-collapse"
              items={[
                {
                  key: 'rules',
                  label: '查看人设与规则',
                  children: (
                    <pre className="dtx-rr-settings__rules-pre">{REPLY_AI_PERSONA_RULES}</pre>
                  ),
                },
              ]}
            />

            <div className="dtx-rr-settings__form-grid">
              <label className="dtx-rr-settings__field">
                <span className="dtx-rr-settings__field-label">API Key</span>
                <Input.Password
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder="sk-…（仅保存在本机）"
                  autoComplete="off"
                  visibilityToggle={false}
                  size="middle"
                />
              </label>
              <label className="dtx-rr-settings__field">
                <span className="dtx-rr-settings__field-label">模型</span>
                <Input
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder={REPORT_REPLY_AI_MODEL_DEFAULT}
                  size="middle"
                />
              </label>
            </div>

            <div className="dtx-rr-settings__ai-actions">
              <Button type="primary" onClick={handleSaveAi} loading={aiSaving}>
                保存配置
              </Button>
              <Button onClick={handleTestAi} loading={aiTesting}>
                测试连接
              </Button>
              <Button onClick={handleSampleReply} loading={aiSampling}>
                试写一条
              </Button>
            </div>
          </article>
        </section>
      </div>

      <div className="dtx-rr-settings__footer">
        <div className="dtx-rr-settings__run-plan">
          <ThunderboltOutlined />
          <span>{running ? '任务执行中…' : runPlan}</span>
        </div>
        <Button
          type="primary"
          size="large"
          block
          className="dtx-rr-settings__run-btn"
          onClick={handleTriggerNow}
          loading={triggering || running}
          disabled={!taskEnabled}
        >
          {running ? '任务进行中…' : '立即执行一轮'}
        </Button>
        <Typography.Text className="dtx-rr-settings__footer-note">
          后台静默打开评价页，完成后自动关闭，不影响当前浏览
        </Typography.Text>
      </div>
    </div>
  );
}
