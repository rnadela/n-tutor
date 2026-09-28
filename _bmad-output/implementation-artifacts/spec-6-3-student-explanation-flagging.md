---
title: 'Story 6.3: Student Explanation Flagging'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The Admin Flagged Explanations queue read and the parent's per-child flag list are
      both unbounded.
    evidence: |-
      `flaggedForAdmin` selects every qualifying flag row across every account with the
      full Explanation body and folds them in memory; `studentFlagsFor` reads every flag
      row for a child and feeds all of them into `flaggedQuestionContextsFor`, which builds
      `id: { in: [...] }` lists with no ceiling. Neither has take/skip/cursor, and the
      queue only grows because nothing marks an entry judged. At v0 volumes this is
      correct and cheap; it degrades monotonically.
    location: >-
      apps/api/src/explanation/explanation.service.ts
    severity: medium
  - summary: >-
      No index supports the per-child flag list's actual predicate.
    evidence: |-
      `studentFlagsFor` filters on parentAccountId + studentProfileId + origin and orders
      by createdAt desc, id desc. The table carries `[parentAccountId, createdAt]` and the
      new `[origin, disposition, createdAt]`; studentProfileId and origin are residual
      filters either way. An index on (parentAccountId, studentProfileId, origin, createdAt)
      is the one this read wants.
    location: >-
      apps/api/prisma/schema.prisma
    severity: low
  - summary: >-
      A disposition is permanent and records no actor beyond the account.
    evidence: |-
      `disposition`/`dispositionAt` carry no parent identity, and Parent View elevation is
      PIN-gated rather than identity-bound, so "who dismissed this" is unanswerable for a
      contested case. The intent does not ask for attribution and the epic scopes the
      account as the entitlement, so this is a note rather than a defect.
    location: >-
      apps/api/prisma/schema.prisma
    severity: low
  - summary: >-
      The story's e2e spec was written and typechecks but has never been executed.
    evidence: |-
      Ports 3000 and 3001 were held for the whole run by an unrelated project's dev
      servers, and apps/web's `start` script pins port 3000, so Playwright could not bring
      the suite up. `pnpm e2e -- student-explanation-flagging` needs one run in a clean
      environment. Same condition Story 6.2 recorded.
    location: >-
      e2e/tests/student-explanation-flagging.spec.ts
    severity: medium
  - summary: >-
      The whole cross-surface flow is one e2e test with a 360s timeout covering eight
      independent claims.
    evidence: |-
      Sign-up through upload, generation, release, sitting, reporting, the parent's two
      decisions, the child's re-read and the operator queue all chain inside a single
      test(). Any failure reports as one red test with no isolation, and the expensive
      setup re-runs on retry.
    location: >-
      e2e/tests/student-explanation-flagging.spec.ts
    severity: low
  - summary: >-
      Several API integration specs fail nondeterministically under parallel load, on
      baseline as well as here.
    evidence: |-
      practice-test, source-test, uncommitted-state and admin-auth-dummy-hash each fail a
      different 1-3 cases per run when the suite runs in parallel and pass when run alone.
      Reproduced with this story's changes stashed and the Prisma client regenerated from
      the baseline schema, so it is contention over shared database state and PIN rate
      limits, not this change.
    location: >-
      apps/api/test/practice-test.int-spec.ts
    severity: medium
  - summary: >-
      Date-formatting-with-"Invalid Date"-fallback logic is reimplemented independently
      three times instead of shared.
    evidence: |-
      `raisedSentence` in the admin flagged-explanations page, `flaggedSentence` in
      `ExplainPanel.tsx`, and the `readableInstant`-based helpers in
      `ExplanationReview.tsx` / the parent explanation-flags page each guard the same
      "Invalid Date" case with their own local function. A future change to that guard
      has to be made three times and can drift.
    location: >-
      apps/web/src/app/admin/flagged-explanations/page.tsx
    severity: low
  - summary: >-
      `ExplanationFlag.disposition` and `dispositionAt` are only kept paired by
      application discipline, not a database constraint.
    evidence: |-
      Every write path in this story sets both columns together, but nothing in the
      migration enforces `(disposition IS NULL) = (dispositionAt IS NULL)`. A future
      write path that sets one without the other would produce a row the mapper has
      never seen and has undefined behavior for.
    location: >-
      apps/api/prisma/migrations/20260928200000_add_explanation_flag_disposition/migration.sql
    severity: low
  - summary: >-
      The 409-conflict reconcile branch in the parent's decide() flow is never exercised
      by an executing test, only by source-string assertions.
    evidence: |-
      `ExplanationReview.spec.tsx` reads the component's source with `readFileSync` and
      asserts on substrings (e.g. that `parentApi.attemptExplanations(token, attemptId)`
      appears, that the reconcile does not call `announce(`). No test renders the
      component, forces a 409 from a mocked `disposeExplanationFlag`, and asserts the
      region actually redraws as decided with the correct entry. This matches the
      codebase's existing source-assertion convention for stateful components, so
      closing it means adding real interactive rendering for this one component, not a
      one-line fix.
    location: >-
      apps/web/src/app/parent/_components/ExplanationReview.spec.tsx
    severity: low
baseline_revision: 'bc476d574e4db36c33babde34c87f84b35636ab5'
---

<intent-contract>

## Intent

**Problem:** A child who is told something wrong by an Explanation has no way to raise a hand. Story 6.1 shows them the prose and Story 6.2 gave the parent a read-and-flag surface of their own, but the student route in FR-38 does not exist: `ExplanationFlagOrigin.Student` is declared and nothing writes it, no parent surface shows a child's concern or disposes of it, and the Admin Flagged Explanations queue — the destination a *confirmed* flag is supposed to reach and an unconfirmed one must never reach — has no reader at all. Without all three, Story 6.4's suppression has no student-side precondition to unlock from.

**Approach:** Write the student flag from the results-screen Explanation panel without touching the prose on screen; carry it to the parent both on the Attempt-detail region they already read Explanations in and on a per-child list of flags that outlives the disposition; give the parent exactly two dispositions, confirm and dismiss, recorded once and final; and open one Admin queue read whose entries are **Explanations** (not flag rows), containing parent-originated flags and parent-confirmed student flags only.

## Boundaries & Constraints

**Always:**
- `explanation` stays the sole owner and sole writer of `explanation` and `explanation_flag` (AD-17), and acquires no `attempt`, `practiceTest`, `question`, `answer`, `sourceTest` or taxonomy delegate. Every fact about an Attempt or a Question arrives through a `PracticeTestService` boundary read, as `attemptProfileFor` and `explanationInputFor` already do.
- A student flag **surfaces to the parent only**. No student-scoped response, and no Admin response, may carry an unconfirmed student flag. The Admin queue read filters in the service, never in a controller and never in the browser.
- **Flagging changes nothing the student is reading or served.** No `Explanation.body` write, no `chargedAt` touch, no allowance movement, no grade, score or Mastery write, and no state on the student's screen except the flag's own. The panel stays open and the prose stays rendered.
- A student sees **only their own flag's existence** — never the parent's flag, never a disposition, never a count. A dismissal is recorded and relayed to nobody (AD-20, AD-26: nothing parent-scoped is reachable from a student-scoped surface or endpoint).
- Flags stay **idempotent per `(explanationId, origin)`** by the existing unique index, with the first `createdAt` kept and the P2002 recovery `flagExplanation` already makes. A repeat press is the same concern, answered 200.
- A disposition applies **only to a student-origin flag**, is one of exactly two values, and the first one recorded is final. A parent-origin flag has no disposition and needs none: it is already the parent's own judgement.
- Every parent route stays `@Controller('parent')` + `ParentElevationGuard` + `ParseUUIDPipe` on ids, with the account off `req.elevated!`; every student route stays `StudentModeGuard` with both ids off `req.student!`, no `ParseUUIDPipe`, and one sentence per refusal. Every Admin route stays `AdminAuthGuard`.
- Refusal sentences live in `explanation-policy.ts` only, and an ownership or existence refusal reuses `PRACTICE_TEST_NOT_FOUND` by value (AD-18).
- No user-facing string is a literal in a component: second person in `studentCopy`, third person in `parentCopy`, factual in `adminCopy` (AD-32). Announcements use the sentence displayed, through each surface's single live region.
- No response, log line or queue row carries a cost, tier, model name, allowance figure or grading rationale. Admin queue log lines carry identifiers only — never Explanation text or a child's answer.

**Block If:**
- The intent would require reversing or re-deciding a disposition after it is recorded, or suppressing on confirm — both are explicitly out of scope here (suppression is 6.4).

**Never:**
- Never suppress, regenerate, or hide an Explanation on any path in this story; confirming does not suppress.
- Never surface a dispute flag, grade override, Mastery figure or the Analytics dashboard band — 6.5 and Epic 7 own those. The per-child flag list here is a plain parent screen that Story 7.4 can later mount as the dashboard band; it is not that band.
- Never generate an Explanation on any parent or Admin path, and never add an un-flag, undo or toggle.
- Never let a student's surface learn a profile id, account id or Attempt ownership fact it did not already hold, and never add a route whose id parameters could pair one child with another's Attempt.
- Never write Mastery, grade state or `Attempt.score` from this module.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Student flags a read Explanation | Bound student, own submitted Attempt, stored Explanation | 200 with the same `body` plus `studentFlaggedAt`; one `explanation_flag` row at `origin: Student`, `disposition: null` | No error expected |
| Student presses again | A student flag already exists | 200 with the **same** `studentFlaggedAt`; no second row | No error expected |
| Two first presses land together | Concurrent identical flag writes | One row; the loser re-reads the winner's row and answers it | P2002 recovered, never a 500 |
| Student flags an unexplained Question | No stored Explanation for that Question | 404, the one shared sentence | `NO_EXPLANATION_TO_FLAG` |
| Student flags a sibling's / foreign / open Attempt | Ids off the binding do not match | 404, the same sentence, nothing written | `PRACTICE_TEST_NOT_FOUND` by value |
| Student re-reads after flagging | Stored Explanation with a student flag | 200 (not 201), same prose, `studentFlaggedAt` set, no allowance movement | No error expected |
| Student read of a parent-flagged Explanation | Parent flag and/or disposition exist | Response carries prose and the student's own flag only — no parent field of any kind | No error expected |
| Parent reads an Attempt | Explanations with mixed flag state | Each entry carries `parentFlaggedAt`, `studentFlaggedAt` and `studentFlagDisposition` | No error expected |
| Parent confirms a student flag | Student flag, no disposition | 200; disposition `Confirmed` with its instant; the Explanation now appears in the Admin queue | No error expected |
| Parent dismisses a student flag | Student flag, no disposition | 200; disposition `Dismissed`; the Explanation stays out of the Admin queue and stays listed for the parent | No error expected |
| Parent disposes twice, same value | Disposition already recorded | 200 with the recorded disposition and its first instant | Idempotent, nothing rewritten |
| Parent disposes twice, other value | Disposition already recorded | 409 with the one stated sentence; nothing rewritten | `FLAG_ALREADY_DISPOSED` |
| Parent disposes a flag that is not there | No student flag on that Explanation | 404, the shared sentence | `NO_STUDENT_FLAG_TO_DISPOSE` (= `PRACTICE_TEST_NOT_FOUND`) |
| Parent lists a child's flags | Child with awaiting and disposed flags | Newest first, both kinds listed, each marked with its disposition or as awaiting | No error expected |
| Parent lists another account's profile | Foreign `studentProfileId` | `[]`, the same answer an empty child gets | Nothing enumerated |
| Admin reads the queue | Parent flag on A, confirmed student flag on B, dismissed on C, awaiting on D | Entries for A and B only, one per Explanation | No error expected |
| Admin queue de-duplication | Parent flag **and** confirmed student flag on one Explanation | **One** entry, `raisedBy` listing both routes, `raisedAt` the earliest qualifying instant | No error expected |
| Admin queue without a token | No/invalid admin bearer | 401 from `AdminAuthGuard` | Guard's own refusal |

</intent-contract>

## Code Map

**API — what exists and what each new piece extends**
- `apps/api/prisma/schema.prisma:1294` `enum ExplanationFlagOrigin { Parent, Student }` — both members already declared, so no enum migration; `:1319` `model ExplanationFlag` — `@@unique([explanationId, origin])` is the idempotency, `@@index([parentAccountId, createdAt])` the existing read index. `model Explanation` at `:1250` (`flags` back-relation, unique `[attemptId, questionId, studentProfileId]`).
- `apps/api/prisma/migrations/20260928160000_add_explanation_flag/migration.sql` — the handwritten-SQL house style and `YYYYMMDDHHMMSS_snake_case_intent` naming; the latest migration on disk.
- `apps/api/src/explanation/explanation-flag.ts:16` `PARENT_FLAG_ORIGIN` (its own doc says 6.3 adds a second constant beside it, not an enum change); `:41` `ParentExplanationView`; `:70` `parentExplanationViews` — the pure mapper, and the one place `flags[0]` is read because the read pre-filters origin. **Both the interface and the mapper change here**, because the read can no longer pre-filter to one origin.
- `apps/api/src/explanation/explanation.service.ts:159` `explanationFor` (ownership proof through `explanationInputFor` **first**, then the read-through cache at `:180`, `ExplanationView` at `:67`); `:324` `explanationsForAttempt` (the parent read, `flags: { where: { origin: PARENT_FLAG_ORIGIN } }`); `:392` `flagExplanation` (the upsert, the P2002 arm, the log line's identifier-only discipline — the template every new write here follows); `StudentScope`/`ParentScope` at `:43`/`:62`.
- `apps/api/src/explanation/explanation-policy.ts` — one file for every sentence; `NO_EXPLANATION_TO_FLAG` at its foot is `PRACTICE_TEST_NOT_FOUND` aliased by value, and documents why a flag needs no 409. The 409 this story *does* need (a second, different disposition) belongs beside it.
- `apps/api/src/explanation/student-explanation.controller.ts` — `StudentModeGuard`, ids off `req.student!`, no `ParseUUIDPipe`, and the 201/200 convention; `parent-explanation.controller.ts` — `ParseUUIDPipe` on both ids, `@HttpCode(HttpStatus.OK)` on the flag POST, account off `req.elevated!`.
- `apps/api/src/explanation/explanation.module.ts` — already builds both guards and exports `ExplanationService`; a new parent/student route needs no new wiring.
- `apps/api/src/practicetest/practice-test.service.ts:1401` `attemptProfileFor` (ownership proof + the child, the boundary-read pattern to mirror); `:1340` `parentSubmittedRunsFor` (`SOURCE_TEST_READER.readSubjectLabels` batching, newest-first ordering); `:1804` `explanationInputFor` (the student-side proof). `ParentAttemptSummary` at `:368`, `AttemptProfile` at `:377`.
- `apps/api/src/practicetest/practice-test-policy.ts:218` `PRACTICE_TEST_NOT_FOUND`.
- `apps/api/src/admin/admin.module.ts` — `AdminAuthGuard` + `ADMIN_JWT` are provided here and the guard is **not exported**, so the Admin queue controller belongs in this module and this module imports `ExplanationModule` (no cycle: nothing imports `AdminModule` but `app.module.ts`). `apps/api/src/admin/parent-account.controller.ts` — `@Controller('admin/...')` + `@UseGuards(AdminAuthGuard)` + `@SkipThrottle({ login: true })`; `dto/parent-account.dto.ts` — the class-validator DTO style a disposition body follows.
- `apps/api/test/harness.ts:474` `adminToken`, `:566` `setPinFor`, `:575` `elevate`; `apps/api/test/parent-explanation-review.int-spec.ts` — the fixture path that reaches a stored Explanation, a seeded `origin: 'Student'` flag, and an elevated parent request; `apps/api/test/explanation.int-spec.ts` — the student-side path.

**Web — precedents and the surfaces that change**
- `apps/web/src/app/student/_components/ExplainPanel.tsx` — `ExplainState` render, the mounted-only `aria-controls`, `announced` ref latched on the state object, `noteOf`/`spokenOf`. The flag control belongs inside the `loaded` branch, beneath the prose, and must not disturb it.
- `apps/web/src/lib/explain-panel.ts` — `ExplainState` (`loaded` carries `body`) and `explainDecision`; the DOM-less unit layer means a new press rule has to be a pure function here too.
- `apps/web/src/app/parent/_components/ExplanationReview.tsx` — the parent region: `reviewStateFor`, the disappearing flag control, the focus move on unmount (`pressed` ref), `announce` as a prop, `ParentApiError.notElevated` handling, `onFlagged` handing state back to the screen.
- `apps/web/src/lib/explanation-review.ts` — `explanationsByQuestion`, `reviewStateFor`, `ExplanationReviewState`.
- `apps/web/src/app/parent/attempts/[attemptId]/page.tsx:214` — the single live region, `proseLoaded`/`proseError` gating, `onFlagged`, and the `explain` slot the region is passed through; `apps/web/src/app/parent/attempts/page.tsx` — the child selector + list screen to mirror for the flag list.
- `apps/web/src/lib/parent-api.ts:492` `ParentExplanationView`, `:1077` `explainQuestion` (student call, no bearer), `:1454` `studentAttempts`, `:1486` `attemptExplanations`, `:1506` `flagExplanation`, `:1540` `elevated(token)`; `ParentApiError` at `:534`, `CONFLICT_STATUS` at `:673`.
- `apps/web/src/lib/admin-api.ts:123` the private `call<T>`, `:149` `adminApi`; `apps/web/src/app/admin/_components/AdminChrome.tsx:40` the nav buttons; `apps/web/src/app/admin/accounts/page.tsx` the screen precedent; `apps/web/src/copy/admin.ts:17` `nav`.
- `apps/web/src/copy/student.ts` `results.explain` group (`control`, `heading`, `announcement(ordinal)`, `atCap`, `offline`); `apps/web/src/copy/parent.ts:872` `attempts` group (`flagControl`, `flagged(instant)`, `flaggedUndated`, `flagNote`, `flagAnnouncement`, `flagFailed`) and `:104` `parentView` group (where a link to a new screen is named); `apps/web/src/lib/parent-view.ts` `readableInstant`, `announcedText`, `applyIfCurrent`, `endsParentView`, `NOTHING_ANNOUNCED`.
- Tests: `apps/web` vitest is `environment: 'node'` — `renderToStaticMarkup` for pure components, `readFileSync` source assertion for stateful ones, pure logic in `src/lib/*.ts`. `e2e/tests/student-explanations.spec.ts` drives sign-up → PIN → profile → upload → generate → release → hand-in → Explanation; `e2e/tests/parent-explanation-review.spec.ts` continues it into Parent View; `e2e/tests/admin-accounts.spec.ts` shows the admin sign-in path.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `enum ExplanationFlagDisposition { Confirmed, Dismissed }` (`@@map("explanation_flag_disposition")`) and, on `ExplanationFlag`, nullable `disposition` and `dispositionAt`, plus `@@index([origin, disposition, createdAt])` -- the queue read is "parent-origin, or student-origin confirmed, newest first" and that is the index it wants; nullable because a parent-origin flag has no disposition and an awaiting student flag has not got one yet.
- `apps/api/prisma/migrations/<ts>_add_explanation_flag_disposition/migration.sql` -- handwritten SQL for the enum, the two columns and the index, commented in the repo's prose style -- migrations are authored here, never generated.
- `apps/api/src/explanation/explanation-policy.ts` -- add `STUDENT_FLAG_ORIGIN`'s two refusals: `NO_STUDENT_FLAG_TO_DISPOSE` (= `PRACTICE_TEST_NOT_FOUND` by value, with the reason spelled out) and `FLAG_ALREADY_DISPOSED` (the one 409 sentence, naming that the first decision stands and stating no child's name, no tier and no number) -- every sentence in one file.
- `apps/api/src/explanation/explanation-flag.ts` -- add `STUDENT_FLAG_ORIGIN`; widen `ParentExplanationView` with `studentFlaggedAt: string | null` and `studentFlagDisposition: 'Confirmed' | 'Dismissed' | null`; add `StudentExplanationFlagView { studentFlaggedAt: string | null }`; rewrite `parentExplanationViews` to fold a row's **both-origin** flag list by origin rather than reading `flags[0]` -- the read can no longer pre-filter to one origin, so the mapper is where the two routes are told apart, and it stays pure.
- `apps/api/src/explanation/explanation.service.ts` -- (a) widen `ExplanationView` with `studentFlaggedAt: string | null` and select the student flag on both arms of `explanationFor`, charged and cached; (b) add `flagExplanationAsStudent(scope: StudentScope, attemptId, questionId)` -- ownership proof through `explanationInputFor` first, then the stored row by its three ids, then the same upsert-plus-P2002-recovery shape at `origin: Student`, returning prose unchanged plus the instant; (c) widen `explanationsForAttempt`'s `flags` select to both origins with `disposition`/`dispositionAt`; (d) add `disposeStudentFlag(scope: ParentScope, attemptId, questionId, disposition)` -- resolve the profile through `attemptProfileFor`, find the student flag, write with `updateMany({ where: { id, disposition: null } })` so the transition is decided by the statement and not by a prior read, then re-read: same value → 200 with the recorded instant, different value → 409; (e) add `flaggedForAdmin()` -- one query over `explanation_flag` for `origin: Parent` or `(origin: Student, disposition: Confirmed)`, grouped into one entry per `explanationId` -- nothing in any of these writes a body, a `chargedAt`, a grade or Mastery.
- `apps/api/src/explanation/admin-flag-queue.ts` + `apps/api/src/explanation/admin-flag-queue.spec.ts` -- the pure part of the queue: `AdminFlaggedExplanationView` (`explanationId`, `parentAccountId`, `studentProfileId`, `attemptId`, `questionId`, `body`, `raisedBy: ('Parent' | 'Student')[]`, `raisedAt`) and `adminQueueEntries(rows)` folding flag rows into one entry per Explanation with the earliest qualifying instant and both routes listed -- this is the architecture's open de-duplication question decided, and it is decided as a pure function so it is assertable without a database.
- `apps/api/src/explanation/student-explanation.controller.ts` -- add `POST attempts/:attemptId/questions/:questionId/explanation-flag` at `@HttpCode(HttpStatus.OK)`, ids off `req.student!` -- 200 and not 201 for the reason the parent flag is 200: a repeat press is the same concern, not a second flag.
- `apps/api/src/explanation/parent-explanation.controller.ts` + `apps/api/src/explanation/dto/dispose-flag.dto.ts` -- add `POST attempts/:attemptId/questions/:questionId/explanation-flag/disposition` with a class-validator `@IsIn`-style DTO on the one body field -- a disposition is a closed set and the validation pipe is where a third value dies.
- `apps/api/src/explanation/parent-explanation-flags.controller.ts` (or the same parent controller, if it stays coherent) -- add `GET parent/students/:studentProfileId/explanation-flags` returning the child's student-origin flags newest first, each with `attemptId`, `questionId`, `flaggedAt`, `disposition`, `dispositionAt` and the run/Question context -- a flag the parent cannot find is a flag that did not surface.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `flaggedQuestionContextsFor(parentAccountId, refs: readonly { attemptId: string; questionId: string }[])` returning, per ref, `{ practiceTestId, runOrdinal, questionOrdinal, subjectName, submittedAt }` with Subject labels batched through `SOURCE_TEST_READER` and refs outside this account simply absent -- one boundary read so the flag list can name what it points at while `explanation` still holds no `attempt` or `question` delegate; a missing context costs the entry its label, never its place.
- `apps/api/src/admin/flagged-explanation.controller.ts` + `apps/api/src/admin/admin.module.ts` -- `@Controller('admin/flagged-explanations')` + `AdminAuthGuard`, `GET` calling `ExplanationService.flaggedForAdmin()`, and `ExplanationModule` added to this module's imports -- the guard is constructed here and not exported, and `admin` is imported by nothing but `app.module.ts`, so this direction is the acyclic one.
- `apps/api/src/explanation/explanation-flag.spec.ts` -- extend for the widened mapper: both origins folded, a dismissed flag still reported to the parent with its disposition, and a parent-origin flag never carrying one -- the matrix's pure rows.
- `apps/api/test/student-explanation-flag.int-spec.ts` -- the stateful matrix rows: the student flag (first press, repeat, unexplained Question, foreign/sibling/open Attempt, nothing written on a refusal), the student re-read (200, prose byte-identical, `studentFlaggedAt` set, **no parent field in the response body** and no allowance movement), the parent read (both flags and the disposition), the two dispositions, the repeat and the conflicting repeat, the per-child list (awaiting and disposed, foreign profile `[]`), and the Admin queue (confirmed and parent-originated only; dismissed and awaiting absent; one entry for an Explanation carrying both routes; 401 without a token) -- these need the real app and database.
- `apps/web/src/lib/explain-panel.ts` + `apps/web/src/lib/explain-panel.spec.ts` -- carry `studentFlaggedAt` on the `loaded` state, add `flagged` to it or a sibling field, and add a pure `flagDecision({ online, state, sending })` returning `'noProse' | 'already' | 'busy' | 'offline' | 'request'` -- the rules that decide whether a press leaves the device must be assertable with no DOM.
- `apps/web/src/copy/student.ts` -- add to `results.explain`: `flagControl`, `flagNote` (what reporting does, in the child's second person: a grown-up will read it, nothing here changes), `flagged` / `flaggedUndated`, `flagFailed`, `flagAnnouncement(ordinal)`, `flagOffline` -- no blame, no exclamation mark, no mention of Admin, an operator, a tier or a queue, and nothing about what the parent might decide.
- `apps/web/src/app/student/_components/ExplainPanel.tsx` -- inside the `loaded` branch only, beneath the prose: the flag control, the note, the reported state that replaces the control, and the failure sentence -- the prose, the panel's open state and every other row are untouched by any outcome, and the announcement is the sentence displayed.
- `apps/web/src/lib/explanation-review.ts` + `.spec.ts` -- add `studentFlagStateFor(view)` → `'none' | 'awaiting' | 'confirmed' | 'dismissed'`, keeping `reviewStateFor` as it is -- the parent region now draws two independent flag facts and each is its own pure decision.
- `apps/web/src/copy/parent.ts` -- extend `attempts` with the student-flag sentences (`studentFlagged(instant)` / undated, the awaiting-decision line, `confirm`, `dismiss`, what each does in words, `confirmed(instant)`, `dismissed(instant)`, the announcements and `disposeFailed`) and add a `flags` group for the new list screen (title, intro, the child selector, the empty sentence, the awaiting/decided labels, the row's "run N, question M" line, `listFailed`, the way back); add the `parentView` link label -- third person about the child, every figure a parameter, and the confirm copy states that it sends the report on for review and does not remove the explanation.
- `apps/web/src/app/parent/_components/ExplanationReview.tsx` + `.spec.tsx` -- render the student flag beside the parent's own: the awaiting state with Confirm and Dismiss, the decided state with which decision and when, and no control once decided; one `parentApi.` disposition call, announced with the displayed sentence, focus moved to the sentence that replaces the controls exactly as the flag path already does -- confirming must not suppress and must say so.
- `apps/web/src/lib/parent-api.ts` -- widen `ParentExplanationView`, widen the student `ExplanationView`, and add `parentApi.flagExplanationAsStudent(attemptId, questionId)` (no bearer, like `explainQuestion`), `parentApi.disposeExplanationFlag(token, attemptId, questionId, disposition)` and `parentApi.studentExplanationFlags(token, studentProfileId)` -- elevated-header reads with the new `parentCopy` fallbacks.
- `apps/web/src/app/parent/explanation-flags/page.tsx` + `page.spec.tsx` -- child selector plus that child's flags, newest first, awaiting ones marked as needing a decision and decided ones marked with their decision, each linking to the Attempt detail screen that carries the Explanation; empty state rendered, not errored -- a flag "stays listed" before and after the decision.
- `apps/web/src/app/parent/page.tsx` -- link the new screen from Parent View -- a destination with no link is a destination a parent cannot reach.
- `apps/web/src/lib/admin-api.ts` + `apps/web/src/copy/admin.ts` + `apps/web/src/app/admin/_components/AdminChrome.tsx` + `apps/web/src/app/admin/flagged-explanations/page.tsx` + `page.spec.tsx` -- `adminApi.flaggedExplanations()`, the copy group, the nav entry, and the screen: one row per Explanation with the prose, which routes raised it, when, and the identifiers — no child name, no account email, no cost, tier or model name; an empty queue is a stated sentence and the normal case.
- `e2e/tests/student-explanation-flagging.spec.ts` -- extend the existing full flow: the child opens an Explanation and reports it, the prose stays on screen and the panel stays open, a reload shows it still reported; the parent enters Parent View, finds it listed as awaiting a decision, opens the Attempt, reads it, confirms one and dismisses another; the child's own screen still serves both Explanations unchanged; the operator signs in and sees the confirmed one and not the dismissed one -- every click, keyboard move and cross-surface claim lives here.

**Acceptance Criteria:**
- **Given** a student reading an Explanation on their results screen, **when** they report it, **then** the prose stays on screen with the panel open, the outcome is announced through the student surface's live region with the sentence displayed, the report persists across a reload, and nothing the student is served anywhere changes.
- **Given** a student's report, **when** the parent enters Parent View, **then** it is listed for that child as awaiting a decision and is readable in full on the Attempt-detail region, and nothing about it has reached any Admin surface.
- **Given** a parent reading a reported Explanation, **when** they confirm it, **then** the decision is recorded once with its instant, the Explanation appears in the Admin Flagged Explanations queue, the Explanation is still served to the child unchanged, and the screen says in words that confirming sends the report on and does not remove it.
- **Given** a parent reading a reported Explanation, **when** they dismiss it, **then** the decision is recorded, the item stays listed marked dismissed, nothing reaches Admin, and the child is told nothing about the decision on any surface.
- **Given** an Explanation carrying both a parent-originated flag and a confirmed student flag, **when** the operator reads the queue, **then** it appears exactly once, naming both routes and the earliest instant either was raised.
- **Given** any student-scoped response on any endpoint, **when** it is inspected, **then** it carries no parent flag, no disposition, no allowance figure, no tier, no cost, no model name and no grading rationale.
- **Given** `pnpm lint`, `pnpm typecheck` and `pnpm test` at the repo root, **when** they run, **then** they pass with the new specs included.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 0, medium 5, low 8)
- defer: 6: (high 0, medium 3, low 3)
- reject: 9: (high 0, medium 1, low 8)
- addressed_findings:
  - `[medium]` `[patch]` A 409 `FLAG_ALREADY_DISPOSED` rendered its sentence but left the region at `awaiting`, so both decision controls stayed on screen offering a decision the API would always refuse and the recorded one was invisible until a reload. The conflict arm now re-reads the Attempt's Explanations and hands the entry to `onFlagged`, so the region redraws as decided beside the refusal.
  - `[medium]` `[patch]` Both effects on the new parent flags screen fell back to `cause.message` before their copy sentence, so internal error text reached a parent and the `parentCopy.flags` fallback was dead code; a failed profiles read also showed the reports-failure sentence. `cause.message` is gone and `parentCopy.flags.profilesFailed` states the other failure.
  - `[medium]` `[patch]` Pressing the student's report control unmounted it and dropped keyboard focus to `document.body` mid-paper — the bug `ExplanationReview` already solves. The panel now moves focus to the sentence that replaced the control, and only when its own press recorded it.
  - `[medium]` `[patch]` Nothing pinned that a decision's response still carries the parent's own flag: every dispose case had `parentFlaggedAt: null`, so narrowing the response's flag list to the decided row would have made a parent's own flag vanish from the row with the suite green. A new case flags both ways on one Question and asserts the instant survives the decision and the re-read.
  - `[medium]` `[patch]` Nothing pinned the student upsert's empty `update: {}` arm, so writing `disposition: null` there would have let a second press from the child erase the parent's decision and drop a confirmed Explanation out of the operator's queue. A new case presses again after a confirmation and asserts both the row and the queue.
  - `[low]` `[patch]` The disposition refusal loop omitted a still-open Attempt, which the controller's own doc claims answers the shared 404. Added to the loop.
  - `[low]` `[patch]` The disposition instant was asserted only as a string, against a fixture whose `dispositionAt` equalled `createdAt`, so a mapper reading the wrong column would pass. The fixture now carries distinct instants and the value is pinned.
  - `[low]` `[patch]` The queue's qualifying disposition was a bare `'Confirmed'` literal in a module whose whole discipline is a named constant per enum member. `QUEUED_FLAG_DISPOSITION` now names it.
  - `[low]` `[patch]` `disposeStudentFlag` guarded `stored === undefined`, which `findUnique` never returns. Dropped.
  - `[low]` `[patch]` Every card on the operator queue emitted the same three `h2` headings and nothing naming which entry, so navigating by heading was unusable. Each card now carries one identifying heading and the in-card labels are demoted.
  - `[low]` `[patch]` An origin outside the two mapped copy keys rendered an empty "Raised by" line. It falls back to the route itself.
  - `[low]` `[patch]` The queue fold ranked an unlisted route `-1`, sorting it ahead of `Parent` and contradicting the fixed order the file states. An unknown route now ranks last.
  - `[low]` `[patch]` The ban on a blocking native dialog had been narrowed to `window.confirm`, so a bare `confirm(...)` passed the assertion that exists to forbid it. The pattern now catches the bare, `window.` and `globalThis.` spellings without matching the copy's own word.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 3: (high 0, medium 0, low 3)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` `disposeStudentFlag`'s response reused the pre-write `stored.flags` read to report the parent's own flag, so a parent flag written concurrently with the disposition write would vanish from that response even though the row itself was correct on the next read. The response now re-reads every flag on the Explanation after the disposition write instead of reusing the stale read.

## Design Notes

**The Admin queue's identity is the Explanation, not the flag.** This is the open question the architecture carried into 6.3. Two rows can legitimately qualify for one Explanation — a parent who originated a flag and a student flag the same parent later confirmed — and the operator's job is to judge *the prose*, once. So the queue read folds flag rows by `explanationId`, lists the routes that raised it, and takes the earliest qualifying instant as the queue position. Two entries would make the same paragraph arrive twice with nothing to tell them apart; a `DISTINCT` on the Explanation would silently lose which route raised it, which is exactly the fact that says whether a child was involved.

**A disposition is a decision, not a setting.** The first one recorded stands: a same-value repeat answers 200 with the recorded instant (a double-tap is one decision), and a different value answers 409 with one sentence. Reversal is not in FR-38, and a reversible confirm would mean an Explanation entering and leaving the operator's queue underneath them. The transition is decided by `updateMany({ where: { id, disposition: null } })` rather than by read-then-write, so two simultaneous presses cannot both win.

```ts
// explanation.service.ts — the queue read's whole filter, stated once
const rows = await this.prisma.explanationFlag.findMany({
  where: {
    OR: [{ origin: 'Parent' }, { origin: 'Student', disposition: 'Confirmed' }],
  },
  orderBy: { createdAt: 'asc' },
  select: { origin: true, createdAt: true, explanation: { select: { /* ids + body */ } } },
});
return adminQueueEntries(rows); // one entry per Explanation, both routes named
```

**Why the student's flag rides on the Explanation response rather than a read of its own.** The panel unmounts on collapse, so reopening it re-issues the `POST .../explanation`, which answers 200 from the stored row. Putting `studentFlaggedAt` on that response means the reported state survives a reload and a re-open with no second request and no new endpoint — and the student's response still carries exactly one flag fact, their own.

**Why the mapper stops pre-filtering.** `explanationsForAttempt` filtered `flags` to `origin: Parent`, which made `flags[0]` safe by the unique key. The parent now needs both routes and a disposition, so the `where` widens and the fold moves into the pure mapper — where a row with two flags is turned into two named fields rather than an array a screen has to search.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate deploy` -- expected: the new migration applies to a clean database
- `pnpm typecheck` -- expected: no errors across api and web
- `pnpm lint` -- expected: clean
- `pnpm test` -- expected: all unit and integration specs pass, including the new flag and queue specs
- `pnpm e2e -- student-explanation-flagging` -- expected: the new e2e spec passes

## Auto Run Result

**Summary:** Follow-up review pass over the already-`done` Story 6.3 implementation (student explanation flagging, parent disposition, Admin queue). No code changes were needed beyond one patch; the four parallel review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) found no intent gaps and no spec defects.

**Files changed this pass:**
- `apps/api/src/explanation/explanation.service.ts` -- `disposeStudentFlag` now re-reads every flag on the Explanation after the disposition write instead of reusing the pre-write read, closing a race where a concurrently-written parent flag could vanish from the response.

**Review findings breakdown (this pass):** 16 total -- 1 patch (applied), 3 deferred, 12 rejected. No intent_gap, no bad_spec.
- Deferred: duplicated "Invalid Date"-fallback logic across three web files; no DB constraint pairing `disposition`/`dispositionAt`; the parent's 409-reconcile branch in `ExplanationReview.tsx` has no executing test, only source-string assertions.
- Rejected: findings that duplicated an already-recorded `deferred` item (unbounded admin queue/per-child list, missing disposition actor), contradicted an explicit design decision in this spec (queue `raisedAt` is deliberately the earliest qualifying instant; the reconcile's `() => {}` catch is deliberate and documented), asked for functionality the intent explicitly places in a later story (a cross-attempt "awaiting" badge -- that is Story 7.4's dashboard band), or asked for hardening with no corresponding requirement (confirmation dialogs, live polling, burst-rate-limit tests, a `ROUTE_ORDER` type-safety guard against a third enum member that does not exist).

**Verification performed:**
- `pnpm typecheck` -- passed (api + web).
- `pnpm lint` -- passed (api + web).
- `apps/api` vitest `test/student-explanation-flag.int-spec.ts` (29 tests) -- passed, confirming the patch introduced no regression.
- Full `pnpm test` / `pnpm e2e` were not re-run this pass; the patch is narrowly scoped to one already-covered method and the targeted int-spec file re-verifies it directly.

**Residual risks:** the three deferred items above remain open at low severity; none blocks this story. The e2e suite's environment-dependent port conflict noted in the original run (`deferred` list) was not re-investigated this pass.

**Follow-up review recommendation:** `false` (one patched finding, medium severity; score 3×1 + 1×0 = 3, below the 5 threshold, and no high-severity patch).

