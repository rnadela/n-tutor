---
title: 'Story 9.6: Allowances Surface & Atomic Monthly Reset'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_revision: '2db38075de951036b05625e3ddcb995ea96f160b'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The Settings screen's own guarantees — the panel rendering, the allowance read
      firing, and a failed allowance read leaving Data & deletion operative — are
      asserted by matching the text of `page.tsx` rather than by observing behaviour.
    evidence: |-
      Every new case in `page.spec.tsx` reads `CODE` (the file's own source, read at
      line 14) and matches wording. Nothing mounts the screen: the file's comment says
      the node environment cannot. Inverting the render guard to
      `consumption === null && <AllowancesPanel …/>`, or moving the allowance failure
      into the shared `setError` path, leaves every grepped literal present and the
      suite green while the section never renders or a read failure takes the FR-33
      deletion gate down with it. Pre-existing constraint, not introduced here — the
      same pattern pins the Data & deletion cases — but it is now load-bearing for
      more claims. A real fix is either a DOM test environment for client screens or
      extracting the section assembly (panel vs. loading sentence vs. alert, given
      consumption/loading/error) into one presentational function.
    location: >-
      apps/web/src/app/parent/settings/page.spec.tsx (the Allowances describe)
    severity: medium
  - summary: >-
      `JwtModule.registerAsync({ useFactory: () => ({ secret: requireParentJwtSecret() }) })`
      is now registered identically in two modules, with a third occurrence imminent.
    evidence: |-
      `analytics.module.ts` and, since this story, `allowance.module.ts` both register
      the parent secret so `ParentElevationGuard` can be constructed in their own
      injector. The duplication is the sanctioned idiom this story was told to mirror,
      so fixing it at one site would create the second idiom; a shared
      `ParentJwtModule` is one decision covering every site.
    location: >-
      apps/api/src/allowance/allowance.module.ts; apps/api/src/analytics/analytics.module.ts
    severity: low
  - summary: >-
      A reading whose `used` exceeds its `limit` — reachable after an Admin tier
      downgrade — renders as "15 of 13", and the Allowances surface states no at-cap
      or over-cap distinction of any kind.
    evidence: |-
      `AllowancesPanel` renders `allowanceUsed(used, limitLabel(limit), unit)`
      unconditionally whenever `limit !== null`. The epic's AC for this surface asks
      only for usage, limit and reset date, and the sentence stays truthful, so this is
      not a defect against the story — but the surface exists so a parent sees a wall
      coming, and reaching one is currently indistinguishable from being halfway to it.
    location: >-
      apps/web/src/app/parent/settings/AllowancesPanel.tsx (the rows map)
    severity: low
  - summary: >-
      `GET parent/allowances` answers 404 when the account row is gone while a valid
      elevation bearer is still presented, rather than re-gating the parent.
    evidence: |-
      `consumptionFor` reads the account through `ParentAccountService.findById`, which
      throws `NotFoundException`. The web maps that to the section's retry alert rather
      than to ending Parent View. Every sibling parent-elevated read shares the shape,
      so it is one decision for all of them, not this route's alone.
    location: >-
      apps/api/src/allowance/parent-allowance.controller.ts:45
    severity: low
  - summary: >-
      The window-identity assertion couples itself to the number of usage classes via
      `expect(issued).toHaveLength(6)`.
    evidence: |-
      The case is about all counts riding one window, not about how many queries a read
      issues. A fourth usage class would fail it on the arity assertion with a message
      naming nothing that broke, before the set-size assertion it exists for is reached.
    location: >-
      apps/api/src/allowance/allowance.service.spec.ts (the consumptionFor describe)
    severity: low
  - summary: >-
      Nothing prevents a Parent View module from importing `admin-api.ts`, and two
      parent-visible strings still come out of `adminCopy`.
    evidence: |-
      `consumption-format.ts` exists so `parent-api.ts` need not import the admin client
      for a type, but `admin-api.ts` keeps re-exporting the four names, so the edge
      remains available to any new file with no lint rule refusing it. Separately, the
      parent's "unlimited" word and its tier labels are read from
      `adminCopy.accounts.*` — pre-existing for `limitLabel`, extended to `tierLabel`
      here. A shared copy namespace plus a `no-restricted-imports` rule is one fix for
      both; note `pnpm lint` is broken repo-wide, so the rule could not be added today.
    location: >-
      apps/web/src/lib/admin-api.ts; apps/web/src/lib/consumption-format.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** A parent cannot read their own allowances anywhere. `AllowanceService.consumptionFor` computes all three counters, their limits, the tier and the reset instant, but the only surfaces that expose it are the Admin console (Story 2.2) and, for the Explanation counter alone, the Analytics dashboard (Story 7.4) — plus `GET parent/allowance/generation`, which answers one allowance shaped for the generate screen. So the epic's "a parent can read all three counters without entering an at-cap state" is unshipped, and the only way a parent learns a limit exists is by hitting it. The atomic reset is true by construction — one window feeds all three counts — but nothing asserts it, so a future change that resolved a window per counter would leave every suite green.

**Approach:** Expose the existing `consumptionFor` payload once, unchanged, on a parent-elevated `GET parent/allowances`, and render it as an Allowances section under Parent View Settings naming the Account Tier, usage against each limit, and the reset date in the account's own zone. Then pin the reset's atomicity with tests: one window resolved once for all three counts, and a real-database case where usage in the previous period reads zero for all three in the next while the previous period still reads its own figures.

## Boundaries & Constraints

**Always:**
- The parent surface reads the **same** `consumptionFor` payload the Admin detail route reads, from the same method, so the epic's "admin and parent views can never disagree" holds by construction rather than by two compositions agreeing today.
- All three counters are measured over **one** `PeriodWindow` resolved once per read. `resetAt` is that window's exclusive `end`. A per-counter window resolve is the partial-reset defect the epic names.
- Reading the surface charges nothing, reads no artifact-producing path, and is reachable at cap for all three allowances.
- `limit: null` is unlimited and is said in words. No tier figure, tier table or reset date is composed in `apps/web`: every figure is the API's, read through `limitLabel` / `dateOnly` in `@/lib/consumption-format`.
- Generation copy is denominated in **Practice Tests** on this surface too — the epic's hard copy rule.
- Usage figures use tabular numerals, as the Admin consumption panel does.
- Behind `ParentElevationGuard` and nothing else; the account comes off the verified elevation, never a path or body param (AD-18). No allowance counter, cost figure or tier label becomes reachable from a student-scoped endpoint.

**Block If:**
- Nothing. Every acceptance criterion is reachable in-repo.

**Never:**
- Never add a counter column, a period column, a stored reset date or a reset job. Usage stays derived (AD-14).
- Never build a second consumption composition, a second window resolve, or a second Explanation readout — the Analytics dashboard's Explanation counter (Story 7.4) already satisfies its own AC and is not touched.
- Never add a timezone-editing control. `appendTimezone` has no route and Settings has no timezone field; the UX rule about what a zone change takes effect on belongs to the story that ships that control.
- Never widen `GET parent/allowance/generation` or change its shape — the generate screen owns it.
- Never restate a tier figure, tier name or reset date as a literal in a test: read them through `TIER_LIMITS` / the response.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Parent reads allowances | Elevated `GET /api/parent/allowances`, `Free` account with usage | 200 with tier, three `{used, limit}` readings, `studentProfileLimit`, `periodStart`, `periodEnd`, `resetAt`, `timezone` — byte-identical to the Admin detail route's `consumption` for the same account | No error expected |
| At cap on all three | Account at its tier's Upload, Generation and Explanation limits | 200 with `used === limit` on all three; nothing is refused and nothing is charged | No error expected |
| Unlimited tier | `Internal` account | 200 with `limit: null` on all three and `studentProfileLimit: null`; the screen says unlimited in words | No error expected |
| Not elevated | Session cookie only, no elevation bearer | 401 carrying `elevated: false` | Guard's own refusal, unchanged |
| Student-scoped caller | Student bearer / student cookie | 401 — the route is not reachable from Student Mode | Guard's own refusal |
| Previous-period usage | Upload, Generation and Explanation artifacts charged inside the previous month's window | Read at a `now` inside the next window: all three `used` are 0 together. Read at a `now` inside the previous window: all three state their own figures | No error expected |
| Boundary instant | `now` exactly `window.end` of the previous period | The next period's window; all three counters move together at that one instant (half-open `[start, end)`) | No error expected |
| Two zones, one instant | Two accounts, different stored zones, same `now` | Different `resetAt`, each in its own zone, each cut as one window for its own three counters | No error expected |
| Read fails | API unreachable or 5xx | The section states the read failed and offers nothing invented; the rest of Settings still renders | Copy-file sentence, no figure guessed |

</intent-contract>

## Code Map

- `apps/api/src/allowance/allowance.service.ts:298-325` (`consumptionFor`) -- **the whole payload, already built.** Reads the account through `identity` (404s on unknown), resolves **one** `windowFor`, runs `countArtifactsIn` over it, and returns `periodStart`/`periodEnd`/`resetAt`/`timezone`/`tier`/`studentProfileLimit`/`allowances`. Takes an injectable `now`, which is what makes the boundary cases testable without a clock fake. **Reuse verbatim; add no method and no second composition.**
- `apps/api/src/allowance/allowance.service.ts:327-335` (`countArtifactsIn`) -- the three counts, `Promise.all` over **one** `window`. This is the atomicity the story has to pin: one window in, three counts out.
- `apps/api/src/allowance/allowance.service.ts:9-33` (`AllowanceReading`, `AccountConsumption`) -- the exported response type. The controller returns it as-is; no DTO and no view file is needed.
- `apps/api/src/allowance/allowance.module.ts` -- currently `imports: [IdentityModule, PrismaModule]`, **no controller**. Add the controller and `ParentElevationGuard` to `providers`, plus `JwtModule.registerAsync({ useFactory: () => ({ secret: requireParentJwtSecret() }) })` — copy `apps/api/src/analytics/analytics.module.ts:40-62` exactly, which is the same guard wired into a module that otherwise only computes. Keep the existing comment about why `SourceTestModule` is absent.
- `apps/api/src/analytics/parent-analytics.controller.ts` -- **the golden example** for the new controller: `@Controller('parent')`, `@SkipThrottle({ login: true })`, `@UseGuards(ParentElevationGuard)`, account off `req.elevated!.parentAccountId`.
- `apps/api/src/practicetest/practice-test.controller.ts:85-88` -- the sibling route `GET parent/allowance/generation`. Read it to keep the new path from colliding and to see the one-line delegation shape. **Do not change it.**
- `apps/api/src/admin/parent-account-admin.service.ts:38-45` (`detail`) -- the Admin reader of the same method. The "admin and parent can never disagree" case asserts both routes against one account.
- `apps/api/src/allowance/allowance.service.spec.ts:168-380` -- the three `…UsedIn` describe blocks with Prisma doubles. There is **no** `consumptionFor` case anywhere: the atomicity cases go here, beside them, using the same double style.
- `apps/api/src/allowance/period.spec.ts:58-215` -- already covers zone history, DST, the running period never re-sliced, and two zones getting different reset instants. **Read-only: the window rules are proven; what is unproven is that all three counters ride one window.**
- `apps/api/src/allowance/tiers.ts:20-33` (`TIER_LIMITS`, `limitsFor`) -- the one figure source. Tests read expectations from it.
- `apps/api/test/harness.ts:466-490` (`createParentAccount`, takes `timezone`/`effectiveFrom`/`tier`), `:679-692` (`setAccountTier`), `:719-732` (`createSignedInParent`), `:733-766` (`bearer`, `setPinFor`, `elevate`), `:181` (`resetParentAccounts`) -- the fixtures. `TIER_LIMITS` is already imported here. Reuse; add no tier literal.
- `apps/api/test/analytics.int-spec.ts:1-60` -- the int-spec shape to copy (dynamic `await import`, `createHarness`, `resetParentAccounts`, PIN + `elevate`), **and the sanctioned precedent for writing artifact rows straight to the tables** when the case is about what a read comes to rather than about a production write path. The new suite needs charged `source_test` / `practice_test` / `explanation` rows at chosen instants, which no service will produce on demand.
- `apps/api/test/parent-account.int-spec.ts:263,552` -- `appendTimezone` used from a fixture, for the two-zones case.
- `apps/web/src/lib/admin-api.ts:56-85` -- `ACCOUNT_TIERS`, `AccountTier`, `AllowanceReading`, `AccountConsumption`. **Move these four to `@/lib/consumption-format` and re-export them from here** (`export type { … }` / `export { ACCOUNT_TIERS }`) so no admin call site changes and the shape stays defined once. `ParentAccountSummary`/`ParentAccountDetail` stay here.
- `apps/web/src/lib/consumption-format.ts` -- `inZone`, `dateOnly`, `limitLabel` (already sources `adminCopy.accounts.unlimited`). This is the module both surfaces already share, so it is where the moved types land and where a new `tierLabel(tier)` reading `adminCopy.accounts.tiers` belongs — one tier-label map for the app, not a parent copy of it. Its header doc must say it is now the shared consumption vocabulary, parent and admin.
- `apps/web/src/lib/consumption-format.spec.ts` -- pins the formatters against a zone the test machine does not share. Add the `tierLabel` cases here.
- `apps/web/src/app/admin/_components/ParentAccountTable.tsx:22,51-108` (`tabular`, `ConsumptionPanel`) -- **the rendering precedent**: label/used-of-limit rows, `limitLabel`, `inZone`/`dateOnly`, tabular numerals. The parent panel mirrors it with parent copy and a tier line. Only its type import changes, if at all.
- `apps/web/src/lib/parent-api.ts:1926-1931` (`generationAllowance`) -- the client-method shape to copy, and `:222-240` (`GenerationAllowanceView`) for the doc conventions. Add `allowances: (token) => call<AccountConsumption>('/parent/allowances', { headers: elevated(token) }, parentCopy.settings.allowancesFailed)`, importing the type from `@/lib/consumption-format`.
- `apps/web/src/app/parent/settings/page.tsx:1-51` -- the screen. `DataAndDeletionNote` is the precedent for **exporting the presentational piece so its spec can render it in the node environment**; the screen's own `useEffect`/`useElevation`/`applyIfCurrent` load pattern (52-135) is what the new read hangs off, and `refusalText`/`endsParentView` handle a lost elevation. The Allowances section renders **above** Data & deletion: reading a limit is the routine visit, ending the account is not.
- `apps/web/src/app/parent/settings/page.spec.tsx:1-50` -- the spec style: `renderToStaticMarkup` of the exported piece plus source-text assertions over `CODE`, because this environment cannot mount the client screen. The new panel's spec follows it.
- `apps/web/src/copy/parent.ts:366-390` (`settings` group) -- where the new copy goes: section heading, the three allowance labels, used-of-limit, unlimited, reset-date and tier lines, the loading sentence and `allowancesFailed`. `:1799-1803` (`analytics.allowance*`) is the wording to stay consistent with, and `:849-862` is the Practice Tests denomination rule the Generation label and its unit must obey.
- `apps/web/src/app/parent/analytics/page.tsx:455-479` -- the Explanation counter on the dashboard. **AC3 is already satisfied by Story 7.4; read it, change nothing.**
- `apps/api/src/identity/parent-account.service.ts:157-168` (`timezoneHistory`, `effectiveTimezoneAt`), `:453-465` (`appendTimezone`) -- read-only here. `appendTimezone` has no route: no zone-editing surface is in this story.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/allowance/parent-allowance.controller.ts` -- new: `@Controller('parent')` + `@SkipThrottle({ login: true })` + `@UseGuards(ParentElevationGuard)`, one `@Get('allowances')` returning `this.allowance.consumptionFor(req.elevated!.parentAccountId)`. Document that it is the *same* method the Admin detail route reads, which is why the two views cannot disagree, and that reading charges nothing and is reachable at cap.
- `apps/api/src/allowance/allowance.module.ts` -- register the controller, add `ParentElevationGuard` to `providers` and the `JwtModule.registerAsync` the guard needs, mirroring `analytics.module.ts`. Update the module doc: it exposes one read-only controller now; it still owns no entity and still writes nothing.
- `apps/api/src/allowance/allowance.service.spec.ts` -- add a `consumptionFor` describe: all three counts are issued over **one identical** `[start, end)` pair; `resetAt === periodEnd`; the limits come from `limitsFor(tier)` with `null` passed through as `null`; a `now` moved across a period boundary moves all three counters' window together in one step, and no counter is ever measured over a window another was not.
- `apps/api/test/allowance.int-spec.ts` -- new suite over the real app and database: the elevated read's full payload; equality with `GET /api/admin/parent-accounts/:id`'s `consumption` for one account; 200 at cap on all three; `null` limits on `Internal`; 401 unelevated and 401 from a student-scoped credential; previous-period usage in all three classes reading 0 together in the next period while the previous period still states its figures; an artifact charged exactly at `window.end` counted in the next period and not both; two accounts in different stored zones getting different `resetAt` at one `now`. Every expected figure from `TIER_LIMITS` or the response.
- `apps/web/src/lib/consumption-format.ts` -- take over `ACCOUNT_TIERS`, `AccountTier`, `AllowanceReading` and `AccountConsumption`, add `tierLabel(tier)` over `adminCopy.accounts.tiers`, and say in the header that this module is the app's one consumption vocabulary — shared by the Admin console and Parent View, which is why the labels are not duplicated per surface.
- `apps/web/src/lib/admin-api.ts` -- re-export the four moved names from `@/lib/consumption-format` so every existing admin import keeps resolving; delete the local definitions. No admin behaviour changes.
- `apps/web/src/lib/consumption-format.spec.ts` -- add `tierLabel` cases: every `AccountTier` renders a non-empty label, and it is read from the copy file rather than from the enum value.
- `apps/web/src/lib/parent-api.ts` -- add `allowances(token)` beside `generationAllowance`, returning `AccountConsumption`, with a doc stating that every figure is the API's and this app holds no tier table, limit or reset date.
- `apps/web/src/app/parent/settings/AllowancesPanel.tsx` -- new exported presentational component taking `{ consumption }`: the section heading, the Account Tier line, one row per allowance (Upload, Generation in **practice tests**, Explanation) as used-of-limit through `limitLabel`, the Student Profile limit, and the reset date through `dateOnly(consumption.resetAt, consumption.timezone)`. Tabular numerals, all copy from `parentCopy.settings`. Presentational so its spec can render it without the screen, its router or its elevation — `DataAndDeletionNote`'s reason.
- `apps/web/src/app/parent/settings/page.tsx` -- read the allowances on mount through the elevation the screen already holds, render `AllowancesPanel` above Data & deletion, state `parentCopy.settings.allowancesLoading` in a `role="status"` while in flight and `allowancesFailed` on failure, and keep Data & deletion working when the allowance read fails. A lost elevation goes through the existing `refusalText`/`endsParentView` path.
- `apps/web/src/copy/parent.ts` -- add the `settings` allowance copy: heading, tier line, the three allowance labels with Generation denominated in practice tests, used-of-limit, unlimited, Student Profile limit, reset-date sentence, `allowancesLoading`, `allowancesFailed`. Wording consistent with `analytics.allowance*`; no figure, tier name or date composed here.
- `apps/web/src/app/parent/settings/AllowancesPanel.spec.tsx` -- new: all three allowances are named and each states used-of-limit; the Generation row says practice tests and never "generations", "requests" or "credits"; an unlimited reading says so in words and shows no invented number; the reset date renders in the account's zone and not in the machine's or UTC; the tier is named; the panel restates no figure of its own (no limit literal, no tier literal in the component).
- `apps/web/src/app/parent/settings/page.spec.tsx` -- assert over `CODE` that the screen renders `AllowancesPanel`, that it states the loading and failed sentences from the copy file, and that a failed allowance read does not suppress Data & deletion.

**Acceptance Criteria:**
- Given an elevated parent on any tier, when they open Parent View Settings, then the Allowances section names the Account Tier and states usage against the limit and the reset date for Upload, Generation and Explanation — with nothing refused, nothing charged, and no cap entered, including on an account already at cap on all three.
- Given one account, when the parent's allowances read and the Admin account-detail read answer, then their consumption payloads are equal field for field, because both are the same `consumptionFor` call.
- Given any single allowances read, when it answers, then exactly one period window was resolved and all three counters were measured over it, and `resetAt` is that window's exclusive end.
- Given usage charged in all three classes inside a period, when the account is read in the following period, then all three counters read 0 together, and read in the earlier period they all still state their own figures — no counter resets without the others and none resets twice.
- Given two accounts whose stored zones differ, when both are read at one instant, then each states the reset instant of its own zone.
- Given the whole web suite, when it runs, then the Allowances surface holds no tier figure, tier name or reset date of its own, every limit renders through `limitLabel`, every date through `dateOnly`, and the Generation allowance is denominated in practice tests on every surface.
- Given a student-scoped or unelevated caller, when they request the allowances route, then it answers 401 and no tier, counter or cost figure is in the body.

## Spec Change Log

## Review Triage Log

### 2026-09-30 — Review pass (fresh, post-done)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 17: (high 0, medium 0, low 17)
- addressed_findings:
  - none

### 2026-09-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 6: (high 0, medium 1, low 5)
- reject: 18: (high 0, medium 0, low 18)
- addressed_findings:
  - `[medium]` `[patch]` The new `parentApi.allowances` method was exercised by no running test — a wrong path or a dropped elevation header would have shipped green while the section never loaded. Added path/header/failure-copy cases to `parent-api.spec.ts`.
  - `[medium]` `[patch]` `allowance.int-spec.ts` never proved the payload is scoped to the caller and never exercised the tombstone half of the composition against the real table. Added a two-elevated-accounts case and a `usage_tombstone` period case.
  - `[low]` `[patch]` `tierLabel` rendered the literal `undefined` for a tier absent from the client's `ACCOUNT_TIERS` mirror. Added a placeholder fallback and an off-union case.
  - `[low]` `[patch]` `AllowancesPanel.spec.tsx` never rendered a `used === limit` reading, so "viewable without entering an at-cap state" was proven at the HTTP surface only, and asserted none of the section semantics the diff introduced. Added an at-cap case and an `aria-labelledby`/heading/intro case.
  - `[low]` `[patch]` A retry whose allowance read failed left the previous period's figures on screen under an alert saying the read had failed. The failure branch now clears `consumption`.
  - `[low]` `[patch]` `expect(CODE).not.toContain('allowancesError !== null || loading')` asserted the absence of one spelling of a coupling. Replaced with positive assertions that the alert renders `allowancesError` and that the delete control's `disabled` predicate reads no allowance state.

## Design Notes

**Why the route returns `consumptionFor` unchanged rather than a parent-shaped view.** The epic requires admin and parent views that "can never disagree". A parent DTO would be a second shape derived from the same numbers, and the guarantee would then rest on two mappings staying aligned. Returning the one payload makes the equality assertable in a single test — and `studentProfileLimit` and `periodStart` are facts a parent may see, so nothing had to be withheld. This is also why the route lives in `allowance` rather than beside the generate screen's route in `practicetest`: `allowance` is the module that owns the composition, and a parent surface reading three allowances has no business entering the module that owns one artifact.

**What "atomic" actually means in this design.** There is no reset. `consumptionFor` resolves one window and measures three counts over it, so the counters "reset together" because they are one derivation of one window — a partial reset has no code path to arrive through. The tests therefore pin the *shape of the derivation* (one window, three counts, `resetAt === periodEnd`) rather than a reset event, plus one real-database case proving the observable consequence across a boundary. A future change that resolved a window per counter is exactly what the unit case fails on.

**Why the four types move to `consumption-format.ts`.** Both surfaces need `AccountConsumption`, and `parent-api.ts` importing `admin-api.ts` would give Parent View an edge to the admin client — including its token storage. `consumption-format.ts` is already the shared module (Parent View's analytics and generate screens import `limitLabel` from it, which already reads `adminCopy.accounts.unlimited`), so the move follows an edge that exists rather than creating one. `tierLabel` lands there for the same reason: one tier-label map in the app.

**Why AC3 needs no code.** Story 7.4 already ships the Explanation counter on the dashboard — `analytics.service.ts:91-96` reads it from `consumptionFor` and `analytics/page.tsx:455-479` renders used-of-limit plus the reset date in the account's zone, with the response stating it is account-level and not the selected child's. The criterion is met; re-rendering it here would be the second Explanation readout the epic forbids. Verification is a read, not a change.

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass, including the new `allowance.int-spec.ts`. Needs Postgres (`pnpm db:up`). Known baseline flakes: DW-89 and DW-288 (`practice-test.int-spec.ts` full-file runs) are not this story's.
- `pnpm --filter web test` -- expected: the new panel spec, the settings spec, `consumption-format.spec.ts` and every admin spec touching the moved types pass.
- `pnpm typecheck` -- expected: clean, which is also what proves the `admin-api` re-exports kept every existing import resolving.
- `pnpm exec prettier --check .` -- expected: no unformatted files. (`pnpm lint` is known-broken repo-wide: `Command "eslint" not found`.)

**Manual checks (if no CLI):**
- Grep `apps/web/src/app/parent/settings` and `apps/web/src/copy/parent.ts` for `Free`, `Plus`, `Family`, `Internal` and for any allowance figure: none of the web's own.
- Grep the repo for a second `consumptionFor`-like composition or a second `resolveWindow` call per counter: there must be exactly one window resolve per read.

## Auto Run Result

Status: done (fresh review pass over an already-`done` spec; no code changes made this pass)

Summary: This run re-reviewed the existing implementation (commit `49920f3`, diff against baseline `2db3807`) — no new code was written. Four review layers ran in parallel (blind hunter, edge-case hunter, verification-gap, intent-alignment auditor) against the full diff.

Files changed (from the prior implementation commit, unchanged this pass):
- `apps/api/src/allowance/parent-allowance.controller.ts` -- new parent-elevated `GET parent/allowances` route.
- `apps/api/src/allowance/allowance.module.ts` -- wires the controller + `ParentElevationGuard` + `JwtModule.registerAsync`.
- `apps/api/src/allowance/allowance.service.spec.ts` -- new `consumptionFor` atomicity unit cases.
- `apps/api/test/allowance.int-spec.ts` -- new real-database int-spec (equality with Admin, at-cap, unlimited, unelevated/student 401s, previous-period/boundary/two-zone atomicity).
- `apps/web/src/lib/consumption-format.ts` / `admin-api.ts` -- shared consumption types + `tierLabel` moved to the shared module.
- `apps/web/src/lib/parent-api.ts` -- `allowances(token)` client method.
- `apps/web/src/app/parent/settings/AllowancesPanel.tsx` (+ spec) -- new presentational panel.
- `apps/web/src/app/parent/settings/page.tsx` (+ spec) -- wires the allowances read above Data & deletion.
- `apps/web/src/copy/parent.ts` -- new Allowances copy.

Review findings breakdown: patch 0, defer 0, reject 17 (0 high / 0 medium / 17 low). Every finding was either a sanctioned existing idiom confirmed safe on inspection (`req.elevated!` is guaranteed by `ParentElevationGuard.canActivate` throwing before the handler runs; `JwtModule.registerAsync` mirrors `analytics.module.ts` by design), speculative with no concrete regression, or a duplicate of an issue already tracked in this spec's `deferred` list (the source-text-only Settings-screen tests, and the deleted-account-mid-read 404 path). No new patch or spec defect surfaced. Full detail in the `## Review Triage Log` entry above.

Follow-up review recommendation: false (0 patch findings this pass; score 0).

Verification performed: no code changed this pass, so no commands were re-run. The prior implementation's own `## Verification` commands (`pnpm --filter api test`, `pnpm --filter web test`, `pnpm typecheck`, `pnpm exec prettier --check .`) remain the record of what was verified at implementation time.

Residual risks: the pre-existing source-text-only test pattern on `apps/web/src/app/parent/settings/page.spec.tsx` (already deferred, medium severity) remains the main verification gap on this surface — a fetch/loading/error regression on the Settings screen would not be caught by any running test. No other residual risk surfaced this pass.

