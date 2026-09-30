---
title: 'Story 9.4: Generation Allowance Enforcement'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_revision: '0c6c6238a0446e58ce448726c1e4fd1dd58a56d8'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      `land()` now takes the account row lock inside a transaction bounded by
      the landing timeout, and a lock wait long enough to exhaust that budget
      is misreported as a provider failure rather than as a cap refusal.
    evidence: |-
      `findByIdForUpdate` is the first statement of `land`'s `withTransaction`,
      which then writes the Practice Test, its questions, choices and topics
      under `LAND_TIMEOUT_MS` / `LAND_MAX_WAIT_MS`. A blocked acquisition is
      charged to that same budget, and a transaction timeout is neither
      `GenerationAllowanceSpent` nor `GenerationClockAnomaly`, so `fail`
      classifies it `UpstreamFault` with `GENERATION_FAILED` and
      `retryable: true` — "Try again" for what was really contention. Narrow in
      the current deployment (one runner, one job at a time) and not covered by
      any case.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (land)
    severity: medium
  - summary: >-
      No test lands a draft across a period boundary, so the boundary-crossing
      case `land()`'s per-draft window re-read exists for is unverified.
    evidence: |-
      `land` re-reads `allowance.windowFor(parentAccountId, chargedAt)` per
      draft precisely so a job spanning a rollover is counted against the period
      it charges to. The integration suite covers the half-open window at
      *request* time only. The harness has no clock seam, which is the same
      limitation Story 9.3 recorded for its own boundary fix.
    location: >-
      apps/api/test/practice-test.int-spec.ts
    severity: medium
  - summary: >-
      The concurrency case never contends `land()`'s row lock: the jobs it
      accepts are drained one at a time.
    evidence: |-
      "lets two concurrent requests through, and still charges exactly one
      draft" fires both requests with `Promise.all`, then drains with
      `while (await h.practiceTestRunner.runOnce())` — sequential. Its
      assertion (`practiceTest.count() === 1`) therefore holds under purely
      sequential execution, so the `FOR UPDATE` the cap's correctness rests on
      is never actually raced. Driving two `land` transactions concurrently
      needs a runner seam the harness does not expose.
    location: >-
      apps/api/test/practice-test.int-spec.ts
    severity: medium
  - summary: >-
      The topic drill-down screen's at-cap message still names no tier,
      figure or date of its own, unlike the generate screen, which this story
      moved onto the API's `exhaustedReason` sentence.
    evidence: |-
      `apps/web/src/app/parent/analytics/topics/[topicId]/page.tsx`'s
      `topic-drill-down-spent` node still renders the static
      `parentCopy.topicDrillDown.spent` ("No Generation Allowance is left this
      period, so nothing can be made right now.") whenever `!cost.spendable`,
      rather than `allowance.exhaustedReason`. Out of this story's scope (not
      in its Code Map), and it does not violate any Always/Never bullet since
      the static sentence still names no tier, limit or date — but the two
      parent-facing surfaces for the same block now state different levels of
      detail, and nothing in `page.spec.tsx` (a source-text match, not an
      executed render) would catch further drift.
    location: >-
      apps/web/src/app/parent/analytics/topics/[topicId]/page.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Generation Allowance is clamped but not enforced. `PracticeTestService.request` counts charged Practice Tests and clamps the ask, but (a) it refuses with `NO_GENERATION_ALLOWANCE`, a sentence naming neither the tier, the usage against the limit, nor the reset date — the three facts Epic 9's hard block requires; (b) the clamp counts only rows that have *already* charged, so two requests (two tabs, or one after the other while a job is still `Queued`) each see the same remaining allowance and together land more drafts than the tier allows (DW-87); and (c) `land()` — the transaction that actually produces the artifact and writes `chargedAt` — checks only for a clock anomaly and never re-checks the limit, so a job spanning a period boundary lands drafts the new period would have refused (DW-92). A parent sitting at cap also never sees the refusal at all: the screen disables every count and states a sentence of its own that names no tier and no reset date.

**Approach:** Move the cap from the request clamp to the point of production. `land()` gains the same guard shape Story 9.3 gave `SourceTestService.submit` — the account row locked inside the transaction that writes the artifact, counted through one `AllowanceService` method — so the limit is enforced by the statement that charges. `request()` keeps clamping, but its at-cap refusal becomes a `generationAllowanceExhausted` sentence naming tier, usage against limit in Practice Tests, and the reset date in the account's own zone; the same sentence rides the allowance read so a parent already at cap reads it instead of the screen's own words.

## Boundaries & Constraints

**Always:**
- The cap check and the `practice_test` INSERT share **one** transaction in `land()`, serialized by `ParentAccountService.findByIdForUpdate` on `parent_account` — the identical row lock Stories 9.2 and 9.3 and the Admin tier change use. No second lock idiom, no application-level clamp standing in for it.
- Usage stays **derived** (AD-14): no counter column, no reservation row, no reset job, nothing decremented. The count is charged Practice Tests in the window **plus `Generation` usage tombstones** — one method, `AllowanceService.generationUsedIn`, answering the readout, `request`'s clamp and `land`'s guard alike.
- Every figure reads through `limitsFor`; `null` is unlimited and returns early with no count issued. No tier name and no allowance figure appears as a literal in `apps/api`, `apps/web`, or a test.
- **Denominated in Practice Tests** everywhere, never in requests, generations or credits — the epic's hard copy rule.
- A refusal charges nothing. A request refused at cap writes no `generation_job`; a draft refused in `land()` rolls back its Practice Test, its questions, its choices, its topics and its `chargedAt` together, and leaves every previously landed draft of that job committed and charged.
- A job stopped by the cap **settles** — `PartiallyComplete` when drafts landed, `Failed` when none did — with a reason constant from `practice-test-policy.ts` and `retryable: false`. A retry would re-spend a provider call to reach the same refusal.
- The refusal reaches the parent verbatim. `apps/web` states no tier name, no limit figure and no reset date of its own.

**Block If:**
- The `land()` guard cannot take the account row lock without a lock-order inversion against a lock `land()`'s transaction already holds.

**Never:**
- Do not enforce Explanation (9.5), and do not build the Allowances surface or the reset machinery (9.6).
- Do not block or slow any other path: opening, reading, editing, releasing or discarding a draft, timer configuration, Extraction, attempts, grading. Only production of a new draft is capped.
- Do not reserve allowance for unsettled jobs, add a `requestedCount` ledger, or refuse a second concurrent job for one Source Test (DW-91's remaining half). Enforcing at the charge makes a reservation unnecessary.
- Do not let a job the cap stopped look like a provider failure: `GENERATION_FAILED` ("Try again") would be false.
- Do not weaken or delete an existing assertion to make a Free-tier fixture pass, and do not raise `MAX_PER_REQUEST` or any tier figure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Request at cap | Free account, 2 charged this period, valid Submitted upload | 409 naming the tier, `2 of 2` in Practice Tests, and the reset date; no `generation_job` row written | `ConflictException` from `generationAllowanceExhausted` |
| Request with headroom | Free account, 1 charged, asks for 5 | 201, `requestedCount` clamped to 1 | No error expected |
| Unlimited tier | `Internal` account, many charged, asks for 5 | 201 with 5; no count issued and no refusal sentence anywhere | No error expected |
| Tombstones count | Free account, 1 charged + a `Generation` tombstone of 1 in the window | 409 at cap — a deleted draft is not a refund | `ConflictException` |
| Previous period | Free account, 2 charged in the *previous* window | 201 — the window is half-open `[start, end)` | No error expected |
| Ordering | At cap **and** an unknown weighted Topic | `WEIGHTED_TOPIC_UNKNOWN` still wins — the existing order is unchanged | Existing `ConflictException` |
| Job stopped mid-run | Job requesting 2, account with 1 left (e.g. a second job already landed one) | Draft 1 lands and charges; draft 2 is refused; job ends `PartiallyComplete`, `retryable: false`, reason `GENERATION_ALLOWANCE_SPENT`; exactly 1 new charged row | `GenerationAllowanceSpent` via `fail` |
| Job stopped at once | Job whose account reached cap before its first draft | No Practice Test row; job ends `Failed`, `retryable: false`, same reason | `GenerationAllowanceSpent` |
| Racing requests | Two concurrent requests for one account with 1 left | Both may be accepted, but exactly one draft ever charges — the cap holds at the charge | `GenerationAllowanceSpent` on the loser's job |
| Allowance read at cap | Free account, 2 charged | The read carries `exhaustedReason` — the same sentence the 409 states | No error expected |
| Allowance read with headroom | Free account, 1 charged, or any `Internal` account | `exhaustedReason` is `null` | No error expected |
| Screen at cap | Generate screen, allowance read carries `exhaustedReason` | The count-reason node shows that sentence; every count stays visible and disabled | Screen states no tier, figure or date of its own |

</intent-contract>

## Code Map

- `apps/api/src/practicetest/practice-test.service.ts:3295-3400` (`land`) -- **the enforcement point.** Already re-reads `allowance.windowFor(job.parentAccountId, chargedAt)` per draft, throws `GenerationClockAnomaly` when the instant falls outside its own window, then opens `prisma.withTransaction` and writes `practiceTest.create({ …, chargedAt })` plus the question/choice/topic `createMany`s and the fenced `producedCount` increment. The allowance guard goes **inside that same transaction, before the `practiceTest.create`**, after the account row lock. The clock-anomaly check stays exactly where it is.
- `apps/api/src/practicetest/practice-test.service.ts:869-950` (`request`) -- the clamp. `consumptionFor` is read before the transaction; inside it, `tx.practiceTest.count({ where: { parentAccountId, chargedAt: { gte, lt } } })` is the **duplicate count** (DW-88) that becomes `allowance.generationUsedIn(…, tx)`; `clampCount(count, remainingFor(used, limit))` stays; `throw new ConflictException(NO_GENERATION_ALLOWANCE)` becomes the parameterised sentence. Its comment about deferred concurrent-request overspend is now wrong and must be rewritten. The refusal **order** (extraction-not-ready, no-usable-questions, unknown Topic, then allowance) is deliberate and unchanged.
- `apps/api/src/practicetest/practice-test.service.ts:166-173` (`GenerationAllowanceView`), `833-846` (`allowanceFor`) -- the read the screen loads. Gains `exhaustedReason: string | null`, built from the same policy function. `consumptionFor` already carries `tier`, `resetAt` and `timezone`.
- `apps/api/src/practicetest/practice-test.service.ts:88-127` -- `GenerationTargetMissing`, `GenerationFenced`, `GenerationClockAnomaly`: the three run-fault classes. `GenerationAllowanceSpent` joins them, modelled on `GenerationClockAnomaly` (message = the policy constant, `name` set).
- `apps/api/src/practicetest/practice-test.service.ts:3438-3510` (`fail`) -- the classification chain and the `failureReason` ternary. One branch each for the new class. Note `retryable: !clientFault && !refused && !clockAnomaly` — the new class must reach `retryable: false`.
- `apps/api/src/practicetest/practice-test.service.ts:3137-3164` (`runJob`) -- the `while (produced < job.requestedCount)` loop. `land`'s throw propagates to `fail(job, cause, produced)` with no change; `produced` is already what decides `PartiallyComplete` vs `Failed`.
- `apps/api/src/practicetest/practice-test-policy.ts:196-199` -- `NO_GENERATION_ALLOWANCE`, whose own doc says "Epic 9 owns the hard block; this is the refusal the clamp already implies". **Delete it**; the sentence moves to `allowance`. `GENERATION_ALLOWANCE_SPENT` (a new terminal `failureReason` constant, beside `GENERATION_CLOCK_ANOMALY` at ~line 300) is what the job row carries. `remainingFor(used, limit)` (~line 540) and `clampCount` are unchanged and still the only definition of "what is left".
- `apps/api/src/allowance/allowance-policy.ts:22-34` (`AllowanceRefusal`), `52-59` (`resetDateIn`), `62-86` (`uploadAllowanceExhausted`) -- the shape to mirror. Its own header already states the contract: siblings share `AllowanceRefusal`, the date rendering and the wording, and each keeps its own unit. `generationAllowanceExhausted` is the sibling, denominated in **practice tests**.
- `apps/api/src/allowance/allowance.service.ts:100-112` (`counters.generation`) -- the existing count, inline. Becomes a call to the new `generationUsedIn`, exactly as `counters.upload` already delegates to `uploadUsedIn`. `uploadUsedIn` (130-160) is the method to copy, including its `client ?? this.prisma` seam and its doc's correction that **the lock, not the transaction, is what makes the count trustworthy** under READ COMMITTED. `tombstonedIn` (176-200) is reused unchanged.
- `apps/api/src/allowance/tiers.ts` -- `limitsFor(tier).generation` (`Free` 2, `Plus` 20, `Family` 60, `Internal` `null`). Read-only; never restate a figure.
- `apps/api/src/allowance/period.ts` -- `PeriodWindow.end` **is** the reset instant; `PeriodWindow.timezone` is the zone it was cut in, already fallen back for an unrecognised zone.
- `apps/api/src/identity/parent-account.service.ts:132-151` -- `findByIdForUpdate(tx, id)`. Exported by `IdentityModule`, which `practice-test.module.ts:51` already imports. **Reuse; write no second lock idiom.**
- `apps/api/src/sourcetest/source-test.service.ts` (`submit`, the Story 9.3 guard) -- the golden example for the guard block; copy its shape, not a new one.
- `apps/api/src/practicetest/practice-test.module.ts:45-56` -- `IdentityModule` and `AllowanceModule` are both already imported; **no module change is needed**. Its doc comment says the dependencies "genuinely run one way" — still true, and the reason no `forwardRef` appears.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx:189-192` -- the local `messageFor`, which already returns `ParentApiError.reason` first, so the 409 sentence reaches the alert unchanged. `645-660` -- the `COUNT_REASON_ID` node rendering `parentCopy.generate.countUnavailable(allowance.remaining)`: this is where `exhaustedReason` takes precedence. `494-498` -- `countOptions` / `remainingAfter`, unchanged.
- `apps/web/src/copy/parent.ts:800-805` (`generate.countUnavailable`) -- its `remaining === 0` branch becomes unreachable and is **removed**; the 1-and-more branches stay. `generate.usage`, `generate.cost`, `generate.costUnlimited` already state Practice Tests and stay untouched.
- `apps/web/src/lib/parent-api.ts` -- `GenerationAllowanceView` (the web mirror of the API interface) gains `exhaustedReason: string | null`; `messageFor(status, fallback)` already puts a 409's sentence on `ParentApiError.reason`, which is what the screen reads.
- `apps/api/test/practice-test.int-spec.ts:890-960` -- the `runJob` cases, which drive the real runner against real Postgres. **Where the mid-run cap cases go.** `613` already documents a window fixture "that never includes now" for `land()`'s clock guard — the precedent for manipulating a window in a test.
- `apps/api/test/extraction.int-spec.ts`, `apps/api/test/page-image-expiry.int-spec.ts` -- the only other suites that run the generation runner, so the only other suites the `land()` guard can newly refuse.
- `apps/api/src/practicetest/practice-test.runner.spec.ts` -- unit-level runner cases; check whether any stub account now needs a tier or a mocked count.
- `apps/api/test/harness.ts:463-480` (`createParentAccount`, takes `tier`), `666-684` (`setAccountTier`), `690-721` (`createSignedInParent`, which signs up and therefore lands `Free`), `17` (`TIER_LIMITS` already imported) -- the headroom mechanism Stories 9.2/9.3 built. Reuse it; write no new tier figure.
- Suites seeding `practiceTest` rows with `chargedAt` (`analytics`, `mastery`, `weak-area`, `grade-dispute`, `student-mode`, `student-profile-deletion`, `parent-account*`, the `explanation*` family) -- a seeded charged row counts toward the cap exactly as a real one does. They are only at risk where they **also** run a job; treat the list as a starting map and the suite as the authority.
- `apps/api/src/allowance/allowance.service.spec.ts` -- already stubs `prisma.practiceTest.count` for `counters.generation`; add the `generationUsedIn` cases beside the `uploadUsedIn` ones.
- `apps/api/src/allowance/allowance-policy.spec.ts` -- the sentence's unit cover, including the "renders in the account's zone and not in UTC" and "unrecognised zone does not throw" cases. Mirror for Generation.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/allowance/allowance.service.ts` -- add `generationUsedIn(accountId, window, client?)`: charged Practice Tests in `[start, end)` plus `Generation` tombstones, over this module's own `PrismaService` or the caller's `TransactionClient`. Point `counters.generation` at it. One method, so the readout, the clamp and the cap can never disagree (closes DW-88).
- `apps/api/src/allowance/allowance-policy.ts` -- add `generationAllowanceExhausted(AllowanceRefusal)`: the sibling sentence, naming the Account Tier, `used` against `limit` **denominated in practice tests**, and the reset date through `resetDateIn`. Same wording and same date rendering as the Upload one; only the unit differs. Update the header comment: the file now holds two of the three.
- `apps/api/src/allowance/allowance-policy.spec.ts` -- mirror the Upload cases for Generation: it names the tier, both figures read from `TIER_LIMITS` (never a literal), the singular/plural unit, the reset date as the account's zone reads it and **not** as UTC reads it, no other figure, and an unrecognised zone still produces a sentence.
- `apps/api/src/practicetest/practice-test-policy.ts` -- delete `NO_GENERATION_ALLOWANCE` (its own doc already hands the hard block to Epic 9) and add `GENERATION_ALLOWANCE_SPENT`, the terminal `failureReason` written when the cap stopped a job mid-run. Its doc states why it is not `GENERATION_FAILED`: nothing about the upload or the provider was wrong, and "try again" would be false until the period turns over.
- `apps/api/src/practicetest/practice-test.service.ts` -- (1) inject `ParentAccountService`; (2) in `request`, replace the inline `tx.practiceTest.count` with `allowance.generationUsedIn(parentAccountId, window, tx)`, lock the account with `findByIdForUpdate` first so two concurrent requests serialize, and throw `ConflictException(generationAllowanceExhausted({ tier, used, limit, resetAt: window.end, timezone: window.timezone }))` when nothing remains — returning early with no count issued on an unlimited tier; (3) add `GenerationAllowanceSpent` beside `GenerationClockAnomaly`; (4) in `land`, inside the existing transaction and before `practiceTest.create`, lock the account, return early when `limitsFor(tier).generation` is `null`, otherwise count through `generationUsedIn(…, tx)` and throw `GenerationAllowanceSpent` when the count has reached the limit; (5) in `fail`, classify the new class as a client fault carrying `GENERATION_ALLOWANCE_SPENT` and `retryable: false`; (6) add `exhaustedReason` to `GenerationAllowanceView` and build it in `allowanceFor` — the same sentence, `null` whenever anything remains or the tier is unlimited; (7) rewrite the now-false comments in `request` (the deferred concurrent-overspend note) and on `land` (the cap is enforced there now).
- `apps/api/src/allowance/allowance.service.spec.ts` -- add the `generationUsedIn` cases beside the Upload ones: the full `where` asserted (account scope, `chargedAt` half-open on `[start, end)`), tombstones summed in, and the count issued on the client it is handed while the module's own Prisma doubles stay untouched.
- `apps/api/test/practice-test.int-spec.ts` -- add the I/O matrix's HTTP and runner cases: at-cap request refusal (message asserted against the exported sentence built from `limitsFor`, never a regex or a literal; no `generation_job` row written), headroom clamp, unlimited-tier repeat requests, a `Generation` tombstone pushing an account to cap, charges in the previous window not counting, unknown-Topic-before-allowance ordering, a job stopped mid-run (one draft charged, `PartiallyComplete`, `retryable: false`, reason asserted against the constant), a job stopped before its first draft (`Failed`, no Practice Test row), and two concurrent requests against the last slot leaving exactly one charged draft.
- `apps/api/test/practice-test.int-spec.ts`, `apps/api/test/extraction.int-spec.ts`, `apps/api/test/page-image-expiry.int-spec.ts`, `apps/api/src/practicetest/practice-test.runner.spec.ts` -- give every account that lands more drafts than its tier's Generation Allowance an explicit tier with headroom via `createSignedInParent`'s `tier` / `setAccountTier`. Change no assertion and weaken no cap; a spec that fails because its Free account wanted a third draft is the cap working.
- `apps/web/src/lib/parent-api.ts` -- add `exhaustedReason: string | null` to `GenerationAllowanceView` so the screen reads the API's sentence rather than composing one.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` -- render `allowance.exhaustedReason` in the `COUNT_REASON_ID` node when it is non-null, falling back to `parentCopy.generate.countUnavailable(allowance.remaining)` otherwise. Every count stays visible and disabled; nothing else on the screen moves.
- `apps/web/src/copy/parent.ts` -- remove `generate.countUnavailable`'s `remaining === 0` branch, now unreachable, and say in its doc that the at-cap sentence is the API's.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx` -- pin the at-cap render: an allowance fixture carrying an opaque sentinel `exhaustedReason` renders that sentence in the count-reason node, a `null` one renders the screen's own remaining-count sentence, and a refused start's 409 reason reaches the alert. The fixtures state no tier name, figure or date.

**Acceptance Criteria:**
- Given an account at its tier's Generation Allowance, when a parent requests generation over HTTP, then it is refused 409 with a sentence naming that tier, the usage against the limit in practice tests, and the reset date in the account's own zone — and no `generation_job` row is written.
- Given a running job whose account reaches the cap mid-run, when the next draft would land, then no Practice Test row, question, choice, topic or `chargedAt` is written for it, every draft that already landed stays committed and charged, and the job settles non-retryable with the cap's own reason rather than a provider-failure sentence.
- Given any period, when the account's consumption is read, then the number of charged Practice Tests inside it never exceeds `limitsFor(tier).generation` — whatever order requests, tabs, reclaimed job passes or period boundaries arrived in.
- Given the whole API suite, when it runs, then no generation figure and no tier name appears as a literal anywhere, every expected limit is read through `limitsFor`, the Generation usage query exists in exactly one place, and the cap is enforced in exactly one place.
- Given the generate screen for an account at cap, when it loads, then the reason it shows is the API's own sentence, every count is visible and disabled, and the web app contains no tier name, no limit figure and no reset date of its own.
- Given any student-scoped endpoint, when it answers, then no allowance figure, reset date or tier label appears in its response.

## Spec Change Log

## Review Triage Log

### 2026-09-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 3: (high 0, medium 3, low 0)
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[medium]` `[patch]` Deleting `NO_GENERATION_ALLOWANCE`'s web twin broke the one test that actually renders the at-cap reason node: `e2e/tests/parent-practice-test.spec.ts` still asserted the removed sentence, so it was red as committed and pinned nothing. It now captures the allowance response off the wire and asserts the node has exactly that response's `exhaustedReason`, first checking the payload carries all three facts — so an empty payload cannot pass by matching an empty node. `generate-usage` is derived from the same response instead of a `2 of 2` literal.
  - `[low]` `[patch]` `countUnavailable`'s `remaining === 0` branch was removed as unreachable, but `parentApi.generationAllowance` is an unchecked cast: a web build ahead of the API yields `undefined ?? countUnavailable(0)` and reads "Only 0 practice tests are left". The branch is restored as an explicit version-skew fallback — a plain sentence naming no tier, limit or date — and pinned by a case.
  - `[low]` `[patch]` `request`'s comment claimed `remainingFor`/`clampCount` were "the only definition of what is left" while `land` compares `used >= limit` directly. Reworded to what is true: one predicate written twice, each in its site's idiom, so both cap guards keep Story 9.3's `submit` shape.
  - `[low]` `[patch]` `clampCount`'s doc still said a non-positive ask "clamps to zero, which the caller refuses" after that throw was replaced by the pre-clamp cap refusal. It now names `RequestPracticeTestsDto` (`@IsInt()`, `@Min(1)`) as what refuses a non-positive count, and the zero as defence in depth for a call bypassing the DTO.
  - `[low]` `[patch]` The doc-comment sentence added to `identity/student-profile-policy.ts` left a run-on line past the file's comment width, which Prettier does not reflow. Hand-wrapped.

Notable rejections, all verified against the code before being dropped: the two allowance sentences being near-identical is the shape `allowance-policy.ts`'s own header mandates (each allowance keeps its builder, the siblings share the wording); "7 of 2 have been used" after a mid-period downgrade is factual and is the Upload sibling's accepted behaviour; taking the row lock before the unlimited-tier check and resolving the window before the transaction are both Story 9.3's reviewed idioms, corrected there for exactly these reasons; asserting screen rules over `PAGE_SOURCE` is this suite's documented no-DOM convention, not a shortcut taken here; the `toBe(2)` usage figures and `'Free'` selectors in the integration suite are fixture parameterisation, and every limit is still read through `limitsFor`; the historical `spec-4-2` / `spec-6-1` artifacts citing `NO_GENERATION_ALLOWANCE` are append-only records of what those stories shipped.

### 2026-09-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 1: (high 0, medium 0, low 1)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` The concurrent-requests int-spec case (`'lets two concurrent requests through, and still charges exactly one draft'`) asserted only that no job was left `Running`/`Queued`, never that the loser settled with the cap's own reason — the "Racing requests" matrix row's `GenerationAllowanceSpent` on the loser's job was unverified. It now selects `failureReason`/`failureKind`/`retryable` and, when a job settled `Failed`, asserts `GENERATION_ALLOWANCE_SPENT`, `ClientFault`, `retryable: false`.
  - `[low]` `[patch]` `request()` called `remainingFor(used, limit)` twice — once for the exhaustion throw, once for `clampCount` — where `allowanceFor()` a few lines above already extracts it once. Extracted to a single `remaining` local; the throw guard now reads `limit !== null && remaining === 0`.

Notable rejections, verified against the code before being dropped: `remainingFor` already clamps at zero (`Math.max(0, limit - used)`), so an over-drawn account cannot produce a negative `remaining` that would hide `exhaustedReason` — the strict `remaining === 0` check both reviewers flagged is correct as written; `ParentAccountService` is injected as a concrete class the same way Story 9.3's `SourceTestService.submit` already does, and `identity` does not import from `practicetest` or `sourcetest` (the dependency runs one way), so no circular-decorator risk exists; period windows (`period.ts`) are derived from the account's timezone history, not its tier, so a tier change mid-request cannot leave a stale reset date or window; the e2e's `toContain` assertions on `exhaustedReason` are a deliberate payload-shape check layered under the DOM-node `toHaveText` exact match, not a substitute for the int-spec's exact-match pin (recorded in the prior pass's own addressed finding); `generationAllowanceExhausted`/`uploadAllowanceExhausted` sharing a near-identical body rather than one parameterised helper is the shape `allowance-policy.ts`'s header mandates; the request-time lock at a second call site beyond `land()` is Design Notes' own "why the request-time lock is still worth taking," not an unauthorised scope expansion; a job-stopped-mid-run forward period-boundary case, a job stopped before its first draft, and generation not enforced against explanation/upload paths are already covered by this spec's own recorded items; updating the `deferred-work.md` ledger is the orchestrator's bookkeeping, not this pass's to touch; the remaining findings (a lock-order-inversion proof beyond the comment, branch-precedence isolation for `allowanceSpent`, the `student-profile-policy.ts` doc's phrasing, and the int-spec's `spend()` helper duplicating an earlier inline tombstone write) are all cosmetic or already-argued in code and not worth a loopback.

## Design Notes

**Why the cap moves to `land()` and the request clamp stays advisory.** The epic's rule is "charged on successful production of the artifact, never on request" and "the cap check and the artifact INSERT happen in the same transaction". For Upload those are the same statement, which is why Story 9.3's single guard was enough. Generation is asynchronous: one request produces 1–5 drafts, each its own transaction, minutes apart and possibly in a later period. A clamp at request time therefore cannot be the cap — it counts charges that have not happened yet and cannot know what another job will land in the meantime, which is exactly DW-87 and DW-92. Enforcing at the charge makes both true by construction and removes the need for a reservation ledger, which would reintroduce the counter column AD-14 forbids. The request clamp keeps its job: it is what stops a parent choosing 5 when 2 remain, and it is where the parent reads the sentence.

**Why the request-time lock is still worth taking.** It does not make the clamp a cap — nothing at request time can — but it serializes two concurrent requests for one account so both read the same post-lock count, which is what the epic means by "racing requests against a cap is an owned test case" at this surface. The honest guarantee is stated at the charge, and the concurrent-request test asserts the number of *charged drafts*, not the number of accepted requests.

**The guard, copied from Story 9.3's shape rather than reinvented:**

```ts
// inside land()'s existing withTransaction, before practiceTest.create:
const account = await this.accounts.findByIdForUpdate(tx, job.parentAccountId);
const limit = limitsFor(account.tier).generation;
if (limit !== null) {
  const used = await this.allowance.generationUsedIn(job.parentAccountId, window, tx);
  if (used >= limit) throw new GenerationAllowanceSpent();
}
```

`window` is the one `land()` already computed from `chargedAt`, so the count and the charge are measured against the same period — the fix Story 9.3's review pass made for the boundary-crossing commit, and the reason a job spanning a rollover is now checked against the window it is actually landing in. Under READ COMMITTED the transaction alone proves nothing; `FOR UPDATE` on the account is what keeps another draft for the same account from committing between the count and the create.

**Why the stopped job is a client fault and not an upstream one.** `fail`'s two-value `AiFailureKind` asks whose fault it was. The provider answered correctly and this machine's clock is fine; the account simply may not have another draft. That is the requester's condition, which also gives `retryable: false` through the existing expression rather than a fourth exception to it — and it keeps the "something this module did not anticipate" logger quiet for a state the module fully anticipates. It is deliberately **not** `GENERATION_INPUT_UNUSABLE`: nothing about the upload needs changing, and asking a parent to retake pages would send them to do work that cannot help.

**Why the at-cap sentence rides the allowance read.** A parent at cap cannot fire the request, so they would never see the 409 — the screen would show its own sentence naming neither tier nor reset date, and the AC would be satisfied only on a path nobody walks. Handing the same builder's output down on `allowanceFor` keeps the rule Story 9.3 set: one sentence, one builder, and `apps/web` owning no tier name, figure or date. The screen's remaining-count sentence stays for 1–4 left, where it is describing disabled options rather than a block.

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass with fixture tiers raised where the `land()` guard newly bites. Needs Postgres (`pnpm db:up`). A pre-existing intermittent cross-file failure in the integration tier is a known baseline flake (DW-89), not this story's.
- `pnpm --filter web test` -- expected: the generate-screen specs pass, including the at-cap render cases.
- `pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --check .` -- expected: no unformatted files. (`pnpm lint` is known-broken repo-wide: `Command "eslint" not found`.)

**Manual checks (if no CLI):**
- Grep the repo for `NO_GENERATION_ALLOWANCE` and for a second `practiceTest.count` over `chargedAt`: both must be gone, leaving one usage query and one refusal sentence.

## Auto Run Result

**Summary:** Story 9.4 (Generation Allowance Enforcement) was already implemented and committed (`85bd949`) at story start; this run's own work was a fresh review pass over that diff plus two small patches it surfaced.

**Files changed (this pass):**
- `apps/api/src/practicetest/practice-test.service.ts` -- `request()`'s duplicate `remainingFor(used, limit)` call collapsed into one `remaining` local.
- `apps/api/test/practice-test.int-spec.ts` -- the "lets two concurrent requests through" case now asserts the loser settles with `GENERATION_ALLOWANCE_SPENT`, `ClientFault`, `retryable: false` rather than only that no job is left `Running`/`Queued`.
- `_bmad-output/implementation-artifacts/spec-9-4-generation-allowance-enforcement.md` -- this review pass's triage log entry and one new deferred item.

**Review findings breakdown:** patch 2 (medium 1, low 1), defer 1 (low), reject 12 (low), intent_gap 0, bad_spec 0.

**Follow-up review recommendation:** `false`. This pass's patched findings: high 0, medium 1, low 1. Score `3×1 + 1×1 = 4`, below the 5 threshold, and no high-severity patch.

**Verification performed:**
- `pnpm typecheck` -- clean.
- `pnpm exec prettier --check .` -- all matched files formatted.
- `pnpm --filter web test` -- 68 files, 1439 tests, all passed.
- `pnpm --filter api test -- practice-test.int-spec.ts` (full suite) run twice: 7 failures each time, in different, unrelated files/tests both runs (page-image-expiry, source-test, or an unrelated practice-test timer-configuration case) — non-deterministic 404s consistent with the known baseline flake this spec's own Verification section already documents (DW-89). Neither run's failures touched the new or edited allowance/racing-request assertions.
- `apps/api/test/practice-test.int-spec.ts` run in isolation twice: 1 failure then 3 failures, again in unrelated cases each time, confirming the flake and not a regression from this pass's patches.
- Grep for `NO_GENERATION_ALLOWANCE` and a second `chargedAt`-scoped `practiceTest.count`: neither present.

**Residual risks:**
- The pre-existing cross-file integration flake (DW-89) remains unresolved and unrelated to this story.
- One new low-severity item deferred: the topic drill-down screen does not yet read `allowance.exhaustedReason`, so it and the generate screen now state different levels of detail for the same at-cap fact (out of this story's scope; recorded in frontmatter `deferred`).
- `_bmad-output/implementation-artifacts/deferred-work.md` and `_bmad-output/implementation-artifacts/sprint-status.yaml` remain modified in the working copy at HALT. Both predate this run's own changes, are orchestrator-owned bookkeeping per this run's invocation instructions, and were left untouched and uncommitted by design.

