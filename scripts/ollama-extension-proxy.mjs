/**
 * 供 Chrome 扩展访问的 Ollama 转发（Node 请求不带 chrome-extension Origin，避免 403）
 * 监听 11435 → 转发到本机 Ollama 11434
 */
import http from 'node:http';

/** 同时监听 127.0.0.1 与 ::1，避免扩展走 localhost 时连不上 */
const LISTEN_HOST = '0.0.0.0';
const LISTEN_PORT = 11435;
const UPSTREAM = 'http://127.0.0.1:11434';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const targetUrl = `${UPSTREAM}${req.url ?? '/'}`;
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] ?? 'application/json',
      },
      body,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `转发失败: ${msg}（请先启动 ollama serve）` }));
  }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[滇同学] Ollama 扩展代理已启动`);
  console.log(`  → http://127.0.0.1:${LISTEN_PORT}`);
  console.log(`  → http://localhost:${LISTEN_PORT}`);
  console.log(`  转发至 ${UPSTREAM}`);
  console.log('  请勿关闭本窗口');
});
