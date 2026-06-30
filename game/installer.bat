@echo off
setlocal enableextensions enabledelayedexpansion
REM =============================================================================
REM   MYS Generals - one-click installer / setup  (Windows)
REM =============================================================================
REM   Just double-click installer.bat
REM
REM   This checks for everything the game needs and installs WHATEVER IS MISSING,
REM   then compiles the project so it is ready to play. Safe to re-run - it only
REM   installs the pieces you don't already have.
REM
REM   What it ensures:
REM     1. Node.js          - REQUIRED to run/host the game   (installed if missing)
REM     2. TypeScript (tsc) - optional, only to rebuild src\  (installed if missing)
REM     3. A fresh build into dist\                           (compiled if tsc is present)
REM
REM   The game itself is dependency-free (no npm packages needed to play), so
REM   Node.js is the only hard requirement.
REM =============================================================================
cd /d "%~dp0"

echo ===================================================
echo    MYS Generals - setup
echo ===================================================
echo.

REM ---- 1) Node.js (required) ----
call :ensure_node
if errorlevel 1 goto :fail_node

REM ---- 2) TypeScript compiler (optional - only needed to rebuild from src\) ----
set "TSC="
where tsc >nul 2>nul && set "TSC=tsc"
if not defined TSC (
  echo [..] Installing the TypeScript compiler...
  call npm install -g typescript >nul 2>nul
  where tsc >nul 2>nul && set "TSC=tsc"
)
if defined TSC (
  echo [OK] TypeScript ready
) else (
  echo [!] TypeScript not available - skipping the optional rebuild.
  echo [!] That's fine: the bundled dist\ already lets you play without building.
)

REM ---- 3) Build (best-effort; the shipped dist\ already works) ----
if defined TSC (
  echo [..] Compiling the game ^(client + server^)...
  set "NODE_OPTIONS="
  call %TSC% -p tsconfig.json
  call %TSC% -p tsconfig.server.json
  echo [OK] Build complete -^> dist\
)

echo.
echo [OK] Setup complete - MYS Generals is ready to play!
echo.
echo   Play single-player / split-screen / vs-AI:
echo       double-click run.bat    ^(then open the printed URL in your browser^)
echo   Host for friends on the same Wi-Fi / LAN:
echo       double-click host.bat
echo.

set "ANS="
set /p "ANS=Start the game now? [y/N] "
if /i "!ANS!"=="y" (
  start "" run.bat
) else (
  echo You can start it any time by double-clicking run.bat
)
pause
exit /b 0

REM ---------------------------------------------------------------------------
:ensure_node
where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%v in ('node --version') do echo [OK] Node.js found %%v
  exit /b 0
)
echo [..] Node.js not found - attempting to install it...

REM Prefer winget (built into modern Windows 10/11).
where winget >nul 2>nul
if not errorlevel 1 (
  echo [..] Installing Node.js LTS via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)
where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%v in ('node --version') do echo [OK] Node.js installed %%v
  exit /b 0
)

REM Fall back to Chocolatey if present.
where choco >nul 2>nul
if not errorlevel 1 (
  echo [..] Installing Node.js LTS via Chocolatey...
  choco install -y nodejs-lts
)
where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%v in ('node --version') do echo [OK] Node.js installed %%v
  exit /b 0
)

exit /b 1

REM ---------------------------------------------------------------------------
:fail_node
echo.
echo [X] Could not install Node.js automatically.
echo     Please install it from https://nodejs.org then run installer.bat again.
echo.
echo     NOTE: if you JUST installed Node, close this window and open a NEW one
echo           (or re-run installer.bat) so Windows picks up the updated PATH.
echo.
pause
exit /b 1
