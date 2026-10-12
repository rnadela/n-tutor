# Sprint Change Proposal — Cards Below Desktop, Tables Only on Desktop

- **Date:** 2026-10-12
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Status:** Approved 2026-10-12; applied to epics.md, DESIGN.md, EXPERIENCE.md, sprint-status.yaml
- **Scope classification:** Minor (one new story; one new UX-DR; amends the responsive rules in DESIGN.md and EXPERIENCE.md; no API, schema, or PRD change)

## 1. Issue Summary

**Trigger.** On phones the app's tables are too tight. Columns squeeze, text wraps mid-word, and the action cell wraps onto several lines. Tablets are better but still cramped in portrait and in the Admin tables. Rvnadela, 2026-10-12: *below desktop, show tables as properly laid-out cards; only desktop gets a table.*

**Tables in the app (`apps/web/src`).**

| Table | File | Columns |
|---|---|---|
| Parent → Students | `app/parent/students/page.tsx:484` | Name, Grade level, Status, Actions |
| Parent → Analytics, Mastery | `app/parent/analytics/_components/MasteryTable.tsx:135` | Topic, Mastery %, bar, Answered, Unanswered, Weak Area |
| Admin → Taxonomy (subjects, grade levels) | `app/admin/_components/TaxonomyList.tsx:154` | Name, Status, Actions |
| Admin → Topics | `app/admin/_components/TopicCurationList.tsx:202` | Name, Subject, Uses, Created, Actions |
| Admin → Accounts | `app/admin/_components/ParentAccountTable.tsx:208` | Email, Name, Tier, Timezone, Created, Consumption toggle; the expanded row holds a nested allowance table (`:87`) |
| Admin → Availability | `app/admin/_components/AvailabilityMatrix.tsx:87` | Subject × Grade level grid of checkboxes |

**Decisions taken (with Rvnadela, 2026-10-12).**

| Decision | Choice |
|---|---|
| Desktop cutoff | **≥ 1200px (MUI `lg`).** Below that, cards. Phones, portrait tablets, and iPad landscape (1180px) get cards. Only the 13" iPad Pro in landscape (1366px) and desktops get a table. |
| Mastery table | **Converted.** One card per Topic. Ranking, Subject filter, and the drill-down link are unchanged. |
| Availability grid | **Converted.** One card per Subject, with its Grade Levels as labeled checkboxes. |
| Packaging | **New Story 1.9**, after Story 1.8. Cards reuse 1.8's `RowActions` in the card header. |
| Review mode | Batch |

## 2. Impact Analysis

### Epic impact
- **Epic 1:** add **Story 1.9 — Cards Below Desktop**. Epic 1 is already `in-progress` (Story 1.8).
- Epics 2, 7, 9 own the affected Admin and Analytics screens. Their behavior is unchanged, so no story is added to them.
- Other epics: no change.

### Story impact
- **Story 1.8 (backlog):** no text change. Its rules (icon-only buttons, ⋮ menu, at most 2 icons) apply unchanged in the card header. 1.9 depends on 1.8 landing first.
- **Story 7.4 (Analytics Dashboard, done):** its behavior holds: ranked weakest first, Subject filter, Weak Area marker, row opens the drill-down. Only the row presentation below 1200px changes. Not reopened.
- No other completed story is reopened.

### Artifact conflicts

| Artifact | Conflict | Update |
|---|---|---|
| PRD | FR-28 says "ranked … Mastery by Topic"; it does not say "table". | **None.** |
| Architecture | None. Web-only presentation. | **None.** |
| `DESIGN.md` Layout & Spacing (`:517`) | "Breakpoint-specific layouts only where the device changes the task … no desktop-specific work is in v0." Tables-on-desktop-only is a third breakpoint-specific layout, and a desktop one. | **Amend** (4.4). |
| `DESIGN.md` Mastery row (`:580`) | Defines a 40px table row only. | **Amend**: the row becomes a card below `lg` (4.5). |
| `DESIGN.md` Components | No list-card component. | **Add Table card** component (4.6). Uses existing tokens only. |
| `EXPERIENCE.md` Responsive & Platform (`:523`) | Same "single fluid layout" rule; the Analytics tablet row puts answered/unanswered into "real columns". | **Amend** the rule and the Analytics row; **add a Data tables row** (4.7, 4.8). |
| `EXPERIENCE.md` Mastery table (`:250`) | "Ranked table … Each row …" | **Amend** to "ranked list: cards below desktop, table on desktop" (4.9). |
| `EXPERIENCE.md` Row actions (added by Story 1.8 proposal) | Says "table". | **Amend** to cover cards (4.10). |
| `mockups/key-analytics.html` | Shows the phone and tablet layout as table rows. | **Out of date** once 1.9 lands. Story 1.9 updates the mock's phone and tablet frames to cards. |
| `epics.md` | — | **Add UX-DR44 and Story 1.9**; add UX-DR44 to Epic 1's Relevant UX-DRs (4.1–4.3). |
| `sprint-status.yaml` | — | Add `1-9-cards-below-desktop: backlog`. |

### Technical impact
- **Web:** a shared pattern. Each table component renders a desktop `<Table>` and a card list, switched by CSS only: `sx` `display` keys at `lg`. No `useMediaQuery`. This follows the existing rule at `MasteryTable.tsx:53`: a viewport hook renders one layout first and then swaps, which causes a visible jump on slow devices. The hidden layout uses `display: none`, so it is out of the accessibility tree and nothing is announced twice. The `phoneVisuallyHidden` columns trick in `MasteryTable` is removed.
- **Shared state:** both layouts read the same component state (rename draft, merge panel, expanded consumption, pending). Element `id`s that `aria-controls`/`aria-describedby` point at are made unique per layout.
- **Tests:** jsdom ignores media queries, so the base (`xs`) style applies: unit specs see the **card** layout. Table-only assertions move to a desktop-viewport Playwright check. E2E runs each affected screen at 390px (cards) and 1280px (table).
- **API / schema / deploy:** none.

## 3. Recommended Approach

**Direct Adjustment.** Add one story inside Epic 1.

- **Rationale:** presentation-only. Data, sorting, actions, and confirmations are unchanged. A shared card pattern keeps all six screens consistent and makes future tables follow it by default.
- **Effort:** medium, about 2 days. Shared card primitives plus spec take half a day; the 6 screens take about a day; spec, E2E, and mock updates take half a day.
- **Risk:** low–medium. The main risk is test churn, because unit specs flip to the card layout. Duplicate `id`s across the two layouts are the main correctness risk; an AC covers them.
- **Order:** after Story 1.8, so cards reuse `RowActions`. Independent of 2.3, 3.7, 3.8, 4.7.

## 4. Detailed Change Proposals

### 4.1 `epics.md` — add UX-DR44 (after UX-DR43)

```
UX-DR44: Implement data tables as cards below desktop: below the `lg` breakpoint (1200px) every data table renders as a list of cards, and only at `lg` and above as a table. The switch is CSS-only (no viewport hook), so there is no layout swap after first paint, and the hidden layout is out of the accessibility tree. Each card is a flat, divider-bordered surface at the surface's card padding: the row's identifying value as the card title, the row actions (UX-DR43) at the card's top-right, and every other column as a labeled field (label in caption, value in body, tabular figures for numbers). Cards stack in one column on phones and two columns from `sm` (600px), except ranked lists, which stay one column so the rank reads top to bottom. The card list is a real list, each card named by its title. Nothing a table shows is dropped from its card.
```

### 4.2 `epics.md` — Epic 1 Relevant UX-DRs

OLD:
```
…, UX-DR43 (table row actions, Story 1.8)
```
NEW:
```
…, UX-DR43 (table row actions, Story 1.8), UX-DR44 (cards below desktop, Story 1.9)
```

### 4.3 `epics.md` — add Story 1.9 (after Story 1.8)

```
### Story 1.9: Cards Below Desktop

As a parent or operator on a phone or tablet,
I want lists shown as cards rather than squeezed tables,
So that every value is readable without columns crushing together.

**Acceptance Criteria:**

**Given** any data table in the app
**When** the viewport is below 1200px (MUI `lg`)
**Then** it renders as a list of cards, and at 1200px and above it renders as the table
**And** the switch is CSS-only (`sx` breakpoint keys, no `useMediaQuery`), with no layout swap after first paint

**Given** a card
**Then** it is a flat surface with a 1px divider border, no shadow, the control radius, and the surface's card padding
**And** its title is the row's identifying value, the row actions (Story 1.8, same icon and menu rules) sit at its top-right, and every other column is a labeled field: caption label, body value, tabular figures for numbers
**And** nothing the table shows is missing from the card

**Given** the card list
**Then** it is one column below 600px, and two columns from 600px, except ranked lists, which stay one column
**And** it is a real list (`ul`/`li`), and each card is named by its title

**Given** both layouts exist in the DOM
**Then** the hidden one is `display: none` (out of the accessibility tree), both read the same component state, and every `id` referenced by `aria-controls` or `aria-describedby` is unique across the two

**Given** Parent → Students
**Then** each card shows name (title), grade level, and status chip, with row actions at top-right; inline rename replaces the title in place

**Given** Parent → Analytics, Mastery
**Then** each card shows the Topic (title, a real link to the drill-down), Mastery % in tabular figures, the inline bar, answered and unanswered counts, and the Weak Area marker where it applies
**And** cards stay ranked weakest first in one column, the Subject filter is unchanged, and on a tablet the sparkline and summary stay in the left column beside the card list

**Given** Admin → Taxonomy and Admin → Topics
**Then** each card shows the item name (title), its status or subject, uses, and created date as fields, with row actions at top-right; inline rename and the merge panel open inside the card

**Given** Admin → Accounts
**Then** each card shows email (title), name, tier, timezone, and created date, with the consumption chevron at top-right; when expanded, the allowance figures show inside the card as a labeled list, not a nested table

**Given** Admin → Availability
**Then** each Subject is a card titled with the Subject name, listing its Grade Levels as labeled checkboxes with the same toggle behavior

**Given** the change
**Then** unit specs cover the card layout; a Playwright E2E checks each affected screen at 390px (cards, no horizontal scroll) and 1280px (table); `mockups/key-analytics.html` phone and tablet frames are updated to cards; and a visual pass in light and dark mode shows no clipped or overlapping field at 360px, 768px, and 1180px
```

### 4.4 `DESIGN.md` — Layout & Spacing, breakpoint rule (`:517`)

OLD:
```
**Breakpoint-specific layouts only where the device changes the task.** Most screens are one fluid layout per surface. Two screens get a genuine second layout — the test-taking screen (where the 34rem measure leaves tablet width to allocate) and the Analytics dashboard. Desktop is supported but not optimized: the fluid layouts must not break there, and no desktop-specific work is in v0.
```
NEW:
```
**Breakpoint-specific layouts only where the device changes the task.** Most screens are one fluid layout per surface. Two screens get a genuine second layout — the test-taking screen (where the 34rem measure leaves tablet width to allocate) and the Analytics dashboard. **One cross-cutting exception: data tables.** Below `lg` (1200px) every data table renders as `{components.table-card}` cards; only at `lg` and above is it a table. *Why:* a table on a phone or tablet squeezes its columns until values wrap mid-word; a card gives each value its own line and label. *(Added 2026-10-12, see `sprint-change-proposal-2026-10-12-table-cards.md`.)* Desktop is otherwise supported but not optimized: the fluid layouts must not break there, and no other desktop-specific work is in v0.
```

### 4.5 `DESIGN.md` — Mastery row (`:580`), prepend sentence

OLD:
```
**Mastery row** — control role, Analytics. `{spacing.density.compact.row-height}` 40px, divider-bottom, no shadow.
```
NEW:
```
**Mastery row** — control role, Analytics. At `lg` and above, a table row: `{spacing.density.compact.row-height}` 40px, divider-bottom, no shadow. Below `lg`, a `{components.table-card}` carrying the same content, one column, in rank order.
```

### 4.6 `DESIGN.md` — add Table card component (after Mastery row)

```
**Table card** — control role when the row opens something, paper role otherwise; every data table below `lg`. `{rounded.control}`, `{colors.background-paper}` on a 1px `{colors.divider}` border, no shadow, `{spacing.density.*.card-padding}` for its surface. Title: the row's identifying value in `{typography.card-title}`. Row actions top-right, under the same rules as on a table row. Every other column is a field: label in `{typography.caption}` at `{colors.text-secondary}`, value in `{typography.table-cell}`, numbers in tabular figures. Fields wrap as label-over-value; they never sit side by side so tightly that a value truncates. Cards sit `{spacing.density.*.gap}` apart: one column below `sm`, two from `sm`, one always for ranked lists.
```

### 4.7 `EXPERIENCE.md` — Responsive & Platform rule (`:523`)

OLD:
```
**Breakpoint-specific layouts only where the device changes the task.** Most screens are a single fluid layout per surface, unchanged between phone and tablet.
```
NEW:
```
**Breakpoint-specific layouts only where the device changes the task.** Most screens are a single fluid layout per surface, unchanged between phone and tablet. **Data tables are the cross-cutting exception:** cards below desktop (1200px), a table only on desktop (see the Data tables row).
```

### 4.8 `EXPERIENCE.md` — Responsive table: amend Analytics row, add Data tables row

Analytics dashboard, Tablet cell. OLD:
```
… sit in a fixed left column alongside the Mastery table rather than stacking, and the phone row's stacked sub-line becomes real answered / unanswered / Weak Area columns. No reduction in row density.
```
NEW:
```
… sit in a fixed left column alongside the Mastery list rather than stacking. The Mastery list is cards on phone and tablet, and a table with real answered / unanswered / Weak Area columns only at desktop width.
```

Add row:
```
| **Data tables** (Students, Mastery, Admin Taxonomy, Topics, Accounts, Availability) | Cards, one column. | Cards, two columns (ranked lists stay one). A table only at desktop width (≥ 1200px). Each card: the row's identifying value as title, row actions top-right, every other column as a labeled field. Nothing the table shows is dropped. |
```

### 4.9 `EXPERIENCE.md` — Mastery table binding rules (`:256`–`:257`)

OLD:
```
- Ranked table with inline bars, **sorted weakest first**, …
- Each row: Topic, Mastery % …
```
NEW:
```
- Ranked list with inline bars — cards below desktop, a table at desktop width — **sorted weakest first**, …
- Each row or card: Topic, Mastery % …
```

### 4.10 `EXPERIENCE.md` — Row actions row (from Story 1.8 proposal)

OLD:
```
| Row actions | Every table with per-row actions (Students, Admin Taxonomy, Topics, Accounts) | Icon-only buttons; …
```
NEW:
```
| Row actions | Every table row or table card with per-row actions (Students, Admin Taxonomy, Topics, Accounts) | Icon-only buttons; on a card they sit at its top-right; …
```

### 4.11 `sprint-status.yaml`

```
  1-8-table-row-actions: backlog
  1-9-cards-below-desktop: backlog   # new
```

## 5. Implementation Handoff

- **Scope:** Minor. Direct implementation by the Developer agent (`bmad-build` on Story 1.9, after Story 1.8).
- **Deliverables:** shared card-list primitives; the six screens switched; unit and E2E specs; `key-analytics.html` phone and tablet frames updated.
- **Success criteria:**
  - Below 1200px no data table renders, and every screen shows cards with no horizontal scroll at 360px.
  - At 1200px and above every screen shows its table, unchanged from today.
  - No layout swap after first paint; no duplicate `id`s; screen reader hears each item once.
  - Existing unit and E2E suites green; new viewport E2E green.
