export const MSG_KEEP_ALIVE_TRIGGER_NOW = 'DTX_KEEP_ALIVE_TRIGGER_NOW';

export type KeepAliveLastResult = {
  at: number;
  ok: boolean;
  message: string;
  tabId?: number;
};
