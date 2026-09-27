---
title: 'Story 5.5 — Grading Engine & Four Grade States'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_revision: '7c8f83b667cfa913140a4f3b5f99b18a6a9c351d'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The API integration suite fails non-deterministically in a varying handful of
      cases across describes unrelated to this story, so a single green full run is
      not trustworthy gating.
    evidence: |-
      Reproduced on every run of this story's verification: one full-suite run failed
      5 cases in `parent-auth`/`parent-pin`, another 3 in `parent-pin`/
      `uncommitted-state`, and single-file runs of `practice-test.int-spec.ts` failed
      2 cases in "claiming" and "release and discard", then 1 in "the request" -- a
      different set each time, always in fixture setup (`elevate`, `generatable`'s
      upload, subject classification), never in a grading case. Every failing case
      passes when its file is run alone. The implementation agent reproduced the same
      failures with this story's work stashed at HEAD. Already recorded on Stories
      5.3 and 5.4 and still open.
    severity: medium
  - summary: >-
      `AttemptClosure.blankQuestionIds` is now computed by `closeAttempt` and consumed
      by nobody, and its doc still calls it the reason the hand-in transaction exists.
    evidence: |-
      Story 5.4 read it to write `Unanswered`; Story 5.5 derives every blank from
      `gradingInputFor`'s answer rows instead, because the same function must serve
      the retry pass where no closure exists. Grep finds the field written at
      `practice-test.service.ts:1101`, declared at `:361`, and read only by an
      int-spec assertion that the response body does *not* carry the key. Harmless but
      dead, and the surrounding prose is now wrong about why it is there.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts:361
    severity: low
  - summary: >-
      Nothing caps how often an Attempt's `Ungraded` Questions may be re-asked, so a
      results view that keeps failing spends a fresh Grading call on every refresh.
    evidence: |-
      FR-22 makes viewing the trigger and grading is deliberately exempt from every
      allowance, so `resolveUngraded` re-asks on each call with no attempt counter,
      cooldown column or minimum interval. A provider outage plus a child refreshing
      is unbounded spend. A cap is a product decision -- it would make some views not
      retry, which is the opposite of what FR-22 asks for -- so it is recorded rather
      than invented here.
    location: >-
      apps/api/src/grading/grading.service.ts:214
    severity: medium
  - summary: >-
      A Question whose stored correct answer is empty or unreadable stays permanently
      `Ungraded` with nothing distinguishing it from a transient grading failure.
    evidence: |-
      `askable` gates a Question on having a correct answer to grade against; one
      that can never produce a plain-text correct answer is retried by every
      `resolveUngraded` call exactly like a transient provider fault, and nothing
      marks or logs the difference between "will resolve on retry" and "can never
      resolve." A product decision on how to surface or cap this is not made here.
    location: >-
      apps/api/src/grading/grading.service.ts
    severity: medium
  - summary: >-
      The batched Grading call has no upper bound on how many free-text Questions it
      sends in one prompt.
    evidence: |-
      `buildGradingPrompt` batches every asked Question with no chunking or size
      ceiling; a Practice Test with many Fill-in-the-Blank/Short Answer Questions
      could produce a prompt near or past the provider's context/token limits, and
      neither the spec nor the tests address that case.
    location: >-
      apps/api/src/grading/grading-prompt.ts
    severity: medium
  - summary: >-
      No test exercises `resolveUngraded` against a truly legacy Attempt with zero
      grade rows at all, as opposed to one already carrying an `Ungraded` row.
    evidence: |-
      Existing cases delete a submitted Attempt's grade rows to simulate the
      row-less branch, but none represents an Attempt submitted before this story
      shipped, which never had grading run against it at all.
    location: >-
      apps/api/test/practice-test.int-spec.ts
    severity: low
  - summary: >-
      `writeGuarded`'s race-handling is covered by sequential simulation only; no
      test drives two truly concurrent writers to confirm the loser writes nothing.
    evidence: |-
      The fix recorded in the 2026-09-27 triage log changed the read-then-write to
      `createMany(skipDuplicates)` plus a guarded `updateMany`, but every case
      exercising it runs sequentially rather than racing two calls against the same
      rows.
    location: >-
      apps/api/src/grading/grading.service.ts
    severity: low
  - summary: >-
      No test covers grading or re-grading after the answer key drifts -- a Question
      removed or a choice's `isCorrect` flag changed between when an Attempt was
      answered and when it is graded.
    evidence: |-
      `gradingInputFor` and `resolveUngraded` both re-read the current Practice Test
      state at grading time, so a changed answer key silently changes the verdict of
      an already-answered Question; this drift scenario is absent from the I/O
      matrix and the tests.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Handing an Attempt in closes it and records `Unanswered` for a manual blank, and nothing else: an answered Question is never judged, no Multiple Choice option is ever matched, no Fill-in-the-Blank or Short Answer answer is ever sent for grading, a blank on an expired Attempt carries no state at all, and there is no score. Story 5.6's answer key and Epic 7's Mastery both read a table that today holds at most one of its four literals.

**Approach:** Make the submit transaction grade. Deterministic first and inside the closing transaction — Multiple Choice by exact option match, expired blanks `Incorrect`, manual blanks `Unanswered` as today — then one foreground `Grading` AI call for the answered Fill-in-the-Blank and Short Answer Questions, whose verdicts and short rationales are persisted in a second short transaction. Every grading failure degrades to `Ungraded`, never to wrong, and a `resolveUngraded` pass re-asks for exactly those Questions and reports the recomputed score plus which Questions just resolved, for Story 5.6's results read to call on view.

## Boundaries & Constraints

**Always:**
- FR-37's table is authoritative and is not restated with different rules: `Correct` and `Incorrect` are in the score denominator, `Unanswered` is in the denominator and earns no credit, `Ungraded` is **excluded** from the denominator and its count and reason are reported so a surface can state them.
- Only a Question the child actually answered is graded by FR-21/FR-22. A blank is never sent to a provider and consumes no model call.
- `Unanswered` is written only at manual submission of an unexpired Attempt, exactly as Story 5.4 writes it. A blank on an Attempt the server judged `expired` grades `Incorrect`. Grading never overwrites an existing `Unanswered`, and never overwrites an existing `Correct` or `Incorrect`.
- Multiple Choice is decided in code, deterministically, with no AI call and no network.
- Every AI-graded Question persists a grade **and** a short rationale on its own row, for the parent to read later. A rationale written only to a log does not satisfy this.
- Every provider call goes through `AiService` with `callClass: 'Grading'`, `modality: 'text'`, a Zod-derived schema and a fake payload builder, and is followed by deterministic post-hoc validation in code. Grading is never blocked by any allowance.
- Any grading failure — input fault, provider refusal, upstream exhaustion, or a payload the post-hoc pass keeps rejecting — writes `Ungraded` for the Questions it could not judge and lets the hand-in stand.
- `grading` stays the sole writer of `QuestionGrade` and reads `practicetest` only through `PracticeTestService`, never through a Prisma delegate of its own. The arrow stays `grading → practicetest`, with no `forwardRef`.
- The submit response keeps its exact shape: `submittedAt`, `expired`, `gradeAt` and nothing else. No grade, state, score, rationale or correct answer reaches a student-scoped response body or log line.
- No log line carries Question content, an answer, a rationale or a fragment of what the model said — identifiers, counts and money only.

**Block If:**
- FR-37's table and this spec disagree about a state's denominator, Mastery or Weak-Area treatment.
- A pending or fifth grade state appears to be required to make the retry path work.

**Never:**
- No results endpoint, results screen, answer-key surface, parent Attempt-detail surface or any web change: those are Story 5.6's and Epic 6's, and this story is the engine they call.
- No Mastery table, Mastery value or Mastery recompute — FR-26 is Epic 7's, and AD-10's "recompute inside the transaction that changed a grade" is satisfied here by there being nothing yet to recompute. No `Mastery` model, no placeholder column.
- No background job, queue, scheduled retry or polling for grading. Submission blocks on grading; the retry is triggered by a caller's view read.
- No fifth `GradeState` member, no `Pending`, no `Queued`, and no grade derived at read time from an empty answer field.
- No override path, no dispute, no Explanation, no Topic canonicalization.
- No change to the submit route's path, body, status codes or refusal sentences.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Answered Multiple Choice, right option | value is the ordinal of the choice flagged `isCorrect` | `Correct`, no rationale, no AI call | No error expected |
| Answered Multiple Choice, wrong or unreadable option | value is another ordinal, or not an ordinal at all | `Incorrect`, no rationale, no AI call | Never `Ungraded`: no provider was involved |
| Answered Fill-in-the-Blank / Short Answer | raw value, plus the stored correct answer and the Question's Topics | one batched `Grading` call; per Question `Correct` or `Incorrect` with a short persisted rationale | Any failure class writes `Ungraded` for every Question in that call |
| Equivalent but differently written answer | `"  answer for 1.2 "` against `Answer for 1.2` | `Correct` — casing, whitespace, notation and phrasing are tolerated | No error expected |
| Blank, manual submission | no `Answer` row, `expired: false` | `Unanswered`, unchanged from Story 5.4, no model call | No error expected |
| Blank, expired submission | no `Answer` row, `expired: true` | `Incorrect` | No error expected |
| Provider unavailable at submit | `AI_FAKE_FAILURE=transport`, retries exhausted | hand-in still succeeds with its usual 200 and shape; answered FIB/SA Questions are `Ungraded`; the deterministic verdicts stand | `Ungraded` written, no throw out of submit |
| Payload the post-hoc pass rejects | verdict list missing a Question or naming an unknown one | re-asked up to `AI_MAX_ATTEMPTS`, then `Ungraded` for whatever is unresolved | Rejection logged by Attempt id and attempt number only |
| `resolveUngraded` on an Attempt with `Ungraded` rows | submitted Attempt, one `Ungraded` Question | that Question is re-asked; on success its row becomes `Correct`/`Incorrect` with a rationale and its id is returned as newly graded, with the recomputed score | On failure the row stays `Ungraded`, nothing is returned as newly graded, and the read still answers |
| `resolveUngraded` with nothing outstanding | every Question carries a verdict | no AI call at all, no newly-graded ids, the score as stored | No error expected |
| `resolveUngraded` on a foreign or open Attempt | another account's or profile's Attempt, or one not submitted | the one shared `PRACTICE_TEST_NOT_FOUND` 404 | No partial work |
| Score with an outstanding `Ungraded` | 15 presented, 11 `Correct`, 2 `Incorrect`, 1 `Unanswered`, 1 `Ungraded` | `correct: 11`, `denominator: 14`, `excludedUngraded: 1` | No error expected |

</intent-contract>

## Code Map

**API — schema and migration**

- `apps/api/prisma/schema.prisma:1157` `QuestionGrade` — the table exists with `state`, `@@unique([attemptId, questionId])` and `@@index([attemptId])`. **Add `rationale String? @db.Text`** and rewrite the doc line "No rationale column and no score: Story 5.5 adds what its own verdicts need" into what this story actually added: a rationale that is null for a deterministic verdict, for `Unanswered` and for `Ungraded`, and set only where a provider judged. `:1131` `GradeState` already carries all four literals — **no enum migration**; update its "Story 5.4 writes exactly one of these" paragraph to say all four are now written and by which rule. `:1081` `Answer` (`value`, `@@unique([attemptId, questionId])`), `:1031` `Attempt` (`expired`, `submittedAt`, `expiresAt`), `:949` `PracticeTestQuestion` (`format`, `answer Json?`), `:976` `PracticeTestChoice` (`ordinal`, `isCorrect`), `:994` `PracticeTestQuestionTopic` (`label`) are the read inputs.
- `apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql` and the Story 5.4 `..._add_question_grade` migration beside it — the hand-written-DDL and commented-rationale convention to copy. One `ALTER TABLE ... ADD COLUMN` is the whole of this story's DDL.

**API — `practicetest`, the read edge**

- `apps/api/src/practicetest/practice-test.service.ts:961` `closeAttempt(tx, …)` — unchanged in behaviour; it already returns `AttemptClosure` with `blankQuestionIds` in stored ordinal order and the `expired` the server decided at `:975`. `:356` `AttemptClosure` / `:337` `AttemptSubmissionView` / `:271` `StudentQuestionView` are where a new **internal** grading-input view belongs, beside them and clearly marked as never a response body.
- The grading input is a **new read on this service**, because `grading` may not touch a `practicetest` delegate: it returns, per Question of the Attempt's Practice Test in ordinal order, the Question id, ordinal, format, prompt, stored correct answer, the ordinal of the choice flagged `isCorrect`, its raw Topic labels, and the child's stored `Answer` value or null. `:1091` `draftViewIn` is the precedent for a `tx`-accepting read that joins choices and topics in one round trip; `:1073` `draftFor` is the precedent for a read that opens its own transaction when no caller supplies one.
- `apps/api/src/practicetest/practice-test.module.ts` — already `exports: [PracticeTestService]`; nothing here changes.
- `apps/api/src/extraction/rich-text.ts:101` `plainTextOf`, `:85` `isRichText` — how a stored `Json` prompt or answer becomes prompt text. `landedPromptsFor` at `practice-test.service.ts:1724` is the precedent for an unreadable stored value being logged and skipped rather than thrown on, mid-way through work already paid for.

**API — `grading`, where the work lands**

- `apps/api/src/grading/grading.service.ts:63` `submitAttempt` — today: one transaction, `closeAttempt`, then `Unanswered` per blank when `!expired`. **This is the method this story grows**; every claim in its doc comment about the transaction, about blanks being the server's answer and about the unchanged response shape stays true.
- `apps/api/src/grading/grading.module.ts` — add `AiModule` to `imports` and rewrite the closing line "No AI module and no allowance module … Story 5.5 is what changes that."
- `apps/api/src/grading/student-attempt.controller.ts` — **untouched**. Same path, same body, same 200, same refusals.
- `apps/api/src/ai/ai.service.ts:113` `AiRunRequest` (`callClass`, `parentAccountId`, `modality`, `images`, `prompt`, `schema`, `schemaName`, `fakePayload`), `:217` `run` with its retry loop, `:27` `AiUpstreamError`, `:38` `AiInputError`, `:54` `AiRejectedError` — the three fault classes to catch. `apps/api/src/ai/ai-config.ts:26` already pins the `Grading` call class; `:34` `AI_FAKE_FAILURES` is the injectable failure set.
- `apps/api/src/practicetest/practice-test.service.ts:1641` `produceDraft` — **the pattern to copy for a post-hoc-validated AI call**: bounded by `this.ai.config.maxAttempts`, re-asking only on its own rejection type, logging the ids and the attempt number and never the model's words, rethrowing the last rejection on exhaustion. `apps/api/src/practicetest/practice-test-schema.ts:88` `fakePracticeTestPayload` and `:60` `PRACTICE_TEST_SCHEMA_NAME` are the fake-builder and schema-name conventions; `practice-test-prompt.ts` is the prompt-module convention (AD-17 carve-out); `practice-test-payload.ts` is the post-hoc-validator convention.
- `apps/api/src/prisma/prisma.service.ts:40` `withTransaction` — does not nest, and its own doc says Prisma's ceiling is five seconds unless a caller raises it. That is why the provider call is made **between** two transactions rather than inside one.

**API — tests**

- `apps/api/test/practice-test.int-spec.ts:3336` `submitAttempt(cookie, attemptId, answers)`, `:3355` `setTimerMinutes`, `:3357` `releasedForChild(timerMinutes)` (returns `questionIds` in ordinal order), `:2350` `withLandedDrafts` — the machinery Story 5.4's grade-row cases already use; this story's cases belong beside them, over the unchanged HTTP path.
- `apps/api/src/practicetest/practice-test-schema.ts:88` fake generation output is what those fixtures produce, and it is deterministic: the correct Multiple Choice option is always **ordinal 1**, and every Fill-in-the-Blank / Short Answer correct answer is the text `Answer for <draftOrdinal>.<seq>`. That is how an integration case answers a Question rightly, wrongly, or equivalently-but-differently without reading the answer key over HTTP.
- `apps/api/test/harness.ts:261` `AiCapture` (`sent`, `failNext(kind)`, `reset()`) wraps the real `run`, so a case asserts the call class and the call **count** (zero for an all-Multiple-Choice Attempt) and injects one failure; `:83` `createHarness` exposes `moduleRef`, which is how a case reaches `GradingService.resolveUngraded` while no route mounts it yet.
- `e2e/fixtures.ts:612` `questionGradesFor(parentEmail, attemptId?)` — already returns `questionId` and `state` per grade row in ordinal order, ownership-checked; its `SELECT` is where `rationale` joins. `e2e/tests/student-submit-attempt.spec.ts` is the spec that already submits with blanks and asserts grade rows.

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` -- add `rationale String? @db.Text` to `QuestionGrade`, doc-commented in the neighbours' voice: it is the evidence a parent decides an FR-25 override on, so it is a column and not a log line; it is null for a deterministic Multiple Choice verdict, for `Unanswered` and for `Ungraded`, because none of those is a judgement a provider explained; and it is `@db.Text` for the reason `Answer.value` is. Rewrite the `GradeState` and `QuestionGrade` doc paragraphs that say Story 5.4 writes one literal and that a missing row may mean an expired blank -- after this story every presented Question of a submitted Attempt carries a row, and absence means only "nothing has judged this yet".
- `apps/api/prisma/migrations/<timestamp>_add_question_grade_rationale/migration.sql` -- hand-written `ALTER TABLE "question_grade" ADD COLUMN "rationale" TEXT;` in the previous migrations' commented style, saying why it is nullable and why no backfill is needed. Exactly one migration.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `gradingInputFor(tx, parentAccountId, studentProfileId, attemptId)` returning the Attempt's `practiceTestId`, `expired`, `submittedAt` and one row per Question in stored ordinal order (`questionId`, `ordinal`, `format`, `prompt`, `answer`, `correctChoiceOrdinal`, `topics`, `answerValue`), with its view interface beside `AttemptClosure`. Doc it as the **answer key plus the child's raw answers** -- an internal read for `grading`, never a controller response and never a student-scoped view -- found by the attempt id **and** both binding ids so a foreign Attempt answers the one shared 404, joined in one round trip for the reason `draftViewIn` is, and ordered by ordinal so every downstream list is in the order the child was shown the Questions. It exists because grade state is `grading`'s and Practice Test rows are `practicetest`'s, and the module arrow forbids the second module reaching for the first one's delegate.
- `apps/api/src/grading/grading-schema.ts` -- **new**: `GradingPayload` (`verdicts: array of { questionOrdinal: number, correct: boolean, rationale: string }`), `GRADING_SCHEMA_NAME`, and `fakeGradingPayload(context)` closing over the asked Questions. Nothing optional and nothing bounded, for the reason `practice-test-schema.ts` states about strict Structured Outputs; every ceiling lives in the payload validator. The fake decides `correct` by case- and whitespace-folded equality of the raw answer against the stored correct answer's plain text, so the integration and e2e tiers can assert a right answer, a wrong answer and an equivalent-but-differently-written answer without a provider -- and the `transport`, `schema` and `unusable` latches each have to keep producing their fault at this seam (AD-22).
- `apps/api/src/grading/grading-prompt.ts` -- **new**: `buildGradingPrompt(questions)`, one line per asked Question carrying its ordinal, its prompt's plain text, its Topic labels, the correct answer's plain text and the child's raw answer. States the rules the payload is afterwards checked against in code: exactly one verdict per ordinal asked and no other ordinal; tolerate spelling, casing, whitespace, notation and phrasing; judge within the Question's own subject matter and never mark a mathematically right answer wrong for a spelling slip in a word beside it; and a rationale of one or two plain sentences addressed to the parent. This is the AD-17 carve-out, exactly as `practice-test-prompt.ts` is.
- `apps/api/src/grading/grading-payload.ts` -- **new**: `MAX_RATIONALE_LENGTH`, `GradingPayloadInvalid`, and `validateGradingPayload(payload, askedOrdinals)` returning one normalized verdict per asked ordinal -- rejecting a missing ordinal, a duplicate, an unknown one, and a rationale that is blank once trimmed, and trimming and capping the rationale to the ceiling here rather than in the schema. A model told to answer for four Questions answers for three often enough that this is the difference between three verdicts and a wrong one.
- `apps/api/src/grading/grading-score.ts` -- **new**: `AttemptScore` and pure `scoreOf(states: readonly (GradeState | null)[])` over one entry per **presented** Question, `null` for a Question with no row. `correct` counts `Correct`; `denominator` is every presented Question less the `Ungraded` and the `null`; `excludedUngraded` is how many were left out. Pure and file-local so FR-37's denominator column is assertable without a database, and one function so no surface can compute a second denominator.
- `apps/api/src/grading/grading.service.ts` -- grow `submitAttempt` and add `resolveUngraded(scope, attemptId)`. In the closing transaction: `closeAttempt`, then `gradingInputFor`, then every **deterministic** row in one `createMany` -- `Unanswered` for a blank when `!expired`, `Incorrect` for a blank when `expired`, and `Correct`/`Incorrect` for every answered Multiple Choice by comparing the trimmed raw value against `correctChoiceOrdinal` (an unparseable or unknown ordinal is `Incorrect`, never `Ungraded`: no provider was involved). Then, **outside that transaction**, the batched `Grading` call for the answered Fill-in-the-Blank and Short Answer Questions, re-asked on `GradingPayloadInvalid` up to `this.ai.config.maxAttempts`; then a short second transaction writing each verdict with its rationale, and `Ungraded` with no rationale for anything the call could not deliver -- `AiInputError`, `AiRejectedError`, an exhausted `AiUpstreamError` and an exhausted rejection all land there. No AI call at all when nothing is answered in those two formats. The write is guarded so grading **never overwrites** an existing row: read the rows for those Questions inside the transaction, insert where none exists, update only where the stored state is `Ungraded`, and leave `Unanswered`, `Correct` and `Incorrect` untouched. `resolveUngraded` is the same second half, scoped to a **submitted** Attempt's `Ungraded` and row-less Questions, taking `{ parentAccountId, studentProfileId? }` so either party reaches it, answering the shared 404 otherwise, and returning `{ score, newlyGradedQuestionIds }` -- the score from `scoreOf` over the stored states, and the ids only of Questions this pass resolved. Doc: why the provider call is between two transactions rather than inside one, why absence is still never a pending state, and that `ungraded` is a failure and never a queue.
- `apps/api/src/grading/grading.module.ts` -- import `AiModule`, and rewrite the "No AI module and no allowance module" paragraph: a provider call is made here now, as its own call class, and it is **never gated by an allowance** -- an unaffordable grade would be a child punished for a billing state.
- `apps/api/src/grading/grading-score.spec.ts` -- **new**: FR-37's denominator column, case by case -- `Correct` earns credit and counts; `Incorrect` counts and earns none; `Unanswered` counts and earns none; `Ungraded` is excluded and counted as excluded; `null` is treated as `Ungraded` is; an all-`Ungraded` Attempt has a zero denominator and does not divide by it; and the fully graded case excludes nothing.
- `apps/api/src/grading/grading-payload.spec.ts` -- **new**: a well-formed payload normalizes to one verdict per asked ordinal; a missing, duplicated or unknown ordinal is rejected; a whitespace-only rationale is rejected; an over-long rationale is capped rather than rejected; and the asked order is what comes back.
- `apps/api/test/practice-test.int-spec.ts` -- new cases beside Story 5.4's, all over the unchanged HTTP path: an answered Multiple Choice on the flagged option is `Correct` with no rationale and **zero AI calls**; another ordinal and a non-numeric value are both `Incorrect`; an answered Fill-in-the-Blank and Short Answer are `Correct` with a persisted non-empty rationale, and a differently-cased and whitespace-padded value is still `Correct` while a wrong value is `Incorrect` with a rationale; exactly one `Grading` call is made per submit and none when the Attempt has no answered free-text Question; a blank on a manual submit is still `Unanswered` and a blank on a submit after `expiresAt` is `Incorrect`; with `failNext('transport')` the submit still answers 200 with its three-key body while the free-text Questions are `Ungraded` with a null rationale and the Multiple Choice verdicts stand; `resolveUngraded` through `moduleRef` then re-asks, turns those rows into verdicts with rationales, returns exactly their ids as newly graded and the recomputed score, writes nothing on a second call and returns no newly-graded ids; a failing `resolveUngraded` leaves the rows `Ungraded` and answers; `resolveUngraded` never overwrites an `Unanswered`, a `Correct` or an `Incorrect`; a foreign account's or another profile's Attempt and an Attempt that is still open each get the shared 404; the serialized submit body still contains no `grade`, `state`, `score`, `rationale` or `correct` key (assert over `JSON.stringify`); and every pre-existing submit case passes untouched.
- `e2e/fixtures.ts` -- add `rationale` to `questionGradesFor`'s `SELECT` and its row type, for the reason the fixture exists: a rationale is a fact no screen this story builds will ever show.
- `e2e/tests/student-submit-attempt.spec.ts` -- extend the existing confirm-and-hand-in run: answer some Questions rightly and some not, hand in, and assert every presented Question now carries a row -- a verdict for each answered one with a rationale on the free-text ones, `Unanswered` for each blank -- and that the results of the same answers are identical on a re-run of the same fixture.

**Acceptance Criteria:**

- **Given** a submitted Attempt with a mixture of formats, blanks and a timer that had not run out, **when** the hand-in transaction commits, **then** every presented Question carries exactly one grade row, no Question carries two, and the response body is byte-identical in shape to before this story.
- **Given** an Attempt whose every answered Question is Multiple Choice, **when** it is handed in, **then** no provider call is made at all and the verdicts are identical on a repeated Attempt with the same answers.
- **Given** an Attempt with answered free-text Questions, **when** it is handed in, **then** exactly one `Grading` call is made for all of them together, every one of them carries a persisted rationale, and no blank Question was named in that call.
- **Given** grading is unavailable for the whole of a submit, **when** the child hands in, **then the hand-in succeeds**, the deterministic verdicts are stored, the free-text Questions are `Ungraded` with no rationale, nothing is `Incorrect` for want of a provider, and no grade, score or rationale appears in the response or in any log line.
- **Given** an Attempt carrying `Ungraded` Questions, **when** either party's read calls `resolveUngraded`, **then** only those Questions are re-asked, the ones that resolve carry a verdict and a rationale and are returned as newly graded, the score is recomputed over the gradable Questions with the excluded count reported, and a second call re-asks nothing and reports nothing newly graded.
- **Given** any stored `Unanswered`, `Correct` or `Incorrect` row, **when** grading runs again for that Attempt, **then** the row is left exactly as it was.
- **Given** the whole change, **when** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter api run test:int` and the e2e specs run, **then** all pass, exactly one migration was added, no `Mastery` table or fifth grade state exists, and no student-scoped surface or endpoint carries a grade, a score, a rationale, a correct answer or a parent-scoped figure.

## Spec Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 3: (high 0, medium 2, low 1)
- reject: 18: (high 0, medium 0, low 18)
- addressed_findings:
  - `[medium]` `[patch]` The post-commit grading block could throw out of an already-committed hand-in (a unique-index race in the second transaction, or any fault `judge` does not classify), answering 500 for a submission that succeeded and sending the retry into the 409. Everything after the closing transaction is now guarded, logs the Attempt id and fault class only, and returns the committed view regardless.
  - `[medium]` `[patch]` `writeGuarded`'s read-then-`create` lost a race: two concurrent passes, or one racing a hand-in's second transaction, surfaced a P2002 out of a read path documented to still answer. Insert is now `createMany(..., skipDuplicates)` and update is an `updateMany` carrying the `state: 'Ungraded'` guard, with the written list derived from the reported counts; an `Ungraded` write over an already-`Ungraded` row is skipped, so a permanently unaskable Question no longer has its `updatedAt` bumped by every results view.
  - `[medium]` `[patch]` The Multiple Choice comparison used `Number.parseInt`, which credited `'1abc'` and `'1.9'` as the flagged ordinal 1. A purely-digits value is now required before comparing, with integration cases for both shapes and for a padded value still grading `Correct`.
  - `[medium]` `[patch]` The child's raw answer was interpolated into the grading prompt in the same line shape as the rules and the answer key, so an answer mimicking a rule line could steer the verdict on that child's own paper. Every untrusted span is now fenced with per-Question markers that content cannot close, a rule states that fenced text is data and is never obeyed, and a new `grading-prompt.spec.ts` pins the ordinal list, the rules and the fences — the prompt was previously unasserted at every tier, since the fake never reads it.
  - `[low]` `[patch]` No test anywhere asserted a `Grading` cost row, though the module doc states the class is billed like every other and `AiService` swallows a failed cost write. An integration case now asserts exactly one `ai_call` row for that parent with `callClass: 'Grading'`, positive tokens and positive `costMicros`, and no answer text on the row.
  - `[low]` `[patch]` The row-less branch of `resolveUngraded` — the crash-recovery guarantee its doc rests on — was reached by no test. Two cases now delete a submitted Attempt's grade rows and re-resolve, once on a manual hand-in and once on an expired one, asserting the deterministic states come back from the stored `expired` column with no provider call.
  - `[low]` `[patch]` `questionOrdinal: z.number()` admitted `1.5` and `-3`, surfacing later as the misleading "verdict for a question nobody asked"; it is now `z.number().int()`.
  - `[low]` `[patch]` `resolveUngraded` pushed into a closure array from inside the transaction callback, which would duplicate ids if the callback were re-executed; it now assigns what the transaction returns.
  - `[low]` `[patch]` `correctAnswerOf`'s Multiple Choice branch was unreachable — `judge` only ever receives `askable` free-text Questions — and is removed along with the doc sentence advertising it.

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 5: (high 0, medium 2, low 3)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `resolveUngraded` had no guard around its post-transaction `judge`/`writeGuarded` call, unlike `submitAttempt`'s identical seam: an unforeseen fault (a race `skipDuplicates` doesn't cover, a dropped connection, a fault class nobody anticipated) would have escaped uncaught into a results read whose own doc promises it still answers. Wrapped in the same try/catch pattern `submitAttempt` uses, logging the Attempt id and fault class only and leaving the outstanding Questions exactly as they were.
  - `[low]` `[patch]` The rationale-column migration's comment garbled a quoted identifier (`` `answer"."value` `` with a misplaced quote) instead of `` `"answer"."value"` ``. Fixed the quoting.

## Design Notes

**Why the provider call sits between two transactions.** AD-4 makes submission block on grading, and AD-10 puts the recompute of whatever a grade changes inside the transaction that changed it. Mastery is Epic 7's and does not exist yet, so the only thing AD-10 binds together here is a grade and the row it is written on. Meanwhile `withTransaction`'s own doc says Prisma's ceiling is five seconds, and one `Grading` call can retry with backoff well past that. So the shape is: one transaction for the close and every verdict that needs no network, the call, then a short transaction for what came back. A crash in between leaves those Questions row-less on a submitted Attempt, which `resolveUngraded` treats exactly as `Ungraded` — which is why it scopes to both.

**Why absence is still not a pending state.** The enum's own doc forbids a fifth member, so nothing is written to mean "being graded". Before this story absence meant either "not yet graded" or "a blank on an expired Attempt"; this story grades the second case `Incorrect`, so on a submitted Attempt absence now means only the first. That is what makes `resolveUngraded`'s scope — `Ungraded` rows plus row-less Questions — a statement about one thing rather than two.

**Why one batched call rather than one per Question.** Submission blocks on it, so a fifteen-Question paper would otherwise be a dozen sequential round trips on a screen a child is waiting at. One call, with a verdict list validated in code against exactly the ordinals asked, and any shortfall re-asked and then degraded. The cost of batching is that one upstream fault marks every free-text Question in that Attempt `Ungraded` together — which is a state the retry path already exists for.

**The deterministic verdict, in one place:**

```ts
// An ordinal comparison, not a text one: the browser submits the chosen
// choice's ordinal as a string. Unparseable or unknown is Incorrect --
// `Ungraded` would claim a provider was asked and could not answer.
const chosen = Number.parseInt(answerValue.trim(), 10);
const state = chosen === correctChoiceOrdinal ? 'Correct' : 'Incorrect';
```

**Why `resolveUngraded` has no route yet.** FR-22 makes viewing the trigger, and the results screen is Story 5.6's. The engine has to exist and be provable first, so it is a service method with integration cases resolved through `moduleRef`, and 5.6 mounts the read that calls it. Adding a route here would be this story building 5.6's surface on a guess about its shape.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean across api, web and e2e.
- `pnpm typecheck` -- expected: no errors; `pnpm typecheck:e2e` also clean.
- `pnpm --filter api test` -- expected: the new `grading-score` and `grading-payload` specs pass; existing unit specs unchanged.
- `pnpm --filter api run test:int` -- expected: the new grading cases pass and every pre-existing submit case still passes at the unchanged path.
- `git status --porcelain apps/api/prisma/migrations` -- expected: exactly one new migration directory.
- `pnpm db:up && pnpm db:migrate && pnpm e2e -- student-submit-attempt` -- expected: passes; `student-attempt-resilience` and `student-take-test` still pass.

## Auto Run Result

**Summary:** Follow-up review pass over the already-implemented grading engine (baseline `7c8f83b`). Four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) ran over the full diff since baseline. Two real defects survived triage and were patched; five real-but-non-blocking gaps were recorded as deferred; six findings were noise (three duplicated already-recorded deferred items, one flagged a cosmetic `prisma format` realignment, two were speculative/out-of-scope).

**Files changed this pass:**
- `apps/api/src/grading/grading.service.ts` -- wrapped `resolveUngraded`'s post-transaction `judge`/`writeGuarded` call in the same crash-guard `submitAttempt` already has, so an unforeseen fault can't escape uncaught into a results read.
- `apps/api/prisma/migrations/20260927180000_add_question_grade_rationale/migration.sql` -- fixed a garbled quoted-identifier in a comment.
- `_bmad-output/implementation-artifacts/spec-5-5-grading-engine-four-grade-states.md` -- this review pass's triage log entry, five new deferred items, `followup_review_recommended` recomputed.

**Review findings breakdown:** patch 2 (medium 1, low 1); defer 5 (medium 2, low 3); reject 6 (low 6); intent_gap 0; bad_spec 0.

**Follow-up review recommendation:** `false`. Only this pass's patched findings count: medium 1, low 1 -> score `3*1 + 1*1 = 4` (< 5), no high-severity patch.

**Verification performed:**
- `pnpm --filter api typecheck` -- clean.
- `pnpm --filter api lint` -- clean.
- `apps/api` unit specs `grading-score.spec.ts`, `grading-payload.spec.ts`, `grading-prompt.spec.ts` -- 24/24 pass.
- `apps/api` integration specs matching `resolveUngraded`/`grad` in `practice-test.int-spec.ts` -- 13/13 pass (targeted run; the untargeted full-suite run hit the pre-existing, already-deferred fixture flake in unrelated `parent-auth`/`parent-pin`/`uncommitted-state` describes -- reproduced independently of this pass's patch, consistent with the standing deferred item).
- Did not re-run the full `pnpm --filter api run test:int` or the e2e suite, since the two patches touch only an error-handling seam and a comment string, neither exercised by the flaking fixtures.

**Residual risks:** None introduced by this pass's patches. The five newly deferred items (answer-key drift, unbounded batch size, permanently-unreadable correct answers, and two test-coverage gaps) remain open, none blocking, consistent with the three items already on this spec's deferred list.
</content>

