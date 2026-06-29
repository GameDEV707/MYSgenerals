@echo off
REM MYS Generals - launcher for Windows. Requires Node.js (https://nodejs.org).
REM Usage: run.bat [port]   (default port 8000)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo Starting MYS Generals... open the URL below in your browser.
node serve.mjs %1
pause
