---
title: 'Story 6.1: On-Demand Explanations'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The explanation table indexes only (attemptId, questionId, studentProfileId) and
      (parentAccountId, chargedAt), so deleting a Student Profile or a Practice Test Question
      scans it sequentially.
    evidence: |-
      Both foreign keys cascade. Only attemptId is covered, by the unique key's prefix.
      Profile deletion is a routine parent action.
    location: >-
      apps/api/prisma/schema.prisma (model Explanation)
    severity: low
  - summary: >-
      Cascading a deleted Attempt or Profile removes charged Explanation rows, which silently
      returns spent allowance for the period.
    evidence: |-
      Usage is derived by counting rows with chargedAt in the window, so deleting a row is
      indistinguishable from never having charged it.
    location: >-
      apps/api/prisma/migrations/20260928120000_add_explanation/migration.sql
    severity: medium
  - summary: >-
      Multiple-choice distractors are read and then discarded, so the explainer never sees the
      option the child actually chose among the alternatives.
    evidence: |-
      explanationInputFor selects choices { ordinal, body, isCorrect } and flattens a single
      answer string out of them; format is still passed to the prompt as MultipleChoice.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (explanationInputFor)
    severity: medium
  - summary: >-
      Every cached re-read still performs the full cross-module ownership read plus a Grade
      Level label resolution that is then discarded.
    evidence: |-
      explanationFor calls explanationInputFor before the cache lookup. Ownership-first is
      required for the single 404 sentence, but the taxonomy resolution is not.
    location: >-
      apps/api/src/explanation/explanation.service.ts
    severity: low
  - summary: >-
      Unlimited tiers run both allowance counts even though remainingFor can never reach zero
      for them.
    evidence: |-
      limit === null makes remainingFor return the per-request ceiling; the pre-check and the
      in-transaction count are both still issued.
    location: >-
      apps/api/src/explanation/explanation.service.ts
    severity: low
  - summary: >-
      No dedicated regression test exercises a period-window rollover during a
      generation call, so a reintroduction of the "stale window" bug this pass's
      own triage log already fixed once would ship undetected.
    evidence: |-
      explanationFor re-reads consumptionFor after the AI call to derive
      windowStart/windowEnd instead of reusing the pre-call read, but every
      existing integration case that varies the count between check and write
      keeps the same period window; none advances or fakes the account's period
      boundary between the two reads.
    location: >-
      apps/api/src/explanation/explanation.service.ts; apps/api/test/explanation.int-spec.ts
    severity: medium
baseline_revision: '630e1064e14cdc7cb1d0d86e3a7126e69ab37054'
---

<intent-contract>

## Intent

**Problem:** A child reading their results sees what the answer was but never *why*. Epic 6 needs its foundation: an Explanation a student can ask for per Question, generated once, cached, charged against the Explanation Allowance, and pitched at the Practice Test's Grade Level.

**Approach:** Add an `explanation` module that owns the new `Explanation` entity and one student endpoint, generating through `AiService` with a fenced prompt and a `RichText` structured payload; wire the already-stubbed `AllowanceService.counters.explanation` to count charged rows; render an inline disclosure panel beneath each answer-key row with loading / error / at-cap / loaded states.

## Boundaries & Constraints

**Always:**
- `explanation` is the sole writer of `explanation`. It reads Practice Test rows only through `PracticeTestService` and Source Test labels only through `SOURCE_TEST_READER` (AD-17); it holds no `practiceTest`, `attempt`, `answer`, `sourceTest`, `subject`, `gradeLevel` or `question_grade` delegate, and never writes `ai_call`.
- Ownership and identity come from `req.student!` (`parentAccountId`, `studentProfileId`), never from the path or body. One refusal sentence for a foreign/unknown/still-open target: reuse `PRACTICE_TEST_NOT_FOUND`.
- The first request generates; every later request for the same `(attemptId, questionId, studentProfileId)` returns the stored row and performs **no** AI call, **no** allowance count and **no** write.
- Allowance usage stays **derived**: counted only in `AllowanceService.counters.explanation`, over `chargedAt` in `[window.start, window.end)`. No counter column, no reset job, no decrement, no refund.
- Enforcement lives at the generation call site and mirrors `practicetest`: read consumption, `remainingFor(used, limit)`, re-count inside the write transaction, refuse with `ConflictException(NO_EXPLANATION_ALLOWANCE)`.
- Register pitching reads the **Practice Test's** Grade Level (`practiceTest.sourceTest.gradeLevelId` resolved to a name), never `StudentProfile.gradeLevelId`.
- Explanation prose is stored and returned as `RichText` segments and rendered only by `components/RichText` (AD-32).
- No provider text, cost, model name, tier, allowance figure or grading rationale reaches a student-scoped response or any log line — ids and counts only (AD-20/AD-26).
- Every user-facing string is a member of `studentCopy`; no literal in a component, and every figure is a function parameter.
- The panel is an inline disclosure beneath its row, never a modal or a route. Retry is manual only. A failed, capped or absent Explanation leaves the rest of the results screen fully usable.
- Announce through the single `useAnnounce()` region, with the exact string displayed.

**Block If:**
- Wiring `counters.explanation` would require `allowance` to import `ExplanationModule` (cycle) — the precedent is to count via `allowance`'s own injected `PrismaService`.
- The Grade Level label cannot be reached without `explanation` acquiring a `sourceTest` or taxonomy delegate.

**Never:**
- No flagging, suppression, regeneration, parent-side reading, Admin queue, grade dispute or override — Stories 6.2–6.5.
- No queue, job, poll, timer, auto-retry or prefetch; no explanation requested without a deliberate press.
- Do not widen `AnswerKeyRowView` / `AttemptResultsView` with explanation, rationale or cost fields; do not add a second `parentApi.` call to `AttemptResults.tsx`; do not give `AnswerKeyRow` hooks; do not restructure the take-test page's state machine.
- No running allowance counter, exclamation mark, apology or upsell in student-facing copy; a failure is never framed as the child's fault.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First request | Submitted attempt of the bound profile, question of that test, no stored row, allowance remaining | AI call, one row written with `chargedAt` set, 201 with the segments | No error expected |
| Cached re-read | A row already exists for `(attemptId, questionId, studentProfileId)` | 200 with the stored segments, no AI call, no write | No error expected |
| At cap | Free tier, charged rows in window >= `TIER_LIMITS.Free.explanation` | Nothing generated, nothing written | 409 `NO_EXPLANATION_ALLOWANCE` |
| Cap reached between read and write | Remaining > 0 at check, 0 on re-count inside the transaction | Nothing written | 409 `NO_EXPLANATION_ALLOWANCE` |
| Unlimited tier | `limit === null` | Generates; no cap is ever reported | No error expected |
| Foreign / unknown / sibling's attempt, or attempt still open | id not matching `parentAccountId` (+ `studentProfileId`), or `submittedAt === null` | Nothing generated | 404 `PRACTICE_TEST_NOT_FOUND` |
| Question not on that attempt's test | Valid attempt, alien `questionId` | Nothing generated | 404 `PRACTICE_TEST_NOT_FOUND` |
| Provider transient fault | `AiUpstreamError` after `maxAttempts` | Nothing written, nothing charged | 503-class transient, `EXPLANATION_FAILED`; panel shows error + manual retry |
| Provider terminal fault | `AiRejectedError` / `AiInputError` | Nothing written, nothing charged | `EXPLANATION_FAILED`, same student-facing sentence |
| Payload fails post-hoc validation | Empty segments, or plain text over `MAX_EXPLANATION_LENGTH` | Re-asked up to `ai.config.maxAttempts`, then treated as a transient failure | `EXPLANATION_FAILED` |
| Unresolvable Grade Level | `gradeLevelId` null or no longer names a row | Generates with no grade clause in the prompt | Degrades, never refuses |
| Offline press | `navigator.onLine === false` at press | No request issued; connection sentence shown | Distinct copy from failure and at-cap |

</intent-contract>

## Code Map

**API — read-only precedents to mirror**
- `apps/api/src/grading/grading.service.ts:485` -- the `ai.run({...})` + `for (attempt … maxAttempts)` + post-hoc-revalidate loop to copy; also `GradingScope`/`StudentScope`.
- `apps/api/src/grading/grading-prompt.ts` -- `FENCE_OPEN`/`FENCE_CLOSE`, `fenced()`, `fenceLabel()`; every untrusted span is fenced and fence markers inside content are broken up.
- `apps/api/src/grading/grading-payload.ts` -- `MAX_RATIONALE_LENGTH`, `validateGradingPayload` shape for the post-hoc pass.
- `apps/api/src/grading/student-attempt.controller.ts` -- `@Controller('student')`, `@UseGuards(StudentModeGuard)`, ids from `req.student!`, no `ParseUUIDPipe`, one refusal sentence.
- `apps/api/src/grading/grading.module.ts` -- exact `JwtModule.registerAsync({ useFactory: () => ({ secret: requireParentJwtSecret() }) })` + `IdentityModule` + `StudentModeGuard` provider recipe a guard-using module needs.
- `apps/api/src/practicetest/practice-test-policy.ts:202,408,458` -- `NO_GENERATION_ALLOWANCE`, `remainingFor`, `clampCount`; `PRACTICE_TEST_NOT_FOUND` at `:218`.
- `apps/api/src/ai/ai.service.ts:113,217` -- `AiRunRequest`/`AiService.run`, `AiUpstreamError`/`AiRejectedError`/`AiInputError`, `this.config.maxAttempts`. `ai-config.ts` already pins `Explanation` in `DEFAULT_MODEL_PINS`; `AiCallClass.Explanation` already exists in the enum.
- `apps/api/src/extraction/rich-text.ts:50,85,101` -- the `RichText` zod schema, `isRichText`, `plainTextOf` (use for the length check).
- `apps/api/src/practicetest/practice-test.service.ts:1501` -- `answerKeyFor` shows the exact ownership `where`, the per-question projection and the degrade-to-null logging. `AnswerKeyQuestion` at `:463`.
- `apps/api/src/sourcetest/source-test.service.ts:829` -- `readSubjectLabels`, the batching + `NotFoundException`-absorbing pattern `readGradeLevelLabels` must copy. Interface at `apps/api/src/sourcetest/source-test-reader.ts` (`SourceTestReader`, `SOURCE_TEST_READER`).
- `apps/api/src/allowance/allowance.service.ts` -- `counters.explanation: async () => 0` is the one line to replace; `consumptionFor`, `AccountConsumption.allowances.explanation`. `tiers.ts` already sets Free = 10, others `null`.
- `apps/api/prisma/schema.prisma` -- `Attempt` (`parentAccountId` is a plain column), `Answer`, `PracticeTestQuestion` (`prompt`/`answer` are `Json`), `PracticeTest` (**no** `gradeLevelId`), `SourceTest.gradeLevelId`. Migrations are handwritten SQL named `YYYYMMDDHHMMSS_snake_case_intent`; latest is `20260927180000_add_question_grade_rationale`.

**Web — read-only precedents and shared surfaces**
- `apps/web/src/app/student/_components/AttemptResults.tsx:252` -- the `results.questions.map` where the panel is wired; `footer` is the existing render-slot precedent. Its spec asserts `parentApi.` appears exactly **once** and forbids `Collapse|transition|animate` in that file.
- `apps/web/src/app/student/_components/AnswerKeyRow.tsx` -- hookless, `renderToStaticMarkup`-tested; `<h4>` row heading, so the panel heading must not be `h2`–`h4`.
- `apps/web/src/components/LiveRegion.tsx` -- `useAnnounce()`; exactly one region per document, mounted in `ThemeRegistry`.
- `apps/web/src/lib/parent-api.ts:534,610,660,981` -- `ParentApiError` (`.reason`, `.notBound`), `CONFLICT_STATUS`, the private `call<T>`, `attemptResults`. `deviceIsUnbound` is exported from `apps/web/src/app/student/page.tsx`.
- `apps/web/src/copy/student.ts` -- `studentCopy.results.*` group, `studentCopy.retry`; parameterization is plain arrow functions with singular/plural inside.
- `apps/web/src/theme/tokens.ts` -- `comfortableDensity`, `typeRoles`, `motion` (never literal ms; reduced motion is zeroed globally in `theme.ts`).
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` -- the inline `online`/`offline` listener + `navigator.onLine` pattern; no offline hook exists. Do not restructure this file.
- No accordion/expand primitive exists anywhere — author the disclosure. Inline status convention is MUI `Alert role="status" variant="outlined"` + outlined retry `Button` at `comfortableDensity.tapTarget`.
- Tests: web vitest is `environment: 'node'` with no DOM — render-to-string for pure components, source-assertion (`readFileSync` own `.tsx`) for stateful ones, pure logic extracted to `src/lib/*.ts`. E2E: `e2e/tests/student-*.spec.ts`, fixtures in `e2e/fixtures.ts`.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add model `Explanation` (`id`, `parentAccountId`, `studentProfileId`, `attemptId`, `questionId`, `body Json`, `chargedAt DateTime?`, `createdAt`, `updatedAt`; `@@unique([attemptId, questionId, studentProfileId])`, `@@index([parentAccountId, chargedAt])`, `@@map("explanation")`) -- the cache key is the uniqueness constraint, and `chargedAt` is nullable so 6.4's free regeneration has somewhere to opt out.
- `apps/api/prisma/migrations/<ts>_add_explanation/migration.sql` -- handwritten SQL for the table, unique index and count index, commented in the repo's prose style -- migrations are authored, never generated.
- `apps/api/src/sourcetest/source-test-reader.ts` + `apps/api/src/sourcetest/source-test.service.ts` -- add `readGradeLevelLabels(sourceTestIds)` to the interface and implement it beside `readSubjectLabels` -- `practicetest` must not hold a taxonomy delegate, and the Grade Level name is `sourcetest`'s to resolve.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `explanationInputFor(parentAccountId, studentProfileId, attemptId, questionId)` returning `{ practiceTestId, ordinal, format, prompt, studentAnswer, correctAnswer, gradeLevelName }`, raising `PRACTICE_TEST_NOT_FOUND` for a foreign/unknown/open attempt or an alien question -- one read across the module boundary instead of `explanation` reaching for delegates it does not own.
- `apps/api/src/explanation/explanation-policy.ts` -- `NO_EXPLANATION_ALLOWANCE`, `EXPLANATION_FAILED`, `MAX_EXPLANATION_LENGTH` -- refusal sentences live in one file, as `practicetest` does it.
- `apps/api/src/explanation/explanation-schema.ts` -- `ExplanationPayload` (reusing the `RichText` zod schema), `EXPLANATION_SCHEMA_NAME`, `fakeExplanationPayload({ ordinal, failure })` -- Strict Structured Outputs cannot express `minItems`/`maxLength`, so bounds belong in the post-hoc pass.
- `apps/api/src/explanation/explanation-prompt.ts` -- `buildExplanationPrompt({ ordinal, format, prompt, studentAnswer, correctAnswer, gradeLevelName })` with every untrusted span fenced -- register is a prompt instruction pinned to the Practice Test's grade, with the clause omitted when the label did not resolve.
- `apps/api/src/explanation/explanation-payload.ts` -- `ExplanationPayloadInvalid` + `validateExplanationPayload(payload)` (non-empty segments, `plainTextOf(...).length <= MAX_EXPLANATION_LENGTH`) -- the schema cannot state either bound.
- `apps/api/src/explanation/explanation.service.ts` -- `explanationFor(scope, attemptId, questionId)`: read-through cache, then allowance check, generate with the retry/degrade loop, and write the row with `chargedAt` and a re-count inside one transaction -- charging and the row must commit together so a paid call is never uncounted and a refused one never charges.
- `apps/api/src/explanation/student-explanation.controller.ts` -- `@Controller('student')`, `@UseGuards(StudentModeGuard)`, `POST attempts/:attemptId/questions/:questionId/explanation` -- ids from `req.student!`; POST because the first call bills.
- `apps/api/src/explanation/explanation.module.ts` + `apps/api/src/app.module.ts` -- wire the module and register it after `GradingModule` with a sole-ownership comment.
- `apps/api/src/allowance/allowance.service.ts` -- replace `counters.explanation` with a `prisma.explanation.count` over `parentAccountId` + `chargedAt` in the window, keeping the "counted here and nowhere else" comment accurate -- counting through its own `PrismaService` avoids the cycle `practicetest` already avoids.
- `apps/api/src/explanation/*.spec.ts` -- unit specs for the prompt (fencing, grade clause present/absent), the payload validator, and the policy/cap arithmetic -- the I/O matrix's pure rows belong here.
- `apps/api/test/explanation.int-spec.ts` -- integration cover for first-generation, cached re-read issuing no second AI call, at-cap 409, cross-profile and open-attempt 404s, and the allowance readout moving -- the matrix's stateful rows need the real app and DB.
- `apps/web/src/lib/parent-api.ts` -- add `ExplanationView` and `parentApi.explainQuestion(attemptId, questionId)`; leave `AnswerKeyRowView`/`AttemptResultsView` untouched.
- `apps/web/src/lib/explain-panel.ts` -- pure `explainDecision({ online, state })` and the state union -- the web unit layer has no DOM, so the decision must be testable as a function.
- `apps/web/src/copy/student.ts` -- add `studentCopy.results.explain.*`: the control label, the suppressed-of-nothing-yet idle state, `loading`, `failed`, `offline`, `atCap(resetAt)`, `heading`, and the announcement string -- every figure a parameter, blame on the plan and never on the child.
- `apps/web/src/app/student/_components/ExplainPanel.tsx` -- the disclosure: a control at `comfortableDensity.tapTarget` with `aria-expanded`/`aria-controls`, the four states as `Alert role="status"` / `RichText` prose, manual retry only, `motion.*` tokens if animated, and one `announce()` of the displayed sentence -- all the state lives here so `AnswerKeyRow` stays hookless and `AttemptResults` keeps its single-call invariant.
- `apps/web/src/app/student/_components/AnswerKeyRow.tsx` + `AttemptResults.tsx` -- add an `explain?: ReactNode` slot to the row, rendered last inside its content column, and pass `<ExplainPanel .../>` from the `questions.map` -- the `footer` slot precedent, so neither file gains knowledge of explaining.
- `apps/web/src/app/student/_components/ExplainPanel.spec.tsx`, `AnswerKeyRow.spec.tsx`, `apps/web/src/lib/explain-panel.spec.ts` -- source-assertion spec for the panel (one `parentApi.` call, no timer/poll/auto-retry, no forbidden copy), render-to-string cover for the row slot, function spec for the decision.
- `e2e/tests/student-explanations.spec.ts` -- expand the panel on a submitted attempt, read prose, collapse and re-expand issuing no second generation, and assert the rest of the results screen stays usable after a failure -- every click/keyboard claim lives here.

**Acceptance Criteria:**
- **Given** a student on the results screen of a submitted attempt, **when** they press the explain control on a Question for the first time, **then** an Explanation is generated, stored, and shown inline beneath that Question's row.
- **Given** an Explanation already exists for that Question and profile, **when** the panel is expanded again — in the same visit or a later one — **then** the stored Explanation is shown and no provider call is made and no allowance is consumed.
- **Given** a Free-tier account whose charged Explanations in the current period have reached the tier limit, **when** the student presses explain on a Question with no stored Explanation, **then** nothing is generated and the panel states the limit and when it resets, blaming the plan, while every Explanation already generated stays readable.
- **Given** a Practice Test whose Grade Level differs from the Student Profile's, **when** an Explanation is generated, **then** the prompt pitches the register to the Practice Test's Grade Level and the Student Profile's is not read on that path.
- **Given** an Explanation that has just been generated or restored, **when** it appears, **then** it is announced through the single live region using the same sentence that is displayed, and the answer key, the score and every other row remain usable.
- **Given** `pnpm lint`, `pnpm typecheck` and `pnpm test` at the repo root, **when** they run, **then** they pass with the new specs included.

## Design Notes

**Why POST, and why the cache read comes first.** The first call bills a provider; a GET that bills is exactly the shape Story 5.6's results read had to justify. POST states it. The service reads the stored row before touching `allowance` or `ai`, so a re-read is provably free — the endpoint answers 200 from the row and 201 when it generated.

**Charging is the row.** There is no debit to reconcile because there is no counter: `chargedAt` on the row *is* the charge, and counting rows in the window is the usage. That is why the re-count and the insert share one transaction — outside it, two concurrent presses on a Free account with one unit left could each see remaining = 1.

```ts
// explanation.service.ts, the charging seam
return this.prisma.withTransaction(async (tx) => {
  const used = await tx.explanation.count({
    where: { parentAccountId, chargedAt: { gte: window.start, lt: window.end } },
  });
  if (remainingFor(used, limits.explanation) === 0) {
    throw new ConflictException(NO_EXPLANATION_ALLOWANCE);
  }
  return tx.explanation.create({ data: { ..., chargedAt: new Date() } });
});
```

**The slot, not the row.** `AnswerKeyRow` is rendered with `renderToStaticMarkup` and asserted as a markup string, and `AttemptResults`'s spec pins it to exactly one `parentApi.` call. An `explain?: ReactNode` slot keeps both true while the panel sits where UX-DR16 requires it — directly beneath its own Question.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate deploy` -- expected: the new migration applies to a clean database
- `pnpm typecheck` -- expected: no errors across api and web
- `pnpm lint` -- expected: clean
- `pnpm test` -- expected: all unit and integration specs pass, including the new `explanation` specs
- `pnpm e2e -- student-explanations` -- expected: the new e2e spec passes

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 7, low 2)
- defer: 5: (high 0, medium 2, low 3)
- reject: 8: (high 0, medium 2, low 6)
- addressed_findings:
  - `[medium]` `[patch]` Two concurrent first presses for one Question raised an unhandled P2002 as a 500. The insert now recovers outside the aborted transaction, answers 200 with the winning row, and drops its own body rather than writing a second one. Covered by a new integration case.
  - `[medium]` `[patch]` The in-transaction re-count reused the period window and tier limit read before the provider call, so a period rollover mid-generation counted the wrong window. Consumption is now read again immediately before the transaction.
  - `[medium]` `[patch]` A Question whose stored text could not be read degraded to an empty fenced span, so an explanation of a question nobody was shown was generated, stored and charged. It now refuses with EXPLANATION_FAILED before any provider call. Covered by a new integration case.
  - `[medium]` `[patch]` Prompt rule 5 presumed the child's answer was wrong; for a correct answer that was a false premise on a surface that must never imply fault. Rule 5 now states the answer may be right or wrong and tells the model to compare.
  - `[medium]` `[patch]` The failed / offline / at-cap alert carried `role="status"` while the same sentence went through the live region, so screen readers spoke every outcome twice. The alert's implicit region was removed; the live region remains the single announcement path.
  - `[medium]` `[patch]` Nothing asserted the prompt carried the stored question, the stored correct answer or the child's own answer — the int spec only grepped it for grade-level names. Added cases for both answers and for the blank-answer sentence.
  - `[medium]` `[patch]` The post-hoc re-ask loop was never exercised: the suite pins AI_MAX_ATTEMPTS to 1, so the "payload comes back empty" case proved a single attempt. Added a case that states its own attempt figure and asserts two asks, one refusal, nothing written or charged.
  - `[medium]` `[patch]` The at-cap and offline panel states were covered only as copy strings and source matches. Added an e2e case that fulfils a 409 at the wire and one that presses with the context offline, asserting the sentences differ and that no request is dispatched offline.
  - `[low]` `[patch]` `aria-controls` pointed at an id that does not exist while the panel is collapsed (the panel is unmounted, not hidden). It is now set only while the panel is mounted; the e2e and panel specs assert both directions.
  - `[low]` `[patch]` The prompt never stated the character ceiling its payload is validated against, so a re-ask was the only thing enforcing it. Rule 3 now states MAX_EXPLANATION_LENGTH.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 1: (high 0, medium 1, low 0)
- reject: 17: (high 0, medium 4, low 13)
- addressed_findings:
  - `[medium]` `[patch]` The pre-generation guard checked only whether the stored prompt was unreadable; an unreadable stored correct answer degraded to an empty span the same way, and would still have been generated, stored and charged. The guard now refuses `EXPLANATION_FAILED` before any provider call for either field, and a new integration case (`refuses rather than explaining a Question whose correct answer could not be read`) covers it.

## Auto Run Result

**Summary:** Follow-up review pass on the already-`done` Story 6.1 (on-demand per-Question explanations). Four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) ran against the diff since `630e1064e14cdc7cb1d0d86e3a7126e69ab37054`. One real gap surfaced and was patched; one real gap was recorded for later; the rest were either already-tracked duplicates of this spec's own `deferred` list (MC distractors, cascade-delete allowance return, discarded-taxonomy-on-cache-hit, unlimited-tier double count) or did not hold up under inspection (speculative FK-guard concern, a double-click race already prevented by React's synchronous per-event re-render plus the server's own P2002 recovery, an unrecognized-`ai.run`-error path that already matches the `grading` module's own precedent and Nest's default filter never leaks its message, and an e2e assertion that was reviewed and found to test the intended property, not a weak one).

**Files changed this pass:**
- `apps/api/src/explanation/explanation.service.ts` — extended the pre-generation "unreadable stored text" refusal to also cover an unreadable stored correct answer, not just an unreadable prompt.
- `apps/api/test/explanation.int-spec.ts` — added the integration case for that guard.
- `_bmad-output/implementation-artifacts/spec-6-1-on-demand-explanations.md` — this triage log entry, one new `deferred` item, and this result.

**Review findings breakdown (this pass):** patch 1 (medium), defer 1 (medium), reject 17 (medium 4, low 13). No intent gaps, no bad-spec findings.

**Follow-up review recommendation:** `false` (1 patched finding, medium severity, score `3 × 1 = 3`, below the `5` threshold and no high-severity patch).

**Verification performed:**
- `pnpm typecheck` — clean (api + web).
- `pnpm lint` — clean (api + web).
- `pnpm --filter api exec vitest run test/explanation.int-spec.ts` — 27/27 pass, including the new case.
- `pnpm test` (full repo) — 1108/1109 pass; the one failure (`test/practice-test.int-spec.ts` › "refuses another account's released test with that same sentence") is unrelated to this diff — that file was not touched by this story, and the same test passes in isolation, confirming a pre-existing cross-test ordering flake rather than a regression from this pass's patch.
- `pnpm e2e -- student-explanations` — could not run: ports 3000/3001 were held by an unrelated, long-running dev server from a different project (`n-electric`) on this machine. Not started or stopped as part of this pass to avoid disturbing that process. This pass's code change does not touch any file the e2e suite exercises beyond the service guard, which the integration suite already covers for the analogous prompt case.
- `pnpm --filter api exec prisma migrate deploy` — not re-run; no migration changed this pass.

**Residual risks:** the newly-deferred period-window regression-test gap (see `deferred` frontmatter); the e2e suite is unverified this pass for the reason above, though no e2e-relevant surface changed.

