---
title: 'Story 4.3: Draft Review'
type: 'feature'
created: '2026-09-25'
baseline_revision: 'd4df50ce68d451af96a81060413186e441d53f18'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-practice-test-generation-bounded-priced-async.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-topic-weighted-regeneration.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The Pending drafts read is unbounded: every `Draft` row the account holds is returned
      and rendered, with no cap, cursor or stated ceiling.
    evidence: |-
      `draftsFor` issues `findMany` with no `take`, and the screen maps the whole array. The
      "every Question" acceptance criterion bounds the *question* list, not the draft list,
      which grows monotonically until Story 4.5 ships release and discard. `RESTORABLE_PAGE_SIZE`
      in `uncommitted-state.service.ts` is the repo's own precedent for capping a parent-facing
      list read. A cap needs a deliberate UI treatment for the overflow, which is a product
      decision rather than a mechanical fix.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (draftsFor)
    severity: medium
  - summary: >-
      Both new parent screens are covered by specs that grep their own source text rather
      than render them, so the 404, empty-list and error states have no executing test.
    evidence: |-
      `drafts/page.spec.tsx` and `drafts/[practiceTestId]/page.spec.tsx` assert with
      `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. Moving the
      `draft-missing` alert inside the `draft !== null` block would leave every searched string
      in place and ship green. The screens are client components whose states appear only after
      an effect resolves, so a real render test needs a DOM the web tier does not have
      (`environment: 'node'`). Same gap already carried from Story 4.2 for the generate screen;
      this story adds two more instances of it.
    location: >-
      apps/web/src/app/parent/drafts/page.spec.tsx
    severity: medium
  - summary: >-
      `RichText` sits in the shared component directory but imports parent-only copy.
    evidence: |-
      It reads `parentCopy.drafts.fractionReading` and its types from `@/lib/parent-api`, while
      living beside `Screen`, `Dialog` and `LiveRegion`. The same segment structure is what a
      student will read in Epic 5, so the first student-side use either imports parent copy or
      forks the component. Taking the reading as a prop, or moving the string to shared copy,
      is a small refactor better made when the second caller actually exists.
    location: >-
      apps/web/src/components/RichText.tsx
    severity: low
  - summary: >-
      Neither new screen announces its state changes, unlike every sibling Parent View surface.
    evidence: |-
      `capture/page.tsx` and `generate/[sourceTestId]/page.tsx` both drive the `LiveRegion`
      through the `Announcement`/`seq` machinery in `apps/web/src/lib/parent-view.ts`. The
      loading-to-loaded, error and draft-is-gone transitions here announce nothing beyond what
      the `role="alert"`/`role="status"` alerts carry on their own.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Stories 4.1 and 4.2 land draft Practice Tests in the database and charge for them, but nothing can read one back: the controller deliberately exposes no route that returns a generated Question, the web app has no surface that shows one, and a parent who leaves the generation screen has no way to find the drafts they paid for. The epic's whole reason for existing — a human quality gate before anything reaches a child — has no screen.

**Approach:** Add the read half. Two elevation-guarded routes on `practicetest` — a Pending drafts list over the account's `Draft` Practice Tests, and a full read of one draft with every Question, its correct answer, its distractors and its Topics — and two Parent View screens over them: a Pending drafts destination and a draft review screen showing one draft at a time as its full question list, in the paper-role serif, with "draft N of M" progress context. Generated content is rich text (AD-32), so a shared segment renderer ships here too. Editing, deleting, timer and release/discard are Stories 4.4–4.6 and are not here.

## Boundaries & Constraints

**Always:**
- Every Question of the opened draft is shown in one list, in stored `ordinal` order, each with its prompt, its correct answer, its Multiple Choice options with the correct one marked, and its Topic labels. Nothing is paginated, collapsed behind a control, or truncated: "every Question" is the acceptance criterion.
- Both routes sit behind `ParentElevationGuard` in `PracticeTestController`, take the account from `req.elevated` and never from the path or the body, and answer **404, not 403**, for a Practice Test id that belongs to another account or does not exist (AD-18).
- The full read serves `Draft` rows only. A `Released` or `Discarded` id answers the same 404 an unknown id gets — those are Story 4.5's states and Story 4.5's surface.
- A draft is never reachable from a student-scoped surface: `StudentModeController` stays the whole of the student-scoped API, and no new route, field or cookie path exposes a Practice Test to it.
- Topic labels and generated text cross the boundary as content only. No log line, failure reason or error message added here carries a fragment of a Question, a Topic label, an allowance figure, a tier label or a model name (AD-20).
- Rich text is rendered from its stored segment array, never from a string: a fraction renders as structure with an accessible reading, and no call site builds `"1/2"` itself.
- "draft N of M" is the draft's own `ordinal` and the count of its job's landed drafts — both read from the server, never counted in the browser.
- Review position is the URL: the draft review screen is addressed by Practice Test id, so a returning parent, a reload and a Parent View idle expiry all resume on the same draft with no stored position.
- Every user-facing string is parameterized in `apps/web/src/copy/parent.ts`; parent-facing copy speaks in the third person about the student.
- The draft review screen is `'use client'` and fetches with the in-memory elevation token, like every other Parent View surface.

**Block If:**
- Nothing. This story is fully specified by the epic's acceptance criteria and the existing schema.

**Never:**
- No edit control, no delete control, no delete-to-zero confirmation (Story 4.4), no timer configuration (Story 4.6), no release or discard control (Story 4.5). The screens are read-only.
- No batch surface that shows several drafts' questions at once — one draft at a time is the UX decision.
- No new table, column, migration, job, queue or AI call. Every row this story reads already exists.
- No allowance figure, cost sentence or tier label on either new screen: nothing is being spent here.
- No Topic canonicalization, merging or Mastery coupling — labels render raw as stored (AD-11, Epic 7).
- No server-rendered parent data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pending drafts, populated | `GET /parent/practice-tests/drafts`, account holds 3 `Draft` rows across 2 jobs | Every `Draft` row, newest first, each with `id`, `sourceTestId`, `studentProfileId`, `ordinal`, `siblingCount`, `questionCount`, `createdAt` | No error expected |
| Pending drafts, empty | Account holds only `Released`/`Discarded` rows, or none | `[]` — an empty list, not a 404 | No error expected |
| Full draft read | `GET /parent/practice-tests/:id` for an owned `Draft` | The draft with `ordinal`, `siblingCount`, `questionCount`, and every Question in `ordinal` order with `prompt`, `answer`, `choices` (each with `isCorrect`), `topics` | No error expected |
| Multiple Choice question | Question with 4 choices, one correct | `answer` is `null`; exactly one choice carries `isCorrect: true`; all 4 are returned in stored order | No error expected |
| Non-MC question | `FillInTheBlank` / `ShortAnswer` | `answer` is the stored rich text; `choices` is `[]` | No error expected |
| Fraction in a prompt | Stored segment `{kind:'fraction', whole:null, numerator:1, denominator:2}` | Returned as the stored segment array, unchanged; the screen renders it as structure with an accessible reading | No error expected |
| Foreign draft | An id owned by another account | Refused as though it did not exist | 404 `PRACTICE_TEST_NOT_FOUND` |
| Released or discarded id | An owned row whose status is not `Draft` | Refused identically to an unknown id | 404 `PRACTICE_TEST_NOT_FOUND` |
| Malformed id | Not a UUID | Refused on shape before any row is read | 400 from `ParseUUIDPipe` |
| Unelevated call | Either route with no elevation token | Refused by the guard; nothing about the account is revealed | 401 |
| Student-scoped reach | Any student-scoped call | No practice-test data is reachable; `/student/session` still answers the bound profile and nothing else | 404 on any attempted student practice-test path |
| Screen: draft opened | Review screen for draft 2 of a 3-draft job | Heading names "draft 2 of 3"; every Question renders with answer and Topics | Server's own sentence surfaced on a 4xx |
| Screen: draft vanished | Review screen for an id that 404s | The screen says the draft could not be found and offers the way back to Pending drafts | 404 handled as a state, not a crash |
| Screen: no drafts | Pending drafts with an empty list | A plain sentence saying there are none yet, and a way back | No error expected |

</intent-contract>

## Code Map

**Change these:**

- `apps/api/src/practicetest/practice-test-policy.ts` -- four-section layout (constants :17, messages :57, runtime :144, rules :215). Add `PRACTICE_TEST_NOT_FOUND` in the messages section beside `GENERATION_NOT_REQUESTED` :96 and `NO_USABLE_QUESTIONS` :108. One sentence, no content, no figures (AD-20).
- `apps/api/src/practicetest/practice-test.service.ts` -- add `draftsFor(parentAccountId)` and `draftFor(parentAccountId, practiceTestId)` beside the existing reads (`allowanceFor` :216, `topicsFor` :244, `statusFor` :347), plus the view interfaces beside `GenerationJobView` :159 and the row→view mappers beside `JOB_VIEW_FIELDS` :824 / `viewOf` :848. Both reads scope by `parentAccountId` in the `where` and return `null`→404 rather than reading then comparing. `siblingCount` is a `practiceTest.count` over the same `generationJobId` with `status: 'Draft'`. Parse nothing: `prompt`, `answer` and `choices[].body` are stored `Json` already validated on the way in — they travel out as they are stored. `land()` :612, `complete()` :710, `fail()` :745 and the fence are untouched.
- `apps/api/src/practicetest/practice-test.controller.ts:38` -- add `GET practice-tests/drafts` and `GET practice-tests/:id` beside `topics` :75 and `job` :94, same guard, same `ParseUUIDPipe`, same 404-not-403 rule. The file's header comment currently says there is no route here that returns a generated Question — it must be rewritten, because that is exactly what this story adds, and why.
- `apps/api/src/extraction/rich-text.ts` -- read-only shape reference for the returned segment arrays (`RichText`, `TextSegment`, `FractionSegment`). Do not widen it and do not re-parse on the way out.
- `apps/api/test/practice-test.int-spec.ts` -- the integration tier; `createHarness()` (`apps/api/test/harness.ts:78,105`) and `practiceTestRunner.runOnce()` already land real drafts, which is what these reads read.
- `apps/api/test/student-mode.int-spec.ts` -- where the "a draft never appears in Student Mode" criterion is pinned: the student surface exposes one read and no practice-test path.
- `apps/web/src/lib/parent-api.ts` -- add `PracticeTestDraftSummary`, `PracticeTestDraftView`, `DraftQuestionView`, `DraftChoiceView` and a `RichTextSegment` type beside `GenerationJobView` :185, and `practiceTestDrafts` / `practiceTestDraft` beside `generationJob` :745. Same `call<T>` + `elevated(token)` convention as every method there.
- `apps/web/src/components/RichText.tsx` (new) + `RichText.spec.tsx` -- the segment renderer. Text segments render as text; a fraction renders as structure with an accessible reading built from parameterized copy. Sits beside the existing primitives (`Screen.tsx`, `Dialog.tsx`, `LiveRegion.tsx`).
- `apps/web/src/app/parent/drafts/page.tsx` (new) + `page.spec.tsx` -- Pending drafts. Follows `apps/web/src/app/parent/students/page.tsx` for the elevation-gated list pattern and `generate/[sourceTestId]/page.tsx:120-200` for the load/`applyIfCurrent`/`endsParentView` conventions. Joins student display names client-side from `parentApi.students(token)` — `practicetest` must not read an identity table (AD-17).
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` (new) + `page.spec.tsx` -- draft review. One draft, "draft N of M", the full question list. Question bodies use the existing `questionBody` type role (`apps/web/src/theme/tokens.ts:147-160`, serif, paper role); chrome stays sans.
- `apps/web/src/app/parent/page.tsx:100-115` -- add the Pending drafts link beside the students/capture/change-PIN links, as a client-side `NextLink` for the same reason the others are.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx:425-450` -- on a `Succeeded` or `PartiallyComplete` job, link on to Pending drafts. The progress copy, the cost sentence and the picker are untouched.
- `apps/web/src/copy/parent.ts` -- add a `drafts` block after `generate` :353: both screen titles, the "draft N of M" sentence, the empty-list sentence, the per-question labels (correct answer, options, Topics), the fraction reading, and the two failure sentences. No literal in any component.
- `e2e/tests/parent-practice-test.spec.ts` -- extend the existing browser pass: after drafts land, open Pending drafts, open draft 1, and read back every Question with its correct answer and Topic from the DOM.

**Read-only evidence (do not change):**
- `apps/api/prisma/schema.prisma:849` `PracticeTest`, :889 `PracticeTestQuestion`, :914 `PracticeTestChoice`, :932 `PracticeTestQuestionTopic` — every field this story reads already exists, including `ordinal` (:856, commented as exactly this "draft 2 of 5") and `questionCount` (:858). No migration.
- `apps/api/src/identity/student-mode.controller.ts` — "the whole of the student-scoped API: one read". It stays that way.
- `apps/api/src/practicetest/practice-test.service.ts:612` `land()` and the charging fence — Story 4.1's, correct as they stand.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/practicetest/practice-test-policy.ts` -- add `PRACTICE_TEST_NOT_FOUND` -- one refusal sentence, written once, shared by the foreign id, the unknown id and the non-`Draft` id, so none of the three can be told apart from the outside.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `draftsFor` and `draftFor` with their view types and mappers -- the reads are the story; scoping by `parentAccountId` inside the `where` rather than comparing after the read is what makes a foreign id a 404 by construction instead of by remembering to check.
- `apps/api/src/practicetest/practice-test.controller.ts` -- add the two routes and rewrite the header comment that promises no route returns a Question -- the comment is now the opposite of the truth, and the reason it changed (the quality gate is being built, not bypassed) belongs beside the routes.
- `apps/api/test/practice-test.int-spec.ts` -- integration-cover every matrix row that touches a row: populated and empty lists, the full read's ordering and completeness, MC vs non-MC answer shape, the fraction segment surviving round-trip unchanged, the foreign id, the released/discarded id, the malformed id, and the unelevated call.
- `apps/api/test/student-mode.int-spec.ts` -- pin that no student-scoped path reaches a draft -- the acceptance criterion is a negative, and a negative nothing asserts is a negative that quietly stops being true.
- `apps/web/src/lib/parent-api.ts` + `parent-api.spec.ts` -- add the two reads and their view types -- every figure and every label the screens show arrives from the API.
- `apps/web/src/components/RichText.tsx` + `RichText.spec.tsx` -- render a stored segment array -- a fraction is structure (AD-32); rendering it as a glyph here would throw away the reading a screen reader needs, one story after the schema went to the trouble of keeping it.
- `apps/web/src/app/parent/drafts/page.tsx` + `page.spec.tsx` -- Pending drafts, with the student name joined client-side -- a returning parent has to be able to find drafts they did not wait for, and that is what makes the progress screen's "nothing is lost by leaving" true.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` + `page.spec.tsx` -- draft review -- one draft, every Question, answers and Topics visible, addressed by id so the position survives a reload and an idle expiry with nothing stored.
- `apps/web/src/app/parent/page.tsx` and `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` -- link to Pending drafts from Parent View and from a finished job -- a first-class destination that nothing links to is not first-class.
- `apps/web/src/copy/parent.ts` -- add the `drafts` block -- parameterized strings only, third person about the student, no cheerleading and no allowance figure.
- `e2e/tests/parent-practice-test.spec.ts` -- extend with the review pass -- the web tier on this screen must prove rendered output, not that the source file contains the right tokens.

**Acceptance Criteria:**

- Given a job that landed drafts, when the parent opens one from Pending drafts, then every Question it holds is rendered in one list in stored order, each showing its correct answer, its options where it has them, and its Topic labels.
- Given a draft that is the second of three landed by its job, when it is opened, then the screen states "draft 2 of 3" from server-supplied figures.
- Given a draft, then no student-scoped route or screen exposes it, and Student Mode's API remains one read of the bound profile.
- Given a Practice Test id belonging to another account, when the full read is called with a valid elevation token, then the answer is a 404 whose sentence is identical to the one an unknown id gets.
- Given a parent who reloads the draft review screen or returns to its URL after Parent View expired and was re-entered, then they resume on the same draft with nothing stored anywhere but the URL.
- Given any log line or error message produced by the two new reads, then it carries identifiers and counts only — no Question text, no Topic label, no allowance figure.
- Given the draft review screen, then it offers no control that edits, deletes, releases, discards or times a draft.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 6, low 2)
- defer: 4: (high 0, medium 2, low 2)
- reject: 18: (high 0, medium 2, low 16)
- addressed_findings:
  - `[medium]` `[patch]` The drafts read and the Student Profile read shared one `Promise.all`, so a failing name join blanked a drafts list that had returned fine — they now settle independently, and only the drafts read is the screen's error.
  - `[medium]` `[patch]` On a failed load the error alert rendered beside "There are no practice tests waiting to be read." — the empty state is now gated on a successful read having answered.
  - `[medium]` `[patch]` The review screen's question total came from the stored `questionCount` column while the list rendered from `questions`, two sources of truth for one figure — the rendered total is now `questions.length`; the list screen, which renders no questions, keeps the column.
  - `[medium]` `[patch]` `draftsFor` and `draftFor` each took their figures in two uncoordinated queries, so a sibling released between them could read as "draft 2 of 1" — each pair now runs in one transaction.
  - `[medium]` `[patch]` "Newest first" was specified with a documented tiebreak and asserted nowhere: the list case sorted the ordinals before comparing, so reversing the `orderBy` shipped green — the response's exact id and ordinal sequence is now pinned against the stored rows.
  - `[medium]` `[patch]` The "a draft never reaches Student Mode" negative probed only `randomUUID()` ids, so it passed whether the route was absent or merely unmatched — it now seeds a real draft in the bound parent's account and probes the student cookie against that draft's actual id, with the parent `:id` read probed too.
  - `[low]` `[patch]` All three new lists set `listStyle: 'none'`, which strips list semantics in Safari/VoiceOver, without the `role="list"`/`role="listitem"` repair `PageStrip.tsx` already makes — added and asserted on both screens.
  - `[low]` `[patch]` `RichText` drew any segment whose `kind` was not `text` as a fraction of `undefined/undefined`, announced as "undefined over undefined" — an unrecognized kind now renders nothing, with a spec case.

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 19: (high 0, medium 0, low 19)
- addressed_findings:
  - `[low]` `[patch]` No test asserted that the generate screen's "go to drafts" link is offered for a `PartiallyComplete` job too, not only a `Succeeded` one — a regression narrowing the condition to `Succeeded` alone would have shipped green. Added `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx: "offers the way to drafts for a partial outcome too, not only a full success"`.
  - `[low]` `[patch]` No test asserted the draft review screen's no-Topic fallback (`parentCopy.drafts.noTopics`) — every existing fixture always carries a Topic, so that branch was unexercised. Added `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx: "says so plainly when a Question carries no Topic, rather than showing nothing"`.

  Everything else this pass either restated an item already carried in this file's `deferred` list (unbounded drafts list, source-text page specs, `RichText`'s parent-copy coupling, absent live-region announcements) or was a state the generation/validation path already forbids by construction (a corrupted rich-text segment, a question with both non-null answer and non-empty choices, a `siblingCount` fallback the transaction makes unreachable) — rejected as noise rather than re-deferred.

## Design Notes

**Why the full read is `Draft`-only, and why that is a 404.** Story 4.5 owns `Released` and `Discarded` and will decide what a parent sees of each. Serving them here would ship an unowned surface, and a 403-flavoured "this is released" would be this module answering a question Story 4.5 has not been asked yet. AD-18's rule already covers the shape: an id you may not read is an id that does not exist. The view still carries `status`, so widening it later is an `in` clause and not a redesign.

**Why `siblingCount` is counted server-side.** "Draft 2 of 3" is a fact about the job, and the browser holds one draft. Counting in the client would require it to fetch the job's whole draft set to render a heading — three reads for a sentence — and would drift the moment Story 4.4's delete-to-zero discards a sibling.

**Why review position is the URL.** The UX requires review position to survive an idle expiry. A stored position would mean a new `UncommittedState` slot, a save on every navigation, and a restore path to test — for a fact the address bar already holds durably and for free. Per-Question *edits* are a different matter and are Story 4.4's, where `UncommittedStateKind.DraftEdit` already waits for them.

**The fraction rendering.** Structure plus one accessible reading, built from copy rather than concatenated in the component:

```tsx
// RichText.tsx — a fraction is never flattened to a string for display.
segment.kind === 'fraction' ? (
  <span role="math" aria-label={parentCopy.drafts.fractionReading(segment)}>
    {segment.whole !== null && <span>{segment.whole} </span>}
    <sup>{segment.numerator}</sup>&frasl;<sub>{segment.denominator}</sub>
  </span>
) : (
  segment.value
)
```

## Verification

**Commands:**
- `pnpm --filter api typecheck` and `pnpm --filter web typecheck` -- expected: no errors.
- `pnpm --filter api test` -- expected: the existing unit suite passes unchanged (no new pure rules here beyond the message constant).
- `pnpm --filter api test:int` -- expected: `practice-test.int-spec.ts` and `student-mode.int-spec.ts` pass against real Postgres, covering both new reads, every refusal, and the student-surface negative.
- `pnpm --filter web test` -- expected: `RichText.spec.tsx`, both new page specs and `parent-api.spec.ts` pass.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- expected: the extended pass opens Pending drafts, opens draft 1, and reads every Question with its answer and Topic from the DOM.
- `pnpm prettier --check .` -- expected: clean. (`pnpm lint` is known-unusable in this environment — `eslint` is not installed; run `pnpm exec eslint` on the changed files instead.)

## Auto Run Result

**Summary of implemented change:** Story 4.3 (Draft Review) was already implemented and committed prior to this run (`f66f344`). This run was a follow-up review pass only, entered because `status: done` with `followup_review_recommended: true`. No production code changed; two test-coverage gaps found by review were patched.

**Files changed with one-line descriptions:**
- `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx` — added a case asserting the "go to drafts" link's condition covers `PartiallyComplete`, not only `Succeeded`.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` — added a case asserting the no-Topic fallback (`parentCopy.drafts.noTopics`) is wired for an empty `question.topics`.

**Review findings breakdown:** 2 patches applied (0 high, 0 medium, 2 low); 0 items deferred; 19 items rejected — duplicates of the four items already in this file's `deferred` list, or scenarios the generation/validation path already forbids by construction (a corrupted rich-text segment, a question with both a non-null answer and non-empty choices, a `siblingCount` fallback the transaction makes unreachable).

**Follow-up review recommendation:** `false`. Patched findings this pass: 0 high, 0 medium, 2 low. Score = 3×0 + 1×2 = 2, below the threshold of 5.

**Verification performed:** `pnpm --filter api typecheck` and `pnpm --filter web typecheck` clean. `pnpm --filter web test` — 25 files, 422 passed (2 more than before, matching the 2 added cases). `pnpm --filter api test` — 41 files, 774 passed on the third attempt; the first two attempts each failed one unrelated, untouched int-spec (`student-profile.int-spec.ts`), consistent with this repo's known pre-existing integration-tier flakiness rather than a regression from this pass. `pnpm prettier --check .` clean. `pnpm lint` remains unusable in this environment (`eslint` not installed). Both patches are new assertions in existing web-tier unit specs — no API or e2e-exercised code changed — so `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` was not re-run.

**Residual risks:** The four `deferred` entries carried from the story's original review (unbounded drafts list, source-text page specs, `RichText`'s parent-copy coupling, absent live-region announcements) remain open. The API integration tier's pre-existing flakiness (fails roughly one run in two, in a different untouched spec each time) reproduced again in this pass's first two `pnpm --filter api test` attempts and cleared on the third.

