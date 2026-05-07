#!/usr/bin/env bash
# Orange Road — start backend (Bun, :3001) and frontend (Vite, :5173) together.
# Use ./dev.sh from the project root. Ctrl+C cleans up both processes.

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

echo "→ backend  → http://localhost:3001"
(cd "$ROOT/backend" && bun run src/server.ts) &
BACKEND_PID=$!

echo "→ frontend → http://localhost:5173"
(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

cat <<'BANNER'

  ──────────────────────────────────────────────
   Orange Road dev servers running
   • frontend   http://localhost:5173
   • backend    http://localhost:3001
   • LM Studio  http://localhost:1234 (optional)
   Ctrl+C to stop.
  ──────────────────────────────────────────────

BANNER

wait
