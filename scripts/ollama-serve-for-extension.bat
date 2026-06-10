@echo off
chcp 65001 >nul
echo [PDD Merchant Helper] Start Ollama with Chrome extension CORS access...
echo If Ollama tray app exists, exit it first by right-clicking, then run this script.
echo.
set OLLAMA_ORIGINS=*
set OLLAMA_HOST=127.0.0.1:11434
ollama serve
