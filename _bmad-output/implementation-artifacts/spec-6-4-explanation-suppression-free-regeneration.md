---
title: 'Story 6.4: Explanation Suppression & Free Regeneration'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
baseline_revision: '54527d90967797c58f13abb6e4ef2bd9122a0964'
deferred:
  - summary: >-
      Suppression is keyed to one Attempt, so a retake serves the child a fresh
      Explanation the parent's decision does not follow.
    evidence: |-
      `Explanation` is keyed `(attemptId, questionId, studentProfileId, generation)`,
      which Story 6.1 chose. A Story 5.7 retake opens a new Attempt, so the same
      Question yields a live generation 1 there and the suppression does not carry
      over. FR-39 says suppression is scoped to a Student Profile without naming the
      Attempt boundary, so both readings are defensible and neither the intent nor
      the epic decides it. No test covers suppress-then-retake either way.
    location: >-
      apps/api/prisma/schema.prisma
    severity: low
  - summary: >-
      The API integration suite is intermittently red when several files run
      together, and hangs outright on a large batch.
    evidence: |-
      Running many int-specs in one vitest invocation fails a different, unrelated
      test roughly one run in several, each of which passes in isolation. Reproduced
      on the baseline commit 54527d9 with the whole change stashed, so it predates
      this story. A twelve-file batch that completed in 73s once later exceeded a
      ten-minute cap without finishing. `practice-test.int-spec.ts` (196 tests)
      cannot complete inside that cap at all, which is why the root `pnpm test`
      cannot be run as one command. `--no-file-parallelism` is not the workaround: it
      leaks `AI_FAKE_FAILURE` across files and fails eight provider-fault cases.
    location: >-
      apps/api/test/harness.ts
    severity: medium
  - summary: >-
      Suppressing a paid Explanation does not credit back the Explanation Allowance unit
      it was charged, so a parent who paid for a bad explanation and removed it gets no
      refund; the free replacement is unrelated to the unit already spent.
    evidence: |-
      `suppressExplanation` only sets `suppressedAt`; it never reads or writes
      `chargedAt`, so a suppressed row that was charged stays charged and the allowance
      counter (which reads `chargedAt: { gte, lt }`) never moves. The intent-contract is
      silent on whether a refund is owed, and both readings — no refund because
      suppression and regeneration change "one Explanation and nothing else," or a
      refund because the parent is being made whole for a bad paid explanation — are
      defensible. No test exercises a suppression of a charged row's counter effect
      either way.
    location: >-
      apps/api/src/explanation/explanation.service.ts (suppressExplanation)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A parent who finds a bad Explanation can flag it and confirm their child's flag, but nothing they do changes what the child is served — the only remedy in the product today is deleting the Student Profile. FR-39 closes that: suppress the Explanation for that one child, and get a replacement that costs nothing.

**Approach:** An `Explanation` row gains `suppressedAt` and a `generation` ordinal, so suppression is a serving rule on a retained row and a replacement is a new generation rather than an overwrite. Every read path resolves the highest generation and checks `suppressedAt` at serve time; the free replacement writes `chargedAt: null`, which the Explanation Allowance counter already excludes by column.

## Boundaries & Constraints

**Always:**
- Suppression is **scoped to one Student Profile** and is **checked at serve time on every read path** — never only by a cache key. The cache key already carries the profile; the `suppressedAt` check is in addition to it.
- Suppression is available **only once a flag exists** on that Explanation: a parent-origin flag, or a student-origin flag the parent confirmed. Never automatic, never in Student Mode. One predicate states that rule, and both the API's refusal and the view's `canSuppress` read it.
- A suppressed row is **retained, stays parent-readable, and still reaches the Admin queue**. Nothing deletes an `Explanation` row and no path un-suppresses one.
- **Suppression is not reversible**, and the parent's confirmation says so in words *before* it fires, together with what it does and does not do.
- A regeneration **consumes no Explanation Allowance at any tier including Free**: it writes `chargedAt: null`, reads no allowance, and cannot be refused by one. The control states that cost (nothing) before it fires.
- Suppression and regeneration change **one Explanation and nothing else**: no grade state, no `GradeRow`, no Attempt score, no Mastery, no dispute flag, no other Question, no other generation, no other child.
- Nothing parent-scoped reaches a student surface or endpoint: no cost, tier, model name, allowance figure, grading rationale, parent flag, disposition, or reason text. The student surface learns exactly two new facts — that a parent removed this explanation, and that a served one is a replacement.
- No log line carries Explanation text, Question content, or a child's answers. Identifiers and counts only.

**Block If:** nothing. Every rule this story needs is already decided in the epic context, EXPERIENCE.md §"Explanation suppressed by a parent", and DESIGN.md's `explanation-panel` suppressed tokens.

**Never:**
- Never add an un-suppress route, a toggle, a soft-delete, or a reason column.
- Never let a student press regenerate, learn who suppressed it beyond "a parent", read the parent's words, or spend allowance on a suppressed Question.
- Never give the suppressed student state an error severity, a warning glyph, a retry control, or a call to action the child cannot perform.
- Never use a blocking native dialog (`confirm`, `window.confirm`, `globalThis.confirm`) — the repo's confirmation is `AppDialog` + `DestructiveButton`.
- Never touch `grading`: no explanation fact enters `AnswerKeyRowView` and `grading` gains no import of `explanation`.
- Never add a second allowance counter or an `excludedFromCount` column — `chargedAt: null` is that flag and `allowance.service.ts` already documents it as this story's.
- Out of scope: Story 6.5's grade dispute and override, Story 7.4's Analytics dashboard band, and a service-wide operator takedown.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Suppress an unlocked Explanation | latest generation live, a parent-origin flag on it | 200, all generations of that Question, the latest carrying `suppressedAt` and `canSuppress: false` | No error expected |
| Suppress after confirming the child's flag | latest live, student flag `Confirmed` | 200, same as above | No error expected |
| Suppress with no qualifying flag | latest live, no flag, or a student flag awaiting/`Dismissed` | 409 `SUPPRESSION_NEEDS_A_FLAG` | Nothing written |
| Suppress twice | latest already suppressed | 200 with the **first** `suppressedAt` | Nothing rewritten |
| Suppress a Question with no Explanation, a foreign/sibling/unknown/open Attempt | any | 404 `PRACTICE_TEST_NOT_FOUND` | Nothing written |
| Student re-reads a suppressed Question | highest generation suppressed | 200 `{ suppressed: true }`, no body, no provider call, no allowance read, no row written | No error expected |
| Regenerate after suppression | highest generation suppressed | 201, all generations; the new one has `generation` + 1, `chargedAt: null`, `suppressedAt: null` | Provider fault → 503 `EXPLANATION_FAILED`, nothing written |
| Regenerate a live Explanation | highest generation not suppressed | 409 `NOTHING_TO_REGENERATE` | Nothing written |
| Regenerate on a Free account at its cap | usage at the Free limit | 201 — the row is free and the counter does not move | No error expected |
| Student reads the replacement | highest generation live, `generation` > 1 | 200 with the prose and `replacement: true` | No error expected |
| Two concurrent regenerations | highest generation suppressed | one row written; the loser answers with the winner's generations | Unique violation recovered, not 500 |
| Student suppression list | any Attempt | question ids whose highest generation is suppressed; a foreign/unknown Attempt answers `[]` | Never a 404 that confirms an id |
| Admin queue with a suppressed Explanation | flagged and suppressed | still one entry for it | No error expected |
| Flag or dispose after suppression | a suppressed generation and a live replacement | flag targets the **latest** generation; a disposition targets the oldest undecided student flag across generations, else the newest decided one | Unchanged 404/409 arms |

</intent-contract>

## Code Map

**API — the schema and the module that owns it**
- `apps/api/prisma/schema.prisma:1250` `model Explanation` — `chargedAt` at `:1260` already documents "a null there is *this row cost nothing*"; `@@unique([attemptId, questionId, studentProfileId])` at `:1275` is the key that must widen; `@@index([parentAccountId, chargedAt])` at `:1279` is the allowance count's index and is unchanged. `enum ExplanationFlagOrigin` `:1294`, `enum ExplanationFlagDisposition` `:1317`, `model ExplanationFlag` `:1341` (`@@unique([explanationId, origin])`, `disposition`/`dispositionAt`) — **no flag change in this story**.
- `apps/api/prisma/migrations/20260928200000_add_explanation_flag_disposition/migration.sql` — the latest migration on disk, and the handwritten-SQL house style plus `YYYYMMDDHHMMSS_snake_case_intent` naming to follow.
- `apps/api/src/allowance/allowance.service.ts:109` the `explanation` counter — it counts `chargedAt: { gte, lt }` and its comment already names **this story's** free regeneration as the null-`chargedAt` case. **Nothing in `allowance` changes**; the carve-out is that this file already excludes it.
- `apps/api/src/explanation/explanation-flag.ts:16`/`:31`/`:47` `PARENT_FLAG_ORIGIN`, `STUDENT_FLAG_ORIGIN`, `QUEUED_FLAG_DISPOSITION` — the three constants the unlock predicate is built from; `ParentExplanationView` `:70`, `StudentExplanationFlagView` `:118`, `StoredExplanationRow` `:135`, `parentExplanationViews` `:160` — the pure mapper that folds a row's flags by origin and is where `canSuppress` is computed.
- `apps/api/src/explanation/explanation.service.ts` — `StudentScope` `:50`, `ParentScope` `:69`, `ExplanationView` `:88`, `StudentFlagListEntry` `:113`, `ExplanationOutcome` `:132`, `ExplanationUnavailable` `:156`; `explanationFor` `:216` (ownership proof through `explanationInputFor` **first**, then the read-through cache `findUnique` at `:230`, the pre-flight allowance read, the `withTransaction` re-count + `create` with `chargedAt: new Date()`, and the P2002 arm that answers with the winner's row — the shape a regeneration mirrors *without* the allowance halves); `explanationsForAttempt` `:404`; `flagExplanation` `:478`; `flagExplanationAsStudent` `:611`; `disposeStudentFlag` `:724`; `studentFlagsFor` `:839`; `flaggedForAdmin` `:914` (its `where` has **no** suppression arm and must keep none); `private write` `:968` (the provider call, the post-hoc retry, `fakeExplanationPayload`, every fault ending as `ExplanationUnavailable`) — reused verbatim by the regeneration.
- `apps/api/src/explanation/explanation-policy.ts` — one file for every sentence. `NO_EXPLANATION_TO_FLAG` and `NO_STUDENT_FLAG_TO_DISPOSE` are `PRACTICE_TEST_NOT_FOUND` aliased **by value** with the reason spelled out; `FLAG_ALREADY_DISPOSED` is the precedent for a 409 that names no child, no number and no tier.
- `apps/api/src/explanation/admin-flag-queue.ts:24` `AdminFlaggedExplanationView`, `:53` `AdminFlagRow`, `adminQueueEntries` — folds by `explanationId`. **Unchanged**: an entry's identity is the Explanation, and a replacement is a different Explanation.
- `apps/api/src/explanation/student-explanation.controller.ts` — `StudentModeGuard`, ids off `req.student!`, **no** `ParseUUIDPipe`, and the 201/200-from-outcome convention; `parent-explanation.controller.ts` — `ParseUUIDPipe` on both ids, `@HttpCode(HttpStatus.OK)`, account off `req.elevated!`; `parent-explanation-flags.controller.ts` — the child-rooted read; `dto/dispose-flag.dto.ts` — the `@IsEnum` DTO style.
- `apps/api/src/explanation/explanation.module.ts` — already builds both guards and exports the service; a new route on an existing controller needs no wiring.
- `apps/api/src/practicetest/practice-test.service.ts:1433` `attemptProfileFor` (the parent-side proof and which child sat it), `:1928` `explanationInputFor` (the ownership proof plus the Question, both answers and the Practice Test's Grade Level — what the regeneration re-asks on), `:1803` `answerKeyFor`. **`practicetest` does not change.**
- `apps/api/test/harness.ts:282` `captureAi` (`sent`, `failNext`) — a spec counts provider calls here; `:474` `adminToken`, `:566` `setPinFor`, `:575` `elevate`. `apps/api/test/parent-explanation-review.int-spec.ts:182` `storeExplanation` — the fixture that writes a stored row directly; `apps/api/test/student-explanation-flag.int-spec.ts` — the flag matrix and the Admin-queue assertions.
- **The fake provider is deterministic per ordinal** (`fakeExplanationPayload({ ordinal, failure })`), so a regenerated body is byte-identical in tests. "A different Explanation" is asserted as a **new row and a second provider call**, never as different prose.

**Web — the surfaces that change**
- `apps/web/src/lib/explain-panel.ts` — `ExplainState` (six members), `flaggedAtOf`, `explainDecision`, `flagDecision`/`FlagPressDecision`. The DOM-less unit layer: a new press rule is a pure function here.
- `apps/web/src/app/student/_components/ExplainPanel.tsx` — the `ExplainState` render, `data-state`, the mounted-only `aria-controls`, `announced`/`reportAnnounced` refs latched on the state object, `pressed`/`flagged` focus move, `noteOf`/`spokenOf`, `deviceIsUnbound`, `CONFLICT_STATUS` → `atCap`.
- `apps/web/src/app/student/_components/AttemptResults.tsx:277` the row loop and the `explain` slot; its doc's **"the one read above is still the only `parentApi.` call this file makes"** invariant — this story adds the second one and the doc says why. `AttemptResults.spec.tsx:139` asserts exactly one `<ExplainPanel`.
- `apps/web/src/lib/explanation-review.ts` — `explanationsByQuestion` (`Map<string, ParentExplanationView>`, one row per Question by the old unique key), `reviewStateFor`, `studentFlagStateFor`.
- `apps/web/src/app/parent/_components/ExplanationReview.tsx` — the parent region: `explanation` prop, `flag()`, `decide()`, `onFlagged`, the `pressed`/`decided` focus moves, `ParentApiError.notElevated`, the 409 re-read reconcile, `decisionSentence`.
- `apps/web/src/app/parent/attempts/[attemptId]/page.tsx:197` `byQuestion`, `:200` `onFlagged` (replaces by `questionId`), `:214` the single live region, `proseLoaded`/`proseError` gating, `:317` the `ExplanationReview` slot.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx:1332` the `AppDialog` + `DestructiveButton` irreversible-action confirmation, and `apps/web/src/copy/parent.ts:805`–`:828` `releaseBody`/`discardBody` — the precedent for stating every consequence before firing. `apps/web/src/components/Dialog.tsx:42` `AppDialog`, `components/Button.tsx:26` `DestructiveButton`.
- `apps/web/src/lib/parent-api.ts:501` `ParentExplanationView`, `:533` `FlagDisposition`, `:1077` `explainQuestion` (student call, no bearer), `:1486` `attemptExplanations`, `:1506` `flagExplanation`, `disposeExplanationFlag`, `studentExplanationFlags`, `elevated(token)`, `ParentApiError`, `CONFLICT_STATUS`.
- `apps/web/src/copy/student.ts:401` `results.explain` (`control`, `heading`, `idle`, `loading`, `failed`, `offline`, `atCap`, `announcement(ordinal)`, `flagControl`, `flagNote`, `flagged`, `flaggedUndated`, `flagFailed`, `flagOffline`, `flagAnnouncement`); `apps/web/src/copy/parent.ts:879` `attempts` (`explanationHeading` `:950`, `nothingExplained` `:956`, `flagControl` `:957`, `flagNote` `:976`, `explanationsFailed` `:982`, `studentFlagAwaiting` `:1010`, `dispositionNote` `:1023`, `confirmAnnouncement` `:1032`) and `drafts.cancel`.
- `apps/web/src/lib/parent-view.ts` `readableInstant`, `applyIfCurrent`. `apps/web/src/theme/tokens.ts` `typeRoles` — the suppressed statement is **product voice in the sans dashboard face** (`typeRoles.caption`/`label`), never `typeRoles.explanationBody`, and carries no error colour.
- Tests: `apps/web` vitest is `environment: 'node'` — `renderToStaticMarkup` for pure components, `readFileSync` source assertion for stateful ones, pure logic in `src/lib/*.ts`. `e2e/tests/student-explanation-flagging.spec.ts` drives sign-up → PIN → profile → upload → generate → release → hand-in → Explanation → report → Parent View → confirm/dismiss → operator queue; `e2e/tests/parent-explanation-review.spec.ts` is the Parent View half.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- on `Explanation` add nullable `suppressedAt DateTime?` and `generation Int @default(1)`, replace `@@unique([attemptId, questionId, studentProfileId])` with `@@unique([attemptId, questionId, studentProfileId, generation])`, and document both: suppression is a **serving rule on a retained row** (so there is no delete and no un-suppress column), and `generation` is what makes a replacement a distinct entry rather than an overwrite — the reason the epic's "a free regeneration is a distinct entry" is expressible at all. State that **at most one generation is live** and that it follows from the two write rules rather than from a partial index: the student path only ever writes generation 1 into an empty (Attempt, Question, child), and the parent path only ever writes `max + 1` when the highest is suppressed, so the widened unique key refuses every racing loser. State that **no column is added for the free regeneration**: `chargedAt: null` is that flag and `allowance.service.ts` already excludes it.
- `apps/api/prisma/migrations/20260929000000_add_explanation_suppression/migration.sql` -- handwritten SQL for the two columns, the dropped unique index and the new one, commented in the repo's prose style -- migrations are authored here, never generated. Existing rows take `generation = 1` from the default and `suppressed_at NULL`, so the new unique index is satisfied by every row already on disk.
- `apps/api/src/explanation/explanation-suppression.ts` + `apps/api/src/explanation/explanation-suppression.spec.ts` -- the pure part of this story, assertable with no database: `suppressionUnlocked(flags)` (a `PARENT_FLAG_ORIGIN` row exists, or a `STUDENT_FLAG_ORIGIN` row whose disposition is `QUEUED_FLAG_DISPOSITION`) -- **the same predicate the Admin queue's two `where` arms state**, named once here so the control a parent is offered and the refusal they would get cannot disagree; `latestGenerations(rows)` folding rows to the highest `generation` per `questionId`; and `suppressedQuestionIds(rows)` returning the ids whose latest is suppressed. A row with no flags, one whose only student flag is awaiting, and one whose student flag is `Dismissed` are each locked, and each is its own case.
- `apps/api/src/explanation/explanation-policy.ts` -- add `NO_EXPLANATION_TO_SUPPRESS` (= `PRACTICE_TEST_NOT_FOUND` **by value**, third of its kind, with its own reason spelled out: there is no Explanation here to remove, and spelling it apart from a foreign Attempt would let the outside read which ids exist), `SUPPRESSION_NEEDS_A_FLAG` (409 -- a concern has to be recorded before an Explanation can be taken away from a child; names no child, no Question, no tier and no number) and `NOTHING_TO_REGENERATE` (409 -- the child is still being served this one, so there is nothing to replace). **No sentence for a repeat suppression**: it is idempotent and answers 200 with the first instant, exactly as a repeat flag press does.
- `apps/api/src/explanation/explanation-flag.ts` -- widen `ParentExplanationView` with `generation: number`, `suppressedAt: string | null` and `canSuppress: boolean`; widen `StoredExplanationRow` with the same two stored fields; compute `canSuppress` in `parentExplanationViews` as `suppressionUnlocked(row.flags) && row.suppressedAt === null` -- **the control's availability is the server's answer, not a rule the browser re-derives**, which is what keeps one rule in one place. Restate in the doc that the view now carries **one entry per generation** and that the screen groups by `questionId`, so the "one row per Question" claim in the old comment is gone.
- `apps/api/src/explanation/explanation.service.ts` -- (a) replace `ExplanationView` with a discriminated `StudentExplanationResponse`: `{ attemptId, questionId, suppressed: false, body, studentFlaggedAt, replacement: boolean }` | `{ attemptId, questionId, suppressed: true }` -- a union rather than a nullable body, so the suppressed answer has **nowhere** for prose, a flag, an instant or a reason to travel, and `replacement` is `generation > 1`. `ExplanationOutcome.view` becomes that union, and the suppressed arm carries `generated: false` so the controller's 201/200 split keeps meaning exactly what it means today — a call that billed a provider against a call that did not; (b) rewrite `explanationFor`'s stored read as `findFirst({ where: { attemptId, questionId, studentProfileId }, orderBy: { generation: 'desc' } })` -- still **after** the `explanationInputFor` proof -- and return the suppressed response when that row carries `suppressedAt`, **before** the allowance read and before any provider call, so a suppressed Question can neither generate nor charge; the no-row arm and its P2002 recovery are otherwise unchanged and still write `generation: 1` with `chargedAt: new Date()`; (c) add `suppressedQuestionsFor(scope: StudentScope, attemptId)` -- one `findMany` over `{ parentAccountId, studentProfileId, attemptId }` selecting `questionId`, `generation`, `suppressedAt`, folded by `suppressedQuestionIds`; a foreign or unknown Attempt matches nothing and answers `[]`, the same answer `studentFlagsFor` gives a foreign profile and for the same reason (AD-18); (d) add `suppressExplanation(scope: ParentScope, attemptId, questionId)` -- `attemptProfileFor` first, then the highest generation, 404 when there is none, 409 `SUPPRESSION_NEEDS_A_FLAG` when `suppressionUnlocked` is false, then `updateMany({ where: { id, suppressedAt: null }, data: { suppressedAt: new Date() } })` so the transition is decided by the statement and a repeat keeps the first instant; (e) add `regenerateExplanation(scope: ParentScope, attemptId, questionId)` -- `attemptProfileFor`, then the highest generation, 404 when there is none, 409 `NOTHING_TO_REGENERATE` when it is not suppressed, then `explanationInputFor(parentAccountId, resolvedProfileId, attemptId, questionId)` and the **existing** `write` internal, and one `create` at `generation + 1` with `chargedAt: null` -- **no allowance read anywhere on this path**, which is what makes "free at every tier" a property of the code rather than a promise; a unique violation means a concurrent regeneration won and the loser answers with the winner's generations; (f) both parent writes answer `ParentExplanationView[]` -- **every** generation of that Question, oldest first, so a screen that must show the removed one beside its replacement gets both from the write it made; (g) widen `explanationsForAttempt`'s select with `generation` and `suppressedAt` and order it `[{ questionId: 'asc' }, { generation: 'asc' }]`; (h) point `flagExplanation` at the highest generation too, and `disposeStudentFlag` at the oldest **undecided** student flag across every generation of that Question, falling back to the newest decided one for its 200/409 arms -- a child can report a suppressed Explanation and its replacement, and a decision is owed on the one nobody has read; (i) leave `flaggedForAdmin` alone and say so in its doc: a suppressed Explanation stays in front of an operator, and a replacement is a different Explanation with an entry of its own. Nothing on any path here writes a grade, a score, Mastery, another Question or another child's row, and no log line gains a fragment of prose.
- `apps/api/src/explanation/student-explanation.controller.ts` -- add `GET attempts/:attemptId/suppressed-explanations` returning `string[]`, ids off `req.student!`, no `ParseUUIDPipe` -- the results screen has to know before it draws a control, because a control the child can press is a parent's decision one tap from being undone and, on Free, an allowance unit spent doing it. Restate on `explainQuestion` that it now answers a union and that the suppressed arm is a 200 rather than a refusal: nothing failed, and a child is not shown an error for a decision a grown-up made.
- `apps/api/src/explanation/parent-explanation.controller.ts` -- add `POST attempts/:attemptId/questions/:questionId/explanation-suppression` at `@HttpCode(HttpStatus.OK)` (a repeat is the same decision, not a second one) and `POST attempts/:attemptId/questions/:questionId/explanation-regeneration` at 201 (it billed a provider call, even though it charged no allowance), both with `ParseUUIDPipe` on both ids and **no body on either** -- there is no reason field, no scope option and no "also confirm the flag": each route does one thing, and a body field with no column behind it is a promise the next reader believes.
- `apps/api/src/explanation/explanation-flag.spec.ts` -- extend for the widened mapper: `canSuppress` true only with a parent flag or a confirmed student flag **and** no `suppressedAt`; a suppressed row still reporting its body and both flag facts; two generations of one Question mapping to two entries with their own `generation` and `suppressedAt`.
- `apps/api/test/explanation-suppression.int-spec.ts` -- the stateful matrix: every I/O row above, plus the claims only the real app and database can settle -- that a suppressed student read makes **no** provider call (`h.ai.sent` does not grow) and writes no row; that a regeneration on a Free account **at its cap** still answers 201 and leaves `GET parent/allowances`' explanation `used` figure unmoved; that the suppressed row survives with its body and is still returned by `GET parent/attempts/:id/explanations`; that the Admin queue still lists it; that the student's re-read of the replacement carries `replacement: true` and **no** parent field, disposition, cost, tier or model name anywhere in the serialized body; that suppression leaves the Attempt's grade states, score and every other Question's Explanation byte-identical; and that a second, concurrent regeneration yields exactly one new row.
- `apps/web/src/lib/explain-panel.ts` + `apps/web/src/lib/explain-panel.spec.ts` -- add `{ kind: 'suppressed' }` to `ExplainState`, add `replacement: boolean` to `loaded`, and add a `'removed'` arm to `ExplainDecision` returned ahead of every other rule when the state is `suppressed` -- a press must never leave the device for a Question a parent has settled, and that rule belongs where it is assertable with no DOM. `flagDecision` returns `noProse` for the suppressed state, which its existing first arm already does.
- `apps/web/src/copy/student.ts` -- add to `results.explain`: `suppressed` (the UX's own words, verbatim and second person -- "A parent removed this explanation. It wasn't a good enough explanation of this question."), `suppressedAnnouncement(ordinal)` (displayed as well as announced, exactly as `announcement` is), and `replacementNote` (a plain line that this is a new explanation). **No** exclamation mark, no blame, no reason, no instruction, no relay of the parent's words, and nothing the child is told to do about it.
- `apps/web/src/app/student/_components/ExplainPanel.tsx` -- accept `suppressed: boolean`; when it is true render the announcement line and the statement **in place of** the `Explain this` control, with no expand, no retry and no flag control, announced once with the sentence displayed; when a press answers `suppressed: true` set the new state, which replaces the prose and the flag block with the same two lines. The statement is product voice in the dashboard face at `severity="info"` at most -- **never** an error severity, a warning glyph or a retry -- and nothing else on the row or the screen changes.
- `apps/web/src/app/student/_components/AttemptResults.tsx` + `AttemptResults.spec.tsx` -- read `parentApi.suppressedExplanations(attemptId)` beside the answer key and pass `suppressed` per row; rewrite the doc's one-read claim to what is now true -- **two reads and no third: the answer key from `grading`, and which Explanations a parent removed from `explanation`; never one per Question, and never one per press.** A failed or still-pending suppression read renders the control as usual and degrades to the API's serve-time check, which is a 200 suppressed state and not a charge -- which is exactly why that check exists and is not a cache trick.
- `apps/web/src/lib/explanation-review.ts` + `apps/web/src/lib/explanation-review.spec.ts` -- `explanationsByQuestion` now returns `Map<string, ParentExplanationView[]>` with each Question's generations in the order the API sent them; add `latestOf(views)` and `suppressionStateFor(views)` → `'locked' | 'available' | 'suppressed'` reading the latest entry's `suppressedAt` and `canSuppress`; `reviewStateFor` and `studentFlagStateFor` keep their signatures and are applied to the latest. The old "last entry wins, which cannot happen" note goes: a Question legitimately holds several rows now.
- `apps/web/src/copy/parent.ts` -- extend `attempts` with the suppression and regeneration sentences, third person about the child and every figure a parameter: `suppressControl`; `suppressTitle`; `suppressBody` naming in one breath that it stops being served **to this student only**, is not a deletion, stays readable here, is still visible to the operator, leaves the question, the attempt, its score and mastery unchanged, and **cannot be undone**; `suppressConfirm`; `suppressed(instant)` / `suppressedUndated`; `suppressAnnouncement(ordinal)`; `suppressFailed`; `regenerateControl`; `regenerateNote` stating the cost before it fires and stating that the cost is nothing at every plan; `regenerating`; `regeneratedAnnouncement(ordinal)`; `regenerateFailed`; and `generationLabel(ordinal)` naming which explanation of that Question an entry is. Nothing here names a tier, a price, a model or a counter.
- `apps/web/src/app/parent/_components/ExplanationReview.tsx` + `ExplanationReview.spec.tsx` -- take `explanations: readonly ParentExplanationView[]`; render each generation with its label, the removed ones read-only with the instant they were removed, and the flag, disposition, suppression and regeneration controls on the latest only; put suppression behind `AppDialog` + `DestructiveButton` carrying `suppressBody`, never a native `confirm`; offer `regenerateControl` with `regenerateNote` beside it **only** in the suppressed state; render nothing at all where `suppressionStateFor` is `'locked'` -- a control that appears disabled would invite a parent to wonder what they did wrong. Announce each outcome with the sentence displayed, and move focus to the sentence that replaces a control it unmounted, guarded on this component's own press exactly as the flag and disposition paths already are.
- `apps/web/src/lib/parent-api.ts` -- widen `ParentExplanationView` with the three new fields; replace the student explanation response type with the discriminated union; add `suppressedExplanations(attemptId)` (no bearer, like `explainQuestion`), `suppressExplanation(token, attemptId, questionId)` and `regenerateExplanation(token, attemptId, questionId)` returning `ParentExplanationView[]`, each with its `parentCopy` fallback sentence.
- `apps/web/src/app/parent/attempts/[attemptId]/page.tsx` + `page.spec.tsx` -- hand `ExplanationReview` the list for each Question; make `onFlagged` replace by `(questionId, generation)` rather than by `questionId`, which now matches several rows; add one handler that replaces **every** entry for a Question with the array a suppression or regeneration answered, so a new generation is appended rather than dropped on the floor.
- `e2e/tests/parent-explanation-suppression.spec.ts` -- the cross-surface claim, continuing the existing full flow: the child opens an Explanation and reports it; the parent enters Parent View, reads it, confirms the report, suppresses it through the confirmation that states the consequences and the irreversibility, and sees no un-suppress anywhere; the child reloads their results and finds the statement in place of the `Explain this` control, with the question, both answers, the grade state, the score and every other Question's Explanation untouched; the parent regenerates, the screen having said the cost is nothing first; the child reloads and reads the replacement, plainly marked as a new one; the operator signs in and still sees the suppressed Explanation in the queue.

**Acceptance Criteria:**
- **Given** an Explanation with no flag on it, **when** the parent opens Attempt detail, **then** no suppression control is rendered and the API refuses a suppression with its own 409 sentence — and **given** a parent-originated flag or a student flag the parent confirmed, **then** the control is offered.
- **Given** a parent suppressing an Explanation, **when** they press the control, **then** a confirmation states before it fires that it stops being served to this student only, is not a deletion, stays readable to them and to the operator, leaves the question, the attempt, its score and mastery unchanged, and cannot be undone — and no request is sent until they confirm.
- **Given** a suppressed Explanation, **when** the child returns to that row on any read path, **then** they are shown that a parent removed it and why in the product's own words, the `Explain this` control is not rendered, no provider call is made, no allowance is consumed, and the question, both answers, the grade state, the score, Retake and every other Explanation on the test are unchanged and usable.
- **Given** a suppressed Explanation, **when** the parent regenerates it, **then** the screen stated first that it costs nothing, a new Explanation is written as a further generation with no allowance charged at any tier including a Free account already at its cap, the suppressed one is retained and still readable, and the child is served the replacement plainly marked as a new explanation.
- **Given** a suppressed Explanation, **when** the operator reads the Flagged Explanations queue, **then** it still appears there, and a replacement that is later flagged appears as an entry of its own.
- **Given** a regenerated Explanation, **when** the child reports it and the parent suppresses it again, **then** both succeed on the same terms with no ceiling, and each generation keeps its own flag, disposition and removal instant.
- **Given** any student-scoped response on any endpoint, **when** it is inspected, **then** it carries no parent flag, no disposition, no reason text, no allowance figure, no tier, no cost, no model name and no grading rationale.
- **Given** `pnpm lint`, `pnpm typecheck` and `pnpm test` at the repo root, **when** they run, **then** they pass with the new specs included.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` `apps/web/src/copy/parent.ts`'s `suppressBody` (the irreversible-suppression confirmation) named the unchanged figures as "the question, the attempt, its score and the student's progress" — but "progress" is the term the codebase reserves for the child's own screen (`copy/student.ts`'s documented convention: "The word for Mastery on a child's screen is `progress`... and never the parent's term"), while AC2 and EXPERIENCE.md both name the figure `Mastery` on parent-facing surfaces. A parent reading this dialog was told the wrong noun for the one figure the confirmation has to name precisely. Changed `suppressBody` to say "Mastery", matching AC2's literal wording and the doc comment above it; no test pinned the old string.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 2: (high 0, medium 1, low 1)
- reject: 11: (high 0, medium 3, low 8)
- addressed_findings:
  - `[medium]` `[patch]` `ExplainPanel` read its `suppressed` prop only in the `useState` initializer, so a panel that mounted before `AttemptResults`' suppression read resolved kept drawing `Explain this` for a Question the parent had removed — the whole "withhold the control, never disable it" rule was decided by which of two parallel requests won. The prop is now adopted on change by a one-way effect, and the e2e forces the late-arrival ordering instead of passing in whichever order it happens to get.
  - `[medium]` `[patch]` The student-flag block and its Agree/Dismiss controls were gated on the latest generation while `disposeStudentFlag` decides the **oldest undecided** report across generations, so a press beside generation 2 recorded a decision about generation 1, the region did not change, and an undecided report on a suppressed generation was undecidable from the screen at all. The block now renders per generation and the controls sit on the generation the API will decide, mirrored by a pure `decidableOf`. The previously unreachable `at(-1)` fallback arm gained coverage: two decided generations, a same-value repeat answering 200 with `generation: 2`, and the opposite value answering 409.
  - `[medium]` `[patch]` `suppressBody` claimed to name every consequence and omitted the most visible one — that the child's own screen will state that a parent removed the explanation. A parent expecting a silent removal would have learned it from their child. Now named second, right after the removal itself.
  - `[low]` `[patch]` The regeneration 404 reused `NO_EXPLANATION_TO_SUPPRESS`, against the convention `explanation-policy.ts` documents at length for its two existing aliases. `NO_EXPLANATION_TO_REGENERATE` now carries its own reason: nothing to put in its place, as against nothing to stop serving.
  - `[low]` `[patch]` A press that answered suppressed unmounted the focused control and dropped focus to `document.body` mid-paper — the bug this same file already solves for the report control. Focus now moves to the line that replaced it, guarded on this panel's own press.
  - `[low]` `[patch]` The regeneration wait was silent to assistive technology until it landed, on a path the e2e allows tens of seconds for. It is announced at the press with the sentence displayed, and the control carries `aria-busy`.
  - `[low]` `[patch]` Four pieces of doc and placement drift: `parent-api.ts` still named the removed `ExplanationView`; `explanationsForAttempt`'s comment still claimed "the order the child asked in" after its `orderBy` changed; `onGenerations` claimed nothing reorders while it appends; and the suppression `AppDialog` mounted once per answer-key row including Questions with no Explanation, where it could never open. The spec slice that should have caught the last one spanned into the falsy arm and was narrowed.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 1, medium 2, low 0)
- defer: 1: (high 0, medium 1, low 0)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[high]` `[patch]` `ExplainPanel`'s `ask()` and `report()` `.then` handlers closed over the `suppressed` prop from whichever render fired the request, so a parent suppressing an Explanation *after* a child's request went out but *before* it came back would have the response's `loaded` state land on top of the `suppressed` state the prop-adoption effect had already set — and nothing put it back, since the prop is only read again on its next change. A child could keep reading, and keep reporting, an Explanation a parent had already, irreversibly removed, until the page reloaded. Both handlers now read a ref mirroring the prop's live value at the moment the response resolves, ahead of `value.suppressed`, and the suppressed answer wins whichever way the fact arrived. `ExplainPanel.spec.tsx` updated for the new effect and the widened condition text it asserts on.
  - `[medium]` `[patch]` `ExplanationReview`'s `confirmSuppression` and `regenerate` failure handlers rendered the API's 409 sentence but never reconciled this region's state the way `decide`'s own 409 handler already does — so a stale suppress or regenerate control (pressed again after another tab already settled it, or the other half of a double press) stayed on screen offering an action the API would keep refusing forever, with no way to learn what actually happened short of a full reload. Extracted the three call sites' identical reconcile logic into one `reconcileAfterConflict()` helper and wired it into all three conflict arms, keeping the "one spelling of one rule" invariant `ExplanationReview.spec.tsx`'s call-count test already polices — that test and the reconcile-slice test were rewritten for the new function boundary.
  - `[medium]` `[patch]` `studentFlagsFor`'s `StudentFlagListEntry` carried no `generation`, and `apps/web/src/app/parent/explanation-flags/page.tsx` keyed its list on `${attemptId}:${questionId}` alone — an invariant this story's widened Explanation key breaks: a child can now flag a suppressed generation and, later, its replacement, and AC6 explicitly keeps each generation's flag and disposition independent. Two such reports now collide on that render key. Added `generation` to `StudentFlagListEntry` and `StudentExplanationFlagView`, included it in `studentFlagsFor`'s select, and widened the page's key to `${attemptId}:${questionId}:${generation}`. Added an int-spec case (`explanation-suppression.int-spec.ts`) driving a Question through flag → suppress → regenerate → flag-again and asserting the parent's flags list returns two distinct entries.
  - `[medium]` `[defer]` Suppressing a paid Explanation (one whose `chargedAt` is set) does not credit the parent's Explanation Allowance for that spent unit — a parent who paid, got a bad explanation, and removed it is not refunded, and the free replacement is unrelated to the unit already spent. The intent-contract is silent on refunds either way, and deciding whether one is owed is a billing-policy call outside what this story's boundaries settle; added to `deferred` below rather than guessed at.
  - `reject` (11, all low): admin-queue visibility of suppression state (the Code Map explicitly leaves `flaggedForAdmin` untouched and says so); a same-endpoint-only concurrency test for repeat suppression (the write is already a single atomic `updateMany`, so the sequential test already proves the invariant); a losing regeneration's discarded provider call leaving no visible trace (matches the existing paid-explanation racing pattern this path deliberately reuses); no rate limit on regeneration (AC6 explicitly states "no ceiling"); no cross-write suppress+regenerate concurrency test (each write is independently atomic; the combination adds no new failure mode); the migration's Postgres-truncated 63-byte index name (cosmetic, and an explicit `map:` would be the only such override in this schema); no dedicated test for `regenerateExplanation` refused on a foreign/open Attempt (shares `attemptProfileFor` with the already-tested suppression path); the read-then-write shape of `suppressionUnlocked` followed by `updateMany` (flags are one-shot and immutable, so nothing can invalidate the read before the write lands); no operator-facing distinction between a removed explanation and one awaiting a decision (same deliberate scope line as the admin-queue item); a hypothetical out-of-order `onGenerations` response from two concurrent actions inside one parent session (requires two simultaneous presses this screen's own guards make hard to reach, and self-heals on the next read); and the `regenerateNote` copy's "free on every plan" claim having no test tying it to the allowance-counting query (a documentation-coupling concern, not a behavioural one).

## Design Notes

**Suppression is a serving rule; a replacement is a generation.** The alternative — overwriting `body` on the one row — was rejected because the epic requires the suppressed record retained, parent-readable and still in the operator's queue, and an overwrite destroys exactly the prose the operator has to judge. So the unique key widens by `generation` and the reads resolve the highest one:

```ts
// The live-or-latest row, on every read path. `findFirst` and not `findUnique`,
// because "the one that counts" is the newest generation and the key now holds four columns.
const stored = await this.prisma.explanation.findFirst({
  where: { attemptId, questionId, studentProfileId },
  orderBy: { generation: 'desc' },
  select: { id: true, body: true, generation: true, suppressedAt: true, flags: { ... } },
});
if (stored !== null && stored.suppressedAt !== null) {
  // Before the allowance read and before `ai`: a settled Question cannot charge.
  return { view: { attemptId, questionId, suppressed: true }, generated: false };
}
```

**Why the suppressed answer is a union arm rather than a nullable body.** A `body: RichText | null` plus a boolean would let a response say "suppressed" and still carry prose, a flag instant or a reason — and the whole discipline of this surface is that a student-scoped shape has nowhere for a parent-scoped fact to sit. The union makes the guarantee the compiler's.

**Why the student results screen reads suppression before it draws anything.** The UX withdraws the `Explain this` control while an Explanation is suppressed, and the panel is mounted per row — so learning it at press time would mean either a control that undoes a parent's decision with one tap, or N requests on load. One attempt-scoped read answers it once. `grading` is deliberately not the carrier: a suppression fact in `AnswerKeyRowView` would put an `explanation` column in the module that owns grades, and that view's own doc exists to say what it refuses to carry.

**Why `chargedAt: null` is the whole of "free".** `allowance.service.ts`'s explanation counter already reads `chargedAt: { gte, lt }` and its comment already names this story's regeneration as the null case. A second counter, an `excludedFromCount` boolean or an allowance read on the regeneration path would each be a new place for the two to disagree. The regeneration path reads no allowance at all, which is why a Free account at its cap cannot be refused one.

**Why the unlock predicate is the Admin queue's predicate.** "A parent-origin flag, or a student-origin flag confirmed" is already `flaggedForAdmin`'s two `where` arms. Stating it a second time in a suppression guard would be two spellings of one rule, and the failure would be silent in the worst direction — a control offered for something the API refuses, or worse, offered for a concern nobody confirmed.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate deploy` -- expected: the new migration applies to a clean database, and to one already carrying Story 6.3's rows
- `pnpm lint` -- expected: clean
- `pnpm typecheck` -- expected: clean, including the union's exhaustive `switch` in `ExplainPanel`
- `pnpm test` -- expected: green, with `explanation-suppression.spec.ts`, `explanation-flag.spec.ts`, `explanation-suppression.int-spec.ts`, `explain-panel.spec.ts`, `explanation-review.spec.ts`, `ExplanationReview.spec.tsx`, `AttemptResults.spec.tsx` and the parent Attempt-detail page spec included
- `pnpm e2e` -- expected: green, with `parent-explanation-suppression.spec.ts` included

## Auto Run Result

**Summary:** This build-auto invocation ran a follow-up review pass on Story 6.4 (already `done` from prior bmad-loop sessions, `followup_review_recommended: true`). No implementation work was re-derived; four review layers ran in parallel against the full diff since `baseline_revision`, one finding was patched, and the rest were rejected or were duplicates of already-tracked deferred items.

**Files changed this pass:**
- `apps/web/src/copy/parent.ts` -- `suppressBody` corrected to name the unchanged figure as "Mastery" (matching AC2 and the codebase's own parent/student terminology split) instead of "progress", which is the term reserved for the child's screen.

**Review findings breakdown:**
- patch: 1 (medium 1, low 0) -- applied.
- defer: 0.
- reject: 11 (all low) -- covered: a duplicate of the already-deferred allowance-refund gap; a duplicate of the already-deferred test-harness flakiness; no logging on the suppression-list endpoint for a foreign Attempt; the `AttemptResults` suppression-fetch effect swallowing failures silently (a deliberate degrade-to-serve-time-check per Design Notes); an extra read before the suppressed short-circuit (deliberate proof-first ordering); no rate limit on regeneration retries against a faulting provider (AC6 explicitly states "no ceiling"); an extra `findMany` per suppress/regenerate write (deliberate design, each write independently atomic); a UI/API race between `decide()`'s picked generation and the server's independently-computed "oldest undecided" (already guarded by the existing `reconcileAfterConflict` path); no operator-visible audit of which press performed a suppression (the intent's own `Never` list forecloses a reason/audit column); no test for a rapid true→false→true flip of `ExplainPanel`'s `suppressed` prop (speculative, no concrete failure demonstrated, and the prop is documented and enforced server-side to only ever move one way); and an intent-alignment note that the shipped suppressed-state copy states a reason beyond the intent-contract's literal "exactly two new facts" (resolved: the intent-contract explicitly defers wording to EXPERIENCE.md's "Explanation suppressed by a parent" section, which authors that exact sentence verbatim).

**Verification performed:**
- `pnpm lint` -- clean.
- `pnpm typecheck` -- clean.
- `pnpm vitest run src/app/parent/_components/ExplanationReview.spec.tsx` (apps/web) -- 33 passed. The full `pnpm test` was not run as one invocation because of the pre-existing, already-deferred test-harness flakiness/timeout (see `deferred`); the patch touched no test-pinned string and no test asserted the old copy, so the targeted run is sufficient evidence for this change.
- Migration and `pnpm e2e` were not re-run this pass; no schema, service, or e2e-exercised surface changed.

**Residual risks:** None introduced by this pass. Pre-existing residual risks are unchanged and remain tracked in `deferred` (retake/suppression-scope ambiguity, the integration-test harness's intermittent failures under batching, and the no-refund-on-suppression-of-a-charged-row gap).

