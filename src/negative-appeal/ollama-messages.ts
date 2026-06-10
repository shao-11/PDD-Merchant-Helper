import type { FetchStepLog } from './fetch-log';

/** 经 background 代理请求 AI（百炼云端 / 本机 Ollama） */
export const MSG_NA_OLLAMA_CHAT = 'NA_OLLAMA_CHAT';
export const MSG_NA_OLLAMA_DIAGNOSE = 'NA_OLLAMA_DIAGNOSE';

export type OllamaDiagLog = FetchStepLog;

export type NaOllamaChatRequest = {
  model: string;
  stream: false;
  messages: { role: string; content: string }[];
};

export type NaOllamaChatResponse = {
  choices?: { message?: { content?: string } }[];
  message?: { content?: string };
  error?: { message?: string; code?: string };
};

export type NaOllamaChatResult =
  | { ok: true; data: NaOllamaChatResponse; logs: OllamaDiagLog[] }
  | { ok: false; error: string; logs: OllamaDiagLog[] };

export type NaOllamaDiagnoseResult = {
  ok: boolean;
  logs: OllamaDiagLog[];
  summary: string;
  provider?: 'bailian' | 'none';
};
