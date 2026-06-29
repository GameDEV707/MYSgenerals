@echo off
REM MYS Generals - build for Windows. Building is OPTIONAL: the compiled dist\ is
REM already included, so you can just run run.bat. Use this only after editing src\.
cd /d "%~dp0"
where tsc >nul 2>nul
if errorlevel 1 (
  echo TypeScript compiler "tsc" not found.
  echo Install it once with:  npm install -g typescript
  echo (Building is optional - dist\ ships precompiled, just run run.bat to play.^)
  pause
  exit /b 1
)
tsc -p tsconfig.json
echo Build complete -^> dist\
pause
