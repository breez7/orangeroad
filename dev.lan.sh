#!/usr/bin/env bash
# Orange Road — LAN dev mode. Binds both servers to 0.0.0.0 and points the
# frontend at this host's LAN IP so other computers on the same network can
# load the game. Set LM_STUDIO_URL to point at the LM Studio instance.
#
# Usage:
#   ./dev.lan.sh                      # auto-detect LAN IP, no LM Studio
#   LM_STUDIO_URL=http://192.168.0.2:1234/v1 ./dev.lan.sh
#   LAN_IP=192.168.0.21 ./dev.lan.sh  # override auto-detected IP
#
# Ctrl+C cleans up both processes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun is not installed. Install from https://bun.sh and retry."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node is not installed. Install Node 20+ and retry."
  exit 1
fi

if [ ! -d "$ROOT/backend/node_modules" ]; then
  echo "→ installing backend deps (bun install)…"
  (cd "$ROOT/backend" && bun install)
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "→ installing frontend deps (npm install)…"
  (cd "$ROOT/frontend" && npm install)
fi

# Pick a LAN IP. If LAN_IP is set, use it. Otherwise grab the first private
# IPv4 (192.168.x.x / 10.x.x.x / 172.16-31.x.x) on this host.
if [ -z "${LAN_IP:-}" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | tr ' ' '\n' | \
    grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | \
    grep -v '^172\.1[7-9]\.' | grep -v '^172\.2[0-9]\.' | grep -v '^172\.3[01]\.' | \
    head -1)"
fi
if [ -z "$LAN_IP" ]; then
  echo "✗ Could not auto-detect a LAN IP. Set LAN_IP=… manually."
  exit 1
fi

LM_STUDIO_URL="${LM_STUDIO_URL:-}"
LM_STUDIO_MODEL="${LM_STUDIO_MODEL:-}"
PORT_BE=3001
PORT_FE=5173

cleanup() {
  echo
  echo "→ shutting down dev servers…"
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "→ backend  → http://$LAN_IP:$PORT_BE  (binds 0.0.0.0)"
(
  cd "$ROOT/backend"
  # Forward all LM_STUDIO_* env vars (URL, MODEL, TIMEOUT_MS, MAX_TOKENS, …)
  # from the caller, plus our own backend config. Anything else from the
  # caller's env passes through too so debugging flags work.
  PORT=$PORT_BE \
    HOSTNAME=0.0.0.0 \
    ALLOWED_ORIGINS="http://$LAN_IP:$PORT_FE,http://localhost:$PORT_FE" \
    bun run src/server.ts
) &
BACKEND_PID=$!

echo "→ frontend → http://$LAN_IP:$PORT_FE (binds 0.0.0.0)"
(
  cd "$ROOT/frontend"
  VITE_API_URL="http://$LAN_IP:$PORT_BE" \
    npx vite --host 0.0.0.0 --port "$PORT_FE"
) &
FRONTEND_PID=$!

cat <<BANNER

  ──────────────────────────────────────────────
   Orange Road LAN dev servers running
   • Open from any computer on this network:
       http://$LAN_IP:$PORT_FE
   • backend     http://$LAN_IP:$PORT_BE
   • LM Studio   ${LM_STUDIO_URL:-(not set — NPC will run offline)}
     ${LM_STUDIO_MODEL:+(model: $LM_STUDIO_MODEL)}
   Ctrl+C to stop.
  ──────────────────────────────────────────────

BANNER

wait
