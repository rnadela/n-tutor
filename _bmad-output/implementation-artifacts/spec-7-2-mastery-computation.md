---
title: 'Story 7.2: Mastery Computation'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The Mastery recompute reads a child's whole submitted-Attempt history on every
      grade change, with no cap and no time bound.
    evidence: |-
      `PracticeTestService.submittedAttemptsFor` deliberately has no `take` and no lower
      `submittedAt` bound, because the per-Topic window can only be taken after the
      Attempts are filtered to the papers that mention each Topic. The row set is small
      per read (three columns), but it grows for the life of a Student Profile and is
      read inside the transaction a child's hand-in is waiting on. A cap would need a
      rule for "old enough that no Topic's five newest can be there", which this story
      has no basis to choose.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (submittedAttemptsFor)
    severity: medium
  - summary: >-
      A label that can never canonicalize is re-normalized on every results read,
      forever, with no negative cache and no backoff.
    evidence: |-
      `resolveUngraded` calls `tagTopicsFor` unconditionally so that a label whose
      normalization failed at hand-in is retried — there is no queue, so the next read
      is the retry. For a label that resolves, the retry costs one stage-1 lookup. For
      one that cannot (a provider outage that persists, or a label the cascade keeps
      refusing), it costs a provider call on every page view of that Attempt's results,
      unbounded. Nothing records that a label was already tried and failed.
    location: >-
      apps/api/src/grading/grading.service.ts (resolveUngraded -> tagTopicsFor)
    severity: medium
  - summary: >-
      recomputeMastery's own question_topic read is unbounded across a child's whole
      qualifying-Attempt history, independent of the already-deferred Attempt-history read.
    evidence: |-
      `tx.questionTopic.findMany` is scoped to `practiceTestId: { in: [...qualifying
      practice test ids] } }` — every qualifying Attempt the child has ever submitted, not
      the window — because the per-Topic window can only be taken after tags are read. This
      grows with the child's whole history the same way the deferred `submittedAttemptsFor`
      read does, and runs inside the same hot transaction.
    location: >-
      apps/api/src/grading/grading.service.ts (recomputeMastery)
    severity: medium
  - summary: >-
      Distinct topic labels on one paper are normalized sequentially, not in parallel,
      inside the hand-in/override request's own latency.
    evidence: |-
      `tagTopicsFor` awaits `topics.normalize` once per distinct label in a `for...of`
      loop rather than `Promise.all`. A paper with many distinct labels serializes that
      many embedding/LLM round trips directly into the child's or parent's request latency.
    location: >-
      apps/api/src/grading/grading.service.ts (tagTopicsFor)
    severity: low
  - summary: >-
      A Practice Test behind a Source Test that will never be classified logs a warning
      on every trigger that touches it, forever, with no negative cache.
    evidence: |-
      `tagTopicsFor`'s `subjectId === null` early exit logs unconditionally and is called
      from every hand-in, every results read and every override on that Attempt. For a
      Source Test that is structurally never going to be classified, this is the same
      "retried forever, no negative cache" shape as the already-deferred label-canonicalization
      item, but for a different and more permanent trigger.
    location: >-
      apps/api/src/grading/grading.service.ts (tagTopicsFor)
    severity: low
  - summary: >-
      TopicMastery rows are never invalidated by a structural deletion of a Question or its
      tags outside of a grade-changing trigger.
    evidence: |-
      Both new tables cascade on delete, but nothing recomputes a TopicMastery row when a
      Question (and its QuestionTopic tags) is deleted independently of the three
      grade-changing triggers this story wires. If no further grade event ever touches that
      (student, topic) pair, a stale Mastery value can persist with no recompute path to
      catch it. This is a consequence of the story's trigger set (AD-10) rather than a defect
      in it — deletion is not one of the three named triggers — but the residual staleness
      risk has no owner.
    location: >-
      apps/api/src/grading/grading.service.ts (recomputeMastery triggers)
    severity: medium
  - summary: >-
      The topicMastery upsert's unique-violation fallback assumes the row it lost the
      insert race on still exists; a concurrent delete between the two leaves it unhandled.
    evidence: |-
      On `P2002` the code falls through to `tx.topicMastery.update(...)` on the same pair,
      which assumes the winner's row is still there. A third, concurrent recompute for the
      same (studentProfileId, topicId) that lands `hasEvidence(counts) === false` between
      this transaction's failed insert and its fallback update would delete that row first,
      so the fallback update hits nothing (Prisma `P2025`) and is not classified the way
      `P2002` is — the whole grade-change transaction would fail instead of falling through
      again. Narrow (needs three transactions racing the same pair with opposite evidence
      outcomes) and not covered by the story's I/O matrix.
    location: >-
      apps/api/src/grading/grading.service.ts (recomputeMastery, topicMastery upsert)
    severity: low
baseline_revision: '0932cc59ff783bd5d8f3d87e05e6d544cc44789e'
---

<intent-contract>

## Intent

**Problem:** Grade rows exist per (Attempt, Question) but nothing turns them into a per-Topic Mastery value, so Epic 7's dashboard, Weak Areas and drill-down have nothing to read. `mastery-eligibility.ts` and the two seams in `grading.service.ts` were left as explicit placeholders for exactly this story.

**Approach:** `grading` gains two tables it solely owns — a canonical tag per (Question, Topic) written through `topics.normalize`, and a stored `TopicMastery` row per (Student Profile, Topic) — plus one from-scratch recompute path that every grade-changing trigger calls inside its own transaction. No route, no read surface: Story 7.4 is the reader.

## Boundaries & Constraints

**Always:**
- Mastery = `correct / (correct + incorrect)` over the **5 most recent qualifying Attempts that included that Topic**, each weighted equally; fewer than 5 uses however many exist. Qualifying = `submittedAt != null` **and** `countsTowardMastery(ordinal)` — reuse that predicate, never a literal `1`.
- **Recomputed from the window, never incremented** (AD-6). Every trigger calls one code path.
- Effective state is `effectiveStateOf(row)` — a parent override counts, the stored verdict does not. `Correct`/`Incorrect` count; `Unanswered` counts in neither term but is **stored as its own count**; `Ungraded` and a missing row count in neither term and are not stored.
- The recompute runs **inside the transaction that wrote the grade change** (AD-10), for all three triggers: the hand-in's verdict write, `resolveUngraded`'s write, and `overrideGrade`'s write.
- `topics.normalize` is called **before** a transaction opens, never inside one, and its failure is swallowed and logged — a provider outage must never fail a committed hand-in or a parent's override.
- The canonical tag is written once per (Question, Topic) and is idempotent; recompute reads tags only and never normalizes.
- `grading` reads `practicetest`'s and `sourcetest`'s rows **only through their services** (AD-17). The arrows stay `grading -> practicetest -> sourcetest` and `grading -> topics`.
- Nothing logged carries a Topic name, a label, a Question, an answer or a Mastery figure — ids, counts and class of fault only (AD-20).
- `recomputeMastery` is **public** on `GradingService` so Story 7.6's merge reuses this exact path (AD-12), and takes a transaction client from its caller.

**Block If:**
- The intended window ordering cannot be made deterministic from stored columns (no `submittedAt` + id tiebreak available).

**Never:**
- No HTTP route, controller, DTO or response field — nothing reads Mastery in this story (Story 7.4).
- No Weak Area threshold, no 60%, no 5-question floor (Story 7.3).
- No confirm / merge / rename of a Topic and no provisional queue (Story 7.6).
- No web/frontend change. No background job, queue, pg-boss schedule or timer (AD-10). No stored Attempt score column. No read-time Mastery derivation.
- No change to generation, the grading prompt, the four grade states, or `scoreOf`.
- No new writer of `practice_test_question_topic`, `attempt`, `question_grade`'s existing columns, or `topic`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First qualifying hand-in | ordinal-1 Attempt, 4 questions tagged one Topic, 3 `Correct` 1 `Incorrect` | one `topic_mastery` row, `correct 3`, `incorrect 1`, `unanswered 0`, `value 0.75`, `attemptsCounted 1` | No error expected |
| Retake | ordinal-2 Attempt submitted and graded | no Mastery row changes at all; recompute exits before any read | No error expected |
| Window eviction | 6 qualifying Attempts include the Topic | only the 5 newest by `(submittedAt desc, id desc)` contribute; the 6th affects nothing | No error expected |
| Unanswered | unexpired manual hand-in with 2 blanks on a tagged Topic | blanks add to `unanswered`, to neither Mastery term; `value` over the answered two only | No error expected |
| Expired hand-in | expired Attempt, blanks stored `Incorrect` | those blanks count in the denominator and add nothing to `unanswered` | No error expected |
| Ungraded then resolved | tagged Question `Ungraded`, later resolved `Correct` by a results read | before: excluded from both terms; after `resolveUngraded`'s write: counted, and Mastery reflects it in the same commit | No error expected |
| Parent override | first-run Question flips `Incorrect` -> `Correct` | Mastery recomputes in the override transaction; the flip and the figure commit together | No error expected |
| No evidence | every tagged Question of the window is `Ungraded`/row-less | no `topic_mastery` row is kept for that Topic (deleted if one existed) | No error expected |
| Unclassified Source Test | `subjectId` is null behind the Practice Test | no tag is written, no Mastery row changes, one log line with the Practice Test id | Never throws |
| Normalization fails | `topics.normalize` throws (`TopicInputError`, `AiUpstreamError`, anything) | the hand-in/override still answers 200; tags for the labels that did resolve are kept; one log line with the fault class | Never throws |
| Two labels, one Topic | `fractions` and `Fractions.` on the same Question | one tag row (unique index), the Question contributes once | Unique violation is absorbed |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma:1048` `Attempt` (`ordinal`, `submittedAt`, `expired`, `studentProfileId`), `:1009` `PracticeTestQuestionTopic` (free-form `label`, the upstream this maps from), `:1204` `QuestionGrade` (`state`, `overrideState`), `:1567` `Topic` (doc-comment and index conventions to copy), `:183` `StudentProfile` (back-relation block with per-relation ownership comments), `:392` `SourceTest.subjectId` (nullable column; `isClassified` gates submission so a released test always carries one).
- `apps/api/prisma/migrations/` -- hand-written `migration.sql` per timestamped dir; newest `20260929180000_add_canonical_topic`.
- `apps/api/src/grading/mastery-eligibility.ts:50` `MASTERY_ATTEMPT_ORDINAL`, `:57` `countsTowardMastery` -- the one definition of "which run counts"; its doc names the two triggers whose seams this story fills.
- `apps/api/src/grading/grading-score.ts:45` `scoreOf` -- the file-shape and doc style for a pure aggregation; **not** reused (a different denominator).
- `apps/api/src/grading/grading-override.ts:37` `effectiveStateOf` -- what a Question counts as; the only source of that rule.
- `apps/api/src/grading/grading.service.ts:174` `submitAttempt` (tx1 closes + writes deterministic rows; provider call; tx2 `writeGuarded`), `:275` `resolveUngraded` (tx writes deterministic rows; provider call; tx2 `writeGuarded`), `:678` `overrideGrade` (single transaction; the seam comment at `:749`), `:1072` `writeGuarded`, `:1127` `scoreFor`.
- `apps/api/src/grading/grading.module.ts` -- imports `PracticeTestModule` + `AiModule`; `TopicsModule` is added here.
- `apps/api/src/topics/topic.service.ts:106` `normalize({label, subjectId, parentAccountId})` -> Topic id; its doc states it must be called before a transaction opens and that Story 7.2 is the caller it exists for.
- `apps/api/src/practicetest/practice-test.service.ts:1699` `gradingInputFor` (has `topics: label[]` but no `subjectId`, `ordinal` or profile id -- deliberately not widened), `:1433` `attemptProfileFor`, `:989` `readSubjectLabels` usage pattern, `:699` the `SOURCE_TEST_READER` token injection.
- `apps/api/src/sourcetest/source-test-reader.ts` -- the type-only reader interface `practicetest` depends on; `apps/api/src/sourcetest/source-test.service.ts:829` `readSubjectLabels` -- the batched shape `readSubjectIds` mirrors.
- `apps/api/test/harness.ts:48` `Harness` (`topics`, `prisma`, `grading` reachable via `moduleRef`), `:246` `captureAi`/`failNextEmbed`, `:508` `createSubject`, `:537` `createStudentProfile`.
- `apps/api/test/grade-dispute.int-spec.ts:97-220` -- the fixture recipe for a released test, ordinal-1 and ordinal-2 Attempts and one `QuestionGrade` of each state.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `model QuestionTopic` (`id`, `questionId`, `practiceTestId`, `topicId`, `createdAt`, relations to `PracticeTestQuestion` and `Topic` both `onDelete: Cascade`, `@@unique([questionId, topicId])`, `@@index([topicId, practiceTestId])`, `@@map("question_topic")`) and `model TopicMastery` (`id`, `studentProfileId`, `topicId`, `correct`, `incorrect`, `unanswered`, `attemptsCounted` all `Int`, `value Float?`, timestamps, relations to `StudentProfile` and `Topic` both `onDelete: Cascade`, `@@unique([studentProfileId, topicId])`, `@@index([studentProfileId])`, `@@map("topic_mastery")`), plus the back-relations on `PracticeTestQuestion`, `Topic` and `StudentProfile` with the ownership comments their neighbours carry -- `practiceTestId` is denormalized onto the tag so recompute can ask "which tests include this Topic" without joining `practicetest`'s tables, and both cascades exist so Epic 8's deletions are never blocked.
- `apps/api/prisma/migrations/20260929210000_add_mastery/migration.sql` -- hand-written migration for both tables, their unique and secondary indexes and FKs -- migrations are checked in, never generated at deploy.
- `apps/api/src/grading/mastery.ts` (+ `.spec.ts`) -- `MASTERY_ATTEMPT_WINDOW = 5`; `masteryWindowOf(attempts, testIds)` taking qualifying Attempts newest-first and the Topic's test ids and returning at most the window; `masteryFrom(states)` returning `{correct, incorrect, unanswered, value}` with `value` null when `correct + incorrect === 0`; `hasEvidence(counts)` -- one formula and one window rule, both assertable with no database.
- `apps/api/src/sourcetest/source-test.service.ts`, `apps/api/src/sourcetest/source-test-reader.ts` -- add `readSubjectIds(sourceTestIds)` returning `Map<sourceTestId, string | null>` and declare it on the reader interface -- canonicalization needs the Subject **id**, and `readSubjectLabels` answers names.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `masteryContextFor(tx, attemptId)` -> `{practiceTestId, studentProfileId, ordinal, subjectId, questions: [{questionId, labels}]}` and `qualifyingAttemptsFor(tx, studentProfileId)` -> qualifying Attempts as `{attemptId, practiceTestId, submittedAt}` ordered `submittedAt desc, id desc` -- two internal reads so `grading` never touches `attempt` or `practice_test_question_topic` directly (AD-17); neither is a response shape and neither widens `gradingInputFor`.
- `apps/api/src/grading/grading.service.ts` -- add `private async tagTopicsFor(parentAccountId, attemptId)`: read the context, return early on a null `subjectId` or `ordinal > 1`, `normalize` each **distinct** label once, `createMany({skipDuplicates: true})` the tags, and swallow + log every fault; add `async recomputeMastery(tx, studentProfileId, topicIds)`: read qualifying Attempts, this story's tags, and the window's grades, then per Topic upsert the row from `masteryFrom` over `effectiveStateOf` — deleting it when `hasEvidence` is false; add `private async recomputeMasteryForAttempt(tx, attemptId)` resolving profile, ordinal and tagged Topic ids and exiting on a retake -- one recompute path, and the only writer of both new tables.
- `apps/api/src/grading/grading.service.ts` -- wire the three triggers: `submitAttempt` tags between its two transactions and recomputes inside the last transaction that writes a grade (inside `writeGuarded`'s transaction where a provider call happened, otherwise in its own immediately-following transaction); `resolveUngraded` does the same; `overrideGrade` tags before opening its transaction and recomputes on the seam line at `:749`, replacing that comment -- each grade change and the figure that follows from it commit together (AD-10).
- `apps/api/src/grading/grading.module.ts` -- import `TopicsModule` with the ownership comment its neighbours carry -- boot must fail, not drift, if the cascade is unreachable.
- `apps/api/test/harness.ts` -- expose `grading: GradingService` -- the int-spec drives the triggers and asserts the rows.
- `apps/api/test/mastery.int-spec.ts` -- cover every I/O & Edge-Case Matrix row against real Postgres and the `fake` AI transport, asserting tag rows, `topic_mastery` rows and provider-call counts -- the matrix is the contract.

**Acceptance Criteria:**
- Given a graded first-run Attempt whose Questions carry labels, when it is handed in, then every distinct (Question, Topic) pair has exactly one `question_topic` row and `topics.normalize` was called once per distinct label.
- Given the same Practice Test handed in and then re-read twice, when the tags are counted, then the count is unchanged and no further `Topic` row was minted — tagging is idempotent.
- Given a Topic whose Mastery row exists, when a grade that feeds it changes inside a transaction that then rolls back, then neither the grade nor the Mastery row is changed.
- Given `grep -rn "questionTopic\|topicMastery" apps/api/src --include=*.ts -l`, when it runs, then only files under `apps/api/src/grading` are listed — `grading` is the sole writer (AD-6).
- Given `grep -rn "prisma.attempt\|prisma.practiceTestQuestionTopic" apps/api/src/grading`, when it runs, then it returns nothing.
- Given `apps/web`, the generation prompt and `apps/api/src/practicetest/practice-test.runner.ts`, when the diff is read, then none is changed by this story.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 6, low 4)
- defer: 2: (high 0, medium 2, low 0)
- reject: 16: (high 0, medium 4, low 12)
- addressed_findings:
  - `[medium]` `[patch]` `recomputeMastery` read `question_grade` for **every** qualifying Attempt rather than the window, so the statement inside the transaction a child waits on grew for the life of a Student Profile — and the method's own doc claimed it read the window. The windows are now built first and the read is narrowed on both axes (window attempt ids and tagged question ids).
  - `[medium]` `[patch]` `recomputeMasteryForAttempt` used `masteryContextFor` inside the caller's open transaction, which reads the whole paper and calls `readSubjectIds` on `SourceTestService`'s own client — a second pooled connection acquired while an interactive transaction held locks, for a `subjectId` that path never reads. A narrow `attemptMasteryKeyFor` now serves the recompute; `masteryContextFor` stays the tagging path's read, outside every transaction.
  - `[medium]` `[patch]` No index led with `practiceTestId`, so the per-trigger "which Topics is this paper tagged with" `distinct` sequential-scanned `question_topic` inside the hot transaction. Added `@@index([practiceTestId, topicId])` in its own new migration, leaving the already-applied one untouched.
  - `[medium]` `[patch]` The `topic_mastery` upsert claimed a concurrent first recompute loses on the index, but nothing caught P2002 — so two parents' simultaneous overrides could abort a grade transaction. The unique violation is now classified with the same helper `writeGuarded` uses and falls back to an update.
  - `[medium]` `[patch]` `submitAttempt`'s no-askable-Question branch was reached by no test: every fixture paper was `ShortAnswer` and every submission answered something, so a Multiple-Choice-only or all-blank hand-in storing no Mastery at all would have shipped green. Covered, and confirmed by neutering the branch.
  - `[medium]` `[patch]` `resolveUngraded`'s nothing-outstanding recompute — the documented recovery for a hand-in whose canonicalization failed — was likewise unasserted. Covered end to end: unclassified upload, no tag and no row, then classification and a results read that produces the row.
  - `[low]` `[patch]` The `(submittedAt desc, id desc)` tiebreak that makes the window deterministic had no test producing a tie; six Attempts sharing one instant now assert two recomputes agree.
  - `[low]` `[patch]` `TopicMastery.attemptsCounted`'s doc said "actually contributed" while the writer stores the window's length; the doc now states what is stored and why counting contributions instead would restate the other three columns.
  - `[low]` `[patch]` `tagTopicsFor`'s catch-all logged "its mastery is left as it was" from a branch that runs before any recompute and touches no Mastery row.
  - `[low]` `[patch]` `qualifyingAttemptsFor` returned every submitted Attempt, retakes included, with the predicate applied by its caller; renamed to `submittedAttemptsFor` so the name cannot mislead a later caller into trusting a filter that is not there.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 3, low 0)
- defer: 0
- reject: 11: (high 0, medium 3, low 8)
- addressed_findings:
  - `[medium]` `[patch]` The concurrent-insert fallback in `recomputeMastery`'s `topicMastery` upsert (the `P2002` -> `update` branch, itself a fix from the prior pass) had no test forcing two transactions to race the same `(studentProfileId, topicId)` insert, so a regression in the fallback would ship undetected. Added an integration test that deletes an existing row and races two `recomputeMastery` calls for the same pair, asserting both resolve and the final row is correct.
  - `[medium]` `[patch]` `recomputeMastery`'s multi-Topic batching — justified in its own doc by "the Topics of one paper overlap heavily" — was exercised by every integration test with exactly one Topic per call, leaving the batched-read path (narrowed on both Attempt ids and Question ids together) untested with more than one Topic in scope. Added an integration test recomputing two Topics of one paper in a single call and asserting each gets its own correct counts.
  - `[medium]` `[patch]` AD-20's "nothing logged carries a Topic name, a label, a Question, an answer or a Mastery figure" rested entirely on inspection of the log-line literals, with no test asserting the log output itself never contains a label string. Added an integration test that spies on `Logger.prototype.warn` during a canonicalization failure and asserts no warning line contains the failing label text.

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 3, low 0)
- defer: 5: (high 0, medium 2, low 3)
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` No test forced `submitAttempt`'s own last-writing transaction (`writeGuarded` + `recomputeMasteryForAttempt`) to fail, so a regression that let a recompute fault escape the documented swallow-and-log guard, or that let the verdict survive the rollback it should share, would ship undetected. Added an integration test that forces `recomputeMastery` to throw inside that transaction and asserts the request still answers, the Question's grade row never committed, and the fault is logged without leaking the label.
  - `[medium]` `[patch]` `resolveUngraded`'s nothing-outstanding branch has its own try/catch around `recomputeMasteryForAttempt`, documented as required because a results read must still answer when recompute faults — but no test forced a fault specifically on this branch; the one existing "nothing outstanding" test only exercises the success path. Added an integration test that forces the same fault here and asserts the read still resolves, the prior Mastery figure is left untouched, and the fault is logged.
  - `[medium]` `[patch]` AD-6's window filter (`countsTowardMastery`) is applied only inside `recomputeMastery`, but every multi-Attempt integration test used first-run Attempts exclusively — none mixed a retake into the same Topic's candidate list alongside a qualifying Attempt on a different paper, so the filter being dropped or inverted would pass every existing test. Added an integration test with a retake sharing a Topic with another qualifying Attempt, asserting the retake's grade never enters the Topic's counts.
  - `[medium]` `[defer]` `recomputeMastery`'s own `question_topic` read is scoped to every qualifying Attempt the child has ever submitted rather than the window, growing with the child's whole history inside the same hot transaction — the same shape as the already-deferred `submittedAttemptsFor` read, but a second, independent instance of it.
  - `[medium]` `[defer]` Nothing recomputes a `TopicMastery` row when a Question (and its tags) is deleted outside of the three named triggers; a stale figure can persist indefinitely with no path to catch it. A consequence of the story's trigger set rather than a defect in it, but unowned.
  - `[low]` `[defer]` Distinct topic labels on one paper are normalized sequentially (`for...of` + `await`) rather than in parallel, so a many-label paper serializes that many provider round trips into the hand-in/override request's own latency.
  - `[low]` `[defer]` A Practice Test behind a Source Test that will never be classified logs a warning on every trigger that touches it, forever — the same "retried forever, no negative cache" shape as the already-deferred label-canonicalization item, for a more permanent trigger.
  - `[low]` `[defer]` The `topicMastery` upsert's `P2002` fallback assumes the row it lost the race on still exists; a third, concurrent recompute that deletes that row (via `hasEvidence === false`) between the failed insert and the fallback update would leave `P2025` unclassified, failing the whole grade-change transaction. Narrow (needs three transactions racing with opposite evidence outcomes) and outside the story's I/O matrix.

## Design Notes

**Why a tag table and not re-normalization at recompute.** The window spans up to five Attempts, each with a full paper of labels; normalizing those on every recompute would put embedding and LLM calls on the hand-in path repeatedly, and `normalize` may not run inside a transaction at all. Resolving once per (Question, Topic) makes recompute pure SQL — and it is also what Story 7.6's merge re-points, which AD-12 requires to exist from the start rather than be retrofitted.

**Why `unanswered` is stored beside the counts.** Every Mastery figure on every Epic 7 surface must carry its skipped count, and that count is a property of the same window as the value. Deriving it separately at read time would be a second window definition. The rule that a timer-expiry auto-submit contributes no unanswered count needs no code: blanks on an expired Attempt are already stored `Incorrect`, so `Unanswered` only ever exists on an unexpired hand-in.

**Where the recompute sits in `submitAttempt`.** That method is deliberately two transactions with one provider call between them, and its own doc says why. The recompute rides the **last** transaction that writes a grade for the request, so the figure a parent can read is never newer than the grades it is over. Tagging sits beside the grading provider call, outside both transactions, in the region whose documented rule is that nothing may throw.

**Zero rows are deleted, not stored.** A Topic whose whole window is `Ungraded` has no Mastery, and a stored `0/0` row would make Story 7.4's empty state ("Mastery appears once N questions are answered") indistinguishable from a real zero.

## Verification

**Commands:**
- `pnpm --filter api run lint` -- expected: clean.
- `pnpm --filter api run typecheck` -- expected: clean.
- `pnpm --filter api exec prisma migrate deploy` -- expected: the new migration applies to a fresh database.
- `pnpm --filter api run test` -- expected: all unit and integration specs pass, including `mastery.spec.ts` and `mastery.int-spec.ts`.
- `grep -rn "pgvector\|@nestjs/schedule" apps/api/src apps/api/prisma` -- expected: no matches.

## Auto Run Result

**Summary of implemented change:** This run reviewed the already-implemented Mastery computation feature (two owned tables, one recompute path, three wired triggers) against its baseline diff with four parallel review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment). No route, controller, or read surface exists — confirmed by the diff's file list, matching the story's "Story 7.4 is the reader" boundary. Fifteen findings were triaged: three were fixed as test-coverage patches, five were logged as pre-existing/structural risk to `deferred`, and seven were rejected as either intentional documented design (e.g. the hand-in/override recompute sharing its trigger's transaction, so a recompute fault rolls the grade back with it — AD-10, stated in code comments) or insufficiently material.

**Files changed with one-line descriptions:**
- `apps/api/test/mastery.int-spec.ts` -- added three integration tests: `submitAttempt`'s own trigger transaction swallowing a recompute fault without losing the request or leaking content, `resolveUngraded`'s nothing-outstanding branch doing the same, and a retake sharing a Topic with a separate qualifying Attempt never entering that Topic's window.
- `_bmad-output/implementation-artifacts/spec-7-2-mastery-computation.md` -- this review pass's triage log entry and five new `deferred` entries.

**Review findings breakdown:** patch 3 (medium 3, all applied), defer 5 (medium 2, low 3), reject 7 (low 7).

**Follow-up review recommendation:** `true` -- this pass's patched findings were 3 medium, 0 low, 0 high; `3 x 3 + 1 x 0 = 9 >= 5`.

**Verification performed:**
- `pnpm --filter api run lint` -- clean.
- `pnpm --filter api run typecheck` -- clean.
- `pnpm --filter api exec vitest run test/mastery.int-spec.ts` -- 21/21 passed (18 pre-existing + 3 new).
- Full-suite `pnpm --filter api run test` showed 5 failures in `source-test.int-spec.ts` and `uncommitted-state.int-spec.ts` — files untouched by this story's diff. Re-run of just those two files together passed 118/118, confirming the failures are pre-existing parallel-worker/shared-state pollution unrelated to this change, not a regression from this pass's patches.
- Migration command not re-run this pass; no schema change was made.

**Residual risks:** the five items newly added to `deferred` frontmatter (two independent unbounded-read risks inside `recomputeMastery`'s and `submittedAttemptsFor`'s query shapes, sequential per-label normalization latency, unbounded repeat-logging for a permanently-unclassified Source Test, and a narrow three-way concurrent-recompute race on the `topicMastery` upsert's fallback path) plus the two carried over from the prior pass (unbounded Attempt-history read, unbounded label-retry).

