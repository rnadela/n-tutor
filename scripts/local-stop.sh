#!/usr/bin/env bash
set -euo pipefail

# Stop local dev stack started by ./scripts/local-start.sh
# Usage: ./scripts/local-stop.sh   (stops web, api, postgres; data volume kept)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_DIR="$ROOT_DIR/.dev"
cd "$ROOT_DIR"

# stop_proc <name> <port>
stop_proc() {
  local name=$1 port=$2 pidfile="$DEV_DIR/$1.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2> /dev/null; then
      echo "==> Stopping $name (pgid $pid)..."
      kill -TERM -- "-$pid" 2> /dev/null || kill -TERM "$pid" 2> /dev/null || true
    fi
    rm -f "$pidfile"
  fi
  # Fallback: anything still holding the port (e.g. started outside this script)
  sleep 1
  local pids
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2> /dev/null || true)
  if [ -n "$pids" ]; then
    echo "==> Killing leftover listener(s) on :$port: $pids"
    kill -TERM $pids 2> /dev/null || true
  fi
}

stop_proc web 3000
stop_proc api 3001

echo "==> Stopping postgres..."
docker compose stop postgres

echo "==> Local dev stopped"
