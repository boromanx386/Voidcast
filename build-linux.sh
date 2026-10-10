#!/usr/bin/env bash
# Voidcast — Linux build script (AppImage + .deb), from source.
#
# Steps:
#   1) Python venv + tools-server dependencies
#   2) Build the LAN web UI (electron-app -> web-ui/)
#   3) PyInstaller: freeze the tools server into a Linux one-file binary
#      (tts-server/dist/voidcast-tools-server)  -- the Linux twin of build-tools-exe.ps1
#   4) tsc + vite build + electron-builder --linux
#
# Output: electron-app/release/<version>/
#
# Usage:
#   ./build-linux.sh                 # AppImage + deb
#   ./build-linux.sh --dir           # unpacked dir only (fast, for testing)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
PY="$VENV/bin/python"
TTS="$ROOT/tts-server"
APP="$ROOT/electron-app"
EXTRA_ARGS="${1:-}"

c_info=$'\033[36m'; c_err=$'\033[31m'; c_off=$'\033[0m'
step() { echo "${c_info}[build-linux]${c_off} $*"; }
die()  { echo "${c_err}[build-linux]${c_off} $*" >&2; exit 1; }

command -v node    >/dev/null 2>&1 || die "Node.js nije instaliran."
command -v python3 >/dev/null 2>&1 || die "python3 nije instaliran."
[ -f "$TTS/tools_exe_entry.py" ] || die "Nema $TTS/tools_exe_entry.py"
[ -d "$TTS/fonts" ]              || die "Nema $TTS/fonts (NotoSans-Regular.ttf + NotoSans-Bold.ttf)"
[ -f "$ROOT/logo_app_nobg.png" ] || die "Nema logo_app_nobg.png u korenu (treba za ikonu)."

# ---------------------------------------------------------------- 1) venv
if [ ! -x "$PY" ]; then
  step "Pravim venv ..."
  python3 -m venv "$VENV"
fi
"$PY" -c "import fastapi" >/dev/null 2>&1 || {
  step "Instaliram tools dependencies ..."
  "$PY" -m pip install --upgrade pip
  "$PY" -m pip install -r "$TTS/requirements-tools.txt"
}

# ---------------------------------------------------------------- node deps
[ -d "$APP/node_modules" ] || { step "npm install ..."; ( cd "$APP" && npm install ); }

# ---------------------------------------------------------------- 2) web UI
if [ ! -f "$TTS/web-ui/index.web.html" ]; then
  step "Build web UI (build:web) ..."
  ( cd "$APP" && npm run build:web )
fi
[ -f "$TTS/web-ui/index.web.html" ] || die "web-ui/index.web.html nije napravljen."

# ---------------------------------------------------------------- 3) freeze tools server
step "PyInstaller: Linux tools binary ..."
"$PY" -m pip install pyinstaller
rm -rf "$TTS/dist" "$TTS/build-linux"
"$PY" -m PyInstaller \
  --noconfirm --onefile \
  --name voidcast-tools-server \
  --distpath "$TTS/dist" \
  --workpath "$TTS/build-linux" \
  --specpath "$TTS/build-linux" \
  --paths "$TTS" \
  --add-data "$TTS/fonts:fonts" \
  --add-data "$TTS/web-ui:web-ui" \
  --exclude-module torch \
  --exclude-module torchaudio \
  --exclude-module omnivoice \
  --exclude-module transformers \
  --exclude-module tensorflow \
  --exclude-module tensorboard \
  "$TTS/tools_exe_entry.py"

[ -f "$TTS/dist/voidcast-tools-server" ] || die "PyInstaller nije napravio voidcast-tools-server."
chmod +x "$TTS/dist/voidcast-tools-server"
step "OK: $TTS/dist/voidcast-tools-server"

# ---------------------------------------------------------------- 4) package
step "tsc + vite build + electron-builder --linux ${EXTRA_ARGS} ..."
( cd "$APP" && npx tsc && npx vite build && npx electron-builder --linux ${EXTRA_ARGS} )

step "Gotovo. Paket: $APP/release/<version>/"
