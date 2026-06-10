import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  verifyLocalLogin,
  verifyMysqlLogin,
  verifyPostgresLogin,
} from './auth-store.js';
import { closeDb, createDbPool, pingDb } from './db-pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const API_PORT = Number(process.env.API_PORT) || 8787;
const { mode: DB_MODE, pool } = createDbPool(process.env);

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

function dbModeLabel() {
  if (DB_MODE === 'local') return '本机 JSON 账号';
  if (DB_MODE === 'postgres') {
    return `PostgreSQL ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}`;
  }
  return `MySQL ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}`;
}

app.get('/api/health', async (_req, res) => {
  if (DB_MODE === 'local') {
    res.json({ ok: true, mode: 'local' });
    return;
  }
  try {
    if (!pool) throw new Error('数据库未配置');
    await pingDb(pool, DB_MODE);
    res.json({ ok: true, mode: DB_MODE });
  } catch (e) {
    res.status(503).json({ ok: false, mode: DB_MODE, message: String(e?.message || e) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!username || !password) {
    res.status(400).json({ ok: false, message: '请输入账号和密码' });
    return;
  }

  try {
    let verified = null;
    if (DB_MODE === 'local') {
      verified = verifyLocalLogin(username, password);
    } else if (DB_MODE === 'postgres') {
      if (!pool) throw new Error('PostgreSQL 未配置');
      verified = await verifyPostgresLogin(pool, username, password);
    } else if (DB_MODE === 'mysql') {
      if (!pool) throw new Error('MySQL 未配置');
      verified = await verifyMysqlLogin(pool, username, password);
    } else {
      throw new Error(`不支持的 DB_MODE: ${DB_MODE}`);
    }

    if (!verified) {
      res.status(401).json({ ok: false, message: '账号或密码错误' });
      return;
    }
    res.json({ ok: true, username: verified });
  } catch (e) {
    console.error('[auth-api] login error', e);
    res.status(500).json({ ok: false, message: '数据库连接或查询失败' });
  }
});

const server = app.listen(API_PORT, '0.0.0.0', () => {
  console.log(`[auth-api] http://127.0.0.1:${API_PORT}  mode=${DB_MODE} (${dbModeLabel()})`);
  console.log('[auth-api] POST /api/auth/login');
});

async function shutdown() {
  server.close();
  await closeDb(pool, DB_MODE);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
