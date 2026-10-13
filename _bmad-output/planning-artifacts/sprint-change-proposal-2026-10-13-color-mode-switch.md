# Sprint Change Proposal — Light / Dark Mode Switch

- **Date:** 2026-10-13
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Status:** Approved 2026-10-13; applied to prd.md, epics.md, EXPERIENCE.md, sprint-status.yaml
- **Scope classification:** Minor (one new FR, one new story, one new UX-DR, one EXPERIENCE.md row; no API, schema, or architecture-decision change)

## 1. Issue Summary

**Trigger.** Rvnadela, 2026-10-13: "I don't see the theme, dark mode and light mode to switch anywhere."

**Finding (ce-debug, 2026-10-13).** Not a defect. The app follows the device's light/dark preference and offers no in-app choice, exactly as specified:

- `apps/web/src/theme/theme.ts:102` builds light and dark color schemes switched by a `data-*` attribute (`cssVariables: { colorSchemeSelector: 'data' }`).
- `apps/web/src/app/layout.tsx:62` mounts `<InitColorSchemeScript attribute="data" />`, which sets that attribute from the device preference before first paint.
- No code in `apps/web/src` calls `useColorScheme()` / `setMode`.
- PRD §6.1 (line 933) states dark mode adds "no … user-visible choice", so it was carried as an accessibility obligation and never as an FR.
- `prds/…/review-consistency.md:222` had recommended "follows the OS preference with a manual override persisted per device"; that half was never adopted.

**Why it matters.** A parent or child whose device is set to light mode cannot get the dark theme in a dim room (the §6.1 use case) without changing the whole device's setting, and the reverse holds for a tablet left in dark mode during the day.

**Decisions taken (with Rvnadela, 2026-10-13).**

| Decision | Choice |
|---|---|
| Choices offered | **Light / Dark only** (a two-way switch). Until someone uses it, the device preference decides. Once used, the choice sticks. No "System" option, so there is no way back to following the device. |
| Where it appears | **Every surface:** Student Mode, Parent View, Admin, and the sign-in pages. |
| Persistence | **Per device** (browser storage), shared by every surface on that device. No server state. |
| Review mode | Batch |

## 2. Impact Analysis

### Checklist status

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger | [x] | User report, not a story. Closest owner: Story 1.7 (Design System Foundation). |
| 1.2 Problem type | [x] | New requirement from a stakeholder: a product gap, not a misunderstanding or failed approach. |
| 1.3 Evidence | [x] | Code and PRD citations above. |
| 2.1 Current epic | [x] | Epic 1 is already `in-progress` and can take one more story. |
| 2.2 Epic changes | [x] | Add Story 1.10, and add FR-42 to Epic 1's coverage. |
| 2.3 Future epics | [x] | Epic 10 (PWA): the browser's `theme-color` must follow the chosen mode, not only the device preference. This is covered in Story 1.10, so no Epic 10 story changes. |
| 2.4 Obsolete or new epics | [N/A] | None. |
| 2.5 Reorder | [N/A] | Independent of all open work. |
| 3.1 PRD | [!] | §6.1 says "no user-visible choice". Amend it, add FR-42 (§4.12), and update the §4 FR table and the §9.1 bullet. MVP unaffected. |
| 3.2 Architecture | [x] | AD-32 ("dark mode is scope, not polish") still holds. The switch only picks which existing scheme applies. No AD change. |
| 3.3 UI/UX | [!] | EXPERIENCE.md: add a Color mode switch row. DESIGN.md: no change, because every token already has both values. |
| 3.4 Other artifacts | [!] | `sprint-status.yaml` gets a new story. Contrast specs are unchanged. |
| 4.1 Direct adjustment | [x] | Viable. Effort low, risk low. |
| 4.2 Rollback | [N/A] | Nothing to revert. |
| 4.3 MVP review | [N/A] | Scope grows slightly and nothing is cut. |
| 4.4 Path | [x] | Direct Adjustment. |

### Epic impact
- **Epic 1 (Parent Accounts, PINs & Student Profiles):** add **Story 1.10 — Light / Dark Mode Switch**. Epic 1 owns the design-system foundation (1.7) and the shared UI patterns (1.8, 1.9). It is already `in-progress`.
- **Epic 10 (Installable App):** no story change. Story 1.10 keeps the browser's `theme-color` in step with the chosen mode, so the installed app's title bar matches the page.
- Epics 2–9: no change.

### Story impact
- No completed story is reopened. Story 1.7's tokens, Story 10.3's brand palette, and all contrast specs stay as they are. Every pair is already verified in both modes, and the switch only chooses between them.
- Every story whose acceptance criteria require a "visual pass in light and dark mode" (1.8, 1.9, 3.9, 4.8, 10.2) becomes easier to verify: a reviewer can flip the mode in the app instead of changing the OS setting.

### Artifact conflicts

| Artifact | Conflict | Update |
|---|---|---|
| PRD §6.1 | "adds no … user-visible choice" | **Amend** (4.1). |
| PRD §4 | No FR for a user choice | **Add FR-42, §4.12** (4.2), plus a row in the FR table (4.3). |
| PRD §9.1 | Dark mode bullet says "Carried as an accessibility obligation rather than an FR" | **Amend** (4.4). |
| Architecture spine | AD-32 governs token completeness, not how a scheme is chosen | **None.** |
| `epics.md` | No FR-42, UX-DR45, or Story 1.10 | **Add** (4.5–4.9). |
| `EXPERIENCE.md` component table | No color mode switch | **Add row** (4.10). |
| `DESIGN.md` | Already defines both values for every token | **None.** |
| `sprint-status.yaml` | — | Add `1-10-color-mode-switch: backlog` (4.11). |

### Technical impact
- **Web:**
  - Add a shared `ColorModeSwitch` component under `components/`. It uses MUI `useColorScheme()`, reads the mode currently in effect (`mode`, or `systemMode` while `mode === 'system'`), and on press calls `setMode` with the opposite of it.
  - Render it as an `IconButton` with a lucide `Sun` or `Moon` icon and a tooltip. Its accessible name states what pressing it does ("Switch to dark mode" / "Switch to light mode").
  - Place it in the Parent header (`ParentSidebarChrome`, top-right, before the exit control), the Admin header (`AdminChrome`, before Sign out), the Student home (beside the Parent View link, `student/page.tsx`), and the sign-in pages (`auth/layout.tsx`, top-right).
- **Shared state:** every surface nests its own `ThemeProvider` (`ParentThemeProvider`, `AdminThemeProvider`, `StudentThemeProvider`, `AuthThemeProvider`). All of them, and `InitColorSchemeScript`, must use MUI's default mode storage key and attribute, so a choice made on one surface applies on every other and the first paint already matches it (no flash). The story verifies this rather than assuming it.
- **`theme-color`:** `layout.tsx` metadata picks `theme-color` from `prefers-color-scheme` media queries. Once someone chooses a mode, the switch must also update the `<meta name="theme-color">` content to that mode's `brandInk` token, so the browser and installed-app title bar match the page.
- **Copy:** add the two switch labels (dark / light) to the `copy/` modules, in second person on Student Mode and third person in Parent View, per AD-32. The wording is neutral, so a shared entry is acceptable if the copy layer allows it.
- **Tests:**
  - Unit spec for `ColorModeSwitch`: pressing it flips the scheme attribute on `<html>`, its label reflects the mode now in effect, and the choice persists in storage.
  - Playwright E2E: emulate a light device preference, switch to dark, reload (still dark), navigate to another surface (still dark), then emulate a dark device preference while "light" is chosen (stays light).
- **API / schema / deploy:** none.

## 3. Recommended Approach

**Direct Adjustment.** Add FR-42 to the PRD and one story inside Epic 1.

- **Rationale:** both palettes, the scheme attribute, and the pre-paint script already exist, so the switch is a small control on top of them. It meets the use case that motivated dark mode in §6.1 without asking a family to change device settings.
- **Effort:** low, about half a day: the component and spec, four placements, `theme-color` sync, and one E2E.
- **Risk:** low. The main risk is the nested `ThemeProvider`s each keeping their own mode. The shared-storage-key requirement and the cross-surface E2E step cover it.
- **Order:** independent of all open stories. Can land any time.

## 4. Detailed Change Proposals

### 4.1 PRD §6.1 — amend the dark-mode paragraph

OLD:
```
Dark mode carries **no functional requirement of its own** — it adds no capability, state, user-visible choice, or behavior that differs between the two modes — so it is enforced as a §10.1 accessibility obligation and listed in §9.1 as scope that must be planned for, rather than as an FR.
```
NEW:
```
The mode follows the device's light/dark preference until the person chooses one in the app; that choice is FR-42. Beyond that choice, dark mode adds no capability, state, or behavior that differs between the two modes, so its visual obligations (token completeness, contrast in both modes) are enforced through §10.1 and listed in §9.1.
```

### 4.2 PRD — add §4.12 (after §4.11 Installable App)

```
### 4.12 Color Mode

#### FR-42: Light / dark mode switch

Every surface — Student Mode, Parent View, Admin, and the sign-in pages — shows one control that switches the app between light and dark mode. Until it is used on a device, the app follows that device's light/dark preference. Once used, the chosen mode applies on that device to every surface and every later visit, regardless of the device preference, and is restored before the first paint (no flash of the other mode). The choice is stored on the device only: it is not part of the Parent Account, does not follow a person to another device, and is not cleared by sign-out or by switching between Student Mode and Parent View. The browser's theme color follows the mode in effect. The switch changes appearance only, never capability or content.

**Notes:**
- Added 2026-10-13 via Sprint Change Proposal (`sprint-change-proposal-2026-10-13-color-mode-switch.md`).
- Two options only (light, dark). There is deliberately no "follow device" option once a choice has been made.
```

### 4.3 PRD §4 FR table — add row (after FR-41)

```
| FR-42 | Light / dark mode switch | §4.12 Color Mode |
```

### 4.4 PRD §9.1 — amend the dark-mode bullet

OLD:
```
- **Dark mode** across Student Mode and Parent View, with contrast verified in both — §6.1, §10.1. Carried as an accessibility obligation rather than an FR.
```
NEW:
```
- **Dark mode** across every surface, with contrast verified in both modes and an in-app light/dark switch remembered per device — FR-42, §6.1, §10.1.
```

### 4.5 `epics.md` — Requirements Inventory, add FR-42 (after FR-41)

```
FR-42: Every surface — Student Mode, Parent View, Admin, and the sign-in pages — shows one control that switches the app between light and dark mode. Until it is used on a device, the app follows that device's light/dark preference. Once used, the chosen mode applies on that device to every surface and every later visit, regardless of the device preference, and is restored before the first paint. The choice is stored on the device only, is not part of the Parent Account, and survives sign-out and mode switching. The browser's theme color follows the mode in effect. The switch changes appearance only.
```

### 4.6 `epics.md` — FR Coverage Map, add line (after FR-41)

```
FR-42: Epic 1 - Light / dark mode switch (per device)
```

### 4.7 `epics.md` — UX Design Requirements, add UX-DR45 (after UX-DR44)

```
UX-DR45: Implement the color mode switch as one shared control: an icon-only button showing a sun or moon icon, placed in each surface's header at the top-right (Parent View before the exit control, Admin before Sign out, the sign-in pages top-right) and on the Student home beside the Parent View link. Its accessible name states what pressing it does ("Switch to dark mode" / "Switch to light mode"), a tooltip shows the same text on hover and focus, and it meets the surface's tap-target floor. Pressing it applies the other mode at once, with no reload and no animation beyond the motion policy (UX-DR37). It is not shown inside the camera capture view or inside an in-progress Attempt.
```

### 4.8 `epics.md` — Epic 1: Epic List entry, epic header, Relevant UX-DRs

Epic List entry and epic header (both places):

OLD:
```
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-34, FR-35
```
NEW:
```
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-34, FR-35, FR-42
```

Relevant UX-DRs, append:
```
…, UX-DR44 (cards below desktop, Story 1.9), UX-DR45 (color mode switch, Story 1.10)
```

### 4.9 `epics.md` — add Story 1.10 (after Story 1.9)

```
### Story 1.10: Light / Dark Mode Switch

As a parent, student, or operator,
I want to switch the app between light and dark mode,
So that I can use the theme that suits the room without changing my device's settings.

**Acceptance Criteria:**

**Given** a device on which the switch has never been used
**When** any surface loads
**Then** the app shows the mode matching the device's light/dark preference, exactly as today

**Given** the shared color mode switch (UX-DR45)
**When** it is pressed
**Then** the app changes to the other mode at once, without a reload
**And** the button's icon, accessible name, and tooltip change to describe the next press ("Switch to light mode" while dark is showing, and the reverse)

**Given** a mode was chosen with the switch
**When** the page reloads, the person opens another surface (Student Mode ↔ Parent View, Admin, sign-in), signs out, or returns later on the same device
**Then** the chosen mode is in effect from the first paint, with no flash of the other mode
**And** a later change to the device's light/dark preference does not override it

**Given** each surface
**Then** the switch appears in the Parent View header top-right before the exit control, in the Admin header before Sign out, on the sign-in pages top-right, and on the Student home beside the Parent View link
**And** it does not appear inside the camera capture view or inside an in-progress Attempt

**Given** a chosen mode
**Then** the document's `theme-color` matches that mode's `brandInk` token, so the browser and installed-app title bar match the page

**Given** the nested surface theme providers (Parent, Admin, Student, Auth) and `InitColorSchemeScript`
**Then** all of them read and write one shared stored mode, so a choice made on one surface applies on every other

**Given** the switch's labels
**Then** they live in the `copy/` modules (UX-DR31), and the switch is a real button reachable by keyboard and meeting the surface's tap-target floor (UX-DR30, UX-DR10)

**Given** the change
**Then** a unit spec covers the toggle, the label change, and persistence; a Playwright E2E covers: light device preference → switch to dark → reload (dark) → another surface (dark) → device preference emulated dark while light is chosen (stays light); existing contrast specs pass unchanged
```

### 4.10 `EXPERIENCE.md` — add Color mode switch row (component table, after "Row actions")

```
| Color mode switch | Every surface header (Parent View, Admin, sign-in), Student home | One icon-only button (sun / moon) that switches between light and dark mode. Until it is used on a device the app follows the device preference; once used, the choice is remembered on that device for every surface and survives sign-out. Labeled with what pressing it does ("Switch to dark mode"), with a tooltip. Not shown in the camera view or during an Attempt. *Why:* the evening, dim-room study session §6.1 names is exactly when a family should not have to dig into device settings to get dark mode. |
```

### 4.11 `sprint-status.yaml`

```
  epic-1: in-progress          # unchanged
  ...
  1-9-cards-below-desktop: done
  1-10-color-mode-switch: backlog   # new
```

## 5. Implementation Handoff

- **Scope:** Minor. Direct implementation by the Developer agent (`bmad-build` on Story 1.10).
- **Deliverables:** shared `ColorModeSwitch` with a unit spec; four placements; `theme-color` sync; copy entries; E2E.
- **Success criteria:**
  - The switch is visible on Parent View, Admin, sign-in, and Student home, and absent from the capture view and an in-progress Attempt.
  - A choice made on one surface holds on every surface, across reload and sign-out, from the first paint.
  - A device with no stored choice behaves exactly as before.
  - The browser `theme-color` matches the chosen mode.
  - Existing unit, contrast, and E2E suites are green.
