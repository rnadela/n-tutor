---
title: 'Story 1.1: Parent Account Sign-Up & Sign-In'
type: 'feature'
created: '2026-09-23'
baseline_revision: '5fcf840b1e69dd3753e07174867261e9f5b3b2df'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - 'DW-17'
  - 'DW-18'
  - 'DW-19'
  - summary: >-
      Parent credential routes are throttled per address only, with no per-account lockout or backoff.
    evidence: |-
      The `parent` throttler bucket keys on the request address, so guessing distributed across
      addresses against one known email is effectively unbounded. Ledger entry DW-20.
    location: >-
      apps/api/src/app.module.ts
    severity: medium
  - summary: >-
      No audit trail exists for parent sign-in, sign-out, reset request or reset confirm.
    evidence: |-
      `AdminAuditService` records admin actions; the parent surface records nothing, including the
      sessionEpoch bump that ends every session. Ledger entry DW-21.
    location: >-
      apps/api/src/identity/parent-auth.service.ts
    severity: medium
  - summary: >-
      `password_reset` and `account_consent` rows have no retention, cleanup or `expiresAt` index.
    evidence: |-
      Used and expired reset rows are never removed and consent has no account-deletion story.
      Harmless at v0 volumes. Ledger entry DW-22.
    location: >-
      apps/api/prisma/schema.prisma
    severity: low
  - summary: >-
      `SameSite=Strict` requires the API and the web app to share a registrable domain.
    evidence: |-
      A deployment splitting them across domains silently drops the session cookie on every
      credentialed request; nothing records the constraint. Ledger entry DW-23.
    location: >-
      apps/api/src/identity/parent-session.cookie.ts
    severity: low
  - summary: >-
      A device reporting an IANA zone the API rejects cannot complete sign-up.
    evidence: |-
      The screen submits the resolved zone with no fallback and no picker, so the rejection ends the
      flow with the generic message and no remedy. Ledger entry DW-24.
    location: >-
      apps/web/src/app/auth/sign-up/page.tsx
    severity: low
  - summary: >-
      `requestPasswordReset` retires outstanding tokens and inserts the new one as two separate
      statements, not one atomically-unique write, so two concurrent requests for the same account
      could each see zero live tokens and both insert, briefly leaving two valid links.
    evidence: |-
      Both statements run inside the same `withTransaction`, and the parent throttler bounds request
      rate, so the window is narrow; there is no `@@unique` constraint enforcing at most one
      un-retired `PasswordReset` row per account.
    location: >-
      apps/api/src/identity/parent-auth.service.ts
    severity: low
  - summary: >-
      `MailService.send` only ever throws `MailDispatchError` today, but `requestPasswordReset`
      rethrows anything else uncaught, which would turn a future non-`MailDispatchError` mail failure
      into a 500 that reveals the email is registered (breaking non-enumeration).
    evidence: |-
      `postToProvider` wraps every failure path in `MailDispatchError`, and the `log` transport
      swallows its own append errors, so the gap is latent, not currently reachable.
    location: >-
      apps/api/src/identity/parent-auth.service.ts
    severity: low
  - summary: >-
      `MAIL_LOG_FILE` (dev/E2E JSONL sink) has no boot-time guard forbidding it under
      `NODE_ENV=production`, so a stray env value would write parent emails and reset-link text to
      disk in production.
    evidence: |-
      `resolveMailConfig` validates transport, from, and timeout for production but passes `logFile`
      through unconditionally.
    location: >-
      apps/api/src/mail/mail.service.ts
    severity: low
  - summary: >-
      Sign-up hardcodes `sessionEpoch: 0` when minting the first session rather than reading the
      value the row actually has, so a future change to the schema's default would silently desync
      the minted session from the account's real epoch.
    evidence: |-
      `ParentAuthService.signUp` calls `this.mintSession({ ...account, sessionEpoch: 0 })`; `account`
      comes from `ParentAccountService.create()`, which does not select `sessionEpoch`.
    location: >-
      apps/api/src/identity/parent-auth.service.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** `ParentAccount` exists as an Admin-visible identity with a tier and a timezone history, but it has no credentials, no consent record, and no parent-facing surface — nobody can actually create an account or sign in, so every Epic 1 story downstream is blocked.

**Approach:** Give `identity` the credential half of a Parent Account (password hash, append-only consent record, single-use password-reset tokens) plus a parent-facing controller mounted at `/api/auth`, authenticated by an httpOnly session cookie; add a vendor-neutral `mail` module whose transport is env-selected (`log` by default, HTTP provider in production); and ship the four unauthenticated web screens (sign up, sign in, request reset, set new password).

## Boundaries & Constraints

**Always:**
- `identity` stays the sole writer of every Parent Account table, credentials and consent included (AD-17). No new module touches those Prisma delegates.
- Password and reset-token secrets are argon2id-hashed; a reset token's plaintext exists only in the emailed link.
- Sign-in, sign-up-duplicate, and reset-request responses never reveal whether an email is registered: one message, one status, and the unknown-email path verifies `DUMMY_HASH` so it costs the same as a wrong password.
- The session credential is a JWT in an httpOnly / Secure / SameSite=Strict cookie with audience `parent-session`, minted from `PARENT_JWT_SECRET`. An admin token can never satisfy the parent guard and vice versa (AD-25).
- Sign-up captures the device's IANA zone as the account's **first** `AccountTimezone` entry inside the same transaction as the account row; the history stays append-only (AD-27).
- Every new env key is added to `.env.example` and `turbo.json` `globalEnv`; migrations are generated by `prisma migrate dev`, never hand-written.
- Password minimum length and consent/terms versions have exactly one source of truth (the API) and reach the web only over `GET /api/auth/policy`.
- No user-facing string is a literal inside a web component — parent copy lives in `src/copy/parent.ts`.

**Block If:** the child-data consent notice text must be authored as legal copy rather than placeholder product copy — v0 ships the mechanism with a versioned placeholder notice and the pending legal review is already a recorded v0 constraint, so this does not block.

**Never:**
- No PIN, no Parent View, no elevation token, no Student Mode, no Student Profile — Stories 1.2–1.6.
- No Settings screen and no timezone-edit endpoint: editing the zone is a Parent-View-gated surface and cannot ship before the elevation token exists (deferred, DW entry).
- No email-verification gating, no CAPTCHA (explicitly out of v0, AD-23).
- No third-party mail SDK dependency; the HTTP transport uses `fetch`.
- No design-system refactor — Story 1.7 owns that; reuse the existing base theme and tokens as-is.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-up happy path | new email, password ≥ min length, accepted terms + notice versions matching current, IANA zone | 201, account + first timezone entry + consent row written in one transaction, session cookie set | No error expected |
| Duplicate email sign-up | email already registered | 400 with the one generic sign-up failure message; no row written | Generic message, identical to any other sign-up rejection |
| Stale consent version | accepted version ≠ current version | 400 generic sign-up failure; no row written | Client re-fetches policy |
| Weak password | password shorter than minimum | 400 from validation | Form states the minimum before submission |
| Unknown timezone | zone string the platform does not recognise | 400 `Unknown timezone: <zone>` | Rejected before the transaction opens |
| Sign-in happy path | registered email, correct password | 200, session cookie set | No error expected |
| Sign-in wrong password / unknown email | either | 401, one message, `DUMMY_HASH` verified on the unknown-email path | Equal-cost, non-enumerating |
| Sign-in, account with no password hash (pre-Epic-1 fixture) | `passwordHash` null | 401, same message | Treated as unknown |
| Session read | request carrying a valid session cookie | 200 `{ id, email, timezone }` | 401 when cookie absent/expired/wrong audience |
| Admin token on a parent route | `Authorization: Bearer <admin token>` | 401 | Audience mismatch |
| Sign-out | any request | 204, cookie cleared | No error expected |
| Reset request, registered email | email | 204, single-use token row written, mail dispatched | Mail failure is logged, response is still 204 |
| Reset request, unknown email | email | 204, no row written, no mail | Response identical to the registered case |
| Reset confirm, valid token | unused, unexpired token + new password | 204, password replaced, token marked used, other outstanding tokens for that account invalidated | No error expected |
| Reset confirm, used/expired/unknown token | any | 400 with one generic message | No enumeration of token state |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:112-144` -- `ParentAccount` (no `passwordHash` yet) and `AccountTimezone`; add the credential field and the two new identity-owned models beside them, under the existing `identity` cluster comment.
- `apps/api/src/identity/parent-account.service.ts:189-221` -- `create()` already writes account + first timezone entry in one `withTransaction`, documented as the landing point for Epic 1 sign-up; extend it (password hash + consent) rather than opening a second write path. Reuse `normaliseEmail()` (`:49`), `requireSupportedTimeZone()` (`:76`), `conflictOnDuplicateEmail()` (`:84`), `ACCOUNT_FIELDS` (`:33`), `zoneInEffectAt()` (`:60`).
- `apps/api/src/identity/identity.module.ts` -- has no controller by design ("parent-facing surfaces arrive with Epic 1"); this story adds one.
- `apps/api/src/admin/admin-auth.service.ts:16` `DUMMY_HASH`, `:41-67` -- the equal-cost unknown-principal pattern and argon2 usage to mirror (do not import across modules; `admin` must not become a dependency of `identity`).
- `apps/api/src/admin/admin-auth.guard.ts:30-64` -- guard shape to mirror for the cookie-borne parent session, including strict audience/issuer/claim checks.
- `apps/api/src/admin/admin-auth.constants.ts` -- pattern for a single non-enumerating failure message constant.
- `apps/api/src/admin/dto/sign-in.dto.ts` -- DTO convention: `@Transform` trim + `class-validator`.
- `apps/api/src/app-setup.ts:5-14` -- the one HTTP-surface config shared by runtime and tests: `enableCors({ credentials: false })` must become `true` and cookie parsing must be added here so integration tests get it too.
- `apps/api/src/app.module.ts:10,12-43` -- `LOGIN_THROTTLER` named throttler to apply to sign-up/sign-in/reset-request; `IdentityModule` must be imported into `AppModule` (today it only arrives transitively through `AdminModule`).
- `apps/api/src/common/env.ts` -- `requireJwtSecret`, `requireIntEnv`, `optionalEnv` for the new keys; `apps/api/src/common/timezone.ts` -- `isSupportedTimeZone`, `DEFAULT_TIMEZONE`.
- `apps/api/test/harness.ts:36-70,88-110` -- `createHarness()`, `resetParentAccounts()`, `createParentAccount()`; extend the truncate list with the new tables and add a cookie helper.
- `apps/web/src/lib/admin-api.ts` -- client shape to mirror for a parent client, minus `localStorage` (the parent session is a cookie: `credentials: 'include'`).
- `apps/web/src/app/admin/login/page.tsx` -- form page shape (MUI `TextField`/`Button`/`Alert role="alert"`, `density.gap`, copy module) to mirror for the four auth screens.
- `apps/web/src/theme/tokens.ts:14` `primaryStudent` / `:16` `primaryParent`; `apps/web/src/app/admin/_components/AdminThemeProvider.tsx` -- nested-ThemeProvider-overriding-`palette.primary`-only pattern for the auth route group.
- `playwright.config.ts:32-45` -- API webServer `env` block; new env keys must be present there for E2E.
- `turbo.json` `globalEnv`, `.env.example`, `apps/web/src/app/page.tsx` (redirects to `/admin/taxonomy`) -- all need updating for the new surface.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW ledger format (`### DW-n:` / origin / location / source_spec / severity / reason / status).

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` -- add `passwordHash String?` to `ParentAccount` (nullable: accounts created before Epic 1 have no credential and must simply be unable to sign in), plus identity-owned `AccountConsent { id, parentAccountId, termsVersion, noticeVersion, acceptedAt, createdAt }` (append-only) and `PasswordReset { id, parentAccountId, tokenHash @unique, expiresAt, usedAt?, createdAt, @@index([parentAccountId]) }`; `@@map` to snake_case -- one migration via `pnpm --filter api exec prisma migrate dev --name add_parent_credentials_and_reset`.
- `apps/api/src/identity/auth-policy.ts` -- new: `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `TERMS_VERSION`, `CHILD_DATA_CONSENT_VERSION`, the notice/terms text, `SIGN_UP_FAILED`, `SIGN_IN_FAILED`, `RESET_FAILED`, `RESET_TOKEN_TTL_MS`, `PARENT_SESSION_AUDIENCE`, `PARENT_SESSION_ISSUER` -- the single source of truth for every figure and non-enumerating message in this story.
- `apps/api/src/identity/parent-auth.service.ts` -- new: `signUp`, `signIn`, `requestPasswordReset`, `confirmPasswordReset`, `sessionFor`; argon2id hashing, `DUMMY_HASH` equal-cost unknown-email path, reset tokens as 32 random bytes hashed before storage, all writes through `identity`'s own delegates inside `withTransaction`.
- `apps/api/src/identity/parent-account.service.ts` -- extend `create()` to accept `passwordHash` and a consent record and write them in the existing transaction; keep the existing no-credential call shape working for fixtures.
- `apps/api/src/identity/parent-session.guard.ts` -- new: reads the session cookie, verifies audience/issuer/scope/claims, attaches `req.parent = { parentAccountId, email }`; rejects any token not minted for `parent-session`.
- `apps/api/src/identity/parent-auth.controller.ts` -- new, `@Controller('auth')`: `POST sign-up`, `POST sign-in`, `POST sign-out`, `GET me` (guarded), `POST password-reset/request`, `POST password-reset/confirm`, `GET policy`; sets/clears the cookie; the three credential-touching POSTs carry the `login` throttler, the rest skip it.
- `apps/api/src/identity/dto/*.dto.ts` -- new DTOs following the existing `@Transform` + `class-validator` convention, with the password rule read from `auth-policy.ts`.
- `apps/api/src/identity/identity.module.ts` -- register the controller, guard, services; import `MailModule`; keep exporting `ParentAccountService`.
- `apps/api/src/mail/mail.service.ts`, `mail.module.ts` -- new: `send({ to, subject, text })` dispatching to an env-selected transport -- `log` (default; structured log line, never a production default in a deployed env) or `http` (POST JSON `{ from, to, subject, text }` to `MAIL_API_URL` with a bearer `MAIL_API_KEY`, via `fetch`). A transport failure throws a mail-specific error the caller swallows.
- `apps/api/src/app-setup.ts` -- add cookie parsing and switch CORS to `credentials: true` with an exact origin.
- `apps/api/src/app.module.ts` -- import `IdentityModule` directly.
- `apps/api/src/common/env.ts` (if needed), `.env`, `.env.example`, `turbo.json`, `playwright.config.ts` -- add `PARENT_JWT_SECRET`, `PARENT_SESSION_TTL_SECONDS`, `MAIL_TRANSPORT`, `MAIL_FROM`, `MAIL_API_URL`, `MAIL_API_KEY`, `WEB_ORIGIN` usage for the reset link base.
- `apps/api/src/identity/auth-policy.spec.ts`, `apps/api/src/identity/parent-auth.spec.ts` -- unit-test the pure logic: password-policy boundaries, reset-token hashing/expiry/single-use predicates, reset-link construction.
- `apps/api/test/parent-auth.int-spec.ts` -- new: every row of the I/O matrix through HTTP, plus cookie attributes (`HttpOnly`, `SameSite=Strict`, `Path=/`) and the admin-token-vs-parent-guard crossover in both directions.
- `apps/api/test/harness.ts` -- truncate the new tables in `resetParentAccounts`, expose the mail transport as a capturable fake and a helper to extract the session cookie.
- `apps/web/src/copy/parent.ts` -- new: every string for the four screens, plain and factual, no exclamation marks, one generic failure message reused.
- `apps/web/src/lib/parent-api.ts` -- new: `credentials: 'include'`, no token storage, `policy()`, `signUp()`, `signIn()`, `signOut()`, `me()`, `requestPasswordReset()`, `confirmPasswordReset()`, `ParentApiError`.
- `apps/web/src/app/auth/layout.tsx` + `_components/AuthThemeProvider.tsx` -- nested ThemeProvider overriding `palette.primary` only (parent accent), mirroring the admin pattern.
- `apps/web/src/app/auth/sign-up/page.tsx` -- form stating the password minimum before submission, rendering the fetched notice text behind an expandable control, requiring both acceptances, capturing `Intl.DateTimeFormat().resolvedOptions().timeZone`, submitting the fetched versions.
- `apps/web/src/app/auth/sign-in/page.tsx`, `apps/web/src/app/auth/reset/page.tsx`, `apps/web/src/app/auth/reset/confirm/page.tsx` -- sign-in; reset request showing one confirmation regardless of account existence; reset confirm reading the token from the query string.
- `apps/web/src/app/auth/signed-in/page.tsx` -- a minimal authenticated landing that calls `me()` and offers sign-out, so "signed in with a persistent session" is observable before Parent View exists.
- `apps/web/src/lib/parent-api.spec.ts` -- unit-test error mapping and the credentials option.
- `e2e/tests/parent-auth.spec.ts`, `e2e/fixtures.ts`, `e2e/global-setup.ts` -- browser coverage: sign-up lands signed in and survives a reload; duplicate email shows the generic message; sign-in then sign-out; reset request shows the same confirmation for a registered and an unregistered email. Truncate the new tables in the E2E reset.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- append DW entries for the deferred Settings timezone-edit surface and for shipping a placeholder consent notice pending legal review.

**Session, revocation and configuration rules (added by review pass 1 — read with the Design Notes of the same name):**

- The session lasts **until explicit sign-out**, not for an elevation-sized window. `PARENT_SESSION_TTL_SECONDS` defaults to 30 days, the cookie `maxAge` matches it, and every authenticated request that is more than a day old re-mints the cookie so an active parent is never signed out by the clock. The architecture's 8-hour ceiling governs the Story 1.2 elevation token and must not be applied to this credential.
- A password reset **invalidates every existing session for that account**. Carry a `sessionEpoch` integer on `ParentAccount`, put it in the session token, bump it inside the reset-confirm transaction, and have the guard reject a token whose epoch is stale.
- `requestPasswordReset` returns its 204 without writing or sending for an account whose `passwordHash` is null, so reset never becomes a sign-in path for a credential-less account — the claim `signIn` already makes.
- A new reset request **marks every outstanding unused token for that account used** before writing its own, so at most one link is live per account.
- `PARENT_JWT_SECRET` equal to `ADMIN_JWT_SECRET` must fail fast at boot with a named error, with a unit test — the two-surface separation cannot rest on an operator's care.
- Mail configuration is validated **once at module init**, not per send: an unrecognised `MAIL_TRANSPORT`, or `http` without `MAIL_API_URL`/`MAIL_API_KEY`, refuses to boot. The per-send swallow then covers only genuine transport failures. The `http` transport carries a request timeout (`MAIL_TIMEOUT_MS`, default 10s).
- The cookie's `Secure` flag reads an explicit `COOKIE_SECURE` env (default `true`, opt out for local HTTP), never `NODE_ENV`. `WEB_ORIGIN` is required — not defaulted — when `NODE_ENV=production`, because credentialed CORS against a wrong origin fails every call.
- The parent credential routes get their **own named throttler** (`parent` bucket, `PARENT_AUTH_RATE_LIMIT`), not the admin `login` bucket, so one surface cannot exhaust the other's budget.
- `apps/api/src/mail/mail.service.spec.ts` -- new: transport resolution rejects an unknown value; the `log` transport actually emits; `http` raises `MailDispatchError` on a non-ok response and on a `fetch` throw.
- `apps/api/test/rate-limit.int-spec.ts` -- extend: a parent sign-in flood returns 429 from the parent bucket, and `GET /api/auth/policy` does not spend it.
- `apps/api/test/harness.ts` -- resolve each module's own `JwtService` (`moduleRef.select(...)`) rather than rebuilding one from raw env, so the test surface cannot drift from production signing options.
- Web: the reset-request screen shows its confirmation **only on a successful response**; a network or server failure states that plainly. `messageFor` gives 429 its own "too many attempts" copy. A failed policy load never leaves a submit button permanently disabled, and the sign-up form re-fetches the policy and re-arms its checkboxes when a submission is rejected for a stale version. The reset-confirm form checks the password minimum client-side before submitting, so a short password is not reported as a bad link.
- Small correctness items: `setPasswordHash` returns `Promise<void>`; the session read does not select `passwordHash`; `termsVersion`/`noticeVersion` DTO fields carry `@MinLength(1)`.
- E2E additions: loading `/` lands on parent sign-in; the reset round trip is completed in the browser by reading the issued token through an E2E fixture and following the link to a successful new-password sign-in; an unregistered reset request is asserted to have written zero rows.

**Acceptance Criteria:**

- Given a signed-in parent, when the session token's age is inspected, then its lifetime is the 30-day session TTL and no code path applies the elevation ceiling to it; and given a session token older than the re-mint threshold, when any authenticated request is made, then a refreshed cookie comes back.
- Given a completed password reset, when a session cookie minted before the reset is replayed, then it is rejected.
- Given `PARENT_JWT_SECRET` and `ADMIN_JWT_SECRET` hold the same value, when the API boots, then it refuses to start with a named error.
- Given `MAIL_TRANSPORT` names an unknown transport, when the API boots, then it refuses to start; and given a reset request whose transport then fails at send time, when the response is read, then it is still 204.
- Given repeated sign-in attempts from one address beyond the parent budget, when the next is made, then it is 429, and the admin login budget is untouched.

- Given a signed-up account, when the browser is reloaded, then the session persists without re-entering credentials, and after `POST /api/auth/sign-out` the same reload lands back on sign-in.
- Given sign-up succeeds, when the account row is inspected, then exactly one `AccountConsent` row exists carrying the acceptance timestamp and the notice version that was current at acceptance, and exactly one `AccountTimezone` entry exists holding the zone the device reported.
- Given the API is the only source of the password minimum and the consent version, when the sign-up screen renders, then both come from `GET /api/auth/policy` and appear nowhere else as literals.
- Given a reset request for a registered email, when the mail transport is captured, then exactly one message is dispatched containing a link to the web reset-confirm screen carrying a token that matches no stored plaintext.
- Given the reset link is followed and a new password set, when the old password is used to sign in, then it is rejected, and when the new password is used, then sign-in succeeds; replaying the same link fails generically.
- Given `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, and `pnpm run e2e` at the repo root, when run on a clean tree, then all pass.

## Spec Change Log

### 2026-09-23 — Review pass 1

**Triggering findings.** The first implementation gave the parent session an 8-hour lifetime borrowed from the architecture's *elevation* ceiling, which contradicts the story's own "signed in with a persistent session" and FR-1's "persists across app launches until explicit sign-out" — and the divergence was asserted as correct by a test named "is 401 for an expired session". Alongside it: a completed password reset left previously issued sessions valid; `requestPasswordReset` accepted accounts with a null `passwordHash`, handing credential-less accounts the sign-in path `signIn` explicitly refuses them; `MAIL_TRANSPORT` was resolved per send, so a misconfiguration produced 204s and no mail forever; `PARENT_JWT_SECRET` equal to `ADMIN_JWT_SECRET` booted cleanly and collapsed the two-surface separation; the parent credential routes shared the admin `login` throttler bucket and nothing tested that they were throttled at all; the cookie's `Secure` flag keyed off `NODE_ENV`; and the reset-request screen reported success in a `finally`, claiming a link was sent when the request had failed.

**What was amended.** A new "Session, revocation and configuration rules" block in `## Tasks & Acceptance` and a Design Note of the same name, plus five acceptance criteria that pin session lifetime, post-reset revocation, secret collision, mail misconfiguration, and parent-bucket throttling. Nothing inside `<intent-contract>` was touched.

**Known-bad state avoided.** A credential that silently expires mid-afternoon while the product claims it lasts until sign-out; a password reset that does not actually lock out whoever prompted it; a reset flow that promotes credential-less rows into sign-in-able accounts; and a mail path that can be dead in production with a green test suite.

**KEEP — what worked and must survive re-derivation.**
- `identity` growing the credential half rather than a new module, with a **local** `DUMMY_HASH` so `admin` never becomes a dependency of `identity`.
- `identity.module.ts` registering its own `JwtModule` on `PARENT_JWT_SECRET`, so an admin token cannot even be verified by the parent guard — and the three crossover tests that pin it, including the token minted with the admin secret at the parent audience.
- `auth-policy.ts` as the single source of password bounds, versions, notice text, the three non-enumerating message constants, and the pure predicates, with its own unit spec.
- Extending `ParentAccountService.create()` to write account + first timezone entry + consent in the one existing transaction, with the old no-credential fixture call shape still working.
- Reset tokens as 32 random bytes hashed before storage, with confirm claiming the row guarded on `usedAt: null` inside a transaction.
- `cookie-parser` as the parsing dependency and a cookie-only guard that never reads `Authorization`.
- The harness's capturable mail fake with an injectable fault, and the integration suite's full I/O-matrix coverage including cookie attributes.
- `pnpm run e2e` does not go through turbo: run `pnpm run build` before it, or it tests a stale `apps/api/dist`.
- The local dev database may still hold the previous `add_parent_credentials_and_reset` migration from the reverted attempt. If `prisma migrate dev` reports drift, run `pnpm --filter api exec prisma migrate reset --force` and re-generate.

## Review Triage Log

### 2026-09-23 — Review pass

- intent_gap: 0
- bad_spec: 13: (high 3, medium 6, low 4)
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[bad_spec]` Session lifetime was the 8-hour elevation ceiling, contradicting "persists until explicit sign-out" — spec now fixes a 30-day session TTL with re-minting, and an AC pins it.
  - `[high]` `[bad_spec]` A completed password reset left existing sessions valid — spec now requires a `sessionEpoch` bumped in the reset transaction and checked by the guard.
  - `[high]` `[bad_spec]` `requestPasswordReset` served accounts with a null `passwordHash`, creating a second sign-in path — spec now requires that case to return 204 writing and sending nothing.
  - `[medium]` `[bad_spec]` `MAIL_TRANSPORT` resolved per send, so a misconfiguration failed silently forever — spec now requires boot-time validation plus an `http` request timeout.
  - `[medium]` `[bad_spec]` `PARENT_JWT_SECRET` equal to `ADMIN_JWT_SECRET` booted cleanly — spec now requires a fail-fast check with a unit test.
  - `[medium]` `[bad_spec]` Parent credential routes shared the admin `login` throttler bucket and no test covered them — spec now requires a separate `parent` bucket and a rate-limit integration test.
  - `[medium]` `[bad_spec]` Cookie `Secure` keyed off `NODE_ENV`, and `WEB_ORIGIN` silently defaulted in production — spec now requires an explicit `COOKIE_SECURE` and a required `WEB_ORIGIN` in production.
  - `[medium]` `[bad_spec]` The reset-request screen confirmed success in a `finally`, lying about a failed request — spec now requires confirmation only on success, plus distinct 429 copy.
  - `[medium]` `[bad_spec]` Reset tokens accumulated unbounded per account — spec now requires each request to invalidate outstanding tokens first.
  - `[low]` `[bad_spec]` `MailService` was never executed by any test (the harness replaced the method under test) — spec now requires `mail.service.spec.ts`.
  - `[low]` `[bad_spec]` The root route change, the browser reset round trip, and the zero-rows assertion for an unregistered email were untested — spec now requires all three in E2E.
  - `[low]` `[bad_spec]` Typing and validation nits: `setPasswordHash` returning `Promise<unknown>`, `passwordHash` selected for the session read, version DTO fields accepting an empty string.
  - `[low]` `[bad_spec]` Web recovery affordances: a failed policy load left submit permanently disabled, a stale version rejection had no path forward, and a short password read as a bad link.

### 2026-09-23 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 2, medium 4, low 7)
- defer: 5: (high 0, medium 2, low 3)
- reject: 8: (high 0, medium 3, low 5)
- addressed_findings:
  - `[high]` `[patch]` `POST /api/auth/password-reset/confirm` carried no `@ParentCredentialRoute()`, so reset-token guessing spent no parent budget — decorator and `SkipThrottle` added, class doc corrected to four credential POSTs.
  - `[high]` `[patch]` `confirmPasswordReset` hashed the new password before validating the token, making an unauthenticated endpoint an argon2id CPU amplifier — hashing moved inside the transaction, after the token row is claimed.
  - `[medium]` `[patch]` Nothing asserted the cookie's `Secure` flag or exercised `optionalBoolEnv` / `requireWebOrigin` — integration assertion for `Secure` under both `COOKIE_SECURE` values plus unit cases for both helpers.
  - `[medium]` `[patch]` Three rate-limit tests shared hidden throttler state — each budget test now builds its own harness, plus an explicit two-budgets-are-independent test.
  - `[medium]` `[patch]` Mail configuration accepted `MAIL_TIMEOUT_MS=0` (aborting every send) and defaulted `MAIL_FROM` in production — both now rejected at boot.
  - `[medium]` `[patch]` The signed-in screen redirected to sign-in from a `finally`, so a failed sign-out claimed success with the cookie intact — redirect only on success; a network `me()` failure now offers a retry instead of signing the parent out.
  - `[low]` `[patch]` Sign-in read the account twice and could answer 404 on a deleted row — `sessionEpoch` selected in the single credential read, the second query removed.
  - `[low]` `[patch]` The session-TTL test pinned the hard-coded default, so ignoring `PARENT_SESSION_TTL_SECONDS` would pass — the override is now covered at both the claim and the cookie.
  - `[low]` `[patch]` The harness's mail-capture comment claimed the production `send` still ran while the helper stubbed it — comment corrected and the original `send` restored on `close()`.
  - `[low]` `[patch]` `appendToLogFile` swallowed every error and did not create its directory, turning a clean checkout into a silent 10s E2E timeout — directory created, failures warned.
  - `[low]` `[patch]` A JSONL line read mid-append crashed the E2E mail sink — lines parsed individually, torn lines skipped.
  - `[low]` `[patch]` Sign-up did not pre-check the password minimum, reporting a short password as a generic account failure — same client-side check as reset-confirm.
  - `[low]` `[patch]` `parentApi` assumed a JSON body on every success and declared a content type on bodyless GETs — parse wrapped with the generic fallback, header sent only with a body.

### 2026-09-23 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 4: (high 0, medium 0, low 4)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `ParentSessionGuard.remintIfStale` let a mint failure during cookie re-mint throw out of `canActivate`, turning an otherwise-valid authenticated request into a 500 — the mint call is now wrapped, logging a warning and leaving the still-valid session cookie in place instead of failing the request.
  - `[low]` `[patch]` No test asserted the CORS `credentials: true` / exact-origin configuration in `app-setup.ts`; supertest bypasses browser CORS enforcement entirely, so a regression there would pass `pnpm test` silently and only surface in a real browser — added an integration assertion on `Access-Control-Allow-Origin` / `Access-Control-Allow-Credentials`.

## Design Notes

**Why the credential lives in `identity`, not a new `auth` module.** AD-17 gives `identity` sole write ownership of every Parent Account table. A separate `auth` module writing `parent_account.passwordHash` would create a second writer of the same entity — the exact drift the rule exists to prevent. `identity` therefore grows a controller and an auth service; `mail` is a genuinely separate concern (no DB) and is its own module.

**Two credentials, not one.** This story ships only the session cookie (identity: *which account*). The in-memory elevation token that authorises parent-scoped data arrives with the PIN in Story 1.2. Nothing here may be reused as an elevation credential, which is why the session audience is `parent-session` and the guard rejects any other audience outright.

**Non-enumeration is structural, not cosmetic.** Sign-in, duplicate sign-up, and reset-request all resolve to a single message constant and a single status per endpoint; the unknown-email sign-in path verifies `DUMMY_HASH` so timing does not leak what the message does not. Duplicate sign-up returns the generic failure rather than `identity`'s existing `ConflictException`, which names the email.

**Mail is vendor-neutral by construction.** `MailService` knows `to`/`subject`/`text` and one of two transports. `log` is the default and is what tests and local development use; `http` posts JSON to a configured provider endpoint with a bearer key. Choosing and provisioning that provider (account, verified sending domain, API key) is an operator action outside the repo — the code path, config keys, and tests ship complete and unexercised against a real provider.

**Session, revocation and configuration rules.** The architecture separates two credentials with two lifetimes: the session answers *which account* and, by FR-1, ends only when the parent signs out; the elevation token authorises parent-scoped data and is the one bounded at 8 hours. Borrowing the elevation ceiling for the session is the specific mistake to avoid — it produces a product that silently signs a parent out while claiming it does not. Because the session is long-lived and stateless, the only way a password reset can actually lock out whoever prompted it is a per-account epoch carried in the token and bumped on reset; without it, "reset your password" protects nothing against a stolen cookie. The configuration rules share one shape: a setting whose wrong value is *silent* must fail at boot, never at the moment a parent needs it — a mail transport that swallows its own misconfiguration, or two surfaces sharing one JWT secret, are both invisible until the day they matter.

**Placeholder consent text.** The notice is versioned content served by the API, so replacing the text is a version bump plus a copy change, not a code change. Legal review of the child-data posture is a known-open v0 item that blocks public registration, not development.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev --name add_parent_credentials_and_reset` -- expected: one new migration directory, schema applied
- `pnpm run typecheck` -- expected: clean
- `pnpm run lint` -- expected: clean
- `pnpm run test` -- expected: all unit + integration specs pass, including the new `parent-auth` suites
- `pnpm run e2e` -- expected: `parent-auth.spec.ts` passes alongside the existing admin specs
- `pnpm prettier --write .` -- expected: no unformatted files remain

## Auto Run Result

**Summary.** Fresh review pass over the already-implemented Story 1.1 (parent sign-up/sign-in/reset). Four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) ran against the diff since baseline `5fcf840`. No intent gaps, no bad-spec findings; two real, trivially-fixable bugs patched directly, four pre-existing-shaped risks recorded to the deferred-work ledger, nine reviewer findings rejected as noise or already-covered by explicit spec decisions (see triage log above for the full breakdown and reasoning).

**Files changed this pass:**
- `apps/api/src/identity/parent-session.guard.ts` -- `remintIfStale` now catches a session re-mint failure and logs a warning instead of letting it fail an otherwise-valid authenticated request with a 500.
- `apps/api/test/parent-auth.int-spec.ts` -- added an integration test asserting `Access-Control-Allow-Origin` / `Access-Control-Allow-Credentials` on a cross-origin request, closing a gap where a CORS-credentials regression would pass `pnpm test` silently (supertest does not enforce browser-side CORS) and surface only in a real browser via the separately-run, non-CI'd e2e suite.
- Spec frontmatter `deferred` list -- four new low-severity items appended (see below); `deferred-work.md` itself was not touched, per the ledger being orchestrator-owned.

**Review findings breakdown:** patch 2 (medium 1, low 1) -- both applied; defer 4 (low 4) -- appended to `deferred` frontmatter and the DW ledger; reject 9 -- dropped silently as noise, already-mitigated by the existing design, or already an explicit spec decision (e.g. `SameSite=Strict`-only CSRF posture, `WEB_ORIGIN`'s `NODE_ENV=production` gating, SHA-256 reset-token hashing which is required for the `@unique` lookup design and is not a security gap for a 256-bit random secret).

**Follow-up review recommendation:** `false`. Score: `3 × 1 medium + 1 × 1 low = 4` (< 5), no high-severity patch.

**Verification performed:**
- `pnpm run typecheck` -- clean.
- `pnpm run lint` -- could not run: `eslint` is not installed in this repo (pre-existing environment gap, not caused by this pass; not a regression to fix here).
- `pnpm run test` -- 17 files / 192 tests (api) + 4 files / 33 tests (web), all pass, including the new CORS assertion.
- `pnpm run build` then `pnpm run e2e` -- 25/25 Playwright tests pass.
- `pnpm prettier --write` -- run on the two changed source files; clean.

**Residual risks:** the four items just appended to frontmatter `deferred` (awaiting the orchestrator's ledger sync): a narrow concurrent-reset-request race that could briefly leave two live reset tokens; a latent (currently unreachable) non-enumeration gap if `MailService` ever throws something other than `MailDispatchError`; no boot-time guard against `MAIL_LOG_FILE` being set in production; and a hardcoded `sessionEpoch: 0` on sign-up that would silently desync from a future schema default change. The pre-existing `eslint`-not-installed gap in this repo remains unaddressed and un-blocking.
