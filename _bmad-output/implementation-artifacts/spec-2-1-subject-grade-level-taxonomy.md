---
title: 'Story 2.1 — Subject & Grade Level Taxonomy'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_revision: '61c8bf727d53a488bb32377fab66ce17fba0b7a8'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md'
warnings: [oversized]
deferred:
  - summary: >-
      Bulk edits on the taxonomy screen can trip the default rate limiter
      because every GET read after a write counts against it.
    evidence: |-
      `GET /api/admin/taxonomy` and `GET /api/admin/auth/me` only skip the
      `login`-named throttler (`@SkipThrottle({ login: true })`); they still
      count against the shared `default` limiter. The taxonomy page reloads
      the entire snapshot after every single create/rename/toggle, so a burst
      of operator edits could plausibly trip the default limiter.
    location: >-
      apps/api/src/admin/admin-auth.controller.ts, apps/api/src/admin/taxonomy.controller.ts
    severity: low
  - summary: >-
      `pg`, `@types/pg`, and `dotenv` versions are declared independently in
      the root `package.json` and `apps/api/package.json` with nothing
      pinning them together.
    evidence: |-
      A prior review pass already fixed drift between these same packages
      once; the fix was not generalised, so the two remaining independent
      copies can drift again.
    location: >-
      package.json, apps/api/package.json
    severity: low
  - summary: >-
      `siblingDatabaseUrl()` only rewrites the URL's pathname, so any other
      connection parameter on `DATABASE_URL` carries over unmodified onto the
      derived test/E2E database URLs.
    evidence: |-
      If the root `.env` later adds pooling flags or a non-default schema,
      those would silently apply to `nts_test`/`nts_e2e` too, which is easy to
      overlook.
    location: >-
      apps/api/src/common/database-url.ts
    severity: low
  - summary: >-
      `/api/health` runs its readiness query with no explicit timeout, so a
      hung (not immediately erroring) database connection could hang the
      health check indefinitely instead of reporting 503.
    evidence: |-
      `health.controller.ts` awaits `SELECT 1` directly with no race against a
      timeout; this is only exercised for the fast-fail case in tests.
    location: >-
      apps/api/src/health/health.controller.ts
    severity: low
  - summary: >-
      The web admin API client shows the same generic or credential-specific
      message for rate-limited (429) and server-error (500) responses as it
      does for actual failures, on both login and general calls.
    evidence: |-
      `messageFor()` only special-cases 401/404/409 before falling back to a
      generic message; `signIn()` uses one fixed failed-credentials message
      for every non-OK response, including 429 and 500.
    location: >-
      apps/web/src/lib/admin-api.ts
    severity: low
  - summary: >-
      `call()` in the admin API client does not guard `response.json()` when
      `response.ok` is true, so a malformed success body throws a raw
      `SyntaxError` instead of a typed `AdminApiError`.
    evidence: |-
      Only the non-OK branch constructs `AdminApiError`; a 200 with an empty
      or invalid JSON body propagates an unguarded parse exception to callers
      that only expect `AdminApiError`.
    location: >-
      apps/web/src/lib/admin-api.ts
    severity: low
  - summary: >-
      The audit-write-rollback matrix row ("Audit write fails" -> "Nothing
      persists; 500 surfaced") is proven at the service layer but not at the
      HTTP layer for this specific scenario.
    evidence: |-
      `taxonomy.int-spec.ts`'s "rolls the taxonomy write back when the audit
      write fails" test mocks `audit.record` and asserts via
      `rejects.toThrow(...)` plus zeroed row counts; no test in this scenario
      asserts an actual HTTP 500 response.
    location: >-
      apps/api/test/taxonomy.int-spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** No operator surface exists for the Subject / Grade Level taxonomy, so parents have nothing to pick from at upload and Student Profiles have no Grade Level list — and the repository currently contains **zero application source**, so the `admin` module has nowhere to live.

**Approach:** Bootstrap the minimum monorepo the architecture spine mandates (pnpm + Turborepo, NestJS API with Prisma/Postgres, Next.js + MUI web), then build the `admin` module end to end: its own credential store and login, `Subject` / `GradeLevel` / their per-Grade-Level availability mapping, an audit row per admin write, and the Admin console screen that manages all three.

## Boundaries & Constraints

**Always:**
- `admin` is a standalone NestJS module owning `AdminUser`, `Subject`, `GradeLevel`, `SubjectGradeLevel`, `AdminAudit`, served under the `/api/admin` route namespace behind an admin-only guard. An admin credential must never satisfy a parent guard and vice versa (AD-25).
- Every admin write emits one `AdminAudit` row **in the same transaction** as the write. Audit rows carry actor, action, target type/id, and a redacted detail payload — never child content (AD-20, AD-25).
- Taxonomy items are **disabled, never deleted**. Renaming changes the label on the row only; every consumer stores the id and resolves the label by reference, so existing references are unaffected (UJ-4).
- Availability is a `Subject` × `GradeLevel` join row with its own `enabled` flag. A Subject is selectable for a Grade Level only when the Subject, the Grade Level, **and** the join row are all enabled. Changes take effect immediately for new selections only.
- Stack versions are pinned exactly as the spine's Stack table states (Node >= 24, pnpm 11.25.0 via `packageManager` + Corepack, Turborepo 2.10.12, NestJS 12.0.1, prisma & @prisma/client & @prisma/adapter-pg 7.10.0, PostgreSQL `postgres:18.6-alpine`, TypeScript 6.0.3, Next.js 16.3.4, React 19.2.8, @mui/material 9.4.0, argon2 0.45.1, Playwright 1.62.1). `PrismaClient` is constructed with `@prisma/adapter-pg`; the Prisma generator is `prisma-client`.
- Web: one base MUI theme carrying every DESIGN token with both light and dark values; the `/admin` route group nests a `ThemeProvider` that overrides **`palette.primary` only** to the Parent View accent (`#0B5FA5` light / `#7FB6E8` dark). Elevation 0 everywhere with an explicit `1px solid divider`; `rounded.control` 8px; `density.compact` (row 40px, card padding 12px, gap 8px, section margin 20px); every tappable control >= 44px; 2px focus outline at 2px offset in the surface primary; sans stack (`'Source Sans 3', -apple-system, …`) for all admin chrome; `table-cell` role (16px/1.45) for table text.
- No user-facing string is a hardcoded literal in a component — admin copy resolves through a single copy module, third person, plain and factual.
- Admin sign-in failure must not reveal whether an operator account exists.

**Block If:**
- The OpenAI model snapshot ids would have to be resolved (they are not needed by this story — if something forces the `ai` module into scope, stop).
- Deploy credentials, a domain, a registry token, or any hosted environment would have to be provisioned to satisfy an acceptance criterion.

**Never:**
- Do not build the parent-facing side: no `ParentAccount`, `StudentProfile`, PIN, elevation token, signup, upload, or Account Tier work. Story 2.2 and Epic 1 own those.
- Do not build any other API module (`sourcetest`, `practicetest`, `ai`, …), the worker entrypoint, pg-boss, Sentry, or the production deploy pipeline.
- No admin roles, invitations, or self-service signup — one operator, seeded out of band.
- No hard delete of taxonomy rows, no label copying into consumers, no second divider tier, no drop shadow or MUI elevation > 0, no bespoke Admin theme or fourth accent.
- Do not commit `node_modules`, build output, `.env`, or `.turbo`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Operator signs in | Seeded operator email + correct password | 200 with an admin-scoped JWT; taxonomy screen reachable | No error expected |
| Sign-in with unknown email or wrong password | Either case | 401 with one identical message for both | Message must not distinguish the two cases; argon2 verify still runs on unknown email |
| Parent-style token on an admin route | Token lacking the admin scope/audience | 401/403, request rejected | Guard rejects before the handler |
| Create a Subject | `{ name: "Mathematics" }` | Subject row created `enabled: true`; one `AdminAudit` row `subject.create` | Duplicate name (case-insensitive) → 409 |
| Rename a Subject | Existing subject id + new name | Row's `name` updated in place, id unchanged; audit row `subject.rename` with before/after name | Unknown id → 404; duplicate name → 409 |
| Disable a Subject | Enabled subject with existing references | `enabled: false`; still resolvable by id with its current name; excluded from selectable list | Unknown id → 404 |
| Enable a Subject–Grade Level mapping | Enabled Subject + enabled Grade Level | Join row `enabled: true`; Subject appears in that Grade Level's selectable list immediately | Unknown subject or grade level id → 404 |
| Disable the mapping only | Subject and Grade Level both still enabled | Subject drops out of that Grade Level's selectable list; remains selectable for other enabled mappings | Unknown mapping → 404 |
| Selectable list for a Grade Level | Subject enabled, Grade Level enabled, mapping enabled, plus one of each disabled | Returns only the fully-enabled combinations, ordered by Subject name | Disabled Grade Level → empty list |
| Reference resolution after rename/disable | A stored subject id captured before a rename and a disable | Resolving that id returns the current name and succeeds while disabled | Never throws for a disabled row |
| Audit write fails | Forced failure inside the transaction | The taxonomy write is rolled back too | Nothing persists; 500 surfaced |

</intent-contract>

## Code Map

The repository tracks **no application source at all** — `git ls-files` outside `.claude/`, `_bmad/`, `_bmad-output/`, `.bmad-loop/` returns only `.gitignore`. The untracked `apps/`, `e2e/`, `node_modules/`, `.turbo/` trees hold only build residue from a lost earlier attempt (`apps/api/dist`, `apps/api/src/generated/prisma`, `apps/web/.next`); there is no hand-written source among them and nothing there is authoritative. Treat this story as greenfield and overwrite that residue.

- `_bmad-output/implementation-artifacts/epic-2-context.md` -- distilled epic requirements, module boundaries, admin UX constraints. Read first.
- `_bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md` -- AD-17 (one writer per entity, module list), AD-25 (admin separation, audit rule), AD-32 (presentation constraints), "Stack" table (exact versions), "Source tree" (directory layout to follow).
- `_bmad-output/specs/spec-n-test-reviewer/glossary.md` -- reserved vocabulary; `Subject`, `Grade Level`, `Admin` must be used exactly.
- `_bmad-output/planning-artifacts/epics.md` (`## Epic 2` / `### Story 2.1`) -- the three Given/When/Then criteria this story must satisfy.
- `.gitignore` -- currently ignores only BMAD paths; must gain `node_modules/`, build output, `.env`, `.turbo/` before anything is committed.
- Toolchain on this machine: Node 24.14.1 via asdf (add a repo `.tool-versions`), Corepack 0.34.6 present, Docker daemon running (usable for the test Postgres).

Design tokens to encode in the web theme (light / dark): `primary-parent` `#0B5FA5`/`#7FB6E8`, `on-primary` `#FFFFFF`/`#0E1620`, `secondary` `#4A6072`/`#9DB2C4`, `success` `#0F6B4F`/`#6FD1AC`, `error` `#B3261E`/`#F19B94`, `warning` `#8A5A00`/`#E3B457`, `info` `#2E6E9E`/`#8CC0E4`, `background-default` `#F6F8FA`/`#0E1620`, `background-paper` `#FFFFFF`/`#16202C`, `text-primary` `#10202E`/`#E7EEF5`, `text-secondary` `#4E6070`/`#A3B3C2`, `divider` `#7C8894`/`#6A747E`, `tintHover` `#EEF3F5`/`#1C2836`, `tintSelected` `#E8F1F2`/`#0D2A33`. Base theme primary (student) is `#0F6E78`/`#71C3CE`; admin overrides it to the parent accent.

## Tasks & Acceptance

**Execution:**
- `.gitignore`, `.tool-versions` -- ignore `node_modules/`, `dist/`, `.next/`, `.turbo/`, `*.tsbuildinfo`, `.env*`, `e2e/test-results/`, `apps/api/src/generated/`; pin `nodejs 24.14.1` -- so the first commit is clean and the toolchain resolves.
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` -- workspace root with `packageManager: pnpm@11.25.0`, Turborepo 2.10.12 pipeline (`build`, `lint`, `typecheck`, `test`, `test:int`, `e2e`) -- the spine's monorepo shape.
- `compose.yml` -- development `postgres:18.6-alpine` service on a non-default host port with a named volume -- Tier-1 tests need a real Postgres (AD-22).
- `apps/api/prisma/schema.prisma` -- `prisma-client` generator + `AdminUser`, `Subject`, `GradeLevel`, `SubjectGradeLevel` (unique on `subjectId+gradeLevelId`), `AdminAudit`; case-insensitive unique names via a citext-style unique index or normalized `nameKey` column -- the owned entity cluster of `admin`.
- `apps/api/prisma/migrations/**` -- the initial migration, generated not hand-written.
- `apps/api/prisma/seed.ts` -- idempotently seed exactly one operator from `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` -- "one operator account, seeded out-of-band".
- `apps/api/src/prisma/prisma.service.ts`, `prisma.module.ts` -- `@Global()` PrismaClient built on `@prisma/adapter-pg`, exposing a `withTransaction` helper -- AD-7 and the shared-transaction rule.
- `apps/api/src/admin/admin.module.ts` -- wires controllers, services, guard, JWT strategy -- module boundary of AD-17/AD-25.
- `apps/api/src/admin/admin-auth.service.ts`, `admin-auth.controller.ts` -- argon2 verify + admin-scoped JWT mint on `POST /api/admin/auth/login`; constant message on failure; verify a dummy hash when the email is unknown -- AD-25 separate credential store.
- `apps/api/src/admin/admin-auth.guard.ts` -- accepts only tokens whose audience/scope is admin -- "an operator credential cannot satisfy a parent guard and a parent credential cannot satisfy an admin guard".
- `apps/api/src/admin/admin-audit.service.ts` -- `record(tx, actorId, action, targetType, targetId, detail)` taking the caller's transaction client first -- one audit row per write, same transaction.
- `apps/api/src/admin/taxonomy.service.ts` -- create/rename/enable/disable for Subject and Grade Level, set mapping availability, `listTaxonomy()`, `listSelectableSubjects(gradeLevelId)`, `resolveSubject(id)` / `resolveGradeLevel(id)` that succeed for disabled rows -- the behavioural core of the story.
- `apps/api/src/admin/taxonomy.controller.ts`, `dto/*.ts` -- `/api/admin/taxonomy` REST surface with validated DTOs -- the console's API.
- `apps/api/src/main.ts`, `app.module.ts`, `src/common/**` -- Nest bootstrap, global validation pipe, structured JSON logging with a per-request correlation id, `/api/health` -- AD-20 logging shape.
- `apps/api/test/**` -- Tier-1 integration tests against the containerised Postgres covering every I/O-matrix row, including the audit-rollback case.
- `apps/web/**` (app router, `src/theme/tokens.ts`, `src/theme/theme.ts`, `src/app/admin/layout.tsx`, `src/app/admin/login/page.tsx`, `src/app/admin/taxonomy/page.tsx`, `src/app/admin/_components/**`, `src/copy/admin.ts`, `src/lib/admin-api.ts`) -- Next.js 16 + MUI 9 admin route group: token-driven light/dark theme, nested primary override, login form, and the Subjects & Grade Levels screen with create/rename/enable/disable for both lists and an availability matrix, each change announced in a live region -- AD-32 and the DESIGN constraints.
- `e2e/**`, `playwright.config.ts` -- Playwright specs signing in as the seeded operator and exercising create → rename → disable → mapping toggle, asserting the selectable list reflects each change -- Tier-2 (AD-22).

**Acceptance Criteria:**
- Given the Admin console, when the operator creates, renames, enables, or disables a Subject or a Grade Level, then the change is persisted with one matching `AdminAudit` row and is reflected in the next read of the taxonomy with no restart or cache flush.
- Given a Subject–Grade Level mapping, when the operator enables or disables it, then `listSelectableSubjects(gradeLevelId)` immediately includes or excludes that Subject, and other Grade Levels' lists are unchanged.
- Given a consumer holding only the id of a Subject or Grade Level, when that item is later renamed or disabled, then resolving the id still succeeds and returns the current name — no consumer ever stores a copied label.
- Given an admin-scoped JWT is absent, expired, or lacks the admin audience, when any `/api/admin/*` route other than login is called, then the request is rejected before the handler runs.
- Given the web app, when the admin route group renders in light and in dark, then every colour comes from a token that defines both values, `palette.primary` is the Parent View accent while every other palette entry matches the base theme, and no MUI surface renders above elevation 0.
- Given a keyboard-only operator, when they tab through the taxonomy screen, then every control is a real focusable element with an accessible name, a 2px focus outline at 2px offset, and a hit area of at least 44px.
- Given a clean checkout, when `pnpm install && pnpm turbo run lint typecheck build test` is run with the compose Postgres up, then every task succeeds and the working tree contains no untracked build output that `.gitignore` does not cover.

## Design Notes

**Availability is three independent flags, resolved on read.** `Subject.enabled`, `GradeLevel.enabled`, and `SubjectGradeLevel.enabled` are stored separately and never denormalised; selectability is their conjunction, computed in one query. This is what makes "disable removes it from new selection but existing work is unaffected" fall out for free — nothing is cascaded, nothing is deleted.

**Audit and write share the caller's transaction client**, matching the cross-module convention the spine sets for `admin` → `identity` in story 2.2:

```ts
async renameSubject(actorId: string, id: string, name: string) {
  return this.prisma.withTransaction(async (tx) => {
    const before = await tx.subject.findUniqueOrThrow({ where: { id } });
    const after = await tx.subject.update({ where: { id }, data: { name, nameKey: key(name) } });
    await this.audit.record(tx, actorId, 'subject.rename', 'Subject', id, { from: before.name, to: after.name });
    return after;
  });
}
```

**Tokens are data, not CSS.** `tokens.ts` exports a plain object keyed exactly as DESIGN.md names them, with `light`/`dark` values; `theme.ts` maps that object onto the MUI palette and component overrides. The admin layout wraps children in a `ThemeProvider` whose callback clones the base theme and replaces `palette.primary` alone — asserting "only primary differs" is then a unit test, not a review step.

## Verification

**Commands:**
- `docker compose up -d postgres` -- expected: healthy `postgres:18.6-alpine` container
- `pnpm install --frozen-lockfile` -- expected: workspace resolves with pnpm 11.25.0
- `pnpm --filter api exec prisma migrate deploy` -- expected: initial migration applies cleanly
- `pnpm --filter api run seed` -- expected: exactly one `AdminUser`; re-running changes nothing
- `pnpm turbo run lint typecheck build` -- expected: all tasks pass
- `pnpm turbo run test` -- expected: all Tier-1 integration tests pass, including every I/O-matrix row
- `pnpm exec playwright test` -- expected: admin login and taxonomy specs pass
- `git status --porcelain` -- expected: no untracked build output outside `.gitignore`

## Spec Change Log

No spec amendments were required — review produced no `intent_gap` or `bad_spec` findings.

## Review Triage Log

### 2026-09-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 21: (high 1, medium 16, low 4)
- defer: 0
- reject: 20: (high 0, medium 4, low 16)
- addressed_findings:
  - `[high]` `[patch]` E2E global setup migrated, seeded and TRUNCATEd the **development** database `nts` instead of an isolated one, destroying local taxonomy and audit data on every Playwright run — residue found in `nts` confirms the loss actually occurred. Added a shared `siblingDatabaseUrl()` helper and moved the suite onto a dedicated `nts_e2e` database.
  - `[medium]` `[patch]` Concurrent create/rename/setAvailability raced past the read-then-write check and surfaced Prisma `P2002` as a 500 instead of the 409 the I/O matrix requires. Mapped `P2002` to `ConflictException`, moved the join row to `upsert`, added concurrency tests.
  - `[medium]` `[patch]` `x-correlation-id` was echoed and logged unvalidated; a CR/LF value made `setHeader` throw. Now gated on a bounded safe pattern, otherwise a fresh id is minted.
  - `[medium]` `[patch]` `ADMIN_JWT_TTL_SECONDS`, `API_PORT` and `ADMIN_JWT_SECRET` were consumed unvalidated (`NaN` expiry, random port, placeholder secret accepted). Added fail-fast boot validation.
  - `[medium]` `[patch]` A failed create/rename wiped the operator's typed input because the page's `run()` swallowed the error and resolved normally. `run()` now reports failure and the draft survives.
  - `[medium]` `[patch]` Availability checkboxes desynchronised from the server on a failed toggle and allowed duplicate out-of-order writes. Added in-flight tracking, pending-disabled controls, and resync on failure.
  - `[medium]` `[patch]` The admin guard accepted a verified token without checking `sub`/`email`, allowing an audit row with an undefined actor. Claims are now validated.
  - `[medium]` `[patch]` `admin-api.ts` touched `localStorage` unguarded (throws during prerender and in private mode), dropped headers when passed a `Headers` instance, and double-slashed a trailing-slash API base. All three fixed.
  - `[medium]` `[patch]` `turbo.json` declared `dependsOn: ["^build"]`, so `turbo run test` on a clean checkout failed before `prisma generate` ran. Added a `db:generate` task the other tasks depend on, and registered the missing env vars in `globalEnv`.
  - `[medium]` `[patch]` `bootstrap()` and the seed's `main()` had no `.catch`, so a missing env var or unreachable database produced a silent unhandled rejection and a zero exit code. Both now log and exit non-zero.
  - `[medium]` `[patch]` `/api/health` returned a static `ok` while Playwright used it as the API readiness gate, so E2E could start against a dead database. It now runs a real query and reports 503 when the database is down.
  - `[medium]` `[patch]` The seed rewrote an existing operator's password hash on every run, silently reverting a rotated credential. It is now create-only.
  - `[medium]` `[patch]` Two admin theme instances existed — the unit test asserted against one, the app rendered the other — and `useAdminToken` was dead, non-hook code. Collapsed to one theme; dead export removed.
  - `[medium]` `[patch]` A failed initial taxonomy load stranded the operator in a `role="status"` region with no retry. Now `role="alert"` with a working retry control.
  - `[medium]` `[patch]` Name normalisation accepted whitespace-only names and let Unicode/whitespace variants coexist as distinct items. Added NFKC normalisation, whitespace collapse, and service-boundary rejection.
  - `[medium]` `[patch]` Both vitest configs matched only `*.spec.ts`, so a future `.tsx` test would be silently uncollected while the run still reported success. Patterns widened.
  - `[medium]` `[patch]` `POST /api/admin/auth/login` had no brute-force protection despite argon2 making a login flood a CPU DoS (AD-23), and failed sign-ins left no audit trail. Added a named throttler and an `auth.signIn.failed` audit row with an unchanged response body.
  - `[medium]` `[patch]` Nine acceptance-criterion behaviours had no test that could fail: wrong-scope and no-scope tokens carrying the correct audience, expired tokens, the argon2 equal-cost enumeration defence, correlation-id echo and replacement, `ValidationPipe` rejection, `JsonLogger` redaction, the web status-to-copy mapping, both session-expiry redirect branches, and a keyboard test that pressed Tab exactly once. Tests grew from 18 API / 8 web / 3 E2E to 59 / 16 / 7; `theme.spec.ts`'s tautological assertion was replaced.
  - `[low]` `[patch]` Dead and contradictory `.swcrc`, workspace version drift in `pg`/`dotenv`/`@types/pg`, and byte-identical `test`/`test:int` scripts — all reconciled.
  - `[low]` `[patch]` `MuiPaper`'s blanket 1px border double-bordered outlined Alerts, Menus and Tooltips. Moved to `MuiCard`.
  - `[low]` `[patch]` An already-authenticated operator opening `/admin/login` was shown the sign-in form. Now redirected to the taxonomy screen.

### 2026-09-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 5, low 3)
- defer: 7: (high 0, medium 0, low 7)
- reject: 11: (high 0, medium 3, low 8)
- addressed_findings:
  - `[medium]` `[patch]` `apps/api/prisma/seed.ts` accepted `ADMIN_SEED_PASSWORD` with no minimum length, so a trivially short credential would seed silently. Extracted a testable `requireSeedPassword`/`seedOperator` pair and added a minimum-length check (the documented `change-me-too` dev/test default is deliberately still accepted, since it's what this workspace's own E2E suite signs in with).
  - `[medium]` `[patch]` The taxonomy page's `run()` silently swallowed a session-expiry (401) on its post-failure recovery reload, leaving the operator stranded on a stale screen instead of redirecting to sign-in. The recovery reload's catch now redirects on 401 the same way the primary path does.
  - `[medium]` `[patch]` `apps/api/src/common/env.ts`'s fail-fast boot validation (`requireJwtSecret`, `requireIntEnv`, `requirePortEnv`) had no test exercising any failure branch, so a regression reintroducing the placeholder-secret or `NaN`-TTL bug it was built to prevent would go undetected. Added `env.spec.ts` covering every rejection path.
  - `[medium]` `[patch]` The seed script's create-only guarantee (never reverting a rotated operator password on re-run) had no test; only a fresh-database path was ever exercised. Added `seed.int-spec.ts` asserting a rotated hash survives a re-seed with the original password.
  - `[medium]` `[patch]` `resolveSubject`/`resolveGradeLevel` GET routes (`/api/admin/taxonomy/subjects/:id`, `/grade-levels/:id`) were only exercised at the service layer, never over HTTP, so a controller-wiring regression on those two routes could ship undetected. Added a REST-level test covering both, including the disabled-row and unknown-id cases.
  - `[low]` `[patch]` The failed-sign-in audit write ran unguarded inside `signIn()`; a transient DB failure while recording it would surface as a 500 instead of the intended 401, since the audit write has no data of its own to roll back. Wrapped it in try/catch.
  - `[low]` `[patch]` The failed-sign-in audit trail was only tested for a known email with a wrong password; the unknown-email branch (audited under `ANONYMOUS_ACTOR`) was unverified. Added a matching test.
  - `[low]` `[patch]` No test simulated a failed availability toggle, so the checkbox's resync-to-server-truth behaviour (added in the prior review pass) was unverified. Added a Playwright test that forces one write to fail and asserts the control resyncs to the still-disabled server state, then succeeds on retry.

Reject notes (no code change; out of the intent's own scope or unsubstantiated on inspection): reverse-proxy/`trust proxy` throttling and response security headers (production-deploy hardening this story explicitly excludes); an audit-log read UI (never an acceptance criterion); the prior pass's rejected-findings list not being itemised (documentation style, not a defect); missing README/CI (deploy-pipeline scope, excluded); a speculative future `P2002` collision on `setAvailability` (no second unique index exists); the intent-alignment auditor's claim that focus-ring/hit-area checks are structural-only (verified false — `admin-taxonomy.spec.ts` already asserts computed `outlineWidth`/`outlineOffset`/box size across the full tab order); no lint enforcing the copy-module convention (not required); and the auditor's test-count-inflation claim (unsubstantiated — `it.each` expansion plausibly accounts for the difference).

### 2026-09-23 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 2, low 4)
- defer: 0
- reject: 15: (high 0, medium 1, low 14)
- addressed_findings:
  - `[high]` `[patch]` A 401 on a taxonomy write (or on the reload that follows one) redirected to `/admin/login` but never cleared the stored token, so the login page's already-signed-in check bounced the operator straight back to `/admin/taxonomy` — an expired session became an unbreakable redirect loop the operator could only escape by manually clearing browser storage. All three 401 branches in `apps/web/src/app/admin/taxonomy/page.tsx` now call `clearToken()` before redirecting; added an e2e test that forces a 401 on a write and asserts the redirect actually lands and sticks. (Root-caused only after adding the verification-gap reviewer's suggested test exposed the loop live.)
  - `[medium]` `[patch]` `SignInDto.email` had no `@Transform` to trim, so a pasted email with leading/trailing whitespace failed `@IsEmail()` and the operator got a generic 400 instead of signing in normally. Added the same trim pattern already used elsewhere in the DTOs.
  - `[medium]` `[patch]` `requireSeedPassword` checked a minimum length but not the `SignInDto` password's 256-character maximum, so a seeded operator password longer than that would seed successfully yet never be able to sign in. Added a matching maximum-length check.
  - `[low]` `[patch]` `app-setup.ts` set `enableCors({ credentials: true })` although admin auth is bearer-token-only, needlessly widening cross-origin credential exposure with no corresponding benefit. Set to `credentials: false`.
  - `[low]` `[patch]` `.env.example` documented every admin/database/web env var but omitted the four rate-limit vars (`API_RATE_LIMIT`, `API_RATE_TTL_MS`, `AUTH_RATE_LIMIT`, `AUTH_RATE_TTL_MS`) that `app.module.ts` reads and `turbo.json` lists in `globalEnv`, leaving an operator no documented way to discover or tune them. Added with their code defaults.
  - `[low]` `[patch]` `TaxonomyList`'s rename form could still be submitted (via Enter) while that same row's enable/disable write was in flight; `withPending`'s guard silently swallowed the resulting no-op, leaving the operator with a save that visibly did nothing. Added the same `isPending` guard the button already had to the form's submit handler.
  - `[low]` `[patch]` No test ever clicked the Sign-out button — the existing keyboard test only asserted focus reached it — so a broken handler (stale token retained, or a wrong/no redirect) would ship undetected. Added an e2e test that clicks it and asserts both the token is cleared and the page lands on `/admin/login`.

Reject notes (no code change; out of the intent's own scope or not a real defect on inspection): storing the admin JWT in `localStorage` rather than an `httpOnly` cookie (a reasonable, common SPA pattern the intent never specifies against; not this story's call to change unilaterally); the rate limiter's lack of `trustProxy` configuration and the taxonomy screen's un-throttled reload-after-write pattern (production-deployment topology, excluded by the intent's own "Never" list); no component-level unit tests for the React admin components (e2e coverage already exercises them; not a defect); no README or CI workflow (deploy-pipeline/tooling scope, excluded); duplicated validation shape between `CreateTaxonomyItemDto` and `RenameTaxonomyItemDto` (cosmetic, not a defect); `setAvailability` writing an audit row on a same-state call (matches the intent's literal "every admin write emits one audit row" — the call is the write); no minimum password-complexity policy beyond length (out of scope — one operator, seeded out of band, no self-service signup); `AdminAuditService`'s `detail` payload having no enforced size bound (speculative, no growth path exists in this story's writes); no in-product UI or endpoint to read `admin_audit` rows (never an acceptance criterion); `compose.yml`'s Postgres volume mount not pinning `PGDATA` explicitly (works correctly; the "implicit dependency" is theoretical); `apps/api/prisma/seed.ts` resolving `.env` via `process.cwd()` instead of `import.meta.dirname` (verified correct on inspection — `tsc`'s `.seed/` build output sits at a different depth than the source tree, so `import.meta.dirname` actually breaks the seed script from its real invocation path; attempted this as a patch, confirmed the regression by running `pnpm --filter api run seed`, and reverted); the base theme's default accent being internally named "Student" (confirmed against `reconcile-ux.md`'s "`comfortable` (Student) / `compact` (Parent, Admin)" density split — this is the spec's own pre-existing base-theme identity, not an invented fourth accent); the seed script's documented dev/test default password (matches the intent's own "seeded out of band," which this workspace's E2E suite depends on); and the admin rate-limit/`me` endpoint surface being unaccounted for in the intent excerpt alone (grounded in AD-23 per `reconcile-ux.md` and `review-child-data.md`, which name the admin login as needing AD-23's throttle explicitly).

## Auto Run Result

**Summary:** This run performed a follow-up review pass of the already-implemented Subject & Grade Level taxonomy story. Four independent reviewers (blind hunter, edge-case hunter, verification-gap, intent-alignment auditor) examined the full diff since `baseline_revision`. Seven trivially-fixable defects were patched; one of them (a missing e2e test for a 401 during a write) led to discovering and fixing a real high-severity bug: an expired/invalidated session bounced the operator in an infinite redirect loop between `/admin/login` and `/admin/taxonomy` instead of landing on sign-in, because the token was never cleared on a 401. Fifteen other findings were rejected as either out of this story's scope (per the intent's own "Never"/"Block If" boundaries), already correct on inspection against the architecture docs, or not real defects.

**Files changed with one-line descriptions:**
- `apps/web/src/app/admin/taxonomy/page.tsx` — `clearToken()` now runs before every 401-triggered redirect to `/admin/login`, closing an infinite redirect loop.
- `apps/api/src/admin/dto/sign-in.dto.ts` — email is now trimmed before `@IsEmail()` validation.
- `apps/api/prisma/seed.ts` — `requireSeedPassword` now also rejects a password over the DTO's 256-character maximum.
- `apps/api/src/app-setup.ts` — CORS `credentials` set to `false` (bearer-token auth doesn't use cookies).
- `.env.example` — documented the four rate-limit env vars already read by `app.module.ts`.
- `apps/web/src/app/admin/_components/TaxonomyList.tsx` — rename form submit now ignores Enter while that row's other write is in flight.
- `e2e/tests/admin-taxonomy.spec.ts` — added a Sign-out click test and a mid-session-401-on-write test.

**Review findings breakdown:** 7 patched (1 high, 2 medium, 4 low), 0 deferred, 15 rejected (1 medium, 14 low).

**Follow-up review recommendation:** `true` — this pass patched one `high`-severity finding, which alone triggers a follow-up review regardless of the medium/low score (`3×2 + 1×4 = 10`, also ≥ 5).

**Verification performed:**
- `pnpm turbo run lint typecheck test build` — all tasks passed (lint, typecheck, unit/integration tests for `api` and `web`, and both production builds).
- `pnpm --filter api run seed` — re-verified create-only, exactly one `AdminUser`, after reverting the `seed.ts` path-resolution patch attempt.
- `pnpm exec playwright test` (full rebuild of `apps/web` and `apps/api` first, so the e2e run exercised the patched code, not a stale build) — all 10 specs passed, including the two newly added ones.
- `git status --porcelain` — clean aside from this spec file and the pre-existing, intentionally-untouched `deferred-work.md`.

**Residual risks:** None blocking. Rejected-but-real architectural questions (JWT storage in `localStorage`, no `trustProxy` handling for a future reverse proxy, no audit-log read UI) remain as documented trade-offs the intent doesn't require this story to resolve.

