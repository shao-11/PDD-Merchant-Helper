export type FetchLogLevel = 'ok' | 'warn' | 'error' | 'info';

export type FetchStepLog = {
  step: string;
  level: FetchLogLevel;
  message: string;
  detail?: string;
  at: number;
};

export function createFetchLogger(): {
  logs: FetchStepLog[];
  log: (step: string, level: FetchLogLevel, message: string, detail?: string) => void;
} {
  const logs: FetchStepLog[] = [];
  return {
    logs,
    log(step, level, message, detail) {
      logs.push({ step, level, message, detail, at: Date.now() });
    },
  };
}
