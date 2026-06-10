/**
 * 在 192.168.1.75 上安装 systemd 服务，实现开机自启登录 API
 * 用法：node install-systemd-on-73.mjs
 */
import { Client } from 'ssh2';

const HOST = '192.168.1.75';
const USER = 'uadmin';
const PASS = 'yuncang.ME8';
const REMOTE = '/home/uadmin/dtx-toolbox-server';
const SERVICE = 'dtx-auth-api';

function exec(conn, cmd, allowFail = false) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream
        .on('close', (code) => {
          const text = (out + errOut).trim();
          if (code === 0 || allowFail) resolve(text);
          else reject(new Error(`exit ${code}: ${text}`));
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

const unit = `[Unit]
Description=Dian Tong Xue Toolbox Auth API (port 8787)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=uadmin
Group=uadmin
WorkingDirectory=${REMOTE}
ExecStart=/usr/bin/env node index.js
Restart=on-failure
RestartSec=8
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      console.log('[ssh] connected, installing systemd service...\n');
      const nodePath = (await exec(conn, 'command -v node || which node')).trim() || '/usr/bin/node';
      console.log('[info] node:', nodePath);

      const unitFinal = unit.replace('/usr/bin/env node', nodePath);
      const b64 = Buffer.from(unitFinal, 'utf8').toString('base64');

      await exec(
        conn,
        `echo '${PASS.replace(/'/g, "'\\''")}' | sudo -S bash -c '
set -e
echo ${b64} | base64 -d > /etc/systemd/system/${SERVICE}.service
systemctl daemon-reload
systemctl enable ${SERVICE}
# 若 nohup 旧进程仍在，先停掉再交给 systemd
if [ -f ${REMOTE}/auth-api.pid ]; then
  old=$(cat ${REMOTE}/auth-api.pid 2>/dev/null || true)
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then kill "$old" || true; fi
  rm -f ${REMOTE}/auth-api.pid
fi
systemctl restart ${SERVICE}
sleep 2
systemctl is-active ${SERVICE}
curl -sf http://127.0.0.1:8787/api/health && echo ""
'`,
      );

      console.log('\n[done] 已启用开机自启: systemctl status', SERVICE);
      conn.end();
      process.exit(0);
    } catch (e) {
      console.error('\n[fail]', e.message);
      conn.end();
      process.exit(1);
    }
  })
  .on('error', (e) => {
    console.error('[ssh error]', e.message);
    process.exit(1);
  })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
