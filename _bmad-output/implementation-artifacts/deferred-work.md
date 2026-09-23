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

### DW-35: Between sign-up and the first PIN there is a window in which anyone holding the signed-in device can set the Parent PIN themselves.
origin: spec-deferred 1b2c9d4e5f60
location: apps/api/src/identity/parent-pin.controller.ts, apps/web/src/app/parent/pin/page.tsx
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `POST /api/parent/pin` takes only the session cookie, as the story's acceptance criterion states ("given no PIN is set, when I set one"). On a shared device a child reaching the signed-in landing before the parent sets a PIN could set it. The web flow narrows the window by offering the gate directly from the signed-in landing; closing it entirely would need a credential the story does not state (the account password at first set, say).
status: open

### DW-36: A forgotten Parent PIN has no recovery path: the change route is elevation-gated, so the account-password alternative is only reachable by someone who can already enter the PIN.
origin: spec-deferred 95158d061212
location: apps/api/src/identity/parent-pin.controller.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: medium
reason: `POST /api/parent/pin/change` sits behind `ParentElevationGuard`, and `/parent/pin/change` redirects to the gate without a token. The UX places "Change PIN" in Parent View Settings, so the gating matches the plan, but no PRD, UX or epic document specifies a reset-PIN flow. A parent who forgets the PIN is permanently shut out of Parent View.
status: open

### DW-37: Setting the first PIN takes a single obscured field with no confirmation entry and no reveal control, so one typo sets a PIN the parent does not know.
origin: spec-deferred 0e324c7d38c5
location: apps/web/src/app/parent/pin/page.tsx
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `apps/web/src/app/parent/pin/page.tsx` renders one `type="password"` input for the set case. Combined with the absent recovery path above, a mistyped first PIN is unrecoverable.
status: open

### DW-38: Nothing rejects a trivially guessable PIN, and a change may set the PIN it is replacing.
origin: spec-deferred 9db1cf8f1794
location: apps/api/src/identity/pin-policy.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `isWellFormedPin` checks four digits only; `0000` and `1234` are accepted, and `changePin` never compares the new PIN with the current one. The stated adversary is a child who knows the parent, against whom a small blocklist is the cheapest control available.
status: open

### DW-39: An outstanding elevation token survives both a PIN change and "Leave Parent View"; only a password reset's epoch bump ends elevation early.
origin: spec-deferred 11f7c3adc3c1
location: apps/api/src/identity/parent-elevation.guard.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: medium
reason: `clearElevation()` drops the token from React state while the JWT stays valid server-side for the rest of its TTL, and `changePin` does not invalidate tokens minted under the old PIN. Ending elevation on demand needs its own epoch column - bumping `sessionEpoch` would also end the session cookie, which FR-1 says lasts until sign-out.
status: open

### DW-40: Account-password guesses on the PIN-change path have no counter or lock of their own.
origin: spec-deferred e93e0e2ab0ca
location: apps/api/src/identity/parent-pin.service.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: The password branch of `changePin` is deliberately exempt from the PIN lock and has no equivalent ceiling; only the per-address `parent` throttler bounds it. It is reachable only from inside an elevated session, which is what keeps this low.
status: open

### DW-41: The three new PIN screens have no component-level tests; their branches are covered only by the happy-path Playwright suite.
origin: spec-deferred 32e61c75eb5c
location: apps/web/vitest.config.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `apps/web/vitest.config.ts` runs `environment: 'node'`, so the web suite can exercise the elevation context and the API client but not a rendered page. The stale-status path, the lock re-enable timer and the 401-vs-network branches are verified by e2e alone.
status: open

### DW-42: Unreadable `deferred:` items in spec-1-2-parent-pin-for-parent-view.md
origin: spec-deferred-malformed feaed088fe8e
location: n/a
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: The dev session recorded deferred findings the orchestrator could not parse, so they were NOT filed as entries: item 1: not a mapping (got str). Read `spec-1-2-parent-pin-for-parent-view.md`'s frontmatter and re-file them by hand.
status: open

### DW-43: The browser (e2e) suite never exercises `POST /api/parent/elevation/refresh` or ceiling expiry; that behavior is covered only at the API integration layer.
origin: spec-deferred 1c60ce783bdf
location: e2e/tests/parent-pin.spec.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `e2e/tests/parent-pin.spec.ts` covers set/enter/lock/change/leave but has no scenario that calls the refresh endpoint or crosses the 8-hour ceiling from the browser. `parent-pin.int-spec.ts` already covers both at the HTTP layer, so this is a coverage-altitude gap, not an unverified behavior — the same shape as the existing web component-test gap.
status: open

### DW-44: No notification is sent when the Parent PIN is changed or repeatedly guessed wrong, so a parent has no signal that someone with device access is guessing at or has changed the PIN.
origin: spec-deferred 688f3eccb75f
location: apps/api/src/identity/parent-pin.service.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `ParentPinService.changePin` and the lockout path in `recordPinFailure`/`lockPin` never touch `MailModule`, which `IdentityModule` already imports for other identity flows. The intent never states a notification requirement, so this is a silent gap rather than a violation.
status: open

### DW-45: The change-PIN screen shows the accurate lock message on a 423 but never disables the form or shows a countdown, unlike the gate screen's lock handling.
origin: spec-deferred 7e4fd5108441
location: apps/web/src/app/parent/pin/change/page.tsx
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `apps/web/src/app/parent/pin/change/page.tsx`'s catch block renders `cause.message` (which does carry the correct lock-lifts-at text from `messageFor`) in a generic error `Alert`, but neither disables the submit button nor re-enables it on a timer the way `/parent/pin` does.
status: open

### DW-46: The `/parent/pin` gate screen has no link back to `/auth/signed-in`; the only way off the page is browser back or waiting out a lock's cool-down.
origin: spec-deferred 791dadd96a5d
location: apps/web/src/app/parent/pin/page.tsx
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `apps/web/src/app/parent/pin/page.tsx` renders the set/enter/locked states with no exit link, unlike the change-PIN screen which links back to `/parent`.
status: open

### DW-47: The e2e suite never drives the account-password branch of the change-PIN form, only the current-PIN branch.
origin: spec-deferred e658348f3a8d
location: e2e/tests/parent-pin.spec.ts
source_spec: `spec-1-2-parent-pin-for-parent-view.md`
severity: low
reason: `e2e/tests/parent-pin.spec.ts` covers set/enter/lock/change(current-PIN)/leave, but no scenario selects the "use account password" radio on the change screen, so that branch and its distinct 401/lock-exempt behaviour are unverified from the browser — the same coverage-altitude shape already recorded for the refresh/ceiling gap.
status: open

### DW-48: No audit trail exists for parent-side Student Profile mutations: create, rename, Grade-Level change, archive and restore write no actor and no record.
origin: spec-deferred d18578588495
location: apps/api/src/identity/student-profile.service.ts
source_spec: `spec-1-3-student-profile-management.md`
severity: low
reason: Admin writes all go through AdminAuditService (AD-25), but nothing equivalent covers the parent surface. `archivedAt` is the only trace any of these five operations leaves, and renames and Grade-Level changes leave none at all. Epic 8's deletion path and any support question ("who archived this profile, and when?") have nothing to read.
status: open

### DW-49: Nothing bounds the number of Student Profiles an elevated parent can create.
origin: spec-deferred 57668f54b73d
location: apps/api/src/identity/student-profile.service.ts create()
source_spec: `spec-1-3-student-profile-management.md`
severity: low
reason: The Account-Tier cap is deliberately Epic 9 (FR-31) and the suite asserts six profiles succeed on a Free account. Separately from that product rule, no sanity ceiling exists, so an authenticated create loop inserts rows without limit. This is an availability concern rather than the tier rule, and it can outlive Epic 9 if the cap lands as a tier figure alone.
status: open

### DW-50: Display-name normalisation does not strip zero-width, bidi-override or other format/control characters.
origin: spec-deferred b8b038d12808
location: apps/api/src/identity/student-profile-policy.ts
source_spec: `spec-1-3-student-profile-management.md`
severity: low
reason: `normaliseDisplayName` applies NFKC, collapses whitespace and trims, which leaves U+200B and bidi overrides intact. A name can therefore render invisibly or direction-flipped in Parent View, and two visually identical names can differ.
status: open

### DW-51: `listSelectableGradeLevels()` is unbounded (no take/skip) and is read on every Students screen load.
origin: spec-deferred bfc9f9303c9b
location: apps/api/src/admin/taxonomy.service.ts
source_spec: `spec-1-3-student-profile-management.md`
severity: low
reason: Same class as DW-8 (the unbounded Parent Accounts list): `findMany` with a where and an orderBy and no limit. Harmless at today's taxonomy size, unbounded by construction.
status: open

### DW-52: The web app has no render-testing setup, so no Parent View screen behaviour is unit tested - only exported pure helpers and copy strings.
origin: spec-deferred 50727f8d28ac
location: apps/web/vitest.config.ts
source_spec: `spec-1-3-student-profile-management.md`
severity: medium
reason: `apps/web/vitest.config.ts` runs `environment: 'node'` and `apps/web/package.json` carries neither jsdom nor @testing-library/react. Every web spec in the repo therefore tests extracted functions; per-row pending locks, draft-survives-a-rejection, and error rendering are reachable only through Playwright, which is slower and coarser.
status: open

### DW-53: Display-name length is bounded by UTF-16 code-unit count, not code points or grapheme clusters, so astral-plane characters (many emoji) count double and an unpaired surrogate is not explicitly
origin: spec-deferred 7f6c751195d8
location: apps/api/src/identity/student-profile-policy.ts
source_spec: `spec-1-3-student-profile-management.md`
severity: low
reason: `DISPLAY_NAME_MAX_LENGTH` gates both the DTO's `@MaxLength` and `isAcceptableDisplayName` on `string.length`, which counts UTF-16 units. A name built from astral-plane characters therefore has an unpredictable effective character budget, and no test exercises a surrogate pair or a lone surrogate. Same class of gap as the existing zero-width/bidi-override normalisation item above.
status: open

### DW-54: Web unit specs assert component source text with regexes instead of rendering and driving the component.
origin: spec-deferred 9a23665cb5bb
location: apps/web/vitest.config.ts
source_spec: `spec-1-4-student-mode-parent-view-switching.md`
severity: medium
reason: apps/web/vitest.config.ts runs environment 'node' with no jsdom and no testing-library anywhere under apps/web/src, so BackToStudentMode.spec.tsx and student/page.spec.tsx pin behaviour as readFileSync + regex matches. They break on reformatting and pass on code that is structurally right but behaviourally wrong. Pre-existing repo-wide convention, not introduced here; fixing it means adding a jsdom test environment.
status: open

### DW-55: GET /api/student/session sends no Cache-Control: no-store though it returns a named child's profile keyed only on a cookie.
origin: spec-deferred 670e4d3ab418
location: apps/api/src/identity/student-mode.controller.ts
source_spec: `spec-1-4-student-mode-parent-view-switching.md`
severity: medium
reason: grep for Cache-Control across apps/api/src returns nothing: no route in the API sets it, so this is an API-wide gap rather than a student-route one. An intermediary or bfcache can re-serve the profile after the binding changed.
status: open

### DW-56: isFirst can be observed as true by two concurrent first-profile creates under read-committed isolation.
origin: spec-deferred 3c617fa7e711
location: apps/api/src/identity/student-profile.service.ts
source_spec: `spec-1-4-student-mode-parent-view-switching.md`
severity: low
reason: StudentProfileService.create counts active profiles inside its own transaction; two simultaneous POST /api/parent/students can each see a count of 1 and each mint a binding, last response winning. Both bindings name a profile of the same account, so the consequence is a nondeterministic choice rather than a leak.
status: open

### DW-57: The API integration suite fails one shifting test per run when executed under full parallel load against the shared Postgres container.
origin: spec-deferred a93468b14c12
location: apps/api/test
source_spec: `spec-1-4-student-mode-parent-view-switching.md`
severity: medium
reason: Reproduced on the pre-change tree (changes stashed): the baseline run failed parent-account.int-spec.ts's row-lock test, while the post-change run failed admin-auth.int-spec.ts. Every implicated spec passes when run alone. Pre-existing contention, not a regression from this story.
status: open

### DW-58: The exit's live-region announcement can go unheard: the component unmounts on navigation to /student before assistive tech has a chance to perceive it.
origin: spec-deferred f0af6345afbe
location: apps/web/src/app/parent/_components/BackToStudentMode.tsx
source_spec: `spec-1-4-student-mode-parent-view-switching.md`
severity: medium
reason: BackToStudentMode.bindAndLeave calls setAnnounced(...) then router.replace('/student') in the same tick. That navigation leaves the /parent route group and unmounts the component — and its live region — along with it. No test renders the component to observe whether the announcement is perceived before the unmount; the existing spec only asserts on the component's source text.
status: open

### DW-59: A profile archived between the deliberate exit's ownership check and the mint can leave the binding cookie briefly naming an already-archived profile.
origin: spec-deferred 00ba7a60c655
location: apps/api/src/identity/student-profile.controller.ts
source_spec: `spec-1-4-student-mode-parent-view-switching.md`
severity: low
reason: student-profile.controller.ts's bind() calls findSelectable(...) to validate the profile, then mintBinding(...) and setStudentModeCookie(...), with no re-check between them. A concurrent archive in that gap lets the 204 response set a cookie for a profile that is no longer selectable. Self-correcting: the next GET /api/student/session read finds the profile unselectable and refuses with the cookie cleared, the same outcome archiving-after-bind already produces.
status: open
