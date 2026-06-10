import dotenv from 'dotenv';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
dotenv.config({ path: join(root, '.env') });

const mode = String(process.env.DB_MODE || 'postgres').toLowerCase();
const host = process.env.DB_HOST || '127.0.0.1';
const user = process.env.DB_USER || 'dtx';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'dtx';

if (mode === 'postgres') {
  const port = Number(process.env.DB_PORT) || 5432;
  const sqlPath = join(root, 'sql', 'init-userchajian-pg.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ host, port, user, password, database, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    await client.query(sql);
    console.log('[init-db] PostgreSQL锛氬凡鍒涘缓/鏇存柊琛?userchajian锛屽苟鍐欏叆 admin / <YOUR_PASSWORD> (set it in your .env)');
  } finally {
    await client.end();
  }
} else if (mode === 'mysql') {
  const port = Number(process.env.DB_PORT) || 3306;
  const sqlPath = join(root, 'sql', 'init-userchajian.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    connectTimeout: 15_000,
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    console.log('[init-db] MySQL锛氬凡鍒涘缓/鏇存柊琛?userchajian锛屽苟鍐欏叆 admin / <YOUR_PASSWORD> (set it in your .env)');
  } finally {
    await conn.end();
  }
} else {
  console.error('[init-db] DB_MODE=local 鏃犻渶鍒濆鍖栨暟鎹簱锛岃浣跨敤 npm run init-local');
  process.exit(1);
}
