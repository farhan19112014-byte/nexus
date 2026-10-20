@echo off
rem ============================================================
rem  NEXUS - double-click to start.  Opens NEXUS in your browser.
rem  First run installs and builds (needs internet, ~2-5 minutes).
rem  Close this window (or press Ctrl+C) to stop NEXUS.
rem ============================================================
setlocal
title NEXUS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  NEXUS needs Node.js ^(free^). Opening the download page...
  echo  Install the "LTS" version, then double-click start-nexus.bat again.
  start "" https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)
node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo  Your Node.js is too old ^(NEXUS needs version 20 or newer^). Opening the download page...
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo  [1/2] Installing NEXUS ^(first run only^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
)
if not exist "dist\index.html" goto :build
if not exist "dist-server\index.js" goto :build
goto :run

:build
echo  [2/2] Building NEXUS...
call npm run build
if errorlevel 1 goto :failed

:run
echo.
echo  Starting NEXUS - your browser will open. Keep this window open while you use it.
echo.
node dist-server\index.js --serve-dist --open
echo.
echo  NEXUS stopped.
pause
exit /b 0

:failed
echo.
echo  Something went wrong above. Check your internet connection and try again.
echo  Help: docs\LAPTOP.md
pause
exit /b 1
