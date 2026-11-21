@echo off
chcp 65001 >nul
title Voidcast - local TTS server
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Missing .venv\Scripts\python.exe
  pause
  exit /b 1
)

rem The server refuses every call without the desktop token Electron sends. A standalone
rem server can't see Electron's per-run token, so both read one persistent user variable.
if "%VOIDCAST_DESKTOP_TOKEN%"=="" (
  for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('VOIDCAST_DESKTOP_TOKEN','User')"`) do set "VOIDCAST_DESKTOP_TOKEN=%%T"
)
if not "%VOIDCAST_DESKTOP_TOKEN%"=="" goto :have_token
rem Kept outside a ( ) block: cmd expands %VAR% there before the token is generated.
for /f "usebackq delims=" %%T in (`call ".venv\Scripts\python.exe" -c "import secrets; print(secrets.token_urlsafe(32))"`) do set "VOIDCAST_DESKTOP_TOKEN=%%T"
if "%VOIDCAST_DESKTOP_TOKEN%"=="" (
  echo [ERROR] Could not generate VOIDCAST_DESKTOP_TOKEN
  pause
  exit /b 1
)
setx VOIDCAST_DESKTOP_TOKEN "%VOIDCAST_DESKTOP_TOKEN%" >nul
echo Created a persistent VOIDCAST_DESKTOP_TOKEN user variable.
echo If Voidcast is already running, restart it so it picks up the token.
echo.
:have_token

echo Freeing port 8765 if it is in use...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue ^| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo TTS server: http://127.0.0.1:8765
echo Stop: Ctrl+C
echo.

".venv\Scripts\python.exe" -m uvicorn tts_main:app --host 127.0.0.1 --port 8765 --app-dir "%~dp0tts-server"

if errorlevel 1 pause
