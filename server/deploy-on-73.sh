#!/bin/bash
# 在 192.168.1.75 上执行：bash deploy-on-73.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未安装 Node.js"
  exit 1
fi

if [ ! -f .env ]; then
  cat > .env <<'EOF'
DB_MODE=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=dtx
DB_PASSWORD=Dtx654321@
DB_NAME=dtx
API_PORT=8787
EOF
  echo "[ok] 已创建 .env"
fi

echo "[1/3] npm install ..."
npm install --omit=dev

echo "[2/3] 放行防火墙 8787 ..."
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 8787/tcp 2>/dev/null || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port=8787/tcp 2>/dev/null || true
  sudo firewall-cmd --reload 2>/dev/null || true
fi

echo "[3/3] 启动登录 API ..."
if systemctl is-enabled dtx-auth-api >/dev/null 2>&1; then
  sudo systemctl restart dtx-auth-api
  sleep 2
elif [ -f auth-api.pid ] && kill -0 "$(cat auth-api.pid)" 2>/dev/null; then
  kill "$(cat auth-api.pid)" || true
  sleep 1
  nohup node index.js >> auth-api.log 2>&1 &
  echo $! > auth-api.pid
  sleep 2
else
  nohup node index.js >> auth-api.log 2>&1 &
  echo $! > auth-api.pid
  sleep 2
fi

if curl -sf "http://127.0.0.1:8787/api/health" >/dev/null; then
  echo "[完成] 登录 API 已运行: http://192.168.1.75:8787"
  curl -s "http://127.0.0.1:8787/api/health"
  echo ""
  if systemctl is-enabled dtx-auth-api >/dev/null 2>&1; then
    echo "[提示] 已配置开机自启: systemctl status dtx-auth-api"
  else
    echo "[提示] 未配置 systemd，可运行: node install-systemd-on-73.mjs"
  fi
else
  echo "[失败] 本机 health 未通过"
  if systemctl is-active dtx-auth-api >/dev/null 2>&1; then
    sudo journalctl -u dtx-auth-api -n 30 --no-pager
  elif [ -f auth-api.log ]; then
    tail -n 50 auth-api.log
  fi
  exit 1
fi
