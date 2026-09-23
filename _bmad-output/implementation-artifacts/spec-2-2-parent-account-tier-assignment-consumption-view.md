---
title: 'Story 2.2 — Parent Account Tier Assignment & Consumption View'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_revision: '8f5cebe58f9a1135a073774537df6fbe6c80f93b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-n-test-reviewer/tiers.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md'
warnings: [oversized]
deferred:
  - summary: >-
      The admin Parent Accounts list is unbounded: it selects every account and
      every account's entire timezone history with no pagination.
    evidence: |-
      `ParentAccountService.list()` runs `findMany` with no `take`/`skip`, and
      resolves each row's effective zone from the full history. The payload and
      its query cost grow as O(accounts x history entries) with no ceiling. No
      account base exists yet, so nothing is slow today.
    location: >-
      apps/api/src/identity/parent-account.service.ts
    severity: medium
  - summary: >-
      The allowance counting seam is a module-private constant, so Epics 3-6
      cannot register a counter without editing `allowance.service.ts` and
      importing the producer modules.
    evidence: |-
      `ARTIFACT_COUNTERS` is a frozen object of three `async () => 0` literals
      inside the service. Wiring real counts would invert the dependency
      direction AD-17 protects; a provider token or registration interface
      would make the documented seam real. Nothing asserts the counters are
      invoked with the resolved window either.
    location: >-
      apps/api/src/allowance/allowance.service.ts
    severity: medium
  - summary: >-
      `ParentAccountAdminService.detail` re-reads the account and the timezone
      history that `AllowanceService.consumptionFor` reads again internally.
    evidence: |-
      Four queries where two suffice, and `detail.account.timezone` (the zone
      in effect now) is a different value from `detail.consumption.timezone`
      (the zone at period start) with no copy distinguishing them. The web page
      currently reads only `consumption`, so the extra read is unobserved.
    location: >-
      apps/api/src/admin/parent-account-admin.service.ts
    severity: low
  - summary: >-
      A month whose local midnight does not exist (a DST switch at 00:00, such
      as `America/Santiago`) is untested.
    evidence: |-
      `instantOfLocal`'s two-probe fixup resolves such a boundary to the first
      instant that does exist, and both adjacent windows are computed the same
      way so they stay contiguous. The behaviour looks correct but no test pins
      it, and no test asserts `previousWindow.end === thisWindow.start`.
    location: >-
      apps/api/src/allowance/period.ts
    severity: low
  - summary: >-
      `resolveWindow`'s bounded fixpoint loop can exhaust its 3 passes on a
      pathological zone-change history without the returned window's zone
      actually agreeing with the zone in effect at the window's start.
    evidence: |-
      The loop returns the last candidate window when `MAX_RESOLUTION_PASSES`
      is exhausted, with no log/telemetry marking the degraded case and no
      test pinning which candidate is returned when convergence fails.
    location: >-
      apps/api/src/allowance/period.ts
    severity: low
  - summary: >-
      `ParentAccountAdminService.assignTier` reads the account's effective
      timezone after its transaction commits, not inside it, so a concurrent
      timezone write landing in that gap could echo a stale zone in the
      response.
    evidence: |-
      No route in this story ever calls `ParentAccountService.appendTimezone`
      (it is reachable only from tests and a future epic), so the race is
      currently unreachable, but nothing guards against it once a timezone-
      write route ships.
    location: >-
      apps/api/src/admin/parent-account-admin.service.ts
    severity: low
  - summary: >-
      `onAssignTier`'s success-path resync failure (after a successful tier
      write, `reload()`/`loadConsumption()` throwing) is deliberately
      swallowed without surfacing any error, but no test pins that intended
      behavior or checks the operator gets any signal the list may be stale.
    evidence: |-
      The only PATCH-failure e2e test mocks the tier write itself failing; no
      test mocks a successful write followed by a failing resync.
    location: >-
      apps/web/src/app/admin/accounts/page.tsx
    severity: low
  - summary: >-
      The stale-consumption-response guard (`expectedConsumptionId`) that
      prevents a slow response from rendering under a different expanded row
      has no dedicated test exercising the race it guards against.
    evidence: |-
      No e2e test expands one account, switches to another before the first
      fetch resolves, and asserts the panel never shows the first account's
      data — a regression here would ship undetected.
    location: >-
      apps/web/src/app/admin/accounts/page.tsx
    severity: low
  - summary: >-
      `taxonomy.int-spec.ts`'s "exposes the same behaviour over the REST
      surface" test failed once (selectable-subjects returned `[]` instead of
      length 1) in a full-suite run, then passed on four immediate reruns of
      the full suite and in isolation.
    evidence: |-
      This spec file is unmodified by this story's diff; the failure did not
      reproduce across `pnpm exec vitest run` x4 nor when run paired with
      `parent-account.int-spec.ts` alone, so it looks like a pre-existing,
      low-frequency flake rather than something this story's changes caused.
    location: >-
      apps/api/test/taxonomy.int-spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Every allowance, limit, and generation path downstream keys off a Parent Account's Account Tier, but no `ParentAccount` entity, no tier, no timezone history, and no allowance period computation exist — so an operator can neither see the account base nor assign a tier, and Epics 3–9 have no tier input to read.

**Approach:** Add the `identity` module owning `ParentAccount` and its effective-dated timezone history, add the `allowance` policy module owning no entity (the single authoritative tiers table, the period-window computation, and the three usage counts), then extend the Admin console with a Parent Accounts screen that lists accounts, assigns a tier through `identity`'s service, and renders all three allowances as usage against limit in the account's own period and timezone.

## Boundaries & Constraints

**Always:**
- `identity` is a new NestJS module and the **sole writer** of `ParentAccount` and `AccountTimezone` (AD-17). `admin` changes a tier by calling `identity`'s service method, never through a Prisma delegate of its own; that method takes the caller's `TransactionClient` as its first parameter, exactly as `AdminAuditService.record` does.
- Every tier change emits one `AdminAudit` row (`parentAccount.tierChange`, carrying `from`/`to` tier and the account id) **in the same transaction** as the write. Audit detail never carries child content (AD-20, AD-25).
- `allowance` **owns no entity** (AD-14/AD-17): it holds the tiers table, the period-window computation, and the usage counts, and is the only place either is implemented. Admin and (later) parent surfaces call the same method, so their numbers can never disagree.
- The tiers table (`tiers.md`: Free 1/2/2/10, Plus 2/8/20/unlimited, Family 5/20/60/unlimited, Internal all unlimited) is transcribed **once**, in `allowance`. No controller, copy string, component, migration default, or test restates a figure; the web reads every limit off the API response. `unlimited` is `null`, never a sentinel number.
- Account timezone is an **effective-dated history**, never a mutable column (AD-27). A period's window is computed from the zone in effect **at that period's start**; a zone change applies from the next boundary onward and never re-slices a running period.
- The three counters are independent and reset together atomically at the calendar-month boundary in the account's own zone. Usage is **derived by counting artifacts in the window**, never a stored counter column and never a reset job (AD-14).
- `ParentAccount.tier` defaults to `Free`. `Internal` is reachable only by Admin assignment — there is no self-serve path of any kind in v0.
- A tier change takes effect **immediately against the current period's counters**: the window is unchanged, only the limits it is measured against change.
- Admin UI constraints from story 2.1 continue unchanged: no hardcoded user-facing literal in a component (all copy via `apps/web/src/copy/admin.ts`), elevation 0 with `1px solid divider`, `density.compact`, ≥44px tap targets, 2px focus outline at 2px offset, sans family, `table-cell` type role, and **tabular figures** on every consumption number so columns align.
- Stack versions stay exactly as pinned; no new runtime dependency is added — period arithmetic uses the platform `Intl` time-zone data.

**Block If:**
- Satisfying an acceptance criterion would require the `sourcetest`, `practicetest`, or `explanation` entities, the `ai` module, or a hosted environment / deploy credential to be provisioned.

**Never:**
- Do not implement enforcement: no blocking at cap, no cap check on any write path, no at-cap messaging. Epic 9 owns that; this story is view-and-assign only.
- Do not build parent-facing surfaces: no sign-up, sign-in, PIN, elevation token, Settings, or parent Allowances screen (Epic 1 and later).
- Do not add `StudentProfile`, `UsageTombstone`, Source Test, Practice Test, or Explanation entities, and do not show a Student Profile count — only the tier's profile **limit**, read from the tiers table.
- Do not add admin roles, invitations, parent-account creation from the Admin console, or account deletion.
- Do not store a computed usage number, a period column, a reset-date column, or a denormalised tier limit anywhere in the schema.
- Do not modify `Subject`, `GradeLevel`, `SubjectGradeLevel`, or the taxonomy screen's behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List Parent Accounts | Operator signed in; several accounts exist | 200 with each account's id, email, current tier, effective timezone, created-at — ordered by email | No error expected |
| List with no accounts | Empty `parent_account` table | 200 with an empty list; screen states it plainly | No error expected |
| New account default tier | Account created with no tier given | `tier` is `Free` | No error expected |
| View one account's consumption | Account on Free, no artifacts yet | 200 with three allowances, each `used: 0` and limits `2 / 2 / 10`, plus `periodStart`, `periodEnd`, `resetAt`, and the zone those were computed in | No error expected |
| Unlimited allowance | Account on Plus or Family | Explanation limit is `null` (unlimited) and Student Profile limit is the tier's number; the screen renders "unlimited", not a number | No error expected |
| Assign a new tier | Existing account id + `Internal` | 200 with the updated account; exactly one `AdminAudit` row `parentAccount.tierChange` with `from`/`to`; the next consumption read shows the new limits against the **same** period window | No error expected |
| Assign the same tier again | Account already on `Plus`, assign `Plus` | 200, still one audit row for this call (the action is recorded even when the value is unchanged) | No error expected |
| Assign an unrecognised tier | `"Premium"` | 400 before any write; nothing persists | Validation rejects the value against the tier enum |
| Assign a tier to an unknown account | Random uuid | 404; no audit row | Nothing persists |
| Tier write with a failing audit write | Forced failure inside the transaction | The tier change is rolled back too | Nothing persists; HTTP 500 surfaced |
| Period window mid-month | Account zone `Asia/Manila`, now 2026-09-23 | Window is 2026-09-01T00:00 to 2026-10-01T00:00 **in Manila**, expressed as UTC instants; `resetAt` is the window end | No error expected |
| Timezone changed mid-period | Zone history: `UTC` from account creation, `Pacific/Auckland` effective now | Current period still uses `UTC` (the zone at that period's start); the **next** period uses `Pacific/Auckland` | Never re-slices or shortens the running period |
| Zone whose month boundary crosses DST | Account zone `America/New_York`, period spanning the DST switch | Window start and end are each the local midnight of the first of the month, offsets resolved independently | No arithmetic drift; never assumes a fixed offset |
| Account with no timezone entry | History row missing | Falls back to `UTC` for the window | Never throws; the response reports the zone actually used |
| Parent-style token on the accounts routes | Token lacking the admin audience | 401/403 before the handler runs | Guard rejects |

</intent-contract>

## Code Map

Everything below already exists at `8f5cebe` (story 2.1) and is the pattern to follow — read these before writing anything new.

- `apps/api/prisma/schema.prisma` — the `admin` entity cluster with its header comment naming the owning module. Add a second cluster block for `identity` (`ParentAccount`, `AccountTimezone`) with the same commenting discipline; `AccountTier` is a Prisma enum. `@@map` to snake_case table names as every existing model does.
- `apps/api/prisma/migrations/` — `20260923005624_init_admin_taxonomy/`; generate the new migration with `prisma migrate dev --name add_identity_parent_account`, never hand-write it.
- `apps/api/src/admin/taxonomy.service.ts` — the reference write path: `this.prisma.withTransaction(...)`, `NotFoundException` on a missing row, `this.audit.record(tx, …)` inside the same transaction, `ITEM_FIELDS`-style narrow `select`. Mirror this shape in the new tier-change path.
- `apps/api/src/admin/admin-audit.service.ts:15` — the `AuditAction` union; add `'parentAccount.tierChange'`. `AuditDetail` is `Record<string, string | number | boolean | null>`, so the detail payload must stay flat scalars.
- `apps/api/src/admin/taxonomy.controller.ts` — controller conventions: `@Controller('admin/…')`, `@UseGuards(AdminAuthGuard)`, `@SkipThrottle({ login: true })`, `ParseUUIDPipe` on every id param, `actor(req)` reading `req.admin!.adminUserId`. The new accounts controller is a copy of this shape.
- `apps/api/src/admin/dto/taxonomy.dto.ts` — `class-validator` DTO conventions for the new tier DTO (`@IsEnum`).
- `apps/api/src/prisma/prisma.service.ts:11` — `TransactionClient` type, the first parameter of every cross-service write method.
- `apps/api/src/app.module.ts:31` — module registration list; `IdentityModule` and `AllowanceModule` go here, and `AdminModule` imports them.
- `apps/api/src/common/env.ts` — `requireEnv` / `requireIntEnv` helpers if any new config is needed (none is expected).
- `apps/api/test/harness.ts` — `createHarness()`, `adminToken()`, `parentStyleToken()`, and `resetTaxonomy()` (a `TRUNCATE`). Add a matching reset for the new tables and a fixture that creates Parent Accounts; keep the operator row surviving resets.
- `apps/api/test/taxonomy.int-spec.ts` — the Tier-1 pattern, including the audit-rollback test that mocks `audit.record`. The tier-change rollback test mirrors it, and the HTTP-500 assertion the 2.1 review deferred should be made at the HTTP layer here.
- `apps/web/src/lib/admin-api.ts` — `call<T>()`, `AdminApiError`, `messageFor`, and the `adminApi` object the new account calls join.
- `apps/web/src/copy/admin.ts` — the single copy module; add an `accounts` section plus `announce` entries for tier changes.
- `apps/web/src/app/admin/_components/AdminChrome.tsx:40` — the nav; add the Parent Accounts link beside `nav.taxonomy`.
- `apps/web/src/app/admin/taxonomy/page.tsx` and `_components/TaxonomyList.tsx` — the client-page pattern: load on mount, guard on missing token, live region for announcements, MUI table at elevation 0. The accounts screen follows it.
- `apps/web/src/theme/tokens.ts`, `theme.ts` — `density`, tap-target floor, and the `table-cell` type role; consumption numbers need `fontVariantNumeric: 'tabular-nums'`.
- `e2e/global-setup.ts` and `e2e/prepare.mts` — the E2E database is truncated per run and seeded by `apps/api/prisma/seed.ts`. Parent Accounts must be created as an **E2E fixture** (in `global-setup.ts`, against the E2E database), never by the production seed script.
- `_bmad-output/specs/spec-n-test-reviewer/tiers.md` — the authoritative figures to transcribe once.
- `_bmad-output/specs/spec-n-test-reviewer/glossary.md:5-9` — "Parent Account", "Account Tier", the three allowance names; use these exact terms in copy and identifiers.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` — add the `identity` cluster: enum `AccountTier { Free Plus Family Internal }`; `ParentAccount { id, email @unique, displayName?, tier @default(Free), createdAt, updatedAt }`; `AccountTimezone { id, parentAccountId, timezone, effectiveFrom, createdAt, @@index([parentAccountId, effectiveFrom]) }` — the effective-dated history AD-27 requires.
- `apps/api/prisma/migrations/**` — generated migration for the above.
- `apps/api/src/identity/identity.module.ts`, `parent-account.service.ts` — sole writer of both models: `list()`, `findById(id)`, `effectiveTimezoneAt(accountId, instant)`, `timezoneHistory(accountId)`, `setTier(tx, accountId, tier)` taking the transaction client first, and a `create(...)` used only by tests and future Epic 1 sign-up. Exports the service; no controller.
- `apps/api/src/allowance/tiers.ts` — the one transcription of `tiers.md` as a frozen table keyed by `AccountTier`, `null` meaning unlimited, with a comment naming the source file.
- `apps/api/src/allowance/period.ts` — `monthWindowFor(instant, zone)` and `resolveWindow(instant, history)`: compute the calendar-month window in a zone using `Intl.DateTimeFormat` parts (no fixed-offset arithmetic, DST-safe), then re-resolve the zone using the one in effect at the computed window start so a mid-period zone change cannot re-slice the running period.
- `apps/api/src/allowance/allowance.service.ts`, `allowance.module.ts` — owns no entity; `consumptionFor(accountId, now?)` returns `{ periodStart, periodEnd, resetAt, timezone, tier, studentProfileLimit, allowances: { upload, generation, explanation } }` where each allowance is `{ used, limit }` with `limit: null` for unlimited. Usage is counted from artifacts in the window; no producer entity exists yet, so the counting seam returns `0` for all three and is the single place Epics 3–6 wire their counts in — documented as such, with no stored counter anywhere.
- `apps/api/src/admin/dto/parent-account.dto.ts` — `AssignTierDto` with `@IsEnum(AccountTier)`.
- `apps/api/src/admin/parent-account.controller.ts` — `GET /api/admin/parent-accounts` (list with tier, effective timezone), `GET /api/admin/parent-accounts/:id` (account + full consumption payload), `PATCH /api/admin/parent-accounts/:id/tier`; guarded and throttled exactly as the taxonomy controller is.
- `apps/api/src/admin/parent-account-admin.service.ts` — `assignTier(actorId, accountId, tier)`: one transaction that reads the current tier through `identity`, calls `identity.setTier(tx, …)`, and writes the `parentAccount.tierChange` audit row; 404 when the account is unknown.
- `apps/api/src/admin/admin-audit.service.ts` — extend `AuditAction` with `'parentAccount.tierChange'`.
- `apps/api/src/admin/admin.module.ts`, `apps/api/src/app.module.ts` — register `IdentityModule` and `AllowanceModule`; `AdminModule` imports both and never touches their Prisma delegates.
- `apps/api/src/allowance/period.spec.ts` — unit tests for every period row of the I/O matrix: mid-month window, DST-spanning month, mid-period zone change using the zone at period start, missing history falling back to `UTC`.
- `apps/api/test/parent-account.int-spec.ts` — Tier-1 integration tests over the containerised Postgres covering every remaining I/O-matrix row: list, empty list, default `Free`, consumption payload and unlimited rendering, tier change with its audit row and unchanged window, same-tier reassignment, 400 on an unknown tier, 404 on an unknown account, audit-failure rollback asserted at the **HTTP layer** (500, nothing persisted), and parent-style-token rejection.
- `apps/api/test/harness.ts` — add a Parent Account fixture helper and extend the reset to truncate `parent_account` and `account_timezone`.
- `apps/web/src/lib/admin-api.ts` — `ParentAccountSummary`, `ParentAccountDetail`, and `AccountTier` types plus `listParentAccounts()`, `loadParentAccount(id)`, `assignTier(id, tier)` on `adminApi`.
- `apps/web/src/copy/admin.ts` — `nav.accounts`, an `accounts` section (title, intro, column labels, tier labels, `unlimited`, `usageOfLimit(used, limit)`, reset-date label, empty state, loading, retry) and `announce.tierChanged(account, from, to)`. No figure from `tiers.md` appears here.
- `apps/web/src/app/admin/_components/AdminChrome.tsx` — add the Parent Accounts nav link.
- `apps/web/src/app/admin/accounts/page.tsx`, `_components/ParentAccountTable.tsx`, `_components/TierSelect.tsx` — the accounts screen: table of accounts with tier, a tier control per row that assigns on change, and an expandable/adjacent consumption panel showing all three allowances as usage against limit with the account's period and reset date in its own timezone; every number tabular, every change announced in the live region, errors surfaced through `AdminApiError`.
- `e2e/global-setup.ts`, `e2e/tests/admin-accounts.spec.ts` — seed two Parent Accounts as an E2E fixture, then sign in as the operator and exercise: the accounts list renders both, a tier change persists across reload, and the consumption panel shows three allowances with the account's own reset date.

**Acceptance Criteria:**
- Given the Admin console, when the operator opens a Parent Account, then its current Account Tier is shown, and an account that has never been assigned one shows `Free`.
- Given a Parent Account, when the operator assigns a new tier, then the change persists, is the only way the tier can change (no route outside `/api/admin/*` writes it), produces exactly one `AdminAudit` row, and the next consumption read applies the new tier's limits to the **same, unchanged** current period window.
- Given a Parent Account, when the operator inspects consumption, then all three allowances (Upload, Generation, Explanation) are shown as usage against limit, together with the period start, the reset date, and the timezone they were computed in — that account's own, never a shared or server-default period.
- Given two accounts in different timezones, when their consumption is read at the same instant, then each window is computed in its own zone and the two reset dates differ accordingly.
- Given every limit rendered on the screen, when the source is traced, then it came from the API response originating in `allowance`'s tiers table — no figure from `tiers.md` is restated in web code, copy, tests, or the schema.
- Given the accounts screen in light and in dark, when a keyboard-only operator tabs through it, then every control is a real focusable element with an accessible name, a 2px focus outline at 2px offset, and a ≥44px hit area, no surface renders above elevation 0, and consumption columns align on tabular figures.
- Given a clean checkout, when `pnpm install && pnpm turbo run lint typecheck build test` runs with the compose Postgres up, then every task succeeds and the working tree contains no untracked build output that `.gitignore` does not cover.

## Spec Change Log

## Review Triage Log

### 2026-09-23 - Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 0, medium 7, low 6)
- defer: 4: (high 0, medium 2, low 2)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `findByIdForUpdate` took no row lock despite its name, so concurrent tier assignments could both record the same `from` tier - now issues `SELECT ... FOR UPDATE`, with a gated test that fails when the lock is removed.
  - `[medium]` `[patch]` An unvalidated timezone string 500'd the accounts list and detail for that account - zones are now rejected on write and fall back to UTC on read, both tested.
  - `[medium]` `[patch]` `account_timezone` allowed two entries at the same instant with no tiebreak, making zone resolution nondeterministic - added `@@unique([parentAccountId, effectiveFrom])` and a deterministic ordering.
  - `[medium]` `[patch]` Every tier assertion read its expectation out of the module under test, so a wrong transcription shipped green - `tiers.spec.ts` now parses `tiers.md` and compares the table row for row.
  - `[medium]` `[patch]` A failed consumption fetch left the panel on "Loading consumption..." forever - the panel now has a real error state with retry.
  - `[medium]` `[patch]` A late consumption response could render one account's allowances under another row - responses are dropped when the expanded account no longer matches.
  - `[medium]` `[patch]` `inZone`/`dateOnly` are what satisfy "rendered in that account's own timezone" and nothing pinned their output - extracted to `consumption-format.ts` with unit tests across four zones.
  - `[low]` `[patch]` `assignTier` was typed as returning a summary the controller never sent - controller and client type now agree.
  - `[low]` `[patch]` A redundant `@@index([email])` duplicated the unique constraint's own index - dropped.
  - `[low]` `[patch]` Email was stored unnormalised against a case-sensitive unique index, and a duplicate surfaced as 500 - now trimmed, lowercased, and mapped to 409.
  - `[low]` `[patch]` `resolveWindow`'s fixed two passes could leave the final window's zone and start disagreeing - now iterates to a bounded fixpoint.
  - `[low]` `[patch]` Dead `accounts.tierLabel` copy key, a second `role="status"` live region inside the table, and a hand-synced `colSpan={6}` - removed, dropped, and derived from a column constant.
  - `[low]` `[patch]` Untested API paths (non-UUID id, unauthenticated `GET /:id` and `PATCH`, extra body keys) and order-dependent E2E fixtures - tests added and the accounts spec made order-independent.

### 2026-09-23 - Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - `[low]` `[patch]` `AppModule` imported `IdentityModule`/`AllowanceModule` directly even though only `AdminModule` (which already imports both) uses their providers - removed the redundant imports.
  - `[medium]` `[patch]` `onAssignTier` treated a failed post-success `reload()`/`loadConsumption()` the same as a failed `assignTier` write, showing "The change could not be saved" even when the tier change had already persisted - split into two try blocks so only a real `assignTier` failure reports that message.
  - `[low]` `[patch]` No test exercised a failing tier-assignment PATCH, so a regression removing the post-failure resync could leave the tier select silently disagreeing with the server undetected - added an e2e test asserting the error banner and that the select still reads the pre-change tier.

### 2026-09-23 - Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 5: (high 0, medium 0, low 5)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[medium]` `[patch]` `onAssignTier` never cleared `pendingIds` when the initial `assignTier` write itself failed (non-401), leaving that row's tier select permanently disabled until a full page reload - both failure branches now clear the pending flag.
  - `[low]` `[patch]` The Verification section's copy-figure grep flags its own `unlimited:` copy key as a false positive, making the documented check unreliable as written - annotated with the expected-match exception.
  - `[low]` `[patch]` The Design Notes' `resolveWindow` snippet still documented the superseded two-pass version, disagreeing with the shipped bounded-fixpoint implementation - snippet replaced with the actual code.
  - `[low]` `[patch]` A tautological `expect(rows).toHaveCount(await rows.count())` assertion in `admin-accounts.spec.ts` compared the row count against itself and could never fail - replaced with a real precondition check.

## Design Notes

**Period windows: resolve the zone from the window, not the other way round.** A naive "current zone → month window" lets a zone change edit the running period. A fixpoint pass fixes it — the invariant AD-27 states is that the window's own start must resolve to the same zone the window was cut in. A history with several zone changes close together can take more than two passes to settle, so the shipped implementation bounds the loop rather than hardcoding two:

```ts
const MAX_RESOLUTION_PASSES = 3;

export function resolveWindow(instant: Date, history: readonly TimezoneEntry[]): PeriodWindow {
  let zone = zoneInEffectAt(history, instant) ?? 'UTC';
  let window = monthWindowFor(instant, zone);
  for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
    const zoneAtStart = zoneInEffectAt(history, window.start) ?? 'UTC';
    if (zoneAtStart === zone) return window; // window start decides the zone, so it is stable
    zone = zoneAtStart;
    window = monthWindowFor(instant, zone);
  }
  return window; // exhausted passes on a pathological history; returns the last candidate
}
```

`monthWindowFor` derives the local Y/M via `Intl.DateTimeFormat(… { timeZone })`, then finds the UTC instant of local midnight on the 1st by probing the zone's offset at that date — never by adding a stored offset, so a month spanning a DST switch resolves each boundary independently.

**Tier change is immediate because nothing is stored.** Usage is counted and limits are looked up per request, so a tier change needs no backfill, no period reset, and no migration of counters — it changes the number the same window is measured against, and that is exactly what "effective immediately against the current period" means.

**Cross-module write, one transaction.** `admin` never touches `parentAccount` itself:

```ts
return this.prisma.withTransaction(async (tx) => {
  const before = await this.identity.findByIdForUpdate(tx, accountId); // 404 if absent
  const after = await this.identity.setTier(tx, accountId, tier);
  await this.audit.record(tx, actorId, 'parentAccount.tierChange', 'ParentAccount', accountId, {
    from: before.tier, to: after.tier,
  });
  return after;
});
```

## Verification

**Commands:**
- `docker compose up -d postgres` — expected: healthy `postgres:18.6-alpine`
- `pnpm install --frozen-lockfile` — expected: workspace resolves, no new dependency added
- `pnpm --filter api exec prisma migrate dev --name add_identity_parent_account` — expected: one new migration directory, applied cleanly
- `pnpm turbo run lint typecheck build` — expected: all tasks pass
- `pnpm turbo run test` — expected: all Tier-1 and unit tests pass, including every I/O-matrix row
- `pnpm exec playwright test` — expected: admin taxonomy and the new accounts specs pass
- `grep -rn "\b10\b\|\bunlimited\b" apps/web/src/copy/admin.ts` — expected: no allowance figure from `tiers.md` restated in web copy (the `unlimited:` copy key itself matches `\bunlimited\b` — that hit is expected and not a violation; a violation looks like a numeric tier figure such as `20` or `60`)
- `git status --porcelain` — expected: no untracked build output outside `.gitignore`

## Auto Run Result

**Summary:** This run re-reviewed the already-implemented Parent Account Tier Assignment & Consumption View story (a fresh review pass on a `done` spec, per the `build-auto` intent-check routing for that status). No new feature code was written; four review-found defects were patched and five pre-existing/low-risk findings were deferred.

**Files changed this pass:**
- `apps/web/src/app/admin/accounts/page.tsx` — `onAssignTier` now clears `pendingIds` on a failed initial write too, so a non-401 assignment failure no longer leaves that row's tier select permanently disabled.
- `e2e/tests/admin-accounts.spec.ts` — replaced a tautological `toHaveCount(await rows.count())` assertion with a real precondition check.
- `_bmad-output/implementation-artifacts/spec-2-2-parent-account-tier-assignment-consumption-view.md` — annotated the Verification section's copy-figure grep for its expected false positive; replaced the Design Notes' stale two-pass `resolveWindow` snippet with the shipped bounded-fixpoint version; appended this pass's Review Triage Log entry and 5 new deferred items.

**Review findings breakdown (this pass):** 4 patched (1 medium, 3 low), 5 deferred (all low), 8 rejected (all low, all noise or ruled out by direct verification — e.g. the suspected `admin_audit` truncate race is not reachable because `vitest.config.ts` sets `fileParallelism: false`).

**Follow-up review recommendation:** `true`. Patched-this-pass counts: high 0, medium 1, low 3. Score = 3×1 + 1×3 = 6 (≥5).

**Verification performed:**
- `pnpm turbo run lint typecheck build` — all 7 tasks passed.
- `pnpm turbo run test` — 122/122 API tests and 23/23 web tests passed on 4 consecutive full-suite runs; one incidental failure in the unmodified `taxonomy.int-spec.ts` REST-surface test occurred on the first run only and did not reproduce across 4 reruns or in isolation (logged as a deferred low-severity flake, not caused by this diff).
- `pnpm exec playwright test` — 19/19 e2e tests passed, including the updated `admin-accounts.spec.ts`.
- `git status --porcelain` — clean; no untracked build output.

**Residual risks:** The 5 newly deferred items are all low severity and either currently unreachable (the timezone-write race, since no route calls `appendTimezone` yet), intentionally-designed-but-undertested (`resolveWindow`'s degraded convergence case, the resync-failure swallow, the stale-consumption-response guard), or an unreproduced pre-existing flake in an unmodified file. None block this story; all are candidates for a future story or a dedicated hardening pass.

