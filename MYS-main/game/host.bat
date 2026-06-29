@echo off
REM MYS Generals - HOST a LAN multiplayer game (Windows). Requires Node.js (https://nodejs.org).
REM Usage: host.bat [port]   (default port 3000)
REM Other players on the SAME Wi-Fi open the LAN link / scan the QR shown below to join.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo ============================================================
echo  MYS Generals - hosting a LAN game
echo  - Keep every device on the SAME Wi-Fi / network.
echo  - On first run, click "Allow access" if Windows Firewall
echo    asks (tick Private networks).
echo  - Share the LAN link / QR printed below. Other devices
echo    open it in a browser to join - use the LAN address,
echo    NOT localhost.
echo ============================================================
node launch.mjs %1
pause
