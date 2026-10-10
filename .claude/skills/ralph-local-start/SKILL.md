---
name: ralph-local-start
description: Start the local dev stack (postgres via docker, api on :3001, web on :3000) detached in the background via `scripts/local-start.sh`. Use when the user asks to "start the dev server", "run locally", "spin up local", or similar.
---

# ralph-local-start

Run from repo root:

```bash
./scripts/local-start.sh
```

What it does:

1. Fails fast if `.env` missing or Docker not running.
2. `docker compose up -d --wait postgres` (port 5434).
3. `pnpm db:migrate`.
4. Starts `pnpm --filter api start:dev` (:3001) and `pnpm --filter web dev` (:3000) detached, each in its own process group. Pids in `.dev/<name>.pid`, logs in `.dev/<name>.log`. Skips any process whose port already has a listener.
5. Polls `http://localhost:3001/api/health` and `http://localhost:3000/` up to 120s each; exits non-zero and tails the log on failure.

Run the Bash call with a timeout of ~300000ms (first Next compile is slow).

Report: web/api URLs and health result. On failure, quote the decisive log line from `.dev/<name>.log` — don't retry blindly.

To stop: `ralph-local-stop` skill.
