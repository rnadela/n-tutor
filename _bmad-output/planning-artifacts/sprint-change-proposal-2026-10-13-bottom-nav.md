# Sprint Change Proposal — Bottom Navigation Below Desktop

- **Date:** 2026-10-13
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Status:** Approved 2026-10-13; applied to prd.md, epics.md, EXPERIENCE.md, DESIGN.md, sprint-status.yaml
- **Scope classification:** Minor to Moderate. Two new stories in Epic 10, one new UX-DR, one new Student Mode screen, and an FR-16 consequence added. No API, schema, or architecture-decision change.

## 1. Issue Summary

**Trigger.** Rvnadela, 2026-10-13: "since we're doing PWA, in mobile and tablet view there should be a bottom navigation so it feels more like a native mobile app when installed as PWA."

**Current state (code, 2026-10-13).**

- **Parent View** (`app/parent/_components/ParentSidebarChrome.tsx`): below `md` (900px), its 10 destinations sit in a drawer opened by a hamburger in the header. At `md` and above, a permanent sidebar that can collapse to a rail.
- **Admin** (`app/admin/_components/AdminChrome.tsx`): the same pattern, with 5 destinations.
- **Student Mode** (`app/student/layout.tsx`): no navigation chrome. Home holds a "Parent View" link to the PIN gate. There is no list of finished tests apart from the completed band at the bottom of Home's list.
- **PWA:** the root `viewport` export (`app/layout.tsx:58`) has no `viewportFit: 'cover'`, and nothing in `apps/web/src` uses `env(safe-area-inset-*)`. On a phone with a home indicator, any bar pinned to the bottom would sit under it.
- Nothing in `apps/web/src` is pinned to the bottom of the viewport today, so the bar does not collide with any existing component. The shared `Snackbar` (bottom-anchored by default) is the one exception.

**Why it matters.** The PRD's target device is "a phone held one-handed in a kitchen and a family tablet" (§6). A hamburger at the top-left is the hardest spot to reach with the thumb, and it hides where you are. Installed apps (FR-41) open without a browser bar, so the app's own chrome is the whole navigation experience, and a bottom tab bar is what makes it feel native on iOS and Android.

**Decisions taken (with Rvnadela, 2026-10-13).**

| Decision | Choice |
|---|---|
| Surfaces | **Parent View, Student Mode, and Admin.** Sign-in pages get none. |
| Widths | **Below `lg` (1200px)**: phones and tablets in both orientations. At `lg` and above, the existing sidebar. Same breakpoint as UX-DR44 (cards below desktop). |
| When shown | **Always below `lg`**, in a browser tab and installed alike. One layout per width. |
| Parent View tabs | **Home · Upload · Drafts · Attempts · More.** "More" opens the existing full grouped destination list (Students, Analytics, Explanation flags, Grade disputes, Change PIN, Settings). |
| Admin tabs | **Overview · Taxonomy · Accounts · Flagged · Topics.** All five fit, so there is no "More". |
| Student tabs | **Home · Results · Parent View.** "Results" is a **new screen** listing the student's completed Practice Tests. "Parent View" leads to the PIN gate, as the Home link does today. |
| Review mode | Batch |

## 2. Impact Analysis

### Checklist status

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger | [x] | Stakeholder request, not a story. Closest owner: Epic 10 (Installable App). |
| 1.2 Problem type | [x] | New requirement that came out of the PWA work: a UX gap, not a defect. |
| 1.3 Evidence | [x] | Code citations above. |
| 2.1 Current epic | [x] | Epic 10 is `in-progress` (10.1–10.3 done) and can take two more stories. |
| 2.2 Epic changes | [x] | Add Story 10.4 (bottom navigation) and Story 10.5 (Student Results tab). Add UX-DR46 to Epic 10. Add FR-16 to Epic 10's coverage, for the Results screen. |
| 2.3 Future epics | [N/A] | No open story depends on the navigation chrome. |
| 2.4 Obsolete or new epics | [N/A] | None. |
| 2.5 Reorder | [x] | 10.4 before 10.5. 10.5 adds the Results tab to the bar that 10.4 builds. |
| 3.1 PRD | [!] | FR-16: add one consequence for the Results screen. §6 platform paragraph: one sentence. MVP unaffected. |
| 3.2 Architecture | [x] | AD-18 (elevation dies on a full page load) still holds: every tab must be a client-side `<Link>`, which the stories state. AD-35 (service worker) is untouched. No AD change. |
| 3.3 UI/UX | [!] | EXPERIENCE.md: add a Student Results row to the IA table, update "Reached from" for the nav-reached rows, add a Bottom navigation row to the component table, and add a persistent-chrome note. DESIGN.md: add a `bottom-nav` component spec. |
| 3.4 Other artifacts | [!] | `sprint-status.yaml`: two new stories. E2E viewports. |
| 4.1 Direct adjustment | [x] | Viable. Effort: medium for 10.4, low for 10.5. Risk: low to medium. |
| 4.2 Rollback | [N/A] | Nothing to revert. The drawer and rail code is reused, not thrown away. |
| 4.3 MVP review | [N/A] | Scope grows, and nothing is cut. |
| 4.4 Path | [x] | Direct Adjustment. |

### Epic impact
- **Epic 10 (Installable App):** add Story 10.4 (Bottom Navigation Below Desktop) and Story 10.5 (Student Results Tab). FRs covered gains FR-16, for the Results screen. Relevant UX-DRs gains UX-DR46.
- **Epic 5 (Student test list, done):** not reopened. Home's flat list (FR-16) is unchanged. The Results screen is an additional, filtered view.
- **Epic 1:** UX-DR45 placements change below `lg`. The color mode switch stays in each header. The Student home's "Parent View" link is replaced by the bar's tab below `lg` and stays as it is at `lg` and above.
- Other epics: no change.

### Story impact
- No completed story is reopened. Their acceptance criteria hold at `lg` and above.
- Stories with a mobile visual pass (1.8, 1.9, 1.10, 10.2) now need it with the bar present. That is covered by 10.4's own visual pass, not by reopening them.
- The upload flow (Upload stepper): the bar shows on `/parent/capture` but hides while the camera viewfinder is open.

### Artifact conflicts

| Artifact | Conflict | Update |
|---|---|---|
| PRD FR-16 | No screen lists completed tests on their own | **Add consequence** (4.1). |
| PRD §6 | Silent on navigation chrome | **Add sentence** (4.2). |
| Architecture spine | None. AD-18 already requires client-side navigation inside Parent View. | **None.** |
| `epics.md` | No UX-DR46, Story 10.4, or Story 10.5; Epic 10 doesn't cover FR-16 | **Add** (4.3–4.6). |
| `EXPERIENCE.md` | IA has no Student Results screen; nav is described only as "Parent View nav" / "Admin nav"; no bottom nav component | **Add or amend** (4.7–4.9). |
| `DESIGN.md` | No `bottom-nav` component | **Add** (4.10). |
| `sprint-status.yaml` | — | Add two stories (4.11). |

### Technical impact
- **Root viewport:** add `viewportFit: 'cover'` to the `viewport` export in `app/layout.tsx`, so `env(safe-area-inset-*)` resolves on iOS. Nothing else currently draws to the screen edges, so this changes nothing except the bar.
- **Shared component** `components/BottomNav.tsx`:
  - Built on MUI `BottomNavigation` with `showLabels`. Each action is a NextLink, so navigation stays client-side (AD-18).
  - Takes its items as props (`href`, `label`, `icon`, `match`) plus an optional "More" action that calls a callback instead of navigating.
  - Fixed to the bottom of the viewport, `background.paper`, a 1px top `divider` border, no shadow.
  - Bottom padding is `env(safe-area-inset-bottom)`; left and right padding are `env(safe-area-inset-left/right)`.
  - Shown below `lg` only, via CSS, with no viewport hook. This follows UX-DR44, so there is no layout swap after first paint.
- **Visibility rule:** a pure helper `bottomNavShown(pathname)` in `lib/`, modeled on `colorModeSwitchShown`. It returns false on `/parent/pin`, `/admin/login`, `/student/tests/*` (an Attempt and its results), and `/auth/*`. The camera viewfinder on `/parent/capture` hides the bar from the capture component itself, through a small context or the existing capture-open state.
- **Parent View** (`ParentSidebarChrome`):
  - Switch the sidebar/drawer breakpoint from `md` to `lg`, and drop the header hamburger below `lg`.
  - The bar's "More" opens the existing `Drawer` with the full `NavList`.
  - "More" counts as current when the route is not under one of the four tabs.
  - Content gets bottom padding equal to the bar height plus the inset.
- **Admin** (`AdminChrome`): the same changes, with five tabs and no "More". Sign out and the color mode switch stay in the header.
- **Student Mode** (`app/student/layout.tsx`):
  - Mount the bar.
  - Below `lg`, hide the Home "Parent View" link, because the bar's tab replaces it.
  - The tab uses the same destination and the same `Lock` glyph.
- **Student Results** (Story 10.5):
  - New route `app/student/results/page.tsx`.
  - Uses the existing `GET /api/student/practice-tests` and `GET /api/student/practice-test-runs` and filters to completed tests on the client, newest first.
  - Reuses `PracticeTestRow`. Tapping a row opens `/student/tests/[id]` (results).
  - No API change.
- **Snackbar:** below `lg`, offset its bottom anchor by the bar height plus the inset, so it never covers the bar.
- **On-screen keyboard:** on a coarse pointer, the bar hides while a text field has focus, so it does not ride up on top of the keyboard on Android.
- **Copy:** short tab labels in `copy/parent`, `copy/student`, and `copy/admin` (UX-DR31).
- **Tests:**
  - Unit specs for `BottomNav` (current tab, the More callback, labels) and `bottomNavShown`.
  - Playwright E2E at 390×844, 820×1180, and 1180×820 (bar shown) and 1280×800 (sidebar, no bar).
- **API / schema / deploy:** none.

## 3. Recommended Approach

**Direct Adjustment.** Add UX-DR46, two stories in Epic 10, and one FR-16 consequence.

- **Rationale:**
  - It builds on chrome that already exists. The destination lists (`NAV_GROUPS`, Admin's `SIDEBAR_ITEMS`) and the drawer are reused, so the bar is a second view of the same data, not a second navigation that can drift from the first.
  - It finishes what FR-41 started: the installed app gets a native shape with thumb-reach navigation.
- **Effort:**
  - 10.4: about 1–1.5 days. That covers the component, three shells, the breakpoint move, the safe-area work, the Snackbar offset, and the E2E.
  - 10.5: about half a day.
- **Risk:** low to medium.
  - (a) Content hidden behind the bar. Mitigated by bottom padding in each shell and by the E2E checking that the last item on a long list is visible.
  - (b) iOS safe-area values only resolve with `viewport-fit=cover`. Covered by a unit check on the viewport export and a manual pass on a device.
  - (c) Moving the drawer breakpoint from `md` to `lg` changes the 900–1199px range from sidebar to bar. This is intended, and the E2E covers it.
- **Order:** 10.4, then 10.5. Independent of other open stories.

## 4. Detailed Change Proposals

### 4.1 PRD FR-16 — add consequence (after "Three conditions are distinguishable…")

NEW:
```
- Student Mode also offers a **Results** screen listing only this Student Profile's *completed* Practice Tests, newest first, each opening its results (FR-23). It is an additional view, not a replacement: the flat list above is unchanged and still includes every completed Practice Test. *Why:* below desktop width, Student Mode carries a bottom navigation bar (UX-DR46), and a student returning to an answer key should not have to scroll past every unstarted test to reach it. *(Added 2026-10-13 via `sprint-change-proposal-2026-10-13-bottom-nav.md`.)*
```

### 4.2 PRD §6 — platform paragraph, append one sentence

OLD (end of paragraph):
```
… installing changes how the app is opened, not what it does.** Native apps are explicitly v2+.
```
NEW:
```
… installing changes how the app is opened, not what it does.** Below desktop width (phones and tablets in either orientation), every signed-in surface navigates through a bottom tab bar within thumb reach, as an installed app is expected to; at desktop width it uses a sidebar. Native apps are explicitly v2+.
```

### 4.3 `epics.md` — UX Design Requirements, add UX-DR46 (after UX-DR45)

```
UX-DR46: Implement navigation below desktop as one shared bottom navigation bar. Below the `lg` breakpoint (1200px) — phones and tablets in either orientation, in a browser tab or installed — Parent View, Student Mode, and Admin each show a bar fixed to the bottom of the viewport; at `lg` and above they keep the sidebar and show no bar. The switch is CSS-only (no layout swap after first paint). Tabs: Parent View — Home, Upload, Drafts, Attempts, More (More opens the full grouped destination list); Student Mode — Home, Results, Parent View (the PIN gate); Admin — Overview, Taxonomy, Accounts, Flagged, Topics. Every tab shows icon and label together; the current tab is marked by color, weight, and an indicator (never color alone) and carries `aria-current="page"`; the bar is a `nav` landmark with an accessible name; each tab meets the surface's tap-target floor (44px Parent/Admin, 48px Student). The bar sits on `background-paper` with a 1px top divider and no shadow, and pads by the device safe-area insets (`viewport-fit=cover`). Content and snackbars sit above it, never under it. Tab changes are client-side and unanimated. The bar is absent on the PIN gate, the Admin sign-in, the sign-in pages, inside an Attempt and its results, while the camera viewfinder is open, and while a text field has focus on a touch device. Below `lg` the header hamburger is removed; the header keeps the page title, the color mode switch, and the surface's exit control.
```

### 4.4 `epics.md` — Epic 10: Epic List entry, epic header, Relevant UX-DRs

Epic List entry and epic header (both places):

OLD:
```
**FRs covered:** FR-41
```
NEW:
```
**FRs covered:** FR-41, FR-16 (Student Results screen, Story 10.5)
```

Epic goal sentence (both places), OLD:
```
A family can install n-tutor to the home screen of their tablet or phone and open it in one tap, and the app gently tells them that they can, and the app's palette matches the icon they tapped.
```
NEW:
```
A family can install n-tutor to the home screen of their tablet or phone and open it in one tap, and the app gently tells them that they can, and the app's palette matches the icon they tapped, and it navigates like an app with a bottom tab bar on phones and tablets.
```

Relevant UX-DRs, append:
```
…, UX-DR17 (Story 10.3), UX-DR46 (bottom navigation, Stories 10.4–10.5)
```

### 4.5 `epics.md` — add Story 10.4 (after Story 10.3)

```
### Story 10.4: Bottom Navigation Below Desktop

As a parent, student, or operator on a phone or tablet,
I want the app's main destinations in a tab bar at the bottom of the screen,
So that I can move around with my thumb and the installed app feels like a native one.

**Acceptance Criteria:**

**Given** a viewport narrower than `lg` (1200px) on Parent View, Student Mode, or Admin
**When** any screen that carries the bar loads
**Then** a bottom navigation bar (UX-DR46) is fixed to the bottom of the viewport, and no sidebar or header hamburger is shown
**And** at `lg` and above the existing sidebar shows and the bar does not, with no layout swap after first paint (CSS-only switch)

**Given** Parent View below `lg`
**Then** the bar's tabs are Home (`/parent`), Upload (`/parent/capture`), Drafts (`/parent/drafts`), Attempts (`/parent/attempts`), and More
**And** More opens the existing destination drawer listing every Parent View destination in its groups, and More is the current tab on any route not under the other four
**And** the header keeps the page title, the color mode switch, and the exit to Student Mode

**Given** Admin below `lg`
**Then** the bar's tabs are Overview, Taxonomy, Accounts, Flagged, and Topics, and the header keeps the color mode switch and Sign out

**Given** Student Mode below `lg`
**Then** the bar's tabs are Home and Parent View (the PIN gate), and the Home screen's own "Parent View" link is not shown, because the tab replaces it (Story 10.5 adds Results)
**And** at `lg` and above the Home screen's "Parent View" link is shown as today

**Given** any tab
**When** it is pressed
**Then** navigation is client-side (a Next `<Link>`), so Parent View stays elevated and no PIN is asked again (AD-18)
**And** the current tab shows icon and label in the primary color at bold weight with an indicator, carries `aria-current="page"`, and every tab meets the surface's tap-target floor

**Given** the PIN gate, the Admin sign-in, the sign-in pages, any `/student/tests/*` route, an open camera viewfinder, or a focused text field on a touch device
**Then** the bar is not shown

**Given** a phone with a home indicator or a display cutout, in a browser tab or installed
**Then** the root viewport declares `viewport-fit=cover`, the bar pads by `env(safe-area-inset-bottom/left/right)`, and no tab sits under the home indicator

**Given** a long list on any surface below `lg`
**When** scrolled to the end
**Then** its last item is fully visible above the bar, and any snackbar appears above the bar

**Given** the bar's labels
**Then** they live in the `copy/` modules (UX-DR31); the bar is a `nav` landmark with an accessible name; it meets the Accessibility Floor in light and dark mode

**Given** the change
**Then** unit specs cover `BottomNav` (current tab, More callback) and `bottomNavShown`; a Playwright E2E at 390×844, 820×1180, and 1180×820 shows the bar, navigates by tab on Parent View without a PIN re-prompt, opens More, and confirms the bar is absent on the PIN gate and inside an Attempt; at 1280×800 it confirms the sidebar and no bar; existing unit and E2E suites pass
```

### 4.6 `epics.md` — add Story 10.5 (after Story 10.4)

```
### Story 10.5: Student Results Tab

As a student,
I want a Results tab that lists the tests I've finished,
So that I can go back to an answer key without scrolling past everything I haven't started.

**Acceptance Criteria:**

**Given** Student Mode below `lg`
**Then** the bottom bar's tabs are Home, Results, and Parent View, in that order

**Given** the Results screen (`/student/results`)
**When** it loads
**Then** it lists only the bound Student Profile's completed Practice Tests, newest first, each with its Subject and state exactly as on Home (same row component), and tapping one opens its results
**And** it reads the existing student endpoints only, with no new API and no profile id in the request

**Given** no completed Practice Tests
**Then** the Results screen shows an empty state that says what will appear here and how (finish a test), never a bare absence

**Given** Home
**Then** its flat list is unchanged and still includes completed Practice Tests (FR-16)

**Given** a viewport at `lg` or above
**Then** the Results screen is reachable from a link on Student Home beside the Parent View link, so it is not a narrow-only screen

**Given** the change
**Then** the Results screen meets the Accessibility Floor in light and dark mode, its copy lives in `copy/student`, a unit spec covers the completed-only filter, the newest-first order, and the empty state, and the E2E from Story 10.4 is extended to open Results from the bar
```

### 4.7 `EXPERIENCE.md` — Information Architecture

Add row (after Student Mode | Results):
```
| Student Mode | Finished tests | Bottom bar Results tab; Student Home link at desktop width | Completed Practice Tests only, newest first; each opens its Results |
```

Amend "Reached from" for nav-reached rows. "Parent View nav" stays, and the rows read as follows:
```
| Parent View | Pending drafts | Parent View nav (persistent; bottom bar below `lg`) | … |
| Parent View | Attempts | Parent View nav (bottom bar below `lg`), or Analytics activity summary | … |
```
The others (Source Tests, Students, Settings, Admin rows) are unchanged in wording. "Parent View nav" / "Admin nav" now means the sidebar at `lg` and above, and the bottom bar plus its More list below `lg` (see Persistent chrome).

### 4.8 `EXPERIENCE.md` — Persistent chrome paragraph, append

```
**Below desktop width the navigation moves to a bottom tab bar** (UX-DR46) on Parent View, Student Mode, and Admin, so the destinations are within thumb reach on a phone or a tablet held in two hands, and the installed app behaves like one. Parent View carries its four most-used destinations plus **More**, which opens the full list; Pending drafts remains first-class as a tab. The bar never appears where it would compete with the task: the PIN gate, inside an Attempt, the camera viewfinder, or while typing. *Why:* the hamburger it replaces sits in the hardest corner to reach one-handed and hides where you are; FR-41 makes the app's own chrome the whole navigation once installed.
```

### 4.9 `EXPERIENCE.md` — component table, add row (after "Color mode switch")

```
| Bottom navigation | Parent View, Student Mode, Admin — below `lg` | Fixed tab bar with icon + label per tab (Parent: Home, Upload, Drafts, Attempts, More; Student: Home, Results, Parent View; Admin: Overview, Taxonomy, Accounts, Flagged, Topics). Current tab marked by color, weight, and indicator. Client-side navigation only. Pads by device safe-area insets. Absent on the PIN gate, sign-in, inside an Attempt and its results, in the camera viewfinder, and while a text field has focus on a touch device. At `lg` and above the sidebar replaces it. *Why:* thumb reach and a native shape for the installed app (FR-41). |
```

### 4.10 `DESIGN.md` — components: add `bottom-nav`

YAML token block (after `snackbar:`):
```
  bottom-nav:
    height: 56px            # plus env(safe-area-inset-bottom)
    background: "{colors.background-paper}"
    border-top: "1px solid {colors.divider}"
    shadow: none
    item-min-width: "{components.tap-target}"   # 44px Parent/Admin, 48px Student
    label: "{typography.caption}"
    color-idle: "{colors.text-secondary}"
    color-current: "{colors.primary}"            # surface primary
    indicator: "3px {rounded.control} bar, {colors.primary}, above the icon"
    breakpoint: "below lg (1200px)"
```

Prose (after **Table card**):
```
**Bottom navigation** — chrome role; Parent View, Student Mode, Admin below `lg`. Flat `{colors.background-paper}` with a 1px `{colors.divider}` top border, no shadow — the same boundary rule as every other surface. Icon above label for every tab, label always visible. The current tab is marked three ways: `{colors.primary}` icon and label, bold weight, and a short indicator bar — never color alone. Uses each surface's own density for its tap target (comfortable in Student Mode). Pads by the safe-area insets so nothing sits under a home indicator. No hide-on-scroll and no transition between tabs, under the motion policy.
```

### 4.11 `sprint-status.yaml`

```
  epic-10: in-progress                       # unchanged
  10-1-web-app-manifest-icons-minimal-service-worker: done
  10-2-install-banner: done
  10-3-brand-palette: done
  10-4-bottom-navigation: backlog             # new
  10-5-student-results-tab: backlog           # new
```

## 5. Implementation Handoff

- **Scope:** Minor to Moderate. Direct implementation by the Developer agent: `bmad-build` on Story 10.4, then Story 10.5. No PM or Architect escalation is needed.
- **Deliverables:**
  - Shared `BottomNav` and `bottomNavShown`, with unit specs.
  - Parent, Admin, and Student shells moved to the `lg` breakpoint with the bar.
  - `viewport-fit=cover` and the safe-area padding.
  - The Snackbar offset.
  - The Student Results screen.
  - The copy entries.
  - The E2E across four viewports.
- **Success criteria:**
  - Below 1200px, every signed-in surface navigates by a bottom bar. At 1200px and above, the sidebar is unchanged.
  - Parent View navigation by tab never re-prompts for the PIN.
  - No content, tab, or snackbar sits under the bar or under the iOS home indicator, in a browser tab or installed.
  - The bar is absent on the PIN gate, inside an Attempt, in the camera viewfinder, and while typing on a touch device.
  - Student Results lists completed tests only, and Home's list is unchanged.
  - Existing unit, contrast, and E2E suites are green.
