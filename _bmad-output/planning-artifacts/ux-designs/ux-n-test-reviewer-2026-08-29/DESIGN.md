---
title: n-test-reviewer
status: final
created: 2026-08-29
updated: 2026-09-01
sources:
  - ../../prds/prd-n-test-reviewer-2026-08-29/prd.md
  - ../../prds/prd-n-test-reviewer-2026-08-29/addendum.md
name: Clear Room
description: Cool clinical daylight for a product that turns a returned school test into practice. One palette, one type scale, two densities, two accents. MUI on Next.js + React; this DESIGN.md specifies the theme the app builds.
colors:
  # --- Accent split. The ONLY role that differs between Student Mode and Parent View. ---
  primary-student: '#0F6E78'
  primary-student-dark: '#71C3CE'
  primary-parent: '#0B5FA5'
  primary-parent-dark: '#7FB6E8'
  on-primary: '#FFFFFF'
  on-primary-dark: '#0E1620'
  # --- Everything below is byte-identical across Student Mode, Parent View, and Admin. ---
  secondary: '#4A6072'
  secondary-dark: '#9DB2C4'
  success: '#0F6B4F'
  success-dark: '#6FD1AC'
  error: '#B3261E'
  error-dark: '#F19B94'
  warning: '#8A5A00'
  warning-dark: '#E3B457'
  info: '#2E6E9E'
  info-dark: '#8CC0E4'
  background-default: '#F6F8FA'
  background-default-dark: '#0E1620'
  background-paper: '#FFFFFF'
  background-paper-dark: '#16202C'
  text-primary: '#10202E'
  text-primary-dark: '#E7EEF5'
  text-secondary: '#4E6070'
  text-secondary-dark: '#A3B3C2'
  # divider carries the ENTIRE boundary of every control, because shadows are banned
  # and the paper->default step is only 1.06:1. It is therefore a non-text-contrast
  # surface under SC 1.4.11 and is specified at >=3:1 against both grounds, in both modes.
  divider: '#7C8894'
  divider-dark: '#6A747E'
  # Inverted surfaces are a DECLARED EXCEPTION, used only for the camera viewfinder
  # chrome. They take neither the light nor the dark palette but the on-inverted set.
  # An inverted surface is dark in BOTH light and dark mode, so it must not track
  # either mode's palette. Each of the three carries a machine-visible
  # deliberateDuplicate marker: the value is knowingly equal to another token and
  # must NEVER be aliased, collapsed, or deduplicated by a tidying pass.
  background-inverted: '#10202E'
  background-inverted-deliberateDuplicate: 'equals light text-primary #10202E — never alias, collapse, or deduplicate'
  primary-on-inverted: '#7FB6E8'
  primary-on-inverted-deliberateDuplicate: 'equals primary-parent-dark #7FB6E8 — never alias, collapse, or deduplicate'
  divider-on-inverted: '#6A747E'
  divider-on-inverted-deliberateDuplicate: 'equals divider-dark #6A747E — never alias, collapse, or deduplicate'
state:
  # Both tints are a step toward background-default. Neither ever uses the accent,
  # and neither is ever the sole carrier of meaning — a tint only reinforces a state
  # that is already carried by glyph and by word.
  tintSelected: '#E8F1F2'
  tintSelectedDark: '#0D2A33'
  tintHover: '#EEF3F5'
  tintHoverDark: '#1C2836'
typography:
  # Family assignment is by CONTENT vs CHROME, never by surface.
  # Root font-size 16px. Both families self-hosted; fallback stacks are required.
  serif-stack:
    fontFamily: "'Literata', Georgia, 'Iowan Old Style', 'Times New Roman', serif"
  sans-stack:
    fontFamily: "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  question-body:
    fontFamily: '{typography.serif-stack.fontFamily}'
    fontSize: 1.375rem   # 22px
    fontWeight: '400'
    lineHeight: '1.60'
  explanation-body:
    fontFamily: '{typography.serif-stack.fontFamily}'
    fontSize: 1.1875rem  # 19px
    fontWeight: '400'
    lineHeight: '1.65'
  card-title:
    fontFamily: '{typography.sans-stack.fontFamily}'
    fontSize: 1.25rem    # 20px
    fontWeight: '600'
    lineHeight: '1.35'
  dashboard-body:
    fontFamily: '{typography.sans-stack.fontFamily}'
    fontSize: 1.0625rem  # 17px
    fontWeight: '400'
    lineHeight: '1.55'
  table-cell:
    fontFamily: '{typography.sans-stack.fontFamily}'
    fontSize: 1rem       # 16px
    fontWeight: '400'
    lineHeight: '1.45'
  label:
    fontFamily: '{typography.sans-stack.fontFamily}'
    fontSize: 0.875rem   # 14px
    fontWeight: '600'
    lineHeight: '1.40'
    letterSpacing: 0.02em
  caption:
    fontFamily: '{typography.sans-stack.fontFamily}'
    fontSize: 0.8125rem  # 13px
    fontWeight: '400'
    lineHeight: '1.40'
  timer:
    fontFamily: '{typography.sans-stack.fontFamily}'
    fontSize: 1.75rem    # 28px
    fontWeight: '600'
    lineHeight: '1.20'
    fontVariantNumeric: 'tabular-nums'
  measure:
    questionMaxWidth: 34rem
rounded:
  # Radius is semantic: it encodes IS-THIS-PAPER-OR-A-CONTROL.
  paper: 2px
  control: 8px
  none: 0px
spacing:
  base: 8px
  '1': 8px
  '2': 16px
  '3': 24px
  '4': 32px
  '5': 40px
  density:
    comfortable:   # Student Mode
      row-height: 56px
      card-padding: 20px
      gap: 16px
      section-margin: 32px
    compact:       # Parent View and Admin
      row-height: 40px
      card-padding: 12px
      gap: 8px
      section-margin: 20px
  tap-target:
    # Pinned SEPARATELY from density. A floor density must never reduce.
    student: 48px
    parent: 44px
  border-width: 1px
  focus-ring-width: 2px
  focus-ring-offset: 2px
components:
  focus-ring:
    # The one non-shadow focus carrier. Applies to every focusable control on every surface.
    width: '{spacing.focus-ring-width}'
    offset: '{spacing.focus-ring-offset}'
    style: 'solid outline'
    color: '{colors.primary-student}'   # nested ThemeProvider swaps to primary-parent in Parent View and Admin
    colorDark: '{colors.primary-student-dark}'
    evaluatedAgainst: 'the surface BEHIND the control, never the control fill'
    minContrast: '3:1'
  hover-state:
    background: '{state.tintHover}'
    backgroundDark: '{state.tintHoverDark}'
    border: '1px solid {colors.divider}'
    elevation: 0
    note: 'Hover is a ground tint only. Never the accent, never a shadow, never a size change.'
  practice-test-card:
    role: control
    radius: '{rounded.control}'
    background: '{colors.background-paper}'
    border: '1px solid {colors.divider}'
    padding: '{spacing.density.comfortable.card-padding}'
    minTapTarget: '{spacing.tap-target.student}'
    titleType: '{typography.card-title}'
    metaType: '{typography.caption}'
    elevation: 0
  question-container:
    role: paper
    radius: '{rounded.paper}'
    background: '{colors.background-paper}'
    border: '1px solid {colors.divider}'
    bodyType: '{typography.question-body}'
    maxWidth: '{typography.measure.questionMaxWidth}'
    elevation: 0
  explanation-panel:
    role: paper
    radius: '{rounded.paper}'
    background: '{colors.background-paper}'
    border: '1px solid {colors.divider}'
    bodyType: '{typography.explanation-body}'
    elevation: 0
    # Suppressed state (FR-39). Follows the expired-Page-Image precedent: designed
    # behavior, so it takes a flat neutral fill and NEVER an error color. The message
    # is product voice rather than generated content, so it is set in the sans
    # dashboard face, not in the Literata explanation face beside it.
    suppressedFill: '{colors.background-default}'
    suppressedFillDark: '{colors.background-default-dark}'
    suppressedType: '{typography.dashboard-body}'
    suppressedTextColor: '{colors.text-primary}'
    suppressedTextColorDark: '{colors.text-primary-dark}'
  grade-state-marker:
    # FOUR redundant carriers. Color is the fourth, and is never load-bearing on its own.
    # Correct and incorrect deliberately share a frame shape and differ on every other axis.
    correct:
      frame: 'solid circle, 1px solid border'
      glyph: 'check'
      label: 'Correct'
      leftRule: 'solid'
      color: '{colors.success}'
      colorDark: '{colors.success-dark}'
    incorrect:
      frame: 'solid circle, 1px solid border'
      glyph: 'cross'
      label: 'Not correct'
      leftRule: '45-degree hatch'
      color: '{colors.error}'
      colorDark: '{colors.error-dark}'
    unanswered:
      frame: 'dashed circle, 1px dashed border'
      glyph: 'dash'
      label: 'Unanswered'
      leftRule: 'dashed'
      color: '{colors.text-secondary}'
      colorDark: '{colors.text-secondary-dark}'
    ungraded:
      frame: 'dotted square, 1px dotted border'
      glyph: 'ellipsis'
      label: 'Not graded yet'
      leftRule: 'dotted'
      color: '{colors.info}'
      colorDark: '{colors.info-dark}'
    leftRuleWidth: '4px'
    labelType: '{typography.label}'
  weak-area-marker:
    frame: 'solid triangle, 1px solid border'
    glyph: 'exclamation'
    label: 'Weak Area'
    color: '{colors.warning}'
    colorDark: '{colors.warning-dark}'
    labelType: '{typography.label}'
  answer-key-row:
    role: paper
    radius: '{rounded.paper}'
    border: '1px solid {colors.divider}'
    borderLeft: '{components.grade-state-marker.leftRuleWidth} textured, per grade state'
    bodyType: '{typography.question-body}'
    stateMarker: '{components.grade-state-marker}'
  question-map-cell:
    role: control
    radius: '{rounded.control}'
    minTapTarget: '{spacing.tap-target.student}'
    border: '1px solid {colors.divider}'
    labelType: '{typography.label}'
    answeredGlyph: 'filled'
    unansweredGlyph: 'hollow'
    answeredBackground: '{state.tintSelected}'
    answeredBackgroundDark: '{state.tintSelectedDark}'
  mastery-row:
    role: control
    height: '{spacing.density.compact.row-height}'
    border-bottom: '1px solid {colors.divider}'
    cellType: '{typography.table-cell}'
    percentNumerals: 'tabular-nums'
    barTrack: '{colors.divider}'
    barFillOk: '{colors.success}'
    barFillWeak: '{colors.warning}'
    weakMarker: '{components.weak-area-marker}'
  sparkline:
    role: control
    strokeWidth: '2px'
    stroke: '{colors.secondary}'
    strokeDark: '{colors.secondary-dark}'
    pointMarker: '2px filled dot at every plotted Attempt'
    baseline: '1px solid {colors.divider}'
    height: '40px'
    minWidth: '120px'
    fill: none
    animation: none
    valueType: '{typography.caption}'
    numerals: 'tabular-nums'
  text-field:
    role: control
    radius: '{rounded.control}'
    background: '{colors.background-paper}'
    border: '1px solid {colors.divider}'
    focus: '{components.focus-ring}'
    minTapTarget: '{spacing.tap-target.student}'
    textType: '{typography.question-body}'
    elevation: 0
  smart-fraction-field:
    role: control
    extends: '{components.text-field}'
    inputElement: 'a real text input; its value is always the raw typed string'
    renderSibling: 'adjacent, not overlaid; presentational only; hidden from assistive technology'
    renderType: '{typography.question-body}'
    degradesTo: 'plain text'
  page-thumbnail:
    role: control
    radius: '{rounded.control}'
    border: '1px solid {colors.divider}'
    minTapTarget: '{spacing.tap-target.parent}'
    ordinalType: '{typography.label}'
    expiredFill: '{colors.background-default}'
    expiredFillDark: '{colors.background-default-dark}'
    expiredLabelType: '{typography.caption}'
  button-primary:
    role: control
    radius: '{rounded.control}'
    background: '{colors.primary-student}'   # nested ThemeProvider swaps to primary-parent in Parent View
    foreground: '{colors.on-primary}'
    border: 'none'
    focus: '{components.focus-ring}'
    elevation: 0
  button-destructive:
    role: control
    radius: '{rounded.control}'
    background: '{colors.background-paper}'
    foreground: '{colors.error}'
    foregroundDark: '{colors.error-dark}'
    border: '1px solid {colors.error}'
    focus: '{components.focus-ring}'
    elevation: 0
  dialog:
    role: control
    radius: '{rounded.control}'
    background: '{colors.background-paper}'
    border: '1px solid {colors.divider}'
    elevation: 0
    scrim: 'rgba(16,32,46,0.55)'
    scrimDark: 'rgba(4,8,12,0.65)'
  destructive-dialog:
    role: control
    extends: '{components.dialog}'
    titleType: '{typography.card-title}'
    bodyType: '{typography.dashboard-body}'
    confirmControl: '{components.button-destructive}'
    reauthField: '{components.text-field}'
    note: 'Names what is destroyed, states it cannot be undone, and takes the account password.'
  snackbar:
    role: control
    radius: '{rounded.control}'
    background: '{colors.background-paper}'
    border: '1px solid {colors.divider}'
    elevation: 0
  timer-display:
    type: '{typography.timer}'
    numerals: 'tabular-nums'
    animation: none
    warningColor: '{colors.warning}'
    warningColorDark: '{colors.warning-dark}'
    warningCarrier: 'a text label beside the value, not color and not motion'
---

# n-test-reviewer — Clear Room

Reference mocks and exploration artifacts are catalogued in `EXPERIENCE.md` §Foundation, which owns their provenance and precedence. Mocks are linked inline below from the sections they illustrate.

## Brand & Style

Clear Room is cool clinical daylight. The product takes a returned school test — a thing that arrives home covered in red pen — and turns it into practice. Its job is to be accurate and calm, so the visual system has almost no opinion of its own: neutral grounds, a single accent, flat bordered surfaces, and one serif reserved for the only thing a user actually reads slowly.

The governing metaphor is **paper**. A generated Question should read like a question on a real test, because the product thesis is *no surprises on test day*. The metaphor is enforced structurally, not decoratively: square corners and a serif mark test content; rounded corners and a sans mark interface. Nothing is textured, skeuomorphic, or nostalgic about it.

The anti-reference is gamified ed-tech. No streaks, badges, mascots, points, or confetti — none of it in v0 and none of it as an aesthetic residue either. **The score appears; it does not perform.**

Two rooms, one building. Student Mode is calm and low-stakes. Parent View is dense and factual. Crossing the Parent PIN should feel like entering a different room in the same house — carried by **accent hue and spacing density**. Everything else is identical, deliberately: identical neutrals, identical semantic colors, identical type scale. The split is small on purpose so it stays enforceable.

Admin inherits the whole theme and receives no craft beyond it (see Dos and don'ts).

## Colors

Clear Room is one palette with one divergent role.

**The accent split.** `primary` is the only token that differs between surfaces.

| Role | Student Mode | Parent View | Admin |
|---|---|---|---|
| Light | `{colors.primary-student}` `#0F6E78` calm teal | `{colors.primary-parent}` `#0B5FA5` clinical blue | Parent value |
| Dark | `{colors.primary-student-dark}` `#71C3CE` | `{colors.primary-parent-dark}` `#7FB6E8` | Parent value |
| On-primary | `{colors.on-primary}` `#FFFFFF` | `{colors.on-primary}` `#FFFFFF` | `#FFFFFF` |
| On-primary (dark) | `{colors.on-primary-dark}` `#0E1620` | `{colors.on-primary-dark}` `#0E1620` | `#0E1620` |

**Implementation is one base MUI theme plus a nested `ThemeProvider` that overrides `palette.primary` only.** Not two themes. Not a fourth accent for Admin. If a second token ever needs to diverge, that is a design change, not an implementation detail.

**Everything else is byte-identical across both surfaces, in both modes.**

| Role | Light | Dark | Meaning |
|---|---|---|---|
| `secondary` | `#4A6072` | `#9DB2C4` | Muted chrome, non-primary controls, the trend sparkline stroke |
| `success` | `#0F6B4F` | `#6FD1AC` | **Correct** grade state only |
| `error` | `#B3261E` | `#F19B94` | **Not correct** grade state, destructive confirm |
| `warning` | `#8A5A00` | `#E3B457` | **Weak Area** flag, legibility warning, pre-expiry timer warning |
| `info` | `#2E6E9E` | `#8CC0E4` | **Not graded yet** grade state, neutral informational notices |
| `background-default` | `#F6F8FA` | `#0E1620` | The room behind the paper |
| `background-paper` | `#FFFFFF` | `#16202C` | Cards, rows, question containers, dialogs |
| `text-primary` | `#10202E` | `#E7EEF5` | Question text, headings, values |
| `text-secondary` | `#4E6070` | `#A3B3C2` | Meta, captions, **Unanswered** grade state |
| `divider` | `#7C8894` | `#6A747E` | Every border in the product |
| `state.tintHover` | `#EEF3F5` | `#1C2836` | Hover ground, one step toward `background-default` |
| `state.tintSelected` | `#E8F1F2` | `#0D2A33` | Selected-or-answered ground; first consumer is the answered question-map cell |

**The two tints are the only sanctioned surface tints, and both are reinforcement only.** `{state.tintHover}` is the canonical hover ground and **supersedes the earlier `hover-tint` `#EDF1F5` / `#121B25`**, which is retired; `{state.tintSelected}` is the sanctioned treatment for a selected or answered control, so no component ever invents a hex value for that state. Neither tint is ever the sole carrier of meaning — the answered map cell already states answered by glyph and by word, and removing both tints entirely must leave every state fully readable.

Dark mode ships in v0. It is an addition beyond PRD §9.1, logged as a departure in `EXPERIENCE.md`. Every pair above is verified in both modes.

**Measured contrast ratios.** This is the single container for every measured pair in the product; no ratio is restated elsewhere in this file.

| Pair | Light | Dark |
|---|---|---|
| `question-body` text on `background-paper` | 16.56:1 | 14.05:1 |
| `success` on `background-paper` | 6.49:1 | 8.92:1 |
| `error` on `background-paper` | 6.54:1 | 7.72:1 |
| `warning` on `background-paper` | 5.93:1 | 8.56:1 |
| `info` on `background-paper` | 5.47:1 | 8.44:1 |
| `text-secondary` on `background-paper` | 6.50:1 | 7.66:1 |
| `text-primary` on `state.tintHover` | 14.81:1 | 12.76:1 |
| `text-primary` on `state.tintSelected` | 14.43:1 | 12.85:1 |
| `divider` on `background-paper` | **3.62:1** | **3.45:1** |
| `divider` on `background-default` | **3.40:1** | **3.82:1** |
| `divider` on `state.tintHover` | **3.23:1** | **3.14:1** |
| `divider` on `state.tintSelected` | **3.15:1** | **3.16:1** |
| `primary-student` on `background-paper` | 5.96:1 | 8.14:1 |
| `primary-student` on `background-default` | 5.60:1 | 9.01:1 |
| `primary-parent` on `background-paper` | 6.57:1 | 7.64:1 |
| `primary-parent` on `background-default` | 6.18:1 | 8.45:1 |
| `primary-on-inverted` on `background-inverted` | **7.70:1** | n/a — one ground only |
| `divider-on-inverted` on `background-inverted` | **3.48:1** | n/a — one ground only |
| `background-default` → `background-paper` step | 1.06:1 | 1.06:1 |
| Rejected: light `primary-parent` on `background-inverted` | 2.52:1 — fails SC 1.4.11 | n/a |
| Rejected: previous `divider` `#DCE3E9` / `#26333F` on `background-paper` | 1.30:1 — failed | 1.27:1 — failed |
| Retired: `divider` on the superseded `hover-tint` `#EDF1F5` / `#121B25` | 3.19:1 | 3.65:1 |

Question body on paper clears AAA in both modes, kept because it fell out for free.

**Both hover grounds clear the SC 1.4.11 floor at the new tint values**, so the tint change cost the divider nothing: `divider` measures **3.23:1** on `{state.tintHover}` light and **3.14:1** on `{state.tintHoverDark}`, against 3.19:1 and 3.65:1 on the retired ground. No tint value was adjusted to get there. **One pair did not clear it and has been settled:** `divider-dark` on the earlier `{state.tintSelectedDark}` value measured 2.88:1, so the answered question-map cell's border fell below 3:1 in dark mode only. By the rule above it was settled by moving the tint, never the divider: `{state.tintSelectedDark}` is now `#0D2A33`, on which `divider-dark` measures **3.16:1**. Resolved.

**`divider` is a non-text-contrast surface, not a decorative rule.** Because shadows are banned and the `background-default` → `background-paper` step is only a reading cue, the 1px divider border is the *entire* boundary of every control in the product — cards, map cells, thumbnails, dialogs, snackbars, icon buttons, the PIN field. WCAG 2.1 SC 1.4.11 therefore applies to it at 3:1; the previous token failed and was darkened to the current values. See the ratios table for the measured pairs, including the hover ground, where the boundary still holds. Flat-with-borders is unchanged — only the token moved. There is deliberately **no second, weaker divider token**: a two-tier divider would reintroduce per-component judgment about which boundary is "real", which is exactly the failure mode this repair closes. (`divider-on-inverted`, below, is a different ground — not a weaker tier.)

**Inverted surfaces are a declared exception, and they take the on-inverted token set.** The camera viewfinder chrome in the capture flow is the *only* inverted surface in the product: a dark ground inside the light theme, not a dark-mode screen. Its ground is declared as its own surface token, `{colors.background-inverted}` `#10202E` — the same value as light-mode `text-primary`, but named separately so the chrome is not an undeclared surface borrowing a text role. The light `primary` would itself fail SC 1.4.11 on that ground (see the ratios table), so inverted surfaces take neither the light nor the dark palette: they take `{colors.primary-on-inverted}` and `{colors.divider-on-inverted}`.

`{colors.primary-on-inverted}` on camera chrome is therefore **not** dark-mode leakage and must not be "corrected" back to the light `primary` — that swap reintroduces the contrast failure. The exception is closed: no surface other than camera chrome may claim the on-inverted set, and camera chrome uses nothing else.

**Focus and hover have values, because a system that bans shadows has nothing else.**

- **Focus ring:** a `{spacing.focus-ring-width}` 2px solid outline in the *surface's* `primary`, at `{spacing.focus-ring-offset}` 2px offset. The offset is load-bearing, not cosmetic — a `primary` ring directly on a `primary`-filled button is 1:1 against the fill, so the ring is **always evaluated against the surface behind the control**. Measured pairs are in the ratios table.
- **Hover:** `{state.tintHover}` light, `{state.tintHoverDark}` dark — one step toward `background-default`, never the accent.
- **Selected or answered:** `{state.tintSelected}` light, `{state.tintSelectedDark}` dark — the same one-step move, applied to a control that holds a state rather than one under the pointer. Reinforcement only: the state is already carried by glyph and by word, so the tint never carries it alone.

**Color is never the only carrier of meaning.** All four grade states and every Weak Area flag carry non-color redundancy specified per state in Components. Removing color entirely must leave every state fully readable.

**`warning` does not do double duty as a grade state.** It marks Weak Areas, the legibility warning, and the pre-expiry timer warning — all of which mean *look at this*. `Not graded yet` means nothing of the kind: it is a neutral, transient, system-side fact about the app, not a finding about the student, so it takes `info`. An earlier revision of the reference mock painted unanswered as `warning`; that mapping is superseded — **this file is the single source of truth** and the normative mapping is the one in Components. [`mockups/key-results.html`](mockups/key-results.html) and [`mockups/key-analytics.html`](mockups/key-analytics.html) are repainted to match.

Not used: gradients, tinted surfaces beyond `{state.tintHover}` and `{state.tintSelected}`, brand color as decoration, any hue outside this table. The accent means *interactive*; semantic colors mean *state*; nothing means *personality*.

## Typography

Two families, split by job — **content versus chrome**, never by surface.

- **Literata** (serif) sets everything a user reads carefully: Question content and Explanations. Drawn for extended screen reading, and it ships native OpenType `frac`, which the typographic-fraction rule requires.
- **Source Sans 3** (sans) sets all chrome: navigation, buttons, labels, cards, dashboards, tables, Admin.

The serif **crosses the Parent PIN**. Wherever generated Question or Explanation content appears — parent draft review, the Topic drill-down's missed questions, the parent-side Explanation reader, the flagged-Explanation queue in Admin — it is Literata. Family follows the content, not the room.

**One scale across both rooms.** Same ramp, same steps, same sizes in Student Mode and Parent View. Density divergence is carried entirely by spacing. The scale is therefore sized for the harder case — a 10-year-old reading a tablet at arm's length — and the parent dashboard earns its density through tighter spacing and more information per row, never smaller text.

| Role | Family | Size | Line height | Weight | Used for |
|---|---|---|---|---|---|
| `question-body` | Literata | 22px / 1.375rem | 1.60 | 400 | Question text, test surface and answer key |
| `explanation-body` | Literata | 19px / 1.1875rem | 1.65 | 400 | Explanation panel |
| `card-title` | Source Sans 3 | 20px / 1.25rem | 1.35 | 600 | Practice Test card title, screen headings |
| `dashboard-body` | Source Sans 3 | 17px / 1.0625rem | 1.55 | 400 | Parent View body copy |
| `table-cell` | Source Sans 3 | 16px / 1rem | 1.45 | 400 | Mastery table, Admin tables |
| `label` | Source Sans 3 | 14px / 0.875rem | 1.40 | 600, +0.02em | Field labels, state chips, grade-state labels |
| `caption` | Source Sans 3 | 13px / 0.8125rem | 1.40 | 400 | Card meta, counts, timestamps |
| `timer` | Source Sans 3 | 28px / 1.75rem | 1.20 | 600, `tnum` | Countdown timer |

**Measure.** Question content is capped at `{typography.measure.questionMaxWidth}` (34rem) regardless of viewport. On a tablet this leaves real unused width, which is a layout decision, not a bug — see Layout & Spacing.

**Tabular figures, applied selectively.** `font-variant-numeric: tabular-nums` on any number that aligns in a column or ticks in place: the countdown timer, the Mastery percentage column, score displays (`11/15`), Admin per-account consumption counts, allowance usage (`2 of 2`), sparkline value readouts. Proportional figures are retained in running prose, Question text, and Explanations.

- **Literata** defaults to proportional figures — `tnum` must be applied **explicitly** wherever tabular is required.
- **Source Sans 3** has tabular figures by default; no feature flag needed, but declaring `tnum` is harmless and keeps the rule uniform.

**Fractions render typographically**, never as plain `1/2`. Literata's native `frac` is the mechanism for *generated content* — Question text, answer keys, Explanations. This has consequences past typography: generation must emit fractions in a structured, renderable form rather than free text, and answer-key and Explanation rendering must consume that form. **Student answer input is a different mechanism and must not be conflated with it:** the input is a real text field whose value is always the raw typed string, with the typographic render in an adjacent presentational sibling — see `{components.smart-fraction-field}` — degrading to plain text if rendering fails.

Both families are self-hosted with the fallback stacks declared in `{typography.serif-stack}` / `{typography.sans-stack}`.

## Layout & Spacing

MUI's 8px base. Components read a **density token**, never a raw spacing number.

| Token | `density.comfortable` (Student Mode) | `density.compact` (Parent View, Admin) |
|---|---|---|
| `row-height` | 56px | 40px |
| `card-padding` | 20px | 12px |
| `gap` | 16px | 8px |
| `section-margin` | 32px | 20px |

**The density split is tokenized because a token is reviewable and a convention erodes.** A component that reads `{spacing.density.compact.row-height}` declares which room it belongs to in a line a reviewer can check; a component carrying `40` declares nothing and drifts silently on the next edit. Enforceability is the whole justification — spacing is not the only thing that differs between the rooms.

**Tap-target minimums are pinned separately from the density token and are a floor `density.compact` must never reduce.**

| Surface | Minimum |
|---|---|
| Student Mode | `{spacing.tap-target.student}` 48px — a 10-year-old aims worse than an adult |
| Parent View / Admin | `{spacing.tap-target.parent}` 44px |

The device tension resolves in favor of this split rather than against it: a tablet has spare room, so comfortable is free; a small phone screen is precisely why a parent needs more rows visible, so compact-on-phone is correct.

**Density is split by surface; breakpoint is independent.** Either surface can appear on either device. Density tokens must never be conflated with breakpoints.

**Breakpoint-specific layouts only where the device changes the task.** Most screens are one fluid layout per surface. Two screens get a genuine second layout — the test-taking screen (where the 34rem measure leaves tablet width to allocate) and the Analytics dashboard. Desktop is supported but not optimized: the fluid layouts must not break there, and no desktop-specific work is in v0.

## Elevation & Depth

**Flat with borders. No drop shadows anywhere in the product. The MUI elevation ramp is not used.**

Separation is carried by exactly two devices:

1. A **1px border** in `{colors.divider}`, at ≥3:1 against both grounds in both modes. See Colors.
2. The **`background-default` → `background-paper` step**, which is a *reading* cue only and never carries a boundary on its own. See Colors.

Rationale: flat-with-borders behaves identically in light and dark. Shadows barely register on a dark ground, and MUI's lighten-on-elevation workaround would make depth mean different things per mode. A flat bordered surface also matches the paper metaphor the radius rule establishes.

Consequences, all binding:

- `Paper`, `Card`, `Dialog`, `Menu`, `Popover`, and `Snackbar` defaults are overridden to `elevation={0}` with an explicit `1px solid {colors.divider}` border.
- **Because the border is the only boundary, the divider token is held to SC 1.4.11's 3:1**, not to a decorative standard. See Colors.
- **Focus and hover are carried by outline and ground tint — never by shadow:** `{components.focus-ring}` and `{components.hover-state}`. See Colors.
- **The inverted camera chrome is still flat-with-borders, but on the on-inverted tokens** — `{colors.background-inverted}`, `{colors.divider-on-inverted}`, `{colors.primary-on-inverted}` — and takes neither the light nor the dark `divider`. See Colors.
- **Overlay surfaces need a non-shadow separation strategy: scrim plus border.** Dialogs, menus, and the Parent PIN entry sit on a scrim (`rgba(16,32,46,0.55)` light / `rgba(4,8,12,0.65)` dark) and carry their own divider border. Nothing floats; things are separated by an edge and a darkened ground.

## Shapes

**Radius is semantic. It encodes IS-THIS-PAPER-OR-A-CONTROL.**

| Role | Radius | Meaning |
|---|---|---|
| **Paper** | `{rounded.paper}` 0–2px, square | This is test content — a Question or an Explanation |
| **Control** | `{rounded.control}` 8px, rounded | This is tappable interface chrome |

**Paper role** (square) is anything carrying generated Question or Explanation content — on the test surface, in results, in draft review, and in the parent drill-down and Explanation reader. **Control role** (rounded) is everything tappable. Each component's role is declared in its Components entry; that is where the per-component assignment lives.

**Every new component must be classified paper or control before it gets a radius.** Risk to guard at review: applied inconsistently, the rule reads as sloppiness rather than as meaning. There is no third *box* radius and no pill shape.

**Scoped exception, stated so it is not read as drift:** iconography is not boxwork. Grade-state icon frames, radio marks, and the Weak Area marker are circles, a triangle, and a square by specification — those shapes are *the non-color carrier of state* (see Components) and are exempt from the paper/control rule. The exemption covers glyph frames only; no container, card, row, field, or button may take a circular or pill shape.

## Components

Visual specs only; behavior lives in `EXPERIENCE.md`. Each entry reads **role → surface → visual spec → binding exception**.

**Practice Test card** — control role, Student Home. `{rounded.control}`, `{colors.background-paper}` on a 1px `{colors.divider}` border, no shadow, `{spacing.density.comfortable.card-padding}`, minimum 48px tap target. Title in `{typography.card-title}`; Subject, Grade Level, question count, timer presence and duration, state, and score in `{typography.caption}`. State is a text chip — never a colored dot alone. **Exception — the retaken state is the densest thing this card ever carries:** first score, latest score, and Attempt count on one line, `First 11/15 · Latest 14/15 · 3 attempts`, staying in `{typography.caption}` with `tnum`, on one meta line, set as **fact rather than as a scoreboard** — no size step, no accent, no emphasis on either number beyond the short literal marking the first as the counted one. Student Mode is deliberately calm and this state must not break that.

**Question container** — paper role, test surface. `{rounded.paper}`, `{typography.question-body}` capped at 34rem, flat on `{colors.background-paper}` with a divider border.

**Grade-state marker** — state encoding, referenced wherever a grade appears: results answer key, parent drill-down, per-Attempt detail, draft review of a completed Attempt. **Four redundant carriers per state.** Color is the fourth and is never load-bearing alone; correct and incorrect deliberately share a frame shape and separate on every other axis, so a shape-only reading still distinguishes them.

| State | Icon frame + border | Glyph | Text label | Row left-rule | Color |
|---|---|---|---|---|---|
| **Correct** | solid circle, 1px solid | check | `Correct` | solid | `{colors.success}` |
| **Incorrect** | solid circle, 1px solid | cross | `Not correct` | 45° hatch | `{colors.error}` |
| **Unanswered** | dashed circle, 1px dashed | dash | `Unanswered` | dashed | `{colors.text-secondary}` |
| **Ungraded** | dotted square, 1px dotted | ellipsis | `Not graded yet` | dotted | `{colors.info}` |

**`{components.grade-state-marker.*.label}` is the single source for these four labels.** This table renders that token; every other site in either spine references the token rather than retyping the string. The labels are literal and normative — `Not correct`, not "Wrong" and not "Incorrect"; `Unanswered`, not "Not answered". The label is simultaneously a visible non-color carrier and the screen-reader announcement, so the two can never diverge. Left-rule width `4px`; labels in `{typography.label}`. All four states are drawn in [`mockups/key-results.html`](mockups/key-results.html), which also shows the results structure and the degraded-grading case.

**Weak Area marker** — state encoding, Analytics. Solid triangle frame, exclamation glyph, literal label `Weak Area`, `{colors.warning}`, label in `{typography.label}`. Exception: it is deliberately distinct in shape and glyph from every grade state, because it appears on the same parent screens as grade data.

**Answer-key row** — paper role; results, drill-down, draft review. Square, divider-bordered, with the textured left rule from `{components.grade-state-marker}`. Carries the student's answer, the correct answer, and the grade state as **icon frame + glyph + text label + left rule + color**.

**Explanation panel** — paper role, inline beneath its answer-key row. Square, body in `{typography.explanation-body}`. Contains its own loading, error, at-cap, and **suppressed** states, plus the flag affordances. The inline expand and the first three of those states are drawn in [`mockups/key-results.html`](mockups/key-results.html); the suppressed state is not yet drawn in any mock. **Exception — the suppressed state (FR-39) is designed behavior, not a failure:** a flat `{components.explanation-panel.suppressedFill}` region carrying the removal statement in `{components.explanation-panel.suppressedType}` at `{components.explanation-panel.suppressedTextColor}`, with **no `{colors.error}` anywhere**, no error or warning glyph, no retry control, and no grade-state icon frame borrowed from `{components.grade-state-marker}`. It reads like the expired Page Image tile and for the same reason — a person decided this, nothing broke. **Second exception, and the reason the type token differs from the panel's own body face:** the removal statement is product voice, so it is set in the sans dashboard face, while everything else this panel ever holds is generated content in Literata. The face is the reader's cue that the app is speaking, not the explanation.

**Question map cell** — control role, test surface. `{rounded.control}`, minimum 48px under `density.comfortable`, divider border. Answered is a **filled** glyph plus the word; unanswered is a **hollow** glyph plus the word. Exception: never fill alone, never color alone. Drawn in [`mockups/key-take-test.html`](mockups/key-take-test.html) alongside the test-taking surface and the submit-with-gaps confirmation.

**Mastery row** — control role, Analytics. `{spacing.density.compact.row-height}` 40px, divider-bottom, no shadow. Topic name in `{typography.table-cell}`; percentage in tabular figures; inline bar with `{colors.divider}` track, `{colors.success}` fill above threshold and `{colors.warning}` fill for a Weak Area; the Weak Area marker is `{components.weak-area-marker}`. The ranked table, the Topic drill-down, the weighted-regenerate cost block, the empty state, and the tablet layout are drawn in [`mockups/key-analytics.html`](mockups/key-analytics.html).

**Trend sparkline** — control role, Analytics dashboard level. 2px `{colors.secondary}` stroke on a 1px `{colors.divider}` baseline, 40px tall, 120px minimum width, no fill, no gradient, **no draw-in animation**. Every plotted Attempt carries a 2px filled dot so the point count is countable rather than inferred from line length; the endpoint value is printed in `{typography.caption}` with tabular figures. Exception: one line only — there are no per-Topic sparklines.

**Text field** — control role, every surface. `{rounded.control}`, divider border, `{components.focus-ring}` on focus, minimum 48px in Student Mode. Question-surface fields are set in `{typography.question-body}`.

**Smart fraction field** — control role, Fill-in-the-Blank. Extends the text field: a **real text input** whose value is always the raw typed string, with the typographic render in an **adjacent presentational sibling**, not overlaid on the input, and hidden from assistive technology. Rendering never moves the caret, never blocks a non-fraction answer, and degrades to plain text on failure. Built and confirmed in [`mockups/key-take-test.html`](mockups/key-take-test.html), where the input is a real labeled `<input>` and the stacked render is its `aria-hidden` sibling. **Exception — treat this as a component with real implementation risk, not a styling detail:** holding the render aligned with the input's text across font loading, zoom, text scaling, and variable-width digits is difficult to keep reliable, and if alignment proves unreliable the fallback is display-only typographic fractions with a plain input, never a numerator/denominator widget. The behavioral spec is owned by `EXPERIENCE.md` §Accessibility Floor hard case 1.

**Page thumbnail** — control role; capture strip, Source Test detail. `{rounded.control}`, divider border, minimum 44px target, ordinal number visible in `{typography.label}`. **Exception — expired state:** a flat `{colors.background-default}` tile with the literal caption `Photo deleted` in `{typography.caption}`, never a broken-image glyph and never an error color, since expiry is designed behavior.

Continuous capture, page management, the batch legibility check, the generate step, and generation progress are drawn in [`mockups/key-capture.html`](mockups/key-capture.html).

**Primary button** — control role, every surface. Filled with the *surface's* primary, `{colors.on-primary}` text, no border, no shadow, `{components.focus-ring}` at 2px offset. Exception: the offset exists so the ring never sits on the fill.

**Destructive button** — control role, destructive confirmations. `{colors.background-paper}` ground with an `{colors.error}` border and `{colors.error}` label. Exception: destructive intent is carried by the label text first and the color second.

**Destructive-confirm dialog** — control role, destructive confirmations. Extends the dialog: title in `{typography.card-title}`, body in `{typography.dashboard-body}` naming exactly what is destroyed, a `{components.text-field}` for account-password re-authentication, and a `{components.button-destructive}` confirm. Exception: the cancel action is the visually quieter of the two but never smaller than the tap-target floor.

**Timer display** — chrome, test surface. `{typography.timer}` with tabular figures. **It changes value in place; it does not animate per tick.** No pulsing, no progress ring sweep. **Exception — at the pre-expiry warning thresholds** the value takes `{colors.warning}` **and** gains a literal text label beside it; the color alone never signals the warning, and neither does motion. Every timer state, the pre-expiry warning included, is drawn in [`mockups/key-take-test.html`](mockups/key-take-test.html).

**Dialogs / snackbars** — control role, every surface. Flat, bordered, scrim-separated.

## Dos and don'ts

The third column links to the section that carries the rationale.

| Do | Don't | Rationale |
|---|---|---|
| Override `palette.primary` in a nested `ThemeProvider` per surface | Build a second theme, or introduce a fourth accent for Admin | [Colors](#colors) |
| Keep every non-primary token byte-identical across surfaces | Tint neutrals or semantics "to match the room" | [Colors](#colors) |
| Classify every new component paper or control before assigning a radius | Invent a third box radius, or use pill shapes | [Shapes](#shapes) |
| Use circle / triangle / square frames for state *glyphs* only | Read the glyph-shape exemption as licence to round a card or a row | [Shapes](#shapes) |
| Separate surfaces with a 1px `{colors.divider}` border and the paper/default step | Use a drop shadow, or any MUI `elevation` above 0 | [Elevation & Depth](#elevation--depth) |
| Hold `{colors.divider}` to 3:1 because it is the only boundary a control has | Add a second, weaker divider token "for decorative rules" | [Colors](#colors) |
| Carry focus on `{components.focus-ring}` at 2px offset, measured against the surface behind the control | Put a `primary` ring flush on a `primary`-filled button | [Colors](#colors) |
| Carry hover on `{state.tintHover}` and selected-or-answered on `{state.tintSelected}` | Carry focus or hover on shadow, hover on the accent, or invent a hex value for a selected state | [Colors](#colors) |
| Read spacing from `{spacing.density.comfortable}` / `{spacing.density.compact}` | Hardcode a spacing number in a component | [Layout & Spacing](#layout--spacing) |
| Treat tap-target minimums as a floor density cannot cross | Let `density.compact` shrink a control below 44px, or a Student Mode control below 48px | [Layout & Spacing](#layout--spacing) |
| Set Question and Explanation text in Literata wherever it appears, including Parent View and Admin | Assign families by surface instead of by content | [Typography](#typography) |
| Apply `tnum` explicitly on Literata wherever numerals align | Assume Literata is tabular by default | [Typography](#typography) |
| Render generated fractions typographically via `frac` | Ship `1/2` as plain text in Question, answer-key, or Explanation content | [Typography](#typography) |
| Render the student's typed fraction in a sibling beside a real input holding the raw string | Overlay the render on the input, or make the rendered glyphs the field's value | [Components](#components) |
| Carry every grade state on all four carriers from `{components.grade-state-marker}` | Ship four colored circles and call the never-color-alone rule met | [Components](#components) |
| Use the literal labels `Correct` / `Not correct` / `Unanswered` / `Not graded yet` **for grade state** | Substitute "Wrong", "Incorrect", or "Not answered" **for a grade state** — the in-test question map's `Answered` / `Not answered` is progress vocabulary and stays as it is | [Components](#components) |
| Keep `{colors.warning}` for Weak Area, legibility, and pre-expiry warning | Reuse `warning` as a grade state — ungraded is `{colors.info}` | [Colors](#colors) |
| Show an expired Page Image as a labeled empty tile | Show a broken image, an error color, or a retry | [Components](#components) |
| Show a suppressed Explanation as a flat neutral statement in the sans dashboard face | Style suppression as an error or a warning, give it a retry control, or set the statement in Literata as though the app were still explaining something | [Components](#components) |
| Let the score simply appear | Count the score up, sweep it in, or celebrate it | [Brand & Style](#brand--style) |
| Use motion only for question transitions, expand/collapse, route changes, and the generation wait | Animate the results reveal, the sparkline draw-in, or the timer per tick | `EXPERIENCE.md` §Interaction Primitives |
| Honor `prefers-reduced-motion` everywhere | Treat reduced motion as optional polish | `EXPERIENCE.md` §Interaction Primitives |
| Let Admin inherit the theme unchanged | Spend bespoke layout or designed-empty-state effort on Admin | [Brand & Style](#brand--style) |
| Keep the register calm and factual | Use streaks, badges, mascots, points, confetti, exclamation marks, or encouragement copy | [Brand & Style](#brand--style) |
