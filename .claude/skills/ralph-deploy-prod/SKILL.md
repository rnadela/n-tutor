---
name: ralph-deploy-prod
description: Deploy branch `main` to production (DigitalOcean droplet, via `pnpm ship`). Handles the known worktree/dirty-checkout traps, requires explicit confirmation before touching prod, and verifies the health check after. Use when the user asks to "deploy to prod", "ship main", "push to production", or similar — never trigger this from a generic "deploy" mention without the user naming prod/main explicitly.
---

# ralph-deploy-prod

Deploys the exact `origin/main` tree to production. This is an **irreversible, production-impacting action** — always get explicit confirmation before running `pnpm ship`, even if invoked from an otherwise-autonomous session.

Reference: `CLAUDE.md`'s Production section (droplet IP in `.env.production`'s `DROPLET_IP`, `scripts/deploy.sh`, GHCR images, `docker compose` + `prisma migrate deploy` on the remote).

---

## Step 0 — Confirm intent

If the user's request didn't explicitly name prod/production/main, ask before proceeding. Do not infer "deploy" to mean prod from an ambiguous phrase like "ship this" without checking — "ship" is also this repo's package-script name for the prod deploy, so treat any invocation of this skill as prod-bound by definition, but still confirm scope if the user's original phrasing was vague about *which* branch.

## Step 1 — Determine which checkout to deploy from

Deploying from the wrong tree is the #1 failure mode here. `scripts/deploy.sh` builds Docker images from **whatever tree is checked out**, tags them with `git rev-parse --short HEAD`, and internally runs `git push origin main` — so the checkout must actually *be* `main`, synced with `origin/main`, before running it.

Run:

```bash
git rev-parse --abbrev-ref HEAD
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

Branch into one of these cases:

**A. Already on `main`, local `main` == `origin/main`.** Clean path. Continue to Step 2 in the current checkout.

**B. Already on `main`, local `main` is behind `origin/main`.** Fast-forward: `git merge --ff-only origin/main`. If that fails (diverged), stop and tell the user — do not force-push or rebase main without asking.

**C. Already on `main`, local `main` is *ahead* of `origin/main`** (unpushed commits). Ask the user to confirm those commits are meant to ship — do not silently deploy someone's WIP that never went through review/CI, unless the conversation already established these commits are ready (e.g. you just finished implementing and testing them this session).

**D. On a feature branch or in a `.claude/worktrees/*` worktree.** Do **not** run `pnpm ship` here — a worktree has no `node_modules`, so a pre-push hook (if any) can fail, and a feature branch's tree can *regress* commits already on `main`. Two options, in order of preference:

   1. **If the primary checkout (the repo's main working directory, not a worktree) is on `main` and clean or safely stashable** — switch instructions to operate there instead. Never stash/clobber another session's WIP in the primary checkout; if it's dirty with unrelated work, fall back to option 2.
   2. **Disposable detached worktree** — deploy `origin/main`'s exact tree without touching the primary checkout:
      ```bash
      SHA=$(git rev-parse origin/main)
      git worktree add --detach /tmp/deploy-$SHA $SHA
      cp <primary-checkout>/.env.production /tmp/deploy-$SHA/.env.production
      cd /tmp/deploy-$SHA
      pnpm ship
      cd - && git worktree remove --force /tmp/deploy-$SHA
      ```
      `.env.production` is gitignored (holds `GHCR_TOKEN`, `DROPLET_IP`, secrets) — it won't exist in a fresh worktree, so it must be copied in from a checkout that has it.

## Step 2 — Pre-flight checks

Before asking for the deploy confirmation, gather what the user needs to approve it:

1. `git log <last-known-deployed-sha-or-origin/main~5>..HEAD --oneline` (or just the last handful of commits) — show what's shipping.
2. If this session (or recent conversation context) just implemented/tested the changes going out, note that plainly — it's the strongest signal the deploy is expected.
3. Confirm `.env.production` exists and has `GHCR_TOKEN` and `DROPLET_IP` set in whichever checkout will run `pnpm ship` (`grep -q GHCR_TOKEN .env.production && grep -q DROPLET_IP .env.production`) — fail fast with a clear message if missing, rather than letting `docker login` or the SSH step fail deep into the script.
4. Confirm `docker` is running locally (`docker info >/dev/null 2>&1`) — the script does two `linux/amd64` builds before it ever touches the network; fail fast if Docker Desktop isn't up.

## Step 3 — Confirm before touching prod

Ask the user directly (use the platform's blocking question tool), showing the commit range from Step 2:

> "Deploy `<N>` commit(s) ending in `<short-sha>` to production (`n-tutor.ralphnadela.com` / `api.n-tutor.ralphnadela.com`)? This builds+pushes Docker images, runs `prisma migrate deploy` against the prod DB, and restarts the prod containers."

Do not proceed without an explicit yes. This holds even in an autonomous/LFG session — a prod deploy is never inferred from "the pipeline reached the ship step" alone; the pipeline's own "ship" terminology refers to the git push/PR step, not this skill.

## Step 4 — Run the deploy

```bash
pnpm ship
```

(Or `./scripts/deploy.sh` directly if not in the repo root.) Stream the output — don't swallow it, the script's own `echo "==> ..."` lines are the progress signal. It:

1. `git push origin main` (should be a no-op / "Everything up-to-date" if Step 1 was done right)
2. Builds `api`/`web` Docker images (`linux/amd64`), tags with the short SHA + `latest`
3. Pushes both tags to GHCR
4. Syncs `compose.production.yml` and `infra/docker/Caddyfile` to the droplet
5. SSHs in: pulls images, runs `prisma migrate deploy` (from `/app/apps/api`, picking up `prisma.config.ts`), `docker compose up -d --remove-orphans`, reloads Caddy
6. Polls `/health` (api) and `/` (web) for up to 90s, **exits non-zero if either never comes up**

## Step 5 — Handle known failure modes

Don't treat every non-zero exit as a fresh problem to diagnose from scratch — check these first:

- **`! [rejected] main -> main (non-fast-forward)`** on the internal `git push origin main`: someone else merged to `origin/main` between Step 1 and now. `git fetch origin main && git merge --ff-only origin/main`, then re-run `pnpm ship` — Docker layer caching makes the retry fast.
- **`docker push` broken pipe / transient GHCR error**: just re-run `pnpm ship`. Builds are cached; only the push retries.
- **Health check fails after 90s**: this is a real failure, not a flake. Pull logs before concluding anything:
  ```bash
  ssh -i ~/.ssh/n-tutor_deploy deploy@<DROPLET_IP> "cd /opt/ntutor && docker compose logs --tail=100 api web"
  ```
  Report the actual error to the user — do not retry blindly, and do not roll back containers/images without asking (rollback is itself a prod-impacting action).
- **`GHCR_TOKEN` unset**: means `.env.production` is missing or stale in whichever checkout is running the script — see Step 2.3.
- **`DROPLET_IP` unset**: same file, same fix.

## Step 6 — Report

On success, tell the user:
- Deployed SHA (short)
- Health check result (api/web both OK)
- One line confirming what's now live (from the commit range in Step 2)

On failure, report exactly which step failed, the actual error output (not a paraphrase), and stop — do not attempt destructive recovery (rollback, force-push, container removal) without the user's explicit go-ahead.
