import mysql from 'mysql2/promise';
import pg from 'pg';

const { Pool: PgPool } = pg;

/** @param {import('dotenv').DotenvConfigOutput['parsed']} env */
export function createDbPool(env = process.env) {
  const mode = String(env.DB_MODE || 'postgres').toLowerCase();
  const host = env.DB_HOST || '127.0.0.1';
  const user = env.DB_USER || 'dtx';
  const password = env.DB_PASSWORD || '';
  const database = env.DB_NAME || 'dtx';

  if (mode === 'postgres') {
    const port = Number(env.DB_PORT) || 5432;
    return {
      mode: 'postgres',
      pool: new PgPool({
        host,
        port,
        user,
        password,
        database,
        max: 10,
        connectionTimeoutMillis: 8_000,
        idleTimeoutMillis: 30_000,
      }),
    };
  }

  if (mode === 'mysql') {
    const port = Number(env.DB_PORT) || 3306;
    return {
      mode: 'mysql',
      pool: mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: 8_000,
      }),
    };
  }

  return { mode: 'local', pool: null };
}

export async function pingDb(pool, mode) {
  if (mode === 'postgres') {
    await pool.query('SELECT 1');
    return;
  }
  if (mode === 'mysql') {
    await pool.query('SELECT 1');
  }
}

export async function closeDb(pool, mode) {
  if (!pool) return;
  if (mode === 'postgres') {
    await pool.end();
    return;
  }
  if (mode === 'mysql') {
    await pool.end();
  }
}
