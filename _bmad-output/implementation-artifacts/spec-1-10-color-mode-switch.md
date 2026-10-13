---
title: 'Story 1.10: Light / Dark Mode Switch'
type: 'feature'
created: '2026-10-13'
baseline_revision: '22dbd32aab822239546954a786075b4d65e71bd1'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Student home's switch sits inside the loaded-session branch, so a device whose
      three reads are failing has no way to change mode on the one Student Mode screen
      that carries the control.
    evidence: |-
      `student/page.tsx` renders the switch in the block after the `<Divider>`, alongside
      the Parent View link; the loading and error branches render an alert and neither
      control. Arguably correct — UX-DR45 states the placement relative to the Parent View
      link, which is also absent there — but nothing decides whether a student looking at
      an error should still be able to pick a theme.
    location: >-
      apps/web/src/app/student/page.tsx
    severity: low
  - summary: >-
      `ColorModeMeta`'s re-sync after a client-side navigation is pinned only by a
      source-text spec, because no browser assertion can distinguish it today.
    evidence: |-
      A client-side nav re-emits the root `viewport` metadata, which restores the
      device-scoped pair — and because `brandInk.light` and `brandInk.dark` are the same
      value, that pair is byte-identical to the chosen one. `ColorModeMeta.spec.ts`
      therefore asserts the dependency list and the call, not the effect. The e2e case
      becomes a real one with no edit on the day the two token values diverge.
    location: >-
      apps/web/src/theme/ColorModeMeta.spec.ts
    severity: low
  - summary: >-
      A corrupt or foreign `mui-mode` value in storage leaves the switch as a permanent
      placeholder with no in-app way back.
    evidence: |-
      `effectiveScheme` returns `null` for any `mode` outside `light | dark | system`,
      which is the right answer for the unresolved case and the wrong shape for a tampered
      one: the control disappears instead of falling back to the device preference. Needs
      someone to have written the value by hand on the same origin, so it is not reachable
      through the app.
    location: >-
      apps/web/src/lib/color-mode.ts
    severity: low
  - summary: >-
      The `colorToken` tokens.ts parser is now duplicated verbatim in two e2e specs
      instead of living in `e2e/fixtures.ts`.
    evidence: |-
      `color-mode.spec.ts` and `pwa-installability.spec.ts` carry the same regex, comment
      and signature. A reformat of `brandInk` across lines breaks both, and the fixtures
      module is where every other shared e2e helper lives.
    location: >-
      e2e/tests/color-mode.spec.ts
    severity: low
  - summary: >-
      The positional half of UX-DR45 is asserted for one of four placements, and the
      switch-plus-action header cluster is pasted into three files.
    evidence: |-
      Parent View's "before the exit" is asserted geometrically; Admin's "before Sign out",
      the auth header's "top-right" and Student home's "beside the Parent View link" are
      asserted only by presence. The same `display: flex` / `alignItems: center` /
      `gap` wrapper is repeated in `AdminChrome.tsx`, `ParentSidebarChrome.tsx` and
      `student/page.tsx`, each restating the ordering rule in prose rather than sharing it.
    location: >-
      apps/web/src/app/admin/_components/AdminChrome.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** The app follows the device's light/dark preference and offers no in-app choice (FR-42 did not exist until 2026-10-13), so a family in a dim room cannot get the dark theme — and a tablet left in dark mode cannot get the light one — without changing the whole device's settings.

**Approach:** Add one shared `ColorModeSwitch` icon button that reads the mode in effect through MUI's `useColorScheme()` and writes the opposite with `setMode`, place it on the four surfaces UX-DR45 names, and keep the document's `theme-color` in step with the chosen mode. The light and dark schemes, the `data-light`/`data-dark` selector, and the pre-paint init script already exist; this story only adds the control and the plumbing that proves one stored mode is shared.

## Boundaries & Constraints

**Always:**
- Two options only: `light` and `dark`. Pressing the switch sets the opposite of the scheme **currently in effect** (`mode`, or `systemMode` while `mode === 'system'`), so the first press off the device preference lands on the opposite of what the person is looking at. There is no "System" option and no way back to following the device once a choice exists.
- One stored mode for every surface. `ThemeRegistry` is the only non-nested `ThemeProvider`, so it owns the single `ColorSchemeContext`; the four route providers inherit it and must keep passing `theme` only. No provider and no call site may pass `modeStorageKey`, `colorSchemeStorageKey`, `defaultMode`, or `disableNestedContext`, because the defaults (`mui-mode` / `mui-color-scheme`, `defaultMode: 'system'`) are already what `InitColorSchemeScript` writes.
- The choice is device-only: browser storage via MUI, no API call, no schema column, no cookie. It survives reload, sign-out, and Student Mode ↔ Parent View, and a later change to the device preference never overrides it.
- `mode` is `undefined` on the server render and the hydration render. The switch must render a non-interactive placeholder of the surface's tap-target size until the mode resolves — never a button whose label would flip after hydration, and never a markup difference that warns.
- Every string is a copy-module entry. The accessible name, the tooltip, and the icon all describe **the next press** ("Switch to dark mode" while light is showing, and the reverse).
- A real `<button>` (MUI `IconButton`), keyboard reachable, named by `aria-label`, tooltip on hover **and** focus, icon `aria-hidden`, sized to the surface's tap-target token — 44 in Parent View / Admin / auth, 48 on Student home — read from the density tokens, never as a literal.
- Pure rules live in a framework-free module so the `environment: 'node'` runner can drive them, following `lib/install-banner.ts`'s shape: every input arrives as an argument.
- `apps/web/src/components/ColorModeSwitch.tsx` is swept by `primitives.spec.tsx` (no hex colour, no `px` figure but `1px`, no bare `44`/`48`, no `aria-expanded`, no `surface ===`, no `'student'` literal, no div/span action, no `tabIndex`). It must pass unchanged.

**Block If:**
- Achieving one shared mode across the nested providers would require changing `ThemeRegistry`'s position, `layout.tsx`'s script/provider order, or any provider's `theme` — all three are pinned by existing specs and by AD-32.

**Never:**
- No "System"/auto third state, no per-account persistence, no API, schema, migration, or deploy change.
- No new theme, no new token, no palette edit: `theme.ts`, `tokens.ts`, `contrast.spec.ts`, and the brand palette stay byte-identical. The switch chooses between schemes that already exist.
- No switch inside the camera capture view (`/parent/capture` and below) or inside an in-progress Attempt.
- No switch on `/parent/pin` or `/admin/login` — both return a bare surface before the header, and neither is among the four placements UX-DR45 names.
- No transition, animation, or reload on press (UX-DR37); do not pass `disableTransitionOnChange`.
- Do not add a media-less `<meta name="theme-color">`: the two media-scoped tags in `layout.tsx` come first in `<head>` and would win. Update their `content` instead.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Never used, light device | `mode: 'system'`, `systemMode: 'light'` | Scheme in effect is `light`; switch offers dark | No error expected |
| Never used, dark device | `mode: 'system'`, `systemMode: 'dark'` | Scheme in effect is `dark`; switch offers light | No error expected |
| First press off the device | `mode: 'system'`, `systemMode: 'dark'`, press | `setMode('light')` | No error expected |
| Press with a choice held | `mode: 'light'`, press | `setMode('dark')` | No error expected |
| Device preference changes after a choice | `mode: 'light'`, `systemMode: 'dark'` | Scheme in effect stays `light`; switch still offers dark | No error expected |
| Mode unresolved (server / hydration) | `mode: undefined` | Placeholder of tap-target size, no button, no label | No error expected |
| `mode: 'system'`, `systemMode` unresolved | `mode: 'system'`, `systemMode: undefined` | Treated as unresolved — placeholder | No error expected |
| Capture route | `pathname: '/parent/capture'` or below | Parent header renders no switch | No error expected |
| Attempt route | `pathname: '/student/tests/<id>'` | No switch (route has no chrome, and the rule also says no) | No error expected |
| Any other parent route | `pathname: '/parent/students'` | Switch renders before the exit control | No error expected |
| `theme-color` sync | scheme in effect `dark` | Every `meta[name="theme-color"]`'s `content` becomes `colorTokens.brandInk.dark` | A document with no such meta is a no-op, not a throw |
| Storage blocked | `localStorage` throws or is unavailable | Press still repaints the page for this visit; nothing throws | Swallow the storage failure; MUI owns the write |

</intent-contract>

## Code Map

**MUI mechanics verified in `node_modules/@mui` at 9.4.0 — read-only evidence, do not re-derive**

- `@mui/system/cssVars/createCssVarsProvider.js:73-74, 116-119, 261-263` -- a nested `ThemeProvider` reads the outer `ColorSchemeContext` and returns its element **without** re-providing, so `mode`/`colorScheme`/`setMode` come from the outermost provider only. This is why one shared mode needs no new prop.
- `@mui/system/cssVars/createCssVarsProvider.js:51` -- `useColorScheme()` outside any provider returns a default context with `mode: undefined` and a no-op `setMode`; `:65, :68` -- `disableNestedContext = false`, `defaultMode = 'system'` defaults.
- `@mui/system/InitColorSchemeScript/InitColorSchemeScript.js:53-55, 62-71` -- `attribute="data"` expands to `[data-%s]`, so the init script sets `data-light` / `data-dark` on `<html>` (never `data-mui-color-scheme`); `createCssVarsProvider.js:178-204` -- the provider's effect sets the same pair. E2E must assert `html[data-dark]` / `html[data-light]`.
- `@mui/material/InitColorSchemeScript/InitColorSchemeScript.js:11-17` and `@mui/material/styles/ThemeProviderWithVars.js:28-29` -- both sides default to `modeStorageKey: 'mui-mode'`, `colorSchemeStorageKey: 'mui-color-scheme'`. Already aligned; the story asserts it rather than configuring it.

**Existing wiring (read-only unless listed under Execution)**

- `apps/web/src/theme/theme.ts:100-106` -- `cssVariables: { colorSchemeSelector: 'data' }` and `colorSchemes: { light, dark }`; `:265-295` -- `baseTheme`, `studentTheme`, `adminTheme`, `parentTheme`. Read-only.
- `apps/web/src/theme/ThemeRegistry.tsx:17-24` -- the one non-nested `ThemeProvider` (`baseTheme`) plus `CssBaseline` and `LiveRegionProvider`. The only place a document-wide client effect can sit inside the color-scheme context.
- `apps/web/src/app/parent/_components/ParentThemeProvider.tsx:12-14`, `app/admin/_components/AdminThemeProvider.tsx:12-14`, `app/student/_components/StudentThemeProvider.tsx:13-15`, `app/auth/_components/AuthThemeProvider.tsx:11-13` -- the four nested providers, `theme` prop only. Read-only; their shape is the invariant.
- `apps/web/src/app/layout.tsx:7, :62` -- `<InitColorSchemeScript attribute="data" />` in `<body>`; `:51-56` -- the `viewport.themeColor` pair keyed on `prefers-color-scheme`, server-evaluated and not reactive; `:60` -- `<html suppressHydrationWarning>`. Read-only.
- `apps/web/src/app/layout.spec.ts:24-26, :31-32, :74` -- pins the exact `viewport.themeColor` array, the absence of the literal hex in source, and the DOM order `InitColorSchemeScript` → `AppRouterCacheProvider` → `ThemeRegistry`. Must still pass.
- `apps/web/src/theme/tokens.ts:102` -- `brandInk: { light, dark }`, the `theme-color` source; `:113-120` -- `density` (`tapTarget: 44`, `gap`, `cardPadding`); `:130-137` -- `comfortableDensity` (`tapTarget: 48`). The only figure source.
- `apps/web/src/components/Screen.tsx:35-39` -- the `theme.density ?? density` idiom to copy when a component needs density at render.
- `apps/web/src/components/RowActions.tsx:6, :11-12, :144-156` -- the `Tooltip` + `IconButton` + lucide import idiom; `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx:510-516` -- the chrome variant that sizes by `density.tapTarget` instead of `size="small"`.
- `apps/web/src/components/primitives.spec.tsx:49-58, 61-69, 127-183` -- the file list, the `renderToStaticMarkup(createElement(ThemeProvider, { theme }, node))` harness, and the sweeps the new component must survive.
- `apps/web/vitest.config.ts` -- `environment: 'node'`: no spec can click. Behaviour is pinned as exported pure functions plus static markup.
- `apps/web/src/lib/install-banner.ts:40-47, 56-77` -- the framework-free rule module to imitate, including the `PARENT_CAPTURE` exclusion, `normalize`, and `within`.
- `apps/web/src/copy/common.ts:18, :109` -- `commonCopy`'s opening and its closing `as const`; the shared module for cross-surface strings.

**Placements**

- `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx:489-562` -- the sticky header; `justifyContent: 'space-between'` `:499`, left cluster `:508-558`, `<BackToStudentMode />` `:561`. `usePathname()` is already imported (`:32`) and `density` at `:36`. Insert the switch immediately before `:561`, both in one flex box.
- `apps/web/src/app/admin/_components/AdminChrome.tsx:361-413` -- the sticky header; Sign out `<Button>` `:401-412`. Insert the switch before it, both in one flex box.
- `apps/web/src/app/student/page.tsx:322-337` -- the `<Divider>` and the Parent View `<Button component={NextLink} href="/parent/pin">` with `minHeight: comfortableDensity.tapTarget` and `justifySelf: 'start'`. The switch goes beside that button, which means wrapping the pair in a flex row inside the grid.
- `apps/web/src/app/auth/layout.tsx:1-23` -- `AuthThemeProvider` wrapping a centered `main` at `minHeight: '100vh'`. There is no header: one must be added above `main` without un-centering the card.
- `apps/web/src/app/parent/capture/page.tsx:941-945` -- the capture screen sits **under** `ParentSidebarChrome`, so the switch leaks there unless the route is excluded. `apps/web/src/app/student/tests/[practiceTestId]/page.tsx:887` under `app/student/layout.tsx` renders no chrome, so the Attempt needs no exclusion in code — only in the rule and its spec.

**E2E**

- `playwright.config.ts:21-31` -- one `chromium` project, `devices['Desktop Chrome']`, `baseURL` from `WEB_ORIGIN`, `fullyParallel: false`, `workers: 1`. `colorScheme` is unset anywhere today, so the new spec sets it per `test.use` / `page.emulateMedia`.
- `e2e/tests/student-mode.spec.ts:19-27, 29-45, 55-60, 112-120, 137-143` -- `signUp`, `openStudents`, `addProfile`, the `Back to Student Mode` handover to `/student`, and the `Parent` link back to `/parent/pin`. The cheapest route to Student home and Parent View; reuse this recipe verbatim.
- `e2e/tests/admin-taxonomy.spec.ts:22` -- the local `signIn(page)` for `/admin/login`.
- `e2e/tests/pwa-installability.spec.ts:142-143` -- the existing `meta[name="theme-color"]` assertions; the new spec extends the same selector rather than inventing one.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/lib/color-mode.ts` -- **new.** Framework-free rules, one argument per input, in `install-banner.ts`'s style: `type ColorSchemeChoice = 'light' | 'dark'`; `effectiveScheme(mode, systemMode)` returning the scheme in effect or `null` when unresolved (`'system'` with no `systemMode`, or `mode` undefined); `nextScheme(scheme)`; `colorModeSwitchShown(pathname)` excluding `/parent/capture` and the Attempt route and allowing everything else; `themeColorFor(scheme)` reading `colorTokens.brandInk[scheme]`; and `syncThemeColor(docLike, scheme)` taking the smallest `{ querySelectorAll(selector): Iterable<{ setAttribute(name, value): void }> }` shape so the writer is drivable from a stub -- every rule in the matrix has to be pinnable by a `node` runner, which a rule inside a component is not.
- `apps/web/src/lib/color-mode.spec.ts` -- **new.** One case per I/O matrix row, including both unresolved rows, the capture and Attempt exclusions with and without trailing slashes, and `syncThemeColor` against a stub with zero, one, and two matching metas -- the matrix is the story's whole logic.
- `apps/web/src/copy/common.ts` -- add a `colorMode` group with the two next-press labels (dark and light), documented as the one place the wording is decided -- AD-32: no user-facing literal in a rendering module, and the wording is neutral enough for all four surfaces.
- `apps/web/src/components/ColorModeSwitch.tsx` -- **new.** Export `ColorModeSwitchView({ scheme, onSelect, tapTarget? })`, a pure presentational `Tooltip` + `IconButton` carrying the next-press label as both `aria-label` and tooltip title with a lucide `Sun`/`Moon` icon, sizing from `theme.density ?? density` per `Screen.tsx:35-39`; and `ColorModeSwitch()`, the `'use client'` wrapper that calls `useColorScheme()`, resolves `effectiveScheme`, renders an `aria-hidden` placeholder box of the same tap-target size while it is `null`, and otherwise renders the view with `onSelect` calling `setMode(nextScheme(scheme))` -- splitting the hook off the markup is what makes both labels, the real button, and the placeholder assertable under `renderToStaticMarkup`.
- `apps/web/src/components/ColorModeSwitch.spec.tsx` -- **new.** Static-markup cases: a real `<button type="button">` named by the dark label when light is in effect and by the light label when dark is; the icon is `aria-hidden`; the tooltip title matches the accessible name; the rendered box is the surface's tap target under both `parentTheme` and `studentTheme`; `ColorModeSwitch` with no provider renders the placeholder and no `<button>`; and `onSelect` receives the opposite scheme -- the switch's label is the only thing telling a person what the press will do.
- `apps/web/src/theme/ColorModeMeta.tsx` -- **new.** A `'use client'`, null-rendering component inside `ThemeRegistry`'s provider that calls `useColorScheme()` and, in an effect, `syncThemeColor(document, scheme)` once the scheme resolves -- the `viewport.themeColor` export is static and server-evaluated, so nothing else can make the title bar follow a chosen mode.
- `apps/web/src/theme/ThemeRegistry.tsx` -- mount `<ColorModeMeta />` inside the `ThemeProvider`, beside `CssBaseline` -- one mount for every surface, and the only node that is inside the color-scheme context on all of them.
- `apps/web/src/theme/ThemeRegistry.spec.tsx` -- add a case that the registry still mounts exactly one live region and that the color-mode meta sync is mounted -- the single-mount claim is what makes the sync surface-independent.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx` -- render `<ColorModeSwitch />` immediately before `<BackToStudentMode />`, wrapped with it in a flex box gapped by `density.gap`, gated on `colorModeSwitchShown(pathname)` -- UX-DR45 puts it at the header's top-right before the exit, and the capture screen inherits this header.
- `apps/web/src/app/admin/_components/AdminChrome.tsx` -- render `<ColorModeSwitch />` before the Sign out button, wrapped with it in a flex box gapped by `density.gap` -- an operator gets the same control in the same corner.
- `apps/web/src/app/student/page.tsx` -- wrap the Parent View button and `<ColorModeSwitch />` in a flex row with `justifySelf: 'start'`, keeping the button's own styling and `onClick` untouched -- Student home is the one Student Mode screen that carries it, and the Attempt must not.
- `apps/web/src/app/auth/layout.tsx` -- add a `component="header"` row above `main`, `justifyContent: 'flex-end'`, padded by the density tokens already imported, holding `<ColorModeSwitch />`; keep the card centered by making the outer box the column that owns `minHeight: '100vh'` and letting `main` grow -- the sign-in pages have no header today and the control has to live somewhere real.
- `e2e/tests/color-mode.spec.ts` -- **new.** With `colorScheme: 'light'` emulated: `/auth/sign-in` renders `html[data-light]` and a switch named for dark; press it, and `html[data-dark]` with the label now naming light and `meta[name="theme-color"]` content equal to the dark brand ink; reload and it is still dark from the first paint; `page.emulateMedia({ colorScheme: 'light' })` does not move it; `/admin/login` is still dark although it shows no switch; sign in and the Admin header's switch reads for light and flips back; then, following `student-mode.spec.ts`'s recipe, Parent View shows the switch before `Back to Student Mode`, `/parent/capture` shows none, Student home shows one beside the `Parent` link, and the Attempt screen shows none -- only a real browser can observe shared storage, first paint, and the device-preference override.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/EXPERIENCE.md` -- verify the Color mode switch row is present and matches what shipped; add or correct it if not -- the sprint change proposal lists it as applied, and the design reference must not contradict the screen.

**Acceptance Criteria:**
- Given a device whose switch has never been used, when any surface loads, then the scheme in effect is the device's preference and nothing about today's behaviour changes.
- Given the switch on any of its four placements, when it is pressed, then the other scheme applies at once with no reload, no animation, and no network request, and the icon, accessible name, and tooltip all change to describe the next press.
- Given a mode chosen on one surface, when the page reloads, another surface is opened, the person signs out, or they return later on the same device, then that mode is in effect from the first paint with no flash of the other, and a later change to the device preference does not override it.
- Given the four nested theme providers and `InitColorSchemeScript`, when the app is built, then each provider still passes `theme` only, no call site passes a storage key or `defaultMode`, and `layout.spec.ts`'s script/provider order and `viewport.themeColor` assertions pass unchanged.
- Given the scheme in effect, when it resolves or changes, then every `meta[name="theme-color"]` in the document carries that scheme's `brandInk` token value.
- Given `/parent/capture` or an in-progress Attempt, when either renders, then no color mode switch is in the document; given `/parent/pin` or `/admin/login`, then likewise none, and both still render exactly as today.
- Given the switch, when reached by keyboard, then it is a focusable real button whose tooltip appears on focus as well as hover, whose accessible name is the next-press sentence from the copy module, and whose box meets its surface's tap-target floor.
- Given the full suites, when `pnpm --filter web run typecheck`, `pnpm --filter web run lint`, `pnpm --filter web run test`, `pnpm --filter web run build`, and the Playwright specs run, then they pass, with `theme.ts`, `tokens.ts`, `contrast.spec.ts`, and every palette value unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 5: (high 0, medium 0, low 5)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[medium]` `[patch]` The device-preference override was never observed: the context was already `colorScheme: 'light'` and the test emulated light again, so the assertion would have passed even if a preference change had clobbered a held mode. Both directions the AC names are now exercised — dark held through an emulated dark *and* light preference, and a light choice made on a dark-preference device surviving a reload.
  - `[medium]` `[patch]` The `theme-color` assertion was self-satisfying: `brandInk.light` and `brandInk.dark` are the same value, so it passed against the server markup and stayed green with the sync deleted. Every meta is now stamped with a sentinel before the press, so the post-press token assertion observes a real write. Mutation-tested: disabling `syncThemeColor` now fails two tests.
  - `[medium]` `[patch]` `ColorModeMeta`'s effect depended on `[scheme]` alone, so a client-side navigation that re-emits the root `viewport` metadata left the metas back on the device-scoped pair with nothing to re-run the sync. `usePathname()` is now a dependency; the claim is pinned at source because today's identical token values make it unobservable in a browser (see `deferred`).
  - `[low]` `[patch]` The forbidden-prop sweep greped `ThemeRegistry.tsx` only, while the storage keys and the `attribute="data"` that every `data-dark` assertion rests on are set on `InitColorSchemeScript` in `layout.tsx`. The sweep now covers that file too, and the comment stripper drops trailing inline comments so prose naming a forbidden identifier cannot fail the suite.
  - `[low]` `[patch]` The Attempt assertion counted switches after navigating to a nonexistent id; a redirect to sign-in would have made it pass vacuously on a surface that does carry one. The URL is asserted first.
  - `[low]` `[patch]` The tooltip-on-focus half of UX-DR45 was unasserted. A keyboard-focus test now reads the next-press text from `role="tooltip"`, scoped so the `aria-label` cannot satisfy it.
  - `[low]` `[patch]` Two docs overclaimed: `colorModeSwitchShown`'s docstring sold the Attempt exclusion as belt-and-braces although only `ParentSidebarChrome` consults the predicate, and the forbidden-prop test attributed `disableTransitionOnChange` to per-surface mode splitting rather than to the no-transition rule. Both narrowed to what they actually hold.
  - `[low]` `[patch]` `layout.tsx`'s `viewport` comment still presented the media-scoped pair as the whole answer; it now records that `ColorModeMeta` rewrites both tags once a mode resolves. Comment only — the export and `layout.spec.ts` are untouched.

Rejected as noise: the `sx` tap-target sizing duplicating `MuiIconButton`'s own floor (explicit is the point), `ColorModeSwitchView`/`tapTarget?` being exported for the specs (the spec mandates that split — it is what makes the control assertable under the `node` runner), no live-region announcement on a mode change (not in UX-DR45, and the control's own name carries the state), the placeholder-to-button transition described as a "flash" (the AC is about a flash of the other *mode*, which the init script prevents), `/admin/login` and `/parent/pin` carrying no switch (a documented scope call in Design Notes), the e2e hard-coding the two labels rather than importing `commonCopy` (the house idiom — `pwa-installability.spec.ts` parses source for the same reason), `//parent/capture` and mixed-case paths (the router normalises before a component sees them), `not.toContain('theme-color')` being tautological, the manifest's single `theme_color` staying light, and the absence of a CI workflow.

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[low]` `[patch]` The placeholder `Box` set `flexShrink: 0` but `ColorModeSwitchView`'s real `IconButton` did not, so the two could size differently under flex-shrink pressure at the exact moment the placeholder swaps for the real control. Added `flexShrink: 0` to the `IconButton`'s `sx` so both sides of the hydration swap shrink identically.

Rejected as noise (this pass): the five deferred items being re-surfaced verbatim by a blind-context reviewer and by the positional-ordering check on Admin/auth/Student home (already recorded in frontmatter `deferred` from the prior pass, so not re-added); the Attempt-exclusion predicate having no browser-level caller for its own branch (`ParentSidebarChrome` is the only call site; the Attempt route itself renders no chrome, which is the existing, documented reason); `STUDENT_ATTEMPT` hiding the switch for the whole `/student/tests` subtree rather than only a "live" attempt (matches the I/O matrix's own Attempt-route row; no narrower rule was ever specified); the icon's fixed 20px size not scaling with the 44/48 tap-target floor (not a requirement anywhere in the intent); no reduced-motion/forced-colors handling for the icon swap (UX-DR37 only forbids a transition, which the diff already does not add); the e2e admin case depending on seeded fallback credentials (the same pattern `admin-taxonomy.spec.ts` already uses); and the spec's `EXPERIENCE.md` task, which needed no edit — the row already present in that file matches what shipped.

## Design Notes

**Why one shared mode needs no configuration.** `ThemeRegistry` is the only `ThemeProvider` without an outer one, so it is the only node that provides `ColorSchemeContext`; the four route providers hit the `nested` branch and return their subtree unwrapped (`createCssVarsProvider.js:261-263`). Both sides of the storage contract already use MUI's defaults. The risk the sprint change proposal flagged — each provider keeping its own mode — is therefore closed by *not* adding props, and the acceptance criterion is a guard against someone adding one later.

**Why `effectiveScheme` returns `null`.** `mode` is `undefined` through the server render and the hydration render, and `systemMode` is `undefined` until the media query is read. A switch that guessed "light" would announce the wrong next press for the first frame on a dark device. A placeholder that reserves the tap target keeps the header from shifting and keeps the markup honest.

**Why the two `theme-color` metas are edited rather than joined by a third.** A browser applies the first `theme-color` whose `media` matches. The media-scoped pair is emitted by the server `viewport` export at the top of `<head>`, so a media-less tag appended later would never win. Writing the chosen scheme's ink into both metas makes whichever one matches correct. Note that `brandInk.light` and `brandInk.dark` are the same value today (`tokens.ts:102`, a deliberate duplicate), so the assertion must be "the content equals `brandInk[scheme]`", not "the two modes differ".

**Why the unit specs do not click.** `apps/web` runs vitest in `environment: 'node'` with no jsdom, so "a unit spec covers the toggle, the label change, and persistence" is satisfied the way this repo always satisfies it: the decisions are exported pure functions with a spec per matrix row, the markup is asserted under `renderToStaticMarkup`, and the three things only a browser can show — the attribute flip, storage across a reload, and the device-preference override — are the Playwright spec's job.

**The shape, once:**

```tsx
const { mode, systemMode, setMode } = useColorScheme();
const scheme = effectiveScheme(mode, systemMode);
if (scheme === null) return <Box aria-hidden="true" sx={placeholderSx} />;
return <ColorModeSwitchView scheme={scheme} onSelect={(next) => setMode(next)} />;
```

**Scope call on the sign-in surfaces.** UX-DR45 says "the sign-in pages top-right", and the sprint change proposal's technical impact names `auth/layout.tsx` as the file. `/parent/pin` and `/admin/login` both return a bare centered surface before their chrome renders, and neither is in the proposal's enumerated placement list, so they are out. A reader can still reach the switch from `/auth/sign-in` one step away, and the mode they pick there holds on both.

## Verification

**Commands:**
- `pnpm --filter web run typecheck` -- expected: clean.
- `pnpm --filter web run lint` -- expected: clean, jsx-a11y satisfied by the real `IconButton` and its `aria-label`.
- `pnpm --filter web run test` -- expected: all specs pass, including the new `color-mode.spec.ts`, `ColorModeSwitch.spec.tsx`, the amended `ThemeRegistry.spec.tsx`, and `primitives.spec.tsx`'s sweeps over the new component.
- `pnpm --filter web run build` -- expected: a successful production build.
- `pnpm exec playwright test e2e/tests/color-mode.spec.ts e2e/tests/pwa-installability.spec.ts e2e/tests/student-mode.spec.ts` -- expected: pass. Playwright must start its own seeded servers; if a local dev `api`/`web` is already running, stop those two first (keep postgres) so `e2e:prepare` seeds.
- `pnpm prettier --write .` -- expected: no unformatted files remain.

**Manual checks (if no CLI):**
- On a light-preference device: Parent View, Admin, `/auth/sign-in`, and Student home each show one sun/moon button in the place UX-DR45 names; press it on any one and every other surface is dark on arrival, through a reload and through sign-out; `/parent/capture` and an in-progress Attempt show no button.

## Auto Run Result

**Summary:** Story 1.10 ships the in-app light/dark switch FR-42 asks for. One `ColorModeSwitch` reads the scheme in effect through MUI's `useColorScheme()` and writes the opposite with `setMode`; it is placed in the Parent View header before the exit control, the Admin header before Sign out, a new auth header top-right, and on Student home beside the Parent View link, and is kept off the camera capture screen and the Attempt. A null-rendering `ColorModeMeta` in `ThemeRegistry` keeps both `theme-color` metas on the chosen scheme's ink. One stored mode is shared across all four surfaces for free, because `ThemeRegistry` is the only non-nested `ThemeProvider` and the route providers hit MUI's nested branch — so the story adds a guard against anyone configuring a storage key rather than configuring one itself. No API, schema, migration, or palette change. This follow-up review pass fixed one small layout-consistency gap in the switch component; everything else shipped in the prior pass stands unchanged.

**Files changed:**
- `apps/web/src/lib/color-mode.ts` -- **new.** Framework-free rules: `effectiveScheme`, `nextScheme`, `colorModeSwitchShown`, `themeColorFor`, `syncThemeColor` over a narrow document seam.
- `apps/web/src/lib/color-mode.spec.ts` -- **new.** One case per I/O matrix row, including both unresolved rows, trailing-slash and prefix near-misses, and the sync against stubs with zero, one, and two metas.
- `apps/web/src/components/ColorModeSwitch.tsx` -- **new, amended this pass.** `ColorModeSwitchView` (pure `Tooltip` + `IconButton`, next-press label as name and title, sized from the mounted theme's density) plus the client wrapper that draws a placeholder until the mode resolves; the real `IconButton` now carries `flexShrink: 0`, matching the placeholder it swaps with.
- `apps/web/src/components/ColorModeSwitch.spec.tsx` -- **new.** Both labels, the real button, the hidden icon, each surface's tap-target floor, the placeholder, and the opposite-scheme press.
- `apps/web/src/theme/ColorModeMeta.tsx` -- **new.** Null-rendering client sync of every `theme-color` meta, re-run on scheme and on navigation.
- `apps/web/src/theme/ColorModeMeta.spec.ts` -- **new.** Pins the dependency list, the call through `syncThemeColor`, and the render-nothing contract.
- `apps/web/src/theme/ThemeRegistry.tsx` / `.spec.tsx` -- mounts the sync once inside the one non-nested provider; the spec sweeps the registry, the four route providers, and `layout.tsx` for any prop that would split the mode.
- `apps/web/src/copy/common.ts` -- the two next-press labels, in the one place the wording is decided.
- `apps/web/src/app/parent/_components/ParentSidebarChrome.tsx`, `app/admin/_components/AdminChrome.tsx`, `app/student/page.tsx`, `app/auth/layout.tsx` -- the four placements; the auth layout gains a header row and gives `main` the growing half so the card stays centred.
- `apps/web/src/app/layout.tsx` -- comment only: records that the sync rewrites the metas the `viewport` export emits.
- `e2e/tests/color-mode.spec.ts` -- **new.** The attribute flip, the sentinel-backed theme-color write, first-paint persistence across a reload, both device-preference-override directions, one shared mode into a surface that shows no switch, the operator's control, the four placements and two exclusions, tooltip on focus, and a device whose storage refuses the write.

**Review findings breakdown:** this pass -- patch 1 (low 1) -- applied; defer 0; reject 0 (noise, logged in the triage log). Prior pass -- patch 8 (medium 3, low 5) -- all applied; defer 5 (low 5) -- in frontmatter `deferred`; reject 10 (low 10) -- dropped.

**Follow-up review recommendation:** `false`. This pass's patched findings score `3*medium(0) + 1*low(1) = 1`, below the 5 threshold, and none was `high`.

**Verification performed (this pass):**
- `pnpm --filter web run typecheck` -- clean.
- `pnpm --filter web run lint` -- clean.
- `pnpm --filter web run test` -- 93 files, 1961 tests, all passing, including `ColorModeSwitch.spec.tsx` and `primitives.spec.tsx`'s sweeps over the amended component.
- `pnpm --filter web run build` -- succeeded.
- `pnpm exec playwright test e2e/tests/color-mode.spec.ts e2e/tests/pwa-installability.spec.ts e2e/tests/student-mode.spec.ts` -- 20 passed. Local dev `api`/`web` were stopped and postgres restarted standalone so Playwright's own seed step ran; the local dev stack was restarted afterward to restore prior state.
- `pnpm prettier --check` on the changed file -- conforms.

**Residual risks:** unchanged from the prior pass -- the five deferred items, all low. The one worth naming is that `brandInk.light` and `brandInk.dark` are the same value today, so the chosen-mode `theme-color` write is proved by a sentinel in the browser and by a source-text spec for the navigation case — the day the two token values diverge, both become ordinary assertions with no edit. Nothing here blocks shipping.

