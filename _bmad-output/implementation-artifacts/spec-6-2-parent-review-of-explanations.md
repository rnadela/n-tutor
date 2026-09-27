---
title: 'Story 6.2: Parent Review of Explanations'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The failure paths of both new parent screens are covered only by an e2e spec that
      could not be executed in this environment.
    evidence: |-
      apps/web runs vitest with environment: 'node' and no DOM library, so a failed flag
      press, a failed Explanations read and an empty runs list can only be exercised at
      the browser. Ports 3000/3001 were held by an unrelated dev server for the whole run,
      so Playwright could not start its own servers.
    location: >-
      e2e/tests/parent-explanation-review.spec.ts
    severity: medium
  - summary: >-
      The stateful parent screens are verified by asserting their own source text rather
      than by rendering them.
    evidence: |-
      ExplanationReview.spec.tsx and both attempts page specs readFileSync their subject
      and match substrings, so a refactor that preserves the strings while changing the
      behaviour passes. This is the house pattern the DOM-less unit environment forces,
      not a defect introduced here, but it caps what the unit tier can prove.
    location: >-
      apps/web/src/app/parent/_components/ExplanationReview.spec.tsx
    severity: medium
  - summary: >-
      A parent opening a run whose Questions are still ungraded triggers grading re-asks,
      with no bound and no test.
    evidence: |-
      resultsFor calls resolveUngraded first (FR-22 makes viewing the trigger), and the
      parent route reuses it unchanged. The integration fixtures pre-grade every Question,
      so the billing path a parent read can take is never exercised, and the parent's
      screen states nothing about it.
    location: >-
      apps/api/src/grading/parent-attempt.controller.ts
    severity: medium
  - summary: >-
      test/practice-test.int-spec.ts fails nondeterministically on this machine, a
      different single case each whole-file run.
    evidence: |-
      Four successive runs failed on four different cases (subject classification, a
      foreign draft read, the generation budget, a malformed-id 400), and each failing
      case passes in isolation. Pre-existing: story 6.1's own result recorded the same
      file flaking.
    location: >-
      apps/api/test/practice-test.int-spec.ts
    severity: medium
  - summary: >-
      The parent run list is unbounded, with no page or cursor.
    evidence: |-
      parentSubmittedRunsFor selects every handed-in Attempt of a profile and batches
      Subject labels for all of them in one cross-module call, so both grow with a
      child's whole history.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (parentSubmittedRunsFor)
    severity: low
  - summary: >-
      The null arm of the run list's Subject label is never produced by a test.
    evidence: |-
      The service degrades an unresolvable Subject to null and the screen renders
      unknownSubject for it, but every integration fixture has a resolvable Subject and
      the spec asserts typeof subjectName === 'string' for every row.
    location: >-
      apps/api/test/parent-explanation-review.int-spec.ts
    severity: low
  - summary: >-
      A leftover review artifact is tracked at the repository root.
    evidence: |-
      _tmp_review_diff.patch was committed by an earlier story and is unrelated to any
      source or build path.
    location: >-
      _tmp_review_diff.patch
    severity: low
  - summary: >-
      The concurrent-double-press recovery in the parent flag write is untested.
    evidence: |-
      flagExplanation recovers from a P2002 unique-violation race on [explanationId,
      origin] by re-reading the winning row, but every integration case presses the
      flag sequentially (first, second, third), which resolves the plain upsert's
      update arm and never forces two concurrent creates to collide. The same,
      pre-existing recovery in explanationFor is equally untested for the same
      reason. If the catch arm silently broke, nothing in the suite would notice.
    location: >-
      apps/api/src/explanation/explanation.service.ts (flagExplanation)
    severity: medium
  - summary: >-
      Parent-facing question-format labels duplicate the student ones instead of
      sharing a table.
    evidence: |-
      parentCopy.attempts.format re-declares the same three labels
      (MultipleChoice, FillInTheBlank, ShortAnswer) already in
      studentCopy.takeTest.format. commonCopy.gradeState was deliberately factored
      out specifically so a parent and a student surface cannot disagree on that
      one; this format table is the same category of duplication left unfactored,
      so a fourth question format added later requires remembering to update both
      copy tables.
    location: >-
      apps/web/src/copy/parent.ts (attempts.format)
    severity: low
baseline_revision: '8e5eb4b62f83fd1212c110dc92ab3ac53f40a8be'
---

<intent-contract>

## Intent

**Problem:** Every Explanation Story 6.1 generates is read by a child and by nobody else. The parent — the accountable adult the PRD's whole case for ungated student-facing AI content rests on — has no surface that shows them what their child was told, and no way to record that one of those Explanations is bad. Without both, Stories 6.3–6.5 have no destination to raise a flag to and no flag to unlock suppression from.

**Approach:** Open the parent's first Attempt-detail path: a per-profile list of handed-in Attempts, and an Attempt detail screen carrying the answer key with each Question's stored Explanation read inline. Add an `ExplanationFlag` entity that `explanation` owns, with the parent-originated route implemented — read the Explanation, flag it — leaving the student route, dispositions, the Admin queue, suppression and grade override to the stories that own them.

## Boundaries & Constraints

**Always:**
- `explanation` is the sole owner and sole writer of `explanation` **and** `explanation_flag` (AD-17). It gains no `attempt`, `practiceTest`, `answer`, `sourceTest` or taxonomy delegate: the attempt→profile binding arrives from `PracticeTestService`, exactly as `explanationInputFor` already delivers it for the student path.
- Every new route is parent-scoped: `@Controller('parent')`, `@UseGuards(ParentElevationGuard)`, `@ParseUUIDPipe` on ids as the other parent routes carry, and the account read off `req.elevated!` and never from the path or body (AD-18). A foreign or unknown id answers `PRACTICE_TEST_NOT_FOUND` 404, never 403.
- A parent's entitlement is the **account**: `GradingScope.studentProfileId` is left absent on every parent read, and the Explanations of an Attempt are scoped to **that Attempt's own** `studentProfileId`, resolved server-side from the Attempt row and never taken from a parameter.
- Parent reads of Explanations are **pure reads**: no AI call, no allowance consumption, no `Explanation` write, no `chargedAt` touched. An Explanation the child never asked for does not exist and is not generated here.
- A flag is **idempotent per (Explanation, origin)**: a second parent flag on the same Explanation is the same flag, not a second row, and keeps the first `createdAt`.
- A flag **changes nothing else**: not the Explanation body, not what the child is served, not the grade state, the Attempt score, Mastery, or any other row.
- Every user-facing string is a member of `parentCopy`, in the **third person** about the child and never addressed to them, with every figure a function parameter.
- The Explanation reading surface is an inline region beneath its answer-key row — the same adjacency the student panel keeps (UX-DR16) — never a modal and never a route of its own.
- Flag outcomes are announced through the existing single live region with the exact string displayed, using the `Announcement`/`announcedText` mechanism the other parent screens use.
- No cost, tier label, model name, allowance figure or provider text reaches any response, any parent-visible string, or any log line — identifiers and counts only (AD-20, AD-26).

**Block If:**
- Serving the parent's Attempt detail would require `AnswerKeyRowView` or `AttemptResultsView` to gain a `rationale` field — the rationale is Story 6.5's, and widening the student view's shape to reach it is the one thing `grading-results.ts` exists to prevent.
- Resolving an Attempt's `studentProfileId` cannot be done without `explanation` acquiring an `attempt` delegate.

**Never:**
- No grading rationale display, no grade dispute, no grade override, no Mastery recompute — Story 6.5.
- No flag **disposition** (confirm/dismiss), no student-originated flag, no Admin Flagged Explanations queue, no Analytics dashboard band — Stories 6.3 and 7.4.
- No suppression, no serve-time suppression check, no regeneration, no free-generation exclusion flag — Story 6.4.
- No un-flagging: a flag is a record. No flag on anything but an existing Explanation.
- No parent-side generation of a missing Explanation, and no second allowance counter, counter column or decrement anywhere (AD-14).
- Do not restructure `AttemptResults.tsx`'s state machine, and do not add a second `parentApi.` call inside it. Do not give the shared answer-key row hooks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List a child's runs | Elevated parent, own profile with two handed-in Attempts | Both rows, newest first, each with Subject label, run ordinal and `submittedAt` | No error expected |
| Child with nothing handed in | Own profile, no submitted Attempt | `[]` — a state the screen renders | No error expected |
| Foreign / unknown profile id | Profile of another account | `[]` — indistinguishable from a profile with no runs | No error expected |
| Read one Attempt | Elevated parent, own account's submitted Attempt | Answer key for every presented Question in ordinal order, plus the score | No error expected |
| Foreign / unknown / still-open Attempt | Attempt of another account, unknown id, or `submittedAt === null` | Nothing read | 404 `PRACTICE_TEST_NOT_FOUND` |
| Read Explanations of an Attempt | Some Questions have a stored Explanation for that Attempt's profile | One entry per stored Explanation: `questionId`, body segments, `parentFlaggedAt` | No error expected |
| Question with no Explanation | No stored row for that Question | Absent from the list; the row states nothing was explained | No error expected |
| Sibling's Explanation on the same test | Another profile's Attempt of the same Practice Test | Never returned — rows are keyed by this Attempt's own profile | No error expected |
| Flag an Explanation | Stored Explanation, no parent flag yet | One `explanation_flag` row, origin `Parent`; response carries `parentFlaggedAt` | No error expected |
| Flag it again | A parent flag already exists | No second row; the same `parentFlaggedAt` comes back | No error expected |
| Flag a Question with no Explanation | No stored row | Nothing written | 404 `PRACTICE_TEST_NOT_FOUND` |
| Flag on a foreign Attempt | Attempt of another account | Nothing written | 404 `PRACTICE_TEST_NOT_FOUND` |
| Elevation expired mid-read | Parent View closed | No data shown; the screen ends Parent View through `endsParentView` | 401 `elevated: false` |

</intent-contract>

## Code Map

**API — precedents to mirror and seams to extend**
- `apps/api/src/practicetest/practice-test.service.ts:1240` (`submittedRunsFor`) -- the exact `attempt.findMany` shape a parent run list needs; `:1535` (`answerKeyFor`) already takes `studentProfileId: string | null` and applies the parent-scoped `where` when it is null; `:1660` (`explanationInputFor`) is the model for a boundary read that returns the ownership proof. `AttemptRun` at `:342`.
- `apps/api/src/practicetest/practice-test.service.ts` (`releasedFor`, `:892`) -- how Subject labels are batched through `SOURCE_TEST_READER.readSubjectLabels` and a label that no longer resolves degrades to `null` without costing the row.
- `apps/api/src/practicetest/practice-test.controller.ts:77-82` -- `@Controller('parent')` + `@SkipThrottle({ login: true })` + `@UseGuards(ParentElevationGuard)`, `req.elevated!.parentAccountId`, `ParseUUIDPipe` on every id.
- `apps/api/src/practicetest/practice-test-policy.ts:218` -- `PRACTICE_TEST_NOT_FOUND`, the one sentence every ownership refusal reuses.
- `apps/api/src/grading/grading.service.ts:25` (`GradingScope`) -- `studentProfileId` is already optional *for this reason*; `:345` (`resultsFor`) already serves a parent scope unchanged. Nothing in `grading` needs a new read.
- `apps/api/src/grading/grading.module.ts` -- provides `StudentModeGuard` only; a parent controller here needs `ParentElevationGuard` added to `providers`, the recipe `practice-test.module.ts` shows.
- `apps/api/src/grading/grading-results.ts:23,52` -- `AnswerKeyRowView` / `AttemptResultsView`. Read-only: the absence of `rationale` is load-bearing.
- `apps/api/src/explanation/explanation.service.ts:28,33,120` -- `StudentScope`, `ExplanationView`, and `explanationFor`'s ordering (ownership proof first, then the row). Its P2002 recovery comment is the precedent for a uniqueness race.
- `apps/api/src/explanation/explanation-policy.ts` -- one file for every refusal sentence; `MAX_EXPLANATION_LENGTH` lives here too.
- `apps/api/src/explanation/explanation.module.ts` -- imports `IdentityModule` + `JwtModule.registerAsync({ secret: requireParentJwtSecret() })` already, so adding `ParentElevationGuard` to `providers` is the whole guard wiring.
- `apps/api/prisma/schema.prisma:1250` -- `model Explanation`: `parentAccountId` and `studentProfileId` are plain denormalized columns, relations cascade, and the unique key is `[attemptId, questionId, studentProfileId]`. Enums are declared beside their models (`GradeState` at `:1161`).
- `apps/api/prisma/migrations/20260928120000_add_explanation/migration.sql` -- the handwritten-SQL house style and naming (`YYYYMMDDHHMMSS_snake_case_intent`); the latest migration on disk.
- `apps/api/test/explanation.int-spec.ts`, `apps/api/test/harness.ts:566,575` (`setPinFor`, `elevate`) -- how an integration case reaches an elevated parent request.

**Web — precedents, shared surfaces and the move**
- `apps/web/src/app/student/_components/AnswerKeyRow.tsx:73` -- the row to share: hookless, `renderToStaticMarkup`-tested, `explain?: ReactNode` slot already present, and the only file importing it is `AttemptResults.tsx:15,260`. Its four second-person labels come from `studentCopy.results.*` and are the only thing standing between it and a parent surface.
- `apps/web/src/app/student/_components/GradeStateMarker.tsx:68` -- already surface-neutral: it reads the four literals from `commonCopy.gradeState`, which its own doc says exists so a parent surface and this one cannot disagree.
- `apps/web/src/app/student/_components/ExplainPanel.tsx` -- the student panel: read-only reference for the inline-region shape, the `aria-expanded`/`aria-controls` pairing and the mounted-only `aria-controls` rule. Not reused — it generates, and the parent surface must not.
- `apps/web/src/app/parent/drafts/page.tsx` + `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` -- the flat list→detail parent route precedent, `'use client'`, `useElevation()`, `applyIfCurrent`, `endsParentView`, `Screen`, `density`.
- `apps/web/src/app/parent/students/page.tsx:261` -- `data-testid="student-row"` and the `Announcement`/`announcedText`/`NOTHING_ANNOUNCED` usage the parent screens share, re-exported from `apps/web/src/lib/parent-view.ts`.
- `apps/web/src/lib/parent-api.ts:407,428,681,1285,1300` -- `AnswerKeyRowView`, `AttemptResultsView`, the private `call<T>`, and `elevated(token)`-header parent reads with a `parentCopy.*Failed` fallback message. `ParentApiError` (`.reason`, `.notElevated`) at `:534`; `explainQuestion` at `:1035` is the student call and stays untouched.
- `apps/web/src/components/RichText.tsx` -- the only renderer of stored segments (AD-32); `apps/web/src/components/LiveRegion.tsx` -- `useAnnounce()`, one region per document.
- `apps/web/src/copy/parent.ts:104,150,658` -- group shape, third-person rules, and where a new `attempts` group belongs; `apps/web/src/copy/common.ts` -- `commonCopy.gradeState`.
- Tests: `apps/web` vitest is `environment: 'node'` — render-to-string for pure components, source assertion (`readFileSync` of the component's own path) for stateful ones, pure logic extracted to `src/lib/*.ts`. E2E in `e2e/tests/*.spec.ts`; `e2e/tests/student-explanations.spec.ts` already drives a parent through sign-up, PIN, profile, upload, generate, release and a student hand-in — the only existing route to a stored Explanation.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `enum ExplanationFlagOrigin { Parent, Student }` and `model ExplanationFlag` (`id`, `explanationId`, `parentAccountId`, `studentProfileId`, `origin`, `createdAt`, `updatedAt`; `@@unique([explanationId, origin])`, `@@index([parentAccountId, createdAt])`, `@@map("explanation_flag")`), plus the `flags` back-relation on `Explanation` -- the unique key is what makes a second parent flag the same flag, and `Student` is declared now so 6.3 adds a code path rather than an enum migration.
- `apps/api/prisma/migrations/<ts>_add_explanation_flag/migration.sql` -- handwritten SQL for the enum, table, unique index and read index, commented in the repo's prose style -- migrations are authored here, never generated.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `parentSubmittedRunsFor(parentAccountId, studentProfileId)` returning `ParentAttemptSummary[]` (attemptId, practiceTestId, ordinal, submittedAt, questionCount, subjectName) newest first with Subject labels batched through `SOURCE_TEST_READER`; and `attemptProfileFor(parentAccountId, attemptId)` returning `{ attemptId, studentProfileId }`, raising `PRACTICE_TEST_NOT_FOUND` for a foreign, unknown or still-open Attempt -- one boundary read each, so neither `explanation` nor a controller holds an `attempt` delegate.
- `apps/api/src/practicetest/practice-test.controller.ts` -- add `GET parent/students/:studentProfileId/attempts` -- a foreign profile matches no Attempt of this account and answers `[]`, which is the same answer a child with no runs gets, so nothing here enumerates.
- `apps/api/src/explanation/explanation-policy.ts` -- add the parent-facing refusal sentence for "no Explanation to flag" (reusing `PRACTICE_TEST_NOT_FOUND`'s single-sentence discipline) and document why a flag needs no new 409 -- refusal wording lives in one file.
- `apps/api/src/explanation/explanation.service.ts` -- add `ParentScope { parentAccountId }`, `ParentExplanationView { questionId, body, parentFlaggedAt }`, `explanationsForAttempt(scope, attemptId)` and `flagExplanation(scope, attemptId, questionId)`; both resolve the Attempt's profile through `attemptProfileFor` **first**, read rows by `(attemptId, studentProfileId)`, and the flag path upserts on `[explanationId, origin]` -- the profile is never a parameter, and the upsert is what makes a repeat press the same flag.
- `apps/api/src/explanation/parent-explanation.controller.ts` -- `@Controller('parent')`, `@UseGuards(ParentElevationGuard)`, `GET attempts/:attemptId/explanations` and `POST attempts/:attemptId/questions/:questionId/explanation-flag` with `ParseUUIDPipe` on both ids -- parent routes carry the pipe the student routes deliberately omit.
- `apps/api/src/explanation/explanation.module.ts` -- register the new controller and add `ParentElevationGuard` to `providers` -- Nest builds a controller's enhancers in that controller's injector, and `IdentityModule` + the parent-secret `JwtModule` are already imported here.
- `apps/api/src/grading/parent-attempt.controller.ts` + `apps/api/src/grading/grading.module.ts` -- `GET parent/attempts/:attemptId/results` calling `resultsFor({ parentAccountId })`, with `ParentElevationGuard` added to `providers` -- `GradingScope`'s optional profile already means "any child of this account", so no service change is needed and no rationale field appears.
- `apps/api/src/explanation/explanation-flag.spec.ts` -- unit cover for the pure parts: the view mapping and the origin/uniqueness reasoning -- the matrix's pure rows belong here.
- `apps/api/test/parent-explanation-review.int-spec.ts` -- integration cover for the stateful matrix rows: the run list (own, empty, foreign profile), Attempt detail (own, foreign, unknown, still open), the Explanation read (stored rows only, sibling's row never returned, no AI call and no allowance movement), the flag (first press writes one row, second press writes none and returns the same instant, missing Explanation and foreign Attempt 404) -- these need the real app and database.
- `apps/web/src/components/AnswerKeyRow.tsx`, `apps/web/src/components/AnswerKeyRow.spec.tsx`, `apps/web/src/components/GradeStateMarker.tsx`, `apps/web/src/components/GradeStateMarker.spec.tsx` -- move all four out of `app/student/_components/` with `git mv`, and give the row a required `labels: AnswerKeyRowLabels` prop in place of its four `studentCopy` reads -- two surfaces now render the same row with a different person, so the copy becomes a parameter rather than a duplicated component.
- `apps/web/src/app/student/_components/AttemptResults.tsx` -- update the two import paths and pass the student labels built from `studentCopy.results.*` -- the only call site, and its single-`parentApi.`-call invariant is untouched.
- `apps/web/src/lib/parent-api.ts` -- add `ParentAttemptSummary`, `ParentExplanationView`, and `parentApi.studentAttempts(token, studentProfileId)`, `parentApi.parentAttemptResults(token, attemptId)`, `parentApi.attemptExplanations(token, attemptId)`, `parentApi.flagExplanation(token, attemptId, questionId)` -- elevated-header reads with `parentCopy.attempts.*Failed` fallbacks; `AnswerKeyRowView` and `AttemptResultsView` are reused as they stand.
- `apps/web/src/lib/explanation-review.ts` + `apps/web/src/lib/explanation-review.spec.ts` -- pure `explanationsByQuestion(views)` and `reviewStateFor(view | undefined)` returning `'absent' | 'unflagged' | 'flagged'` -- the web unit layer has no DOM, so the row's decision must be assertable as a function.
- `apps/web/src/copy/parent.ts` -- add the `attempts` group: screen titles and intros, the child selector, the empty-runs sentence, `run(ordinal)`, `submitted(instant)`, the Explanation heading, the nothing-was-explained sentence, the flag control, the flagged state, the sentence stating a flag records a concern and changes nothing the child sees, the announcement strings and the failure messages -- third person about the child, every figure a parameter.
- `apps/web/src/app/parent/_components/ExplanationReview.tsx` + `apps/web/src/app/parent/_components/ExplanationReview.spec.tsx` -- the inline region beneath a row: the stored prose through `RichText`, the flag control, the flagged state, one `announce()` of the displayed sentence, and no generation path at all; source-assertion spec asserting one `parentApi.` call, no `explainQuestion`, and that the flag control disappears once flagged.
- `apps/web/src/app/parent/attempts/page.tsx` + `page.spec.tsx` -- child selector plus that child's handed-in runs, newest first, each linking to its detail route; empty state rendered, not errored.
- `apps/web/src/app/parent/attempts/[attemptId]/page.tsx` + `page.spec.tsx` -- Attempt detail: the score header, every answer-key row with parent labels, and each row's `ExplanationReview` in the shared `explain` slot.
- `apps/web/src/app/parent/page.tsx` + `apps/web/src/copy/parent.ts` (`parentView` group) -- add the way in to the new screen -- a destination with no link from Parent View is a destination a parent cannot reach.
- `e2e/tests/parent-explanation-review.spec.ts` -- extend the existing full flow: the child generates one Explanation, the parent re-enters Parent View, opens the child's runs, reads that same Explanation in Attempt detail, flags it, sees the flagged state, and reloads to find it still flagged; assert the child's own results screen still serves the Explanation unchanged afterwards -- every click, keyboard and cross-surface claim lives here.

**Acceptance Criteria:**
- **Given** a parent in Parent View whose child has handed in Attempts, **when** they open the new Attempt-detail path from Parent View, **then** they reach that child's handed-in runs and, from one of them, the whole answer key with every Explanation their child was shown readable inline beneath its own Question.
- **Given** an Attempt whose Questions the child never asked about, **when** the parent reads it, **then** each such row states that nothing was explained, no Explanation is generated, and the account's Explanation Allowance consumption is unchanged.
- **Given** a parent reading any stored Explanation, **when** they flag it, **then** the flag is recorded against that Explanation as parent-originated, the outcome is announced through the single live region with the sentence displayed, and a second press records no second flag.
- **Given** an Explanation the parent has flagged, **when** the child next opens their own results for that Question, **then** the same Explanation is served unchanged — flagging alone changes nothing the child sees, and the parent's screen says so in words.
- **Given** a parent-scoped read of an Attempt belonging to another account, or of one still open, **when** it is requested, **then** it is refused with the one shared sentence, and no parent response anywhere carries a grading rationale, cost, tier, model name or allowance figure.
- **Given** `pnpm lint`, `pnpm typecheck` and `pnpm test` at the repo root, **when** they run, **then** they pass with the new and moved specs included.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 6, low 4)
- defer: 7: (high 0, medium 4, low 3)
- reject: 15: (high 0, medium 2, low 13)
- addressed_findings:
  - `[medium]` `[patch]` The Attempt-detail effect cleared `loading`/`error`/`proseError` but never `results` or `explanations`, so navigating between two runs of one Practice Test rendered the previous run's prose and flagged state under the new run's Questions (the Question ids are shared), and a failed Retry left a stale answer key under "could not be found". Both lists are now cleared as the effect re-issues, and `results` again on the failure arm.
  - `[medium]` `[patch]` A failed Explanations read left every row resolving to `absent`, so the screen told the parent their child never asked about any Question on the paper. Rows no longer draw the region while that read has failed; the one true sentence stays at screen level and now carries its own Retry, which the copy already instructed.
  - `[medium]` `[patch]` The runs screen stated "there is no student profile yet" on first render and after a *failed* profiles read, beside an error saying otherwise — the bug its own `loaded` flag guards for runs. Gated behind a `profilesLoaded` flag.
  - `[medium]` `[patch]` Retry re-issued only the runs read: the profiles effect's deps omitted the retry counter, so a failed profiles read was unrecoverable without a reload. The counter is now a dependency of both.
  - `[medium]` `[patch]` `flagExplanation` rested on `upsert` alone, which Prisma does not perform atomically — the concurrent double-press its own doc claimed to have closed could still surface P2002 as a 500. It now recovers on the unique violation by re-reading the winning row, the recovery `explanationFor` already carries.
  - `[medium]` `[patch]` Nothing wrote an `origin: 'Student'` flag anywhere, so the parent-origin filter on the read and the `origin` component of the unique key could both be deleted with the suite still green. A new integration case seeds a student flag, asserts the read still answers `parentFlaggedAt: null`, and asserts a parent press writes its own second row with the student's instant untouched.
  - `[medium]` `[patch]` Two invariants the spec states as "Always" were unasserted: no malformed id was sent to any new parent route, and the elevation check covered two of the four routes, not the results read and not the flag POST. Both are now covered, including that the refused press wrote nothing.
  - `[low]` `[patch]` A stored instant that does not parse rendered the words "Invalid Date" beside "Reported", and the same in the run list's handed-in line. A shared `readableInstant` helper now returns null for an unparsable instant and both surfaces state a sentence without a date; `reviewStateFor`'s presence test is unweakened.
  - `[low]` `[patch]` Pressing the flag control unmounted it and dropped keyboard focus to `document.body` mid-paper. Focus now moves to the sentence that replaced it, and only when this component's own press is what flagged it — a paper that arrives already reported does not steal focus on load.
  - `[low]` `[patch]` The Explanation heading rendered on every row including unasked ones, giving a screen reader a heading per Question introducing "the student did not ask". It now renders only in the branch that has prose. The `explanationsForAttempt` query comment claiming "nothing here sorts" directly above an `orderBy` was corrected in the same pass.

### 2026-09-28 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 2: (high 0, medium 1, low 1)
- reject: 17: (high 0, medium 1, low 16)
- addressed_findings:
  - `[medium]` `[patch]` The Attempt-detail screen's two reads (the answer key and the Explanations) settle independently and the results read is often the faster of the two, so `loading` could already be false while `explanations` was still `[]` mid-flight — in that window every row's region rendered as if its Question had never been explained, a false claim about the child made while the read simply had not answered yet. A `proseLoaded` flag now gates the region on the read having actually settled (success or failure), not merely on it not having errored.
  - `[low]` `[patch]` The screen's single live region held a prior run's flag announcement across an attemptId navigation: the effect that re-issues on route change already drops the two held lists for the same reason (this page instance is reused, not remounted) but never reset `announcement`, so a parent who flagged something on one run and opened a different one could still find the previous run's "reported" sentence sitting in the region. The effect now resets it alongside the two lists.

## Design Notes

**Why no new `grading` read.** `GradingScope.studentProfileId` is already documented as "absent for a parent, whose entitlement is the account", and `answerKeyFor` already takes `studentProfileId: string | null`. The parent path was designed for in Story 5.6 and left unmounted; this story mounts it. A parent-specific results service method would be a second answer to FR-37's one denominator.

**The profile is resolved, never passed.** An Explanation is cached under `(attemptId, questionId, studentProfileId)`, so a parent read has to know which child sat the Attempt. Taking that from the URL would let one profile's id be paired with another's Attempt; taking it from the Attempt row means the pairing cannot be expressed.

```ts
// explanation.service.ts, the parent read seam
const { studentProfileId } = await this.practiceTests.attemptProfileFor(
  scope.parentAccountId,
  attemptId, // 404s for foreign, unknown and still-open Attempts
);
const rows = await this.prisma.explanation.findMany({
  where: { attemptId, studentProfileId },
  select: { questionId: true, body: true, flags: { where: { origin: 'Parent' }, select: { createdAt: true } } },
});
```

**One row component, two persons.** The answer-key row is specified as shared across results, Attempt detail and drill-down. Duplicating ~150 lines of grade-marker layout into a parent copy would let the two drift on the four redundant carriers accessibility depends on; parameterizing the four labels keeps one layout and lets the student read "Your answer" while the parent reads about their child in the third person.

**Why the flag has no undo and no confirmation.** Suppression is the destructive, irreversible act and Story 6.4 gives it a confirmation in words. A flag records a concern and serves nothing to the child differently, so a dialog here would teach a parent that flagging does something it does not do — the panel states what it does instead.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate deploy` -- expected: the new migration applies to a clean database
- `pnpm typecheck` -- expected: no errors across api and web
- `pnpm lint` -- expected: clean
- `pnpm test` -- expected: all unit and integration specs pass, including the new parent specs and the moved component specs
- `pnpm e2e -- parent-explanation-review` -- expected: the new e2e spec passes

## Auto Run Result

Status: done

**Summary:** Story 6.2 opens the parent's first Attempt-detail path and the parent-originated Explanation flag. A parent in Parent View picks a child, sees that child's handed-in runs, opens one, and reads the whole answer key with every Explanation the child was shown rendered inline beneath its own Question — a pure read that generates nothing and spends no Explanation Allowance. Any stored Explanation can be flagged as parent-originated, idempotently per (Explanation, origin), with the outcome announced through the screen's single live region and the panel stating in words that flagging alone changes nothing the child sees. Dispositions, the student flag route, the Admin queue, suppression, regeneration and the grade override stay with the stories that own them. A follow-up review pass on 2026-09-28 found and fixed two further bugs on the Attempt-detail screen (below).

**Files changed:**
- `apps/api/prisma/schema.prisma` — `enum ExplanationFlagOrigin`, `model ExplanationFlag` (unique on `[explanationId, origin]`), `flags` back-relation on `Explanation`.
- `apps/api/prisma/migrations/20260928160000_add_explanation_flag/migration.sql` — handwritten SQL for the enum, table and two indexes.
- `apps/api/src/practicetest/practice-test.service.ts` — `parentSubmittedRunsFor` (newest first, Subject labels batched through `SOURCE_TEST_READER`) and `attemptProfileFor` (ownership proof plus the Attempt's own profile id).
- `apps/api/src/practicetest/practice-test.controller.ts` — `GET parent/students/:studentProfileId/attempts`.
- `apps/api/src/explanation/explanation.service.ts` — `ParentScope`, `explanationsForAttempt`, `flagExplanation` with P2002 recovery.
- `apps/api/src/explanation/explanation-flag.ts` + `.spec.ts` — the pure view mapper and the parent origin constant.
- `apps/api/src/explanation/explanation-policy.ts` — the refusal sentence for a flag with no Explanation behind it.
- `apps/api/src/explanation/parent-explanation.controller.ts`, `explanation.module.ts` — the two parent routes and `ParentElevationGuard`.
- `apps/api/src/grading/parent-attempt.controller.ts`, `grading.module.ts` — `GET parent/attempts/:attemptId/results` over the account-scoped `GradingScope` 5.6 already allowed; no service change, so no rationale field exists to leak.
- `apps/api/test/parent-explanation-review.int-spec.ts` — 19 integration cases covering every I/O matrix row plus origin scoping, malformed ids and elevation on all four routes.
- `apps/web/src/components/AnswerKeyRow.{tsx,spec.tsx}`, `GradeStateMarker.{tsx,spec.tsx}` — moved out of `app/student/_components/`; the row takes a required `labels` prop and imports no copy.
- `apps/web/src/app/student/_components/AttemptResults.tsx` — the two import paths and the student labels.
- `apps/web/src/lib/parent-api.ts` — `ParentAttemptSummary`, `ParentExplanationView` and the four parent calls.
- `apps/web/src/lib/explanation-review.{ts,spec.ts}` — `explanationsByQuestion`, `reviewStateFor`.
- `apps/web/src/lib/parent-view.ts` (+ spec) — `readableInstant`, shared by both new screens.
- `apps/web/src/copy/parent.ts`, `apps/web/src/app/parent/page.tsx` — the `attempts` copy group and the way in from Parent View.
- `apps/web/src/app/parent/_components/ExplanationReview.{tsx,spec.tsx}` — the inline review region and the flag press.
- `apps/web/src/app/parent/attempts/page.{tsx,spec.tsx}`, `apps/web/src/app/parent/attempts/[attemptId]/page.{tsx,spec.tsx}` — the runs list and the Attempt detail (further amended in the follow-up pass below).
- `apps/web/src/components/primitives.spec.tsx` — the two moved components excluded from the primitives sweep.
- `e2e/tests/parent-explanation-review.spec.ts` — the cross-surface flow, child generation through to the parent's flag and back.

**Review findings breakdown:** patch 10 applied (medium 6, low 4), defer 7 recorded (medium 4, low 3), reject 15 (medium 2, low 13). No intent gaps, no bad-spec findings.

**Follow-up review recommendation:** `true` (patched: high 0, medium 6, low 4; score `3 × 6 + 1 × 4 = 22`, at or above the `5` threshold).

**Verification performed:**
- `pnpm --filter api exec prisma migrate deploy` — the new migration applies to a clean database (run as part of the integration suite's setup).
- `pnpm typecheck` — clean across api and web; `pnpm typecheck:e2e` clean.
- `pnpm lint` — clean.
- `pnpm test` (full repo, after the patch pass) — 1137/1138 pass. The single failure is in `test/practice-test.int-spec.ts`, a file whose whole-file runs fail nondeterministically on this machine: four successive runs failed on four *different* cases, and each of those cases passes when run in isolation. Story 6.1 recorded the same file flaking. Not a regression from this diff.
- `pnpm --filter web exec vitest run` — 946/946 across 52 files.
- `pnpm e2e -- parent-explanation-review` — could not run: ports 3000/3001 are held by an unrelated long-running dev server from another project on this machine, which was left alone rather than killed, so Playwright's own API server cannot bind. The spec typechecks and is unexecuted.

**Residual risks:** the e2e spec is unverified at runtime, so the parent screens' exact role/text selectors and every device-level claim rest on inspection alone; the new screens' failure branches have no executing test at any tier (recorded as deferred); a parent read of an ungraded Attempt still triggers grading re-asks with no bound or test; and `test/practice-test.int-spec.ts` remains unstable under whole-file runs.

### 2026-09-28 — Follow-up review pass

**Summary:** A fresh review pass over the same diff (baseline unchanged) found two real bugs on the parent Attempt-detail screen and two testing/consistency gaps worth deferring. Both bugs are fixed in this pass.

**Files changed in this pass:**
- `apps/web/src/app/parent/attempts/[attemptId]/page.tsx` — added `proseLoaded`, gated the `explain` region on it in addition to `proseError`, and reset `announcement` alongside `results`/`explanations` when the read re-issues.
- `apps/web/src/app/parent/attempts/[attemptId]/page.spec.tsx` — updated the source-text assertion for the widened `explain` condition and added assertions for `proseLoaded`'s two settle points and for the announcement reset.

**Review findings breakdown:** patch 2 applied (medium 1, low 1), defer 2 recorded (medium 1, low 1), reject 17 (medium 1, low 16). No intent gaps, no bad-spec findings. The rejected findings were either already covered by this spec's existing `deferred` list (the unexecuted e2e spec, source-text-only unit specs, the unbounded grading re-ask on the parent results route, the unbounded run list) or did not hold up under inspection (a `practiceTest.status: 'Released'` filter present on the run list but not on `attemptProfileFor` looked like a scope mismatch, but `release` is one-way with no path back to `Draft` or to `Discarded` — a submitted Attempt's Practice Test is always `Released`, so the two reads can never actually disagree).

**Follow-up review recommendation:** `false` (patched: high 0, medium 1, low 1; score `3 × 1 + 1 × 1 = 4`, below the `5` threshold).

**Verification performed:**
- `pnpm typecheck` — clean across api and web.
- `pnpm lint` — clean.
- `pnpm --filter web exec vitest run` — 947/947 across 52 files (one new test added).
- `pnpm --filter api exec vitest run test/parent-explanation-review.int-spec.ts` — 19/19 (this pass touched no API code, so only the story's own integration spec was re-run rather than the full, independently-flaky API suite).

**Residual risks:** unchanged from the prior pass, plus the two newly deferred items above (the concurrent flag-write race recovery is untested, and the parent format-label copy duplicates the student one instead of sharing a table).

