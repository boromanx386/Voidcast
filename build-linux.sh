#!/usr/bin/env bash
# Voidcast — Linux build script (AppImage + .deb), from source.
# Fetches/installs whatever is missing (Node, Python, venv, build tools).
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
#   bash build-linux.sh                  # AppImage + deb
#   bash build-linux.sh --dir            # unpacked dir only (fast, for testing)
#   bash build-linux.sh "--publish never"  # CI: do not publish to GitHub
#   VOIDCAST_SKIP_SYSDEPS=1 bash build-linux.sh   # leave apt alone (CI)
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

[ -f "$TTS/tools_exe_entry.py" ] || die "Missing $TTS/tools_exe_entry.py"
[ -d "$TTS/fonts" ]              || die "Missing $TTS/fonts (NotoSans-Regular.ttf + NotoSans-Bold.ttf)"
[ -f "$ROOT/logo_app_nobg.png" ] || die "Missing logo_app_nobg.png in the repo root (needed for the icon)."

# ------------------------------------------------------------------ system packages
# VOIDCAST_SKIP_SYSDEPS=1 skips apt (for CI where the environment is already prepared).
if have_apt && [ "${VOIDCAST_SKIP_SYSDEPS:-0}" != "1" ]; then
  missing=()
  for p in ca-certificates curl git python3 python3-venv python3-pip build-essential fakeroot dpkg; do
    pkg_ok "$p" || missing+=("$p")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    step "Installing system packages: ${missing[*]}"
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
    die "Node.js ${NODE_MIN}+ is not installed and apt is unavailable to fetch it. Install manually: https://nodejs.org"
  fi
  step "Installing Node.js ${NODE_MAJOR}.x (NodeSource) ..."
  url="https://deb.nodesource.com/setup_${NODE_MAJOR}.x"
  if [ "$(id -u)" -eq 0 ]; then
    curl -fsSL "$url" | bash -
  else
    curl -fsSL "$url" | sudo -E bash -
  fi
  as_root apt-get install -y nodejs
fi
node_ok || die "Node.js is still unavailable after install."
step "Node $(node -v)  |  npm $(npm -v)"

# ------------------------------------------------------------------ 1) venv
if [ ! -x "$VENV/bin/python" ]; then
  step "Creating venv ..."
  if ! python3 -m venv "$VENV"; then
    if have_apt; then as_root apt-get install -y python3-venv; fi
    python3 -m venv "$VENV"
  fi
fi
PY="$VENV/bin/python"
[ -x "$PY" ] || die "venv was not created ($PY)."

if ! "$PY" -c "import fastapi" >/dev/null 2>&1; then
  step "Installing tools dependencies ..."
  "$PY" -m pip install --upgrade pip
  "$PY" -m pip install -r "$TTS/requirements-tools.txt"
fi

# ------------------------------------------------------------------ node deps
if [ ! -d "$APP/node_modules" ]; then
  step "npm install in electron-app (first run is slow) ..."
  ( cd "$APP" && npm install )
fi

# ------------------------------------------------------------------ 2) web UI
if [ ! -f "$TTS/web-ui/index.web.html" ]; then
  step "Building web UI (build:web) ..."
  ( cd "$APP" && npm run build:web )
fi
[ -f "$TTS/web-ui/index.web.html" ] || die "web-ui/index.web.html was not created."

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
  --collect-data trafilatura \
  --add-data "$TTS/fonts:fonts" \
  --add-data "$TTS/web-ui:web-ui" \
  --exclude-module torch \
  --exclude-module torchaudio \
  --exclude-module omnivoice \
  --exclude-module transformers \
  --exclude-module tensorflow \
  --exclude-module tensorboard \
  "$TTS/tools_exe_entry.py"

[ -f "$TTS/dist/voidcast-tools-server" ] || die "PyInstaller did not produce voidcast-tools-server."
chmod +x "$TTS/dist/voidcast-tools-server"
step "OK: $TTS/dist/voidcast-tools-server"

# ------------------------------------------------------------------ 4) package
step "tsc + vite build + electron-builder --linux ${EXTRA_ARGS} ..."
( cd "$APP" && npx tsc && npx vite build && npx electron-builder --linux ${EXTRA_ARGS} )

step "Done. Package: $APP/release/<version>/"
