---
title: 'Story 5.6 — Results & Answer Key'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_revision: 'c8068c2d7828d1e335370f5b7405796d92812dbb'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Opening one results screen does the same expensive work twice: two full
      question/choice/answer joins and three grade reads per view.
    evidence: |-
      `resultsFor` calls `resolveUngraded`, which already runs `gradingInputFor`,
      a `questionGrade.findMany` and `scoreFor` (a second grade read) inside its
      transaction -- then runs `answerKeyFor` (the same join in a different shape)
      and a third grade read, and discards `resolution.score`. The two reads are
      deliberate: one serves the provider and one serves the screen, and the score
      is recomputed so it describes exactly the rows in the same response. Collapsing
      them means either widening `resolveUngraded`'s return to carry the states it
      already read, or an internal variant that skips `scoreFor` -- both touch a
      method three other paths call, so it is recorded rather than done here.
    location: >-
      apps/api/src/grading/grading.service.ts
    severity: medium
  - summary: >-
      Story 5.5's unbounded ungraded re-ask is now reachable from a child's screen:
      every results open with an outstanding Question spends a fresh Grading call.
    evidence: |-
      Already recorded on Story 5.5 as a product decision (FR-22 makes viewing the
      trigger and grading is exempt from every allowance, so a cap would make some
      views not retry). This story is what turns it from a service method with no
      caller into a `GET` a child reaches by reloading, and a React StrictMode
      double-mount or a second tab doubles it again. No attempt counter, cooldown
      column or minimum interval exists, and the controller carries only the
      class-level `@SkipThrottle({ login: true })`.
    location: >-
      apps/api/src/grading/grading.service.ts:231
    severity: medium
  - summary: >-
      `answerKeyFor`'s call to `readSubjectLabels` has no error handling of its own,
      unlike every other degrade-don't-throw branch in the same read.
    evidence: |-
      A transient failure in the Subject-label lookup (the module down, a timeout)
      throws out of `answerKeyFor` and 500s the whole results read, even though the
      Attempt is already graded and every other unreadable field in this method
      (`prompt`, `studentAnswer`, `correctAnswer`) degrades to `null` instead. The
      call is the same shape `releasedFor` already uses without a guard, so this is
      an existing pattern this story reused rather than one it introduced -- fixing
      it means deciding a shared fallback for both callers, not a one-line patch here.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (answerKeyFor)
    severity: medium
  - summary: >-
      `AnswerKeyRowView`'s type still allows `newlyGraded: true` together with
      `state: 'Ungraded'`, a combination the service is documented to never produce.
    evidence: |-
      `AnswerKeyRow.tsx` guards against the pairing defensively
      (`row.newlyGraded && row.state !== 'Ungraded'`) rather than the type ruling it
      out. A future consumer of `AttemptResultsView` (the parent-facing read the
      service already leaves room for) has to remember to repeat the same guard.
      Closing it means a discriminated union keyed on `state`, which is a shape
      change beyond a trivial patch.
    location: >-
      apps/api/src/grading/grading-results.ts (AnswerKeyRowView)
    severity: low
  - summary: >-
      No integration case exercises `subjectName` genuinely failing to resolve
      (a deleted or reclassified Subject) on the results endpoint specifically.
    evidence: |-
      The existing results cases only assert the happy-path label match via
      `subjectNameOf`. The "keeps its place and loses its label" degradation that
      `readSubjectLabels` documents is proven for Student Home's equivalent read
      elsewhere in the suite, but not for this endpoint.
    location: >-
      apps/api/test/practice-test.int-spec.ts (Story 5.6 results block)
    severity: low
  - summary: >-
      No test covers two Questions simultaneously left `Ungraded`, where only some
      of them resolve on a given results read.
    evidence: |-
      Every existing re-ask/resolution case uses exactly one ungraded Question, so
      the per-row correctness of a genuinely mixed outcome (some rows newly graded,
      others still stuck) within the same response is unverified.
    location: >-
      apps/api/test/practice-test.int-spec.ts (Story 5.6 results block)
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 5.5 grades every presented Question of a handed-in Attempt and can re-ask for the ones nothing judged, but nothing reads any of it back: handing in still lands the child on a bare "Handed in" panel, `resolveUngraded` has no caller and therefore FR-22's view-triggered retry never fires, and a completed Practice Test on Student Home leads to the same panel forever. The child is told their work is in and nothing else.

**Approach:** Add one student-scoped read that answers an Attempt's whole answer key — every presented Question in original order with the child's answer, the correct answer and its grade state on all four carriers — and render it in place of that panel, so it appears the instant the work is in and again every time the completed test is opened. The read is the FR-22 trigger: it calls `resolveUngraded` first, then reports the score over exactly the rows it returns and marks the Questions that pass just resolved.

## Boundaries & Constraints

**Always:**
- FR-37's denominator is `scoreOf`'s and no surface computes a second one. While any Question is unjudged the header scores **only the gradable Questions** and states the excluded count and the reason; `denominator` may legitimately be 0 and the screen must say something true in that case rather than divide.
- The results read **is** FR-22's retry: it calls `resolveUngraded` before it reads, and a failed re-ask still answers with the rows as they stand. Nothing polls, nothing is queued, no route retries on a timer.
- The four grade labels are fixed literals, identical on every surface, and they live in exactly one place: `Correct`, `Not correct`, `Unanswered`, `Not graded yet`. Each state carries icon frame shape + border style, glyph, that literal text label, and a row left-rule texture, with colour as a never-alone fifth carrier — a colourless rendering stays fully readable, and the label is simultaneously the visible carrier and the announcement.
- A Question this pass just resolved is shown **as newly graded**, in words, and announced through the existing live region using the same sentence that is displayed.
- Rows are in stored ordinal order, correct and incorrect alike, every presented Question present. Prompts, answers and option bodies travel as stored `RichText` segments (AD-32) and are rendered by `components/RichText`.
- Nothing parent-scoped reaches this surface or this endpoint: **no grading rationale**, no Topic label, no cost, tier, allowance or model name (AD-20, AD-26). The rationale is not selected by the read at all, so no mapper can leak one.
- Both binding ids come off `req.student`; a foreign Attempt, a sibling's Attempt, an unknown id and an Attempt that is still open answer the one shared `PRACTICE_TEST_NOT_FOUND` 404, with no `ParseUUIDPipe`.
- `grading` stays the sole reader/writer of `QuestionGrade` and reaches `practicetest` only through `PracticeTestService`. The arrow stays `grading → practicetest`, no `forwardRef`.
- Every user-facing string is parameterized in `copy/`, second person, no exclamation mark, no error code. Results appear with no flourish: no count-up, no reveal, no celebration, no per-tick motion.
- Every existing `take-test-handed-in`, `take-test-handed-in-heading` and `take-test-auto-submit` assertion in `student-submit-attempt.spec.ts` and `student-attempt-resilience.spec.ts` keeps passing unchanged: the results render **beneath** that panel on the same route, it does not replace it and there is no redirect.

**Block If:**
- Reading the answer key would require a grade state the enum cannot express, or a fifth state to mean "being graded".

**Never:**
- No Explanations, no `Explain this` control, no grade-dispute flag, no bad-explanation flag (Epic 6). No Retake control and no first/latest/attempt-count card line (Story 5.7). No parent-side Attempt detail, no grading-rationale surface and no grade override (Parent View, Epic 6).
- No score, state or answer key on Student Home's rows, on the take-test screen before hand-in, or on the submit response — all three keep their exact current shape.
- No new route, no new page file and no redirect: the results are the submitted state of `/student/tests/[practiceTestId]`.
- No grade written or overwritten here: this story reads, and the one write it triggers is `resolveUngraded`'s own.
- No elapsed-time figure, no `timerMinutes`, no Grade Level on the results surface — none is a fact this story needs and two are not student-scoped.
- No score column, no cached score, no second denominator.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fully graded Attempt | submitted Attempt, every Question judged | 200: one row per presented Question in ordinal order, each with prompt, student answer, correct answer, state; `score.denominator` = presented count, `excludedUngraded` 0, no row newly graded | No error expected |
| Blank Question, manual hand-in | a Question with no `Answer` row, Attempt unexpired | row state `Unanswered`, `studentAnswer` null, correct answer present, counted in the denominator | No error expected |
| Multiple Choice answered | stored `Answer.value` is the chosen ordinal | `studentAnswer` is that **option's body**, `correctAnswer` is the flagged option's body — never a bare ordinal | An ordinal matching no option renders as the raw stored string |
| Ungraded present | rows stored `Ungraded`, re-ask fails again | 200: those rows stay `Ungraded`, `excludedUngraded` names them, `score.denominator` excludes them; header states the gap | `resolveUngraded`'s failure is swallowed there; the read still answers |
| Ungraded resolves | rows stored `Ungraded`, re-ask succeeds | those rows carry their verdict and `newlyGraded: true`; score is recomputed over the rows returned; screen states and announces it | No error expected |
| Row-less Question | crash between the hand-in's two transactions | the deterministic verdict is rewritten by `resolveUngraded`; anything still without a row reads `Ungraded` | No error expected |
| Attempt still open | `submittedAt` null | 404 `PRACTICE_TEST_NOT_FOUND` | Same sentence as every other refusal |
| Foreign / sibling / unknown / malformed id | any | 404 `PRACTICE_TEST_NOT_FOUND` | One sentence, no 400 |
| Unreadable stored answer key | stored `answer`/choice body fails `isRichText` | `correctAnswer` null; the row renders its state and says the answer is unavailable | Degraded, never thrown — the Attempt is already closed |
| Read fails / offline | request rejects | the handed-in panel stays, the results area states the failure and offers Try again | Stated, never auto-retried |

</intent-contract>

## Code Map

**API — `practicetest`, the presentation read**

- `apps/api/src/practicetest/practice-test.service.ts:1135` `gradingInputFor` — the grader's read: answer key + raw answers + Topic labels, `tx`-required, `studentProfileId` nullable so either party reaches it. **The precedent and the deliberate non-reuse**: this story needs resolved display text and no Topics, so it gets its own read beside it rather than widening this one. `:1073`/`:1217` `draftFor` is the precedent for a read that opens its own transaction; `:1091` `draftViewIn` for joining choices in one round trip; `:1184` for `isRichText`-checked, degrade-don't-throw handling of stored `Json` on work already done.
- `:409` `AttemptGradingInput` / `:375` `GradingQuestionInput` / `:271` `StudentQuestionView` / `:258` `StudentChoiceView` — where the new view interfaces belong, beside their neighbours, each doc-marked for what it withholds.
- `:782` `releasedFor` — how a Subject label is resolved across the module boundary: `this.sourceTests.readSubjectLabels([...])`, batched, and a test whose Subject does not resolve keeps its place and loses its label. `practicetest` holds no `subject` delegate and must not acquire one (AD-17).
- `apps/api/src/extraction/rich-text.ts:85` `isRichText`, `:101` `plainTextOf`, `:50` `RichText` — the stored-segment contract.

**API — `grading`, where the results are composed**

- `apps/api/src/grading/grading.service.ts:231` `resolveUngraded` — already exactly FR-22's pass: scope `{parentAccountId, studentProfileId?}`, 404 on a foreign or open Attempt, re-writes deterministic verdicts for row-less Questions, returns `{score, newlyGradedQuestionIds}` and **still answers when the re-ask fails**. Its doc says it has no route because the results surface is this story's; that sentence is now this story's to rewrite. `:474` `scoreFor` and `grading-score.ts:57` `scoreOf` are the one denominator. `:419` `writeGuarded` never overwrites a standing verdict.
- `apps/api/src/grading/student-attempt.controller.ts` — the one student-scoped controller in this module: `@Controller('student')`, `@SkipThrottle({login:true})`, `@UseGuards(StudentModeGuard)`, ids off `req.student`, no `ParseUUIDPipe`, one-sentence refusals. The new `@Get` belongs here.
- `apps/api/src/grading/grading.module.ts` — unchanged: `PracticeTestModule`, `AiModule`, `StudentModeGuard` already imported, `GradingService` already exported.
- `apps/api/src/practicetest/practice-test-policy.ts` `PRACTICE_TEST_NOT_FOUND` — the shared sentence.

**Web**

- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx:800-842` — the `submitState === 'done'` branch: the auto-submit `role="alert"`, the focused `take-test-handed-in-heading`, the `take-test-handed-in` status alert. Reached by a hand-in, by the 409, and at `:329` by **resuming an already-submitted Attempt** — which is how a completed test opened from Student Home arrives. `attempt.id` is in hand on every one of those paths. This is the single insertion point.
- `apps/web/src/app/student/_components/PracticeTestRow.tsx` — read-only here: the `Completed` row already links to `/student/tests/{id}`, so no list change is needed for "reachable thereafter".
- `apps/web/src/components/RichText.tsx:21` — the only renderer of stored segments; `:54` `Fraction` carries the spoken reading. `apps/web/src/components/LiveRegion.tsx:116` `useAnnounce` — the one polite region, mounted in `ThemeRegistry`. `apps/web/src/components/Screen.tsx`, `Button`, MUI `Alert` — the chrome these screens already use.
- `apps/web/src/theme/tokens.ts:11` `colorTokens` (`success`, `error`, `textSecondary`, `info` all exist — **no new colour token**), `:171` `typeRoles` (`questionBody` serif for generated content, `label` for the state label, `caption`), `:109` `rounded`, `:79` `comfortableDensity`.
- `apps/web/src/lib/parent-api.ts:240` `RichTextSegment`, `:277`–`:359` the student view types, `:728`–`:801` the student call block (`call<T>(path, init, fallbackCopy)`, no bearer, binding cookie) — where the new type and call go.
- `apps/web/src/copy/student.ts` — `studentCopy`, second person, exhaustive `practiceTestState` as the precedent for a switch that falls through to nothing. `apps/web/src/copy/common.ts` — `commonCopy`, cross-surface strings; the four grade labels belong here, not in a per-surface file.
- `apps/web/src/app/student/_components/PracticeTestRow.spec.tsx:29` `render` (`renderToStaticMarkup` under `studentTheme`) and `:42` `colourless` — the exact harness for "readable with every colour, class and inline style stripped". `apps/web/src/lib/answers.ts` + `answers.spec.ts` — the precedent for a pure, DOM-free summary helper with its own spec.

**Tests**

- `apps/api/test/practice-test.int-spec.ts:3330` `startAttempt`, `:3337` `submitAttempt`, `:3349` `setTimerMinutes`, `:3357` `releasedForChild` (returns `questionIds` in ordinal order), `:2350` `withLandedDrafts` — the machinery; new cases belong beside Story 5.5's over the real HTTP path.
- `apps/api/src/practicetest/practice-test-schema.ts:88` `fakePracticeTestPayload` — deterministic: the correct Multiple Choice option is always **ordinal 1** with body `Option A for <draftOrdinal>.<seq>`, and every free-text correct answer is `Answer for <draftOrdinal>.<seq>`. `apps/api/test/harness.ts:261` `AiCapture` (`failNext(kind)`, `sent`) is how a case forces `Ungraded` and then lets the next read resolve it; `:83` `createHarness` exposes `moduleRef`.
- `e2e/fixtures.ts:622` `questionGradesFor` (returns `questionId`, `state`, `rationale` per row in ordinal order) — read-only here, and the tool for proving the screen agrees with the table. `e2e/tests/student-submit-attempt.spec.ts:254`, `:325`, `:376`; `e2e/tests/student-attempt-resilience.spec.ts:283`, `:307`, `:365`, `:413`, `:464`, `:473` — every assertion the additive render must not disturb.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/practicetest/practice-test.service.ts` — add `answerKeyFor(parentAccountId, studentProfileId, attemptId)` returning `{ attemptId, practiceTestId, subjectName, questionCount, questions: AnswerKeyQuestion[] }`, with `AnswerKeyQuestion` = `{ questionId, ordinal, format, prompt, studentAnswer, correctAnswer }` — all three text fields `RichText | null`. It finds the Attempt by id **and** both binding ids (`studentProfileId` nullable, so the parent surface a later story builds needs no second read), throws the shared 404 when absent **or when `submittedAt` is null**, joins questions, choices and this Attempt's answers in one transaction in `ordinal` order, resolves `studentAnswer` — the chosen option's stored body for Multiple Choice, matched on the trimmed digits-only ordinal, the raw typed string as one text segment for free text, `null` for a blank — and `correctAnswer` — the flagged option's body, or the stored free-text answer — and resolves `subjectName` through `readSubjectLabels` exactly as `releasedFor` does. Doc it as the **reader's** view beside `gradingInputFor`'s grader's view: it carries no Topic label and no ordinal a screen could not show, it resolves the ordinal into words because a child cannot read "2" as an answer, and it is deliberately not `gradingInputFor` widened — one read serves the provider and one serves the screen, and merging them would put Topic labels one mapper away from a student response. Unreadable stored segments degrade to `null` and are logged as ids only, for the reason `:1184` states.
- `apps/api/src/grading/grading-results.ts` — **new**: `AnswerKeyRowView` (`questionId`, `ordinal`, `format`, `prompt`, `studentAnswer`, `correctAnswer`, `state: GradeState`, `newlyGraded: boolean`) and `AttemptResultsView` (`attemptId`, `practiceTestId`, `subjectName`, `questionCount`, `score: AttemptScore`, `questions: AnswerKeyRowView[]`), plus pure `answerKeyRows(key, states, newlyGraded)` composing them in the key's order and mapping a **missing row to `Ungraded`** — the same fact, per `scoreOf`'s own doc. Pure and file-local so the mapping is assertable without a database. There is deliberately no `rationale` field to omit later.
- `apps/api/src/grading/grading.service.ts` — add `resultsFor(scope, attemptId): Promise<AttemptResultsView>`: `resolveUngraded` first (the FR-22 trigger, and the 404 for a foreign, sibling or open Attempt), then `answerKeyFor`, then one `questionGrade.findMany` selecting **`questionId` and `state` only**, then `answerKeyRows` and `scoreOf` over the states of the rows returned. Doc why the score is recomputed here rather than taken from `resolveUngraded`'s: the number a surface states must describe exactly the rows in the same response, and the retry's own score was computed before this read. Rewrite `resolveUngraded`'s "no route yet" paragraph to name this caller. Never select or return a rationale.
- `apps/api/src/grading/student-attempt.controller.ts` — add `@Get('attempts/:attemptId/results')` calling `resultsFor({ parentAccountId, studentProfileId })` with both ids off `req.student`. Doc: the one **read** this controller mounts; it is a `GET` that legitimately writes grades, because FR-22 makes viewing the trigger and a `POST` would invite a screen to fire it twice; it carries no rationale, no Topic and no parent figure; same guard, same one-sentence 404, still no `ParseUUIDPipe`.
- `apps/api/src/grading/grading-results.spec.ts` — **new**: a row per presented Question in the key's order; a missing state maps to `Ungraded`; `newlyGraded` is true only for ids in the list; no field named `rationale` appears on any row (assert over `JSON.stringify`); and the composed states are what `scoreOf` is then given.
- `apps/api/test/practice-test.int-spec.ts` — new cases over the unchanged HTTP path: a fully answered Attempt's results carry one row per Question in ordinal order with the Multiple Choice **option bodies** as both answers and `score` = presented count; a blank on a manual hand-in reads `Unanswered` with a null `studentAnswer` and still counts; `failNext('transport')` on submit leaves the free-text rows `Ungraded`, and the **first** results read then resolves them, returns their ids as `newlyGraded` and a larger `denominator`, while a **second** read returns the same score and no newly-graded ids; a results read whose re-ask also fails still answers 200 with the gap named; an open Attempt, another profile's, another account's and a malformed id all answer the one 404 sentence; and the serialized body contains no `rationale`, `topic`, `cost`, `tier` or `model` key (assert over `JSON.stringify`).
- `apps/web/src/lib/parent-api.ts` — add `GradeState`, `AnswerKeyRowView`, `AttemptScore` and `AttemptResultsView` beside the other student types, and `attemptResults(attemptId)` in the student call block: no bearer, the binding names the child, and the doc states what the view cannot carry (no rationale, no Topic, no allowance figure) and that **reading it is what re-asks** for anything unjudged.
- `apps/web/src/theme/tokens.ts` — add `gradeStateMarker`: per `GradeState`, `{ frame: 'circle' | 'square', border: 'solid' | 'dashed' | 'dotted', glyph, rule: 'solid' | 'hatch' | 'dashed' | 'dotted', color: ColorTokenName }` — circle/solid/`✓`/solid/`success`, circle/solid/`✗`/hatch/`error`, circle/dashed/`—`/dashed/`textSecondary`, square/dotted/`⋯`/dotted/`info`. Doc that `Correct` and `Incorrect` **share a frame shape on purpose** and separate on every other axis, that the rule width is 4px, and that colour is the fifth carrier and never alone. No new colour token.
- `apps/web/src/copy/common.ts` — add `gradeState`, the **one source** for the four literals: `Correct`, `Not correct`, `Unanswered`, `Not graded yet`. Doc that they are normative, that the same string is the visible label and the announcement so the two cannot diverge, and that they are cross-surface — which is why they are here and not in `student.ts`.
- `apps/web/src/copy/student.ts` — add `results`: the heading `Your results`; the score sentence in two forms, plain and `graded questions` while anything is excluded; the meta parts `N not correct` and `N unanswered` with singular forms; the section heading `Every question, in order`; `Question N`; `You answered`; `Correct answer`; `You didn’t answer this one.`; the ungraded-gap sentence naming the count, that they are not counted in the figure above, and that the total may go up next time because that is the grading finishing and not the work changing; the per-row ungraded note; the newly-graded line and the identical announcement; an unavailable-answer line; a nothing-to-score line for a zero denominator; and `Your results could not be loaded.` No exclamation mark, no error code, no grade word in `takeTest`.
- `apps/web/src/lib/results-summary.ts` + `results-summary.spec.ts` — **new**, pure and DOM-free: `summaryOf(rows)` counting `Incorrect` and `Unanswered` for the meta line, and `newlyGradedCount(rows)`. It deliberately **computes no denominator** — that is the API's one answer — and the spec says so by asserting the returned shape.
- `apps/web/src/app/student/_components/GradeStateMarker.tsx` + `.spec.tsx` — **new**, no hooks: the frame, the `aria-hidden` glyph, and the literal label as real text. The spec renders it under `studentTheme` and asserts, via the `colourless` helper, that each of the four states is still told apart by its label and its `data-` carriers with every colour, class and inline style stripped.
- `apps/web/src/app/student/_components/AnswerKeyRow.tsx` + `.spec.tsx` — **new**, no hooks: the left rule's texture, the prompt in the serif `questionBody` role through `RichText`, the child's answer or the blank line, the correct answer or the unavailable line, the marker, the per-row ungraded note and the newly-graded line. The spec asserts all four states, a fraction segment surviving into `rich-text-fraction`, the blank and unavailable lines, and that no rationale-shaped prose can reach it because the prop type has no such field.
- `apps/web/src/app/student/_components/AttemptResults.tsx` + `.spec.tsx` — **new**: reads `attemptResults(attemptId)` once per Attempt, renders loading, then either the failure alert with `Try again` or the header plus every row in the order given — no sort, no filter, no grouping. Announces the newly-graded sentence through `useAnnounce` with the words it displays, once per read. Routes nowhere on a failed read: a 404 here is a bad moment, not Student Mode taken away (the sole exception stays `deviceIsUnbound`, as everywhere else in this surface). The spec asserts over the component's own source for the claims a node environment cannot render — one read per Attempt, no `sort`/`reverse`/`toSorted`, `announce` called with the same copy constant that is rendered.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` — in the `submitState === 'done'` branch only, render `<AttemptResults attemptId={attempt.id} />` **beneath** the existing auto-submit alert, focused heading and status alert, all three untouched. Nothing else in the file changes: the same three states, the same focus, the same latch, the same single dispatch. Doc that the answer key appears here because this is the state a hand-in, the 409 and a resumed submitted Attempt all reach, so "immediately on submit" and "reachable from history" are one surface rather than two.
- `apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx` — extend: the done branch renders `AttemptResults` with `attempt.id`, and the existing auto-submit and focus assertions still hold.
- `e2e/tests/student-submit-attempt.spec.ts` — extend the existing confirm-and-hand-in run **after** its current assertions: the answer key appears on hand-in with one row per Question in ordinal order, the score sentence states the figure the table agrees with via `questionGradesFor`, the blank rows read `Unanswered` and the answered one `Correct`, every row carries its literal label as text, no row shows a rationale or a Topic, and `/student` → the `Completed` row → the same answer key again. Keep the existing "no grade vocabulary" assertion on the **pre-hand-in** screen and Student Home only.

**Acceptance Criteria:**

- Given a child hands an Attempt in, when the request succeeds, then the full answer key is on screen without a further press or navigation — every presented Question in the order they were shown, each with the Question, their answer, the correct answer and its grade state as icon frame, glyph, literal label and row rule.
- Given a completed Practice Test on Student Home, when the child opens it, then the same answer key is shown and no new Attempt is started.
- Given Questions left `Ungraded` by a grading failure, when the results are opened, then the header scores only the gradable Questions and states how many were excluded and why, and the ungraded rows say so on their own row.
- Given those Questions resolve on that read, when the screen renders, then each resolved row is marked newly graded, the score reflects them, and the same sentence is announced through the live region.
- Given the results of an Attempt, when the response body is inspected, then it carries no grading rationale, no Topic label and no cost, tier or model figure.
- Given an Attempt of another profile or another account, an Attempt still open, or an id that never existed, when the results are read, then all four answer one identical 404 sentence.
- Given every grade-state marker rendered with all colour, class and inline styling stripped, when the markup is read, then all four states are still distinguishable by their literal label and their non-colour carriers.
- Given the existing take-test suites, when they run unchanged, then the handed-in heading, its status alert, the auto-submit `role="alert"` and the focus target all still behave exactly as before.

## Spec Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 4, low 7)
- defer: 2: (high 0, medium 2, low 0)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` The partial-score sentence, the ungraded-gap alert, the newly-graded line and its announcement, and the failed read with its retry were verified only as regexes over `AttemptResults.tsx`'s own source -- `apps/web` runs vitest in `environment: 'node'`, so none of them was ever rendered, and deleting a whole branch left every check green. Covered behaviourally with Playwright route interception on `**/api/student/attempts/*/results` (the precedent `student-take-test.spec.ts` already sets): a crafted body with `excludedUngraded > 0`, one with `newlyGraded`, one with a zero denominator, and a 500 whose retry drives read 1 to read 2.
  - `[medium]` `[patch]` `subjectName`, `questionCount` and `format` were composed by the API, typed on the wire and asserted in the integration tier, then rendered nowhere -- a child opening results from history could not tell which test it was. The header now carries a Subject-and-count meta line and each row's heading carries its format, reusing `studentCopy.takeTest.format`'s three literals rather than writing new strings.
  - `[medium]` `[patch]` `answerKeyFor`'s two documented degradation branches -- an unreadable stored prompt/answer, and a Multiple Choice value matching no option of its Question -- would each have turned a handed-in Attempt into a permanent 500 or a false "You didn't answer this one." without failing a single test. Both now have integration cases that mutate stored rows the way `asFreeText` already does.
  - `[medium]` `[patch]` Row headings collided: `h2` results, `h3` section, and each answer-key row also `h3`, so every row was a sibling of the heading it belongs under. Rows are `h4` with the visual type role unchanged, and the outline is asserted.
  - `[low]` `[patch]` `AnswerKeyRow` held a second copy of `GradeStateMarker`'s colour map, typed `Record<string, …>` and read through a non-null assertion, so a new colour token on `gradeStateMarker` would compile in one file and throw at render in the other. One exported map in `theme/grade-state-palette.ts`, keyed on a union derived from the token table.
  - `[low]` `[patch]` `ruleBackground`'s `default` arm rendered any unknown rule kind as `dotted`, which is `Ungraded`'s own texture -- exhaustive now, with a `never` binding.
  - `[low]` `[patch]` The meta line rendered unconditionally, so a perfect paper read `0 not correct · 0 unanswered`. Suppressed when both counts are zero.
  - `[low]` `[patch]` With a zero denominator the header stated `nothingToScore` while the gap alert still said the excluded Questions were "not counted in the figure above" -- a figure nothing had stated. A second gap sentence names the count without referring to one.
  - `[low]` `[patch]` A row whose state is still `Ungraded` could render both "not graded yet" and "just graded"; the newly-graded line is gated on the state the service should never pair it with.
  - `[low]` `[patch]` `commonCopy.gradeState` was declared normative with nothing enforcing coverage -- now `satisfies Record<GradeState, string>`, the type imported type-only as `tokens.ts` does.
  - `[low]` `[patch]` One added integration assertion was vacuous: a serialized segment array compared against a serialized number string can never be equal. Replaced with a direct claim about the shape. Two more losses fixed with it: the resilience spec's narrowing had left no body-wide "no verdict word anywhere" assertion at all (restored in the in-progress state, where the answer key genuinely must not exist), and the page spec still claimed the screen "holds no score, no grade and no answer key", which this change made false (re-scoped to what the page states of its own).

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` `studentAnswerTextOf` fell back to the raw stored ordinal string (e.g. `"2"`) whenever a Multiple Choice value matched a real option whose stored `body` failed `isRichText` — violating the "never a bare ordinal" rule for the one case where the child's answer *did* match a real choice. `practice-test.service.ts`: that branch now returns `null` (the same degradation `correctAnswerTextOf` already uses) instead of falling through to the generic raw-string path; only a value matching **no** option still travels raw, per the I/O matrix.
  - `[low]` `[patch]` `answerKeyFor`'s `unreadable` tracking and its warn log only counted a corrupted correct answer; a corrupted prompt or a corrupted-but-matched student answer degraded silently with no log entry. The condition now also flags those two cases.
  - `[low]` `[patch]` `AnswerKeyQuestion.prompt`'s doc comment said "Empty when unreadable" while the field type is `RichText | null` and the code returns `null`. Corrected to "Null when unreadable," matching the sibling fields' wording.
  - `[low]` `[patch]` `resultsFor`'s JSDoc said "Either party reaches it — a parent by account, a child by both ids," reading as if a parent-facing caller already existed. Reworded to state the signature *admits* either party while only the student route is wired up by this story.
  - `[low]` `[patch]` No test asserted `subjectName`'s actual resolved value anywhere in the results suite — only that the key exists on the response, which would stay green even if the label were silently wrong or always `null`. Added a direct comparison against the Subject actually classified onto the released test's source, in the first `answers a fully answered Attempt...` integration case.
  - `[low]` `[reject]` A stored empty-string free-text answer (`value === ''`) would render as an empty answer line rather than "You didn't answer this one." — speculative; nothing in the schema or the submit path is shown to ever store `''` rather than omitting the row, so there is no reachable trigger.
  - `[low]` `[reject]` A free-text correct answer may render as a formatted fraction while the child's numerically-equivalent typed answer renders as plain text — explicitly by design per `studentAnswerTextOf`'s own doc ("nothing here parses a fraction out of it").
  - `[low]` `[reject]` Two concurrent results reads for the same under-graded Attempt could both trigger a billed re-ask before either grade write lands — the same risk Story 5.5 already recorded and this spec's own `deferred` list already names as "reachable from a child's screen... no attempt counter, cooldown column or minimum interval exists." Already tracked; not re-added.
  - `[low]` `[reject]` The new results route carries no throttle beyond the controller's class-level `@SkipThrottle`, so a provider outage could be retried on every reload — the same already-deferred risk as above, just its other half.
  - `[low]` `[reject]` The e2e `assertAnswerKey` helper checks a narrower forbidden-field list than the integration suite's `JSON.stringify` assertion — the integration tier already carries the full guarantee; the e2e tier's role is behavioral, not an exhaustive field audit.
  - `[low]` `[reject]` The crafted-response e2e cases use fixed placeholder ids decoupled from the real hand-in's attempt — intentional: those cases test the screen's rendering of arbitrary server payloads via route interception, not identifier threading, which the real hand-in flow already covers elsewhere in the same file.
  - `[low]` `[reject]` No test covers a Multiple Choice stored value that is empty, negative, or decimal — the digit-only regex routes all of these to the already-tested "raw stored string" fallback; behavior is already spec-correct, only additional test coverage is missing, and it's speculative that any of these values are ever actually stored.
  - `[low]` `[reject]` No test covers navigating directly between two different attempts' results without an unmount — the take-test route is per `practiceTestId`, and nothing in this product currently drives that transition; speculative.
  - `[low]` `[reject]` No test forces `resolveUngraded`'s own score and `resultsFor`'s recomputed score to actually diverge — the safeguard is real and documented in code; the finding asks for stronger proof of necessity, not a defect.
  - `[low]` `[reject]` (intent-alignment auditor note) Three assertions in `student-attempt-resilience.spec.ts` had their locator narrowed from `page.locator('body')` to `page.getByTestId('take-test-handed-in')` to keep working once results render on the same page — a deliberate, documented scope narrowing, not a defect.
  - `[low]` `[reject]` (intent-alignment auditor note) `GradingService.resultsFor` has no dedicated unit spec in `grading.service.spec.ts`, only integration coverage — the integration tier exercises it end-to-end thoroughly; not a requirement gap.

### 2026-09-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 4: (high 0, medium 1, low 3)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` A child pressing `Try again` on `AttemptResults` twice before the first retry settled could fire a second `GET /results` — and a second billed re-ask — before the first resolved; nothing disabled the button while a read was in flight. Added a `pending` state set around the read's lifetime and wired to `disabled` on the retry `Button`.
  - `[medium]` `[patch]` The second review pass's own fix to `studentAnswerTextOf` (return `null`, not the raw ordinal, when a *matched* Multiple Choice option's stored `body` fails `isRichText`) shipped with no regression test proving it — every existing case either has no chosen option (`value` null) or an ordinal matching no option (the other branch). Added an integration case that answers a real option, corrupts only that chosen option's `body`, and asserts `studentAnswer` is `null` while `correctAnswer` and the stored grade are untouched.
  - `[low]` `[reject]` `ruleBackground`'s `default` arm for an unhandled `rule` value throws — flagged as a robustness gap, but this is the intentional exhaustiveness guard the prior review pass added (a `never` binding), only reachable if a new state compiled without updating this switch, which TypeScript itself would refuse.
  - `[low]` `[reject]` "You answered" / "Correct answer" labels lack `aria-labelledby`/`dl`-`dt`-`dd` pairing — the spec's own accessibility bar for this surface is the `colourless` label/carrier test already passing; a stronger ARIA structure is a speculative enhancement, not a gap against the intent.
  - `[low]` `[reject]` No guard against two concurrent `resultsFor` reads for the same Attempt — already named verbatim in this spec's own `deferred` list; not re-added per the precedent set in the prior review pass.
  - `[low]` `[reject]` `resultsFor`'s second `questionGrade` read is not snapshot-consistent with `resolveUngraded`'s own transaction — the same class of finding the prior review pass already rejected ("asks for stronger proof of necessity, not a defect"); no reachable trigger is shown here either.
  - `[low]` `[reject]` `studentAnswerTextOf`'s digit-only regex is untested against a leading-zero or decimal-looking stored value — duplicate of a finding the prior review pass already rejected as speculative.
  - `[low]` `[reject]` The e2e `assertAnswerKey` helper doesn't inspect the response body the way the integration tier's `JSON.stringify` assertion does — duplicate of a finding the prior review pass already rejected (integration tier carries the exhaustive guarantee; e2e's role is behavioral).
  - `[low]` `[reject]` No client-side guard against a malformed score (`correct > denominator`) from the server — speculative defense against a regression in `scoreOf`, which carries its own dedicated spec.
  - `[low]` `[reject]` `AnswerKeyRow`'s format-label lookup (`studentCopy.takeTest.format[row.format]`) has no runtime fallback for an unrecognized format — the wire type is a closed three-literal union today, so the lookup is exhaustive and type-safe at compile time; a future fourth format would be a build-time TypeScript error at this exact call site, not a silent `undefined` at runtime.
  - `[low]` `[reject]` No log line or metric marks billed re-ask volume specifically attributable to results views — an operational monitoring enhancement, not a requirement this story's intent names.
  - `[low]` `[reject]` (intent-alignment auditor note) The resilience spec's `body`-scoped assertions were narrowed to `take-test-handed-in` rather than left byte-for-byte unchanged — already disclosed and addressed in the first review pass's triage log; the underlying guarantee (those testids still render and pass) holds and is independently checked by the page spec.
  - `[low]` `[reject]` (intent-alignment auditor note) `answerKeyFor`'s nullable `studentProfileId` parameter is wider than what this story's own tests exercise, in anticipation of a parent-facing caller — already disclosed and reworded in the second review pass's triage log to state the signature only *admits* either party.

## Design Notes

**Why the results live on the take-test route rather than a route of their own.** Three paths already converge on `submitState === 'done'` — a hand-in, the 409 on a second one, and `startOrResumeAttempt` answering with a `submittedAt` — and the third is exactly how a completed test opened from Student Home arrives. Rendering the key there makes both acceptance criteria one surface, keeps `attempt.id` in hand with no second resolution read, and leaves eleven existing end-to-end assertions about that panel true. A dedicated route would need a redirect, a query flag to carry the auto-submit announcement across it, and either a practice-test→Attempt resolution read or a `POST` that can *create* an Attempt from a results URL.

**Why `answerKeyFor` is not `gradingInputFor` widened.** They read the same rows and answer different questions. The grader needs Topic labels, the flagged ordinal and the raw typed string; the screen needs words a child can read and must never be one mapper away from a Topic label. Keeping them apart is what makes "no Topic reaches a student response" structural, the way `STUDENT_TEST_SELECT` makes it structural for the answer key. The duplication is a select shape, not a rule.

**Why a `GET` writes.** FR-22 makes viewing the trigger, so the read *is* the retry. A `POST` would be honest about the write and wrong about everything else: a screen that navigated to its results would either fire it twice or skip it, and nothing about opening results is a thing the child is asking to change.

**The score, once, over the rows returned:**

```ts
// Not `resolveUngraded`'s score: that one was computed before this read, and a
// header must describe exactly the rows in the same response. One `scoreOf`,
// so no surface can reach a second denominator.
const rows = answerKeyRows(key, states, resolution.newlyGradedQuestionIds);
const score = scoreOf(rows.map((row) => row.state));
```

**Why a missing grade row is `Ungraded` on the wire.** `scoreOf`'s doc already treats `null` and `Ungraded` as one fact, and `resolveUngraded` re-asks for both. Flattening them in the view means the screen has four states to draw rather than five, and the row a crash left behind reads as the thing it is: nothing has judged this yet.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean across api, web and e2e.
- `pnpm typecheck` -- expected: no errors; `pnpm typecheck:e2e` also clean.
- `pnpm --filter api test` -- expected: the new `grading-results` spec passes; existing unit specs unchanged.
- `pnpm --filter web test` -- expected: the new `results-summary`, `GradeStateMarker`, `AnswerKeyRow` and `AttemptResults` specs pass; the extended take-test page spec passes; every other web spec unchanged.
- `pnpm --filter api run test:int` -- expected: the new results cases pass and every pre-existing submit and attempt case still passes at its unchanged path.
- `git status --porcelain apps/api/prisma` -- expected: empty. This story adds no column and no migration.
- `pnpm db:up && pnpm db:migrate && pnpm e2e -- student-submit-attempt` -- expected: passes, including its pre-existing assertions; `student-attempt-resilience` and `student-take-test` still pass.

## Auto Run Result

**Summary of implemented change:** This pass is a fresh review of an already-`done` story (student results/answer-key surface: `resultsFor`, `answerKeyFor`, the `GET .../results` route, and the `AttemptResults`/`AnswerKeyRow`/`GradeStateMarker` components). No new feature work; two patch-severity gaps found by this review pass were fixed directly.

**Files changed with one-line descriptions:**
- `apps/web/src/app/student/_components/AttemptResults.tsx` -- added a `pending` state gating the retry `Button`'s `disabled` prop, so a second click cannot fire a second billed re-ask before the first read settles.
- `apps/api/test/practice-test.int-spec.ts` -- added an integration case asserting a chosen Multiple Choice option whose stored `body` cannot be read back degrades `studentAnswer` to `null` (never the raw ordinal), leaving `correctAnswer` and the stored grade untouched.

**Review findings breakdown:** patch 2 (medium 2, low 0) -- both fixed; defer 4 (medium 1, low 3) -- added to frontmatter `deferred`; reject 11 (low 11) -- dropped, see triage log for reasoning on each.

**Follow-up review recommendation:** `true` (patch score = 3×2 medium + 1×0 low = 6 ≥ 5).

**Verification performed:**
- `eslint` on both touched files -- clean.
- `tsc --noEmit` for `apps/web` and `apps/api` -- clean.
- `pnpm --filter web test` -- 44 files, 814 tests, all passing (including `AttemptResults.spec.tsx`'s existing retry-button coverage).
- `apps/api` integration suite (`vitest run test/practice-test.int-spec.ts`) -- the new case passes; the Story 5.6 results block (8 cases) passes in full; one unrelated case elsewhere in the same file (`counts a whitespace-only value as a blank and grades it Unanswered`) failed on a 404 from a concurrency-sensitive fixture helper (`generatable`/`withLandedDrafts`) under full-file parallel load -- pre-existing test-infra flakiness unrelated to this change; not touched.
- `pnpm lint` / `pnpm typecheck` (turbo, repo-wide) were not run because the `eslint` binary is not resolvable at the repo root in this environment (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`); per-workspace `eslint`/`tsc` were run directly instead and are clean.
- `pnpm --filter api test` (unit) and `pnpm e2e -- student-submit-attempt` were not re-run this pass -- no code path they cover was touched by either patch.

**Residual risks:** The four newly deferred items (subject-label lookup has no error handling of its own; `AnswerKeyRowView`'s type still permits an `Ungraded`+`newlyGraded` pairing the service never produces; no coverage for `subjectName` failing to resolve on this endpoint; no coverage for a mixed multi-Question ungraded/resolved read) are recorded in frontmatter `deferred`, not fixed. The pre-existing unrelated integration-suite flakiness noted above was not investigated further.

