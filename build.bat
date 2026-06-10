@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NPM_CMD=npm"
where npm >nul 2>&1
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\npm.cmd" (
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
  ) else (
    echo [ERROR] npm not found. Please install Node.js LTS.
    echo Download: https://nodejs.org/
    exit /b 1
  )
)

call "%NPM_CMD%" install
if errorlevel 1 exit /b 1

call "%NPM_CMD%" run build
if errorlevel 1 exit /b 1

echo.
echo [Done] Load in Chrome: Extensions -> Developer Mode -> Load unpacked -> Select this dist folder.
exit /b 0
