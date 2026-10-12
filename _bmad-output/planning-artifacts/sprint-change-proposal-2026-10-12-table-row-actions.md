# Sprint Change Proposal — Table Row Actions (Icon Buttons & Action Menu)

- **Date:** 2026-10-12
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Status:** Approved 2026-10-12; applied to epics.md, EXPERIENCE.md, sprint-status.yaml
- **Scope classification:** Minor (one new story; one new UX-DR; one UX-spec row added, one amended; no API, schema, or PRD change)

## 1. Issue Summary

**Trigger.** Tables with per-row actions render each action as a text button with a leading icon ("✎ Rename", "Archive", "🗑 Delete", "Disable", "Confirm", "Merge"). On a phone, and on the narrower Admin columns, the action cell wraps onto several lines and crowds the table.

**Requested rule (Rvnadela, 2026-10-12).**
1. Row actions are **icon-only buttons**.
2. An action whose icon is **not self-evident** (e.g. Archive) goes in an **action menu** (⋮), where each item shows **icon + label**.
3. **At most 2 icons** per row. More than 2 actions → **all** go in the action menu.

**Affected tables (survey of `apps/web/src`).**

| Table | File | Row actions today | Count |
|---|---|---|---|
| Admin → Taxonomy (subjects, grade levels) | `app/admin/_components/TaxonomyList.tsx:222` | Rename · Disable/Enable | 2 |
| Admin → Topics (provisional curation) | `app/admin/_components/TopicCurationList.tsx:277` | Confirm · Rename · Merge | 3 |
| Parent → Students | `app/parent/students/page.tsx:634` | Rename · Archive/Restore · Delete, plus a notes row explaining Archive vs Delete | 3 |
| Admin → Accounts | `app/admin/_components/ParentAccountTable.tsx:240` | "Show consumption ▾" expand toggle | 1 |

Not affected: `AvailabilityMatrix.tsx` (checkbox grid, no row actions), `MasteryTable.tsx` (row is a link, no action buttons).

**Decisions taken (with Rvnadela, 2026-10-12).**

| Decision | Choice |
|---|---|
| Self-evident icons (may stand alone) | Rename = pencil, Delete = trash, expand/collapse = chevron. Everything else goes in the menu. |
| Taxonomy (Rename + Disable/Enable) | **Pencil icon + ⋮ menu** holding Disable/Enable. The ⋮ counts toward the 2-icon cap. |
| Accounts consumption toggle | **In scope.** Becomes an icon-only chevron button that rotates when open. |
| Students notes row | **Removed.** Archive/Delete distinction carried by the confirm dialogs, which already state what is kept / destroyed. |
| Review mode | Batch |

## 2. Impact Analysis

### Epic impact
- **Epic 1 (Parent Accounts, PINs & Student Profiles):** add **Story 1.8 — Table Row Actions**. Epic 1 owns the design-system foundation (Story 1.7) and the Students table (Story 1.3). Epic reopens `done` → `in-progress`.
- Epics 2 and 7 own the Admin tables, but their behavior does not change; only the presentation pattern does, so no story is added to them.
- Epics 3–10: no change.

### Story impact
- No completed story is reopened. Every action keeps its behavior, confirmation, pending/disabled state, and live-region announcement.
- **Story 1.3** (archive "visibly distinct from delete"): still met. The two are separate menu items with different icons; Delete is set apart by a divider and the error color; each opens its own confirmation that says what it keeps or destroys.
- **UX-DR33** (icon-only controls labeled with the object they act on): the new pattern relies on it directly. Every icon button and the ⋮ trigger get an accessible name that includes the row's object.

### Artifact conflicts

| Artifact | Conflict | Update |
|---|---|---|
| PRD | FR-3 (profiles), FR-30 (taxonomy), FR-40 (topic curation) describe capabilities, not layout. | **None.** |
| Architecture | None. Web-only presentation. | **None.** |
| `epics.md` | No row-action rule. | **Add UX-DR43**, **add Story 1.8**, add UX-DR43 to Epic 1's Relevant UX-DRs (4.1–4.3). |
| `EXPERIENCE.md` component table | No row-action rule. The Student Profile form row says archive is "visibly distinct from delete", which assumed side-by-side text buttons. | **Add a Row actions row; amend the Student Profile form row** (4.4, 4.5). |
| `DESIGN.md` | `Menu` already flat with a divider border (line 532). Icon buttons already carry the divider boundary (line 440). | **None.** |
| `sprint-status.yaml` | — | Add `1-8-table-row-actions: backlog`; `epic-1` → `in-progress`. |

### Technical impact
- **Web:** a new shared `RowActions` component (under `components/`) takes a list of actions `{ key, label, icon, onClick, disabled?, destructive?, selfEvident? }` and an object name, then applies the rule. The four tables switch to it. MUI `IconButton`, `Tooltip`, `Menu`, `MenuItem`, `ListItemIcon`, `ListItemText`, `Divider`; lucide `MoreVertical`. No new dependency.
- **Copy:** `copy/admin.ts` and `copy/parent.ts` gain an "Actions for {name}" label for the ⋮ trigger. `parentCopy.students.archiveNote`, `deleteNote`, `restoreNote`, and the `archiveNoteId`/`deleteNoteId` helpers are removed.
- **Tests:** unit specs for `RowActions` (cap rule, menu rule, labels, keyboard). Existing table specs and E2E that find buttons by visible text ("Rename", "Archive") switch to accessible-name or menu-item queries. Accessible names keep the current `"{action} {name}"` form, so `getByRole('button', { name })` queries mostly survive. Menu items need a ⋮ open step first.
- **API / schema / deploy:** none.

## 3. Recommended Approach

**Direct Adjustment.** Add one story inside Epic 1.

- **Rationale:** a presentation-only rule. All actions, flows, and confirmations stay as they are. One shared component enforces the rule, so later tables follow it by default.
- **Effort:** medium-small, about 1 day. The component plus spec is half a day; switching 4 tables and fixing the specs they break is the other half.
- **Risk:** low. The main risk is test churn in `students/page.spec.tsx` and the admin specs. Keeping accessible names unchanged limits it.
- **Order:** independent of all open stories (2.3, 3.7, 3.8, 4.7). Can land any time.

## 4. Detailed Change Proposals

### 4.1 `epics.md` — add UX-DR43 (after UX-DR42)

```
UX-DR43: Implement table row actions as one shared pattern: each row action is an icon-only button, and only a self-evident icon (Rename = pencil, Delete = trash, expand/collapse = chevron) may stand alone. Any other action goes in a per-row action menu (⋮) whose items show icon and label together. A row shows at most 2 icons, and the ⋮ counts as one. When a row has more than 2 actions, all of them go in the menu and the ⋮ is the only icon. Every icon button and every ⋮ trigger has an accessible name that includes the row's object ("Rename Grade 3", "Actions for Grade 3"), a tooltip showing the action name on hover and focus, and the surface's tap-target floor. Destructive menu items are set apart by a divider and the error color.
```

### 4.2 `epics.md` — Epic 1 Relevant UX-DRs

OLD:
```
**Relevant UX-DRs:** UX-DR1, … UX-DR36, UX-DR37 (design system foundation, Story 1.7)
```
NEW:
```
**Relevant UX-DRs:** UX-DR1, … UX-DR36, UX-DR37 (design system foundation, Story 1.7), UX-DR43 (table row actions, Story 1.8)
```

### 4.3 `epics.md` — add Story 1.8 (after Story 1.7)

```
### Story 1.8: Table Row Actions

As a parent or operator,
I want each table row's actions shown as compact icons or a single actions menu,
So that tables stay readable and uncrowded, on a phone too.

**Acceptance Criteria:**

**Given** a shared row-actions component
**When** a row has at most 2 actions and every action has a self-evident icon (Rename = pencil, Delete = trash, expand/collapse = chevron)
**Then** each action renders as an icon-only button, with no visible text

**Given** a row with at most 2 actions where one action's icon is not self-evident
**Then** the self-evident action renders as an icon-only button and the other goes in an action menu (⋮), and the row shows no more than 2 icons including the ⋮

**Given** a row with more than 2 actions
**Then** all of its actions go in the action menu and the ⋮ is the row's only icon

**Given** the action menu is open
**Then** each item shows its icon and its label, keeps the action's disabled/pending state, and a destructive item is set apart by a divider and the error color
**And** it opens with Enter, Space, or click, moves with arrow keys, closes on Escape or after a choice, and returns focus to the ⋮

**Given** any icon-only button or ⋮ trigger
**Then** its accessible name includes the row's object (UX-DR33), a tooltip shows the action name on hover and focus, and it meets the surface's tap-target floor

**Given** Admin → Taxonomy (Rename, Disable/Enable)
**Then** Rename is a pencil icon button and Disable/Enable is in the ⋮ menu

**Given** Admin → Topics (Confirm, Rename, Merge)
**Then** all three are in the ⋮ menu, and the Merge item reads "Cancel merge" while that row's merge panel is open

**Given** Parent → Students (Rename, Archive or Restore, Delete)
**Then** all three are in the ⋮ menu, with Delete last after a divider
**And** the per-row notes row is removed; the Archive confirmation still states that history is kept and nothing is deleted, and the Delete confirmation still names what is destroyed and that it cannot be undone

**Given** Admin → Accounts (show/hide consumption)
**Then** the toggle is an icon-only chevron button that rotates when open, keeping `aria-expanded` and `aria-controls`

**Given** an action's behavior today (inline rename form, confirmations, pending state, live-region announcement)
**Then** it is unchanged

**Given** the change
**Then** the component has a unit spec covering the cap, menu, label, and keyboard rules; existing table unit and E2E specs pass, updated only for how actions are reached; and a visual pass in light and dark mode, on a phone and a tablet, shows no action cell wrapping onto a second line
```

### 4.4 `EXPERIENCE.md` — add Row actions row (component table, after "Destructive confirmation")

```
| Row actions | Every table with per-row actions (Students, Admin Taxonomy, Topics, Accounts) | Icon-only buttons; only a self-evident icon stands alone (Rename = pencil, Delete = trash, expand/collapse = chevron). Any other action goes in a per-row ⋮ action menu whose items show icon **and** label. **At most 2 icons per row, ⋮ included; more than 2 actions → all in the menu.** Every icon and ⋮ is labeled with the row's object and shows a tooltip. Destructive menu items sit last, after a divider, in the error color. *Why:* text buttons wrap the action cell onto several lines on a phone and crowd the table; an icon that has to be guessed is worse than a menu. |
```

### 4.5 `EXPERIENCE.md` — amend Student Profile form row

OLD:
```
Archive is presented as *hides from Student Mode, keeps history* and is visibly distinct from delete.
```
NEW:
```
Archive is presented as *hides from Student Mode, keeps history* and is visibly distinct from delete: separate action-menu items with their own icons, Delete set apart by a divider and the error color, and each confirmation stating what it keeps or destroys.
```

### 4.6 `sprint-status.yaml`

```
  epic-1: in-progress          # was: done
  ...
  1-7-design-system-foundation: done
  1-8-table-row-actions: backlog   # new
```

## 5. Implementation Handoff

- **Scope:** Minor. Direct implementation by the Developer agent (`bmad-build` on Story 1.8).
- **Deliverables:** shared `RowActions` component with unit spec; the four tables switched over; notes-row copy and helpers removed; specs updated.
- **Success criteria:**
  - No table row shows more than 2 icons, and no row action shows visible text outside the menu.
  - Archive, Restore, Enable/Disable, Confirm, and Merge are reachable only through the ⋮ menu, as icon + label.
  - Keyboard and screen-reader pass: every trigger is named with its row's object, and the menu is fully operable by keyboard.
  - Existing unit and E2E suites are green.
