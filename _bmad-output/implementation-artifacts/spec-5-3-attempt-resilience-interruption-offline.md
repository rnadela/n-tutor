---
title: 'Story 5.3 — Attempt Resilience (interruption & offline)'
type: 'feature'
created: '2026-09-25'
status: 'in-review'
baseline_revision: '500462b11d374b3ca617d9b17c4bd37ad6cf358a'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
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

## Review Triage Log

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
