#!/usr/bin/env bash
# Voidcast — dev launcher for Linux (installs whatever is missing).
#
# Starts both halves from source:
#   1) Python tools server (uvicorn tools_main:app, port 8765)
#   2) Electron app       (electron-app -> vite dev)
#
# Installs what is missing automatically: Node.js + npm (NodeSource),
# python3 / python3-venv / python3-pip / build-essential, Python deps and npm packages.
#
# Usage:
#   bash start-dev.sh
#   VOIDCAST_TOOLS_HOST=127.0.0.1 bash start-dev.sh   # local only (no LAN)
#   VOIDCAST_TOOLS_PORT=8765 bash start-dev.sh
#   VOIDCAST_NODE_MAJOR=20 bash start-dev.sh
#
# Ctrl+C stops both processes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
TTS_DIR="$ROOT/tts-server"
APP_DIR="$ROOT/electron-app"

NODE_MAJOR="${VOIDCAST_NODE_MAJOR:-22}"   # which NodeSource release to install
NODE_MIN=20                                # minimum for Vite 5 / Electron 44

c_info=$'\033[36m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_off=$'\033[0m'
info() { echo "${c_info}[voidcast]${c_off} $*"; }
warn() { echo "${c_warn}[voidcast]${c_off} $*" >&2; }
die()  { echo "${c_err}[voidcast]${c_off} $*" >&2; exit 1; }

# ------------------------------------------------------------------ root / apt
if [ "$(id -u)" -eq 0 ]; then SUDO=(); else SUDO=(sudo); fi
as_root()  { "${SUDO[@]}" "$@"; }
have_apt() { command -v apt-get >/dev/null 2>&1; }
pkg_ok()   { dpkg -s "$1" >/dev/null 2>&1; }

[ -d "$TTS_DIR" ] || die "Cannot find tts-server/ (run the script from the project root)."
[ -d "$APP_DIR" ] || die "Cannot find electron-app/ (run the script from the project root)."

# ------------------------------------------------------------------ system packages
if have_apt; then
  missing=()
  for p in ca-certificates curl git python3 python3-venv python3-pip build-essential; do
    pkg_ok "$p" || missing+=("$p")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    info "Installing system packages: ${missing[*]}"
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
  info "Installing Node.js ${NODE_MAJOR}.x (NodeSource) ..."
  url="https://deb.nodesource.com/setup_${NODE_MAJOR}.x"
  if [ "$(id -u)" -eq 0 ]; then
    curl -fsSL "$url" | bash -
  else
    curl -fsSL "$url" | sudo -E bash -
  fi
  as_root apt-get install -y nodejs
fi
node_ok || die "Node.js is still unavailable after install (check 'node -v')."
info "Node $(node -v)  |  npm $(npm -v)"

# ------------------------------------------------------------------ python venv
if [ ! -x "$VENV/bin/python" ]; then
  info "Creating Python venv ..."
  if ! python3 -m venv "$VENV"; then
    if have_apt; then as_root apt-get install -y python3-venv; fi
    python3 -m venv "$VENV"
  fi
fi
PY="$VENV/bin/python"
[ -x "$PY" ] || die "venv was not created ($PY)."

if ! "$PY" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  info "Installing tools-server dependencies (requirements-tools.txt) ..."
  "$PY" -m pip install --upgrade pip
  "$PY" -m pip install -r "$TTS_DIR/requirements-tools.txt"
fi

# ------------------------------------------------------------------ node deps
if [ ! -d "$APP_DIR/node_modules" ]; then
  info "npm install in electron-app (first run is slow, downloads Electron ~150 MB) ..."
  ( cd "$APP_DIR" && npm install )
fi

# ------------------------------------------------------------------ electron sandbox
if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] &&
   [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = "1" ]; then
  warn "AppArmor restricts user namespaces (Ubuntu 24.04+) — disabling the Electron sandbox for this run."
  warn "Permanent fix:  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0"
  export ELECTRON_DISABLE_SANDBOX=1
fi

# ------------------------------------------------------------------ run
TOOLS_HOST="${VOIDCAST_TOOLS_HOST:-0.0.0.0}"
TOOLS_PORT="${VOIDCAST_TOOLS_PORT:-8765}"

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  info "Shutting down ..."
  if [ "${#PIDS[@]}" -gt 0 ]; then
    for pid in "${PIDS[@]}"; do
      [ -n "${pid:-}" ] || continue
      kill -0 "$pid" 2>/dev/null || continue
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

info "Tools server -> http://${TOOLS_HOST}:${TOOLS_PORT}"
( cd "$TTS_DIR" && exec "$PY" -m uvicorn tools_main:app --host "$TOOLS_HOST" --port "$TOOLS_PORT" ) &
PIDS+=("$!")

for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${TOOLS_PORT}/health" >/dev/null 2>&1; then
    info "Tools server is ready."
    break
  fi
  if [ "$i" -eq 40 ]; then
    warn "Tools server has not answered yet — continuing (Electron also autostarts it)."
  fi
  sleep 0.5
done

info "Electron (vite dev) ..."
( cd "$APP_DIR" && exec npm run dev ) &
PIDS+=("$!")

wait
