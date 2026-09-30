---
title: 'Story 9.5: Explanation Allowance Enforcement'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_revision: '0117f378b836d2cb20f449c2ea934a247f383338'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The charging transaction now holds a `parent_account` row lock but passes no
      `timeout`/`maxWait`, so a contended press can abort on Prisma's 2s default
      lock wait and answer a child a 500 instead of the cap's own 409.
    evidence: |-
      `prisma.withTransaction` forwards `{ timeout, maxWait }` and the generation
      runner's `land()` passes `LAND_TIMEOUT_MS` / `LAND_MAX_WAIT_MS`
      (practice-test.service.ts:3521). Neither Story 9.3's `SourceTestService.submit`
      guard nor this one passes any, so both run on Prisma's defaults (maxWait 2s,
      timeout 5s) while holding `FOR UPDATE` on the account. Not introduced here in
      isolation — it is the sanctioned sibling idiom — so giving only the Explanation
      site a timeout would create the second idiom the spec forbids. Both sites want
      one decision.
    location: >-
      apps/api/src/explanation/explanation.service.ts (explanationFor's charging
      transaction); apps/api/src/sourcetest/source-test.service.ts (submit)
    severity: medium
  - summary: >-
      The counting window is resolved before the transaction opens, so a timezone
      history row written between the resolve and the lock makes the cap count a
      stale window.
    evidence: |-
      `allowance.windowFor(parentAccountId, chargedAt)` runs outside
      `withTransaction`; only the tier is re-read off the locked row. A zone change
      committed in that gap moves the window's edges, and the count inside the
      transaction is then measured over the pre-change window. Extremely narrow — a
      zone change lands from the next boundary onward by design — and the same shape
      the sibling guards carry.
    location: >-
      apps/api/src/explanation/explanation.service.ts (explanationFor)
    severity: low
  - summary: >-
      `chargedAt` is captured before the lock wait, so a press that blocks stamps a
      charging instant earlier than the instant it actually committed.
    evidence: |-
      One instant is deliberately shared by the window derivation and the row stamp,
      which is what makes the count and the charge agree. The cost is that a long
      lock wait can commit a row stamped in a period earlier than the commit — at a
      period boundary, into the period the count measured rather than the one the
      write landed in. Defensible as the design, but unpinned: the new assertion that
      a written `chargedAt` falls inside the account's window cannot fail against a
      second clock read, because a test cannot stage a press that straddles a month
      boundary.
    location: >-
      apps/api/src/explanation/explanation.service.ts (explanationFor)
    severity: low
  - summary: >-
      The int-spec's `atCap()` helper recomputes the account's window after the
      response, so a period turning over between the two makes the expected sentence
      disagree with the one the API built.
    evidence: |-
      `atCap(parentAccountId)` reads `h.allowance.windowFor(...)` at assertion time,
      not at request time. A suite run crossing a month boundary in that gap would
      render a different reset date. Narrow, and the same shape the pre-existing cases
      carry.
    location: >-
      apps/api/test/explanation.int-spec.ts (atCap)
    severity: low
  - summary: >-
      The `extraQuestion` fixture appends Questions to a Practice Test without
      updating its stored `questionCount`, so the row and the paper disagree.
    evidence: |-
      `sat()` writes `questionCount` at creation; `extraQuestion` adds rows past it.
      The grading-at-cap case works around the drift by counting live rows instead of
      reading `questionCount`, which is exactly the shape that would hide a real
      defect in a future case that trusts the column.
    location: >-
      apps/api/test/explanation.int-spec.ts (extraQuestion)
    severity: low
  - summary: >-
      The composed at-cap text a child reads mixes two nouns for one thing and two
      date dialects.
    evidence: |-
      The panel renders `This account allows 10 explanations … resets on October 1,
      2026.` (the API's sentence, `en-US` through `resetDateIn`) followed by the web's
      `That is about the plan, not about you …`. `allowance-policy.ts` states as
      policy that "plan" is a word this product uses nowhere else, while student copy
      uses it deliberately, and student copy elsewhere renders dates as
      `28 September 2026`. Neither is wrong; together they read as two voices.
    location: >-
      apps/api/src/allowance/allowance-policy.ts (resetDateIn);
      apps/web/src/copy/student.ts (results.explain.atCap)
    severity: low
  - summary: >-
      The integration-level no-billing-fact guard checks fewer patterns than its
      unit-level counterpart, so a leak the unit spec would catch could pass the
      boundary check.
    evidence: |-
      `allowance-policy.spec.ts`'s assertions on `explanationSentence()` also check
      for the literal words "Account Tier" and `/\bplans?\b/iu`.
      `explanation.int-spec.ts`'s `carriesNoBillingFact`, which runs against the
      body that actually crossed the wire, checks only the four tier names and
      usage/cost patterns — it would not catch a hypothetical future build of the
      sentence that named "Account Tier" or "plan" without also naming a tier.
    location: >-
      apps/api/test/explanation.int-spec.ts (carriesNoBillingFact)
    severity: low
  - summary: >-
      The new concurrency case synchronizes two presses with a hand-rolled
      Promise barrier that has no timeout, so a regression that changes how many
      times the barrier's hook fires can hang the suite instead of failing it.
    evidence: |-
      `lets exactly one of two concurrent presses take the last unit` releases a
      barrier from inside the `ai.run` mock with no `Promise.race` against a
      timeout. If the implementation ever called `ai.run` a different number of
      times than the test expects, or a request errored before reaching the
      release, the awaited barrier would never resolve.
    location: >-
      apps/api/test/explanation.int-spec.ts (lets exactly one of two concurrent
      presses take the last unit)
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Explanation Allowance is checked but not enforced. `ExplanationService.explanationFor` counts charged rows twice — once through `consumptionFor` before the provider call and once inline inside the write transaction — and the in-transaction count takes **no account row lock**, so under READ COMMITTED two presses for two different Questions read the same pre-charge usage and both charge (the gap that method's own comment records as deferred, and that Stories 9.3/9.4 closed at their own charge sites). The inline `tx.explanation.count` is also a second implementation of the Explanation window query that `AllowanceService.counters.explanation` already owns, so the number a surface shows and the number a child is refused at agree only by two code paths matching today. And the refusal itself, `NO_EXPLANATION_ALLOWANCE`, names neither the limit nor the reset date, so the hard block does not state the facts Epic 9 requires of it.

**Approach:** Give the Explanation charge the same guard shape Stories 9.3 and 9.4 gave Upload and Generation: extract `explanationUsedIn` into `AllowanceService` as the one Explanation window query, take `ParentAccountService.findByIdForUpdate` inside the transaction that writes the row, and count through that one method behind the lock. Move the refusal sentence to `allowance-policy.ts` as the third sibling — but denominated for a **child**: it names the limit and the reset date in the account's own zone and never the Account Tier and never a usage count, because this is the only allowance refusal a student-scoped endpoint answers with.

## Boundaries & Constraints

**Always:**
- The cap check and the `explanation` INSERT share **one** transaction, serialized by `ParentAccountService.findByIdForUpdate` on `parent_account` — the identical row lock Stories 9.2, 9.3, 9.4 and the Admin tier change take. No second lock idiom and no application-level clamp standing in for it.
- Exactly **one** Explanation window query exists in the repo, on `AllowanceService`, reading `chargedAt` half-open over `[window.start, window.end)` plus `Explanation` tombstones. Every reader — the consumption readout, the pre-call check and the cap at the charge — goes through it.
- The window the count is measured over is re-resolved from the charging instant **after** the provider call, so a press that spans a period rollover is counted against the period it charges into.
- A cache hit, a suppressed Question, a failed generation and Story 6.4's free post-suppression regeneration charge nothing and read no allowance. The free regeneration writes `chargedAt: null` and stays that way at every tier including Free.
- The refusal sentence is built in exactly one place, in `allowance-policy.ts`, from `limitsFor` figures and the window's own `end`/`timezone`. `apps/web` restates no figure, no date and no limit of its own; `studentCopy.results.explain.atCap` keeps taking the API's sentence whole.
- AI grading stays reachable at cap: nothing in `grading` reads an allowance, and reading an already-generated Explanation stays a 200 with no allowance read at any usage level.
- Usage stays derived (AD-14): no counter column, no period column, no reset job, no decrement, no refund.

**Block If:**
- The intent would require a student-scoped response to carry the Account Tier or a usage count. It must not: the epic's UX rule ("the only allowance figure a student ever sees: a plain statement naming the limit and the reset date") and AD-20/AD-26 both select against it, and the resolution is recorded in Design Notes rather than escalated.

**Never:**
- Never build the Allowances surface, the Analytics Explanation readout, or the atomic-reset work — that is Story 9.6.
- Never refund a suppressed, deleted or disputed Explanation (DW-224, DW-199 stay open and out of scope).
- Never restate a tier figure: every expected limit in production code, copy and tests reads through `limitsFor` / `TIER_LIMITS`.
- Never introduce a reservation ledger, a counter column or a second refusal sentence at a second throw site.
- Never widen the student response shape: no cost, model, tier or allowance figure joins `StudentExplanationResponse`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First press with headroom | Free account, 3 charged rows this period | 201, prose returned, one row written with `chargedAt` set | No error expected |
| Press at cap | Free account, `TIER_LIMITS.Free.explanation` charged rows this period | 409 carrying the sentence naming the limit and the reset date in the account's zone; **no provider call**, no row written | `ConflictException` from the pre-call check |
| Cap reached during the provider call | Headroom at press time, another press charges the last slot mid-call | 409 with the same sentence; no row written and the written prose dropped | `ConflictException` from the in-transaction check behind the lock |
| Two presses, two Questions, one slot left | Free account at `limit - 1`, two concurrent presses | Exactly one row charged; the loser gets the 409 sentence | Lock serializes; loser refused, never a 500 |
| Re-read at cap | Account at cap, Question already has a live Explanation | 200 with the stored prose, no allowance read, no provider call | No error expected |
| Free regeneration at cap | Account at cap, parent regenerates a suppressed Explanation | 200/201 with the replacement; row written with `chargedAt: null`; charged count unchanged | No error expected |
| Unlimited tier | Plus/Family/Internal account, thousands of rows | Every press generates; the row lock is taken, **no count is issued** | No error expected |
| Tombstone pushes to cap | Free account, charged rows + `Explanation` tombstones summing to the limit | 409 sentence; nothing generated | `ConflictException` |
| Previous period's charges | Free account with `limit` rows charged before `window.start` | Press succeeds; last period's rows are not counted | No error expected |
| Grading at cap | Account at cap, student submits an Attempt | Graded normally; every grade state reachable | No error expected |
| Unrecognised account timezone | Stored zone the platform does not know | Sentence still renders, through `PeriodWindow.timezone`'s fallback | Never a 500 |

</intent-contract>

## Code Map

- `apps/api/src/explanation/explanation.service.ts:279-470` (`explanationFor`) -- **the enforcement point.** Order today: `explanationInputFor` (ownership) → cache `findFirst` → suppressed arm (200, before any allowance read — this is what makes "a suppressed Question is free" a property of the code and must stay first) → cached arm → `consumptionFor` pre-check → empty-prompt refusal → `this.write(...)` (the provider call) → second `consumptionFor` → `prisma.withTransaction` with the inline `tx.explanation.count` at **385** and `explanation.create({ …, chargedAt: new Date() })` at **407** → the `isUniqueViolation` recovery arm. The guard goes inside that same transaction, before the `create`, after the account row lock. The unique-violation recovery arm is untouched.
- `apps/api/src/explanation/explanation.service.ts:336-346` -- the pre-call check. `consumptionFor` counts **all three** allowances to read one; replace with `accounts.findById` for the tier + `allowance.windowFor` + `allowance.explanationUsedIn`, returning early with no count on an unlimited tier. That also closes DW-202 at this site. `remainingFor` (imported from `practice-test-policy`) is then no longer needed here if the comparison becomes `used >= limit`; keep the import only if still used elsewhere in the file.
- `apps/api/src/explanation/explanation.service.ts:363-373` -- the second `consumptionFor` and the `windowStart`/`windowEnd`/`limit` locals it derives. Becomes `allowance.windowFor(parentAccountId, chargedAt)` re-read after the provider call (the `land()` precedent), with the tier read from the locked row instead. Its comment about why it re-reads stays true and stays.
- `apps/api/src/explanation/explanation.service.ts:376-390` -- the inline count and its comment stating the READ COMMITTED gap as "narrows the window rather than closing it". The comment is **now false** and must be rewritten: the lock closes it.
- `apps/api/src/explanation/explanation.service.ts:260-265` -- the constructor. Inject `ParentAccountService`; `ExplanationModule` already imports `IdentityModule`, which exports it, so **no module change is needed**.
- `apps/api/src/explanation/explanation.service.ts:1221-1305` (`regenerateExplanation`) -- Story 6.4's free path. `chargedAt: null`, no allowance read: **already correct, change nothing.** Its comment ("The whole of 'free'") is the AC's own statement; the work owed is a test that proves it at cap.
- `apps/api/src/allowance/allowance.service.ts:104-122` (`counters.explanation`) -- the existing count, **inline**, with the window rule restated in its comment. Becomes a call to a new `explanationUsedIn`, exactly as `counters.upload` and `counters.generation` already delegate. `generationUsedIn` (205-217) is the method to copy verbatim in shape, including the `client ?? this.prisma` seam and the doc note that **the lock, not the transaction, is what makes the count trustworthy** under READ COMMITTED. `tombstonedIn` (240-255) is reused unchanged with `'Explanation'`.
- `apps/api/src/allowance/allowance-policy.ts:23-36` (`AllowanceRefusal`), `52-60` (`resetDateIn`), `74-86` / `104-116` (the Upload and Generation sentences) -- the shape to mirror. The Explanation sibling takes **`Omit<AllowanceRefusal, 'tier' | 'used'>`**: a child reads it, so the tier and the usage figure are both absent. `resetDateIn` is reused unchanged — it is already fallen back for an unrecognised zone. The file header (lines 4-21) must be updated: it now holds all three, and it must state why one of them names no tier.
- `apps/api/src/explanation/explanation-policy.ts:16-30` -- `NO_EXPLANATION_ALLOWANCE`, whose own doc already says the web renders the reset instant and this sentence therefore does not. **Delete it**; the sentence moves to `allowance`, exactly as `NO_GENERATION_ALLOWANCE` did in Story 9.4. `EXPLANATION_FAILED`, `MAX_EXPLANATION_LENGTH` and the rest of the file stay.
- `apps/api/src/allowance/tiers.ts:21-28` -- `limitsFor(tier).explanation` (`Free` 10, `Plus`/`Family`/`Internal` `null`). Read-only; never restate a figure.
- `apps/api/src/allowance/period.ts` -- `PeriodWindow.end` **is** the reset instant; `PeriodWindow.timezone` is the zone it was cut in, already fallen back.
- `apps/api/src/identity/parent-account.service.ts:141-151` (`findByIdForUpdate`) and `identity.module.ts:71` (exports `ParentAccountService`). **Reuse; write no second lock idiom.**
- `apps/api/src/sourcetest/source-test.service.ts:860-900` (`submit`, the Story 9.3 guard) -- the golden example. Copy its shape: lock, `limitsFor(...)`, early return on `null`, count through `allowance`, throw the policy sentence.
- `apps/api/src/explanation/explanation-payload.spec.ts:104-128` -- the cap-arithmetic block plus the `NO_EXPLANATION_ALLOWANCE` wording case. The wording case **moves** to `allowance-policy.spec.ts`; the `remainingFor` arithmetic cases stay here.
- `apps/api/src/allowance/allowance-policy.spec.ts` -- the Upload/Generation sentence cases to mirror, including "renders in the account's zone and not in UTC" and "an unrecognised zone does not throw".
- `apps/api/src/allowance/allowance.service.spec.ts` -- already stubs `prisma.explanation.count` for `counters.explanation`; add the `explanationUsedIn` cases beside the `uploadUsedIn`/`generationUsedIn` ones.
- `apps/api/test/explanation.int-spec.ts:4` (imports `NO_EXPLANATION_ALLOWANCE`), `:319` (the at-cap refusal, which already asserts the re-read stays 200 and `explanationCalls() === 0`), `:561` (the mid-call cap case, which already forces a concurrent charge from inside the fake provider). Both assertions repoint at the new sentence built from `TIER_LIMITS`. This suite is where the new cases go.
- `apps/api/test/explanation-suppression.int-spec.ts` -- Story 6.4's suite; **where the "free regeneration at cap" case belongs**, since the suppression fixtures live here.
- `apps/api/test/harness.ts` -- `createParentAccount` / `createSignedInParent` (take `tier`), `setAccountTier`, and `TIER_LIMITS` already imported: the headroom mechanism Stories 9.2-9.4 built. Reuse it; write no new tier figure.
- `apps/api/src/explanation/explanation.service.spec.ts` **does not exist** — this service is covered at the integration tier only. Do not create one; put behavioural cover in the int-specs.
- `apps/web/src/lib/explain-panel.ts:11-41` (`ExplainState`'s `atCap` arm carrying `limitSentence: string | null`) and `apps/web/src/app/student/_components/ExplainPanel.tsx:207` (`setState({ kind: 'atCap', limitSentence: cause.reason })`), `:634` (`studentCopy.results.explain.atCap(state.limitSentence)`) -- the web already renders the API's sentence whole. **No behavioural web change is needed.**
- `apps/web/src/copy/student.ts:378-457` -- the `explain` group. `atCap` is correct and stays. Its group doc (lines 385-390) claims the refusal "says the plan ran out rather than how far" and that the one sentence mentioning the limit "says no number" — now false and must be corrected: the API's sentence names the limit and the reset date; what stays forbidden is a **usage count**.
- `apps/web/src/app/student/_components/ExplainPanel.spec.tsx:367-420` -- the copy-discipline block. Line 377 hands `atCap` a stale copy of the old API sentence; make it an opaque sentinel so no web test carries the API's words. The `/\d+\s*(of|\/)\s*\d+|\bleft\b.*\d|remaining/` guard and the tier-name guard both still hold for the web's own sentences and must keep holding.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/allowance/allowance.service.ts` -- add `explanationUsedIn(accountId, window, client?)`: charged `explanation` rows in `[start, end)` plus `Explanation` tombstones, over this module's own `PrismaService` or the caller's `TransactionClient`. Point `counters.explanation` at it. One method, so the readout, the pre-call check and the cap can never disagree.
- `apps/api/src/allowance/allowance-policy.ts` -- add `explanationAllowanceExhausted({ limit, resetAt, timezone })`, the third sibling: it names the limit and the reset date through `resetDateIn`, and **never** the Account Tier and never a usage figure, because a child reads it. Same date rendering as its siblings. Update the file header: it holds all three now, and it states why one of them is shaped differently.
- `apps/api/src/allowance/allowance-policy.spec.ts` -- mirror the sibling cases for Explanation, and take over the wording case moved out of `explanation-payload.spec.ts`: it names the limit read from `TIER_LIMITS` (never a literal), carries no tier name, no `used`-style figure, no upsell and no exclamation mark, renders the reset date as the account's zone reads it and **not** as UTC reads it, singular and plural agree, and an unrecognised zone still produces a sentence.
- `apps/api/src/explanation/explanation-policy.ts` -- delete `NO_EXPLANATION_ALLOWANCE` and its doc block; state in the file header that the allowance refusal is `allowance`'s, the way this file already defers `PRACTICE_TEST_NOT_FOUND` to `practicetest`. Nothing else in the file moves.
- `apps/api/src/explanation/explanation.service.ts` -- (1) inject `ParentAccountService`; (2) replace the pre-call `consumptionFor` check with a tier read + `allowance.windowFor` + `allowance.explanationUsedIn`, returning early with no count on an unlimited tier and throwing `ConflictException(explanationAllowanceExhausted(...))` otherwise; (3) after the provider call, re-resolve the window from the charging instant via `allowance.windowFor` instead of the second `consumptionFor`; (4) inside the existing `withTransaction`, before `explanation.create`, take `accounts.findByIdForUpdate(tx, parentAccountId)`, return early when `limitsFor(account.tier).explanation` is `null`, otherwise count through `explanationUsedIn(…, tx)` and throw the same sentence when `used >= limit`; (5) rewrite the now-false READ COMMITTED comment — the lock closes the gap — and the constructor/class doc where it describes the allowance read.
- `apps/api/src/explanation/explanation-payload.spec.ts` -- drop the `NO_EXPLANATION_ALLOWANCE` import and its wording case (moved to `allowance-policy.spec.ts`); keep the `remainingFor` cap-arithmetic cases unchanged.
- `apps/api/src/allowance/allowance.service.spec.ts` -- add the `explanationUsedIn` cases beside the sibling ones: the full `where` asserted (account scope, `chargedAt` half-open on `[start, end)`), `Explanation` tombstones summed in, and the count issued on the client it is handed while the module's own Prisma doubles stay untouched.
- `apps/api/test/explanation.int-spec.ts` -- repoint the two existing refusal assertions at the new sentence built from `TIER_LIMITS` (never a regex or a literal), and add the matrix's remaining cases: an `Explanation` tombstone pushing an account to cap, charges in the previous window not counting, an unlimited-tier account generating well past `Free`'s figure, two concurrent presses on two different Questions against the last slot leaving exactly one charged row and refusing the loser with the sentence, and an at-cap account still submitting an Attempt and receiving grades.
- `apps/api/test/explanation-suppression.int-spec.ts` -- add the free-regeneration-at-cap case: an account at its Explanation Allowance, a suppressed Explanation, a parent regeneration that succeeds, writes `chargedAt: null`, and leaves the charged count exactly where it was.
- `apps/api/test/explanation.int-spec.ts`, `apps/api/test/explanation-suppression.int-spec.ts`, `apps/api/test/student-explanation-flag.int-spec.ts`, `apps/api/test/parent-explanation-review.int-spec.ts` -- give any account that charges more Explanations than its tier allows an explicit tier with headroom via `createSignedInParent`'s `tier` / `setAccountTier`. Change no assertion and weaken no cap; a spec that fails because its Free account wanted an eleventh Explanation is the cap working.
- `apps/web/src/copy/student.ts` -- correct the `explain` group doc: the API's at-cap sentence now names the limit and the reset date, and what this module still never shows is a **usage count**, a badge or a running total. `atCap` itself is unchanged.
- `apps/web/src/app/student/_components/ExplainPanel.spec.tsx` -- replace the stale copy of the API sentence in the copy-discipline fixture with an opaque sentinel, so no web test carries the API's words, and keep both existing guards passing.

**Acceptance Criteria:**
- Given an account at its tier's Explanation Allowance, when a child presses for a new Explanation, then it is refused 409 with a sentence naming the limit and the reset date in the account's own zone, no provider call is made and no row is written — while re-reading any already-generated Explanation for that account still answers 200 with its prose and reads no allowance.
- Given any period, when the account's Explanation consumption is read, then the number of charged `explanation` rows inside it never exceeds `limitsFor(tier).explanation`, whatever order presses, tabs, cache misses or period boundaries arrived in.
- Given an account at cap, when a parent takes Story 6.4's free regeneration after a suppression, then the replacement is written with no `chargedAt`, the charged count is unchanged, and the path reads no allowance at any tier including Free.
- Given any allowance state, when a student submits an Attempt, then grading runs and every grade state stays reachable — no allowance is read on that path.
- Given the whole API suite, when it runs, then no Explanation limit figure and no tier name appears as a literal anywhere, every expected limit is read through `limitsFor` / `TIER_LIMITS`, the Explanation usage query exists in exactly one place, and the refusal sentence is built in exactly one place.
- Given any student-scoped response, when it answers, then it carries no Account Tier, no usage count and no cost figure — only the refusal's limit and reset date.

## Spec Change Log

## Review Triage Log

### 2026-09-30 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 6: (high 0, medium 1, low 5)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` The concurrency case's assertions could not distinguish the new row lock from the advisory pre-call check — plain `Promise.all` does not overlap the two charging transactions, so deleting the lock left the case green even after adding `explanationCalls() === 2`. A barrier on `ai.run` now holds the first press inside its provider call until the second reaches it, so both enter the transaction together; mutation-verified to fail as `[201, 201]` with the lock removed. The loser is also asserted to have written no row at all.
  - `[medium]` `[patch]` The tier re-read off the locked row was claimed in a comment and exercised by nothing — substituting the pre-call limit passed the whole suite. Added a case that downgrades an unlimited account to `Free` past the Free ceiling from inside the `ai.run` hook, so only the locked row's tier can produce the refusal; mutation-verified.
  - `[medium]` `[patch]` Nothing related a written row's `chargedAt` to the window its cap was counted over. The first-press case now asserts the stamp falls inside `[start, end)` of the account's own window. Weaker than intended and recorded as a deferred item: a test cannot stage a press that straddles a month boundary, so it does not fail against a second clock read at insert time.
  - `[medium]` `[patch]` The 409 assertions compared the body against the builder's own output, so a leak in the builder was untestable at the boundary where AD-20/AD-26 is promised. Added `carriesNoBillingFact`, applied to the at-cap and mid-call-downgrade refusals: no tier name, no `N of N`, no `left`/`remaining`, no cost, price or upgrade.
  - `[low]` `[patch]` The grading-at-cap case asserted only `state` truthy and `score` defined. Now asserts `Correct` for the answered Question, `Unanswered` for every other, and the concrete score object.
  - `[low]` `[patch]` Two Explanation policy cases were coupled to the reset-date fixture's digits (`split(limit).toHaveLength(2)`, a hard-coded `['1', '2026']`), so a recalibrated limit or an October 10 reset date would fail with no defect present. Replaced with direct absence-of-usage-clause assertions plus positive checks that the same patterns do fire on the Upload sibling; the date figures are now derived from `RESET_AT`.
  - `[low]` `[patch]` Replacing the web fixture's real sentence with a sentinel removed the only assertion that `atCap` hands the API's sentence through whole. Added a case pinning the passthrough and both wrapper clauses.
  - `[low]` `[patch]` The new `charge()` / `extraQuestion()` helpers were added without retiring the four hand-rolled filler loops they replace. All routed through the helpers, and ordinal allocation moved to a file-level monotonic counter so two `charge()` calls cannot clash.
  - `[low]` `[patch]` Stale prose: the mid-call case still explained itself by "the re-count shares a transaction with the insert" (the rationale the lock replaced); `explanation-payload.spec.ts` kept a title and three `remainingFor` cases for a helper this module's paths no longer call (dropped — `practice-test-policy.spec.ts` and `tiers.spec.ts` already cover both halves); `student-profile-policy.ts` had a ragged rewrap.

### 2026-09-30 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2: (high 0, medium 0, low 2)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - none

## Design Notes

**Why the student's sentence names the limit and the reset date but not the tier or the usage.** Story 9.5's acceptance criterion in `epics.md` says "a message naming the tier, usage, and reset date", which is the epic's generic block rule written once for all three allowances. Two narrower rules in the same epic select against applying it literally here: the technical decision "no allowance counter, cost figure, or tier label is ever reachable from a student-scoped endpoint", and the UX rule "the Explanation at-cap state is the only allowance figure a student ever sees: **a plain statement naming the limit and the reset date**, blaming the plan and never the child". The Explanation press is student-scoped and is the only paid Explanation path, so the specific rule governs: limit and reset date, no tier, no count. The tier-naming version of the sentence is the parent's, and it arrives with the Allowances surface in Story 9.6. This is a resolution, not an open question — hence `Omit<AllowanceRefusal, 'tier' | 'used'>` rather than a second `AllowanceRefusal`.

**The guard, copied from Story 9.3's shape rather than reinvented:**

```ts
// inside explanationFor's existing withTransaction, before explanation.create:
const account = await this.accounts.findByIdForUpdate(tx, scope.parentAccountId);
const limit = limitsFor(account.tier).explanation;
if (limit !== null) {
  const used = await this.allowance.explanationUsedIn(scope.parentAccountId, window, tx);
  if (used >= limit) throw new ConflictException(explanationAllowanceExhausted({ limit, resetAt: window.end, timezone: window.timezone }));
}
```

`window` is re-resolved from the charging instant after the provider call, so a press that started in one period and lands in the next is counted against the period it charges into — the same fix Story 9.4 made for `land()`. Under READ COMMITTED the transaction alone proves nothing; `FOR UPDATE` on the account is what keeps another Explanation for the same account from committing between the count and the create, and it is why the pre-call check is advisory however carefully it counts.

**Why the pre-call check survives.** It spends nothing and saves a provider call: refusing after generating prose nobody will be given is paying for the artifact this story exists to cap. It also reaches the parent's own wallet faster than the transaction does. The honest guarantee is still stated at the charge, and the tier read it now does replaces `consumptionFor` — which counted Upload and Generation too, to answer one question.

**Why the refused mid-call press is a 409 and not a 500.** Nothing failed: the account simply may not have another Explanation. The written body is dropped rather than stored uncharged, because an Explanation with no `chargedAt` means exactly one thing in this schema — Story 6.4's free replacement — and a second meaning for that null would make the counter's own predicate ambiguous.

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass, with fixture tiers raised where the new guard newly bites. Needs Postgres (`pnpm db:up`). A pre-existing intermittent cross-file failure in the integration tier is a known baseline flake (DW-89), not this story's.
- `pnpm --filter web test` -- expected: the explain-panel and copy specs pass.
- `pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --check .` -- expected: no unformatted files. (`pnpm lint` is known-broken repo-wide: `Command "eslint" not found`.)

**Manual checks (if no CLI):**
- Grep the repo for `NO_EXPLANATION_ALLOWANCE` and for a second `explanation.count` over `chargedAt`: both must be gone, leaving one usage query and one refusal sentence.
- Grep `apps/web` for `10`-as-an-Explanation-limit, `Free`, `Plus`, `Family`: no tier name or Explanation figure of the web's own.

## Auto Run Result

Status: done

**Summary:** The Explanation Allowance is enforced at the charge rather than checked twice and hoped for. `AllowanceService.explanationUsedIn` is the single Explanation window query (charged rows in `[start, end)` plus `Explanation` tombstones), `counters.explanation` delegates to it, and `ExplanationService.explanationFor` takes `ParentAccountService.findByIdForUpdate` inside the transaction that writes the row, re-reads the tier off the locked row and counts through that one method — closing the READ COMMITTED double-charge the method's own comment used to record as deferred. The refusal moved out of `explanation-policy.ts` into `allowance-policy.ts` as the third sibling: `explanationAllowanceExhausted({ limit, resetAt, timezone })` names the limit and the reset date in the account's own zone and never the Account Tier and never a usage figure, since the Explanation press is the only student-scoped endpoint that charges. This pass is a follow-up review pass only — no code was changed; the code and its prior review pass (2026-09-30, patch 9 / defer 6 / reject 11) are unchanged from the last `done` state.

**Files changed this pass:** none (review-only pass; this file's own frontmatter and log sections were updated with the new triage entry and two new deferred items).

**Review findings breakdown (this pass):** patch 0, defer 2 (low 2), reject 12 (low 12), intent_gap 0, bad_spec 0. Reviewed via four parallel layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) against the diff since `baseline_revision`. No patch or bad_spec finding survived triage: the strongest apparent hit (two spec helper functions that looked undefined) was verified false — both are defined earlier in the same file for the Upload/Generation cases. The two edge-case-hunter findings (unguarded account lookups) were verified false — both `ParentAccountService.findById` and `findByIdForUpdate` already throw `NotFoundException` on a missing row, the same idiom Stories 9.2-9.4 share. The intent-alignment auditor's only divergence (web-side tests use an opaque sentinel rather than the real composed sentence) was judged correct-as-is: that isolation is what proves `studentCopy.atCap` restates no figure of its own, per this spec's own Boundaries.

**Follow-up review recommendation:** `false`. This pass's patched findings: high 0, medium 0, low 0. Score `3×0 + 0 = 0`, below the 5 threshold.

**Verification performed:** None re-run this pass — no patch finding required a code change, so the prior pass's verification results (typecheck clean, prettier clean, `pnpm --filter web test` 68/1440 passed, touched-suite subset of `pnpm --filter api test` 384/384 passed, unrelated baseline flake DW-89 confirmed independent) stand.

**Residual risks:** The 8 deferred items in this file's frontmatter remain open (transaction lock timeout/maxWait gap shared with Story 9.3; pre-lock window resolution race; pre-lock `chargedAt` capture; `atCap()` test helper's own window re-read race; `extraQuestion`'s stale `questionCount`; two-voice at-cap copy; the int-spec's narrower no-billing-fact guard; the untimed concurrency-test barrier). None block this story; all are pre-existing-shape or test-only.

