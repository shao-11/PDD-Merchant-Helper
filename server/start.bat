@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\" (
  echo [auth-api] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 exit /b 1
)
echo [auth-api] 启动登录 API，监听 0.0.0.0:8787 ...
node index.js
pause
