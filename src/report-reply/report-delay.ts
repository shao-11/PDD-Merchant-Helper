import {
  LIST_FETCH_INTERVAL_MS_MAX,
  LIST_FETCH_INTERVAL_MS_MIN,
  REPORT_INTERVAL_MS_MAX,
  REPORT_INTERVAL_MS_MIN,
} from './constants';

export function randomReportIntervalMs(): number {
  const span = REPORT_INTERVAL_MS_MAX - REPORT_INTERVAL_MS_MIN;
  return REPORT_INTERVAL_MS_MIN + Math.floor(Math.random() * (span + 1));
}

export function randomListFetchIntervalMs(): number {
  const span = LIST_FETCH_INTERVAL_MS_MAX - LIST_FETCH_INTERVAL_MS_MIN;
  return LIST_FETCH_INTERVAL_MS_MIN + Math.floor(Math.random() * (span + 1));
}
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
