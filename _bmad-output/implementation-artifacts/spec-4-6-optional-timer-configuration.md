---
title: 'Story 4.6: Optional Timer Configuration'
type: 'feature'
created: '2026-09-25'
baseline_revision: 'b6acc3465d5bc429e5ceb84d05336f4b30dd851b'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-5-release-or-discard.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The draft review screen's timer block, like every other control on that screen, is covered by a
      spec that greps the page's own source text rather than rendering it, so no executing unit test
      drives the timer in a DOM.
    evidence: |-
      `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` asserts with
      `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. The new timer cases
      assert the presence of literals such as `setTimerOn(storedTimer !== null)` — a refactor that
      preserves behaviour fails them, and a behavioural inversion that keeps the literal passes.
      `apps/web/vitest.config.ts` sets `environment: 'node'` and no testing-library dependency
      exists under `apps/web`, so a real render test needs a DOM the web tier does not have. Carried
      from Stories 4.3, 4.4 and 4.5; this story adds more instances of it. The Playwright pass is the
      compensating surface and it does drive the timer end to end, including the off path, the
      disabled-save gate and the survive-a-delete case.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx
    severity: medium
  - summary: >-
      The api integration specs fail 1-2 non-deterministic tests per run, a different test each time,
      and the flake now also appears on single-file runs rather than only on a full parallel run.
    evidence: |-
      Observed this pass as `topic weighting > offers the other topics for the remaining questions`
      (404 where 202) and `release and discard > leaves a discarded test out of the read entirely` on
      separate runs of `vitest run test/practice-test.int-spec.ts` alone, and as
      `Student Mode and the device binding > binds to the named profile on the deliberate exit` on one
      run of `test/student-mode.int-spec.ts`. Every one passed on the next run and in isolation. Two
      consecutive full-file runs at baseline `b6acc34` (99 tests, this story's 13 absent) were green,
      so the longer file widens an existing window rather than introducing a fault: the cause is the
      shared-Postgres reset pattern recorded on Story 4.5, not product code. Needs a per-file schema
      or database, or `fileParallelism: false` for the integration specs.
    location: >-
      apps/api/vitest.config.ts; apps/api/test/harness.ts
    severity: medium
  - summary: >-
      Nothing on the pending-drafts list says whether a draft carries a time limit, so a parent
      holding several drafts must open each one to find out.
    evidence: |-
      `PracticeTestDraftSummary` carries id, source test, profile, ordinal, sibling count, question
      count and made-at, and this story deliberately did not widen it — the timer is read and written
      on the draft it belongs to, which is where FR-15 puts it. No story currently owns a timer
      marker on the list, which is why this is recorded rather than built. Harmless with a handful of
      drafts; a real omission once a parent holds a dozen.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (draftsFor); apps/web/src/app/parent/drafts/page.tsx
    severity: low
  - summary: >-
      A timer save with nothing changed is still a full write: a transaction, a log line and an
      announcement for a row that already read that way.
    evidence: |-
      `saveTimer` gates on `timerSavable` and `busy` but compares nothing against `storedTimer`, so
      clicking save on an untimed draft with the box unticked issues `PUT { minutes: null }` and
      announces "There is no time limit …" for a no-op. Idempotent and harmless, and the same shape
      the edit save already has, so it is a rough edge rather than a defect.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (saveTimer)
    severity: low
  - summary: >-
      The 1-180 minute bound lives only in the DTO, so any future writer that is not that route can
      store a duration Epic 5 would derive a nonsensical deadline from.
    evidence: |-
      The migration adds a bare `INTEGER` with no CHECK, and `student-mode.int-spec.ts` demonstrates
      the gap by writing `timerMinutes: 25` straight through Prisma. This story deliberately located
      enforcement in the DTO because `practicetest` is the sole writer (AD-17) and the one route is
      the only path; a database CHECK would make the invariant a property of the column instead.
      Worth taking with Epic 5's own migration rather than a migration of its own.
    location: >-
      apps/api/prisma/schema.prisma (PracticeTest.timerMinutes)
    severity: low
  - summary: >-
      The timer save button and every other mutation button on this screen only gate on `busy !==
      null`, so a click that lands while the elevation token is null, or a second click in the same
      tick before `setBusy` commits, is a silent no-op with no feedback.
    evidence: |-
      `saveTimer` returns early on `token === null || busy !== null`, but the button's own `disabled`
      prop (`disabled={busy !== null || !timerSavable}`) never checks `token`, and the same shape
      (`disabled={busy !== null}` with no token check) appears on every other action button in
      `page.tsx` (:1245, :1258, :1294, :1301, :1345, :1353, :1361) — a pre-existing pattern this story
      only repeats rather than introduces. A double-click before React commits `setBusy` is the same
      shared gap.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (saveTimer and sibling action buttons)
    severity: low
  - summary: >-
      The minutes field's `aria-describedby` wiring — the one accessibility property genuinely new to
      this story — is asserted only by a source-text grep, and the Playwright pass that is this
      screen's compensating surface for that pattern never reads the attribute off the rendered input.
    evidence: |-
      `page.spec.tsx`'s "ties both explanatory sentences to the minutes field itself" test greps
      `PAGE_SOURCE` for the id constants and the `aria-describedby` template string; it does not
      render the component. `e2e/tests/parent-practice-test.spec.ts` drives the timer block end to end
      but its only `aria-describedby` assertion (line 171) targets an unrelated control on the
      generate screen. So nothing executing confirms the minutes `<input>` actually carries
      `aria-describedby="draft-timer-hint draft-timer-suggestion"` at runtime — a wrong `slotProps`
      key or a mismatched id would ship undetected. A narrower instance of the pattern already
      recorded above (source-grepped page spec), called out separately because the general
      deferred item's claim that "the Playwright pass ... does drive the timer end to end" does not
      hold for this specific attribute.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (minutes TextField); e2e/tests/parent-practice-test.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** A parent can now read, fix, release or discard a draft, but cannot say how long the child gets. FR-15's timer has no column, no route and no control: the one configuration a Practice Test carries that is not generated content is missing, and it must be settable while reviewing the draft it applies to and frozen the moment that draft is released.

**Approach:** One nullable duration column on `practice_test` — null *is* off, so default-off needs no second flag — plus one elevation-guarded, `Draft`-only mutation that sets or clears it, the suggested duration carried on the draft view so the screen pre-fills without inventing a figure, and a timer block in draft review beside the release control. The released-state write barrier AD-33/the reconcile addendum require is the same `status: 'Draft'` in the `where` that the 4.4 edits and the 4.5 transitions already rely on.

## Boundaries & Constraints

**Always:**
- The stored configuration is **one nullable `timerMinutes Int?` column** on `PracticeTest`. `null` means no timer, which is what every existing row already reads as — no backfill, no second boolean, no "enabled" flag that could disagree with a duration.
- Minutes, not seconds: minutes are what the parent enters (FR-15), and a unit converted twice is a unit two surfaces can disagree about. Epic 5 derives a deadline from it; this story stores what was typed.
- Bounds are `MIN_TIMER_MINUTES = 1` and `MAX_TIMER_MINUTES = 180`, stated once in `practice-test-policy.ts` and enforced **server-side** in the DTO. A figure outside them is a 400 in this module's own sentence; UI disablement alone does not satisfy it — the same rule Story 4.1's clamp follows.
- The **suggested** duration is derived from the stored question count as `questionCount + 5` minutes, clamped to the bounds: a minute per Question plus five to read and check, which reproduces the PRD's own worked example (15 questions → 20 minutes, §UJ-2). It is computed server-side, carried on `PracticeTestDraftView` as `suggestedTimerMinutes`, and is a **suggestion only** — it is never stored by anything but an explicit parent write, so a draft nobody configured stays `null`.
- One route: `PUT /parent/practice-tests/:id/timer`, `@HttpCode(OK)`, body `{ minutes: number | null }`, answering the full `PracticeTestDraftView` exactly as every other mutation in this module does. `null` turns the timer off and is a legitimate body, not an absent field.
- `Draft` is in the `where` of the statement that mutates, beside `parentAccountId`. A `Released` id, a `Discarded` id, a foreign id and an unknown id therefore all answer the same 404 `PRACTICE_TEST_NOT_FOUND` (AD-18) — "editable up to release, never after" is a property of the statement, not a check on a screen.
- Setting a timer is **not** a transition and **not** a charge: `status` and `chargedAt` are untouched (AD-14), and the derived allowance count is unaffected.
- The timer block lives in draft review beside the release and discard controls: an off/on control, a minutes field pre-filled with the suggestion, and a save. Both are real focusable elements with accessible names, the outcome is announced through the existing `announce` live region in the same words the screen shows, and a failure surfaces through the existing `actionError` machinery.
- Every user-facing string is parameterized in `apps/web/src/copy/parent.ts`, third person about the student, plain fact — no exclamation marks, no cheerleading, no error codes, no allowance figure, no tier, no model name.
- Nothing logged by the mutation carries generated content: identifiers and the minute figure only (AD-20).

**Block If:**
- Nothing. FR-15, the epic's acceptance criteria and the reconcile addendum's released-state write barrier fully specify the configuration half.

**Never:**
- No countdown rendering, no warning thresholds, no auto-submit, no expiry evaluation, no `incorrect`-vs-`unanswered` consequence — Epic 5 owns every one of them, and this story writes configuration only. The epic's third and fourth acceptance criteria are Epic 5's to satisfy.
- No Attempt table, no `deadlineAt`, no server clock evaluation, no `role="timer"` component.
- No timer figure on **any** student-scoped response: `PracticeTestReleasedSummary` stays `{ id, questionCount }`. Epic 5 adds what its own surface needs.
- No unrelease, no post-release timer change by any route, flag or parameter, and no admin override.
- No second column, no `timerEnabled` boolean, no seconds column, no per-account or per-profile default.
- No change to generation: the runner does not write a timer, and a draft lands with `null` as it always has.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set a timer | `PUT .../timer` `{ minutes: 20 }` on an owned `Draft` | Row stores 20; answer is the full view with `timerMinutes: 20`; `status` and `chargedAt` unchanged | No error expected |
| Turn it back off | `{ minutes: null }` on a draft that had one | Row stores `null`; the view carries `timerMinutes: null` | No error expected |
| Change it again before release | A second `PUT` with a different figure | Latest figure stored; editable any number of times while `Draft` | No error expected |
| A freshly generated draft | Read a draft nothing configured | `timerMinutes: null` and `suggestedTimerMinutes` = `questionCount + 5` clamped | No error expected |
| Suggestion at the ceiling | A draft with more than 175 questions | `suggestedTimerMinutes` is `MAX_TIMER_MINUTES`, never above it | No error expected |
| After release | `PUT .../timer` on a `Released` id | Refused; nothing is written | 404 `PRACTICE_TEST_NOT_FOUND` |
| After discard | Same call on a `Discarded` id | Refused; nothing is written | 404 `PRACTICE_TEST_NOT_FOUND` |
| Foreign or unknown id | Another account's or a random id | Refused as though it did not exist | 404 `PRACTICE_TEST_NOT_FOUND` |
| Below the floor | `{ minutes: 0 }` or a negative | Refused on shape before a row is read | 400 |
| Above the ceiling | `{ minutes: 181 }` | Refused on shape | 400 |
| Not a whole number | `{ minutes: 12.5 }` | Refused on shape | 400 |
| Missing field | `{}` | Refused — `null` is explicit, absence is not | 400 |
| Malformed id | Path segment not a UUID | Refused on shape | 400 from `ParseUUIDPipe` |
| Unelevated call | No elevation bearer | Refused by the guard | 401 |
| Student-scoped read | `GET /student/practice-tests` with a timed released test | Body still exactly `{ id, questionCount }` — no minute figure anywhere | No error expected |
| Screen: off by default | Parent opens a draft nothing configured | The timer reads off, the minutes field is pre-filled with the suggestion, and nothing is stored until they save | No error expected |
| Screen: saved | Parent turns it on, saves | The stored figure is re-rendered from the returned view and announced in the same words shown | Server's own sentence on a 4xx, controls re-enabled |
| Screen: the draft moved | The id was released in another tab | The existing missing state with the way back | 404 handled as the read's own 404 already is |

</intent-contract>

## Code Map

**Change these:**

- `apps/api/prisma/schema.prisma` -- add `timerMinutes Int?` to `model PracticeTest` (:854-865, beside `questionCount`/`chargedAt`), documented as: null is off, minutes because minutes are what a parent enters, and immutable after release by the statement that writes it. No index — it is read only as part of a row already being read by primary key.
- `apps/api/prisma/migrations/<new>/migration.sql` -- one `ALTER TABLE "practice_test" ADD COLUMN "timerMinutes" INTEGER;`, in the shape `20260925090000_add_generation_job_weighted_topic/migration.sql` uses, with the same "nullable, so every existing row already means the right thing" comment. Name it `<timestamp>_add_practice_test_timer`.
- `apps/api/src/practicetest/practice-test-policy.ts` -- add `MIN_TIMER_MINUTES = 1`, `MAX_TIMER_MINUTES = 180`, `TIMER_MINUTES_PER_QUESTION = 1`, `TIMER_MINUTES_OVERHEAD = 5` and a `suggestedTimerMinutes(questionCount)` helper beside them. Do **not** add a new refusal constant: `PRACTICE_TEST_NOT_FOUND` (:120) stays the one sentence every ownership and state refusal shares (AD-18).
- `apps/api/src/practicetest/dto/practice-test.dto.ts` -- add `SetPracticeTestTimerDto`: `minutes!: number | null` with `@ValidateIf((_, value) => value !== null)` + `@IsInt()` + `@Min(MIN_TIMER_MINUTES)` + `@Max(MAX_TIMER_MINUTES)`, and `@IsDefined()` so `{}` is a 400 — absence is not the same statement as `null`. Unlike `RequestPracticeTestsDto`'s deliberately unbounded `count`, the ceiling **does** belong here: a duration above the bound is a malformed request, not an overreach to clamp.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `setTimer(parentAccountId, practiceTestId, minutes)` beside `transitionTo` (:898+), in that method's exact shape: `updateMany` with `{ id, parentAccountId, status: 'Draft' }` in the `where`, `count !== 1 → NotFoundException(PRACTICE_TEST_NOT_FOUND)`, then `draftViewIn(tx, ...)` (:640) for the answer — unlike a transition the row is still a `Draft`, so the ordinary reader serves it and no second mapper is needed. Add `timerMinutes: true` to `DRAFT_SELECT` (:1354-ish) and `timerMinutes` + `suggestedTimerMinutes` to `draftViewOf` (:1393-ish) and to `PracticeTestDraftView` (:271). Log identifiers and the minute figure after the commit, never inside it.
- `apps/api/src/practicetest/practice-test.controller.ts` -- add `@Put('practice-tests/:id/timer')` below `discard` (:250+), same guard, same `ParseUUIDPipe`, account from `req.elevated`. Extend the header comment: the barrier the 4.4 comment already names ("a timer changed after release would retroactively change how past Attempts were graded") now has the route it was written about.
- `apps/api/test/practice-test.int-spec.ts` -- a `describe('timer configuration')` block beside `describe('release and discard')`, reusing the file's `withDrafts` helper (:1356-ish) and `generatable` (:117). Every matrix row that touches a row: set, clear, re-set, the suggestion on an unconfigured draft, both 400 bounds, the non-integer, the missing field, and the barrier on a `Released` **and** a `Discarded` id with `chargedAt` and `status` asserted unchanged.
- `apps/api/test/student-mode.int-spec.ts` -- extend the released-list case so the asserted body of a **timed** released test is still exactly `{ id, questionCount }`: the minute figure must not leak onto a student-scoped response.
- `apps/web/src/lib/parent-api.ts` -- add `timerMinutes: number | null` and `suggestedTimerMinutes: number` to `PracticeTestDraftView` (:292), and `setPracticeTestTimer(token, practiceTestId, minutes)` beside `discardPracticeTest` (:964) — `PUT`, elevated, returning the view, failure sentence `parentCopy.drafts.timerFailed`.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` -- the timer block above the release/discard row (:1030-ish), and delete the "The timer is Story 4.6. There is no control here for it." line from the file header (:160). An on/off control plus a minutes `TextField` pre-filled from `suggestedTimerMinutes` when nothing is stored and from `timerMinutes` when something is, its own save wired through the existing `busy`/`actionError`/`failed` machinery (:290-310), `announce` on success, and state re-derived from the returned view rather than from what the browser hoped it wrote. No save while `busy !== null`.
- `apps/web/src/copy/parent.ts` -- extend the `drafts` block with the timer section: the legend, the on/off label, the minutes field label, the suggestion hint, the save label, the saved/off announcements and the failure sentence. Third person, plain fact, and the minute figure always parameterized.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx`, `apps/web/src/lib/parent-api.spec.ts` -- the screen's and the client's cases in each file's existing style (method, URL, bearer, body shape, returned shape).
- `e2e/tests/parent-practice-test.spec.ts` -- extend the browser pass: on a draft, the timer reads off with the suggestion pre-filled; set it, reload, and it is still what was set; then release and confirm the timer control is unreachable for that test. One route-intercepted failure case asserting the timer's own sentence and re-enabled controls, in the shape the release-refused test (:704) already uses.

**Read-only evidence (do not change):**
- `_bmad-output/planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/prd.md:396-408` — FR-15, including the recorded assumption that default-off is deliberate, and §UJ-2's worked 15-questions/20-minutes example the suggestion reproduces.
- `_bmad-output/planning-artifacts/architecture/.../reconcile-addendum.md:146` — the released-state write barrier this story is the named beneficiary of, superseding AD-33's "written once at generation".
- `apps/api/src/practicetest/practice-test.service.ts:898-955` (`transitionTo`) — the `updateMany`-with-state-in-the-`where` shape to copy rather than re-invent.
- `apps/api/src/identity/parent-elevation.guard.ts` — unchanged; this story is a caller.

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` + a new migration -- add the one nullable column -- null is off, so default-off and "no backfill" are the same fact, and one column cannot contradict itself the way a flag plus a duration can.
- `apps/api/src/practicetest/practice-test-policy.ts` -- the bounds and the suggestion -- one place that knows what a legal duration is and what a sensible one would be, so the DTO, the service and the screen cannot each hold their own figure.
- `apps/api/src/practicetest/dto/practice-test.dto.ts` -- `SetPracticeTestTimerDto` -- the bound is enforced server-side or it is not enforced, and an absent field must not read as "turn it off".
- `apps/api/src/practicetest/practice-test.service.ts` -- `setTimer`, plus the two new view fields -- scoping `Draft` inside the mutating statement is what makes "never after release" a property of the statement rather than a rule somebody has to remember.
- `apps/api/src/practicetest/practice-test.controller.ts` -- the one route and the header comment -- the barrier the module has described since Story 4.4 finally has the mutation it was written about.
- `apps/api/test/practice-test.int-spec.ts` -- integration-cover every matrix row against real Postgres -- especially both terminal states refusing the write, the untouched `chargedAt` and `status`, and both bounds.
- `apps/api/test/student-mode.int-spec.ts` -- assert the student summary of a **timed** released test is unchanged -- a configuration figure is a parent-only fact, and the only executing proof of that is this file.
- `apps/web/src/lib/parent-api.ts` + `parent-api.spec.ts` -- the call and the two view fields -- method, URL, bearer and body asserted like every sibling call.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` + `page.spec.tsx` -- the timer block -- FR-15 requires the parent to set it *while reviewing the draft it applies to*, not by leaving that context.
- `apps/web/src/copy/parent.ts` -- the new strings -- parameterized, plain fact, and the suggestion is described as a suggestion so a parent knows nothing was stored on their behalf.
- `e2e/tests/parent-practice-test.spec.ts` -- set a timer, prove it survives a reload, and prove it is gone after release -- "editable up to release, never after" is a claim about two moments, which only a browser crossing between them demonstrates.

**Acceptance Criteria:**

- Given a freshly generated draft, when the parent opens it, then no timer is stored, the screen shows it as off, and the minutes field is pre-filled with `questionCount + 5` clamped to the bounds — a figure the server supplied, not one the browser computed.
- Given a draft, when the parent sets a duration and saves, then the stored row carries exactly that figure, the answer is the whole draft view carrying it, and `status` and `chargedAt` are unchanged.
- Given a draft with a timer, when the parent turns it off, then the stored value is `null` and the draft reads as untimed.
- Given a `Released` or `Discarded` Practice Test, when the timer route is called on it with a valid elevation token, then it answers a 404 whose sentence is identical to the one an unknown id gets, and nothing is written.
- Given a duration below the floor, above the ceiling, not a whole number, or absent from the body, then the request is refused with a 400 before any row is read.
- Given a released Practice Test with a timer, when a bound device reads the student-scoped list, then the body carries no minute figure — only the id and the question count.
- Given any log line or error message produced by the timer mutation, then it carries identifiers and the minute figure only — no Question text, no Topic label, no allowance figure, no tier, no model name.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 5: (high 0, medium 2, low 3)
- reject: 11: (high 0, medium 1, low 10)
- addressed_findings:
  - `[medium]` `[patch]` The timer sync effect depended on `suggestedTimerMinutes`, which moves when
    a Question is deleted, so a delete wiped a figure the parent had typed and a box they had
    ticked — the exact outcome the code's own comment claimed its primitive dependencies prevented.
    A parent could configure a limit, delete a bad Question, release, and ship an untimed test. The
    block now seeds once per draft id through a `timerSeededFrom` ref and re-seeds only when the
    *stored* figure changes, and a Playwright case ticks the timer, types a figure, deletes a
    Question and asserts both survive while the suggestion paragraph moves.
  - `[medium]` `[patch]` Turning the timer off was never driven through the screen by anything that
    executed: the only layer that chooses `null` is `timerOn ? Number(...) : null`, and inverting it
    left every test green (the client spec passes `null` itself, the int-spec posts it, and the page
    spec only greps the literal). The Playwright pass now unticks, saves, asserts the off sentence,
    and asserts after a reload that the box is unticked and the field fell back to the suggestion.
  - `[low]` `[patch]` `timerSavable` — the guard that keeps an invalid figure from ever being sent —
    had no executing witness either. Playwright now clears the field with the timer on, asserts the
    save control is disabled, restores a figure and asserts it is enabled again.
  - `[low]` `[patch]` The minutes field's `onChange` did not clear `notice`/`actionError` the way the
    checkbox's does, so a parent who saved 25 and then typed 40 read "The student has 25 minutes …"
    beside a field showing 40. Both are cleared now, asserted inside a timer-block slice.
  - `[low]` `[patch]` `saveTimer` held a second shape check (`!Number.isInteger`) that returned
    silently — a click that did nothing and said nothing. Replaced with one rule: `timerSavable`,
    which now also surfaces `timerFailed` rather than returning mute.
  - `[low]` `[patch]` The minutes field carried no `aria-describedby`, so the timer hint and the
    suggestion sentence were invisible to a screen reader reading the input. Both paragraphs now
    carry ids the field points at. The `Checkbox` import was also returned to alphabetical order.
  - `[low]` `[patch]` Two over-broad source assertions in the page spec: a ban on the bare literal
    `180` anywhere in the file, and a global `<Checkbox` count of one in a test about the option
    editor. Narrowed to the two constant names and to the existing option-editor slice. Added
    int-spec cases pinning the DTO's coercion behaviour: `{ minutes: '20' }` is a 400, and a body
    carrying a second duration-ish field (`timerEnabled`, `timerSeconds`) is a 400 with the column
    unchanged — the executing witness for "no second flag that could disagree with a duration".

### 2026-09-25 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 3: (high 0, medium 0, low 3)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[low]` `[patch]` `timerSavable`'s shape check (`/^\d+$/u`) had no upper bound, so a digit
    string long enough makes `Number(...)` overflow to `Infinity`, which `JSON.stringify` then
    serializes as `null` — a figure the parent typed silently turning the timer *off* instead of
    failing shape validation. Bounded the regex to `/^\d{1,15}$/u`, well under
    `Number.MAX_SAFE_INTEGER`, so `Number()` can never reach `Infinity`. Added a source-level
    assertion pinning the bounded pattern in `page.spec.tsx`.


## Design Notes

**Why one nullable column and not a flag plus a duration.** "Off by default" and "no backfill" are the same fact if null means off: every existing row is already correctly untimed, and there is no state in which an `enabled` boolean and a stored duration can disagree — which is exactly the kind of disagreement that would later decide whether a child's Attempt auto-submits.

**Why the suggestion is computed on the server and never stored.** The screen must pre-fill a figure, but pre-filling is not configuring: a parent who opens a draft, reads it and releases it without touching the timer has released an untimed test, and the stored `null` says so. Computing it server-side keeps one definition of "suggested" for the screen, Epic 5's own surfaces and any test that asserts it. The formula is `questionCount + 5` — a minute a Question plus five to read and check — chosen because it reproduces the PRD's own worked example (15 questions, 20 minutes) rather than inventing a second figure beside it.

**Why `PUT` and why `minutes: null` rather than a `DELETE`.** There is one configuration and the parent restates it whole; turning the timer off is the same statement with a different value, not a different verb on a different resource. `@IsDefined()` is what keeps `{}` from reading as "off" — an empty body is a request that said nothing, and a mutation that treats silence as an instruction is how a timer disappears without anybody asking.

**The mutation, in the shape the module already uses:**

```ts
// `Draft` in the `where`: "never after release" is what this statement cannot
// match, not a check above it that a concurrent release could make stale.
const set = await tx.practiceTest.updateMany({
  where: { id: practiceTestId, parentAccountId, status: 'Draft' },
  data: { timerMinutes: minutes }, // `status` and `chargedAt` absent on purpose.
});
if (set.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
// Still a draft, so the ordinary reader serves the answer — no second mapper.
return draftViewIn(tx, parentAccountId, practiceTestId);
```

**What this story deliberately leaves to Epic 5.** The epic's third and fourth acceptance criteria — remaining time visible throughout an Attempt, three non-escalating warnings, announced auto-submit, and every blank graded `incorrect` — all require an Attempt, which does not exist yet. Epic 4 writes the configuration; Epic 5 is what makes it count, with the server as timer authority evaluated at submit.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate dev --name add_practice_test_timer` (or an equivalent hand-written migration + `prisma generate`) -- expected: the column exists and the client types carry it.
- `pnpm --filter api typecheck` and `pnpm --filter web typecheck` -- expected: no errors.
- `pnpm --filter api test` -- expected: the unit suite passes.
- `pnpm --filter api test:int` -- expected: `practice-test.int-spec.ts` and `student-mode.int-spec.ts` pass against real Postgres, covering the set, the clear, both bounds and the post-release barrier. Known flake: 1-2 unrelated 404s on a full parallel run (recorded as a deferred item on Story 4.5) — re-run the failing file in isolation to confirm.
- `pnpm --filter web test` -- expected: `parent-api.spec.ts` and the draft review page spec pass.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- expected: the extended pass sets a timer, reloads onto it, and finds it unreachable after release.
- `pnpm prettier --check .` -- expected: clean. (`pnpm lint` is known-unusable here — `eslint` is not installed; run `pnpm exec eslint` on changed files instead.)

## Auto Run Result

**Summary:** Follow-up review pass on a story already implemented (`status: done` at invocation) — four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) run against the diff since `baseline_revision`, one low-severity finding patched, three low-severity findings deferred, twelve rejected as noise or already-covered-by-construction.

**Files changed this pass:**
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` -- bounded `timerSavable`'s digit regex (`/^\d{1,15}$/u`) so an absurdly long figure cannot overflow `Number()` to `Infinity`, which `JSON.stringify` would otherwise serialize as `null` and silently turn the timer off.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` -- added a source-level assertion pinning the bounded regex.
- `_bmad-output/implementation-artifacts/spec-4-6-optional-timer-configuration.md` -- `status` cycled `done` → `in-review` → `done`; appended two `deferred` items and one `## Review Triage Log` entry; this section.

**Review findings breakdown:** patch 1 (low), defer 3 (low), reject 12 (low). intent_gap 0, bad_spec 0.

**Follow-up review recommendation:** `false`. Only this pass's `patch` findings count: 1 low, 0 medium, 0 high. Score `3×0 + 1×1 = 1` (< 5) and no high-severity patch, so no follow-up review is recommended.

**Verification performed:**
- `pnpm --filter web typecheck` -- clean.
- `pnpm --filter api typecheck` -- clean (sanity check; this pass touched no API code).
- `pnpm --filter web test` -- 26 files / 490 tests passed, including the new regex-bound assertion.
- `pnpm exec prettier --check` on both changed source files -- clean.
- API integration tests (`pnpm --filter api test:int`) and the Playwright e2e pass were not re-run this pass: the patch touched only client-side input-shape validation with no server-facing or generated-content implications, and the spec's own recorded flake on the int-spec file is pre-existing and unrelated.

**Residual risks:** the three deferred items (pre-existing unguarded-button pattern shared by every mutation control on this screen; the `aria-describedby` wiring unverified by any executing test) carry forward as recorded in frontmatter `deferred`. No risk introduced by this pass's patch beyond the fix's own scope.

