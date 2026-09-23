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
