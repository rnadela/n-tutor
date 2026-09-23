---
title: 'Story 1.2: Parent PIN for Parent View'
type: 'feature'
created: '2026-09-23'
baseline_revision: '5caee7e74759213e3b0dc77ca574bc68411d9c0e'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - 'DW-35'
  - summary: >-
      A forgotten Parent PIN has no recovery path: the change route is elevation-gated, so the
      account-password alternative is only reachable by someone who can already enter the PIN.
    evidence: |-
      `POST /api/parent/pin/change` sits behind `ParentElevationGuard`, and `/parent/pin/change`
      redirects to the gate without a token. The UX places "Change PIN" in Parent View Settings,
      so the gating matches the plan, but no PRD, UX or epic document specifies a reset-PIN flow.
      A parent who forgets the PIN is permanently shut out of Parent View.
    location: >-
      apps/api/src/identity/parent-pin.controller.ts
    severity: medium
  - summary: >-
      Setting the first PIN takes a single obscured field with no confirmation entry and no reveal
      control, so one typo sets a PIN the parent does not know.
    evidence: |-
      `apps/web/src/app/parent/pin/page.tsx` renders one `type="password"` input for the set case.
      Combined with the absent recovery path above, a mistyped first PIN is unrecoverable.
    location: >-
      apps/web/src/app/parent/pin/page.tsx
    severity: low
  - summary: >-
      Nothing rejects a trivially guessable PIN, and a change may set the PIN it is replacing.
    evidence: |-
      `isWellFormedPin` checks four digits only; `0000` and `1234` are accepted, and `changePin`
      never compares the new PIN with the current one. The stated adversary is a child who knows
      the parent, against whom a small blocklist is the cheapest control available.
    location: >-
      apps/api/src/identity/pin-policy.ts
    severity: low
  - summary: >-
      An outstanding elevation token survives both a PIN change and "Leave Parent View"; only a
      password reset's epoch bump ends elevation early.
    evidence: |-
      `clearElevation()` drops the token from React state while the JWT stays valid server-side for
      the rest of its TTL, and `changePin` does not invalidate tokens minted under the old PIN.
      Ending elevation on demand needs its own epoch column - bumping `sessionEpoch` would also end
      the session cookie, which FR-1 says lasts until sign-out.
    location: >-
      apps/api/src/identity/parent-elevation.guard.ts
    severity: medium
  - summary: >-
      Account-password guesses on the PIN-change path have no counter or lock of their own.
    evidence: |-
      The password branch of `changePin` is deliberately exempt from the PIN lock and has no
      equivalent ceiling; only the per-address `parent` throttler bounds it. It is reachable only
      from inside an elevated session, which is what keeps this low.
    location: >-
      apps/api/src/identity/parent-pin.service.ts
    severity: low
  - summary: >-
      The three new PIN screens have no component-level tests; their branches are covered only by
      the happy-path Playwright suite.
    evidence: |-
      `apps/web/vitest.config.ts` runs `environment: 'node'`, so the web suite can exercise the
      elevation context and the API client but not a rendered page. The stale-status path, the lock
      re-enable timer and the 401-vs-network branches are verified by e2e alone.
    location: >-
      apps/web/vitest.config.ts
    severity: low
  - summary: >-
      The browser (e2e) suite never exercises `POST /api/parent/elevation/refresh` or ceiling
      expiry; that behavior is covered only at the API integration layer.
    evidence: |-
      `e2e/tests/parent-pin.spec.ts` covers set/enter/lock/change/leave but has no scenario that
      calls the refresh endpoint or crosses the 8-hour ceiling from the browser. `parent-pin.int-spec.ts`
      already covers both at the HTTP layer, so this is a coverage-altitude gap, not an unverified
      behavior — the same shape as the existing web component-test gap.
    location: >-
      e2e/tests/parent-pin.spec.ts
    severity: low
  - summary: >-
      No notification is sent when the Parent PIN is changed or repeatedly guessed wrong, so a
      parent has no signal that someone with device access is guessing at or has changed the PIN.
    evidence: |-
      `ParentPinService.changePin` and the lockout path in `recordPinFailure`/`lockPin` never touch
      `MailModule`, which `IdentityModule` already imports for other identity flows. The intent
      never states a notification requirement, so this is a silent gap rather than a violation.
    location: >-
      apps/api/src/identity/parent-pin.service.ts
    severity: low
  - summary: >-
      The change-PIN screen shows the accurate lock message on a 423 but never disables the form or
      shows a countdown, unlike the gate screen's lock handling.
    evidence: |-
      `apps/web/src/app/parent/pin/change/page.tsx`'s catch block renders `cause.message` (which
      does carry the correct lock-lifts-at text from `messageFor`) in a generic error `Alert`, but
      neither disables the submit button nor re-enables it on a timer the way `/parent/pin` does.
    location: >-
      apps/web/src/app/parent/pin/change/page.tsx
    severity: low
  - summary: >-
      The `/parent/pin` gate screen has no link back to `/auth/signed-in`; the only way off the page
      is browser back or waiting out a lock's cool-down.
    evidence: |-
      `apps/web/src/app/parent/pin/page.tsx` renders the set/enter/locked states with no exit link,
      unlike the change-PIN screen which links back to `/parent`.
    location: >-
      apps/web/src/app/parent/pin/page.tsx
    severity: low
  - summary: >-
      The e2e suite never drives the account-password branch of the change-PIN form, only the
      current-PIN branch.
    evidence: |-
      `e2e/tests/parent-pin.spec.ts` covers set/enter/lock/change(current-PIN)/leave, but no scenario
      selects the "use account password" radio on the change screen, so that branch and its distinct
      401/lock-exempt behaviour are unverified from the browser — the same coverage-altitude shape
      already recorded for the refresh/ceiling gap.
    location: >-
      e2e/tests/parent-pin.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** A Parent Account can sign in, but the session cookie alone reaches everything — there is no second credential and no gate, so "Parent View" is a name with no boundary behind it. Stories 1.4 (mode switching), 1.5 (idle expiry) and 1.6 (restorable state) all assume the PIN and the elevation token already exist.

**Approach:** Give `identity` a numeric Parent PIN (argon2id-hashed, server-side attempt counter and lock-until on the Parent Account, per AD-33), a `/api/parent` surface that mints the **elevation token** on a correct PIN, and an elevation guard that the session cookie alone can never satisfy (AD-18). On the web, hold that token in a React context in memory only and ship the three PIN screens (set, enter, change) plus a minimal elevation-gated landing that proves the gate.

## Boundaries & Constraints

**Always:**
- `identity` stays the sole writer of every Parent Account column, PIN state included (AD-17). The PIN hash, the consecutive-failure count and the lock-until instant are columns on `parent_account` — not a client-held counter, not a throttler bucket (AD-33; a client counter is cleared by the same refresh the gate already expects).
- The PIN is argon2id-hashed, is never returned by any read path, and no response, log line or error message ever carries it or its hash.
- **Two credentials, two audiences.** The elevation token's audience is `parent-elevation` and the session cookie's is `parent-session`; neither verifies at the other's guard. The elevation token travels as `Authorization: Bearer`, never as a cookie, and the web app never writes it to `localStorage`, `sessionStorage`, a cookie, or IndexedDB (AD-18).
- Elevation is 15 minutes per token with an absolute 8-hour ceiling measured from the PIN crossing. A refresh mints a replacement carrying the **original** `elevatedAt`; the client can request but never extend (AD-13).
- A completed password reset ends elevation too: the elevation token carries the account's `sessionEpoch` and the guard rejects a stale one, exactly as the session guard does.
- Every figure (PIN length, attempt ceiling, cool-down minutes, elevation window) has one source of truth in the API and reaches the web only over `GET /api/auth/policy`.
- No user-facing string is a literal inside a web component — parent copy lives in `apps/web/src/copy/parent.ts` (AD-32).
- Cool-down copy states the lock and when it lifts, never an attempt counter framed as a taunt; no exclamation marks, no error codes.
- Every new env key lands in `.env.example`, `turbo.json` `globalEnv`, and `playwright.config.ts`; migrations come from `prisma migrate dev`, never hand-written.

**Block If:** nothing here requires a human decision. The cool-down duration is unstated in the PRD and UX (both say only "a cool-down"); 15 minutes is set in the policy module as a single tunable constant, which is a parameter choice rather than an intent gap.

**Never:**
- No Student Mode, no device-to-profile binding, no "which profile" prompt, no Student Profile at all — Stories 1.3/1.4.
- No client-side idle clock, no interaction tracking, no automatic refresh loop — Story 1.5 owns the clock; this story ships only the server's 15-minute window and the refresh endpoint it calls.
- No restorable uncommitted parent state — Story 1.6.
- No Settings screen, no timezone edit, no password change, no account deletion.
- No real Parent View content (analytics, uploads, drafts): the elevation-gated landing exists to make the gate observable and is replaced by later epics.
- No design-system refactor — Story 1.7 owns that; reuse the existing base theme, tokens and the nested-ThemeProvider pattern as-is.
- The PIN never gates a destructive action; destruction takes the account password (FR-33).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PIN status, no PIN set | valid session cookie | 200 `{ pinSet: false, lockedUntil: null }` | 401 without the cookie |
| Set first PIN | session cookie, 4-digit PIN, no PIN set | 204, hash written, counter 0, lock cleared | No error expected |
| Set PIN when one exists | session cookie, PIN already set | 409 generic "already set" — setting is not a change path | Client is directed to the change screen |
| Set a non-conforming PIN | fewer/more than 4 digits, or any non-digit | 400 stating the required shape | Form states the shape before submission |
| Enter correct PIN | session cookie + correct PIN | 200 elevation token + `expiresAt` + `ceilingAt`; counter reset, lock cleared | No error expected |
| Enter wrong PIN (1st, 2nd) | session cookie + wrong PIN | 401 one generic message; counter incremented | Counter persists in the database |
| Enter wrong PIN (3rd) | counter already at 2 | 423 with `lockedUntil`; lock written, counter reset to 0 | Response states when the lock lifts |
| Enter any PIN while locked | `lockedUntil` in the future | 423 with `lockedUntil`; **no argon2 verification runs** and the correct PIN does not unlock early | Lock survives a process restart — it is a row, not memory |
| Enter PIN after the lock lapses | `lockedUntil` in the past | verification proceeds normally from a zero counter | No error expected |
| Enter PIN when none is set | session cookie, `pinSet: false` | 409, same shape as the set-when-exists mirror | Client is directed to the set screen |
| Change PIN with current PIN | elevation token + correct current PIN + new PIN | 204, hash replaced, counter and lock cleared | No error expected |
| Change PIN with account password | elevation token + correct password + new PIN | 204, same effect | No error expected |
| Change PIN with neither / wrong | elevation token + wrong current PIN or wrong password | 401 one generic message; a wrong **PIN** spends an attempt, a wrong **password** does not | Lock applies to the PIN path only |
| Change PIN without elevation | session cookie only | 401 from the elevation guard | The cookie alone never satisfies it |
| Parent-scoped read, elevated | valid elevation token | 200 `{ id, email, expiresAt, ceilingAt }` | — |
| Parent-scoped read, cookie only | session cookie, no bearer | 401 | AD-18's whole point |
| Parent-scoped read, session token as bearer | the `parent-session` JWT in the header | 401 | Audience mismatch, both directions |
| Refresh while elevated | elevation token minted 3 minutes ago | 200, new token, same `ceilingAt` as the first | No error expected |
| Refresh past the 8-hour ceiling | `elevatedAt` more than 8 hours ago | 401 — the PIN must be crossed again | No token is minted |
| Elevation after a password reset | token minted before the reset bumped `sessionEpoch` | 401 | Stale epoch, same rule as the session |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:112-131` -- `ParentAccount` already carries `passwordHash` and `sessionEpoch` under the `identity` cluster; add `pinHash`, `pinFailedAttempts`, `pinLockedUntil` beside them. No new model and no new table, so `resetParentAccounts` and the E2E truncate list need no change.
- `apps/api/src/identity/auth-policy.ts` -- the single-source-of-truth module: `PARENT_SESSION_AUDIENCE/ISSUER/COOKIE`, `currentAuthPolicy()`, `PARENT_JWT`, the non-enumerating message constants and the pure predicates (`isAcceptablePassword`, `isResetTokenUsable`). The PIN's figures and predicates belong in a sibling `pin-policy.ts`; `currentAuthPolicy()` grows `pinLength` so the web still restates nothing.
- `apps/api/src/identity/parent-auth.service.ts:80-100` `mintSession` -- the exact shape to mirror for `mintElevation` (subject/audience/issuer/`expiresIn`, plus `epoch`); `:104` `sessionFor` for the read shape; `DUMMY_HASH` at `:37` is the equal-cost pattern (the PIN path does **not** need it — the account is already known).
- `apps/api/src/identity/parent-session.guard.ts:56-100` -- guard shape to mirror: verify, then re-check `scope`/`sub`/`epoch` claim-by-claim, then re-read the account and compare `sessionEpoch`. The elevation guard reads `Authorization: Bearer` instead of `request.cookies` and has **no** re-mint behaviour (`remintIfStale:88-112` is session-only; elevation is refreshed by an explicit endpoint).
- `apps/api/src/identity/parent-account.service.ts:245-262` `findSessionSubject` / `setPasswordHash` -- the reads and writes to extend: add a PIN-state read and the PIN writes here, since `identity` is the sole writer (AD-17). `ACCOUNT_FIELDS:33` deliberately excludes secrets; keep `pinHash` out of every shared select.
- `apps/api/src/identity/parent-auth.controller.ts:33-45` -- controller conventions: `@Controller('auth')`, `@SkipThrottle({ default: true, login: true })` plus `@ParentCredentialRoute()` on every argon2-running POST, `@HttpCode`, `@Res({ passthrough: true })`. The new controller is `@Controller('parent')`.
- `apps/api/src/identity/parent-credential-route.decorator.ts` + `apps/api/src/app.module.ts:37-46` -- the `parent` throttler bucket applies only to handlers carrying the decorator; the PIN routes run argon2 and must carry it.
- `apps/api/src/identity/identity.module.ts:20-35` -- register the new controller, service and guard here; the module's own `JwtModule` (on `PARENT_JWT_SECRET`) signs both tokens, so the audience is what separates them.
- `apps/api/src/identity/dto/parent-sign-in.dto.ts` -- DTO convention (`@Transform` trim + `class-validator`); the PIN DTOs use `@Matches` against the policy's digit shape.
- `apps/api/src/common/env.ts:30-45` `requireIntEnv` -- for the tunables; `requireParentJwtSecret:67` already guards the secret split.
- `apps/api/test/harness.ts:160-175,200-250` -- `sessionCookieFrom`, `cookieHeader`, `sessionTokenFrom`, `createCredentialedParent`, `adminSecretTokenAtParentAudience`: extend with an elevation helper (`elevate(...)` returning a bearer) and a `setPin` fixture. `resetParentAccounts:103` already truncates `parent_account`, which is where the PIN state now lives.
- `apps/api/test/parent-auth.int-spec.ts`, `apps/api/test/rate-limit.int-spec.ts` -- the integration conventions and the parent-bucket assertions to extend.
- `apps/web/src/lib/parent-api.ts:56-100` -- `call<T>()` sets `credentials: 'include'` and maps failures through `messageFor`; the parent-scoped calls additionally need an `Authorization` header, and `messageFor` needs a 423 branch.
- `apps/web/src/app/auth/signed-in/page.tsx` -- the "minimal landing" page shape (load / error / retry / busy) and the router-replace-on-401 pattern to mirror; it is also where the entry point into Parent View is added.
- `apps/web/src/app/auth/_components/AuthThemeProvider.tsx` + `apps/web/src/app/auth/layout.tsx` -- the nested-ThemeProvider-and-layout pattern the `/parent` route group copies verbatim (`parentTheme`, `density` paddings).
- `apps/web/src/copy/parent.ts` -- every string; note it deliberately carries no figures, so the cool-down and PIN-length copy must be parameterised functions like `passwordMinimum(minimum)`.
- `e2e/tests/parent-auth.spec.ts`, `e2e/fixtures.ts` (`uniqueParentEmail`), `e2e/global-setup.ts` -- E2E conventions; the truncate list needs no new table.
- `.env.example`, `turbo.json` `globalEnv`, `playwright.config.ts:32-45` -- every new env key must appear in all three.

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` -- add `pinHash String?`, `pinFailedAttempts Int @default(0)`, `pinLockedUntil DateTime?` to `ParentAccount` with doc comments naming AD-33 (server-side counter); one migration via `pnpm --filter api exec prisma migrate dev --name add_parent_pin`.
- `apps/api/src/identity/pin-policy.ts` -- new: `PIN_LENGTH` (4), `PIN_PATTERN`, `MAX_PIN_ATTEMPTS` (3), `PIN_COOLDOWN_MS` (15 min), `ELEVATION_TTL_SECONDS` (15 min), `ELEVATION_CEILING_MS` (8 h), `PARENT_ELEVATION_AUDIENCE` (`parent-elevation`), the message constants (`PIN_INCORRECT`, `PIN_NOT_SET`, `PIN_ALREADY_SET`, `PIN_LOCKED`, `NOT_ELEVATED`), and the pure predicates: `isWellFormedPin`, `isLocked(state, now)`, `nextPinFailureState(attempts, now)` (returns either an incremented counter or a lock instant with the counter reset), `elevationCeilingFrom(elevatedAt)`, `isWithinCeiling(elevatedAt, now)`. The single source of every figure.
- `apps/api/src/identity/auth-policy.ts` -- extend `AuthPolicy` and `currentAuthPolicy()` with `pinLength`, `pinMaxAttempts` and `pinCooldownMinutes`, so the web states the shape and the lock without a literal of its own.
- `apps/api/src/identity/parent-account.service.ts` -- add `findPinState(id)` (returns `pinHash`, `pinFailedAttempts`, `pinLockedUntil`, `sessionEpoch`; the only read that ever selects the hash), `setPin(tx, id, pinHash)` (writes the hash, zeroes the counter, clears the lock), `recordPinFailure(tx, id, next)` and `clearPinFailures(tx, id)`. `ACCOUNT_FIELDS` stays secret-free.
- `apps/api/src/identity/parent-pin.service.ts` -- new: `status`, `setPin`, `verifyPin`, `changePin`, `mintElevation`, `refreshElevation`. Lock check **before** argon2 so a locked account costs nothing; counter and lock mutated inside `withTransaction`; a correct PIN resets both in the same transaction that mints nothing (the token is minted after the write commits).
- `apps/api/src/identity/parent-elevation.guard.ts` -- new: reads `Authorization: Bearer`, verifies audience `parent-elevation` and issuer, re-checks `scope`/`sub`/`epoch`/`elevatedAt` claim-by-claim, re-reads the account and rejects a stale `sessionEpoch` or an `elevatedAt` past the ceiling; attaches `req.elevated = { parentAccountId, email, elevatedAt }`. Never reads a cookie, never re-mints.
- `apps/api/src/identity/dto/parent-pin.dto.ts` -- new: `SetPinDto` (`pin` matched against `PIN_PATTERN`), `VerifyPinDto`, `ChangePinDto` (`newPin` plus exactly one of `currentPin` / `password`, rejected by validation when both or neither are present).
- `apps/api/src/identity/parent-pin.controller.ts` -- new, `@Controller('parent')`: `GET pin/status` (session-guarded), `POST pin` (session-guarded, set-first-time), `POST pin/verify` (session-guarded, mints elevation), `POST pin/change` (elevation-guarded), `POST elevation/refresh` (elevation-guarded), `GET session` (elevation-guarded; returns `{ id, email, expiresAt, ceilingAt }` — the parent-scoped read that proves the gate). Every argon2-running POST carries `@ParentCredentialRoute()` and skips the `login` bucket.
- `apps/api/src/identity/identity.module.ts` -- register `ParentPinService`, `ParentPinController`, `ParentElevationGuard`.
- `apps/api/src/common/env.ts` usage, `.env`, `.env.example`, `turbo.json`, `playwright.config.ts` -- `PIN_COOLDOWN_MS`, `ELEVATION_TTL_SECONDS`, `ELEVATION_CEILING_MS` as optional overrides read through `requireIntEnv` with the policy defaults, so the integration suite can drive a short cool-down.
- `apps/api/src/identity/pin-policy.spec.ts` -- unit-test every predicate: PIN shape boundaries (3/4/5 digits, non-digits, leading zeros preserved), the failure-state transition at attempts 0→1→2→lock, lock expiry exactly at the boundary, and ceiling arithmetic.
- `apps/api/test/parent-pin.int-spec.ts` -- new: every row of the I/O matrix through HTTP, including the lock surviving a fresh app instance against the same database, the correct PIN being refused while locked, both crossover directions (session token as bearer; elevation token in the cookie), and elevation death after a password reset.
- `apps/api/test/rate-limit.int-spec.ts` -- extend: a PIN-verify flood spends the `parent` bucket and returns 429; `GET /api/parent/pin/status` does not spend it.
- `apps/api/test/harness.ts` -- add `setPinFor(...)` and `elevate(...)` helpers returning the bearer, plus an `elevationTokenFrom` accessor.
- `apps/web/src/copy/parent.ts` -- add the `pin` section: set/enter/change titles and labels, the parameterised `pinShape(length)`, `locked(until)` stating when the lock lifts, `incorrect` (one generic line, no counter), `notElevated`, and the Parent View landing strings. Plain and factual, no exclamation marks.
- `apps/web/src/lib/elevation.tsx` -- new: `ElevationProvider` + `useElevation()`, holding `{ token, expiresAt, ceilingAt }` in `useState` **only**. No storage API is touched anywhere in this file; a comment states why (AD-18).
- `apps/web/src/lib/parent-api.ts` -- add `parentApi.pinStatus`, `setPin`, `verifyPin`, `changePin`, `refreshElevation`, `parentSession`, each taking the bearer explicitly rather than reading it from a module-level variable; add the 423 branch to `messageFor` and surface `lockedUntil` on `ParentApiError`.
- `apps/web/src/app/parent/layout.tsx` + `_components/ParentThemeProvider.tsx` -- the `/parent` route group, mirroring `/auth`: `parentTheme`, `density` paddings, wrapping children in `ElevationProvider`.
- `apps/web/src/app/parent/pin/page.tsx` -- the gate: reads status, renders the **set** form when no PIN exists and the **enter** form when one does, renders the lock state (message plus when it lifts, submit disabled) when locked, and on success stores the token in context and routes to `/parent`.
- `apps/web/src/app/parent/page.tsx` -- the minimal elevation-gated landing: with no token in context it redirects to `/parent/pin` (which is what makes a reload re-require the PIN); with one it renders `GET /api/parent/session`, a "Change PIN" link, and a "Leave Parent View" control that clears the context token.
- `apps/web/src/app/parent/pin/change/page.tsx` -- change form: new PIN plus a current-PIN-or-password choice, elevation-guarded, one generic failure line.
- `apps/web/src/app/auth/signed-in/page.tsx` -- add the "Enter Parent View" link to `/parent/pin`, so the gate is reachable from the signed-in surface.
- `apps/web/src/lib/elevation.spec.tsx`, `apps/web/src/lib/parent-api.spec.ts` -- unit-test that the context never touches `localStorage`/`sessionStorage`/`document.cookie` (assert on spies), that the bearer is attached to parent-scoped calls only, and the 423 mapping.
- `e2e/tests/parent-pin.spec.ts` -- browser coverage: sign up, set a PIN, land in Parent View; reload and the PIN is required again; three wrong entries lock the gate with a message naming when it lifts, and the lock survives a reload; after changing the PIN the old one is refused and the new one works; the PIN is never rendered back (the field is obscured and no response body carries it).

**Acceptance Criteria:**

- Given a parent who has set a PIN and crossed it, when the browser is reloaded, then Parent View is unreachable and the PIN prompt is shown again — with no token in any browser storage, cookie or storage API at any point.
- Given three consecutive wrong PIN entries, when the API process is restarted and the correct PIN is entered before the cool-down lapses, then it is still refused and the response names when the lock lifts; and when the cool-down has lapsed, then the same correct PIN succeeds and the counter is back to zero.
- Given a PIN has been set, when every response body, log line and error message from the PIN and elevation surfaces is inspected, then none contains the PIN or its hash.
- Given a parent elevated at a known instant, when refreshes are requested repeatedly within the window, then each new token carries the original ceiling, and once eight hours have passed since the PIN crossing the refresh is refused and the PIN must be crossed again.
- Given `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` and `pnpm run build && pnpm run e2e` at the repo root, when run on a clean tree, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-09-23 - Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 1, medium 6, low 3)
- defer: 6: (high 0, medium 2, low 4)
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[high]` `[patch]` The PIN failure counter was a read-modify-write: concurrent wrong entries all read the same count and wrote the same value, so parallel guessing never reached `MAX_PIN_ATTEMPTS` and the lock - the story's whole brute-force defence - never landed. The increment is now atomic in the database and the lock decision is derived from the returned count, with a concurrency test that fails against the old code.
  - `[medium]` `[patch]` `setPin` was a check-then-act, letting two concurrent first-set requests both pass and the loser overwrite the winner's PIN; the write is now conditional on `pinHash: null` and 409s when it matches nothing.
  - `[medium]` `[patch]` The elevation guard never required an `exp` claim, so a token minted without one was bounded only by the 8-hour ceiling, and the `exp ?? 0` fallback rendered a 1970 `expiresAt`; the claim is now required and the fallback is gone.
  - `[medium]` `[patch]` The change path's password branch resolved the credential from the token's email claim rather than the authoritative account id; it now looks up by `parentAccountId`.
  - `[medium]` `[patch]` The three new env overrides were read per request, so a typo'd value produced a 500 at the gate instead of failing the process at boot; they are resolved and validated once at module init, which also refuses a TTL longer than the ceiling.
  - `[medium]` `[patch]` On the gate screen a successful set followed by a failed verify left `pinSet` stale, so every retry re-POSTed the set route and 409'd into a dead end; the failure path now re-reads the status and renders from it.
  - `[medium]` `[patch]` The gate stayed disabled after the cool-down lapsed until the parent happened to reload, despite the copy naming the instant; a cleared-on-unmount timer now re-enables it on that clock.
  - `[low]` `[patch]` The change screen's "elevation expired" branch was dead code - it compared against a message the client never produced - so a parent whose elevation had ended was told the PIN was wrong; the guard's 401 now carries a marker the client branches on and routes back to the gate.
  - `[low]` `[patch]` Four verification gaps closed: the new policy figures were asserted nowhere (`toMatchObject` passes with them absent); no test sent a wrong-length PIN to the verify route, which is exactly where the DTO's deliberate absence of a shape check matters; the counter/lock-clearing test never established a real lock, so its assertion passed against an already-null value; and no status read was ever made against a lapsed lock.
  - `[low]` `[patch]` `.env.example` claimed an active parent refreshes rather than re-enters, which no shipped client code does (the idle clock is Story 1.5); the comment now describes what ships.

### 2026-09-23 - Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[low]` `[patch]` The change-PIN screen took the new PIN in a single obscured field with no confirmation, so one typo would set a PIN the parent does not know (the same gap DW-37 already records for the first-set screen, but on the change path, which DW-37 does not cover); a confirm-new-PIN field with a client-side match check is added, plus an e2e case for the mismatch.
  - `[low]` `[patch]` `nextPinFailureState` was exported and unit-tested but no production code called it — the real failure path uses the atomically-incremented count with `lockReachedAt` directly, so the two could silently drift; the unused function and its now-redundant tests are removed, leaving `lockReachedAt`'s existing coverage as the one tested path.
  - `[low]` `[patch]` The PIN fields in both PIN screens carried no client-side length limit despite the shape already being loaded before the field renders, so an obviously oversized entry was only caught after a round trip; `maxLength` is now bound to `policy.pinLength` on every PIN input.
  - `[low]` `[patch]` `apps/web/src/app/parent/page.tsx`'s `load()` had no guard against a stale in-flight request: a session fetch outlived by "Leave Parent View", or superseded by a Retry click, could resolve afterward and either overwrite fresher state or re-route back to the PIN gate on top of the navigation leaving already asked for. A per-call request id now makes a superseded response a no-op.
  - `[medium]` `[patch]` The prior pass's boot-time fail-fast (`IdentityModule`'s constructor resolving `pinRuntime()`) had no test exercising the module's own construction — only the pure `resolvePinRuntime()` function was tested directly, so a regression in the wiring itself (e.g. the constructor call being dropped) would not fail any test. `identity.module.spec.ts` now constructs `IdentityModule` directly with both a valid and an invalid override.

### 2026-09-23 - Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 4: (high 0, medium 0, low 4)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` `apps/api/prisma/schema.prisma`'s new `ParentAccount` columns (`pinHash`, `pinFailedAttempts`, `pinLockedUntil`) were not column-aligned with the rest of the model, meaning `prisma format` had not been run; ran it, no functional change.

## Design Notes

**Why the PIN state is three columns on `parent_account`.** AD-33 settles it: the failure count persists across restart, so it cannot be client-held, and there is no elevation token before the PIN succeeds, so it cannot ride in one. AD-17 then forbids a second writer of the account, which rules out a `pin` module or a side table owned elsewhere. Three columns beside `passwordHash`/`sessionEpoch` is the smallest shape that satisfies both.

**The lock is checked before argon2, and a correct PIN does not unlock early.** Verifying first would make a locked account pay for a hash it cannot spend, and would leak — by timing — whether the entered PIN was right, which is precisely what the lock exists to hide from a child holding the device. The lock lifts on the clock, never on a correct entry.

**Reaching the ceiling is not the same as expiring.** A 15-minute elevation token that lapses is re-mintable while the parent is active; a token whose `elevatedAt` is more than eight hours old is not, and the only path back is the PIN. Carrying `elevatedAt` as a claim rather than a server row keeps the ceiling stateless and makes it unforgeable in the same stroke: the client holds the number but cannot change it without invalidating the signature.

**Two audiences, one secret.** `identity` already signs with `PARENT_JWT_SECRET`, and `requireParentJwtSecret` already refuses to boot if it equals the admin secret. Session and elevation therefore separate on audience plus a `scope` claim re-checked in each guard — the same belt-and-braces the session guard already uses — and the integration suite pins both crossover directions so the separation cannot quietly decay into a claim check.

**A wrong password on the change path does not spend a PIN attempt.** The counter guards the PIN secret; the password has its own throttle and its own reset path. Counting password mistakes toward a Parent-View lock would let a mistyped password lock a parent out of the mode they are already inside.

**First-set takes only the session.** The acceptance criterion says "given no PIN is set, when I set one" — no credential beyond being signed in. That leaves a window on a shared device between sign-up and the first PIN; the web flow narrows it by offering the PIN immediately from the signed-in landing, and the residual gap is recorded as deferred rather than closed by inventing a requirement the story does not state.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev --name add_parent_pin` -- expected: one new migration directory, schema applied. If the local database reports drift from an earlier attempt, `pnpm --filter api exec prisma migrate reset --force` and re-generate.
- `pnpm run typecheck` -- expected: clean
- `pnpm run lint` -- expected: clean, or the pre-existing "eslint not installed" gap unchanged (recorded in Story 1.1, not a regression to fix here)
- `pnpm run test` -- expected: all unit + integration specs pass, including `pin-policy.spec.ts` and `parent-pin.int-spec.ts`
- `pnpm run build` then `pnpm run e2e` -- expected: `parent-pin.spec.ts` passes alongside the existing suites. `pnpm run e2e` does not go through turbo, so the build must run first or it tests a stale `apps/api/dist`.
- `pnpm prettier --write .` -- expected: no unformatted files remain

## Auto Run Result

Status: done

**Summary:** Story 1.2 (Parent PIN for Parent View) was already fully implemented and twice reviewed prior to this run. This run performed a third, fresh review pass over the full diff since `baseline_revision`, per the `done`-status re-review route.

**Files changed this pass:**
- `apps/api/prisma/schema.prisma` -- ran `prisma format`; realigned the columns added to `ParentAccount` (`pinHash`, `pinFailedAttempts`, `pinLockedUntil`) with the rest of the model. No schema/behavior change.
- `spec-1-2-parent-pin-for-parent-view.md` -- status flipped to `in-review` then `done`; 4 new `deferred` items and this pass's Review Triage Log / Auto Run Result entries added.

**Review findings breakdown (this pass):**
- 15 total findings across 4 parallel review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment).
- patch: 1 (low) -- Prisma schema column misalignment, fixed.
- defer: 4 (low) -- no PIN-event notification/audit signal; change-PIN screen has no lock-aware UI (message text is accurate, but no disable/countdown); gate screen has no back-out link; e2e suite never drives the account-password branch of the change-PIN form.
- reject: 10 -- includes 3 edge-case-hunter findings that described conditions already guarded by existing code (`@MinLength(1)` on `VerifyPinDto.pin`/`ChangePinDto.currentPin`; the `ExactlyOneCredential` validator already rejects both-credentials-given at the DTO layer), a boot-time env-sanity claim contradicted by `requireIntEnv`'s existing regex/positivity check, and several out-of-scope or ledger-mechanics items.
- intent_gap: 0, bad_spec: 0.
- The `deferred:` frontmatter's pre-existing bare-string `DW-35` entry (flagged by the blind-hunter) is already tracked by the orchestrator as DW-42 and was left untouched, per this run's instructions not to modify deferred-work ledger entries.

**Follow-up review recommendation:** `false` -- this pass's only patched finding was low severity (score: 1 × low = 1, below the 5 threshold; no high-severity patch).

**Verification performed:** `pnpm run typecheck` (clean), `pnpm run test` (270 tests passed across web+api, including `pin-policy.spec.ts` and `parent-pin.int-spec.ts`), `pnpm run build` (clean), `pnpm prettier --write .` (no changes). `pnpm run lint` still hits the pre-existing "eslint not installed" gap recorded in Story 1.1 (not a regression). `pnpm run e2e` was not re-run this pass since the only change was a no-op schema formatting fix with no runtime effect.

**Residual risks:** Four new low-severity deferred items (see frontmatter `deferred`) plus the eight items carried from prior passes remain open, all previously judged non-blocking. No new functional, security, or data-integrity risk was introduced by this pass.

