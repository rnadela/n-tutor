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

### DW-60: Web unit specs still pin component behaviour by matching component source text, because apps/web runs its unit tests without a DOM.
origin: spec-deferred b2d4edd00725
location: apps/web/vitest.config.ts
source_spec: `spec-1-5-parent-view-idle-expiry.md`
severity: medium
reason: apps/web/vitest.config.ts runs environment 'node' with no jsdom and no testing-library, so ParentIdleExpiry.spec.tsx asserts on readFileSync + toContain for the parts of the component that are not extractable as pure functions (the effect body, the Date.parse guard, the onExpire wiring). Those assertions break on a reformat and pass on code that is structurally right and behaviourally wrong. Pre-existing convention recorded in Story 1.4; the story's own mitigation was to push the logic into idle-expiry.ts, which is unit-tested for real. Fixing the convention means adding a jsdom test environment.
status: open

### DW-61: The parent layout imports a page module, so the Students screen's whole graph loads on every Parent View surface including the PIN gate.
origin: spec-deferred d876370ff87a
location: apps/web/src/app/parent/_components/ParentIdleExpiry.tsx
source_spec: `spec-1-5-parent-view-idle-expiry.md`
severity: low
reason: apps/web/src/app/parent/layout.tsx mounts BackToStudentMode and ParentIdleExpiry, both of which import endsParentView from '../students/page' — a 'use client' module pulling ~15 MUI imports, parentApi and parentCopy. endsParentView is a pure predicate over ParentApiError and belongs in apps/web/src/lib/parent-api.ts. The coupling pre-dates this story (Story 1.4 introduced it via BackToStudentMode); this story's clock follows the existing import rather than adding a new kind of dependency.
status: open

### DW-62: Nothing caps how many uncommitted-state slots one account can hold, so an elevated parent can grow the store without bound for the full 72-hour window.
origin: spec-deferred 084011b39b1f
location: apps/api/src/identity/uncommitted-state.service.ts
source_spec: `spec-1-6-uncommitted-parent-input-survives-expiry-mechanism.md`
severity: medium
reason: `scope` is a free-form caller-supplied string and every distinct (kind, scope) pair opens a new row holding up to the payload ceiling. There is no per-account row count, no byte budget, and the routes skip the credential throttler bucket because none of them runs argon2. The read is now page-capped, which bounds the response but not the store. A cap is a product decision that belongs with Epic 9's allowance work rather than with the mechanism.
status: open

### DW-63: The 72-hour sweep runs opportunistically on each save rather than as the pg-boss schedule AD-33 states, so an account that never saves again keeps expired rows on disk.
origin: spec-deferred 085e91f0f7bb
location: apps/api/src/identity/uncommitted-state.service.ts
source_spec: `spec-1-6-uncommitted-parent-input-survives-expiry-mechanism.md`
severity: medium
reason: This repo has no pg-boss, no worker entrypoint and no job table; standing all three up belongs to the story that first needs background work (Epic 3's orphaned-capture sweep). Reads filter on `expiresAt`, so an expired row is invisible the instant the clock passes regardless — but the bytes are only deleted when some later save on any account triggers `sweepExpired()`. The scheduled job, when it lands, calls that same method unchanged.
status: open

### DW-64: The hand-rolled "names no storage API" source scan now exists twice, with two independently drifting comment-stripping regexes.
origin: spec-deferred d3210dc9edaa
location: apps/web/src/lib/parent-api.spec.ts
source_spec: `spec-1-6-uncommitted-parent-input-survives-expiry-mechanism.md`
severity: low
reason: `apps/web/src/lib/elevation.spec.tsx` and `apps/web/src/lib/parent-api.spec.ts` each carry their own copy. Both strip comments with a line-start-only filter that misses trailing comments, and both match literal identifiers only, so an indirection such as `globalThis['local' + 'Storage']` passes either. Both files now also assert at runtime with storage spies, which is the real guard; unifying the scan means editing a Story 1.4 file this story had no other reason to touch.
status: open

### DW-65: The address-resolution value carries no possessive or pluralisation helper, so later epics' result strings cannot render "your test" versus "Ada's test" through it.
origin: spec-deferred 7fe40d5d816f
location: apps/web/src/components/Address.tsx
source_spec: `spec-1-7-design-system-foundation.md`
severity: low
reason: `AddressValue` exposes `name`, `Name` and `verb` only. UX-DR31 covers every result/analytics string describing student work, and Epic 5/7 copy will need a possessive form. No such string exists yet in Epic 1, so nothing is broken today — but the first consumer will either extend the mechanism or reintroduce a literal.
status: open

### DW-66: Both variable font families are imported as full CSS entrypoints with no preload and no fallback metric matching, so every weight and subset ships and the swap is unmeasured.
origin: spec-deferred 1ebdb826a3ff
location: apps/web/src/app/layout.tsx
source_spec: `spec-1-7-design-system-foundation.md`
severity: low
reason: `apps/web/src/app/layout.tsx` imports the two `@fontsource-variable` index entrypoints, which pull every subset including latin-ext and cyrillic. No `size-adjust`/`ascent-override` is declared on the fallback stacks and no face is preloaded, so a layout shift on swap is possible. UX-DR5 requires self-hosting, which is met; bundle weight and CLS are not addressed by any requirement or test.
status: open

### DW-67: The new jsx-a11y ESLint rules (UX-DR30) are not run by any automated gate, so a violation ships undetected unless a developer runs lint manually.
origin: spec-deferred ceadb9df77a2
location: apps/web/package.json
source_spec: `spec-1-7-design-system-foundation.md`
severity: low
reason: `apps/web/package.json`'s `"lint"` script is separate from `"build"` and `"test"`, neither of which invokes ESLint, and the repository has no `.github/workflows` directory, so no CI job runs it either. This is a repo-wide condition that predates this story — no prior story's lint output is enforced automatically either — so the new jsx-a11y rules inherit the same gap rather than introducing a new one.
status: open

### DW-68: DestructiveConfirmDialog has no error-state copy or slot for a rejected account password, so the first consumer that wires it to real re-authentication has nowhere defined to show that failure.
origin: spec-deferred 135ec645b19a
location: apps/web/src/components/Dialog.tsx
source_spec: `spec-1-7-design-system-foundation.md`
severity: low
reason: `commonCopy.destructive` defines title/irreversible/labels/confirm/cancel but nothing for a failed confirm. This story ships the primitive only, with no API wiring (out of scope per the spec's "Never" boundary), so nothing is broken today — but `onConfirm(password)` currently has no way to report back that the password was wrong.
status: open

### DW-69: The destructive-confirm password field has no Enter-to-submit: confirming requires clicking the button even once a password is typed.
origin: spec-deferred c9aced4f6a98
location: apps/web/src/components/Dialog.tsx
source_spec: `spec-1-7-design-system-foundation.md`
severity: low
reason: `DestructiveConfirmDialog`'s `TextField` carries no `onKeyDown`/form submit handling, so pressing Enter while focused in the field does nothing. Not required by any acceptance criterion or UX-DR in this story; a reasonable follow-up affordance.
status: open

### DW-70: DestructiveConfirmDialog's `onConfirm(password)` call, the busy/firing interlock, and AppSnackbar's unmount cleanup are only verified through their extracted pure functions (`passwordOnToggle`,
origin: spec-deferred 8c6ff3f1b8fe
location: apps/web/src/components/Dialog.tsx, apps/web/src/components/Snackbar.tsx
source_spec: `spec-1-7-design-system-foundation.md`
severity: low
reason: The story's own constraint forbids introducing a DOM test runner — tests run under vitest in the `node` environment against `renderToStaticMarkup`, which never processes effects or click handlers. The pure-function extraction already carries the actual logic under test; only the wiring between a real DOM event and that logic goes unverified, and closing that gap would mean revisiting the no-DOM-runner constraint.
status: open

### DW-71: `theme.spec.ts` asserts `baseTheme.spacing(3)` against MUI's own generated CSS-variable string, so a MUI version bump could break the assertion with no real regression behind it.
origin: spec-deferred b4fef3ccd7b7
location: apps/web/src/theme/theme.spec.ts
source_spec: `spec-1-7-design-system-foundation.md`
severity: low
reason: The assertion checks the literal string `'3 * var(--mui-spacing, 8px)'`, which is MUI's internal `spacing()` output format rather than this story's own token. `package.json` has already carried multiple major-version bumps across this epic, so this coupling is more likely than most to need attention on the next one.
status: open

### DW-72: The api integration suite is flaky under a full-suite run, failing a different spec on each run with unrelated 404s or 60s timeouts.
origin: spec-deferred d2bf38dd80a2
location: apps/api/vitest.config.ts, apps/api/test/harness.ts
source_spec: `spec-3-2-page-management-before-submit.md`
severity: medium
reason: Reproduced on HEAD (b38a804) with this story's changes stashed: a full `pnpm --filter api run test` failed `uncommitted-state.int-spec.ts` with "expected 200 OK, got 404 Not Found". Three runs with the story applied failed `student-mode.int-spec.ts`, then `parent-auth.int-spec.ts`, then `taxonomy.int-spec.ts`; each of those files passes when run alone. The suite declares `fileParallelism: false`, so this is cross-file state or resource leakage between Nest apps rather than parallelism.
status: open

### DW-73: Two password-reset E2E tests fail on a strict-mode violation because a second role="status" region exists on the page.
origin: spec-deferred 014852ca6cea
location: e2e/tests/parent-auth.spec.ts
source_spec: `spec-3-2-page-management-before-submit.md`
severity: medium
reason: `e2e/tests/parent-auth.spec.ts` uses `getByRole('status')`, which now matches both the page's own region and the global AnnouncementRegion that ThemeRegistry mounted in Story 1.7. Both ThemeRegistry.tsx and the reset-confirm page are unmodified at HEAD, and the failure artifacts were already in the working tree when this run started.
status: open

### DW-74: The in-flight "adding a page" indicator and the blocked-state reasons (page-limit, submit-blocked) render as plain text with no live-region wiring, so a screen-reader user only learns of those state
origin: spec-deferred 9d11992f5f68
location: apps/web/src/app/parent/capture/page.tsx
source_spec: `spec-3-2-page-management-before-submit.md`
severity: low
reason: `apps/web/src/app/parent/capture/page.tsx`: the `data-testid="adding"` span, `parentCopy.capture.limitReached(maxPages)`, and `parentCopy.capture.submitBlocked` are all plain `Typography` with no `role="status"` and no `useAnnounce()` call, unlike every completed add/move/delete/retake action, which is announced.
status: open

### DW-75: page.tsx's own gating and orchestration logic (isDraft, addable, submittable, the ordinal lookups in retakePage/deletePage) is exercised in page.spec.tsx only by grepping the component's source text
origin: spec-deferred 4c9f70cf2e05
location: apps/web/src/app/parent/capture/page.tsx, apps/web/src/app/parent/capture/page.spec.tsx
source_spec: `spec-3-2-page-management-before-submit.md`
severity: low
reason: `apps/web/src/app/parent/capture/page.spec.tsx` asserts things like `expect(PAGE_SOURCE).toContain('const isDraft = sourceTest !== null')`. These assertions execute nothing: a differently-phrased but equally buggy implementation would pass, and a correct implementation phrased differently would fail. Real behavioral coverage of this logic exists only in `e2e/tests/parent-capture.spec.ts`, which is a full-stack Playwright suite rather than a colocated, DOM-free spec on an exported function -- the shape the story's own "pure functions with colocated specs" language points at. `apps/web/src/lib/page-order.ts` already extracts the narrower ordering/count rules the story's own task list names; this is about the rest of the screen's decision logic that stayed inline.
status: open

### DW-76: source_test.subjectId carries a Restrict foreign key with no index, while the grade-level axis is indexed.
origin: spec-deferred 656b057f1784
location: apps/api/prisma/schema.prisma
source_spec: `spec-3-3-subject-grade-level-assignment.md`
severity: low
reason: Postgres does not index foreign-key columns automatically. Subject-axis reads planned for Epics 4 and 7, and the Restrict check run on every Subject delete, both scan source_test. The spec asked only for @@index([gradeLevelId]), so the omission is deliberate-by-spec rather than an implementation slip.
status: open

### DW-77: A Subject patch against a draft whose stored Grade Level an Admin has since withdrawn is refused with the Subject sentence, naming the wrong cause.
origin: spec-deferred f5763ce515a7
location: apps/api/src/sourcetest/source-test.service.ts
source_spec: `spec-3-3-subject-grade-level-assignment.md`
severity: low
reason: isSubjectOffered delegates to listSelectableSubjects, which answers [] for a disabled Grade Level rather than throwing, so every subjectId patch on such a draft returns 400 SUBJECT_NOT_AVAILABLE. Submission is unaffected, and the stored classification still resolves, so this is a message-accuracy gap on a rare state rather than a broken rule.
status: open

### DW-78: One classification patch issues more queries than it needs, fetching the whole offered Subject list only to test membership and re-resolving both names after the write.
origin: spec-deferred fbad4082d2f7
location: apps/api/src/sourcetest/source-test.service.ts
source_spec: `spec-3-3-subject-grade-level-assignment.md`
severity: low
reason: classify runs requireDraft, resolveSubject, listSelectableSubjects, updateMany and then a full read that resolves both taxonomy names again. Membership could be a single join-row read, and the answering view could be built from state the method already holds. No measured problem at current volumes.
status: open

### DW-79: A pre-existing E2E failure in the auth spec, surfaced by running the full suite during this story and untouched by it.
origin: spec-deferred 86153ee3e6ac
location: e2e/tests/parent-auth.spec.ts:105
source_spec: `spec-3-3-subject-grade-level-assignment.md`
severity: medium
reason: e2e/tests/parent-auth.spec.ts:105 uses getByRole('status'), which became a strict-mode violation when story 1-7 added a global polite live region in ThemeRegistry. No file in this story's diff touches auth or the live region, and the capture spec passes.
status: open

### DW-80: The classify() announcement on the capture screen assumes a patch never carries both subjectId and gradeLevelId at once, so a combined patch would describe only the grade-level change and never
origin: spec-deferred 2c80b1effee5
location: apps/web/src/lib/classification.ts (classificationAnnouncement)
source_spec: `spec-3-3-subject-grade-level-assignment.md`
severity: low
reason: classificationAnnouncement branches solely on whether gradeLevelId is present in the patch; today's UI only ever sends one field per select's onChange, so the combined path is unreachable from the current screen. The DTO, API and service all accept both fields together, so a future caller (e.g. a combined-picker UI) would hit this silently.
status: open

### DW-81: loadGradeLevels/loadSubjects' out-of-order-response guard is verified only by asserting the guard call text is present in page.tsx's raw source, not by exercising the guard against
origin: spec-deferred 9d863e3434a7
location: apps/web/src/app/parent/capture/page.tsx (loadGradeLevels, loadSubjects)
source_spec: `spec-3-3-subject-grade-level-assignment.md`
severity: medium
reason: page.spec.tsx's coverage of applyIfCurrent(gradeLevelsCurrent.current, ...) and applyIfCurrent(subjectsCurrent.current, ...) is `PAGE_SOURCE.toContain(...)` against the file text; the spec file never renders CapturePage, only PageStrip. No test (unit or e2e) resolves two grade-level/subject reads out of order and asserts the later-issued one wins. The guard mirrors the already-working profiles/draft guards, so it is very likely correct, but that is unverified.
status: open

### DW-82: The API integration suite carries a pre-existing intermittent failure, most often in the PIN cool-down case, unrelated to Story 3.5.
origin: spec-deferred a6b020246054
location: apps/api/test/parent-pin.int-spec.ts
source_spec: `spec-3-5-structured-extraction.md`
severity: medium
reason: Reproduced by running parent-pin.int-spec.ts, taxonomy.int-spec.ts and source-test.int-spec.ts together without any Story 3.5 file: roughly one run in four fails "accepts the same correct PIN once the cool-down has lapsed". extraction.int-spec.ts ran six times in isolation with zero failures. Present before this story's baseline revision.
status: open

### DW-83: A Submitted Source Test still carries the 72-hour uncommitted-state expiresAt, so the general Source Test read 404s three days after capture.
origin: spec-deferred 558a79e167d2
location: apps/api/src/sourcetest/source-test.service.ts
source_spec: `spec-3-5-structured-extraction.md`
severity: medium
reason: submit() never clears or extends SourceTest.expiresAt, and requireLive() rejects any expired row regardless of status (apps/api/src/sourcetest/source-test.service.ts). Story 3.5 worked around this for its own status route by adding requireReadable, which honours expiry only while the row is a Draft; the pre-existing read path was left alone because it belongs to Stories 3.2/3.3 and AD-16.
status: open

### DW-84: The web unit tier runs in a node environment with no DOM library, so the capture screen's interactive behavior is asserted by grepping its own source text rather than by running it.
origin: spec-deferred 3e867c264d7e
location: apps/web/vitest.config.ts
source_spec: `spec-3-6-thin-extraction-warning.md`
severity: medium
reason: apps/web/vitest.config.ts sets environment: 'node' and the workspace has no jsdom or testing-library dependency, so page.spec.tsx can only render presentational components with renderToStaticMarkup and otherwise match literals against PAGE_SOURCE. That predates this story — the same idiom covers Stories 3.2 and 3.3 — but it now also carries this story's gate, poll, retry and dismissal wiring, each of which a behavior-preserving refactor breaks and a behavior regression can slip past. Closing it means adding a DOM tier to apps/web, which is an architectural change no single story should make unannounced.
status: open

### DW-85: The healthy (non-thin) proceed path is never exercised in a browser, because Playwright starts the API once with one environment.
origin: spec-deferred 3755172d893d
location: playwright.config.ts
source_spec: `spec-3-6-thin-extraction-warning.md`
severity: medium
reason: The thin verdict is covered end to end, and the healthy one is covered at the pure-rule tier (extraction-status.spec.ts) and the API tier (extraction.int-spec.ts, via AI_FAKE_QUESTIONS_PER_PAGE). Nothing clicks proceed on a succeeded, non-thin Extraction in a real page and asserts no dialog opens. Closing it needs a second Playwright project running the API under a raised AI_FAKE_QUESTIONS_PER_PAGE, which is a test-infrastructure change rather than a fix to this diff.
status: open

### DW-86: The API integration suite carries a pre-existing intermittent failure under full-suite parallelism, unrelated to this story.
origin: spec-deferred 23f70b170ef4
location: apps/api/test/harness.ts
source_spec: `spec-3-6-thin-extraction-warning.md`
severity: medium
reason: One `pnpm --filter api run test:int` run in this session failed a single case; the immediately following run passed 343/343, and extraction.int-spec.ts passes in isolation on every run. Reproduced on a clean tree with every Story 3.6 change stashed, where parent-auth.int-spec.ts failed instead — the failing file moves between runs and the message is typically "No elevation token in the response body", which is cross-file contention on the one shared Postgres. Already logged against Story 3.5.
status: open

### DW-87: Two concurrent generation requests for one account can each clamp against the same remaining allowance and overspend the tier limit.
origin: spec-deferred fa3ed148f5e1
location: apps/api/src/practicetest/practice-test.service.ts (request)
source_spec: `spec-4-1-practice-test-generation-bounded-priced-async.md`
severity: medium
reason: `PracticeTestService.request` counts only `PracticeTest` rows that already carry `chargedAt`; a Queued or Running job has none, and nothing counts the outstanding `requestedCount` of unsettled jobs. Two tabs or a double-click on an account with 2 remaining both enqueue 2 and 4 drafts land charged. The intent explicitly defers the hard block at cap to Epic 9, so this is out of this story's scope.
status: open

### DW-88: The Generation Allowance window query exists twice, in two modules, with the half-open-window rule restated in prose in three places.
origin: spec-deferred f40ebcad8d77
location: apps/api/src/allowance/allowance.service.ts
source_spec: `spec-4-1-practice-test-generation-bounded-priced-async.md`
severity: low
reason: `ARTIFACT_COUNTERS.generation` in `allowance.service.ts` and the in-transaction count in `PracticeTestService.request` are the same query written twice; a change to the window semantics has to land in both or usage and clamping disagree.
status: open

### DW-89: The integration tier fails roughly one run in two with a parent account vanishing mid-test, in a different untouched file each time.
origin: spec-deferred a786cb1710e9
location: apps/api/test/harness.ts
source_spec: `spec-4-1-practice-test-generation-bounded-priced-async.md`
severity: medium
reason: Reproduced on a stashed baseline (run 1 failed in parent-pin.int-spec.ts, run 2 passed), the same rate and signature as this branch. Pre-existing cross-file isolation or truncation race in the integration harness, not caused by this story, but it makes CI noisy.
status: open

### DW-90: Two parent-auth password-reset E2E tests fail on a strict-mode locator violation.
origin: spec-deferred f230636e20d5
location: e2e/tests/parent-auth.spec.ts:105
source_spec: `spec-4-1-practice-test-generation-bounded-priced-async.md`
severity: medium
reason: `getByRole('status')` resolves to both the MUI success alert and the empty live region, so `toContainText('password is saved')` fails. Confirmed failing identically on a clean stash of this branch, so it predates this story.
status: open

### DW-91: A parent (or a double-submitted request, e.g. two tabs) can enqueue a second GenerationJob for the same Source Test while one is already Queued or Running.
origin: spec-deferred e2a5e1c2d5f8
location: apps/api/src/practicetest/practice-test.service.ts (request, statusFor)
source_spec: `spec-4-1-practice-test-generation-bounded-priced-async.md`
severity: low
reason: `PracticeTestService.request` never checks for an existing unsettled job before inserting a new one. `statusFor` only ever surfaces the newest job by `createdAt`, so the older job keeps running and keeps spending the allowance with no UI surface showing it. The normal single-page UI flow (picker replaced by progress view once a job starts) makes this unreachable through ordinary use; it needs a second tab or a direct API call. Out of this story's scope for the same reason concurrent-request overspend is: the intent explicitly defers a hard block at cap to Epic 9.
status: open

### DW-92: A charge can land in a period window different from the one `request()` clamped against, if the period rolls over while a job is mid-run; nothing re-verifies the account is still within its limit at
origin: spec-deferred 8b1694b12b26
location: apps/api/src/practicetest/practice-test.service.ts (land)
source_spec: `spec-4-1-practice-test-generation-bounded-priced-async.md`
severity: medium
reason: `land()` re-reads `allowance.windowFor` per draft and rejects only a clock/zone anomaly (the instant falling outside its own just-computed window); it never re-clamps against `remainingFor(used, limit)`. A job that spans a period boundary can therefore land a draft the new period's limit would have refused. Same category as the already-recorded concurrent-request overspend risk, and out of scope for the same reason: the intent explicitly defers hard-block-at-cap enforcement to Epic 9.
status: open

### DW-93: The I/O matrix's "Partial success" and "Total failure" rows are proven at the backend (real job, real DB) and the frontend (real component, mocked API) separately, but never joined at the
origin: spec-deferred 682ea5a144ac
location: e2e/tests/parent-practice-test.spec.ts
source_spec: `spec-4-1-practice-test-generation-bounded-priced-async.md`
severity: low
reason: `apps/api/test/practice-test.int-spec.ts` covers partial/total failure against the real worker; `apps/web/.../generate/[sourceTestId]/page.spec.tsx` covers the same copy against a fabricated `GenerationJobView`. `e2e/tests/parent-practice-test.spec.ts` covers only the happy path, leave/return-while-succeeding, and the two allowance- boundary cases. A defensible simplification (the e2e harness has no seam to force a real AI failure through the fake transport at a controlled point), not a regression.
status: open

### DW-94: A weighted job whose stored Topic has since vanished from the Extraction spends the whole AI_MAX_ATTEMPTS budget reaching an unsatisfiable floor.
origin: spec-deferred 9bfedbd04a2c
location: apps/api/src/practicetest/practice-test.service.ts (planFor)
source_spec: `spec-4-2-topic-weighted-regeneration.md`
severity: medium
reason: `planFor` takes `weightedTopic` from the job row by design, and the Design Notes argue against re-resolving it against the run's own Extraction read. Neither addresses the case where the label is no longer there: the prompt then names a Topic absent from the topic list, no payload can meet the floor, and every attempt is a paid provider call spent to be refused. A `GenerationTargetMissing`-style early bail would cost one read.
status: open

### DW-95: "A weighted draft still covers the Extraction's other Topics" is instructed in the prompt but enforced nowhere and asserted by no test.
origin: spec-deferred 7af43280364b
location: apps/api/src/practicetest/practice-test-payload.ts (validateGenerationPayload)
source_spec: `spec-4-2-topic-weighted-regeneration.md`
severity: low
reason: `validateGenerationPayload` checks only the floor, so a draft putting every question on the weighted Topic passes. `fakePracticeTestPayload` spreads the remainder, so the integration tier cannot surface it either. Enforcing it in code needs a rule that does not false-reject a single-Topic Extraction, which is a product decision rather than a mechanical fix.
status: open

### DW-96: The parent-facing weighted control shipped on the generate screen, while the UX design sites weighted regeneration inside the Epic 7 Topic drill-down with the Topic pre-selected.
origin: spec-deferred c124914b979f
location: apps/web/src/app/parent/generate/[sourceTestId]/page.tsx
source_spec: `spec-4-2-topic-weighted-regeneration.md`
severity: medium
reason: UX decision Q12c states weighted regenerate lives in the Topic drill-down and that there is no duplicate entry point in v0. This story's picker browses all Extraction Topics from the generate screen and needs a `GET …/practice-tests/topics` route that the drill-down caller will never use, since it already holds the Topic. Epic 7 has to reconcile the two surfaces — keep both deliberately, or retire this one when the drill-down ships.
status: open

### DW-97: The integration tier fails roughly one full run in two, in a different untouched file each time, with a parent account vanishing mid-test.
origin: spec-deferred e3692329dcba
location: apps/api/test/harness.ts
source_spec: `spec-4-2-topic-weighted-regeneration.md`
severity: medium
reason: Observed across five full `pnpm --filter api test` runs on this branch, failing in extraction, source-test, uncommitted-state and practice-test in turn and passing clean once. `practice-test.int-spec.ts` passes 47/47 in isolation on three consecutive runs. Same signature already recorded as deferred in Story 4.1; pre-existing cross-file harness isolation, not caused by this change.
status: open

### DW-98: `pnpm lint` cannot run in this environment, so the lint half of every spec's verification section is unverifiable.
origin: spec-deferred 4635b2c0f968
location: package.json (lint script)
source_spec: `spec-4-2-topic-weighted-regeneration.md`
severity: low
reason: `pnpm lint` exits with `Command "eslint" not found`. Pre-existing and already noted in Story 4.1's run; formatting is still verified through `prettier --check`.
status: open

### DW-99: The generate screen's tests verify almost entirely by grepping the page's own source text rather than rendering it, so a broken wiring that merely contains the right tokens would still pass.
origin: spec-deferred 10cad6073382
location: apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx
source_spec: `spec-4-2-topic-weighted-regeneration.md`
severity: medium
reason: `page.spec.tsx` has no React Testing Library usage anywhere in the directory; nearly every assertion is `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. This predates this story and spans the whole file, including the new Topic-weighting behavior added here (e.g. the 409-degrade-to-empty-topics branch), so this story's own new UI logic inherits the same untested-at-runtime gap as the rest of the screen.
status: open

### DW-100: Nothing bounds how many Topic radio options the generate screen renders.
origin: spec-deferred 9940351f7e92
location: apps/web/src/app/parent/generate/[sourceTestId]/page.tsx
source_spec: `spec-4-2-topic-weighted-regeneration.md`
severity: low
reason: Topic labels are raw and never canonicalized, merged or deduplicated beyond exact-match normalization (AD-11), unlike `count`, which is clamped by `MAX_PER_REQUEST`. An Extraction with many distinct raw/OCR-noisy Topic labels could render an unbounded radio group with no discussed ceiling or scroll/collapse treatment.
status: open

### DW-101: The Pending drafts read is unbounded: every `Draft` row the account holds is returned and rendered, with no cap, cursor or stated ceiling.
origin: spec-deferred 3c15842b3bd5
location: apps/api/src/practicetest/practice-test.service.ts (draftsFor)
source_spec: `spec-4-3-draft-review.md`
severity: medium
reason: `draftsFor` issues `findMany` with no `take`, and the screen maps the whole array. The "every Question" acceptance criterion bounds the *question* list, not the draft list, which grows monotonically until Story 4.5 ships release and discard. `RESTORABLE_PAGE_SIZE` in `uncommitted-state.service.ts` is the repo's own precedent for capping a parent-facing list read. A cap needs a deliberate UI treatment for the overflow, which is a product decision rather than a mechanical fix.
status: open

### DW-102: Both new parent screens are covered by specs that grep their own source text rather than render them, so the 404, empty-list and error states have no executing test.
origin: spec-deferred dc262b0cbe68
location: apps/web/src/app/parent/drafts/page.spec.tsx
source_spec: `spec-4-3-draft-review.md`
severity: medium
reason: `drafts/page.spec.tsx` and `drafts/[practiceTestId]/page.spec.tsx` assert with `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. Moving the `draft-missing` alert inside the `draft !== null` block would leave every searched string in place and ship green. The screens are client components whose states appear only after an effect resolves, so a real render test needs a DOM the web tier does not have (`environment: 'node'`). Same gap already carried from Story 4.2 for the generate screen; this story adds two more instances of it.
status: open

### DW-103: `RichText` sits in the shared component directory but imports parent-only copy.
origin: spec-deferred 54847222ef18
location: apps/web/src/components/RichText.tsx
source_spec: `spec-4-3-draft-review.md`
severity: low
reason: It reads `parentCopy.drafts.fractionReading` and its types from `@/lib/parent-api`, while living beside `Screen`, `Dialog` and `LiveRegion`. The same segment structure is what a student will read in Epic 5, so the first student-side use either imports parent copy or forks the component. Taking the reading as a prop, or moving the string to shared copy, is a small refactor better made when the second caller actually exists.
status: open

### DW-104: Neither new screen announces its state changes, unlike every sibling Parent View surface.
origin: spec-deferred f48fb4936d4c
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx
source_spec: `spec-4-3-draft-review.md`
severity: low
reason: `capture/page.tsx` and `generate/[sourceTestId]/page.tsx` both drive the `LiveRegion` through the `Announcement`/`seq` machinery in `apps/web/src/lib/parent-view.ts`. The loading-to-loaded, error and draft-is-gone transitions here announce nothing beyond what the `role="alert"`/`role="status"` alerts carry on their own.
status: open

### DW-105: The two Parent View draft screens are covered by specs that grep their own source text rather than render them, so no executing test drives the edit, delete or slot-restore states in a DOM.
origin: spec-deferred cf2f6a26a114
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx
source_spec: `spec-4-4-draft-editing.md`
severity: medium
reason: `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` asserts with `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. Inverting the slot filter to `slot.kind === 'DraftEdit'` would leave every searched string in place and ship green with restore entirely dead. `apps/web/vitest.config.ts` sets `environment: 'node'` and no testing-library dependency exists under `apps/web`, so a real render test needs a DOM the web tier does not have. Carried from Story 4.3; this story adds more instances of it. The Playwright pass is the compensating surface.
status: open

### DW-106: Two deletes committing concurrently on one draft can collide on the ordinal renumber rather than serialising.
origin: spec-deferred 314454a0b7ca
location: apps/api/src/practicetest/practice-test.service.ts (deleteQuestion)
source_spec: `spec-4-4-draft-editing.md`
severity: medium
reason: `deleteQuestion` reads the survivors and rewrites their ordinals without locking the parent `practice_test` row first, so two overlapping transactions can both negate and both renumber; the loser surfaces a unique-constraint violation as a 500 rather than as this module's own answer. The window needs two in-flight deletes from one elevated parent, which the screen does not produce (its controls disable while a mutation is in flight), and the fix is a `SELECT ... FOR UPDATE` on the parent row whose interaction with the charging fence deserves its own pass.
status: open

### DW-107: The `DraftEdit` slot's restore, debounced save and discard mechanism, and the screen's error path on a failed edit or delete, run through no test that actually renders or executes them.
origin: spec-deferred 305ba0351c52
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (restore effect, debounced slot save, discardSlot/discardEverySlot); apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx
source_spec: `spec-4-4-draft-editing.md`
severity: medium
reason: `page.spec.tsx`'s slot-restore cases (e.g. "holds a typed-but-unsaved edit in the DraftEdit slot", "restores the held edits once per draft id", "checks every field of a restored slot", "debounces the slot write") are all `expect(PAGE_SOURCE).toContain(...)` assertions against the raw source text, same as the general gap already deferred above. Neither of the new Playwright specs in `e2e/tests/parent-practice-test.spec.ts` leaves an editor open and reloads to observe a restore, or forces a 4xx/network failure to observe `data-testid="draft-action-error"`. Swapping the merge-precedence spread at `setEdits((open) => ({ ...restored, ...open }))` to `{ ...open, ...restored }` -- which would let a slow slot fetch clobber text a parent is actively typing, exactly the race the surrounding comment says the ordering prevents -- would not fail any test in this diff.
status: open

### DW-108: The release and discard controls, their confirmations and the new Student Home list are covered by specs that grep their own source text rather than render them, so no executing unit test drives
origin: spec-deferred a5ad18184523
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx; apps/web/src/app/student/page.spec.tsx
source_spec: `spec-4-5-release-or-discard.md`
severity: medium
reason: `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` and `apps/web/src/app/student/page.spec.tsx` assert with `expect(SOURCE).toContain(...)` against `readFileSync(page.tsx)`. Swapping `RELEASED_DRAFTS_HREF` and `DISCARDED_DRAFTS_HREF` at the one `router.replace(transition === ...)` call site -- which would tell a parent a release was a discard, and the reverse -- leaves every searched string in place and ships green. `apps/web/vitest.config.ts` sets `environment: 'node'` and no testing-library dependency exists under `apps/web`, so a real render test needs a DOM the web tier does not have. Carried from Stories 4.3 and 4.4; this story adds more instances of it. The Playwright pass is the compensating surface, and it does assert both landing sentences by their own test ids.
status: open

### DW-109: The api test suite fails 1-2 non-deterministic tests on a full parallel run, at the baseline revision as well as on this story, always as a 404 on an unrelated parent or admin route.
origin: spec-deferred 870c1a7ad9b9
location: apps/api/vitest.config.ts; apps/api/test/harness.ts
source_spec: `spec-4-5-release-or-discard.md`
severity: medium
reason: Reproduced at `cf36aab` by stashing this story's changes: two consecutive full runs of `pnpm --filter api test` failed two tests each, a different pair every time (`the request > answers 404 for a Source Test belonging to another account`, `topic weighting > judges the label itself, not the padding around it`, `validation.int-spec.ts > rejects a missing name with 400`, `source-test.int-spec.ts > keeps a Subject the new Grade Level still offers`). The stack is always the same shape: a setup call such as `setPinFor` (harness.ts:544) answering 404 where it expects 204, i.e. the account it just created is gone. Every failing spec passes in isolation. The cause is test isolation, not product code: spec files run in parallel against one Postgres database and several call `resetParentAccounts`/`resetTaxonomy` in `beforeEach`, so one file's reset deletes rows another file's in-flight case depends on. Needs either a per-file schema or database, or `fileParallelism: false` for the integration
status: open

### DW-110: `releasedFor` is unbounded and has no index matching its own predicate, so a child's Student Home read grows without limit as releases accumulate.
origin: spec-deferred 55ece1e24c97
location: apps/api/src/practicetest/practice-test.service.ts (releasedFor); apps/api/prisma/schema.prisma
source_spec: `spec-4-5-release-or-discard.md`
severity: low
reason: The query filters `(parentAccountId, studentProfileId, status)` and sorts `createdAt desc, id desc` with no `take`. The only relevant index on `practice_test` is `@@index([studentProfileId])`; the allowance index `@@index([parentAccountId, chargedAt])` does not serve this shape. A composite index and a cap belong with the first cross-boundary read, but both require a migration, which this story's intent excludes. Harmless at v0 volumes and a real cost once a child has a year of releases.
status: open

### DW-111: A transition's response `siblingCount` counts the drafts that remain, so it can contradict the `ordinal` beside it.
origin: spec-deferred c9557d1d7498
location: apps/api/src/practicetest/practice-test.service.ts (transitionTo)
source_spec: `spec-4-5-release-or-discard.md`
severity: low
reason: `transitionTo` recomputes `count({ generationJobId, status: 'Draft' })` after the row has left `Draft`, so releasing the only draft of a job answers `ordinal: 1, siblingCount: 0` — which `parentCopy.drafts.position` would render as "Draft 1 of 0". Unobserved only because the screen navigates away on success and never draws the returned view. This is the identical shape Story 4.4's `deleteQuestion` discard branch already ships, so fixing it is a change to the view contract both transitions and the delete share, not a local repair.
status: open

### DW-112: No parent-visible surface lists what a child can now see, so after an irreversible release the only confirmation is a transient sentence on Pending drafts.
origin: spec-deferred 6191195541d9
location: apps/web/src/app/parent/drafts/page.tsx
source_spec: `spec-4-5-release-or-discard.md`
severity: low
reason: `draftsFor` scopes `status: 'Draft'` and the parent draft read 404s a released id, by design. Nothing in Story 4.5's acceptance criteria asks for a parent-side released list and Epic 5's Story 5.1 owns only the student's, so no story currently owns it — which is why it is recorded here rather than built. A parent who reloads after `?released=1` has no way to confirm what was released.
status: open

### DW-113: The comment-stripping regexes the web page specs use to build their searchable source can eat string literals, silently weakening the word bans built on them.
origin: spec-deferred 0f3cbdc53d34
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx; apps/web/src/app/student/page.spec.tsx
source_spec: `spec-4-5-release-or-discard.md`
severity: low
reason: `.replace(/\/\/.*$/gm, '')` deletes everything after any `//` on a line, including one inside a string such as a URL, and `/\/\*[\s\S]*?\*\//g` can span string boundaries. A banned word sitting after such a sequence stops being checked, so the "ban on the code, not the prose" guarantee is weaker than it reads. Pre-existing across the drafts and student page specs rather than introduced here; this story adds callers of it.
status: open

### DW-114: No test drives an elevation bearer expiring in the exact window between the release/discard confirmation opening and the parent confirming it, so the 401/403-on-expiry path for these two new actions
origin: spec-deferred 4f3e91957baf
location: e2e/tests/parent-practice-test.spec.ts; apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (confirmTransition)
source_spec: `spec-4-5-release-or-discard.md`
severity: low
reason: `e2e/tests/parent-practice-test.spec.ts` covers a 500 and a 404 on each transition but not a 401/403. The `endsParentView`/expiry handling itself is pre-existing and shared by edit and delete, and those actions carry no such test either, so this is a gap in the established pattern rather than something this story introduced alone.
status: open

### DW-115: If the elevation token becomes null in the narrow window between opening a release/discard confirmation and clicking confirm, `confirmTransition` silently returns with the dialog left open, no error
origin: spec-deferred 9ccd7eb4177d
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (confirmTransition)
source_spec: `spec-4-5-release-or-discard.md`
severity: low
reason: `confirmTransition` guards with `if (token === null || transition === null) return;` — no `setActionError`, no `leave()`, no dialog dismissal. The window is narrow (elevation expiry mid-confirmation) and Cancel still works, so this is a rough edge rather than a lost action, and is not new to this story's pattern of guarding on `token === null`.
status: open

### DW-116: The draft review screen's timer block, like every other control on that screen, is covered by a spec that greps the page's own source text rather than rendering it, so no executing unit test drives
origin: spec-deferred 8a1bc20b108f
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx
source_spec: `spec-4-6-optional-timer-configuration.md`
severity: medium
reason: `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` asserts with `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. The new timer cases assert the presence of literals such as `setTimerOn(storedTimer !== null)` — a refactor that preserves behaviour fails them, and a behavioural inversion that keeps the literal passes. `apps/web/vitest.config.ts` sets `environment: 'node'` and no testing-library dependency exists under `apps/web`, so a real render test needs a DOM the web tier does not have. Carried from Stories 4.3, 4.4 and 4.5; this story adds more instances of it. The Playwright pass is the compensating surface and it does drive the timer end to end, including the off path, the disabled-save gate and the survive-a-delete case.
status: open

### DW-117: The api integration specs fail 1-2 non-deterministic tests per run, a different test each time, and the flake now also appears on single-file runs rather than only on a full parallel run.
origin: spec-deferred f118c50e6dbf
location: apps/api/vitest.config.ts; apps/api/test/harness.ts
source_spec: `spec-4-6-optional-timer-configuration.md`
severity: medium
reason: Observed this pass as `topic weighting > offers the other topics for the remaining questions` (404 where 202) and `release and discard > leaves a discarded test out of the read entirely` on separate runs of `vitest run test/practice-test.int-spec.ts` alone, and as `Student Mode and the device binding > binds to the named profile on the deliberate exit` on one run of `test/student-mode.int-spec.ts`. Every one passed on the next run and in isolation. Two consecutive full-file runs at baseline `b6acc34` (99 tests, this story's 13 absent) were green, so the longer file widens an existing window rather than introducing a fault: the cause is the shared-Postgres reset pattern recorded on Story 4.5, not product code. Needs a per-file schema or database, or `fileParallelism: false` for the integration specs.
status: open

### DW-118: Nothing on the pending-drafts list says whether a draft carries a time limit, so a parent holding several drafts must open each one to find out.
origin: spec-deferred bae7e1cf324d
location: apps/api/src/practicetest/practice-test.service.ts (draftsFor); apps/web/src/app/parent/drafts/page.tsx
source_spec: `spec-4-6-optional-timer-configuration.md`
severity: low
reason: `PracticeTestDraftSummary` carries id, source test, profile, ordinal, sibling count, question count and made-at, and this story deliberately did not widen it — the timer is read and written on the draft it belongs to, which is where FR-15 puts it. No story currently owns a timer marker on the list, which is why this is recorded rather than built. Harmless with a handful of drafts; a real omission once a parent holds a dozen.
status: open

### DW-119: A timer save with nothing changed is still a full write: a transaction, a log line and an announcement for a row that already read that way.
origin: spec-deferred 6e21dded6050
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (saveTimer)
source_spec: `spec-4-6-optional-timer-configuration.md`
severity: low
reason: `saveTimer` gates on `timerSavable` and `busy` but compares nothing against `storedTimer`, so clicking save on an untimed draft with the box unticked issues `PUT { minutes: null }` and announces "There is no time limit …" for a no-op. Idempotent and harmless, and the same shape the edit save already has, so it is a rough edge rather than a defect.
status: open

### DW-120: The 1-180 minute bound lives only in the DTO, so any future writer that is not that route can store a duration Epic 5 would derive a nonsensical deadline from.
origin: spec-deferred f46ef489895e
location: apps/api/prisma/schema.prisma (PracticeTest.timerMinutes)
source_spec: `spec-4-6-optional-timer-configuration.md`
severity: low
reason: The migration adds a bare `INTEGER` with no CHECK, and `student-mode.int-spec.ts` demonstrates the gap by writing `timerMinutes: 25` straight through Prisma. This story deliberately located enforcement in the DTO because `practicetest` is the sole writer (AD-17) and the one route is the only path; a database CHECK would make the invariant a property of the column instead. Worth taking with Epic 5's own migration rather than a migration of its own.
status: open

### DW-121: The timer save button and every other mutation button on this screen only gate on `busy !== null`, so a click that lands while the elevation token is null, or a second click in the same tick before
origin: spec-deferred c576b3ecd57b
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (saveTimer and sibling action buttons)
source_spec: `spec-4-6-optional-timer-configuration.md`
severity: low
reason: `saveTimer` returns early on `token === null || busy !== null`, but the button's own `disabled` prop (`disabled={busy !== null || !timerSavable}`) never checks `token`, and the same shape (`disabled={busy !== null}` with no token check) appears on every other action button in `page.tsx` (:1245, :1258, :1294, :1301, :1345, :1353, :1361) — a pre-existing pattern this story only repeats rather than introduces. A double-click before React commits `setBusy` is the same shared gap.
status: open

### DW-122: The minutes field's `aria-describedby` wiring — the one accessibility property genuinely new to this story — is asserted only by a source-text grep, and the Playwright pass that is this screen's
origin: spec-deferred eb1863be63f4
location: apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (minutes TextField); e2e/tests/parent-practice-test.spec.ts
source_spec: `spec-4-6-optional-timer-configuration.md`
severity: low
reason: `page.spec.tsx`'s "ties both explanatory sentences to the minutes field itself" test greps `PAGE_SOURCE` for the id constants and the `aria-describedby` template string; it does not render the component. `e2e/tests/parent-practice-test.spec.ts` drives the timer block end to end but its only `aria-describedby` assertion (line 171) targets an unrelated control on the generate screen. So nothing executing confirms the minutes `<input>` actually carries `aria-describedby="draft-timer-hint draft-timer-suggestion"` at runtime — a wrong `slotProps` key or a mismatched id would ship undetected. A narrower instance of the pattern already recorded above (source-grepped page spec), called out separately because the general deferred item's claim that "the Playwright pass ... does drive the timer end to end" does not hold for this specific attribute.
status: open

### DW-123: The `generatable()` fixture in the practice-test integration spec fails randomly, roughly one run in two, at a different assertion each time.
origin: spec-deferred 3d7fcd2ba24e
location: apps/api/test/practice-test.int-spec.ts:140-160
source_spec: `spec-5-2-answering-a-question.md`
severity: medium
reason: Page upload answers 404, 401 or 200-instead-of-201, or `/submit` answers 400 or 404, always inside `generatable()` and never inside the assertion the failing test is named for. Reproduced on baseline d9f21c2ea98bc4a54cb9d0ce69b4d245093e5a90 with this story's test changes stashed: 3 failures in 5 runs there, same signature. The statuses crossing (a 200 where a 201 was expected) point at responses landing on the wrong assertion rather than at any one route.
status: open

### DW-124: The product cannot produce a Fill-in-the-Blank or Short Answer Question through its own pipeline, so two of the three input controls are only ever exercised against hand-written rows.
origin: spec-deferred e43f4d7074fe
location: apps/api/src/extraction/extraction-schema.ts
source_spec: `spec-5-2-answering-a-question.md`
severity: medium
reason: The fake Extraction emits `format: 'MultipleChoice'` for every question, and generation's format histogram is asserted to match the source. Both `spreadPracticeTestFormatsFixture` in e2e and the new integration case have to rewrite stored rows directly to reach the other two formats. The rendering rule is verified; the end-to-end claim "a Question's Format decides its control" is not reachable through the real path.
status: open

### DW-125: The unbound-device redirect on Take Test is verified only by a regex over `page.tsx`'s source text, never by an executed render or request.
origin: spec-deferred f9cf7a3ff24a
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx:118-121; apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx:18-27
source_spec: `spec-5-2-answering-a-question.md`
severity: medium
reason: `page.spec.tsx` reads the file, strips comments, and asserts the literal substring `if (deviceIsUnbound(cause)) { router.replace(...)` is present. It never renders `TakeTestPage` or mocks a rejected `studentPracticeTest` call, so an inverted condition, a wrong `cause` binding, or an unreachable branch would still match the same source text and pass. `apps/web`'s vitest runs in `environment: 'node'` (`renderToStaticMarkup` only, no effects), so proving this needs either a DOM-capable render or an e2e case that revokes the binding mid-session — neither exists today.
status: open

### DW-126: The cross-test navigation reset (answers/index/map cleared when `practiceTestId` changes) is verified only by slicing `page.tsx`'s source text, never by rendering two different tests in sequence.
origin: spec-deferred fefe41a24219
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx:93-100; apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx:45-59
source_spec: `spec-5-2-answering-a-question.md`
severity: medium
reason: `page.spec.tsx` asserts the reset block's source text contains `setTest(null)`, `setAnswers({})`, etc., but never mounts the page, navigates from one practice test id to another, and checks the resulting screen. A mis-keyed condition (e.g. on `attempt` instead of `practiceTestId`) would leave a stale `index`/`answers` state and the same source-text assertions would still pass.
status: open

### DW-127: The I/O matrix's "one Question" row (Back and Next both disabled, counter reads "Question 1 of 1") is proven only by a source-text regex, never by loading a real single-question released test.
origin: spec-deferred b972b24b45e9
location: apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx:127-136
source_spec: `spec-5-2-answering-a-question.md`
severity: low
reason: `page.spec.tsx` checks `disabled={index === 0}` and `disabled={index >= questions.length - 1}` appear literally in the source; `QuestionMap.spec.tsx` covers the one-cell-map part of the row behaviorally, but no integration or e2e case ever loads an actual one-Question released test through the screen and asserts both buttons are simultaneously disabled with the counter text.
status: open

### DW-128: The I/O matrix's "read fails transiently" row (500 / 429 / dropped connection) is only exercised via a 404, never via an actual transient-failure status.
origin: spec-deferred 69463ec22097
location: e2e/tests/student-take-test.spec.ts
source_spec: `spec-5-2-answering-a-question.md`
severity: low
reason: The e2e case for this branch (`student-take-test.spec.ts`) requests a well-formed but nonexistent id, which is a permanent-absence 404, not a 500/429/dropped-connection. The code path is shared with genuine transient failures, so the claim is plausible, but nothing in the diff simulates a 5xx, a 429, or an aborted connection through this route.
status: open

### DW-129: Take Test moves no focus and announces nothing when Back, Next, or a map jump changes the active Question.
origin: spec-deferred 745a9fd48b38
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx
source_spec: `spec-5-2-answering-a-question.md`
severity: medium
reason: Neither `page.tsx` nor `QuestionMap.tsx` sets focus to the new prompt or uses a live region on navigation. A screen-reader user advancing through the test has no signal that the on-screen content changed, beyond re-reading the whole column on their own.
status: open

### DW-130: A released Practice Test with zero Questions is indistinguishable from a genuinely broken read: both render the generic retryable-error alert.
origin: spec-deferred afa42a2244ea
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx:169
source_spec: `spec-5-2-answering-a-question.md`
severity: low
reason: `questions[index]` is `undefined` when the array is empty, which falls into the same branch used for a failed fetch. Not in the story's I/O matrix and likely unreachable given the generation pipeline, but nothing guards or tests the distinction.
status: open

### DW-131: No test exercises real keyboard operation of the map cells or the radio group — only clicks, via e2e, and static markup, via component specs.
origin: spec-deferred d32ab294f2b1
location: e2e/tests/student-take-test.spec.ts
source_spec: `spec-5-2-answering-a-question.md`
severity: low
reason: The spec's Always list requires keyboard-navigable map cells (UX-DR20). Real `<button>`/`<input type="radio">` elements are keyboard-operable by construction, but no test presses Tab or Space/Enter to confirm it end to end.
status: open

### DW-132: The `ignoreRestSiblings` eslint rule change is justified in-comment by one consumer, with no lint-rule test guarding against the pattern later being used elsewhere to swallow a genuinely unused
origin: spec-deferred 423def8705fd
location: apps/web/eslint.config.mjs
source_spec: `spec-5-2-answering-a-question.md`
severity: low
reason: `apps/web/eslint.config.mjs`'s comment names `apps/parent/drafts/[practiceTestId]/page.tsx` as the reason for the rule, but the rule itself applies workspace-wide.
status: open

### DW-133: The retake file input in PageStrip still offers the `image/*` wildcard, while the page-add input now offers the explicit four-format list.
origin: spec-deferred ff4a9aa0da31
location: apps/web/src/app/parent/capture/PageStrip.tsx:130
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: `ACCEPTED_IMAGE_TYPES` exists because `image/*` lets a parent pick a GIF or TIFF the server then refuses, and because some iOS pickers report no usable type for HEIC. `apps/web/src/app/parent/capture/PageStrip.tsx` keeps the wildcard, so half the photo-choosing surface on this screen behaves the way the new module calls wrong. Pre-existing: it shipped with Story 3.2, and Story 3.1's intent constrains how the server decides a format, not what the retake picker offers.
status: open

### DW-134: The HEIF branch discards the source colour profile, so a Display P3 HEIC is reinterpreted as sRGB.
origin: spec-deferred 7a9cd049a79a
location: apps/api/src/sourcetest/page-ingest.service.ts
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: libheif returns raw RGBA with no ICC profile attached, and `sharp` treats raw input as sRGB. iPhone HEICs are commonly Display P3, so colour shifts on exactly the format the branch exists to support. The ordinary `sharp(buffer)` branch keeps its profile. Low impact for extraction, which reads text rather than colour.
status: open

### DW-135: The disabled shutter drops below the 3:1 contrast floor on the inverted ground.
origin: spec-deferred 3558360933d6
location: apps/web/src/app/parent/capture/CameraViewfinder.tsx
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: `'&:disabled': { opacity: 0.5 }` over `primaryOnInverted` on `backgroundInverted` halves a 7.70:1 pair, and no token or test covers the disabled appearance. Every other colour decision on this surface was measured; this one was not.
status: open

### DW-136: No Playwright coverage drives the camera or a multi-file library selection, so the stream lifecycle and the capture encode are verified only structurally.
origin: spec-deferred e98a99431c8e
location: e2e/tests/parent-capture.spec.ts
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: medium
reason: `apps/web` runs `environment: 'node'`, so the double-press guard, the `getUserMedia` race, the track-ended handler, and the canvas-to-JPEG encode are asserted against source text rather than driven. `e2e/tests/parent-capture.spec.ts` contains no occurrence of `camera`, `getUserMedia`, or `viewfinder`, and every `setInputFiles` call there passes exactly one file. Pinning these needs a browser launched with fake media devices and a granted camera permission.
status: open

### DW-137: The api unit specs cannot run without Postgres, because they share a vitest project with the integration tier.
origin: spec-deferred 4db8474c1cbc
location: apps/api/vitest.config.ts
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: `apps/api/vitest.config.ts` includes both `src/**/*.spec.ts` and `test/**/*.int-spec.ts`, and `test/global-setup.ts` connects to Postgres and runs `prisma migrate deploy` for either. The new pure `normalize` spec is among the fastest tests in the repo and among the slowest to start. Pre-existing and repo-wide.
status: open

### DW-138: A captured frame's canvas size is unbounded, so a high-resolution camera can post a page well past the sizes the library path implicitly stays under.
origin: spec-deferred c6b87711fa01
location: apps/web/src/app/parent/capture/AddPages.tsx
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: `CAPTURE_IDEAL_WIDTH`/`CAPTURE_IDEAL_HEIGHT` in `AddPages.tsx` are `ideal` hints, not a cap, and `capture()` sizes the canvas straight from `video.videoWidth`/`videoHeight` with no client-side check against `MAX_PAGE_BYTES` or `MAX_DECODED_PIXELS`. A device reporting a much higher native resolution would still post, and only the server's own limits would catch it.
status: open

### DW-139: `CameraViewfinder`'s shutter gate mirrors the page cap but not `editable`, so the shutter is not provably disabled if the upload stops being editable while the viewfinder is still open.
origin: spec-deferred b0cc3acd8c07
location: apps/web/src/app/parent/capture/CameraViewfinder.tsx
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: `AddPages` computes `addable = editable && !full` to gate opening the camera and the library input, but `CameraViewfinder` receives only `busy`/`pageCount`/`maxPages` and derives its own `full = pageCount >= maxPages`, with no `editable` input at all. No test drives a viewfinder that is already open at the moment `editable` turns false, so whether that transition is reachable from the surrounding screen, and what the shutter does if it is, is unverified.
status: open

### DW-140: If the attached stream never produces a frame, the shutter silently no-ops with no guidance shown.
origin: spec-deferred ee290aa3c760
location: apps/web/src/app/parent/capture/AddPages.tsx
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: `capture()` returns early when `video.videoWidth`/`videoHeight` are both `0`, which is correct — it stops a blank page from being posted — but nothing tells the parent why the shutter did nothing in that state, and no test exercises a stream that opens but never produces a frame.
status: open

### DW-141: `decodeHeic` has no timeout, so a pathological HEIC container could hang the ingest request indefinitely.
origin: spec-deferred 5ac279bba936
location: apps/api/src/sourcetest/page-ingest.service.ts
source_spec: `spec-3-1-multi-page-capture-camera-library.md`
severity: low
reason: `decodedPipeline` awaits `decodeHeic({ buffer })` directly; a crafted or corrupt container that causes libheif to loop rather than throw would hold the request open with nothing to bound it. Lower risk than an unauthenticated surface would carry, since only a signed-in parent can reach this route, but the code path is new with this story.
status: open

### DW-142: The legibility check endpoint is free, uncapped and re-runnable, so an add-page / check / delete-page loop can bill unbounded provider calls.
origin: spec-deferred a8b967099147
location: apps/api/src/sourcetest/source-test.controller.ts
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: medium
reason: `POST /parent/source-tests/:id/legibility` charges no allowance by design (AD-29) and becomes runnable again after any page add, retake or delete. There is no throttle on the route, no per-draft check counter and no `@Throttle` anywhere in the API. Allowance *enforcement* is Epic 9's, but a per-check ceiling is not the same thing as an allowance.
status: open

### DW-143: The Legibility call class is pinned to the cheap `luna` model, which ai-config itself documents as the non-vision pin, and images are sent at `detail: 'auto'`.
origin: spec-deferred 4a487b289a74
location: apps/api/src/ai/ai-config.ts
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: medium
reason: `DEFAULT_MODEL_PINS.Legibility` is `gpt-5.6-luna`, described in the same file as "the cheap, fast pin for the two classes that answer a narrow question about something already read", while `sol` is documented as "the capable vision-and-reasoning pin ... which is what reading a photographed paper test needs". Story 3.4 is the first vision use of the class. The pin predates this story (shipped with the `ai` module), so either the pin or its rationale comment is now wrong.
status: open

### DW-144: A foreground, in-request call inherits the worker-sized 180s timeout and 3 attempts, so a worst case holds the parent's HTTP request open for ~9 minutes.
origin: spec-deferred f6a315c872b9
location: apps/api/src/ai/ai-config.ts
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: medium
reason: `DEFAULT_AI_TIMEOUT_MS = 180_000` and `DEFAULT_AI_MAX_ATTEMPTS = 3` were sized for the asynchronous Extraction/Generation paths. Nothing gives the Legibility class a shorter timeout or a single attempt, and the web client sets no abort. Any sane proxy or browser timeout fires first, and the parent's retry pays for the tokens twice.
status: open

### DW-145: `allowance` now imports the whole `SourceTestModule` rather than the existing narrow `SOURCE_TEST_READER` seam, to run one count.
origin: spec-deferred 1424b7aba131
location: apps/api/src/allowance/allowance.module.ts
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: low
reason: The spec's wording ("read by `allowance` through `SourceTestService`") is what was implemented, and it is followed exactly. But `sourcetest` already publishes a narrow reader token for cross-module reads (used by `practicetest`), and importing the full module drags the controller, `PageIngestService`, `AiModule` and the parent-JWT `JwtModule` registration behind every consumer of `AllowanceModule`, including `admin`. `countSubmittedIn` arguably belongs on the reader interface.
status: open

### DW-146: The combined `pnpm test` run is flaky: loading all 43 api spec files into one process intermittently yields 404s from a partially-booted app.
origin: spec-deferred d0f06f8e2a3c
location: apps/api/vitest.config.ts
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: medium
reason: Four consecutive runs produced four disjoint failure sets, always in specs the story does not touch (extraction, parent-pin, rate-limit, practice-test, student-profile), with `POST /api/auth/sign-up` answering 404. Reproduced on the pre-change tree by stashing the whole diff: 1 failure in `practice-test.int-spec` out of 868. The same files are green split as `vitest run src` (439/439) and `test:int` (614/614). Pre-existing harness problem, not a regression from this story, but it makes the combined run unusable as a gate.
status: open

### DW-147: The capture screen's unit specs assert on component source text read with `readFileSync` rather than on rendered markup.
origin: spec-deferred 89083013d90a
location: apps/web/src/app/parent/capture/page.spec.tsx
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: low
reason: `page.spec.tsx` pins behaviour with `PAGE_SOURCE.toContain("pending === 'check'")` and `panel.indexOf('legibility-cost') < panel.indexOf('legibility-continue')`. These break on a reformat and pass on a semantically broken refactor. The file used this pattern before this story and the same file already has a working `renderToStaticMarkup` helper for `PageStrip`, so the rendered half is reachable.
status: open

### DW-148: "No log line ever carries image bytes or page content" is asserted for the cost row and the HTTP body, but never for logs.
origin: spec-deferred 9b262abff494
location: apps/api/test/source-test.int-spec.ts
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: low
reason: `source-test.int-spec.ts` pins the exact key set of the `ai_call` row and asserts the response body carries no `storagePath`, `.uploads` or base64. Nothing observes the log stream, and the test harness records the prompt without asserting on it.
status: open

### DW-149: The web copy constants `capture.submit` / `capture.submitting` now render the "Check pages" / "Checking…" control's label and pending text, while the actual commit control uses
origin: spec-deferred 2a1cc8b12ce8
location: apps/web/src/copy/parent.ts, apps/web/src/app/parent/capture/page.tsx
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: low
reason: A prior review pass in this same story already fixed the functional half of this (the commit button briefly rendered "Checking…" because it read `capture.submitting` directly) by adding `capture.legibility.committing` for the commit control, but left `capture.submit` / `capture.submitting` bound to the check button under their original, now-misleading names. A future reader editing "submit" copy is likely to touch the wrong control.
status: open

### DW-150: Two genuinely concurrent legibility-check requests for the same page set can each dispatch a provider call before either sees the other's compare-and-set write, so a real double tap can spend two
origin: spec-deferred 16ad2d9afa35
location: apps/api/src/sourcetest/source-test.service.ts
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: medium
reason: `checkLegibility` calls `this.ai.run(...)` before the transaction that performs the `pageSetStamp` compare-and-set. The loser of the race is answered the winner's stored result rather than a duplicate charge, so stored data and the parent-facing outcome stay correct, but the provider spend itself is not deduplicated. Closing this needs a claim/lock ahead of the provider call (e.g. an in-flight marker), which is a design change beyond this pass's patch scope. Sibling concern to the existing "free, uncapped, re-runnable" deferred item above, but specific to true request concurrency rather than sequential re-runs over time.
status: open

### DW-151: The new `source_test` composite index (`parentAccountId, status, submittedAt`) is created with a plain `CREATE INDEX`, not `CREATE INDEX CONCURRENTLY`, so replaying this migration against a populated
origin: spec-deferred 6d48de11fe67
location: apps/api/prisma/migrations/20260926090000_add_page_legibility/migration.sql
source_spec: `spec-3-4-legibility-check-upload-commit.md`
severity: low
reason: `apps/api/prisma/migrations/20260926090000_add_page_legibility/migration.sql` adds the index inside the same transactional migration as the rest of the schema change. `CONCURRENTLY` cannot run inside a transaction, so avoiding the lock needs a non-transactional migration step, which is an operational/deployment decision, not a one-line fix. Low impact at current table size; worth revisiting before a production table is large enough for the lock duration to matter.
status: open

### DW-152: The student list loads every Attempt row of every released test to derive state and the completed band's order.
origin: spec-deferred 1273ea7a9bb1
location: apps/api/src/practicetest/practice-test.service.ts (releasedFor)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: `releasedFor` selects `attempts: { select: { submittedAt: true } }` with no bound. Rows are allowance-bounded, but Attempts per row are not once retakes exist (Story 5.7). Both facts needed are aggregates: whether any `submittedAt` is null, and the maximum non-null one.
status: open

### DW-153: Nothing constrains how many Attempts of one Practice Test may be open at once.
origin: spec-deferred ec46038d8c4e
location: apps/api/prisma/schema.prisma (model Attempt)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: The `attempt` table permits any number of rows with `submittedAt` null for one `practiceTestId`, and `studentListState` tolerates it. If "at most one open sitting" is the intended invariant it belongs as a partial unique index, and it is cheapest to add while the table has no writer.
status: open

### DW-154: Band 1 of the student list orders by generation time because no release instant is stored.
origin: spec-deferred ed6106ccaa36
location: apps/api/src/practicetest/practice-test.service.ts (releasedFor)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: There is no `releasedAt` column, so a test generated last week and released today sorts below one generated this morning. The acceptance criterion says only "newest-first within each band" and does not name the instant, so this is defensible -- but it is a modelling limitation worth a decision if the distinction ever matters to a child.
status: open

### DW-155: Nothing constrains `submittedAt` to fall at or after `startedAt` on an Attempt row.
origin: spec-deferred da4d83849cd4
location: apps/api/prisma/migrations/20260925130000_add_attempt/migration.sql
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: The table has no CHECK constraint, so a negative-duration sitting is storable. No writer exists yet -- Story 5.2 owns it -- so this is cheapest to decide alongside that writer, together with the one-open-sitting question already deferred above.
status: open

### DW-156: The integration suite writes Attempt rows directly, and nothing tracks replacing those helpers once the real writer exists.
origin: spec-deferred a212b932d4c4
location: apps/api/test/practice-test.int-spec.ts (seedAttempt)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: `seedAttempt` calls `h.prisma.attempt.create` and says in a comment that it stands in for Story 5.2's writer. Once 5.2 lands, tests seeding rows behind the writer's back can drift from what the writer actually produces.
status: open

### DW-157: Every row in the child's list exposes the same accessible name, so the Subject and the state that tell the rows apart never reach a screen reader's link list.
origin: spec-deferred d1c633b48323
location: apps/web/src/app/student/_components/PracticeTestRow.tsx
source_spec: `spec-5-1-student-s-test-list.md`
severity: medium
reason: The row's link is Story 5.2's and its accessible name is still only the question-count sentence. This story added a Subject line above it and a state label below it as sibling text nodes, so the two facts that distinguish one row from another sit outside the link's name. An `aria-labelledby` pointing at the three nodes would fix it without adding an `aria-label` that hides the visible words, but the link belongs to 5.2's Take Test path, so the change is best made there.
status: open

### DW-158: No integration test exercises `readSubjectLabels` rethrowing a non-`NotFoundException` failure all the way through `releasedFor` to the student route's existing per-read error handling.
origin: spec-deferred 2abc38d31c20
location: apps/api/src/sourcetest/source-test.service.ts (readSubjectLabels)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: The unit-level absorb/rethrow split (`NotFoundException` -> null, anything else rethrows) is tested directly on `readSubjectLabels`, but nothing injects a non-`NotFoundException` taxonomy failure and asserts the student list route still answers with the page's existing alert-with-retry behaviour rather than an unhandled state.
status: open

### DW-159: `Attempt` carries both `startedAt` and `createdAt`, which are functionally identical while the table has no writer.
origin: spec-deferred f7ac42b84bd7
location: apps/api/prisma/schema.prisma (model Attempt)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: Both default to `now()` and this read-only story never diverges them. Whether `startedAt` is meant to ever differ from `createdAt` -- or whether one column is redundant -- is a decision Story 5.2's writer should make explicitly rather than inherit by default.
status: open

### DW-160: `studentListState` and `lastSubmission` do not guard against an invalid `submittedAt` Date.
origin: spec-deferred 06a6ae44571a
location: apps/api/src/practicetest/practice-test-policy.ts (studentListState, lastSubmission)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: Both are pure functions over `readonly AttemptSubmission[]` and `lastSubmission`'s comparison calls `.getTime()`, which would compare against `NaN` for an invalid Date. The value only ever arrives from Postgres via Prisma today, so the risk is low, but it is untested.
status: open

### DW-161: `readSubjectLabels` has no timeout around `TaxonomyService.resolveSubject`, so one slow or hung resolution blocks the whole student list read.
origin: spec-deferred f340dfe092b5
location: apps/api/src/sourcetest/source-test.service.ts (readSubjectLabels)
source_spec: `spec-5-1-student-s-test-list.md`
severity: low
reason: Each distinct Subject id is now resolved in parallel via `Promise.all`, but nothing bounds how long any single `resolveSubject` call may take before the batch (and so the list) is considered failed.
status: open

### DW-162: The API integration suite fails non-deterministically in fixture setup, in a varying handful of cases unrelated to this story, so a single green full run is not trustworthy gating.
origin: spec-deferred 814fff14a32b
location: apps/api/test/ (shared nts_test database reset helpers)
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: high
reason: Reproduced twice in this run at review time: one pass failed 6 cases across extraction.int-spec.ts and the Story 4.1/4.2 generation describes, a second pass failed 1 case in the Story 4.6 timer describe. Different cases each time, none of them this story's Attempt cases, and all of them failing in fixture setup (release / setPinFor / elevate answering 404) rather than in an assertion. The implementation session established it also reproduces with practice-test.int-spec.ts run alone (about 1 in 3) with fileParallelism already off, and that it predates this story's review fixes. The symptom is a row vanishing between creation and the next read, pointing at the shared nts_test database and the TRUNCATE ... CASCADE reset helpers rather than at cross-file interference.
status: open

### DW-163: Two pre-existing end-to-end failures in the parent password-reset flow.
origin: spec-deferred 6e694819a8d8
location: e2e/tests/parent-auth.spec.ts
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: medium
reason: e2e/tests/parent-auth.spec.ts fails two password-reset cases. Confirmed pre-existing by stashing this story's entire diff, rebuilding both apps at baseline_revision and re-running: they fail identically. This story touches no auth, identity or mail file.
status: open

### DW-164: submitAttempt does not require the Practice Test to still be Released, while startOrResumeAttempt does.
origin: spec-deferred dd853abbdbc2
location: apps/api/src/practicetest/practice-test.service.ts (submitAttempt)
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: medium
reason: startOrResumeAttempt carries status: 'Released' in its where clause; submitAttempt matches on the Attempt id plus both owner ids only. A test discarded while the child is working therefore still accepts a hand-in and writes answer rows, and the "one indistinguishable 404" story applies to start but not to submit. Nothing in this story's intent requires the check, so the asymmetry was recorded rather than closed.
status: open

### DW-165: The new Attempt start/submit write routes inherit the controller's existing @SkipThrottle, which was reasonable for its prior read-only routes but was not reconsidered now that the controller has
origin: spec-deferred 001e330c63b0
location: apps/api/src/practicetest/student-practice-test.controller.ts
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: medium
reason: apps/api/src/practicetest/student-practice-test.controller.ts carries a class-level @SkipThrottle predating this story; startAttempt and submitAttempt were added under it with nothing in this diff adding throttling to either.
status: open

### DW-166: answer.questionId has an ON DELETE CASCADE foreign key, so deleting a PracticeTestQuestion after Attempts/Answers exist against it silently drops a child's submitted answer with no tombstone.
origin: spec-deferred b3284fcc8410
location: apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql declares answer_questionId_fkey ON DELETE CASCADE. Nothing in this diff enforces or tests that a Released test's questions are immutable once Attempts exist against it.
status: open

### DW-167: isUniqueViolation treats any P2002 inside a transaction as safe to retry without checking which constraint fired, so an unrelated unique violation in the same transaction would be masked and retried
origin: spec-deferred 831ea4089bef
location: apps/api/src/practicetest/practice-test.service.ts (isUniqueViolation)
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: apps/api/src/practicetest/practice-test.service.ts:2028 (and the same helper restated in source-test.service.ts, extraction.service.ts and uncommitted-state.service.ts) checks only `cause.code === 'P2002'`, not `cause.meta?.target`. This is a pre-existing codebase-wide pattern, not something this story introduced, so fixing it here alone would diverge from the other three call sites.
status: open

### DW-168: startOrResumeAttempt retries a P2002 exactly once (two attempts total), so a third concurrent racer for the same first-open would surface as an unhandled 500 instead of resuming.
origin: spec-deferred a519eb947cfd
location: apps/api/src/practicetest/practice-test.service.ts (startOrResumeAttempt)
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: apps/api/src/practicetest/practice-test.service.ts:874-895 catches the first P2002 and retries the transaction once with no loop. The same single-retry-no-loop shape is used at the other isUniqueViolation call sites, so this is a pre-existing codebase-wide pattern rather than a defect specific to this story, and a three-way race is a narrow window.
status: open

### DW-169: The new migration drops the DEFAULT now() on attempt.startedAt, so any insert into that table outside startOrResumeAttempt must now supply it explicitly or fail on a missing NOT NULL column.
origin: spec-deferred 6d5a43ab58e3
location: apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql (ALTER TABLE "attempt" ... ALTER COLUMN "startedAt" DROP DEFAULT). No other writer of this table exists today, so the risk is latent rather than active.
status: open

### DW-170: The Hand-in dispatch fix for a null profileId (send() gated on the Attempt alone, not the profile) is verified only by a source-text regex in page.spec.tsx, never by an executed dispatch.
origin: spec-deferred a7394e790d6a
location: apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: medium
reason: page.spec.tsx's "what the screen does with a profile it never learned" describe block asserts `CODE.toContain('if (current === null) return;')` and a banned regex over stripped source; nothing renders the page, stubs a failing studentSession(), clicks Hand in, and confirms parentApi.submitAttempt is still called. Reproducing the guarded bug with the operands reversed would pass every existing test. Fixing this needs either a DOM-rendering test environment for this file (currently environment: 'node') or new network-mock e2e infrastructure this suite has no precedent for -- downgraded from patch to defer this pass because this session had no way to run either and confirm it passes.
status: open

### DW-171: e2e/tests/student-mode.spec.ts seeds a sibling's storage record with a hand-rolled key string instead of deriving it from attempt-store.ts's attemptKey(), so a change to the key-encoding scheme would
origin: spec-deferred 906cc12db97e
location: e2e/tests/student-mode.spec.ts
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: 'ntr.attempt.another-child.some-attempt' is written directly in two places in student-mode.spec.ts. Fixing this by importing attemptKey() would be e2e's first cross-package import from apps/web/src/lib -- no existing precedent -- so it is recorded here for a deliberate call rather than a blind edit.
status: open

### DW-172: The Hand-in control's visible text changes to "Handing in..." on press with no aria-live confirmation that the press itself registered.
origin: spec-deferred 651be64e6a65
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx (Hand in button)
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: The intent requires live-region behavior for the countdown's three thresholds and for the auto-submit alert; it says nothing about the button press itself. A screen-reader user gets no immediate spoken confirmation until the eventual success or failure state renders.
status: open

### DW-173: isAttemptState validates that answers' values are strings but never validates the object's keys.
origin: spec-deferred 2d33f9baee6a
location: apps/web/src/lib/attempt-store.ts (isAttemptState)
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: A same-origin, self-written record with an empty-string key or a prototype-polluting key (e.g. __proto__) would satisfy the shape check. This is the page's own storage, not untrusted input, so the practical exposure is limited, but the check is cheap to close.
status: open

### DW-174: AttemptTimer's multi-threshold-skip behavior (a device waking far past a warning threshold) is proven only at the pure-function layer, not through the page's two same-tick effects end-to-end.
origin: spec-deferred 57e2c0f29111
location: apps/web/src/app/student/_components/AttemptTimer.tsx
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: low
reason: attempt-clock.spec.ts unit-tests warningFor's multi-threshold skip; nothing exercises the page's warning-crossing effect and its remaining-=== 0 belt-and-braces effect together through a real render to confirm they resolve in the order that prevents a stale warning sentence from ever painting.
status: open

### DW-175: The Parent-View "Parent" link's clearAll call is verified by an e2e crossing that seeds only a foreign profile's storage record, never the currently bound profile's own.
origin: spec-deferred 2dbe11b64d2a
location: apps/web/src/app/student/page.tsx (Parent link) / e2e/tests/student-mode.spec.ts
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: medium
reason: student-mode.spec.ts's mode-crossing test seeds 'ntr.attempt.another-child.some-attempt' before clicking "Parent"; that record would be swept by the next screen's retainOnly call regardless of whether clearAll fired on the Parent-link click. No test seeds the bound profile's own attempt record and asserts it specifically is gone right after that click.
status: open

### DW-176: studentSession() is read once with no retry; a transient failure before the deadline is reached while offline leaves profileId unresolved for the rest of the session, which prevents both answer
origin: spec-deferred 44212b0e9948
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx (studentSession effect)
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: medium
reason: apps/web/src/app/student/tests/[practiceTestId]/page.tsx's profile effect (studentSession().then(...)) runs once on mount with no retry on a non-unbound failure. The hydration, persist, and deadline-latch effects all gate on profileId !== null, so a failed read blocks all three for the page's lifetime unless the tab is reloaded.
status: open

### DW-177: MAX_JSON_BODY_BYTES raises the JSON body-parser limit for the whole app, not scoped to the submit route it was sized for.
origin: spec-deferred 98099e9d2410
location: apps/api/src/app-setup.ts
source_spec: `spec-5-3-attempt-resilience-interruption-offline.md`
severity: medium
reason: apps/api/src/app-setup.ts applies useBodyParser('json', { limit: MAX_JSON_BODY_BYTES }) globally. Every other route's oversized-payload exposure grows by the same margin the submit route needed, rather than only the route that needed it.
status: open

### DW-178: A person's press of Hand in is not guarded on the client store having been hydrated for this Attempt, so a press inside the window before hydration dispatches the answers held in state rather than the
origin: spec-deferred 438b44f6cc5d
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx
source_spec: `spec-5-4-submitting-an-attempt.md`
severity: medium
reason: `send` and the press path gate on the Attempt and on `submitState`, never on `hydratedFor`; the deadline effect does carry that guard and says why ("resuming an Attempt whose deadline had already passed auto-submits the *empty* answer set"). The same exposure reaches a person's press. Pre-existing from Story 5.3 -- this story only made it visible, since the confirmation now names a blank count computed from the same un-hydrated state.
status: open

### DW-179: The API integration suite fails non-deterministically in PIN/elevation and upload fixture setup, in a varying handful of cases across files unrelated to this story, so a single green full run is not
origin: spec-deferred a203f34e2c9c
location: n/a
source_spec: `spec-5-4-submitting-an-attempt.md`
severity: medium
reason: Reproduced on every full run of this story's verification: one run failed 2 cases in source-test.int-spec.ts, another 1 in practice-test.int-spec.ts "draft editing", another 2 in "claiming" and "release and discard" -- each time a different case, each time inside `elevate` (401/404) or `generatable`'s upload (404), never inside this story's own cases, which were verified green by name on every run. The implementation agent reproduced the same failures with this story's work stashed at HEAD. Already recorded on Story 5.3 and still open.
status: open

### DW-180: Below the `md` breakpoint the confirmation's way back lands the child on the first Question that is not answered but no longer opens the question-map overlay for them, so the map is one further press
origin: spec-deferred d59f5e57b183
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx
source_spec: `spec-5-4-submitting-an-attempt.md`
severity: low
reason: Opening the overlay from that control was removed during review: MUI's ModalManager sets `aria-hidden` on the rest of the app and traps focus while a Modal is open regardless of CSS, so hiding the overlay above `md` with a `display` rule made the whole screen invisible to assistive technology behind a dialog nobody could see (reproduced in e2e). The map remains reachable by its own control at that width, and is permanently on screen in the rail above it, so AC1's path back is intact -- but a click-time media-query read would restore the stronger behaviour at phone width.
status: open

### DW-181: Reconfirmed this pass: a Hand-in press before `hydratedFor` matches the current Attempt can submit fewer answers than the device has stored, because `handIn`/`decideHandIn` read the same un-hydrated
origin: spec-deferred 34a79e0eb033
location: apps/web/src/app/student/tests/[practiceTestId]/page.tsx (handIn, decideHandIn)
source_spec: `spec-5-4-submitting-an-attempt.md`
severity: medium
reason: Blind Hunter, Edge Case Hunter and the Verification Gap reviewer each independently traced the same gap this pass. Verification Gap reviewer confirmed no test reloads mid-flight and presses Hand in inside the pre-hydration window, so neither `page.spec.tsx`'s source-region assertions nor the new e2e specs would catch a regression here. Same root cause as the existing hydration entry above; recorded separately since this pass's review produced a concrete demonstration and consumer trace, not because the underlying issue is new.
status: open

### DW-182: The "value counts as blank" rule is defined independently in three places -- the web `isAnswered` helper, the API's inline `value.trim().length === 0` check, and the e2e/int-spec fixtures -- with no
origin: spec-deferred e6e1978f9a7c
location: apps/web/src/lib/answers.ts; apps/api/src/practicetest/practice-test.service.ts
source_spec: `spec-5-4-submitting-an-attempt.md`
severity: low
reason: Raised by the Blind Hunter reviewer. Each site is individually tested for the plain-space case; nothing in this diff exercises the sites together for non-space whitespace, so a future edit to only one of them could silently desync client-reported and server-persisted blank counts.
status: open

### DW-183: The API integration suite fails non-deterministically in a varying handful of cases across describes unrelated to this story, so a single green full run is not trustworthy gating.
origin: spec-deferred e66c2c6a8512
location: n/a
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: medium
reason: Reproduced on every run of this story's verification: one full-suite run failed 5 cases in `parent-auth`/`parent-pin`, another 3 in `parent-pin`/ `uncommitted-state`, and single-file runs of `practice-test.int-spec.ts` failed 2 cases in "claiming" and "release and discard", then 1 in "the request" -- a different set each time, always in fixture setup (`elevate`, `generatable`'s upload, subject classification), never in a grading case. Every failing case passes when its file is run alone. The implementation agent reproduced the same failures with this story's work stashed at HEAD. Already recorded on Stories 5.3 and 5.4 and still open.
status: open

### DW-184: `AttemptClosure.blankQuestionIds` is now computed by `closeAttempt` and consumed by nobody, and its doc still calls it the reason the hand-in transaction exists.
origin: spec-deferred 0e87265a76f2
location: apps/api/src/practicetest/practice-test.service.ts:361
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: low
reason: Story 5.4 read it to write `Unanswered`; Story 5.5 derives every blank from `gradingInputFor`'s answer rows instead, because the same function must serve the retry pass where no closure exists. Grep finds the field written at `practice-test.service.ts:1101`, declared at `:361`, and read only by an int-spec assertion that the response body does *not* carry the key. Harmless but dead, and the surrounding prose is now wrong about why it is there.
status: open

### DW-185: Nothing caps how often an Attempt's `Ungraded` Questions may be re-asked, so a results view that keeps failing spends a fresh Grading call on every refresh.
origin: spec-deferred a36551d8179d
location: apps/api/src/grading/grading.service.ts:214
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: medium
reason: FR-22 makes viewing the trigger and grading is deliberately exempt from every allowance, so `resolveUngraded` re-asks on each call with no attempt counter, cooldown column or minimum interval. A provider outage plus a child refreshing is unbounded spend. A cap is a product decision -- it would make some views not retry, which is the opposite of what FR-22 asks for -- so it is recorded rather than invented here.
status: open

### DW-186: A Question whose stored correct answer is empty or unreadable stays permanently `Ungraded` with nothing distinguishing it from a transient grading failure.
origin: spec-deferred 652abbd93491
location: apps/api/src/grading/grading.service.ts
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: medium
reason: `askable` gates a Question on having a correct answer to grade against; one that can never produce a plain-text correct answer is retried by every `resolveUngraded` call exactly like a transient provider fault, and nothing marks or logs the difference between "will resolve on retry" and "can never resolve." A product decision on how to surface or cap this is not made here.
status: open

### DW-187: The batched Grading call has no upper bound on how many free-text Questions it sends in one prompt.
origin: spec-deferred 7b1f98acb945
location: apps/api/src/grading/grading-prompt.ts
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: medium
reason: `buildGradingPrompt` batches every asked Question with no chunking or size ceiling; a Practice Test with many Fill-in-the-Blank/Short Answer Questions could produce a prompt near or past the provider's context/token limits, and neither the spec nor the tests address that case.
status: open

### DW-188: No test exercises `resolveUngraded` against a truly legacy Attempt with zero grade rows at all, as opposed to one already carrying an `Ungraded` row.
origin: spec-deferred 21d978393b3c
location: apps/api/test/practice-test.int-spec.ts
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: low
reason: Existing cases delete a submitted Attempt's grade rows to simulate the row-less branch, but none represents an Attempt submitted before this story shipped, which never had grading run against it at all.
status: open

### DW-189: `writeGuarded`'s race-handling is covered by sequential simulation only; no test drives two truly concurrent writers to confirm the loser writes nothing.
origin: spec-deferred 10c227352f55
location: apps/api/src/grading/grading.service.ts
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: low
reason: The fix recorded in the 2026-09-27 triage log changed the read-then-write to `createMany(skipDuplicates)` plus a guarded `updateMany`, but every case exercising it runs sequentially rather than racing two calls against the same rows.
status: open

### DW-190: No test covers grading or re-grading after the answer key drifts -- a Question removed or a choice's `isCorrect` flag changed between when an Attempt was answered and when it is graded.
origin: spec-deferred 21c33018efbb
location: apps/api/src/practicetest/practice-test.service.ts
source_spec: `spec-5-5-grading-engine-four-grade-states.md`
severity: low
reason: `gradingInputFor` and `resolveUngraded` both re-read the current Practice Test state at grading time, so a changed answer key silently changes the verdict of an already-answered Question; this drift scenario is absent from the I/O matrix and the tests.
status: open

### DW-191: Opening one results screen does the same expensive work twice: two full question/choice/answer joins and three grade reads per view.
origin: spec-deferred cf73dedc0d2b
location: apps/api/src/grading/grading.service.ts
source_spec: `spec-5-6-results-answer-key.md`
severity: medium
reason: `resultsFor` calls `resolveUngraded`, which already runs `gradingInputFor`, a `questionGrade.findMany` and `scoreFor` (a second grade read) inside its transaction -- then runs `answerKeyFor` (the same join in a different shape) and a third grade read, and discards `resolution.score`. The two reads are deliberate: one serves the provider and one serves the screen, and the score is recomputed so it describes exactly the rows in the same response. Collapsing them means either widening `resolveUngraded`'s return to carry the states it already read, or an internal variant that skips `scoreFor` -- both touch a method three other paths call, so it is recorded rather than done here.
status: open

### DW-192: Story 5.5's unbounded ungraded re-ask is now reachable from a child's screen: every results open with an outstanding Question spends a fresh Grading call.
origin: spec-deferred ee03670630ed
location: apps/api/src/grading/grading.service.ts:231
source_spec: `spec-5-6-results-answer-key.md`
severity: medium
reason: Already recorded on Story 5.5 as a product decision (FR-22 makes viewing the trigger and grading is exempt from every allowance, so a cap would make some views not retry). This story is what turns it from a service method with no caller into a `GET` a child reaches by reloading, and a React StrictMode double-mount or a second tab doubles it again. No attempt counter, cooldown column or minimum interval exists, and the controller carries only the class-level `@SkipThrottle({ login: true })`.
status: open

### DW-193: `answerKeyFor`'s call to `readSubjectLabels` has no error handling of its own, unlike every other degrade-don't-throw branch in the same read.
origin: spec-deferred 4df26108aeda
location: apps/api/src/practicetest/practice-test.service.ts (answerKeyFor)
source_spec: `spec-5-6-results-answer-key.md`
severity: medium
reason: A transient failure in the Subject-label lookup (the module down, a timeout) throws out of `answerKeyFor` and 500s the whole results read, even though the Attempt is already graded and every other unreadable field in this method (`prompt`, `studentAnswer`, `correctAnswer`) degrades to `null` instead. The call is the same shape `releasedFor` already uses without a guard, so this is an existing pattern this story reused rather than one it introduced -- fixing it means deciding a shared fallback for both callers, not a one-line patch here.
status: open

### DW-194: `AnswerKeyRowView`'s type still allows `newlyGraded: true` together with `state: 'Ungraded'`, a combination the service is documented to never produce.
origin: spec-deferred 8212997251d7
location: apps/api/src/grading/grading-results.ts (AnswerKeyRowView)
source_spec: `spec-5-6-results-answer-key.md`
severity: low
reason: `AnswerKeyRow.tsx` guards against the pairing defensively (`row.newlyGraded && row.state !== 'Ungraded'`) rather than the type ruling it out. A future consumer of `AttemptResultsView` (the parent-facing read the service already leaves room for) has to remember to repeat the same guard. Closing it means a discriminated union keyed on `state`, which is a shape change beyond a trivial patch.
status: open

### DW-195: No integration case exercises `subjectName` genuinely failing to resolve (a deleted or reclassified Subject) on the results endpoint specifically.
origin: spec-deferred 7ba522faa018
location: apps/api/test/practice-test.int-spec.ts (Story 5.6 results block)
source_spec: `spec-5-6-results-answer-key.md`
severity: low
reason: The existing results cases only assert the happy-path label match via `subjectNameOf`. The "keeps its place and loses its label" degradation that `readSubjectLabels` documents is proven for Student Home's equivalent read elsewhere in the suite, but not for this endpoint.
status: open

### DW-196: No test covers two Questions simultaneously left `Ungraded`, where only some of them resolve on a given results read.
origin: spec-deferred 737ecda8801c
location: apps/api/test/practice-test.int-spec.ts (Story 5.6 results block)
source_spec: `spec-5-6-results-answer-key.md`
severity: low
reason: Every existing re-ask/resolution case uses exactly one ungraded Question, so the per-row correctness of a genuinely mixed outcome (some rows newly graded, others still stuck) within the same response is unverified.
status: open

### DW-197: The retake route has no ceiling on runs and no per-child rate limit, so Attempt rows and the grading spend each handed-in run costs are both unbounded.
origin: spec-deferred 16b9d07e184e
location: apps/api/src/practicetest/student-practice-test.controller.ts
source_spec: `spec-5-7-retaking-a-practice-test.md`
severity: medium
reason: `POST /api/student/practice-tests/:id/retake` inserts at `latest.ordinal + 1` with no maximum ordinal, and `StudentPracticeTestController` declares no throttle stance for it. Every retake that is handed in costs a provider call at grading time, so a child pressing the control repeatedly is unbounded spend. Neither the intent contract nor the epic asks for a cap, which is why this is recorded rather than added here.
status: open

### DW-198: The explanation table indexes only (attemptId, questionId, studentProfileId) and (parentAccountId, chargedAt), so deleting a Student Profile or a Practice Test Question scans it sequentially.
origin: spec-deferred 241152136017
location: apps/api/prisma/schema.prisma (model Explanation)
source_spec: `spec-6-1-on-demand-explanations.md`
severity: low
reason: Both foreign keys cascade. Only attemptId is covered, by the unique key's prefix. Profile deletion is a routine parent action.
status: open

### DW-199: Cascading a deleted Attempt or Profile removes charged Explanation rows, which silently returns spent allowance for the period.
origin: spec-deferred 5b5a191022a8
location: apps/api/prisma/migrations/20260928120000_add_explanation/migration.sql
source_spec: `spec-6-1-on-demand-explanations.md`
severity: medium
reason: Usage is derived by counting rows with chargedAt in the window, so deleting a row is indistinguishable from never having charged it.
status: open

### DW-200: Multiple-choice distractors are read and then discarded, so the explainer never sees the option the child actually chose among the alternatives.
origin: spec-deferred 91649b1304df
location: apps/api/src/practicetest/practice-test.service.ts (explanationInputFor)
source_spec: `spec-6-1-on-demand-explanations.md`
severity: medium
reason: explanationInputFor selects choices { ordinal, body, isCorrect } and flattens a single answer string out of them; format is still passed to the prompt as MultipleChoice.
status: open

### DW-201: Every cached re-read still performs the full cross-module ownership read plus a Grade Level label resolution that is then discarded.
origin: spec-deferred 3008c1f1df59
location: apps/api/src/explanation/explanation.service.ts
source_spec: `spec-6-1-on-demand-explanations.md`
severity: low
reason: explanationFor calls explanationInputFor before the cache lookup. Ownership-first is required for the single 404 sentence, but the taxonomy resolution is not.
status: open

### DW-202: Unlimited tiers run both allowance counts even though remainingFor can never reach zero for them.
origin: spec-deferred 07e8aefb3625
location: apps/api/src/explanation/explanation.service.ts
source_spec: `spec-6-1-on-demand-explanations.md`
severity: low
reason: limit === null makes remainingFor return the per-request ceiling; the pre-check and the in-transaction count are both still issued.
status: open

### DW-203: No dedicated regression test exercises a period-window rollover during a generation call, so a reintroduction of the "stale window" bug this pass's own triage log already fixed once would ship
origin: spec-deferred 6b3ef2dab275
location: apps/api/src/explanation/explanation.service.ts; apps/api/test/explanation.int-spec.ts
source_spec: `spec-6-1-on-demand-explanations.md`
severity: medium
reason: explanationFor re-reads consumptionFor after the AI call to derive windowStart/windowEnd instead of reusing the pre-call read, but every existing integration case that varies the count between check and write keeps the same period window; none advances or fakes the account's period boundary between the two reads.
status: open

### DW-204: The failure paths of both new parent screens are covered only by an e2e spec that could not be executed in this environment.
origin: spec-deferred 2f2bab10a60a
location: e2e/tests/parent-explanation-review.spec.ts
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: medium
reason: apps/web runs vitest with environment: 'node' and no DOM library, so a failed flag press, a failed Explanations read and an empty runs list can only be exercised at the browser. Ports 3000/3001 were held by an unrelated dev server for the whole run, so Playwright could not start its own servers.
status: open

### DW-205: The stateful parent screens are verified by asserting their own source text rather than by rendering them.
origin: spec-deferred c1ac4a56f4f4
location: apps/web/src/app/parent/_components/ExplanationReview.spec.tsx
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: medium
reason: ExplanationReview.spec.tsx and both attempts page specs readFileSync their subject and match substrings, so a refactor that preserves the strings while changing the behaviour passes. This is the house pattern the DOM-less unit environment forces, not a defect introduced here, but it caps what the unit tier can prove.
status: open

### DW-206: A parent opening a run whose Questions are still ungraded triggers grading re-asks, with no bound and no test.
origin: spec-deferred 9e0f0422a09d
location: apps/api/src/grading/parent-attempt.controller.ts
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: medium
reason: resultsFor calls resolveUngraded first (FR-22 makes viewing the trigger), and the parent route reuses it unchanged. The integration fixtures pre-grade every Question, so the billing path a parent read can take is never exercised, and the parent's screen states nothing about it.
status: open

### DW-207: test/practice-test.int-spec.ts fails nondeterministically on this machine, a different single case each whole-file run.
origin: spec-deferred e3095184265c
location: apps/api/test/practice-test.int-spec.ts
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: medium
reason: Four successive runs failed on four different cases (subject classification, a foreign draft read, the generation budget, a malformed-id 400), and each failing case passes in isolation. Pre-existing: story 6.1's own result recorded the same file flaking.
status: open

### DW-208: The parent run list is unbounded, with no page or cursor.
origin: spec-deferred 3f58a2290ace
location: apps/api/src/practicetest/practice-test.service.ts (parentSubmittedRunsFor)
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: low
reason: parentSubmittedRunsFor selects every handed-in Attempt of a profile and batches Subject labels for all of them in one cross-module call, so both grow with a child's whole history.
status: open

### DW-209: The null arm of the run list's Subject label is never produced by a test.
origin: spec-deferred b9ebfb47f737
location: apps/api/test/parent-explanation-review.int-spec.ts
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: low
reason: The service degrades an unresolvable Subject to null and the screen renders unknownSubject for it, but every integration fixture has a resolvable Subject and the spec asserts typeof subjectName === 'string' for every row.
status: open

### DW-210: A leftover review artifact is tracked at the repository root.
origin: spec-deferred 8053ba9a5eac
location: _tmp_review_diff.patch
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: low
reason: _tmp_review_diff.patch was committed by an earlier story and is unrelated to any source or build path.
status: open

### DW-211: The concurrent-double-press recovery in the parent flag write is untested.
origin: spec-deferred a82bcecacc38
location: apps/api/src/explanation/explanation.service.ts (flagExplanation)
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: medium
reason: flagExplanation recovers from a P2002 unique-violation race on [explanationId, origin] by re-reading the winning row, but every integration case presses the flag sequentially (first, second, third), which resolves the plain upsert's update arm and never forces two concurrent creates to collide. The same, pre-existing recovery in explanationFor is equally untested for the same reason. If the catch arm silently broke, nothing in the suite would notice.
status: open

### DW-212: Parent-facing question-format labels duplicate the student ones instead of sharing a table.
origin: spec-deferred 9b07ea640432
location: apps/web/src/copy/parent.ts (attempts.format)
source_spec: `spec-6-2-parent-review-of-explanations.md`
severity: low
reason: parentCopy.attempts.format re-declares the same three labels (MultipleChoice, FillInTheBlank, ShortAnswer) already in studentCopy.takeTest.format. commonCopy.gradeState was deliberately factored out specifically so a parent and a student surface cannot disagree on that one; this format table is the same category of duplication left unfactored, so a fourth question format added later requires remembering to update both copy tables.
status: open

### DW-213: The Admin Flagged Explanations queue read and the parent's per-child flag list are both unbounded.
origin: spec-deferred e5b7665ce51f
location: apps/api/src/explanation/explanation.service.ts
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: medium
reason: `flaggedForAdmin` selects every qualifying flag row across every account with the full Explanation body and folds them in memory; `studentFlagsFor` reads every flag row for a child and feeds all of them into `flaggedQuestionContextsFor`, which builds `id: { in: [...] }` lists with no ceiling. Neither has take/skip/cursor, and the queue only grows because nothing marks an entry judged. At v0 volumes this is correct and cheap; it degrades monotonically.
status: open

### DW-214: No index supports the per-child flag list's actual predicate.
origin: spec-deferred 5e8d0071edb8
location: apps/api/prisma/schema.prisma
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: low
reason: `studentFlagsFor` filters on parentAccountId + studentProfileId + origin and orders by createdAt desc, id desc. The table carries `[parentAccountId, createdAt]` and the new `[origin, disposition, createdAt]`; studentProfileId and origin are residual filters either way. An index on (parentAccountId, studentProfileId, origin, createdAt) is the one this read wants.
status: open

### DW-215: A disposition is permanent and records no actor beyond the account.
origin: spec-deferred 6bb1970908c5
location: apps/api/prisma/schema.prisma
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: low
reason: `disposition`/`dispositionAt` carry no parent identity, and Parent View elevation is PIN-gated rather than identity-bound, so "who dismissed this" is unanswerable for a contested case. The intent does not ask for attribution and the epic scopes the account as the entitlement, so this is a note rather than a defect.
status: open

### DW-216: The story's e2e spec was written and typechecks but has never been executed.
origin: spec-deferred 7510f85c5fd7
location: e2e/tests/student-explanation-flagging.spec.ts
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: medium
reason: Ports 3000 and 3001 were held for the whole run by an unrelated project's dev servers, and apps/web's `start` script pins port 3000, so Playwright could not bring the suite up. `pnpm e2e -- student-explanation-flagging` needs one run in a clean environment. Same condition Story 6.2 recorded.
status: open

### DW-217: The whole cross-surface flow is one e2e test with a 360s timeout covering eight independent claims.
origin: spec-deferred 60c35419df7a
location: e2e/tests/student-explanation-flagging.spec.ts
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: low
reason: Sign-up through upload, generation, release, sitting, reporting, the parent's two decisions, the child's re-read and the operator queue all chain inside a single test(). Any failure reports as one red test with no isolation, and the expensive setup re-runs on retry.
status: open

### DW-218: Several API integration specs fail nondeterministically under parallel load, on baseline as well as here.
origin: spec-deferred 315ba56fc32e
location: apps/api/test/practice-test.int-spec.ts
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: medium
reason: practice-test, source-test, uncommitted-state and admin-auth-dummy-hash each fail a different 1-3 cases per run when the suite runs in parallel and pass when run alone. Reproduced with this story's changes stashed and the Prisma client regenerated from the baseline schema, so it is contention over shared database state and PIN rate limits, not this change.
status: open

### DW-219: Date-formatting-with-"Invalid Date"-fallback logic is reimplemented independently three times instead of shared.
origin: spec-deferred 4afad1f1ceea
location: apps/web/src/app/admin/flagged-explanations/page.tsx
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: low
reason: `raisedSentence` in the admin flagged-explanations page, `flaggedSentence` in `ExplainPanel.tsx`, and the `readableInstant`-based helpers in `ExplanationReview.tsx` / the parent explanation-flags page each guard the same "Invalid Date" case with their own local function. A future change to that guard has to be made three times and can drift.
status: open

### DW-220: `ExplanationFlag.disposition` and `dispositionAt` are only kept paired by application discipline, not a database constraint.
origin: spec-deferred ea3102ce24e7
location: apps/api/prisma/migrations/20260928200000_add_explanation_flag_disposition/migration.sql
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: low
reason: Every write path in this story sets both columns together, but nothing in the migration enforces `(disposition IS NULL) = (dispositionAt IS NULL)`. A future write path that sets one without the other would produce a row the mapper has never seen and has undefined behavior for.
status: open

### DW-221: The 409-conflict reconcile branch in the parent's decide() flow is never exercised by an executing test, only by source-string assertions.
origin: spec-deferred 0e026d11ef6d
location: apps/web/src/app/parent/_components/ExplanationReview.spec.tsx
source_spec: `spec-6-3-student-explanation-flagging.md`
severity: low
reason: `ExplanationReview.spec.tsx` reads the component's source with `readFileSync` and asserts on substrings (e.g. that `parentApi.attemptExplanations(token, attemptId)` appears, that the reconcile does not call `announce(`). No test renders the component, forces a 409 from a mocked `disposeExplanationFlag`, and asserts the region actually redraws as decided with the correct entry. This matches the codebase's existing source-assertion convention for stateful components, so closing it means adding real interactive rendering for this one component, not a one-line fix.
status: open

### DW-222: Suppression is keyed to one Attempt, so a retake serves the child a fresh Explanation the parent's decision does not follow.
origin: spec-deferred 70dbbd098c98
location: apps/api/prisma/schema.prisma
source_spec: `spec-6-4-explanation-suppression-free-regeneration.md`
severity: low
reason: `Explanation` is keyed `(attemptId, questionId, studentProfileId, generation)`, which Story 6.1 chose. A Story 5.7 retake opens a new Attempt, so the same Question yields a live generation 1 there and the suppression does not carry over. FR-39 says suppression is scoped to a Student Profile without naming the Attempt boundary, so both readings are defensible and neither the intent nor the epic decides it. No test covers suppress-then-retake either way.
status: open

### DW-223: The API integration suite is intermittently red when several files run together, and hangs outright on a large batch.
origin: spec-deferred eacf1665da2b
location: apps/api/test/harness.ts
source_spec: `spec-6-4-explanation-suppression-free-regeneration.md`
severity: medium
reason: Running many int-specs in one vitest invocation fails a different, unrelated test roughly one run in several, each of which passes in isolation. Reproduced on the baseline commit 54527d9 with the whole change stashed, so it predates this story. A twelve-file batch that completed in 73s once later exceeded a ten-minute cap without finishing. `practice-test.int-spec.ts` (196 tests) cannot complete inside that cap at all, which is why the root `pnpm test` cannot be run as one command. `--no-file-parallelism` is not the workaround: it leaks `AI_FAKE_FAILURE` across files and fails eight provider-fault cases.
status: open

### DW-224: Suppressing a paid Explanation does not credit back the Explanation Allowance unit it was charged, so a parent who paid for a bad explanation and removed it gets no refund; the free replacement is
origin: spec-deferred 6de3e49bc3c6
location: apps/api/src/explanation/explanation.service.ts (suppressExplanation)
source_spec: `spec-6-4-explanation-suppression-free-regeneration.md`
severity: medium
reason: `suppressExplanation` only sets `suppressedAt`; it never reads or writes `chargedAt`, so a suppressed row that was charged stays charged and the allowance counter (which reads `chargedAt: { gte, lt }`) never moves. The intent-contract is silent on whether a refund is owed, and both readings — no refund because suppression and regeneration change "one Explanation and nothing else," or a refund because the parent is being made whole for a bad paid explanation — are defensible. No test exercises a suppression of a charged row's counter effect either way.
status: open
