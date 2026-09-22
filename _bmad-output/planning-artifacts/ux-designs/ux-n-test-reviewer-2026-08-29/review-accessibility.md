---
title: Accessibility review — n-test-reviewer UX
lens: accessibility
status: draft
created: 2026-08-29
reviewer: Reviewer Gate — accessibility lens
scope:
  - ./DESIGN.md
  - ./EXPERIENCE.md
  - ./.working/key-take-test.html
  - ./.working/key-results.html
  - ./.working/key-analytics.html
  - ./.working/key-capture.html
standard: WCAG 2.1 AA on student-facing surfaces (PRD §10) + four named hard cases
---

# Accessibility review

**Primary user is a 10-year-old.** This lens is not a compliance formality here: the product's core surface is a timed test, its core content is mathematics rendered as glyphs, and its core output is a four-valued state that the whole parent-facing value chain depends on. All three are places where an accessibility miss produces a *wrong answer*, not merely an awkward experience.

Every contrast ratio in this review was recomputed from the hex values in `DESIGN.md` using the WCAG 2.x sRGB relative-luminance formula. The claims in the mocks were **not** trusted, and several are wrong (see C14) — none in a direction that causes a failure, but the disagreement between artifacts means the published numbers cannot serve as a gate.

## Verdict on the four hard cases

| # | Hard case | Verdict |
|---|---|---|
| 1 | Typographic fractions | **Partially resolved** — alternatives exist on Question text, answer key and the input, but the input is not an input, raw-string preservation is unspecified, and the two alternatives double-announce and disagree in wording |
| 2 | The timed test (SC 2.2.1) | **Unresolved** — the exemption is named as required but never taken or argued; no warning, no announcement, no live region on the timer |
| 3 | The question map | **Resolved** — genuinely, and it is the best-executed component in the set |
| 4 | Four grade states | **Partially resolved** — the encoding over-delivers, but two of four colour tokens in the reference mock contradict both spines and one label string diverges |

## Finding counts

| Severity | Confirmed defects | Risks |
|---|---|---|
| Critical | 2 | 0 |
| High | 5 | 1 |
| Medium | 6 | 2 |
| Low | 4 | 4 |
| **Total** | **17** | **7** |

**Single most serious defect: C1 + C2 — the timed test.** A blind or low-vision 10-year-old is given no warning and no announcement before the countdown auto-submits their work, and the exemption that would justify the time limit at all has never been taken. **Most widespread defect: C3** — every interactive boundary in the product sits at 1.30:1 (light) / 1.27:1 (dark), a straight SC 1.4.11 failure that follows directly from the flat-with-borders decision.

---

# Confirmed defects

## C1 — CRITICAL — SC 2.2.1 exemption is required by the design and was never taken

**Location:** `EXPERIENCE.md` §Accessibility Floor item 2; `EXPERIENCE.md` §Open Questions row 2; `.memlog.md` entry 60 (Q18); absent from `DESIGN.md` and all four mocks.
**Criterion:** WCAG 2.1 SC 2.2.1 Timing Adjustable (Level A).

`EXPERIENCE.md` states the position correctly — "a practice test has a legitimate exemption path … but it must be a **deliberate, documented call**, not an oversight" — and then Open Question 2 records: *"Is the timed-test exemption from SC 2.2.1 formally taken, and where is it documented? — Open."* The design has diagnosed the problem and left it open. Naming a hard case is not resolving it.

The exemption is also not as clean as the design assumes. SC 2.2.1's Essential exception covers time limits where "extending the time limit would invalidate the activity." That reads naturally for an invigilated exam. This is a *practice* test taken at home, on a timer a parent chose, defaulting to off (FR-15). A time limit that is optional and configurable by a third party is closer to a preference than to something essential — which weakens the exemption argument and simultaneously supplies a better one.

**Fix.** Take the call explicitly, in `EXPERIENCE.md` §Accessibility Floor and mirrored into PRD §10:

1. Claim the **Essential** exception, scoped narrowly to Attempts where a parent has enabled the timer, on the stated ground that *no surprises on test day* requires simulating a real time limit.
2. Argue the parent-set duration as the SC 2.2.1 *adjust* mechanism — but this only holds if the duration is genuinely adjustable per Student Profile and the parent can raise it or turn it off at any time, including after a Practice Test is released. Confirm that FR-15 permits this; if it does not, the adjust argument fails and only the Essential exception remains.
3. Record that the default-off state means the *unmodified* product ships with no time limit at all, so the conformance claim for the untimed path is unconditional.

## C2 — CRITICAL — Auto-submit fires with no warning and no announcement

**Location:** `.working/key-take-test.html` — timer markup at the app bar of all three states (State 1 `<span class="timer-value" aria-label="12 minutes 47 seconds left">12:47</span>`; States 2 and 3 have **no** `aria-label` at all, so they announce as bare digits "12:31" / "03:08"). `EXPERIENCE.md` §State Patterns "Timer expiry".
**Criteria:** SC 2.2.1 (Level A); SC 4.1.3 Status Messages (Level AA, new in 2.1).

Nothing in either spine or any mock specifies a pre-expiry warning. `EXPERIENCE.md` says only "Expiry auto-submits." A sighted student watches the number fall and paces themselves. A screen-reader user has no equivalent signal — the timer is a static `<span>` with no `role="timer"`, no `aria-live`, and no threshold behaviour — so the first they know of expiry is that the test has submitted itself and the results screen has replaced the question. This is the one place in the product where an accessibility gap directly destroys student work, on the surface the whole product exists to serve.

The design elsewhere is scrupulous about this exact failure mode (unanswered is never scored as wrong; timer expiry "preserves whatever work exists"). The omission is inconsistent with the design's own values, not just with WCAG.

**Fix.**

- `role="timer"` on the countdown, with `aria-live="off"` in steady state so it does not chatter every second.
- Polite live-region announcements at **5 minutes, 1 minute, and 20 seconds** remaining: "Five minutes left." A matching *visible* treatment at the same thresholds — a change of the `Time left` label to `5 minutes left`, carried by text, not by an animation and not by colour (the design bans per-tick motion, and this must not become a loophole for a pulsing timer).
- `role="alert"` at expiry: "Time is up. Your test has been submitted." fired *before* the route change, and the results screen must receive focus at its heading.
- Restore `aria-label` on every timer instance — three exist and only one has it.

## C3 — HIGH — Every interactive boundary sits at 1.30:1

**Location:** `DESIGN.md` §Elevation & Depth; `divider` `#DCE3E9` / `#26333F`. Applied as the sole component boundary on `question-map-cell`, `page-thumbnail`, `practice-test-card`, `dialog`, `snackbar`, `.btn-quiet` / `.btn-danger-quiet` (`key-take-test.html`), `.iconbtn` (`key-capture.html`, `key-results.html`), and the Parent PIN field.
**Criterion:** SC 1.4.11 Non-text Contrast (Level AA) — "visual information required to identify user interface components."

Recomputed:

| Pair | Ratio | Required |
|---|---|---|
| `#DCE3E9` on `#FFFFFF` | **1.30:1** | 3:1 |
| `#DCE3E9` on `#F6F8FA` | **1.22:1** | 3:1 |
| `#26333F` on `#16202C` (dark) | **1.27:1** | 3:1 |
| `#26333F` on `#0E1620` (dark) | **1.41:1** | 3:1 |
| `background-paper` → `background-default`, light | **1.06:1** | — |
| `background-paper` → `background-default`, dark | **1.11:1** | — |

The mocks defend this with "divider is decorative only — it never carries state." That defence is sound for a *rule between two rows of text*, and I accept it there. It is not sound for a component whose entire boundary is that border. The flat-with-borders decision (§Elevation & Depth) is the direct cause: shadows are banned, the paper/default step is 1.06:1, so a quiet button, a page thumbnail, an unanswered question-map cell and a text input have nothing else defining their edge. `DESIGN.md` names exactly two separation devices and both of them are below 3:1.

Note the design already gets this right in one place — `key-take-test.html` `.fitb-field` uses `2px solid var(--primary)` (5.96:1). That is the focused/active answer field. The unfocused version, and every other bordered control, is not covered.

**Fix.** Add a third token, `divider-strong`, at ≥3:1 in both modes, and make it mandatory on any element that is a control boundary. Suggested values (verify before adopting): light `#767F89` ≈ 3.5:1 on `#FFFFFF` and 3.3:1 on `#F6F8FA`; dark `#6E7C89` ≈ 3.3:1 on `#16202C`. Keep `#DCE3E9` / `#26333F` for decorative rules and table separators only. Add a Do/Don't row: *Use `divider` for rules between content; use `divider-strong` for any boundary that identifies a control.*

## C4 — HIGH — The smart fraction field is not a field

**Location:** `.working/key-take-test.html`, Fill-in-the-Blank inset (`.fitb-field`). `EXPERIENCE.md` §Component Patterns "Smart fraction field"; §Open Questions row 1.
**Criteria:** SC 4.1.2 Name, Role, Value (Level A); SC 3.3.2 Labels or Instructions (Level A).

The rendered field is:

```html
<div class="fitb-field">
  <span class="rendered">
    <span class="frac" role="img" aria-label="3 over 4">…</span>
    <span class="sr-only">You typed 3 slash 4, shown as the fraction three quarters.</span>
    <span class="caret" aria-hidden="true"></span>
  </span>
</div>
```

There is no `<input>`, no `<label>`, no accessible name for the field, no programmatic value, and the caret is a CSS `<span>`. A screen-reader or switch user cannot focus it, cannot enter text, and cannot read back what they entered. Whole mock files contain zero `<input>` elements.

The deeper problem is that the *mechanism* is unspecified. `EXPERIENCE.md` commits to three things — live render in place, never move the caret, and "**the raw typed string is what is submitted**" — without saying how the raw string stays the programmatic value while a stack of non-text glyphs occupies the visible field. The three obvious implementations (contenteditable, overlay, canvas) all break either the caret, the value, or AT text-editing. `EXPERIENCE.md` Open Question 1 asks exactly this and is unanswered.

**Fix — and this also closes Open Question 1.**

- A real `<input type="text">` whose `value` is always the raw typed string, never rewritten, never reformatted, caret never moved. That input is the programmatic value and the accessible name is carried by a real `<label>`.
- The typographic fraction renders in a **sibling** element, `aria-hidden="true"`, positioned adjacent to the field — not overlaid on it and not replacing its text.
- `aria-describedby` on the input pointing at a `aria-live="polite"` region that announces once, on pattern recognition: "showing 3 over 4."
- Non-fraction input must never be blocked or transformed: typing `0.75`, `three quarters`, or `1 1/2` leaves the raw string intact and simply produces no render.
- Record the answer: **for the input, the raw typed string IS the text alternative.** Authored math markup is only required for *generated* content (Question, Explanation, answer key), where no raw string exists.

## C5 — MEDIUM — Fractions announce twice, and the two alternatives disagree

**Location:** `.working/key-take-test.html` Fill-in-the-Blank inset; `.working/key-results.html` Question 4 text and answer key.
**Criterion:** SC 1.1.1 Non-text Content (Level A) — met, but inconsistently and redundantly.

The input carries both `role="img" aria-label="3 over 4"` **and** a sibling `.sr-only` "You typed 3 slash 4, shown as the fraction three quarters." Both announce, so the student hears the value three times in three different forms. Across artifacts the convention also drifts: numeric-and-explicit in the input ("3 over 4"), word-form in results ("three fifths", "two thirds").

Word forms break for improper and mixed fractions — "seven fifths", "one and one half" — and for algebraic fractions they break entirely. A maths product needs one convention that scales.

**Fix.** One carrier, one convention, product-wide: **`aria-label="3 over 4"`** — numeric, explicit, and unambiguous for improper, mixed and non-unit fractions. Remove the `.sr-only` duplicate. Add the convention to `DESIGN.md` §Typography beside the `frac` rule, since generation must emit the structured form that produces it.

Also note: `DESIGN.md` specifies Literata's **native OpenType `frac`** as the mechanism, while every mock composes fractions from stacked spans with a `border-top` rule. These are different rendering paths with different accessibility characteristics (native `frac` produces real text that a screen reader will read as "3⁄4" or "34" depending on the stack; the stacked construction produces two separate text nodes). The spine and the reference implementation disagree about the mechanism for the hard case they are trying to resolve. Pick one.

## C6 — MEDIUM — Two of four grade-state colours in the reference mock contradict both spines

**Location:** `.working/key-results.html` `<style>`: `.chip--unanswered{color:var(--warning)}` and `.chip--ungraded{color:var(--info)}`; matching `.legend-rule.u` / `.legend-rule.g`. Contradicts `DESIGN.md` §Components `answer-key-row` (`unansweredColor: {colors.text-secondary}`, `ungradedColor: {colors.warning}`) and `EXPERIENCE.md` §Grade States.

| State | DESIGN.md / EXPERIENCE.md | key-results.html |
|---|---|---|
| Correct | `success` `#0F6B4F` | `success` ✓ |
| Incorrect | `error` `#B3261E` | `error` ✓ |
| Unanswered | `text-secondary` `#4E6070` | **`warning` `#8A5A00`** ✗ |
| Ungraded | `warning` `#8A5A00` | **`info` `#2E6E9E`** ✗ |

`info` is not a grade colour in the palette at all — `DESIGN.md` reserves it for "neutral informational notices." This is the reference artifact for the hard case the design claims to have resolved, and it disagrees with the specification of that hard case. Whichever an implementer copies, the other is wrong.

The spine's assignment is the better one and should win: unanswered is *neutral* (it is explicitly not a failure — the whole Mastery model depends on that), so `text-secondary` is semantically correct and `warning` is not; and `warning` for ungraded matches `DESIGN.md`'s own stated meaning for the token ("**ungraded** grade state").

**Fix.** Correct the mock to the spine, and add the four-state colour mapping to a single normative table that both documents reference.

## C7 — LOW — Grade-state label strings diverge between the spine and the mock

**Location:** `EXPERIENCE.md` §Grade States ("Icon + **Incorrect**") vs `.working/key-results.html` (renders **"Not correct"** — 6 occurrences; "Incorrect" appears 0 times). `.memlog.md` entry 66 records "Not correct" as the decision; `EXPERIENCE.md` was not updated.

The label is not cosmetic here: it is one of the required non-colour carriers **and** it is the screen-reader announcement. Two different strings means two different announcements for the same state.

**Fix.** "Not correct" is the better string — it matches the calm, non-punitive register the design commits to, and it parallels "Not answered" / "Not graded yet". Update `EXPERIENCE.md` §Grade States to match, and record all four announcement strings as normative.

## C8 — HIGH — The capture screen has no accessibility layer at all

**Location:** `.working/key-capture.html`, all five states.
**Criteria:** SC 2.1.1 Keyboard (Level A); SC 4.1.2 Name, Role, Value (Level A); SC 1.1.1 (Level A).

Measured across the whole file: **0** `<button>`, **0** `<a>`, **0** `<input>`, **0** `role=` attributes, **0** `aria-label` attributes. Every action is a `<div>`: 12 `<div class="iconbtn">` (reorder ▲/▼, retake, delete) and 7 `<div class="btn">` (Add page, Check pages, Retake page 2, Continue with all 3 pages, Generate 2 practice tests, Leave and check Pending drafts later). The shutter is a bare `<div class="shutter">`. The reorder controls are icon-only (`▲`, `▼`) with no text and no label.

Nothing on this screen is reachable by keyboard, and nothing announces. Additionally the live viewfinder region, the "2 of 10" page counter, and the ordered thumbnail strip carry no accessible text — a parent using a screen reader has no way to know how many pages have been captured or in what order, which is the entire point of the strip.

The generation-progress state (State 5) also has no `role="status"` / `aria-live` on its step list, despite being an asynchronous operation the parent is explicitly advised to wait on (SC 4.1.3).

**Fix.** Semantic elements throughout; `aria-label` on every icon-only control including the page ordinal it acts on ("Move page 2 up", "Retake page 2", "Delete page 2"); the thumbnail strip as an ordered list with each item naming its ordinal and legibility state; a `role="status"` region on the generation progress step list.

## C9 — HIGH — The results screen has no interactive elements either

**Location:** `.working/key-results.html`, all four states.
**Criteria:** SC 2.1.1 (Level A); SC 4.1.2 (Level A).

Measured: **0** `<button>`, **0** `<a>`, **31** `<span class="btn …>`. This includes "Explain this", "Hide explanation", both flag controls ("This grade looks wrong", "This explanation didn't help"), and Retake. The expand toggle carries `aria-expanded="true"` **on a `<span>`**, where the attribute has no host role and is not exposed. The app-bar back control is `<span class="iconbtn" role="img" aria-label="Back to home">` — announced as an *image*, not as a link or button.

Consequence for the product specifically: the FR-23 grade-dispute flag and the FR-24a bad-Explanation flag are the only accountability mechanism for child-facing AI content that ships without a parent gate. As specified, a screen-reader or keyboard user cannot operate either one.

**Fix.** `<button>` for every control; `aria-expanded` on the real toggle; the back control as a `<button>` or `<a>` with a text-equivalent name.

## C10 — MEDIUM — Parent View tap targets below the stated 44px floor, with a false claim in the artifact

**Location:** `.working/key-capture.html`.
**Standard:** the product's own `DESIGN.md` §Layout & Spacing floor (`{spacing.tap-target.parent}` 44px), which is *stricter* than WCAG 2.1 AA. (WCAG 2.1 has no AA target-size criterion — 2.5.5 Target Size is AAA and 2.5.8 arrived in 2.2 — so these are failures against the design's own binding rule, not against the stated conformance target. They are still defects: `DESIGN.md` calls the floor something "density cannot cross.")

| Element | Line | Rendered size | Floor |
|---|---|---|---|
| `.reorder .iconbtn` (▲ / ▼) | 281 | 44 × **21px** | 44px |
| `.page-row .thumb` | 267 | **40** × 52px | 44px (`page-thumbnail.minTapTarget`) |
| `.bar-row` back control | 133 | **32 × 32px** | 44px |

Line 491 of the same file states: *"Every thumbnail, reorder pair, retake and delete control meets the 44px Parent View tap-target floor."* This is false for the reorder pair and for the page-row thumbnail. A load-bearing claim in a reference artifact that does not survive reading the CSS immediately below it.

The Student Mode 48px floor, by contrast, holds: `key-take-test.html` `.map-cell{min-width:var(--tap);min-height:var(--tap)}` with `--tap:48px`, and `key-results.html` `.btn` / `.flagbtn` / `.iconbtn` all use `min-height:var(--tap)` at 48px. Verified clean.

**Fix.** Bring all three to a 44px hit area. The reorder pair can keep its 21px visual height with a 44px hit area via padding or a pseudo-element, provided the two do not overlap each other. Then correct or delete the claim at line 491.

## C11 — MEDIUM — `prefers-reduced-motion` is not honoured on the screen that has the most motion

**Location:** `.working/key-take-test.html` — no `prefers-reduced-motion` block anywhere in the file. `key-results.html` and `key-capture.html` both have one; `key-analytics.html` has none but animates nothing, which is acceptable.

The test-taking screen is where two of the five permitted motions live: question-to-question transitions and question-map open/close (`EXPERIENCE.md` §Interaction Primitives). `DESIGN.md` §Do's and Don'ts is unambiguous — *"Honour `prefers-reduced-motion` everywhere / Treat reduced motion as optional polish."*

Beyond the missing media query, no artifact specifies **what the reduced-motion fallback actually is** for each permitted motion. "Honour it" is a policy, not a specification.

**Fix.** Add the block, and specify the fallback per motion:

| Motion | Reduced-motion behaviour |
|---|---|
| Question → question | Instant swap; focus moves to the new question heading |
| Question-map open/close | Instant; no slide, no fade |
| Explanation expand/collapse | Instant; region appears in place |
| Generation progress | Determinate bar updates in steps; no indeterminate sweep (`key-capture.html` already does this correctly — keep it) |
| Route / page transitions | Instant |

## C12 — HIGH — Focus indicators specified in prose, rendered on one screen of four, absent from the token set

**Location:** `DESIGN.md` §Elevation & Depth ("Focus uses a visible outline in the surface's `primary`"); `.working/key-take-test.html` (`:focus-visible` on `.btn` and `.map-cell` — the only two in the whole artifact set); **zero** `:focus` rules in `key-results.html`, `key-analytics.html`, `key-capture.html`.
**Criteria:** SC 2.4.7 Focus Visible (Level AA); SC 1.4.11 Non-text Contrast (Level AA).

The flat-with-borders decision removes shadow as a focus carrier, which makes the focus specification load-bearing rather than incidental. `DESIGN.md` names the strategy correctly but never turns it into a token: no width, no offset, no contrast requirement, no name.

The good news is that the strategy **does** pass, verified in both modes:

| Ring | Against | Ratio | 3:1? |
|---|---|---|---|
| `#0F6E78` (Student) | `#FFFFFF` paper | 5.96:1 | ✓ |
| `#0F6E78` | `#F6F8FA` default | 5.60:1 | ✓ |
| `#0B5FA5` (Parent) | `#FFFFFF` | 6.57:1 | ✓ |
| `#71C3CE` (Student, dark) | `#16202C` paper-dark | 8.14:1 | ✓ |
| `#7FB6E8` (Parent, dark) | `#16202C` | 7.64:1 | ✓ |

One hazard the prose does not cover: a `primary`-coloured ring drawn on a `primary`-filled button is 1:1 against the fill. `key-take-test.html` gets this right by accident — `outline:2px solid var(--primary); outline-offset:2px` puts a 2px gap of paper colour between fill and ring, so the ring is measured against paper. That is the mechanism, and it needs to be stated rather than inherited.

**Fix.** Promote to a token — `focus-ring: 2px solid {palette.primary}, offset 2px` — add it to the `components` block, state that the ring is always evaluated against the surface *behind* the control (never against a filled ground), and render it on all four key screens.

## C13 — MEDIUM — Twelve-plus colours outside the declared palette, none with dark-mode values

**Location:** all four mocks. `DESIGN.md` §Colors: *"Not used: gradients, **tinted surfaces**, brand color as decoration, **any hue outside this table**."*

| Token / literal | File | Note |
|---|---|---|
| `--primary-tint:#E8F1F8` | key-analytics | Same named role… |
| `--primary-tint:#E8F1F2` | key-take-test | …two different values |
| `--track:#E6ECF1` | key-analytics | `DESIGN.md` specifies `barTrack: {colors.divider}` `#DCE3E9` |
| `--warn-wash:#FFF8EA` | key-capture | Undeclared |
| `--info-wash:#EFF5FA` | key-capture | Undeclared |
| `--primary-wash:#EAF2F9` | key-capture | Undeclared |
| `#C7DDEE` `#E4CFA3` `#C6DAE9` `#E6C4C1` | key-analytics, key-capture | Hard-coded tinted borders |
| `#3C4E5D` `#1B2B39` `#C2C9D0` `#96A2AC` | key-capture | Hard-coded on-dark chrome |

This matters for accessibility, not just for token hygiene: `--primary-tint` is the **state fill** for an answered question-map cell, and `--warn-wash` is the ground of the legibility-failure panel. Both carry state, both are undeclared, and neither has a dark-mode counterpart — so `DESIGN.md`'s claim that "every pair above is verified in both modes" is unverified for precisely the surfaces that convey state. In dark mode the answered-cell fill would need to be a tint of `#71C3CE` on `#16202C` that still reads as a distinct state at ≥3:1; no such value exists.

**Fix.** Promote the three washes and the bar track to real light+dark tokens in `DESIGN.md`, compute both modes, and either reconcile the two `primary-tint` values or state that the tint derives from the surface's `primary` and is therefore two values by design.

## C14 — LOW — The published contrast figures are internally inconsistent and mostly slightly wrong

**Location:** the `COMPUTED CONTRAST RATIOS` blocks in all four mock `<style>` comments; `.memlog.md` entries 62–66.

Recomputed against claimed:

| Pair | Actual | key-take-test | key-results | key-analytics | key-capture |
|---|---|---|---|---|---|
| `#10202E` on `#FFFFFF` | **16.56** | 16.20 ✗ | 16.59 ✗ | 16.20 ✗ | 16.56 ✓ |
| `#4E6070` on `#FFFFFF` | **6.50** | 6.50 ✓ | 6.61 ✗ | 6.50 ✓ | 6.50 ✓ |
| `#0F6E78` on `#FFFFFF` | **5.96** | 5.96 ✓ | 6.06 ✗ | — | — |
| `#0B5FA5` on `#FFFFFF` | **6.57** | — | — | 6.52 ✗ | 6.57 ✓ |
| `#B3261E` on `#FFFFFF` | **6.54** | 6.53 ✗ | 6.57 ✗ | 6.53 ✗ | 6.54 ✓ |
| `#8A5A00` on `#FFFFFF` | **5.93** | 5.93 ✓ | 6.02 ✗ | 5.93 ✓ | 5.93 ✓ |
| `#2E6E9E` on `#FFFFFF` | **5.47** | — | 5.55 ✗ | 5.46 ✗ | 5.47 ✓ |
| `#0F6B4F` on `#FFFFFF` | **6.49** | — | 6.49 ✓ | 6.49 ✓ | 6.49 ✓ |

**No pair fails AA** — every value, claimed or actual, clears 4.5:1. The defect is credibility: three artifacts give three different answers for the same pair, so the tables cannot be used as a gate, and a future revision that moves a colour closer to the line would not be caught. `key-capture.html` is the only file whose numbers are right throughout.

**Fix.** One computed table, in `DESIGN.md`, generated rather than hand-written. Delete the per-mock tables or generate them from the same source.

## C15 — MEDIUM — No live region for the state changes the spine requires be announced

**Location:** `EXPERIENCE.md` §Accessibility Floor standing requirements ("every state change that matters — grade resolution, save, submit confirmation — announced via a live region") vs `.working/key-results.html` `<div class="score">` (plain div, no `role="status"`), and State 4 (degraded grading) which has no announcement mechanism at all.
**Criterion:** SC 4.1.3 Status Messages (Level AA).

The ungraded→graded resolution is the sharp case. `EXPERIENCE.md` §State Patterns is explicit that a score "can legitimately change between two viewings and that must never read as the app changing its mind about the student's work," and that a resolved Question "must be visibly a **newly graded item**, not a silently altered one." *Visibly* is the operative word — the requirement is stated in visual terms only, and no mechanism exists for a user who cannot see it. For them the score silently differs from last time, which is exactly the reading the design set out to prevent.

**Fix.**

- `role="status"` on the score header, populated **only** on the degraded→resolved transition, never on first render (first render would double-announce the page).
- Newly graded rows carry a visually-hidden "Newly graded" prefix ahead of the grade-state label. This satisfies both the SC 4.1.3 requirement and the spine's own "visibly a newly graded item" rule for non-visual users — the same mechanism serves both.
- Same treatment for submit confirmation and for uncommitted-edit persistence in Parent View.

## C16 — LOW — Question-map cells announce their number twice

**Location:** `.working/key-take-test.html` `.map-cell` markup, States 1 and 2.

```html
<button class="map-cell" type="button">
  <span class="n">7</span>
  <span class="glyph" aria-hidden="true">○</span>
  <span class="sr-only">Question 7, not answered, you are here</span>
</button>
```

The visible `7` is not hidden, so the cell announces "7 Question 7, not answered, you are here." Fifteen times, on the most-used affordance on the screen. Also `.map-cell{cursor:default}` on a real `<button>` is wrong, and in State 3 the rail cells degrade to `<span class="map-cell">` with the `.sr-only` text removed entirely — inconsistent with the same component two states earlier.

**Fix.** `aria-hidden="true"` on `.n`; `cursor:pointer`; make State 3 use the same markup as States 1 and 2.

## C17 — LOW — `role="img"` fractions are opaque to braille and to character navigation

**Location:** every `.frac` element across `key-take-test.html` and `key-results.html`.

`role="img"` with an `aria-label` satisfies SC 1.1.1 and is the right call for AA. The cost is that the fraction becomes a single opaque node: a student on a braille display cannot inspect it digit by digit, cannot navigate into it, and gets the label as prose rather than as Nemeth or UEB maths. For a maths product this is a real limitation, just not a conformance failure at the committed level.

**Fix.** Record as an accepted v0 limitation with a named upgrade path: MathML with an `alttext` attribute, sourced from the same structured fraction output that `DESIGN.md` §Typography already requires generation to emit. The structured form is the prerequisite and it is already committed, so the upgrade is cheap later — provided nobody "simplifies" generation back to free-text fractions in the meantime.

---

# Risks

## R1 — MEDIUM-HIGH — The silent Parent View timeout is defensible, but not for the reason given, and one hazard is unaddressed

**Location:** `EXPERIENCE.md` §State Patterns "PIN idle timeout"; `.memlog.md` entries 53–55 (Q14a/b/c).
**Criterion in play:** SC 2.2.1 (Level A). SC 2.2.6 Timeouts is AAA and out of scope, but is where the "warn about data loss" expectation normally lives.

The brief asks whether "no warning" is defensible for a non-test surface. **My read: yes, and the design has already done the work that makes it so — but it has not connected that work to the conformance argument, and it has left one hazard open.**

Why it holds: SC 2.2.1 governs time limits on *completing an activity*. Q14c makes durability a hard requirement — "a per-Question edit typed but not committed, review position within a draft, and any partially completed upload or classification step must all survive the timeout and be exactly where the parent left them." Because nothing is lost and position is restored exactly, the timeout is a re-authentication event, not a limit on completing an activity. That is the strongest available answer and it is genuinely strong. Note it is *not* the "security exception" — SC 2.2.1 has no security exception; the argument rests entirely on the no-loss guarantee, which means **that guarantee is load-bearing for conformance and cannot be traded away later as a scope cut.** This should be recorded in `EXPERIENCE.md` so a future revision does not weaken durability without realising it also weakens the accessibility position.

The unaddressed hazard, and the reason this is not merely a note: **screen-reader reading may not register as activity.** A user navigating with a virtual cursor generates no scroll, no pointer and no key events in the page on several common stacks. A parent using a screen reader to read a 75-question draft — precisely the workload Q14b sized the 15-minute window around, and precisely the user who reads slowest — can be *actively working* for 15 minutes and still trip an idle timer that Q14a promises "never interrupts an actively working parent." The 15-minute value was chosen against sighted reading speed.

Also worth noting: users with motor or cognitive disabilities are the ones for whom re-entering a PIN and re-orienting after an unannounced context change is most expensive, even when no data is lost.

**Recommendations.**

1. **Define activity to include assistive-technology reading** — focus changes, `aria-activedescendant` movement, and virtual-cursor events where detectable — or fall back to a visibility/interaction heartbeat that does not depend on pointer and key events. This is the near-defect; the other two are hardening.
2. **Make the duration configurable in Settings.** This converts the whole question into an unambiguous SC 2.2.1 *adjust* pass and costs one setting.
3. **Announce the transition on arrival.** `role="alert"` on landing in Student Mode: "Parent View closed. Your work is saved." Silent *before* the timeout is the decision and I am not challenging it; silent *after* leaves a non-visual user with no idea why the content changed under them.

## R2 — MEDIUM — Focus management is unspecified for every navigation event

**Location:** `EXPERIENCE.md` §Interaction Primitives and §Component Patterns; no mock demonstrates it.
**Criterion:** SC 2.4.3 Focus Order (Level A).

`EXPERIENCE.md` says "focus order follows reading order" — a static property — but never says where focus *goes* after: Next / Back between questions, a question-map jump, closing the map, opening or closing the submit dialog, or expanding an Explanation. Without a specification, focus resets to the document start on each question change: a keyboard user tabs past the app bar, the timer and the counter fifteen times.

The Explanation expand is the subtler one. `role="region"` with a label does not announce on expansion — nothing fires. A student taps "Explain this", the foreground wait resolves, and unless focus or a live region carries it, nothing is spoken.

**Recommendation.** Specify the focus target for each: Next/Back and map-jump → the question heading (`tabindex="-1"`); map close → the trigger; dialog open → the dialog heading, close → the trigger; Explanation expand → focus stays on the toggle and the `aria-live="polite"` region inside the expanded area announces the loaded body. Add these to §Component Patterns, which is where the behaviour belongs.

## R3 — MEDIUM — The question-map panel is a dialog without modal semantics

**Location:** `.working/key-take-test.html` State 2: `<div class="map-panel" role="dialog" aria-label="Your questions">` over `<div class="surface dim" aria-hidden="true">` and a `.panel-scrim`.

The submit confirmation two states later gets this right — `role="dialog" aria-modal="true" aria-labelledby="submit-title"`. The map panel does not: no `aria-modal`, no stated focus trap, no Esc-to-close, no focus restoration. It renders over a scrim with the surface behind it `aria-hidden`, so it is modal in every respect except the one that tells assistive technology it is.

**Recommendation.** `aria-modal="true"`, focus trap, Esc closes, focus restores to the trigger. Match the submit dialog, which is already correct.

## R4 — LOW-MEDIUM — Dark mode is unrendered, but the declared tokens hold

The mocks render light only. I computed every declared dark pair; **all pass, most comfortably.**

| Dark pair | Ratio |
|---|---|
| `text-primary` `#E7EEF5` on `background-paper-dark` `#16202C` | 14.05:1 |
| `text-primary` on `background-default-dark` `#0E1620` | 15.55:1 |
| `text-secondary` `#A3B3C2` on paper-dark | 7.66:1 |
| `success` `#6FD1AC` on paper-dark | 8.92:1 |
| `error` `#F19B94` on paper-dark | 7.72:1 |
| `warning` `#E3B457` on paper-dark | 8.56:1 |
| `info` `#8CC0E4` on paper-dark | 8.44:1 |
| `primary-student-dark` `#71C3CE` on paper-dark | 8.14:1 |
| `primary-parent-dark` `#7FB6E8` on paper-dark | 7.64:1 |
| `on-primary-dark` `#0E1620` on `primary-student-dark` | 9.01:1 |
| `on-primary-dark` on `primary-parent-dark` | 8.45:1 |

`DESIGN.md`'s specific claim — "question body on paper measures 16.56:1 light and **14.05:1 dark**" — is exactly correct in both modes. It is the only figure in the whole artifact set that I could verify to the digit.

The residual dark-mode risk is entirely C3 (divider-dark at 1.27:1, same failure as light) and C13 (the undeclared washes, which carry state and have no dark values). Fix those two and dark mode is genuinely clean.

**Recommendation.** Render one key screen in dark before this is treated as verified — the results screen, since it carries all four grade states plus the tinted row grounds.

## R5 — LOW — Nothing depends on distinguishing the two rooms by colour alone

Checked directly. `#0F6E78` vs `#0B5FA5` is the only token that differs, but:

- Parent View carries a persistent **"Back to Student Mode"** text control in the app bar of every state (`key-analytics.html`, four states) and a text profile switcher with a full `aria-label`.
- Copy register differs structurally: Student Mode is second person, Parent View names the student in the third person — a text-level distinction on every screen.
- No safety or authorisation consequence attaches to the distinction: entering Parent View requires the PIN regardless, and no destructive action is reachable by mistaking one room for the other.

**SC 1.4.1 is not engaged.** But the "Back to Student Mode" control is currently the only non-colour signal of which room you are in, and `DESIGN.md` does not identify it as accessibility-load-bearing — it reads as a convenience affordance (Q14a.3, "deliberate handover"). If a future revision moves it into a menu, the rooms *would* become colour-distinguished only.

**Recommendation.** One line in `DESIGN.md` §Colors: the accent split may never be the only differentiator; Parent View chrome must always carry a persistent text marker.

## R6 — LOW — The "four visually distinct icon frames" claim overstates by one

`.working/key-results.html` `<style>` comment: *"four visually distinct icon frames, independent of hue: solid circle ✓ | solid circle ✕ | dashed circle – | dotted square ⋯"*. The comment lists correct and incorrect with the *same* frame — `2px solid` circle in both. They differ only by glyph and label.

No failure: glyph + text label + row-rule texture all distinguish them, so the states survive greyscale comfortably (I checked all four against each other, not just against "not colour alone" in the abstract — correct/incorrect/unanswered/ungraded are mutually distinguishable without hue on three independent carriers). But the comment claims a fourth carrier that is not there.

**Recommendation.** Either differentiate the two frames or correct the comment. Do not let the overclaim survive into implementation as a justification for dropping a carrier.

## R7 — LOW — The unanswered glyph is low-salience for a 10-year-old

`.chip--unanswered` uses an em-dash `—` inside a 2px dashed circle at 14px. Against a ✓, a ✕ and an ellipsis, a short horizontal rule is the least legible of the four at a glance for a young reader, and the dashed frame reduces it further. Cognitive/legibility, not WCAG.

**Recommendation.** Consider a hollow circle or a slash. Test with an actual 10-year-old if any usability session happens.

---

# Stronger than required — preserve through revision

These exceed the committed AA floor. Each is cheap to lose in a later pass by someone optimising for consistency or simplicity, and each is listed here so that loss is a decision rather than an accident.

1. **Grade states carry four redundant non-colour carriers, not one.** Icon frame shape and border style; glyph; literal text label; and a left row-rule *texture* (solid / 45° hatch / dashed / dotted, `key-results.html` `.legend-rule`). AA requires one. Keep the row-rule texture in particular — it is the carrier that still works when scanning a long answer key at a distance, and it is the one most likely to be pruned as decorative.

2. **The question map is the best-executed component in the set.** Real `<button>` elements, a per-cell visually-hidden state string, `aria-current` on the current question, 48×48 minimum, a `:focus-visible` ring, and an on-screen legend. This is hard case 3 and it is genuinely done. Do not let a later "simplify to a grid of divs with click handlers" refactor undo it.

3. **Question body contrast at 16.56:1 light / 14.05:1 dark** — AAA, kept because it fell out for free, and correctly documented. The 22px/1.60 Literata body at that ratio is a real advantage for a 10-year-old reading a tablet at arm's length.

4. **The sparkline has a complete text alternative.** `role="img"` with every data point spoken: *"Noah's scores across his last 5 completed practice tests: 47 percent, 60 percent, 53 percent, 67 percent, 73 percent."* Charts with genuine alternatives are rare. The empty-state meters do the same ("3 of 5 questions answered on the topic with the most answers").

5. **No inline bar is ever the sole carrier of its value** — the numeric percentage is always adjacent, and the unanswered count is always spoken alongside it ("division with remainders — 40%, 3 unanswered"). This was decided as a data-integrity rule (§Grade States) and happens to discharge SC 1.4.1 for the Mastery table for free.

6. **One type scale, sized for the harder case.** `DESIGN.md` §Typography forbids the parent dashboard from shrinking text to earn density — density is carried by spacing only. 16px floor everywhere, 22px question body. This is a standing protection against the most common accessibility regression in dense admin-style views.

7. **Tap-target floors are pinned separately from the density token**, explicitly so `density.compact` can never reduce them. The mechanism is right even where C10 shows the execution slipped.

8. **Every result and analytics string is required to be parameterised, never a literal** (`EXPERIENCE.md` §Voice and Tone, "load-bearing for implementation"). This is what makes distinct per-state, per-surface screen-reader announcements possible at all — a shared component with hard-coded copy could not announce correctly in both rooms.

9. **The Explanation wait is correctly instrumented**: `aria-busy` on the region, `role="status" aria-live="polite"` on the wait, `role="alert"` on failure, and the wait bar stilled under `prefers-reduced-motion`. This is the pattern the other three screens should copy.

10. **`EXPERIENCE.md` names its own open accessibility questions** rather than papering over them (Open Questions 1 and 2). The gaps in C1 and C4 are real, but the design found them itself — which is why they are fixable now rather than at audit.

---

# Recommended order of work

| Order | Findings | Why first |
|---|---|---|
| 1 | C1, C2 | Core surface, irreversible work loss, and the one hard case that is fully unresolved |
| 2 | C4, C5 | The other genuinely unresolved hard case; blocks Open Question 1 |
| 3 | C3, C12 | Both follow from the flat-with-borders decision and should be fixed as one token change |
| 4 | C6, C7 | Reference artifact contradicts the spine on the hard case it is meant to demonstrate |
| 5 | C8, C9, C10 | Mock-level, but these are the implementation reference |
| 6 | C11, C13, C15 | Specification gaps with clear fixes |
| 7 | R1.1, R2, R3 | Behavioural specification the spine currently lacks |
| 8 | C14, C16, C17, R4–R7 | Hygiene and recorded limitations |
