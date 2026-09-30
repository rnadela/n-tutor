---
title: 'Story 5.7 — Retaking a Practice Test'
type: 'feature'
created: '2026-09-27'
baseline_revision: '11542fd3e4bcbcb119a21a7d64fb6c34f75b4092'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The retake route has no ceiling on runs and no per-child rate limit, so Attempt
      rows and the grading spend each handed-in run costs are both unbounded.
    evidence: |-
      `POST /api/student/practice-tests/:id/retake` inserts at `latest.ordinal + 1`
      with no maximum ordinal, and `StudentPracticeTestController` declares no
      throttle stance for it. Every retake that is handed in costs a provider call at
      grading time, so a child pressing the control repeatedly is unbounded spend.
      Neither the intent contract nor the epic asks for a cap, which is why this is
      recorded rather than added here.
    location: >-
      apps/api/src/practicetest/student-practice-test.controller.ts
    severity: medium
operator_actions:
  - >-
    Free TCP ports 3000 and 3001 by stopping the n-electric dev servers currently
    holding them (a Next server on 3000 and apps/api/dist/main on 3001), then run
    `pnpm db:up && pnpm db:migrate && pnpm e2e -- student-submit-attempt` plus
    `pnpm e2e -- student-attempt-resilience`, `pnpm e2e -- student-take-test` and
    `pnpm e2e -- student-mode`, and report any failure. The e2e layer is the only
    verification this story could not perform: `apps/web`'s start script pins port
    3000 and `NEXT_PUBLIC_API_URL` is baked at build time, so the suite cannot be
    moved to other ports without editing repository files outside this story.
---

<intent-contract>

## Intent

**Problem:** A finished Practice Test is a dead end. `startOrResumeAttempt` returns *any* existing Attempt by design — "a second row would be a retake, and retakes are Story 5.7's" — so a child who opens a completed test gets the same answer key forever with no way to practise it again, and nothing anywhere states which Attempt of a multi-run test is the one Mastery will count.

**Approach:** Add the one student-scoped write that opens a *second* run at a Practice Test — a new Attempt at the next `ordinal`, with the same Questions and a fresh deadline — reachable from the results screen the child already lands on, and one read that states a test's run history so the card can show first score, latest score and run count together with the first named as the one counting toward Mastery. Mastery itself is Epic 7's; what this story owes it is the single canonical predicate for "this Attempt counts", stated once, and a retake that cannot touch it.

## Boundaries & Constraints

**Always:**
- A retake **inserts a new `Attempt` row** at `latest.ordinal + 1` with a `startedAt` and (for a timed test) an `expiresAt` written by the server from its own clock at that moment, exactly as `startOrResumeAttempt`'s insert does. Prior Attempts, their `Answer` rows and their `QuestionGrade` rows are never read for writing, never touched and never deleted.
- `startOrResumeAttempt` keeps its **exact current behaviour and shape**: it still returns the latest Attempt by `ordinal desc` whether open or submitted, still never inserts when one exists, and is still the only route the take-test screen opens a run with. After a retake it resumes the retake, because the retake is now the latest row. Every existing assertion against it keeps passing unchanged.
- Retaking is refused unless the child's **latest** Attempt at that test is handed in. An open latest Attempt and no Attempt at all are one refusal, one 409 and one sentence: two open Attempts would give the resume read two answers and split the client-held store, and there is nothing to retake at a test never sat.
- Ownership refusals stay the one shared `PRACTICE_TEST_NOT_FOUND` 404 with no `ParseUUIDPipe`: a draft, a discarded row, a sibling's release, another account's test and an id that never existed are indistinguishable. Both ids come off `req.student`; the path names only *which* test.
- **Question content and Question order are unchanged by a retake.** The new Attempt presents the same Questions in the same stored `ordinal` order, so nothing about a retake can alter a Question, an answer key, a `QuestionGrade` of an earlier run, or the order the results of either run are read in.
- **`ordinal === 1` is the one definition of "counts toward Mastery"**, stated in exactly one place in `grading` and used by every surface and by Epic 7. A retake is `ordinal > 1`, so it is excluded by construction and not by a filter somebody has to remember.
- The run-history read states `attemptCount`, the first run's score and the latest run's score over **handed-in** Attempts only, with `scoreOf` as the sole denominator on both. A run still open is not a score and is not counted.
- The single-run case is a shape the surface can tell apart without arithmetic: one run answers with `first` and `latest` naming the **same** Attempt id and `attemptCount: 1`, and the card then shows one score with no first/latest framing.
- Nothing parent-scoped reaches either endpoint or either surface: no grading rationale, no Topic label, no cost, tier, allowance or model name (AD-20, AD-26). Neither new view has a field one could travel in.
- `grading` stays the sole reader of `QuestionGrade` and reaches `practicetest` only through `PracticeTestService`; the arrow stays `grading → practicetest` with no `forwardRef`. The Attempt insert is `practicetest`'s, because `Attempt` is `practicetest`'s entity.
- Every user-facing string is parameterized in `copy/`, second person, no exclamation mark, no error code. The retake control and the score lines appear with no flourish: no count-up, no reveal, no celebration, no badge, no streak, no "personal best".
- Every existing student e2e and integration assertion keeps passing: the handed-in panel, its heading and focus, the auto-submit `role="alert"`, the results answer key, Student Home's order and its three state labels.

**Block If:**
- Producing a retake would require mutating a prior Attempt, its Answers or its grades, or a second `PracticeTestStatus` member to record completion.

**Never:**
- **No shuffle.** The epic permits one ("order *may* shuffle") and this story declines it: shuffling needs a per-Attempt order column, and stored-`ordinal` order is what the answer key, `answerKeyRows`, `gradingInputFor` and eleven existing assertions all read in. Content unchanged and order unchanged satisfies the criterion.
- No Mastery table, column, recompute or value — FR-26 is Epic 7's. This story writes the predicate and nothing that consumes it.
- No change to `startOrResumeAttempt`'s route, response or resume rule; no retake reachable from that route; no `GET` that can create an Attempt.
- No cap on retakes, no cooldown, no allowance charge, no attempt-limit copy: generation is what costs, and a retake generates nothing.
- No Explanations, no grade dispute, no parent override, no parent-facing Attempt history surface (Epic 6, Parent View).
- No score, grade word or answer key on the **pre-hand-in** take-test screen, and no new route or page file: the retake is pressed on the state the results already render in.
- No per-Attempt re-read of the practice test on retake: the Questions are already on screen and unchanged.
- No `Completed` derived-state change on Student Home: an open retake already reads `InProgress` by `studentListState`'s existing rule, which is the reading this story needs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Retake a finished test | latest Attempt submitted, `ordinal: 1` | 201: a new `AttemptView` with `ordinal 2`'s id, a fresh `startedAt`, `expiresAt` from the test's current `timerMinutes` or null, `submittedAt: null`; the prior Attempt, its Answers and its grades are byte-identical afterwards | No error expected |
| Retake while a run is open | latest Attempt has `submittedAt: null` | 409, one sentence, nothing inserted | Stated, never retried |
| Retake a test never sat | released, no Attempt rows | 409, the **same** sentence as above, nothing inserted | Stated, never retried |
| Retake not-yours / unknown | sibling's, another account's, a draft, a malformed id | 404 `PRACTICE_TEST_NOT_FOUND` | One sentence, no 400 |
| Two retake presses at once | two requests race the same `ordinal + 1` | one insert wins; the loser answers with **the winner's** Attempt, not a third row | Unique-violation caught, latest row resumed |
| Resume after a retake | retake open, `GET`/`POST` start route | the **retake** comes back with its own instants; the earlier Attempt is not returned | No error expected |
| Run history, multi-run | 3 handed-in Attempts | `attemptCount: 3`, `first` = ordinal 1 with `countsTowardMastery: true`, `latest` = ordinal 3 with `countsTowardMastery: false` | No error expected |
| Run history, single run | 1 handed-in Attempt | `attemptCount: 1`, `first` and `latest` carry the **same** `attemptId`, both `countsTowardMastery: true` | No error expected |
| Run history, open run only | 1 Attempt, not handed in | no entry for that test at all | No error expected |
| Run history, ungraded present | a run with `Ungraded` rows | that run's `score` excludes them and reports `excludedUngraded`, by `scoreOf` | No error expected |
| Run history read fails | request rejects | Student Home renders every row exactly as today, with no score line and no alert | Degraded, never retried on a timer |
| Retake press fails | 409, 500, offline | the results stay on screen untouched, the failure is stated beside the control, the control stays pressable | Stated, never auto-retried |

</intent-contract>

## Code Map

**API — `practicetest`, the Attempt insert**

- `apps/api/src/practicetest/practice-test.service.ts:940` `startOrResumeAttempt` — **the template and the thing not to change.** Its `open` callback shows the whole shape: all three ids plus `status: 'Released'` in one `where`, the shared 404, `attempt.findFirst({ orderBy: { ordinal: 'desc' }, select: ATTEMPT_SELECT })`, the `startedAt`/`expiresAt` pair written from `new Date()` and `test.timerMinutes`, and the `isUniqueViolation` catch that **re-runs the whole transaction** because Postgres aborts it on a constraint violation. Its doc says `ordinal: 1` is "always 1 while there are no retakes" and that the column exists "so Story 5.7 has somewhere to put a second run" — both sentences are this story's to rewrite.
- `:1065` `closeAttempt` — read-only here: what a handed-in Attempt looks like, and the `tx`-taking cross-module shape.
- `:312` `AttemptView` / `attemptViewOf` — the exact view a retake answers with; no new view type is needed for the insert.
- `:832` `releasedFor` — Student Home's list read, unchanged by this story (no score field is added to `PracticeTestReleasedSummary`), and the precedent for `readSubjectLabels` batching.
- `apps/api/src/practicetest/practice-test-policy.ts:218` `PRACTICE_TEST_NOT_FOUND`, `:235` `ATTEMPT_ALREADY_SUBMITTED` — the 404 sentence and the **409-on-a-rule precedent**, with the doc paragraph explaining when a child is entitled to know which rule. The new refusal constant belongs beside it. `:547` `StudentListState`, `:566` `studentListState` — already documents "an open Attempt outranks a submitted one … which is the reading Story 5.7 needs too": no change.
- `apps/api/src/practicetest/student-practice-test.controller.ts` — the `@Post('practice-tests/:practiceTestId/attempt')` route is the shape the retake route copies (no body, no `ParseUUIDPipe`, ids off `req.student`). The controller doc's "exactly **one** student-scoped write mounted here" sentence becomes two.

**API — `grading`, the run history and the Mastery predicate**

- `apps/api/src/grading/grading-score.ts:57` `scoreOf` + `AttemptScore` — the **one** denominator. Everything scored here goes through it.
- `apps/api/src/grading/grading.service.ts:330` `resultsFor` — the precedent for composing a student view in `grading` off a `practicetest` read plus a two-column `questionGrade.findMany`. `:537` `scoreFor` — the same padding rule (`?? null` per presented Question) the history read needs. `:234` `resolveUngraded` — **not** called by the history read: history is a list read over many tests and must not fire a billed re-ask per row.
- `apps/api/src/grading/grading-results.ts` — where the file-local pure composer + its view interfaces live; the pattern the new history composer follows.
- `apps/api/src/grading/student-attempt.controller.ts` — the student-scoped controller in this module (`@Controller('student')`, `@SkipThrottle({ login: true })`, `StudentModeGuard`, ids off `req.student`, one-sentence refusals). The history `@Get` belongs here.
- `apps/api/src/grading/grading.module.ts` — unchanged: `PracticeTestModule` and `StudentModeGuard` already imported.
- `apps/api/prisma/schema.prisma:1031` `model Attempt` — `ordinal` is already there with `@@unique([practiceTestId, studentProfileId, ordinal])` and the index `[practiceTestId, submittedAt]`. Its `ordinal` doc comment ("Retakes are Story 5.7's") is this story's to rewrite. **No migration and no new column.**

**Web**

- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx:228` the render-phase reset keyed on `loadedTestId` — the exhaustive list of what "a new run" has to clear, including the two refs (`deadlineActedFor`, `previousRemaining`) the reset reaches by hand. `:800` the `submitState === 'done'` branch — where the retake control goes, beneath `<AttemptResults />`. `:307` the start-attempt effect — the path that sets `submitState: 'done'` on a resumed submitted Attempt, and the reason the retake handler must take a fresh `AttemptView` rather than re-fetch.
- `apps/web/src/app/student/_components/AttemptResults.tsx` — read-only except for the retake slot: it already owns loading, the failure alert with `Try again`, the `pending` guard on a second press and the `deviceIsUnbound`-only routing rule. `AnswerKeyRow.tsx`, `GradeStateMarker.tsx` — untouched.
- `apps/web/src/app/student/page.tsx` — Student Home: two **independently settled** reads with their own failure states and a `requestId` ref guarding stale responses; the history read joins them as a third with the same discipline. `_components/PracticeTestList.tsx` / `PracticeTestRow.tsx:29` — the row renders a Subject, a link and a state label and nothing else; the run line is added here, and `PracticeTestRow.spec.tsx:29`'s `render` + `:42` `colourless` helpers are how it is proved readable with all styling stripped.
- `apps/web/src/lib/parent-api.ts:277` `StudentPracticeTestSummary`, `:369` `GradeState`, `:385` `AttemptScore`, `:427` `AttemptResultsView` — where the new view types go; `:852` `startAttempt` and `:897` `attemptResults` are the exact call shapes (no bearer, binding cookie, `call<T>(path, init, fallbackCopy)`).
- `apps/web/src/copy/student.ts:240` `results` — the results copy block the retake strings join; `:46` `practiceTestState` is the precedent for an exhaustive switch that falls through to nothing. `apps/web/src/copy/common.ts` `gradeState` — the four literals, untouched.
- `apps/web/src/lib/results-summary.ts` + `.spec.ts` — the precedent for a pure, DOM-free helper with its own spec, and where the run-line formatting helper belongs if the copy module cannot express it alone.
- `apps/web/src/theme/tokens.ts:171` `typeRoles` (`caption`, `label`, `dashboardBody`), `:79` `comfortableDensity` (`tapTarget`) — **no new token and no new colour.**

**Tests**

- `apps/api/test/practice-test.int-spec.ts:3330` `startAttempt`, `:3337` `submitAttempt`, `:3349` `setTimerMinutes`, `:3357` `releasedForChild` (returns `questionIds` in ordinal order), `:2350` `withLandedDrafts` — the machinery the new cases use over the real HTTP path, beside Story 5.6's block.
- `apps/api/src/practicetest/practice-test-schema.ts:88` `fakePracticeTestPayload` — deterministic: the correct Multiple Choice option is always ordinal 1 with body `Option A for <draftOrdinal>.<seq>`, free-text answers are `Answer for <draftOrdinal>.<seq>`. `apps/api/test/harness.ts:261` `AiCapture.failNext(kind)` is how a run is forced to carry `Ungraded` rows.
- `e2e/fixtures.ts:526` `newestAttemptFixture`, `:563` `countAttemptsFor`, `:622` `questionGradesFor` — read-only proof that a retake inserted a second row and that the card's figures agree with the grade table. `e2e/tests/student-submit-attempt.spec.ts`, `student-attempt-resilience.spec.ts`, `student-take-test.spec.ts`, `student-mode.spec.ts` — the suites whose existing assertions must not move.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/practicetest/practice-test-policy.ts` — add `ATTEMPT_NOT_RETAKEABLE`, the one sentence a retake's own refusal gets: second person, states the rule, names no count, no score and no grade word (e.g. `You can only retake a practice test you have finished.`). Doc it beside `ATTEMPT_ALREADY_SUBMITTED` and for the same reason: it is a 409 on a **rule** the child is entitled to know, where a 404 would say the test does not exist while it is on their screen — and it deliberately covers **both** an open latest run and a test never sat, because "you have not finished this" is the same true statement about both and two sentences would let a child tell the two apart for no benefit.
- `apps/api/src/practicetest/practice-test.service.ts` — add `startRetake(parentAccountId, studentProfileId, practiceTestId): Promise<AttemptView>`. One transaction: the same one-`where` released lookup and shared 404 as `startOrResumeAttempt`; the latest Attempt by `ordinal desc`; **409 `ATTEMPT_NOT_RETAKEABLE`** when it is absent or its `submittedAt` is null; otherwise insert at `latest.ordinal + 1` with `startedAt = new Date()` and `expiresAt` from the test's `timerMinutes` snapshotted now, selecting `ATTEMPT_SELECT`. Wrap it in the same `isUniqueViolation` catch — but on a lost race **do not re-run the insert**: re-read the latest Attempt and return it, because a second run of the same decision would compute `ordinal + 2` and leave the child with two open runs where they pressed once. Doc: why a retake is its own method rather than a flag on `startOrResumeAttempt` (that route's whole promise is that it never inserts when a row exists, and a query flag able to create a run would make every reload a potential new deadline); that Questions and their order are untouched, so nothing here reads a Question at all; and that prior Attempts, Answers and grades are not in any statement this method makes. Rewrite the two "retakes are Story 5.7's" paragraphs on `startOrResumeAttempt` to name this method and to say that resuming after a retake returns the retake because it is the latest row.
- `apps/api/src/practicetest/student-practice-test.controller.ts` — add `@Post('practice-tests/:practiceTestId/retake')` returning `AttemptView`, ids off `req.student`, **no body**, no `ParseUUIDPipe`, 201 (Nest's default: unlike hand-in, something genuinely is created). Doc: the second student-scoped write this controller mounts and why it is a route of its own rather than a mode of the start route; that nothing student-authored is read here either; and the 404/409 split. Update the controller doc's "exactly **one** student-scoped write" sentence.
- `apps/api/src/grading/mastery-eligibility.ts` — **new**, pure and file-local: `MASTERY_ATTEMPT_ORDINAL = 1` and `countsTowardMastery(ordinal: number): boolean`. Doc that this is the **single** definition FR-26 and Epic 7 read, that a retake is excluded by being `ordinal > 1` rather than by a filter at each call site, and that it is stated here because Mastery is `grading`'s (AD-6) even though `ordinal` is `practicetest`'s column. Plus `mastery-eligibility.spec.ts`: ordinal 1 counts, 2 and 3 do not, and the exported constant is what the predicate compares against.
- `apps/api/src/practicetest/practice-test.service.ts` — add `submittedRunsFor(parentAccountId, studentProfileId): Promise<AttemptRun[]>` with `AttemptRun = { attemptId, practiceTestId, ordinal, submittedAt: string, questionCount }`: every handed-in Attempt of this child at a `Released` test, `orderBy: [{ practiceTestId: 'asc' }, { ordinal: 'asc' }]`, selecting the owning test's `questionCount` in the same round trip. Doc that `questionCount` travels with the run because the presented set of a released test is frozen by Epic 4's write barrier, so the count is the same for every run of it — and that it carries no grade, no answer and no Question, because the module that reads grades is the caller.
- `apps/api/src/grading/grading-history.ts` — **new**: `AttemptRunView = { attemptId, ordinal, submittedAt, score: AttemptScore, countsTowardMastery: boolean }`, `PracticeTestRunsView = { practiceTestId, attemptCount, first: AttemptRunView, latest: AttemptRunView }`, plus pure `runsOf(runs, statesByAttempt)` grouping by `practiceTestId`, scoring each named run with `scoreOf` padded to `questionCount` (`states[i] ?? null`, exactly as `scoreFor` does), stamping `countsTowardMastery` from `countsTowardMastery(ordinal)`, and emitting `first`/`latest` as the same object identity's data when there is one run. Doc: there is deliberately no `rationale`, no Topic and no cost field; only the first and latest runs are scored because they are the only two any surface states; and a single run answers with `first` and `latest` naming the same `attemptId` so the surface tells the two cases apart by data rather than by arithmetic. Plus `grading-history.spec.ts`: three runs score independently and mark only ordinal 1; one run yields identical `first`/`latest` ids with `attemptCount: 1`; a run with fewer grade rows than `questionCount` reports the missing ones as `excludedUngraded`; no `rationale`-shaped key appears anywhere in the output (assert over `JSON.stringify`).
- `apps/api/src/grading/grading.service.ts` — add `runHistoryFor(scope): Promise<PracticeTestRunsView[]>`: `submittedRunsFor`, then one `questionGrade.findMany` over **only the first and latest attempt id of each test**, selecting `attemptId`, `questionId` and `state` and nothing else, then `runsOf`. Doc why `resolveUngraded` is **not** called here even though FR-22 makes viewing the trigger: this is a list read over every test on Student Home, a re-ask per row would spend a provider call per card on every visit to the child's home screen, and the results screen is still the trigger FR-22 names. Also doc that a rationale never selected is a rationale no mapper can leak.
- `apps/api/src/grading/student-attempt.controller.ts` — add `@Get('practice-tests/runs')` calling `runHistoryFor` with both ids off `req.student`. Doc: it is mounted in `grading` and not beside the practice-test list because a score is a grade fact and `grading` is its sole reader (AD-6, AD-17) — a `practicetest` controller reaching for it would reverse the module arrow; it carries no rationale, no Topic and no parent figure; a child with nothing handed in answers `[]` and never a 404.
- `apps/api/test/practice-test.int-spec.ts` — new cases over the unchanged HTTP path, beside Story 5.6's block: a retake after a hand-in answers 201 with a new id and `ordinal 2`'s fresh instants while the first Attempt's row, its Answers and its `QuestionGrade` rows are unchanged; the start route then resumes the **retake**; the retake's own results read answers its own rows independent of the first run's; a retake on an open Attempt and on a never-sat released test both answer 409 with the identical `ATTEMPT_NOT_RETAKEABLE` sentence and insert nothing (`attempt.count` unchanged); a sibling's test, another account's, a draft and a malformed id all answer the one 404; a timed test retaken after its `timerMinutes` was changed takes the **current** value; the runs read after two hand-ins states `attemptCount: 2` with the first marked `countsTowardMastery` and the second not, and after one hand-in states `attemptCount: 1` with the same id in `first` and `latest`; a test with only an open Attempt is absent from the runs read; `failNext('transport')` leaving a run `Ungraded` is reflected in that run's `excludedUngraded`; and the serialized runs body carries no `rationale`, `topic`, `cost`, `tier` or `model` key (assert over `JSON.stringify`).
- `apps/web/src/lib/parent-api.ts` — add `AttemptRunView` and `PracticeTestRunsView` beside the other student types, `retakeTest(practiceTestId)` beside `startAttempt` (no bearer, no body, `POST`), and `practiceTestRuns()` beside `studentPracticeTests`. Doc on each: the binding names the child; what the views cannot carry (no rationale, no Topic, no allowance figure); that `retakeTest` **creates** where `startAttempt` resumes, so a screen must never call it to recover from a failure; and that `practiceTestRuns` fires no re-ask, unlike `attemptResults`.
- `apps/web/src/copy/student.ts` — add to `results`: the retake control label (`Practise this again`), its in-flight label, and `Your retake could not be started.` as the fallback. Add a `runs` block: the multi-run line as three parameterized parts joined by `·` — first score, latest score, and the run count with a singular form — plus the short sentence naming the first run as the one that counts toward progress, and the single-run line with **no** first/latest framing. Second person, no exclamation mark, no error code, no grade word on any pre-hand-in surface. Doc that the run count is over finished runs only, and that the word for Mastery on a child's screen is plain (`progress`), never the parent's term.
- `apps/web/src/lib/practice-test-runs.ts` + `practice-test-runs.spec.ts` — **new**, pure and DOM-free: `runLineOf(runs)` choosing between the single-run and multi-run shapes by comparing `first.attemptId` to `latest.attemptId` and `attemptCount`, and returning the parts (not a rendered node) so the spec can assert the choice without a DOM; and `runsById(runs)` indexing the array for the row lookup. It computes **no** score and **no** denominator — both arrive from the API — and the spec asserts the returned shape says so.
- `apps/web/src/app/student/_components/PracticeTestRow.tsx` + `PracticeTestRow.spec.tsx` — accept an optional `runs: PracticeTestRunsView | undefined` prop and render the run line beneath the state label: the single-run form for one finished run, the multi-run form plus the counts-toward-progress sentence for more, and **nothing at all** when the prop is absent (the read failed, or no run is finished) — a row with no figure is the row that shipped in Story 5.1 and is still complete. Extend the spec: both shapes render as text, the absent prop renders no extra line, and the `colourless` helper proves every figure and the first/latest distinction survive with all colour, class and inline style stripped.
- `apps/web/src/app/student/_components/PracticeTestList.tsx` — pass each row its own entry from a `runs` map prop. Still no sort, no filter, no grouping: the map is a lookup, never an order.
- `apps/web/src/app/student/page.tsx` — read `practiceTestRuns()` as a **third independently settled** read under the existing `requestId` guard, applied only while it is the most recent request, and pass its lookup down. On failure: no alert and no routing — the rows render exactly as they do today. Doc why this one read degrades silently where the list's does not: the list *is* the screen and its absence leaves a child with nothing to act on, while a score line is an annotation on rows that are fully usable without it, and an alert about a figure the child did not ask for would be noise on a child's home screen. `deviceIsUnbound` stays the one exception that routes.
- `apps/web/src/app/student/_components/AttemptResults.tsx` — accept an optional `onRetake` render slot (or `footer`) and render it after the rows, so the component keeps owning its own read and its own failure and gains no knowledge of retaking. Doc that the control is the page's because only the page owns the run state a retake replaces.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` — in the `submitState === 'done'` branch only, render a `Practise this again` control beneath `<AttemptResults />`. Its handler calls `parentApi.retakeTest(practiceTestId)`, and on success **begins the new run in place** from the returned `AttemptView`: set the new attempt, stamp `syncedAt`/`now`, clear `answers`, `index`, `mapOpen`, `confirmingHandIn`, `warning`, `submitNote`, `autoSubmitting`, `waitingForOnline`, `submittedAttemptToClear`, set `submitState` back to `'open'`, and clear both refs (`deadlineActedFor`, `previousRemaining`) — the same list the render-phase reset clears, minus `test` and `error`, because the Questions are unchanged and re-reading them would be a second answer to a question already answered. `hydratedFor` is left alone: it is compared against `attempt.id`, so the new id re-runs hydration by itself and finds nothing stored. A single in-flight guard prevents a second press; a failure is stated beside the control and never retried on its own, and it never routes (except `deviceIsUnbound`). Doc why the reset is duplicated rather than extracted: the render-phase one is a *different* event — a different test, whose Questions must be re-read — and folding the two would make a retake able to blank the test read.
- `apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx` — extend: the done branch renders the retake control; a successful retake returns the screen to the working state with the new Attempt's id, no answers and `index` 0; a failed retake leaves the results and the control in place with the failure stated; the existing auto-submit, focus and handed-in assertions still hold.
- `apps/web/src/app/student/page.spec.tsx` — extend: a successful runs read puts the figures on the matching rows only; a failed runs read leaves every row and the list order exactly as before with no alert; a runs entry for a test not in the list is ignored.
- `e2e/tests/student-submit-attempt.spec.ts` — extend the existing hand-in run **after** its current assertions: press `Practise this again`, land back on Question 1 of the same Questions in the same order with nothing pre-filled, `countAttemptsFor` reports two, answer differently and hand in, then read the second run's own answer key; return to `/student` and read the row's `First … · Latest … · 2 attempts` line with the first named as the one counting toward progress, cross-checked against `questionGradesFor` for both runs. Keep the existing "no grade vocabulary before hand-in" assertion intact.

**Acceptance Criteria:**

- Given a child on the results of a finished Practice Test, when they press the retake control, then a second Attempt exists, the screen is back on the first Question with nothing pre-filled, and the earlier Attempt, its answers and its grades are unchanged and still readable.
- Given a retake in progress, when the child leaves and re-opens that Practice Test, then the retake is resumed with its own instants and the earlier Attempt is not returned.
- Given a Practice Test with more than one finished run, when its row is read on Student Home, then the first run's score, the latest run's score and the run count appear together, with the first named as the one counting toward progress.
- Given a Practice Test with exactly one finished run, when its row is read, then one score appears with no first/latest framing and no run count.
- Given a retake of a test whose Questions were never changed, when both runs' results are read, then both list the same Questions in the same order with each run's own answers and grades.
- Given any Attempt after the first, when the Mastery predicate is applied to it, then it does not count — and the predicate exists in exactly one place in the codebase.
- Given a run line and a run score rendered with all colour, class and inline styling stripped, when the markup is read, then which figure is the first and which is the latest is still unambiguous from the words alone.
- Given the existing student take-test, resilience, submit and Student Home suites, when they run unchanged, then every assertion still holds.

## Spec Change Log

- **The run-history route is `GET /api/student/practice-test-runs`, not `practice-tests/runs`.** The spec's literal path is unreachable: `practicetest` mounts `GET student/practice-tests/:practiceTestId`, and Nest registers that controller's routes *before* `grading`'s because `GradingModule` depends on `PracticeTestModule` — so a literal `runs` segment is swallowed by the parameter and answers the detail read's 404. Verified empirically (four integration cases failed with 404 on the spec's path and pass on the sibling path). A sibling path is the only arrangement whose reachability does not depend on module ordering. Everything else about the endpoint is as specified: mounted in `grading`, both ids off `req.student`, no path parameter, no re-ask.
- **The "timer changed between runs" integration case writes `timerMinutes` straight to the column.** `PUT /api/parent/practice-tests/:id/timer` is a draft-only write and answers 404 once a test is released (Epic 4's write barrier), so no route can produce the state the case is about. The claim under test is unchanged: the retake snapshots the column *as it stands now* rather than copying the first run's instants.
- **`runHistoryFor` selects `attemptId` and `state` only, not `questionId`.** The spec's
  Execution bullet names three columns, but the third is never read: the states are
  grouped into a list per Attempt and `scoreOf` tallies them, so the Question a verdict
  belongs to changes no figure. Review found the column selected and discarded, with the
  module doc claiming a keying the code does not have. Both were corrected together.
- **The run line has one copy variant the spec did not enumerate: `runs.notGradedYet`.** `AttemptScore.denominator` may legitimately be 0, and `0 out of 0` is not a sentence. The figure is replaced rather than divided, exactly as `results.nothingToScore` already does on the results screen.

## Review Triage Log

### 2026-09-27 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 1: (high 0, medium 1, low 0)
- reject: 14: (high 0, medium 5, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The run-history read had no case that could tell its profile
    scoping from its ownership scoping: every existing case was a single-profile
    account, so dropping `studentProfileId` from `submittedRunsFor`'s `where` kept the
    whole suite green while the endpoint returned a sibling's `attemptId`s and scores.
    Added a two-profile-on-one-account integration case (`releasedFor`, a new local
    helper that runs the whole source-test pipeline for an existing account's second
    profile, because `generatable` opens an account of its own). Mutation-checked: the
    case fails with that filter removed and passes with it restored.
  - `[medium]` `[patch]` The new retake-race case asserted both presses answer 201,
    which only holds when the two transactions genuinely interleave; serialized, the
    loser legitimately answers 409 `ATTEMPT_NOT_RETAKEABLE`. Rewritten to assert the
    invariant instead — one 201, the other 201 or 409, never a third Attempt row — with
    the winner's-row equality asserted only on the run where the collision happened.
  - `[medium]` `[patch]` The retake settle had no stale-response guard, unlike every
    other async settle on that screen: a retake landing after the route moved to another
    practice test would have installed that other test's Attempt as the current run.
    Now reads `requestId.current` at dispatch (never bumps it — the test read owns the
    counter) and drops both callbacks when it has moved. Pinned by a new page spec.
  - `[low]` `[patch]` `runHistoryFor` selected `questionId` and discarded it, and
    `grading-history.ts` documented a keying by `attemptId` **and** `questionId` that the
    code does not have. Column dropped from the `select`; both doc blocks corrected.
  - `[low]` `[patch]` The run-history leak case asserted the key shape of `first` only.
    Now asserts it over `first` and `latest` both.

Rejected as noise, with the reason: the broad `isUniqueViolation(cause)` check (the
repo-wide convention at seven pre-existing call sites); `timerMinutes: 0` producing an
already-expired retake (`MIN_TIMER_MINUTES` is 1 and `@Min` enforces it);
`attemptCount` of 0 or negative reaching `runLineOf` (`runsOf` emits an entry only for
a test with a finished run); the counts-toward-progress note being unconditional in the
multi branch (`first` is the lowest submitted ordinal, and a retake is refused until
ordinal 1 is handed in, so it is always the run that counts); no focus move or
announcement on a successful retake (the open state has no programmatic focus target on
a fresh arrival either, and the screen's own stated rule is that a transition the child
pressed for needs no announcement); the schema comment "overclaiming" a database
invariant (as amended it attributes at-most-one-open-run to the resume-and-refuse rules
and says the unique index expresses several rows per test); `model` missing from the
final loose regex of the leak case (it is in the keyed loop above it); the web specs
asserting over component source text (the `apps/web` workspace runs `environment:
'node'` with no router, which the specs state as their reason); and the remaining
observations that no admissible scope authority supports — a partial unique index on
open Attempts, extracting the duplicated grouping walk, `questionCount` versus the
results screen's own denominator, chunking the `attemptId` `in` list, and an
expired-but-unsubmitted latest run being unretakeable until the child re-opens the test.

## Design Notes

**Why the retake is its own route rather than a mode of the start route.** `startOrResumeAttempt`'s entire promise is that it never inserts while a row exists — that is what keeps a reload from handing out a fresh deadline, and it is asserted from outside in several places. A query flag or a body field able to make it create would make every path that calls it (mount, retry, second tab, reconnect) a path that could start a run the child did not ask for. A separate `POST` is the smallest change that keeps that promise literally true, and it is also where the 409 belongs.

**Why a lost race resumes instead of re-running.** `startOrResumeAttempt` recovers from `attempt_practiceTestId_studentProfileId_ordinal_key` by re-running its whole transaction, which is safe there because the second run finds the winner's row and returns it. Here the same recovery would re-read the latest ordinal — now the winner's — and insert again:

```ts
// Two presses, one run. The loser returns the winner's row rather than
// computing `ordinal + 2`: a child who pressed once must not end up with two
// open runs, and the unique index is the only thing that can tell us we lost.
if (!isUniqueViolation(cause)) throw cause;
return this.prisma.withTransaction(latestAttemptOf); // read-only, no insert
```

**Why one 409 sentence covers both "still open" and "never sat".** Both are the same true statement to a child — you have not finished this yet — and the test is visibly on their screen, so a 404 would be false. Splitting them would let a child distinguish "no run exists" from "a run is open", which tells them nothing they cannot see and adds a second sentence to a surface whose discipline is one.

**Why no shuffle.** The epic permits an order change; it does not ask for one. Taking it costs a per-Attempt order column and a new source of truth for "the order the child met the Questions in" — which `answerKeyFor`, `answerKeyRows`, `gradingInputFor`, the question map and eleven existing e2e assertions all currently read off `PracticeTestQuestion.ordinal`. Content unchanged and order unchanged satisfies the acceptance criterion as written, and the column can be added by a later story that actually wants it.

**Why Mastery is one predicate and nothing else.** FR-26, the rolling 5-Attempt window and every Mastery figure are Epic 7's. What this story owes Epic 7 is that "which Attempt counts" is already decided, stated in one file, and true of the data: retakes are `ordinal > 1` and nothing writes Mastery yet, so exclusion is currently free — and it stays free only if the predicate has exactly one home.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean across api, web and e2e. If the repo-root `eslint` binary does not resolve, run `eslint` per workspace on the touched files instead and say so.
- `pnpm typecheck` -- expected: no errors; `pnpm typecheck:e2e` also clean.
- `pnpm --filter api test` -- expected: the new `mastery-eligibility` and `grading-history` specs pass; existing unit specs unchanged.
- `pnpm --filter web test` -- expected: the new `practice-test-runs` spec passes; the extended `PracticeTestRow`, Student Home page and take-test page specs pass; every other web spec unchanged.
- `pnpm --filter api run test:int` -- expected: the new retake and runs cases pass and every pre-existing Attempt, submit and results case still passes at its unchanged path.
- `git status --porcelain apps/api/prisma` -- expected: `apps/api/prisma/schema.prisma` modified and **nothing under `migrations/`**. The only schema change is the `ordinal` doc comment; no column, no index and no migration.
- `pnpm db:up && pnpm db:migrate && pnpm e2e -- student-submit-attempt` -- expected: passes, including its pre-existing assertions; `student-attempt-resilience`, `student-take-test` and `student-mode` still pass.

## Auto Run Result

Status: done
Operator e2e verification (2026-09-30): ports 3000/3001 were free, no kill needed.
`pnpm db:up && pnpm db:migrate` ran clean. `student-submit-attempt` (5/5),
`student-attempt-resilience` (4/4), `student-take-test` (2/2), `student-mode` (8/8) —
19/19 passed via direct `npx playwright test <file>` (pnpm's `e2e -- <arg>` script did
not forward the filter arg and ran the full suite instead; direct invocation filtered
correctly).

### Summary

A Practice Test a child has finished is no longer a dead end. One new student-scoped
write opens a second run at it — a new `Attempt` at `latest.ordinal + 1`, the same
Questions in the same order, a deadline taken from the test's timer as it stands now —
reachable from the results screen the child already lands on. One new read states a
test's run history, so a card can show the first score, the latest score and the run
count together with the first named as the one counting toward progress. `ordinal === 1`
is now the single definition of "counts toward Mastery", stated in one file that Epic 7
reads, so a retake is excluded by construction rather than by a filter at each call
site. `startOrResumeAttempt` is behaviourally untouched: it still never inserts when a
row exists, and after a retake it resumes the retake because the retake is the latest
row.

### Files changed

- `apps/api/prisma/schema.prisma` — `Attempt.ordinal` and `submittedAt` doc comments
  rewritten. No column, no index, no migration.
- `apps/api/src/practicetest/practice-test-policy.ts` — `ATTEMPT_NOT_RETAKEABLE`, the one
  409 sentence covering both an open latest run and a test never sat.
- `apps/api/src/practicetest/practice-test.service.ts` — `startRetake` (insert at the next
  ordinal; on a lost race re-reads the latest row rather than re-deciding) and
  `submittedRunsFor` (handed-in runs at released tests, with the owning test's
  `questionCount`).
- `apps/api/src/practicetest/student-practice-test.controller.ts` —
  `POST practice-tests/:practiceTestId/retake`, 201, no body, no `ParseUUIDPipe`.
- `apps/api/src/grading/mastery-eligibility.ts` + spec — **new.** `MASTERY_ATTEMPT_ORDINAL`
  and `countsTowardMastery`, the single definition.
- `apps/api/src/grading/grading-history.ts` + spec — **new.** The two run views and the
  pure `runsOf` that scores only the first and latest run.
- `apps/api/src/grading/grading.service.ts` — `runHistoryFor`: the runs, one grade read
  over the scored attempt ids only, then `runsOf`. No re-ask.
- `apps/api/src/grading/student-attempt.controller.ts` — `GET practice-test-runs`.
- `apps/api/test/practice-test.int-spec.ts` — 13 new cases over the real HTTP path, plus
  the `releasedFor` helper for a second profile on an existing account.
- `apps/web/src/lib/parent-api.ts` — the two views, `retakeTest` and `practiceTestRuns`.
- `apps/web/src/copy/student.ts` — the retake control, its in-flight and failure copy, and
  the `runs` block.
- `apps/web/src/lib/practice-test-runs.ts` + spec — **new.** `runLineOf` and `runsById`,
  pure and DOM-free, computing no score and no denominator.
- `apps/web/src/app/student/_components/PracticeTestRow.tsx`, `PracticeTestList.tsx` and
  their specs — the run line beneath the state label, nothing at all when absent.
- `apps/web/src/app/student/page.tsx` + spec — the runs read as a third independently
  settled read under the existing `requestId` guard, degrading silently.
- `apps/web/src/app/student/_components/AttemptResults.tsx` — an optional `footer` slot, so
  the component gains no knowledge of retaking.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` + spec — the retake control in
  the handed-in state, beginning the new run in place with a stale-response guard.
- `e2e/tests/student-submit-attempt.spec.ts` — the hand-in run extended through a retake,
  a second hand-in, both answer keys and the row's run line.

### Review findings

- Patches applied: 5 — `(high 0, medium 3, low 2)`; score `3 × 3 + 1 × 2 = 11`.
- Items deferred: 1 (no ceiling or rate limit on the creating retake route).
- Items rejected: 14.
- Follow-up review recommended: **true** (score 11 ≥ 5).

### Verification performed

- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:e2e` — clean.
- `pnpm --filter api exec vitest run src` — 33 files / 498 tests pass, including the new
  `mastery-eligibility` and `grading-history` specs.
- `pnpm --filter web test` — 45 files / 853 tests pass, including the new
  `practice-test-runs` spec and the extended row, list, Student Home and take-test specs.
- `pnpm --filter api exec vitest run test/practice-test.int-spec.ts` — **196/196 pass** on
  a clean run, all 13 new cases included.
- `git status --porcelain apps/api/prisma` — only `schema.prisma` modified; nothing under
  `migrations/`.
- Mutation check on the new isolation case: removing `studentProfileId` from
  `submittedRunsFor`'s `where` fails it; restored, it passes.
- **Not run: the e2e suite.** `pnpm db:up` and `pnpm db:migrate` succeed, but
  `pnpm e2e -- student-submit-attempt` dies with `listen EADDRINUSE: address already in
  use :::3001` — another project's dev servers (a Next server on 3000, `n-electric`'s API
  on 3001) hold both fixed ports. Stopping another project's processes is not this run's
  to do, and the ports cannot be moved from here: `apps/web`'s `start` pins `-p 3000` and
  `NEXT_PUBLIC_API_URL` is baked at build time.

### Residual risks

- **The e2e assertions are unexecuted.** `e2e/tests/student-submit-attempt.spec.ts`
  typechecks and its additions are written, but no run has observed them. The retake
  control's rendering, the return to Question 1 and the Student Home run line are covered
  by unit and integration assertions; the full-stack path is not.
- **The integration suite is flaky in this environment, independent of this change.** Runs
  of `practice-test.int-spec.ts` failed 7, 2, 5 and 0 cases across four runs, always at a
  setup helper with a 404 and always on a different set. With every change stashed, the
  same file at `11542fd` failed 2 cases of its own. A red run here is not evidence about
  this story; re-run the file before reading anything into one.
- The retake route's missing ceiling and rate limit are recorded under `deferred`.
