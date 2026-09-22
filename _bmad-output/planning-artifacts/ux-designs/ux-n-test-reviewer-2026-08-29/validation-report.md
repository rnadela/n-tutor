# Validation Report — n-test-reviewer

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/EXPERIENCE.md`
- **Run at:** 2026-08-29
- **Lenses:** rubric walker · coherence · PRD fidelity · accessibility
- **Findings:** 83 after deduplication (121 raw) — **7 critical · 20 high · 40 medium · 16 low**

## Overall verdict

`DESIGN.md` is close to handoff-ready: the token layer is complete and dark-paired, the sections are canonical and in order, and the accent-split / paper-vs-control / flat-bordered rules are stated tightly enough to be enforced in code review. `EXPERIENCE.md` is not. It is excellent on the four PRD journeys and on every decision the coaching session interrogated directly, and materially incomplete on everything the session never reached: the FR-25 grade dispute, FR-24a parent-side Explanation review, FR-15 timer configuration, FR-33 deletion, and profile management have surfaces named in the IA (or not named at all) with no behaviour, no states, and no components behind them. Separately, the single most concrete accessibility decision in the memlog — the four-carrier grade-state encoding — was dropped in distillation and two of its four literal labels were silently changed.

Three further lenses move the picture, and not in the spines' favour. **PRD fidelity** finds that two of the six self-declared "deliberate departures" are mis-classified as gap closures when the PRD states the opposite — one of them, FR-15 timer expiry, is a live contradiction producing two incompatible scoring and Mastery rules that no document flags as an override. **Coherence** finds the Generation Allowance denominated in two different units across the artifacts, with each mock picking a different one, so the mock an implementer copies decides the product's economics. **Accessibility** finds the flat-with-borders decision produced a system whose only two separation devices both sit below 3:1, making every control boundary an SC 1.4.11 failure, and finds the timed test — hard case 2, the product's core surface — entirely unresolved: no exemption argued, no pre-expiry warning, no timer announcement, work destroyed silently. All three lenses independently found the grade-state encoding broken, which is signal, not noise.

## Blocking set — do not hand off to architecture until these are closed

Eight items. Each either commits architecture to a stored computation, an economic model, or a conformance claim that cannot be reversed cheaply, or names an entire feature area a story workflow would have to invent.

1. **FR-15 timer expiry: two incompatible scoring rules.** FR-15 grades unanswered Questions incorrect; the spines keep them unanswered and exclude them from the Mastery denominator. Filed as a gap closure on the false premise that the PRD is silent, so it never reaches *PRD overrides*. Different scores, different Mastery, different Weak Area calls on the same Attempt.
2. **Generation Allowance denominated in two incompatible units.** One request vs one Practice Test, one per mock, colliding with FR-10's up-to-5-per-request. It is the tier economics and the allowance data model, and a PRD-facing decision against FR-31.
3. **FR-25 has no Parent View destination and no parent grade override.** The raising end is buildable, the receiving end does not exist; a score-and-Mastery-mutating action is absent from the UX contract, and UJ-2 asserts a destination the IA does not contain.
4. **The Mastery formula drops FR-26's rolling 5-Attempt window and first-Attempt-only rule.** The most implementable-looking sentence in the document and the one an engineer will copy. SM-C3 exists to catch the retake loop this omission enables.
5. **The grade-state encoding is broken on all three axes at once** — four decided non-colour carriers never carried, two of four labels drifted in opposite directions across the mocks, and the colour assignment inverted in `key-results.html` with `warning` on double duty as both "you ran out of time" and "this is a weak area" over shared components.
6. **`divider` at 1.30:1 light / 1.27:1 dark is the sole boundary of every control** — a direct SC 1.4.11 failure created by the flat-with-borders decision. Rated *high*, not critical, but blocking anyway: one token added now versus every bordered component revisited later.
7. **SC 2.2.1 on the timed test: exemption named but never argued, and no configuration surface to argue it from.** No pre-expiry warning, no `role="timer"`, no threshold announcement, two of three timer instances with no `aria-label`. The "adjustable duration" argument needs FR-15's parent-side control, which appears on no screen while the Practice Test card confidently displays "timer presence and duration when set".
8. **FR-1 sign-up / sign-in / consent and FR-33 deletion have no surface.** The blocking subset of the nine FRs with no UX. Auth is the first screen every user sees and carries the PRD's one security-relevant message rule; §5.2 makes the child-data consent notice a launch gate blocking public registration; FR-33 requires password re-authentication — *not* the Parent PIN — for destructive actions, a surface that exists nowhere.

### Assessed and not blocking

- **FR-32's missing Source Test / Page Image surface** — blocking-adjacent. A new Parent View destination with IA consequences, but specifiable in an Update without changing the architecture's shape.
- **FR-3 profile management, FR-24a parent-side Explanation review, FR-13 last-Question deletion, FR-31 profile at-limit state** — real gaps, all closeable as State and Component Pattern rows against requirements the PRD already states precisely.
- **Mock-level accessibility semantics** (zero `<button>` on the capture and results screens, missing `prefers-reduced-motion`, tap targets under the stated floor) — defects in the reference artifacts, not in the contract. Must be fixed before the mocks are used as an implementation reference, which is a different gate.
- **Token hygiene, contrast-table inconsistency, copy drift, memlog citation errors** — absorb into the Update pass.

## Category verdicts

- Flow coverage — **thin**
- Token completeness — **adequate**
- Component coverage — **thin**
- State coverage — **thin**
- Visual reference coverage — **thin**
- Bloat & overspecification — **strong**
- Inheritance discipline — **adequate**
- Shape fit — **strong**

## Where the lenses disagree

Five places. Each is recorded rather than silently resolved.

1. **Grade-state label drift — three-band severity spread.** Rubric: critical (a decided value was silently reverted, across three files). Coherence: high (shared-component consequence under Q17a). Accessibility: low (both strings are legible; neither fails a criterion). The spread is itself the finding — cheap to fix, expensive to leave, because every consumer sees a different answer depending on which artifact they open.
2. **Grade-state colour inversion.** Coherence: critical, on the `warning` double-duty consequence across shared components. Accessibility: medium, because no mapping fails a contrast criterion and the semantic argument is not a conformance failure. Coherence's reading is the one that matters for handoff — the defect is that two artifacts give opposite answers.
3. **Open Question #1, the accessible fraction representation — a substantive disagreement about whether it is closed.** Rubric: the memlog's final entry closes it concretely (`role="img"` plus a spoken text alternative, "closing the Q18 hard case"), so a resolved decision is wrongly recorded as open and will be re-decided. Accessibility: the mock has no `<input>` at all, so `role="img"` on a non-field demonstrates nothing about the input, and the question is genuinely open. Reconciliation: the memlog closed the *generated-content* half and left the *input* half open. Split the question and close each separately.
4. **The Q13a generation-progress interpretation.** Coherence L3 verifies it as properly handled — flagged in the memlog, carried in Open Question 17, implemented consistently in the mock. Rubric and PRD fidelity both hold that honest flagging seventeen rows later does not offset three binding statements made without a hedge. Procedural reconciliation: one question to the user; until it lands, mark the State Patterns row provisional.
5. **The four grade-state icon frames.** Coherence reads the shared correct/incorrect frame as deliberate (Q66 says so). Accessibility R6 reads the mock's own comment claiming "four visually distinct icon frames" as an overclaim by one. Both are right about different objects: the decision is deliberate, the mock's self-description of it is false — and the overclaim must not survive into implementation as a justification for dropping a carrier.

Two further notes on lens coverage rather than disagreement: the `divider` contrast failure was found by accessibility alone, and the FR-15 expiry contradiction and the Generation Allowance unit split were each found by a single lens positioned to catch them.

## Findings by severity

### Critical (7)

**[Inheritance discipline · prd-fidelity B-1/A-3]** — Timer expiry contradicts FR-15 and is filed as a gap closure, so no override exists (§ State Patterns → Timer expiry; § Decisions That Travel Upstream; memlog Q8b(3))
FR-15: "On timer expiry the Attempt auto-submits **with unanswered Questions graded incorrect**." The spine: "The PRD… **never states what expiry does**" and "Unanswered Questions at expiry are recorded as **unanswered, not wrong**." The auto-submit half is compliance, not a gap closure, and filing it as a gap invites a PRD update adding a requirement already present. The unanswered-not-wrong half is a genuine contradiction missing from *PRD overrides*. It also silently invalidates the memlog Q8b chain, which builds the entire distinct-unanswered-state decision on the premise that the PRD is silent.
Fix: move to *PRD overrides*, state it against FR-15, note that FR-15's third consequence must be rewritten in the PRD, and correct the false premise in both spine and memlog.

**[Coherence C1]** — The Generation Allowance is denominated in two different units, and the two mocks each pick a different one (key-capture.html State 4; key-analytics.html cost block; § Allowances; memlog Q12c/Q13c)
Capture counts Practice Tests ("0 of 2 practice tests this month"); analytics counts requests ("Generations left this month 2 of 2"). The spine's own copy is ambiguous, and the memlog says both. These are two different counters: under capture's rule a Free parent can never exceed 2 tests a month, contradicting FR-10's up-to-5-per-request and emptying Q11a's "draft 2 of 5" requirement of meaning; under analytics' rule the same parent gets 10 tests from 2 generations. The cost statement Q12c makes a hard guard is unimplementable until the unit is fixed.
Fix: decide the unit once and state it in § Allowances as the normative sentence; correct whichever mock disagrees; align the capture-step selector bound. A PRD-facing decision against FR-31, not a copy fix.

**[Component coverage · rubric critical / coherence H2 / accessibility hard case 4 + R6]** — The four non-colour carriers were decided, marked "to be carried into the spines", and never carried (memlog Q66; DESIGN.md § Components → Answer-key row; EXPERIENCE.md § Grade States, § Accessibility Floor #4)
The decided pattern is three redundant non-colour carriers plus hue: icon frame shape and border style (solid / solid / dashed circle / dotted square), glyph (check / cross / dash / ellipsis), literal text label, and row left-rule texture (solid / 45° hatch / dashed / dotted), with correct and incorrect deliberately sharing a frame and separated on every other axis. Neither spine carries any of it. **No icon set, glyph, or shape is specified in either file**, so "never colour alone" is an assertion a builder cannot implement, and Accessibility Floor hard case 4 rests on it. An implementer reading only the spines builds four coloured circles and believes the requirement is met; the 45° hatch left-rule exists only inside one HTML file.
Fix: restore the four-carrier table into DESIGN.md § Components (icon-frame and left-rule are visual spec) and into EXPERIENCE.md § Grade States as the normative encoding.
*Lenses disagree:* coherence reads the shared correct/incorrect frame as deliberate; accessibility reads the mock's "four visually distinct icon frames" comment as an overclaim by one. Both are right about different objects.

**[Component coverage · rubric critical / coherence H1 / accessibility C7 low]** — Grade-state labels drift three ways, and the drift lost the one label that was reasoned about (memlog Q66; § Grade States; key-results.html; key-analytics.html; UJ-2 step 6)
Decided: `'Correct' / 'Not correct' / 'Unanswered' / 'Not graded yet'`, with the memlog stating explicitly that the incorrect label is "Not correct", not "Wrong", "consistent with the requirement that a wrong answer never read as punishment". EXPERIENCE.md ships `'Correct' / 'Incorrect' / 'Not answered' / 'Not graded yet'`. `key-results.html` matches the memlog (6 occurrences of "Not correct", 0 of "Incorrect"); `key-analytics.html` matches EXPERIENCE.md, including in its own accessibility note. Q17a's rule is that grade-state strings are shared parameterised components rendered in both rooms — two label sets means two components or one rendering different words per surface, a distinction Q17a reserves for *address*, not state vocabulary. The label is also a required non-colour carrier *and* the screen-reader announcement.
Fix: adopt the memlog's set verbatim in § Grade States, DESIGN.md § Components → Answer-key row and UJ-2 step 6; correct `key-analytics.html`; record all four announcement strings as normative.
*Lenses disagree on severity by three bands* (rubric critical / coherence high / accessibility low) — see "Where the lenses disagree".

**[Component coverage · coherence C2 / accessibility C6 medium]** — Grade-state colour assignment is inverted between key-results.html and both spines, with `warning` on double duty (key-results.html chip and legend-rule styles)
Both spines assign `unansweredColor: {colors.text-secondary}` and `ungradedColor: {colors.warning}`. The mock swaps them and pulls `info` — specified as "neutral informational notices" and not a grade colour at all — into duty as a grade state. `warning` is simultaneously the Weak Area colour throughout `key-analytics.html`, so under the mock's mapping the same hue means "you ran out of time" on the student screen and "this is a weak area" on the parent screen, over the same Attempt data rendered by shared components. This is the reference artifact for the hard case the design claims to have resolved, disagreeing with the specification of that hard case.
Fix: the spine's mapping wins — unanswered is explicitly not a failure, so `text-secondary` is semantically correct. Repaint the mock's unanswered and ungraded chips and left rules, verify the resulting pairs, and put the four-state mapping in one normative table both documents reference.
*Lenses disagree on severity:* coherence critical, accessibility medium.

**[Flow coverage · rubric critical / coherence H3 / prd-fidelity C-6 + B-13 + B-8]** — FR-25 grade dispute: mis-cited as FR-23, no Parent View home, no grade override (§ Component Patterns; § IA; UJ-2)
FR-25 requires flagged Questions to appear in Parent View with the student's answer, the recorded grade and the grading rationale, and requires the parent to override the grade, recomputing the Attempt score and the affected Topic's Mastery. Neither spine contains an override affordance and the IA has no screen that could hold one. The Explanation panel calls it "the FR-23 grade-dispute flag" — FR-23 is *Answer reveal* — so a workflow tracing FR coverage by number marks FR-23 covered and FR-25 unreferenced. The memlog found this gap exactly and it did not survive distillation. UJ-2 asserts "the flag surfaces to Maria in Parent View", a destination the IA does not contain, so EXPERIENCE.md contradicts itself. FR-22's grading rationale has no display surface either, stranding the override's evidence.
Fix: correct the citation; add a Parent View destination; add a Component Patterns row for the four data elements plus the override control; add a State Pattern for what the student sees after an override lands — the same "must not read as the app changing its mind" problem already solved for ungraded resolution, and the answer must be consistent.

**[Flow coverage · rubric critical (a) / prd-fidelity C-8 medium (a) / accessibility C1+C2 critical (b)]** — FR-15 timer: no configuration surface, and no accessible expiry treatment (§ IA; § Component Patterns; § Accessibility Floor; key-take-test.html)
Two distinct aspects of one absent feature. **(a) No configuration surface.** The timer is load-bearing in DESIGN.md tokens, Component Patterns, State Patterns, Accessibility Floor hard case 2, UJ-1 step 9 and UJ-2 step 2 — but nothing says where a parent turns it on or sets a duration. The Accessibility Floor asserts it is "optional, parent-controlled, and default off" with no control to point at, while the Practice Test card displays "timer presence and duration when set". A feature is displayed that nothing lets the parent enable. **(b) No accessible expiry treatment.** No pre-expiry warning anywhere; the timer is a static `<span>` with no `role="timer"`, no `aria-live`, no threshold behaviour, and only one of three instances carries an `aria-label`. A screen-reader user's first notice of expiry is that the results screen has replaced their test — the one place in the product where an accessibility gap directly destroys student work. The two aspects compound: the SC 2.2.1 "adjust" argument requires a duration the parent can genuinely change, which requires the control that does not exist.
Fix: name the surface that owns timer configuration (Draft review is the natural home) with default off, per-Practice-Test, duration entry and post-release editability stated. Then `role="timer"` with `aria-live="off"` in steady state; polite announcements at 5 minutes, 1 minute and 20 seconds with a matching visible label change carried by text, not motion or colour; `role="alert"` at expiry fired before the route change with focus landing on the results heading; restore `aria-label` on every timer instance.

### High (20)

**[Token completeness · accessibility C3]** — `divider` at 1.30:1 / 1.27:1 is the sole boundary of every control (DESIGN.md § Elevation & Depth; `#DCE3E9` / `#26333F`)
Recomputed: `#DCE3E9` on `#FFFFFF` = 1.30:1; on `#F6F8FA` = 1.22:1; `#26333F` on `#16202C` = 1.27:1. SC 1.4.11 requires 3:1. Applied as the sole boundary on question-map cells, page thumbnails, practice-test cards, dialogs, snackbars, quiet and danger-quiet buttons, every icon button, and the Parent PIN field. The mocks' "divider is decorative only" defence is sound for a rule between rows of text and not sound for a component whose entire boundary *is* that border. Flat-with-borders is the direct cause: shadows banned, paper→default step 1.06:1, so DESIGN.md names exactly two separation devices and both are below 3:1.
Fix: add `divider-strong` at ≥3:1 in both modes, mandatory on any control boundary (suggested light `#767F89`, dark `#6E7C89`; verify before adopting). Keep the existing values for decorative rules only, with a Do/Don't row saying which is which.

**[Component coverage · accessibility C4 / coherence M4]** — The smart fraction field is not a field (key-take-test.html `.fitb-field`; § Component Patterns; § Open Questions #1)
No `<input>`, no `<label>`, no accessible name, no programmatic value — the whole mock set contains zero `<input>` elements. A screen-reader or switch user cannot focus it, enter text, or read back what they entered. The deeper problem: the spine commits to live render in place, never moving the caret, and "the raw typed string is what is submitted", without saying how the raw string stays the programmatic value while non-text glyphs occupy the visible field. The three obvious implementations each break the caret, the value, or AT text-editing. It is the most constrained new component in the product and has no visual spec either.
Fix: a real `<input type="text">` whose value is always the raw typed string, with a real `<label>`; the fraction renders in a *sibling* `aria-hidden` element, adjacent not overlaid; `aria-describedby` pointing at a polite live region announcing once on pattern recognition; non-fraction input never blocked or transformed. Record the answer: for the input, the raw typed string IS the text alternative.

**[Token completeness · rubric / accessibility C12]** — Focus has no token, no width, no offset, and is rendered on one mock of four (DESIGN.md § Elevation & Depth; key-take-test.html only)
DESIGN.md commits every interactive surface to "a visible outline in the surface's `primary`" and "a subtle background tint toward `background-default`", with no width, offset, tint value or opacity — the one place downstream code cannot mirror the spine, applying to every control on every screen. Flat-with-borders removes shadow as a focus carrier, making the focus spec load-bearing. `key-take-test.html` carries the only two `:focus-visible` rules in the artifact set. The strategy passes (5.60:1 to 8.14:1 across all five ring-on-surface pairs), but one hazard is uncovered: a `primary` ring on a `primary`-filled button is 1:1 against the fill, avoided in the mock only by accident via a 2px offset.
Fix: add `focus-ring: { width: 2px, offset: 2px, color: '{colors.primary}' }` with the 3:1 check stated; add `colors.hover-tint` / `-dark` as hex; state that the ring is always evaluated against the surface *behind* the control; render it on all four key screens.

**[Accessibility C8]** — The capture screen has no accessibility layer at all (key-capture.html, all five states)
Measured: 0 `<button>`, 0 `<a>`, 0 `<input>`, 0 `role=`, 0 `aria-label`. Every action is a `<div>` — 12 icon buttons and 7 text buttons — and the shutter is a bare `<div>`. Reorder controls are icon-only with no text and no label. Nothing is keyboard-reachable, nothing announces. The viewfinder, the "2 of 10" counter and the ordered thumbnail strip carry no accessible text, so a parent using a screen reader cannot know how many pages exist or in what order — the entire point of the strip. The generation-progress state has no `role="status"` on its step list despite being an async operation the parent is advised to wait on.
Fix: semantic elements throughout; `aria-label` on every icon-only control including the page ordinal it acts on; the strip as an ordered list naming ordinal and legibility state; `role="status"` on the progress step list.

**[Accessibility C9]** — The results screen has no interactive elements either (key-results.html, all four states)
Measured: 0 `<button>`, 0 `<a>`, 31 `<span class="btn…">` — including "Explain this", "Hide explanation", both flag controls, and Retake. `aria-expanded="true"` sits on a `<span>`, where it has no host role and is not exposed. The back control is `<span role="img">`, announced as an image. Product-specific consequence: the grade-dispute flag and the bad-Explanation flag are the only accountability mechanism for child-facing AI content shipping without a parent gate, and as specified a screen-reader or keyboard user cannot operate either.
Fix: `<button>` for every control; `aria-expanded` on the real toggle; the back control as a button or link with a text-equivalent name.

**[Inheritance discipline · rubric / prd-fidelity B-5/A-4a]** — The Mastery formula drops FR-26's rolling window and first-Attempt-only rule (§ Grade States)
The spine states `Mastery = correct / (correct + incorrect)` per Topic as the whole rule. FR-26 computes it over the 5 most recent qualifying Attempts that included the Topic, where only the first Attempt on a Practice Test qualifies. The window appears only as a passing rationale for not drawing per-Topic trend lines; the retake exclusion appears nowhere. Read literally the spine's formula *replaces* FR-26 rather than refining it, and it is the sentence an engineer will copy.
Fix: state the full rule — `correct / (correct + incorrect)` computed over the qualifying Attempts inside FR-26's rolling 5-Attempt window.

**[Inheritance discipline · prd-fidelity B-6]** — Retake Attempts are one tap from everywhere and marked non-qualifying nowhere (§ Component Patterns → Practice Test card, Trend sparkline; UJ-2 step 8)
FR-20 and FR-26 are explicit that retakes are scored and shown but do not contribute to Mastery, and SM-C3 exists to catch the product being used as a memorisation loop. No surface distinguishes a qualifying first Attempt from a retake. Two questions fall out: which score does a completed card show after three retakes, and does the trend sparkline include retakes? If it does, it plots exactly the number SM-C3 warns against optimising; if not, that is a rule nobody has written down. UJ-2 ends on Retake with no indication that it moves nothing on his mother's dashboard.
Fix: state the card's post-retake score rule and the sparkline's membership rule, and decide which surface tells the user retakes do not count.

**[Inheritance discipline · rubric / prd-fidelity B-9 medium]** — FR-28's "filterable by Subject" is dropped from the Mastery table (§ Component Patterns → Mastery table)
Specified in full — ranked, weakest-first, inline bars, answered count, skipped count, Weak Area marker, row tap — with no Subject filter, while PRD UJ-3 describes "most-missed topics across subjects". Invisible with one Subject; the moment Math and Science are both released the ranked list interleaves two Subjects whose Topics are deliberately scoped per Subject under FR-26a.
Fix: add the filter, or record dropping it as a deliberate v0 decision with rationale.

**[Inheritance discipline · prd-fidelity B-2]** — FR-16's Subject grouping is contradicted by the flat Student Home, and the contradiction is never named (§ Component Patterns → Student Home list; memlog Q7b)
FR-16 requires tests "**grouped** and labeled by Subject and state"; the spine says "flat list, no Subject grouping". Q7b reasons the choice on its merits and never mentions FR-16, and the departure does not reach *Decisions That Travel Upstream*. A workflow deriving acceptance criteria from FR-16 will write a grouping requirement the UX has deliberately rejected.
Fix: log it as a departure against FR-16.

**[Inheritance discipline · prd-fidelity A-2]** — Camera-roll upload is mis-classified as a gap closure; FR-5 already mandates it (§ Decisions That Travel Upstream; memlog Q10a)
The spine says the PRD "never rules out the camera roll". FR-5 is titled *Multi-page capture **and library selection*** and requires the device photo library with library multi-select on mobile web. High on the accuracy of the log (a PRD update executed from this entry adds a duplicate requirement), low on the design, which is correct. The behavioural additions — mixed freely in one Source Test, source never surfaced, identical ceiling and legibility treatment — are real elaborations worth keeping. Sub-finding at medium: FR-5 requires multi-select while also saying pages are "captured or selected one at a time", so the PRD is ambiguous and the spine inherits the ambiguity rather than resolving it — the opposite of what a spine is for.
Fix: drop the gap framing, keep the elaborations, resolve the multi-select question in the Capture strip row.

**[Inheritance discipline · rubric / accessibility C4 — disagreeing]** — Open Question #1 records a question the memlog closed, and the accessibility lens says it did not (§ Open Questions #1; memlog final entry; key-take-test.html)
Rubric: the memlog closes it concretely — typographic fractions marked `role="img"` with a spoken text alternative, "closing the Q18 hard case" — so a resolved accessibility decision recorded as open will be re-decided, probably differently. Accessibility: the mock has no `<input>` at all, so `role="img"` on a non-field demonstrates nothing about the input, and the question — how the raw typed string stays the programmatic value — is genuinely unresolved.
Fix: split it. Close the generated-content half by moving the `role="img"` + spoken-alternative rule into § Accessibility Floor hard case 1 and § Component Patterns; keep the input half open until the real-`<input>`-plus-sibling-render mechanism is adopted.

**[State coverage · coherence H4]** — The Explanation at-cap state is the override's own flagged consequence and is the one state no mock renders (memlog override entry, Q13b; key-results.html)
The override entry names it: "a NEW at-cap state is required in Student Mode, which is the first allowance wall the PRD's design ever places in front of a child… its copy and behaviour must be specified with unusual care." The results screen is the only place the cap can be met and the screen where the constraint list is longest: plain statement, no counter, blame the plan not the child, and the answer key, previously-read Explanations, the dispute flag and Retake all keep working. Every *other* Explanation state was proven in the mock; the one carrying the binding copy constraint was not.
Fix: add a fifth state to `key-results.html`, or record in § Open Questions that this state is specified-but-unrendered so the implementer knows there is no reference.

**[Flow coverage · prd-fidelity C-1 + C-2 / rubric medium]** — FR-1: sign-up, sign-in, password reset and the child-data consent notice have no surface (§ IA)
Fourteen screens, none of them authentication; both UJ-1 and UJ-3 open "already signed in". FR-1's four testable consequences all need surfaces: verified-format email and stated minimum password strength, a duplicate-email message that does not leak account existence, session persistence until explicit sign-out, password reset via emailed link. Separately FR-1 requires acceptance of terms and the child-data consent notice, and §5.2 makes parent-provided consent at sign-up the build posture with legal review of it a **launch gate blocking public registration** — the one interaction the entire privacy posture rests on has no wording, no placement, and no record-of-consent state.
Fix: add the auth rows with the duplicate-email rule stated, and give the consent notice a named surface even in a v0 with closed registration. If auth is inherited from the `n-electric` stack, say so — but the consent notice and the message rule are product decisions and cannot be inherited.

**[Flow coverage · rubric / prd-fidelity C-4]** — FR-33: parent-initiated deletion is a word in a nav list (§ IA → Settings)
FR-33 specifies three destructive operations with binding requirements stated nowhere: explicit confirmation *naming what will be destroyed* and stating it cannot be undone; **the account password, not the Parent PIN**, for profile and account deletion (the PRD is emphatic — "the PIN gates a mode, not a destructive action"), a re-authentication surface that exists nowhere; and per-Source-Test early Page Image deletion, invoked from a surface that does not exist. DESIGN.md names `error` as the "destructive confirm" colour, so the token anticipates a pattern EXPERIENCE.md never specifies. This is a product holding photographs of children's schoolwork; §4.9's preamble says these were written as FRs precisely so downstream story creation could not drop them.
Fix: a State Patterns row for destructive confirmation and a Component Patterns row for the confirm dialog — `dialog` already has a visual spec.

**[Flow coverage · prd-fidelity C-3 / rubric medium / coherence L7]** — FR-3: Student Profile management has a screen name and nothing behind it (§ IA → Students, → Settings)
Both screens are IA rows with zero downstream content — no component rows, no states, no empty states, no copy rules, no Key Flow. No states exist for any of FR-3's four operations. Missing specifically: the at-limit state when creation is blocked by Account Tier, which FR-3 and FR-31 jointly require to name the tier and its limit; the archive action and its distinction from deletion, which FR-33 calls out as different; and Grade Level change, whose stated consequence collides with the spine pitching Explanation language to the profile's Grade Level rather than the Practice Test's.
Fix: give both screens minimal Component and State Pattern rows, or state deliberately that they inherit default MUI form treatment — but say which.

**[Flow coverage · rubric / prd-fidelity C-7 medium]** — FR-24a: the parent-side Explanation reading surface and flag control do not exist (§ Component Patterns → Explanation panel; § IA)
FR-24a's first testable consequence is a *parent* capability: read every Explanation shown to the student, and flag one as bad. The spine puts the flag inside a Student Mode results component and the received flags in an Admin queue. As written, either the student is flagging their own Explanations or the parent's path runs through Student Mode, which FR-4 forbids from carrying parent functionality.
Fix: add the parent-side read/flag path — most cheaply as an expandable Explanation on the Parent View per-Attempt results or Topic drill-down rows, which already render Question content as paper role.

**[Flow coverage · prd-fidelity C-5 / rubric medium]** — FR-32: no Source Test or Page Image surface, so the expired state has nowhere to live (§ IA)
The IA contains no Source Tests list and no Page Image viewer; Page Images appear only transiently in the Capture strip during upload. Four consequences: the expired state has no home; the parent cannot see what she uploaded 30 days ago; there is no entry point for FR-33's early image deletion; and FR-11's "the originating Source Test is reused" is legible nowhere. A Source Test list is the missing Parent View destination several FRs quietly assume.
Fix: add the Source Test list to the IA and a State Patterns row for the expired Page Image.

**[Flow coverage · prd-fidelity B-3 / rubric medium]** — FR-4: the multi-profile binding prompt is replaced by an unexplained "correct Student Profile" (§ State Patterns → PIN idle timeout, Deliberate handover)
FR-4 requires that on a device with more than one Student Profile, exiting Parent View prompts which profile the device should bind to. The spine returns "on the correct Student Profile" with no prompt on either path and no definition of correct on a Family-tier account with five profiles and one tablet. The silent path is worst: a parent who walked away cannot answer a prompt, so the rule needs an explicit answer — last-bound profile? the profile whose Analytics she was viewing? — not an adjective. Nothing says how a device becomes bound in the first place.
Fix: state the binding rule for the silent path, restore the prompt on the deliberate path, and name where initial binding is set.

**[State coverage · rubric]** — No camera-permission-denied state anywhere (§ State Patterns; § Foundation; UJ-1 steps 3–4)
§ Foundation commits to camera access through the browser and the entire capture flow assumes the viewfinder opens. A permission denial or unavailable camera is the single most likely hard failure in the parent's five-minute kitchen path — and camera-roll upload, the UX-originated addition in this very session, is the ready-made fallback.
Fix: a State Patterns row — permission denied or camera unavailable falls back to camera-roll selection with a plain statement, never a dead end.

**[State coverage · rubric / prd-fidelity B-14 low]** — No offline / network-loss state, in a product where every grade, Explanation and generation is a server call (§ State Patterns; PRD §9.2, FR-18, FR-15)
The closest coverage is "Interrupted Attempt survives interruption", which addresses backgrounding, not connectivity. A tablet dropping wifi mid-Attempt is the realistic case. The spine's own decisions sharpen it: FR-18 requires an Attempt to survive backgrounding, refresh and sleep, and the spine adds auto-submit at expiry, while §9.2 states network is required — so expiry on a sleeping or offline tablet is unspecified, and submission triggers AI grading, which needs the network.
Fix: a State Patterns row covering submit-while-offline, Explanation request while offline (distinguishable from the FR-24 failure state *and* from at-cap, since the copy rules differ), and generation while offline. Answer the expiry-while-offline case explicitly.

### Medium (40)

**[Token completeness · coherence M3 / accessibility C13]** — Tinted surfaces carry state in the mocks, are banned by DESIGN.md, and have no dark values (DESIGN.md § Colors; all four mocks)
Twelve-plus undeclared colours do real work: `--primary-tint` at two different values for one named role, `--track` where DESIGN.md specifies `barTrack: {colors.divider}`, `--warn-wash`, `--info-wash`, `--primary-wash`, four hard-coded tinted borders, four hard-coded on-dark chrome values. § Elevation & Depth simultaneously *requires* a tint mechanism the palette does not provide. This is accessibility, not only hygiene: `--primary-tint` is the state fill for an answered question-map cell and `--warn-wash` is the ground of the legibility-failure panel — both carry state, both undeclared, neither with a dark counterpart, so "every pair above is verified in both modes" is unverified for exactly the surfaces that convey state.
Fix: promote the three washes and the bar track to real light+dark tokens, compute both modes, narrow the § Colors prohibition to "outside the declared tint tokens", and reconcile the two `primary-tint` values or state that the tint derives from the surface's `primary`.

**[Token completeness · rubric / accessibility C14 low]** — One contrast pair published; the measured values were dropped and the mock tables disagree with each other (DESIGN.md § Colors; the four mocks' COMPUTED CONTRAST RATIOS blocks)
DESIGN.md asserts "every pair above is verified in both modes" without numbers, while the memlog holds measured values for exactly the load-bearing pairs (6.50, 6.53, 5.93, 5.96, 6.52, lowest 5.47). Independently, accessibility recomputed every published figure: three artifacts give three different answers for the same pair, and `key-capture.html` is the only file right throughout. **No pair fails AA** — the defect is credibility, so the tables cannot serve as a gate and a future revision moving a colour closer to the line would not be caught.
Fix: one computed table in DESIGN.md § Colors, generated rather than hand-written. Delete the per-mock tables or generate them from the same source.

**[Component coverage · rubric / coherence M4]** — Ten components carry behaviour or render in a mock with no visual spec and no paper/control classification (DESIGN.md § Components, § Shapes)
§ Shapes states the rule as total — "every new component must be classified paper or control before it gets a radius" — and unclassified are: Score header (the most emotionally loaded element in the product, no type role assigned), Trend sparkline (a chart in a system with no chart language), Profile switcher, smart fraction field, state chip, the tablet question-map rail, Legibility result, generation progress, Draft review list, the cost block the weighted-regenerate control is gated behind, and the Parent PIN entry. `mastery-row` carries `role: control` and no radius key at all — classified, then not given the thing classification exists to determine.
Fix: add rows with an explicit role each, at minimum Score header, Trend sparkline, Profile switcher and the smart fraction field; give `mastery-row` a radius; state if the remainder inherit roles.

**[Component coverage · coherence M2]** — "No third radius, no pill shape" is binding and is violated by required affordances (DESIGN.md § Shapes, § Do's and Don'ts)
Circular icon frames are load-bearing for the grade-state encoding, circles are the conventional radio affordance on multiple-choice marks, and status dots render at 50%. As written, a reviewer applying the rule literally would reject the mocks.
Fix: add a third named class — e.g. `glyph-frame: 50%`, restricted to state icons and radio marks and explicitly not a surface radius — so the rule stays total and enforceable.

**[Component coverage · coherence M6 + L8 / prd-fidelity A-5 low]** — The Score header spec is narrower than the decision and than the mock (§ Component Patterns; key-results.html)
Q8c surfaces the skipped count "wherever unanswered questions exist… including the per-Attempt results summary". The spine's row says only "Score appears; it does not perform… Names any ungraded gap". The mock resolved the composition — "You answered 12 of 15 correctly" plus "2 not correct · 1 unanswered · Finished in 23:11", including an elapsed-time element in no decision and no spine — and none came back. An implementer building from the spine ships a bare "12 of 15": the exact bare-number failure Q8c forbids. Related drift: § Voice and Tone says "You answered 11 of 15" where the mock says "…correctly" — the adverb is load-bearing, since with unanswered questions the spine's version is literally false.
Fix: specify the sub-line composition; specify or drop the elapsed-time element; adopt the mock's phrasing.

**[Component coverage · rubric / prd-fidelity B-6 / coherence L1]** — The trend sparkline has no window, no visual spec, and no stated membership rule (§ Component Patterns; § Open Questions #3; key-analytics.html)
"Across recent Practice Tests", with Open Question 3 honestly acknowledging the missing window. Three further gaps: no visual spec at all in DESIGN.md; nothing states what renders below a window's worth of Attempts, which is the Free-tier default the empty-state work went to lengths to handle; and nothing states whether retakes are members. The mock quietly answers the window at 5 attempts without saying so.
Fix: fix the window at five (matching the mock and FR-26), state membership, say what renders below the count, add a `trend-sparkline` component to DESIGN.md.

**[Component coverage · rubric]** — `dialog` and `snackbar` have visual spec and no behaviour (DESIGN.md § Components; § Component Patterns)
Snackbar is undefined on duration, dismissal, stacking, and live-region announcement — and § Accessibility Floor requires every state change that matters be announced via a live region, presumably the snackbar's job.
Fix: add behavioural rows for both, or drop `snackbar` if nothing uses it.

**[Component coverage · rubric]** — The FR-28 activity summary is three words in an IA row (§ IA → Analytics dashboard)
"Unstarted vs completed" is the v0 answer to "did my child do it", it leads the dashboard per FR-28, and the rendered mock leads with it — but it has no Component Patterns row, no visual spec, and no appearance in UJ-3's steps.
Fix: a Component Patterns row, and put it in UJ-3 step 2 or 3.

**[Component coverage · accessibility C5]** — Fractions announce twice, the two alternatives disagree, and the spine and mocks use different rendering mechanisms (key-take-test.html; key-results.html; DESIGN.md § Typography)
The input carries both `role="img" aria-label="3 over 4"` and an `.sr-only` "You typed 3 slash 4, shown as the fraction three quarters" — the value is heard three times in three forms. The convention drifts across artifacts (numeric in the input, word-form in results), and word forms break for improper, mixed and algebraic fractions. Separately, DESIGN.md specifies Literata's native OpenType `frac` while every mock composes fractions from stacked spans with a `border-top` — different rendering paths with different accessibility characteristics, for the hard case they exist to resolve.
Fix: one carrier, one convention product-wide — `aria-label="3 over 4"`. Remove the `.sr-only` duplicate. Add the convention to § Typography beside the `frac` rule, since generation must emit the structured form. Pick one rendering mechanism.

**[Component coverage · accessibility C10]** — Parent View tap targets below the stated 44px floor, with a false claim in the artifact (key-capture.html lines 133, 267, 281, 491)
Reorder icon buttons render 44 × **21px**, the page-row thumbnail **40** × 52px, the bar-row back control **32 × 32px**. Line 491 states "Every thumbnail, reorder pair, retake and delete control meets the 44px Parent View tap-target floor" — false for two of three, contradicted by the CSS immediately below it. Measured against the product's own floor, which is stricter than WCAG 2.1 AA. The Student Mode 48px floor holds throughout and was verified clean.
Fix: bring all three to a 44px hit area (the reorder pair can keep its 21px visual height via padding, provided the two do not overlap). Correct or delete the claim at line 491.

**[Component coverage · coherence M1]** — Page-thumbnail tap target: the memlog says 48px, every artifact says 44px (memlog Q10a vs Q5)
44 is the correct Parent View floor and Q10a's 48 looks like an inherited-by-mistake Student number, but it is an unreconciled contradiction in the canonical log with no entry recording the change.
Fix: a one-line memlog correction noting Q10a's 48px is superseded by the Q5 parent floor of 44px.

**[State coverage · accessibility C15]** — No live region for the state changes the spine itself requires be announced (§ Accessibility Floor vs key-results.html)
The score header is a plain `<div>` with no `role="status"`, and the degraded-grading state has no announcement mechanism at all. The ungraded→graded resolution is the sharp case: § State Patterns is explicit that a score can legitimately change between viewings and "must never read as the app changing its mind", and that a resolved Question "must be **visibly** a newly graded item". *Visibly* is the operative word — the requirement is stated in visual terms only, so for a user who cannot see it the score silently differs from last time, which is exactly the reading the design set out to prevent.
Fix: `role="status"` on the score header populated only on the degraded→resolved transition, never on first render; newly graded rows carry a visually-hidden "Newly graded" prefix, which satisfies SC 4.1.3 and the spine's own rule with one mechanism; same for submit confirmation and uncommitted-edit persistence.

**[State coverage · rubric]** — No cold-load / first-paint state for any surface (§ State Patterns)
Student Home, the Analytics dashboard, the Mastery table and Pending drafts all render server data; only the Explanation panel and Generation progress specify a loading treatment. Given the ban on motion outside four named cases, whether a skeleton is permitted is a real open question a builder will resolve by guessing.
Fix: one rule — what the product shows while a list or dashboard loads, and whether it is exempt from the motion ban.

**[State coverage · rubric]** — No error state for Upload / Classify, and the FR-5 page ceiling has no at-limit behaviour (§ State Patterns; § Component Patterns → Capture strip)
Legibility failure, thin Extraction and generation failure are covered. An outright upload failure, an oversized Page Image, and an 11th page against the 1–10 ceiling are not; the ceiling is mentioned with no behaviour attached.
Fix: one row covering the capture ceiling and upload failure.

**[State coverage · rubric / prd-fidelity B-12]** — Admin's three surfaces have no states at all (§ IA → Admin; UJ-4)
"Same tokens, no craft" is a defensible decided posture, but the Flagged Explanations queue is named in UJ-4 as the one Admin screen with a claim on real attention, and an empty queue — the normal case — has no treatment. Related: FR-30a specifies Admin consumption as two counters; the Explanation-cap override adds a third, and the Admin Parent Accounts screen is still described with the two-counter shape. The operator acts on tiers, and if the cap is the wall that generates support contacts, this is where it must be visible.
Fix: state explicitly that Admin inherits default states and receives no designed empty states — which is what the memlog decided — or give the flagged queue its empty and worked states. Add the third counter.

**[State coverage · prd-fidelity A-4c]** — Ungraded resolution can retroactively create a Weak Area, and no rule covers it (§ State Patterns; § Component Patterns → Mastery table)
The spine handles the *score* changing between viewings with care. It does not handle the same transition in Analytics, where a resolved batch of ungraded Questions can push a Topic across the five-question floor and produce a Weak Area flag that was not there an hour ago. The same problem recurs for a parent grade override, which mutates score and Mastery by design.
Fix: extend the "newly resolved, not silently altered" rule to the Analytics surfaces, and reuse it as the answer for the FR-25 override.

**[State coverage · accessibility C11]** — `prefers-reduced-motion` is absent from the screen with the most motion, and the fallbacks are unspecified (key-take-test.html; § Interaction Primitives)
The test-taking screen carries two of the five permitted motions and is the only key screen with no `prefers-reduced-motion` block, against a DESIGN.md Do/Don't that is unambiguous. Beyond the missing query, no artifact says what the fallback *is* for each permitted motion. "Honour it" is a policy, not a specification.
Fix: add the block and specify the fallback per motion — question→question: instant swap with focus to the new question heading; map open/close: instant; Explanation expand/collapse: instant, region appears in place; generation progress: determinate steps, no indeterminate sweep (the capture mock already does this correctly); route transitions: instant.

**[State coverage · accessibility R2]** — Focus management is unspecified for every navigation event (§ Interaction Primitives, § Component Patterns)
"Focus order follows reading order" is a static property. Nothing says where focus *goes* after Next/Back, a map jump, closing the map, opening or closing the submit dialog, or expanding an Explanation. Without a spec, focus resets to document start on each question change and a keyboard user tabs past the app bar, timer and counter fifteen times. The Explanation expand is subtler: `role="region"` with a label does not announce on expansion — nothing fires, so the wait resolves and nothing is spoken.
Fix: specify the target for each — Next/Back and map-jump → the question heading with `tabindex="-1"`; map close → the trigger; dialog open → the dialog heading, close → the trigger; Explanation expand → focus stays on the toggle while a polite live region inside the expanded area announces the loaded body.

**[State coverage · accessibility R3]** — The question-map panel is a dialog without modal semantics (key-take-test.html State 2)
`role="dialog"` over an `aria-hidden` surface and a scrim, with no `aria-modal`, no stated focus trap, no Esc-to-close, no focus restoration. Modal in every respect except the one that tells assistive technology it is. The submit confirmation two states later gets this exactly right.
Fix: match the submit dialog — `aria-modal="true"`, focus trap, Esc closes, focus restores to the trigger.

**[State coverage · accessibility R1 / prd-fidelity B-4 high]** — The silent PIN idle timeout is defensible, but not for the reason given, and screen-reader reading may not register as activity (§ State Patterns; memlog Q14a–c)
Accessibility accepts the no-warning decision and strengthens the argument: SC 2.2.1 governs time limits on *completing an activity*, and because Q14c makes durability a hard requirement the timeout is a re-authentication event, not a limit on completing an activity. It is **not** a security exception; SC 2.2.1 has none — which means the no-loss guarantee is load-bearing for conformance and cannot be traded away later as a scope cut, and nothing records that. The open hazard: a virtual cursor generates no scroll, pointer or key events on several common stacks, so a parent using a screen reader to read a 75-question draft — precisely the workload the 15-minute window was sized around, and the user who reads slowest — can be actively working and still trip a timer Q14a promises "never interrupts an actively working parent". PRD fidelity separately rates the whole 15-minute timeout a **high** unlogged PRD addition: FR-2 requires the PIN on every transition and nothing more, so session expiry, silent firing and the expensive uncommitted-input persistence obligation are all new, and architecture sees the consequence without the requirement that justifies it.
Fix: define activity to include assistive-technology reading, or fall back to a heartbeat not dependent on pointer and key events — this is the near-defect. Then make the duration configurable in Settings, which converts the question into an unambiguous SC 2.2.1 *adjust* pass for one setting; and announce the transition on arrival with `role="alert"`. Record the no-loss guarantee as accessibility-load-bearing, and log the timeout itself as a PRD addition.

**[State coverage · prd-fidelity A-4b]** — The FR-27 five-question floor interaction is gestured at, not specified (§ Grade States)
Three things unstated: whether ungraded Questions count toward the floor (excluded from the denominator, so presumably not — but they resolve later, so the floor can be crossed retroactively); whether the floor counts Questions inside FR-26's rolling window or across the profile's lifetime, which FR-27 does not say either; and what the empty-state copy's "He's answered 3 so far" counts, since under the four-state model "answered" must mean correct+incorrect only — worth making explicit because the number is shown to a parent.
Fix: state all three alongside the Mastery formula.

**[Flow coverage · prd-fidelity C-9]** — FR-13: deleting the last Question discards the Practice Test — no state specified (§ Component Patterns → Draft review)
Draft review says per-Question delete acts in place; it does not describe the floor, the block, or the transition when a parent deletes her way to zero — a destructive outcome reached by repeating an ordinary action, producing a *discarded* state that FR-14 says removes the test from all student-facing surfaces and from Analytics.
Fix: one State Patterns row covering the floor, the warning, and the discard transition.

**[Flow coverage · prd-fidelity C-10]** — FR-31 / FR-3: the Student Profile at-limit block has no state (§ Allowances & Limits)
FR-31 requires a hard block with a message naming tier, usage and reset date; FR-3 requires the same shape for the profile limit. The Allowances table covers Upload, Generation and Explanation thoroughly. The profile limit is the fourth cap in the product and is not covered at all.
Fix: a fourth row in Allowances & Limits, or a State Patterns row on the Students screen.

**[Flow coverage · prd-fidelity B-7]** — FR-9a's retake path is missing from the IA (§ IA → Generate)
The path from Generate back to Capture pages, which FR-9a requires, appears nowhere.
Fix: one IA edge.

**[Visual reference coverage · rubric]** — Seven rendered references, zero links (`.working/`; both spines)
Four of the seven are resolution, not exploration: `key-take-test` resolved the tablet question-map rail, `key-analytics` the drill-down cost block and the empty-state meters, `key-results` the grade-state encoding and the fraction text alternative, `key-capture` the generation-progress copy. Anyone consuming the spines cannot find the pictures that settled the arguments.
Fix: inline-link the four key-screen renders at the relevant sections naming what each shows; link the two theme explorations and the type pairing from DESIGN.md § Colors and § Typography.

**[Visual reference coverage · rubric / coherence]** — The spines-win-on-conflict rule is never stated, and the artifacts already conflict (§ Foundation)
§ Foundation states the DESIGN/EXPERIENCE precedence rule and says nothing about precedence over the rendered mocks. Across this review the mocks and spines disagree on grade-state labels, grade-state colour roles, the allowance reset date, the scrim value, the parent accent in light mode, tint tokens, the score-header composition, the fraction rendering mechanism, and the sparkline window. Without a precedence rule each is resolved by whichever artifact the implementer opened first.
Fix: one sentence in § Foundation — noting it cuts both ways, since several conflicts are cases where the *mock* is right and the spine is stale, so the rule needs to be "the spines win, and where a mock is right the spine gets corrected first".

**[Visual reference coverage · coherence M7]** — key-capture.html paints a light-mode screen with the dark-mode parent accent
The file declares `--primary:#0B5FA5` correctly, then hardcodes `#7FB6E8` — the dark value — as the shutter ring border and the Done button border on a light ground. It reads as a fifth accent no token defines, it is well below AA as a meaningful border on white, and the shutter is the most important control on the screen. It also breaks the one-token-diverges discipline the mock exists to demonstrate.
Fix: replace both occurrences with `var(--primary)`.

**[Visual reference coverage · coherence M8]** — The allowance reset date differs across the two mocks and the spine
"Resets 1 October" in capture and in the spine; "1 September" in analytics. All artifacts are dated 2026-08-29, so the next calendar-month boundary is 1 September. Example copy, so low blast radius alone — but it sits directly on Open Question 5, the unfixed month-boundary definition, and two mocks demonstrating two boundaries is how that open question turns into a bug.
Fix: make all three read 1 September, and resolve Open Question 5.

**[Bloat & overspecification · rubric]** — The responsive rule is stated twice, near-verbatim, in both spines (DESIGN.md § Layout & Spacing ¶5–6; § Responsive & Platform)
Both carry "Breakpoint-specific layouts only where the device changes the task", both name the same two screens, both carry "Density is split by surface; breakpoint is independent". Duplication across a spine pair is a drift surface.
Fix: keep the density-vs-breakpoint invariant in DESIGN.md and the per-screen layout table in EXPERIENCE.md, with a pointer rather than a restatement.

**[Inheritance discipline · rubric]** — The Weak Area threshold is stated in neither spine (§ Component Patterns → Mastery table; DESIGN.md § Components → Mastery row)
FR-27 sets it at below 60% Mastery with the five-question floor. EXPERIENCE.md names the floor four times and the threshold zero times; DESIGN.md gives `mastery-row` a `barFillOk` and a `barFillWeak` with nothing saying which fires when. The rendered mock even has an explicit threshold divider row. A builder cannot render the table without inventing a number.
Fix: state 60% in both places.

**[Inheritance discipline · rubric]** — The tablet question-map rail lost its binding no-mid-test-feedback qualifier (§ Responsive & Platform → Take Test)
The spine allocates the tablet surplus to "a persistently visible question map beside the Question" and drops the qualifier: the rail shows answered/not-answered state only — no score, no correctness hint, nothing constituting mid-test feedback. PRD §9.1 requires no mid-test feedback, so this is the constraint that keeps a persistent rail legal.
Fix: restore the qualifier.

**[Inheritance discipline · rubric / prd-fidelity A-6a / coherence L3 — disagreeing]** — The Q13a generation-progress reading is an unconfirmed interpretation presented as settled (§ State Patterns; § Voice and Tone constraint 3; UJ-1 step 6; § Open Questions #17)
The memlog is explicit that the user answered "A" among three A-variants and that "generation continues server-side and no work is lost" is the reviewer's interpretation. Open Question 17 flags it honestly, but the State Patterns row, the Voice and Tone constraint and UJ-1 step 6 all state it as decided fact, and the copy constraint is written as binding. The risk is asymmetric: if the interpretation is wrong, the shipped copy tells a parent something false. Coherence L3 verifies this as *properly handled*; rubric and PRD fidelity hold that flagging seventeen rows later does not offset three unhedged binding statements.
Fix: get the confirmation before handoff; until it lands, mark the State Patterns row provisional.

**[Inheritance discipline · rubric]** — Open Question #4, the profile switcher's outstanding-work signal, has a mitigation with no mechanism (§ IA)
§ IA commits to it "where that is cheap" — an escape hatch that will be read at build time as "skip it", quietly removing the mitigation that made the one-child-at-a-time Analytics scope acceptable for Family tier.
Fix: decide it. The FR-28 unstarted count is already computed for the dashboard, so "cheap" probably resolves to "yes".

**[Inheritance discipline · prd-fidelity B-7 / rubric low]** — FR-9a's warning content is specified in the PRD and dropped in the spine (§ State Patterns → Thin Extraction)
FR-9a requires the parent be shown the count of usable questions and the count of pages submitted, and requires that choosing to retake rather than proceed consumes no Generation Allowance. The spine reduces this to "Warned before generation fires, with proceeding allowed". The counts are the whole basis on which the parent decides; the no-charge point matters structurally, because everywhere else a cost is stated before it is spent and this is the one place the correct statement is "this costs you nothing".
Fix: name the counts and the no-charge guarantee in the State Patterns row.

**[Inheritance discipline · prd-fidelity B-10]** — Explanation grade-level source diverges from FR-24 (§ Voice and Tone constraint 4)
FR-24 pitches Explanation language to the **Practice Test's** Grade Level; the spine consistently says the **Student Profile's**. Not the same value — FR-7 lets a parent override Grade Level per upload and FR-3 lets a profile's Grade Level change without altering existing Practice Tests, so a Grade 5 profile promoted to Grade 6 mid-term gets Grade 6 language on Grade 5 explanations. The spine's choice may be better; it is not flagged as a choice.
Fix: pick one and log the departure if it is the spine's.

**[Inheritance discipline · prd-fidelity A-1a]** — The Explanation-cap override names only FR-31; three other PRD locations carry the same claim (§ Decisions That Travel Upstream → PRD overrides)
FR-24's final consequence reads "Explanation generation is never blocked by an Account Tier allowance (FR-31)"; §5.1 justifies ungated Explanations partly because a review gate would put a wall in front of a child mid-session; §9.1's MVP bullet describes Explanations without qualification. A PRD update executed literally would leave FR-24 stating the opposite of FR-31. Everything else about this override is verified complete across eight required consequences — this is the one crack in the best-traced decision in the document.
Fix: name all four sites.

**[Inheritance discipline · prd-fidelity A-1b]** — The Explanation cap's interaction with Retake is unexamined (§ Allowances & Limits; UJ-2 step 8)
FR-24 caches an Explanation against "the same Question **and answer**". A retake producing a different wrong answer is a cache miss and therefore a new Explanation, charged against the 10/month. The product's own student journey ends on Retake — the behaviour the cap most directly penalises, on the tier where it applies.
Fix: state the interaction and accept or mitigate it.

**[Inheritance discipline · prd-fidelity B-11]** — Dark mode is added to v0 scope without appearing in the PRD's MVP list (DESIGN.md; memlog line 9)
The memlog records honestly that the PRD states no dark-mode requirement, then decides dark mode ships in v0 — doubling the token surface and adding a contrast-verification obligation to every component. Defensible and cheap to build alongside, but v0 build scope §9.1 does not list, and it does not reach *Decisions That Travel Upstream*.
Fix: one row recording the scope addition.

**[Inheritance discipline · prd-fidelity D-1]** — Three respected non-goals interact to produce a dead end (§ Allowances & Limits; § Open Questions 11, 12)
Non-goal discipline is the strongest category in this review, and the refusal to name the Free tier as the cause of an empty dashboard *because there is no upgrade path* is a genuinely principled call. But the Free-tier Explanation cap creates the product's only wall landing on a person who cannot act on it, and *a limit a child meets* + *no notifications* + *no self-serve upgrade* means the resolution path is: the child stops asking, and the parent finds out only if she opens Analytics and thinks to look at a counter in Settings.
Fix: state it as an accepted cost of the override rather than leaving it to be discovered.

**[Inheritance discipline · coherence M5]** — The density chain's stated premise is false, and DESIGN.md contradicts itself about it (§ Layout & Spacing vs § Brand & Style)
"Spacing is the **only** remaining differentiator between the two rooms" against "carried by **accent hue and spacing density only**". Two sentences in one document disagree on the count, and the count is wrong in both — accent hue, spacing density, tap-target floor (48/44, pinned in the same section) and voice/address all differ by surface. The conclusion, two named density token sets, survives on its independent rationale; the premise is what an implementer will quote back when arguing that some other token may diverge "since spacing is the only split anyway".
Fix: rewrite to "the only *dimensional* differentiator" and cross-reference the full list of surface-divergent things once, in § Brand & Style.

### Low (16)

**[Token completeness · rubric]** — Two frontmatter shapes deviate from `design-md-spec.md`. `typography.timer.fontVariantNumeric` is outside the permitted subset; `typography.measure.questionMaxWidth` is not a typography object; `spacing.density` / `spacing.tap-target` nest below the flat scale. All read cleanly and a resolver flattens them, so this is a defect only against the letter of the spec. Fix: accept and note the deliberate extension, or move `measure` to a sibling `layout` key.

**[Token completeness · rubric / coherence L4]** — `dialog.scrim` / `scrimDark` are raw `rgba()` literals rather than named tokens, and `key-take-test.html` uses `0.48` against the spec's `0.55`. Fix: promote to `colors.scrim` / `colors.scrim-dark`; align the mock.

**[Component coverage · rubric]** — `answer-key-row` is the only paper-role component object with no `background` key, while `question-container` and `explanation-panel` both declare it. Fix: add `background: '{colors.background-paper}'`.

**[Component coverage · accessibility C16]** — Question-map cells announce their number twice, and State 3 degrades the markup. The visible `7` is not hidden, so the cell announces "7 Question 7, not answered, you are here" — fifteen times, on the most-used affordance on the screen. `.map-cell{cursor:default}` on a real `<button>` is wrong, and State 3 degrades the cells to `<span>` with the visually-hidden text removed entirely, inconsistent with the same component two states earlier. Fix: `aria-hidden="true"` on the number; `cursor:pointer`; make State 3 match States 1 and 2.

**[Component coverage · accessibility C17]** — `role="img"` fractions are opaque to braille and character navigation. Satisfies SC 1.1.1 and is the right call for AA, but the fraction becomes a single opaque node: a student on a braille display cannot inspect it digit by digit and gets the label as prose rather than Nemeth or UEB maths. A real limitation for a maths product, not a conformance failure at the committed level. Fix: record as an accepted v0 limitation with a named upgrade path — MathML with `alttext`, sourced from the structured fraction output § Typography already requires. The prerequisite is committed, so the upgrade is cheap later, provided nobody "simplifies" generation back to free-text fractions.

**[Component coverage · accessibility R7]** — The unanswered glyph is low-salience for a 10-year-old. An em-dash inside a 2px dashed circle at 14px; against a check, a cross and an ellipsis it is the least legible of the four at a glance for a young reader, and the dashed frame reduces it further. Cognitive and legibility, not WCAG. Fix: consider a hollow circle or a slash; test with an actual 10-year-old if any usability session happens.

**[Visual reference coverage · accessibility R4]** — Dark mode is unrendered; the declared pairs hold but the state-bearing washes have no dark values. Every declared dark pair was computed and all pass, most comfortably (7.64:1 to 15.55:1), and DESIGN.md's 14.05:1 claim is exactly right. The residual risk is entirely the divider at 1.27:1 and the undeclared washes. Fix: render one key screen in dark before dark mode is treated as verified — the results screen, since it carries all four grade states plus the tinted row grounds.

**[Bloat & overspecification · rubric, preference]** — Rejected-option archaeology in several § State Patterns cells. Memlog content, defensible here as a guard-rail against relitigation and genuinely short, so a preference rather than a defect. Fix: if trimmed, keep the rule and drop the rejected clause.

**[Bloat & overspecification · rubric, preference]** — § Open Questions runs 17 rows doing two jobs; eleven are post-launch revisit triggers rather than open questions. The list is also where three genuinely open items are currently buried. Fix: split into "Open" (1–5, 17) and "Revisit conditions" (6–16).

**[Inheritance discipline · coherence L7 / prd-fidelity C-11]** — Two of the three memlog coverage gaps did not survive distillation. The memlog records three gaps found during distillation; only the sparkline window reached Open Questions. The other two — Students and Settings unreached by any Key Flow, and the grade-dispute flag having no Parent View home — exist nowhere a downstream workflow will look, and the second is the FR-25 critical above, compounded by the FR-23 mis-citation. Fix: restore both to § Open Questions, noting the first is inherited from the PRD's journey coverage rather than introduced here.

**[Inheritance discipline · coherence L6]** — UJ-2 contradicts itself on how many questions Noah skipped. Step 4: "He skips one and uses the question map to jump back to it"; step 5: "**Two** Questions are unanswered"; step 6: "the **two** he skipped". Fix: make step 4 say he skips two and returns to one of them.

**[Inheritance discipline · prd-fidelity A-1c]** — SM-4 is not reconciled with the Free-tier cap. SM-4 targets an Explanation request in ≥40% of completed Attempts; a Free-tier cap suppresses the metric that validates the product's stated differentiator, on the tier most new accounts sit in. Fix: one line saying the metric is measured on uncapped tiers, or is expected to read low on Free.

**[Inheritance discipline · prd-fidelity A-6b]** — Pending drafts is a new Parent View surface not in PRD §6. A good addition, load-bearing for durable drafts and for the generation-progress reconciliation, that does not reach *Decisions That Travel Upstream*. Fix: log it.

**[Inheritance discipline · accessibility R5]** — The two rooms would become colour-distinguished only if the text marker ever moved. SC 1.4.1 is not engaged today — Parent View carries a persistent "Back to Student Mode" text control in every state, the copy register differs structurally, and no safety or authorisation consequence attaches to the distinction. But that control is the *only* non-colour signal of which room you are in, and DESIGN.md does not identify it as accessibility-load-bearing; it reads as a convenience affordance. Fix: one line in § Colors — the accent split may never be the only differentiator; Parent View chrome must always carry a persistent text marker.

**[Shape fit · rubric, preference]** — No Inspiration section, though the trigger arguably fires. The memlog carries four rejected palettes, four rejected type pairings, PT Serif rejected on a named filter, and an explicit anti-reference. The anti-reference is handled well inline in § Brand & Style and the rejects are exploration rather than reference products, so the omission is defensible. Raised only so the call is visible. Fix: none required.

**[Coherence L5]** — DESIGN.md's motion allow-list omits the question map. DESIGN.md permits motion "only for question transitions, expand/collapse, route changes, and the generation wait"; Q8a and § Interaction Primitives both name question-map open/close. Defensible as covered by "expand/collapse", but the two lists should read identically. Fix: add it to the DESIGN.md line.

## Mechanical notes

- **Frontmatter.** Both files carry `title`, `status: draft`, `created`, `updated`, `sources`, all present and consistent; `DESIGN.md` additionally carries the full spec frontmatter. All `sources` paths resolve.
- **Cross-references.** One broken FR citation: `EXPERIENCE.md` line 94, "the FR-23 grade-dispute flag" → **FR-25**. The error originates in the memlog (Q9b) and propagated cleanly, so it is wrong anywhere else that entry was consumed. All `{token}` cross-references resolve in both directions.
- **Memlog hygiene.** Q13b cites "the Q10 override", which does not exist — the Explanation-cap override is an untagged `(override)` entry between Q9c and Q10a. Tag it and correct the citation; no downstream artifact repeats the bad reference.
- **Memlog contradiction.** Q10a specifies 48px page-thumbnail targets; the Q5 Parent View floor is 44px and every artifact uses it, with no entry recording the change.
- **Name consistency.** Component names are byte-identical across `DESIGN.md` frontmatter, `DESIGN.md` § Components and `EXPERIENCE.md` § Component Patterns. No drift found.
- **Literal-copy drift.** Two grade-state labels differ from the decided values. Both appear in more than one place, so a fix must touch § Grade States, `DESIGN.md` § Components → Answer-key row, UJ-2 step 6, and `key-analytics.html` including its accessibility note.
- **Mermaid.** No diagrams in either file. The IA is a table, which is the right call at 15 screens.
- **Numbers.** All figures traceable: 34rem measure, 15-minute timeout, 48/44px targets, 1–10 pages, 10 Explanations/month, 5-question floor, 8px base. The numbers that should exist and do not: the 60% Weak Area threshold, the sparkline window, the focus-ring width and offset, the hover-tint value, and a settled Generation Allowance unit.

## Preserve through revision

Stronger than required, and cheap to lose in a later pass by someone optimising for consistency — each is listed so the loss is a decision rather than an accident.

1. Grade states carry **four** redundant non-colour carriers where AA requires one. Keep the row-rule texture in particular: it is the carrier that still works when scanning a long answer key at a distance, and the one most likely to be pruned as decorative.
2. The question map is the best-executed component in the set — real buttons, per-cell hidden state strings, `aria-current`, 48×48 minimum, a focus ring, an on-screen legend. Do not let a later "simplify to a grid of divs" refactor undo it.
3. Question body contrast at 16.56:1 light / 14.05:1 dark — AAA, kept because it fell out for free.
4. The sparkline has a complete text alternative with every data point spoken; the empty-state meters do the same. Charts with genuine alternatives are rare.
5. No inline bar is ever the sole carrier of its value — decided as a data-integrity rule, and it discharges SC 1.4.1 for the Mastery table for free.
6. One type scale, sized for the harder case: the parent dashboard is forbidden from shrinking text to earn density.
7. Tap-target floors are pinned separately from the density token so `density.compact` can never reduce them — the mechanism is right even where execution slipped.
8. Every result and analytics string is required to be parameterised, never a literal, which is what makes distinct per-state, per-surface announcements possible at all.
9. The Explanation wait is correctly instrumented (`aria-busy`, `role="status"`, `role="alert"` on failure, wait bar stilled under reduced motion) and is the pattern the other three screens should copy.
10. `EXPERIENCE.md` names its own open accessibility questions rather than papering over them.

Also worth protecting, from the PRD-fidelity lens: the Explanation-cap override's consequence tracing (eight required consequences, all verified present and consistent); the generation-progress reconciliation, which is genuine rather than verbal because durable Pending drafts is what lets the copy advise staying *without* claiming loss; the skipped-count addition, applied consistently to the three surfaces it claims; and the non-goal discipline in §D — particularly the refusal to introduce upsell copy on a tier with no exit. From the coherence lens: eight of nine load-bearing decision chains verified end to end, including serif-by-content-not-by-surface, zero `box-shadow` declarations anywhere, and byte-identical neutrals and semantics across all four mocks with one diverging accent.

## Reviewer files

- `review-rubric.md`
- `review-coherence.md`
- `review-prd-fidelity.md`
- `review-accessibility.md`
