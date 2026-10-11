#!/usr/bin/env bash
# Voidcast — Linux build script (AppImage + .deb), iz source-a.
# Sam skida/instališe što fali (Node, Python, venv, build alate).
#
# Steps:
#   1) venv + tools-server dependencies
#   2) LAN web UI build (electron-app -> tts-server/web-ui/)
#   3) PyInstaller: Linux one-file binary tools server
#      (tts-server/dist/voidcast-tools-server)
#   4) tsc + vite build + electron-builder --linux
#
# Output: electron-app/release/<version>/
#
# Usage:
#   bash build-linux.sh            # AppImage + deb
#   bash build-linux.sh --dir      # samo raspakovani dir (brzo, za test)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
TTS="$ROOT/tts-server"
APP="$ROOT/electron-app"
EXTRA_ARGS="${1:-}"

NODE_MAJOR="${VOIDCAST_NODE_MAJOR:-22}"
NODE_MIN=20

c_info=$'\033[36m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_off=$'\033[0m'
step() { echo "${c_info}[build-linux]${c_off} $*"; }
warn() { echo "${c_warn}[build-linux]${c_off} $*" >&2; }
die()  { echo "${c_err}[build-linux]${c_off} $*" >&2; exit 1; }

# ------------------------------------------------------------------ root / apt
if [ "$(id -u)" -eq 0 ]; then SUDO=(); else SUDO=(sudo); fi
as_root()  { "${SUDO[@]}" "$@"; }
have_apt() { command -v apt-get >/dev/null 2>&1; }
pkg_ok()   { dpkg -s "$1" >/dev/null 2>&1; }

[ -f "$TTS/tools_exe_entry.py" ] || die "Nema $TTS/tools_exe_entry.py"
[ -d "$TTS/fonts" ]              || die "Nema $TTS/fonts (NotoSans-Regular.ttf + NotoSans-Bold.ttf)"
[ -f "$ROOT/logo_app_nobg.png" ] || die "Nema logo_app_nobg.png u korenu (treba za ikonu)."

# ------------------------------------------------------------------ sistemski paketi
# VOIDCAST_SKIP_SYSDEPS=1 preskače apt (za CI gde je okruženje već spremno).
if have_apt && [ "${VOIDCAST_SKIP_SYSDEPS:-0}" != "1" ]; then
  missing=()
  for p in ca-certificates curl git python3 python3-venv python3-pip build-essential fakeroot dpkg; do
    pkg_ok "$p" || missing+=("$p")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    step "Instaliram sistemske pakete: ${missing[*]}"
    as_root apt-get update -y
    as_root apt-get install -y "${missing[@]}"
  fi
fi

# ------------------------------------------------------------------ node
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm  >/dev/null 2>&1 || return 1
  local v; v="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  if [ -z "${v:-}" ]; then return 1; fi
  [ "$v" -ge "$NODE_MIN" ] 2>/dev/null
}

if ! node_ok; then
  if ! have_apt; then
    die "Node.js ${NODE_MIN}+ nije instaliran, a nemam apt da ga skinem. Skini ručno: https://nodejs.org"
  fi
  step "Instaliram Node.js ${NODE_MAJOR}.x (NodeSource) ..."
  url="https://deb.nodesource.com/setup_${NODE_MAJOR}.x"
  if [ "$(id -u)" -eq 0 ]; then
    curl -fsSL "$url" | bash -
  else
    curl -fsSL "$url" | sudo -E bash -
  fi
  as_root apt-get install -y nodejs
fi
node_ok || die "Node.js i dalje nije dostupan posle instalacije."
step "Node $(node -v)  |  npm $(npm -v)"

# ------------------------------------------------------------------ 1) venv
if [ ! -x "$VENV/bin/python" ]; then
  step "Pravim venv ..."
  if ! python3 -m venv "$VENV"; then
    if have_apt; then as_root apt-get install -y python3-venv; fi
    python3 -m venv "$VENV"
  fi
fi
PY="$VENV/bin/python"
[ -x "$PY" ] || die "venv nije napravljen ($PY)."

if ! "$PY" -c "import fastapi" >/dev/null 2>&1; then
  step "Instaliram tools dependencies ..."
  "$PY" -m pip install --upgrade pip
  "$PY" -m pip install -r "$TTS/requirements-tools.txt"
fi

# ------------------------------------------------------------------ node deps
if [ ! -d "$APP/node_modules" ]; then
  step "npm install u electron-app (prvi put traje) ..."
  ( cd "$APP" && npm install )
fi

# ------------------------------------------------------------------ 2) web UI
if [ ! -f "$TTS/web-ui/index.web.html" ]; then
  step "Build web UI (build:web) ..."
  ( cd "$APP" && npm run build:web )
fi
[ -f "$TTS/web-ui/index.web.html" ] || die "web-ui/index.web.html nije napravljen."

# ------------------------------------------------------------------ 3) freeze tools server
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

# ------------------------------------------------------------------ 4) package
step "tsc + vite build + electron-builder --linux ${EXTRA_ARGS} ..."
( cd "$APP" && npx tsc && npx vite build && npx electron-builder --linux ${EXTRA_ARGS} )

step "Gotovo. Paket: $APP/release/<version>/"
