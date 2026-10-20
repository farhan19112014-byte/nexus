@echo off
rem Rebuilds NEXUS after you change or update its files, then starts it.
setlocal
cd /d "%~dp0"
call npm install --no-audit --no-fund || goto :failed
call npm run build || goto :failed
call "%~dp0start-nexus.bat"
exit /b 0
:failed
echo  Rebuild failed - see the messages above.
pause
exit /b 1
