@echo off
chcp 65001 >nul
title Voidcast — build
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not in PATH. Install Node.js LTS.
  pause
  exit /b 1
)

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=installer"

if /i not "%TARGET%"=="web" (
  if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Missing Python venv at: %~dp0.venv\
    echo Create a venv in the repo root and run: pip install -r tts-server\requirements-tools.txt
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo Installing npm dependencies in the workspace root...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

call :install_app_deps
if errorlevel 1 (
  echo [ERROR] npm install failed in electron-app.
  pause
  exit /b 1
)

if /i "%TARGET%"=="installer" goto build_installer
if /i "%TARGET%"=="dir" goto build_dir
if /i "%TARGET%"=="web" goto build_web
goto usage

:build_installer
set "NPM_SCRIPT=build:ci"
goto run_build

:build_dir
set "NPM_SCRIPT=build:dir"
goto run_build

:build_web
set "NPM_SCRIPT=build:web"
goto run_build

:run_build
echo.
echo Running: npm run %NPM_SCRIPT% ^(in electron-app^)
echo Output:  electron-app\release\  ^|  web UI: tts-server\web-ui\
echo.
pushd "electron-app"
call npm run %NPM_SCRIPT%
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
  echo.
  echo [ERROR] Build failed with exit code %RC%.
  pause
  exit /b %RC%
)

echo.
echo [OK] Build finished: %NPM_SCRIPT%
exit /b 0

:usage
echo Usage: build.bat [installer^|dir^|web]
echo.
echo   installer  Full NSIS installer, no publish ^(default^)
echo   dir        Fast unpacked build ^(electron-builder --dir^)
echo   web        Rebuild only the web UI ^(output: tts-server\web-ui^)
echo.
pause
exit /b 1

:install_app_deps
if exist "electron-app\node_modules" exit /b 0
echo Installing npm dependencies in electron-app...
pushd "electron-app"
call npm install
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
