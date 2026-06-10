import { Client } from 'ssh2';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = '192.168.1.75';
const USER = 'uadmin';
const PASS = 'yuncang.ME8';
const REMOTE = '/home/uadmin/dtx-toolbox-server';

const UPLOAD_NAMES = [
  'index.js',
  'db-pool.js',
  'auth-store.js',
  'package.json',
  'package-lock.json',
  'deploy-on-73.sh',
  '.env',
];

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream
        .on('close', (code) => {
          if (code === 0) resolve(out);
          else reject(new Error(`exit ${code}: ${errOut || out}`));
        })
        .on('data', (d) => {
          out += d.toString();
          process.stdout.write(d);
        })
        .stderr.on('data', (d) => {
          errOut += d.toString();
          process.stderr.write(d);
        });
    });
  });
}

function sftpMkdir(sftp, dir) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dir, (err) => {
      if (err && err.code !== 4) return reject(err);
      resolve();
    });
  });
}

function sftpPut(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

async function uploadDir(sftp, localDir, remoteDir) {
  await sftpMkdir(sftp, remoteDir);
  for (const name of readdirSync(localDir)) {
    const local = join(localDir, name);
    const remote = posix.join(remoteDir, name);
    if (statSync(local).isDirectory()) {
      await uploadDir(sftp, local, remote);
    } else {
      await sftpPut(sftp, local, remote);
      console.log('uploaded', remote);
    }
  }
}

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      console.log('[ssh] connected');
      await exec(conn, `mkdir -p '${REMOTE}'`);
      const sftp = await new Promise((resolve, reject) => {
        conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
      });
      for (const name of UPLOAD_NAMES) {
        const local = join(__dirname, name);
        try {
          statSync(local);
        } catch {
          continue;
        }
        await sftpPut(sftp, local, posix.join(REMOTE, name));
        console.log('uploaded', name);
      }
      for (const sub of ['sql', 'scripts']) {
        const local = join(__dirname, sub);
        try {
          if (statSync(local).isDirectory()) await uploadDir(sftp, local, posix.join(REMOTE, sub));
        } catch {
          /* optional */
        }
      }
      sftp.end();
      await exec(
        conn,
        `cd '${REMOTE}' && sed -i 's/\\r$//' deploy-on-73.sh 2>/dev/null || sed -i '' 's/\\r$//' deploy-on-73.sh 2>/dev/null || true; chmod +x deploy-on-73.sh && bash deploy-on-73.sh`,
      );
      console.log('[done] deploy finished');
      conn.end();
      process.exit(0);
    } catch (e) {
      console.error('[fail]', e.message);
      conn.end();
      process.exit(1);
    }
  })
  .on('error', (e) => {
    console.error('[ssh error]', e.message);
    process.exit(1);
  })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
