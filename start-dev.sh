#!/usr/bin/env bash
# Voidcast — dev launcher for Linux/macOS.
#
# Starts both halves from source:
#   1) Python tools server  (uvicorn tools_main:app, port 8765)
#   2) Electron desktop app (electron-app -> vite dev)
#
# Usage:
#   ./start-dev.sh
#   VOIDCAST_TOOLS_HOST=127.0.0.1 ./start-dev.sh   # LAN closed, local only
#   VOIDCAST_TOOLS_PORT=8765 ./start-dev.sh
#
# Ctrl+C shuts both down.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
PY="$VENV/bin/python"
TTS_DIR="$ROOT/tts-server"
APP_DIR="$ROOT/electron-app"

c_info=$'\033[36m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_off=$'\033[0m'
info() { echo "${c_info}[voidcast]${c_off} $*"; }
warn() { echo "${c_warn}[voidcast]${c_off} $*" >&2; }
die()  { echo "${c_err}[voidcast]${c_off} $*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
command -v node    >/dev/null 2>&1 || die "Node.js nije instaliran.  ->  nvm install 22"
command -v npm     >/dev/null 2>&1 || die "npm nije instaliran."
command -v python3 >/dev/null 2>&1 || die "python3 nije instaliran.  ->  sudo apt install python3 python3-venv"
[ -d "$TTS_DIR" ]  || die "Ne vidim tts-server/ (pokreni skriptu iz korena projekta)."
[ -d "$APP_DIR" ]  || die "Ne vidim electron-app/ (pokreni skriptu iz korena projekta)."

TOOLS_HOST="${VOIDCAST_TOOLS_HOST:-0.0.0.0}"
TOOLS_PORT="${VOIDCAST_TOOLS_PORT:-8765}"

# ---------------------------------------------------------------- python venv
if [ ! -x "$PY" ]; then
  info "Pravim Python venv u .venv ..."
  python3 -m venv "$VENV"
fi

if ! "$PY" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  info "Instaliram tools-server dependencies (requirements-tools.txt) ..."
  "$PY" -m pip install --upgrade pip
  "$PY" -m pip install -r "$TTS_DIR/requirements-tools.txt"
fi

# ---------------------------------------------------------------- node deps
if [ ! -d "$APP_DIR/node_modules" ]; then
  info "npm install u electron-app (prvi put traje) ..."
  ( cd "$APP_DIR" && npm install )
fi

# ---------------------------------------------------------------- lifecycle
PIDS=()
cleanup() {
  trap - EXIT INT TERM
  info "Gašenje ..."
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

# ---------------------------------------------------------------- 1) tools server
info "Tools server -> http://${TOOLS_HOST}:${TOOLS_PORT}"
( cd "$TTS_DIR" && exec "$PY" -m uvicorn tools_main:app --host "$TOOLS_HOST" --port "$TOOLS_PORT" ) &
PIDS+=("$!")

for i in $(seq 1 40); do
  if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${TOOLS_PORT}/health" >/dev/null 2>&1; then
    info "Tools server je spreman."
    break
  fi
  if [ "$i" -eq 40 ]; then
    warn "Tools server se još nije javio — nastavljam (Electron ima i sopstveni autostart)."
  fi
  sleep 0.5
done

# ---------------------------------------------------------------- 2) electron
info "Electron (vite dev) ..."
( cd "$APP_DIR" && exec npm run dev ) &
PIDS+=("$!")

wait
