export const REPORT_REPLY_LOG_SOURCE = 'PDD_REPORT_REPLY_LOG';

export type ReportReplyLogFrom = 'panel' | 'rpc' | 'inject' | 'overlay' | 'reply-ai' | 'auto-reply';

export type ReportReplyLogLevel = 'info' | 'warn' | 'error';

export type ReportReplyLogEntry = {
  id: string;
  ts: number;
  from: ReportReplyLogFrom;
  level: ReportReplyLogLevel;
  message: string;
  detail?: string;
};

const MAX_LOGS = 200;

function formatDetail(detail: unknown): string | undefined {
  if (detail == null || detail === '') return undefined;
  try {
    const s = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 0);
    return s.length > 2400 ? `${s.slice(0, 2400)}…` : s;
  } catch {
    return String(detail);
  }
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 任意世界调用：通过 postMessage 广播到面板 */
export function rrLog(
  from: ReportReplyLogFrom,
  level: ReportReplyLogLevel,
  message: string,
  detail?: unknown
): void {
  const entry: ReportReplyLogEntry = {
    id: newId(),
    ts: Date.now(),
    from,
    level,
    message,
    detail: formatDetail(detail),
  };
  try {
    window.postMessage({ source: REPORT_REPLY_LOG_SOURCE, entry }, '*');
  } catch {
    /* ignore */
  }
  const tag = `[一键举报][${from}]`;
  const line = detail != null ? `${message} ${formatDetail(detail) ?? ''}` : message;
  if (level === 'error') console.error(tag, line);
  else if (level === 'warn') console.warn(tag, line);
  else console.info(tag, line);
}

export function clearReportReplyLogs(): void {
  try {
    window.postMessage({ source: REPORT_REPLY_LOG_SOURCE, action: 'clear' as const }, '*');
  } catch {
    /* ignore */
  }
}

export function subscribeReportReplyLogs(
  onChange: (entries: ReportReplyLogEntry[]) => void
): () => void {
  const buffer: ReportReplyLogEntry[] = [];

  const flush = (): void => {
    onChange([...buffer]);
  };

  const onMsg = (e: MessageEvent): void => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as {
      source?: string;
      entry?: ReportReplyLogEntry;
      action?: 'clear';
    };
    if (d?.source !== REPORT_REPLY_LOG_SOURCE) return;

    if (d.action === 'clear') {
      buffer.length = 0;
      flush();
      return;
    }

    const entry = d.entry;
    if (!entry?.id) return;
    if (buffer.some((x) => x.id === entry.id)) return;
    buffer.push(entry);
    if (buffer.length > MAX_LOGS) {
      buffer.splice(0, buffer.length - MAX_LOGS);
    }
    flush();
  };

  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}

export function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}
