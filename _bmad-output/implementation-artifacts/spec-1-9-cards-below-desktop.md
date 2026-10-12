---
title: 'Story 1.9: Cards Below Desktop'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_revision: 'a6104220dd09a80a9a2b7bdf5890aa8b2401f688'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The Taxonomy table scrolls inside a 440px box with a sticky header; the card list
      that replaces it below `lg` has no equivalent cap, so a long taxonomy becomes an
      unbounded page on a phone.
    evidence: |-
      TaxonomyList's TableContainer keeps `maxHeight: 440`; CardList states only the grid,
      the gap and the column rule. Not a regression — the card layout is new — but the two
      layouts now disagree about how a long list is bounded, and nothing decides which is
      right for a parent or an operator scrolling it.
    location: >-
      apps/web/src/app/admin/_components/TaxonomyList.tsx
    severity: low
  - summary: >-
      Every row of every converted table is now rendered twice, and nothing bounds the cost
      on the unpaginated lists.
    evidence: |-
      Each row ships a second `RowActions` with its menu, and on Students a second
      `TextField select` holding every grade level per profile, on Accounts a second
      `TierSelect`. Inherent to the approved dual-render approach rather than a defect in it,
      but the Students, Taxonomy, Topics and Accounts lists are all unpaginated and no test
      or budget observes the DOM node count.
    location: >-
      apps/web/src/components/TableCards.tsx
    severity: low
  - summary: >-
      The Topic curation screen still has no executing browser coverage, so the card
      layout's open-merge and renaming states are pinned at source only.
    evidence: |-
      The new TopicCurationList.spec.tsx renders the closed state under
      renderToStaticMarkup; `mergingId`/`renamingId` are internal `useState` and
      unreachable without a DOM runner, so the open merge panel inside a card is asserted
      as source text. No Playwright spec visits /admin/topics at all — the same pre-existing
      gap Story 1.8 deferred.
    location: >-
      apps/web/src/app/admin/_components/TopicCurationList.spec.tsx
    severity: medium
  - summary: >-
      The e2e sideways-scroll probe is strictly stronger than the page-level figure it
      replaced, but no case demonstrates it firing.
    evidence: |-
      measureCardActions' sibling check now measures only boxes whose computed `overflow-x`
      is `auto`/`scroll`, plus `main`. An attempt to make it fire by revealing the hidden
      `TableOnDesktop` wrapper at 390px still measured 0, because the Students table happens
      to fit 390px. A probe that has never gone red is a probe whose wiring is unproven.
    location: >-
      e2e/fixtures.ts
    severity: low
  - summary: >-
      Row actions, a rename field, and a select control are each mounted twice from one
      row's state, with no handling for a live breakpoint crossing mid-interaction.
    evidence: |-
      `RowActions` keeps its open/anchor state in a local `useState`, so the table's menu
      and the card's menu are two independent instances; the same is true of each layout's
      rename `TextField` (focus) and of the grade-level/merge-target/tier `select` controls.
      Resizing across `lg` while one of these is open (a window resize, a foldable rotation)
      hides the active layout's control via `display: none` with nothing moving focus,
      closing the menu, or carrying the interaction to the now-visible counterpart. No test
      exercises a breakpoint crossing while any of these is mid-interaction.
    location: >-
      apps/web/src/components/RowActions.tsx
    severity: low
  - summary: >-
      ParentAccountTable's `aria-controls` can point at an id that is not in the DOM.
    evidence: |-
      The consumption chevron's `controls: \`consumption-${account.id}${idSuffix}\`` is only
      backed by a real element while `expandedId === account.id`; collapsed, neither the
      table's nor the new card's target id exists. Pre-existing pattern, now duplicated into
      the card layout rather than fixed.
    location: >-
      apps/web/src/app/admin/_components/ParentAccountTable.tsx
    severity: low
  - summary: >-
      The unranked two-column card grid can produce visually ragged rows.
    evidence: |-
      `CardList`'s unranked layout is `repeat(2, minmax(0, 1fr))` from `sm`; a card whose
      merge panel, consumption disclosure, or rename form is open can be much taller than
      its row-mate (Topics, Accounts), and nothing in the pattern or its tests addresses the
      resulting unevenness in the 600-1200px band.
    location: >-
      apps/web/src/components/TableCards.tsx
    severity: low
  - summary: >-
      A `TableCard`'s sole accessible name can collide with another card's when the
      underlying value falls back to the same placeholder string.
    evidence: |-
      `TableCard` names itself via `aria-label={title}` alone, no `aria-labelledby`.
      `MasteryTable`'s `labelOf()` falls back to `parentCopy.analytics.unknownTopic` for a
      topic with no resolvable name; if more than one row hits that fallback, their cards
      become indistinguishable by name to assistive technology — a pre-existing ambiguity
      on the link text, now extended to the list item itself.
    location: >-
      apps/web/src/app/parent/analytics/_components/MasteryTable.tsx
    severity: low
  - summary: >-
      Five converted screens show their pre-existing "no items" message for an empty list
      at every width instead of the spec's literal "empty `ul`, no placeholder" requirement.
    evidence: |-
      TaxonomyList, TopicCurationList, ParentAccountTable, AvailabilityMatrix, and
      parent/students's page all gate on `items.length === 0` and render a friendly
      empty-state message in place of both `TableOnDesktop` and `CardList`, unchanged from
      before this story. The practical result is identical to pre-story behavior and
      arguably clearer for a user than a bare empty list, but the I/O matrix's "no empty
      card, no placeholder" row is formally unmet below `lg`.
    location: >-
      apps/web/src/app/admin/_components/TaxonomyList.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Every data table in the app renders as a table at every width, so on a phone and on a portrait tablet the columns squeeze until values wrap mid-word; `MasteryTable` papers over it by visually hiding four of its six columns on a phone, which drops real data rather than laying it out.

**Approach:** Add one shared card-list pattern (UX-DR44) and put all six data tables through it: below MUI `lg` (1200px) each table renders as a list of cards, at `lg` and above as the table it is today. Both layouts live in the DOM reading the same component state; the switch is CSS-only through `sx` breakpoint keys, so nothing swaps after first paint. Presentation only — no handler, confirmation, sort order, filter, or API call changes.

## Boundaries & Constraints

**Always:** The switch is `sx` `display` breakpoint keys — never `useMediaQuery`, never a viewport hook, never a `@media` string written by hand. The hidden layout is `display: none`, so it is out of the accessibility tree and nothing is announced or named twice. Both layouts render from the same state (`renamingId`/`renameDraft`, `mergingId`/`targetId`, `expandedId`, `pendingIds`, `enabledPairs`/`pendingPairs`) — no second copy of state, no second effect, no second fetch. Every `id` that an `aria-controls`, `aria-describedby`, or label points at is unique across the two layouts: **the table layout keeps today's id verbatim and the card layout suffixes `-card`**, so every existing desktop query stays green. Nothing a table column shows may be missing from the card. Card figures use the same copy functions and `tabular-nums` the cells use. Row actions in a card header go through the existing `RowActions` under the same rules, with no change to that component's behavior. Card copy — field labels included — comes from `copy/*.ts`, reusing the existing `*Column` header strings as field labels. The shared card component states no colour, px figure, or tap target of its own: all of it from `theme.density` and `typeRoles`, since `primitives.spec.tsx` sweeps every file in `src/components/`.

**Block If:** nothing — the cutoff (1200px/`lg`), the per-screen card content, the Mastery and Availability conversions, and the one-vs-two column rule were all settled in the approved sprint change proposal.

**Never:** Do not change any action's handler, confirmation dialog, pending/disabled logic, live-region announcement, sort order, Subject filter, or drill-down href. No API, schema, or dependency change. Do not add a DOM test runner or testing library to `apps/web` (vitest runs `environment: 'node'`). Do not restyle the shared theme or add a breakpoint override — MUI's defaults already put `sm` at 600 and `lg` at 1200. Do not touch the table layouts' own markup beyond extracting shared row content and leaving their ids untouched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card list, unranked | any table, viewport < 600px | One column of cards; the table is `display: none` | No error expected |
| Card list, unranked | any table, 600px ≤ viewport < 1200px | Two columns of cards | No error expected |
| Card list, ranked | Mastery, viewport < 1200px | One column at every width, weakest first, order unchanged | No error expected |
| Desktop | viewport ≥ 1200px | The table renders; the card list is `display: none` | No error expected |
| Row with actions | a row whose actions are planned by `RowActions` | The same icons/menu at the card's top-right as in its action cell | No error expected |
| A field with no value | e.g. a withdrawn grade level, a null mastery percent | The card still shows the label with the table's own fallback string | No error expected |
| Empty row set | `topics`/`items`/`accounts` is `[]` | The card list renders as an empty `ul` — no empty card, no placeholder | No error expected |

</intent-contract>

## Code Map

**Shared pattern (new)**

- `apps/web/src/components/TableCards.tsx` -- **new.** Exports the pattern: `TableOnDesktop` (wraps today's `<Table>`, `display: { xs: 'none', lg: 'block' }`), `CardList` (`component="ul"`, `display: { xs: 'grid', lg: 'none' }`, `gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }` unless `ranked`, `gap` from density), `TableCard` (`Card component="li"` carrying `aria-label={title}` so the card is named without a second id, a `titleContent?` slot so an inline rename can replace the title in place, an `actions` slot at top-right, and children for fields and panels), and `CardField` (`label` in `typeRoles.caption` at `text.secondary`, `value` in `typeRoles.tableCell`, `tabular` opting into `fontVariantNumeric: 'tabular-nums'`). Follow the sibling primitives' shape (`Button.tsx`, `RowActions.tsx`): named exports, no default export, `theme.density ?? density` read at render as in `Screen.tsx:39`.
- `apps/web/src/components/TableCards.spec.tsx` -- **new.** Unit spec, `renderToStaticMarkup` under `ThemeProvider` per `primitives.spec.tsx:67-69`.
- `apps/web/src/theme/theme.ts:172-179` -- `MuiCard` is already `elevation: 0` with the 1px divider border, `MuiCardContent` already pads by `d.cardPadding`. Read-only: do not restyle.
- `apps/web/src/theme/tokens.ts:113-137, 160, 273-331` -- `density` (compact: rowHeight 40, cardPadding 12, gap 8, tapTarget 44) / `comfortableDensity`, `rounded.control`, and `typeRoles.cardTitle` / `.tableCell` / `.caption`. The only figure source.
- `apps/web/src/app/student/_components/PracticeTestRow.tsx:61-146` -- the house precedent for `Card component="li"` with density padding. Read-only pattern evidence.
- `apps/web/src/components/primitives.spec.tsx:49-58, 127-163, 175-182` -- the sweep the new file must survive: no hex colour, no px figure but `1px`, no `44`/`48` literal, no `aria-expanded` outside `RowActions.tsx`, no `surface ===`, no `'student'` literal, no div/span action. Read-only constraint.
- `apps/web/src/components/RowActions.tsx:23-46, 108-115` -- `RowAction` (`key, label, icon, onClick, disabled?, destructive?, selfEvident?, ariaLabel?, expanded?, controls?`) and `RowActionsProps` (`actions`, `menuLabel`). Reused unchanged; only `controls` differs per layout.

**Parent screens**

- `apps/web/src/app/parent/students/page.tsx:427-653` -- table: head `:446-461`, rows `:463-650`, name cell with the rename swap `:470-527` (`id={`student-rename-${profile.id}`}` at `:489`), grade-level select `:528-574` (`id={`student-grade-level-${profile.id}`}` at `:531`, withdrawn-level fallback `:570-572`), status `Chip` `:575-586`, `RowActions` `:587-648`. State at `:138-164`. Card: name as title (rename replaces it in place), grade level and status as fields, actions top-right.
- `apps/web/src/app/parent/students/page.spec.tsx` -- pure-rule and copy assertions only; no markup coupling. Only needs additions if new copy lands.
- `apps/web/src/app/parent/analytics/_components/MasteryTable.tsx:89-101` -- `phoneVisuallyHidden`, **deleted** by this story; `:133-158` heads, `:163-170` row, `:171-188` topic link (`data-testid="mastery-topic-link"`), `:189-251` figure + bar + the phone-only subline `:233-244` and phone-only marker `:247-249` (**both deleted** — the card states them properly), `:252-271` answered/unanswered/runs/status cells. Card: topic as a real link title, mastery figure (tabular) + the bar, answered, unanswered, runs, and `WeakAreaMarker` where it applies; one column, order untouched.
- `apps/web/src/app/parent/analytics/_components/MasteryTable.spec.tsx:76-96, 241-249, 265-284` -- the source rules that pin `phoneVisuallyHidden` / `sm: 'static'` / "never `display: none`" and the rendered counts of `data-weak-area` and `weak-area-marker`. These are the assertions this story must rewrite: the rule becomes "shape changes by `lg` breakpoint keys, never by a viewport hook", and the counts must account for both layouts.
- `apps/web/src/app/parent/analytics/page.tsx:323-330, 671-687` -- the `md` two-column grid (sparkline/summary left) and the `MasteryTable` call; the Subject filter `:625-668`. Read-only: unchanged, the tablet left column already holds.

**Admin screens**

- `apps/web/src/app/admin/_components/TaxonomyList.tsx:141-265` -- heads `:153-164` (`adminCopy.taxonomy.nameColumn/statusColumn/actionsColumn`), rename swap `:174-207` (`id={`${idPrefix}-rename-${item.id}`}`), status `:208-222`, `RowActions` `:223-264`; state `:38-43`. Card: name title, status field, actions top-right.
- `apps/web/src/app/admin/_components/TopicCurationList.tsx:201-436` -- heads `:201-219` (`nameColumn/subjectColumn/taggedColumn/createdColumn/actionsColumn`), rename `:229-266` (`id={`topic-rename-${topic.topicId}`}`), subject `:268`, tagged `:269-274`, created `:275-277`, `RowActions` + merge panel `:278-434` (panel `:336-432`, target select `id={`topic-merge-target-${topic.topicId}`}` at `:365`). Card: name title, subject/uses/created fields, rename and the merge panel open inside the card.
- `apps/web/src/app/admin/_components/ParentAccountTable.tsx:31-38` -- `ACCOUNT_COLUMNS`; `:206-214` heads, `:220-276` row (email, name, `TierSelect`, timezone, created, the chevron `RowActions` with `controls: `consumption-${account.id}`` at `:258`), `:277-317` the expanded row whose cell is `id={`consumption-${account.id}`}`, `:53-132` `ConsumptionPanel` with its nested `Table` (`data-testid="consumption-table"` at `:85`, `allowance-row` at `:98`, `reset-at` at `:122`). Card: email title, name/tier/timezone/created fields, chevron top-right, and the allowances as a labeled list (not a nested table) under `id={`consumption-${account.id}-card`}`.
- `apps/web/src/app/admin/_components/AvailabilityMatrix.tsx:76-154` -- the subject × grade-level checkbox grid; labels from `adminCopy.availabilityCheckboxLabel(subject, gradeLevel)` `:142-146`, toggle keyed `"${subject.id}:${gradeLevel.id}"`, state `:28-34`. Card: one card per Subject titled with its name, its grade levels as labeled checkboxes with the same handler.
- `apps/web/src/app/admin/topics/page.spec.tsx` -- asserts `TopicCurationList.tsx`'s **source text** by substring. Read-only risk: substrings referencing the extracted row content may need re-pointing, not relaxing.
- `apps/web/src/copy/admin.ts:76-80, 302` -- the `*Column` strings (reuse verbatim as card field labels) and `rowActionsLabel`. `apps/web/src/copy/parent.ts` -- same idiom; `parentCopy.analytics.*Column` are the Mastery card's labels.

**E2E**

- `e2e/playwright.config.ts:28-32` -- one `chromium` Desktop project, no mobile project; viewport set per test.
- `e2e/fixtures.ts:12-14, 23-26, 97-127` -- `rowActionsName`, `chooseRowAction`, `measureActionCell(page, rowSelector)` (returns `buttons/text/height/scrollWidth/clientWidth`), `COMPACT_TAP_TARGET`/`ONE_LINE_CEILING`.
- `e2e/tests/parent-students.spec.ts:311-331` and `e2e/tests/admin-taxonomy.spec.ts:284-306` -- the two existing phone-width tests. They measure a **table** action cell at 390px, where the table is now `display: none`: both must be re-pointed at the card's action area. Everything else in those files runs at the default desktop viewport and must stay untouched.
- `e2e/tests/parent-students.spec.ts:161` -- `chooseGradeLevel(page, `student-grade-level-${id}`)`, a live dependency on the **table** keeping today's unsuffixed id.
- `e2e/tests/admin-accounts.spec.ts:98-122` -- `consumption-table`, `allowance-row`, `reset-at` at desktop width. Read-only evidence that the card's allowance list needs its own testids rather than reusing these.
- `e2e/tests/parent-analytics.spec.ts:173-174` -- `getByTestId('mastery-row')` count and the topic link by name. The card rows need a distinct testid (e.g. `mastery-card`) so this count does not double.

**Mockup**

- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/mockups/key-analytics.html:654-727` (phone frame) and `:1016-1085` (tablet frame) -- `<table class="mtable">` rows to be redrawn as cards.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/components/TableCards.tsx` -- add `TableOnDesktop`, `CardList`, `TableCard`, `CardField` as described in the Code Map -- one pattern is what makes every present and future table follow UX-DR44 by default.
- `apps/web/src/components/TableCards.spec.tsx` -- cover every I/O matrix row: the breakpoint keys emitted for the table wrapper and for the one/two/ranked column cases, that a `TableCard` is a real `li` named by its title inside a real `ul`, that a `CardField` emits its label and value with tabular figures only when asked, that an empty list renders an empty `ul` with no card, and that the component states no figure the theme does not give it -- the swap rule is the story and must be pinned where the `node` runner can see it.
- `apps/web/src/copy/admin.ts`, `apps/web/src/copy/parent.ts` -- add only the card-specific labels that no column header already supplies (e.g. the Mastery runs/status field labels if the column strings do not read as labels) -- strings stay parameterised and out of components.
- `apps/web/src/app/parent/students/page.tsx` -- extract the row's content once and render it through both `TableOnDesktop` and `CardList`: card titled by the display name with the rename form replacing the title in place, grade level and status as fields, `RowActions` top-right; card-side ids suffixed `-card`.
- `apps/web/src/app/parent/analytics/_components/MasteryTable.tsx` -- delete `phoneVisuallyHidden`, the phone-only subline, and the phone-only weak marker; the table keeps all six columns at `lg` and above, and the card list (ranked, one column, `data-testid="mastery-card"`) carries the topic link title, the mastery figure and bar, answered, unanswered, runs, and the weak-area marker -- the hidden-column trick is exactly what this story replaces.
- `apps/web/src/app/parent/analytics/_components/MasteryTable.spec.tsx` -- rewrite the breakpoint and hidden-column rules for the new swap, and re-count the rendered assertions now that both layouts are in the markup -- an unupdated count would fail for the right reason and hide the wrong one.
- `apps/web/src/app/admin/_components/TaxonomyList.tsx` -- same two-layout treatment: name title with the rename form in place, status field, actions top-right, card ids suffixed `-card`.
- `apps/web/src/app/admin/_components/TopicCurationList.tsx` -- same, with subject/uses/created as fields and the merge panel rendered inside the card it belongs to, its target select id suffixed `-card`.
- `apps/web/src/app/admin/_components/ParentAccountTable.tsx` -- same, with the consumption chevron top-right and the expanded allowances as a labeled field list inside the card (its own testids), never a nested table.
- `apps/web/src/app/admin/_components/AvailabilityMatrix.tsx` -- add the card layout: one card per Subject listing its grade levels as labeled checkboxes bound to the same `toggle` and `pendingPairs` -- the grid is the worst offender at phone width.
- `e2e/tests/parent-students.spec.ts`, `e2e/tests/admin-taxonomy.spec.ts` -- re-point the two phone-width tests at the card's action area, and add a desktop-width assertion (1280px) that the table is the layout that renders -- the swap is only observable in a real viewport.
- `e2e/tests/admin-accounts.spec.ts`, `e2e/tests/parent-analytics.spec.ts` -- add one 390px check each: the card list renders, the table does not, the expected fields are present, and the screen has no horizontal scroll.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/mockups/key-analytics.html` -- redraw the phone and tablet mastery frames as cards -- the mock is the design reference and would otherwise contradict the shipped screen.

**Acceptance Criteria:**
- Given any of the six screens, when the viewport is below 1200px, then its card list is what renders and its table is `display: none`; at 1200px and above the reverse holds, and the decision is made by `sx` breakpoint keys with no viewport hook anywhere in the changed files.
- Given both layouts in the DOM, when the page is read by assistive technology, then the hidden one contributes nothing — every row is named once — and no `id` referenced by `aria-controls`, `aria-describedby`, or a label is emitted twice.
- Given a card, when it renders, then it is a flat `background.paper` surface on a 1px divider border at the surface's card padding and control radius, titled by the row's identifying value, with its row actions at the top-right and every remaining column as a labeled field whose numerals are tabular.
- Given the card list, when it renders, then it is a real `ul` of `li` cards, one column below 600px and two from 600px, except the Mastery list which stays one column weakest-first.
- Given a stateful row, when a rename, a merge panel, a consumption expansion, or a pending write is active in one layout, then the other layout reflects the same state from the same source, with no duplicated fetch or effect.
- Given every screen's existing behavior, when exercised at desktop width, then handlers, confirmations, pending state, announcements, sort order, the Subject filter, and the drill-down href are byte-for-byte what they were.
- Given Parent → Students, Parent → Analytics Mastery, Admin → Taxonomy, Admin → Topics, Admin → Accounts, and Admin → Availability, when each renders below 1200px, then its cards show exactly the content the sprint change proposal lists for it, with nothing a table column shows missing.
- Given the full suites, when `pnpm --filter web run typecheck`, `pnpm --filter web run lint`, `pnpm --filter web run test`, `pnpm --filter web run build`, and the affected Playwright specs run, then they pass, changed only for how a value is laid out.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass (follow-up, status: done → fresh pass)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 5: (high 0, medium 0, low 5)
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` `MasteryTable`'s card omitted the Status field entirely for a non-weak topic, so a card's field count varied row to row and broke "nothing a table column shows may be missing from the card." The `CardField` now always renders, with `null` in place of `WeakAreaMarker` when the topic is not a weak area, matching the table's always-present, often-empty Status cell. `MasteryTable.spec.tsx`'s `mastery-status-card` count assertion updated from 1 to 3 (every row) to match.
  - `[low]` `[patch]` `measureCardActions`'/`measureActionCell`'s shared `measureActionArea` resolved to zero elements and only ever surfaced as an opaque Playwright timeout when a card had no `actions` slot or the selector was wrong. It now throws an explicit error naming the selector that matched nothing.

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 18: (high 0, medium 8, low 10)
- defer: 4: (high 0, medium 1, low 3)
- reject: 18: (high 0, medium 3, low 15)
- addressed_findings:
  - `[medium]` `[patch]` The Mastery card rendered `unanswered` raw, so a topic with no blanks showed a bare `0` — the rule the deleted phone sub-line carried through `unansweredNone`. Zero now reads in words, with the numerals dropped for that case, pinned at source and in the render.
  - `[medium]` `[patch]` `CardField`'s label was a bare span above its value, losing the `th scope="col"` association the table had. The field is now a `role="group"` named by its label — id-free, so no per-row id has to be unique across the two layouts.
  - `[medium]` `[patch]` The runs field stuttered its label into its value (`Practice tests` / "over 3 practice tests"). It now shows the plain count; the sentence stays in the table cell only.
  - `[medium]` `[patch]` The no-sideways-scroll assertions measured `document.documentElement`, which cannot see an inner container scrolling — and `TableOnDesktop` puts `overflowX: 'auto'` on every consumer. Narrowed to the boxes that can actually scroll, plus `main`; see the matching deferred entry about the probe never having gone red.
  - `[medium]` `[patch]` Neither the 600–1200 two-column band nor the cutoff itself was observed at any viewport. Added a 768px check that two cards share a row with the table still hidden, the same two stacking at 390px, and the Mastery list computing one track at 768px.
  - `[medium]` `[patch]` The 390px availability check only asserted its container was visible, so a mis-keyed or dead card checkbox would have shipped green. It now ticks and unticks the pair, asserting the announcement and the state re-read from the server.
  - `[medium]` `[patch]` No test renamed a row in the card layout, leaving the `-card` id suffix — the invariant the change is built on — unpinned. A 390px Students rename round-trip now asserts exactly one `New name` textbox is in the tree and that its id is the card's.
  - `[medium]` `[patch]` The `TopicCurationList` card branch was executed by nothing. Added a 14-case render spec: one card per topic in API order, every column as a field, a real list, no merge panel until one is opened, and each row-scoped id template carrying the suffix exactly once.
  - `[low]` `[patch]` `CardList` was a `ul` with `listStyle: 'none'`, which strips list semantics in Safari/VoiceOver — `role="list"`/`role="listitem"` restored and asserted.
  - `[low]` `[patch]` The card title was a hardcoded `h3` that vanished entirely during a rename, so the heading outline changed shape per row state. The title is no longer a heading on any screen; the card stays named by its `aria-label`.
  - `[low]` `[patch]` `dataAttributes` spread after the card's own `data-testid`, so a caller could clobber it; now spread first and typed to `data-*` keys only.
  - `[low]` `[patch]` A long unbreakable title (an account email) could overflow the card at 390px — wrap and `minWidth: 0` added.
  - `[low]` `[patch]` `CardList`'s accessible name was optional although the table it replaces always has one; now required, which surfaced seven call sites vitest could not have caught.
  - `[low]` `[patch]` `consumptionBody`'s `consumption ? … : null` ternary could never yield `null` and would have rendered an empty disclosure if the branches diverged. Removed by taking a non-null reading.
  - `[low]` `[patch]` `measureActionCell`'s `td:last-child` was a descendant match that could resolve a nested table's cell — the consumption panel is exactly such a row. Narrowed to the row's direct child.
  - `[low]` `[patch]` `css()` returned `''` when no style tag was emitted, making every negative stylesheet assertion vacuous; it now asserts the sheet is non-empty, and the token sweep is re-anchored so `440` cannot read as `44`.
  - `[low]` `[patch]` The 390px mastery assertions were bolted into the drill-down test, which resized mid-test; they have their own test and the drill-down no longer resizes.
  - `[low]` `[patch]` In the mockup, the card list re-used the caption's id through a second `aria-labelledby` (the name was announced twice), the threshold note sat inside the list as a seventh item, three `class=""` attributes were empty, and all six cards hardcoded the same run count. All fixed; the annotated `.mtable` rules stay as the record of the desktop shape.

## Design Notes

**Why the table keeps today's ids and only the card suffixes.** Both layouts render the same row, so every row-scoped `id` would otherwise appear twice. Suffixing the *card* side alone makes them unique while leaving every existing desktop query — `chooseGradeLevel(page, `student-grade-level-${id}`)`, `consumption-${account.id}` as the chevron's `aria-controls` — valid exactly as written.

**Why `display: none` and not `visuallyHidden`.** `MasteryTable` currently hides four columns with the clip-rect trick precisely so their headers stay in the accessibility tree. Here the opposite is wanted: the hidden layout is a duplicate, so it must be out of the tree entirely or every row is announced twice. That inverts the existing spec rule, which is why `MasteryTable.spec.tsx` is on the task list rather than left alone.

**The shape of the swap, once:**

```tsx
const d = theme.density ?? density;
<TableOnDesktop>{/* today's <Table> verbatim */}</TableOnDesktop>
<CardList ranked={false}>
  {items.map((item) => (
    <TableCard key={item.id} title={item.name} actions={<RowActions {...} />}>
      <CardField label={adminCopy.taxonomy.statusColumn} value={statusText(item)} />
    </TableCard>
  ))}
</CardList>
```

**Unit specs see both layouts.** `renderToStaticMarkup` emits breakpoint styles as classes, so every assertion that *counts* occurrences of a testid, a marker, or a row attribute now counts both layouts. Give the card rows their own testids (`mastery-card`, `*-card-row`) and fix the counts rather than loosening the assertions.

## Verification

**Commands:**
- `pnpm --filter web run typecheck` -- expected: clean.
- `pnpm --filter web run lint` -- expected: clean, jsx-a11y satisfied by the real `ul`/`li` and real controls.
- `pnpm --filter web run test` -- expected: all specs pass, including the new `TableCards.spec.tsx` and the rewritten `MasteryTable.spec.tsx`.
- `pnpm --filter web run build` -- expected: a successful production build.
- `pnpm exec playwright test e2e/tests/parent-students.spec.ts e2e/tests/admin-taxonomy.spec.ts e2e/tests/admin-accounts.spec.ts e2e/tests/parent-analytics.spec.ts` -- expected: pass, with the phone-width checks exercising cards and the desktop checks exercising tables.
- `pnpm prettier --write .` -- expected: no unformatted files remain.

**Manual checks (if no CLI):**
- Light and dark mode at 360px, 768px, and 1180px on all six screens: cards only, no clipped or overlapping field, no horizontal scroll; and at 1280px: tables only, unchanged from today.

## Auto Run Result

**Summary:** This was a fresh, follow-up review pass over a story already at `status: done` (the orchestrator had flagged `followup_review_recommended: true`). No new implementation work was planned in this pass — the diff reviewed is the one already shipped at `baseline_revision` → `HEAD`. Four review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran against that diff; two real, low/medium-severity patches were found and fixed, five pre-existing or low-impact issues were deferred, and four findings were rejected as redundant with the deferred items the prior pass had already logged.

**Files changed this pass:**
- `apps/web/src/app/parent/analytics/_components/MasteryTable.tsx` -- the card's Status field now always renders (empty when not a weak area), matching the table's always-present Status cell.
- `apps/web/src/app/parent/analytics/_components/MasteryTable.spec.tsx` -- `mastery-status-card` count assertion updated from 1 to 3 to match.
- `e2e/fixtures.ts` -- `measureActionArea` now throws an explicit error, naming the selector, instead of letting a zero-element match time out opaquely downstream.
- `_bmad-output/implementation-artifacts/spec-1-9-cards-below-desktop.md` -- this review pass's triage log, five new deferred items, and this result.

**Review findings breakdown:** patch 2 (medium 1, low 1) -- both fixed; defer 5 (low 5) -- added to frontmatter `deferred`; reject 4 (medium 1, low 3) -- dropped as redundant with items already in `deferred` from the prior pass.

**Follow-up review recommendation:** `false`. This pass's patched findings score `3*medium(1) + 1*low(1) = 4`, below the 5 threshold, and none was `high`.

**Verification performed:**
- `pnpm --filter web run typecheck` -- clean.
- `pnpm --filter web run lint` -- clean.
- `pnpm --filter web run test` -- 90 files, 1924 tests, all passing.
- `pnpm --filter web run build` -- succeeded.
- `pnpm exec playwright test e2e/tests/parent-students.spec.ts e2e/tests/admin-taxonomy.spec.ts e2e/tests/admin-accounts.spec.ts e2e/tests/parent-analytics.spec.ts` -- 34 passed. (First attempt failed on missing seed data because the already-running local dev `api`/`web` were reused by Playwright's `reuseExistingServer`, skipping the `e2e:prepare` seed step; stopped the dev stack's `api`/`web`, kept `postgres`, and reran so Playwright started its own seeded servers.)
- `pnpm prettier --write .` on the touched files -- no changes needed.

**Residual risks:** the five newly deferred items (breakpoint-crossing interaction desync across RowActions/rename/select controls, a pre-existing dangling `aria-controls` id, ragged two-column card rows when a panel is open, a possible duplicate-fallback-name accessible-name collision, and the five screens' empty-list message not literally matching the spec's "empty `ul`, no placeholder" row) are all low severity and not caused by this pass. None blocks shipping.

