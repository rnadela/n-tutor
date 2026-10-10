---
name: ralph-local-stop
description: Stop the local dev stack started by `ralph-local-start` (web :3000, api :3001, postgres container) via `scripts/local-stop.sh`. Use when the user asks to "stop the dev server", "kill local", "shut down local", or similar.
---

# ralph-local-stop

Run from repo root:

```bash
./scripts/local-stop.sh
```

What it does:

1. Kills each process group recorded in `.dev/{web,api}.pid`, removes the pid file.
2. Fallback: kills any remaining listener on :3000 / :3001 (covers servers started outside the script).
3. `docker compose stop postgres` — container stopped, data volume kept (never use `down -v`).

Report what was stopped.
