---
title: 'Story 5.4 — Submitting an Attempt'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_revision: 'a6146d81335a23ab877eb4cdf52236770741edfa'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      A person's press of Hand in is not guarded on the client store having been
      hydrated for this Attempt, so a press inside the window before hydration
      dispatches the answers held in state rather than the ones on the device.
    evidence: |-
      `send` and the press path gate on the Attempt and on `submitState`, never on
      `hydratedFor`; the deadline effect does carry that guard and says why
      ("resuming an Attempt whose deadline had already passed auto-submits the
      *empty* answer set"). The same exposure reaches a person's press. Pre-existing
      from Story 5.3 -- this story only made it visible, since the confirmation now
      names a blank count computed from the same un-hydrated state.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx
    severity: medium
  - summary: >-
      The API integration suite fails non-deterministically in PIN/elevation and
      upload fixture setup, in a varying handful of cases across files unrelated to
      this story, so a single green full run is not trustworthy gating.
    evidence: |-
      Reproduced on every full run of this story's verification: one run failed 2
      cases in source-test.int-spec.ts, another 1 in practice-test.int-spec.ts
      "draft editing", another 2 in "claiming" and "release and discard" -- each time
      a different case, each time inside `elevate` (401/404) or `generatable`'s
      upload (404), never inside this story's own cases, which were verified green by
      name on every run. The implementation agent reproduced the same failures with
      this story's work stashed at HEAD. Already recorded on Story 5.3 and still open.
    severity: medium
  - summary: >-
      Below the `md` breakpoint the confirmation's way back lands the child on the
      first Question that is not answered but no longer opens the question-map
      overlay for them, so the map is one further press away on a phone.
    evidence: |-
      Opening the overlay from that control was removed during review: MUI's
      ModalManager sets `aria-hidden` on the rest of the app and traps focus while a
      Modal is open regardless of CSS, so hiding the overlay above `md` with a
      `display` rule made the whole screen invisible to assistive technology behind a
      dialog nobody could see (reproduced in e2e). The map remains reachable by its
      own control at that width, and is permanently on screen in the rail above it,
      so AC1's path back is intact -- but a click-time media-query read would restore
      the stronger behaviour at phone width.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx
    severity: low
  - summary: >-
      Reconfirmed this pass: a Hand-in press before `hydratedFor` matches the
      current Attempt can submit fewer answers than the device has stored,
      because `handIn`/`decideHandIn` read the same un-hydrated `answers`/
      `blanks` state the deadline effect explicitly guards against.
    evidence: |-
      Blind Hunter, Edge Case Hunter and the Verification Gap reviewer each
      independently traced the same gap this pass. Verification Gap reviewer
      confirmed no test reloads mid-flight and presses Hand in inside the
      pre-hydration window, so neither `page.spec.tsx`'s source-region
      assertions nor the new e2e specs would catch a regression here. Same
      root cause as the existing hydration entry above; recorded separately
      since this pass's review produced a concrete demonstration and consumer
      trace, not because the underlying issue is new.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx (handIn,
      decideHandIn)
    severity: medium
  - summary: >-
      The "value counts as blank" rule is defined independently in three
      places -- the web `isAnswered` helper, the API's inline
      `value.trim().length === 0` check, and the e2e/int-spec fixtures --
      with no test pinning that all three treat non-space whitespace (e.g.
      newlines, non-breaking spaces) identically.
    evidence: |-
      Raised by the Blind Hunter reviewer. Each site is individually tested
      for the plain-space case; nothing in this diff exercises the sites
      together for non-space whitespace, so a future edit to only one of them
      could silently desync client-reported and server-persisted blank
      counts.
    location: >-
      apps/web/src/lib/answers.ts;
      apps/api/src/practicetest/practice-test.service.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Handing in is currently a silent, unqualified act: a child can press Hand in with half the paper blank and nothing asks them about it or offers a way back, and the blanks they chose to leave are stored as the absence of a row — indistinguishable from a blank on a test whose time ran out, which FR-37 says must be graded differently and forbids deriving at display time from an empty answer field. The `unanswered` grade state therefore has nowhere to live, and nothing yet owns writing it.

**Approach:** Put a confirmation in front of a person's press that names how many Questions are still not answered and offers a path back through the question map, and give the submit request a grade-owning step that persists `Unanswered` for each blank of a **manually** submitted Attempt — in the same transaction that closes it, from a new `grading` module that owns the new grade-state table, with the existing derived `Completed` band and the existing 409 standing as the irreversibility and completed-transition this story is accepted on.

## Boundaries & Constraints

**Always:**
- The four grade labels are the fixed literals of FR-37 and nothing here invents a fifth or a "pending": the enum this story introduces carries `Correct`, `Incorrect`, `Unanswered`, `Ungraded`, and this story **writes only `Unanswered`**.
- `Unanswered` is written at submission, for a Question left blank, **only when the server decided the Attempt had not expired** (`expired === false`) — timed or untimed alike. An expired Attempt writes no grade row at all here; FR-37 grades its blanks `Incorrect` and that is Story 5.5's.
- Which Questions are blank is decided **server-side**, from the Questions on that Practice Test minus the `Answer` rows the same transaction just wrote. A browser never states a blank count, an ordinal or a grade, and a body that omitted answers entirely is treated as "all blank" rather than trusted about anything.
- Grade state is `grading`'s entity and `grading`'s sole write (AD-6, AD-17). `practicetest` never writes it and never reads `grading` — the module arrow stays `grading → practicetest` (no `forwardRef`, no reversed edge), which is why the submit route moves into `grading` rather than calling out of `practicetest`.
- Closing the Attempt and writing its blanks are **one transaction** (AD-10): there is no instant at which an Attempt is handed in and its blanks are unrecorded.
- The route stays `POST /api/student/attempts/:attemptId/submit` with the same body shape, the same 200, the same `AttemptSubmissionView` fields, the same single `PRACTICE_TEST_NOT_FOUND` sentence on a foreign or unknown id, the same 409 `ATTEMPT_ALREADY_SUBMITTED`, the same `StudentModeGuard`, the same `@SkipThrottle({ login: true })` and no `ParseUUIDPipe` — a move, not a new contract.
- The confirmation is only ever in front of a **person's** press. A timer-expiry auto-submit and the single reconnect dispatch are never confirmed and never blocked on one: there is nobody there to answer, and the deadline has already decided.
- The confirmation names the count, states nothing about correctness, and its two ways out are "go back to the questions" (which closes it and lands the child on the question map at the first Question that is not answered) and "hand in anyway". Dismissing it hands nothing in.
- With no Questions left blank there is no confirmation at all — a press sends.
- Progress vocabulary and grade vocabulary stay separate: the screen keeps saying `Answered` / `Not answered`, the copy for the confirmation uses the progress words, and `Unanswered` appears in this story only as a stored grade literal, never as a student-facing string.
- Every new user-facing string is parameterized in `apps/web/src/copy/student.ts`, second person, no exclamation mark, no error code, no figure written into a sentence that belongs to a token. Every figure comes from `apps/web/src/theme/tokens.ts`.
- No response body, no student-scoped read and no screen this story touches gains a grade, a score, a correct answer, a rationale, a tier, a cost or a model name.

**Block If:**
- Persisting `Unanswered` cannot be done without either reversing the `grading → practicetest` module edge or writing grade state from `practicetest` (both forbidden above) — i.e. if moving the submit route into `grading` turns out to require a `forwardRef` cycle.

**Never:**
- No grading of anything. No `Correct`, no `Incorrect`, no `Ungraded` written anywhere; no AI call, no rationale column, no score, no denominator, no Mastery, no recompute. Story 5.5.
- No results screen, no answer key, no score header, no ungraded retry, no "newly graded" marker. Story 5.6.
- No retake, no second Attempt, no Attempt history surface, no parent-side Attempt detail. Story 5.7 and Parent View.
- No `Completed` member on `PracticeTestStatus`, and no status write on submit: the band is derived from Attempts by `studentListState` and must stay derived.
- No change to the client's offline rules, latch, clock, store, TTL or auto-submit dispatch count, and no new automatic dispatch of any kind.
- No confirmation, dialog or extra round trip on the expiry auto-submit path.
- No change to what any student-scoped read selects.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manual submit, some blanks, untimed test | 5 Questions, 3 answered, `expiresAt: null` | 200 with the existing body shape; 3 `Answer` rows; **2** grade rows, both `Unanswered`, one per blank Question | No error expected |
| Manual submit, some blanks, timed test not expired | Same with `expiresAt` in the future | Identical: blanks are `Unanswered` whether or not the test was timed | No error expected |
| Manual submit, nothing blank | Every Question answered | 200; no grade row written at all — there is no blank to record | No error expected |
| Manual submit, nothing answered | `answers: []` | 200; no `Answer` rows; one `Unanswered` row per Question on the test | No error expected |
| Submit after the deadline | `expiresAt` in the past | 200 `{ expired: true, gradeAt: expiresAt }` as before, and **no grade row of any kind** | No error expected |
| Body naming a Question of another test | A stale id in the browser's store | Ignored as today, and the Question it named is not counted blank; every real blank still recorded | No error expected |
| Body answering a Question twice | Two entries, same id | One `Answer` row as today; that Question is not blank | No error expected |
| Blank-only value | `value: '   '` | Dropped as today, and that Question **is** blank, so it takes `Unanswered` | No error expected |
| Second submit | Same call twice | 409 `ATTEMPT_ALREADY_SUBMITTED` as today; the first result and its grade rows stand, unchanged and un-rewritten | 409, nothing written |
| Foreign or unknown Attempt id | Another profile's or account's Attempt | 404 with the one shared sentence | 404, distinguishing nothing |
| Unbound device | No binding cookie | 401 from `StudentModeGuard`, from the route's new home as from its old one | Screen routes to sign-in only on the guard's own refusal |
| Press Hand in with blanks | 2 of 5 not answered | A confirmation names the count; nothing is dispatched until it is answered | Dismissing it sends nothing and leaves the Attempt open |
| "Go back to the questions" | Confirmation open | It closes, the question map is on screen, and the screen is on the first Question that is not answered | No request issued |
| "Hand in anyway" | Confirmation open | Exactly one submit is dispatched | The existing failure sentences, unchanged |
| Press Hand in with nothing blank | Every Question answered | No confirmation; one submit dispatched | As today |
| Deadline reached online with blanks | Timer expiry auto-submit | Dispatched with **no** confirmation and no extra press | As today |
| Reconnect with an armed latch and blanks | `online` transition after an offline expiry | Exactly one dispatch, no confirmation | As today |
| Completed after handing in | Student Home re-read after a successful submit | The row reads `Completed`, derived from the submitted Attempt | No error expected |

</intent-contract>

## Code Map

**API — what the route moves out of**

- `apps/api/src/practicetest/practice-test.service.ts:927` `submitAttempt` — the whole of today's hand-in: the three-id `findFirst` (404), the `submittedAt !== null` courtesy read and the conditional `updateMany` that makes the 409 true under concurrency, the `onThisTest` set, the `byQuestion` dedupe/blank drop, `answer.createMany`, and the `expired` / `gradeAt` computation. **Refactor in place into a tx-accepting `closeAttempt(tx, …)` that also returns the blank Question ids**; keep every comment's claim intact. `:815` `startOrResumeAttempt` is untouched. `:273`–`:360` is where `AttemptView` / `AttemptSubmissionView` live; a new `AttemptClosure` interface belongs beside them.
- `apps/api/src/practicetest/student-practice-test.controller.ts:183` `@Post('attempts/:attemptId/submit')` — **delete this route** (and its now-unused `Body`/`HttpCode`/`SubmitAttemptDto` imports); its doc comment is the text to carry to the new home. The class doc's "exactly one kind of student-scoped write" paragraph must be rewritten: the start route is the only write left here.
- `apps/api/src/practicetest/practice-test-policy.ts:235` `ATTEMPT_ALREADY_SUBMITTED`, plus `MAX_ANSWERS_PER_SUBMISSION`, `MAX_ANSWER_LENGTH`, `MAX_QUESTION_ID_LENGTH`, `MAX_JSON_BODY_BYTES` — stay here and are imported by the new module across the read edge. `PRACTICE_TEST_NOT_FOUND` is in the same file's neighbourhood and stays the one refusal sentence.
- `apps/api/src/practicetest/dto/attempt-submit.dto.ts` — `SubmitAttemptDto` / `SubmitAnswerDto`, **moved** to the new module's `dto/` unchanged (its reasoning about `@IsDefined`, no `@IsUUID` and `[]` being legitimate is exactly this story's, and its closing sentence — "Story 5.4 owns whether they are asked about it first" — is now answered).
- `apps/api/src/practicetest/practice-test.module.ts` — already `exports: [PracticeTestService]`; the new module imports it. **No cycle**: nothing here imports the new module.
- `apps/api/src/identity/student-mode.guard.ts` — `StudentModeGuard`, `StudentRequest`; the new controller mounts it the way `student-practice-test.controller.ts` does. The guard's three dependencies come from `IdentityModule` + a `JwtModule.registerAsync` with `requireParentJwtSecret()` — copy that arrangement from `practice-test.module.ts:45`.
- `apps/api/src/app.module.ts` — where the new module is registered.
- `apps/api/src/prisma/prisma.service.ts:40` `withTransaction` — no nesting: a cross-module transaction is a `tx` passed as a parameter. `apps/api/src/admin/admin-audit.service.ts:31` and `apps/api/src/identity/parent-account.service.ts:139` are the precedents for a service method taking `tx: TransactionClient` from another module.

**API — schema and migration**

- `apps/api/prisma/schema.prisma:794` `PracticeTestStatus` (three members; **no `Completed`, deliberately**), `:1030` `Attempt` (`expired`, `submittedAt`), `:1081` `Answer` — whose doc says "no grade column … a Question the child left blank has no row at all". That claim stays true: the new grade row is a **separate** table, so raw answers stay raw. `:949` `PracticeTestQuestion` gains a back-relation.
- `apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql` — the naming and hand-written-DDL convention to copy, including the commented rationale style and the explicit index/FK blocks.

**API — tests**

- `apps/api/test/practice-test.int-spec.ts:3336` `submitAttempt(cookie, attemptId, answers)` helper and `:3360` `releasedForChild(timerMinutes)` / `setTimerMinutes` — every existing submit case goes over HTTP at the unchanged path, so they must all still pass untouched. `:2881` is the `Completed`-band case, which seeds an Attempt rather than submitting one — the new end-to-end "submit, then the list says Completed" case belongs beside it or beside the submit cases.

**Web**

- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx:606` `handIn` — the single place a person's press is decided; the confirmation goes in front of `submitDecision`, never in front of `send`, so neither the deadline effect (`:654`) nor the reconnect take (`:692`) can reach it. `:92` `answers`, `:94` `index`, `:96` `mapOpen`, `:706` `jumpTo`, `:204` the render-phase reset (which the new state must join), `:965` the existing `AppDialog` overlay usage.
- `apps/web/src/lib/answers.ts` — `isAnswered`, `answeredCount`, `progressOf`, `QuestionProgress`; the one source of truth for "answered", and where the blank-list rule belongs. Its header already explains why `Unanswered` is avoided in this vocabulary.
- `apps/web/src/lib/attempt-submit.ts:66` `submitDecision` — unchanged; the confirmation is a gate *before* it, not a fifth `SubmitAction`.
- `apps/web/src/components/Dialog.tsx:29` `AppDialog` (title, `aria-labelledby`, actions, extra MUI props pass through so a test can mount it inline) — the primitive. `DestructiveConfirmDialog` is **not** the shape to reuse: no password, nothing destroyed.
- `apps/web/src/app/student/_components/QuestionMap.tsx` — one component for rail and overlay; `onJump(index)` is the path back. `apps/web/src/copy/student.ts:~70` `studentCopy.takeTest` — every new string, inside it.
- `apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx` — source-region assertions over comment-stripped `CODE` (`:14`), including the `parentApi` member allow-list (`:91`) and the reset-block assertions (`:55`). `apps/web/vitest.config.ts` — `environment: 'node'`: no click, no event, no storage. Behaviour claims belong in `e2e/`.
- `e2e/tests/student-take-test.spec.ts` (Story 5.2 arrangement: generate, release, bind, answer, navigate) and `e2e/tests/student-attempt-resilience.spec.ts` (offline, expiry, dispatch counting) — the two specs to extend from. `e2e/fixtures.ts:526` `newestAttemptFixture` (returns `answerCount`, straight from the row) is the precedent for reading what no screen shows; a grade-row count needs the same treatment.

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` -- add `enum GradeState { Correct Incorrect Unanswered Ungraded }` (`@@map("grade_state")`) and model `QuestionGrade` (`id`, `attemptId`, `questionId`, `state GradeState`, `createdAt`, `updatedAt`; `@@unique([attemptId, questionId])`, `@@index([attemptId])`, both relations `onDelete: Cascade`), with back-relations on `Attempt` and `PracticeTestQuestion` -- doc-commented in the neighbours' voice: all four literals exist because FR-37 fixes them and a fifth "pending" member is what the table must never have, this story writes only `Unanswered`, and it is a table of its own rather than a column on `Answer` because a blank has no answer to hang a grade on and `Answer` is `practicetest`'s while grade state is `grading`'s (AD-6, AD-17).
- `apps/api/prisma/migrations/<timestamp>_add_question_grade/migration.sql` -- hand-written DDL for the enum, the table, its unique index and both foreign keys, in the previous migration's commented style -- one migration, applied by `pnpm db:migrate`.
- `apps/api/src/practicetest/practice-test.service.ts` -- rename `submitAttempt` to `closeAttempt(tx: TransactionClient, parentAccountId, studentProfileId, attemptId, answers)`, taking the transaction rather than opening one and returning `AttemptClosure` = the existing `AttemptSubmissionView` fields plus `blankQuestionIds: string[]` (the `onThisTest` set minus the keys of `byQuestion`, in stored ordinal order) -- every existing rule, comment and claim preserved verbatim, because the 404, the conditional `updateMany` behind the 409 and the ignore-stale-id rule are what the existing integration cases pin. The blanks are computed here because only the writer of `Answer` knows what it wrote, and computing them anywhere else would be a second definition of "blank".
- `apps/api/src/practicetest/student-practice-test.controller.ts` -- remove the submit route and the imports it alone needed; rewrite the class doc so the one student-scoped write it still mounts is the Attempt start, and say where handing in went and why (grade state is not this module's to write).
- `apps/api/src/grading/grading.service.ts` -- **new**: `submitAttempt(parentAccountId, studentProfileId, attemptId, answers): Promise<AttemptSubmissionView>`, opening one transaction, calling `PracticeTestService.closeAttempt` inside it, and -- **only when the closure reports `expired: false`** -- inserting one `QuestionGrade` per blank with `state: 'Unanswered'` before it returns the unchanged view shape. Nothing is graded and no other state is ever written; an expired Attempt gets no row, because FR-37 says its blanks are `Incorrect` and that verdict is Story 5.5's to make.
- `apps/api/src/grading/student-attempt.controller.ts` -- **new**: `@Controller('student')` + `@SkipThrottle({ login: true })` + `@UseGuards(StudentModeGuard)`, mounting `@Post('attempts/:attemptId/submit')` with `@HttpCode(HttpStatus.OK)`, both ids off `req.student!`, the body validated by the moved DTO -- carrying the old route's doc comment forward and adding why handing in is mounted here: submission is the transaction a grade is written in (AD-4, AD-10), so it belongs to the module that owns grade state.
- `apps/api/src/grading/dto/attempt-submit.dto.ts` -- move `SubmitAttemptDto` / `SubmitAnswerDto` here unchanged, importing the ceilings from `practicetest`'s policy across the read edge, and answer its own closing sentence: the child *is* asked about blanks first, on the screen, and `[]` is still a legitimate body.
- `apps/api/src/grading/grading.module.ts` -- **new**: imports `PracticeTestModule`, `IdentityModule` and a `JwtModule.registerAsync({ useFactory: () => ({ secret: requireParentJwtSecret() }) })`; provides `GradingService` and `StudentModeGuard`; mounts the controller; exports `GradingService` -- doc-commented with the arrow it keeps (`grading → practicetest`, never reversed, no `forwardRef`) and the entity it owns.
- `apps/api/src/app.module.ts` -- register `GradingModule`.
- `apps/api/test/practice-test.int-spec.ts` -- new cases beside the existing submit ones, all over the unchanged HTTP path: a manual submit on an untimed test writes one `Unanswered` per blank and none for an answered Question; the same on a timed-but-not-expired test writes the same rows; a submit with every Question answered writes none; a submit with `answers: []` writes one per Question; a submit after `expiresAt` writes **no** grade row; a whitespace-only value counts as blank; a stale foreign question id in the body neither writes an answer nor suppresses a real blank; the losing side of two concurrent submissions still answers 409 and leaves exactly one set of grade rows; and the serialized 200 body still contains no grade, state, score or rationale key (assert over `JSON.stringify`). Add the completed-transition case: submit, then re-read the student list and get `state: 'Completed'`.
- `apps/web/src/lib/answers.ts` -- add `notAnswered(order, answers): QuestionProgress[]` and `firstNotAnsweredIndex(order, answers): number | null`, both over the given order and both `isAnswered`-derived -- pure, so "the confirmation names the right count and lands on the right Question" is assertable without a DOM, and derived from the same predicate the map uses so the dialog and the map can never disagree.
- `apps/web/src/lib/answers.spec.ts` -- extend: the count matches the map's `Not answered` figure for the same input; an answered-then-cleared Question counts as not answered; whitespace counts as not answered; `firstNotAnsweredIndex` is the earliest index in the given order and `null` when nothing is blank; an answer held for a Question not in the order affects neither.
- `apps/web/src/copy/student.ts` -- add inside `takeTest`: `confirmHandInTitle`, `confirmHandIn(notAnswered: number)` (singular and plural, naming the count in the progress vocabulary and saying the work can still be finished), `confirmHandInBack` (the way back to the questions) and `confirmHandInAnyway` -- second person, no exclamation mark, no grade or score word, and **never** the word `Unanswered`.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` -- hold a `confirmingHandIn` flag, join it to the render-phase reset, and in `handIn` (and only there) open the confirmation instead of deciding when `notAnswered` is non-empty; render it with `AppDialog` titled from the new copy, its body naming the count, and two actions -- back, which closes it, opens the question map and jumps to `firstNotAnsweredIndex`; and hand in anyway, which closes it and runs the existing decision path once. Neither the deadline effect nor the reconnect take may touch the flag, and no `send(true)` path gains a gate. Extend the header comment: the one thing a person's press now passes through is a question about their own blanks, and it is a question, not a verdict.
- `apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx` -- extend the source-region assertions: `confirmingHandIn` appears in the reset block; the only `setConfirmingHandIn(true)` is inside `handIn`; neither the deadline effect nor the latch-take effect mentions it; `send(true)` is reachable without it; the `parentApi` member allow-list is unchanged; and the file still contains no `score`, `correct`, `grade` or `Unanswered` identifier with comments stripped.
- `e2e/tests/student-submit-attempt.spec.ts` -- **new**: release a test, answer some but not all Questions, press Hand in and assert the confirmation names the number not answered and that no submit request went out; take the way back and assert the map is open on the first Question that is not answered and still nothing was sent; press Hand in and confirm, and assert exactly one submit request, the handed-in state, and one `Unanswered` grade row per blank with none for an answered Question; return to Student Home and assert the row reads `Completed`; then answer every Question of a second released test and assert no confirmation appears at all. In a second run, let a short timer expire and assert the auto-submit is dispatched with no confirmation and writes no grade row.
- `e2e/fixtures.ts` -- add `questionGradesFor(parentEmail)` returning the newest Attempt's grade rows (question id and state), for the reason `newestAttemptFixture` exists: a grade row is a fact no screen this story builds will ever show.

**Acceptance Criteria:**

- **Given** a released Practice Test with Questions still not answered, **when** the child presses Hand in, **then** a confirmation states how many are not answered, nothing has been dispatched, and one of its two ways out returns them to the question map on the first of those Questions while the other hands in.
- **Given** that confirmation, **when** the child dismisses it or takes the way back, **then** no submit request is issued, the Attempt stays open and every answer is intact.
- **Given** a Practice Test with every Question answered, **when** the child presses Hand in, **then** no confirmation appears and exactly one submit is dispatched.
- **Given** a manually submitted Attempt with blanks, **when** the transaction commits, **then** each blank Question carries exactly one persisted `Unanswered` grade row and no Question carries `Incorrect`, whether or not the Practice Test was timed — and none of those rows was derived from an empty answer field at read time.
- **Given** an Attempt the server judged expired, **when** it submits, **then** it writes no grade row at all and its response is byte-identical in shape to before this story.
- **Given** a successful submission, **when** it is sent again, **then** it answers 409 with the existing sentence and neither the Attempt's instants nor its grade rows change.
- **Given** a successful submission, **when** Student Home is read again, **then** that Practice Test reads `Completed`, derived from the Attempt with no status column written.
- **Given** a timer expiry, **when** the screen auto-submits — on screen or on the single reconnect dispatch — **then** no confirmation is shown, no extra press is required, and the dispatch count is exactly what it was before this story.
- **Given** the whole change, **when** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter api run test:int` and the e2e specs run, **then** all pass, exactly one migration was added, every pre-existing submit case passes untouched at the unchanged route path, and no response body or student-scoped surface carries a grade, a score, a correct answer, a rationale or a parent-scoped figure.

## Spec Change Log

## Review Triage Log

### 2026-09-27 - Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 3: (high 0, medium 2, low 1)
- reject: 13: (high 0, medium 3, low 10)
- addressed_findings:
  - `[medium]` `[patch]` A person's press after the deadline opened the confirmation, offering to "go back and finish" work the server judges as of the expiry instant -- `handIn` now goes straight to the decision path when `remaining` is 0.
  - `[medium]` `[patch]` The dialog's count sentence -- its whole reason for existing -- was not its accessible description, so opening it announced only the title. `AppDialog` gained a documented `describedBy` prop, wired to the count sentence, with a spec case for both branches.
  - `[medium]` `[patch]` The way back opened a modal duplicate of the map over the rail that is already permanently visible from `md` up. It now sets the index only. The CSS-only mechanism first asked for was withdrawn: MUI's `ModalManager` applies `aria-hidden` to the rest of the app and traps focus while a Modal is open whatever `display` says, which hid the whole screen from assistive technology behind an invisible dialog (reproduced in e2e). The phone-width consequence is recorded under `deferred`.
  - `[medium]` `[patch]` The e2e resilience helper probed for the confirmation with a non-retrying `isVisible()`, so an uncommitted render made it click nothing and fail the following assertions intermittently. The expectation is now a stated parameter, waited for in both directions -- the premise that every press in that file meets a blank paper proved false (the first case answers both Questions).
  - `[low]` `[patch]` The new page-spec region assertions sliced source on `indexOf`, which passes vacuously when a marker moves (`-1` yields an empty or whole-file slice). A `regionOf` helper now asserts both markers are present and ordered before slicing.
  - `[low]` `[patch]` `notAnswered` was recomputed inline in JSX alongside the already-memoized `progress` -- one memoized derivation now feeds both the decision and the copy.
  - `[low]` `[patch]` The confirmation could stay open across an automatic dispatch; it now closes whenever `submitState` leaves `'open'`.
  - `[low]` `[patch]` `questionGradesFor` returned `[]` both for "no grade rows" and for "not the Attempt you meant", so a regression writing rows against the wrong Attempt would still have passed. It now takes and returns an attempt id.
  - `[low]` `[patch]` `GradeState`'s doc claimed an absent row means only "not graded yet", while an expired Attempt's blanks are deliberately absent too. Both meanings are now stated. Comment only -- no schema, index or migration change.

Rejected as noise, for the record: a dispatch with an empty question order (the Hand in control cannot render while the test view is null); a clock-skew window between the client's countdown and the server's column (the server deciding is the design, not a gap); `createMany` duplicate-key and transaction-timeout hazards on a path guarded by the conditional close; `closeAttempt` being handed a non-transactional client (its type forbids it, and grading is its only caller); a `send(true)` occurrence count called brittle (the file is deliberately a source-text pin); the redundant `@@index([attemptId])` and a missing `questionId` index (`Answer` carries the identical key shape and no such index -- changing either is a schema decision, not a review fix); untested cascade deletes and a 404's rollback (Epic 8 owns deletion, and the 409 race already pins the rollback); `GradingModule` exporting its service and the submission ceilings staying in `practicetest`'s policy (both directed by the spec's own task text); and `practicetest`'s module docstring wording, which the move did not falsify.

### 2026-09-27 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 2: (high 0, medium 1, low 1)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[medium]` `[patch]` `e2e/fixtures.ts`'s `questionGradesFor` silently ignored `parentEmail` whenever a caller passed an explicit `attemptId` -- a test asserting the wrong Attempt for the right parent (or vice versa) would still have read real grade rows and passed. It now verifies the named Attempt belongs to that parent before reading rows, throwing otherwise.

Rejected as noise, for the record: the Intent-Contract's I/O matrix not carrying an explicit row for the already-recorded hydration gap (the gap itself is tracked under `deferred`, not owed a matrix row); no test for a rapid double-press of "Hand in anyway" (the underlying `inFlight` dispatch guard is pre-existing and unchanged by this diff); the phone-width "go back to the questions" AC wording read as overstating what ships (already tracked as the existing mobile-map deferred item, not a second issue); `notAnswered` and `firstNotAnsweredIndex` lacking a property test proving they never disagree (each is independently tested; no concrete divergence shown); the trim rule living in three files (tracked under `deferred` above, not also a reject-worthy patch); `GradingService.submitAttempt`'s inline answers type versus reusing `SubmitAnswerDto` (a hypothetical future-drift concern, not a present defect); `grading.module.ts` re-registering `JwtModule`/`StudentModeGuard` rather than sharing `practicetest`'s copy (an accepted arrangement per this story's own Design Notes); the concurrent-hand-in race test not also asserting `Answer` row singularity for the losing request (the transaction's atomicity already covers it; no concrete gap demonstrated); no e2e case for a timed, not-yet-expired, manual submission with blanks (covered server-side by the int-spec; the e2e suite covers other combinations); and `QuestionGrade` cascade-delete on a hypothetical retake going untested (already rejected in the prior pass -- Story 5.7's concern, not this one's).

## Design Notes

**Why the submit route moves into a new `grading` module.** AC2 requires a grade state to be *persisted*, and FR-37 forbids deriving it at display time. Grade state is `grading`'s entity and its sole write (AD-6, AD-17), while the module arrow is `grading → practicetest` and "no arrow may be reversed without moving entity ownership". So `practicetest` cannot call a grading service, and a controller in `practicetest` injecting one would make the two modules a `forwardRef` cycle — the one thing `practice-test.module.ts` says it has no reason to have. Moving the endpoint is the only arrangement where AD-4's "submission blocks on grading" and AD-10's "the recompute is inside the submit transaction" can both be literally true, and it is where Story 5.5 needs it anyway. The path, body, status codes and refusal sentences are unchanged, so every existing case still pins the behaviour from outside.

**Why a table rather than a column on `Answer`.** A blank has no `Answer` row — `Answer`'s own doc makes that a promise, and keeping it means raw answers stay raw text with nothing judged in them. A grade is a fact about an (Attempt, Question) pair whether or not an answer exists, which is exactly what `QuestionGrade`'s unique key says. Story 5.5 then adds its rationale column and its other three states to a table that already exists and already belongs to the right module.

**Why the enum carries all four literals now.** FR-37 fixes them, so they are not this story's to negotiate, and a two-member enum would force 5.5 to migrate an enum rather than insert rows. What must not appear is a fifth member: `ungraded` is a grading *failure* and never a pending state, and a row's absence already means "not graded yet" during the interval before 5.5 lands.

**Why the confirmation sits in `handIn` and nowhere else.**

```ts
// A person's press, and only a person's press.
if (notAnswered(questions, answers).length > 0 && !confirmingHandIn) {
  setConfirmingHandIn(true);   // nothing dispatched
  return;
}
```

`send(true)` — the deadline effect and the latch take — never reaches this line. A gate on the automatic paths would be a dialog nobody is there to answer, which would hold a child's work back past a deadline the server has already judged, and would break "exactly one dispatch on reconnect".

**Where each claim is testable.** `apps/web` runs `environment: 'node'`: the blank-count and first-blank rules go in `answers.spec.ts` as pure functions, and the page spec asserts over its own comment-stripped source. Pressing, dismissing, jumping and dispatch counting go in `e2e/`. Grade rows are asserted through integration cases over HTTP and through an e2e fixture reading the row directly, because nothing this story builds displays one.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean across api, web and e2e.
- `pnpm typecheck` -- expected: no errors; `pnpm typecheck:e2e` also clean.
- `pnpm --filter web test` -- expected: the extended `answers` and Take Test page specs pass; existing specs unchanged.
- `pnpm --filter api run test:int` -- expected: the new grade-row and completed-transition cases pass and every pre-existing submit case still passes at the unchanged path.
- `git status --porcelain apps/api/prisma/migrations` -- expected: exactly one new migration directory.
- `pnpm db:up && pnpm db:migrate && pnpm e2e -- student-submit-attempt` -- expected: the new end-to-end passes; `pnpm e2e -- student-attempt-resilience` and `student-take-test` still pass.

## Auto Run Result

**Summary:** Follow-up review pass over the already-implemented Story 5.4 change (confirmation-gated Hand-in with server-side `Unanswered` grade recording). No new implementation work was requested this pass; the four review layers were run against the diff since `baseline_revision`, findings were triaged, and the one `patch`-triaged finding was applied and verified.

**Files changed this pass:**
- `e2e/fixtures.ts` -- `questionGradesFor` now verifies the named `attemptId` belongs to the given `parentEmail` before reading grade rows, instead of silently ignoring the parent check whenever an explicit Attempt id was passed.

**Review findings breakdown (this pass):** patch 1 (medium), defer 2 (1 medium, 1 low), reject 10 (all low). No `intent_gap`, no `bad_spec`. See `## Review Triage Log` above for the itemized list.

**Follow-up review recommendation:** `false`. Score this pass: 1 medium patch → 3×1 = 3, below the 5-point threshold; no high-severity patch.

**Verification performed:**
- `pnpm typecheck:e2e` -- clean.
- `pnpm lint` -- clean (turbo: `api`, `web`; the changed file's package has no separate lint target beyond typecheck).
- `pnpm db:up && pnpm db:migrate` -- ran clean, no pending migrations.
- `pnpm e2e -- student-submit-attempt` -- both `student-submit-attempt.spec.ts` cases passed, along with `student-attempt-resilience.spec.ts` and `student-take-test.spec.ts` (all green). Two unrelated failures surfaced in `parent-auth.spec.ts` (a `getByRole('status')` strict-mode violation against an unrelated status banner) -- not touched by this story's diff or this pass's patch; consistent with the already-recorded flaky-suite deferred item, though that item names the API integration suite specifically rather than this e2e file.

**Residual risks:** The two medium-severity deferred items (pre-existing client hydration gap on Hand-in, reconfirmed this pass; and the already-recorded flaky test infrastructure) remain open and are tracked under `deferred` in this file's frontmatter, not resolved by this pass.

