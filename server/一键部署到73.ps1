# 在你自己的电脑上运行（会提示输入 73 的 SSH 密码，输入时不会显示字符）
# 右键 -> 使用 PowerShell 运行，或在 PowerShell 中:
#   cd "...\server"
#   powershell -ExecutionPolicy Bypass -File ".\一键部署到73.ps1"

$ErrorActionPreference = "Stop"
$ServerIp = "192.168.1.75"
$SshUser = "uadmin"
$LocalServerDir = $PSScriptRoot
$RemoteDir = "/home/uadmin/dtx-toolbox-server"

Write-Host "=== 滇同学登录 API 部署到 $ServerIp ===" -ForegroundColor Cyan
Write-Host "将把 server 目录上传到 ${SshUser}@${ServerIp}:${RemoteDir}"
Write-Host "接下来会提示输入 uadmin 的 SSH 密码（输入时屏幕不显示字符，输完按回车）"
Write-Host ""

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "未找到 ssh，请安装 OpenSSH 客户端"
}

ssh -o ConnectTimeout=10 "${SshUser}@${ServerIp}" "mkdir -p '$RemoteDir'"

# 上传文件（不含 node_modules，在服务器上 npm install）
$items = @("index.js", "db-pool.js", "auth-store.js", "package.json", "package-lock.json", "start.bat", "deploy-on-73.sh", ".env.example")
foreach ($name in $items) {
  $p = Join-Path $LocalServerDir $name
  if (Test-Path $p) {
    scp -o ConnectTimeout=10 $p "${SshUser}@${ServerIp}:${RemoteDir}/"
  }
}
if (Test-Path (Join-Path $LocalServerDir ".env")) {
  scp -o ConnectTimeout=10 (Join-Path $LocalServerDir ".env") "${SshUser}@${ServerIp}:${RemoteDir}/"
}
scp -o ConnectTimeout=10 -r (Join-Path $LocalServerDir "sql") "${SshUser}@${ServerIp}:${RemoteDir}/" 2>$null
scp -o ConnectTimeout=10 -r (Join-Path $LocalServerDir "scripts") "${SshUser}@${ServerIp}:${RemoteDir}/" 2>$null

Write-Host ""
Write-Host "正在远程执行 deploy-on-73.sh ..."
ssh "${SshUser}@${ServerIp}" "chmod +x '$RemoteDir/deploy-on-73.sh' && cd '$RemoteDir' && bash deploy-on-73.sh"

Write-Host ""
Write-Host "正在从你这台电脑检测外网访问 ..."
try {
  $r = Invoke-WebRequest -Uri "http://${ServerIp}:8787/api/health" -TimeoutSec 8 -UseBasicParsing
  Write-Host "成功: $($r.Content)" -ForegroundColor Green
} catch {
  Write-Host "外网检测失败: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "若服务器上 deploy 已成功，可能是 75 防火墙仍拦截外网 8787，请在 75 上放行 TCP 8787"
}

Write-Host ""
Write-Host "完成后请让同事重新加载 Chrome 扩展 dist 文件夹。" -ForegroundColor Cyan
