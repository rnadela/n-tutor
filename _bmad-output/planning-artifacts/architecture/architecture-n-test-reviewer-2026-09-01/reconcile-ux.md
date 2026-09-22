---
title: UX ↔ Architecture reconciliation — n-test-reviewer
type: reconciliation
created: 2026-09-02
inputs:
  - _bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/EXPERIENCE.md
  - _bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md
scope: >
  Where the UX contracts require something the ARCHITECTURE SPINE fails to support or
  actively contradicts. Not a review of the UX documents' quality.
---

# UX ↔ Architecture reconciliation

Findings are ordered by severity class: **impossibilities** (a UX promise the spine cannot
keep), then **contradictions** (both documents are internally coherent but assert opposite
things), then **gaps** (the spine is silent where the UX needs a decision), then **frictions**
(supported, but at a cost neither document has priced).

Every finding names the binding UX line and the AD it collides with.

---

## Class A — Impossibilities

### A1. The in-progress Attempt has no home. Every offline and interruption promise in Student Mode rests on storage the spine does not define.

**UX binding lines** — *State Patterns*:

- "Interrupted Attempt / Take Test — **Survives backgrounding, refresh, and device sleep; resumes in place.**"
- *Offline during an Attempt*: "Answering and navigating keep working — **answers are held locally and the Attempt survives.**"
- "**If a timer expires while offline, the Attempt is auto-submitted as soon as connectivity returns, graded against the expiry moment, not the reconnect moment.**"
- *Timer*: "Counts down wall-clock across interruption; the clock does not pause on backgrounding, refresh, or device sleep."
- Constraints-landing index: "Timer expiry must be resolvable offline."

**What the spine provides.** Nothing. The ER model is `Attempt ||--o{ Answer` with `practicetest`
owning both; there is no *state* on Attempt, no draft-answer row, no client persistence decision,
no service worker, no offline store, and no statement of whether an Attempt row is created at
**start** or at **submit**. AD-15's "a row is the authority from the first byte" is written for
Page Images and never extended to an Attempt in progress.

**Why the obvious workaround is closed.** AD-16 is the spine's only uncommitted-state mechanism,
and it is explicitly parent-scoped: "FR-35 uncommitted parent state is a row under the same
treatment: **owned by the Parent Account**, with a state and a TTL, **readable only against a
parent-scoped token** (AD-13)." A student in Student Mode holds no parent-scoped token by
construction (AD-18), so the one uncommitted-state lifecycle the spine defines **cannot** be
reused for the student's in-flight answers. The spine has one mechanism for unsaved work and has
locked the student out of it.

**Second half of the same problem — the expiry moment.** "Graded against the expiry moment, not
the reconnect moment" requires either (a) the server deriving expiry from a persisted
attempt-start timestamp plus the configured duration — which requires the Attempt row to exist
from start, the decision the spine never makes — or (b) the server trusting a client-asserted
expiry timestamp, which is a grade-affecting value supplied by the device a 10-year-old is
holding. The spine takes no position, and (b) is not acceptable under its own posture (AD-15
refuses client-supplied storage paths for a far smaller stake).

**Consequence if unresolved.** A refresh mid-test loses the Attempt; the offline path is
unbuildable; the timer's wall-clock guarantee is unenforceable; and the *Submit with gaps* /
*unanswered vs incorrect* distinction — which turns entirely on whether submission was manual or
by expiry — has no trustworthy source for "did the clock reach zero."

**Needs:** an AD stating (1) the Attempt row is created at start with an explicit `in_progress`
state and a server-recorded start timestamp, (2) where in-flight Answers live (server-synced on
change, or client-durable with a named store), and (3) that expiry is computed server-side from
start + duration and never accepted from the client.

---

### A2. Extraction is a queued job with no UX state anywhere — and the flow needs its output at render time of a screen the parent reaches immediately.

**Spine.** AD-4: "Queued: **Extraction**, Generation, Grading." AD-3: "Progress surfaces read job
status." So Extraction has a queue latency, a failure mode, and a partial-result mode.

**UX.** The Information Architecture lists exactly one progress screen: **Generation progress**
("Live progress for an async job"), reached from **Generate**. Between capture and generate the
IA lists **Legibility check** then **Generate**. There is:

- no Extraction progress screen,
- no Extraction in-flight state in *State Patterns*,
- no Extraction failure state,
- no Extraction partial-result state,

and the **Generate** screen is required to render Extraction's output before the parent acts:

> *Thin-Extraction warning* — "States the **count of usable questions and the count of pages
> submitted**, then offers proceed or retake pages." (D7: "the allowance guarantee is the
> load-bearing half.")

A usable-question count is Extraction output. Under AD-4 it does not exist when the parent
arrives at Generate; under AD-3 the parent can only be shown job status. So either the Generate
screen blocks on a queued job with no specified waiting state, or the thin-Extraction warning
cannot be rendered — and D7 marks that warning as restored-because-load-bearing.

**Compounding: the legibility check is an unaccounted AI call class.** *Legibility result*: "Runs
as a **batch, once, immediately after capture finishes and before any other step**", identifying
**which** page failed. AD-2 fixes exactly four call classes (Extraction, Generation, Grading,
Explanation) and AD-8 pins exactly four model assignments. Per-page legibility is a vision
judgement over Page Images:

- If it **is** Extraction, then Extraction runs "immediately after capture, before any other
  step" — which contradicts AD-4's queued-with-progress-surface shape (there is no progress
  surface there), and makes the thin-Extraction count available at Generate for free.
- If it is a **separate** call, the spine is missing a fifth call class: no model pin (AD-8), no
  AiCall class value (AD-20 enumerates five classes and legibility is not among them), no
  allowance position (AD-14), and no place in the AD-4 queue/foreground split.

Either reading is a spine defect. The spine must pick one and say so.

**Needs:** an AD binding the capture→legibility→extraction→generate sequence: which calls happen,
which are queued, what the parent sees while each runs, what happens when Extraction fails or
returns thin, and where legibility sits in the call-class taxonomy.

---

### A3. The Admin surface has no credential model, no module, and no owner — yet it must write an entity another module owns.

**UX.** Admin is one of the four declared surfaces and carries three screens plus a sign-in:
Subjects & Grade Levels (taxonomy CRUD + per-grade availability), Parent Accounts (**Account Tier
assignment**, per-account consumption for all three counters against **that account's own
period**), Flagged Explanations (the FR-24a/FR-38 queue, which UJ-4's footnote calls "the entire
after-the-fact accountability mechanism for child-facing AI content"). DESIGN gives Admin the
parent accent and `density.compact`. UJ-4 walks the flow end to end.

**Spine.** AD-2 says only "Admin is a separate surface outside any Parent Account." Then:

- **No credential.** AD-13 and AD-18 define exactly two credentials, both keyed to a Parent
  Account: a session cookie answering *which account*, and an in-memory elevation token carrying
  *mode*. There is no admin identity, no admin session, no admin scope, and no statement of how an
  admin endpoint is authorized. AD-23's throttler is scoped to "unauthenticated endpoints" with
  signup and login named — admin sign-in is not among them, so the argon2-flood argument the spine
  itself makes applies to an endpoint it has not protected.
- **No module.** The source tree and dependency graph have no `admin`. The spine's own Deferred
  list concedes it: "**Admin-surface module ownership** — the Admin surface is named by FR-30/FR-30a
  and AD-12 but has no owned entity cluster assigned in the decomposition."
- **An ownership violation is already implied.** Account Tier assignment writes `ParentAccount`,
  owned by `identity` (AD-17: "one writer per entity"). Subjects & Grade Levels writes `Subject`,
  which appears in the ER diagram but is assigned to no module at all. Flagged Explanations reads
  and dispositions `explanation` state. The Admin surface therefore needs write paths into two
  modules it does not own, through a service layer nobody has named.

**Also unresolved by the spine's own admission:** "De-duplication of Admin content-quality queue
entries for one Explanation … the queue's identity model is unresolved." The UX has already
decided the routing (Admin receives **parent-confirmed and parent-originated flags only**; a
suppressed Explanation **stays** in the queue), so the identity model has a specified shape the
spine can adopt rather than leave open.

**Needs:** an AD for the Admin surface — credential and scope, module ownership (including
`Subject`/`GradeLevel`), the write paths it needs into `identity` and `explanation`, and the
flag-queue identity model the UX already constrains.

---

## Class B — Contradictions

### B1. Sliding expiry is measured in requests; the UX timeout is measured in inactivity. The generation-progress screen makes them opposite.

**UX** — *PIN idle timeout*: "Fires **silently at 15 minutes of inactivity** — inactivity, not
wall-clock session age." Rationale (D4): the shared family tablet, where "a forgotten session
[stays] open all evening."

**Spine** — AD-13: "**Sliding expiry:** every parent-scoped request returns a refreshed token
carrying a new 15-minute window."

These are the same number attached to two different clocks, and both failure directions are real:

- **The timeout never fires.** AD-3/AD-4 make Generation a queued job and AD-3 requires the
  progress surface to read **job status** — i.e. poll. Every poll is a parent-scoped request, so
  every poll refreshes the token. A parent who taps Generate and walks away leaves Parent View
  authenticated **indefinitely** on the exact device D4 was written about. The same holds for any
  future auto-refreshing parent surface.
- **The timeout fires during work.** A parent reading a long Explanation in Attempt detail, or
  typing a per-Question edit in Draft review, issues no network request. Under AD-13 they are idle
  at 15 minutes and are dropped mid-keystroke; under the UX they are active and must not be.

**Needs:** AD-13 amended so the sliding window is driven by *user interaction* reported by the
client, not by request traffic, with background polling explicitly excluded from refreshing it —
or a separate non-refreshing idle clock alongside the token's own expiry.

---

### B2. A timezone change must not re-slice the running period — but AD-14's counts are derived from the currently stored timezone.

**UX** — *Allowances & Limits*: "The timezone is captured at registration and is **editable by
the parent** in Settings → Account & security. … **A change applies from the next boundary onward
and never to the period already running:** counts never move, no period is shortened, lengthened,
or reset twice, and the control states which reset date the change takes effect on before it is
saved." The stated *why* is that a draggable boundary "is both a way to reset an allowance early
and a way to make a stated reset date retroactively wrong."

**Spine** — AD-14: "No counter column and no reset job. Usage is a **COUNT over the artifacts**,
scoped to the Parent Account and to the period window **computed from the account's stored IANA
timezone**."

A derived count reads the *current* stored timezone every time it is evaluated. Change the
timezone mid-month and the window boundaries move for the period already running — counts change,
the period is shortened or lengthened, and a previously stated reset date becomes retroactively
wrong. That is precisely the three-part failure the UX rule exists to forbid, and AD-14 as written
cannot express the rule: there is no representation of "the period already running keeps its old
boundary."

**Needs:** the timezone becomes an effective-dated value (the account carries the current zone
plus a pending zone with the boundary instant it takes effect), and the allowance window
computation resolves the zone **as of the period being counted**, not as of now. This also
satisfies "all three counters reset atomically," which the derived model already gives for free.

---

### B3. Partial generation success: the spine charges for it, the UX states it is free and has no state for it.

**Spine** — AD-14: "A generation job producing 1–5 drafts charges per draft that lands; **a job
failing after three drafts has charged three.**" AD-22 makes this a mandatory test case: the fake
"must be able to fail … and **partial success on a multi-draft generation job**."

**UX** — *State Patterns*, Generation failure: "Retryable **without re-upload**. **Allowance is
charged on successful production, so a failed generation costs nothing.**" *Allowances & Limits*
repeats it: "A failed generation costs nothing." *Voice and Tone* constraint 3 hangs on the same
premise.

Under AD-14, a job that produces 3 of 5 drafts and then fails has charged 3 units. The UX has:

- **no state** for partial success (its vocabulary is in-flight / failure / done),
- **copy that is false** in that state ("a failed generation costs nothing"),
- **no defined retry semantics** — retrying "without re-upload" after a partial failure must
  regenerate only the missing 2, or it double-charges, and nothing says which.

There is also a bounding question the two documents answer differently by omission: the *Generate
control* is "bounded at initiation by the remaining Generation Allowance", but AD-14 charges as
drafts land, so a job initiated within allowance can still be interrupted by the cap check on the
4th draft's INSERT. That outcome — "you asked for 5, you got 4, the 5th hit your cap" — is also
stateless in the UX.

**Needs:** a UX state for partial production with copy that names what was charged, plus a spine
rule for what retry-after-partial regenerates.

---

### B4. Drafts are promised "indefinitely"; AD-16 puts one non-extendable 72-hour TTL on uncommitted state and deletes the row outright.

**UX** — *Draft interrupted*: "Drafts are **durable**. **Unreleased drafts persist indefinitely
with review position and any per-Question edits preserved.**" *PIN idle timeout*: "in-progress
parent work must persist without an explicit save: a per-Question edit typed but not committed,
review position within a draft, an uncommitted grade override, and any partially completed upload
or classification step all survive." Constraints index: "Uncommitted parent input persists
without an explicit save … and are **restored exactly**." UJ-1's closing line: "Interruption at
any point costs position only: drafts are durable **down to uncommitted field input**."

**Spine** — AD-16: "**One TTL, 72 hours from row creation**, applied uniformly to uncommitted
state whether or not it carries bytes. … TTL is measured from row creation and is **not** extended
by activity. … Expiry **deletes the row outright** rather than husking it."

The draft Practice Test itself is a `practicetest` entity and survives — no conflict there. The
conflict is the *uncommitted* half: review position, a typed-but-uncommitted per-Question edit,
and an uncommitted grade override are uncommitted state under AD-16, so they are hard-deleted 72
hours after creation regardless of activity. A parent who reviews a draft on Sunday and returns
the following Thursday loses edits the UX promised were "restored exactly."

The clash is sharper than a number: AD-16 deliberately unified FR-35 restorable capture state with
the orphan sweep because "sweeping is expiring FR-35 state." That argument is sound for abandoned
camera captures with bytes on disk. It does not transfer to a text edit inside a durable draft,
which has no storage cost and no orphan semantics.

**Needs:** AD-16 scoped to uncommitted state **that carries bytes or has no durable parent**;
uncommitted edits attached to a durable entity (draft, Attempt detail) inherit that entity's
lifetime instead of the 72-hour TTL.

---

### B5. "No background job" for ungraded retry vs. AD-4's queued grading — and `ungraded` means two different things in the two documents.

**UX** — *Ungraded resolves later*: "Grading **retries on next view** of the results screen, by
student or parent. Retry must not block rendering." Constraints index, stated as binding:
"Ungraded Questions retry grading on next view — **By either student or parent; no background
job**, and the transition must be legible rather than silent." *Grade States*: `ungraded` = "**AI
grading unavailable**; degrades to ungraded, never to wrong," colored `{colors.info}`.

**Spine** — AD-4: "Queued: Extraction, Generation, **Grading**. … **FR-22's `ungraded` is the
queue-pending state.** Submit enqueues grading; the results screen renders immediately with
deterministic Multiple Choice grades and AI-graded items marked not-graded-yet. FR-22's
retry-on-next-view = read the job result if finished, re-enqueue if it failed."

Three distinct collisions:

1. **"No background job" is contradicted by the primary path.** Submit enqueues a background
   grading job with no view involved. The UX line reads as a prohibition on exactly that
   mechanism.
2. **`ungraded` changes from an exception to the default.** Under the spine, *every* submitted
   test renders every AI-graded Question as `ungraded` for as long as the job takes. The UX
   defines `ungraded` as an outage state, gives it the `{colors.info}` degraded treatment, writes
   its copy as a gap statement ("4 aren't graded yet"), excludes it from Mastery, and renders it in
   `key-results.html` as *degraded grading*. Under the spine that degraded rendering is the normal
   post-submit screen for every attempt, and UJ-2 step 6 — "the results screen appears
   immediately. 'You answered 11 of 15.'" — is only true for a Multiple-Choice-only test.
3. **There is no state for "grading in flight with the results screen open."** The UX has no
   grading progress surface (its only progress screen is generation) and no polling. AD-3 says
   progress surfaces read job status, but nothing reads grading's. A job that completes while the
   student is looking at the screen cannot reach that screen: the student must navigate away and
   back to trigger the on-view retry. The UX requires the resolution to be "visibly a **newly
   graded item**, not a silently altered one," which is a transition it never gets to render.

**Needs:** either a UX state distinguishing *grading in progress* (normal, expected, brief) from
*grading unavailable* (degraded, AD-4's failure branch) — with the `{colors.info}` degraded
treatment and the gap copy reserved for the second — plus a defined refresh mechanism for a
results screen held open; or a spine decision to grade Multiple Choice deterministically in-request
and treat the AI-graded remainder as the only queued portion, which is close to what AD-4 already
implies but does not state as a UX contract.

---

## Class C — Gaps

### C1. Grade disputes and Explanation flags are records with a lifecycle and no owner.

The UX makes both first-class, listed, dispositioned records:

- *Dispute entry*: "Grade disputes for the currently selected Student Profile only … newest
  first, each naming the Practice Test, the Question, and the recorded grade. Tap opens Attempt
  detail scrolled to that Question. **Entries stay listed after resolution, marked resolved.**
  *Why:* a dispute is a record, not a to-do that vanishes."
- *Flag disposition*: a student flag "carries exactly two dispositions — **confirm** … or
  **dismiss** … A flag **stays listed on the dashboard band as awaiting disposition** until one is
  taken, and stays listed afterwards marked with the disposition taken."

The spine's ER model and module decomposition contain no Dispute entity and no flag entity beyond
`explanation` owning "Explanation, suppression state, flags." Specifically missing:

- **Dispute has no owner.** AD-6 names "the FR-25 override path" and AD-10 makes the override
  recompute Mastery in-transaction — but the *dispute* raised in Student Mode, before any
  override, is unmodeled. It is not a grade, so `grading` does not obviously own it; it is not an
  Explanation, so `explanation` does not.
- **A student-raised flag crosses a module boundary the graph does not have.** The dispute is
  raised from Student Mode against an Answer/Question (`practicetest`) and surfaces on Analytics.
- **`analytics` cannot read what the dashboard must render.** The dependency graph gives
  `analytics --> grading`, `topics`, `practicetest`. The Analytics dashboard is required to render
  (a) grade disputes, (b) Explanation flags awaiting disposition — both in `explanation` or an
  unowned entity — and (c) the **Explanation Allowance readout** with usage and reset date, which
  lives in `allowance`. There is no `analytics --> explanation` and no `analytics --> allowance`
  edge. Under AD-17 ("never through Prisma directly") the dashboard as specified cannot be
  assembled.

**Needs:** an owner and entity for the dispute/flag record with its disposition lifecycle, and two
added edges (`analytics --> explanation`, `analytics --> allowance`) — or an explicit statement
that the dashboard is composed at the web layer from several module endpoints.

### C2. Nothing carries which Student Profile the device is bound to — yet Student Mode is server-rendered.

FR-4 / *Deliberate handover*: the device binds to one Student Profile; the deliberate exit prompts
which, defaulting to the last-bound; "the silent timeout cannot prompt, so it uses the **last-bound
profile**"; "Initial binding is set when the first Student Profile is created, and thereafter by
this prompt."

AD-18 says the session cookie "answers *which account*" and "lets Next.js server-render the shell
and **student-scoped surfaces**." But Student Home is a flat list of **this Student Profile's**
Practice Test cards, and the server cannot know which profile from a credential that carries only
the account. The binding is device-scoped state that must survive app restarts and the silent
timeout, and no AD gives it a home (device-local storage? a claim in the session cookie? a row on
`identity`?). Each choice has different consequences for the shared-tablet threat model AD-18
exists to serve — e.g. a binding readable by browser JS is a binding a curious 10-year-old can
change to another sibling's profile.

### C3. The PIN cooldown counter has no server-side model, and the throttler does not cover it.

*PIN cooldown*: "Three wrong entries lock Parent View for a cooldown. **The failure count persists
across app restart.**" UJ-3's edge case makes brute-force resistance the explicit goal.

AD-23 scopes `@nestjs/throttler` to **unauthenticated** endpoints, naming signup and login. PIN
entry is an authenticated endpoint (the session cookie is present) and is therefore outside that
control. No AD models a per-account PIN attempt counter or lock-until timestamp, and AD-13/AD-18
do not mention one. "Persists across app restart" rules out a client-side count.

### C4. No latency budget for the foreground Explanation, against an inherited 30s client timeout.

AD-4 keeps Explanation foreground, "in-request with an inline loading state and manual retry."
AD-1 inherits the n-electric client config with a "30s default timeout" and `maxRetries: 2`; AD-7
overrides the timeout only for the vision path.

The UX's rejection of auto-retry is explicitly a latency argument: "auto-retry can silently double
a wait **the product requires to stay short**." Nothing in the spine states what "short" is, and
the inherited `maxRetries: 2` means a slow Explanation can silently consume up to three sequential
30s attempts inside the request the parent or student is waiting on — the doubled wait the UX
rejected, arriving through the SDK instead of through the app. The retry policy for the foreground
class should be pinned separately from the queued classes.

### C5. `Subject` and `GradeLevel` appear in the ER diagram and in Admin CRUD with no owning module.

`Subject ||--o{ Topic` is in the core entities diagram, and Admin's Subjects & Grade Levels screen
does full CRUD plus per-grade availability. Under AD-17 every entity has exactly one writing
module; neither `Subject` nor Grade Level is assigned to one. This is a sub-case of A3 but is
listed separately because it also affects the non-Admin path: Upload → Classify reads the
per-grade-available Subject list, and the *Student Profile form* requires "exactly one Grade Level
from the **Admin-configured list**."

---

## Class D — Frictions the spine does not price

### D1. The surface accent/density swap straddles AD-18's server/client boundary.

DESIGN is clean and the spine supports it in principle: "**one base MUI theme plus a nested
`ThemeProvider` that overrides `palette.primary` only.** Not two themes. Not a fourth accent for
Admin," with density read from `{spacing.density.comfortable}` (Student) / `{spacing.density.compact}`
(Parent, Admin), and font family assigned by **content vs chrome, never by surface** — the serif
"crosses the Parent PIN," which costs the architecture nothing.

The cost the spine does not name: AD-18 makes the server-rendered shell knowable only from the
session cookie, which carries no mode, while the elevation token that *does* carry mode is
"held in a React context in memory only." So the server cannot emit parent accent or parent
density. Every Parent View screen must be a client boundary below a student-themed server shell,
or the parent surfaces render once in the wrong accent and swap. This is compatible with AD-18 —
"a server-rendered parent screen is a bug" — but it means the theme swap is a client-mount event
on every PIN entry, and the shell chrome that survives the mode change must be either
mode-agnostic or client-rendered too.

### D2. A refresh during a parent flow costs the PIN at four points the UX walks as continuous.

AD-18 is deliberate: "A refresh or hard navigation drops the parent to the PIN — intended, and why
FR-35 exists." Cross-checking every parent-facing flow in EXPERIENCE against it:

| Parent flow | Refresh consequence | Verdict |
|---|---|---|
| Upload → Classify → Capture (UJ-1 2–4) | PIN, then FR-35 restore of the capture | **Supported** — this is FR-35's exact purpose. Note mobile browsers reload tabs under camera memory pressure, so this path is hit by accident, not only by choice. |
| Legibility check → Generate (UJ-1 4–5) | PIN; state must be restorable | **Supported** if the legibility result and classification are part of the FR-35 row (the UX requires "any partially completed upload or **classification** step" to survive). |
| Generation progress (UJ-1 6) | PIN, then must land back on progress or Pending drafts | **Supported in outcome** (AD-3's job outlives the connection; the drafts land in Pending drafts) but the UX says the parent is "advised to stay on" this screen because "v0 has no notifications and this screen is the only live completion signal." An accidental refresh converts the only completion signal into a PIN prompt. |
| Draft review (UJ-1 7–9) | PIN; edits and position must survive | **Supported** by FR-35 in principle — but see **B4**: the 72-hour TTL contradicts "persist indefinitely." |
| Analytics → drill-down → weighted regenerate (UJ-3) | PIN, then re-entry "returns the parent to where the session ended, not to the Parent View root" | **Gap** — restoring a *location* (which profile, which Topic drill-down, which Attempt scrolled to which Question) is not the same as restoring uncommitted work, and AD-16's UncommittedState models work, not position. |
| Attempt detail with an uncommitted grade override (PIN idle timeout) | PIN; the uncommitted override must survive | **Supported** by AD-16, subject to B4. |

No parent flow is *broken* by AD-18 outright — the decision is coherent and FR-35 is the right
counterweight. The residue is (i) B4's TTL, (ii) restoring navigation position, and (iii) the
generation-progress screen being the only completion signal in a design where a refresh costs the
PIN.

### D3. Suppression is per-Student-Profile, but `explanation` has no path to a profile.

Constraints index: "FR-39 suppression is a per-Student-Profile serving rule, not a deletion …
**Serving is therefore filtered per profile at read time** rather than by removing the record."

The spine handles the counting half well — AD-14: "A suppressed Explanation (FR-39) still counts
as consumed; the free regeneration it entitles carries a **flag excluding it from the count** —
not a second counter," which matches the UX requirement to "distinguish a charged generation from
a free one at the point of generation."

The scope half is thinner. `explanation` owns "Explanation, suppression state, flags," but the ER
diagram attaches `Explanation` to `Question` only, and the dependency graph gives `explanation`
edges to `practicetest` and `ai` — not to `identity`. Per-profile suppression is reachable
transitively (`Question → PracticeTest → StudentProfile`), and that works when a Practice Test is
assigned to exactly one profile, which the ER diagram asserts. Worth stating explicitly rather
than leaving to be inferred, since the UX is emphatic that suppression "is never a service-wide
takedown."

---

## Cross-check summary

**1. Behavioral requirements with architectural consequences** — the parent-facing flows survive
AD-18 (see D2); the *student*-facing offline and interruption requirements do not survive the
spine's silence (A1). The idle-timeout clock is defined two incompatible ways (B1).

**2. Progress / queued-work states** — the shapes do not match. Extraction is queued with no UX
state and is needed synchronously (A2); Generation's partial-success outcome has no UX state and
its failure copy is false under AD-14 (B3); Grading's queue-pending state is conflated with the
UX's grading-unavailable state, and a results screen held open has no way to observe the job
finishing (B5). Explanation-as-foreground is the one clean match, missing only a latency budget
(C4).

**3. The two-surface split** — supported cleanly for Student Mode and Parent View: AD-13's
mode-in-token and AD-18's split credentials map onto DESIGN's single-theme-plus-nested-provider
and per-surface density with no structural conflict, and DESIGN's content-vs-chrome font rule
costs the architecture nothing. The unpriced cost is that the accent/density swap cannot be
server-rendered (D1). The split breaks down entirely at the **third** surface: Admin has the
parent accent and density in DESIGN and four screens in EXPERIENCE, and no credential, module, or
entity ownership in the spine (A3, C5).

**4. Anything the spine makes impossible** — A1, A2, A3, reported first above.

---

## Recommended dispositions

| # | Finding | Owner | Disposition |
|---|---|---|---|
| A1 | In-progress Attempt has no home | Spine | **New AD.** Attempt row created at start with state + server start timestamp; named store for in-flight answers; expiry computed server-side. |
| A2 | Extraction queued, no UX state, needed at Generate; legibility unaccounted | Both | **New AD + UX states.** Bind the capture→legibility→extraction→generate sequence and the call-class taxonomy. |
| A3 | Admin has no credential or module | Spine | **New AD.** Admin identity/scope, module ownership, write paths, flag-queue identity model. |
| B1 | Sliding expiry vs inactivity timeout | Spine | **Amend AD-13.** Interaction-driven window; polling excluded. |
| B2 | Timezone change re-slices the running period | Spine | **Amend AD-14.** Effective-dated timezone; window resolves the zone as of the period counted. |
| B3 | Partial generation success | Both | **Amend AD-14 retry semantics + add a UX partial state**; correct the "costs nothing" copy. |
| B4 | 72h TTL vs indefinite draft durability | Spine | **Amend AD-16.** Scope the TTL to byte-carrying / parentless uncommitted state. |
| B5 | "No background job" + `ungraded` overloaded | Both | **Split the UX state** (in-progress vs unavailable); define refresh for a held-open results screen. |
| C1 | Dispute/flag unowned; analytics edges missing | Spine | Assign an owner; add `analytics --> explanation`, `analytics --> allowance`. |
| C2 | Device→Student Profile binding unmodeled | Spine | Decide where the binding lives, with the shared-tablet threat model in view. |
| C3 | PIN cooldown counter unmodeled and outside the throttler | Spine | Server-side attempt counter + lock-until on the account. |
| C4 | No latency budget for foreground Explanation | Spine | Pin timeout/retry for the foreground class separately from queued classes. |
| C5 | `Subject` / Grade Level unowned | Spine | Assign to a module (folds into A3). |
| D1 | Theme swap straddles the SSR boundary | Spine | State that Parent View is a client boundary and how the shell avoids an accent flash. |
| D2 | Refresh costs the PIN mid-flow | Spine | Extend FR-35 state to cover navigation position; acknowledge the progress-screen case. |
| D3 | Per-profile suppression scope | Spine | State the profile-scoping path explicitly. |
