# Reviewer Gate — COHERENCE lens

Scope: `.memlog.md` (all 67 entries), `DESIGN.md`, `EXPERIENCE.md`, and the four mocks in `.working/`
(`key-take-test.html`, `key-results.html`, `key-analytics.html`, `key-capture.html`).

Ranked by how much damage the contradiction does if it reaches implementation.

Counts: **2 Critical · 4 High · 8 Medium · 8 Low** (22 findings).

---

## CRITICAL

### C1 — The Generation Allowance is denominated in two different units, and the two mocks each pick a different one

- **Location A:** `.working/key-capture.html`, State 4 — "You've used **0 of 2 practice tests** this month on the Free tier… Generating 2 leaves 0 for this month. 3 to 5 are above the Free tier limit."
- **Location B:** `.working/key-analytics.html`, drill-down cost block — "Practice tests this will generate **1** · **Generations left this month 2 of 2** · Left after this one **1 of 2**."
- **Location C:** `EXPERIENCE.md` §Allowances — "Generation Allowance — charged when **a generation** successfully produces Practice Tests"; §Voice and Tone — "Generating 2 practice tests. This uses 2 of your 2 remaining **generations** this month." (itself ambiguous: 2 tests costing 2 generations reads as per-test).
- **Location D:** memlog Q12c — "it spends Generation Allowance (**2 per month** on Free)"; memlog Q13c — "the Free tier's **2-tests-per-month**".

**What breaks.** These are not two wordings of one rule, they are two different counters. Under capture's rule a Free parent can never produce more than 2 Practice Tests in a month, which contradicts FR-10 (up to 5 per request) and empties Q11a's "draft 2 of 5" review-progress requirement of meaning on the Free tier. Under analytics' rule a Free parent can produce up to 10 tests in a month from 2 generations. The cost statement that Q12c makes a *hard guard* ("a one-tap generate without a cost statement is a defect") is unimplementable until the unit is fixed, and the mock the implementer copies decides the product's economics.

**Minimal fix.** Decide the unit once and state it in `EXPERIENCE.md` §Allowances as the normative sentence ("one generation request = one Generation Allowance, regardless of how many Practice Tests it produces" *or* "one Practice Test = one unit"). Then correct whichever mock disagrees and align the capture-step selector bound to the chosen unit. This is a PRD-facing decision (FR-31), not a copy fix.

### C2 — Grade-state colour roles are inverted in the results mock relative to both spines

- **Location A:** `DESIGN.md` frontmatter `answer-key-row` — `unansweredColor: {colors.text-secondary}`, `ungradedColor: {colors.warning}`; §Colors meaning table — `warning` = "Weak Area flag, **ungraded** grade state, legibility warning"; `text-secondary` = "…**unanswered** grade state".
- **Location B:** `EXPERIENCE.md` §Grade States — Unanswered → `{colors.text-secondary}`, Ungraded → `{colors.warning}`.
- **Location C:** `.working/key-results.html` — `.chip--unanswered {color:var(--warning)}`, `.qrow--unanswered{border-left-color:var(--warning)}`; `.chip--ungraded {color:var(--info)}`, `.qrow--ungraded{border-left-color:var(--info)}`.

**What breaks.** The mock assigns `warning` to *unanswered* and `info` to *ungraded* — exactly swapping the spine and pulling `info` (spec'd as "neutral informational notices") into duty as a grade state. Worse, `warning` is simultaneously the **Weak Area** colour throughout `key-analytics.html`, so under the mock's mapping the same hue means "you ran out of time" on the student screen and "this is a weak area" on the parent screen — over the same underlying Attempt data that Q17a says is rendered in both rooms by shared components. An implementer building the answer-key row from the mock and the Mastery row from the spine ships both meanings.

**Minimal fix.** Pick one mapping. The spine's mapping is the defensible one (`text-secondary` for unanswered keeps a non-judgemental neutral on a skip; `warning` stays a single meaning). Repaint `key-results.html`'s unanswered and ungraded chips and left rules, and verify the resulting text-secondary-on-paper and warning-on-paper contrast pairs still pass.

---

## HIGH

### H1 — Three-way terminology drift on the grade-state labels, including the one label the memlog marked as deliberate

- **Location A:** memlog Q66 (canonical, and explicitly reasoned) — "'Correct' / '**Not correct**' / '**Unanswered**' / 'Not graded yet'. Note the incorrect label is 'Not correct', not 'Wrong' — consistent with the requirement that a wrong answer never read as punishment."
- **Location B:** `EXPERIENCE.md` §Grade States — Icon + "Correct" / Icon + "**Incorrect**" / Icon + "**Not answered**" / Icon + "Not graded yet".
- **Location C:** `key-results.html` uses "Not correct" and "Unanswered" (matches Q66).
- **Location D:** `key-analytics.html` uses "**Incorrect**" and "**Not answered**" (matches EXPERIENCE) — including in its own accessibility note.

**What breaks.** Q17a's load-bearing rule is that grade-state strings are shared, parameterised components rendered in both rooms. Two different label sets means either two components or one component that renders a different word on each surface — a distinction Q17a explicitly reserves for *address*, not for state vocabulary. And the drift lost the one label choice the memlog reasoned about: "Not correct" was chosen over harsher wording, and `EXPERIENCE.md` silently reverted it to "Incorrect".

**Minimal fix.** Adopt Q66's set verbatim in `EXPERIENCE.md` §Grade States and in `DESIGN.md` §Components (answer-key row), and correct `key-analytics.html`'s drill-down labels and its accessibility note.

### H2 — Q66's redundant non-colour carriers were resolved in a mock, marked for the spines, and never carried

- **Location A:** memlog Q66 — "GRADE-STATE ENCODING resolved concretely in key-results.html and **to be carried into the spines as the canonical pattern**": (a) icon frame shape/border style — solid/solid/dashed/dotted; (b) glyph — check/cross/dash/ellipsis; (c) literal text label; (d) row left-rule texture — solid/hatch/dashed/dotted.
- **Location B:** `DESIGN.md` §Components answer-key row and §Colors — only "icon + text label + color".
- **Location C:** `EXPERIENCE.md` §Grade States and §Accessibility Floor #4 — only "icon + text label + colour".

**What breaks.** Correct and incorrect deliberately *share* a frame shape in Q66 and are separated on the other three axes. Nothing in either spine records that, so an implementer reading only the spines will build four differently-coloured circles with four glyphs and believe the requirement is met — while the mock they are asked to match encodes state in border style and row-rule texture that the spines never mention. The 45° hatch left-rule for incorrect exists only inside one HTML file.

**Minimal fix.** Add the four-carrier table (frame style, glyph, label, left-rule texture) to `EXPERIENCE.md` §Grade States, and add the icon-frame and left-rule specs to `DESIGN.md` §Components under answer-key row.

### H3 — The FR-23 grade-dispute flag has no Parent View home, but a Key Flow asserts one

- **Location A:** `EXPERIENCE.md` §Information Architecture — no Parent View screen receives grade disputes (flagged Explanations get `Admin → Flagged Explanations`; disputes get nothing).
- **Location B:** `EXPERIENCE.md` §Key Flows UJ-2 closing line — "Disagrees with a mark: he flags it, and **the flag surfaces to Maria in Parent View**."
- **Location C:** memlog Q67 recorded this exactly as a coverage gap; `EXPERIENCE.md` §Open Questions does **not** list it (it lists the sparkline window, which was gap 3 of the same entry).

**What breaks.** `EXPERIENCE.md` contradicts itself: the flow promises a destination the IA does not contain. The flag affordance is specified inside the Explanation panel (Component Patterns) and in the mock, so the *raising* end is buildable and the *receiving* end is not — the dispute is written to storage and nothing ever reads it. Two of the three gaps Q67 surfaced were dropped between the memlog and the Open Questions table.

**Minimal fix.** Either add a Parent View destination row to the IA table (a dispute queue, or disputes surfaced on the per-Attempt results view in Parent View), or add the gap to §Open Questions and soften UJ-2's line so it does not assert an unbuilt destination.

### H4 — The Explanation at-cap state is the override's own flagged consequence and is the one state no mock renders

- **Location A:** memlog untagged PRD-override entry (between Q9c and Q10a), consequence (3) — "a NEW at-cap state is required in Student Mode, which is the first allowance wall the PRD's design ever places in front of a child… its copy and behaviour **must be specified with unusual care**."
- **Location B:** memlog Q13b specifies the copy and the "everything else keeps working" contract.
- **Location C:** memlog key-results render event and `key-results.html` itself — four states rendered: canonical, Explanation loading, Explanation failed, degraded grading. **No at-cap state.**

**What breaks.** The results screen is the only place the cap can be met, and it is the only screen where the constraint list is long: plain statement, no counter, blame the plan not the child, and the answer key, previously-read Explanations, the grade-dispute flag and Retake must all keep working. Every *other* Explanation state was proven in the mock; the one that carries the binding copy constraint was not. Untested copy plus an untested "everything stays live" contract is where the child-facing failure lands.

**Minimal fix.** Add a fifth state to `key-results.html` rendering the at-cap expanded region, or record explicitly in `EXPERIENCE.md` §Open Questions that this state is specified-but-unrendered so the implementer knows there is no reference.

---

## MEDIUM

### M5 — The density chain's stated premise is false, and DESIGN.md contradicts itself about it

- **Location A:** `DESIGN.md` §Layout & Spacing — "Spacing is the **only** remaining differentiator between the two rooms — type is shared, elevation does not exist, semantic colors are byte-identical, and the accent is a single hue."
- **Location B:** `DESIGN.md` §Brand & Style — the split is "carried by **accent hue and spacing density only**."
- **Location C:** memlog Q5, the justification for two density token sets, uses A's wording; memlog Q17a later adds a second-vs-third-person address split by surface; `DESIGN.md` §Layout & Spacing itself pins **different tap-target floors per surface** (48 / 44).

**What breaks.** Two sentences in one document disagree on how many differentiators exist, and the count is wrong in both: accent hue, spacing density, tap-target floor, and voice/address all differ by surface. See "Load-bearing chains" below — the *conclusion* (two named density token sets) survives on its independent rationale, but the premise as written is the one an implementer will quote back when arguing that some other token may diverge "since spacing is the only split anyway".

**Minimal fix.** Rewrite the §Layout & Spacing sentence to "Spacing is the only *dimensional* differentiator" and cross-reference the full list of surface-divergent things (accent, density, tap-target floor, address) once, in §Brand & Style.

### M1 — Page-thumbnail tap target: Q10a says 48px, everything downstream says 44px

- **Location A:** memlog Q10a — "Thumbnails are CONTROL role (8px radius) per Q3, flat-bordered per Q4, **min 48px targets**."
- **Location B:** memlog Q5 / `DESIGN.md` §Layout & Spacing — Parent View floor is **44px**; `DESIGN.md` `page-thumbnail.minTapTarget: {spacing.tap-target.parent}`; `key-capture.html` `--tap:44px`.

**What breaks.** Nothing catastrophic — 44 is the correct Parent View floor and Q10a's 48 looks like an inherited-by-mistake Student number. But it is an unreconciled contradiction in the canonical log: the memlog says 48 and every artifact says 44, and no entry records the change.

**Minimal fix.** One-line memlog correction noting Q10a's 48px is superseded by the Q5 parent floor of 44px.

### M2 — "No third radius, no pill shape" is stated as binding and is violated by required affordances

- **Location A:** `DESIGN.md` §Shapes — "**There is no third radius and no pill shape.**"; §Do's and Don'ts — "Don't: Invent a third radius, or use pill shapes."
- **Location B:** memlog Q66 makes a **circular icon frame** (and its border style) a semantic carrier of grade state; `key-results.html` `.chip--* .ico{border-radius:50%}`; `key-take-test.html` `.option .mark{border-radius:50%}` (multiple-choice marks); status dots at `50%` in `key-analytics.html`.

**What breaks.** The radius rule is stated as a total classification ("every new component must be classified paper or control before it gets a radius") with no room for circles — yet circles are load-bearing for the grade-state encoding and are the conventional radio affordance. As written, a reviewer applying the rule literally would reject the mocks.

**Minimal fix.** Add a third named class to `DESIGN.md` §Shapes — e.g. `glyph-frame: 50%`, restricted to state icons and radio marks and explicitly *not* a surface radius — so the rule stays total and enforceable.

### M3 — Tinted surfaces are used as state carriers in the mocks and are banned by DESIGN.md

- **Location A:** `DESIGN.md` §Colors — "Not used: gradients, **tinted surfaces**, brand color as decoration, **any hue outside this table**."
- **Location B:** `key-take-test.html` `--primary-tint:#E8F1F2` used as the *answered* map-cell background; `key-analytics.html` `--primary-tint:#E8F1F8`, `--track:#E6ECF1`; `key-capture.html` `--warn-wash:#FFF8EA`.
- **Location C:** `DESIGN.md` §Elevation & Depth simultaneously requires "hover uses a subtle **background tint** toward `background-default`".

**What breaks.** Four hues that no token defines are doing real work in the mocks (one of them carries answered-state on the question map), while the palette section bans exactly that and the elevation section requires a tint mechanism the palette does not provide. Implementation will invent its own tints, per component, in both themes.

**Minimal fix.** Add a small tint layer to `DESIGN.md` frontmatter — `primary-tint-student`, `primary-tint-parent`, `warning-wash`, `track` — with dark counterparts, and narrow the §Colors prohibition to "tinted surfaces outside the declared tint tokens".

### M4 — Components specified without a paper/control classification, in violation of the rule that says every one must have it

- **Location A:** `DESIGN.md` §Shapes — "**Every new component must be classified paper or control before it gets a radius.**"
- **Location B:** unclassified and un-spec'd in `DESIGN.md` §Components / frontmatter, yet all specified behaviourally in `EXPERIENCE.md` or rendered in a mock: **trend sparkline**, **smart fraction field / answer input** (Q2d, a whole new component), **state chip**, **profile switcher**, the tablet **question-map rail** (Q61), the **legibility result card**, the **generation progress** surface, and the **Parent PIN entry** (which §Elevation names but §Components does not).
- **Location C:** `DESIGN.md` `mastery-row` carries `role: control` but **no radius key at all** — classified, then not given the thing classification exists to determine.

**What breaks.** Q2d's smart fraction field is the single most constrained new component in the product (caret behaviour, non-blocking input, degradation to plain text, plus the Q18 accessibility hard case) and has no visual spec anywhere. The sparkline is a data component with no role, no colour, and no window (see L1).

**Minimal fix.** Add the missing components to `DESIGN.md` §Components with an explicit role each; give `mastery-row` a radius.

### M6 — The score header spec is narrower than what Q8c requires and than what the mock renders

- **Location A:** memlog Q8c — the skipped count is surfaced "wherever unanswered questions exist… This affects the Analytics dashboard, the Topic drill-down, and **the per-Attempt results summary**."
- **Location B:** `EXPERIENCE.md` §Component Patterns, Score header — "Score appears; it does not perform… **Names any ungraded gap** (see Grade States)." No mention of the unanswered count.
- **Location C:** `key-results.html` renders "You answered 12 of 15 correctly." plus a sub-line "**2 not correct · 1 unanswered · Finished in 23:11**".

**What breaks.** The mock resolved the score-header composition — including an elapsed-time element ("Finished in 23:11") that appears in no decision and no spine — and none of it came back into the spine. An implementer building from `EXPERIENCE.md` ships a bare "12 of 15" header, which is the exact bare-number failure Q8c forbids on the parent side and which is arguably worse on the student side, where the skip is the student's own.

**Minimal fix.** Extend the Score header row in §Component Patterns to specify the sub-line composition (not-correct count, unanswered count where any exist, ungraded gap where any exist) and either specify or drop the elapsed-time element.

### M7 — key-capture.html paints a light-mode screen with the dark-mode parent accent

- **Location A:** `DESIGN.md` §Colors — primary-parent is `#0B5FA5` light / `#7FB6E8` dark; "Implementation is one base MUI theme plus a nested ThemeProvider that overrides `palette.primary` only."
- **Location B:** `key-capture.html` declares `--primary:#0B5FA5` correctly, then hardcodes `#7FB6E8` (the **dark** value) as the shutter ring border and the Done button border on a `#F6F8FA` light ground.

**What breaks.** It reads as a fifth accent value that no token defines, and `#7FB6E8` on white is well below AA as a meaningful border — a shutter is the most important control on the screen. It also breaks the one-token-diverges discipline the mock is supposed to demonstrate.

**Minimal fix.** Replace both `#7FB6E8` occurrences in `key-capture.html` with `var(--primary)`.

### M8 — The allowance reset date differs across the two mocks and the spine

- **Location A:** `key-capture.html` — "Resets **1 October**" (Generation and Upload Allowance).
- **Location B:** `key-analytics.html` — "Your allowance resets on **1 September**."
- **Location C:** `EXPERIENCE.md` §Voice and Tone / §State Patterns at-cap example — "They reset on **1 October**."
- All artifacts are dated 2026-08-29, so the next calendar-month boundary is 1 September.

**What breaks.** Example copy, so low blast radius on its own — but it sits directly on top of `EXPERIENCE.md` Open Question #5 (the month-boundary definition is unfixed), and two mocks demonstrating two different boundaries is how that open question turns into a bug.

**Minimal fix.** Make all three read 1 September, and resolve Open Question #5.

---

## LOW

### L1 — Sparkline: proposal → decided without confirmation, window still unspecified, and no visual spec anywhere
memlog Q12b records the trend sparkline as "a **proposal, not yet confirmed** by the user"; Q12c states it as decided; `EXPERIENCE.md` §Component Patterns states it as settled behaviour. **Verified: the status *is* correctly flagged** in `EXPERIENCE.md` §Open Questions #3, which records both the proposal status and the missing window — so this is honestly logged, not buried. What is *not* handled: `DESIGN.md` has no sparkline component at all (no role, no colour, no density), and `key-analytics.html` renders one over 5 attempts, which quietly answers the open window question in a mock without saying so. Fix: add a `trend-sparkline` component to `DESIGN.md` and note in Open Question #3 that the mock assumes a 5-attempt window.

### L2 — Q13b cites "the Q10 override", which does not exist
`.memlog.md` Q13b — "reading is never capped per **the Q10 override**". The Explanation-cap override is an **untagged `(override)` entry between Q9c and Q10a**; Q10a and Q10b are the capture decisions and contain no override. Fix: tag the override entry (e.g. `Q9d`) and correct the Q13b citation. No downstream artifact repeats the bad reference, so this is memlog hygiene only.

### L3 — Q13a is a self-declared interpretation of an ambiguous answer, and is correctly carried as unconfirmed
memlog Q13a records "Interpretation recorded explicitly (user answered 'A' among three A-variants; correct if this is wrong)". **Verified as properly handled**: `EXPERIENCE.md` §Open Questions #17 carries it forward as "Needs confirmation", and `key-capture.html`'s State 5 copy implements the interpretation exactly ("If you leave, generation keeps running and nothing is lost"). No fix needed beyond getting the confirmation.

### L4 — Scrim value drift
`DESIGN.md` `dialog.scrim: rgba(16,32,46,0.55)`; `key-take-test.html` `--scrim: rgba(16,32,46,0.48)`. Fix: align the mock to 0.55.

### L5 — DESIGN.md's motion allow-list omits the question map
`DESIGN.md` §Do's and Don'ts — "Use motion only for question transitions, expand/collapse, route changes, and the generation wait." Q8a and `EXPERIENCE.md` §Interaction Primitives both name **question-map open/close** as permitted. Defensible as covered by "expand/collapse", but the two lists should read identically. Fix: add it to the DESIGN.md line.

### L6 — UJ-2 contradicts itself on how many questions Noah skipped
`EXPERIENCE.md` §Key Flows UJ-2 step 4 — "He skips one and uses the question map to jump back to it" (i.e. answers it); step 5 — "**Two** Questions are unanswered"; step 6 — "the **two** he skipped read *Not answered*". Fix: make step 4 say he skips two and returns to one of them.

### L7 — Two of the three Q67 coverage gaps were not carried into Open Questions
memlog Q67 lists three gaps. Gap 3 (sparkline window) became Open Question #3. Gap 2 (grade-dispute home) is finding H3 above. **Gap 1** — Parent View **Students** and **Settings** appear in the IA but no Key Flow reaches them — appears nowhere in `EXPERIENCE.md`. Fix: add it to §Open Questions, noting it is inherited from the PRD's journey coverage rather than introduced here.

### L8 — Score-header phrasing drift
`EXPERIENCE.md` §Voice and Tone — "You answered 11 of 15."; `key-results.html` — "You answered 12 of 15 **correctly**." The adverb is load-bearing: with unanswered questions in the set, "answered 11 of 15" is literally false where "answered 11 of 15 correctly" is true. Fix: adopt the mock's phrasing in the spine.

---

## Load-bearing chains — verification

| # | Chain | Verdict |
|---|---|---|
| 1 | **Density = two token sets, *because* spacing is the only remaining differentiator** (Q5) | **Premise fails, conclusion holds.** The premise was already false when written (Q1's accent split diverges, and Q5 itself pins different tap-target floors per surface), and Q17a later added a fourth divergence — surface-aware address. `DESIGN.md` contradicts itself on the count (§Brand & Style "accent hue and spacing density only" vs §Layout & Spacing "spacing is the only"). The **conclusion survives on its independent rationale** — components reading a named density token is enforceable in code review where per-surface judgment is not — but the justification sentence must be rewritten. See M5. |
| 2 | **Serif/sans by CONTENT vs CHROME, never by surface; the serif crosses the PIN** (Q2a/Q2b/Q2f) | **Holds.** Verified in all four mocks: `key-analytics.html` (Parent View) loads Literata and uses it only for the drill-down's missed Questions; `key-capture.html` loads *no* serif and states why ("this screen shows no generated Question content"); `key-take-test.html` and `key-results.html` use serif for question/explanation bodies and sans for all chrome. `DESIGN.md` §Typography and §Do's and Don'ts both state the rule. No violation found. |
| 3 | **Flat with borders; no shadow anywhere; MUI elevation unused** (Q4) | **Holds.** Zero `box-shadow` declarations across all four mocks. Separation is carried by 1px dividers and the default→paper step throughout. `DESIGN.md` §Elevation & Depth specifies the scrim-plus-border overlay strategy that Q4 demanded (only the scrim *value* drifts — L4). |
| 4 | **Accent split is the only diverging token; one base theme plus a nested `palette.primary` override; no fourth accent for Admin** (Q1/Q15) | **Holds in the spines; one mock violation.** `key-take-test.html` uses `--primary:#0F6E78`, `key-analytics.html` and `key-capture.html` use `--primary:#0B5FA5`, and every neutral and semantic hex is byte-identical across all four files. Admin correctly takes the parent value in both spines. The single break is `key-capture.html` hardcoding the *dark* parent accent in a light screen (M7). |
| 5 | **Unanswered is a distinct grade state → therefore excluded from the Mastery denominator → therefore the skipped count is surfaced** (Q8b → Q8c → Q13d/Q13e) | **Holds, and is the best-propagated chain in the set.** `EXPERIENCE.md` §Grade States carries `Mastery = correct / (correct + incorrect)`, extends the same reasoning to ungraded, and lists the accepted cost; §Decisions That Travel Upstream flags the FR-26/FR-27 refinement for architecture; `key-analytics.html` renders "40% · 3 unanswered" with a table footnote and a matching sparkline caption. The only slack is on the *student* side — see M6 — and the colour role for unanswered is broken in the results mock, see C2. |
| 6 | **Explanation cap: capping *generation* is free to combine with never capping *reading*, because FR-24a already retains every Explanation** (untagged override → Q13b) | **Holds.** The dependency is real (retention is a pre-existing FR-24a requirement, not a new cost) and is carried intact into `EXPERIENCE.md` §Allowances and §Decisions That Travel Upstream, including the "only wall that lands on someone who cannot act on it" framing and the no-visible-counter rule. Weakness is coverage, not logic: the state was never rendered (H4). |
| 7 | **No notifications in v0 → the progress screen is the only completion signal → therefore advise staying, reconciled with durable drafts** (Q13a × Q11b) | **Holds.** The reconciliation is genuine rather than verbal: Q11b's durable, discoverable Pending drafts is what lets the copy advise staying *without* claiming loss, and `key-capture.html` State 5 renders exactly that sentence. `EXPERIENCE.md` binding copy constraint #3 forbids the false claim. Depends on Q13a's unconfirmed interpretation (L3). |
| 8 | **Radius encodes paper-vs-control, and every component is classified before it gets one** (Q3) | **Rule holds; application is incomplete.** The classification is applied correctly wherever it is applied (all mocks use `--r-paper:2px` for question/answer-key surfaces and `--r-control:8px` for chrome), but the rule is stated as *total* and several components carry no classification at all (M4), while circular affordances the design actually requires have no legal radius under it (M2). |
| 9 | **Motion is functional-plus-progress only; the score does not perform** (Q6) | **Holds.** No results-reveal animation in `key-results.html`; the timer in `key-take-test.html` is static with `tabular-nums`; `prefers-reduced-motion` blocks are present in `key-results.html` and `key-capture.html` and disable the indeterminate bars. Only the allow-list wording drifts (L5). |
