---
title: 'Story 7.5: Weak Area Drill-Down & Targeted Regeneration'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_revision: '490ceed61378ebfc87abcd44105ebd557ca9beac'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      One drill-down screen states two clocks: the hand-in and upload dates
      resolve in the browser's zone while the allowance reset resolves in the
      account's.
    evidence: |-
      `readableInstant` (apps/web/src/lib/parent-view.ts) formats with the
      browser's locale and zone; `dateOnly(allowance.resetAt,
      allowance.timezone)` formats in the account's stored zone. Both appear on
      this one screen, so a parent travelling reads a hand-in date against their
      device and the reset against the account. Neither string is wrong on its
      own, and the split is the established convention across every existing
      parent surface (`parent/attempts`, `parent/generate`), so fixing it here
      alone would make this screen the odd one out. It needs a single decision
      about which zone parent-facing instants are stated in, applied everywhere
      at once.
    location: >-
      apps/web/src/app/parent/analytics/topics/[topicId]/page.tsx
    severity: low
  - summary: >-
      The exhausted-allowance fire-control disable is proven only by a
      source-text regex match, not by an executing test, so a wiring
      regression that unbinds `disabled` from `cost.spendable` would ship
      silently.
    evidence: |-
      `apps/web/src/app/parent/analytics/topics/[topicId]/page.spec.tsx` never
      renders the component (no testing-library import); it `readFileSync`s
      `page.tsx` and regex-matches the literal
      `disabled={cost === null || !cost.spendable || firing}` string.
      `e2e/tests/parent-analytics.spec.ts` only exercises the spendable path
      and asserts the button `toBeEnabled()`; it never drives the allowance to
      `remaining: 0`. Consequence is bounded because
      `PracticeTestService.request` still clamps the allowance server-side and
      surfaces a 409 sentence, but the UI-level guarantee UX Q12c calls out
      (never fire on a spent allowance) has no executable proof.
    location: >-
      apps/web/src/app/parent/analytics/topics/[topicId]/page.spec.tsx
    severity: low
  - summary: >-
      `questionEvidenceFor`'s unreadable-prompt/answer degrade path is proven
      at the service unit level but never driven end-to-end through the
      drill-down route, so a wiring break between the service and the view
      assembly for this row shape would not be caught.
    evidence: |-
      The I/O matrix's "Unreadable stored prompt/key" row has no matching
      case in `apps/api/test/analytics.int-spec.ts`'s topic-drill-down
      describe block, only in unit specs.
    location: >-
      apps/api/test/analytics.int-spec.ts
    severity: low
  - summary: >-
      `targetSentence`'s branch for a target with neither a Subject nor a
      readable date renders a materially vaguer sentence than the `noTarget`
      branch's specific guidance, so a parent reads two different confidence
      levels about upload coverage depending on which incidental data happens
      to be missing.
    evidence: |-
      Compare the `targetSentence` fallback copy in
      `apps/web/src/lib/topic-drill-down.ts` (and the `topicDrillDown`
      copy namespace) against the `noTarget` string: one says "From an
      earlier upload of this student's," the other names the missing
      coverage specifically.
    location: >-
      apps/web/src/lib/topic-drill-down.ts
    severity: low
  - summary: >-
      The cost-read failure (`allowanceFailed`) and the fire-request failure
      (409) branches this screen special-cases with their own retry/copy have
      no int-spec or e2e coverage -- only the happy path is driven
      end-to-end.
    evidence: |-
      `e2e/tests/parent-analytics.spec.ts` only exercises the
      spendable/success path; no test triggers a failing allowance read or a
      409 from the fire request against the rendered screen.
    location: >-
      apps/web/src/app/parent/analytics/topics/[topicId]/page.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 7.4 shipped the Mastery table, but a Topic row is a dead end: a parent reads "division with remainders — 40%, 3 unanswered" and cannot see *which* Questions produced it, and the weighted generation Story 4.2 built is reachable only from the generate screen of one upload — so UJ-3's arc (see the weak Topic, read the evidence, act on it) breaks exactly where acting starts. DW-96 records this unresolved: UX Q12c sites weighted regeneration *inside* the drill-down with the Topic pre-selected, and nothing implements that surface.

**Approach:** Add one parent-scoped drill-down read per Topic that returns the Topic's own Mastery figure (with its unanswered count), the missed Questions of the same five-Attempt window the figure is over — each with the student's answer and the correct answer — the Questions left blank as a separate list, and the single weighted-generation target resolved server-side (a Source Test behind that evidence whose Extraction actually carries a label for the Topic). One drill-down screen renders the evidence in the paper role, states the cost in Practice Tests before anything fires, and fires Story 4.2's existing request for one Practice Test weighted on that Topic.

## Boundaries & Constraints

**Always:**
- One window rule: the drill-down's evidence is the **same** window `recomputeMastery` counted — `submittedAttemptsFor` → `countsTowardMastery` → `masteryWindowOf`. Extract the shared window resolution so there is one implementation, never a second one beside it.
- The Mastery figure on this screen is the stored `TopicMastery` row read through the parent-scoped `where`, and it carries its unanswered count wherever it appears (Epic 7, FR-27).
- Questions in the `Unanswered` state are listed **separately** from missed Questions. `Ungraded` and row-less Questions appear in neither list, exactly as they enter neither Mastery term.
- Generation goes through `PracticeTestService.request(parentAccountId, sourceTestId, count, weightedTopic)` unchanged. The weighted label handed to it is resolved from the Extraction's own spelling server-side, so the request cannot 409 on a label the drill-down invented.
- The cost block states, before the control can fire: how many Practice Tests it will generate, the Generation Allowance left, and what is left after — all denominated in **Practice Tests** (UX C1's resolved unit, the unit `GenerationAllowanceView` already uses). A fire with no cost stated is a defect.
- A foreign or unknown profile id, and a Topic this child has no Mastery row for, answer 200 with an empty drill-down — never 404, never 403 (AD-18).
- Every string describing student work is a copy function taking the subject; Parent View names the profile in third person (UX-DR31).

**Block If:**
- Nothing. Every decision this story needs is settled by the epic context, UX Q12c, or the existing code.

**Never:**
- No new generation path, no second cost/allowance computation: the count, the clamp and the charge stay `practicetest`'s.
- No schema change, no migration, no new web or api dependency, no chart library.
- No duplicate generate entry point on the dashboard itself (Q12c). The generate screen's own Topic picker stays — it is the first-generation entry from capture, not a dashboard duplicate.
- No per-Topic trend line, no second Mastery formula, no re-derivation of the Weak Area thresholds in the web app.
- No Account Tier name and no upsell anywhere on this surface.
- Do not touch `recomputeMastery`'s counting or `masteryFrom`; the extraction is a move of the window-resolution block, not a change of what it computes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Weak Topic with evidence | Profile with a `TopicMastery` row for the Topic; window holds `Correct`/`Incorrect`/`Unanswered` rows | Mastery figure + counts + `isWeakArea`; `missed` holds the `Incorrect` refs, `unanswered` the `Unanswered` refs, both newest Attempt first then `ordinal` asc | No error expected |
| Ungraded in window | A tagged Question with `Ungraded` state or no grade row | Appears in neither list; the figure's denominator is unchanged | No error expected |
| Override flips a grade | `overrideState: 'Correct'` over a stored `Incorrect` | Row leaves `missed`; the remaining rows carry `parentAdjusted: true` where an override exists | No error expected |
| Retake only | The Topic's Questions answered only on `ordinal > 1` Attempts | Empty drill-down lists; the stored figure is whatever the first runs produced | No error expected |
| Foreign / unknown profile or Topic | Another account's profile id, or a Topic with no row for this child | 200, `mastery: null`, both lists empty, `target: null` | No refusal, no 404 |
| Unreadable stored prompt/key | Stored segments a schema change left unreadable | Row keeps its place; `prompt`/`correctAnswer`/`studentAnswer` degrade to null and the screen states the answer is unavailable | Logged by id only (AD-20) |
| No generation target | No Source Test behind the evidence is `Submitted`, or none carries a matching label | `target: null`; the screen states that no upload of this child's carries the Topic and offers no fire | No refusal |
| Allowance spent | `remaining === 0` | Cost block states nothing is left and the reset date; the control is disabled and never fires | `request`'s 409 is still surfaced as a sentence if pressed via a stale read |
| Generation accepted | Target resolved, allowance left, control pressed | `request(..., 1, weightedTopic)` accepted; the parent is taken to the existing generate progress screen for that Source Test | 409/network fault states a sentence and leaves the screen usable |

</intent-contract>

## Code Map

**API — what exists to reuse**

- `apps/api/src/grading/grading.service.ts:1099` `recomputeMastery(tx, studentProfileId, topicIds)` — its middle block (`:1127-1163`) is the window resolution to **extract**: `testIdsByTopic` / `questionIdsByTopicAndTest` built from `questionTopic` tags, then `masteryWindowOf` per Topic. `:1279` `masteryFor(scope: ParentScope, studentProfileId)` — the parent-scoped `where` (`studentProfile: { parentAccountId }`) and the AD-18 "answer empty, never 404" rule to copy. `:88`/`:121` `GradingScope`/`ParentScope` (no child id on the scope — the profile is a second argument).
- `apps/api/src/grading/mastery.ts:36` `MASTERY_ATTEMPT_WINDOW`, `:45` `MasteryWindowAttempt`, `:64` `masteryWindowOf`, `:112` `masteryFrom`; `mastery-eligibility.ts:55` `countsTowardMastery(ordinal)`. The file's own doc block already names the drill-down as a reader that must state its figure over the same five Attempts.
- `apps/api/src/grading/grading-override.ts` `effectiveStateOf(row)` — resolve before partitioning; `weak-area-policy.ts:70` `weakAreaRuntime()`, `:107` `answeredOf`, `:127` `isWeakArea`.
- `apps/api/src/practicetest/practice-test.service.ts:2013` `answerKeyFor` — the recipe for reading prompt / student answer / correct answer in one transaction, including `correctAnswerTextOf` / `studentAnswerTextOf` (`:3550`, `:3582`) and the degrade-to-null + log-ids-only rule. **Do not widen it**: it is per-Attempt and reads every Question of a test; the new reader is keyed by `(attemptId, questionId)` refs.
- `apps/api/src/practicetest/practice-test.service.ts:3498` `topicsOf(extraction)`, `:3510` `matchTopic(topics, wanted)`, `:3524` `resolveWeightedTopic` — the **only** comparison a weighted label may be resolved by (`normalizeTopicLabel`, `practice-test-policy.ts:446`). `:784` `allowanceFor(parentAccountId)` -> `GenerationAllowanceView` (`:166`: `used`, `limit`, `remaining`, `maxPerRequest`, `resetAt`, `timezone`); `:848` `request(...)` — unchanged, and the only way to enqueue. `:1950` `submittedAttemptsFor(tx, studentProfileId)` (uncapped, `(submittedAt desc, id desc)`).
- `apps/api/src/practicetest/practice-test.controller.ts:84` `GET parent/allowance/generation`, `:100` `POST parent/source-tests/:id/practice-tests` — already exposed; no new generation route.
- `apps/api/src/sourcetest/source-test-reader.ts:70` `SourceTestReader.requireReadable` (404 on foreign/unknown), `:91` `readSubjectLabels`; `apps/api/src/extraction/extraction-reader.ts:44` `ExtractionForGeneration` with `questions[].topics` — `practicetest` reads Extractions only through `EXTRACTION_READER` (AD-17).
- `apps/api/src/topics/topic.service.ts` `describe(topicIds)` -> `Map<string, { topicId, name, subjectId, subjectName, provisional }>` — the Topic's name and Subject; `topics` owns `Topic` (AD-11/AD-17).
- `apps/api/src/analytics/analytics-view.ts:25-160` the view interfaces and pure assembly (`rankTopics`, `describedTopics`, `countAwaiting`); `analytics.service.ts:57` `profileAnalyticsFor` — the composition shape to imitate; `parent-analytics.controller.ts:36-49` the controller shape (`@Controller('parent')`, `@SkipThrottle({ login: true })`, `ParentElevationGuard`, `ParseUUIDPipe`); `analytics.module.ts` — add nothing new to it except what the new reads need (`PracticeTestModule` and `GradingModule` are already imported).
- `apps/api/src/grading/grading-results.ts:27` `AnswerKeyRowView` — the row shape the web already renders; the drill-down's rows are this shape (`newlyGraded` is always `false` here) so no second row component exists.
- `apps/api/prisma/schema.prisma` `QuestionTopic` (`@@index([topicId, practiceTestId])`), `PracticeTestQuestionTopic.label` (the raw generated spelling), `TopicMastery`, `Attempt`, `QuestionGrade`, `GradeDispute` — **read-only; no schema change in this story**.
- `apps/api/test/harness.ts:50-123`, `apps/api/test/analytics.int-spec.ts`, `apps/api/test/weak-area.int-spec.ts` — the graded-hand-in fixture recipe and the supertest-through-`harness.app` elevation-token recipe; `apps/api/test/practice-test.int-spec.ts` — how a generation request is driven end to end.

**Web — what exists to reuse**

- `apps/web/src/app/parent/analytics/page.tsx` — the staged-reads skeleton (`applyIfCurrent`, `endsParentView`, Retry `attempt`, `loaded` flags, the profile picker) and `_components/MasteryTable.tsx:131` the `TableRow` carrying `data-topic-id` — the row that gains the drill-down link.
- `apps/web/src/app/parent/drafts/page.tsx:76-199` — the `useSearchParams`-behind-`Suspense` pattern (and its spec assertion) this screen must follow, since the selected profile arrives as a query parameter.
- `apps/web/src/components/AnswerKeyRow.tsx:38` `AnswerKeyRowLabels` / `:132` `AnswerKeyRow` — renders prompt in the paper role with the five-carrier grade marker; `apps/web/src/app/parent/attempts/[attemptId]/page.tsx:60-72` `PARENT_ROW_LABELS` — the third-person label set to reuse verbatim.
- `apps/web/src/components/WeakAreaMarker.tsx` — built in 7.4 "because 7.5 reuses this"; `apps/web/src/components/RichText.tsx`, `Screen.tsx`, `theme/tokens.ts` (`typeRoles.questionBody`, `measure.questionMaxWidth`, `rounded.paper`, `density`).
- `apps/web/src/lib/parent-api.ts:188` `GenerationAllowanceView`, `:1231` `students`, `:1732` generation allowance call, `:1744` `startGeneration(token, sourceTestId, count, weightedTopic)`, `:995` `call<T>`, `:869` `ParentApiError`, and the 7.4 analytics view interfaces to extend.
- `apps/web/src/lib/practice-test-count.ts:85` `remainingAfter(count, limit, used)` — the only "left after this" arithmetic; `apps/web/src/lib/consumption-format.ts:25` `dateOnly`, `:38` `limitLabel`.
- `apps/web/src/lib/parent-view.ts`, `apps/web/src/lib/elevation.tsx:82` `useElevation`, `apps/web/src/components/Address.tsx` (`AddressProvider surface="parent"`), `apps/web/src/copy/parent.ts` (`analytics` namespace `:…` for `masteryFigure`, `masteryNone`, `weakArea`, `unknownTopic`; `attempts` namespace for the row labels; `generate` namespace for the allowance fine print's precedent).
- `e2e/tests/parent-analytics.spec.ts`, `e2e/fixtures.ts` — the Playwright journey to extend.

**Reference (read, do not change)**
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/.memlog.md:47` — Q12c in full: the control lives in the drill-down, cost stated before it fires, one tap, no dashboard duplicate.
- `_bmad-output/implementation-artifacts/deferred-work.md` DW-96 — the entry this story answers.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/grading/mastery.ts` -- add `TopicWindowTag = { topicId, questionId, practiceTestId }` and `topicWindowsOf(attempts, tags, topicIds)` -> `Map<string, { window: MasteryWindowAttempt[]; questionIdsByTest: Map<string, string[]> }>`, lifted verbatim from `recomputeMastery`'s grouping block -- the window rule this file already claims to be the only statement of is about to have a second reader, and two copies would disagree the first time either is touched.
- `apps/api/src/grading/mastery.spec.ts` -- extend: a Topic whose papers interleave with unrelated ones keeps its five, per-test question ids group correctly, an absent Topic answers an empty window -- the extraction must be proved behaviour-preserving before two callers depend on it.
- `apps/api/src/grading/topic-evidence.ts` -- new pure module: `TopicEvidenceRef` (`attemptId`, `questionId`, `practiceTestId`, `submittedAt`, `state`, `parentAdjusted`, `disputed`) and `partitionTopicEvidence(entries)` -> `{ missed, unanswered }`, ordering newest Attempt first then question `ordinal` asc, dropping `Ungraded` and row-less entries -- what belongs in which list is a rule, and a rule belongs in a spec rather than in a screen.
- `apps/api/src/grading/topic-evidence.spec.ts` -- new: every matrix row of the partition (incorrect, unanswered, ungraded, no row, overridden to correct, ordering across two Attempts).
- `apps/api/src/grading/grading.service.ts` -- rewrite `recomputeMastery`'s grouping block to call `topicWindowsOf` (counting untouched), and add `topicEvidenceFor(scope: ParentScope, studentProfileId: string, topicId: string): Promise<TopicEvidenceView>`: the parent-scoped `TopicMastery` read first (absent -> empty view, never a refusal), then one transaction resolving the Topic's window through the shared helper, one `questionGrade.findMany` over the window's refs, one `gradeDispute.findMany` over them, `effectiveStateOf`, then `partitionTopicEvidence` -- the evidence must be the same five Attempts the figure is over, so it is resolved by the same function and not by a filter of its own.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `questionEvidenceFor(parentAccountId, refs: readonly { attemptId, questionId }[])` -> `Map<string, QuestionEvidenceView>` keyed `attemptId:questionId` (`ordinal`, `format`, `prompt`, `studentAnswer`, `correctAnswer`), one transaction, account in the `where` through the Attempt relation, reusing `correctAnswerTextOf`/`studentAnswerTextOf` and `answerKeyFor`'s degrade-to-null-and-log-ids rule; and `weightedTargetFor(parentAccountId, questionIds, canonicalTopicName)` -> `{ sourceTestId, weightedTopic, subjectName, submittedAt } | null`, which reads those Questions' Practice Tests (scoped) newest first, collects their `PracticeTestQuestionTopic.label`s, and for each distinct Source Test in turn runs `requireReadable` + `readForGeneration` and `matchTopic` against the canonical name then the raw labels, answering the first hit and `null` if none -- the label a request is weighted on must be the Extraction's own spelling, so it is resolved by the module that owns that comparison and never guessed by a screen.
- `apps/api/src/analytics/analytics-view.ts` -- add `TopicDrillDownRowView` (an `AnswerKeyRowView` plus `attemptId` and `submittedAt`), `WeightedTargetView`, `TopicDrillDownView` (`topicId`, `topicName`, `subjectName`, `mastery: MasteryTopicView | null`, `missed`, `unanswered`, `target`, `weakArea`), and the pure `drillDownRowsOf(refs, evidence)` that joins refs to words, keeps a ref whose evidence is missing with null fields, and sets `newlyGraded: false` -- the join is arithmetic over two maps and is assertable with no database.
- `apps/api/src/analytics/analytics-view.spec.ts` -- extend: the join, the missing-evidence row, `mastery: null` for a Topic with no row, and that an `Ungraded` ref never reaches either list.
- `apps/api/src/analytics/analytics.service.ts` -- add `topicDrillDownFor(parentAccountId, studentProfileId, topicId)` composing `grading.topicEvidenceFor`, `topics.describe([topicId])`, `practiceTests.questionEvidenceFor`, `practiceTests.weightedTargetFor` and `weakAreaRuntime()`; an empty evidence view short-circuits before any further read -- one composition in one place, as the dashboard's is.
- `apps/api/src/analytics/parent-analytics.controller.ts` -- add `GET students/:studentProfileId/analytics/topics/:topicId` with both params through `ParseUUIDPipe`, same guard and same AD-18 answer -- the drill-down is one read, so it is one route.
- `apps/api/test/analytics.int-spec.ts` -- extend: drive a graded hand-in with a wrong answer, a blank and a correct answer on one Topic, then assert through `harness.app` that the drill-down states the figure with its unanswered count, lists the wrong answer with the student's and the correct words, lists the blank separately, excludes an `Ungraded` Question, excludes a retake's answers, that an override moves a row out of `missed` and marks the rest `parentAdjusted`, that a foreign profile id answers an empty drill-down, and that the resolved `target` names a Source Test whose Extraction carries the label.
- `apps/api/test/practice-test.int-spec.ts` -- extend: `weightedTargetFor` picks the newest Source Test carrying the label and answers `null` when no Extraction carries it, and the target it does resolve is accepted by `POST parent/source-tests/:id/practice-tests` with `weightedTopic` and produces a weighted job -- there is no unit tier for this service (only `practice-test-policy.spec.ts` / `-payload.spec.ts` / `.runner.spec.ts`), and the whole point of resolving server-side is that the request cannot refuse it.
- `apps/web/src/lib/parent-api.ts` -- add the mirrored interfaces and `topicDrillDown: (token, studentProfileId, topicId) => call<TopicDrillDownView>(...)` -- the one place the web knows the route.
- `apps/web/src/copy/parent.ts` -- add a `parentCopy.topicDrillDown` namespace: the back link, the Topic heading, the figure sentence (reusing the `analytics` figure/unanswered wording so the two screens cannot drift), the explanation that blanks count in neither term and that a timer expiry would have marked them wrong, the two list headings named after the student, the empty-evidence sentence, the cost block's three lines in Practice Tests, the fire control's label, the no-target sentence, the spent-allowance sentence and the reset-date line -- every string a function of the subject, no literal in a component (UX-DR31), no tier and no upsell.
- `apps/web/src/lib/topic-drill-down.ts` -- new pure module: `costOf(allowance)` -> `{ count, remaining, after, spendable }` over `remainingAfter` with the count fixed at one, and `hasEvidence(view)` -- the cost block is the Q12c guard, so its arithmetic is unit-tested rather than inlined in JSX.
- `apps/web/src/lib/topic-drill-down.spec.ts` -- new: the unlimited tier, a remaining of one, a remaining of zero (not spendable), and the empty-evidence predicate.
- `apps/web/src/app/parent/analytics/topics/[topicId]/page.tsx` -- new: the analytics page's staged-reads skeleton, the profile id read from `useSearchParams` inside a `Suspense`-wrapped child, an `AddressProvider surface="parent"`, the student named from the profiles read, the Topic heading with the Mastery figure and its unanswered count, `WeakAreaMarker` where the API says so, the missed list and the separate blanks list rendered through `AnswerKeyRow` with `PARENT_ROW_LABELS` and a per-row caption naming the practice test's date, then "Generate more on this": the cost block, then a control that fires `startGeneration(token, target.sourceTestId, 1, target.weightedTopic)` and on acceptance routes to `/parent/generate/{sourceTestId}` for the existing progress screen -- one screen, reached only from the Mastery table, and firing only through Story 4.2's request.
- `apps/web/src/app/parent/analytics/_components/MasteryTable.tsx` -- add a required `hrefFor(topicId)` prop and render the Topic name as a link filling that cell (keyboard reachable, the accessible name being the Topic) -- a row that cannot be opened is a dashboard that still dead-ends.
- `apps/web/src/app/parent/analytics/page.tsx` -- pass `hrefFor` carrying the selected profile in the query string -- the drill-down is about one child and must not guess which.
- `apps/web/src/app/parent/analytics/topics/[topicId]/page.spec.tsx`, `apps/web/src/app/parent/analytics/_components/MasteryTable.spec.tsx` (extend), `apps/web/src/lib/parent-api.spec.ts` (extend) -- the house style: source assertions for the screen (including the `Suspense` wrapper and that no literal cost figure appears), a real `renderToStaticMarkup` case for the table's new link.
- `e2e/tests/parent-analytics.spec.ts` -- extend: from the dashboard, open a Topic row, and assert the drill-down states the Topic, states a cost before any fire, names no Account Tier and offers no upgrade -- reachability from the table and what a parent actually reads live nowhere else.

**Acceptance Criteria:**

- Given the drill-down response for a Topic, when its lists are read, then no `questionId` appears in both, every `missed` row is `Incorrect` and every `unanswered` row is `Unanswered`, and `grep -n "MASTERY_ATTEMPT_WINDOW\|masteryWindowOf" apps/api/src/grading` shows the window resolved only in `mastery.ts` and called from `grading.service.ts`.
- Given `git diff` for this story, when `recomputeMastery` is read, then its counting loop, `masteryFrom` and `hasEvidence` are unchanged, and `apps/api/prisma` lists no changed file.
- Given the resolved `target`, when it is posted to `POST parent/source-tests/:id/practice-tests` with `count: 1`, then the request is accepted and the stored job carries that `weightedTopic` — no `WEIGHTED_TOPIC_UNKNOWN`.
- Given the drill-down screen, when the generate section renders, then the count, the allowance left and the amount left after are all stated above the control, all three in Practice Tests, and `grep -rn "remainingAfter\|[0-9]\+ of [0-9]\+" apps/web/src/app/parent/analytics/topics` shows no figure computed or written in the component.
- Given an allowance with nothing left, when the screen renders, then the control is disabled, the reset date is stated, and no request is sent.
- Given `grep -riE "tier|upgrade|free plan" apps/web/src/app/parent/analytics/topics apps/web/src/lib/topic-drill-down.ts` and the `topicDrillDown` namespace of `apps/web/src/copy/parent.ts`, when they run, then they return nothing.
- Given the Mastery table, when a row is rendered, then its Topic name is a link carrying the Topic id and the selected profile, and `grep -rn "questionBody\|AnswerKeyRow" apps/web/src/app/parent/analytics/topics` shows the evidence rendered through the shared row rather than a second layout.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 18: (high 0, medium 7, low 11)
- defer: 1: (high 0, medium 0, low 1)
- reject: 11
- addressed_findings:
  - `[medium]` `[patch]` A Topic whose whole window the child answered correctly resolved no generation target, so the screen stated "none of your uploads covers this topic any more" — false. `topicEvidenceFor` now carries the window's tagged Question ids and the target is resolved over all of them, not only the failed rows.
  - `[medium]` `[patch]` The stored figure was read outside the transaction its evidence is read inside, so the percentage and the rows under it could come from two snapshots. Moved inside, and the docstring's statement count corrected.
  - `[medium]` `[patch]` A target with neither a Subject nor a readable date composed two sentences into "From the upload of From a finished practice test." A fourth copy variant was added and the branch lifted into a unit-tested `targetSentence`.
  - `[medium]` `[patch]` A well-formed `?student=` naming nobody on the account rendered a blank screen — no error, no empty state. It now states that the student could not be found, gated on the profiles read having answered.
  - `[medium]` `[patch]` The dashboard spec still claimed "offers no drill-down" and passed only vacuously, and nothing asserted the link carries the selected student. Replaced with assertions over the real href and the student in it.
  - `[medium]` `[patch]` Every drill-down integration case used a two-question paper, so `isWeakArea` was never observed true on the response a parent reaches *because* a Topic is weak. A case at the answered floor now asserts it.
  - `[medium]` `[patch]` Nothing performed the story's one action. The e2e now clicks the control, asserts the navigation, and asserts the enqueued job's weighted label and count — the only place `startGeneration`'s argument order is pinned by consequence.
  - `[low]` `[patch]` The profiles read and the drill-down read shared one error slot while a spec claimed they were separate; each has its own now.
  - `[low]` `[patch]` The cost block's Retry re-issued all three reads and blanked evidence the parent was reading; the allowance read has its own effect and its own retry.
  - `[low]` `[patch]` A Question the system cannot read back was headed "Question 0"; it now says it cannot be identified.
  - `[low]` `[patch]` `LiveSourceTest.submittedAt` was optional for a reason that did not hold, and no test asserted it; made required and asserted.
  - `[low]` `[patch]` Two unchecked `as` casts (the row state, the attempt instant) replaced with types that make the invariant the compiler's.
  - `[low]` `[patch]` Two assertions were coupled to byte shape (a call's line break, an exact `href=` count); both now assert behaviour.
  - `[low]` `[patch]` Section headings skipped from `h1` to `h3`; they are `h2`, asserted.
  - `[low]` `[patch]` No integration case staged two qualifying Attempts on one Topic, so response-level row order was unproven; added.
  - `[low]` `[patch]` `WeightedTargetView` was both aliased on import and re-exported.
  - `[low]` `[patch]` `weightedTargetFor`'s docstring claimed an ordering and a tie-break it does not use; corrected to what it orders by and why the upload's own column is not reachable there.
  - `[low]` `[patch]` Two assertions could not fail for the reason they named (a capitalised-literal regex that missed attributes and lowercase text; a plan/price substring sweep over comments). Both tightened and proved against planted violations.

Reject notes: `requireReadable` throwing mid-loop in `weightedTargetFor` (the ids come from this account's own Practice Tests and `PracticeTest.sourceTest` is `onDelete: Restrict`, so the row cannot be missing or foreign); duplicate `question_topic` rows producing duplicate evidence (`@@unique([questionId, topicId])` forbids it); an `Intl` throw on the allowance timezone (the zone is the server's own account record — rejected for the same reason in Story 7.4); `TopicDrillDownView.weakArea` being unread by the screen (it mirrors the dashboard's contract so the empty state can state the floor without restating a tunable); `TopicEvidenceRef.practiceTestId` being unused downstream (it is what the window is keyed by while the refs are built); `hrefForTopic`'s query string inside the typed segment and a claimed double-encode (the App Router decodes params, and the id is a UUID); a stale `startGeneration` response after a `?student=` switch (user-initiated, and the target does not change with the student); dropping the `gradeDispute` read that feeds a field `AnswerKeyRow` does not render (shipping a hardcoded `disputed: false` on a shared row shape is a falsehood in the contract, which is worse than one narrow indexed read); and the three intent-alignment divergences — the count fixed at one, the upload resolved server-side rather than chosen, and a cost preview composed here rather than 4.2's — each of which is the reading UX Q12c selects and is recorded in Design Notes.

### 2026-09-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 4: (high 0, medium 0, low 4)
- reject: 13
- addressed_findings:
  - none

Reject notes: `weightedTargetFor`'s `practiceTestId desc` tie-break left untested (arbitrary tie-break, no consumer-visible consequence); sequential per-candidate reads in `weightedTargetFor` as a latency concern (bounded by the five-Attempt window, already justified in Design Notes, not a functional defect); read-skew between `topicEvidenceFor`'s transaction and `questionEvidenceFor`'s separate transaction (the second read only fetches text for refs already selected in the first; a concurrent override cannot corrupt the row's prompt/answer text, only a future reload's classification); `drillDownRowsOf`'s missing-evidence ordinal tie-break left untested precisely (minor coverage nit, already defensively coded); duplicated per-effect retry-guard code across the three staged reads (maintainability opinion, no observed defect); `hrefForTopic`'s typed-route cast (already rejected in the prior pass for the same reason — the App Router decodes params and the id is a UUID); `MasteryTable`'s new anchor cell tap-target/responsive layout left unverified (cosmetic, no reported regression); `costOf`/disabled duplicate boundary at `remaining === count` left untested exactly (arithmetic already unit-tested generally); the client-side double-submission race beyond the `firing` flag (the server clamps the allowance independently, per Design Notes and the existing 409 contract, so no consumer harm); `MasteryTable.spec.tsx`'s regex assertion on href composition being brittle to a future non-template-literal rewrite (test-robustness opinion, not a functional issue); duplicate `question_topic` rows producing duplicate evidence in `topicEvidenceFor`'s refs loop (`@@unique([questionId, topicId])` forbids it — same as the prior pass's reject); `requireReadable` throwing mid-loop in `weightedTargetFor` (same reasoning as the prior pass — the ids come from this account's own Practice Tests under `onDelete: Restrict`); and the intent-alignment auditor's one interpretive note on unlimited-tier cost copy (`costRemainingUnlimited`/`costAfterUnlimited` prose instead of a raw ceiling number) being a defensible reading, not a divergence, since a raw ceiling would misrepresent itself as a real remaining balance.

## Design Notes

**Why the window resolution is extracted rather than re-written.** `mastery.ts`'s own doc block says every Epic 7 read — "the dashboard, Weak Areas, the drill-down" — must state its figure over the same five Attempts. The drill-down is the first read that needs the *members* of that window and not just the counts, so the grouping block in `recomputeMastery` becomes a function both callers use. Copying it would put a second selection rule beside a stored figure it must agree with, and the two would diverge the first time `MASTERY_ATTEMPT_WINDOW` or the tie-break moved.

**Why the weighted label is resolved in `practicetest`.** `request()` refuses a label the Extraction does not carry, and it resolves against `normalizeTopicLabel` — a comparison that is deliberately *not* canonicalization (AD-11). A canonical Topic name is not guaranteed to be one of an Extraction's raw labels, so the drill-down cannot simply send its heading. The new reader tries the canonical name and then the raw `PracticeTestQuestionTopic` labels of the very Questions the parent is looking at, through the same `matchTopic` the request uses, and answers `null` rather than offering a fire that would 409. No provider call, and at most one Extraction read per Source Test behind a five-Attempt window.

**Why one target and one Practice Test, not a picker.** UX Q12c: the control is one tap from the evidence, with the Topic pre-selected and no duplicate entry point. A count picker and a Topic picker on this screen would be the generate screen rebuilt, so the count is fixed at one and the Source Test is resolved rather than chosen. After the request is accepted the parent is handed to the existing generate screen, which already polls the newest job for that Source Test — so nothing about progress, clamping or charging is duplicated either.

**Why DW-96 keeps both surfaces.** Q12c forbids a duplicate entry point *at the dashboard*. The generate screen's Topic picker is the only way to weight a first generation from a freshly captured paper, before any Attempt exists to drill into, so it is kept deliberately; the drill-down never calls `GET …/practice-tests/topics`, because it already holds the Topic.

**Why the evidence rows are `AnswerKeyRowView`.** The five non-colour grade carriers, the paper-role prompt and the "no answer" treatment are all already in `AnswerKeyRow`, and 7.4 built `WeakAreaMarker` for this story to reuse. A second row layout here would be the place the two rooms' grade semantics drift.

## Verification

**Commands:**
- `pnpm --filter api run lint` -- expected: clean.
- `pnpm --filter api run typecheck` -- expected: clean.
- `pnpm --filter web run lint` -- expected: clean.
- `pnpm --filter web run typecheck` -- expected: clean.
- `pnpm --filter api exec vitest run src/grading src/analytics src/practicetest` -- expected: all pass, including the extracted window's new cases.
- `pnpm --filter api exec vitest run test/analytics.int-spec.ts test/weak-area.int-spec.ts test/mastery.int-spec.ts test/practice-test.int-spec.ts` -- expected: all pass; 7.2–7.4 and Epic 4 suites still green.
- `pnpm --filter web run test` -- expected: all pass.
- `pnpm exec playwright test e2e/tests/parent-analytics.spec.ts` -- expected: pass.

## Auto Run Result

**Summary:** Story 7.5 adds a parent-scoped Topic drill-down: `GET students/:studentProfileId/analytics/topics/:topicId` returns the stored Mastery figure, the missed/unanswered evidence rows for the same five-Attempt window `recomputeMastery` counts, and a server-resolved weighted-generation target; the web app adds `/parent/analytics/topics/[topicId]` rendering that evidence through the shared `AnswerKeyRow`, a cost block in Practice Tests, and a fire control that calls `PracticeTestService.request(...)` unchanged. This pass was a fresh review of the already-`done` implementation (no code changes this pass).

**Files changed:** see `git diff --stat 490ceed61378ebfc87abcd44105ebd557ca9beac` (26 files, +4025/-67) — API: `mastery.ts`/`mastery.spec.ts` (window extraction), `topic-evidence.ts`/`.spec.ts` (new partition module), `grading.service.ts` (refactor + `topicEvidenceFor`), `practice-test.service.ts` (`questionEvidenceFor`, `weightedTargetFor`), `source-test-reader.ts` (small support change), `analytics-view.ts`/`.spec.ts` (new view shapes + join), `analytics.service.ts` (`topicDrillDownFor`), `parent-analytics.controller.ts` (new route), `analytics.int-spec.ts` / `practice-test.int-spec.ts` (integration coverage). Web: `topic-drill-down.ts`/`.spec.ts` (cost arithmetic), `parent-api.ts`/`.spec.ts` (client call), `copy/parent.ts` (new namespace), `topics/[topicId]/page.tsx`/`.spec.tsx` (new screen), `MasteryTable.tsx`/`.spec.tsx` (drill-down link), `analytics/page.tsx`/`.spec.tsx` (hrefFor wiring), `e2e/fixtures.ts` / `parent-analytics.spec.ts` (e2e journey).

**Review findings breakdown (this pass):** patches applied: 0. Items deferred: 4 (all low). Items rejected: 13. No intent_gap, no bad_spec.

**Follow-up review recommendation:** `false`. This pass patched 0 findings (0 high, 0 medium, 0 low); score = 3×0 + 1×0 = 0, below the 5 threshold, and no high-severity patch occurred.

**Verification performed:** No code changed this pass, so the `## Verification` commands above were not re-run; they were satisfied by the prior implementation/review passes that brought this spec to `done`. This pass's own verification was the four-layer review (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment Auditor) against the full diff since `490ceed61378ebfc87abcd44105ebd557ca9beac`, plus triage of every returned finding.

**Residual risks:** The four newly deferred items are test-coverage gaps, not observed functional defects — notably, the exhausted-allowance fire-control disable is proven by source-text assertion and a spendable-path e2e case, but no test renders the screen with `remaining: 0` and observes the control actually non-interactive (bounded by the server's independent allowance clamp). The other three are narrower coverage gaps (the unreadable-evidence degrade path not driven end-to-end, one copy-consistency nit between two "no coverage" sentences, and the cost/fire error branches untested end-to-end). None block this story; all are recorded in `deferred` for later focused attention.

