# Sprint Change Proposal — Paged Answer Key with Results Map

- **Date:** 2026-10-14
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Status:** Approved 2026-10-14 (with keyboard Previous/Next added); applied to prd.md, epics.md, EXPERIENCE.md, DESIGN.md, sprint-status.yaml
- **Scope classification:** Minor. One new story (Epic 5, reopened), one new UX-DR, amendments to EXPERIENCE.md / DESIGN.md, one PRD clarification. No API, schema, or architecture-decision change.

## 1. Issue Summary

**Trigger.** Rvnadela, 2026-10-14: "in the test results view (where the user can see their results as well as the correct and wrong answers and see explanations), i don't like the never-ending-scroll design. it'll be better to have a previous/next buttons and a icons indicator (same as when taking the test, you can click the button to see questions)."

**Current state (code, 2026-10-14).**

- **Student Results** (`app/student/_components/AttemptResults.tsx`, mounted by `app/student/tests/[practiceTestId]/page.tsx`): score header, then every `AnswerKeyRow` stacked in one `<ul>`, each with its `DisputePanel` and `ExplainPanel` inline. A 20-Question paper with a few explanations open is a very long page. Retake (`footer` slot) sits at the very bottom.
- **Parent Attempt detail** (`app/parent/attempts/[attemptId]/page.tsx`): same shape — header, then every `AnswerKeyRow` with `GradeReview` + `ExplanationReview`. Reached from Attempts, Grade disputes and Explanation flags lists; those two lists know the `questionId`/ordinal but land the parent at the top, so they must scroll to find the Question in question.
- **Take Test** already has the wanted pattern: one Question at a time, Back/Next (UX-DR39), and `QuestionMap` (UX-DR20) as a persistent rail from `md` up and an overlay below `md` (UX-DR34). The map speaks progress vocabulary only (Answered / Not answered).

**Why it matters.** The PRD's device is a phone held one-handed (§6). A long scroll hides where the wrong answers are, and makes "go back to question 7" a hunt. EXPERIENCE.md already bans infinite scroll (Motion policy); this screen is effectively one. Using the Take Test shape on Results also means a child sees the same navigation before and after handing in.

**Decisions taken (with Rvnadela, 2026-10-14).**

| Decision | Choice |
|---|---|
| Surfaces | **Student Results and Parent Attempt detail.** Both render `AnswerKeyRow`; both page. |
| Map form | **Same as Take Test.** Rail beside the Question from `md` up; overlay opened by a button below `md`. |
| Landing | **Question 1**, below the score header. Current Question kept in the URL (`?q=<ordinal>`) so refresh keeps place. |
| Keyboard | **Left/Right arrow keys** go to Previous/Next, ignored while focus is in a text field, select or editable region, or with a modifier key held. |
| Parent Analytics drill-down | **Keeps the stacked list.** Only Results and Attempt detail page. |
| Review mode | Batch |

## 2. Impact Analysis

### Checklist status

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger | [x] | Stakeholder UX feedback on done Story 5.6 (and the parent half of 6.2/6.5). |
| 1.2 Problem type | [x] | UX change to shipped behavior, not a defect. |
| 1.3 Evidence | [x] | Code citations above. |
| 2.1 Current epic | [x] | Epic 10 in progress; change belongs to Epic 5 (Results & answer key), which is `done`. |
| 2.2 Epic changes | [x] | Reopen Epic 5 with Story 5.8. Add UX-DR47 to Epic 5's UX-DRs. |
| 2.3 Future epics | [N/A] | Nothing open depends on the answer-key layout. |
| 2.4 Obsolete / new epics | [N/A] | None. |
| 2.5 Reorder | [N/A] | Independent of Epic 10's remaining work. |
| 3.1 PRD | [!] | §4.6 Reveal: one clarifying sentence. "Full answer key" stays true — every Question reachable. MVP unaffected. |
| 3.2 Architecture | [x] | No AD affected. One-read-per-Attempt (FR-22 view-triggered retry) is unchanged: paging is client-side over the one response. AD-18 (parent elevation dies on full load) — `?q` changes use `router.replace`, client-side. |
| 3.3 UI/UX | [!] | EXPERIENCE.md: Answer-key row + Score header + Question map rows, IA rows for Results / Attempt detail. DESIGN.md: new `results-map-cell` component; Question map cell prose cross-reference. |
| 3.4 Other artifacts | [!] | `sprint-status.yaml`: Epic 5 back to `in-progress`, add 5.8. Existing unit specs and E2E that assert all rows visible at once must change. |
| 4.1 Direct adjustment | [x] | Viable. Effort ~1 day. Risk low. |
| 4.2 Rollback | [N/A] | Nothing reverted; `AnswerKeyRow`, panels and reads reused as-is. |
| 4.3 MVP review | [N/A] | No scope cut. |
| 4.4 Path | [x] | Direct Adjustment. |

### Epic impact
- **Epic 5:** reopened (`done` → `in-progress`) for Story 5.8. UX-DR47 added to its Relevant UX-DRs.
- **Epic 6:** no story reopened. Parent Attempt detail changes layout only; `GradeReview`, `ExplanationReview`, `ExplainPanel`, `DisputePanel` are unchanged and keep their slots.
- **Epic 10:** none. Student results already have no bottom bar (UX-DR46); parent Attempt detail keeps the bar below `lg` and the pager sits above it via existing content padding.

### Story impact
- No done story's acceptance criteria are contradicted: 5.6 ("full answer key shown immediately") still holds — score + Q1 shown at once, every Question one tap away. 5.2's map rules (progress vocab only) stay for Take Test; the results map uses grade vocab (EXPERIENCE "two vocabularies for two moments").
- Specs touched: `AttemptResults.spec.tsx`, `parent/attempts/[attemptId]/page.spec.tsx`, `tests/[practiceTestId]/page.spec.tsx`, and any E2E that counts rendered answer-key rows.

### Artifact conflicts

| Artifact | Conflict | Update |
|---|---|---|
| PRD §4.6 Reveal | Silent on layout; "full answer key" could be read as one list | **Clarify** (4.1) |
| Architecture | None | **None** |
| `epics.md` | No UX-DR47, no Story 5.8; Epic 5 UX-DR list | **Add** (4.2–4.4) |
| `EXPERIENCE.md` | Answer-key row says "Full question list"; Question map scoped to Take Test only | **Amend** (4.5–4.8) |
| `DESIGN.md` | No results map cell | **Add** (4.9–4.10) |
| `sprint-status.yaml` | — | Epic 5 → `in-progress`, add `5-8-paged-answer-key` (4.11) |

### Technical impact
- **Shared pager** `components/AnswerKeyPager.tsx`: takes the rows, a `renderRow(row)` callback (each page passes its own `AnswerKeyRow` + slots), labels (student vs parent copy, like `AnswerKeyRowLabels`), and an optional `footer`. Owns: current index, Previous/Next, "Question N of M" counter, map rail (`md`+) / overlay (below `md`), `?q=` sync.
- **All rows stay mounted; non-current ones are `hidden`.** Keeps each `ExplainPanel` / `DisputePanel` / `GradeReview` / `ExplanationReview` open state, loaded text and in-progress input across page turns, and adds zero reads (one-read invariant untouched).
- **Results map** `components/AnswerKeyMap.tsx`: same grid/cell geometry as `QuestionMap`, but each cell is ordinal + grade-state glyph in its frame (check/circle, cross/circle, dash/dashed circle, ellipsis/dotted square — from the `gradeStateMarker` tokens already used by `GradeStateMarker`). Accessible name is a full sentence: "Question 3, Not correct, current". Legend lists the four fixed labels (only those present). A newly graded Question's cell carries the same newly-graded mark the row does. No percentage, no tally beyond the existing header. Extract shared cell geometry from `QuestionMap` rather than forking it; `QuestionMap` behavior and copy unchanged.
- **URL:** `?q=<ordinal>` written with `router.replace` (browser Back leaves the screen, it does not walk Questions). Missing/out-of-range `q` → Question 1. Student and parent pages read it via `useSearchParams` behind `Suspense` (pattern from `analytics/topics/[topicId]`).
- **Deep links:** Grade disputes and Explanation flags lists link to `/parent/attempts/{id}?q={ordinal}` so the parent lands on that Question. Both lists already hold the ordinal — no API change.
- **Keyboard:** a `keydown` listener in the pager maps ArrowLeft/ArrowRight to Previous/Next. Ignored when the event target is an `input`, `textarea`, `select` or `contenteditable`, when Alt/Ctrl/Meta/Shift is held, when the overlay map is open, and at the ends. Keeps dispute and grade-review text entry safe.
- **Focus & announce:** on Previous/Next/map jump, focus moves to the Question's heading; the polite live region states "Question N of M". No animation (motion policy).
- **Retake / back link:** stay below the pager, visible on every Question, not only the last.
- **Copy:** new strings in `copy/student` and `copy/parent` (Previous, Next, position counter, map heading, map open button, cell sentence). Grade labels reuse the fixed literals.
- **Tests:** unit specs for `AnswerKeyPager` (bounds, `?q` parse, focus, arrow keys + exclusions) and `AnswerKeyMap` (four states, current, accessible names, legend); update the three page/component specs; Playwright at 390×844 (overlay) and 1280×800 (rail) on both surfaces, including a deep link from Grade disputes.
- **API / schema / deploy:** none.

## 3. Recommended Approach

**Direct Adjustment** — one new story in Epic 5.

- **Rationale:** reuses Take Test's proven navigation shape and every existing answer-key piece; the change is presentation only. It removes the long scroll, makes wrong answers findable at a glance, and gives parent deep links a real landing point.
- **Effort:** ~1 day (pager + map + two page swaps + deep links + specs/E2E).
- **Risk:** low.
  - (a) Panel state lost on page turn — mitigated by keeping rows mounted and hidden.
  - (b) Hidden rows still announced — mitigated by `hidden` attribute (removes from AT tree), asserted in spec.
  - (c) Parent elevation lost on navigation — `?q` uses client-side `router.replace` only; E2E covers paging without re-PIN.
- **Timeline:** independent of Epic 10's retrospective; can run next.

## 4. Detailed Change Proposals

### 4.1 PRD §4.6 — Reveal bullet

OLD:
```
- **Reveal.** Score and full answer key appear immediately on submission and stay reachable from Attempt history (FR-23).
```
NEW:
```
- **Reveal.** Score and full answer key appear immediately on submission and stay reachable from Attempt history (FR-23). The answer key is presented one Question at a time in original order, with Previous/Next and a results map showing every Question's grade state, so any Question is one tap away; "full" means every Question is reachable, not that all are stacked on one page. *(Added 2026-10-14 via `sprint-change-proposal-2026-10-14-paged-results.md`.)*
```

### 4.2 `epics.md` — UX Design Requirements, add after UX-DR46

NEW:
```
UX-DR47: Present the answer key (student Results and parent Attempt detail) one Question at a time, mirroring Take Test (UX-DR34, UX-DR39): the score header stays above; below it one answer-key row with its explanation and grade controls; Previous/Next as the linear path (also on the Left/Right arrow keys, except while typing in a field or with a modifier held) with a "Question N of M" position; and a results map as the escape hatch — a persistent rail from `md` up and an overlay opened by its own control below `md`. Each results-map cell is a real button showing the ordinal and the Question's grade-state glyph in its frame (UX-DR17 carriers: frame, glyph, fixed label as the accessible name, color never alone), marks the current Question with `aria-current`, and carries a newly-graded mark where the row does. The map uses grade vocabulary only, never Answered/Not answered. The current Question is kept in the URL (`?q=<ordinal>`, replaced not pushed); entry with no or an invalid `q` lands on Question 1. Paging keeps every row's panel state and makes no additional reads. No animation on page turn; focus moves to the Question heading and the position is announced.
```

### 4.3 `epics.md` — Epic 5 header, Relevant UX-DRs

OLD (end of line):
```
… UX-DR34 (Take Test responsive layout), UX-DR39 (linear nav + map escape hatch)
```
NEW:
```
… UX-DR34 (Take Test responsive layout), UX-DR39 (linear nav + map escape hatch), UX-DR47 (paged answer key + results map, Story 5.8)
```

### 4.4 `epics.md` — add Story 5.8 after Story 5.7

NEW:
```
### Story 5.8: Paged Answer Key with Results Map

As a student (and as a parent reviewing an Attempt),
I want to step through the answer key one Question at a time with a map of every Question's grade,
So that I can find and review the ones I got wrong without scrolling an endless page.

**Acceptance Criteria:**

**Given** a submitted Attempt's results (student) or Attempt detail (parent)
**When** it loads
**Then** the score header is shown, followed by exactly one answer-key row (Question 1 by default) with its grade and explanation controls, a "Question N of M" position, and Previous/Next controls; Previous is disabled on the first Question and Next on the last

**Given** keyboard focus is not in a text field, select or editable region and no modifier key is held
**When** I press Left or Right arrow
**Then** it acts as Previous or Next, and does nothing at the matching end; while typing in a dispute or grade-review field, arrow keys move the caret only

**Given** the results map (UX-DR47)
**Then** it lists every Question in original order as a button showing the ordinal and its grade-state glyph in its frame, with the fixed grade label in its accessible name, the current Question marked with `aria-current`, a legend of the grade states present, and no Answered/Not-answered wording; pressing a cell shows that Question

**Given** a viewport at `md` or above
**Then** the results map is a persistent rail beside the Question; below `md` it is an overlay opened by its own control and closed on jump, exactly as on Take Test

**Given** the current Question changes
**Then** the URL's `q` parameter is replaced with its ordinal (no new history entry), focus moves to the Question heading, the position is announced, and nothing animates
**And** opening the screen with a valid `?q=` shows that Question; a missing or invalid one shows Question 1

**Given** an explanation opened, a dispute started, or a grade review in progress on one Question
**When** I move to another Question and back
**Then** that state is still there, and no request was made by the page turn itself

**Given** the parent's Grade disputes and Explanation flags lists
**When** an entry is opened
**Then** Attempt detail opens on that entry's Question

**Given** the student's Retake control and the parent's back-to-list link
**Then** they are visible below the pager on every Question

**Given** the change
**Then** it meets the Accessibility Floor in light and dark mode (hidden rows are not exposed to assistive technology), its copy lives in `copy/student` and `copy/parent`, Take Test's question map is unchanged, unit specs cover the pager (bounds, `q` parsing, focus, arrow keys and their text-field/modifier exclusions) and the results map (four states, current, accessible names, legend), and Playwright covers both surfaces at 390×844 (overlay) and 1280×800 (rail), including a deep link from Grade disputes
```

### 4.5 `EXPERIENCE.md` — Component table, Answer-key row (line ~180)

OLD:
```
| Answer-key row | Results, Attempt detail, drill-down, draft review | Full question list in **original order** — correct and incorrect alike. Each row: the Question, the student's answer, the correct answer, and the grade state on all four carriers from `{components.grade-state-marker}`. |
```
NEW:
```
| Answer-key row | Results, Attempt detail, drill-down, draft review | Every Question in **original order** — correct and incorrect alike. Each row: the Question, the student's answer, the correct answer, and the grade state on all four carriers from `{components.grade-state-marker}`. On Results and Attempt detail the rows are **paged one at a time** with Previous/Next and the results map (UX-DR47); drill-down and draft review keep the stacked list. *Why:* a long stacked paper is an endless scroll on a phone and hides where the wrong answers are. |
```

### 4.6 `EXPERIENCE.md` — Component table, add row after Question map (line ~176)

NEW:
```
| Results map | Results, Attempt detail | The question map's after-submission twin: every Question with its **grade state** (glyph in its frame from `{components.grade-state-marker}`, fixed label as the accessible name); tap jumps directly. Rail from `md` up, overlay below — same placement as Take Test. Grade vocabulary only; never `Answered` / `Not answered`. Paired with Previous/Next (also Left/Right arrow keys outside text entry) and a "Question N of M" position. Current Question kept in the URL so refresh and deep links land on it. |
```

### 4.7 `EXPERIENCE.md` — Score header row (line ~179), append

APPEND to the row's description:
```
On paged screens it stays above the pager and does not repeat per Question.
```

### 4.8 `EXPERIENCE.md` — IA table, Attempt detail row (line ~43), Reached from

OLD:
```
| Parent View | Attempt detail | Attempts row tap, Analytics dashboard dispute or flag entry | …
```
NEW:
```
| Parent View | Attempt detail | Attempts row tap, Analytics dashboard dispute or flag entry, Grade disputes / Explanation flags entry (opens on that Question) | …
```

### 4.9 `DESIGN.md` — components YAML, add after `question-map-cell`

NEW:
```
  results-map-cell:
    role: control
    radius: '{rounded.control}'
    minTapTarget: '{spacing.tap-target.student}'   # parent surface: '{spacing.tap-target.parent}'
    border: '1px solid {colors.divider}'
    labelType: '{typography.label}'
    stateGlyph: '{components.grade-state-marker.*.glyph} in {components.grade-state-marker.*.frame}'
    stateColor: '{components.grade-state-marker.*.color}'
    currentBorder: '2px solid {colors.primary}'
    currentBackground: '{state.tintSelected}'
    currentBackgroundDark: '{state.tintSelectedDark}'
```

### 4.10 `DESIGN.md` — Components prose, add after **Question map cell** paragraph (line ~592)

NEW:
```
**Results map cell** — control role, Results and Attempt detail. Same geometry as the question map cell, but the glyph is the Question's **grade-state glyph inside its grade-state frame** from `{components.grade-state-marker}`, and the accessible name carries the fixed grade label. Current Question: 2px primary border plus tinted ground — never tint alone. Exception: the cell carries no left rule and no visible label (the frame + glyph + accessible label + legend are its carriers at this size); the full four-carrier marker stays on the answer-key row beside it.
```

### 4.11 `sprint-status.yaml`

OLD:
```
  epic-5: done
  …
  5-7-retaking-a-practice-test: done
  epic-5-retrospective: optional
```
NEW:
```
  epic-5: in-progress
  …
  5-7-retaking-a-practice-test: done
  5-8-paged-answer-key: backlog
  epic-5-retrospective: optional
```

## 5. Implementation Handoff

- **Scope:** Minor — direct implementation by Developer agent (bmad-build / bmad-loop) as Story 5.8.
- **Recipients:** Developer agent. No PM/Architect escalation.
- **Success criteria:**
  - No answer-key screen (student Results, parent Attempt detail) stacks more than one Question at a time.
  - Results map shows all four grade states distinguishable without color; current Question exposed to AT.
  - `?q=` round-trips; deep links from Grade disputes / Explanation flags land on the right Question.
  - Panel state survives paging; network log shows no request on page turn.
  - Take Test question map unchanged; all existing + new specs and E2E green.
