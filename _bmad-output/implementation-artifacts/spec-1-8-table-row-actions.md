---
title: 'Story 1.8: Table Row Actions'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_revision: 'f6ff4bb818e19003a53a8f93f0a532166eff04df'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The Topic curation screen has no executing test coverage at all: its spec asserts
      the component's source text and no Playwright suite visits /admin/topics.
    evidence: |-
      apps/web/src/app/admin/topics/page.spec.tsx reads page.tsx and TopicCurationList.tsx
      with readFileSync and asserts on substrings; there is no e2e/tests/admin-topics*.spec.ts.
      Swapping the Confirm and Merge handlers would ship green. Pre-existing: the screen never
      had behavioural coverage, and this story only changed how its actions are reached.
    location: >-
      apps/web/src/app/admin/topics/page.spec.tsx
    severity: medium
  - summary: >-
      Choosing Rename from a row menu reveals an inline text field that never receives
      focus and is never announced.
    evidence: |-
      TaxonomyList, TopicCurationList and the Students table all swap the cell to a TextField
      when renamingId is set; nothing calls focus() on it. Pre-existing — the old in-cell
      Rename button was itself unmounted by the swap, losing focus entirely — but the menu
      makes the revealed field one more step away from where focus lands.
    location: >-
      apps/web/src/app/admin/_components/TaxonomyList.tsx
    severity: low
  - summary: >-
      The deferred-work ledger still tracks parentCopy.students.restoreNote, a string this
      story deleted.
    evidence: |-
      _bmad-output/implementation-artifacts/deferred-work.md references restoreNote at a
      location that no longer exists; the entry needs closing or re-pointing by a sweep.
    location: >-
      _bmad-output/implementation-artifacts/deferred-work.md
    severity: low
  - summary: >-
      A disabled inline icon action would have no reachable name, because MUI shows no
      tooltip for a disabled child.
    evidence: |-
      RowActions wraps inline IconButtons in Tooltip and accepts disabled on an inline action.
      No current call site disables an inline action (the pencil and the chevron are always
      enabled), so this is latent rather than live; the usual fix is a wrapping span.
    location: >-
      apps/web/src/components/RowActions.tsx
    severity: low
  - summary: >-
      No automated check covers the four tables in dark mode or at tablet width.
    evidence: |-
      The new Playwright measurements run at 390px and desktop in the default theme only, and
      the unit renders use parentTheme. The spec files the light/dark, phone/tablet pass under
      manual checks; nothing in the repo asserts it, here or on any earlier design-system story.
    location: >-
      e2e/tests/admin-taxonomy.spec.ts
    severity: medium
  - summary: >-
      RowActions renders aria-expanded/aria-controls onto a MenuItem whenever a
      disclosure-type action lands in the overflow menu, which is a different ARIA
      meaning there (submenu disclosure) than on a toggle button.
    evidence: |-
      No current call site puts a disclosure action (expanded/controls) behind the
      overflow menu — only the inline chevron uses those props today — so this is
      latent, not live. A future row mixing a disclosure action with 2+ others would
      hit it.
    location: >-
      apps/web/src/components/RowActions.tsx
    severity: low
  - summary: >-
      epic-1-context.md now documents Story 1.9 (cards below desktop) as already
      consuming this story's RowActions component, before 1.9's card-list component
      exists in the codebase.
    evidence: |-
      The compiled epic context describes "1.9's cards consume 1.8's component" and
      a CSS-only breakpoint swap, but no Cards/list component was added by this diff;
      whoever starts 1.9 should verify the context doc against the real component
      surface rather than trusting the description as already-built.
    location: >-
      _bmad-output/implementation-artifacts/epic-1-context.md
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Every table with per-row actions renders each action as a text button with a leading icon ("✎ Rename", "Archive", "🗑 Delete", "Disable", "Confirm", "Merge"), so on a phone and in the narrow Admin columns the action cell wraps onto several lines and crowds the table.

**Approach:** Add one shared `RowActions` component that applies UX-DR43 — icon-only buttons, only a self-evident icon standing alone, everything else in a per-row `⋮` menu showing icon and label, at most 2 icons per row with `⋮` counting as one, and all actions in the menu once a row has more than 2 — then switch the four tables that have row actions onto it. No action's behavior, confirmation, pending state, or announcement changes.

## Boundaries & Constraints

**Always:** Self-evident icons are exactly pencil (rename), trash (delete), and chevron (expand/collapse); every other action goes in the menu. Every icon button and `⋮` trigger keeps an accessible name naming the row's object and shows a tooltip on hover *and* focus. A destructive menu item sits last, after a divider, in the error color, and keeps its disabled/pending state. Accessible names keep the existing `"{action} {name}"` wording so current `getByRole` queries survive, apart from the role change for items now inside the menu. The cap rule lives in a pure function so it is unit-testable under the repo's `environment: 'node'` runner. Copy stays in `copy/*.ts`, never inline. The expand toggle keeps `aria-expanded` and `aria-controls`.

**Block If:** nothing — the rule, the per-table placement, and the notes-row removal were all decided in the approved sprint change proposal.

**Never:** Do not change any action's handler, confirmation dialog, pending/disabled logic, or live-region announcement. Do not touch `AvailabilityMatrix.tsx` (checkbox grid) or `MasteryTable.tsx` (row is a link). Do not touch the capture screen's per-page delete — it is not a table row. No API, schema, or dependency change; `lucide-react` and MUI already ship what is needed. Do not introduce a DOM test runner or testing library to test the menu's keyboard behavior — pin the pure rules in unit specs and the keyboard path in E2E.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two self-evident actions | `[rename(selfEvident), delete(selfEvident)]` | Both inline as icon-only buttons; no `⋮` | No error expected |
| One self-evident, one not | `[rename(selfEvident), disable]` | Rename inline; Disable in menu; 2 icons total (pencil + `⋮`) | No error expected |
| Neither self-evident | `[archive, disable]` | Both in menu; `⋮` is the row's only icon | No error expected |
| More than 2 actions | `[confirm, rename, merge]` | All three in menu; nothing inline | No error expected |
| Single expand toggle | `[toggleConsumption(selfEvident, expanded, controls)]` | One inline chevron icon button, rotated when expanded, carrying `aria-expanded`/`aria-controls` | No error expected |
| Destructive in a menu | `[rename, archive, delete(destructive)]` | Delete rendered last, preceded by a divider, in the error color | No error expected |
| Disabled action | any action with `disabled: true` | The inline button or menu item is disabled and cannot fire | No error expected |
| Empty action list | `[]` | Renders nothing — no empty `⋮` trigger | No error expected |

</intent-contract>

## Code Map

- `apps/web/src/components/RowActions.tsx` -- **new.** The shared component plus the exported pure `planRowActions(actions)` returning `{ inline, menu }`. Follow the sibling primitives' shape (`Button.tsx`, `Dialog.tsx`): named exports, no default export, theme-driven styling only.
- `apps/web/src/components/RowActions.spec.tsx` -- **new.** Unit spec. `primitives.spec.tsx` and `Dialog.spec.tsx` are the pattern: `renderToStaticMarkup` under a `ThemeProvider`, plus direct assertions on exported pure functions.
- `apps/web/src/theme/theme.ts:196-204` -- `MuiIconButton` already applies `minWidth`/`minHeight: d.tapTarget` and `rounded.control`, so the per-surface tap-target floor comes free; `:231-238` -- `MuiMenu`/`MuiPopover` are already flat with `overlaySurface` (scrim plus border). Read-only: do not restyle.
- `apps/web/src/app/admin/_components/TaxonomyList.tsx:222-259` -- the action cell: Rename `Button` (pencil, `aria-label` `` `${rename} ${item.name}` ``) and Disable/Enable `Button` (`EyeOff`/`Eye`, `color` error/success, `disabled={isPending(item.id)}`). Replace with `RowActions`: Rename self-evident inline, Disable/Enable in the menu.
- `apps/web/src/app/admin/_components/TopicCurationList.tsx:277-320` -- Confirm (`Check`), Rename (`Pencil`), Merge (`GitMerge`, carries `aria-expanded={mergingId === topic.topicId}` and the "Cancel merge" label while open). Three actions, so all go in the menu; the merge item keeps the toggle label and `aria-expanded`. The merge panel below and `closeMerge()`/`openMerge()` wiring are unchanged.
- `apps/web/src/app/admin/_components/ParentAccountTable.tsx:240-266` -- the consumption toggle `Button` with `aria-expanded`, `aria-controls={`consumption-${account.id}`}`, `aria-label={adminCopy.consumptionToggleLabel(account.email)}` and a rotating `ChevronDown`. Becomes a single inline chevron icon button through `RowActions`, keeping all three attributes and the rotation.
- `apps/web/src/app/parent/students/page.tsx:103-140` -- `archiveNoteId`/`deleteNoteId` and `StudentRowNotes`; `:634-705` -- the Rename/Archive-or-Restore/Delete buttons and the `colSpan={4}` notes row. Three actions, so all go in the menu with Delete last after a divider; delete it all, including the exported id helpers and the `aria-describedby` references.
- `apps/web/src/copy/parent.ts:330-348` -- remove `archiveNote`, `restoreNote`, `deleteNote`; add the `⋮` trigger label. `archiveConfirmBody` already says history is kept and nothing is deleted, and `deleteBody` already names what is destroyed — they carry the Archive/Delete distinction now.
- `apps/web/src/copy/admin.ts:217-218, 294` -- `showConsumption`/`hideConsumption` become the tooltip/label source for the chevron; `consumptionToggleLabel` is unchanged. Add the `⋮` trigger label.
- `apps/web/src/app/parent/students/page.spec.tsx:90-110, 175-195, 280-316` -- the archive/delete copy assertions and the whole `StudentRowNotes` describe block, which must go with the notes row; keep the archive-vs-delete distinction asserted against the two confirmation bodies instead.
- `apps/web/src/app/admin/topics/page.spec.tsx` -- asserts `TopicCurationList.tsx`'s **source text** (merge-target guards, `useEffect` absence, confirmation ordering) and walks the copy list. Read-only evidence: those assertions survive, since `RowActions` is a separate file.
- `e2e/tests/admin-taxonomy.spec.ts:125, 169-174, 211-212` -- clicks `Disable {name}`, asserts tab order reaches `Rename/Disable {name}`, and asserts the focus ring and 44px hit area on both. Update to open `⋮` and use the menu item for Disable.
- `e2e/tests/parent-students.spec.ts:74-79, 112, 147` -- `confirmArchive()`, the Rename click, and the Restore click. Update to go through `⋮`.
- `e2e/tests/admin-accounts.spec.ts:98, 220-228, 252-253` -- queries the toggle by `Consumption for {email}`; the name does not change, so these stay as they are. Read-only evidence that the toggle rename is safe.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/components/RowActions.tsx` -- add `RowAction` (`key`, `label`, `icon`, `onClick`, `disabled?`, `destructive?`, `selfEvident?`, `ariaLabel?`, `expanded?`, `controls?`), the pure `planRowActions`, and the component: inline actions as `IconButton`s wrapped in `Tooltip`, the rest behind an `IconButton` `⋮` trigger (`MoreVertical`) opening a MUI `Menu` whose `MenuItem`s carry `ListItemIcon` + `ListItemText`, with a `Divider` before the destructive item and `color: 'error.main'` on it -- one component is what makes later tables follow UX-DR43 by default.
- `apps/web/src/components/RowActions.spec.tsx` -- unit-test every I/O matrix row against `planRowActions`, plus static-markup assertions that inline buttons and the `⋮` trigger emit real `button` elements with their object-naming accessible names, that the markup carries no visible action text outside the menu, and that an empty list renders nothing -- the cap rule is the story and must be pinned where the `node` runner can see it.
- `apps/web/src/copy/admin.ts` -- add `rowActionsLabel: (name: string) => ...` for the `⋮` trigger -- strings stay parameterised and out of components.
- `apps/web/src/copy/parent.ts` -- add the same `⋮` trigger label and remove `archiveNote`, `restoreNote`, `deleteNote` -- the notes row is gone, so the strings would be dead copy.
- `apps/web/src/app/admin/_components/TaxonomyList.tsx` -- replace the action cell with `RowActions`: Rename self-evident, Disable/Enable in the menu, both keeping their current `aria-label`s, pending state, and handlers.
- `apps/web/src/app/admin/_components/TopicCurationList.tsx` -- replace the three buttons with `RowActions`; all three land in the menu, and the merge item keeps its open/closed label and `aria-expanded`.
- `apps/web/src/app/admin/_components/ParentAccountTable.tsx` -- replace the toggle with a single self-evident `RowActions` chevron, keeping `aria-expanded`, `aria-controls`, the existing accessible name, and the rotation.
- `apps/web/src/app/parent/students/page.tsx` -- replace the three buttons with `RowActions` (Delete last, destructive); delete `StudentRowNotes`, `archiveNoteId`, `deleteNoteId`, the notes `TableRow`, and the `aria-describedby`/`title` references to them.
- `apps/web/src/app/parent/students/page.spec.tsx` -- drop the `StudentRowNotes` describe block and the removed-copy assertions; assert the Archive-vs-Delete distinction against `archiveConfirmBody` and `deleteBody` instead -- the distinction moved into the confirmations, so that is where it must be pinned.
- `e2e/tests/admin-taxonomy.spec.ts`, `e2e/tests/parent-students.spec.ts` -- reach menu-held actions by opening the row's `⋮` first; assert the focus ring and hit area on the `⋮` trigger and the inline pencil.
- `e2e/tests/admin-taxonomy.spec.ts` or `e2e/tests/parent-students.spec.ts` -- add one check at phone width that a row's action cell holds at most 2 icons, shows no visible action text, and produces no horizontal table scroll -- the wrapping this story exists to fix is only observable in a real viewport.

**Acceptance Criteria:**
- Given any table row rendered through `RowActions`, when it displays, then it shows at most 2 icon buttons counting the `⋮`, and no row action shows visible text outside the open menu.
- Given the open menu, when a destructive action is present, then it is the last item, preceded by a divider and rendered in the error color, and it stays disabled while that row is pending.
- Given the `⋮` trigger, when operated by keyboard, then Enter, Space, or click opens it, arrow keys move between items, Escape or choosing an item closes it, and focus returns to the trigger.
- Given any icon-only button or `⋮` trigger, when inspected, then its accessible name includes the row's object, a tooltip shows the action name on hover and on focus, and its box meets the surface's tap-target floor.
- Given Admin → Taxonomy, Admin → Topics, Parent → Students, and Admin → Accounts, when each renders, then placement is pencil + `⋮`, all-in-menu, all-in-menu with Delete last, and a lone rotating chevron respectively.
- Given the Students table, when a row renders, then no per-row notes row exists, and the Archive and Delete confirmations still state what is kept and what is destroyed.
- Given every action, when fired through its new control, then its handler, confirmation, pending state, and live-region announcement are byte-for-byte the behavior it had before.
- Given the full suites, when `pnpm --filter web run test` and the affected Playwright specs run, then they pass, changed only in how an action is reached.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 5: (high 0, medium 2, low 3)
- reject: 13: (high 0, medium 3, low 10)
- addressed_findings:
  - `[medium]` `[patch]` The Topics merge menu item's accessible name stayed "Merge {topic}" while its visible label flipped to "Cancel merge" — a Label-in-Name mismatch and a state lie. `ariaLabel` now flips with `label`.
  - `[medium]` `[patch]` The per-surface tap-target floor reached `MuiIconButton` only, so every action moved behind the `⋮` was a sub-44px target (MUI's `MenuItem` drops to `minHeight: auto` from `sm` up). Added a `MuiMenuItem` override in `buildTheme`, restated inside the `sm` media query so it outranks MUI's own, and pinned both density sets in `theme.spec.ts`.
  - `[medium]` `[patch]` The keyboard acceptance criterion was asserted nowhere — the E2E helper was click-only. Added real keyboard coverage: Enter and Space open the menu, focus lands on a `menuitem`, arrows move between items (asserted on the three-item Students menu, since a taxonomy row's menu holds one), Escape closes and returns focus to the trigger, and an open item's visible text and 44px box are measured.
  - `[medium]` `[patch]` Delete was never driven through the menu, leaving the Students placement criterion uncovered. The Students E2E now chooses Delete from the `⋮` and asserts its password-gated confirmation.
  - `[low]` `[patch]` The divider condition emitted a rule before every destructive item, so two destructive actions would be separated from each other. The decision moved into a pure `planMenuRows(menu)` and is unit-tested for one, two, and leading destructive items.
  - `[low]` `[patch]` Five `SOURCE.toContain(...)` assertions discharged rendered-appearance criteria by lexical substring — passing on unreachable JSX, failing on a prettier reflow. Deleted, and replaced with browser assertions on item order, a single separator above Delete, Delete's computed colour against `--mui-palette-error-main`, and the tooltip on hover and on focus.
  - `[low]` `[patch]` `chooseRowAction` was duplicated byte-for-byte across two suites, each hardcoding the `⋮` label, and an orphaned doc comment left `confirmArchive` undocumented. Helpers moved to `e2e/fixtures.ts`; comments restored.
  - `[low]` `[patch]` The phone-width test encoded "not two lines" as a bare `80`. Replaced with named `COMPACT_TAP_TARGET`/`ONE_LINE_CEILING` constants, and the measurement extended to the all-in-menu Students row at 390px.
  - `[low]` `[patch]` The `primitives.spec.tsx` `aria-expanded` exemption was keyed to a filename that could go stale silently. It now asserts `RowActions.tsx` is among the swept sources first.

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2: (high 0, medium 1, low 1)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - none

## Design Notes

**The cap rule is a pure function, not a render-time condition.** `apps/web` runs vitest with `environment: 'node'` and ships no DOM testing library, and a closed MUI `Menu` renders nothing into static markup — so the rule has to be assertable without a browser:

```ts
export function planRowActions<A extends RowAction>(actions: A[]): { inline: A[]; menu: A[] } {
  if (actions.length === 0) return { inline: [], menu: [] };
  if (actions.length > 2) return { inline: [], menu: actions };
  const selfEvident = actions.filter((a) => a.selfEvident === true);
  if (selfEvident.length === actions.length) return { inline: actions, menu: [] };
  // A ⋮ is itself one of the two allowed icons, so at most one action stays inline.
  return { inline: selfEvident.slice(0, 1), menu: actions.filter((a) => a !== selfEvident[0]) };
}
```

**Accessible names are preserved deliberately.** Keeping `"{action} {name}"` on the menu items as an explicit `ariaLabel` — while the item still *displays* icon + label — is what keeps the existing E2E queries meaningful after the move; only the role changes, from `button` to `menuitem`.

**Archive's distinction from Delete moves, it does not disappear.** Story 1.3 requires archive to be visibly distinct from delete. After this change that lives in two separate menu items with their own icons, the divider and error color on Delete, and the two confirmation bodies — which already say "history is kept. Nothing is deleted." and "cannot be undone". That is why the notes row can go.

## Verification

**Commands:**
- `pnpm --filter web run typecheck` -- expected: clean, including the removed `archiveNoteId`/`deleteNoteId` exports having no remaining importers.
- `pnpm --filter web run lint` -- expected: clean, with the jsx-a11y rules satisfied by the real `IconButton`/`MenuItem` elements.
- `pnpm --filter web run test` -- expected: all specs pass, including the new `RowActions.spec.tsx` rows and the amended students spec.
- `pnpm --filter web run build` -- expected: a successful production build.
- `pnpm prettier --write .` -- expected: no unformatted files remain.

**Manual checks (if no CLI):**
- Light and dark mode at phone, tablet, and desktop widths on the four tables: no action cell wrapping onto a second line, no clipped `⋮` menu, and the destructive item visibly set apart.

## Auto Run Result

**Summary:** Follow-up review pass only (`bmad-build-auto` resumed on a `done` spec, per step-01's `done` → fresh-review route). No code change made in this pass.

**Files changed:** none this pass.

**Review findings breakdown (this pass):** patches applied: 0, items deferred: 2, items rejected: 14.

**Follow-up review recommendation:** `false` (0 patched findings this pass; score 0 < 5, no high-severity patch).

**Verification performed:** none required — no patch to verify.

**Residual risks:** the two deferred items — `RowActions` renders `aria-expanded`/`aria-controls` onto a `MenuItem` for a disclosure action with no live call site yet (low); `epic-1-context.md` now describes Story 1.9's card component as already consuming `RowActions` before that component exists (medium) — see frontmatter `deferred` for both.

Status: done

