import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_USERS_PATH = join(__dirname, 'data', 'userchajian.json');

/** @typedef {{ username: string, password: string }[]} UserRow */

export function readLocalUsers() {
  if (!fs.existsSync(LOCAL_USERS_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(LOCAL_USERS_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeLocalUsers(users) {
  const dir = dirname(LOCAL_USERS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
}

export function verifyLocalLogin(username, password) {
  const list = readLocalUsers();
  const hit = list.find(
    (u) => String(u.username ?? '').trim() === username && String(u.password ?? '') === password
  );
  return hit ? String(hit.username).trim() : null;
}

export async function verifyPostgresLogin(pool, username, password) {
  const result = await pool.query(
    'SELECT username FROM userchajian WHERE username = $1 AND password = $2 LIMIT 1',
    [username, password]
  );
  const list = result.rows ?? [];
  if (list.length === 0) return null;
  return String(list[0].username ?? username).trim();
}

export async function verifyMysqlLogin(pool, username, password) {
  const [rows] = await pool.query(
    'SELECT username FROM userchajian WHERE username = ? AND password = ? LIMIT 1',
    [username, password]
  );
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  return String(list[0].username ?? username).trim();
}
