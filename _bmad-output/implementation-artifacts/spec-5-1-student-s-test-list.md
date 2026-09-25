---
title: "Story 5.1 — Student's Test List"
type: 'feature'
created: '2026-09-25'
status: 'in-progress'
baseline_revision: 'd9f21c2ea98bc4a54cb9d0ce69b4d245093e5a90'
review_loop_iteration: 2
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The student list loads every Attempt row of every released test to derive
      state and the completed band's order.
    evidence: |-
      `releasedFor` selects `attempts: { select: { submittedAt: true } }` with no
      bound. Rows are allowance-bounded, but Attempts per row are not once
      retakes exist (Story 5.7). Both facts needed are aggregates: whether any
      `submittedAt` is null, and the maximum non-null one.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (releasedFor)
    severity: low
  - summary: >-
      Nothing constrains how many Attempts of one Practice Test may be open at
      once.
    evidence: |-
      The `attempt` table permits any number of rows with `submittedAt` null for
      one `practiceTestId`, and `studentListState` tolerates it. If "at most one
      open sitting" is the intended invariant it belongs as a partial unique
      index, and it is cheapest to add while the table has no writer.
    location: >-
      apps/api/prisma/schema.prisma (model Attempt)
    severity: low
  - summary: >-
      Band 1 of the student list orders by generation time because no release
      instant is stored.
    evidence: |-
      There is no `releasedAt` column, so a test generated last week and released
      today sorts below one generated this morning. The acceptance criterion says
      only "newest-first within each band" and does not name the instant, so this
      is defensible -- but it is a modelling limitation worth a decision if the
      distinction ever matters to a child.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (releasedFor)
    severity: low
  - summary: >-
      Nothing constrains `submittedAt` to fall at or after `startedAt` on an
      Attempt row.
    evidence: |-
      The table has no CHECK constraint, so a negative-duration sitting is
      storable. No writer exists yet -- Story 5.2 owns it -- so this is cheapest
      to decide alongside that writer, together with the one-open-sitting
      question already deferred above.
    location: >-
      apps/api/prisma/migrations/20260925130000_add_attempt/migration.sql
    severity: low
  - summary: >-
      The integration suite writes Attempt rows directly, and nothing tracks
      replacing those helpers once the real writer exists.
    evidence: |-
      `seedAttempt` calls `h.prisma.attempt.create` and says in a comment that it
      stands in for Story 5.2's writer. Once 5.2 lands, tests seeding rows behind
      the writer's back can drift from what the writer actually produces.
    location: >-
      apps/api/test/practice-test.int-spec.ts (seedAttempt)
    severity: low
---

<intent-contract>

## Intent

**Problem:** Student Home lists a child's released Practice Tests as bare question counts. It cannot say what Subject a test is, and it cannot tell a not-started test from one with an Attempt open or one already completed — because no Attempt entity exists yet, so "completed" is unrepresentable.

**Approach:** Introduce the `Attempt` row (owned by `practicetest`, read-only in this story), derive a three-valued list state from it, resolve each test's Subject label across the `sourcetest` reader boundary, and serve one flat server-ordered list that Student Home renders with a Subject and a state on every row.

## Boundaries & Constraints

**Always:**
- One flat list, never grouped by Subject. Server owns the order; the browser renders what it is given.
- Band order: every non-completed released test first, then completed ones. Newest-first inside each band — `createdAt` desc for the first band, most-recent `submittedAt` desc for the completed band — with `id` desc as the tiebreak, exactly as `releasedFor` already tiebreaks.
- `status: 'Released'` and the profile id from `req.student` stay in the `where`: a `Draft`, a `Discarded` row and a sibling's test are absent by construction (AD-18, AD-26).
- Completed rows are returned unconditionally and forever — no cutoff, no archive flag, no date filter anywhere on this path.
- The three conditions are distinguishable by a **text label**, never by color alone.
- `practicetest` reads Subject through `SOURCE_TEST_READER`, never through the `sourceTest` or `subject` Prisma delegate (AD-17). `sourcetest` resolves the label through `TaxonomyService`, as it already does in `source-test.service.ts:819`.
- Not one word of generated content on this route: no prompt, no option body, no answer, no Topic, no allowance figure, no tier, no model name (AD-20, AD-26).
- Every user-facing string lives in `apps/web/src/copy/student.ts`, second person, no exclamation marks.

**Block If:**
- The Subject label cannot be resolved for a released test without `practicetest` touching a table it does not own.

**Never:**
- No Attempt is created, started, submitted or written anywhere in this story — `Attempt` is read-only here; 5.2–5.4 own its writes.
- No grade state, no score, no answer key, no `QuestionGrade`, no Mastery.
- No tap target and no route out of the list: Take Test is 5.2, Results is 5.6.
- No `timerMinutes` and no Grade Level on this payload. Story 4.6 deliberately withheld the timer from this route, the ACs here do not ask for it, and the profile's Grade Level is already stated once at the top of the page.
- No retake framing (`First … · Latest … · N attempts`) — that is 5.7.
- No client-side re-sorting, filtering or grouping.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Not started | Released test, zero Attempts | Row with `state: 'NotStarted'`, in band 1 | No error expected |
| In progress | Released test, an Attempt with `submittedAt: null` | Row with `state: 'InProgress'`, in band 1 beside not-started rows | No error expected |
| Completed | Released test, every Attempt submitted | Row with `state: 'Completed'`, in band 2 | No error expected |
| Retake open on a completed test | One submitted Attempt plus one open Attempt | `state: 'InProgress'` and band 1 — an open Attempt is work to return to, and it outranks a past submission | No error expected |
| Band ordering | Mixed states | All band-1 rows precede every completed row, regardless of dates | No error expected |
| Completed ordering | Two completed tests | Ordered by most-recent `submittedAt` desc, `id` desc on a tie | No error expected |
| Old completed test | Completed months ago | Still present, unchanged | No error expected |
| Not released | `Draft` / `Discarded`, or another profile's released test | Absent from the list | No error expected |
| Nothing yet | No released tests | `[]` and HTTP 200 | Never a 404; page renders the empty sentence |
| Unbound device | No binding cookie | `StudentModeGuard`'s own 401 | Page routes to `/auth/sign-in` |
| List read fails | 500 / dropped connection | Existing per-read alert with Retry; the greeting stays on screen | Never routes the child away |

</intent-contract>

## Code Map

- `apps/api/prisma/schema.prisma` — `PracticeTest` at the `model PracticeTest` block (has `status`, `questionCount`, `createdAt`, `studentProfileId`); `PracticeTestStatus` is `Draft | Released | Discarded` and gains **no** `Completed` member — completion is derived from Attempts, not a fourth status. Add `model Attempt` and the `attempts` back-relation here.
- `apps/api/prisma/migrations/20260925120000_add_practice_test_timer/migration.sql` — the shape and comment style a new migration folder follows.
- `apps/api/src/practicetest/practice-test.service.ts:231` — `PracticeTestReleasedSummary` (`{ id, questionCount }`), the interface to widen. `:587-597` — `releasedFor`, the only method to rewrite; its `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` is the tiebreak to preserve.
- `apps/api/src/practicetest/student-practice-test.controller.ts` — the one student route, `GET /api/student/practice-tests`, guarded by `StudentModeGuard`; both ids come from `req.student` and never from a parameter.
- `apps/api/src/practicetest/practice-test-policy.ts` — where pure, unit-testable rules live; `practice-test-policy.spec.ts` is its sibling suite. Put the state derivation and the comparator here.
- `apps/api/src/sourcetest/source-test-reader.ts` — `SourceTestReader` / `LiveSourceTest` / `SOURCE_TEST_READER`; a leaf file importing nothing, which is why the boundary works. Extend the interface here.
- `apps/api/src/sourcetest/source-test.service.ts:809-819` — the existing label resolution (`this.taxonomy.resolveSubject(row.subjectId)`), the pattern to reuse. `:555-570` — the submit gate proves `subjectId` is non-null on every `Submitted` Source Test, so a released test always has one; the column stays nullable, so the type still admits `null`.
- `apps/api/src/practicetest/practice-test.module.ts` — already imports `SourceTestModule`; no new import is needed.
- `apps/api/src/admin/taxonomy.service.ts:129` — `resolveSubject(id)`, single-id, succeeds for a disabled row.
- `apps/api/test/practice-test.int-spec.ts:2378-2382` — `readReleased(cookie)`, the student-scoped request helper; `withLandedDrafts` and `release()` nearby build released rows.
- `apps/api/test/student-mode.int-spec.ts:642-676` — asserts the payload is exactly `['id', 'questionCount']`, including the timer case. This assertion must be updated to the new key set; its **timer** claim stays true and must survive.
- `apps/web/src/lib/parent-api.ts:259` — `StudentPracticeTestSummary`; `:644` — `studentPracticeTests()`.
- `apps/web/src/copy/student.ts` — `studentCopy`, including `practiceTest(questionCount)`, the row copy to replace.
- `apps/web/src/app/student/page.tsx` — the list render (`role="list"` restored by hand; `data-testid="student-practice-test"`), the two independently-settled reads, and the separate `testsError` alert. All of that stays.
- `apps/web/src/app/student/page.spec.tsx` — the existing cases are pure-function assertions plus regex over the source. That shape is for rules about the *file*; it is not how a rendered claim is verified here.
- `apps/web/src/components/primitives.spec.tsx:4,40` and `apps/web/src/app/parent/capture/page.spec.tsx:1-11` — **the repo's render-test pattern**: `renderToStaticMarkup(createElement(ThemeProvider, { theme }, node))` from `react-dom/server`, asserting over the returned markup string. There is no @testing-library and none is needed; do not add one.
- `apps/web/src/app/parent/capture/PageStrip.tsx` — the precedent for this story's shape: a presentational component extracted out of a page precisely so it can be rendered and asserted on, while the page keeps the data fetching.
- `apps/web/vitest.config.ts` — `environment: 'node'`: there is no DOM and no router in this workspace. A claim can only be *rendered* if it lives in a component that can be rendered on its own; the page cannot be. That is the constraint that decides where each visible claim has to live.
- `e2e/tests/parent-practice-test.spec.ts:760-766` — the **only** browser-level consumer of the row's copy: it asserts the released row's *entire* text with `toHaveText('A practice test with N questions')`. It is not run by `pnpm test` and not typechecked by `pnpm typecheck` (it runs under `pnpm e2e` / `pnpm typecheck:e2e`), so a copy change breaks it silently. It must be updated. `e2e/tests/student-mode.spec.ts:81` asserts a count of zero on an empty page and stays true as written.
- `apps/api/src/admin/taxonomy.service.ts:129` — `resolveSubject(id)` **throws** `NotFoundException` for an unknown id; it never returns nullish. Any `?? null` around it is dead, and an unhandled throw turns one unresolvable Subject into a failed list read on a route the controller documents as never 404.
- `apps/api/test/harness.ts` — `setSubjectEnabled` (used at `:425`) is how a test disables a Subject after classification.

## Tasks & Acceptance

**Execution:**
- `apps/api/prisma/schema.prisma` -- add `model Attempt` (`id`, `practiceTestId`, `startedAt @default(now())`, `submittedAt DateTime?`, `createdAt`, `updatedAt`), relation to `PracticeTest` with `onDelete: Cascade`, `@@index([practiceTestId, submittedAt])`, `@@map("attempt")`, plus the `attempts Attempt[]` back-relation -- the three list conditions are underivable without it, and `practicetest` owns Attempt per AD-17. No `studentProfileId`: `PracticeTest` already carries it and duplicating it makes two places the association can drift.
- `apps/api/prisma/migrations/<timestamp>_add_attempt/migration.sql` -- hand-write the `CREATE TABLE` + index + FK, commented like the timer migration -- a new table, so no backfill.
- `apps/api/src/sourcetest/source-test-reader.ts` -- add `readSubjectLabels(sourceTestIds: string[]): Promise<Map<string, string | null>>` to `SourceTestReader` -- one batched call keeps `practicetest` off the `sourceTest` delegate without an N+1.
- `apps/api/src/sourcetest/source-test.service.ts` -- implement it: one `findMany` over the given ids selecting `id, subjectId`, then `resolveSubject` once per **distinct** non-null subject id -- distinct subjects are few, so this reuses the existing single-id method rather than adding a batch API to `admin`. `resolveSubject` **throws** for an unknown id, so catch per subject id and record `null` -- one unresolvable Subject must cost that row its label, never the whole list read, on a route that documents itself as never answering 404. Resolution must keep succeeding for a **disabled** Subject.
- `apps/api/test/source-test.int-spec.ts` -- direct cases for `readSubjectLabels`, which otherwise has coverage only transitively through another module's route: a Subject **disabled after classification** still resolves its name (the method claims this deliberately, and nothing asserts it); an unclassified Source Test maps to `null`; an id the batch does not return is absent from the map.
- `apps/api/src/practicetest/practice-test-policy.ts` -- add pure `studentListState(attempts)` returning `'NotStarted' | 'InProgress' | 'Completed'` (any unsubmitted Attempt wins over any submitted one) and `compareStudentListRows(a, b)` implementing the two bands and their tiebreaks -- rules that must be unit-tested without a database.
- `apps/api/src/practicetest/practice-test-policy.spec.ts` -- cover every I/O Matrix row that is a pure ordering or state decision, including the open-retake precedence and the `id` tiebreak.
- `apps/api/src/practicetest/practice-test.service.ts` -- widen `PracticeTestReleasedSummary` to `{ id, subjectName: string | null, questionCount, state }`, and rewrite `releasedFor` to select each released row's Attempt `submittedAt` values, resolve Subject labels through `SOURCE_TEST_READER`, and sort with `compareStudentListRows` -- the comparator needs a per-row aggregate Prisma cannot order by, and a child's released list is allowance-bounded, so sorting in memory is sound; say so in the doc comment.
- `apps/api/src/practicetest/student-practice-test.controller.ts` -- update the return type and the doc comment -- the comment currently promises "an identifier and a question count" and would otherwise be untrue.
- `apps/api/test/practice-test.int-spec.ts` -- integration cases for band order, completed order, the open retake, an old completed test still listed, `Draft`/`Discarded`/foreign-profile exclusion, and the Subject label on a row -- seed Attempts with `h.prisma.attempt.create` since no write path exists, and say in the helper that it is a stand-in for Story 5.2's writer. Two cases the single-row fixtures cannot reach and which must be written: (1) **two released tests classified under different Subjects in one list**, asserting each row carries its *own* label -- a batched lookup that returns the right labels against the wrong rows passes every single-row assertion; (2) **one completed test with two submitted Attempts where the later submission is not the last row returned**, so the "most recent `submittedAt`" reduce is actually exercised. Fixtures must not fabricate a state no route can produce: obtain the two differently-classified released tests **within one account and one child** (classify two Source Tests under different Subjects, raising the fixture's allowance if that is what stands in the way), never by re-pointing another account's released row onto the child.
- `apps/api/test/harness.ts` -- name `"attempt"` in the truncate list, child-before-parent, for the reason the list already names `page_image`.
- `apps/api/test/student-mode.int-spec.ts` -- update the exact-key assertions to the new payload; keep the claim that no `timerMinutes` and no generated content reach this route.
- `apps/web/src/lib/parent-api.ts` -- widen `StudentPracticeTestSummary` to match, and update `studentPracticeTests()`'s comment about the server's order.
- `apps/web/src/copy/student.ts` -- replace `practiceTest(questionCount)` with row copy carrying a Subject line and a state label (`Not started` / `In progress` / `Completed`) -- the state mapping must be **exhaustive over the three tags and nothing else**: an unrecognized or missing value renders no label, never `Completed`, because telling a child a test they never touched is finished is the worst available default. Omit the Subject line when the label is `null`, `undefined` **or an empty string** -- guard on truthiness, not on `!= null`, so no empty styled line can render.
- `apps/web/src/app/student/_components/PracticeTestRow.tsx` -- **new presentational component** taking one `StudentPracticeTestSummary` and rendering the `<li>`: Subject line, question count, state label -- extracted so the rendered row can be asserted on directly, exactly as `PageStrip.tsx` is. It holds no state, no fetch and no router.
- `apps/web/src/app/student/_components/PracticeTestList.tsx` -- **new presentational component** taking `StudentPracticeTestSummary[]` and rendering the `<ul role="list">` of `PracticeTestRow`s **in the order received**, carrying the list's `data-testid`s -- extracted for the same reason the row was: the order claim is a claim about what a child sees, and this workspace can only render a component, never the page. It holds no state, no fetch, no router and no sort, filter or grouping.
- `apps/web/src/app/student/page.tsx` -- hand the array to `PracticeTestList` untouched -- the page's remaining job on this path is the two independently-settled reads, their separate error alerts and the empty sentence, all untouched.
- `apps/web/src/app/student/_components/PracticeTestRow.spec.tsx` -- **render** the component with `renderToStaticMarkup` under the student theme and assert on the markup: each of the three states shows its own words; a row given a Subject shows it and a row given `null`, `undefined` **or an empty string** renders no Subject element at all; the three states are told apart by text that survives with every colour stripped.
- `apps/web/src/app/student/_components/PracticeTestList.spec.tsx` -- **new**, **render** the list with `renderToStaticMarkup` under the student theme: three rows given in a fixed order appear in the markup in that order; one `<li>` per element and no more; each row's Subject pairs with its own state; an empty array renders no `<li>`. This is the test that makes the "renders what it is given" acceptance criterion observable -- a list that reverses, sorts or groups must fail it.
- `apps/web/src/app/student/page.spec.tsx` -- the page's only remaining claim here is that it hands the array over untouched, so keep the pure-function copy assertions and the region-scoped source assertions, with three corrections: (1) assert **both** region anchors were actually found (each `indexOf` result `>= 0`) *before* slicing, so a renamed anchor fails loudly instead of silently widening the region; (2) match the render call with a pattern (e.g. `/<PracticeTestList\s+tests=\{tests\}/u`), never an exact one-line JSX string a Prettier reflow would break; (3) the ban list is reordering verbs only -- `.sort(`, `.toSorted(`, `.reverse(`, `.filter(`, `groupBy`, `Object.entries(` -- and carries no blanket ban on a field name like `subjectName`, which a legitimate future `aria-label` would trip. The rendered-order claim itself belongs to `PracticeTestList.spec.tsx`, not here.
- `e2e/tests/parent-practice-test.spec.ts` -- update the released-row assertion: it asserts the row's *entire* text against the old one-line copy and fails as written. Assert the question-count sentence, the Subject and `Not started` with **per-line locators**, never one exact `toHaveText` over the whole row. This file is outside `pnpm test` and `pnpm typecheck`, so run `pnpm typecheck:e2e` as part of verification.

**Acceptance Criteria:**
- Given a child with released and completed Practice Tests, when Student Home loads, then one flat ungrouped list renders and every row shows a Subject and a state.
- Given a released test with no Attempt, one with an open Attempt and one completed, when the list is read, then all three are present and distinguishable by their state label with no reliance on color.
- Given a test completed months earlier, when the list is read, then it is still returned, with nothing on this path filtering by date.
- Given the API's order, when the page renders, then it maps the array as received and performs no sort, filter or grouping of its own.
- Given `pnpm test` and `pnpm typecheck` at the repo root, when they run, then both pass.

## Spec Change Log

### 2026-09-25 -- Review pass 1

**Triggering finding (high):** the three-conditions and Subject-label claims -- the story's central acceptance criteria -- were verified only by matching literal substrings of `page.tsx`. No test rendered the row, so a regression that keeps the literals but stops the element reaching the DOM would ship green, and a prettier reflow or a rename would fail a test whose subject was intact.

**Root cause in this spec:** the Code Map asserted "web tests are pure-function assertions plus regex over the source. **There is no @testing-library in this workspace** -- do not add one." True about @testing-library, and misleading: the repo renders components with `renderToStaticMarkup` from `react-dom/server` (`primitives.spec.tsx:40`, `parent/capture/page.spec.tsx`), and extracts presentational components out of pages (`PageStrip.tsx`) precisely so they can be rendered and asserted on.

**Amended:** the Code Map now points at the render pattern and at `PageStrip.tsx` as the precedent; Tasks now require a `PracticeTestRow` presentational component with its own render-based spec, scope any regex-over-source assertion to the region it is about, make the state-label mapping exhaustive rather than falling through to `Completed`, treat `undefined` like `null` for the Subject guard, and add the two integration cases the single-row fixtures cannot reach; Design Notes state the rule.

**Known-bad state avoided:** an accessibility guarantee asserted about a file's wording rather than about what a child sees, plus a copy function that labels an unknown state "Completed".

**KEEP -- these worked and must survive re-derivation:**
- The API shape and ordering: `{ id, subjectName, questionCount, state }`, two bands, `createdAt` desc in band 1, most-recent `submittedAt` desc in band 2, `id` desc tiebreak in both, sorted in memory with the reason stated in the doc comment.
- `studentListState` / `compareStudentListRows` as pure functions in `practice-test-policy.ts` with their unit suite, including the open-retake precedence, the band-beats-date case, the `id` tiebreak in both bands and the total-order stability check.
- `Attempt` with no `studentProfileId`, `submittedAt` nullable as the in-progress signal, `onDelete: Cascade`, `@@index([practiceTestId, submittedAt])`, and **no** `Completed` member added to `PracticeTestStatus`.
- `readSubjectLabels` on `SourceTestReader`: batched, deduped, resolving once per distinct subject id through `TaxonomyService`, with `practicetest` never touching the `sourceTest` or `subject` delegate.
- The existing student-list guarantees: no `timerMinutes`, no generated content, no allowance/tier/model figure, profile scoping from the binding cookie, `[]` and never a 404.
- The page's two independently-settled reads and their separate error alerts, untouched.

### 2026-09-25 -- Review pass 2

**Triggering finding (high):** the acceptance criterion "the page maps the array as received and performs no sort, filter or grouping of its own" was verified only by banning five tokens inside a source slice of `page.tsx`, plus a rendered-order test that built **its own** `<ul>` out of `PracticeTestRow`s and never imported the page. `page.tsx` could reverse the array (`.reverse(`, `.toSorted(`, or a named grouping helper — none of them on the ban list) and the whole suite stayed green; the two e2e cases that do render the real page hold zero or one released test, so they observe no order either. The region guard compounded it: `indexOf` returning `-1` was not detected, so a renamed anchor would have silently asserted against the wrong slice of the file.

**Root cause in this spec:** pass 1 fixed this defect class at the *row* level and stated the rule in Design Notes, but the Tasks then asked `page.spec.tsx` to "render the list of rows in a fixed order and assert the rendered order matches the input order" without saying **whose** list — and named only `PracticeTestRow` as an extracted component. A list assembled by the test satisfies the words while verifying nothing about the page. The Code Map also never named `e2e/tests/parent-practice-test.spec.ts`, the one browser-level consumer of the row copy, which sits outside both `pnpm test` and `pnpm typecheck` and broke unnoticed on the copy rename.

**Amended:** the Code Map now names the `environment: 'node'` constraint that decides where a claim must live, the e2e consumer and its exclusion from the default commands, and `resolveSubject`'s throwing contract. Tasks now require a `PracticeTestList` presentational component with its own render-based spec carrying the order claim, reduce `page.tsx` to handing the array over, harden the region-scoped source assertions (anchors asserted, pattern instead of an exact JSX string, reordering verbs only and no blanket field-name ban), update the e2e row assertion to per-line locators with `pnpm typecheck:e2e` in Verification, treat an empty-string Subject like `null`, make `readSubjectLabels` survive one unresolvable Subject instead of failing the read, add direct `readSubjectLabels` cases including a Subject disabled after classification, and forbid fixtures that fabricate a cross-account state no route can produce.

**Known-bad state avoided:** the story's central ordering guarantee — "what there is to do comes first" — resting on a token blocklist that three ordinary reorderings walk straight through, and a green suite hiding a broken browser test.

**KEEP -- these worked and must survive re-derivation:**
- Everything in the pass-1 KEEP list still holds, unchanged.
- `Attempt` exactly as landed: no `studentProfileId`, `submittedAt` nullable as the in-progress signal, `onDelete: Cascade`, `@@index([practiceTestId, submittedAt])`, `@@map("attempt")`, no `Completed` member on `PracticeTestStatus`, and a migration with no backfill commented like the timer migration. `"updatedAt" TIMESTAMP(3) NOT NULL` with no default is the repo's own Prisma convention -- do not "fix" it.
- `studentListState`, `lastSubmission` and `compareStudentListRows` as pure functions in `practice-test-policy.ts`, with the full unit suite: three states, open-retake precedence in both arrival orders, band-beats-date, band 1 mixing not-started with in-progress, completed band by most-recent submission, `id` desc tiebreak in both bands, and the total-order/antisymmetry check.
- `releasedFor` widened to `{ id, subjectName, questionCount, state }`, sorting in memory with the reason stated in the doc comment, with `status: 'Released'` and the `req.student` profile id still in the `where`.
- `readSubjectLabels` batched and deduped through `SOURCE_TEST_READER`, deliberately not account-scoped, with `practicetest` never touching the `sourceTest` or `subject` delegate.
- `PracticeTestRow` as a presentational `<li>` with its render-based spec: three states in their own words, words surviving with colour/class/style stripped, an unrecognized or missing state rendering no label and never "Completed", no anchor and no button.
- The exhaustive three-tag copy mapping in `student.ts`, and the integration cases already written: in-progress, completed, band order, open retake, completed-band order with two submissions seeded out of order, a test completed in 2024 still listed, `Draft`/`Discarded`/foreign-profile exclusion, and the `student-mode.int-spec.ts` exact-key payload assertion that keeps the no-`timerMinutes` and no-generated-content claims.
- `"attempt"` in the harness truncate list, child-before-parent, and `seedAttempt` labelled as a stand-in for Story 5.2's writer.

## Review Triage Log

### 2026-09-25 -- Review pass
- intent_gap: 0
- bad_spec: 1: (high 1, medium 0, low 0)
- patch: 5: (high 0, medium 3, low 2)
- defer: 3: (high 0, medium 0, low 3)
- reject: 11
- addressed_findings:
  - `[high]` `[bad_spec]` Rendered claims (Subject line, three state labels, no colour-only distinction) verified only by substring-matching `page.tsx`; the spec's Code Map wrongly ruled out render testing. Code reverted, Code Map and Tasks amended to require a `PracticeTestRow` component with a `renderToStaticMarkup` spec, and implementation re-derived.
  - `[medium]` `[patch]` `practiceTestState` fell through to `'Completed'` for any unrecognized or missing value -- folded into the amended copy task as an exhaustive mapping.
  - `[medium]` `[patch]` No test put two differently-classified Subjects in one list, so a batched label-to-row mix-up was unobservable -- folded into the amended integration task.
  - `[medium]` `[patch]` The most-recent-`submittedAt` reduce was never exercised with two submitted Attempts out of order -- folded into the amended integration task.
  - `[low]` `[patch]` The Subject guard used `!== null`, so an `undefined` field rendered an empty bold line -- folded into the amended copy and row tasks.
  - `[low]` `[patch]` File-wide regex bans (`/color:|bgcolor/`, `/\.filter\(/`) would fail on unrelated future code -- folded into the amended web test task as a scoping rule.

### 2026-09-25 -- Review pass
- intent_gap: 0
- bad_spec: 5: (high 1, medium 3, low 1)
- patch: 0
- defer: 2: (high 0, medium 0, low 2)
- reject: 14
- addressed_findings:
  - `[high]` `[bad_spec]` The "renders what it is given" ordering criterion was verified by a token blocklist over a source slice of `page.tsx` plus a rendered-order test that built its own list and never imported the page; `.reverse()`, `.toSorted()` or a named grouping helper would all have shipped green. Spec amended to require a `PracticeTestList` component carrying the order claim in a render-based spec, code reverted and re-derived.
  - `[medium]` `[bad_spec]` `e2e/tests/parent-practice-test.spec.ts:760-766` asserts the student row's entire text against the removed `studentCopy.practiceTest`, and sits outside both `pnpm test` and `pnpm typecheck`, so it broke silently. Code Map now names it, Tasks require per-line locators, Verification now runs `pnpm typecheck:e2e`.
  - `[medium]` `[bad_spec]` `readSubjectLabels` wrapped `resolveSubject` -- which throws for an unknown id -- in a dead `?? null`, so one unresolvable Subject would fail the whole list read on a route documented as never 404. Amended to catch per subject id and record `null`, with direct cases including a Subject disabled after classification.
  - `[medium]` `[bad_spec]` The two-Subjects-in-one-list integration case reached its fixture by re-pointing another account's released Practice Test onto the child, encoding a state no route can produce and crossing the very boundary the intent calls absent by construction. Amended to require both released tests within one account and one child.
  - `[low]` `[bad_spec]` The `page.spec.tsx` region guard checked the slice's length rather than that either `indexOf` anchor was found, and banned the field name `subjectName` outright; the render call was pinned to an exact JSX one-liner. Amended to assert both anchors, match a pattern, and ban reordering verbs only. An empty-string Subject also passed the `null`/`undefined` guard and rendered an empty styled line -- amended to a truthiness guard.

## Design Notes

Completion is **derived**, not a fourth `PracticeTestStatus`. A `Completed` enum member would make `practicetest` write a status from what is really an Attempt fact, and 5.7's retake would then have to walk it backwards.

An open Attempt outranks a submitted one because the AC puts released tests first "whether or not an Attempt is in progress" — the band exists to surface what there is to do. A retake left open therefore reads as in-progress, which is forward-consistent with 5.7.

Shape of the payload:

```ts
interface PracticeTestReleasedSummary {
  id: string;
  subjectName: string | null;
  questionCount: number;
  state: 'NotStarted' | 'InProgress' | 'Completed';
}
```

A claim about what a child *sees* is verified by rendering, not by matching the text of the file that renders it: a behaviour-preserving refactor must not fail, and a row that stops reaching the DOM must not pass. Regex-over-source stays for rules about the file itself (that the page does not sort), scoped to the region it is about.

That rule applies to the **list**, not only to the row. `apps/web` runs with `environment: 'node'`, so the page itself cannot be rendered here — which means every visible claim has to be delegated to a component that can be. The order the server chose is such a claim. A backstop made of source-text bans is not a substitute: `.reverse()`, `.toSorted()` or a named `groupBySubject` helper all slip past a token list, and a source region whose anchors have moved asserts against the wrong text while staying green. So the bans stay, narrowed to reordering verbs, with their anchors asserted — and the order itself is rendered and read back.

## Verification

**Commands:**
- `pnpm --filter api exec prisma migrate deploy` -- expected: the new migration applies cleanly against a fresh database
- `pnpm --filter api run db:generate` -- expected: the client regenerates with `Attempt`
- `pnpm typecheck` -- expected: no errors in `api` or `web`
- `pnpm test` -- expected: all vitest suites pass, including the new policy and page cases
- `pnpm --filter api run test:int` -- expected: the practice-test and student-mode integration suites pass
- `pnpm typecheck:e2e` -- expected: no errors in the Playwright suite (it is outside `pnpm typecheck`)
- `pnpm lint` -- expected: clean (note: `eslint` is not installed in this workspace, so this command cannot run; `pnpm prettier --write` on every touched path stands in)
