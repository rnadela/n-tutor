### DW-1: Bulk edits on the taxonomy screen can trip the default rate limiter because every GET read after a write counts against it.
origin: spec-deferred e4ab22e4e56a
location: apps/api/src/admin/admin-auth.controller.ts, apps/api/src/admin/taxonomy.controller.ts
source_spec: `spec-2-1-subject-grade-level-taxonomy.md`
severity: low
reason: `GET /api/admin/taxonomy` and `GET /api/admin/auth/me` only skip the `login`-named throttler (`@SkipThrottle({ login: true })`); they still count against the shared `default` limiter. The taxonomy page reloads the entire snapshot after every single create/rename/toggle, so a burst of operator edits could plausibly trip the default limiter.
status: open

### DW-2: `pg`, `@types/pg`, and `dotenv` versions are declared independently in the root `package.json` and `apps/api/package.json` with nothing pinning them together.
origin: spec-deferred 555e494f8a82
location: package.json, apps/api/package.json
source_spec: `spec-2-1-subject-grade-level-taxonomy.md`
severity: low
reason: A prior review pass already fixed drift between these same packages once; the fix was not generalised, so the two remaining independent copies can drift again.
status: open

### DW-3: `siblingDatabaseUrl()` only rewrites the URL's pathname, so any other connection parameter on `DATABASE_URL` carries over unmodified onto the derived test/E2E database URLs.
origin: spec-deferred 0dfd12c4a8be
location: apps/api/src/common/database-url.ts
source_spec: `spec-2-1-subject-grade-level-taxonomy.md`
severity: low
reason: If the root `.env` later adds pooling flags or a non-default schema, those would silently apply to `nts_test`/`nts_e2e` too, which is easy to overlook.
status: open

### DW-4: `/api/health` runs its readiness query with no explicit timeout, so a hung (not immediately erroring) database connection could hang the health check indefinitely instead of reporting 503.
origin: spec-deferred 09678bf607d0
location: apps/api/src/health/health.controller.ts
source_spec: `spec-2-1-subject-grade-level-taxonomy.md`
severity: low
reason: `health.controller.ts` awaits `SELECT 1` directly with no race against a timeout; this is only exercised for the fast-fail case in tests.
status: open

### DW-5: The web admin API client shows the same generic or credential-specific message for rate-limited (429) and server-error (500) responses as it does for actual failures, on both login and general calls.
origin: spec-deferred 9a0ec04c863c
location: apps/web/src/lib/admin-api.ts
source_spec: `spec-2-1-subject-grade-level-taxonomy.md`
severity: low
reason: `messageFor()` only special-cases 401/404/409 before falling back to a generic message; `signIn()` uses one fixed failed-credentials message for every non-OK response, including 429 and 500.
status: open

### DW-6: `call()` in the admin API client does not guard `response.json()` when `response.ok` is true, so a malformed success body throws a raw `SyntaxError` instead of a typed `AdminApiError`.
origin: spec-deferred 39297b008d2d
location: apps/web/src/lib/admin-api.ts
source_spec: `spec-2-1-subject-grade-level-taxonomy.md`
severity: low
reason: Only the non-OK branch constructs `AdminApiError`; a 200 with an empty or invalid JSON body propagates an unguarded parse exception to callers that only expect `AdminApiError`.
status: open

### DW-7: The audit-write-rollback matrix row ("Audit write fails" -> "Nothing persists; 500 surfaced") is proven at the service layer but not at the HTTP layer for this specific scenario.
origin: spec-deferred f82d20185a43
location: apps/api/test/taxonomy.int-spec.ts
source_spec: `spec-2-1-subject-grade-level-taxonomy.md`
severity: low
reason: `taxonomy.int-spec.ts`'s "rolls the taxonomy write back when the audit write fails" test mocks `audit.record` and asserts via `rejects.toThrow(...)` plus zeroed row counts; no test in this scenario asserts an actual HTTP 500 response.
status: open

### DW-8: The admin Parent Accounts list is unbounded: it selects every account and every account's entire timezone history with no pagination.
origin: spec-deferred 6f7c5bed1ca9
location: apps/api/src/identity/parent-account.service.ts
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: medium
reason: `ParentAccountService.list()` runs `findMany` with no `take`/`skip`, and resolves each row's effective zone from the full history. The payload and its query cost grow as O(accounts x history entries) with no ceiling. No account base exists yet, so nothing is slow today.
status: open

### DW-9: The allowance counting seam is a module-private constant, so Epics 3-6 cannot register a counter without editing `allowance.service.ts` and importing the producer modules.
origin: spec-deferred 5ea56905f952
location: apps/api/src/allowance/allowance.service.ts
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: medium
reason: `ARTIFACT_COUNTERS` is a frozen object of three `async () => 0` literals inside the service. Wiring real counts would invert the dependency direction AD-17 protects; a provider token or registration interface would make the documented seam real. Nothing asserts the counters are invoked with the resolved window either.
status: open

### DW-10: `ParentAccountAdminService.detail` re-reads the account and the timezone history that `AllowanceService.consumptionFor` reads again internally.
origin: spec-deferred e10c59ceba1b
location: apps/api/src/admin/parent-account-admin.service.ts
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: low
reason: Four queries where two suffice, and `detail.account.timezone` (the zone in effect now) is a different value from `detail.consumption.timezone` (the zone at period start) with no copy distinguishing them. The web page currently reads only `consumption`, so the extra read is unobserved.
status: open

### DW-11: A month whose local midnight does not exist (a DST switch at 00:00, such as `America/Santiago`) is untested.
origin: spec-deferred 1866cf525a38
location: apps/api/src/allowance/period.ts
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: low
reason: `instantOfLocal`'s two-probe fixup resolves such a boundary to the first instant that does exist, and both adjacent windows are computed the same way so they stay contiguous. The behaviour looks correct but no test pins it, and no test asserts `previousWindow.end === thisWindow.start`.
status: open

### DW-12: `resolveWindow`'s bounded fixpoint loop can exhaust its 3 passes on a pathological zone-change history without the returned window's zone actually agreeing with the zone in effect at the window's
origin: spec-deferred 4c384e3a63ab
location: apps/api/src/allowance/period.ts
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: low
reason: The loop returns the last candidate window when `MAX_RESOLUTION_PASSES` is exhausted, with no log/telemetry marking the degraded case and no test pinning which candidate is returned when convergence fails.
status: open

### DW-13: `ParentAccountAdminService.assignTier` reads the account's effective timezone after its transaction commits, not inside it, so a concurrent timezone write landing in that gap could echo a stale zone
origin: spec-deferred b4ff1d102134
location: apps/api/src/admin/parent-account-admin.service.ts
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: low
reason: No route in this story ever calls `ParentAccountService.appendTimezone` (it is reachable only from tests and a future epic), so the race is currently unreachable, but nothing guards against it once a timezone- write route ships.
status: open

### DW-14: `onAssignTier`'s success-path resync failure (after a successful tier write, `reload()`/`loadConsumption()` throwing) is deliberately swallowed without surfacing any error, but no test pins that
origin: spec-deferred bdded0a1860c
location: apps/web/src/app/admin/accounts/page.tsx
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: low
reason: The only PATCH-failure e2e test mocks the tier write itself failing; no test mocks a successful write followed by a failing resync.
status: open

### DW-15: The stale-consumption-response guard (`expectedConsumptionId`) that prevents a slow response from rendering under a different expanded row has no dedicated test exercising the race it guards against.
origin: spec-deferred c22f09db4083
location: apps/web/src/app/admin/accounts/page.tsx
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: low
reason: No e2e test expands one account, switches to another before the first fetch resolves, and asserts the panel never shows the first account's data — a regression here would ship undetected.
status: open

### DW-16: `taxonomy.int-spec.ts`'s "exposes the same behaviour over the REST surface" test failed once (selectable-subjects returned `[]` instead of length 1) in a full-suite run, then passed on four immediate
origin: spec-deferred 9bcd5e305850
location: apps/api/test/taxonomy.int-spec.ts
source_spec: `spec-2-2-parent-account-tier-assignment-consumption-view.md`
severity: low
reason: This spec file is unmodified by this story's diff; the failure did not reproduce across `pnpm exec vitest run` x4 nor when run paired with `parent-account.int-spec.ts` alone, so it looks like a pre-existing, low-frequency flake rather than something this story's changes caused.
status: open

### DW-17: No Settings screen and no timezone-edit endpoint: a parent cannot change the account's timezone after sign-up
origin: spec-deferred spec-1-1
location: apps/web/src/app/auth, apps/api/src/identity
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: medium
reason: Editing the zone is a Parent-View-gated surface and cannot ship before the elevation token exists (Story 1.2). Sign-up captures the device's zone as the first, append-only `AccountTimezone` entry; until the edit surface ships, a parent who moves has no way to correct it and `ParentAccountService.appendTimezone` stays reachable only from tests.
status: open

### DW-18: The child-data consent notice and the terms text are placeholder product copy pending legal review
origin: spec-deferred spec-1-1
location: apps/api/src/identity/auth-policy.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: medium
reason: v0 ships the mechanism — versioned notice text served by the API, an append-only `AccountConsent` row per acceptance — with placeholder wording. Replacing it is a version bump plus a string change, but the pending legal review blocks public registration, and acceptances recorded against the placeholder version will not be acceptances of the reviewed text.
status: open

### DW-19: The `http` mail transport has never run against a real provider
origin: spec-deferred spec-1-1
location: apps/api/src/mail/mail.service.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: medium
reason: Choosing and provisioning a provider (account, verified sending domain, API key) is an operator action outside the repo. The code path, config keys and unit tests ship complete, but the request shape a given provider expects is unverified, and a reset-request response is 204 whether or not the message was actually accepted — so a wrong shape would surface only as parents not receiving links.
status: open

### DW-20: No per-account lockout or backoff on parent credential routes — throttling is per-address only
origin: review-deferred spec-1-1
location: apps/api/src/app.module.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: medium
reason: The `parent` throttler bucket is keyed by request address, so guessing distributed across addresses against one known email is effectively unbounded. A per-account attempt counter with backoff is the missing half, and it needs a storage decision that belongs with the Story 1.2 elevation work.
status: open

### DW-21: Parent credential events are not audited
origin: review-deferred spec-1-1
location: apps/api/src/identity/parent-auth.service.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: medium
reason: The admin surface records actions through `AdminAuditService`; parent sign-in, sign-out, reset request and reset confirm — including the `sessionEpoch` bump that signs out every device — record nothing, so a parent asking whether someone else reset their password has no answer.
status: open

### DW-22: `password_reset` and `account_consent` rows only ever grow
origin: review-deferred spec-1-1
location: apps/api/prisma/schema.prisma
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: There is no cleanup of used or expired reset rows and no index on `expiresAt`; consent is append-only by design but has no retention or account-deletion story. Neither matters at v0 volumes; both want deciding before real traffic.
status: open

### DW-23: `SameSite=Strict` constrains where the API may be deployed relative to the web app
origin: review-deferred spec-1-1
location: apps/api/src/identity/parent-session.cookie.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: The session cookie survives credentialed cross-origin calls only while API and web share a registrable domain. Deploying the API under a different domain would silently drop the cookie on every request; the constraint is recorded nowhere in the deployment configuration.
status: open

### DW-24: A device whose IANA zone the API rejects cannot complete sign-up
origin: review-deferred spec-1-1
location: apps/web/src/app/auth/sign-up/page.tsx
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: The screen submits `Intl.DateTimeFormat().resolvedOptions().timeZone` with no fallback and no picker, so a zone the platform does not recognise ends the flow with the generic failure message and no remedy. Rare, but unrecoverable from the browser.
status: open

### DW-25: Parent credential routes are throttled per address only, with no per-account lockout or backoff.
origin: spec-deferred eda97199037d
location: apps/api/src/app.module.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: medium
reason: The `parent` throttler bucket keys on the request address, so guessing distributed across addresses against one known email is effectively unbounded. Ledger entry DW-20.
status: open

### DW-26: No audit trail exists for parent sign-in, sign-out, reset request or reset confirm.
origin: spec-deferred 63e2831557a6
location: apps/api/src/identity/parent-auth.service.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: medium
reason: `AdminAuditService` records admin actions; the parent surface records nothing, including the sessionEpoch bump that ends every session. Ledger entry DW-21.
status: open

### DW-27: `password_reset` and `account_consent` rows have no retention, cleanup or `expiresAt` index.
origin: spec-deferred c48228585609
location: apps/api/prisma/schema.prisma
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: Used and expired reset rows are never removed and consent has no account-deletion story. Harmless at v0 volumes. Ledger entry DW-22.
status: open

### DW-28: `SameSite=Strict` requires the API and the web app to share a registrable domain.
origin: spec-deferred 2e79d025d97d
location: apps/api/src/identity/parent-session.cookie.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: A deployment splitting them across domains silently drops the session cookie on every credentialed request; nothing records the constraint. Ledger entry DW-23.
status: open

### DW-29: A device reporting an IANA zone the API rejects cannot complete sign-up.
origin: spec-deferred 0cc7b6228f77
location: apps/web/src/app/auth/sign-up/page.tsx
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: The screen submits the resolved zone with no fallback and no picker, so the rejection ends the flow with the generic message and no remedy. Ledger entry DW-24.
status: open

### DW-30: Unreadable `deferred:` items in spec-1-1-parent-account-sign-up-sign-in.md
origin: spec-deferred-malformed 4cf3b748aed2
location: n/a
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: The dev session recorded deferred findings the orchestrator could not parse, so they were NOT filed as entries: item 1: not a mapping (got str); item 2: not a mapping (got str); item 3: not a mapping (got str). Read `spec-1-1-parent-account-sign-up-sign-in.md`'s frontmatter and re-file them by hand.
status: open

### DW-31: `requestPasswordReset` retires outstanding tokens and inserts the new one as two separate statements, not one atomically-unique write, so two concurrent requests for the same account could each see
origin: spec-deferred 009f5ef40317
location: apps/api/src/identity/parent-auth.service.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: Both statements run inside the same `withTransaction`, and the parent throttler bounds request rate, so the window is narrow; there is no `@@unique` constraint enforcing at most one un-retired `PasswordReset` row per account.
status: open

### DW-32: `MailService.send` only ever throws `MailDispatchError` today, but `requestPasswordReset` rethrows anything else uncaught, which would turn a future non-`MailDispatchError` mail failure into a 500
origin: spec-deferred 9c5f7639b605
location: apps/api/src/identity/parent-auth.service.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: `postToProvider` wraps every failure path in `MailDispatchError`, and the `log` transport swallows its own append errors, so the gap is latent, not currently reachable.
status: open

### DW-33: `MAIL_LOG_FILE` (dev/E2E JSONL sink) has no boot-time guard forbidding it under `NODE_ENV=production`, so a stray env value would write parent emails and reset-link text to disk in production.
origin: spec-deferred 0efc83d8e807
location: apps/api/src/mail/mail.service.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: `resolveMailConfig` validates transport, from, and timeout for production but passes `logFile` through unconditionally.
status: open

### DW-34: Sign-up hardcodes `sessionEpoch: 0` when minting the first session rather than reading the value the row actually has, so a future change to the schema's default would silently desync the minted
origin: spec-deferred cf82aa87ae55
location: apps/api/src/identity/parent-auth.service.ts
source_spec: `spec-1-1-parent-account-sign-up-sign-in.md`
severity: low
reason: `ParentAuthService.signUp` calls `this.mintSession({ ...account, sessionEpoch: 0 })`; `account` comes from `ParentAccountService.create()`, which does not select `sessionEpoch`.
status: open
