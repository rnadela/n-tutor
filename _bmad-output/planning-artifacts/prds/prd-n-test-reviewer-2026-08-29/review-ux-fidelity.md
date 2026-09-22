# Review — UX Fidelity Lens (reverse direction)

**Target:** `prd.md` (838 lines, FR-1 – FR-38)
**Source of truth:** `ux-designs/ux-n-test-reviewer-2026-08-29/{EXPERIENCE.md, DESIGN.md, .memlog.md}`
**Method:** the merge is uncommitted, so the exact merge delta was read as `git diff HEAD -- prd.md` (171 insertions, 36 deletions) and checked line-by-line against EXPERIENCE.md §Decisions That Travel Upstream, the D1/D3–D8 disposition table, §Grade States, §Mastery, and §Constraints landing on architecture and prompt work.
**Date:** 2026-08-31

---

## Verdict

The merge landed **substantially complete and substantially faithful**. Every item in the departures disposition table (D1, D3–D8) and the FR-31 Explanation-Allowance override reached the PRD, and the two known-subtle conditions (`unanswered` excluded at timer expiry; skipped-count scoped to untimed and manually submitted Attempts) both survived translation with their conditions intact.

Two real defects: one **CRITICAL** self-contradiction introduced inside FR-34 that inverts D5, and one **HIGH** missing clause from D5. The remaining findings are over-application — UX interaction mechanics, ARIA attribute names, and literal copy strings pulled into a document that says of itself "the PRD otherwise stays at capability level" (§6).

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 3 |
| Medium | 7 |
| Low | 6 |
| **Total** | **17** |

---

## Critical

### C1 — FR-34's binding rule cites FR-4, which says the opposite. D5 is inverted.

- **UX source:** `EXPERIENCE.md` §Departures from the PRD, logged — row **D5**: "Prompt **restored** on the deliberate 'Back to Student Mode' path. The **silent idle timeout cannot prompt** and binds to the **last-bound Student Profile**." Disposition: "**Partial departure, scoped to the silent path only.**"
- **PRD location:** `prd.md:147` (FR-34, bullet 3) and `prd.md:136` (FR-4, bullet 1)
- **What drifted:** FR-34 bullet 3 reads:

  > On expiry the device lands in Student Mode bound to the Student Profile it was last bound to, **following the same binding rule as an explicit exit (FR-4)**.

  FR-4 bullet 1 is unchanged and unconditional:

  > On a device with more than one Student Profile, exiting Parent View **prompts** which Student Profile the device should bind to.

  The two halves of FR-34's own sentence contradict each other. "Bound to the profile it was last bound to" is the D5 rule; "the same binding rule as an explicit exit (FR-4)" is the prompt rule that D5 says the silent path **cannot** use. A story writer reading FR-34 to its cross-reference will implement a modal prompt on a timeout that fires while nobody is at the tablet — precisely the failure D5 was written to prevent. The merge added a new requirement that points at an un-amended old one.
- **Fix:** Delete the trailing clause from FR-34 bullet 3 and make the scoping explicit in both places.
  - FR-34 bullet 3 → "On expiry the device lands in Student Mode bound to the Student Profile it was **last bound to**. The silent path cannot prompt, so it never does — this is deliberately *not* the explicit-exit rule of FR-4."
  - FR-4 bullet 1 → add the scope: "On a device with more than one Student Profile, **deliberately exiting** Parent View prompts which Student Profile the device should bind to. A silent FR-34 idle expiry does not prompt and binds to the last-bound profile."

---

## High

### H1 — D5's initial-binding rule reached neither the PRD nor a "stays in UX" disposition.

- **UX source:** `EXPERIENCE.md` D5: "**Initial binding is set at first Student Profile creation.** The earlier undefined 'the correct Student Profile' is replaced by this rule."
- **PRD location:** absent — not in FR-3 (Student Profile management), FR-4, or FR-34.
- **What is missing:** "last-bound profile" is only well-defined if something defines the *first* binding. On a fresh multi-profile account whose device has never been bound, FR-34 has no answer and FR-4's prompt is unreachable (the timeout is silent). D5 supplies the rule; the merge dropped the half that makes the other half computable.
- **Fix:** Add to FR-3 or FR-4: "A device's initial Student Profile binding is set when the first Student Profile is created on that account. Every subsequent binding, explicit or silent, replaces it."

### H2 — FR-5 and FR-15 were edited despite being on the no-change list, and FR-5's edit exceeds its stated disposition.

- **UX source:** `EXPERIENCE.md` §Corrections to this workflow's own record — "**Camera roll is not a PRD gap.** … The earlier 'gap closed' framing would have produced a duplicate PRD requirement. The behavioral elaborations stand and are worth keeping … FR-5's own ambiguity … is resolved in favor of **multi-select**, **and that resolution is stated in the Capture strip pattern**." (i.e. the resolution's home is UX.) And: "**No PRD change is required for this** [FR-15 expiry], **and none should be raised.**"
- **PRD location:** `prd.md:179–180` (FR-5), `prd.md:312–317` (FR-15)
- **What happened:**
  - **FR-5** — the old bullet "Pages are captured or selected one at a time and appended in order" was replaced by two bullets. Bullet 1 (camera one-at-a-time / library multi-select) is a *defensible* upstream fix: it removes a genuine self-contradiction the UX session identified inside FR-5, and leaving it would have left the PRD contradicting itself. Keep it, but note it as a deliberate deviation from the "no PRD change" disposition rather than an unremarked edit. Bullet 2 — "how it got there is never surfaced — there is no shot-versus-selected distinction **in the UI**, in ordering, or in any downstream behavior" — is the behavioural elaboration EXPERIENCE.md explicitly assigned to the Capture strip pattern. It should not be here (see M1).
  - **FR-15** — the expiry bullet was edited: a sentence was appended ("This is the one path by which a Question the student did not answer is graded incorrect rather than *unanswered* (FR-37)"). The appended sentence is **accurate and faithful** to §Grade States and is arguably necessary now that FR-37 exists, but it is an edit to a line the disposition said to leave alone. FR-15 additionally gained two wholly new bullets (see M2).
- **Fix:** Retain FR-5 bullet 1 and the FR-15 cross-reference sentence, and record both in the merge log as intentional deviations from the no-change list, so the next fidelity pass does not read them as accidental. Remove FR-5 bullet 2 and the FR-15 additions flagged in M1/M2.
- **No duplicates found.** None of the eight no-change items now has a second FR stating the same rule. FR-24 was also edited, but only its allowance bullets — the item actually on the list, "Explanation language is pitched to the Practice Test's Grade Level" (`prd.md:435`), is byte-identical to HEAD, which is the correct outcome given D2's retirement. FR-9a, FR-10 (async), FR-26 (ungraded exclusion), FR-28 (Subject filter), and FR-31 (Practice-Test denomination) are untouched.

### H3 — ARIA attribute names in §10 are implementation, not capability.

- **UX source:** `EXPERIENCE.md` §Accessibility Floor and `DESIGN.md` §Components — these own `role="timer"`, `aria-live` politeness thresholds, `role="alert"`, and `role="img"` on fractions.
- **PRD location:** `prd.md:756–759`
- **What drifted:** §10 now names four specific ARIA roles and an `aria-live` policy. §6 of this same PRD states "the PRD otherwise stays at capability level," and §10 is the section that sets the WCAG target — not the section that specifies the markup that meets it. Naming the attributes here makes the PRD the authority on an implementation choice UX already owns, and freezes a technique (e.g. an `aria-live` region) that an equally conformant implementation might meet differently.
- **Fix:** Reduce to the requirement and cross-reference the owner. E.g. "The timer is exposed to assistive technology as a timer, named by what it counts down. Announcements are made at the three warning thresholds and are otherwise silent — a per-second announcement makes the test unusable with a screen reader. Auto-submit is announced and focus moves to the results heading. Each rendered fraction carries a spoken alternative reading as the number. Implementation of these is specified in the UX Accessibility Floor." Keep the **SC 2.2.1 essential-exception argument** exactly as written — that is a compliance posture, correctly PRD-level.

---

## Medium — over-application

Each of these dragged UX behaviour-level detail into a capability-level document. None is factually wrong; all over-constrain the build and create a second place the UX artifacts must be kept in sync with.

### M1 — FR-5 bullet 2 specifies UI behaviour
`prd.md:180`. "…never surfaced — there is no shot-versus-selected distinction **in the UI**, in ordering, or in any downstream behavior." The PRD-level requirement is the last clause only: provenance carries no downstream behavioural difference. The UI half belongs in `EXPERIENCE.md` §Component Patterns, Capture strip.
**Fix:** trim to "Camera-captured and library-selected pages mix freely within one Source Test in any order, and provenance carries no downstream behavioural difference."

### M2 — FR-15 now specifies timer placement, input unit, and warning visual treatment
`prd.md:312–316`. Three separable over-applications:
- "Timer configuration **lives in Draft review** … not in a separate settings surface and not as a step after release" — surface placement is IA, owned by `EXPERIENCE.md` §Information Architecture. The product requirement is that the timer is set **before release** (already in FR-15 and FR-14).
- "Duration is expressed **in minutes**" — input-unit choice, `DESIGN.md` §Components / Timer.
- "All three use **identical treatment** — the same wording pattern, the same visual weight, the same audibility. The sequence deliberately does **not** escalate: a 20-second warning that shouts louder…" — this is visual and motion design with its design rationale attached. `DESIGN.md` owns it.

**What is legitimately PRD-level:** that pre-expiry warnings exist, that there are three of them, at 5 min / 1 min / 20 s, and that they must not escalate in intensity (a product-tone commitment tied to §7). Keep that sentence; move the treatment specification and the rationale paragraph to `DESIGN.md`.

### M3 — FR-28 names the widget
`prd.md:544`. "The dashboard carries a **trend sparkline**: a single dashboard-level line…". `DESIGN.md` §Trend sparkline owns the component. The product requirement — already present in FR-28's own headline and in the following two bullets — is *a per-profile score trend computed over the 5 most recent qualifying Attempts, excluding retakes, at a deliberately different scope from FR-26's per-Topic window*. That is the load-bearing content and it should survive; "sparkline" should not, because it forecloses a bar or dot rendering that satisfies the requirement identically.
**Fix:** "The dashboard carries a **profile-level score trend**, computed over the 5 most recent qualifying Attempts for that Student Profile, with retake Attempts excluded on the same basis as FR-26. Its rendering is specified in UX."

### M4 — FR-22 specifies component anatomy for the grading rationale
`prd.md:410`. "…readable by the parent on the Question's own row in Attempt detail, **collapsed by default and expandable in place**." The UX constraint index states the requirement as "**Persisted and readable, not merely logged** — it is the evidence the override is decided on." Collapsed-by-default-expandable-in-place is disclosure mechanics from `EXPERIENCE.md` §Component Patterns, Grading rationale.
**Fix:** keep "persisted with the Attempt and readable by the parent where the override decision is made (Attempt detail); writing it only to a log does not satisfy this requirement." Drop the disclosure mechanic.

### M5 — FR-10 specifies control state, not capability
`prd.md:252`. "counts exceeding the remaining Generation Allowance are shown **disabled with the reason stated** … never hidden." Disabled-versus-hidden is a control-state decision from `EXPERIENCE.md` §Allowances & Limits. The requirement is that the ceiling and its reason are **visible before initiation**. The adjacent bullet — server-side clamping, independent of what the client sent — is correctly PRD-level and matches the UX constraint index verbatim; keep it unchanged.
**Fix:** "The remaining ceiling and the reason for it are visible to the parent before the action fires; the option is never silently absent."

### M6 — Four literal copy strings crossed the boundary
`prd.md:252` (`"2 of 2 used this month"`), `:254` (`"this will use 3 of your remaining 4"`), `:376` (`` `First 11/15 · Latest 14/15 · 3 attempts` ``), `:416` (`"11/14 graded — 1 question could not be graded yet"`), `:463` (`"11/15 → 12/15, adjusted by parent"`). `DESIGN.md` owns strings; §7 of the PRD explicitly forbids fixed literals for exactly this class of string ("No result or analytics string is a fixed literal"), so the PRD is illustrating with the artefact it prohibits. The `·`-separated FR-20 example is the worst of the five — it fixes a separator character and a field order.
**Fix:** keep the *informational content* each example demonstrates (usage-against-limit; pending cost in Practice Tests; first score + latest score + Attempt count with the first marked as counting; graded denominator named explicitly; prior and adjusted score both visible) and drop the literal renderings, or demote each to a parenthetical "(e.g. …)" that is explicitly non-normative.

### M7 — The Free Explanation cap number "10" is now stated in four normative places
`prd.md:648` (§5.3 table), `:437` (FR-24), `:672` (FR-31), `:727` (§9.1). §12.2 item 3 records that the tier values are unevidenced guesses to be recalibrated after a month of real accounts. Four normative copies of a number scheduled to change is a drift hazard; the same pattern applies more mildly to the 15-minute idle window (FR-34, §10, §9.1, Assumptions 9) and the timer thresholds (FR-15, §9.1, §10).
**Fix:** make the §5.3 table the single normative source for every tier number and have FR-24, FR-31, and §9.1 refer to it by name ("the tier's Explanation Allowance (§5.3)") rather than restating the value. The behavioural rules — generation capped, reading never capped, grading uncapped — stay where they are.

---

## Low

### L1 — FR-37 and FR-28 word the same condition two different ways
`prd.md:471` (FR-37): "It arises only from a **manually submitted** Attempt…". `prd.md:542` (FR-28): "The unanswered count applies **only to untimed and manually submitted** Attempts."
Both are correct against `EXPERIENCE.md` §Timer expiry (an untimed Attempt can only be submitted manually, so "untimed" is a subset of "manually submitted"), but FR-28's phrasing implies the two are disjoint, which invites a reader to wonder what an auto-submitted untimed Attempt would be. **Fix:** use one phrasing in both — FR-37's enumeration is the clearer one: "an untimed Attempt submitted with gaps, or a timed Attempt submitted manually before expiry."

**Fidelity of the two known-subtle rules is otherwise clean.** FR-37 bullet 4 states the expiry carve-out explicitly and non-conditionally; FR-15's expiry bullet, FR-19, FR-23, FR-26, FR-27, and the §3 glossary all carry it consistently; and FR-28's skipped-count bullet pair reproduces `EXPERIENCE.md` §Mastery's scoping ("for untimed and manually submitted Attempts only") including the reason. Nothing was flattened to unconditional in either direction.

### L2 — §9.2 restates FR-36 at paragraph length
`prd.md:742`. The offline carve-out now appears in full in both FR-36 and the Out-of-Scope bullet. §9.2 is a scope list; a pointer suffices. **Fix:** "**Offline test-taking** — network required, with one carve-out inside an already-started Attempt (FR-36)."

### L3 — FR-16's "show older" control
`prd.md:333`. "…nothing ages out, is collapsed behind a 'show older' control, or is archived by the system." Naming a control the product does not have is UI vocabulary. The requirement is that completed Practice Tests remain listed indefinitely and reachable. **Fix:** drop the middle clause.

### L4 — FR-8's batching timing
`prd.md:209`. "The check runs **once, as a single batch over all pages, immediately after capture is finished** — not per page as each is added." This is partly a cost/architecture decision (one vision call, not N) and partly interaction sequencing. It reads as the latter. **Fix:** state it as the cost/UX outcome — "the parent receives one verdict covering the whole Source Test at one moment, not a verdict per page" — and let the batching follow.

### L5 — §6 Surfaces mirrors the UX IA at UX granularity
`prd.md:688`. The Parent View surface list grew to enumerate Pending drafts, Source Test detail, Attempt detail, Allowances, and Settings sub-items. §6 is titled Information Architecture so this is not out of place, but it is now a second copy of `EXPERIENCE.md` §Information Architecture that will drift. **Fix:** acceptable as-is if the PRD is declared the owner of the surface inventory and UX the owner of navigation within it; state which, once, at the top of §6.

### L6 — §7's mode-of-address rule carries its examples
`prd.md:696`. The parameterized-string rule ("Student Mode addresses the student in the second person, Parent View names the child in the third person") is genuinely product-level and belongs in §7 — it is the rule that makes one dashboard readable by two people. The illustrative strings ("you left 3 questions unanswered" / "Noah left 3 questions unanswered") are `DESIGN.md`'s. Minor; the rule is hard to state without them. **Fix:** optional — mark them explicitly non-normative.

---

## Completeness ledger

| UX item | Disposition in UX | Landed in PRD | Verdict |
|---|---|---|---|
| **FR-31 / §5.3 override** — Free Explanation Allowance 10/mo; reading never capped; grading uncapped | "Belongs in a PRD update" | §3 glossary, §5.3 table + prose, FR-24, FR-30a, FR-31, §9.1, §12.1 rows 3 & 7, §12.2 items 6/7/10/11 | ✅ Landed complete. All three named consequences present (third counter, Student-Mode at-cap state, Admin Explanation column). Over-stated in four places — see M7 |
| **FR-15 expiry correction** — no PRD change required, "none should be raised" | Stays in UX | FR-15 unchanged except an appended FR-37 cross-reference | ✅ Correct outcome; the edit is noted in H2 |
| **Camera roll** — not a PRD gap; elaborations stay in the Capture strip pattern | Stays in UX | FR-5 edited (2 bullets) | ⚠️ Bullet 1 defensible, bullet 2 over-applied — H2, M1 |
| **D1** — flat Student Home list, no Subject grouping | Departure stands | FR-16 headline rewritten + 3 bullets | ✅ Landed faithfully, including the sort that replaces the grouping |
| **D3** — dark mode ships in v0 | Departure stands | §6, §9.1, §10 | ✅ Landed |
| **D4** — Parent View idle timeout, 15 min, silent; uncommitted work persists | New requirement, UX-originated | FR-34, FR-35, §10 Security, §9.1, Assumptions 9 | ✅ Landed complete, including the hard consequence (FR-35 enumerates all four persistence cases from the UX constraint index) |
| **D5** — prompt on deliberate exit only; silent path binds last-bound; initial binding at first profile creation | Partial departure, silent path only | FR-34 bullet 3 | ❌ **Landed distorted (C1) and incomplete (H1)** |
| **D6** — Subject filter on the Mastery table | Restored | FR-28 unchanged — already present | ✅ Correctly absent from the diff |
| **D7** — FR-9a counts + no-Generation-Allowance guarantee | Restored | FR-9a unchanged — both already present | ✅ Correctly absent from the diff |
| **D8** — Explanation counter in Admin consumption view | Restored | FR-30a rewritten | ✅ Landed, plus the per-account reset-period rendering and the flagged-queue Grade Level context |
| **D2** | Retired — no override to carry | FR-24's Grade Level bullet untouched | ✅ Correct |
| Grade-adaptive Explanation language from the **Practice Test's** Grade Level | Architecture-facing | FR-24 (unchanged), FR-30a (queue shows Grade Level) | ✅ |
| Fractions as structured generation output + spoken alternative | Architecture / prompt | FR-9, FR-10, FR-24, §10 | ✅ (ARIA specifics over-applied — H3) |
| FR-25 dispute surface = Analytics dashboard, override in Attempt detail | Architecture-facing | FR-25 | ✅ |
| FR-24a flag routing — student flag reaches Admin only on parent confirmation | Architecture-facing | FR-38, FR-30a | ✅ |
| Three counters, one calendar-month boundary, per-account timezone, atomic reset | Architecture-facing | FR-1, FR-31, FR-30a, §3 | ✅ |
| Generation request clamped server-side | Architecture-facing | FR-10, FR-11 | ✅ |
| Four grade states carried through storage / answer key / Mastery / drill-down | Architecture-facing | FR-23, FR-26, FR-27, FR-29, FR-37, §3 | ✅ |
| Override retains original AI grade + rationale; visible in Student Mode | Architecture-facing | FR-25 | ✅ |
| Grading rationale persisted and readable, not merely logged | Architecture-facing | FR-22 | ✅ (anatomy over-applied — M4) |
| Uncommitted parent input persists without explicit save | Architecture-facing | FR-35 | ✅ |
| Ungraded retries on next view, no background job, legible transition | Architecture-facing | FR-22 | ✅ |
| Timer expiry resolvable offline, graded at the expiry moment | Architecture-facing | FR-36 | ✅ |
| Smart fraction field implementation risk + display-only fallback | Owned by UX Accessibility Floor | absent | ✅ Correctly absent — build-estimation note, not a product capability |
| Continuous capture (camera stays open across pages) | UX interaction decision (`.memlog` 41) | absent | ✅ Correctly absent |
| At-cap copy "You've used all 10 explanations this month…" | UX copy (`.memlog` 49) | FR-24 states the message's required *content* only | ✅ Correct altitude |

**No UX decision failed to land outright.** The only completeness gap is H1 (D5's initial-binding clause).

---

## Direction-of-authority summary

PRD text that now restates a UX implementation choice as a product requirement, over-constraining the build:

1. `prd.md:312` — FR-15, timer configuration **located in Draft review**. Requirement is *before release*; the surface is UX's.
2. `prd.md:313` — FR-15, duration **expressed in minutes**. Input unit is UX's.
3. `prd.md:315` — FR-15, warning **treatment** (identical wording pattern, visual weight, audibility) and its rationale. Requirement is *three non-escalating warnings at 5 min / 1 min / 20 s*; the treatment is DESIGN.md's.
4. `prd.md:252` — FR-10, over-allowance counts **shown disabled**, not hidden. Requirement is *the ceiling and its reason are visible before initiation*.
5. `prd.md:410` — FR-22, rationale **collapsed by default, expandable in place**. Requirement is *persisted and readable where the override is decided*.
6. `prd.md:544` — FR-28, the trend is a **sparkline**. Requirement is *a per-profile score trend over 5 qualifying Attempts, retakes excluded*.
7. `prd.md:180` — FR-5, no shot-versus-selected distinction **in the UI**. Requirement is *provenance carries no downstream behavioural difference*.
8. `prd.md:333` — FR-16, nothing collapsed behind a **"show older" control**. Requirement is *completed tests remain listed indefinitely*.
9. `prd.md:756–759` — §10, four literal **ARIA role/attribute names**. Requirement is the announcement behaviour; the markup is UX's.
10. `prd.md:252, :254, :376, :416, :463` — five literal **copy strings**, one of which (`First 11/15 · Latest 14/15 · 3 attempts`) fixes separator and field order.
