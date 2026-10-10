#!/usr/bin/env bash
set -euo pipefail

# Start local dev stack: postgres (docker), api (nest watch :3001), web (next dev :3000).
# Usage: ./scripts/local-start.sh
#
# Processes run detached; pids + logs in .dev/. Stop with ./scripts/local-stop.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_DIR="$ROOT_DIR/.dev"
cd "$ROOT_DIR"
mkdir -p "$DEV_DIR"

[ -f .env ] || { echo "ERROR: .env missing (copy .env.example)"; exit 1; }
docker info > /dev/null 2>&1 || { echo "ERROR: docker not running"; exit 1; }

PG_HOLDER=$(docker ps --filter publish=5434 --format '{{.Names}}' | grep -v '^n-tutor-postgres$' || true)
if [ -n "$PG_HOLDER" ]; then
  echo "ERROR: port 5434 held by container '$PG_HOLDER'; stop it first (docker stop $PG_HOLDER)"
  exit 1
fi

echo "==> Starting postgres..."
docker compose up -d --wait postgres

echo "==> Applying migrations..."
pnpm db:migrate

# start_proc <name> <port> <cmd...>
start_proc() {
  local name=$1 port=$2
  shift 2
  if lsof -ti tcp:"$port" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "==> $name already listening on :$port, skipping"
    return
  fi
  echo "==> Starting $name on :$port (log: .dev/$name.log)..."
  # set -m gives the job its own process group so stop can kill the whole tree
  set -m
  nohup "$@" > "$DEV_DIR/$name.log" 2>&1 &
  echo $! > "$DEV_DIR/$name.pid"
  set +m
}

start_proc api 3001 pnpm --filter api start:dev
start_proc web 3000 pnpm --filter web dev

# wait_for <name> <url>
wait_for() {
  local name=$1 url=$2
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$url"; then
      echo "==> $name OK ($url)"
      return 0
    fi
    sleep 2
  done
  echo "ERROR: $name not up after 120s; see .dev/$name.log"
  tail -20 "$DEV_DIR/$name.log" 2>/dev/null || true
  return 1
}

wait_for api http://localhost:3001/api/health
wait_for web http://localhost:3000/
echo "==> Local dev up: web http://localhost:3000  api http://localhost:3001/api"
