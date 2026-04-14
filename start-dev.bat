@echo off
chcp 65001 >nul
title Voidcast — TTS + Electron
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [GRESKA] npm nije u PATH. Instaliraj Node.js LTS.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [GRESKA] Nema Python venv na: %~dp0.venv\
  echo Napravi venv u korenu repoa i: pip install -r tts-server\requirements.txt
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instaliram npm zavisnosti u korenu workspace-a...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Oslobadjanje portova ako su zauzeti: 8765 ^(TTS^), 5173–5174 ^(Vite^)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = 8765, 5173, 5174; foreach ($p in $ports) { Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue ^| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

echo.
echo Pokretanje: TTS ^(0.0.0.0:8765^) + Electron / Vite
echo Zaustavi: Ctrl+C
echo.

call npm run dev

if errorlevel 1 pause
