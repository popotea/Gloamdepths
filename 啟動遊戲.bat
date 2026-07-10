@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js not found. Please install it from https://nodejs.org
  pause
  exit /b 1
)

REM If a server is already running (e.g. window wasn't closed last time), just open the browser
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo [i] Server already running, opening browser...
  start http://localhost:8000
  echo.
  echo You can close this window now, the game is in your browser tab.
  pause
  exit /b 0
)

REM Wait 1 second then open the browser, giving the server time to start
start "" cmd /c "ping -n 2 127.0.0.1 >nul & start http://localhost:8000"

node serve.js

REM If node stopped for any reason, stay open so any error message is visible
echo.
echo ===== Server stopped. If there is an error message above, please screenshot it =====
pause
