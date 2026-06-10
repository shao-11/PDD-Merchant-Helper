import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseOutlined, FlagTwoTone, MessageTwoTone } from '@ant-design/icons';
import { Alert, App, Button, Flex, Progress, Segmented, Spin, Typography } from 'antd';
import { rrLog } from './debug-log';
import { ReportReplyLogView } from './ReportReplyLogView';
import {
  DEFAULT_REPLY_DAYS,
  DEFAULT_REPORT_DAYS,
  REPORT_INTERVAL_MS_MAX,
  REPORT_INTERVAL_MS_MIN,
  REPORT_PANEL_SHOW_LOG,
  REPORT_PANEL_SHOW_TIPS,
} from './constants';
import { randomReportIntervalMs, sleepMs } from './report-delay';
import {
  batchReportReviews,
  fetchFiveStarReviews,
  fetchLowStarReviews,
  warmReportReplyAnti,
} from './rpc';
import type { UnrepliedReviewItem } from './review-reply-status';
import { replyOneReviewWithAi } from './reply-with-ai';
import panelCssText from './report-reply-panel.css';

const PANEL_STYLE_ID = 'dtx-report-reply-panel-css';

function ensurePanelStyles(): void {
  if (document.getElementById(PANEL_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = PANEL_STYLE_ID;
  el.textContent = panelCssText;
  document.documentElement.appendChild(el);
}

type ReportReplyPanelProps = {
  mode: 'report' | 'reply';
  onClose: () => void;
};

const DAY_OPTIONS = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
  { label: '180 天', value: 180 },
] as const;

type StatCardProps = {
  title: string;
  value: string | number;
  color?: string;
  accent?: boolean;
  accentBlue?: boolean;
};

function StatCard({ title, value, color, accent, accentBlue }: StatCardProps): JSX.Element {
  const cardClass = accentBlue
    ? 'dtx-report-panel__stat-card dtx-report-panel__stat-card--accent-blue'
    : accent
      ? 'dtx-report-panel__stat-card dtx-report-panel__stat-card--accent'
      : 'dtx-report-panel__stat-card';
  return (
    <div className={cardClass}>
      <div className="dtx-report-panel__stat-label">{title}</div>
      <div className="dtx-report-panel__stat-value" style={color ? { color } : undefined}>
        {value}
        <span className="dtx-report-panel__stat-suffix">条</span>
      </div>
    </div>
  );
}

function ReplyPanelView({ onClose }: { onClose: () => void }): JSX.Element {
  const { message } = App.useApp();
  const [days, setDays] = useState<number>(DEFAULT_REPLY_DAYS);
  const [loading, setLoading] = useState(false);
  const [replying, setReplying] = useState(false);
  const [total, setTotal] = useState(0);
  const [unreplied, setUnreplied] = useState(0);
  const [replied, setReplied] = useState(0);
  const [unrepliedIds, setUnrepliedIds] = useState<string[]>([]);
  const [unrepliedItems, setUnrepliedItems] = useState<UnrepliedReviewItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 });
  const [waitNextSec, setWaitNextSec] = useState<number | null>(null);
  const loadGenRef = useRef(0);

  const loadReviews = useCallback(async (): Promise<void> => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);
    rrLog('panel', 'info', `开始查询 4～5 星好评`, { days, gen });
    try {
      const warm = await warmReportReplyAnti();
      rrLog('panel', 'info', 'MAIN inject 已响应', warm);
      const res = await fetchFiveStarReviews(days);
      if (gen !== loadGenRef.current) return;
      setTotal(res.total);
      setUnreplied(res.unreplied);
      setReplied(res.replied);
      setUnrepliedIds(res.unrepliedIds);
      setUnrepliedItems(res.unrepliedItems ?? []);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setTotal(0);
      setUnreplied(0);
      setReplied(0);
      setUnrepliedIds([]);
      setUnrepliedItems([]);
      void message.error(msg);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [days, message]);

  useEffect(() => {
    rrLog('panel', 'info', '回复面板已打开', { days });
    const t = window.setTimeout(() => void loadReviews(), 120);
    return () => window.clearTimeout(t);
  }, [days, loadReviews]);

  const handleBatchReply = async (): Promise<void> => {
    if (loading) return;
    if (unrepliedItems.length === 0 && unrepliedIds.length === 0) {
      void message.info('没有待回复的好评');
      return;
    }
    setReplying(true);
    setWaitNextSec(null);
    const items =
      unrepliedItems.length > 0
        ? [...unrepliedItems]
        : unrepliedIds.map((id) => ({ reviewId: id, comment: '', goodsName: '', star: 5 }));
    setProgress({ done: 0, total: items.length, ok: 0, fail: 0 });
    let ok = 0;
    let fail = 0;
    let aiFallback = 0;
    try {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]!;
        const res = await replyOneReviewWithAi(item);
        if (!res.aiGenerated) aiFallback += 1;
        for (const r of res.results) {
          if (r.ok) ok += 1;
          else fail += 1;
        }
        setProgress({ done: i + 1, total: items.length, ok, fail });
        if (i < items.length - 1) {
          const gapMs = randomReportIntervalMs();
          const gapSec = Math.max(1, Math.ceil(gapMs / 1000));
          setWaitNextSec(gapSec);
          await sleepMs(gapMs);
          setWaitNextSec(null);
        }
      }
      void message.success(`回复完成：成功 ${ok} 条，失败 ${fail} 条`);
      if (aiFallback > 0) {
        void message.warning(
          `${aiFallback} 条因 AI 未成功而使用了默认文案，请重载扩展并刷新评价页后重试；可在控制台查看 [一键举报][reply-ai] 日志`,
        );
      }
      await loadReviews();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setWaitNextSec(null);
      setReplying(false);
    }
  };

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const remaining = Math.max(0, progress.total - progress.done);
  const statVal = (n: number): string | number => (loading ? '…' : n);

  return (
    <div className="dtx-report-panel dtx-report-panel--reply">
      <header className="dtx-report-panel__header">
        <Flex align="flex-start" justify="space-between" gap={12}>
          <Flex align="center" gap={12} className="dtx-report-panel__header-main">
            <span className="dtx-report-panel__icon" aria-hidden>
              <MessageTwoTone twoToneColor={['#1677ff', '#93c5fd']} style={{ fontSize: 24 }} />
            </span>
            <div>
              <Typography.Title level={5} className="dtx-report-panel__title">
                一键回复
              </Typography.Title>
              <Typography.Text className="dtx-report-panel__subtitle">
                按所选天数拉取 4～5 星好评（先回复 5 星），AI 根据评价内容个性化回复（单次最多约 4000 条）
              </Typography.Text>
            </div>
          </Flex>
          <Button
            type="text"
            className="dtx-report-panel__close"
            icon={<CloseOutlined />}
            onClick={onClose}
            disabled={replying}
            aria-label="关闭"
          />
        </Flex>
      </header>

      <div className="dtx-report-panel__body">
        <section className="dtx-report-panel__block">
          <span className="dtx-report-panel__block-label">时间范围</span>
          <Segmented
            block
            size="large"
            className="dtx-report-panel__segmented"
            value={days}
            options={DAY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            onChange={(v) => setDays(Number(v))}
            disabled={loading || replying}
          />
        </section>

        <div className="dtx-report-panel__stats-area">
          <Spin spinning={loading} tip="正在拉取…" wrapperClassName="dtx-report-panel__stats-spin">
            <div className="dtx-report-panel__stats dtx-report-panel__stats--reply">
              <StatCard title="4～5 星好评" value={statVal(total)} />
              <StatCard
                title="未回复"
                value={statVal(unreplied)}
                color="#1677ff"
                accentBlue
              />
              <StatCard title="已回复" value={statVal(replied)} color="#389e0d" />
            </div>
          </Spin>
        </div>

        {loadError ? (
          <Alert type="error" showIcon message={loadError} className="dtx-report-panel__error" />
        ) : null}

        <div className="dtx-report-panel__actions">
          <Button
            type="primary"
            block
            size="large"
            className="dtx-report-panel__submit dtx-report-panel__submit--reply"
            onClick={() => void handleBatchReply()}
            loading={replying}
            disabled={loading || unreplied === 0}
          >
            一键回复好评
            {!loading && unreplied > 0 ? `（${unreplied} 条待处理）` : ''}
          </Button>
        </div>

        {(replying || progress.done > 0) && (
          <div className="dtx-report-panel__progress">
            <Typography.Text className="dtx-report-panel__progress-text">
              已回复 {progress.done} / {progress.total}，还剩 {remaining} 条（成功 {progress.ok}，失败{' '}
              {progress.fail}）
              {waitNextSec != null ? ` · 约 ${waitNextSec} 秒后下一条` : ''}
            </Typography.Text>
            <Progress percent={pct} status={replying ? 'active' : undefined} strokeColor="#1677ff" />
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportReplyPanel({ mode, onClose }: ReportReplyPanelProps): JSX.Element {
  useEffect(() => {
    ensurePanelStyles();
  }, []);

  const { message } = App.useApp();
  const [days, setDays] = useState<number>(DEFAULT_REPORT_DAYS);
  const [loading, setLoading] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [total, setTotal] = useState(0);
  const [unreported, setUnreported] = useState(0);
  const [pending, setPending] = useState(0);
  const [success, setSuccess] = useState(0);
  const [failed, setFailed] = useState(0);
  const [other, setOther] = useState(0);
  const [unreportedIds, setUnreportedIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 });
  const [waitNextSec, setWaitNextSec] = useState<number | null>(null);
  const loadGenRef = useRef(0);

  const loadReviews = useCallback(async (): Promise<void> => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);
    rrLog('panel', 'info', `开始查询`, { days, gen, url: window.location.href });
    try {
      rrLog('panel', 'info', '探测 MAIN inject（WARM_ANTI）…');
      const warm = await warmReportReplyAnti();
      rrLog('panel', 'info', 'MAIN inject 已响应', warm);
      const res = await fetchLowStarReviews(days);
      if (gen !== loadGenRef.current) {
        rrLog('panel', 'warn', '查询结果被丢弃（已有新请求）', { gen });
        return;
      }
      rrLog('panel', 'info', '查询成功', res);
      setTotal(res.total);
      setUnreported(res.unreported);
      setPending(res.pending);
      setSuccess(res.success);
      setFailed(res.failed);
      setOther(res.other);
      setUnreportedIds(res.unreportedIds);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      rrLog('panel', 'error', '查询失败', { msg, stack: e instanceof Error ? e.stack : undefined });
      setLoadError(msg);
      setTotal(0);
      setUnreported(0);
      setPending(0);
      setSuccess(0);
      setFailed(0);
      setOther(0);
      setUnreportedIds([]);
      void message.error(msg);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [days, message]);

  useEffect(() => {
    if (mode !== 'report') return;
    rrLog('panel', 'info', '举报面板已打开', { days });
    const t = window.setTimeout(() => void loadReviews(), 120);
    return () => window.clearTimeout(t);
  }, [mode, days, loadReviews]);

  const handleBatchReport = async (): Promise<void> => {
    if (loading) return;
    if (unreportedIds.length === 0) {
      void message.info('没有待举报的评价');
      return;
    }
    setReporting(true);
    setWaitNextSec(null);
    setProgress({ done: 0, total: unreportedIds.length, ok: 0, fail: 0 });
    const ids = [...unreportedIds];
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i]!;
        const res = await batchReportReviews([id]);
        for (const r of res.results) {
          if (r.ok) ok += 1;
          else fail += 1;
        }
        setProgress({ done: i + 1, total: ids.length, ok, fail });
        if (i < ids.length - 1) {
          const gapMs = randomReportIntervalMs();
          const gapSec = Math.max(1, Math.ceil(gapMs / 1000));
          setWaitNextSec(gapSec);
          rrLog('panel', 'info', `等待后举报下一条`, { gapMs, nextIndex: i + 2, total: ids.length });
          await sleepMs(gapMs);
          setWaitNextSec(null);
        }
      }
      void message.success(`举报完成：成功 ${ok} 条，失败 ${fail} 条`);
      await loadReviews();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setWaitNextSec(null);
      setReporting(false);
    }
  };

  if (mode === 'reply') {
    return <ReplyPanelView onClose={onClose} />;
  }

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const remaining = Math.max(0, progress.total - progress.done);
  const statVal = (n: number): string | number => (loading ? '…' : n);

  return (
    <div className="dtx-report-panel">
      <header className="dtx-report-panel__header">
        <Flex align="flex-start" justify="space-between" gap={12}>
          <Flex align="center" gap={12} className="dtx-report-panel__header-main">
            <span className="dtx-report-panel__icon" aria-hidden>
              <FlagTwoTone twoToneColor={['#cf1322', '#ffa39e']} style={{ fontSize: 24 }} />
            </span>
            <div>
              <Typography.Title level={5} className="dtx-report-panel__title">
                一键举报
              </Typography.Title>
              <Typography.Text className="dtx-report-panel__subtitle">
                按所选天数拉取 1～3 星评价并统计举报状态（单次最多约 2000 条）
              </Typography.Text>
            </div>
          </Flex>
          <Button
            type="text"
            className="dtx-report-panel__close"
            icon={<CloseOutlined />}
            onClick={onClose}
            disabled={reporting}
            aria-label="关闭"
          />
        </Flex>
      </header>

      <div className="dtx-report-panel__body">
        <section className="dtx-report-panel__block">
          <span className="dtx-report-panel__block-label">时间范围</span>
          <Segmented
            block
            size="large"
            className="dtx-report-panel__segmented"
            value={days}
            options={DAY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            onChange={(v) => setDays(Number(v))}
            disabled={loading || reporting}
          />
        </section>

        <div className="dtx-report-panel__stats-area">
          <Spin spinning={loading} tip="正在拉取…" wrapperClassName="dtx-report-panel__stats-spin">
            <div className="dtx-report-panel__stats">
              <StatCard title="共查到" value={statVal(total)} />
              <StatCard title="未举报" value={statVal(unreported)} color="#cf1322" accent />
              <StatCard title="待审核" value={statVal(pending)} color="#d48806" />
              <StatCard title="举报成功" value={statVal(success)} color="#389e0d" />
              <StatCard title="举报失败" value={statVal(failed)} color="#8c8c8c" />
            </div>
          </Spin>
          {other > 0 ? (
            <div className="dtx-report-panel__stats-other">
              <StatCard title="其他状态" value={statVal(other)} />
            </div>
          ) : null}
        </div>

        {loadError ? (
          <Alert type="error" showIcon message={loadError} className="dtx-report-panel__error" />
        ) : null}

        <div className="dtx-report-panel__actions">
          <Button
            type="primary"
            danger
            block
            size="large"
            className="dtx-report-panel__submit"
            onClick={() => void handleBatchReport()}
            loading={reporting}
            disabled={loading || unreported === 0}
          >
            一键举报评价
            {!loading && unreported > 0 ? `（${unreported} 条待处理）` : ''}
          </Button>
        </div>

        {(reporting || progress.done > 0) && (
          <div className="dtx-report-panel__progress">
            <Typography.Text className="dtx-report-panel__progress-text">
              已举报 {progress.done} / {progress.total}，还剩 {remaining} 条（成功 {progress.ok}，失败{' '}
              {progress.fail}）
              {waitNextSec != null ? ` · 约 ${waitNextSec} 秒后下一条` : ''}
            </Typography.Text>
            <Progress percent={pct} status={reporting ? 'active' : undefined} strokeColor="#cf1322" />
          </div>
        )}

        {REPORT_PANEL_SHOW_TIPS ? (
          <Alert
            type="info"
            showIcon
            message="说明"
            style={{ marginTop: 16, borderRadius: 10 }}
            description={`打开面板或切换天数时会自动查询。一键举报时每条间隔约 ${Math.ceil(REPORT_INTERVAL_MS_MIN / 1000)}～${Math.ceil(REPORT_INTERVAL_MS_MAX / 1000)} 秒（随机），避免过快触发系统异常。若失败请先在评价页点选 1～3 星刷新列表。`}
          />
        ) : null}

        {REPORT_PANEL_SHOW_LOG ? <ReportReplyLogView /> : null}
      </div>
    </div>
  );
}
