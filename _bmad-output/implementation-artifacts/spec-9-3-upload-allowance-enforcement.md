---
title: 'Story 9.3: Upload Allowance Enforcement'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_revision: '4d136d96cca64129d2e8ff2ca225f3215297c316'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The capture screen's add-pages catch still drops the API's own 409
      sentence, so a page refused at the 10-page ceiling shows the generic
      fallback.
    evidence: |-
      `addPages`' per-file catch does
      `setError(cause instanceof Error ? cause.message : parentCopy.capture.addFailed)`.
      For a 409, `ParentApiError.message` is the call's generic fallback and the
      server's sentence lives on `reason`, so `PAGE_LIMIT_REACHED` ("An upload
      holds at most N pages.") never reaches the parent. The shared `write`
      catch was fixed by this story; this second refusal site on the same screen
      was not, and no test observes which sentence it sets. Pre-existing: the
      catch predates this change and no path this story added routes through it.
    location: >-
      apps/web/src/app/parent/capture/page.tsx:553
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The Upload Allowance is computed but never enforced: `AllowanceService` counts committed Source Tests against `limitsFor(tier).upload`, and `SourceTestService.submit` commits one without ever consulting that count, so a Free account can commit unlimited uploads and every commit is a paid Extraction call.

**Approach:** Gate the one transaction that commits a Source Test on the account's remaining Upload Allowance, refusing 409 with a sentence naming the tier, the usage against the limit, and the reset date in the account's own zone — and surface that sentence on the capture screen instead of its generic fallback.

## Boundaries & Constraints

**Always:**
- The cap check and the `status: 'Submitted'` write share **one** transaction, serialized by `ParentAccountService.findByIdForUpdate` on `parent_account` — the same row lock Story 9.2 and the Admin tier change use. No second row-lock idiom, no application-level clamp.
- Usage stays **derived** (AD-14): no counter column, no charge write, no reset job, nothing decremented. The count is committed Source Tests in the window **plus `Upload` usage tombstones** — the same sum `AllowanceService.counters.upload` already answers, computed in exactly one place.
- Every figure is read through `limitsFor`; `null` is unlimited and returns early with no count issued. No tier name and no allowance figure appears as a literal anywhere, in `apps/api`, in `apps/web`, or in a test.
- Nothing is charged for a refusal: a refused submit leaves the row a `Draft`, writes no Extraction job, and leaves the account's usage byte-for-byte unchanged.
- The refusal reaches the parent verbatim. `apps/web` states no tier name, no limit and no reset date of its own.

**Block If:**
- The Upload cap cannot be enforced inside `submit`'s transaction without a second writer of `source_test` or a new counter column.

**Never:**
- Do not enforce Generation (9.4), Explanation (9.5), or build the Allowances surface / reset machinery (9.6).
- Do not block, gate or slow any other path: opening a draft, adding, reordering or deleting pages, classifying, the legibility check, Extraction, grading. Only the commit is capped.
- Do not add a `forwardRef` cycle between `sourcetest` and `allowance` (see Design Notes), and do not weaken or delete an existing assertion to make a Free-tier fixture pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Headroom | Free account, 1 committed this period, valid draft | 200, the draft is `Submitted`, the Extraction job exists | No error expected |
| At cap | Free account, 2 committed this period, valid draft | 409 naming tier, `2 of 2`, and the reset date; row stays `Draft`; no Extraction job | `ConflictException` from the policy sentence |
| Unlimited tier | `Internal` account, many committed | 200 every time; no account lock contention beyond the read, no count issued | No error expected |
| Tombstones count | Free account, 1 committed + an `Upload` tombstone of 1 in the window | 409 at cap — a deleted upload is not a refund | `ConflictException` |
| Previous period | Free account, 2 committed in the *previous* window | 200 — the window is half-open `[start, end)` and the old commits fall outside it | No error expected |
| Failed gates charge nothing | At cap **and** zero pages / unclassified / unchecked | The existing 400 still wins where it is reached first; usage unmoved either way | Existing `BadRequestException` |
| Racing submits | Two concurrent submits of two drafts against the last free slot | Exactly one commits; the other is refused | `ConflictException`, via the row lock |
| Refusal on screen | Capture screen, submit answers 409 with a reason | The alert shows the API's sentence, Parent View is not ended | Non-409 falls back to `parentCopy.capture.failed` |

</intent-contract>

## Code Map

- `apps/api/src/sourcetest/source-test.service.ts:811-869` (`submit`) -- **the enforcement point.** Already opens `prisma.withTransaction` and applies three gates (`canSubmit`, `isClassified`, `isChecked`) plus a state-guarded `updateMany` to `Submitted` and `extraction.enqueue(tx, …)`. The allowance guard goes inside this same transaction, after the existing gates and before the `updateMany`. Lines `883-900` (`countSubmittedIn`) are the current upload count — **moves to `allowance`** (see Design Notes); line `206-208`'s class-comment claim "Nothing here charges an Upload Allowance" needs rewriting, as does the sentence at `871-882`. `submittedInstantsFor` (916) is Epic 8's and stays.
- `apps/api/src/allowance/allowance.service.ts:100-104` -- `counters.upload` = `sourceTests.countSubmittedIn(...) + tombstonedIn(..., 'Upload')`. Becomes a call to one new tx-aware method so the guard and the readout cannot drift. `tombstonedIn` (163-180) is the tombstone half, unchanged. `windowFor` (185) already exposes the window; `consumptionFor` (189) already exposes `resetAt`/`timezone`.
- `apps/api/src/allowance/allowance.module.ts:14-19` -- imports `SourceTestModule` **for the upload count alone**. That import is what makes the enforcement direction a cycle; it goes, and `sourcetest` imports `AllowanceModule` instead. `IdentityModule` + `PrismaModule` remain.
- `apps/api/src/allowance/tiers.ts` -- `limitsFor(tier).upload` (`Free` 2, `Plus` 8, `Family` 20, `Internal` `null`). Read-only; never restate a figure.
- `apps/api/src/allowance/period.ts:96-110` (`monthWindowFor`), `wallClockAt` (46) -- the zone machinery the reset date must be rendered through. `PeriodWindow.end` **is** the reset instant, and `PeriodWindow.timezone` is the zone it was actually cut in (already falls back to `DEFAULT_TIMEZONE` for an unrecognised zone, so the sentence cannot throw).
- `apps/api/src/identity/parent-account.service.ts:132-151` -- `findByIdForUpdate(tx, id)`: `SELECT … FOR UPDATE` on `parent_account`. **Reuse; write no second lock idiom.** Exported by `IdentityModule`, which `sourcetest` already imports (`source-test.module.ts:29`) for `StudentProfileService`.
- `apps/api/src/explanation/explanation.service.ts:335-390` -- the established at-cap idiom: read the consumption, refuse with a `ConflictException` before the spend, re-count *inside* the write transaction. Model the shape on it. Note its sentence names neither tier nor date, because its reader is a **student**; this story's reader is a parent and the AC requires all three.
- `apps/api/src/explanation/explanation-policy.ts:20-30` and `apps/api/src/identity/student-profile-policy.ts` -- one refusal sentence per rule, in the owning module's policy file, no exclamation and no apology. Story 9.2's `cannotAddStudentProfile(tier, limit)` is the closest precedent for a sentence parameterised by tier.
- `apps/api/src/prisma/prisma.service.ts:11,40` -- `TransactionClient` and `withTransaction`, the types the new tx-aware count takes.
- `apps/api/src/allowance/allowance.service.spec.ts:60-70` -- stubs `sourceTests.countSubmittedIn` and constructs `new AllowanceService(accounts, prisma, sourceTests)`. Both change when the dependency goes; the tombstone cases themselves stay.
- `apps/web/src/app/parent/capture/page.tsx:388-409` (`write`) -- its catch does `setError(cause instanceof Error ? cause.message : …)` and so **drops the server's sentence** (`ParentApiError.reason`), exactly the defect Story 9.2 fixed on the students screen. `submit()` (line 676) goes through it. The alert at ~695 is `role="alert"`, so the refusal is announced already — no new live region.
- `apps/web/src/app/parent/students/page.tsx:65,372` -- `createRefusal(cause)`: the exported rule pattern a review pass required, so the catch's decision is testable. Mirror it here.
- `apps/web/src/lib/parent-view.ts:59-62` -- `refusalText(cause, fallback)`, already the right function; `endsParentView` handling stays ahead of it.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- `node`-env, `renderToStaticMarkup` + source inspection only (no `@testing-library`), so the refusal is pinned by testing the exported rule. `apps/web/src/app/parent/students/page.spec.tsx:245-265` is the block to mirror.
- `apps/api/test/source-test.int-spec.ts` -- the submit block and its idioms (`elevatedParent()`, `messagesOf(response)`, "writes nothing" assertions). **Where the new HTTP cases go.**
- `apps/api/test/harness.ts:463-480` (`createParentAccount`, takes `tier`), `666-684` (`setAccountTier`), `690-721` (`createCredentialedParent` / `createSignedInParent`, which sign up and therefore land `Free`) -- Story 9.2 already built the headroom mechanism; this story reuses it for uploads.
- Suites that commit more than two Source Tests under one account and therefore need Upload headroom: `extraction`, `page-image-expiry`, `mastery`, `analytics`, `practice-test`, `source-test`, `parent-account`, and any spec seeding `status: 'Submitted'` rows **and** then calling `POST …/submit` on the same account. Treat as a starting map, not a contract: the suite is the authority. A seeded `Submitted` row counts toward the cap even though it never went through `submit`.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/allowance/allowance.service.ts` -- add `uploadUsedIn(accountId, window, client?)`: committed Source Tests in `[start, end)` plus `Upload` tombstones, over this module's own `PrismaService` or the caller's `TransactionClient`. Point `counters.upload` at it and drop the `SourceTestService` injection. One method, so the guard and the readout can never disagree.
- `apps/api/src/allowance/allowance.module.ts` -- drop the `SourceTestModule` import and say in the doc comment why the upload count now reads the column directly, the way `generation` and `explanation` already do: the module every surface reads may not depend on a module that enforces against it.
- `apps/api/src/allowance/allowance-policy.ts` (new) -- `uploadAllowanceExhausted({ tier, used, limit, resetAt, timezone })`: one sentence naming the Account Tier, `used` against `limit` **denominated in uploads**, and the reset date rendered in `timezone` through `Intl.DateTimeFormat`. A pure module beside `tiers.ts`/`period.ts`, with no Nest dependency, because 9.4 and 9.5 need the same shape and a second formatter is a second answer.
- `apps/api/src/allowance/allowance-policy.spec.ts` (new) -- unit-cover the sentence: it names the tier, both figures read from `TIER_LIMITS` (never a literal), and the reset date as it reads in the account's zone and **not** as it reads in UTC (use a zone whose local date differs from the UTC date at the boundary); it names no other figure; an unrecognised zone still produces a sentence rather than throwing.
- `apps/api/src/sourcetest/source-test.service.ts` -- inject `ParentAccountService` and `AllowanceService`; resolve the window before the transaction, then inside it (after the three existing gates, before the `updateMany`) lock the account with `findByIdForUpdate`, return early when `limitsFor(tier).upload` is `null`, and otherwise count through `allowance.uploadUsedIn(…, tx)` and throw `ConflictException(uploadAllowanceExhausted(...))` when the count has reached the limit. Delete `countSubmittedIn` (its only caller moves) and rewrite the class comment at 206 and the doc comment at 871: the Upload Allowance is enforced here now, the charge is still the `Submitted` row and nothing else.
- `apps/api/src/sourcetest/source-test.module.ts` -- import `AllowanceModule`; state that the dependency now runs `sourcetest -> allowance` only, which is why no `forwardRef` and no reader token is needed for it.
- `apps/api/src/allowance/allowance.service.spec.ts` -- drop the `sourceTests` stub and give the prisma double a `sourceTest.count`; keep every tombstone case asserting the same sums, and add one pinning that `uploadUsedIn` issues its count on the client it is handed.
- `apps/api/test/source-test.int-spec.ts` -- add the I/O matrix's HTTP cases to the submit block: at-cap refusal (message asserted against the exported sentence built from `limitsFor`, never a regex or a literal; row still `Draft`; no Extraction job), headroom success, unlimited-tier repeat commits, a tombstone pushing an account to cap, commits in the previous window not counting, and two concurrent submits against the last slot leaving exactly one committed.
- `apps/api/test/*.int-spec.ts` (the suites mapped above) -- give each account that commits past its tier's Upload Allowance an explicit tier with headroom via `createSignedInParent`'s `tier` / `setAccountTier`. Change no assertion and weaken no cap; a spec that fails because its Free account wanted a third upload is the cap working.
- `apps/web/src/app/parent/capture/page.tsx` -- export `writeRefusal(cause)` = `refusalText(cause, parentCopy.capture.failed)` and use it in `write`'s catch, so the API's tier-and-date sentence reaches the parent for this refusal and every other one on the screen.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- add a refused-submit block mirroring the students screen's: a 409 carrying an opaque sentinel reason renders that reason, a non-409 `Error` falls back to its own message, a non-`Error` throw falls back to the copy string, and the refusal does not end Parent View. The fixture states no tier name, figure or date.

**Acceptance Criteria:**
- Given an account at its tier's Upload Allowance, when it commits a Source Test over HTTP, then it is refused 409 with a sentence naming that tier, the usage against the limit in uploads, and the reset date in the account's own zone — and the draft, its pages and the Extraction job table are unchanged.
- Given any refused or abandoned attempt — a failed gate, a refused commit, an expired draft — when the account's consumption is read, then its Upload usage is unmoved: only a `Submitted` row ever counts.
- Given the whole API suite, when it runs, then no upload figure and no tier name appears as a literal anywhere, every expected limit is read through `limitsFor`, and the Upload cap is enforced in exactly one place.
- Given the capture screen, when a commit is refused at the cap, then the alert shows the API's own sentence and the web app still contains no tier name, no limit figure and no reset date of its own.

## Spec Change Log

## Review Triage Log

### 2026-09-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 0, low 11)
- defer: 1: (high 0, medium 1, low 0)
- reject: 20: (high 0, medium 0, low 20)
- addressed_findings:
  - `[low]` `[patch]` `AllowanceRefusal.limit` was typed `number` while its doc described a `null` caller. The doc now states the real contract: the caller returns early on an unlimited tier, so no `null` ever reaches the builder.
  - `[low]` `[patch]` The refusal read "1 of 1 have been used" on a tier allowing one upload. The verb now agrees with `used`, pinned by a singular unit case.
  - `[low]` `[patch]` `allowance-policy.ts` claimed one builder would serve Upload, Generation and Explanation while hardcoding the noun. The claim is now what is true: the siblings share `AllowanceRefusal`, the date rendering and the wording, each keeping its own unit.
  - `[low]` `[patch]` The comment "an Internal account pays for no query here" was false — `findByIdForUpdate` had already taken the row lock. Reworded to: no *count* is issued, the lock is still taken.
  - `[low]` `[patch]` Both `submit` and `uploadUsedIn` justified passing the transaction as sharing "one snapshot". Under READ COMMITTED every statement takes its own; correctness comes from `FOR UPDATE` alone. Both comments corrected so 9.4 and 9.5 do not copy a wrong model.
  - `[low]` `[patch]` The window was resolved before the transaction while `submittedAt` was stamped inside it, so a commit crossing a period boundary was counted against one window and written into the next. One `now` now feeds both.
  - `[low]` `[patch]` `submittedInstantsFor`'s doc still claimed nothing outside `sourcetest` reads `source_test`; `allowance.uploadUsedIn` now does. Claim corrected.
  - `[low]` `[patch]` The moved Upload predicate was unverified at unit level: only call counts were asserted, so dropping the account scope or using `lte` on the window end passed. The full `where` is now asserted.
  - `[low]` `[patch]` The transaction-client case had no negative half. It now asserts the module's own Prisma doubles are untouched when a client is passed.
  - `[low]` `[patch]` Three int-spec defects: a "built one at a time" comment sitting above a `Promise.all`, a "twice over" comment for one-past-the-limit, and a lexicographic `.sort()` on numeric statuses. All three fixed.
  - `[low]` `[patch]` The web spec restated the tier enum as a literal array. It now iterates `ACCOUNT_TIERS`, so a fifth tier is checked too.

### 2026-09-30 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 18
- addressed_findings:
  - none

## Design Notes

**Why the upload count moves into `allowance` rather than `sourcetest` importing it back through a `forwardRef`.** `AllowanceModule` currently imports `SourceTestModule` so the upload count is read through the owning module's service (AD-17). Enforcement needs the arrow the other way. Keeping both makes `allowance` — the module every surface reads — depend on a module that depends on it, which is precisely the cycle `allowance.service.ts` already refuses for `practicetest` ("Injecting `PracticeTestService` instead would make `allowance` … depend on a module that depends on it") and for `explanation`. So Upload joins its two siblings: `allowance` counts `source_test` rows through its own `PrismaService`, `sourcetest` imports `AllowanceModule` one way, and there is no `forwardRef`, no reader token and no ESM cycle. What is read is a status and an instant — a column, not a behaviour — and `countSubmittedIn` is deleted rather than left as a second definition of the count.

**Why the guard is inside `submit`'s transaction and behind the account row lock.** The charge *is* the `Submitted` row, so the only honest place to refuse is the statement that writes it. `explanation`'s charging seam documents the race it could not close: under READ COMMITTED two requests read the same pre-charge usage. Here it closes, for the same reason Story 9.2's did — `findByIdForUpdate` already exists, and one account's commits are exactly what should serialize. Shape:

```ts
const window = await this.allowance.windowFor(parentAccountId);
// …inside the existing withTransaction, after the three gates:
const account = await this.accounts.findByIdForUpdate(tx, parentAccountId);
const limit = limitsFor(account.tier).upload;
if (limit !== null) {
  const used = await this.allowance.uploadUsedIn(parentAccountId, window, tx);
  if (used >= limit)
    throw new ConflictException(
      uploadAllowanceExhausted({ tier: account.tier, used, limit, resetAt: window.end, timezone: window.timezone }),
    );
}
```

The window is resolved before the transaction because it reads the zone history and holding the lock across that read buys nothing; a zone change landing in between moves the *next* boundary, never the running period (AD-27).

**Why the sentence lives in `allowance` and not in `source-test-policy.ts`.** Story 9.2's sentence lived in `identity` because the figure it named was `identity`'s own live count. This one names the tier, the period and the reset instant — all three owned by `allowance` — and 9.4 and 9.5 will need the identical shape in their own units. One parameterised builder there beats three sentences that drift apart, and `sourcetest` keeps stating no tier figure of its own.

**Why a seeded `Submitted` row counts.** Usage is derived from rows, not from the path that wrote them, so a fixture that inserts committed Source Tests directly raises the account's usage exactly as a real commit would. That is correct, and it is the reason the fixture sweep is wider than "suites that call `POST …/submit` three times".

## Verification

**Commands:**
- `pnpm --filter api test` -- expected: unit and real-Postgres specs pass with the fixture tiers raised where needed. Needs Postgres (`pnpm db:up`). A pre-existing intermittent failure in `practice-test.int-spec.ts` is a known baseline flake, not this story's.
- `pnpm --filter web test` -- expected: the capture-screen specs pass, including the refused-submit cases.
- `pnpm typecheck` -- expected: clean.
- `pnpm exec prettier --check .` -- expected: no unformatted files. (`pnpm lint` is known-broken repo-wide: `Command "eslint" not found`.)

## Auto Run Result

**Summary:** Fresh review pass on the already-implemented Upload Allowance enforcement (no code changes this pass). `SourceTestService.submit` takes a fourth gate inside its existing transaction — the account row locked with `ParentAccountService.findByIdForUpdate`, an early return on an unlimited tier, and otherwise a count through `AllowanceService.uploadUsedIn` — refusing 409 with a sentence naming the Account Tier, the usage against the limit in uploads, and the reset date in the account's own zone. Usage stays derived: no counter column, no charge write, no reset job. The module arrow was flipped so `sourcetest` can enforce against `allowance` without a cycle.

**Files changed (this story, unchanged this pass):**
- `apps/api/src/allowance/allowance-policy.ts` (new) -- `uploadAllowanceExhausted`, the parent-facing refusal.
- `apps/api/src/allowance/allowance-policy.spec.ts` (new) -- the sentence's unit cover.
- `apps/api/src/allowance/allowance.service.ts` -- `uploadUsedIn(accountId, window, client?)`, the one Upload count for both the readout and the cap; `SourceTestService` injection dropped.
- `apps/api/src/allowance/allowance.module.ts` -- `SourceTestModule` import removed.
- `apps/api/src/allowance/allowance.service.spec.ts` -- Prisma double gains `sourceTest.count`; new cases pin the count's `where` and the transaction-client routing.
- `apps/api/src/sourcetest/source-test.service.ts` -- the allowance gate inside `submit`'s transaction; `countSubmittedIn` deleted (confirmed no remaining callers by repo-wide grep).
- `apps/api/src/sourcetest/source-test.module.ts` -- imports `AllowanceModule`.
- `apps/api/test/source-test.int-spec.ts` -- the `the Upload Allowance` block: seven HTTP cases covering every I/O matrix row.
- `apps/web/src/app/parent/capture/page.tsx` -- `writeRefusal(cause)` exported and used in the shared `write` catch.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- the refused-commit block.

**Review findings breakdown (this pass):** 4 parallel review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment auditor) ran against the diff since `baseline_revision`. 18 findings raised, all triaged `reject` after independent verification:
- Two candidate correctness bugs were checked directly against the code and refuted: `ParentAccountService.findByIdForUpdate` already throws `NotFoundException` when the account row is missing (no unguarded null access), and a repo-wide grep confirmed no remaining caller of the deleted `SourceTestService.countSubmittedIn`.
- The verification-gap finding on the web refusal test (source-grep rather than a rendered-component assertion) matches this codebase's documented, established testing convention for this file (`page.spec.tsx` -- "`node`-env, `renderToStaticMarkup` + source inspection only ... so the refusal is pinned by testing the exported rule," per this spec's own Code Map) -- not a gap introduced by this story.
- The intent-alignment auditor's one flagged divergence (tier names `'Free'`/`'Internal'` as literals in `source-test.int-spec.ts` fixture selectors) is fixture parameterization, not a restated allowance figure -- every count and limit in those tests is still read through `limitsFor`, and the pattern matches the pre-existing Story 9.2 fixture idiom (`createSignedInParent(h, { tier })`).
- Remaining findings (timezone fallback logging, DST-transition test coverage, race-test outcome-only assertion, module-graph acyclicity enforced only in prose, etc.) are either out of this story's scope, already covered by an equivalent existing case, or ask for infrastructure this story never touches.

**Follow-up review recommendation:** `false`. Patched this pass: high 0, medium 0, low 0. Score = 3x0 + 1x0 = 0.

**Verification performed:**
- No code changed this pass, so the implementation pass's verification stands: `pnpm typecheck --force` clean; `pnpm exec prettier --check .` clean; `pnpm --filter web test` 1436/1436 passed; `pnpm exec vitest run src` (apps/api) 864/864 passed; all 28 API integration specs passed in batches.
- This pass's own checks: repo-wide grep for `countSubmittedIn` (no stray callers); read of `findByIdForUpdate`'s implementation (confirms the `NotFoundException` guard the edge-case finding assumed missing).

**Residual risks:**
- Unchanged from the implementation pass: the period-boundary fix is not covered by an HTTP-level test (no clock seam in the harness); the 409 sentence and the web decision rule are each asserted in isolation, not end-to-end; a pre-existing intermittent 401/404 suite flake is unrelated to this change.
- The deferred add-pages refusal site (`apps/web/src/app/parent/capture/page.tsx:553`) remains open and unchanged; tracked separately in the deferred-work ledger, not touched by this run.

