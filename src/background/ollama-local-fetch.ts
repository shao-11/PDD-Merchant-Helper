/** Chrome 123+ 访问本机地址需 targetAddressSpace: 'local'，否则可能 Failed to fetch */
export type LocalRequestInit = RequestInit & {
  targetAddressSpace?: 'local' | 'private' | 'loopback';
};

export function localFetch(url: string, init?: RequestInit): Promise<Response> {
  const req: LocalRequestInit = {
    ...init,
    targetAddressSpace: 'local',
  };
  return fetch(url, req);
}

export const OLLAMA_PROXY_BASES = ['http://127.0.0.1:11435', 'http://localhost:11435'] as const;

export const OLLAMA_DIRECT_BASE = 'http://127.0.0.1:11434';
