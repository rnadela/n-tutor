---
name: ralph-browser-test
description: Acceptance-test an epic (or story) of this app end to end in Chrome via Claude in Chrome — walk every acceptance criterion from `epics.md` through the real UI, back it with DB/API checks, fix what breaks, and report a pass/fail table. Use when the user asks to "test epic N", "browser test story X", "QA epic N in Chrome", or "use Claude Chrome to test …".
---

# ralph-browser-test

Drives the **local** stack (web :3000, api :3001, postgres :5434) through Claude in Chrome against one epic's acceptance criteria. Local only — never point this at production.

Inputs: an epic number (e.g. `2`) or story key (e.g. `1-4`). If neither was given, ask.

---

## Step 1 — Load the acceptance criteria

```bash
awk '/^## Epic N:/{f=1} /^## Epic N\+1:/{f=0} f' _bmad-output/planning-artifacts/epics.md
```

(Substitute N.) Turn each story's Given/When/Then into a checklist row: `story | check | how (UI / API / DB)`. Note ACs that are mechanism-only (no UI yet) — those get API-level checks, not skipped.

## Step 2 — Bring the stack up and seed

1. `./scripts/local-start.sh` (or the `ralph-local-start` skill). It fails fast if another container holds :5434.
2. `pnpm db:seed` — seeds the operator and the Philippine K–12 grade levels (Kindergarten, Grade 1–12). A Student Profile cannot be created without a grade level.
3. Test credentials live in `.dev/test-credentials.env` (gitignored). If missing, generate and write them there — **never** echo values in chat; point the user to `! cat .dev/test-credentials.env`:
   ```
   PARENT_EMAIL=parent1@example.test
   PARENT_PASSWORD=Tutor-<random>!
   PARENT_PIN=<4 digits>
   ```
   Update the file whenever a test changes a password or PIN. Admin operator: `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` in `.env`.

## Step 3 — Open Chrome

Load the browser tools in **one** ToolSearch call (tabs_context_mcp, tabs_create_mcp, navigate, computer, find, read_page, form_input, javascript_tool, get_page_text, browser_batch, tabs_close_mcp). Call `tabs_context_mcp`, then create a fresh tab — never reuse a user's tab. Batch predictable steps with `browser_batch`.

The product name in the UI and tab title is `n-test-reviewer` — that is this app, not another project.

## Step 4 — Walk each AC

Prefer the real UI; add a DB or API assertion wherever the AC is about persistence or server enforcement:

- **DB** (read-only checks unless setting up state):
  `docker exec n-tutor-postgres psql -U nts -d nts -Atc "<sql>"`
  Mask secrets in output (`sed -E 's#//[^@]*@#//***@#'`).
- **API**: use `ctx_execute` (JavaScript `fetch` with a manual cookie jar) against `http://localhost:3001/api/...`, or `javascript_tool` in the tab with `credentials:'include'` to reuse the browser session. Elevated (Parent View) routes need `Authorization: Bearer <token>` from `POST /api/parent/pin/verify`.
- **Email** (`MAIL_TRANSPORT=log`): sent mail is logged in `.dev/api.log` as `mail.send` — grep it for reset links.
- **Server-side enforcement**: for "unreachable from Student Mode" ACs, probe both direct URLs (expect the PIN gate) and the parent API routes without a token (expect 401; `pin/status` is legitimately open).

### Known traps (each cost real time — check before acting)

| Trap | Symptom | Do this |
|---|---|---|
| 1Password overlay | `type`/`key`/JS calls fail with "Cannot access a chrome-extension:// URL" on password fields | Use `form_input` for password/PIN fields; click via `find` refs. Suggest the user disable 1Password on localhost. |
| Native `window.confirm` | Page freezes; every tool times out | Before clicking a destructive control, `grep -rn "window.confirm" apps/web/src`. If it fires anyway, ask the user to dismiss it — and report it as a bug (UX-DR27 wants the app's Dialog). |
| Reload / typed URL inside Parent View | Lands on "Enter your PIN" | By design: elevation is in memory only. Re-enter the PIN, then navigate via the sidebar — never `navigate`/`goto` to a deep parent URL. |
| Frozen tab missed hot reload | Code fix not visible even after reload | Restart: `./scripts/local-stop.sh && ./scripts/local-start.sh`. |
| Free tier | Second profile refused ("allows 1 active Student Profile") | `update parent_account set tier='Family' where email='…'`; restore afterwards if the AC is about tier limits. |
| Idle expiry (15 min) | Too slow to test | Temporarily set `ELEVATION_TTL_SECONDS=60` in `.env`, restart the stack, idle ~75 s, then **restore 900 and restart**. |
| PIN lockout | Further PIN tests blocked for 15 min | Test lockout **last**; clear with `update parent_account set "pinFailedAttempts"=0, "pinLockedUntil"=null where email='…'`. |
| MUI select offset | Ref click picks the wrong option | Screenshot the open listbox, click by coordinate, verify the chosen value. |
| `read_page` misses checkboxes/radios | MUI hides the native input | Not an a11y bug by itself — verify with JS that the input sits inside its `<label>`. |
| Password reset | Open tab bounced to sign-in afterwards | Expected: reset bumps the session epoch. Sign in again with the new password. |

## Step 5 — Fix what breaks

For each failure decide: **product bug** vs **test/setup drift** vs **by design**. Product bugs:

1. Fix in code following surrounding patterns (copy in `apps/web/src/copy/*`, dialogs from `@/components/Dialog`, announcements via `useAnnounce`).
2. Update affected unit specs and Playwright specs (`e2e/tests/*`).
3. `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test`, plus `pnpm typecheck:e2e`.
4. Re-verify in the browser (restart the stack if the change doesn't show).
5. Show the diff and get approval before each commit (Conventional Commits, no attribution lines).

To run Playwright specs, stop the dev web/api first (Playwright reuses whatever listens on :3000/:3001), keep postgres, and `pnpm build` — the e2e web server serves the production build.

## Step 6 — Clean up

- Restore any `.env` change and restart the stack.
- Clear PIN locks; restore tiers changed only for setup.
- Delete throwaway rows you created via API (or list them in the report).
- Close every tab you opened.

## Step 7 — Report

One table, every AC:

| Story | Check | Result |
|---|---|---|
| 1.2 | 3 wrong PINs lock Parent View; lock survives reload | Pass |

Then: bugs found (with `file:line`), what was fixed and committed (SHAs), test/setup drift fixed, anything untested and why, and leftover local state (accounts, credentials file changes).
