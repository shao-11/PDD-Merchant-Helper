import dotenv from 'dotenv';
import pg from 'pg';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env') });

const c = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
await c.connect();

const t = await c.query(
  "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='userchajian'"
);
console.log('表 userchajian 存在:', t.rows.length > 0);

const u = await c.query('SELECT id, username, password, created_at FROM userchajian ORDER BY id');
console.log('记录数:', u.rows.length);
for (const row of u.rows) {
  console.log(`  - id=${row.id} username=${row.username} password=${row.password}`);
}

await c.end();
