---
title: 'Story 1.7: Design System Foundation'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_revision: '19a71de41583282fa994611dda1f0a277d0f2be6'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The address-resolution value carries no possessive or pluralisation helper, so later
      epics' result strings cannot render "your test" versus "Ada's test" through it.
    evidence: |-
      `AddressValue` exposes `name`, `Name` and `verb` only. UX-DR31 covers every
      result/analytics string describing student work, and Epic 5/7 copy will need a
      possessive form. No such string exists yet in Epic 1, so nothing is broken today —
      but the first consumer will either extend the mechanism or reintroduce a literal.
    location: >-
      apps/web/src/components/Address.tsx
    severity: low
  - summary: >-
      Both variable font families are imported as full CSS entrypoints with no preload and
      no fallback metric matching, so every weight and subset ships and the swap is unmeasured.
    evidence: |-
      `apps/web/src/app/layout.tsx` imports the two `@fontsource-variable` index entrypoints,
      which pull every subset including latin-ext and cyrillic. No `size-adjust`/`ascent-override`
      is declared on the fallback stacks and no face is preloaded, so a layout shift on swap is
      possible. UX-DR5 requires self-hosting, which is met; bundle weight and CLS are not
      addressed by any requirement or test.
    location: >-
      apps/web/src/app/layout.tsx
    severity: low
  - summary: >-
      The new jsx-a11y ESLint rules (UX-DR30) are not run by any automated gate, so a
      violation ships undetected unless a developer runs lint manually.
    evidence: |-
      `apps/web/package.json`'s `"lint"` script is separate from `"build"` and `"test"`,
      neither of which invokes ESLint, and the repository has no `.github/workflows`
      directory, so no CI job runs it either. This is a repo-wide condition that predates
      this story — no prior story's lint output is enforced automatically either — so the
      new jsx-a11y rules inherit the same gap rather than introducing a new one.
    location: >-
      apps/web/package.json
    severity: low
  - summary: >-
      DestructiveConfirmDialog has no error-state copy or slot for a rejected account
      password, so the first consumer that wires it to real re-authentication has nowhere
      defined to show that failure.
    evidence: |-
      `commonCopy.destructive` defines title/irreversible/labels/confirm/cancel but nothing
      for a failed confirm. This story ships the primitive only, with no API wiring
      (out of scope per the spec's "Never" boundary), so nothing is broken today — but
      `onConfirm(password)` currently has no way to report back that the password was wrong.
    location: >-
      apps/web/src/components/Dialog.tsx
    severity: low
  - summary: >-
      The destructive-confirm password field has no Enter-to-submit: confirming requires
      clicking the button even once a password is typed.
    evidence: |-
      `DestructiveConfirmDialog`'s `TextField` carries no `onKeyDown`/form submit handling,
      so pressing Enter while focused in the field does nothing. Not required by any
      acceptance criterion or UX-DR in this story; a reasonable follow-up affordance.
    location: >-
      apps/web/src/components/Dialog.tsx
    severity: low
  - summary: >-
      DestructiveConfirmDialog's `onConfirm(password)` call, the busy/firing interlock, and
      AppSnackbar's unmount cleanup are only verified through their extracted pure functions
      (`passwordOnToggle`, `canConfirmDestructive`, `announcementFor`), not through a real
      click or unmount driven by a mounted component.
    evidence: |-
      The story's own constraint forbids introducing a DOM test runner — tests run under
      vitest in the `node` environment against `renderToStaticMarkup`, which never processes
      effects or click handlers. The pure-function extraction already carries the actual
      logic under test; only the wiring between a real DOM event and that logic goes
      unverified, and closing that gap would mean revisiting the no-DOM-runner constraint.
    location: >-
      apps/web/src/components/Dialog.tsx, apps/web/src/components/Snackbar.tsx
    severity: low
  - summary: >-
      `theme.spec.ts` asserts `baseTheme.spacing(3)` against MUI's own generated CSS-variable
      string, so a MUI version bump could break the assertion with no real regression behind it.
    evidence: |-
      The assertion checks the literal string `'3 * var(--mui-spacing, 8px)'`, which is MUI's
      internal `spacing()` output format rather than this story's own token. `package.json`
      has already carried multiple major-version bumps across this epic, so this coupling is
      more likely than most to need attention on the next one.
    location: >-
      apps/web/src/theme/theme.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Stories 1.1–1.6 shipped on a partial theme: one accent pair, a semantic palette, flat surfaces and a focus ring exist, but the serif family, the eight-role type scale, tabular figures, the paper radius role, Student Mode's comfortable density, the reusable primitives (text field, primary/destructive button, dialog, destructive-confirm dialog, snackbar), and the cross-cutting rules (real controls, address resolution, live-region announcements, single fluid layout, motion policy) do not exist — so every later epic would invent its own.

**Approach:** Complete the token set and the one base MUI theme (typography roles, self-hosted Literata + Source Sans 3, semantic radius, per-surface density), then add a small `src/components` primitive layer plus the shared address-resolution, live-region and layout mechanisms that later epics consume, each with unit tests asserting the token rule rather than a rendered pixel.

## Boundaries & Constraints

**Always:**
- Tokens live in `src/theme/tokens.ts` as data; `src/theme/theme.ts` is the only place they map onto MUI. No component hardcodes a colour, size, spacing figure or radius.
- Exactly one base theme. Surfaces differ by `palette.primary` and by density set only — every other token byte-identical (the existing `theme.spec.ts` entry-for-entry assertion must keep passing, extended to the student theme).
- Family follows content, not surface: serif (Literata) for generated Question/Explanation content wherever it appears, sans (Source Sans 3) for all chrome. Both self-hosted via `@fontsource-variable/*`, with the DESIGN.md fallback stacks declared.
- Destructive intent is label text plus an outlined error-colour border — never a filled red button.
- Overlay separation is scrim plus 1px divider border; `boxShadow: none` everywhere, `elevation={0}` everywhere.
- Every primitive renders a real interactive element (`button`, `input`, `a`); no `div`/`span` carries an action, state, or `aria-expanded`.
- `prefers-reduced-motion` disables every transition the theme emits.
- Tests run under vitest in the `node` environment — assert theme objects, pure functions, and `renderToStaticMarkup` output, as the existing specs do. No DOM test runner is introduced.

**Block If:**
- The npm registry is unreachable, so the self-hosted font packages cannot be installed.

**Never:**
- Do not rewrite the shipped Stories 1.1–1.6 screens onto the new primitives. Those screens inherit the completed theme through MUI's component defaults; swapping their raw `@mui/material` imports is refactor churn with regression risk and is out of scope. The one exception is `StudentThemeProvider`, which must switch to the comfortable-density theme for UX-DR9/UX-DR10 to mean anything.
- No inverted/viewfinder tokens (UX-DR4), fraction rendering (UX-DR8), or any Epic 3–7 component (cards, question container, grade-state markers, mastery table, sparkline, timer, question map, smart fraction field). Those are their own stories.
- No new API, Prisma, or `apps/api` change. This story is `apps/web` plus root lint/dependency wiring only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Type role resolution | `typeRoles.questionBody` | Serif stack, 1.375rem, weight 400, line-height 1.60 | No error expected |
| Tabular figures | A role flagged tabular (`timer`) | `fontVariantNumeric: 'tabular-nums'` present on that role, absent on `questionBody`/`explanationBody` | No error expected |
| Student density | `studentTheme` | Button/input min-height 48, row height 56, card padding 20 | No error expected |
| Parent density | `parentTheme` / `adminTheme` | Button/input min-height 44, row height 40, card padding 12 | No error expected |
| Address resolution, Student Mode | surface `student`, subject `Ada` | Second person (`You scored 11 of 15.`) | No error expected |
| Address resolution, Parent View | surface `parent`, subject `Ada` | Third person by name (`Ada scored 11 of 15.`) | No error expected |
| Address resolution, no provider | component rendered outside `AddressProvider` | Throws at render — a missing surface is a defect, not a silent default | Throw with a named error |
| Destructive confirm submit | password field empty | Confirm control disabled; no callback fired | No request attempted |
| Destructive confirm copy | `subject: 'Ada'` | Dialog names Ada, states the action cannot be undone, asks for the account password | No error expected |
| Reduced motion | `prefers-reduced-motion: reduce` | Theme transition durations resolve to `0ms` | No error expected |

</intent-contract>

## Code Map

- `apps/web/src/theme/tokens.ts` (76 lines) -- token data. Has `colorTokens` (full semantic set, light+dark), `density` (compact, tapTarget 44), `comfortableDensity` (tapTarget 48), `rounded.control` = 8, `focusRing`, `sansStack`, and a stub `typeRoles` carrying only `tableCell`. Extend here: `serifStack`, all eight roles, `rounded.paper`/`none`, `measure.questionMaxWidth` (34rem), `spacing`, `motion`.
- `apps/web/src/theme/theme.ts` (176 lines) -- `buildTheme(primary: TokenPair)` is the single factory; `paletteFor()` maps every colour token; `flatSurface`/`borderedSurface`/`focusOutline` are the shared style fragments; exports `baseTheme` (student accent), `adminTheme`, `parentTheme`, plus `createAdminTheme()`/`createParentTheme()`. Currently hardcodes the compact `density` in `MuiButton`, `MuiIconButton`, `MuiCheckbox`, `MuiSwitch`, `MuiOutlinedInput`, `MuiTableCell`, `MuiTableRow`, `MuiCardContent` — parameterise `buildTheme` with the density set.
- `apps/web/src/theme/mui.d.ts` (9 lines) -- `CssThemeVariables { enabled: true }` augmentation. Add the `TypographyVariants`/`TypographyVariantsOptions`/`TypographyPropsVariantOverrides` augmentation for the eight roles here.
- `apps/web/src/theme/theme.spec.ts` (78 lines) -- the entry-for-entry "only `palette.primary` differs" assertion and the "every token has light+dark" loop. The model for the new theme assertions; extend rather than duplicate.
- `apps/web/src/theme/ThemeRegistry.tsx` -- root provider on `baseTheme` + `CssBaseline`. Unchanged.
- `apps/web/src/app/layout.tsx` -- root layout, `InitColorSchemeScript attribute="data"`, `AppRouterCacheProvider`. Import the two `@fontsource-variable` CSS entrypoints here.
- `apps/web/src/app/student/_components/StudentThemeProvider.tsx` -- currently `baseTheme`; switch to the comfortable-density student theme.
- `apps/web/src/app/{parent,admin,auth}/_components/*ThemeProvider.tsx` -- read `parentTheme`/`adminTheme`; keep compact. Read-only evidence that the nested-provider pattern is already established.
- `apps/web/src/copy/{student,parent,admin}.ts` -- copy modules are plain `as const` objects, some entries already parameterised functions (`greeting: (name) => ...`). The precedent for the shared destructive-dialog copy and for address-parameterised strings.
- `apps/web/src/lib/elevation.spec.tsx`, `apps/web/src/app/parent/_components/ParentIdleExpiry.spec.tsx` -- the `renderToStaticMarkup` test pattern under the `node` environment; copy it for the primitives.
- `apps/web/src/app/parent/_components/BackToStudentMode.tsx` -- the only existing `@mui/material/Dialog` consumer. Read-only: do not migrate it.
- `apps/web/vitest.config.ts` -- `environment: 'node'`, `@` alias, `esbuild.jsx: 'automatic'`. No change needed.
- `apps/web/eslint.config.mjs` (11 lines) -- `tseslint.configs.recommended` plus `no-explicit-any`. Add the jsx-a11y layer that mechanises UX-DR30.
- `apps/web/package.json` -- MUI 9.4.0, Next 16.3.4, React 19.2.8, vitest 3.2.4. Add the two font packages and the a11y lint plugin.
- `_bmad-output/planning-artifacts/epics.md:164-208` -- UX-DR1–UX-DR13 and UX-DR23/26/27/28 definitions; `:236-254` -- UX-DR30/31/33/36/37. Read-only source of truth.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md:63-115` -- the typography/radius/spacing token block; `:461-470` -- the eight-role table with exact sizes, weights, line-heights and the `label` `+0.02em` letter-spacing; `:472-478` -- the tabular-figure rule and the "Literata needs `tnum` explicitly" note.

## Tasks & Acceptance

**Execution:**
- `apps/web/package.json` -- add `@fontsource-variable/literata` and `@fontsource-variable/source-sans-3` (5.3.0) as dependencies and `eslint-plugin-jsx-a11y` as a dev dependency; run `pnpm install` -- the families are self-hosted per UX-DR5, and UX-DR30 is enforced by lint rather than review.
- `apps/web/src/theme/tokens.ts` -- add `serifStack`, the eight `typeRoles` at the DESIGN.md figures, `rounded.paper`/`rounded.none`, `measure.questionMaxWidth`, the 8px `spacing` scale, and `motion` durations/easing -- one data source for every later epic.
- `apps/web/src/theme/mui.d.ts` -- augment MUI typography with the eight roles so `<Typography variant="questionBody">` typechecks -- roles are reachable by name, never by a one-off `sx`.
- `apps/web/src/theme/theme.ts` -- give `buildTheme` a density parameter; map the eight roles onto `typography`; apply `tabular-nums` only to the flagged roles; give Dialog/Menu/Popover scrim-plus-border and Paper the semantic radius; zero every transition under `prefers-reduced-motion`; export `studentTheme` (student accent + comfortable) alongside the existing compact themes -- UX-DR5/6/7/9/10/11/12/37 land in the one place tokens become MUI.
- `apps/web/src/app/layout.tsx` -- import the two font CSS entrypoints -- self-hosting, no network font fetch at runtime.
- `apps/web/src/app/student/_components/StudentThemeProvider.tsx` -- switch to `studentTheme` -- Student Mode's 48px floor and comfortable spacing take effect.
- `apps/web/src/components/TextField.tsx` -- wrap MUI `TextField` at the control role with the divider border, focus ring and surface tap-target floor from the theme (UX-DR23).
- `apps/web/src/components/Button.tsx` -- export `PrimaryButton` and `DestructiveButton`; destructive is an outlined error-colour border plus label text, never a filled red fill (UX-DR26).
- `apps/web/src/components/Dialog.tsx` -- export `AppDialog` (scrim plus border, no shadow) and `DestructiveConfirmDialog`, which names the subject being destroyed, requires an account-password field, states the action cannot be undone, and keeps its confirm control disabled while the password is empty (UX-DR27).
- `apps/web/src/components/Snackbar.tsx` -- flat, bordered, shadowless snackbar that announces through the live region (UX-DR28).
- `apps/web/src/components/LiveRegion.tsx` -- one `role="status"` polite region plus an `announce()` hook, announcing the displayed copy verbatim (UX-DR33).
- `apps/web/src/components/Address.tsx` -- `AddressProvider` (surface + subject name) and the `useAddress()`/`<Addressed>` resolution used by every result/analytics string; throws outside a provider (UX-DR31).
- `apps/web/src/components/Screen.tsx` -- the single fluid layout primitive: one column, density-driven gutters, unchanged phone-to-tablet, with the 34rem measure cap available for content (UX-DR36).
- `apps/web/src/copy/common.ts` -- the shared destructive-confirm and snackbar copy as parameterised functions, plain and factual, no exclamation marks (UX-DR41 voice, applied here).
- `apps/web/eslint.config.mjs` -- enable the jsx-a11y rules that forbid an action, `aria-expanded`, or state on a non-interactive element, scoped to `src/**/*.tsx` -- UX-DR30 becomes a build failure rather than a review note.
- `apps/web/src/theme/theme.spec.ts` -- extend with the type-scale, tabular-figure, density, radius and reduced-motion assertions, and hold `studentTheme` to the same entry-for-entry "only `palette.primary` and density differ" rule.
- `apps/web/src/components/*.spec.tsx` -- unit-test every I/O matrix row: role figures, per-surface tap-target floors, address resolution on both surfaces and its no-provider throw, the destructive dialog's disabled-until-password rule and its copy, and that each primitive renders a real interactive element.

**Acceptance Criteria:**
- Given the completed token set, when any theme is built, then every colour, size, spacing and radius it applies traces to `tokens.ts`, and no component file contains a literal hex colour, `px` tap-target, or radius figure.
- Given the two families, when the app renders, then serif resolves for generated-content roles and sans for every chrome role, both served from the bundled self-hosted packages with the specified fallback stacks, and neither is selected by surface.
- Given `studentTheme`, `parentTheme` and `adminTheme`, when their palettes are compared entry for entry, then only `palette.primary` differs, and the student theme's only other divergence is the comfortable density set.
- Given the primitives, when each is rendered to static markup, then it emits a real interactive element carrying its accessible name, and no `div` or `span` in `src/components` carries an action, state, or `aria-expanded`.
- Given a destructive confirmation, when it opens, then it names exactly what will be destroyed, states the action cannot be undone, asks for the account password, and refuses to confirm until one is entered.
- Given a state change worth announcing, when a primitive reports it, then the live region carries the displayed copy verbatim rather than a second, test-only string.
- Given `prefers-reduced-motion: reduce`, when the theme resolves, then every transition duration it emits is `0ms`, and no primitive introduces a decorative animation.
- Given the shipped Stories 1.1–1.6 screens, when they render unchanged on the completed theme, then their existing unit specs still pass and Student Mode picks up the 48px floor and comfortable spacing.

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 0, medium 7, low 7)
- defer: 2: (high 0, medium 0, low 2)
- reject: 13: (high 0, medium 4, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `LiveRegionProvider` was mounted nowhere, so `AppSnackbar` would have thrown on first real use — mounted once in `ThemeRegistry`, with a test asserting exactly one polite region.
  - `[medium]` `[patch]` `DestructiveConfirmDialog` kept the typed password across an `open` toggle, re-enabling confirm against a stale value — cleared on close via a pure `passwordOnToggle` transition, tested including the reopen path.
  - `[medium]` `[patch]` Snackbar announcements were lost on a repeated identical message, never cleared on close, never auto-dismissed, and a `clickaway` could dismiss unread copy — live-region state is now message-plus-count, `announcementFor`/`closesOn` are pure and tested, and `motion.snackbarAutoHide` supplies the default duration.
  - `[medium]` `[patch]` `rounded.paper` was declared and asserted but applied nowhere — `MuiPaper` now takes the paper role while Card, controls and overlays keep the control role, asserted both ways.
  - `[medium]` `[patch]` All four `transitions.easing` entries were flattened to one curve, erasing MUI's `sharp` semantics — the override is now `easeInOut` only, with the others asserted as MUI ships them.
  - `[medium]` `[patch]` `{...props}` was spread after the enforced `variant`/`color`/`fullWidth`, letting a caller drop the control role a primitive exists to enforce — spread order inverted in `TextField` and both buttons, with override-loses tests.
  - `[medium]` `[patch]` The destructive-confirm wiring, dialog copy and snackbar announcement were verified by source-text matching that a rename or reformat would break and a real regression would pass — replaced with `renderToStaticMarkup` assertions on the mounted dialog (`disablePortal keepMounted`) and pure-transition tests for the announcement path.
  - `[low]` `[patch]` The `spacing` token was consumed by nothing, so `theme.spacing()` used MUI's default — passed to `createTheme` and asserted.
  - `[low]` `[patch]` The reduced-motion block zeroed durations but not delays — `transitionDelay`/`animationDelay` now zeroed too.
  - `[low]` `[patch]` The Student Mode theme swap was unpinned: reverting it to `baseTheme` left the suite green — new `StudentThemeProvider.spec.tsx` asserts the provided theme carries `comfortableDensity`.
  - `[low]` `[patch]` Density tests restated 48/44/56/40/20/12 as literals, contradicting the story's own no-restated-figure rule — replaced with an `overridesFollow(theme, set)` helper reading the tokens, which also covers the previously unasserted `MuiIconButton` and `MuiCheckbox`.
  - `[low]` `[patch]` `Screen` read `theme.density`, which is optional, so a theme not built by `buildTheme` collapsed the layout to `undefinedpx` gutters — falls back to the compact set, tested against a bare `createTheme()`.
  - `[low]` `[patch]` `resolveAddress` accepted an empty or whitespace subject and rendered a headless sentence in Parent View — now throws, tested on both surfaces.
  - `[low]` `[patch]` `AddressSurface` omitted `admin`, though DESIGN.md puts generated content in the Admin console — `'admin'` added, resolving third-person by name.
  - `[medium]` `[patch]` Found while applying the dialog render tests: MUI `Dialog`/`Menu`/`Popover` ship their own paper elevation (Dialog's is 24), which overrode the flat `MuiPaper` default and re-emitted a shadow — `slotProps.paper.elevation = 0` on all three, asserted.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 1: (high 0, medium 0, low 1)
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - `[low]` `[patch]` `resolveAddress` trimmed the subject only to check it was non-empty, so a padded name like `" Ada "` rendered with stray leading/trailing whitespace — the trimmed value is now what's stored and returned.
  - `[low]` `[patch]` `AppDialog` treated an explicit `actions={null}` the same as an omitted prop and rendered an empty `DialogActions` bar — the check now uses `== null`.
  - `[medium]` `[patch]` `AppSnackbar` had no cleanup on unmount, so a screen that removed it while still open (instead of toggling `open` to `false` first) would leave its announcement in the live region for the next screen to inherit — an unmount-only effect now clears it when that happens.
  - `[low]` `[patch]` `MuiSwitch`'s density override was the only tap-target-driven component not covered by the `overridesFollow` density test — added to the existing helper.

### 2026-09-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 4: (high 0, medium 0, low 4)
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[medium]` `[patch]` `baseTheme.typography.body1`/`body2` were remapped from MUI's stock defaults onto `dashboardBody`/`tableCell` with no assertion anywhere, so every shipped 1.1–1.6 screen's variant-less `<Typography>` could regress silently — added to `theme.spec.ts` alongside the other eight named roles.
  - `[medium]` `[patch]` `AppDialog`'s `onClose` (Escape key, backdrop click) fired unconditionally, so a destructive confirmation could be dismissed while its delete was still in flight — `DestructiveConfirmDialog` now ignores `onClose` while `busy`.
  - `[low]` `[patch]` `DestructiveConfirmDialog` accepted an empty or whitespace-only `subject` and rendered a headless "Delete ?" instead of throwing, unlike `resolveAddress`'s handling of the same input — now throws, tested on both surfaces.
  - `[low]` `[patch]` The confirm control's `disabled` state lagged the parent's `busy` prop by one render, so a fast double-click/double-tap could call `onConfirm(password)` twice for one confirmation — a local `firing` flag now closes the gap immediately and releases again once `busy` clears, so a failed delete does not leave the control disabled forever.

## Design Notes

**Density belongs to the theme, not the component.** `buildTheme` currently closes over the compact `density` import. Parameterising it is what makes UX-DR9's "every component reads the density token" true for free — the shipped screens change behaviour on the student surface without any screen being edited:

```ts
function buildTheme(primary: TokenPair, d: DensitySet): Theme { /* … d.tapTarget, d.rowHeight … */ }
export const baseTheme = buildTheme(colorTokens.primaryStudent, density);
export const studentTheme = buildTheme(colorTokens.primaryStudent, comfortableDensity);
export const parentTheme = buildTheme(colorTokens.primaryParent, density);
```

**Tabular figures are a per-role flag, not a global.** DESIGN.md keeps proportional figures in running prose, Question text and Explanations. So the flag rides on the role (`timer`, `tableCell`, `label`, `caption`), and the serif roles deliberately omit it — Literata would otherwise need `tnum` applied explicitly and would get it wrongly.

**Address resolution throws rather than defaults.** A result string rendered with no surface in scope is the exact bug UX-DR31 exists to prevent; a silent second-person default would ship a child's copy into Parent View. `useAddress()` follows the existing `elevation.tsx` precedent, whose spec already asserts an orphaned consumer throws.

## Verification

**Commands:**
- `pnpm install` -- expected: the two font packages and the lint plugin resolve and lock cleanly.
- `pnpm --filter web run typecheck` -- expected: clean, including `<Typography variant="questionBody">` resolving through the augmentation.
- `pnpm --filter web run lint` -- expected: clean, with the jsx-a11y rules active.
- `pnpm --filter web run test` -- expected: all specs pass, including the pre-existing `theme.spec.ts` assertions and every I/O matrix row.
- `pnpm --filter web run build` -- expected: a successful production build with the fonts bundled.
- `pnpm prettier --write .` -- expected: no unformatted files remain.

## Auto Run Result

**Summary of implemented change:** Story 1.7 (Design System Foundation) was already implemented and had passed two prior review passes (`status: done`) before this run. This run performed a fresh, unattended review pass over the same diff (against `baseline_revision`): four parallel review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment) were spawned, their findings triaged, and four resulting `patch` findings were fixed directly in this pass.

**Files changed with one-line descriptions:**
- `apps/web/src/theme/theme.spec.ts` -- added an assertion tying `baseTheme.typography.body1`/`body2` to `typeRoles.dashboardBody`/`typeRoles.tableCell`, closing a verification gap on every shipped screen's default-variant text.
- `apps/web/src/components/Dialog.tsx` -- `DestructiveConfirmDialog` now throws on an empty/whitespace `subject`, ignores `onClose` (Escape/backdrop) while `busy`, and guards against a double-fired `onConfirm` via a local `firing` flag that releases once `busy` clears.
- `apps/web/src/components/Dialog.spec.tsx` -- added coverage for the empty/whitespace-subject throw.
- `_bmad-output/implementation-artifacts/spec-1-7-design-system-foundation.md` -- `status`, `deferred`, and `## Review Triage Log` updated for this pass.

**Review findings breakdown:**
- Patches applied: 4 (medium 2, low 2) -- see the 2026-09-24 triage-log entry above for detail.
- Items deferred: 4 (all low) -- destructive-confirm error-state copy has no slot yet; no Enter-to-submit on the password field; `onConfirm`/busy-interlock/`AppSnackbar` unmount cleanup verified only through extracted pure functions rather than a real click/unmount (blocked on the story's own no-DOM-test-runner constraint); `theme.spec.ts`'s spacing assertion couples to MUI's internal CSS-variable string format.
- Items rejected: 13 -- noise, restatements of already-accepted design constraints (no DOM test runner, `renderToStaticMarkup`-only testing), or findings disproved by running the actual verification commands (e.g. the new jsx-a11y ESLint rules were claimed to risk failing on the new `.spec.tsx` files or on the untouched 1.1–1.6 screens; `pnpm --filter web run lint` ran clean against the whole `src/**/*.tsx` tree, disproving both).

**Follow-up review recommendation:** `true`. This pass's patched findings: medium 2, low 2, high 0 -- score `3*2 + 1*2 = 8`, which is `>= 5`.

**Verification performed:** `pnpm --filter web run typecheck`, `pnpm --filter web run lint`, `pnpm --filter web run test` (229/229 passing), `pnpm --filter web run build`, and `pnpm prettier --write .` all ran clean after the patches above.

**Residual risks:** the four deferred items above, plus the three deferred items already carried from prior passes (address-resolution possessive/pluralisation gap, unmeasured font bundle weight/CLS, lint not wired into any CI gate).

