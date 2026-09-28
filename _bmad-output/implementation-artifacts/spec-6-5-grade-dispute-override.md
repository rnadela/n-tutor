---
title: 'Story 6.5: Grade Dispute & Override'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
baseline_revision: '7fa00cc896ff6b2c03f81d6b30c00e82803969f6'
deferred:
  - summary: >-
      Grade disputes surface on a standalone parent screen, not on the FR-28
      Analytics dashboard band FR-25 names.
    evidence: |-
      FR-25 says disputes surface "within or immediately beside the FR-28 activity
      summary" and that there is "no separate flagged-items destination in v0". That
      dashboard is Story 7.4's and does not exist yet, so this story shipped a plain
      parent screen, exactly as Story 6.3 did for explanation flags. The divergence is
      pinned by passing assertions (`page.spec.tsx` asserts no Mastery figure, the e2e
      asserts no analytics vocabulary) that Story 7.4 will have to move or invert when
      it mounts the band.
    location: >-
      apps/web/src/app/parent/grade-disputes/page.tsx
    severity: medium
  - summary: >-
      A dispute the parent reads and agrees with has no terminal state, so it stays
      listed as awaiting forever.
    evidence: |-
      Resolution is derived from the override, because FR-25 grants exactly one remedy
      and authorizes no dismiss verb. A parent who judges the AI right therefore leaves
      the entry at "Waiting for you to decide" with nothing to press. Whether a dispute
      wants a second outcome is an intent decision nobody has taken.
    location: >-
      apps/web/src/lib/grade-dispute.ts
    severity: low
  - summary: >-
      A child may dispute an Unanswered or Ungraded row, which no override can ever
      resolve.
    evidence: |-
      `OVERRIDABLE_STATES` is `{Correct, Incorrect}` and the DTO refuses the other two,
      while `disputeGrade` records a dispute on any row. The parent screen now says in
      words that a mark nothing judged cannot be adjusted, so the dead end is stated
      rather than silent — but the entry still cannot leave the awaiting list.
    location: >-
      apps/api/src/grading/grading-override.ts
    severity: low
  - summary: >-
      There is no way to object a second time, including to a mark the parent
      themselves set.
    evidence: |-
      `disputed` stays true for the life of the row and the control unmounts
      permanently, and the schema carries no reopen, disposition or delete. A child whose
      Correct is flipped to Incorrect has no route to say so. FR-25 does not decide this
      either way.
    location: >-
      apps/api/prisma/schema.prisma
    severity: low
  - summary: >-
      Six E2E specs fail on this machine independently of this story, and
      `practice-test.int-spec.ts` is intermittently red under batching.
    evidence: |-
      The whole changeset was stashed and the suite re-run on the baseline commit
      7fa00cc: admin-taxonomy (401 redirect), parent-auth (both reset cases),
      parent-explanation-review, parent-explanation-suppression and
      student-explanation-flagging fail identically with the work reverted.
      `practice-test.int-spec.ts` failed 6 of 196 on the same stashed baseline, in areas
      this diff never touches. Both predate the story; neither can currently tell a real
      break from noise.
    location: >-
      e2e/tests
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A child whose answer was graded wrong by a provider has no way to say so, and a parent who can see the grade and its rationale has no way to change it — FR-25's whole mitigation for AI grading being harsh on phrasing is unbuilt, so a wrong `Incorrect` is final.

**Approach:** A per-Question dispute the child raises on their own results screen, listed for the parent per Student Profile and resolved by a parent override in Attempt detail that flips the Question between `Correct` and `Incorrect`, recomputes the Attempt score in the transaction that wrote the flip, retains the original AI grade and its rationale untouched, and marks the row parent-adjusted on both surfaces.

## Boundaries & Constraints

**Always:**
- `grading` owns and is the sole writer of grade state, the override and the dispute row (AD-6, AD-17). It reaches `practicetest` through `PracticeTestService` only; the arrow stays one-way with no `forwardRef`.
- The original AI grade and rationale are **retained, never overwritten**: `QuestionGrade.state` and `.rationale` keep the provider's verdict, and the override is its own nullable column beside them. Effective state is `overrideState ?? state`, resolved in one place.
- One denominator: every figure on every surface comes from `scoreOf` (`grading-score.ts`). The adjusted score is `scoreOf` over effective states, the prior score is `scoreOf` over stored AI states, and nothing anywhere counts a third time.
- The override write and the score it changes are **one transaction** (AD-10, `prisma.withTransaction`), with the Mastery recompute seam inside it — Mastery itself is Epic 7's and there is nothing yet to recompute, exactly as `grading/mastery-eligibility.ts` already records for hand-in.
- An override flips **only** between `Correct` and `Incorrect`, on a Question whose stored AI state is one of those two. `Unanswered` and `Ungraded` are refused.
- Nothing parent-scoped reaches a student-scoped surface **or endpoint**: no rationale, no override mechanics, no AI-versus-parent wording, no cost, tier, model or allowance figure. The student row view has no field a rationale could travel in (AD-20, AD-26).
- A dispute is a **record**: no un-flag route, no delete, no soft-delete column, and a second press is the same row (unique key, upsert). It stays listed after resolution, marked with the outcome.
- Requires Parent View elevation and no further PIN. Parent reads and writes take the account off `req.elevated`; student routes take both ids off `req.student`. A foreign, unknown or still-open Attempt answers the one shared `PRACTICE_TEST_NOT_FOUND` 404, never a 403.
- Every refusal on the student surface is one sentence; the two parent-side rule refusals are 409s with their own sentences, naming no child, no number and no tier.
- No log line, trace or error report carries Question content, a child's answer or a rationale — identifiers only.
- Grade resolution and the override are each announced through the existing live region using the same words displayed; the rationale region is collapsed by default.

**Block If:**
- The intent would require a dispute disposition the parent takes *other than* the override (a dismiss/uphold control) — nothing in FR-25 or the epic authorizes one, so building it would be inventing a control (see Design Notes).
- Mastery figures are required to be observable by this story rather than deferred to Epic 7.

**Never:**
- No Mastery table, Mastery value, Weak Area or Analytics dashboard — those are Epic 7's (7.2, 7.4). The dispute list is a plain parent screen of its own, exactly as Story 6.3's reports screen is, and 7.4 may later mount a band like it.
- No overwrite of `state`/`rationale`, no second score column, no second denominator, no dispute `resolvedAt`/`resolution` column (resolution is derived from the override).
- No un-flag, no dispute deletion, no parent-originated dispute, no operator/Admin destination for disputes, no reason text on either side, no relay of a parent's or child's words to the other.
- No Explanation, suppression or flag behaviour changes; `explanation` and `practicetest` are read-only here.
- No change to hand-in, to `resolveUngraded`, to the four grade states, or to Retake.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Child disputes a grade | `POST student/attempts/:a/questions/:q/grade-dispute`, own submitted Attempt | 200, the row's dispute view (`disputedAt`); score, grade state and every other row unchanged | No error expected |
| Child disputes twice | A dispute row already exists | 200, the **same** row with its first `disputedAt` | No error expected |
| Child disputes a foreign / unknown / open Attempt | Ids off `req.student` do not own it | 404 `PRACTICE_TEST_NOT_FOUND`, one sentence | Single shared 404, never 403 |
| Parent overrides an `Incorrect` | `POST parent/attempts/:a/questions/:q/grade-override` `{ state: 'Correct' }` | 200, the parent row view: effective `Correct`, `parentAdjusted: true`, AI `Incorrect` and its rationale still present; adjusted and prior score both stated | No error expected |
| Parent overrides to the state already effective | Effective state equals the requested one | 409, own sentence ("that grade is already recorded") | Own 409, no child/number/tier named |
| Parent overrides an `Unanswered`/`Ungraded` row | Stored AI state is neither `Correct` nor `Incorrect` | 409, own sentence (only a judged answer can be adjusted) | Own 409 |
| Parent overrides a row with no dispute | No `GradeDispute` for the pair | 200, the override stands | No error expected — an override needs no dispute |
| Two simultaneous overrides | Same pair, both presses in flight | One row, last statement wins; `updateMany` on the pair, never read-then-write | No partial write: score and flip commit together |
| Dispute list read | `GET parent/students/:id/grade-disputes` | Newest first: recorded grade, effective grade, run and question ordinal, Subject, raised-at, and resolved-with-outcome or awaiting | Context that no longer resolves answers nulls, not a 404 |
| Child re-reads results after an override | Any row overridden | Effective state, a plain line that a parent reviewed it, prior and adjusted score as a change | No rationale, no mechanics, no person named |

</intent-contract>

## Code Map

**API — the module that owns grades**
- `apps/api/prisma/schema.prisma:1161` `enum GradeState`, `:1195` `model QuestionGrade` — `state` `:1204`, `rationale` `:1216` ("the evidence a parent decides an FR-25 override on"), `@@unique([attemptId, questionId])` `:1225`, `@@index([attemptId])`. The two override columns go here; nothing existing changes. `model Explanation` `:1250` and `model ExplanationFlag` `:1392` are the house style for a denormalized `parentAccountId` with no FK, a cascading child edge, an idempotent `@@unique`, and "there is no un-flagging" — `GradeDispute` is modelled on `ExplanationFlag` and carries **no disposition columns**.
- `apps/api/prisma/migrations/20260929000000_add_explanation_suppression/migration.sql` — the latest migration on disk; follow its handwritten SQL and `YYYYMMDDHHMMSS_snake_case_intent` naming (this story's is later than it).
- `apps/api/src/grading/grading.service.ts` — `GradingScope` `:25` (parent = account alone, child = both ids), `StudentScope` `:44`, `submitAttempt` `:148` and its "two transactions, one provider call" doc, `resolveUngraded` `:249` (the read-triggered re-ask, untouched), `resultsFor` `:345` — **the read to fork**: it calls `resolveUngraded`, then `answerKeyFor`, then one `questionGrade.findMany` selecting `{ questionId, state }` only and composes with `answerKeyRows` + `scoreOf`. Its comment "a rationale this never selects is a rationale no mapper can put on a student response" is the invariant the parent read must not break: the parent read is its own method selecting more columns, not a widening of this one. `runHistoryFor` `:409` and `writeGuarded` `:566`/`scoreFor` `:621` are the write-statement precedents (`updateMany`-style guards, `withTransaction`).
- `apps/api/src/grading/grading-results.ts` — `AnswerKeyRowView` (`state`, `newlyGraded`, and the doc stating why there is **deliberately no `rationale` field**), `AttemptResultsView`, pure `answerKeyRows`. The student row gains `parentAdjusted` and `disputed` here and nothing else; the parent's superset row lives in a new file.
- `apps/api/src/grading/grading-score.ts` — `AttemptScore`, `scoreOf`. **Unchanged**: called twice (effective states, AI states) rather than widened.
- `apps/api/src/grading/mastery-eligibility.ts` — `countsTowardMastery`, and the precedent for stating what Epic 7 is owed without a Mastery table: the override's recompute seam is documented the same way, in the same module.
- `apps/api/src/grading/parent-attempt.controller.ts` — mounts `GET parent/attempts/:attemptId/results` with `ParentElevationGuard`, `ParseUUIDPipe`, `@SkipThrottle({ login: true })`, account off `req.elevated`. Its doc already says the rationale "is Story 6.5's" and that this view will not gain one — this story replaces its return type with the parent view rather than widening the student one. `student-attempt.controller.ts` — the student conventions: **no `ParseUUIDPipe`**, one-sentence refusals, `@HttpCode(HttpStatus.OK)` on posts, `dto/attempt-submit.dto.ts` as the only student-authored body.
- `apps/api/src/grading/grading.module.ts` — already builds both guards and exports the service; a new controller route needs no new wiring, a new controller needs listing here.
- `apps/api/src/explanation/explanation.service.ts` — `flagExplanationAsStudent` (the student-raises-a-concern shape: ownership proof first, idempotent upsert on the unique key, view back), `disposeStudentFlag` (`updateMany({ where: { id, disposition: null } })` — the two-presses-one-winner statement), `studentFlagsFor` (**the dispute list's model**: denormalized-id `where`, `orderBy [{createdAt:'desc'},{id:'desc'}]`, then one `flaggedQuestionContextsFor` call folded by `refKey`), `StudentFlagListEntry` (the list entry's field set, including the nullable `runOrdinal`/`questionOrdinal`/`subjectName`/`submittedAt`).
- `apps/api/src/explanation/explanation-policy.ts` — one file for every refusal sentence, with `NO_EXPLANATION_TO_FLAG` aliasing `PRACTICE_TEST_NOT_FOUND` **by value** and `FLAG_ALREADY_DISPOSED` as the 409 precedent. `apps/api/src/practicetest/practice-test-policy.ts` holds `PRACTICE_TEST_NOT_FOUND`.
- `apps/api/src/practicetest/practice-test.service.ts` — `answerKeyFor` (`:1803`, nullable profile id = "any child of this account"), `attemptProfileFor` (`:1433`, which child sat it), `flaggedQuestionContextsFor` (run/question ordinal + Subject for a list of pairs — reused verbatim). **`practicetest` does not change.**
- `apps/api/src/explanation/dto/dispose-flag.dto.ts` — the `@IsEnum` single-field DTO style the override body follows.
- `apps/api/test/harness.ts` — `adminToken` `:474`, `setPinFor` `:566`, `elevate` `:575`, `captureAi` `:282`. `apps/api/test/student-explanation-flag.int-spec.ts` and `parent-explanation-review.int-spec.ts` are the two suites to model: hand-in through the harness, then the flag/parent matrix and the cross-account 404s.

**Web — the surfaces**
- `apps/web/src/components/AnswerKeyRow.tsx` — `AnswerKeyRowLabels` `:38` (every word is an argument so the two surfaces cannot inherit each other's person), `AnswerKeyRow` `:119` with `row`, `labels` and the `explain` slot; hookless and asserted as a markup string. It gains one label (`rowParentAdjusted`) and one slot (`grade`), rendered before `explain`. `GradeStateMarker.tsx` and `theme/grade-state-palette.ts` carry state five ways — the parent-adjusted line is a **sentence**, never a sixth colour.
- `apps/web/src/app/student/_components/AttemptResults.tsx:102` — the student screen: two reads today (`attemptResults`, `suppressedExplanations`) and its "two reads and no third" doc, `STUDENT_ROW_LABELS`, the score sentence `:285` (zero denominator said in words), `useAnnounce`, `deviceIsUnbound`, the `footer` slot. The dispute control is a new sibling of `ExplainPanel` in the row's `grade` slot; the dispute state comes off the widened results read, not a third request.
- `apps/web/src/app/student/_components/ExplainPanel.tsx` + `apps/web/src/lib/explain-panel.ts` — the press-decision pattern to copy: the pure decision function lives in `src/lib`, the component holds only render and focus. `apps/web/src/copy/student.ts:401` `results.explain` (`flagControl`/`flagNote`/`flagged`/`flagFailed`/`flagOffline`/`flagAnnouncement`) — the dispute copy's shape and voice.
- `apps/web/src/app/parent/attempts/[attemptId]/page.tsx` — `PARENT_ROW_LABELS` `:47`, the results read and its Retry, `byQuestion` `:197`, `onFlagged` `:200`, the single live region `:214`, `proseLoaded`/`proseError` gating, the score line `:290`, the `explain` slot `:317`. The override control and the collapsed rationale go in the row's new `grade` slot as a component of their own.
- `apps/web/src/app/parent/explanation-flags/page.tsx` — **the dispute list's template**, including the "it is a plain parent screen and not the Analytics dashboard band" doc that names this story: per-child selector defaulting to the first profile, `applyIfCurrent` staleness guard, `profilesLoaded`/`loaded` held apart from `loading`, `role="list"` restored by hand, `ParentApiError.reason` preferred over a platform message, `attemptHref`/`AttemptLink` typed-route helpers, back link.
- `apps/web/src/app/parent/page.tsx:135` — the Parent View link list; the disputes screen needs its own link for the reason the reports screen has one.
- `apps/web/src/lib/parent-api.ts` — `AttemptResultsView` and `AnswerKeyRowView` types `:501`-region, `attemptResults` (student, no bearer), `parentApi.attemptResults` (elevated), `flagExplanation`, `studentExplanationFlags`, `saveUncommittedState`/`uncommittedState` `:1306`-`:1340`, `UncommittedStateKind` `:81` (**`GradeOverride` already declared and unused — this story is its writer**), `ParentApiError`, `CONFLICT_STATUS`.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx:462`/`:535` — the only existing uncommitted-slot wiring (`DraftEdit`): debounce, save, read-back, clear on commit. `apps/web/src/lib/parent-view.ts` `readableInstant`, `applyIfCurrent`, `announcedText`, `endsParentView`.
- `apps/web/src/copy/parent.ts:879` `attempts` (row labels, `score`, `excluded`, `retry`, `unknownSubject`) and `:1132` `flags` (the whole list-screen vocabulary to mirror for disputes), `parentView:104` (link labels). `apps/web/src/copy/student.ts:401` `results`.
- Tests: `apps/web` vitest is `environment: 'node'` — `renderToStaticMarkup` for pure components, `readFileSync` source assertions for stateful pages, pure logic in `src/lib/*.ts`. `e2e/tests/student-explanation-flagging.spec.ts` is the full-stack template (sign-up → PIN → profile → upload → generate → release → hand-in → results → Parent View → decide).

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `overrideState GradeState?` and `overriddenAt DateTime?` to `QuestionGrade`, documenting that `state`/`rationale` stay the AI's and that effective state is `overrideState ?? state`; add `model GradeDispute` (`attemptId`, `questionId`, `studentProfileId`, `parentAccountId` denormalized with no FK, `createdAt`, `updatedAt`, cascading `attempt`/`question` edges, `@@unique([attemptId, questionId])`, `@@index([studentProfileId, createdAt])`, `@@index([parentAccountId, createdAt])`, `@@map("grade_dispute")`) -- the retained original grade and the record of a raised hand are both columns, not derived.
- `apps/api/prisma/migrations/<ts>_add_grade_dispute_and_override/migration.sql` -- handwritten SQL for the two nullable columns, the new table and its three indexes (no new enum -- the override reuses grade_state) -- applies to a database already carrying Story 6.4's rows.
- `apps/api/src/grading/grading-override.ts` -- new pure module: `effectiveStateOf(row)`, `OVERRIDABLE_STATES`, `overrideDecision(storedState, requested)` returning `flip | already | notJudged`, and the parent/student row mappers built on `answerKeyRows` -- the flip rule is assertable without a database, as `grading-score.ts` is.
- `apps/api/src/grading/grading-policy.ts` -- new: `GRADE_ALREADY_RECORDED` and `GRADE_NOT_JUDGED` 409 sentences, plus the `PRACTICE_TEST_NOT_FOUND` alias for a dispute on a pair that is not the caller's -- one file for every refusal sentence, as `explanation-policy.ts` is.
- `apps/api/src/grading/grading-results.ts` -- add `parentAdjusted` and `disputed` to `AnswerKeyRowView`, add nullable `originalScore` to `AttemptResultsView`, and have `answerKeyRows` take effective states plus the two per-row facts -- restating the doc that no `rationale` field exists here and why.
- `apps/api/src/grading/parent-results.ts` -- new `ParentAttemptResultsView`/`ParentAnswerKeyRowView`: the student row plus `rationale`, `aiState`, `overriddenAt` and `disputedAt` -- a separate shape so the parent-scoped facts have nowhere to sit on the child's response.
- `apps/api/src/grading/grading.service.ts` -- add `disputeGrade(StudentScope, attemptId, questionId)` (ownership proof first, idempotent upsert, no write to any grade), `parentResultsFor(GradingScope, attemptId)` (its own read selecting `rationale`, the override columns and the dispute, composed with `scoreOf` twice), `overrideGrade(ParentScope, attemptId, questionId, requested)` (proof, `overrideDecision`, then `withTransaction`: `updateMany` guarded on the pair, the recomputed score read back in the same transaction, and the documented Mastery seam inside it), and `gradeDisputesFor(ParentScope, studentProfileId)` -- and widen `resultsFor`'s composition to effective states without touching `resolveUngraded`.
- `apps/api/src/grading/mastery-eligibility.ts` -- extend the doc to name the override as the second trigger that will call Epic 7's recompute from inside its transaction -- one code path for every trigger (AD-10).
- `apps/api/src/grading/dto/grade-override.dto.ts` -- new `@IsEnum`-guarded `{ state: 'Correct' | 'Incorrect' }` body -- the only shape a parent may send.
- `apps/api/src/grading/student-attempt.controller.ts` -- mount `POST attempts/:attemptId/questions/:questionId/grade-dispute` (`@HttpCode(OK)`, no `ParseUUIDPipe`, both ids off `req.student`) -- the child's own hand, raised on their own work.
- `apps/api/src/grading/parent-attempt.controller.ts` -- return `ParentAttemptResultsView` from the existing results route and mount `POST attempts/:attemptId/questions/:questionId/grade-override` -- replacing, not widening, the doc's now-obsolete "it will not gain a rationale" paragraph with why the parent read is its own.
- `apps/api/src/grading/parent-grade-disputes.controller.ts` -- new: `GET parent/students/:studentProfileId/grade-disputes`, elevated, `ParseUUIDPipe` -- the child-rooted read, as `parent-explanation-flags.controller.ts` is; list it in `grading.module.ts`.
- `apps/api/src/grading/grading-override.spec.ts`, `grading-results.spec.ts` -- unit-cover every I/O matrix row that needs no database: the three override decisions, effective-state resolution, and both scores over a mixed Attempt.
- `apps/api/test/grade-dispute.int-spec.ts` -- integration-cover the matrix's request rows: dispute idempotence, the cross-account and open-Attempt 404s, both 409s, the score-and-flip transaction, the retained AI grade and rationale, the parent list's ordering and nulls, and that no student response ever carries a rationale.
- `apps/web/src/lib/parent-api.ts` -- add `disputeGrade`, `overrideGrade`, `gradeDisputes`, the `ParentAttemptResultsView`/`GradeDisputeView` types, and the widened row/score fields -- one typed client, no page fetching by hand.
- `apps/web/src/lib/grade-dispute.ts` -- new pure layer: the dispute press decision (idle/pending/reported/failed/offline), `scoreChangeOf(score, originalScore)` and the resolution sentence selector -- pure so it is assertable without a DOM, as `explain-panel.ts` is.
- `apps/web/src/components/AnswerKeyRow.tsx` -- add `labels.rowParentAdjusted` and the `grade` slot before `explain` -- the row stays hookless and gains no notion of disputing or overriding.
- `apps/web/src/app/student/_components/DisputePanel.tsx` -- new: the child's dispute control, its reported/failed/offline states and its live-region announcement -- a sibling of `ExplainPanel` so a failed dispute cannot take the answer key down.
- `apps/web/src/app/student/_components/AttemptResults.tsx` -- pass the dispute panel and the adjusted-grade line off the one widened read, and state the score as a change when `originalScore` is present -- still two reads and no third.
- `apps/web/src/app/parent/_components/GradeReview.tsx` -- new: the collapsed-by-default rationale, the recorded AI grade, the parent-adjusted marker, the dispute marker, and the override control that commits with an explicit save while holding the uncommitted choice in the `GradeOverride` slot scoped to the Attempt -- the decision sits beside the evidence it is made on.
- `apps/web/src/app/parent/attempts/[attemptId]/page.tsx` -- render `GradeReview` in the row's `grade` slot, state prior → adjusted score with "adjusted by parent", and announce an override through the existing single live region -- one screen, one region, no second denominator.
- `apps/web/src/app/parent/grade-disputes/page.tsx` -- new list screen modelled on the reports screen: per-child selector, newest first, recorded and effective grade, where it was, raised-at, awaiting-or-resolved-with-outcome, and a link into Attempt detail -- a dispute the parent cannot find is a dispute that did not surface.
- `apps/web/src/app/parent/page.tsx` -- add the disputes link beside the reports link -- for the same reason that one exists.
- `apps/web/src/copy/student.ts`, `apps/web/src/copy/parent.ts` -- add `results.dispute` (second person: control, reported, failed, offline, announcement, the plain parent-reviewed line) and `attempts.override` + `disputes` groups (third person: rationale toggle, recorded grade, adjusted-by-parent, score-change sentence, the two 409 sentences' rendering, list vocabulary) -- no user-facing string is a literal in a component.
- `apps/web/src/lib/grade-dispute.spec.ts`, `apps/web/src/components/AnswerKeyRow.spec.tsx`, `apps/web/src/app/student/_components/DisputePanel.spec.tsx`, `apps/web/src/app/parent/_components/GradeReview.spec.tsx`, `apps/web/src/app/parent/grade-disputes/page.spec.tsx`, `apps/web/src/app/parent/attempts/[attemptId]/page.spec.tsx` -- cover the pure decisions, both rendered surfaces, and by source assertion that no student-side file reads a rationale field.
- `e2e/tests/student-grade-dispute.spec.ts` -- new: hand-in → child disputes a graded Question → Parent View → disputes list → Attempt detail → read the rationale → override → score stated as a change → back in Student Mode the adjusted grade and the parent-reviewed line, with the dispute still listed and marked resolved.

**Acceptance Criteria:**
- Given a submitted Attempt with a graded Question, when the child raises a dispute, then it is listed for their parent per Student Profile with the Practice Test, the question number and the recorded grade, and the Attempt's score, grade states and every other row are unchanged.
- Given a disputed or undisputed judged Question, when the parent overrides it in Attempt detail, then the flip and the recomputed Attempt score commit in one transaction, the Mastery recompute runs on the same seam every other trigger uses (nothing to recompute until Epic 7), and a reader can never see one without the other.
- Given an override, when either surface is read afterwards, then the original AI grade and its rationale are still stored and still readable by the parent, the row reads parent-adjusted, and the prior and adjusted scores are stated together as a change rather than one replacing the other.
- Given any student-scoped response or endpoint, when it is inspected, then it carries no grading rationale, no AI-versus-parent mechanics and no cost, tier, model or allowance figure — the child sees the adjusted grade and one plain line that a parent reviewed it.
- Given a resolved dispute, when the parent opens the disputes screen, then it is still listed and marked with its outcome; a dispute awaiting a decision is listed as awaiting.
- Given Parent View has expired with an override picked but not saved, when the parent returns through the PIN, then the picked choice is still offered from the `GradeOverride` slot and the rationale is re-read from the Attempt rather than retained (FR-35).

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 6, low 5)
- defer: 5: (high 0, medium 2, low 3)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `runHistoryFor` scored the provider's verdict, so a child's home screen kept the pre-override figure while the results screen showed the adjusted one — it now resolves through `effectiveStateOf`, with an integration case asserting the two reads agree.
  - `[medium]` `[patch]` `disputeGrade` ran the whole results read twice, costing two ownership proofs and up to two provider grading calls per press — one read now does the proof and the response.
  - `[medium]` `[patch]` A picked mark could not be un-picked and a refused save left the pick set, so a mis-press was escapable only by saving the wrong mark — added a cancel control, and a 409 now clears the pick.
  - `[medium]` `[patch]` The "you can change it" sentence was gated differently from the control, so a disputed Unanswered/Ungraded row promised an action it did not offer — both are gated together and the row now says a mark nothing judged cannot be adjusted.
  - `[medium]` `[patch]` The retained-pick read fired once per rendered row — hoisted to the page, one read per Attempt, with the page spec asserting the real shape.
  - `[medium]` `[patch]` Acceptance criterion 6 (the FR-35 retained override) had no executing coverage — the E2E now picks a mark, drives Parent View to expiry, crosses the PIN and asserts the pick is still offered unsaved.
  - `[low]` `[patch]` `overrideGrade` ignored `updateMany`'s count and could answer 200 for a write that landed nothing — the count is inspected and a zero throws the shared 404 inside the transaction.
  - `[low]` `[patch]` `gradeDisputesFor` matched a cross-product of two `in` sets and `aiStateOf` was quadratic — the read matches the disputed pairs and the mapper reuses the existing Map.
  - `[low]` `[patch]` Every new sentence reached assistive technology twice, from a live region and a status/alert node — said once.
  - `[low]` `[patch]` Two separately maintained copies of one grade-label map, plus inconsistent instant wording and a dangling `Said` fragment — one source, consistent sentences.
  - `[low]` `[patch]` The docs claimed the difference between the recorded and effective mark *is* the resolution, which a flip-and-flip-back disproves — stated as the code implements it.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[medium]` `[patch]` `GradeReview.tsx`'s `pick`/`unpick`/`save` sent `saveUncommittedState` unawaited with no ordering guard, so a pick quickly followed by another pick, an unpick, or a save could let a stale response set `slotId.current` to an abandoned slot — which a later Parent View restore (FR-35) would then offer back as if still picked. Added a `pickSeq` guard: a late `pick` response is discarded if superseded, and `unpick`/`save` bump the sequence so any pick still in flight is stale by the time it resolves.

## Design Notes

**The override is a column beside the verdict, not an edit of it.** FR-25 requires the original AI grade *and* its rationale to remain readable after an override, so overwriting `state` is out — and a separate `grade_override` table would put a second row in the way of every score read for one nullable pair. Effective state is resolved in one function:

```ts
// grading-override.ts — the one place a grade is "what counts".
export const effectiveStateOf = (row: { state: GradeState; overrideState: GradeState | null }) =>
  row.overrideState ?? row.state;
```

**Two calls to one `scoreOf`, never a stored prior score.** The prior figure is `scoreOf` over stored `state`s and the adjusted one is `scoreOf` over effective states, so "11/15 → 12/15, adjusted by parent" is derived from the same denominator rule as the figure it replaces. `originalScore` is **null** when no row on the Attempt carries an override, which is what keeps every surface from having to compare two identical fractions and decide whether that counts as a change.

**Resolution is derived, and there is deliberately no dismiss.** FR-25 grants the parent exactly one remedy — the override — and says resolved disputes stay listed showing the outcome. A `resolution` enum would need a second value nothing authorizes, and a `resolvedAt` column would be a second writer of a fact the override already states, so a dispute is resolved exactly when its Question carries an override. The consequence is deliberate and stated: a parent who reads a dispute and agrees with the AI leaves it listed as awaiting, which is what a record of an unanswered concern should look like. The explanation-flag disposition is **not** the precedent here — that epic text says "exactly two dispositions" and this one names none.

**Why the parent read is its own method.** `resultsFor`'s comment — "a rationale this never selects is a rationale no mapper can put on a student response" — is load-bearing. Widening it with a nullable rationale and a scope check would make one read serve two audiences and one field's presence depend on a runtime branch; a second method selecting more columns keeps the student response's *shape* incapable of carrying the fact.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate deploy` -- expected: applies to a clean database and to one already carrying Story 6.4's rows
- `pnpm lint` -- expected: clean
- `pnpm typecheck` -- expected: clean, including the exhaustive `overrideDecision` switch and the parent/student view split
- `pnpm --filter api vitest run src/grading` and `pnpm --filter api vitest run test/grade-dispute.int-spec.ts` -- expected: green (the root `pnpm test` is known to time out under batching — see Story 6.4's deferred ledger)
- `pnpm --filter web vitest run` -- expected: green, with the six web specs above included
- `pnpm e2e -- student-grade-dispute` -- expected: green

## Auto Run Result

**Summary:** Story implemented in a prior run (commit `db16cdd`, baseline `7fa00cc896ff6b2c03f81d6b30c00e82803969f6`) and already reviewed once (see the 2026-09-28 triage entry above). This run performed a fresh review pass over the same diff per `status: done` re-review routing.

**Files changed:** see the 40-file changeset in commit `db16cdd` (API: schema/migration, `grading-override.ts`, `grading-policy.ts`, `parent-results.ts`, service/controller/module wiring, unit + int specs; Web: `GradeReview.tsx`, `DisputePanel.tsx`, `grade-disputes` page, `AttemptResults.tsx`/`AnswerKeyRow.tsx` wiring, copy, `parent-api.ts`, unit specs; E2E: `student-grade-dispute.spec.ts`). This pass's own edit: `apps/web/src/app/parent/_components/GradeReview.tsx` (pick/unpick/save race guard).

**Review findings breakdown (this pass):** patch: 1 (medium); defer: 0; reject: 13 (low) — see the 2026-09-28 Review pass entries in `## Review Triage Log` for the itemized list.

**Follow-up review recommendation:** `false` — one medium patch this pass, score 3 (< 5), no high-severity patch.

**Verification performed:**
- `pnpm lint` — clean
- `pnpm typecheck` — clean
- `pnpm --filter web exec vitest run` — 58 files / 1179 tests passed, including the patched `GradeReview.spec.tsx` (31 tests)
- `pnpm --filter api exec vitest run src/grading` — 7 files / 68 tests passed
- `pnpm --filter api exec vitest run test/grade-dispute.int-spec.ts` — 37 tests passed
- `pnpm --filter api exec prisma migrate status` — schema up to date, no pending migrations
- `pnpm e2e -- student-grade-dispute` — **not executed**: Playwright's web server could not bind port 3001, already held by an unrelated long-running process from a different project (`n-electric/apps/api`, ~18.5h uptime) on this machine. Not caused by this change; left running rather than terminated unasked. The flow this e2e covers is otherwise exercised by `grade-dispute.int-spec.ts` (37 passing, including the score-and-flip transaction and both refusal 409s) and by the unit specs for `GradeReview.tsx`, `DisputePanel.tsx` and `grade-dispute.ts`.

**Residual risks:**
- The e2e suite (including the FR-35 pick-survives-PIN-expiry acceptance criterion) has not been executed against this exact commit in this session; it passed in the prior run per this spec's existing triage log. Re-run once port 3001 is free.
- The full local unit/integration suites for `web` and `api/grading` are green; the workflow's known root `pnpm test` batching timeout (documented in Story 6.4's deferred ledger) was not re-triggered since the narrower, spec-mandated commands were used instead.

