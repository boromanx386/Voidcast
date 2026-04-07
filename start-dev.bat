@echo off
title OmniVoice Chat - TTS + Electron
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo npm nije u PATH. Instaliraj Node.js ili dodaj ga u PATH.
  pause
  exit /b 1
)

echo Oslobadjanje portova 8765 ^(TTS^), 5173/5174 ^(Vite^) ako su zauzeti...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = 8765, 5173, 5174; foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

echo.
echo Pokretanje: TTS ^(8765^) + Electron...
echo Zaustavi: Ctrl+C
echo.

npm run dev

if errorlevel 1 pause
