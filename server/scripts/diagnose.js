import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import pg from 'pg';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const mode = String(process.env.DB_MODE || 'postgres').toLowerCase();
const host = process.env.DB_HOST || '127.0.0.1';
const defaultPort = mode === 'postgres' ? 5432 : mode === 'mysql' ? 3306 : 0;
const port = Number(process.env.DB_PORT) || defaultPort;
const user = process.env.DB_USER || 'dtx';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'dtx';

function probeTcp(targetHost, targetPort, ms = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: targetHost, port: targetPort, timeout: ms }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

console.log('--- 滇同学插件 · 登录服务诊断 ---');
console.log(`DB_MODE=${mode} DB_HOST=${host} DB_PORT=${port}`);

if (mode === 'local') {
  console.log('[OK] 本机 JSON 模式，无需连远程数据库');
  process.exit(0);
}

const tcpOk = await probeTcp(host, port);
const dbName = mode === 'postgres' ? 'PostgreSQL' : 'MySQL';
console.log(
  tcpOk
    ? `[OK] ${host}:${port} 端口可连通`
    : `[失败] ${host}:${port} 无法连接（${dbName} 未启动、未开远程或防火墙拦截）`
);

if (!tcpOk) {
  console.log('\n建议：');
  if (mode === 'postgres') {
    console.log('1. 确认 PostgreSQL 已启动，防火墙放行 5432');
    console.log('2. pg_hba.conf 允许内网 IP 使用 dtx 用户连接');
  } else {
    console.log('1. 确认 MySQL 已启动，防火墙放行 3306');
    console.log('2. bind-address 与 GRANT 允许 dtx 远程登录');
  }
  console.log('3. server/.env 中 DB_MODE、DB_PORT 需与数据库类型一致');
  process.exit(1);
}

try {
  if (mode === 'postgres') {
    const client = new pg.Client({ host, port, user, password, database, connectionTimeoutMillis: 10_000 });
    await client.connect();
    const r = await client.query('SELECT username FROM userchajian WHERE username = $1 LIMIT 1', ['admin']);
    await client.end();
    console.log('[OK] PostgreSQL 登录成功，userchajian 表可读');
    console.log(r.rows?.length ? '[OK] 已存在账号 admin' : '[提示] 尚无 admin，请执行 npm run init-db');
  } else {
    const conn = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10_000 });
    const [rows] = await conn.query('SELECT username FROM userchajian WHERE username = ? LIMIT 1', ['admin']);
    await conn.end();
    console.log('[OK] MySQL 登录成功，userchajian 表可读');
    console.log(rows?.length ? '[OK] 已存在账号 admin' : '[提示] 尚无 admin，请执行 npm run init-db');
  }
} catch (e) {
  console.error(`[失败] ${dbName} 连接或查表错误:`, e.message);
  process.exit(1);
}
