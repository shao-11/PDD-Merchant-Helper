@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PDD Merchant Helper - AI Analysis

echo ========================================
echo   PDD Merchant Helper - AI Analysis Environment
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node first.
  pause
  exit /b 1
)

where ollama >nul 2>&1
if errorlevel 1 (
  echo [WARN] Ollama command not found. Please ensure Ollama is installed.
)

echo [1/3] Starting extension proxy 11435 -> 11434 to avoid HTTP 403...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":11435" ^| findstr LISTENING') do (
  echo       Port 11435 is already used by PID=%%p, skipping.
  goto proxy_done
)
start "PDD Helper - Ollama Proxy" /MIN cmd /k "cd /d "%~dp0" && node ollama-extension-proxy.mjs"
timeout /t 3 /nobreak >nul
:proxy_done

echo [2/3] Checking if 11435 is available...
powershell -NoProfile -Command "try { =Invoke-WebRequest -Uri 'http://127.0.0.1:11435/api/tags' -UseBasicParsing -TimeoutSec 5; if(.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
if errorlevel 1 (
  echo [FAIL] 11435 proxy not responding. Check the window titled 'PDD Helper - Ollama Proxy' for errors.
) else (
  echo [OK] 11435 proxy is running, AI is ready for the extension.
)

echo [3/3] If system tray has no Ollama, will try to start ollama serve...
echo       If Ollama is already running, skip this step.
set OLLAMA_ORIGINS=*
set OLLAMA_HOST=127.0.0.1:11434
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":11434" ^| findstr LISTENING') do goto ollama_ok
start "PDD Helper - Ollama" /MIN cmd /k "set OLLAMA_ORIGINS=*&& set OLLAMA_HOST=127.0.0.1:11434&& ollama serve"
:ollama_ok

echo.
echo After done: Reload Chrome extension -> Click 'Re-analyze' on appeal page.
echo Model: ollama pull qwen2.5:3b
echo.
pause
