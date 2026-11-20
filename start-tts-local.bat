@echo off
chcp 65001 >nul
title Voidcast — samo TTS server
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [GRESKA] Nema .venv\Scripts\python.exe
  pause
  exit /b 1
)

echo Oslobadjanje porta 8765 ako je zauzet...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue ^| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo TTS server: http://127.0.0.1:8765
echo Zaustavi: Ctrl+C
echo.

".venv\Scripts\python.exe" -m uvicorn tts_main:app --host 127.0.0.1 --port 8765 --app-dir "%~dp0tts-server"

if errorlevel 1 pause
