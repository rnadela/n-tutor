---
lens: internal-consistency
target: prd.md (838 lines, FR-1..FR-38)
reviewed: 2026-08-31
findings: 16 (2 critical, 3 high, 6 medium, 5 low)
---

# Internal Consistency Review — n-test-reviewer PRD

Scope: contradictions, stale statements, and broken cross-references *inside* the document
(plus its addendum) after the 27-change update. Ranked by damage if the defect reached
architecture or implementation.

**Headline:** the Free Explanation cap — the change most likely to have gone stale — is
clean at every one of its eight sites. The real damage sits in the **grade-state work
(FR-37)**, which was added as a *state* but never given an *enforcement point* or a
*score arithmetic*, and in **FR-35's retained upload state**, which has no home and no
retention regime.

---

## CRITICAL

### C-1. The Attempt score denominator for *unanswered* is undefined, and every worked example contradicts FR-37

- **Location A:** FR-37, line 475 — "An *unanswered* Question is never shown as a wrong
  answer the student gave, **and never counted as one**."
- **Location B:** FR-23, line 423 — "The results screen shows **the overall score**" (no
  denominator rule). Reinforced by FR-20 line 373 (`First 11/15 · Latest 14/15 · 3 attempts`)
  and UJ-2 line 56 ("11/15").

**What breaks.** FR-26 tells you how *Mastery* treats unanswered (excluded from both terms,
line 516). FR-28 tells you how the *dashboard* pairs it (line 541). FR-22 tells you how
*ungraded* bends the score denominator and requires the gap be named out loud (line 416,
"11/14 graded — 1 question could not be graded yet"). Nothing tells you what unanswered does
to the **Attempt score itself**. The only worked examples in the document use a full
denominator — `11/15` on a 15-question test — which is exactly "counted as one wrong answer."
An implementer has two defensible readings that produce different numbers on the flagship
screen: `11/15` (unanswered in the denominator, i.e. scored as wrong) or `11/13` (excluded,
matching FR-26 and FR-37). The document proves it knows this must be stated — FR-22 states it
for the other new state — and then does not state it for this one.

**Severity rationale.** This is the score. It appears on the results screen, the Student Mode
card, the Attempts list, Attempt detail, and the FR-28 trend sparkline. Getting it wrong is
not recoverable by a later fix, because historical Attempt records will have been written
under whichever reading shipped.

**Minimal fix.** One consequence bullet under FR-23, parallel in shape to FR-22's:

> The results header scores over correct + incorrect only. Questions in the *unanswered*
> state are excluded from both terms and reported alongside, never silently folded into the
> denominator (e.g. "11/13 · 2 unanswered"). The FR-20 first/latest display and the FR-28
> sparkline use this same figure.

Then correct the `11/15` in FR-20 line 373 to a figure with no unanswered Questions, or
annotate it.

---

### C-2. FR-37 has no enforcement point — no FR excludes unanswered Questions from the FR-21 / FR-22 grading path

- **Location A:** FR-37, line 472 — unanswered is "carried through Attempt storage ... as a
  first-class state, **not derived at display time from an empty answer field**."
- **Location B:** FR-21 (line 396, "grades Multiple Choice Questions by exact option match")
  and FR-22 (line 404, "grades Fill-in-the-Blank and Short Answer Questions on semantic
  equivalence to the correct answer"). Neither carves out a Question with no answer.

**What breaks.** FR-19 says unanswered Questions are *recorded* with the state (line 361).
FR-37 says the state must not be derived at display time. But grading is defined as an
unconditional function of Question Format, and it runs *at submission*, before display. Read
literally, an unanswered Short Answer goes to the AI grader as an empty string and comes back
`incorrect` — at which point the stored state is `incorrect`, FR-37's "not derived at display
time" is satisfied trivially and wrongly, and FR-26/FR-27/FR-28/FR-29 all silently degrade
because the unanswered state they depend on never exists in the data. FR-37 is the only FR
that would be violated, and it is violated by an implementation that read FR-21 and FR-22
correctly.

This is also a cost defect: every blank Short Answer becomes a billed grading call.

**Minimal fix.** Add to FR-19 (or as a shared consequence on FR-21 and FR-22):

> A Question with no student answer on a manually submitted Attempt is assigned the
> *unanswered* state at submission and is never sent to the grader. Neither FR-21 nor FR-22
> is invoked for it, and it produces no grading rationale.

---

## HIGH

### H-1. FR-4 vs FR-35 — the applied reading holds, but only under an architecture the PRD does not state (known contradiction #1)

- **Location A:** FR-4, line 137 — "In Student Mode, no upload, generation, release,
  cross-profile data, or Analytics surface is reachable — not by navigation, not by direct URL."
- **Location B:** FR-35, line 159 — "A partially completed upload is retained: captured or
  selected Page Images, their order, and the Subject and Grade Level classification chosen so
  far ... **No Page Image is lost to expiry.**"

**Verdict on the reading.** *The applied reading holds, but it is not free.* FR-4 constrains
**surfaces** — routable, navigable UI. Retained state is not a surface, so the two FRs do not
contradict on their own terms. But the reading survives only if a third statement is honored,
and that statement is in a different section: §10 Security, line 753 — "Student Mode
restrictions are **not client-side-only** (FR-4)." Together those force a conclusion the PRD
never draws:

> **The retained upload state, including Page Image bytes, cannot live on the client.**

FR-35's own wording pushes the opposite way. "Persists ... **without an explicit save**" and
"restored **exactly**" is the natural description of a local draft buffer — `localStorage`,
IndexedDB, an in-memory store rehydrated on reload. Every one of those puts photographs of a
named child's schoolwork on a device sitting in Student Mode, readable by anyone with
devtools, and one careless component-mount away from re-rendering the thumbnail strip *inside*
Student Mode. FR-4 would then be violated in fact while being satisfied on paper.

**What it implies for where that state lives.** Server-side, keyed to the Parent Account,
returned only on an authenticated Parent View session established by a fresh PIN entry
(FR-34 line 148). Page Images already upload to storage; the uncommitted set is a
server-held draft Source Test, not a client buffer. That is a real architecture constraint
and it is currently discoverable only by cross-reading three sections.

**Minimal fix.** One consequence bullet on FR-35:

> Retained uncommitted state is held server-side against the Parent Account and is not
> readable by a device in Student Mode by any path. It is returned only after a successful
> PIN re-entry. A client-local draft buffer does not satisfy FR-35, because it would place
> Page Images within reach of Student Mode (FR-4, §10 Security).

**Second-order gap, not previously named:** FR-35 does not scope the persistence. Restored
*where* — the same device, or any device the parent next signs in on? Retained for *how long*
— until re-entry, or indefinitely? "Restoration is exact rather than approximate" (line 160)
implies indefinite, which compounds H-2.

---

### H-2. FR-35's retained Page Images sit outside the entire FR-32 / FR-33 retention regime

- **Location A:** FR-35, line 159 — uncommitted Page Images persist indefinitely with no
  stated expiry.
- **Location B:** FR-32, line 597 — "The system deletes Page Images **90 days after the
  upload of their Source Test**." FR-33 line 612 — account deletion removes "all Source Tests,
  Page Images, Extractions, Practice Tests, Attempts, Explanations, and Mastery **belonging to
  them**."

**What breaks.** An abandoned upload has no submitted Source Test, so FR-32's clock — which is
measured from Source Test upload — never starts. The images are photographs of a child's
schoolwork with **no deletion trigger at all**. FR-33's enumeration is written in terms of
committed artifacts; an uncommitted capture buffer is not obviously "belonging to" a Source
Test that was never created, so an implementer following FR-33 literally can leave it behind —
and FR-33 line 615 ("Deletion completes without leaving orphaned stored files") is then failed
by a path FR-33 does not describe.

§4.9's own preamble (line 591) states why this matters: the §5.2 privacy commitments were
promoted into FRs "precisely so downstream story creation cannot drop them." FR-35 created a
new class of stored Page Image after that promotion, and it was not folded back in. §5.2's
headline commitment — "**Page Images are deleted 90 days after upload**" (line 633) — is now
false for this class.

**Minimal fix.** A consequence bullet on FR-32:

> Page Images captured into an uncommitted upload that is never submitted are deleted on the
> same 90-day clock, measured from capture, and are covered by every FR-33 deletion path
> including Parent Account deletion.

---

### H-3. FR-25's dispute and override flow assumes an AI grade and rationale that two of the four grade states do not have

- **Location A:** FR-25, line 456 — "Flagged Questions appear in Parent View with the
  student's answer, the recorded grade, and **the grading rationale** (FR-22)." Line 461 — "An
  override **retains the original AI grade and its rationale** rather than overwriting them."
- **Location B:** FR-37 (unanswered — no student answer, never graded, so no rationale) and
  FR-22 line 412 (*ungraded* — grading was unavailable, so no grade and no rationale).

**What breaks.** FR-25 is written as though every gradeable Question passed through FR-22.
Three concrete holes:

1. **Can a student dispute an *unanswered* mark?** "I did answer that one" is a plausible and
   important dispute — it is the student's only recourse against a lost keystroke or a
   submission race. FR-25 line 455 makes flagging available "per Question" with no state
   restriction, so yes; but line 456 then requires displaying a student answer and a rationale
   that do not exist, and line 461's "retains the original AI grade" has nothing to retain.
2. **Can a parent override an *ungraded* Question?** FR-22's remedy is a view-triggered retry
   (line 413) — but if the AI stays unavailable, the Question is permanently ungraded, excluded
   from Mastery (line 520) and from the Weak Area floor (line 529). A parent override is the
   obvious escape hatch and FR-25 neither grants nor withholds it.
3. **What does "parent-adjusted" (line 462) look like** on a row that was never AI-adjudicated?

Left unresolved, an implementer will either block flagging on those states (removing the
student's only recourse against a wrongly-recorded blank) or render empty rationale fields.

**Minimal fix.** Two bullets on FR-25:

> Flagging and override apply to all four grade states. Where no AI grade or rationale exists
> — an *unanswered* Question (FR-37) or an *ungraded* one (FR-22) — the Parent View row states
> that plainly rather than showing an empty rationale, and the override records the parent's
> grade with no prior grade to retain.
> A parent override on an *ungraded* Question is terminal: it cancels the FR-22 view-triggered
> retry for that Question.

---

## MEDIUM

### M-1. Dark mode is a §6 / §9.1 / §10 commitment with no FR — the exact failure §4.9 exists to prevent

- **Location A:** §6 line 680 ("**Dark mode ships in v0** ... This is **scope, not polish**"),
  §9.1 line 715, §10 line 754.
- **Location B:** §4 — no functional requirement anywhere in FR-1..FR-38 mentions dark mode,
  theme, or design tokens.

**What breaks.** §4.9's preamble states the document's own rule: commitments that live only in
prose sections "are stated as FRs precisely so downstream story creation cannot drop them"
(line 591) — the lesson learned when the §5.2 privacy commitments had no FRs. Dark mode was
added in this update with exactly the shape that failure had: a strong prose claim in §6, a
scope bullet in §9.1, an NFR clause in §10, and nothing epic-and-story generation will pick
up as buildable work. §10 line 754 makes it worse by stating the *verification* obligation
("contrast verified in both light and dark") against a capability no requirement creates.

Note the asymmetry: the other scope change in this update, the idle timeout, correctly got
FR-34 *and* FR-35 *and* the §9.1 bullet *and* the §10 clause.

**Minimal fix.** Add an FR under §4.1 (or a new §4.10 presentation grouping) stating: both
modes present a light and a dark theme; the theme follows the OS preference with a manual
override persisted per device; every token has a dark counterpart; contrast is verified in
both. Then §9.1 and §10 cite it.

---

### M-2. "in-progress" is used as a Practice Test state, contradicting the four-state Glossary the document says must be used verbatim

- **Location A:** §3 line 81 — a Practice Test is "in one of **four states**: *draft*,
  *released*, *completed*, *discarded*." §0 line 13 — "vocabulary is fixed in §3 Glossary and
  used **verbatim** everywhere else."
- **Location B:** FR-16 line 332 — "Sort order is fixed: **unstarted and in-progress first,
  then completed**." Line 334 — "**Unstarted, in-progress, and completed states** are visually
  distinguishable." Also FR-28 line 540, "how many released Practice Tests are unstarted
  versus completed."

**What breaks.** *unstarted* and *in-progress* are not Practice Test states — both are the
*released* state, distinguished by whether an Attempt exists and whether it has been submitted.
FR-16 line 327 correctly says the list shows "*released* and *completed*" and then two bullets
later describes three different states. This is precisely the drift that produces a wrong data
model: an implementer adds `in_progress` and `unstarted` to the Practice Test status enum, at
which point *released* becomes ambiguous, FR-14's "Release transitions the Practice Test to
*released*" (line 302) no longer describes a terminal-until-Attempt state, and FR-12's "A
*draft* Practice Test never appears in Student Mode" is checking a field that now has six
values.

**Minimal fix.** Keep the display language, anchor it to the model. FR-16 line 334:

> The card distinguishes three display conditions, all derived rather than stored: *released*
> with no Attempt (unstarted), *released* with an unsubmitted Attempt (in progress), and
> *completed*. The Practice Test's own state remains one of the four in §3.

---

### M-3. FR-1 makes the timezone editable; nothing says what happens to the three counters when it changes

- **Location A:** FR-1 line 109 — timezone is "defaulted from the signing-up device and
  **changeable in Settings**. It is the boundary every allowance period is measured against."
- **Location B:** FR-31 line 666-667 — all three allowances reset on the calendar month
  boundary in the stored timezone, and "The three counters reset **atomically per account**."

**What breaks.** The reset boundary is now a **user-editable input to a rate limit**. Nothing
states whether changing the timezone (a) leaves the current period's counters untouched,
(b) recomputes the period boundary and can therefore trigger an immediate reset, or (c) is
blocked mid-period. Reading (b) is the naive implementation and it is a self-serve allowance
reset: a Free account at 2/2 uploads moves its timezone forward across the month boundary and
gets a fresh month. That defeats §5.3's entire cost-control premise and FR-31 line 663's "there
is no self-serve upgrade path in v0."

This gap is *created by this update* — the editability was inferred, not specified (it carries
the new §13 item 10 assumption tag), and the consequence of the inference was not traced into
FR-31.

**Minimal fix.** One bullet on FR-31:

> Changing the account timezone (FR-1) never resets or recomputes the current period's
> counters. It takes effect from the next reset boundary. Consumption already recorded in the
> current period is unaffected.

---

### M-4. §5.3 calibration — the two Free limits rest on different logic, and §12.2 item 7 has no authority to resolve against (known contradiction #2)

- **Location A:** §5.3 line 655 — "**Free is a taste, not a trial.** At 2 Practice Tests per
  month, a Free account will not accumulate enough answered Questions ... Analytics is a
  Plus-and-above capability in practice ... Do not 'fix' the empty Free dashboard."
- **Location B:** §5.3 line 646 tier table, Free Explanation Allowance = **10/month**; FR-31
  line 672; FR-24 line 437.

**Verdict: this is real, but it is calibration incoherence, not a logical contradiction.**
Nothing in the document asserts P and not-P. Both limits are internally consistent and both
are cost-motivated. The defect is that they are argued from **incompatible design intents**,
and the document presents only one of the two intents as the position.

Do the arithmetic the paragraph invites. Free = 2 Practice Tests × ~15 Questions (FR-10 line
255 derives count from the source; UJ-1 and UJ-2 both use 15) ≈ **30 Questions/month**. Ten
Explanations covers **a third of everything a Free student will ever see**, and comfortably
covers every wrong answer on both tests (at UJ-2's 11/15, that is 8 wrong across two tests).
So:

- The **upload and generation** caps are set *deliberately below the useful threshold* — they
  are a positioning lever. §5.3 says so explicitly and forbids relaxing them.
- The **Explanation** cap is set *comfortably above* the intended usage. It is a pure spend
  ceiling, and §5.1 line 625 confirms this framing — "a **cost wall, not a safety one**."

Two limits, two philosophies, presented under one heading that argues only the first. The
downstream cost is concrete and already visible: **§12.2 item 7** (SM-4's ≥40% Explanation
engagement target is measured on the tier that now caps Explanations) asks which number is
authoritative and the document cannot answer, because §5.3 never says the Explanation number
is not a positioning lever. Same for **item 6** (the retake cache miss charges again) and
**item 11** (the accepted cost of a child hitting the cap silently) — all three are arguments
about how tight the Explanation cap should be, and all three are unresolvable while §5.3's only
stated calibration philosophy is "keep Free below useful."

**Minimal fix.** One sentence into §5.3, after line 655:

> The Explanation Allowance is calibrated on different grounds from the other two. Uploads and
> generations are held deliberately below the useful threshold as a positioning decision; the
> Explanation cap is a spend ceiling only, set above expected Free usage, and is **not** a
> positioning lever. Tuning it up does not weaken the "taste, not a trial" position (§12.2
> items 6, 7, 11 resolve against this).

---

### M-5. The addendum still says the counters are **two** — stale against the three-counter override

- **Location A:** `addendum.md`, "Rejected / deferred alternatives" — "**Combined credit
  pool** ... Rejected in favor of **two separate counters**."
- **Location B:** prd.md Glossary line 70, FR-31 line 664, FR-30a line 581, §5.3 table,
  §9.1 line 714, §12.1 row 7 — all say **three**.

**What breaks.** The addendum's own header says it "belongs to downstream architecture / UX
work" — it is read by the architecture workflow, and it is the document that carries the
rejected-alternatives rationale. An architect reading it will model two counters and treat
Explanation metering as unbounded, which is exactly the position the O-1 override reversed.
The PRD was updated in eight places; its companion was not updated in one.

**Minimal fix.** In the addendum, change "two separate counters" to "three separate counters
(Upload, Generation, Explanation)" and add half a sentence noting the Explanation counter was
added after the tier decision.

---

### M-6. §0 still frames §13 as "the intended review surface" after §12.2 grew to eleven items including two definition gaps

- **Location A:** §0 line 15 — "**Every question raised in drafting has been resolved** and
  recorded in §12.1; the inferences that remain unconfirmed are indexed in §13 and **are the
  intended review surface**."
- **Location B:** §12.2 — now eleven items. Items 6-11 were added by this update. Item 8 ("The
  FR-27 5-question floor has no stated window ... **Not a tuning question — a definition
  gap**") and item 9 (a resolved *ungraded* batch retroactively creating a Weak Area, "there is
  no parallel rule for the dashboard") are open behavioral questions, not unconfirmed
  inferences.

**What breaks.** §0 is the routing instruction for every downstream workflow. It directs
attention to §13 (ten assumptions awaiting a yes/no) and never mentions §12.2. A reader
following §0 concludes the PRD has no open behavioral questions. It has at least two that
block implementation — item 8 blocks Mastery, item 2 blocks Topic normalization — and item 5
(Extraction exceeds the inherited 30s timeout) blocks Extraction.

**Minimal fix.** §0 line 15, replace the last clause:

> ... the inferences that remain unconfirmed are indexed in §13, and the questions still open
> after this update — including two definition gaps that block implementation — are in §12.2.
> Both are review surfaces.

---

## LOW — loose wording, not contradictions

### L-1. §13 attributes the thin-Admin-auth note to FR-30; it sits on FR-30a
§13 line 835 reads "**§4.8 / FR-30** — Thin Admin authentication, no roles, no audit logging."
The `[NOTE FOR PM]` is on **FR-30a** (line 587). FR-30 is taxonomy management and carries no
note. Pure citation slip from the FR-32→FR-30a renumbering recorded in the memlog. Fix the
label.

### L-2. FR-20's score display format ignores FR-22's reduced denominator
FR-20 line 373 mandates `First 11/15 · Latest 14/15 · 3 attempts`. FR-22 line 416 requires that
while any Question is *ungraded*, the score covers "only the gradable Questions" and names the
gap ("11/14 graded — 1 question could not be graded yet"). The compact first/latest format has
nowhere to put that. Not a contradiction — FR-22 governs the results header, FR-20 the card —
but two surfaces will show different denominators for the same Attempt with no rule saying
which wins. Add to FR-20: "Where an Attempt has *ungraded* Questions, the card shows the
FR-22 denominator, not the question count." (Interacts with C-1 — fix both together.)

### L-3. The at-cap Explanation message shows account-tier data to a student in Student Mode
FR-24 line 437 blocks a capped request "with the standard at-cap message naming **the tier**,
the usage, and the reset date" (FR-31 line 669's format: "You've used 2 of 2 ... on the Free
tier. Resets 1 October."). That message fires on the results screen, in Student Mode, to a
10-year-old. §3 line 74 scopes Student Mode to "only one Student Profile's Practice Tests,
results, and explanations" — tier name, account-level usage, and billing-period dates are none
of those. §7 line 696 anticipates the string being parameterized by surface but not that its
*content* should differ. Recommend a Student Mode variant that states the wall without the
account internals ("No more explanations this month — ask a parent"), which also happens to be
the cheap hook §12.2 item 11 names as the deferred fix.

### L-4. FR-15's three warning thresholds are asserted untagged while the structurally identical FR-34 value carries an `[ASSUMPTION]`
FR-34's 15-minute window correctly carries an assumption tag with its justification (line 145,
indexed as §13 item 9). FR-15's 5-minute / 1-minute / 20-second thresholds and the
non-escalation rule (line 315) are UX-derived values of exactly the same kind — specific,
guessed, tunable, consequential — and are asserted flat with a rationale but no tag and no §13
entry. Either tag them or state why they are settled. Same observation, weaker, for FR-16's
fixed sort order (line 332).

### L-5. "Active" Student Profiles (FR-3) vs "current profile count" (FR-31) — archived profiles' countability is unstated
FR-3 line 126 caps "the number of **active** Student Profiles"; line 128 archiving "hides it
from Student Mode selection but preserves its Attempt and Mastery history." FR-31 line 670
says reducing a tier "below its **current profile count** does not delete profiles; it blocks
creating more." Whether an archived profile occupies a Free tier's single slot decides whether
a Free parent can ever switch children. One clause on FR-3: "Archived profiles do not count
toward the tier limit."

---

## Verified clean

Checked and found consistent — recorded so the next pass does not redo the work.

**The Free Explanation cap — all eight sites agree.** FR-31 line 672, FR-24 lines 437-439,
§5.1 line 625, §9.1 line 727, §5.3 table line 646, §5.3 prose line 651, §3 Glossary lines
69-70, FR-30a line 581, and §12.1 row 3. Every site states: generation capped at 10/month on
Free; reading never capped at any tier; AI grading never capped at any tier; Plus / Family /
Internal uncapped on generation. **No site still implies Explanations are never blocked.** The
one residual risk is L-3 (what the capped student is shown), not the rule itself.

**FR-15 vs FR-37 are stated compatibly.** FR-15 line 317 ("This is the one path by which a
Question the student did not answer is graded incorrect rather than *unanswered*") and FR-37
line 474 ("It cannot arise from an expired timed Attempt. FR-15 grades those Questions
incorrect, and that consequence is unchanged") are mutually citing and mutually consistent.
FR-28 line 542 correctly extends the same rule to the dashboard's unanswered count. This
triple is the cleanest piece of the update.

**Three allowance counters.** FR-30a, FR-31, §5.3, §9.1, §6 surfaces list, and the Glossary
all agree on three counters, on all three resetting together and atomically, and on the
calendar-month boundary in the account's own stored timezone. The only defect is the
unaddressed editability consequence (M-3) and the stale addendum (M-5).

**§12.1 rows 3 and 7.** Both rewritten correctly. Row 3 carries the cost-not-safety
distinction and the never-capped-reading rule; row 7 carries three counters, local-timezone
reset, and uncapped AI grading. Neither asserts a superseded position. The only surviving
citation of the old two-counter decision is in the addendum (M-5).

**§9.2 offline carve-out vs FR-36.** §9.2 line 742 reproduces FR-36's three load-bearing
rules verbatim in substance — submission requires network, never silently retried, offline
timer expiry graded at the moment of expiry — and FR-36 line 386 back-references §9.2 as the
sole carve-out. Bidirectionally consistent.

**Assumption and note tags.** Ten inline `[ASSUMPTION]` tags, ten §13 index entries, exact
one-to-one match. Four `[NOTE FOR PM]` callouts (FR-26a, FR-30a, §9.2 ×2), four §13 "deferred,
not assumed" entries — correct count, one mislabeled target (L-1). The two deliberately added
tags (FR-34's 15-minute justification, FR-1's timezone default and editability) are both
present and both indexed as items 9 and 10. **No stale tags found** — the retirement note at
line 831 correctly accounts for the assumptions the §12.1 decisions absorbed.

**Cross-references spot-checked and resolving:** FR-13→FR-31 (no refund, line 665 confirms);
FR-24→FR-10/§10 (fractions); FR-28→FR-25/FR-38; FR-38→FR-30a (line 583 confirms
parent-confirmed flags reach Admin); FR-34→FR-4 (binding rule, line 136); FR-35→FR-5..FR-7;
FR-16→FR-23; FR-25→FR-28; §10→FR-34 (15 minutes, matching); FR-3→FR-31; FR-9→FR-10/§10;
FR-32→FR-9/FR-10/FR-11; §12.1 row counts (eleven questions, eleven rows). No pointer found
resolving to an FR that no longer says what the citation assumes.
