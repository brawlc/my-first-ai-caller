@echo off
setlocal
cd /d "%~dp0"

echo Starting DPvision AI (Gemini only) on http://localhost:3001/live

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

set PORT=3001

echo Building latest frontend bundle...
call npm run build
if errorlevel 1 (
  echo Build failed. Trying to continue with last successful build...
  if not exist dist\index.html (
    echo No existing build found in dist. Fix build errors and run again.
    pause
    exit /b 1
  )
  echo Using existing dist build.
)

start "" powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url='http://localhost:3001/api/health'; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if($r.StatusCode -eq 200){ Start-Process 'http://localhost:3001/live'; break } } catch {}; Start-Sleep -Milliseconds 500 }"

echo Server starting... keep this window open.
node server.mjs

echo Server stopped.
pause
