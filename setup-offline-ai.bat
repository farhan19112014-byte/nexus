@echo off
rem ============================================================
rem  Free offline AI for NEXUS (Ollama). Double-click to set up.
rem  Optional model name:  setup-offline-ai.bat qwen2.5:7b
rem ============================================================
setlocal
title NEXUS - offline AI setup
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is needed first - run start-nexus.bat once.
  pause
  exit /b 1
)
node scripts\setup-ollama.mjs %1
echo.
pause
