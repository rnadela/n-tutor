---
title: 'Story 5.3 — Attempt Resilience (interruption & offline)'
type: 'feature'
created: '2026-09-25'
status: 'done'
baseline_revision: '4cff0d65172fc7b95c2367f1853e997ddea4e95d'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The API integration suite fails non-deterministically in fixture setup, in a
      varying handful of cases unrelated to this story, so a single green full run
      is not trustworthy gating.
    evidence: |-
      Reproduced twice in this run at review time: one pass failed 6 cases across
      extraction.int-spec.ts and the Story 4.1/4.2 generation describes, a second
      pass failed 1 case in the Story 4.6 timer describe. Different cases each
      time, none of them this story's Attempt cases, and all of them failing in
      fixture setup (release / setPinFor / elevate answering 404) rather than in
      an assertion. The implementation session established it also reproduces with
      practice-test.int-spec.ts run alone (about 1 in 3) with fileParallelism
      already off, and that it predates this story's review fixes. The symptom is
      a row vanishing between creation and the next read, pointing at the shared
      nts_test database and the TRUNCATE ... CASCADE reset helpers rather than at
      cross-file interference.
    location: >-
      apps/api/test/ (shared nts_test database reset helpers)
    severity: high
  - summary: >-
      Two pre-existing end-to-end failures in the parent password-reset flow.
    evidence: |-
      e2e/tests/parent-auth.spec.ts fails two password-reset cases. Confirmed
      pre-existing by stashing this story's entire diff, rebuilding both apps at
      baseline_revision and re-running: they fail identically. This story touches
      no auth, identity or mail file.
    location: >-
      e2e/tests/parent-auth.spec.ts
    severity: medium
  - summary: >-
      submitAttempt does not require the Practice Test to still be Released, while
      startOrResumeAttempt does.
    evidence: |-
      startOrResumeAttempt carries status: 'Released' in its where clause;
      submitAttempt matches on the Attempt id plus both owner ids only. A test
      discarded while the child is working therefore still accepts a hand-in and
      writes answer rows, and the "one indistinguishable 404" story applies to
      start but not to submit. Nothing in this story's intent requires the check,
      so the asymmetry was recorded rather than closed.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (submitAttempt)
    severity: medium
  - summary: >-
      The new Attempt start/submit write routes inherit the controller's existing
      @SkipThrottle, which was reasonable for its prior read-only routes but was
      not reconsidered now that the controller has state-mutating endpoints.
    evidence: |-
      apps/api/src/practicetest/student-practice-test.controller.ts carries a
      class-level @SkipThrottle predating this story; startAttempt and
      submitAttempt were added under it with nothing in this diff adding
      throttling to either.
    location: >-
      apps/api/src/practicetest/student-practice-test.controller.ts
    severity: medium
  - summary: >-
      answer.questionId has an ON DELETE CASCADE foreign key, so deleting a
      PracticeTestQuestion after Attempts/Answers exist against it silently
      drops a child's submitted answer with no tombstone.
    evidence: |-
      apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql
      declares answer_questionId_fkey ON DELETE CASCADE. Nothing in this diff
      enforces or tests that a Released test's questions are immutable once
      Attempts exist against it.
    location: >-
      apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql
    severity: low
  - summary: >-
      isUniqueViolation treats any P2002 inside a transaction as safe to retry
      without checking which constraint fired, so an unrelated unique violation
      in the same transaction would be masked and retried instead of rethrown.
    evidence: |-
      apps/api/src/practicetest/practice-test.service.ts:2028 (and the same
      helper restated in source-test.service.ts, extraction.service.ts and
      uncommitted-state.service.ts) checks only `cause.code === 'P2002'`, not
      `cause.meta?.target`. This is a pre-existing codebase-wide pattern, not
      something this story introduced, so fixing it here alone would diverge
      from the other three call sites.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (isUniqueViolation)
    severity: low
  - summary: >-
      startOrResumeAttempt retries a P2002 exactly once (two attempts total), so
      a third concurrent racer for the same first-open would surface as an
      unhandled 500 instead of resuming.
    evidence: |-
      apps/api/src/practicetest/practice-test.service.ts:874-895 catches the
      first P2002 and retries the transaction once with no loop. The same
      single-retry-no-loop shape is used at the other isUniqueViolation call
      sites, so this is a pre-existing codebase-wide pattern rather than a
      defect specific to this story, and a three-way race is a narrow window.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (startOrResumeAttempt)
    severity: low
  - summary: >-
      The new migration drops the DEFAULT now() on attempt.startedAt, so any
      insert into that table outside startOrResumeAttempt must now supply it
      explicitly or fail on a missing NOT NULL column.
    evidence: |-
      apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql
      (ALTER TABLE "attempt" ... ALTER COLUMN "startedAt" DROP DEFAULT). No
      other writer of this table exists today, so the risk is latent rather
      than active.
    location: >-
      apps/api/prisma/migrations/20260927120000_extend_attempt_and_add_answer/migration.sql
    severity: low
  - summary: >-
      The Hand-in dispatch fix for a null profileId (send() gated on the
      Attempt alone, not the profile) is verified only by a source-text regex
      in page.spec.tsx, never by an executed dispatch.
    evidence: |-
      page.spec.tsx's "what the screen does with a profile it never learned"
      describe block asserts `CODE.toContain('if (current === null) return;')`
      and a banned regex over stripped source; nothing renders the page, stubs
      a failing studentSession(), clicks Hand in, and confirms
      parentApi.submitAttempt is still called. Reproducing the guarded bug with
      the operands reversed would pass every existing test. Fixing this needs
      either a DOM-rendering test environment for this file (currently
      environment: 'node') or new network-mock e2e infrastructure this suite
      has no precedent for -- downgraded from patch to defer this pass because
      this session had no way to run either and confirm it passes.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx
    severity: medium
  - summary: >-
      e2e/tests/student-mode.spec.ts seeds a sibling's storage record with a
      hand-rolled key string instead of deriving it from attempt-store.ts's
      attemptKey(), so a change to the key-encoding scheme would silently stop
      being covered by this test rather than failing loudly.
    evidence: |-
      'ntr.attempt.another-child.some-attempt' is written directly in two
      places in student-mode.spec.ts. Fixing this by importing attemptKey()
      would be e2e's first cross-package import from apps/web/src/lib -- no
      existing precedent -- so it is recorded here for a deliberate call
      rather than a blind edit.
    location: >-
      e2e/tests/student-mode.spec.ts
    severity: low
  - summary: >-
      The Hand-in control's visible text changes to "Handing in..." on press
      with no aria-live confirmation that the press itself registered.
    evidence: |-
      The intent requires live-region behavior for the countdown's three
      thresholds and for the auto-submit alert; it says nothing about the
      button press itself. A screen-reader user gets no immediate spoken
      confirmation until the eventual success or failure state renders.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx (Hand in button)
    severity: low
  - summary: >-
      isAttemptState validates that answers' values are strings but never
      validates the object's keys.
    evidence: |-
      A same-origin, self-written record with an empty-string key or a
      prototype-polluting key (e.g. __proto__) would satisfy the shape check.
      This is the page's own storage, not untrusted input, so the practical
      exposure is limited, but the check is cheap to close.
    location: >-
      apps/web/src/lib/attempt-store.ts (isAttemptState)
    severity: low
  - summary: >-
      AttemptTimer's multi-threshold-skip behavior (a device waking far past a
      warning threshold) is proven only at the pure-function layer, not through
      the page's two same-tick effects end-to-end.
    evidence: |-
      attempt-clock.spec.ts unit-tests warningFor's multi-threshold skip;
      nothing exercises the page's warning-crossing effect and its
      remaining-=== 0 belt-and-braces effect together through a real render to
      confirm they resolve in the order that prevents a stale warning sentence
      from ever painting.
    location: >-
      apps/web/src/app/student/_components/AttemptTimer.tsx
    severity: low
  - summary: >-
      The Parent-View "Parent" link's clearAll call is verified by an e2e
      crossing that seeds only a foreign profile's storage record, never the
      currently bound profile's own.
    evidence: |-
      student-mode.spec.ts's mode-crossing test seeds
      'ntr.attempt.another-child.some-attempt' before clicking "Parent"; that
      record would be swept by the next screen's retainOnly call regardless of
      whether clearAll fired on the Parent-link click. No test seeds the bound
      profile's own attempt record and asserts it specifically is gone right
      after that click.
    location: >-
      apps/web/src/app/student/page.tsx (Parent link) /
      e2e/tests/student-mode.spec.ts
    severity: medium
  - summary: >-
      studentSession() is read once with no retry; a transient failure before
      the deadline is reached while offline leaves profileId unresolved for
      the rest of the session, which prevents both answer persistence and the
      offline auto-submit latch from arming.
    evidence: |-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx's profile
      effect (studentSession().then(...)) runs once on mount with no retry on
      a non-unbound failure. The hydration, persist, and deadline-latch
      effects all gate on profileId !== null, so a failed read blocks all
      three for the page's lifetime unless the tab is reloaded.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx (studentSession effect)
    severity: medium
  - summary: >-
      MAX_JSON_BODY_BYTES raises the JSON body-parser limit for the whole app,
      not scoped to the submit route it was sized for.
    evidence: |-
      apps/api/src/app-setup.ts applies useBodyParser('json', { limit:
      MAX_JSON_BODY_BYTES }) globally. Every other route's oversized-payload
      exposure grows by the same margin the submit route needed, rather than
      only the route that needed it.
    location: >-
      apps/api/src/app-setup.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A child's answers live only in React state (Story 5.2), so a refresh, a backgrounded tab, a slept device or a dropped connection destroys the work — and there is no Attempt, no server-issued clock and no way to hand anything in, so the timer the parent configured in Story 4.6 has no effect and an interruption is indistinguishable from never having started.

**Approach:** Give the Attempt a server-owned identity (`Attempt` row with a server-issued `startedAt` and, for a timed test, an immutable `expiresAt`), hold the child's answers in client-side persistent storage keyed to that Attempt, render the countdown from the server's instants without ever letting the client decide expiry, and make handing in a network-requiring act that is refused plainly while offline, never silently retried, and dispatched exactly once on reconnect when the deadline passed during the outage.

## Boundaries & Constraints

**Always:**
- Both ids come from `req.student` (the binding cookie, via `StudentModeGuard`). The path names *which* Attempt, never *whose*; every refusal on a student route is the one existing `PRACTICE_TEST_NOT_FOUND` sentence.
- `startedAt` and `expiresAt` are written by the server, from the server's clock, once, at Attempt start. `expiresAt` is `startedAt + timerMinutes` snapshotted from the Practice Test at start, or `null` for an untimed test. Neither is ever moved, extended, paused or recomputed; nothing in a request body may set or influence either.
- Expiry is decided **server-side at submit** by comparing the server's own clock to the stored `expiresAt`. A client claim about expiry is never trusted — it only decides *when the client dispatches*, never *how the attempt is judged*.
- The client-held record is keyed to Attempt **and** Student Profile, carries a 72-hour TTL measured from creation and never extended by a save (AD-16 parity, AD-26), and is removed on successful submission, on a profile switch, and on any crossing into Parent View or sign-in.
- Every browser-storage access is wrapped so a throwing or absent `localStorage` (private mode, blocked site data) degrades to in-memory answers for the page's lifetime and never breaks the screen.
- Answering and navigating work with no network: after the initial read nothing on Take Test requires a request until the child hands in.
- Submission requires the network. Offline it is refused with a plain statement, the Attempt stays open, every answer stays in the store, and it is retried **only on a person's action or on the single reconnect dispatch** — never on a timer, never in a loop, never silently.
- When the deadline passes while offline, exactly **one** auto-submit is dispatched on the next `online` transition, and the server grades it against its own `expiresAt`.
- The countdown uses `role="timer"` with a unit-bearing `aria-label`, `aria-live` off in steady state and raised only at 5 minutes, 1 minute and 20 seconds remaining; each threshold carries a matching **visible text** change, identical treatment at all three, never escalating, never colour or motion alone, never a per-tick animation.
- Auto-submit fires a `role="alert"` announcement before the screen changes, and focus lands on the heading of the state it moves to.
- Every user-facing string is parameterized in `apps/web/src/copy/student.ts`, second person, no exclamation marks, no error codes. Every figure comes from `apps/web/src/theme/tokens.ts`.
- No correctness feedback, score, grade word or parent-scoped figure appears anywhere on the screen or in any response this story adds.

**Block If:**
- The stored Practice Test cannot supply a timer duration without a schema change beyond the two new tables (it can: `PracticeTest.timerMinutes` exists).
- Making the offline-submit and expiry-on-reconnect criteria observable would require grading, a score or a results route.

**Never:**
- No grading, no grade state, no score, no rationale, no `Answer` grade column, no Mastery, no results route, no answer key. Stories 5.5–5.6.
- No blank-count confirmation dialog and no `unanswered`-versus-`incorrect` assignment. Story 5.4 owns both; this story's submit records the raw answers and closes the Attempt, and states nothing about what a blank means.
- No retake, no second open Attempt on one Practice Test, no Attempt list, no Attempt history surface. Story 5.7 and Parent View.
- No background job, no service worker, no request queue, no exponential-backoff retry, no `setInterval` retry of a submission.
- No client-side expiry decision, no clock sent up from the browser, no extendable or pausable duration.
- No Subject, Grade Level, sort band or in-progress marker on Student Home. Story 5.1.
- No change to what `GET /student/practice-tests/:id` selects: still no `answer`, no `isCorrect`, no Topic.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open a released timed test | `POST /student/practice-tests/{id}/attempt`, bound device, `timerMinutes: 20` | 201 `{ id, practiceTestId, startedAt, expiresAt, serverNow, submittedAt: null }`, `expiresAt = startedAt + 20min` | No error expected |
| Open an untimed test | Same, `timerMinutes: null` | Same shape with `expiresAt: null` | No error expected |
| Re-open a test with an open Attempt | Same call again, an Attempt exists with `submittedAt: null` | The **same** Attempt row returns, `startedAt` and `expiresAt` unchanged | No error expected |
| Draft / discarded / sibling / foreign / unknown id | Same call | 404 with the one shared sentence | 404, distinguishing nothing |
| Unbound device | Same call, no binding cookie | 401 from `StudentModeGuard` | Screen routes to sign-in only on the guard's own refusal |
| Refresh mid-Attempt | Answers entered, page reloaded | Every answer returns from the store; the countdown reads the elapsed wall-clock, not the value it held before the reload | Storage unreadable: answers start empty, screen still works |
| Backgrounded or slept device | Tab hidden 10 minutes on a 20-minute test | On return the countdown has dropped by 10 minutes; nothing paused or caught up in a jump-free animation | No error expected |
| Offline answering and navigating | Network down after the initial read | Typing, selecting, Back/Next and the map all work; no request is issued | No request to fail |
| Hand in while offline | Child activates Hand in, `navigator.onLine === false` or the call rejects with `NETWORK_STATUS` | Plain statement that it needs a connection; Attempt stays open; answers intact; no automatic re-send | The statement is the handling; the control stays live for the child to press again |
| Deadline passes while offline | `expiresAt` reached with no connection | Screen states the time is up and that it will hand in when the connection returns; on the next `online` transition exactly one submit is dispatched | A failed dispatch states the failure and waits for the next `online` or a person's press — it never loops |
| Submit of an expired Attempt | `POST /student/attempts/{id}/submit` arriving after `expiresAt` | 200 `{ submittedAt, expired: true, gradeAt: expiresAt }` — judged at the expiry instant, not arrival | No error expected |
| Submit of an already-submitted Attempt | Same call twice | The second answers 409 with a stated reason; the first result stands | Screen states it was already handed in and does not re-send |
| Submit with a foreign Attempt id | Attempt of another profile or account | 404, the same shared sentence | 404 |
| Profile switched on the device | Bound to sibling B, a record for A's Attempt is in storage | A's record is removed; B sees a clean Take Test | Removal is unconditional, not conditional on A's record parsing |
| Record older than 72 hours | `createdAt + 72h` in the past | Treated as absent and deleted on read | No error expected |

</intent-contract>

## Code Map

**API**

- `apps/api/prisma/schema.prisma:849` `PracticeTest` (`timerMinutes` at the commented block — the countdown's only source), `:908` `PracticeTestQuestion`, `:180` `StudentProfile`, `:120` `ParentAccount`. New `Attempt` and `Answer` models go after `PracticeTestQuestionTopic` (`:951`). `UncommittedState` (`:244`) is the TTL/slot-doc precedent to mirror in prose, **not** a table to reuse — AD-26 is explicitly the one uncommitted mechanism that is not parent-gated.
- `apps/api/prisma/migrations/20260925120000_add_practice_test_timer/` — the most recent migration; copy its naming and hand-written SQL convention.
- `apps/api/src/practicetest/practice-test.service.ts:630` `releasedFor()`, `:661` `releasedTestFor()` — the `where: { id, parentAccountId, studentProfileId, status: 'Released' }` shape and the single `NotFoundException(PRACTICE_TEST_NOT_FOUND)` (`:672`) every new method must reuse verbatim. `:273` `StudentPracticeTestView` — where new exported view interfaces belong. `STUDENT_TEST_SELECT` (referenced at `:668`) must not gain a field.
- `apps/api/src/practicetest/student-practice-test.controller.ts` — the whole student surface; `@Controller('student')` + `@SkipThrottle({ login: true })` + `@UseGuards(StudentModeGuard)`, both ids off `req.student!`, and the documented reason there is **no** `ParseUUIDPipe` on a student path parameter. The two new routes mount here. Its class doc claims "no student-scoped write" and must be rewritten, not left standing.
- `apps/api/src/practicetest/practice-test.module.ts` — already registers `StudentModeGuard` and the student controller. **No module change.**
- `apps/api/src/identity/student-mode.guard.ts` — `StudentRequest`/`StudentPrincipal`; the guard already resolves account + profile and refuses with `bound: false`.
- `apps/api/src/identity/uncommitted-state-policy.ts:20` `UNCOMMITTED_STATE_TTL_MS` — the 72-hour figure and the "never extended by an update" wording the client TTL is stated against.
- `apps/api/test/practice-test.int-spec.ts:2340` `describe('release and discard')` — holds `withLandedDrafts()`, `release()`, the binding-cookie helpers and `readReleased(cookie)`; the new integration cases belong beside the Story 5.2 student cases and reuse them.

**Web**

- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` — Take Test. Holds `answers`, `index`, `mapOpen`, the render-phase reset keyed on `practiceTestId`, the `requestId` ref guarding superseded reads, and the `deviceIsUnbound`-only routing rule. This is where the store, the clock and the hand-in control are wired; its header comment explicitly promises no storage and no request after the read and must be rewritten.
- `apps/web/src/app/student/page.tsx:34` `deviceIsUnbound()` (exported, the single routing rule) and the `studentSession()` read that yields `session.profile.id` — the profile the retention rule is stated against.
- `apps/web/src/app/parent/_components/BackToStudentMode.tsx:86` `bindAndLeave()` — the one place the device's binding changes; the profile-switch clearing hook belongs immediately after `bindStudentMode` resolves.
- `apps/web/src/lib/parent-api.ts:364` `ParentApiError` (`notBound`, `status`, `reason`), `:406` `NETWORK_STATUS` (status `0` — a request that never got a response, which is how offline presents), `:490` `call()` (`credentials: 'include'`, throws `ParentApiError(NETWORK_STATUS)` on a fetch rejection), `CONFLICT_STATUS` 409 with the server's own `reason`. New types and calls go in the existing `--- Student Mode ---` region beside `studentPracticeTest` (`:~690`).
- `apps/web/src/copy/student.ts` — `studentCopy.takeTest`; new strings go inside it. The file's own doc forbids a figure in a sentence that belongs to a token and forbids grade vocabulary.
- `apps/web/src/lib/answers.ts` — `isAnswered`, `answeredCount`, `progressOf`; already pure, already the map's only source of truth. Reuse; do not fork.
- `apps/web/src/lib/smart-fraction.ts` + `apps/web/src/lib/idle-expiry.ts` — the two precedents for "a rule stated purely so it is testable without a DOM"; `idle-expiry.ts` is the closest shape for a clock rule with thresholds.
- `apps/web/src/components/LiveRegion.tsx`, `Dialog.tsx` (`AppDialog`), `Button.tsx`, `Screen.tsx` — the primitives. `apps/web/src/theme/tokens.ts:57` `comfortableDensity`, `:87` `rounded`, `:102` `measure`, `:109` `motion`, `:149` `typeRoles`.
- `apps/web/vitest.config.ts` — `environment: 'node'`. Component specs render with `renderToStaticMarkup` (`apps/web/src/app/student/_components/QuestionMap.spec.tsx` is the pattern); **no click, no event, no storage and no timer advance is testable here** — those claims belong in `e2e/`.
- `e2e/tests/student-take-test.spec.ts` — the Story 5.2 end-to-end: generates and releases a test as a parent, enters Student Mode, answers, navigates and uses the map. The new spec extends this arrangement; `e2e/tests/student-mode.spec.ts` holds the binding/PIN helpers.

## Tasks & Acceptance

**Execution:**

- `apps/api/prisma/schema.prisma` -- add `Attempt` (`id`, `practiceTestId`, `parentAccountId`, `studentProfileId`, `ordinal Int`, `startedAt`, `expiresAt DateTime?`, `submittedAt DateTime?`, `expired Boolean @default(false)`, `createdAt`, `updatedAt`; `@@unique([practiceTestId, studentProfileId, ordinal])`, `@@index([studentProfileId, submittedAt])`; `PracticeTest` and `StudentProfile` relations `onDelete: Cascade`) and `Answer` (`id`, `attemptId`, `questionId`, `value String @db.Text`, `createdAt`; `@@unique([attemptId, questionId])`, both relations `Cascade`) -- doc-commented like the models above them: `expiresAt` is the server's one statement of when this Attempt ended, written once and never moved, because a timer that could be moved would retroactively change how a past Attempt graded.
- `apps/api/prisma/migrations/<timestamp>_add_attempt_and_answer/migration.sql` -- hand-written DDL for both tables in the style of the timer migration -- one migration, applied by `pnpm db:migrate`.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `AttemptView` / `AttemptSubmissionView` interfaces beside `StudentPracticeTestView`, plus `startOrResumeAttempt(parentAccountId, studentProfileId, practiceTestId)` and `submitAttempt(parentAccountId, studentProfileId, attemptId, answers)`. Start runs in one transaction: find the released test with all three ids and `status: 'Released'` in the `where` (404 otherwise), return the existing `submittedAt: null` Attempt untouched if there is one, else insert with `startedAt = now`, `ordinal = max + 1` and `expiresAt = timerMinutes === null ? null : startedAt + timerMinutes`. Submit runs in one transaction: find the Attempt by id **and** both ids (404 otherwise), refuse a second submission with a 409 carrying a stated reason, write the answers as `Answer` rows keyed by question (ignoring any question id not on that Practice Test and any blank value), set `submittedAt = now` and `expired = expiresAt !== null && now > expiresAt`, and return `{ submittedAt, expired, gradeAt: expired ? expiresAt : submittedAt }` -- the expiry comparison is on the server's clock against the server's column, so nothing a browser sends can buy time or lose it.
- `apps/api/src/practicetest/student-practice-test.controller.ts` -- add `@Post('practice-tests/:practiceTestId/attempt')` and `@Post('attempts/:attemptId/submit')`, both taking both ids from `req.student!`, the second taking a validated body of `{ answers: { questionId: string; value: string }[] }`; rewrite the class doc, which currently claims there is no student-scoped write -- there now is exactly one kind, and it writes only the child's own answers and the Attempt's own instants.
- `apps/api/src/practicetest/dto/attempt-submit.dto.ts` -- **new**: a `class-validator` DTO bounding the array length and each value's length, shaped after the existing `dto/` files -- the body is the only student-authored input the API accepts anywhere, so its bounds are stated rather than assumed.
- `apps/api/test/practice-test.int-spec.ts` -- integration cases beside the Story 5.2 student cases: start returns a server `startedAt` and an `expiresAt` exactly `timerMinutes` later; start on an untimed test returns `expiresAt: null`; a second start returns the same Attempt id with unchanged instants; draft/discarded/sibling/foreign/unknown ids each answer 404 with the identical sentence and an unbound call answers 401; submit persists the answers, sets `submittedAt`, and a second submit answers 409; a submit of an Attempt whose `expiresAt` is already in the past answers `expired: true` with `gradeAt` equal to `expiresAt`; the serialized bodies of both routes contain no `answer`, `isCorrect`, `topic`, `cost`, `tier` or model key (assert over `JSON.stringify`).
- `apps/web/src/lib/attempt-store.ts` -- **new**, pure and `Storage`-injected: `ATTEMPT_STATE_TTL_MS` (72 hours, stated against AD-16's figure and never extended by a save), `readAttemptState(storage, profileId, attemptId)`, `writeAttemptState(...)`, `clearAttemptState(...)`, `retainOnly(storage, profileId)` and `clearAll(storage)`; every accessor wrapped so a throwing or absent storage yields `null` rather than an exception, a malformed or wrong-profile record is deleted on read, and a record past its TTL is treated as absent -- injected rather than reaching for `window`, because `apps/web` tests run with no DOM and this rule is the one that decides whether a child's work survives.
- `apps/web/src/lib/attempt-store.spec.ts` -- **new**: a round trip; a record written under one profile is invisible and removed under another; `retainOnly` keeps the current profile's record and drops every other; an expired record reads as `null` and is gone afterwards; malformed JSON reads as `null` and is gone; a storage whose getter and setter both throw never throws out of any function.
- `apps/web/src/lib/attempt-clock.ts` -- **new**, pure: `remainingMs({ expiresAt, serverNow, syncedAt, now })` computing against the server-issued instants through a fixed offset (never the browser's unadjusted clock), `WARNING_THRESHOLDS_MS = [300_000, 60_000, 20_000]`, `warningFor(previousMs, remainingMs)` returning the threshold just crossed or `null`, and `formatRemaining(ms)` yielding both a displayed `m:ss` and a spoken unit-bearing string -- pure so "the clock never pauses and warns exactly three times" is assertable by advancing a number instead of a device.
- `apps/web/src/lib/attempt-clock.spec.ts` -- **new**: remaining falls monotonically with wall-clock including across a simulated ten-minute gap; a threshold fires once and only on the crossing render, never on a later tick below it; all three fire on a run from full to zero and no fourth; remaining clamps at zero and never goes negative; `expiresAt: null` yields `null` remaining and no warning ever; the spoken form carries units and the displayed form does not repeat them.
- `apps/web/src/lib/attempt-submit.ts` -- **new**, pure policy: `submitDecision({ online, expiredAt, submitted })` returning `'send' | 'refuse-offline' | 'wait-for-online' | 'already-submitted'`, and a `PendingSubmit` latch (`armPending`, `takePending`) persisted in the attempt record so a deadline reached offline survives a reload and is consumed **exactly once** -- a take that empties the latch is what makes "never silently retried" a property of the code rather than a promise about it.
- `apps/web/src/lib/attempt-submit.spec.ts` -- **new**: offline with no expiry refuses; offline after expiry waits; online after expiry sends; a taken latch is empty on the next take, so two `online` events produce one dispatch; an already-submitted Attempt sends nothing whatever the network says.
- `apps/web/src/lib/parent-api.ts` -- add `AttemptView`, `AttemptSubmissionView`, `startAttempt(practiceTestId)` and `submitAttempt(attemptId, answers)` in the `--- Student Mode ---` region, both no-bearer and cookie-carried like the other student calls, with `studentCopy.takeTest` failure messages -- and export nothing that could let a caller name a profile.
- `apps/web/src/copy/student.ts` -- add inside `takeTest`: `timerLabel(spoken)` and `timerRemaining(display)`, `timerWarning(spoken)` (one sentence, identical at all three thresholds, no exclamation mark), `timeUp`, `handIn`, `handingIn`, `handedIn`, `handedInHeading`, `offlineSubmit` (states that handing in needs a connection and that the answers are kept), `offlineExpired` (states the time is up and that it will be handed in when the connection returns), `autoSubmitAnnouncement`, `alreadyHandedIn`, `submitFailed` -- second person, no figure written into a sentence that belongs to a token, and not one grade or score word.
- `apps/web/src/app/student/_components/AttemptTimer.tsx` -- **new** presentational component taking `remainingMs` and `warning`: renders `role="timer"` with a unit-bearing `aria-label`, the `m:ss` value as plain text that changes in place with no transition, and the warning as a **visible sentence** rendered identically at every threshold, with `aria-live="polite"` applied only while a warning is showing -- one component so the rail and the column cannot render two different clocks.
- `apps/web/src/app/student/_components/AttemptTimer.spec.tsx` -- **new**, static render: `role="timer"` present with a unit-bearing label; no warning sentence in steady state and `aria-live` absent; the warning sentence present and the markup identical in structure at all three thresholds; no score, percentage or correctness word; no animation or transition property in the rendered style.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` -- start or resume the Attempt after the test read, hydrate `answers` and `index` from the store on mount, persist on every change, render `AttemptTimer` from `attempt-clock` on a `setInterval` that re-reads the wall clock rather than counting its own ticks, listen for `online`/`offline` and `visibilitychange`, render the Hand in control and the handed-in state (heading focused on arrival, `role="alert"` announcement on an auto-submit), state the offline refusal and the offline-expired sentence, and clear the record on a successful submit; keep the existing `deviceIsUnbound`-only routing rule, the `requestId` guard and the render-phase reset, extending the reset to the Attempt and the store key; rewrite the header comment, which currently promises no storage and no request after the read.
- `apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx` -- extend the existing source-region assertions: the only `router.replace` is still guarded by `deviceIsUnbound`; the page calls only student-scoped `parentApi` members; the source contains no `setInterval`-driven re-submit, no `catch`-and-resend, and no `score`, `correct` or `grade` identifier in code with comments stripped; every `localStorage` reference goes through `attempt-store`.
- `apps/web/src/app/student/page.tsx` -- after `studentSession()` resolves, call `retainOnly(storage, session.profile.id)` -- Student Home is the screen every child passes through, so it is where a sibling's abandoned work stops being on the device.
- `apps/web/src/app/parent/_components/BackToStudentMode.tsx` -- after `bindStudentMode` resolves, `retainOnly(storage, profileId)` -- the binding changing is precisely the mode-gate crossing AD-26 says clears the client-held answers.
- `e2e/tests/student-attempt-resilience.spec.ts` -- **new**: release a timed test, open it, answer two questions, reload and confirm both answers and the map state return and the countdown has fallen rather than reset; go offline via the browser context and confirm typing, Back/Next and the map still work with no request issued; press Hand in offline and confirm the connection sentence appears, the answers are still there and no submit request went out; go back online and confirm nothing was re-sent on its own; press Hand in again and confirm exactly one submit request and the handed-in state; in a second run let a short timer expire while offline and confirm exactly one submit is dispatched on reconnect and the response reports `expired: true`.

**Acceptance Criteria:**

- **Given** a released Practice Test, **when** the child opens it twice with an Attempt already open, **then** one Attempt row exists with its original server-issued `startedAt` and `expiresAt`, and nothing the browser sent influenced either instant.
- **Given** answers entered on several Questions, **when** the tab is reloaded, backgrounded for ten minutes, or the device sleeps and wakes, **then** every answer and the question map's state return intact and the countdown reflects elapsed wall-clock time across the gap, having neither paused nor jumped backwards.
- **Given** no network after the initial read, **when** the child types, selects, navigates with Back/Next and jumps through the map, **then** all of it works and not one request is issued.
- **Given** no network, **when** the child hands in, **then** a plain sentence says it needs a connection, the Attempt stays open with every answer intact, and no further submit is issued until a person acts or the single reconnect dispatch fires.
- **Given** a timed Attempt whose deadline passes while offline, **when** the connection returns, **then** exactly one submit is dispatched, the server answers `expired: true` with `gradeAt` equal to the stored `expiresAt` rather than the arrival instant, and every answer entered before the outage is in the persisted set.
- **Given** a timed Attempt running on screen, **when** 5 minutes, 1 minute and 20 seconds remain, **then** each threshold produces one announcement and one visible text change, the treatment is identical at all three, nothing escalates, and no announcement occurs between thresholds.
- **Given** an Attempt handed in successfully, **when** the store is inspected, **then** its record is gone; **and given** the device is then bound to a sibling, **then** no record of the first child's work remains under any key.
- **Given** an Attempt id belonging to another profile or account, **when** submit is called with a valid binding cookie, **then** it answers the same 404 sentence every other student refusal answers.
- **Given** the whole change, **when** `pnpm lint`, `pnpm typecheck`, `pnpm test` and the new e2e spec run, **then** all pass, exactly one migration was added, and no response body this story adds contains a correct answer, a grade, a score or a parent-scoped figure.

## Spec Change Log

- 2026-09-25: Dispatched at `status: in-review` but no implementation existed on disk (no `Attempt` model, no `attempt-*` files, no new migration, HEAD still at Story 5.2). Reset to `in-progress` and implemented from the frozen contract; no intent-contract content changed.

- 2026-09-25: Implementation deviations from the **Execution** task text, all recorded rather than silently taken:
  - `startOrResumeAttempt` resumes **any** existing Attempt for the pair, not only one with `submittedAt: null`. The task text's "else insert" would open a second Attempt when a child re-opens a test already handed in, which the **Never** list forbids ("no retake, no second open Attempt"); an e2e run reproduced it. `ordinal` therefore stays `1` until Story 5.7. An integration case pins the resumed-handed-in read.
  - `Attempt.parentAccountId` is a plain column with no foreign key. `PracticeTest`'s own edge to the account is `Restrict` (AD-14); a second cascading edge to the same account would contradict it. Both ids are still in every `where`.
  - `AttemptTimer` renders in the Question column, not the rail: the rail is `display: none` below `md`, so a rail-mounted countdown is invisible on a phone. Still exactly one instance.
  - `e2e/tests/student-take-test.spec.ts` was edited: Story 5.2 asserted `localStorage` was empty, which this story necessarily falsifies. It now asserts exactly one key exists, under the `ntr.attempt.` prefix, and nothing else is written.
  - Three new `e2e/fixtures.ts` helpers (`setNewestDraftTimerFixture`, `newestAttemptFixture`, `countAttemptsFor`) were added beyond the file list: a one-minute timer cannot be configured through the parent form, and `expired` is a column no screen shows.
  - `clearAttemptState`'s sibling `clearAll(storage)` is exported and currently unused — the sign-in / parent-crossing caller it was written for is outside this story's file list.

- 2026-09-26 (`/bmad-loop-resolve`, human-decided): the dev session that produced the entry above **timed out before committing**, and the orchestrator deferred this story (`phase: deferred`, `defer_reason: dev session timeout`) and moved on to Story 5.4. The working tree was reverted, so the entry above describes code that is **not on disk**: no `Attempt`/`Answer` in `schema.prisma`, no `_add_attempt_and_answer` migration, no `attempt-store` / `attempt-clock` / `attempt-submit` / `AttemptTimer`, no `student-attempt-resilience` e2e spec. `sprint-status.yaml` correctly lists this story as `backlog`.

- 2026-09-26: the implementation is **not lost** — the orchestrator preserved the dirty worktree as a commit parented on this spec's `baseline_revision` (`500462b`):
  - `refs/attempt-preserve-dirty/20260923-210321-45b5-500462b1-2` — attempt 2, 2026-09-25 16:59, 25 files, +3959/-61. **This is the one to restore**; its file set matches the deviations recorded above.
  - `refs/attempt-preserve-dirty/20260923-210321-45b5-500462b1-1` — attempt 1, 2026-09-25 15:29, 26 files, +3861/-79. Superseded; keep only as a fallback.

  Restore it onto a clean tree at `500462b` with:

  ```
  git checkout refs/attempt-preserve-dirty/20260923-210321-45b5-500462b1-2 -- .
  ```

  The snapshot is **unverified**: the session died mid-dev, so none of the Verification commands below were confirmed green and no review pass ran. A resumed session must treat it as an in-progress tree — run every Verification command, fix what fails, then review. The Execution list above stays authoritative where the snapshot diverges from it, except for the deviations already recorded in the entry above, which are accepted.

- 2026-09-26: **Ordering is binding.** Story 5.4 (`5-4-submitting-an-attempt`) escalated because it was dispatched while this story's route did not exist on disk. Story 5.4 extends `POST /student/attempts/{id}/submit`; it must not be dispatched until this story is committed.

- 2026-09-26 (`/bmad-loop-resolve 5-4-submitting-an-attempt`, human-decided): Story 5.4 halted a **second** time at its version-control sanity check, because this spec sat untracked in the working tree while its implementation was absent from disk. The human resolved the escalation as: **this story is finished first, from the preserved snapshot.** Binding consequences:

  1. This story is driven in its own scoped `bmad-loop` run before Story 5.4 is re-dispatched. That run restores `refs/attempt-preserve-dirty/20260923-210321-45b5-500462b1-2` (`8c6acc8`, parented on `500462b`, fast-forwardable, 25 files, +3959/-61) onto a clean tree at `baseline_revision`, treats it as an **in-progress, unverified** tree, runs every command under **Verification**, fixes what fails, reviews, and commits the implementation **together with this spec file** — the untracked spec is the obstruction and must stop being untracked.
  2. Re-planning this story from scratch and re-scoping the `Attempt` entity / submit route onto Story 5.4 were both considered and **rejected**: the snapshot is intact and the ordering note above already settled ownership. The `Attempt` model, `Answer` model, the `_add_attempt_and_answer` migration and `POST /student/attempts/{id}/submit` remain **this story's** deliverables.
  3. Story 5.4 stays blocked until this story's commit exists. Resuming run `20260923-210321-45b5` before that commit reproduces the same step-01 halt.
  4. `sprint-status.yaml` (`backlog` here) is orchestrator-owned and was not edited by the resolution; it is reconciled by the scoped run, not by hand.

- 2026-09-26 (queue order, human-decided): the restore run for this story is queued **after** Stories 3.1 and 3.4, whose implementations are missing the same way this one's was. Order: `3-1-multi-page-capture-camera-library`, `3-4-legibility-check-upload-commit`, this story, then `5-4-submitting-an-attempt`. Their snapshots are `refs/attempt-preserve-dirty/20260923-210321-45b5-b38a8047-2` (3.1 — note its spec exists only inside that ref; it is not on disk) and `refs/attempt-preserve-dirty/20260923-210321-45b5-9ce972f1-2` (3.4). Nothing in this story reads the source-test ingest path, so the ordering is a sequencing choice, not a dependency: this story's own restore is unaffected by it.

- 2026-09-27 (restore run, mechanical reconciliation before implementation): the snapshot was restored, but **not** with the `git checkout <ref> -- .` command recorded above -- HEAD has moved past `500462b` since that command was written, and a whole-tree checkout would have reverted Stories 3.1, 3.4 and 5.1. What was done instead, and what it means for the code now on disk:

  1. `baseline_revision` is now `4cff0d6` (`story 5-1-student-s-test-list`), the HEAD this restore started from. The old value `500462b` was the snapshot's parent and no longer describes this run's diff.
  2. `refs/attempt-preserve-dirty/20260923-210321-45b5-500462b1-2` (`8c6acc8`) was applied onto `4cff0d6` as a three-way merge (`git cherry-pick -n`), so only the snapshot's own changes landed and the three intervening stories were preserved. 23 of the snapshot's 25 files merged; two conflicted.
  3. **`schema.prisma` conflict (resolved).** Story 5.1 landed a minimal, deliberately read-only `Attempt` model of its own (`id`, `practiceTestId`, `startedAt` with a database default, `submittedAt`, timestamps, `@@index([practiceTestId, submittedAt])`) and a migration `20260927090000_add_attempt` that creates the `attempt` table. This story's fuller `Attempt` supersedes it and was taken, with one addition: Story 5.1's `@@index([practiceTestId, submittedAt])` is **kept alongside** this story's `@@index([studentProfileId, submittedAt])`, because the student list's read path still filters on it.
  4. **Migration reconciled.** The snapshot's `20260925150000_add_attempt_and_answer` sorted *before* Story 5.1's `20260927090000_add_attempt` and would have created the `attempt` table twice. It was deleted and replaced by a forward migration, `20260927120000_extend_attempt_and_add_answer`, which alters the existing `attempt` table (adds `parentAccountId`, `studentProfileId`, `ordinal`, `expiresAt`, `expired`; drops the `startedAt` default) and creates `answer` with its indexes and foreign keys. It opens with `DELETE FROM "attempt"` because nothing ever wrote an `attempt` row before it -- Story 5.1 created the table read-only -- so the NOT NULL columns can be added without a default and the migration still applies to a database migrated at Story 5.1. **Verification expects exactly one new migration directory, and this is it**; do not generate a second one.
  5. **`spec` conflict (resolved).** The snapshot carried an older copy of this spec file; the on-disk copy (this file, with every resolution note above) was kept.

  The tree is therefore **in-progress and unverified**, exactly as the resolution above requires: nothing in the snapshot was ever run green, and the Story 5.1 reconciliation in points 3 and 4 is itself untested. In particular, `apps/api/test/practice-test.int-spec.ts` merged *both* stories' cases, and Story 5.1's own Attempt fixtures predate the new required columns (`parentAccountId`, `studentProfileId`, `ordinal`, and a `startedAt` the server must now supply) -- expect them to need updating. Run every command under **Verification**, fix what fails, and keep the **Execution** list authoritative where the snapshot diverges from it.

- 2026-09-27 (verification of the restored tree): every command under **Verification** was run and is green. Two things in the restored snapshot were stale against stories that landed after it was taken, and both were fixed rather than worked around:

  1. **Story 5.1's `seedAttempt` fixture** (`apps/api/test/practice-test.int-spec.ts`) still wrote `{ practiceTestId, submittedAt }`, which no longer type-checks against the fuller `Attempt`. It now resolves `parentAccountId` and `studentProfileId` from the Practice Test row itself and counts `ordinal` from the Attempts already there, so every existing call site reads unchanged and the two cases that seed two sittings on one test do not collide on `@@unique([practiceTestId, studentProfileId, ordinal])`. Resolved from the row rather than passed in on purpose: the call sites are about *bands on Student Home*, not about who owns an Attempt.
  2. **`e2e/tests/student-attempt-resilience.spec.ts`'s `openTimedTest` helper** drove the pre-Story-3.4 upload flow: one `Check pages` press straight to `submitted-note`. Story 3.4 split that into a check and the commit it gates, so the helper now presses `Check pages`, waits for `legibility-continue` and clicks it, exactly as `student-take-test.spec.ts` and `parent-practice-test.spec.ts` do. The spec's own assertions were not touched.

  Nothing else in the snapshot needed changing: `startOrResumeAttempt`, `submitAttempt`, the DTO, the store, the clock, the latch, `AttemptTimer` and the Take Test wiring were all green as restored, and `prisma migrate diff` reports **no difference** between `20260927120000_extend_attempt_and_add_answer` and `schema.prisma` -- the Story 5.1 migration reconciliation applies cleanly onto a database already migrated at 5.1.

  Two environmental notes, neither a code fault:
  - A **local** `nts_e2e` database migrated by the dead 2026-09-25 session still had the deleted `20260925150000_add_attempt_and_answer` recorded and failed `migrate deploy` with `relation "attempt" already exists`. Dropping `nts_e2e` and letting `e2e:prepare` rebuild it is the fix; a fresh database was never affected. Anyone whose e2e database was touched by that session needs the same drop.
  - `e2e/tests/parent-auth.spec.ts`'s two **password-reset** cases fail on this machine. Confirmed pre-existing: they fail identically with this story's whole diff stashed and both apps rebuilt at `baseline_revision`. This story touches no auth, identity or mail file. The other 70 e2e cases pass.

- 2026-09-27 (review loop, 15 patch findings applied): a four-layer review of the restored tree produced 15 findings, all applied in place; none needed a contract change. Grouped by what they were about:

  **The automatic hand-in (HIGH).** The deadline effect carried `submitState` in its dependency list, so a failed auto-submit setting it back to `open` re-satisfied the effect while the clock still read zero and the browser was still online -- an unbounded dispatch loop, against "never on a timer, never in a loop, never silently". It now records the Attempt whose deadline it has acted on in a ref, cleared by the render-phase reset, and acts once whatever comes of it. The same effect gained the hydration guard its sibling reconnect effect already had: without it, resuming an already-expired Attempt online submitted the **empty** answer set before the store had been read, and the success path then cleared the record -- the child's work destroyed by the mechanism meant to hand it in. The reconnect effect now checks `inFlight` **before** taking the latch, so a take is never spent against a dispatch `send` will refuse.

  **The hand-in control (HIGH).** `send` returned silently when `profileId` was null, so any `studentSession()` failure other than an unbound device left Hand in enabled and inert. Dispatch is now gated on the Attempt alone -- the server takes both ids off the binding cookie and needs nothing this screen knows about a profile -- and only the store calls are guarded on the profile.

  **The countdown warning (HIGH).** The warning latched and never cleared, so the sentence sat inside a live region between thresholds and at 0:00 the screen stated both that the time was up and that twenty seconds remained. `WARNING_VISIBLE_MS` (10s, shorter than the smallest threshold) now bounds it, it is cleared when the countdown reaches zero, and it is reset on a move to another test.

  **The auto-submit announcement.** Adding the online-expiry end-to-end case the review asked for showed the `role="alert"` announcement was only mounted between the dispatch and the response -- a few milliseconds, which is no announcement at all. It is now carried into the handed-in state and rendered ahead of the heading focus lands on, so the reason the screen moved is the first thing read out. A hand-in the child pressed themselves still gets no such sentence.

  **Concurrency, server side.** Two simultaneous starts both found no row and both inserted `ordinal: 1`, and the loser surfaced as a 500 rather than resuming. The insert's transaction is now retried once on a `P2002`, **outside** the transaction -- Postgres aborts the whole transaction on a constraint violation, so recovering where the insert failed is not something a retry inside it can do. Two simultaneous hand-ins both read `submittedAt: null` and the loser collided on `answer_attemptId_questionId_key` as a 500; the Attempt is now closed by a conditional `updateMany` carrying `submittedAt: null` in its `where`, before any answer is written, so "a second submission answers 409" is structural rather than sequential.

  **Bounds and transport.** `MAX_ANSWERS_PER_SUBMISSION` is now `MAX_QUESTIONS` rather than an independently chosen 500, `questionId` has its own `MAX_QUESTION_ID_LENGTH` instead of borrowing the Short Answer prose ceiling, and `MAX_JSON_BODY_BYTES` is computed from both and applied in `app-setup.ts`. Express defaults to 100KB, so the largest paper the DTO allowed was refused in transport as a 413 -- which the screen can only read as the generic failure, leaving a child pressing Hand in forever on work that would never be taken. The Short Answer input is capped at the same figure (mirrored as `MAX_ANSWER_LENGTH` in `apps/web/src/lib/answers.ts`, the way `attempt-store.ts` already mirrors the TTL), so the ceiling is met while typing rather than discovered after the work is done.

  **Status code.** The submit route answers **200**, per the matrix; the start route keeps its 201 because it may insert. Seven integration expectations moved with it.

  **The sweep's missing crossings.** `clearAll` had no call site at all, so a child's answers survived a sign-in on a shared device. It is now called after a successful `parentApi.signIn` and on the Student Mode exit to `/parent/pin` -- `clearAll` rather than `retainOnly` at both, because past either gate nobody is a child.

  **Shape guards.** `remainingMs` now checks `now` for finiteness like the other three instants (`Math.max(0, NaN)` is `NaN`, which renders `NaN:NaN` and never reaches zero), and the store rejects a non-finite `pendingSubmitAt` -- which is neither null nor a time, so it read as an **armed** latch and would dispatch an auto-submit no deadline asked for -- along with a negative or fractional `index`.

  **Tests that could not fail.** Four of this story's own claims were asserted only as regexes over the page's source. Each now has an assertion that executes the behaviour: the warning sentence becoming visible on a real device (in the one-minute e2e, before it goes offline); a new online-expiry e2e asserting the `role="alert"` announcement, the handed-in state and **exactly one** submit after a settle; a new two-crossing case in `student-mode.spec.ts` seeding a foreign-profile record and asserting it is gone after the handover *and* after Student Home, so neither `retainOnly` call site can be deleted unnoticed; and a new two-tab e2e driving a real 409 and asserting it lands on the handed-in state with the record cleared. Three integration cases were added: a body at exactly every bound accepted rather than 413'd, and the two concurrency races. The page spec's blanket `not.toMatch(/setTimeout/)` was narrowed to "exactly one, and it is the warning's" -- a blanket ban reads as the stronger claim while being the weaker one, since the next timer added for any reason has to relax it.


## Review Triage Log

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 15: (high 4, medium 8, low 3)
- defer: 3: (high 1, medium 2, low 0)
- reject: 6: (high 0, medium 1, low 5)
- addressed_findings:
  - `[high]` `[patch]` The deadline effect retried auto-submit in an unbounded loop: `submitState` was in its dependency list, so a failed auto-submit setting `'open'` re-satisfied the effect while the clock read zero and the device was online, contradicting the intent's "never on a timer, never in a loop, never silently". Fixed with a `deadlineActedFor` ref set before either branch and cleared by the render-phase reset.
  - `[high]` `[patch]` The deadline effect had no hydration guard, unlike its sibling, so resuming an already-expired Attempt online submitted the empty answer set and then cleared the child's stored work. The `hydratedFor !== attempt.id` guard was added.
  - `[high]` `[patch]` `send` returned silently when `profileId` was null, so a failed `studentSession()` read left Hand in enabled and a press a complete no-op. Dispatch is now gated on the Attempt alone; only the store calls are profile-guarded.
  - `[high]` `[patch]` The threshold warning latched: it was never cleared, so the sentence stayed inside a live region between thresholds and 0:00 showed the time-up sentence beside a stale "20 seconds left", against "`aria-live` off in steady state". `WARNING_VISIBLE_MS` was added beside `WARNING_THRESHOLDS_MS` (asserted shorter than the smallest threshold); the warning clears on elapse, at zero, and on a new test.
  - `[medium]` `[patch]` The reconnect effect took the latch even with a manual submit in flight, so the latch was spent, nothing dispatched, and the screen still said the hand-in was arranged. It now checks `inFlight.current` before `takePending`.
  - `[medium]` `[patch]` The submit route answered 201 where the matrix states 200. `@HttpCode(HttpStatus.OK)` on submit only; seven integration assertions moved to 200, every start assertion left at 201.
  - `[medium]` `[patch]` `clearAll` had no call site although the intent requires the record removed on any crossing into Parent View or sign-in. It is now called after a successful `signIn` and on the Student Mode exit to `/parent/pin`, both asserted.
  - `[medium]` `[patch]` Two concurrent starts both inserted `ordinal: 1` and the loser surfaced as a 500 instead of resuming. Retried once on `P2002`, outside the transaction — inside it cannot work, because Postgres aborts the whole transaction on a constraint violation, and the new test caught that first attempt.
  - `[medium]` `[patch]` Two concurrent submits both passed the `submittedAt: null` read and the loser tripped the answer unique index as a 500 rather than the stated 409. The Attempt is now closed by a conditional `updateMany` carrying `submittedAt: null` in its `where`, before any answer is written.
  - `[medium]` `[patch]` The DTO's bounds (500 × 2000 ≈ 1MB) exceeded Express's default 100KB body limit, so a large paper was rejected as 413 before validation and mapped to the generic failure the child could only retry. `MAX_ANSWERS_PER_SUBMISSION` is now derived from `MAX_QUESTIONS`, and a computed `MAX_JSON_BODY_BYTES` is applied in `app-setup.ts`; an integration case covers the accepted edge.
  - `[medium]` `[patch]` Resuming an Attempt the server reported as already submitted left the record on the device for its full 72 hours, against "removed on successful submission". It is now cleared on that path.
  - `[medium]` `[patch]` Four of this story's own claims could not fail a test, because the page's specs assert regexes over its own source: the page wiring `warningFor` into a visible warning, the online-expiry auto-submit and its `role="alert"` announcement, the profile-switch sweep, and a 409 on submit landing on the handed-in state. Added warning visibility to the one-minute end-to-end, a new online-expiry case, a two-crossing case pinning both `retainOnly` sites, a two-tab case driving a real 409, and three integration cases.
  - `[low]` `[patch]` `questionId` was bounded by `MAX_ANSWER_LENGTH`, the Short Answer prose ceiling; it now has its own `MAX_QUESTION_ID_LENGTH`.
  - `[low]` `[patch]` The Short Answer input had no `maxLength`, so a child could type past the server's ceiling and learn of it only as an unexplained hand-in failure. Capped from the mirrored policy figure.
  - `[low]` `[patch]` `remainingMs` never checked `now` for finiteness (rendering "NaN:NaN" and never reaching zero), and the store's shape check accepted a NaN `pendingSubmitAt` and a negative or fractional `index`. Guards added, with a case pinning that legitimate zeros survive.

Rejected in this pass, recorded so a later pass does not re-litigate them: the `serverNow` stamp's placement after the transaction commits; `submitDecision`'s `'already-submitted'` branch being unreachable from the Hand in control; the unescaped `.` separator in the store's keys (both ids are UUIDs); the `DELETE FROM "attempt"` opening the new migration (nothing ever wrote that table before it, and the reason is stated in the migration); the double read per keystroke inside `writeAttemptState`; and the observation that an offline reload cannot restore the screen — the Questions come from the network by design, and the intent's resilience claims are about the answers, not the paper.

One change went beyond the findings, on the implementation session's judgement and recorded here for the next reviewer: the `role="alert"` auto-submit announcement was mounted only between dispatch and response — a few milliseconds, so no child or screen reader could ever have received it. `autoSubmitting` is now carried into the handed-in state and the alert renders ahead of the focused heading. The intent's "fires before the screen changes" was satisfied literally before this change, but unobservably.

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 3, low 0)
- defer: 7: (high 0, medium 2, low 5)
- reject: 5: (high 0, medium 1, low 4)
- addressed_findings:
  - `[medium]` `[patch]` Both the deadline effect and `handIn`'s offline branch armed the reconnect latch only `if (profileId !== null)`, but marked the Attempt acted-once (or set `waitingForOnline`) regardless — so a deadline reached, or a hand-in pressed, before `studentSession()` had resolved left the screen saying the hand-in was arranged while nothing was ever written to the latch, and (in the effect) the acted-once guard then permanently blocked a retry once the profile did resolve. The deadline effect now defers marking acted-once until `profileId` is known, so it re-runs and arms correctly once the profile settles; `handIn`'s branch now falls back to the existing "offline, press again" note instead of claiming an arm that didn't happen. The manual Hand in control was already unaffected (`send` never gated on the profile), so recovery was always available by a second press; this fixes the automatic and stated paths to match.
  - `[medium]` `[patch]` `MAX_JSON_BODY_BYTES`'s "doubling is JSON escaping" reasoning bounded UTF-16 code units at 2 bytes each, but a JSON control-character escape (`\u00XX`) is six ASCII bytes for one code unit — a bound sized from UTF-8 width alone would still be short of that. A legitimate maximum-length answer using the worst-case escape could 413 before validation ever saw it, which is exactly the failure this constant exists to prevent. Changed the multiplier from 2x to 6x and corrected the comment; the existing edge-of-every-bound integration case (ASCII-only) still passes with the larger, still-safe ceiling.
  - `[medium]` `[patch]` The AD-26 sign-in sweep (`clearAll(attemptStorage())` in `sign-in/page.tsx`) was verified only by a source-text regex in `sign-in/page.spec.tsx` (`environment: 'node'`, no render) — a change that kept the exact wording while breaking the runtime effect would pass every existing test. Added an end-to-end case in `student-mode.spec.ts` that seeds a foreign-profile record, signs out, signs back in through the real form, and asserts the record is gone afterward (and still present right after sign-out, so the assertion isn't vacuous).

Two findings from this pass were downgraded from patch to defer rather than fixed blind: a matching test-execution gap on the Hand-in dispatch's null-profile guard (`page.spec.tsx`'s regex-only assertion) needs network-mock e2e infrastructure this suite doesn't have a precedent for, and this session had no way to run it to confirm it passes; and a hardcoded sibling storage key in `student-mode.spec.ts` would need either a new cross-package import from `e2e` into `apps/web/src/lib` (no existing precedent) or a duplicated encoding, both worth a deliberate call rather than a blind edit. Both are recorded below with the fix already described.

Rejected in this pass: `submitAttempt`'s missing `status: 'Released'` re-check (duplicate of the existing `deferred` entry — nothing new to add); `writeAttemptState`'s read-then-stringify-then-write per keystroke (a defended, deliberate tradeoff already commented in the code, not a defect); `e2e/tests/student-attempt-resilience.spec.ts`'s `openTimedTest` setting the timer by a direct DB write rather than the parent-facing UI (deliberate test-isolation choice, consistent with this story's own layering design note); the `MAX_QUESTION_ID_LENGTH` comment's fragile tie to "ids are UUIDs" (cosmetic); and the intent-alignment audit's output, which is descriptive only — every divergence it named is already disclosed in this file's own Spec Change Log.

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (medium 2, low 0)
- defer: 6: (medium 3, low 3)
- reject: 6: (medium 1, low 5)
- addressed_findings:
  - `[medium]` `[patch]` The reconnect-take effect empties the latch before calling `send(true)`; if that dispatch then failed for a reason other than "already submitted" or "device unbound", `submitState` went back to `'open'` but `waitingForOnline` stayed `true` — the screen showed both "your work will be handed in automatically" and the failure sentence at once, with no automatic retry left to satisfy the first claim. `setWaitingForOnline(false)` added to that failure branch alongside `setSubmitState('open')`.
  - `[medium]` `[patch]` `MAX_JSON_BODY_BYTES` applied the 6x JSON-escaping multiplier to `MAX_ANSWER_LENGTH` but added `MAX_QUESTION_ID_LENGTH` raw, unmultiplied — `questionId` carries no `@IsUUID` and no character restriction (deliberately, per the DTO's own comment), so it is exactly as exposed to the same worst-case escape as the answer text. A maximally-escaping `questionId` across a full-size submission could 413 before validation, the failure this constant exists to prevent. Both fields now carry the 6x.

Two findings this pass restate claims already adjudicated in this file: `submitAttempt`'s missing `status: 'Released'` re-check and the Hand-in dispatch's regex-only test (both already in `deferred`, unchanged here), and the store key's unescaped `.` separator (rejected twice already as noise since both ids are UUIDs) — its doc comment was nonetheless tightened in passing to state that UUID-shaped ids are the actual safety property, not the encoding, since the fix was a one-line, zero-risk wording correction already sitting in the diff under review.

Rejected in this pass: `writeAttemptState` not re-validating the shape `readAttemptState` checks on read (every caller is this file's own typed code, not untrusted input); a narrower cascade-delete race on `submitAttempt`'s `updateMany` reporting 409 instead of 404 (a fourth variant of the concurrency window already covered by three `deferred` entries); the Review Triage Log's own formatting inconsistency between two prior passes (cosmetic, no consumer-facing effect); no client-side ceiling matching `MAX_ANSWERS_PER_SUBMISSION` before dispatch (the server enforces it; the intent asks for nothing client-side); and no storage sweep on a parent sign-out/logout action (no such action exists anywhere in this diff's scope).

Deferred rather than fixed blind, none of them contradicting the intent and each needing a call this session had no standing to make alone: the Hand-in control's "Handing in…" state change carrying no `aria-live` confirmation of the press itself (the intent requires live-region behavior for the countdown and the auto-submit alert, not for this); `isAttemptState` accepting an `answers` object without checking its keys (same-origin storage the page already trusts, not untrusted input, but cheap to close); `AttemptTimer`'s multi-threshold-skip behavior proven only at the pure-function layer, not through the page's two same-tick effects end-to-end; the Parent-View "Parent" link's `clearAll` call verified by an e2e crossing that seeds only a foreign profile's record, never the bound profile's own, so a regression narrowly scoped to that one call site would pass every existing test; the one-shot `studentSession()` read having no retry if it fails before the deadline arrives while offline, which would leave `profileId` unresolved and the offline auto-submit latch never armed for that session; and `MAX_JSON_BODY_BYTES`'s transport ceiling being global to the app rather than scoped to the submit route.

## Design Notes

**Why an `Attempt` row exists at all when the answers are client-owned.** AD-26 says the answers live in the browser; it also says the timer's authority is the server. Those are the same sentence read from two ends: the browser may hold the work, but it may not hold the clock, because expiry decides `incorrect` versus `unanswered` (Story 5.5) and that propagates into Mastery. So the row carries two instants and nothing else of substance until submission.

**Why the clock is a computed offset, never `Date.now()` directly.**

```ts
// Synced once, from the start response.
const offset = serverNow - clientNowAtResponse;
const remaining = Math.max(0, expiresAt - (Date.now() + offset));
```

A device whose clock is wrong or changes mid-Attempt shifts only what is *displayed*; the server still decides expiry from its own column at submit. A `performance.now()`-based tick was rejected: it counts the page's life, not the wall clock, so a slept device would come back with time it never had.

**Why the pending-submit latch is a take, not a flag.** "Never silently retried" cannot be a rule someone remembers to honour in a `catch`. The latch is armed when the deadline passes offline and *emptied by the act of reading it*, so two `online` events, a reload between them, or a re-render all produce at most one dispatch. A failure after a take leaves the Attempt open and says so — it does not re-arm itself.

**Why submit lands here rather than waiting for Story 5.4.** Two of this story's four criteria are about what handing in does when the network is gone, and neither is observable without a submit path. So the path is built to the point those claims need and no further: it stores the raw answers and closes the Attempt. The confirmation naming blanks, the `unanswered`-versus-`incorrect` decision, the completed transition and grading remain entirely Stories 5.4–5.5, which extend this route rather than replace it.

**Where each claim is testable.** `apps/web` runs `environment: 'node'`: storage, clock and latch rules go in `lib/*.spec.ts` as pure functions; markup and ARIA go in static-render specs; reloading, going offline, sleeping and dispatching go in `e2e/`. A claim in the wrong layer is a claim that never runs.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean across api, web and e2e.
- `pnpm typecheck` -- expected: no errors; `pnpm typecheck:e2e` also clean.
- `pnpm --filter web test` -- expected: the new `attempt-store`, `attempt-clock`, `attempt-submit`, `AttemptTimer` and Take Test page specs pass; existing specs unchanged.
- `pnpm --filter api run test:int` -- expected: the new Attempt start and submit cases pass; `practice-test.int-spec.ts` green.
- `git status --porcelain apps/api/prisma/migrations` -- expected: exactly one new migration directory.
- `pnpm db:up && pnpm db:migrate && pnpm e2e -- student-attempt-resilience` -- expected: the new end-to-end passes.

## Auto Run Result

**Summary:** Follow-up review pass on an already-`done` implementation (server-owned Attempt clock, client-persisted answers, offline hand-in refusal, single reconnect auto-submit). Four parallel review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran against the diff since `baseline_revision`. Most findings restated claims already adjudicated in this file's prior two review passes (Released-status re-check, throttle, cascade-delete FK, single-retry concurrency, regex-only test coverage, hardcoded e2e key) and were not re-litigated. Two genuinely new, trivially-fixable defects were patched; six new non-blocking gaps were recorded to `deferred`; six restatements or out-of-scope items were rejected as noise.

**Files changed (this pass only):**
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` -- `send`'s generic failure branch now clears `waitingForOnline` alongside `submitState`, so a failed auto-dispatch after the reconnect latch was already consumed no longer leaves the screen claiming an automatic hand-in is still arranged.
- `apps/api/src/practicetest/practice-test-policy.ts` -- `MAX_JSON_BODY_BYTES` now applies the 6x JSON-escaping multiplier to `MAX_QUESTION_ID_LENGTH` as well as `MAX_ANSWER_LENGTH`, since `questionId` carries the same unescaped-character exposure by design.
- `apps/web/src/lib/attempt-store.ts` -- `attemptKey`'s doc comment corrected: `encodeURIComponent` does not escape `.`, the literal separator; the actual safety property is that both ids are server-issued UUIDs, not the encoding. (No behavior change; this exact claim was already reviewed and rejected as noise twice in prior passes, fixed in passing since the wording was already inaccurate.)

**Review findings breakdown (this pass):** patch 2 (medium 2), defer 6 (medium 3, low 3), reject 6 (medium 1, low 5), intent_gap 0, bad_spec 0. Full detail in `## Review Triage Log` and `deferred` frontmatter.

**Follow-up review recommendation:** `true` (medium 2 this pass -> score 6, >= 5).

**Verification performed:**
- `pnpm lint` -- clean (api, web).
- `pnpm typecheck` and `pnpm typecheck:e2e` -- clean.
- `pnpm --filter web test` -- 741/741 passed, all files including `attempt-store`, `attempt-clock`, `attempt-submit`, `AttemptTimer`, Take Test page specs.
- `pnpm --filter api run test:int` -- full run: 655/658 passed; 3 failures (`extraction.int-spec.ts`, `practice-test.int-spec.ts` x2) are the already-`deferred` non-deterministic fixture-setup flakiness, none touching Attempt/Answer code. Confirmed by re-running `practice-test.int-spec.ts` alone: 144/144 passed, including every Attempt case.
- `git status --porcelain apps/api/prisma/migrations` -- clean (migration already committed from a prior pass; no stray new migration).
- `pnpm db:up && pnpm db:migrate && pnpm e2e -- student-attempt-resilience` -- full e2e suite: 74/76 passed; the 2 failures are the already-`deferred` pre-existing `parent-auth.spec.ts` password-reset failures. Both `student-attempt-resilience.spec.ts` cases passed, including the reconnect-offline-auto-submit case that exercises the `waitingForOnline` path patched this pass.

**Residual risks:** the 6 newly `deferred` items (Parent-View clearAll test coverage, `studentSession()` no-retry-while-offline, global JSON body-parser scope, Hand-in press announcement, `isAttemptState` key validation, `AttemptTimer` threshold-order integration coverage) are non-blocking per the intent contract but worth a future pass. The two pre-existing environment issues (integration fixture flakiness, parent-auth e2e failures) remain unresolved and unrelated to this story, as recorded in earlier passes.

