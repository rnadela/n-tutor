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
