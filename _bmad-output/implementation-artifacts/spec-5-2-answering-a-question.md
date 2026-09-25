---
title: 'Story 5.2 — Answering a Question'
type: 'feature'
created: '2026-09-25'
status: 'done'
baseline_revision: 'd9f21c2ea98bc4a54cb9d0ce69b4d245093e5a90'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The `generatable()` fixture in the practice-test integration spec fails
      randomly, roughly one run in two, at a different assertion each time.
    evidence: |-
      Page upload answers 404, 401 or 200-instead-of-201, or `/submit` answers
      400 or 404, always inside `generatable()` and never inside the assertion
      the failing test is named for. Reproduced on baseline
      d9f21c2ea98bc4a54cb9d0ce69b4d245093e5a90 with this story's test changes
      stashed: 3 failures in 5 runs there, same signature. The statuses crossing
      (a 200 where a 201 was expected) point at responses landing on the wrong
      assertion rather than at any one route.
    location: >-
      apps/api/test/practice-test.int-spec.ts:140-160
    severity: medium
  - summary: >-
      The product cannot produce a Fill-in-the-Blank or Short Answer Question
      through its own pipeline, so two of the three input controls are only ever
      exercised against hand-written rows.
    evidence: |-
      The fake Extraction emits `format: 'MultipleChoice'` for every question,
      and generation's format histogram is asserted to match the source. Both
      `spreadPracticeTestFormatsFixture` in e2e and the new integration case have
      to rewrite stored rows directly to reach the other two formats. The
      rendering rule is verified; the end-to-end claim "a Question's Format
      decides its control" is not reachable through the real path.
    location: >-
      apps/api/src/extraction/extraction-schema.ts
    severity: medium
  - summary: >-
      The unbound-device redirect on Take Test is verified only by a regex
      over `page.tsx`'s source text, never by an executed render or request.
    evidence: |-
      `page.spec.tsx` reads the file, strips comments, and asserts the
      literal substring `if (deviceIsUnbound(cause)) { router.replace(...)`
      is present. It never renders `TakeTestPage` or mocks a rejected
      `studentPracticeTest` call, so an inverted condition, a wrong `cause`
      binding, or an unreachable branch would still match the same source
      text and pass. `apps/web`'s vitest runs in `environment: 'node'`
      (`renderToStaticMarkup` only, no effects), so proving this needs
      either a DOM-capable render or an e2e case that revokes the binding
      mid-session — neither exists today.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx:118-121;
      apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx:18-27
    severity: medium
  - summary: >-
      The cross-test navigation reset (answers/index/map cleared when
      `practiceTestId` changes) is verified only by slicing `page.tsx`'s
      source text, never by rendering two different tests in sequence.
    evidence: |-
      `page.spec.tsx` asserts the reset block's source text contains
      `setTest(null)`, `setAnswers({})`, etc., but never mounts the page,
      navigates from one practice test id to another, and checks the
      resulting screen. A mis-keyed condition (e.g. on `attempt` instead of
      `practiceTestId`) would leave a stale `index`/`answers` state and the
      same source-text assertions would still pass.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx:93-100;
      apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx:45-59
    severity: medium
  - summary: >-
      The I/O matrix's "one Question" row (Back and Next both disabled,
      counter reads "Question 1 of 1") is proven only by a source-text
      regex, never by loading a real single-question released test.
    evidence: |-
      `page.spec.tsx` checks `disabled={index === 0}` and
      `disabled={index >= questions.length - 1}` appear literally in the
      source; `QuestionMap.spec.tsx` covers the one-cell-map part of the
      row behaviorally, but no integration or e2e case ever loads an actual
      one-Question released test through the screen and asserts both
      buttons are simultaneously disabled with the counter text.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx:127-136
    severity: low
  - summary: >-
      The I/O matrix's "read fails transiently" row (500 / 429 / dropped
      connection) is only exercised via a 404, never via an actual
      transient-failure status.
    evidence: |-
      The e2e case for this branch (`student-take-test.spec.ts`) requests a
      well-formed but nonexistent id, which is a permanent-absence 404, not
      a 500/429/dropped-connection. The code path is shared with genuine
      transient failures, so the claim is plausible, but nothing in the
      diff simulates a 5xx, a 429, or an aborted connection through this
      route.
    location: >-
      e2e/tests/student-take-test.spec.ts
    severity: low
  - summary: >-
      Take Test moves no focus and announces nothing when Back, Next, or a
      map jump changes the active Question.
    evidence: |-
      Neither `page.tsx` nor `QuestionMap.tsx` sets focus to the new prompt
      or uses a live region on navigation. A screen-reader user advancing
      through the test has no signal that the on-screen content changed,
      beyond re-reading the whole column on their own.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx
    severity: medium
  - summary: >-
      A released Practice Test with zero Questions is indistinguishable
      from a genuinely broken read: both render the generic retryable-error
      alert.
    evidence: |-
      `questions[index]` is `undefined` when the array is empty, which
      falls into the same branch used for a failed fetch. Not in the
      story's I/O matrix and likely unreachable given the generation
      pipeline, but nothing guards or tests the distinction.
    location: >-
      apps/web/src/app/student/tests/[practiceTestId]/page.tsx:169
    severity: low
  - summary: >-
      No test exercises real keyboard operation of the map cells or the
      radio group — only clicks, via e2e, and static markup, via component
      specs.
    evidence: |-
      The spec's Always list requires keyboard-navigable map cells
      (UX-DR20). Real `<button>`/`<input type="radio">` elements are
      keyboard-operable by construction, but no test presses Tab or
      Space/Enter to confirm it end to end.
    location: >-
      e2e/tests/student-take-test.spec.ts
    severity: low
  - summary: >-
      The `ignoreRestSiblings` eslint rule change is justified in-comment by
      one consumer, with no lint-rule test guarding against the pattern
      later being used elsewhere to swallow a genuinely unused variable.
    evidence: |-
      `apps/web/eslint.config.mjs`'s comment names
      `apps/parent/drafts/[practiceTestId]/page.tsx` as the reason for the
      rule, but the rule itself applies workspace-wide.
    location: >-
      apps/web/eslint.config.mjs
    severity: low
---

<intent-contract>

## Intent

**Problem:** A child can see that a released Practice Test exists but cannot open it. There is no student-scoped read of a test's Questions, no Take Test screen, no format-driven input control and no question map — so the product's central act, working through a test, does not exist.

**Approach:** Add one student-scoped read that answers a released Practice Test's Questions **with no correct answer of any kind**, and a Take Test screen that renders one Question at a time in the paper role with the control its Format calls for, linear Back/Next navigation, and a question map that reports Answered / Not answered only. Answers live in React state for this story; persistence, the timer and submission are Stories 5.3–5.4.

## Boundaries & Constraints

**Always:**
- The student read resolves **both** `parentAccountId` and `studentProfileId` from `req.student` (the binding cookie, via `StudentModeGuard`) — never from a path, query or body parameter.
- `status: 'Released'` sits in the statement's `where` beside both ids, so a `Draft`, a `Discarded`, a sibling's test, a foreign account's test and an unknown id all answer the **same** 404 sentence by construction.
- The student view carries **no correct answer**: `PracticeTestQuestion.answer` and `PracticeTestChoice.isCorrect` are never selected, never mapped and never serialized. No Topic label, no allowance figure, no tier, no model name, no cost (AD-20, AD-26).
- No correctness feedback of any kind appears anywhere on the screen before submission — not on a choice, not in the map, not in a count, not in a colour.
- Navigation is linear (Back/Next) **plus** the map as an escape hatch. Never linear-only (UX-DR39).
- Every control is a real control: `<button>`, `<input>`, `<textarea>`. No `div`/`span` carries an action or a state.
- Question content renders in the paper role capped at `measure.questionMaxWidth` (34rem) at every viewport (UX-DR15/34); the map rail takes the surplus width and the column never widens.
- Fill-in-the-Blank uses the smart fraction field: a real labelled `<input>` whose value is always the **raw typed string** and is the sole accessible and submitted value, with an **adjacent, never overlaid** `aria-hidden` typographic sibling that degrades to plain text and never moves the caret, blocks typing or rejects a non-fraction answer (UX-DR24, UX-DR32 case 1).
- Map cells are real keyboard-navigable buttons at the `comfortableDensity.tapTarget` floor, each individually announced with its own progress state, `aria-current` on the active Question, with a visible on-screen legend (UX-DR20, UX-DR32 case 3).
- Progress vocabulary is exactly `Answered` / `Not answered`. Never `Unanswered` — that is a grade state only submission can claim.
- Answered/not-answered is carried by a **word plus a filled/hollow glyph**, never by colour or fill alone; a grayscale rendering stays readable.
- Every user-facing string is parameterized in `apps/web/src/copy/student.ts`, second person, no exclamation marks, no error codes.
- Every figure comes from `apps/web/src/theme/tokens.ts`. No component writes a raw pixel, colour or radius.

**Block If:**
- The Prisma schema would need a new table, column or migration to satisfy this story. (It must not: Attempt and Answer are Stories 5.3–5.4.)
- A student-scoped read cannot be written without also exposing a correct answer.

**Never:**
- No `Attempt` or `Answer` model, no server-side persistence of a child's answers, no write endpoint of any kind. Answers are React state that lives for the page's lifetime; browser storage, TTL and profile-switch clearing are Story 5.3's.
- No timer: no countdown, no `role="timer"`, no deadline, no `timerMinutes` on the student view. Story 5.3 owns it.
- No Submit control and no submit endpoint; no blank-count confirmation. Story 5.4 owns them.
- No grading, no score, no answer key, no results route. Stories 5.5–5.6.
- No Subject / Grade Level labelling of the list rows and no sort, band or state derivation on Student Home. Story 5.1 owns the list; this story adds only the link that opens a row.
- No numerator/denominator widget, no contenteditable, no input masking, no format lock-in on Fill-in-the-Blank or Short Answer.
- No `sort`/`filter`/`reverse`/`groupBy` over the Questions in the browser: the server's ordinal order is the order shown.
- No animation beyond the sanctioned question-to-question and map open/close transitions, all collapsing under `prefers-reduced-motion`. No drop shadow anywhere.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Released test, bound device | `GET /api/student/practice-tests/{id}` with the binding cookie, row `Released` for the bound profile | 200 with `{ id, questionCount, questions[] }`; each question `{ id, ordinal, format, prompt, choices[] }`, choices `{ ordinal, body }`, all in ascending `ordinal` | No error expected |
| Draft / Discarded row | Same call, row not `Released` | 404 carrying the same sentence every other refusal carries | 404, nothing about which case it was |
| Sibling's or foreign account's test | Same call, row belongs to another profile or account | 404, identical sentence | 404 |
| Unknown id | Same call, no such row | 404, identical sentence | 404 |
| Unbound device | Same call, no binding cookie | 401 from `StudentModeGuard` | Screen routes to `/auth/sign-in` only on the guard's own refusal |
| Read fails transiently | 500 / 429 / dropped connection | Take Test screen shows a retryable error and stays put | Retry control re-issues the read; never routes the child away |
| Multiple Choice question | `format: 'MultipleChoice'`, choices present | One radio group named by the prompt, exactly one option selectable, each option body rendered through `RichText` | No error expected |
| Fill-in-the-Blank, fraction typed | `format: 'FillInTheBlank'`, raw value `3/4` | `<input>` value stays `"3/4"`; the adjacent `aria-hidden` sibling shows the stacked form | Unparseable raw value renders no sibling; the input is untouched |
| Fill-in-the-Blank, prose typed | Raw value `one half` | Input holds `one half`, no sibling, no rejection, no reformatting | No error expected |
| Short Answer | `format: 'ShortAnswer'` | Multi-line `<textarea>` holding the raw string | No error expected |
| Answer changed after navigating back | Answer on Q3, go to Q5, return to Q3, change it | The new value is held and the map still reads `Answered` | No error expected |
| Answer cleared to whitespace | Answered field emptied or left only spaces | Map cell returns to `Not answered` | No error expected |
| Test with one Question | `questionCount: 1` | Back and Next are both disabled; counter reads `Question 1 of 1`; the map holds one cell | No error expected |

</intent-contract>

## Code Map

**API — what exists and what it proves**

- `apps/api/src/practicetest/student-practice-test.controller.ts` — the whole student surface today: one `@Get('practice-tests')` under `@Controller('student')` + `@UseGuards(StudentModeGuard)`. Both ids come off `req.student!`. This is where the detail route is added, with the same guard and the same no-generated-content discipline.
- `apps/api/src/practicetest/practice-test.service.ts:587` `releasedFor()` — the existing student read; shows the `where: { parentAccountId, studentProfileId, status: 'Released' }` shape and the explicit `orderBy` convention. Mirror it.
- `apps/api/src/practicetest/practice-test.service.ts:1578` `DRAFT_SELECT` / `:1608` `DraftRow` / `:1618` `draftViewOf()` — the `as const satisfies Prisma.PracticeTestSelect` + `Prisma.PracticeTestGetPayload` + mapper triad to copy. **`DRAFT_SELECT` selects `answer` and `isCorrect` — the student select must not be derived from it or reuse it.**
- `apps/api/src/practicetest/practice-test.service.ts:646` `draftViewIn()` — the 404 pattern: `findFirst` with the status in the `where`, then `throw new NotFoundException(PRACTICE_TEST_NOT_FOUND)`. Reuse that same constant so every refusal is one sentence.
- `storedRichText()` in the same file — casts stored `Json` out as segments without re-parsing. Use it; do not re-parse.
- `apps/api/src/practicetest/practice-test.service.ts:231` `PracticeTestReleasedSummary`, `:237` `DraftChoiceView`, `:249` `DraftQuestionView`, `:272` `PracticeTestDraftView` — exported view interfaces sit here, beside the service. New student views go here too.
- `apps/api/src/practicetest/practice-test.module.ts` — already registers `StudentModeGuard` and `StudentPracticeTestController`. **No module change is needed.**
- `apps/api/prisma/schema.prisma:849` `PracticeTest`, `:908` `PracticeTestQuestion`, `:933` `PracticeTestChoice`, `:547` `QuestionFormat` — read-only. `questionCount` is stored; `ordinal` is `@@unique` per parent; choices carry `isCorrect`. **No migration in this story.**
- `apps/api/test/practice-test.int-spec.ts:2340` `describe('release and discard')` — holds `withLandedDrafts()`, `release()`, `readReleased(cookie)` and the binding-cookie helpers. The new integration cases belong beside these and reuse them.

**Web — what exists and what is reused**

- `apps/web/src/app/student/page.tsx` — Student Home. Two independently-settled reads, `deviceIsUnbound()` (exported, the only thing that routes to sign-in), per-read error alerts, `data-testid="student-practice-test"` rows. The row gains a link; **nothing else on this page changes**.
- `apps/web/src/app/student/layout.tsx` — `StudentThemeProvider` + comfortable padding. The new route nests inside it and needs no layout of its own.
- `apps/web/src/lib/parent-api.ts:259` `StudentPracticeTestSummary`, `:631` `studentSession()`, `:644` `studentPracticeTests()`, `ParentApiError` (`notBound`), `NETWORK_STATUS`, `RichTextSegment` at `:225`. New types and the new call go in the same `--- Student Mode ---` region.
- `apps/web/src/components/RichText.tsx` — the **one** renderer for stored segments; draws a fraction as `role="math"` with a spoken `aria-label`. Reuse verbatim for prompts and choice bodies. Its `aria-label` currently comes from `parentCopy.drafts.fractionReading` — leave that alone; it is a reading, not parent-scoped data.
- `apps/web/src/components/Screen.tsx` — `measured` caps a column at 34rem. Take Test is one of the two screens the file names as the deliberate breakpoint exception, so the rail split is written here, not in `Screen`.
- `apps/web/src/components/TextField.tsx`, `Button.tsx` (`PrimaryButton`), `Dialog.tsx` (`AppDialog`, portal-free when props are passed through), `LiveRegion.tsx` — the primitives. Use them rather than raw MUI.
- `apps/web/src/theme/tokens.ts` — `comfortableDensity` (tapTarget 48, gap 16, cardPadding 20, rowHeight 56), `rounded.paper`/`rounded.control`, `measure.questionMaxWidth`, `typeRoles.questionBody`, `motion`.
- `apps/web/src/copy/student.ts` — all student copy. `practiceTest(questionCount)` is the row sentence today.
- `apps/web` test shape: `apps/web/vitest.config.ts` runs `environment: 'node'`, so component specs render with `renderToStaticMarkup` under a `ThemeProvider` (`apps/web/src/components/primitives.spec.tsx:1-40` is the pattern). **Interaction is not testable in this workspace** — click-through claims belong in `e2e/`.
- `e2e/tests/student-mode.spec.ts` — the binding/PIN helpers and Student Mode navigation pattern; `e2e/tests/parent-practice-test.spec.ts` — how a draft is generated and released end to end. The new e2e spec composes both.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/practicetest/practice-test.service.ts` -- add `StudentChoiceView` / `StudentQuestionView` / `StudentPracticeTestView` interfaces, a `STUDENT_TEST_SELECT` written **from scratch** (never spread from `DRAFT_SELECT`) carrying only `id`, `questionCount` and `questions{ id, ordinal, format, prompt, choices{ ordinal, body } }` with explicit ascending `ordinal` ordering, a `studentTestViewOf()` mapper, and `releasedTestFor(parentAccountId, studentProfileId, practiceTestId)` using `findFirst` with all three plus `status: 'Released'` in the `where` and throwing `NotFoundException(PRACTICE_TEST_NOT_FOUND)` on null -- one statement is what makes "a child cannot reach an answer key, a sibling's test or a draft" structural instead of remembered.
- `apps/api/src/practicetest/student-practice-test.controller.ts` -- add `@Get('practice-tests/:practiceTestId')` delegating to `releasedTestFor` with both ids from `req.student!` -- the id in the path names *which* test; it never names *whose*.
- `apps/api/test/practice-test.int-spec.ts` -- integration cases beside the existing student read: the happy path asserts the serialized body matches **no** `answer`, `isCorrect`, `topic`, `cost`, `tier` or model key at all (assert over `JSON.stringify(body)`, not field-by-field); draft, discarded, sibling-owned, foreign-account and unknown ids each answer 404 with the identical sentence; an unbound call answers 401; questions and choices arrive in ascending ordinal.
- `apps/web/src/lib/smart-fraction.ts` -- **new**, pure and DOM-free: `fractionOf(raw): { whole: number | null; numerator: number; denominator: number } | null`, recognising `3/4` and `1 3/4` and returning `null` for everything else including a zero denominator -- pure because `apps/web` tests run without a DOM, so the rule has to be statable outside a render.
- `apps/web/src/lib/smart-fraction.spec.ts` -- **new**: covers `3/4`, `1 3/4`, surrounding whitespace, `one half`, `0.5`, `3/`, `3/0`, `''`, and a mixed string -- and asserts the function never rewrites its input.
- `apps/web/src/lib/answers.ts` -- **new**, pure: `isAnswered(value: string | undefined): boolean` (trimmed, non-empty), `answeredCount(order, answers)`, and `progressOf(...)` returning per-question `'answered' | 'not-answered'` in the given order -- the progress claim is the map's whole content and must be assertable without a browser.
- `apps/web/src/lib/answers.spec.ts` -- **new**: whitespace-only clears an answer; an unanswered question is absent, not `''`; the count and the per-question states agree; the returned order is the order given, never sorted.
- `apps/web/src/copy/student.ts` -- add the Take Test strings: `takeTest.counter(n, total)` → `Question {n} of {total}`, `takeTest.format` per Format (`Multiple choice` / `Fill in the blank` / `Short answer`), `takeTest.answerLabel` → `Your answer`, `takeTest.fractionHelp`, `takeTest.back` → `Back`, `takeTest.next` → `Next`, `takeTest.mapHeading` → `Your questions`, `takeTest.mapSummary(answered, notAnswered)` → `{a} answered · {b} not answered`, `takeTest.cellState(ordinal, answered, current)` producing `Question 3, answered` / `Question 4, not answered` / `Question 7, not answered, you are here`, `takeTest.legendAnswered`/`legendNotAnswered`, `takeTest.openMap`, `takeTest.closeMap`, `takeTest.loading`, `takeTest.failed`, `takeTest.open` (the Student Home link label) -- second person, no exclamation marks, no figure written into a sentence that belongs to a token.
- `apps/web/src/lib/parent-api.ts` -- add `StudentChoiceView`, `StudentQuestionView`, `StudentPracticeTestView` mirroring the API exactly (no `answer`, no `isCorrect`), and `studentPracticeTest(id)` calling `/student/practice-tests/{encodeURIComponent(id)}` with `studentCopy.takeTest.failed` -- in the existing Student Mode region, beside `studentPracticeTests()`.
- `apps/web/src/app/student/_components/AnswerInput.tsx` -- **new** presentational component: switches on `format` to a MUI `RadioGroup` of real radios (`MultipleChoice`, labelled by the prompt through `aria-labelledby`, bodies via `RichText`), the smart fraction field (`FillInTheBlank`), or a multiline `TextField` (`ShortAnswer`); takes `value`, `onChange`, and holds no fetch, no router and no test-wide state -- one file because the three controls are one decision and splitting it would hide the exhaustive switch.
- `apps/web/src/app/student/_components/SmartFractionField.tsx` -- **new**: a bordered wrapper carrying the focus ring on `:focus-within`, containing a real labelled `<input type="text" autoComplete="off" spellCheck={false}>` whose `value` is the raw string and an **adjacent** `aria-hidden` sibling rendering `fractionOf(raw)` stacked, rendering nothing when it parses to `null` -- never overlaid, never a second accessible value, never a mask.
- `apps/web/src/app/student/_components/QuestionMap.tsx` -- **new** presentational component taking the per-question progress states, the current ordinal and `onJump`; renders `<ul>` of real `<button>`s carrying the ordinal, an `aria-hidden` filled/hollow glyph, a visually-hidden per-cell state sentence and `aria-current` on the active cell, plus the summary line and the on-screen legend -- one component used in both the rail and the overlay so the two can never drift.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` -- **new** client route: reads `studentPracticeTest(id)`, holds `answers: Record<questionId, string>` and `index` in state, renders the counter, the prompt in the paper role capped at `measure.questionMaxWidth`, `AnswerInput`, Back/Next (disabled at the ends), the `QuestionMap` as a persistent rail from the `md` breakpoint up and as an `AppDialog` overlay below it with an open control that is hidden from `md` up; routes to `/auth/sign-in` only via `deviceIsUnbound`, and shows a retryable error for anything else -- the screen is where the answers live for this story and nothing here touches storage or the network after the read.
- `apps/web/src/app/student/page.tsx` -- make each row's sentence a `next/link` to `/student/tests/{id}` labelled by `studentCopy.takeTest.open` -- the only change Student Home needs to make Take Test reachable; the list's Subject, state and sort remain Story 5.1's.
- `apps/web/src/app/student/_components/QuestionMap.spec.tsx` -- **new**, `renderToStaticMarkup` under the student theme: one `<button>` per question; each cell's state sentence is present and distinct; `aria-current` appears exactly once; the glyph is `aria-hidden`; the legend renders both words; the markup contains no score, no percentage and no correctness word; states survive with colour stripped (word plus glyph present).
- `apps/web/src/app/student/_components/AnswerInput.spec.tsx` -- **new**, static render per Format: Multiple Choice renders `type="radio"` inputs, one per choice, sharing one `name` and named by the prompt; Fill-in-the-Blank renders one `<input>` whose `value` is the raw string with an `aria-hidden` sibling beside it and no second accessible value; Short Answer renders a `<textarea>`; **no rendered markup for any Format contains a correct-answer marker**.
- `apps/web/src/app/student/tests/[practiceTestId]/page.spec.tsx` -- **new**, source-region assertions in the shape of `apps/web/src/app/student/page.spec.tsx`: the only `router.replace` is guarded by `deviceIsUnbound`; the page calls `parentApi.studentPracticeTest` and no parent-scoped call; the source contains no `timer`, `submit`, `score`, `correct` or `localStorage` identifier in code (comments stripped first); the questions array is rendered in the order received with no reordering verb.
- `e2e/tests/student-take-test.spec.ts` -- **new**: generate and release a practice test as a parent, return to Student Mode, open the test, answer a Multiple Choice question by clicking its option, Next to a Fill-in-the-Blank and type `3/4`, Next to a Short Answer, open the map and jump back to question 1, confirm the earlier answers are still selected and changeable, and confirm the map cell for an answered question reads `Answered` while an untouched one reads `Not answered` -- the interaction claims live here because `apps/web`'s runner has no DOM.

**Acceptance Criteria:**

- **Given** a released Practice Test belonging to the bound Student Profile, **when** the Take Test screen opens it, **then** every Question is reachable in stored ordinal order and the response body — inspected as raw JSON — contains no correct answer, no `isCorrect` flag, no Topic label and no parent-scoped figure.
- **Given** a Question whose Format is Multiple Choice, **when** it is displayed, **then** the child gets a single-select group of real radio inputs, one per stored choice, in stored ordinal order, with no option marked correct.
- **Given** a Question whose Format is Fill-in-the-Blank, **when** the child types `3/4`, **then** the input's value and its accessible value are both exactly `3/4`, a stacked typographic form appears in an adjacent `aria-hidden` sibling, and typing `one half` instead is accepted unchanged with no sibling and no refusal.
- **Given** a Question whose Format is Short Answer, **when** it is displayed, **then** the child gets a multi-line free-text control holding the raw string.
- **Given** answers entered on several Questions, **when** the child navigates backward and forward with Back/Next, **then** every previously entered answer is still there and can be changed.
- **Given** the question map, **when** it is opened or read in the rail, **then** it lists **every** Question with `Answered` or `Not answered`, marks the current Question with `aria-current`, and selecting any cell moves the screen to that Question.
- **Given** any point before submission, **when** any part of the screen is inspected, **then** nothing states or implies correctness, a score, a running tally or a grade — in the map, on an option, in a count or in a colour.
- **Given** a Draft, Discarded, sibling-owned, foreign-account or unknown Practice Test id, **when** the student route is called with a valid binding cookie, **then** each answers 404 with one identical sentence that distinguishes none of them.
- **Given** a viewport at or above the `md` breakpoint, **when** the screen renders, **then** the question map is a persistently visible rail beside a Question column still capped at 34rem; **given** a narrower viewport, the map is an overlay opened by a real button and closed by a real button.
- **Given** the whole change, **when** `pnpm lint`, `pnpm typecheck`, `pnpm test` and the new e2e spec run, **then** all pass and no Prisma migration was added.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 2: (high 0, medium 2, low 0)
- reject: 17: (high 0, medium 0, low 17)
- addressed_findings:
  - `[medium]` `[patch]` Student Home's row link carried a constant `aria-label`, giving every released test the identical accessible name and overriding the visible sentence (WCAG 2.5.3 Label in Name) — the label was dropped, the visible sentence is now the link's name, `studentCopy.takeTest.open` was removed as unused, and the e2e selects by the visible sentence.
  - `[medium]` `[patch]` Take Test held `index`, `answers` and `mapOpen` across a change of `practiceTestId`, so opening a shorter test left `index` past the end and rendered the failure alert for a successful read — a render-phase reset keyed on the id (never on `attempt`) was added.
  - `[medium]` `[patch]` A read failing after one had succeeded set `error` but left `test`, so the error branch was never reached and a stale test stayed on screen — the handler now clears `test` before stating the failure.
  - `[medium]` `[patch]` The integration spec's free-text answer sweep ran zero iterations (every generated question is Multiple Choice, whose `answer` is null) and the route was never exercised against the other two Formats — a new case rewrites a landed draft into all three Formats, guards non-vacuity, and asserts `choices: []` on both non-Multiple-Choice questions.
  - `[low]` `[patch]` The counter read its total from the stored `questionCount` column while Next read its bound from `questions.length`; both now derive from the array.
  - `[low]` `[patch]` `AnswerInput`'s exhaustiveness branch returned the `never`-typed value, which would render a raw Format enum name to a child — it now returns `null`.
  - `[low]` `[patch]` The student controller's class doc still claimed one route and no generated content, and `DRAFT_SELECT`'s doc comment had been orphaned by the new select inserted above it — both restored to describe what the file now does.
  - `[low]` `[patch]` The `ignoreRestSiblings` lint option's comment implied this story used the pattern; it now names the draft-review site it actually exists for.
  - `[low]` `[patch]` Nothing exercised the Retry control — the e2e now counts reads to the student detail endpoint and asserts a second one goes out after the click.

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 8: (high 0, medium 2, low 6)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` `fractionOf` coerced an arbitrarily long digit string with `Number()`, which can overflow to `Infinity` and render a broken stacked-fraction preview — it now returns `null` (the specified plain-text degradation) whenever any part fails `Number.isSafeInteger`.
  - `[low]` `[patch]` Navigating to a different practice test while a prior read's error was still set left that stale error message set (though not rendered, since `test`/`error` are reset in the same block) — `setError(null)` was added to the cross-test reset alongside `setTest`, `setAnswers`, `setIndex` and `setMapOpen` so no field is left behind.

## Design Notes

**Why the student select is written from scratch.** `DRAFT_SELECT` is the parent's, and it selects `answer` and `isCorrect`. Deriving the student select from it — by spread, by `Omit`, by deleting keys — makes the absence of the answer key a subtraction somebody has to keep performing. Writing the student select as its own literal makes it an addition nobody can forget:

```ts
const STUDENT_TEST_SELECT = {
  id: true,
  questionCount: true,
  questions: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true, ordinal: true, format: true, prompt: true,
      choices: { orderBy: { ordinal: 'asc' }, select: { ordinal: true, body: true } },
    },
  },
} as const satisfies Prisma.PracticeTestSelect;
```

**Why the fraction render is a sibling and not an overlay.** An overlaid render has to track caret position, font loading, zoom and text scaling to stay aligned, and every one of those is a way to lose a child's keystroke. Beside the input, misalignment is cosmetic. The input is the only value: `aria-hidden` on the sibling is what keeps the answer from being announced twice, and `fractionOf` returning `null` is the specified degradation to plain text.

**Why the breakpoint lives on this screen.** `Screen.tsx` says in its own comment that every screen but Take Test and Analytics is one layout at every width. This is that exception, so the rail/overlay split is written here with `theme.breakpoints.up('md')` as CSS — both forms render, and CSS decides which is visible — rather than with a JS media query, which would make the first paint disagree with the server's.

**Where each claim is testable.** `apps/web` runs `environment: 'node'`, so a component spec can assert markup but never a click. Pure rules (`fractionOf`, `isAnswered`, `progressOf`) go in `lib/*.spec.ts`; markup and accessibility attributes go in static-render specs; selecting, typing, navigating and jumping go in `e2e/`. A claim placed in the wrong layer is a claim that silently never runs.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean across api, web and e2e.
- `pnpm typecheck` -- expected: no errors; `pnpm typecheck:e2e` also clean.
- `pnpm --filter web test` -- expected: the new `smart-fraction`, `answers`, `QuestionMap`, `AnswerInput` and Take Test page specs pass, existing specs unchanged.
- `pnpm --filter api run test:int` -- expected: the new student detail cases pass; `practice-test.int-spec.ts` green.
- `git status --porcelain apps/api/prisma` -- expected: no new migration directory and no `schema.prisma` change.
- `pnpm e2e -- student-take-test` -- expected: the new end-to-end pass, run after `pnpm db:up && pnpm db:migrate`.

## Auto Run Result

**Summary:** Fresh unattended review pass over the already-implemented Story 5.2 (student-scoped read + Take Test screen). No new feature work; two small patches applied, eight new items deferred, ten review findings rejected as noise or already covered by spec/existing convention.

**Files changed this pass:**
- `apps/web/src/lib/smart-fraction.ts` -- `fractionOf` now returns `null` instead of coercing an overflowing digit string to `Infinity`.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx` -- the cross-test-navigation reset now also clears `error`, alongside `test`, `answers`, `index` and `mapOpen`.

**Review findings breakdown:**
- patch: 2 (low 2) -- both applied (see Review Triage Log).
- defer: 8 (medium 2, low 6) -- appended to frontmatter `deferred`: unbound-redirect and cross-test-reset verified only by source-text regex (not an executed render); the "one Question" and "transient read failure" I/O-matrix rows proven only indirectly; no focus management/announcement on question change; zero-Question test rendering the generic error; no real keyboard-operation test; the `ignoreRestSiblings` eslint comment naming only one consumer.
- reject: 10 (low 10) -- duplicate view types across api/web (spec-mandated mirroring), no unload warning (explicitly Story 5.3's), `questionCount`/row-count mismatch (pre-existing, unreachable), 0/1-choice `AnswerInput` guard (unreachable via the generation pipeline), `storedRichText`'s unchecked cast (existing reused pattern), no mid-session revocation test (speculative, outside the I/O matrix), API/web route naming (cosmetic), the Format caption's fallback branch (unreachable without a schema change), Fill-in-the-Blank/Short-Answer pipeline reachability (already recorded in `deferred`), and the deliberate `ParseUUIDPipe` omission (intent-alignment noted it as consistent with the spec, not a divergence).

**Follow-up review recommendation:** `false`. This pass's patch findings were 2 low, 0 medium, 0 high: `3 × 0 + 1 × 2 = 2`, under the threshold of 5, and no high-severity patch.

**Verification performed:**
- `pnpm --filter web exec vitest run` (full `apps/web` suite) -- 31 files, 560 tests, all passed.
- `pnpm --filter web run typecheck` -- clean.
- `pnpm --filter web run lint` -- clean.
- `git status --porcelain apps/api/prisma` -- empty; no migration.
- API integration tests and the e2e suite were not re-run this pass (no API or e2e file was touched; the two patches are web-only, pure-function and cross-navigation-reset changes covered by the full web suite above).

**Residual risks:** the eight deferred items are real but non-blocking; two (unbound-redirect and cross-test-reset verified only by source text) carry medium severity because a future regression in either branch would ship undetected by the current test suite -- worth a follow-up pass that either moves `page.tsx`'s stateful logic to a DOM-capable render or adds e2e coverage for both scenarios.

