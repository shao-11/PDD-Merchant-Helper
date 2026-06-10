import { useEffect, useRef, useState } from 'react';
import { Button, Flex, Typography } from 'antd';
import {
  clearReportReplyLogs,
  formatLogTime,
  subscribeReportReplyLogs,
  type ReportReplyLogEntry,
  type ReportReplyLogLevel,
} from './debug-log';

const LEVEL_COLOR: Record<ReportReplyLogLevel, string> = {
  info: '#595959',
  warn: '#d48806',
  error: '#cf1322',
};

export function ReportReplyLogView(): JSX.Element {
  const [logs, setLogs] = useState<ReportReplyLogEntry[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeReportReplyLogs(setLogs), []);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div style={{ marginTop: 12 }}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }}>
        <Typography.Text strong>运行日志</Typography.Text>
        <Button size="small" onClick={() => clearReportReplyLogs()} disabled={logs.length === 0}>
          清空日志
        </Button>
      </Flex>
      <div
        ref={boxRef}
        style={{
          maxHeight: 160,
          overflow: 'auto',
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          padding: '8px 10px',
          fontFamily: 'Consolas, Monaco, monospace',
          fontSize: 11,
          lineHeight: 1.45,
        }}
      >
        {logs.length === 0 ? (
          <Typography.Text type="secondary">暂无日志，打开面板或查询后会在此显示</Typography.Text>
        ) : (
          logs.map((row) => (
            <div key={row.id} style={{ marginBottom: 6 }}>
              <span style={{ color: '#8c8c8c' }}>{formatLogTime(row.ts)} </span>
              <span style={{ color: '#1677ff' }}>[{row.from}] </span>
              <span style={{ color: LEVEL_COLOR[row.level] }}>{row.message}</span>
              {row.detail ? (
                <pre
                  style={{
                    margin: '4px 0 0',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    color: '#595959',
                  }}
                >
                  {row.detail}
                </pre>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
