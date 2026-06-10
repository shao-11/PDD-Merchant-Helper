import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { LineChartOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Descriptions,
  Image,
  Input,
  Modal,
  Segmented,
  Space,
  Spin,
  Table,
  Typography,
  message,
} from 'antd';
import type { EChartsOption } from 'echarts';
import ReactECharts from 'echarts-for-react';
import type { ColumnsType } from 'antd/es/table';
import {
  STORAGE_CHAT_EMPTY_ORDER_SN_MAP,
  STORAGE_REVIEWS_AUTO_FETCH_ALL,
  STORAGE_REVIEWS_CAPTURE,
  STORAGE_REVIEWS_FETCH_RANGE_DAYS,
  STORAGE_REVIEWS_MERGE_PAGES,
} from '../../constants/storage-keys';
import type { ReviewItem, ReviewsCaptureState } from '../../types/reviews';
import { formatUnixSeconds } from '../../utils/time';
import { parseSpecs } from '../../utils/specs';
import {
  DEFAULT_NEGATIVE_KEYWORDS,
  filterReviewsByNegative,
  filterReviewsByReportStatus,
  filterReviewsBySearch,
  sortReviews,
  summarizeReviews,
  type ReportStatusFilterMode,
  type ReviewSortMode,
} from '../../utils/review-display-pipeline';
import { buildDailyReviewTrend, type TrendRangeDays } from '../../utils/review-trend-series';
import {
  MMS_CHAT_SEARCH_REFERER,
  parseChatHistoryResponse,
  type ChatHistoryParseResult,
} from '../../utils/chat-history-parse';
import { ChatHistoryThread } from '../ChatHistoryThread';
import { errorStep, logStep } from '../../content/logger';

/** 根据解析结果写入「无聊天记录订单」映射（静默探测与弹窗共用） */
function mergeChatOutcomeIntoHiddenMap(
  sn: string,
  parsed: ChatHistoryParseResult,
  setHidden: Dispatch<SetStateAction<Set<string>>>,
  syncRef?: { current: Set<string> }
): void {
  if (parsed.treatAsNoDataSignal) {
    void chrome.storage.local.get(STORAGE_CHAT_EMPTY_ORDER_SN_MAP, (raw) => {
      const map = {
        ...((raw[STORAGE_CHAT_EMPTY_ORDER_SN_MAP] as Record<string, boolean> | undefined) ?? {}),
      };
      map[sn] = true;
      void chrome.storage.local.set({ [STORAGE_CHAT_EMPTY_ORDER_SN_MAP]: map }, () => {
        if (chrome.runtime.lastError) return;
        setHidden((prev) => {
          const next = new Set(prev).add(sn);
          if (syncRef) syncRef.current = next;
          return next;
        });
      });
    });
    return;
  }
  if (parsed.outcome === 'has_messages' && parsed.rows.length > 0) {
    void chrome.storage.local.get(STORAGE_CHAT_EMPTY_ORDER_SN_MAP, (raw) => {
      const map = {
        ...((raw[STORAGE_CHAT_EMPTY_ORDER_SN_MAP] as Record<string, boolean> | undefined) ?? {}),
      };
      delete map[sn];
      void chrome.storage.local.set({ [STORAGE_CHAT_EMPTY_ORDER_SN_MAP]: map }, () => {
        if (chrome.runtime.lastError) return;
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(sn);
          if (syncRef) syncRef.current = next;
          return next;
        });
      });
    });
  }
}

/** 与 inject-hook 中 window.postMessage 约定一致（勿与评价捕获逻辑混用 type） */
const PDD_ANALYZER_MSG_SOURCE = 'PDD_REVIEW_ANALYZER';
const TABLE_PAGINATION_LOCALE = {
  items_per_page: '条/页',
  jump_to: '跳转到',
  jump_to_confirm: '确定',
  page: '页',
  prev_page: '上一页',
  next_page: '下一页',
  prev_5: '向前 5 页',
  next_5: '向后 5 页',
  prev_3: '向前 3 页',
  next_3: '向后 3 页',
  page_size: '页码',
} as const;

function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toCsvRow(cells: string[]): string {
  return cells
    .map((c) => {
      const s = String(c ?? '');
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(',');
}

function buildCsv(rows: ReviewItem[]): string {
  const header = toCsvRow(['订单号', '商品名', '评价', '时间', '规格', '图片数', '举报状态', '商品链接']);
  const body = rows.map((r) =>
    toCsvRow([
      r.orderSn ?? '',
      r.goodsName ?? '',
      r.comment ?? '',
      r.createTime != null ? String(r.createTime) : '',
      parseSpecs(r.specs) === '—' ? '' : parseSpecs(r.specs),
      String(r.pictures?.length ?? 0),
      r.reportResult?.desc ?? r.reportResult?.clientDesc ?? '',
      r.goodsInfoUrl ?? '',
    ])
  );
  return '\uFEFF' + [header, ...body].join('\n');
}

type Props = { compact?: boolean; embedded?: boolean };

export type ReviewFetchRangeDays = 7 | 30 | 90 | 180;

const FETCH_RANGE_OPTIONS: { label: string; value: ReviewFetchRangeDays }[] = [
  { label: '近7天', value: 7 },
  { label: '近30天', value: 30 },
  { label: '近90天', value: 90 },
  { label: '近180天', value: 180 },
];

function rowStableKey(r: ReviewItem): string {
  if (r.reviewId != null) return String(r.reviewId);
  if (r.orderSn) return `sn:${r.orderSn}`;
  return `t:${r.createTime ?? 0}-g:${r.goodsId ?? 0}`;
}

/** 同页悬浮层遮罩 z-index 极高，Select 默认挂 body 时下拉会躲在遮罩下面无法点击 */
function selectGetPopupContainer(trigger: HTMLElement): HTMLElement {
  return (
    trigger.closest('#pdd-review-analyzer-overlay') ??
    trigger.closest('#pdd-activity-assistant-overlay') ??
    document.body
  );
}

export function ReviewsTable({ compact, embedded }: Props): JSX.Element {
  const [capture, setCapture] = useState<ReviewsCaptureState | null>(null);
  const [search, setSearch] = useState('');
  const [fetchRangeDays, setFetchRangeDays] = useState<ReviewFetchRangeDays>(7);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchStatusText, setFetchStatusText] = useState<string | null>(null);
  const pendingFetchRequestIdRef = useRef<string | null>(null);
  const fetchRangeDaysRef = useRef<ReviewFetchRangeDays>(7);
  const [detailRow, setDetailRow] = useState<ReviewItem | null>(null);
  /** P1：本地排序（仅影响表格与导出顺序，不改接口） */
  const [sortMode, setSortMode] = useState<ReviewSortMode>('timeDesc');
  /** P3：仅保留评价正文命中内置负面词的条目 */
  const [negativeKeywordFilter, setNegativeKeywordFilter] = useState(false);
  /** 举报状态：全部 / 未被举报 / 举报成功（仅本地匹配接口已返回的 reportResult） */
  const [reportStatusFilter, setReportStatusFilter] = useState<ReportStatusFilterMode>('all');
  /** 表格分页每页条数（仅本地展示，与接口请求的「请求每页条数」无关） */
  const [tablePageSize, setTablePageSize] = useState(() => (compact ? 6 : 10));
  const [trendModalOpen, setTrendModalOpen] = useState(false);
  const [trendRangeDays, setTrendRangeDays] = useState<TrendRangeDays>(30);

  const chatOnMmsPage = useMemo(
    () => typeof window !== 'undefined' && window.location.hostname === 'mms.pinduoduo.com',
    []
  );
  const pendingChatRequestIdRef = useRef<string | null>(null);
  /** 当前这次聊天记录请求对应的订单号（用于写回「无数据」缓存） */
  const pendingChatOrderSnRef = useRef<string | null>(null);
  /** 曾判定为聊天记录「无数据」的订单号，评价表隐藏入口 */
  const [chatHiddenOrderSet, setChatHiddenOrderSet] = useState(() => new Set<string>());
  /** 已从 chrome.storage 读完「无数据订单」映射后再跑静默探测，避免覆盖竞态 */
  const [chatHiddenStorageHydrated, setChatHiddenStorageHydrated] = useState(false);
  const chatHiddenOrderRef = useRef<Set<string>>(new Set());
  /** CHAT_HISTORY_RESPONSE：静默探测 requestId → 订单号（不与弹窗共用 pendingChatRequestIdRef） */
  const silentChatProbeRef = useRef(new Map<string, string>());
  /** 静默探测完成后 resolve Promise（串行队列用） */
  const silentProbeResolversRef = useRef(new Map<string, () => void>());
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOrderLabel, setChatOrderLabel] = useState('');
  /** 聊天记录弹窗：接口解析结果（区分「无记录」与「出错」） */
  const [chatParse, setChatParse] = useState<ChatHistoryParseResult | null>(null);
  /** 仅网络层 / HTTP 非 2xx / postMessage 异常 */
  const [chatErr, setChatErr] = useState<string | null>(null);

  /** 聊天记录弹窗：标题栏拖拽位移 */
  const chatDragOffsetRef = useRef({ x: 0, y: 0 });
  const [chatModalDrag, setChatModalDrag] = useState({ x: 0, y: 0 });
  const [chatModalDraggingUi, setChatModalDraggingUi] = useState(false);

  useEffect(() => {
    if (!chatModalOpen) {
      chatDragOffsetRef.current = { x: 0, y: 0 };
      setChatModalDrag({ x: 0, y: 0 });
      setChatModalDraggingUi(false);
    }
  }, [chatModalOpen]);

  const onChatModalTitleMouseDown = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('.ant-modal-close') || el.closest('button') || el.closest('a')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = chatDragOffsetRef.current.x;
    const oy = chatDragOffsetRef.current.y;

    const onMove = (ev: MouseEvent): void => {
      const x = ox + (ev.clientX - startX);
      const y = oy + (ev.clientY - startY);
      chatDragOffsetRef.current = { x, y };
      setChatModalDrag({ x, y });
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      setChatModalDraggingUi(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    setChatModalDraggingUi(true);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, []);

  const openChatHistory = useCallback(
    (orderSn: string | undefined) => {
      const sn = orderSn?.trim();
      if (!sn) {
        message.warning('当前行无订单号');
        return;
      }
      if (!chatOnMmsPage) {
        message.warning('请在拼多多商家后台页面使用（扩展单独弹窗无法调用页面内聊天接口）');
        return;
      }
      const requestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      pendingChatRequestIdRef.current = requestId;
      pendingChatOrderSnRef.current = sn;
      setChatOrderLabel(sn);
      setChatModalOpen(true);
      setChatLoading(true);
      setChatParse(null);
      setChatErr(null);
      try {
        window.postMessage(
          {
            source: PDD_ANALYZER_MSG_SOURCE,
            type: 'CHAT_HISTORY_REQUEST',
            requestId,
            orderSn: sn,
          },
          '*'
        );
      } catch (e) {
        setChatLoading(false);
        setChatErr(String(e));
      }
    },
    [chatOnMmsPage]
  );

  useEffect(() => {
    chatHiddenOrderRef.current = chatHiddenOrderSet;
  }, [chatHiddenOrderSet]);

  useEffect(() => {
    const onWinMessage = (event: MessageEvent): void => {
      if (event.source !== window) return;
      if (event.origin && event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        requestId?: string;
        ok?: boolean;
        status?: number;
        bodyText?: string;
        error?: string;
      };
      if (data?.source !== PDD_ANALYZER_MSG_SOURCE || data.type !== 'CHAT_HISTORY_RESPONSE') return;
      if (!data.requestId) return;

      const silentSn = silentChatProbeRef.current.get(data.requestId);
      if (silentSn !== undefined) {
        silentChatProbeRef.current.delete(data.requestId);
        const resolve = silentProbeResolversRef.current.get(data.requestId);
        silentProbeResolversRef.current.delete(data.requestId);
        resolve?.();

        const sn = silentSn.trim();
        if (!data.error && data.ok) {
          const parsed = parseChatHistoryResponse(data.bodyText ?? '{}');
          mergeChatOutcomeIntoHiddenMap(sn, parsed, setChatHiddenOrderSet, chatHiddenOrderRef);
        }
        return;
      }

      if (data.requestId !== pendingChatRequestIdRef.current) return;
      setChatLoading(false);
      if (data.error) {
        setChatErr(data.error);
        setChatParse(null);
        return;
      }
      if (!data.ok) {
        setChatErr(
          `请求失败 HTTP ${data.status ?? '—'}${data.bodyText ? `：${data.bodyText.slice(0, 400)}` : ''}`
        );
        setChatParse(null);
        return;
      }
      setChatErr(null);
      const parsed = parseChatHistoryResponse(data.bodyText ?? '{}');
      setChatParse(parsed);
      const sn = pendingChatOrderSnRef.current?.trim();
      if (sn) mergeChatOutcomeIntoHiddenMap(sn, parsed, setChatHiddenOrderSet, chatHiddenOrderRef);
    };
    window.addEventListener('message', onWinMessage);
    return () => window.removeEventListener('message', onWinMessage);
  }, []);

  const load = useCallback(() => {
    logStep('storage', '执行从 chrome.storage.local 读取 reviewsCapture');
    void chrome.storage.local.get(STORAGE_REVIEWS_CAPTURE, (raw) => {
      if (chrome.runtime.lastError) {
        errorStep('storage', '读取存储失败', chrome.runtime.lastError.message);
        message.error(chrome.runtime.lastError.message ?? '读取存储失败');
        return;
      }
      const v = raw[STORAGE_REVIEWS_CAPTURE] as ReviewsCaptureState | undefined;
      logStep('storage', '读取完成', {
        hasData: !!v?.payload?.data?.length,
        rows: v?.payload?.data?.length ?? 0,
      });
      setCapture(v ?? null);
    });
  }, []);

  useEffect(() => {
    void chrome.storage.local.get(STORAGE_CHAT_EMPTY_ORDER_SN_MAP, (raw) => {
      if (chrome.runtime.lastError) {
        setChatHiddenStorageHydrated(true);
        return;
      }
      const map = raw[STORAGE_CHAT_EMPTY_ORDER_SN_MAP] as Record<string, boolean> | undefined;
      if (map && typeof map === 'object') {
        const next = new Set(Object.keys(map).filter((k) => map[k]));
        chatHiddenOrderRef.current = next;
        setChatHiddenOrderSet(next);
      }
      setChatHiddenStorageHydrated(true);
    });
  }, []);

  /** 当前捕获数据中唯一订单号指纹（变化则触发后台静默探测） */
  const captureOrderFingerprint = useMemo(() => {
    const rows = capture?.payload?.data ?? [];
    const sns = [...new Set(rows.map((r) => r.orderSn?.trim()).filter(Boolean))] as string[];
    sns.sort();
    return sns.join('\u0001');
  }, [capture]);

  /** 对列表内每个尚未标记为「无数据」的订单串行请求聊天记录，用于统一隐藏入口（不打开弹窗） */
  useEffect(() => {
    if (
      !chatHiddenStorageHydrated ||
      !chatOnMmsPage ||
      !capture?.payload?.data?.length ||
      !captureOrderFingerprint
    )
      return;
    const sns = [...new Set(capture.payload.data.map((r) => r.orderSn?.trim()).filter(Boolean))] as string[];
    let cancelled = false;
    const gapMs = 320;

    void (async () => {
      for (const sn of sns) {
        if (cancelled) break;
        if (chatHiddenOrderRef.current.has(sn)) continue;

        await new Promise<void>((resolve) => {
          const requestId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `silent-chat-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
          let finished = false;
          const finish = (): void => {
            if (finished) return;
            finished = true;
            resolve();
          };
          const to = window.setTimeout(() => {
            silentChatProbeRef.current.delete(requestId);
            silentProbeResolversRef.current.delete(requestId);
            finish();
          }, 55000);
          silentChatProbeRef.current.set(requestId, sn);
          silentProbeResolversRef.current.set(requestId, () => {
            window.clearTimeout(to);
            finish();
          });
          try {
            window.postMessage(
              {
                source: PDD_ANALYZER_MSG_SOURCE,
                type: 'CHAT_HISTORY_REQUEST',
                requestId,
                orderSn: sn,
              },
              '*'
            );
          } catch {
            window.clearTimeout(to);
            silentChatProbeRef.current.delete(requestId);
            silentProbeResolversRef.current.delete(requestId);
            finish();
          }
        });

        await new Promise((r) => window.setTimeout(r, gapMs));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [captureOrderFingerprint, chatOnMmsPage, chatHiddenStorageHydrated]);

  useEffect(() => {
    fetchRangeDaysRef.current = fetchRangeDays;
  }, [fetchRangeDays]);

  useEffect(() => {
    void chrome.storage.local.set({
      [STORAGE_REVIEWS_MERGE_PAGES]: true,
      [STORAGE_REVIEWS_AUTO_FETCH_ALL]: false,
    });
    void chrome.storage.local.get([STORAGE_REVIEWS_FETCH_RANGE_DAYS], (r) => {
      const d = Number(r[STORAGE_REVIEWS_FETCH_RANGE_DAYS]);
      if (d === 7 || d === 30 || d === 90 || d === 180) {
        setFetchRangeDays(d);
        fetchRangeDaysRef.current = d;
      }
    });
  }, []);

  const startFetchByDays = useCallback(
    (days: ReviewFetchRangeDays) => {
      if (!chatOnMmsPage) {
        message.warning('请在拼多多商家后台评价页使用（扩展弹窗无法直接请求页面内接口）');
        return;
      }
      const requestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      pendingFetchRequestIdRef.current = requestId;
      setFetchLoading(true);
      setFetchStatusText(`正在拉取近 ${days} 天评价…`);
      logStep('fetch', '发起按时间范围拉取', { days, requestId });
      void chrome.storage.local.remove(STORAGE_REVIEWS_CAPTURE, () => {
        setCapture(null);
        try {
          window.postMessage(
            {
              source: PDD_ANALYZER_MSG_SOURCE,
              type: 'FETCH_REVIEWS_BY_DAYS',
              requestId,
              days,
            },
            '*'
          );
        } catch (e) {
          setFetchLoading(false);
          setFetchStatusText(null);
          message.error(String(e));
        }
      });
    },
    [chatOnMmsPage]
  );

  useEffect(() => {
    const onWinMessage = (event: MessageEvent): void => {
      if (event.source !== window) return;
      if (event.origin && event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        requestId?: string;
        ok?: boolean;
        error?: string;
        rowCount?: number;
        pages?: number;
        days?: number;
      };
      if (data?.source !== PDD_ANALYZER_MSG_SOURCE || data.type !== 'FETCH_REVIEWS_BY_DAYS_DONE') return;
      if (!data.requestId || data.requestId !== pendingFetchRequestIdRef.current) return;
      pendingFetchRequestIdRef.current = null;
      setFetchLoading(false);
      if (data.ok) {
        const n = data.rowCount ?? 0;
        const p = data.pages ?? 1;
        setFetchStatusText(`近 ${data.days ?? fetchRangeDaysRef.current} 天已拉取约 ${n} 条（${p} 页）`);
        if (n > 0) message.success(`已加载近 ${data.days} 天评价 ${n} 条`);
        else message.info('该时间范围内暂无评价数据');
      } else {
        setFetchStatusText(data.error ?? '拉取失败');
        message.error(data.error ?? '拉取失败');
      }
    };
    window.addEventListener('message', onWinMessage);
    return () => window.removeEventListener('message', onWinMessage);
  }, []);

  useEffect(() => {
    if (!chatOnMmsPage) return;
    startFetchByDays(fetchRangeDays);
  }, [chatOnMmsPage, fetchRangeDays, startFetchByDays]);

  useEffect(() => {
    load();
    const onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local' || !changes[STORAGE_REVIEWS_CAPTURE]) return;
      const nv = changes[STORAGE_REVIEWS_CAPTURE].newValue as ReviewsCaptureState | undefined;
      setCapture(nv ?? null);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [load]);

  const onFetchRangeChange = useCallback((v: ReviewFetchRangeDays) => {
    setFetchRangeDays(v);
    void chrome.storage.local.set({ [STORAGE_REVIEWS_FETCH_RANGE_DAYS]: v });
  }, []);

  const clearAccumulated = useCallback(() => {
    void chrome.storage.local.remove(STORAGE_REVIEWS_CAPTURE, () => {
      if (chrome.runtime.lastError) {
        message.error(chrome.runtime.lastError.message ?? '清空失败');
        return;
      }
      logStep('storage', '已清空本地累积 reviewsCapture');
      setCapture(null);
      message.success('已清空本地累积的评价数据');
    });
  }, []);

  const rows = capture?.payload?.data ?? [];
  const err = capture?.payload?._error;
  const totalNum = capture?.payload?.totalNum;
  const reviewNum = capture?.payload?.reviewNum;
  const showNum = capture?.payload?.showNum;

  /** 搜索 → 差评关键词 → 举报状态 → 排序（全程本地，不依赖新接口） */
  const displayRows = useMemo(() => {
    const searched = filterReviewsBySearch(rows, search);
    const negFiltered = filterReviewsByNegative(searched, negativeKeywordFilter, DEFAULT_NEGATIVE_KEYWORDS);
    const reportFiltered = filterReviewsByReportStatus(negFiltered, reportStatusFilter);
    return sortReviews(reportFiltered, sortMode);
  }, [rows, search, negativeKeywordFilter, reportStatusFilter, sortMode]);

  const summary = useMemo(() => summarizeReviews(displayRows), [displayRows]);

  const trendChartOption = useMemo((): EChartsOption => {
    const { days, counts } = buildDailyReviewTrend(displayRows, trendRangeDays);
    const rotate = trendRangeDays >= 90 ? 45 : 0;
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 44, right: 20, top: 28, bottom: rotate ? 56 : 40 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days,
        axisLabel: { rotate, fontSize: 11 },
      },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      series: [
        {
          name: '评价条数',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: counts,
          areaStyle: { opacity: 0.12 },
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [displayRows, trendRangeDays]);

  const looksLikePermissionDenied = useMemo(
    () =>
      !!err &&
      (/40010|缺少.{0,40}权限|无权限|无权使用|permission/i.test(err) || err.includes('权限')),
    [err]
  );

  const looksLikeSystemBusy = useMemo(
    () => !!err && (/2000018|系统异常/i.test(err)),
    [err]
  );

  /** 拼多多服务端返回的业务码：可查评价总量上限（扩展无法绕过） */
  const looksLikeReviewQuota = useMemo(
    () => !!err && (/2000010|近.{0,30}2000/i.test(err)),
    [err]
  );

  const columns: ColumnsType<ReviewItem> = useMemo(
    () => [
      {
        title: '订单号',
        dataIndex: 'orderSn',
        key: 'orderSn',
        width: compact ? 128 : 160,
        ellipsis: true,
        render: (v: string | undefined) => v ?? '—',
      },
      {
        title: '商品',
        dataIndex: 'goodsName',
        key: 'goodsName',
        width: compact ? 160 : 220,
        ellipsis: true,
      },
      {
        title: '评价',
        dataIndex: 'comment',
        key: 'comment',
        ellipsis: true,
      },
      {
        title: '时间',
        dataIndex: 'createTime',
        key: 'createTime',
        width: compact ? 136 : 156,
        render: (t: number | undefined) => formatUnixSeconds(t),
      },
      {
        title: '规格',
        key: 'specs',
        width: compact ? 120 : 180,
        ellipsis: true,
        render: (_: unknown, r) => parseSpecs(r.specs),
      },
      {
        title: '图',
        key: 'pics',
        width: compact ? 120 : 132,
        render: (_: unknown, r) => {
          const urls = (r.pictures ?? [])
            .map((p) => p?.url)
            .filter((u): u is string => typeof u === 'string' && u.length > 0);
          if (urls.length === 0) {
            return (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                无图
              </Typography.Text>
            );
          }
          const z = 2147483647;
          return (
            <Image.PreviewGroup preview={{ zIndex: z }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  maxWidth: compact ? 108 : 120,
                  alignItems: 'center',
                }}
              >
                {urls.map((url, i) => (
                  <Image
                    key={`${rowStableKey(r)}-tbl-${i}`}
                    src={url}
                    alt=""
                    width={compact ? 32 : 36}
                    height={compact ? 32 : 36}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    preview={{ zIndex: z }}
                  />
                ))}
              </div>
            </Image.PreviewGroup>
          );
        },
      },
      {
        title: '举报',
        key: 'report',
        width: compact ? 72 : 88,
        ellipsis: true,
        render: (_: unknown, r) => r.reportResult?.desc ?? r.reportResult?.clientDesc ?? '—',
      },
      {
        title: '操作',
        key: 'actions',
        width: compact ? 148 : 168,
        fixed: 'right' as const,
        render: (_: unknown, r) => {
          const sn = r.orderSn?.trim() ?? '';
          const hideChatLink = sn.length > 0 && chatHiddenOrderSet.has(sn);
          return (
            <Space size={4} wrap>
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setDetailRow(r)}>
                详情
              </Button>
              {!hideChatLink ? (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  disabled={!sn || !chatOnMmsPage}
                  title={
                    !chatOnMmsPage
                      ? '请在商家后台本页使用'
                      : !sn
                        ? '无订单号'
                        : '查看聊天记录（需先在「客服聊天搜索」页加载一次以同步校验头，或其它标签页已打开该页亦可）'
                  }
                  onClick={() => openChatHistory(r.orderSn)}
                >
                  聊天记录
                </Button>
              ) : null}
            </Space>
          );
        },
      },
    ],
    [compact, chatOnMmsPage, openChatHistory, chatHiddenOrderSet]
  );

  const tablePageSizeOptions = useMemo(
    () => (compact ? (['6', '10', '20', '50'] as const) : (['10', '20', '50', '100'] as const)),
    [compact]
  );

  /** embedded 时在商家后台页打开悬浮层，pathname 仍是 mms，必须用 props 区分宽布局 */
  const fullLayout =
    embedded ||
    window.location.pathname.endsWith('panel.html') ||
    new URLSearchParams(window.location.search).get('embed') === '1';

  return (
    <div
      style={{
        padding: embedded ? 12 : fullLayout ? 16 : 8,
        width: embedded ? '100%' : fullLayout ? 'min(1200px, 100vw)' : undefined,
        maxWidth: embedded ? '100%' : fullLayout ? 1200 : undefined,
        margin: embedded ? 0 : fullLayout ? '0 auto' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flex: 1,
        minHeight: 0,
        height: embedded ? '100%' : undefined,
        overflow: embedded ? 'hidden' : undefined,
      }}
    >
      {err ? (
        <Alert
          type={looksLikePermissionDenied ? 'error' : 'warning'}
          showIcon
          message={
            looksLikePermissionDenied
              ? '接口拒绝返回评价列表（账号权限不足）'
              : looksLikeReviewQuota
                ? '接口拒绝（平台可查条数规则）'
                : looksLikeSystemBusy
                  ? '接口返回系统异常（多为风控/频控）'
                  : '上次捕获异常'
          }
          description={
            <div>
              <div>{err}</div>
              {looksLikePermissionDenied ? (
                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  扩展只能展示页面实际拿到的接口结果，无法在浏览器里绕过拼多多权限。请在商家后台让主账号为当前子账号开通与本页菜单一致的权限（控制台里的跨境/评价相关能力），或换有权限的账号登录后再打开评价列表触发加载。
                </p>
              ) : null}
              {looksLikeReviewQuota ? (
                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  此为拼多多服务端规则（扩展无法绕过）。请尝试切换为更短的时间范围（如近 7 天）后重新拉取，或在商家后台缩小筛选时间后重试。
                </p>
              ) : null}
              {!looksLikePermissionDenied && !looksLikeReviewQuota && looksLikeSystemBusy ? (
                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  可稍后重试、刷新评价页后再次打开评价分析，或先切换为更短时间范围。
                </p>
              ) : null}
            </div>
          }
        />
      ) : rows.length === 0 && !fetchLoading ? (
        <Alert
          type="info"
          showIcon
          message="暂无数据"
          description={
            chatOnMmsPage
              ? '正在等待按时间范围拉取完成；若长时间无数据，请刷新评价页后重新打开「评价分析」。'
              : '请在商家后台评价页打开本工具，将自动按所选时间范围拉取评价。'
          }
        />
      ) : null}

      {fetchLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <Spin size="small" />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {fetchStatusText ?? '正在拉取评价…'}
          </Typography.Text>
        </div>
      ) : null}

      {/* 同页悬浮层 z-index 为 2147483646，Modal 默认约 1000，会导致详情弹窗整层躲在半透明遮罩后面 */}
      <Modal
        title="评价详情"
        open={detailRow != null}
        onCancel={() => setDetailRow(null)}
        footer={
          <Button type="primary" onClick={() => setDetailRow(null)}>
            关闭
          </Button>
        }
        width={Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 48 : 720)}
        destroyOnClose
        zIndex={2147483647}
        styles={{ mask: { zIndex: 2147483647 } }}
      >
        {detailRow ? (
          <div style={{ maxHeight: 'min(70vh, 640px)', overflowY: 'auto' }}>
            <Descriptions bordered size="small" column={1} labelStyle={{ width: 112 }}>
              <Descriptions.Item label="评价 ID">{detailRow.reviewId ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="订单号">{detailRow.orderSn ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="商品 ID">{detailRow.goodsId ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="商品名">{detailRow.goodsName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="昵称/名称">{detailRow.name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="匿名">
                {detailRow.anonymousReview === true ? '是' : detailRow.anonymousReview === false ? '否' : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="时间">
                {formatUnixSeconds(detailRow.createTime)}
                {detailRow.createTime != null ? `（${detailRow.createTime}）` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="规格">{parseSpecs(detailRow.specs)}</Descriptions.Item>
              <Descriptions.Item label="评价全文">
                <Typography.Paragraph copyable style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                  {detailRow.comment ?? '—'}
                </Typography.Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="商品链接">
                {detailRow.goodsInfoUrl ? (
                  <Typography.Link href={detailRow.goodsInfoUrl} target="_blank" rel="noreferrer">
                    打开
                  </Typography.Link>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="缩略图">
                {detailRow.thumbUrl ? (
                  <Image
                    src={detailRow.thumbUrl}
                    alt=""
                    width={96}
                    style={{ borderRadius: 4 }}
                    preview={{ zIndex: 2147483647 }}
                  />
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="晒图">
                {detailRow.pictures?.length ? (
                  <Space wrap size={[8, 8]}>
                    {detailRow.pictures.map((p, i) =>
                      p.url ? (
                        <Image
                          key={`${rowStableKey(detailRow)}-pic-${i}`}
                          src={p.url}
                          alt=""
                          width={72}
                          height={72}
                          style={{ objectFit: 'cover', borderRadius: 4 }}
                          preview={{ zIndex: 2147483647 }}
                        />
                      ) : null
                    )}
                  </Space>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="举报">
                {detailRow.reportResult
                  ? [
                      detailRow.reportResult.desc,
                      detailRow.reportResult.clientDesc,
                      detailRow.reportResult.status != null ? `状态码 ${detailRow.reportResult.status}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="评价趋势（本地统计）"
        open={trendModalOpen}
        onCancel={() => setTrendModalOpen(false)}
        footer={
          <Button type="primary" onClick={() => setTrendModalOpen(false)}>
            关闭
          </Button>
        }
        width={Math.min(920, typeof window !== 'undefined' ? window.innerWidth - 32 : 920)}
        zIndex={2147483647}
        styles={{ mask: { zIndex: 2147483647 } }}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
          按<strong>当前表格数据</strong>（含搜索与筛选）统计；时间范围为<strong>最近若干日历日</strong>内落在每一天的评价条数。
          若某日无评价或未抓到该日数据则为 0；<strong>不会请求新接口</strong>。
        </Typography.Paragraph>
        <Segmented<TrendRangeDays>
          value={trendRangeDays}
          onChange={(v) => setTrendRangeDays(v)}
          options={[
            { label: '近 1 天', value: 1 },
            { label: '近 30 天', value: 30 },
            { label: '近 90 天', value: 90 },
            { label: '近 180 天', value: 180 },
          ]}
          style={{ marginBottom: 12 }}
        />
        <div style={{ width: '100%', height: 380 }}>
          <ReactECharts option={trendChartOption} style={{ width: '100%', height: '100%' }} notMerge lazyUpdate />
        </div>
      </Modal>

      <Modal
        title={
          <div
            onMouseDown={onChatModalTitleMouseDown}
            style={{
              cursor: chatModalDraggingUi ? 'grabbing' : 'grab',
              userSelect: 'none',
              margin: '-16px -24px -12px',
              padding: '16px 52px 12px 24px',
              boxSizing: 'border-box',
            }}
          >
            {chatOrderLabel ? `订单聊天记录 · ${chatOrderLabel}` : '订单聊天记录'}
          </div>
        }
        open={chatModalOpen}
        onCancel={() => {
          setChatModalOpen(false);
          pendingChatRequestIdRef.current = null;
        }}
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Button
              onClick={() => {
                window.open(MMS_CHAT_SEARCH_REFERER, '_blank', 'noopener,noreferrer');
              }}
            >
              打开客服聊天搜索页
            </Button>
            <Button
              type="primary"
              onClick={() => {
                setChatModalOpen(false);
                pendingChatRequestIdRef.current = null;
              }}
            >
              关闭
            </Button>
          </Space>
        }
        width={Math.min(800, typeof window !== 'undefined' ? window.innerWidth - 32 : 800)}
        zIndex={2147483647}
        styles={{
          mask: { zIndex: 2147483647 },
          content: {
            transform: `translate(${chatModalDrag.x}px, ${chatModalDrag.y}px)`,
          },
        }}
        destroyOnClose
      >
        {!chatLoading &&
        !chatErr &&
        chatParse?.outcome === 'has_messages' &&
        chatParse.rows.length > 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
            以下为该订单在商家后台可查询范围内的会话摘录（最近 180 天）。若加载异常，请先打开
            <Typography.Link href={MMS_CHAT_SEARCH_REFERER} target="_blank" rel="noreferrer">
              客服聊天搜索页
            </Typography.Link>
            完成加载后再试。
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
            数据由商家后台 <strong>getHistoryMessage</strong> 接口返回（与评价页无关）；时间范围最近 180 天。请先在本浏览器打开并加载完成
            <Typography.Link href={MMS_CHAT_SEARCH_REFERER} target="_blank" rel="noreferrer">
              客服聊天搜索页
            </Typography.Link>
            ，以便页面发起聊天相关请求并缓存校验头；扩展会把校验头写入本站 localStorage，其它商家后台标签页在 45 分钟内可共用。若仍无数据，请在该页用订单号搜索后再回到评价页重试。
          </Typography.Paragraph>
        )}
        {chatParse?.outcome === 'has_messages' && chatParse.rows.length > 0 ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
            共 {chatParse.rows.length} 条消息
          </Typography.Text>
        ) : chatParse?.summaryLine ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            {chatParse.summaryLine}
          </Typography.Text>
        ) : null}
        {chatErr && !chatLoading ? (
          <Alert type="error" showIcon message="请求未成功" description={chatErr} style={{ marginBottom: 8 }} />
        ) : null}
        {!chatLoading && !chatErr && chatParse?.outcome === 'failed' && chatParse.failureDetail ? (
          <Alert type="warning" showIcon message="接口失败（非「无聊天记录」）" description={chatParse.failureDetail} style={{ marginBottom: 8 }} />
        ) : null}
        {!chatLoading && !chatErr && chatParse?.outcome === 'no_messages' && chatParse.emptyHint ? (
          <Alert
            type="info"
            showIcon
            message={chatParse.treatAsNoDataSignal ? '无数据' : '未查到聊天记录'}
            description={chatParse.emptyHint}
            style={{ marginBottom: 8 }}
          />
        ) : null}
        {chatLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
          </div>
        ) : (
          <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto' }}>
            {chatParse?.outcome === 'has_messages' && chatParse.rows.length > 0 ? (
              <ChatHistoryThread rows={chatParse.rows} />
            ) : null}
            {!chatLoading && !chatErr && chatParse?.outcome === 'has_messages' && chatParse.rows.length === 0 ? (
              <Typography.Text type="secondary">暂无消息</Typography.Text>
            ) : null}
          </div>
        )}
      </Modal>

      <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space wrap align="center">
          <Space size={4} align="center" wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              时间范围
            </Typography.Text>
            <Segmented<ReviewFetchRangeDays>
              size="small"
              value={fetchRangeDays}
              onChange={onFetchRangeChange}
              disabled={fetchLoading}
              options={FETCH_RANGE_OPTIONS}
            />
          </Space>
          <Input.Search
            allowClear
            placeholder="本地筛选：订单号 / 商品ID / 商品名 / 评价内容 / 规格"
            value={search}
            onSearch={setSearch}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: fullLayout ? 420 : 320 }}
          />
          <Space size={4} align="center" wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              举报
            </Typography.Text>
            <Segmented<ReportStatusFilterMode>
              size="small"
              value={reportStatusFilter}
              onChange={setReportStatusFilter}
              options={[
                { label: '全部', value: 'all' },
                { label: '未被举报', value: 'not_reported' },
                { label: '举报成功', value: 'report_success' },
              ]}
            />
          </Space>
          <Button onClick={clearAccumulated}>清空累积数据</Button>
          <Button
            type="primary"
            disabled={!displayRows.length}
            onClick={() => {
              const csv = buildCsv(displayRows);
              downloadTextFile(`reviews-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`, csv, 'text/csv;charset=utf-8');
              message.success('已导出 CSV（Excel 可直接打开）');
            }}
          >
            导出 CSV
          </Button>
          <Button
            icon={<LineChartOutlined />}
            disabled={!displayRows.length}
            onClick={() => setTrendModalOpen(true)}
          >
            分析
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {capture?.capturedAt ? `最近捕获：${new Date(capture.capturedAt).toLocaleString()}` : '尚无捕获'}
          {typeof totalNum === 'number' ? ` · 接口 totalNum：${totalNum}` : ''}
          {typeof reviewNum === 'number' ? ` · reviewNum：${reviewNum}` : ''}
          {typeof showNum === 'number' ? ` · 接口 showNum（可查条数参考）：${showNum}` : ''}
          {capture?.httpStatus != null ? ` · HTTP ${capture.httpStatus}` : ''}
          {fetchStatusText ? ` · ${fetchStatusText}` : ''}
          {rows.length > 0 ? ` · 本地 ${rows.length} 条` : ''}
        </Typography.Text>
      </Space>

      {rows.length > 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.6 }}>
          本地汇总（受搜索 / 差评 / 举报筛选影响）：共 <strong style={{ color: 'inherit' }}>{summary.count}</strong> 条
          {summary.minTime != null && summary.maxTime != null
            ? ` · 时间 ${formatUnixSeconds(summary.minTime)} ～ ${formatUnixSeconds(summary.maxTime)}`
            : ''}
          {summary.withPicPct != null
            ? ` · 有晒图 ${summary.withPicCount} 条（${summary.withPicPct}%）`
            : ''}
        </Typography.Text>
      ) : null}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: embedded ? 'auto' : undefined,
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <Table<ReviewItem>
          size="small"
          rowKey={rowStableKey}
          columns={columns}
          dataSource={displayRows}
          pagination={{
            locale: TABLE_PAGINATION_LOCALE,
            pageSize: tablePageSize,
            showSizeChanger: {
              getPopupContainer: selectGetPopupContainer,
              styles: { popup: { root: { zIndex: 2147483647 } } },
            },
            pageSizeOptions: [...tablePageSizeOptions],
            showTotal: false,
            position: ['bottomCenter'],
            showQuickJumper: true,
            onShowSizeChange: (_current, size) => setTablePageSize(size),
          }}
          scroll={{
            x: compact ? 1180 : 1280,
            ...(!embedded ? { y: compact ? 280 : 420 } : {}),
          }}
        />
      </div>
    </div>
  );
}
