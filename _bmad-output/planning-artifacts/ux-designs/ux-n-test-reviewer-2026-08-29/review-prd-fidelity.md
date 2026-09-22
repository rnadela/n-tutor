---
title: PRD Fidelity Review — n-test-reviewer UX
lens: prd-fidelity
status: complete
created: 2026-08-29
reviewed:
  - ./DESIGN.md
  - ./EXPERIENCE.md
  - ./.memlog.md
against:
  - ../../prds/prd-n-test-reviewer-2026-08-29/prd.md
  - ../../prds/prd-n-test-reviewer-2026-08-29/addendum.md
---

# PRD Fidelity Review

The question this lens asks is not "is the UX good" — it is "can a downstream architecture workflow read the PRD and the spines together without inheriting a contradiction." Every departure from the PRD must be deliberate, logged, and complete in its consequences. Departures that are real but unlogged are the highest-value findings and are ranked first.

**Headline:** the spines are unusually disciplined about logging — the `.memlog.md` is 68 entries deep and `EXPERIENCE.md` carries an explicit *Decisions That Travel Upstream* section, which is exactly the right instrument. But two of the six "known deliberate departures" are **mis-classified**: they are described as closing gaps the PRD leaves open, when the PRD in fact states the opposite. One of those (timer expiry) is a live contradiction with FR-15 that no document flags. Separately, the distillation from memlog to `EXPERIENCE.md` **dropped two of the three coverage gaps the memlog itself discovered**, so they exist nowhere a downstream reader will look.

**Finding counts**

| Category | Findings | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| B. Unlogged drift | 14 | 1 | 5 | 6 | 2 |
| C. Requirements with no UX | 11 | 0 | 6 | 4 | 1 |
| A. Known deliberate departures | 9 | 0 | 2 | 5 | 2 |
| D. Non-goals respected | 4 | 0 | 0 | 1 | 3 |
| **Total** | **38** | **1** | **13** | **16** | **8** |

---

## B. Unlogged drift — highest value

Ranked first as instructed. Each is a place where the spines assume, contradict, or extend the PRD with no logged decision naming the FR involved.

### B-1. CRITICAL — Timer expiry contradicts FR-15; logged as a gap closure, so no override exists

- **FR:** FR-15 (Timer configuration), consequence 3
- **Spine:** `EXPERIENCE.md` State Patterns → "Timer expiry"; Component Patterns → "Timer"; *Decisions That Travel Upstream* → "PRD gaps closed here"; `.memlog.md` Q8b part (3)
- **Classification:** **unlogged departure, mis-filed as a gap closure**

FR-15 states plainly:

> On timer expiry the Attempt auto-submits **with unanswered Questions graded incorrect**.

`EXPERIENCE.md` asserts the opposite premise and the opposite outcome:

> **Timer expiry auto-submits.** The PRD specifies the timer tracks wall-clock across interruption but **never states what expiry does**.
> …
> Unanswered Questions at expiry are recorded as **unanswered, not wrong**.

The PRD does state what expiry does, and it states it in the direction the spine reverses. Two consequences:

1. The auto-submit half is not a UX-originated gap closure at all — it is compliance with FR-15. Filing it as a gap invites a PRD update that "adds" a requirement already present.
2. The unanswered-not-wrong half is a **genuine contradiction of FR-15** and is therefore missing from the *PRD overrides* section, where it belongs alongside the Explanation-cap override. Architecture reading FR-15 will implement `graded incorrect`; architecture reading `EXPERIENCE.md` will implement a distinct `unanswered` state excluded from the Mastery denominator. These produce different Mastery numbers, different Weak Area calls, and different scores on the same Attempt.

This also silently invalidates the reasoning chain in `.memlog.md` Q8b, which builds the distinct-unanswered-state decision on the premise that the PRD is silent here.

**Required:** move to *PRD overrides*, state it against FR-15 explicitly, and note that FR-15's third consequence must be rewritten in the PRD.

### B-2. HIGH — FR-16's Subject grouping is contradicted by the flat Student Home, and the contradiction is never named

- **FR:** FR-16 (Practice Test list in Student Mode)
- **Spine:** `EXPERIENCE.md` Component Patterns → "Student Home list"; `.memlog.md` Q7b
- **Classification:** **unlogged departure** (logged as a design decision, never as a PRD departure)

FR-16: "A student can see their *released* and *completed* Practice Tests, **grouped** and labeled by Subject and state." `EXPERIENCE.md`: "Flat list, **no Subject grouping**."

Q7b in the memlog reasons the choice through on its merits and is a defensible call, but it never mentions FR-16 and the departure does not reach `EXPERIENCE.md`'s *Decisions That Travel Upstream*. Labeling by Subject is honoured; grouping is dropped. This is a small requirement to break and an easy one to defend — but as it stands, an architecture or story workflow deriving acceptance criteria from FR-16 will write a grouping requirement the UX has deliberately rejected.

### B-3. HIGH — FR-4's Student Profile binding prompt is replaced by an unexplained "correct Student Profile"

- **FR:** FR-4 (Mode switching and Student Mode binding), consequence 1
- **Spine:** `EXPERIENCE.md` State Patterns → "PIN idle timeout", "Deliberate handover"
- **Classification:** **unlogged departure**

FR-4: "On a device with more than one Student Profile, **exiting Parent View prompts which Student Profile the device should bind to**."

`EXPERIENCE.md` says the idle timeout "returns to Student Mode **on the correct Student Profile**" and that an explicit "Back to Student Mode" control always exists — with no binding prompt on either path, and no definition of what makes a profile "the correct" one on a Family-tier account with up to five profiles. The spine assumes a single-child device (true on Free and mostly true on Plus) and silently drops the multi-profile prompt FR-4 requires. Note this is the one path where the silent timeout is *worse* than a deliberate exit: a parent who walked away cannot answer a prompt, so the rule needs an explicit answer (last-bound profile? the profile whose Analytics she was viewing?), not an adjective.

### B-4. HIGH — The 15-minute Parent View idle timeout is a new requirement with no PRD basis and no upstream log entry

- **FR / §:** FR-2 (Parent PIN), §10 Security
- **Spine:** `EXPERIENCE.md` State Patterns → "PIN idle timeout"; `.memlog.md` Q14a/Q14b/Q14c
- **Classification:** **unlogged departure** (addition)

FR-2 requires the PIN on "every transition from Student Mode into Parent View, including after app restart" — nothing more. Automatic session expiry, a 15-minute inactivity window, silent firing, and the resulting **"uncommitted parent input must persist without an explicit save"** obligation are all new. The persistence obligation in particular is a substantial architecture ask (field-level autosave across draft review, upload, and classification) that reaches `Decisions That Travel Upstream` as a *constraint*, but the session-timeout requirement that causes it is never itself recorded as a PRD addition. Architecture will see the expensive consequence without the requirement that justifies it.

### B-5. HIGH — The Mastery formula in the spine omits FR-26's rolling window and first-Attempt-only rule

- **FR:** FR-26 (Per-Topic Mastery computation), FR-20
- **Spine:** `EXPERIENCE.md` Grade States → "Mastery = correct / (correct + incorrect) per Topic"; *Decisions That Travel Upstream* → FR-26/FR-27 refinements
- **Classification:** **unlogged departure** (by omission)

FR-26 defines Mastery over **the 5 most recent qualifying Attempts that included that Topic**, where **only the first Attempt on a given Practice Test qualifies**. `EXPERIENCE.md` states the formula as a flat `correct / (correct + incorrect)` per Topic, across nothing in particular. The refinements section then says "FR-26 and FR-27 must be read with these refinements" — but the spine's own formula, read literally, *replaces* FR-26 rather than refining it: it drops both the window and the retake exclusion.

This is the most implementable-looking sentence in the Grade States section and it is the one an engineer will copy. It needs to read as `correct / (correct + incorrect)`, **computed over the qualifying Attempts inside FR-26's rolling 5-Attempt window**, or it will be built wrong.

### B-6. HIGH — Retake Attempts are visible everywhere and marked as non-qualifying nowhere

- **FR:** FR-20 consequence 3, FR-26, SM-C3
- **Spine:** `EXPERIENCE.md` Component Patterns → "Practice Test card", "Trend sparkline"; Key Flows UJ-2 step 8
- **Classification:** **unlogged departure**

FR-20 and FR-26 are explicit that retake Attempts are scored and shown but do **not** contribute to Mastery, and SM-C3 exists specifically to catch the product being used as a memorisation loop. The spines put **Retake** one tap from every completed test and show completed scores on the Student Home card, but no surface — card, results header, parent drill-down, or Attempt history — distinguishes a qualifying first Attempt from a non-qualifying retake. Two unanswered questions fall straight out:

- Which score does a completed Practice Test card show after three retakes?
- Does the dashboard-level **trend sparkline** include retake Attempts? If it does, it plots exactly the number SM-C3 warns against optimising; if it does not, that is a rule nobody has written down. Open Question 3 asks about the sparkline's *window* but not its *membership*.

### B-7. MEDIUM — FR-9a's warning content is specified in the PRD and dropped in the spine

- **FR:** FR-9a (Thin Extraction warning)
- **Spine:** `EXPERIENCE.md` State Patterns → "Thin Extraction"; IA → "Generate"
- **Classification:** **unlogged departure** (by omission)

FR-9a requires the parent to be shown **the count of usable questions and the count of pages submitted**, and requires that choosing to retake rather than proceed **consumes no Generation Allowance**. The spine reduces this to one line — "Warned before generation fires, with proceeding allowed" — carrying neither the counts nor the no-charge guarantee. The no-charge point matters: everywhere else in the spine an allowance cost is stated before it is spent (legibility override, weighted regenerate), and this is the one place the correct statement is "this costs you nothing." Also missing from the IA: the retake path from Generate back to Capture pages.

### B-8. MEDIUM — FR-22's grading rationale has no display surface, which strands FR-25's override

- **FR:** FR-22 consequence 3, FR-25 consequence 2
- **Spine:** `EXPERIENCE.md` Component Patterns → "Answer-key row"; IA (no parent results detail view)
- **Classification:** **unlogged departure** (by omission)

FR-22: "Every AI-graded Question records both the grade and a short grading rationale, **available to the parent in the results detail view**." FR-25 then requires that flagged Questions appear in Parent View **with the grading rationale**, because the rationale is the evidence on which the parent decides whether to override. The answer-key row is specified as Question / student answer / correct answer / grade state — no rationale — and no parent results detail view exists in the IA at all. See also C-6.

### B-9. MEDIUM — FR-28's "filterable by Subject" is absent from the Mastery table

- **FR:** FR-28 consequence 1
- **Spine:** `EXPERIENCE.md` Component Patterns → "Mastery table"; Responsive & Platform → Analytics dashboard
- **Classification:** **unlogged departure** (by omission)

The Mastery table is specified in full — ranked, weakest-first, inline bars, answered count, skipped count, Weak Area marker, row tap — with no Subject filter. On a single-Subject account this is invisible; the moment a family uploads Math and Science the ranked-weakest-first table interleaves two Subjects whose Topics are, per FR-26a, deliberately scoped per Subject. Either the filter ships or its absence is a logged call.

### B-10. MEDIUM — Explanation grade-level source diverges from FR-24

- **FR:** FR-24 consequence 3, FR-3 consequence 4, FR-7 consequence 2
- **Spine:** `EXPERIENCE.md` Voice and Tone constraint 4; *Decisions That Travel Upstream* → grade-adaptive Explanation language
- **Classification:** **unlogged departure**

FR-24: "Explanation language is pitched to the **Practice Test's** Grade Level." The spine consistently says the **Student Profile's** Grade Level. These are not the same value: FR-7 lets the parent override Grade Level per upload, and FR-3 lets a profile's Grade Level change without altering existing Practice Tests. A Grade 5 profile promoted to Grade 6 mid-term would, under the spine, get Grade 6 language on explanations for a Grade 5 test. The spine's choice may well be the better one — it is not flagged as a choice.

### B-11. MEDIUM — Dark mode is added to v0 scope without appearing in the PRD's MVP list

- **§:** §9.1 In Scope, §6 Platform
- **Spine:** `DESIGN.md` (full dark palette, every pair verified); `.memlog.md` line 9
- **Classification:** **unlogged departure** (addition)

The memlog records honestly that the PRD states no dark-mode requirement, then decides dark mode ships in v0 — doubling the token surface and adding a contrast-verification obligation to every component. This is defensible and cheap to build alongside, but it is v0 build scope that §9.1 does not list and it does not reach *Decisions That Travel Upstream*.

### B-12. MEDIUM — The Explanation-cap override is not carried into the Admin consumption view

- **FR:** FR-30a consequence 3
- **Spine:** `EXPERIENCE.md` IA → Admin → Parent Accounts; Allowances & Limits
- **Classification:** **unlogged departure** (incomplete consequence)

FR-30a specifies consumption "as uploads used / allowance and generations used / allowance" — two counters. The override adds a third. The Allowances section says the parent needs visibility of all three, but the Admin Parent Accounts screen is still described with the two-counter shape. The operator is the person who acts on tiers; if the Explanation cap is the wall that generates support contacts, this is the screen where it must be visible.

### B-13. LOW — Grade-dispute flag cited as FR-23 throughout; FR-23 is Answer reveal

- **FR:** FR-25 (mis-cited as FR-23)
- **Spine:** `EXPERIENCE.md` Component Patterns → "Explanation panel"; `.memlog.md` Q9b, line 67
- **Classification:** **unlogged departure** (citation error)

Both spine and memlog refer to "the FR-23 grade-dispute flag". FR-23 is *Answer reveal*; the grade-dispute flag is **FR-25**. A downstream workflow tracing FR coverage by number will mark FR-23 as covered by an affordance that has nothing to do with it, and will find FR-25 apparently unreferenced. The same error propagates into the memlog's own coverage-gap note, which is the one place this gap is recorded at all (see C-6).

### B-14. LOW — Offline behaviour of auto-submit and Attempt persistence is unexamined

- **§:** §9.2 (offline test-taking out of scope), FR-18, FR-15
- **Spine:** `EXPERIENCE.md` State Patterns → "Interrupted Attempt", "Timer expiry"
- **Classification:** **gap**

Not a non-goal violation, but an unexamined dependency between two requirements. FR-18 requires an in-progress Attempt to survive backgrounding, refresh, and device sleep, and the spine adds auto-submit at expiry — while §9.2 states network is required. What happens when the timer expires on a tablet that is asleep, or when the device is offline at the moment of auto-submit, is unspecified: submission triggers AI grading, which needs the network. This is a state the spine's own decisions create and should answer.

---

## A. Known deliberate departures — verification

### A-1. Free-tier Explanation cap — logged, complete on its own terms, but under-scoped against the PRD

- **FR:** FR-31 / §5.3, and see below
- **Spine:** `EXPERIENCE.md` *Decisions That Travel Upstream* → PRD overrides; Allowances & Limits; State Patterns; Voice and Tone; `.memlog.md` `(override)` entry
- **Classification:** **logged override**

**Verified present and internally consistent:**

| Required consequence | Status |
|---|---|
| Explicit override, user-directed and confirmed | ✅ Logged as `(override)` in memlog and in *PRD overrides* |
| Third allowance counter | ✅ Allowances & Limits, three rows, same calendar-month boundary |
| Reading never capped, at any tier | ✅ Stated in both documents, consistently |
| AI grading remains uncapped at every tier | ✅ Stated explicitly, unchanged from FR-31 |
| Plus / Family / Internal uncapped | ✅ Stated |
| New student-facing at-cap state | ✅ State Patterns row, with binding copy constraints and the no-counter rule |
| Parent visibility of the counter | ✅ Allowances table ("she is the only person who can act on it"); Settings carries allowance visibility |
| Everything else works at cap | ✅ Answer key, prior Explanations, dispute flag, Retake all named |

Three defects against completeness:

- **A-1a. MEDIUM — the override names only FR-31 and §5.3; three other PRD locations carry the same claim.** FR-24's final consequence reads "Explanation generation is never blocked by an Account Tier allowance (FR-31)"; §5.1 justifies ungated Explanations partly because a review gate "would put a wall in front of a child mid-study-session"; §9.1's MVP bullet describes Explanations without qualification. The override text targets FR-31 alone, so a PRD update executed literally would leave FR-24 stating the opposite of FR-31. Name all four sites.
- **A-1b. MEDIUM — the cap's interaction with Retake is unexamined.** FR-24 caches an Explanation against "the same Question **and answer**". A retake that produces a different wrong answer produces a cache miss and therefore a **new** Explanation, charged against the 10/month. The product's own student journey ends on "he taps **Retake** and does the same test again, then a fresh variant" — the behaviour the cap most directly penalises, on the tier where it applies. Nothing in either spine acknowledges this.
- **A-1c. LOW — SM-4 is not reconciled.** §11 SM-4 targets an Explanation request in ≥40% of completed Attempts. A Free-tier cap suppresses the metric that validates the product's stated differentiator, on the tier most new accounts sit in. Worth one line saying the metric is measured on uncapped tiers, or is expected to read low on Free.

*Not a defect, worth recording:* the Explanation Allowance's scope (per Parent Account vs per Student Profile) is undefined, but is moot by construction — the cap applies only to Free, and Free is limited to 1 Student Profile. State this so it is not rediscovered as a bug.

### A-2. Camera roll upload — the claimed gap does not exist; FR-5 already mandates it

- **FR:** FR-5
- **Spine:** `EXPERIENCE.md` *PRD gaps closed here*; Component Patterns → "Capture strip"; `.memlog.md` Q10a
- **Classification:** **mis-classified — compliance presented as a gap closure**

`EXPERIENCE.md` states: "The PRD specifies photos-only and describes in-app capture but **never rules out the camera roll**, leaving a parent who photographed the test at school pickup with no path that evening."

FR-5 is titled *Multi-page capture **and library selection*** and states:

> A parent can add multiple Page Images to a single Source Test, using the device camera **or the device photo library**.
> - Both camera capture and **library multi-select** are available on mobile web.

The PRD does not merely fail to rule the camera roll out — it requires it. **HIGH** on the accuracy of the log (a PRD update executed from this entry would add a duplicate requirement), **LOW** on the design itself, which is correct and well-specified. The behavioural additions the spine genuinely contributes — mixed freely in one Source Test, source never surfaced as a distinction, identical 1–10 ceiling and legibility treatment — are real and worth keeping; they are elaborations of FR-5, not a gap closure.

One substantive sub-finding: **MEDIUM** — FR-5 requires library **multi-select**, and the spine's Capture strip describes camera-roll images as "mixed freely into the same Source Test" without saying whether selection is multi or one-at-a-time. FR-5 also says "Pages are captured or selected **one at a time** and appended in order," so the PRD is itself ambiguous here; the spine inherits the ambiguity rather than resolving it, which is the opposite of what a UX spine is for.

### A-3. Timer expiry auto-submits — see B-1

Mis-classified as a gap closure; is in fact a contradiction of FR-15. Escalated to CRITICAL and reported in full above.

### A-4. Unanswered and ungraded excluded from the Mastery denominator — logged, but not stated precisely enough to implement

- **FR:** FR-26, FR-27, FR-22
- **Spine:** `EXPERIENCE.md` Grade States; *Decisions That Travel Upstream* → FR-26 / FR-27 refinements
- **Classification:** **logged refinement, under-specified**

The refinement itself is logged (Q8c, Q13d), reasoned, cost-accepted, and consistently carried into the four-grade-state table, the answer-key row, the Mastery table, and the drill-down. What is missing:

- **A-4a. HIGH — the formula drops FR-26's rolling window and retake exclusion.** Reported in full as B-5.
- **A-4b. MEDIUM — the FR-27 five-question floor interaction is gestured at, not specified.** The spine says only that a heavy skipper "takes longer to reach the five-question Weak Area floor," which implies unanswered Questions do not count toward the floor. Three things remain unstated: whether **ungraded** Questions count toward the floor (they are excluded from the denominator, so presumably not — but they resolve later, so the floor can be crossed retroactively); whether the floor counts Questions **inside FR-26's rolling 5-Attempt window** or across the profile's lifetime, which FR-27 does not say either; and what the empty-state copy's "He's answered 3 so far" counts — the copy uses "answered," which under the four-state model must mean correct+incorrect only, and that is worth making explicit since the number is shown to a parent.
- **A-4c. MEDIUM — ungraded resolution can retroactively create a Weak Area.** The spine handles the *score* changing between viewings with care ("visibly a newly graded item, not a silently altered one"). It does not handle the same transition in Analytics, where a resolved batch of ungraded Questions can push a Topic across the five-question floor and produce a Weak Area flag that was not there an hour ago. The rule for the results screen exists; the parallel rule for the dashboard does not.

### A-5. Skipped count surfaced to the parent — logged, consistent, complete

- **FR:** FR-26 / FR-28 presentation
- **Spine:** `EXPERIENCE.md` Grade States; Component Patterns → "Mastery table"; Voice and Tone; Key Flows UJ-3
- **Classification:** **logged addition** — ✅ no defect

Applied consistently to the three surfaces it claims (dashboard, drill-down, per-Attempt results summary), stated in the Voice and Tone do/don't table as a binding copy rule, demonstrated in UJ-3, and justified in a way that connects it to the product's parent-facing promise. The rationale is also the strongest single argument for A-4's exclusion decision and is correctly reused as such. **LOW** note only: the Student Mode results header ("You answered 11 of 15") does not distinguish skipped from wrong; the per-row grade state does, so nothing is misreported, but the header is the one number a student remembers.

### A-6. Generation progress screen vs the §10 NFR — genuinely reconciled, but resting on an unconfirmed reading

- **§:** §10 Performance NFR, FR-10 consequence 7
- **Spine:** `EXPERIENCE.md` State Patterns → "Generation in flight"; Voice and Tone constraint 3; `.memlog.md` Q13a
- **Classification:** **logged tension, reconciled**

The reconciliation is real, not papered over. §10 requires that "a parent should be able to leave and return"; the spine advises staying but establishes that (a) the work continues server-side and nothing is lost, (b) completed drafts land in **Pending drafts**, which is made a first-class Parent View destination precisely so a returning parent is not stranded, (c) allowance is charged on success so leaving costs nothing, and (d) the copy is **forbidden** from claiming work will be lost. What the parent loses is immediacy, not progress — and the reason for the advice (no notifications in v0, so this screen is the only live completion signal) is a genuine v0 constraint, not a design preference. The rendered mock copy quoted in the memlog gets this exactly right. Two riders:

- **A-6a. MEDIUM — the reconciliation rests on an interpretation the memlog itself flags as unconfirmed.** Q13a records that the user answered "A" among three A-variants and that the reading — work continues, warning is about discoverability only — is an *interpretation*. `EXPERIENCE.md` Open Question 17 carries this forward as "Needs confirmation," which is honest, but the behaviour is written into State Patterns as settled. If the reading is wrong, both the State Patterns row and Voice and Tone constraint 3 invert. This should be closed before architecture, not carried as an open question into it.
- **A-6b. LOW — Pending drafts is a new Parent View surface not in PRD §6.** §6 lists the Parent View chain as "Upload → Classify → Capture pages → Generate → Review draft → Release." Pending drafts as a persistent destination is an addition (a good one, load-bearing for durable drafts and for this very reconciliation) that does not reach *Decisions That Travel Upstream*.

---

## C. Requirements with no UX

Ranked by whether the FR genuinely needs a surface. Correctly absent, and not counted as findings: **FR-9** (Extraction — the PRD explicitly states it is not a product surface in v0), **FR-21** (deterministic MC grading), **FR-26a** (Topic normalization — the PRD requires it be invisible, and the spine correctly shows canonical Topics only), **FR-32**'s deletion mechanics, and the §10 Security / Observability NFRs.

### C-1. HIGH — FR-1: no sign-up, sign-in, or password-reset surface exists anywhere

The IA table has fourteen screens and none of them is authentication. Parent View begins at **PIN entry**; UJ-1 opens with "already signed in." FR-1 carries four testable consequences that all need surfaces: verified-format email and stated minimum password strength, a duplicate-email message that does not leak account existence, session persistence until explicit sign-out, and password reset via emailed link. None appear. This is the first screen every real user sees and the only screen in the product where a security-relevant message rule (the duplicate-email wording) is specified in the PRD.

### C-2. HIGH — FR-1 / §5.2: the child-data consent notice has no surface

FR-1 requires "acceptance of the terms and the child-data consent notice." §5.2 makes parent-provided consent at sign-up **the build posture** and makes legal review of that posture a **launch gate** blocking public registration. The one interaction the entire privacy posture rests on is unspecified — no wording, no placement, no record-of-consent state. Given the gate, this deserves a named surface even in a v0 with closed registration.

### C-3. HIGH — FR-3: Student Profile management has a screen name and nothing else

The IA lists "Students — Student Profile management." No flow reaches it (the memlog notes this at line 67; it did not survive distillation — see C-11), and no states are specified for any of FR-3's four operations. Specifically missing: the **at-limit state** when creation is blocked by the Account Tier, which FR-3 and FR-31 jointly require to name the tier and its limit; the **archive** action and its distinction from deletion, which FR-33 explicitly calls out as different ("Archiving… preserves history"); and Grade Level change, whose consequence (existing Practice Tests unaffected) interacts with B-10.

### C-4. HIGH — FR-33: parent-initiated deletion is a word in a nav list

Settings is described as "PIN, account, data deletion, allowance visibility." FR-33 specifies three distinct destructive operations with binding requirements the spine states nowhere:

- Every deletion requires **an explicit confirmation naming what will be destroyed** and stating it cannot be undone.
- Student Profile and Parent Account deletion require **the account password, not the Parent PIN** — the PRD is emphatic ("the PIN gates a mode, not a destructive action"). This is a re-authentication surface inside Parent View that exists nowhere in the spine, and it is the single place where the PIN-only model of Parent View is deliberately insufficient.
- Early Page Image deletion is **per Source Test** — and there is no Source Test surface to invoke it from (see C-5).

This is a product that holds photographs of children's schoolwork and a longitudinal record of a named child's performance. §4.9's own preamble says these FRs were written as FRs "precisely so downstream story creation cannot drop them." The UX drops them.

### C-5. HIGH — FR-32: no Source Test or Page Image surface exists, so the expired state has nowhere to live

FR-32 requires that "surfaces that would otherwise display a Page Image show an **expired state** rather than a broken image or an error." The IA contains no Source Tests list and no Page Image viewer — Page Images appear only transiently in the Capture strip during upload. Consequences: the expired state has no home; the parent has no way to see what she uploaded 30 days ago; there is no entry point for FR-33's early image deletion; and there is no surface from which FR-11's "the originating Source Test is reused" is legible to her. A Source Test list is the missing Parent View destination that several FRs quietly assume.

### C-6. HIGH — FR-25: the grade-dispute flag has a student-side affordance and no parent-side destination

The Explanation panel carries the flag ✅. FR-25 then requires that flagged Questions **appear in Parent View** with the student's answer, the recorded grade, and the grading rationale, and that the parent can **override the grade**, recomputing the Attempt score and the affected Topic's Mastery. None of that exists: no destination, no override control, no recompute-and-notice state — and per A-4c, an override that changes Mastery raises the same "score changed between viewings" problem the spine solves carefully for ungraded resolution and not at all here.

The memlog found this exactly (line 67, gap 2) and named it correctly as having "NO named Parent View home," contrasting it with flagged Explanations, which do have an Admin queue. It then did not survive into `EXPERIENCE.md` — not into Open Questions, not into *Decisions That Travel Upstream*. Compounded by the FR-23/FR-25 mis-citation (B-13), this gap is currently invisible to every downstream reader.

### C-7. MEDIUM — FR-24a: the parent-side Explanation reading surface and flag control do not exist

FR-24a is a **parent** capability: read every Explanation shown to the student, and flag one as bad. The spine puts the bad-Explanation flag inside the Explanation panel, which is a Student Mode results component, and puts the *received* flags in an Admin queue. Missing in between: the Parent View surface where a parent reads retained Explanations and raises the flag. As written, either the student is flagging their own Explanations as bad (not what FR-24a says) or the parent's path runs through Student Mode, which FR-4 forbids from carrying cross-profile or parent functionality.

### C-8. MEDIUM — FR-15: there is no timer configuration control

The parent-side half of FR-15 — enable an optional countdown timer and **set its duration before release**, default off, with a suggested duration derived from question count — appears on no screen. Draft review specifies per-Question edit/delete and per-draft release/discard; Generate specifies count and cost. Yet the spine *consumes* the timer confidently: the Practice Test card shows "timer presence **and duration when set**," and UJ-1 step 9 asserts a 20-minute timer is on. A feature is displayed that nothing in the spine lets the parent turn on.

### C-9. MEDIUM — FR-13: deleting the last Question discards the Practice Test — no state specified

FR-13 allows deletion down to one remaining Question and specifies that deleting the last one **discards the Practice Test**. Draft review says per-Question delete acts in place; it does not describe the floor, the block, or the state transition when a parent deletes her way to zero — a destructive outcome reached by repeating an ordinary action, with a *discarded* state that FR-14 says removes the test from all student-facing surfaces and from Analytics.

### C-10. MEDIUM — FR-31 / FR-3: the Student Profile at-limit block has no state

FR-31 requires that reaching an allowance hard-blocks with a message naming tier, usage, and reset date, and FR-3 requires the same shape for the profile limit ("a message naming the tier and its limit"). The spine's Allowances table covers Upload, Generation, and Explanation at-cap behaviour thoroughly — the profile limit is the fourth cap in the product and is not covered.

### C-11. LOW — Two of the three coverage gaps the memlog found did not survive distillation

`.memlog.md` line 67 records three gaps discovered during distillation: (1) Students and Settings appear in the IA but no Key Flow reaches them, (2) the grade-dispute flag has no Parent View home, (3) the sparkline window is unspecified. Only (3) reaches `EXPERIENCE.md` (Open Question 3). Gaps (1) and (2) exist nowhere a downstream workflow will read. The instinct to surface rather than invent was correct; the surfacing did not complete. Add both to Open Questions.

---

## D. Non-goals respected

Checked against §8 and §9.2. **The spines are strong here** — this is the most disciplined category in the review and the anti-gamification posture in particular is enforced structurally rather than by exhortation.

| Non-goal | Verdict | Evidence |
|---|---|---|
| No notifications | ✅ Respected, and load-bearing | The absence is *used* as a premise (generation progress advice, FR-28 activity summary as the "did my child do it" answer). The one adjacent idea — a persistent cross-app generation indicator — is explicitly rejected for v0 and filed as Open Question 10. |
| No gamification | ✅ Respected, structurally | Banned list is explicit and specific (streaks, badges, mascots, points, confetti, score count-up, reveal sweep). "The score appears; it does not perform" is enforced in `DESIGN.md` Do's and Don'ts and in the Motion primitives. The incorrect label is "Not correct", not "Wrong". |
| No conversational follow-up on Explanations | ✅ Respected | The Explanation panel holds loading, error, at-cap, and two flags — no input, no follow-up affordance, no chat. |
| No offline | ⚠️ Respected but under-examined | See B-14: auto-submit and Attempt persistence create a network dependency at expiry that is unspecified. Not a violation. |
| No localization | ✅ Respected | English only throughout. Open Question 5 concerns timezone boundaries, not locale. |
| No co-parent accounts | ✅ Respected | One Parent Account, one PIN, no sharing surface anywhere. |
| No PDF / document scanner | ✅ Respected | Capture strip is image-only; formats stay within FR-5's image set. |
| No self-serve upgrade | ✅ Respected, and defended under pressure | Q13c explicitly refuses to name the Free tier as the cause of an empty dashboard *because* there is no upgrade path — "telling a parent her plan is the reason while giving her no way to change it is a frustration with no exit" — and files the reversal as Open Question 12, gated on the path existing. The Explanation at-cap copy carries a binding "no upsell language aimed at the child" constraint. |
| Not a grading system of record | ✅ Respected | Scores framed as practice signal; no export, no authority claim. |
| Not a curriculum / question bank | ✅ Respected | Every generation path traces to an uploaded Source Test; weighted regenerate explicitly reuses the originating Source Test. |

**D-1. MEDIUM — the one place a non-goal is under real pressure.** The Free-tier Explanation cap creates the product's only wall that lands on a person who cannot act on it. The spine handles this with genuine care (no counter, blame-the-plan copy, everything else stays working, and Open Question 11 keeps the "ask a parent" prompt deferred rather than dismissed). But the combination of *a limit a child meets* + *no notifications to tell the parent it happened* + *no self-serve upgrade* means the resolution path is: the child stops asking, and the parent finds out only if she opens the Analytics dashboard and thinks to look at a counter in Settings. That is three respected non-goals interacting to produce a dead end. Worth stating as an accepted cost of the override rather than leaving it to be discovered.

---

## Summary for the Reviewer Gate

**Must fix before architecture:**

1. **B-1** — reclassify timer expiry as a PRD override against FR-15 and correct the false premise in both spine and memlog. This is the one live contradiction that will produce divergent implementations of scoring and Mastery.
2. **B-5 / A-4a** — restate the Mastery formula with FR-26's rolling 5-Attempt window and first-Attempt-only qualification. The current sentence is the one an engineer will copy and it is incomplete.
3. **A-1a** — extend the Explanation-cap override to name FR-24 and §5.1, not FR-31 alone.
4. **A-2** — correct the camera-roll entry: FR-5 already requires the photo library. Keep the behavioural elaborations, drop the gap framing.
5. **C-11 / C-6** — restore the two dropped coverage gaps to `EXPERIENCE.md`, and fix the FR-23 → FR-25 mis-citation.

**Should fix:** B-2, B-3, B-4, B-6 (retake visibility and sparkline membership), and the C-1 through C-6 missing surfaces — of which **FR-33 deletion, FR-1 sign-up/consent, and FR-25's parent-side destination** are the three that a story workflow cannot invent for itself without guessing at requirements the PRD already states precisely.

**Strongest work:** the Explanation-cap override's consequence tracing (A-1), the generation-progress reconciliation (A-6), the skipped-count addition (A-5), and the non-goal discipline in §D — particularly the refusal to introduce upsell copy on a tier with no exit.
