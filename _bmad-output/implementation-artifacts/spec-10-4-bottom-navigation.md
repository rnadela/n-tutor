---
title: 'Story 10.4: Bottom Navigation Below Desktop'
type: 'feature'
created: '2026-10-13'
baseline_revision: 'f2ad29b7db8a25cc210ad89e9ba5f1a5207ca4f4'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/apps/web/AGENTS.md']
warnings: ['oversized']
deferred:
  - summary: >-
      No screen in the app mounts `AppSnackbar`, so the bar offset this story
      added to it cannot be exercised end to end.
    evidence: |-
      `grep -rn "AppSnackbar" apps/web/src e2e` matches only the component's own
      definition and the render inside `components/primitives.spec.tsx`, which
      renders it outside a router — so `liftedOverBar` is always false there.
      The offset is therefore pinned only by a source-text assertion in
      `components/Snackbar.spec.tsx`, which would pass on a broken `calc()` or
      an `sx` key that loses to MUI's specificity. Closing it means either
      mounting the snackbar where messages are actually raised (not this
      story's scope) or accepting a prop-injected pathname so the lift can be
      asserted over the emitted stylesheet.
    location: >-
      apps/web/src/components/Snackbar.tsx:109
    severity: medium
  - summary: >-
      Several shell-level rules are pinned by matching the implementation's own
      source text, which passes on code that is textually right and
      behaviourally wrong.
    evidence: |-
      `apps/web` runs vitest with `environment: 'node'` and ships no DOM
      testing library, a repo-wide convention older than this story
      (`ParentSidebarChrome.spec.tsx`, `page.spec.tsx`, `layout.spec.ts` all
      read source). The consequence here is that the Parent shell's viewfinder
      suppression and both chromes' breakpoint/padding wiring are asserted as
      strings; the pure rules underneath them (`bottomNavShown`,
      `barIsOnScreen`, `reportCaptureOpen`, `typingAfterFocusChange`) are
      executed, but the wiring that calls them is not. Adding a jsdom (or
      browser-mode) project to `apps/web/vitest.config.ts` is the real fix and
      is a decision for the workspace, not for one story.
    location: >-
      apps/web/src/app/parent/_components/ParentSidebarChrome.spec.tsx
    severity: medium
  - summary: >-
      Playwright declares only a fine-pointer desktop project, so the rule that
      hides the bar while a text field has focus on a touch device is never
      exercised in a browser.
    evidence: |-
      `playwright.config.ts` has one project, `devices['Desktop Chrome']`, with
      no `hasTouch`/`isMobile`, so `(pointer: coarse)` never matches and the
      `focusin`/`focusout` branch is dead under E2E — including in the new
      `bottom-nav.spec.ts` cases that do fill text fields at 390x844. The
      predicates are unit-tested; the wiring is not. A touch-emulating project
      (or one `test.use({ hasTouch: true, isMobile: true })` block) would close
      it for every surface at once.
    location: >-
      playwright.config.ts:28
    severity: low
  - summary: >-
      No test exercises the viewfinder-open signal reaching the bottom bar or
      the snackbar end to end; each half is only driven in isolation.
    evidence: |-
      `capture-open.spec.ts` drives only the pure `reportCaptureOpen(report,
      open)` helper, never `AddPages.tsx` or the `CaptureOpenProvider` wiring.
      `ParentSidebarChrome.spec.tsx` and `Snackbar.spec.tsx` assert
      `useCaptureOpen()` only as a source-text match. No e2e spec opens the
      camera on `/parent/capture` and asserts the bar or a snackbar actually
      responds. This is not new to this story — the repo has no
      `getUserMedia`/camera mocking anywhere in `playwright.config.ts` or
      existing e2e specs, so the viewfinder itself was already untestable in a
      real browser before this story added a new consumer of its open state.
      Closing it means adding camera-stream mocking to the E2E harness, which
      is bigger than one story.
    location: >-
      apps/web/src/app/parent/capture/AddPages.tsx:132
    severity: medium
  - summary: >-
      The bottom bar's "More" button has no `aria-haspopup`/`aria-expanded`,
      so assistive-tech users get no advance notice that it opens a drawer
      rather than acting in place.
    evidence: |-
      `apps/web/src/components/BottomNav.tsx` renders `more` as a plain
      `<button>` with `onClick={more.onPress}` and no disclosure attributes.
      The intent-contract's accessibility language ("Accessibility Floor
      holds in both schemes") is about colour-scheme contrast, not
      interaction-pattern disclosure, so this was never in scope for this
      story, but it is a real usability gap on the one new overflow trigger
      the story introduces.
    location: >-
      apps/web/src/components/BottomNav.tsx:340-355
    severity: low
  - summary: >-
      `navDestination()` in Parent View's shell is only a runtime
      module-evaluation throw with no React error boundary around it, so a
      broken href blanks the whole Parent View import rather than failing a
      build (Admin's equivalent is caught at typecheck via a literal union).
    evidence: |-
      `ParentSidebarChrome.tsx:109-128`'s own comment documents this
      asymmetry and names the reason: `NAV_GROUPS` is built from
      `parentCopy` rather than literal types, so there is no union for the
      compiler to check an href against; the throw is an acknowledged
      backstop, not an oversight. Closing it fully means giving the copy
      module literal route types, which is a cross-cutting change to
      `copy/parent.ts`'s shape, not a fix local to this story.
    location: >-
      apps/web/src/app/parent/_components/ParentSidebarChrome.tsx:109-128
    severity: low
  - summary: >-
      The bottom bar's coarse-pointer check runs once on mount and never
      re-evaluates, so a hybrid device whose pointer capability changes after
      first paint (e.g. a mouse attached to a touch tablet) keeps the bar's
      original typing-aware behaviour for the rest of the session.
    evidence: |-
      `apps/web/src/components/BottomNav.tsx:183-201`'s effect calls
      `coarsePointer()` once inside a `useEffect` with an empty dependency
      array; nothing re-subscribes to `matchMedia('(pointer: coarse)')`
      changes. This is a narrow, rare-hardware edge case with no existing
      precedent elsewhere in the shells for reactive pointer-type tracking.
    location: >-
      apps/web/src/components/BottomNav.tsx:183-201
    severity: low
---

<intent-contract>

## Intent

**Problem:** Below desktop width every signed-in surface hides its destinations behind a top-left hamburger (Parent View and Admin) or offers none at all (Student Mode). That is the hardest corner to reach one-handed, it hides where you are, and once the app is installed (FR-41) the browser chrome is gone, so the app's own navigation is the whole experience.

**Approach:** Add one shared `BottomNav` bar, fixed to the bottom, shown below `lg` (1200px) and hidden from `lg` up by CSS alone, mounted by the Parent, Admin and Student shells. Move both shells' sidebar/drawer breakpoint from `md` to `lg`, drop their header hamburger, and give the bar's Parent "More" action the drawer that hamburger used to open — so the bar is a second view of the existing destination lists (`NAV_GROUPS`, `SIDEBAR_ITEMS`), never a second navigation. Declare `viewport-fit=cover` and pad by the safe-area insets.

## Boundaries & Constraints

**Always:**
- The breakpoint switch is CSS-only — `sx` breakpoint keys (`{ xs: …, lg: … }`), never `useMediaQuery`, `matchMedia` on a width, `window.inner*` or a hand-written `@media` (UX-DR44's rule, pinned by `TableCards.spec.tsx`). Both chromes lose their `isNarrow` hook entirely.
- Tab hrefs and icons are read from the existing destination lists (`NAV_GROUPS` for Parent, `SIDEBAR_ITEMS` for Admin); only the short tab *label* is new copy. A tab whose href is not in those lists is a drift bug.
- Every tab navigates with a Next `<Link>` (`component={NextLink}`), so Parent View elevation survives (AD-18). "More" is a real `<button>` with a callback and no `href`.
- The current tab carries three markers — surface `primary.main` colour, bold weight, and a 3px indicator bar — plus `aria-current="page"`. Never colour alone.
- The bar is `component="nav"` with an accessible name from `copy/`, sits on `background.paper` with a 1px top `divider` border and no shadow, takes every figure from tokens (no new hex, no bare px for colour/spacing), and animates nothing.
- Each tab meets its surface's tap-target floor (`density.tapTarget` 44 for Parent/Admin, `comfortableDensity.tapTarget` 48 for Student) and the bar pads by `env(safe-area-inset-bottom/left/right)`.
- Visibility by route is one pure helper `bottomNavShown(pathname)` in `apps/web/src/lib/bottom-nav.ts`, modelled on `colorModeSwitchShown` (same `normalize`/`within` shape): false for `/parent/pin` **exactly** (`/parent/pin/change` is a real destination and keeps the bar), `/admin/login`, `/auth/*`, `/student/tests/*`; true otherwise.
- Content on every surface below `lg` pads its bottom by bar height + `env(safe-area-inset-bottom)` so the last row of a long list clears the bar, and the shared snackbar's bottom anchor is offset by the same amount on routes that carry the bar.
- New copy lives in `copy/parent.ts`, `copy/admin.ts`, `copy/student.ts` (UX-DR31). Labels are short nouns ("Home", "Upload", "Drafts", "Attempts", "More"), not the sidebar's sentences.
- Unit specs run under `environment: 'node'` with no DOM: assert markup with `renderToStaticMarkup` + the emotion stylesheet (the `TableCards.spec.tsx` idiom) and assert behaviour through pure exported helpers, never through a click.

**Block If:**
- A tab destination named by the story does not exist as a route (nothing to link to), or Parent View's four tab hrefs cannot be resolved from `NAV_GROUPS`.

**Never:**
- No Story 10.5 work: no `/student/results` route and no Results tab. Student Mode gets Home and Parent View only.
- No API, schema, migration, architecture-decision or dependency change. No change to `colorTokens` values.
- No hide-on-scroll, no tab transition, no badge, no FAB, no sidebar removal at `lg` and above, and no change to any screen's own content beyond the bottom padding and the one hidden Student Home link.
- No new client persistence; the bar remembers nothing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Route carries the bar | `bottomNavShown('/parent/drafts')` | `true` | No error expected |
| PIN gate | `bottomNavShown('/parent/pin')`, `'/parent/pin/'` | `false` | No error expected |
| Change-PIN is not the gate | `bottomNavShown('/parent/pin/change')` | `true` | No error expected |
| Admin sign-in | `bottomNavShown('/admin/login')` | `false` | No error expected |
| Auth pages | `bottomNavShown('/auth/sign-in')`, `'/auth'` | `false` | No error expected |
| Attempt and its results | `bottomNavShown('/student/tests')`, `'/student/tests/abc-1'` | `false` | No error expected |
| Near-miss prefixes | `bottomNavShown('/student/testsuite')`, `'/parent/pins'` | `true` | No error expected |
| Current tab, exact | `tabIsCurrent('/parent', { href: '/parent', match: 'exact' })` | `true`; `'/parent/drafts'` → `false` | No error expected |
| Current tab, drill-down | `tabIsCurrent('/parent/drafts/abc', { href: '/parent/drafts', match: 'prefix' })` | `true` | No error expected |
| More is current | `moreIsCurrent('/parent/students', PARENT_TAB_HREFS)` | `true`; `'/parent/capture/review'` → `false` | No error expected |
| Viewfinder open | capture reports open | Parent bar not rendered | No error expected |
| Coarse pointer, field focused | `focusin` on an `input` while `(pointer: coarse)` matches | bar hidden until `focusout` | A `matchMedia`-less environment leaves the bar shown |

</intent-contract>

## Code Map

- `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx:275-587` -- the Parent shell. `:280` `isNarrow = useMediaQuery(down('md'))` is what goes: `:357-394` (drawer branch) and `:395-486` (sidebar branch) stop being a ternary and both render always, the drawer unconditionally mounted (`ModalProps={{ keepMounted: true }}` already) and the sidebar wrapped in `display: { xs: 'none', lg: 'flex' }`. `:511-519` is the hamburger to delete; `:352` `railCollapsed` loses its `!isNarrow` term (the sidebar no longer exists below `lg`). `:330-350` is the gate's early return, which must stay bar-less. `:573-583` is the content box that gains the bottom padding. `NAV_GROUPS` `:67-103` and `NavList` `:156-258` are the reuse points — read, never duplicated. `locate()` `:130-146` is the exact/prefix matching idiom the tab matcher mirrors.
- `apps/web/src/app/admin/_components/AdminChrome.tsx:168-434` -- the Admin shell, same shape. `:175` hook goes, `:237-274` drawer **and** `:381-389` hamburger are deleted outright (five tabs, no More, so nothing opens a drawer), `:275-357` sidebar gets the `lg` display gate, `:233` `railCollapsed` simplifies, `:421-430` content gains bottom padding. `SIDEBAR_ITEMS` `:66-67` is the tab source (Overview, Taxonomy, Accounts, Flagged, Topics — exactly the five).
- `apps/web/src/app/student/layout.tsx:14-30` -- Student shell, a server component with no chrome at all. The `main` box gains the bottom padding and a new client `StudentBottomNav` sibling (the layout itself must stay server-side; `usePathname` lives in the child).
- `apps/web/src/app/student/page.tsx:326-349` -- the Home cluster holding the Parent View `Button` (`:335-346`, `href="/parent/pin"`, `Lock` glyph, `clearAll(attemptStorage())` on click) next to `<ColorModeSwitch />`. Only the `Button` is hidden below `lg`; the switch stays at every width.
- `apps/web/src/lib/color-mode.ts:33-49,90-96` -- `STUDENT_ATTEMPT`/`PARENT_CAPTURE` constants, `normalize`, `within`, and `colorModeSwitchShown`: the exact shape `bottom-nav.ts` copies (framework-free, every input an argument, unit-testable without a DOM). `lib/color-mode.spec.ts:92-123` is the near-miss-prefix spec idiom.
- `apps/web/src/components/TableCards.tsx` + `TableCards.spec.tsx:19-60` -- the CSS-only breakpoint precedent and the spec technique: `SOURCE`/`CODE` comment-stripped source reads, `renderToStaticMarkup` under `ThemeProvider`, `css(markup)` pulling emotion's sheet, `parentTheme.breakpoints.values.lg` named rather than restated.
- `apps/web/src/components/Snackbar.tsx:82-96` -- `MuiSnackbar` with no `sx` today; this is where the bottom offset goes. It is mounted by many screens, so the offset is gated by `bottomNavShown(usePathname())` rather than applied blind.
- `apps/web/src/app/parent/capture/AddPages.tsx:107-108,348-358` -- `open` state and the `{open && status === 'ready' && <CameraViewfinder …>}` render: the one fact the Parent shell cannot derive from the pathname. Report it upward through a tiny context (new `lib/capture-open.tsx`, modelled on `lib/elevation.tsx:1-50`), provider in the Parent shell, `useEffect` reporter here.
- `apps/web/src/theme/tokens.ts:113-158,160-166,216-224` -- `density`/`comfortableDensity` (`tapTarget`, `gap`, `cardPadding`, `sectionMargin`), `rounded`, `spacing`. Add one `bottomNav = { height: 56, indicator: 3 }` layout export beside them; `colorTokens` is not touched (Story 10.3's "no key added or removed" rule is about `colorTokens` alone, and `tokens.spec.ts` asserts that key set).
- `apps/web/src/app/layout.tsx:58-63` -- the `viewport` export. Add `viewportFit: 'cover'` beside `themeColor`; without it `env(safe-area-inset-*)` resolves to 0 on iOS. `e2e/tests/color-mode.spec.ts:270` already asserts things about this export's output — read it before editing.
- `apps/web/src/copy/parent.ts:187-240` (`parentView` block), `apps/web/src/copy/admin.ts:28-48` (`nav` block), `apps/web/src/copy/student.ts:737` (`parent: 'Parent'`) -- where the short labels and the bar's accessible name go. `parentCopy.parentView.menuToggle` (`copy/parent.ts:246`) and `adminCopy.nav.menuToggle` (`copy/admin.ts:48`) become dead once the hamburgers go; verified during planning that their only other readers are the two hamburgers themselves, so both keys are deleted with them.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.spec.tsx` -- asserts only install-banner wiring, so the breakpoint move does not break it; extend it with the CSS-only and no-hamburger claims rather than starting a second file.
- `e2e/tests/parent-pin.spec.ts:9-67` (sign-up → PIN → Parent View helpers), `e2e/tests/student-mode.spec.ts:19-60` (sign-up → profile → hand over), `e2e/tests/parent-students.spec.ts:325-431` and `e2e/tests/admin-taxonomy.spec.ts:289-363` (`setViewportSize` both ends of a swap) -- the E2E patterns to copy. Playwright runs one Chromium project, `workers: 1`, 60s timeout (`playwright.config.ts`), so the new spec must reuse these cheap flows and never generate a practice test.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/theme/tokens.ts` -- add `export const bottomNav = { height: 56, indicator: 3 } as const;` with a comment naming DESIGN.md's `bottom-nav` block as its source -- one figure, one place, so three shells and the snackbar cannot disagree about how tall the bar is.
- `apps/web/src/lib/bottom-nav.ts` -- new, framework-free: `bottomNavShown(pathname)`, `tabIsCurrent(pathname, { href, match })`, `moreIsCurrent(pathname, hrefs)`, the `BottomNavMatch = 'exact' | 'prefix'` type, and `barOffsetCss` (a `calc(...)` string of `bottomNav.height` + `env(safe-area-inset-bottom)` + a gap) used by both the shells' content padding and the snackbar -- every rule an argument-in/value-out function, because this workspace has no DOM to drive a component through.
- `apps/web/src/lib/bottom-nav.spec.ts` -- new: the whole I/O matrix's pure rows, including each near-miss prefix and `/parent/pin/change`, plus one assertion that `barOffsetCss` names `env(safe-area-inset-bottom)` and the token rather than a literal 56.
- `apps/web/src/components/BottomNav.tsx` -- new shared bar: props `{ items, ariaLabel, density, more? }`; `component="nav"` + `aria-label`; each item a `<Link>`-based action with icon above an always-visible label, current-state colour/weight/indicator and `aria-current="page"`; `more` a `<button>` firing its callback; `display: { xs: 'flex', lg: 'none' }`, `position: 'fixed'`, bottom/left/right 0, `zIndex: theme.zIndex.appBar`, `bgcolor: 'background.paper'`, `borderTop: '1px solid'`, `borderColor: 'divider'`, safe-area padding, `boxShadow: 'none'`; hides itself while a text field has focus **only** when `matchMedia('(pointer: coarse)')` matches, guarded for environments with no `matchMedia` -- one component so the three surfaces cannot drift, built on MUI primitives with each surface's own density passed in.
- `apps/web/src/components/BottomNav.spec.tsx` -- new, `TableCards.spec.tsx` idiom: breakpoint stated as `display` keys and never as a width hook (`not.toMatch(/useMediaQuery|window\.inner/)`, no `@media` literal, `matchMedia` only ever with `(pointer: coarse)`); emotion sheet shows `display:none` from `min-width:1200px` and the fixed/paper/divider/no-shadow treatment; markup shows the nav landmark with its name, one `<a href>` per item, `aria-current="page"` on the current one only, the indicator element and bold weight on it, a label rendered for every tab, `more` rendered as a `<button>` with no `href`, and the tap-target floor following the density passed (44 vs 48).
- `apps/web/src/lib/capture-open.tsx` -- new minimal context (`CaptureOpenProvider`, `useCaptureOpen`, `useReportCaptureOpen`), modelled on `lib/elevation.tsx`, with a no-provider default of "closed" so any other mount of `AddPages` is harmless -- the viewfinder's open state is the one visibility input no pathname can carry.
- `apps/web/src/app/parent/capture/AddPages.tsx` -- report `open && status === 'ready'` through `useReportCaptureOpen` in an effect, and report closed on unmount -- the camera's own state stays owned here; the shell only listens.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx` -- drop `isNarrow`/`useMediaQuery` and the header hamburger; render the drawer always and the sidebar under `display: { xs: 'none', lg: 'flex' }`; wrap in `CaptureOpenProvider`; mount `BottomNav` with Home/Upload/Drafts/Attempts resolved from `NAV_GROUPS` plus a More action that opens the existing drawer, suppressed when `!bottomNavShown(pathname)` or the viewfinder is open; pad the content box's bottom by `barOffsetCss` below `lg`; keep the gate's early return bar-less and the header's title, colour-mode switch and exit untouched.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.spec.tsx` -- extend with: no width hook and no hand-written media query in the shell, no hamburger/`menuToggle` reference left, the four tab hrefs resolved from `NAV_GROUPS` rather than written out, More wired to the same `setDrawerOpen` the sidebar's drawer uses, and the bar absent from the gate branch.
- `apps/web/src/app/admin/_components/AdminChrome.tsx` -- same breakpoint move; delete the drawer and the hamburger outright; mount `BottomNav` with the five `SIDEBAR_ITEMS` and no More; pad content; keep sign-out and the colour-mode switch in the header -- five destinations fit, so Admin needs no overflow affordance and the drawer would be dead code.
- `apps/web/src/app/admin/_components/AdminChrome.spec.tsx` -- new, source-read spec: the five tabs come from `SIDEBAR_ITEMS`, no `more` prop is passed, no `Drawer`/`menuToggle`/width hook survives, and the login branch renders no bar.
- `apps/web/src/app/student/_components/StudentBottomNav.tsx` -- new client mount: Home (`/student`, exact) and Parent View (`/parent/pin`, `Lock`), comfortable density, suppressed when `!bottomNavShown(pathname)` -- Student Mode's layout is a server component, so the pathname read lives in this child.
- `apps/web/src/app/student/_components/StudentBottomNav.spec.tsx` -- new: both tabs' hrefs and short labels, the suppression on an Attempt path, and the 48px floor.
- `apps/web/src/app/student/layout.tsx` -- mount `StudentBottomNav` and pad the `main` box's bottom by `barOffsetCss` below `lg`.
- `apps/web/src/app/student/page.tsx` -- wrap only the Parent View `Button` in `display: { xs: 'none', lg: 'inline-flex' }`, leaving the divider, the cluster and `<ColorModeSwitch />` as they are -- the tab replaces the link below `lg` and nothing else about Home changes.
- `apps/web/src/app/student/page.spec.tsx` -- assert the link is hidden below `lg` and shown from `lg` up, and that the colour-mode switch is not gated.
- `apps/web/src/components/Snackbar.tsx` -- offset the bottom anchor by `barOffsetCss` below `lg` on routes where `bottomNavShown(usePathname())`, unchanged from `lg` up -- a message that covers the navigation is a message that hides where you are.
- `apps/web/src/copy/parent.ts`, `apps/web/src/copy/admin.ts`, `apps/web/src/copy/student.ts` -- add a `bottomNav` block per surface (short tab labels plus the bar's accessible name) and delete the now-dead `menuToggle` keys.
- `apps/web/src/app/layout.tsx` -- add `viewportFit: 'cover'` to the `viewport` export, with a comment saying the insets resolve to 0 without it.
- `e2e/tests/bottom-nav.spec.ts` -- new Playwright spec reusing the cheap sign-up/PIN and student-binding flows: at 390×844 the Parent bar shows with its five tabs and no hamburger, tab presses navigate without a PIN re-prompt and mark the current tab, More opens the full grouped drawer, the last row of a long list and a snackbar both clear the bar; the bar also shows at 820×1180 and 1180×820; at 1280×800 the sidebar shows and the bar does not; the bar is absent on the PIN gate and on a `/student/tests/*` path; in Student Mode the bar's two tabs show and Home's Parent View link is hidden below `lg` and present at 1280×800.

**Acceptance Criteria:**
- Given any Parent, Admin or Student screen that carries the bar, when it is opened below 1200px, then the bar is fixed to the bottom with no sidebar and no header hamburger anywhere on the surface; and at 1200px and above the sidebar is exactly what it is today and the bar is not rendered — with the choice made by CSS, so no spec in the repo can find a width hook in any of the three shells.
- Given Parent View below `lg`, when the bar is read, then its tabs are Home, Upload, Drafts, Attempts and More; every href and icon traces to an entry in `NAV_GROUPS`; More opens the same drawer with the same grouped `NavList` the hamburger used to open; and More is the current tab on any route not under the other four.
- Given Admin below `lg`, when the bar is read, then its five tabs are exactly `SIDEBAR_ITEMS` in order, no More action exists, and the header still carries the colour-mode switch and Sign out.
- Given Parent View at 390×844, when a tab is pressed, then the browser performs a client-side navigation, the PIN is not asked again, the pressed tab carries `aria-current="page"` with the primary colour, bold weight and the indicator, and no tab's hit area is under 44px (48px in Student Mode).
- Given a long list below `lg`, when it is scrolled to the end and a snackbar is raised, then the last row and the snackbar are both fully above the bar, and the bar itself pads by the bottom, left and right safe-area insets with `viewport-fit=cover` declared at the root.
- Given the bar's labels and landmark, when the surface is read by assistive technology in light and dark mode, then the bar is a `nav` with an accessible name, every label comes from a `copy/` module, and the Accessibility Floor holds in both schemes.
- Given the whole web suite, when `pnpm --filter web test`, `typecheck`, `lint`, `build` and `pnpm e2e` run, then every pre-existing result is unchanged and the new unit and E2E specs pass.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 4: (high 0, medium 1, low 3)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[medium]` `[patch]` `viewport.viewportFit` (`apps/web/src/app/layout.tsx:65`) had no executing assertion — `layout.spec.ts` checked only `themeColor`, so reverting the one-line `viewportFit: 'cover'` the whole safe-area feature depends on would pass every test while silently putting the bar under the iOS home indicator. Added `expect(viewport.viewportFit).toBe('cover')` to `layout.spec.ts`.


### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 1, medium 6, low 4)
- defer: 3: (high 0, medium 2, low 1)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[high]` `[patch]` `BottomNav.tsx` cleared its `typing` state only on a `focusout` whose target was itself a text entry, so an input that unmounted (dialog closed, route changed, list re-rendered) left the bar hidden for the rest of the session — below `lg` that is a surface with no navigation at all. Added the pure `typingAfterFocusChange`, asked of `event.relatedTarget` on `focusout`, plus a reset keyed on `pathname`.
  - `[medium]` `[patch]` `isTextEntry` counted every `INPUT` as typing, so a checkbox, radio or file input made the bar vanish although no keyboard opens. Narrowed to text-like `type` values (case-insensitive, missing/empty included), with spec rows for the non-text ones.
  - `[medium]` `[patch]` The bar invented two figures outside the token system — an 11px label smaller than any `typeRoles` role (DESIGN.md's `bottom-nav` block says `{typography.caption}`) and a 22px glyph matching no other icon in the repo. Label now reads `typeRoles.caption`; glyph is a named 20. The "states no size figure of its own" test now fails on a new rem literal or an off-convention icon size.
  - `[medium]` `[patch]` Nothing stopped a tab label wrapping, so five tabs at 320px or under text zoom grew the bar past `bottomNav.height` and every `barOffsetCss` reservation under-reserved. Labels now clamp with `nowrap`/`hidden`/`ellipsis`/`maxWidth`, asserted over the emitted stylesheet with five tabs rendered.
  - `[medium]` `[patch]` `normalize` threw on a non-string pathname and `StudentBottomNav` passed `usePathname()` straight in, although Next returns `null` outside a router (the snackbar already guarded this). The three rules now take `string | null | undefined` and answer "no bar" instead of throwing; matrix rows added for `null`, `undefined` and `''`.
  - `[medium]` `[patch]` The Admin console — the one surface whose only narrow-width navigation this story deleted — had no browser coverage. Added Admin cases to `e2e/tests/bottom-nav.spec.ts`: five tabs in `SIDEBAR_ITEMS` order and no hamburger at 390x844, a tab press moving `aria-current`, the sidebar and no bar at 1280x800, and no bar on `/admin/login`.
  - `[medium]` `[patch]` Student Mode's server layout padded for the bar unconditionally, so the Attempt — where the bar is suppressed — ended a bar's height early. The clearance moved into `StudentBottomNav` as an `aria-hidden` flow spacer behind the same `bottomNavShown` guard, so room and bar appear and disappear together.
  - `[low]` `[patch]` Parent View reserved room for the bar on a live camera screen, where the bar is not drawn. Both the bar and the padding now ask one rule, `barIsOnScreen(pathname, captureOpen)`.
  - `[low]` `[patch]` The tab-drift guard threw during module evaluation while its comments claimed it "stops the build". `SIDEBAR_ITEMS` is now a literal union and `ADMIN_TAB_LABELS` `satisfies Record<AdminHref, string>`, so a renamed destination fails `typecheck` (verified by renaming one); the throw stays as a backstop and every overstated comment is corrected.
  - `[low]` `[patch]` The E2E "room under the last row" case seeded one profile, so the page might not scroll and the box comparison would pass whether or not the clearance existed. It now shrinks the viewport, asserts the document actually scrolls, scrolls to the end, and then compares.
  - `[low]` `[patch]` `lib/capture-open.tsx` — the state this story added a context for — had no executed test, only a source-text match that would pass on a mis-wired provider. Extracted `reportCaptureOpen(report, open)` and specced it, including that the cleanup reports closed and is handed back rather than run.

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[low]` `[patch]` `BottomNav.tsx`'s typing effect only reacted to a `focusin`/`focusout` *change*, so a text field already focused when the bar first mounts on a coarse-pointer device (an autofocused field on first paint) left the bar drawn over the keyboard until the next focus move. Added a read of `document.activeElement` through `typingAfterFocusChange` when the effect first runs; spec'd the source-text wiring.
  - `[medium]` `[patch]` `Snackbar.tsx`'s `liftedOverBar` asked only `bottomNavShown(pathname)`, not whether the Parent bar is actually drawn — on `/parent/capture` with the viewfinder open (`barIsOnScreen` in `ParentSidebarChrome.tsx` already hides the bar there), the snackbar would still lift by the bar's height over a bar that is not there. Folded in `useCaptureOpen()`, which reads `false` with no provider above it and so stays harmless on every other screen; spec'd.
  - `[medium]` `[patch]` `AdminChrome.tsx`'s bottom-bar clearance (`routeCarriesBottomNav` gating `barOffsetCss`) was pinned only by a source-text match in `AdminChrome.spec.tsx` — unlike Parent View's identical pattern, no test scrolled an Admin list and measured the last row against the bar, so an inverted or dropped condition would ship undetected. Added the Admin equivalent of Parent View's "leaves room under the last row of a list" case to `e2e/tests/bottom-nav.spec.ts`.

**Why both branches render instead of a hook.** `ParentSidebarChrome` and `AdminChrome` are the last two places in `apps/web` that pick a layout with `useMediaQuery`. A hook renders the narrow layout first on every device and swaps after hydration — the reflow UX-DR44 exists to forbid, and the thing `TableCards.spec.tsx` pins everywhere else. Rendering the drawer (closed, already `keepMounted`) and the sidebar together and letting `display` decide costs one hidden subtree and buys a stable first paint:

```tsx
<Box component="nav" sx={{ display: { xs: 'none', lg: 'flex' }, width: railCollapsed ? RAIL_WIDTH : SIDEBAR_WIDTH, … }}>
  <NavList pathname={pathname} collapsed={railCollapsed} />
</Box>
<BottomNav ariaLabel={parentCopy.parentView.bottomNav.label} items={PARENT_TABS} density={density}
           more={{ label: parentCopy.parentView.bottomNav.more, onPress: () => setDrawerOpen(true) }} />
```

**Why the tabs are resolved from `NAV_GROUPS` rather than written out.** The bar is a second *view* of the destination data, not a second navigation. Looking each tab's icon and href up by href keeps a renamed route or a moved icon from leaving the bar pointing somewhere the sidebar no longer does, and makes "the bar lists destinations that exist" a compile-or-test failure instead of a review question.

**Why the viewfinder needs a context when everything else is a pathname.** `/parent/capture` carries the bar — page management is an ordinary Parent screen. Only the *live viewfinder* must not have a bar over it, and that is state inside `AddPages`, three levels below the shell. A context is the smallest thing that carries one boolean upward; the alternative (route-level suppression of all of `/parent/capture`) would take the bar off the whole upload flow, which the story does not ask for.

**Why the keyboard rule is a pointer query and not a breakpoint.** A desktop browser at 1100px has a hardware keyboard and no on-screen one; hiding the bar on focus there would make the navigation flicker while typing. `(pointer: coarse)` is the condition that matters, and it is not a width — so it does not violate the CSS-only breakpoint rule, which is about *which layout* is drawn.

## Verification

**Commands:**
- `pnpm --filter web test` -- expected: all specs pass, including the new `bottom-nav`, `BottomNav`, `StudentBottomNav` and `AdminChrome` specs; no pre-existing spec changes result
- `pnpm --filter web typecheck` -- expected: no errors
- `pnpm --filter web lint` -- expected: no errors (including `jsx-a11y`)
- `pnpm --filter web build` -- expected: build succeeds
- `npx prettier --check` on every changed file -- expected: clean
- `pnpm e2e` -- expected: `bottom-nav.spec.ts` passes and every other spec's result is unchanged
- `grep -rn "useMediaQuery" apps/web/src` -- expected: no match outside specs asserting its absence
- `grep -rn "menuToggle" apps/web/src` -- expected: no match

**Manual checks (if no CLI):**
- At 390×844, 820×1180, 1180×820 and 1280×800, in light and dark: the bar (or sidebar) is the only navigation on screen, nothing sits under the bar, and the current tab reads as current with colour removed.

## Auto Run Result

**Summary:** Fresh unattended review pass over the already-`done` implementation (shared `BottomNav` bar on Parent/Admin/Student shells, CSS-only `lg` breakpoint, pure `bottom-nav.ts` visibility/current-tab helpers, `CaptureOpenProvider` viewfinder signal, safe-area padding). No intent gaps or spec defects found this pass; one real test-coverage gap was patched.

**Files changed this pass:**
- `apps/web/src/app/layout.spec.ts` -- added an executing assertion that `viewport.viewportFit === 'cover'`, closing the one case this pass found where reverting a load-bearing one-line viewport setting would have passed every existing test.

**Review findings breakdown:**
- patch: 1 (medium 1) -- applied; see Review Triage Log entry above
- defer: 4 (medium 1, low 3) -- added to frontmatter `deferred`: viewfinder-open signal untested end to end (pre-existing lack of camera mocking in the E2E harness), `More` button missing `aria-haspopup`/`aria-expanded`, Parent View's destination-drift guard is runtime-only (vs. Admin's compile-time union), bottom bar's coarse-pointer check does not re-evaluate if device capability changes post-mount
- reject: 10 (low 10) -- all matched either explicit intent-contract requirements (e.g. `aria-current="page"` on "More", the dual-rendered drawer/sidebar, the pointer-based typing rule, Parent's status==='ready' viewfinder gating) or pre-existing, already-logged repo conventions (source-text-matched shell specs, the `next-env.d.ts` churn `next dev` regenerates and `apps/web/AGENTS.md` says to commit)

**Verification performed:**
- `pnpm --filter web test` -- 99 files, 2050 tests, all pass (including the new `layout.spec.ts` assertion)
- `pnpm --filter web typecheck` -- clean
- `pnpm --filter web lint` -- clean
- `pnpm --filter web build` -- succeeds
- `npx prettier --check` on the changed file -- clean
- `grep -rn "useMediaQuery" apps/web/src` -- no match outside comments/specs naming its absence
- `grep -rn "menuToggle" apps/web/src` -- no match outside specs asserting its absence
- `pnpm e2e` was not re-run this pass: the only change was one unit-level assertion with no behavioural or E2E-visible surface, and the full E2E suite's prior green result (from the implementation pass) stands

**Residual risks:** the four deferred items above remain open; none blocks this story's own acceptance criteria. The 3 pre-existing deferred items logged at the prior `done` pass are unchanged and still owned by their original scope (workspace-wide jsdom/browser-mode test project, a mounted `AppSnackbar` consumer, a touch-emulating Playwright project).

