---
title: PRD ↔ Architecture Spine Reconciliation
subject: n-test-reviewer v0
prd: _bmad-output/planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/prd.md
spine: _bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md
created: 2026-09-02
scope: fit between PRD and spine only — not a review of either document's internal quality
---

# Reconciliation: what the PRD requires that the spine fails to govern

The spine `binds:` all 39 FRs in its frontmatter. That claim is not met. This document
records where the spine **contradicts** the PRD, where an FR **falls through** with no AD,
no convention, no module owner and no Deferred entry, and where **quiet requirements** —
constraints expressed as tone, policy, safety or copy rather than as a feature — have been
dropped.

Verdict: the spine is strong on cost, allowance, entity ownership, deployment and the
Topic-normalization risk the PRD flagged as highest. It is silent on the entire
presentation tier — accessibility, dark mode, copy/tone, offline — and it redefines two
PRD invariants.

---

## 1. Contradictions (spine states something the PRD forbids)

These are the findings that must be resolved before build, because both documents are
currently authoritative and disagree.

### C-1. AD-4 redefines `ungraded` from a failure state into the happy-path queue-pending state

**Spine (AD-4):** "FR-22's `ungraded` **is the queue-pending state**. Submit enqueues
grading; the results screen renders immediately with deterministic Multiple Choice grades
(FR-21) and AI-graded items marked not-graded-yet. FR-22's retry-on-next-view = read the
job result if finished, re-enqueue if it failed."

**PRD:** FR-37's authoritative grade-state table defines *ungraded* as written "When AI
grading is unavailable (FR-22)" — a fault. FR-22: "If AI grading is unavailable, the
Attempt still submits and scores; affected Questions are marked *ungraded* **and surfaced
to the parent** rather than defaulted to incorrect." FR-22 further requires that while any
Question is *ungraded*, "the results header scores the Attempt over **only the gradable
Questions** ... and states the number of Questions excluded and why."

**Why this is a contradiction, not a refinement:**

1. Under AD-4, *every* Attempt with any Fill-in-the-Blank or Short Answer Question passes
   through *ungraded* on the normal path. FR-37 says the state means grading was
   unavailable. The two meanings cannot both hold.
2. FR-22 requires every *ungraded* Question to be **surfaced to the parent**. AD-4 makes
   that a per-submission event on healthy operation, converting a fault signal into noise.
   The PRD's FR-30a/FR-28 parent surfaces treat *ungraded* as something to act on.
3. FR-22's results header rule ("states the number excluded and why") would fire on every
   normal submission, showing a partial score with an exclusion notice for a system that is
   working correctly. FR-23 separately fixes the score denominator as "every Question
   presented"; a transient denominator is not what FR-23 describes.
4. FR-22 states explicitly: an *ungraded* Question "retries grading the next time the
   results screen for its Attempt is opened, by either the student or the parent.
   **There is no background job and no scheduled retry — viewing is the trigger.**"
   AD-4 makes grading precisely a background job. AD-3 reinforces it. Direct collision.
5. UJ-2 and §10 Reliability both assume the score is present at submission ("the results
   screen appears immediately: 11/15"). AD-4's model shows 4/15-of-the-MC-only first.

**What the spine actually needed to decide:** whether grading is queued at all, given FR-22
forbids background retry and UJ-2 promises an immediate full score. If grading is queued,
a **fifth, distinct pending state** is required, disjoint from *ungraded*, and FR-37's
table and FR-22's header rule both need PRD amendment. AD-2's "Four grade states ... carried
through Attempt storage" also then becomes false.

### C-2. AD-14/AD-15 "chargeable artifacts are never hard-deleted" contradicts FR-33 account and profile deletion

**Spine (AD-14):** "Chargeable artifacts are **never hard-deleted** — retirement is a status
change and the row stays countable. Deletion must not refund."
**Spine (AD-15):** "**Deletion is a state transition, not a row removal.** FR-32/FR-33 unlink
the file and blank content-bearing columns; the row survives in `deleted` state retaining
identifiers, timestamps, and account scope."

**PRD (FR-33):** "Student Profile deletion **removes** that profile's Practice Tests,
Attempts, Explanations, and Mastery." "Parent Account deletion **removes the account, every
Student Profile under it, and all Source Tests, Page Images, Extractions, Practice Tests,
Attempts, Explanations, and Mastery belonging to them**, together with any uncommitted
Parent View state still held server-side under FR-35." §5.2: "A parent can delete a Student
Profile's data and can delete the Parent Account and all associated data." §12.2 item 1
places this under an unresolved child-data legal review.

**The conflict:** AD-15's husking rule is correct and well-argued for FR-32 (Page Image
expiry) and for early image deletion, where the PRD explicitly requires derived data to
survive. It is wrong for the two erasure paths FR-33 also defines. Applying "the row
survives retaining identifiers, timestamps, and account scope" to **Parent Account
deletion** is incoherent — the allowance argument that motivates husking (the row must stay
countable so deletion cannot refund) has no referent once the account it would be counted
against is gone. The PRD's promise is data erasure; the spine's rule is data retention
under a status flag, and it is stated as covering "FR-32/FR-33" without carve-out.

**Also unmet:** FR-33's testable consequence "Deletion completes without leaving orphaned
stored files" and its feature-level NFR "a partial deletion that leaves image bytes behind
fails this requirement." AD-15's sweeper covers rows, and its "unlink the file" clause
covers bytes for Page Images; nothing covers Explanation text, Answer text, or Question
content on the profile/account erasure path, where AD-15 says only "blank content-bearing
columns" — never stated to include those.

**Needs:** an explicit three-tier deletion taxonomy in the spine — *expiry/early image
deletion* (husk, derived data survives), *profile deletion* (erase profile-scoped content,
keep account-scoped countable husks), *account deletion* (erase, full stop) — with the
allowance-integrity argument scoped to only the first two.

### C-3. AD-13's sliding expiry is not FR-34's idle timeout

**Spine (AD-13):** "**Sliding expiry:** every parent-scoped request returns a refreshed
token carrying a new 15-minute window."

**PRD (FR-34):** "The idle window is **15 minutes with no parent interaction**." The
`[ASSUMPTION]` behind it names the failure it prevents: "a tablet left on the kitchen
counter is not an open Parent View." §10 Security: "an unattended family tablet does not
sit in an elevated state indefinitely."

**The conflict:** *request* is not *parent interaction*. AD-3 requires progress surfaces to
poll job status; a parent who taps **Generate** and walks away leaves a screen polling a
parent-scoped endpoint, refreshing the elevation token indefinitely. The exact scenario
FR-34 exists to prevent is the one AD-13's rule permits. AD-13 also does not state where
the 15-minute clock lives, and FR-34 requires it to be enforced server-side (§10: "a client
that fails to expire does not retain Parent View authority").

**Needs:** either token refresh gated on user-initiated requests only (polling excluded
from refresh), or an absolute last-interaction timestamp held server-side against which
every parent-scoped request is checked.

### C-4. FR-35's cross-Student-Profile rejection is downgraded to account scoping

**PRD (FR-35):** "**A fetch of retained state belonging to a different Student Profile is
rejected server-side.** *Why:* Pending drafts span Student Profiles (§6.3) while FR-34 binds
to the last-bound profile, so without this rejection one child's retained draft state can
strand on a device a sibling now operates."

**Spine (AD-15):** FR-35 state is "owned by the Parent Account, with a state and a TTL,
readable only against a parent-scoped token (AD-13)." AD-13: "FR-35 restore is gated on
presenting a parent-scoped token."

**The conflict:** Parent-Account scoping is strictly weaker than what FR-35 requires. Both
siblings' retained state sits under one Parent Account, so an account-scoped check passes
in exactly the case FR-35 names as the failure. The spine's rule, implemented literally,
does not satisfy the FR.

### C-5. AD-23's global spend ceiling can block grading, which FR-31 forbids

**Spine (AD-23):** "A global daily spend ceiling enforced against the AiCall table — total
across all accounts ... Crossing the configured limit **refuses new AI work** and fires an
alert." No carve-out.

**PRD (FR-31):** "**AI grading (FR-22) is never blocked by an allowance at any tier.**
*Why:* ... a student must never be unable to find out whether they were right." §5.1 and
§10 Reliability carry the same position.

Strictly, FR-31 governs *allowances* and AD-23 is a different mechanism, which is why this
sits last among the contradictions — but the product invariant it protects is stated in
absolute terms and AD-23 breaches it. The spine should either exempt Grading from the
ceiling or state that a ceiling breach degrades grading to *ungraded* (FR-22's defined
degradation) rather than refusing it.

### C-6 (soft). AD-16's 72-hour TTL can destroy work FR-35 promises to preserve

AD-16: "One TTL, 72 hours from row creation ... **not** extended by activity ... Expiry
deletes the row outright." FR-35: "A partially completed upload is retained ... **No Page
Image is lost to expiry.**" A parent whose capture session spans a boundary 72 hours after
the *first* page row was created loses pages mid-flow, with no warning — FR-34's silent
expiry is the reason FR-35 exists, and a silent TTL deletion reintroduces the same loss.
Non-extension by activity is the specific clause in tension.

---

## 2. FRs that fall through — no AD, no convention, no module rule, no Deferred entry

Walked FR-1 through FR-39 including FR-9a, FR-24a, FR-26a, FR-30a. The Capability →
Architecture Map assigns every §4 subsection to a module, so nothing is *unassigned*; the
list below is FRs whose load-bearing substance has no governing rule anywhere in the spine.

### U-1. FR-8 — the pre-generation legibility check is not an AI call class

FR-8 requires the system to "evaluate each Page Image for readability" and report
**per-page readability confidence**, "once, as a single batch over all pages, immediately
after capture is finished." This is a vision workload over up to 10 images.

The spine enumerates AI call classes three times and never includes it:
- AD-2: "**Four** AI call classes ... Extraction (vision, up to 10 images), Generation,
  Grading, Explanation."
- AD-4: queue/foreground split covers those four only.
- AD-8: model pins for those four (plus Topic normalization, itself inconsistent with AD-2's
  count).
- AD-20: AiCall `call class` enumerated as "(Extraction, Generation, Grading, Explanation,
  Topic normalization)" — a legibility call would be uncosted and unattributed.

So FR-8 has: no model pin, no queue-vs-foreground decision, no timeout (AD-7 overrides the
30s default for Extraction only — a 10-image legibility call inherits the 30s that AD-7
itself calls "90s of guaranteed failure"), no cost attribution row, and no test-fake
coverage under AD-22. FR-8 is also the point at which §5.3's most expensive counter is
committed (FR-8: "proceeding commits the Source Test and will spend one Upload Allowance"),
so its placement relative to the AD-14 transaction matters and is unstated.

Nor is the alternative governed: if the check is intended to be non-AI (blur/resolution
heuristics client-side), no rule, library, or convention says so, and FR-8's "per-page
readability confidence" is not obviously a local computation.

### U-2. FR-36 — offline behaviour has no governing decision anywhere

FR-36 requires that with no network the student can keep answering and navigating
(FR-17/FR-18), that nothing entered is lost, that submission is refused with a plain
message and **never silently retried**, and that "a timer that expires while offline
auto-submits on reconnect, **graded against the moment of expiry, not the moment of
reconnect**." §9.2 names this the single carve-out from network-required.

The spine contains no client-state, offline, service-worker, local-persistence, or
reconnect-sync decision. AD-17 gives `practicetest` ownership of `Answer` rows, which is a
server-side statement; AD-18 governs credentials, not data. Nothing states where in-flight
answers live while offline, how they reconcile on reconnect, or what wins on conflict.
AD-22's test tiers do not include an offline scenario, though FR-36 is entirely a
failure-mode requirement.

This also strands FR-18 ("survives app backgrounding, refresh, and device sleep") on the
same gap.

### U-3. FR-15 / FR-36 — timer authority (client clock vs server clock) is unassigned

FR-15 requires auto-submit on expiry with every blank graded *incorrect* — the one path in
the whole PRD that writes *incorrect* to an unanswered Question (FR-37). FR-36 requires an
offline expiry to be **graded against the moment of expiry**, established while the device
had no connection. FR-18 requires the timer to track wall-clock across interruption.

Together these require a defensible expiry timestamp that survives a disconnected client,
which is an architecture decision (server-issued deadline at Attempt start? client
timestamp trusted and reconciled?). The spine does not make it. The stakes are direct: the
timer decides whether a Question is *incorrect* or *unanswered*, and FR-37/FR-26/FR-27 all
turn on that distinction, so a wrong answer here corrupts Mastery, not just a score.

### U-4. FR-5 — the image ingestion pipeline has no owner or dependency

FR-5's testable consequences include: supported formats JPEG/PNG/WebP/HEIC/HEIF; "**Format
is determined by inspecting the file's bytes, not by trusting the client-declared type**";
"HEIC/HEIF — the iPhone camera default — is **converted server-side** before any AI
processing"; "**EXIF orientation is honored**, so a page photographed in portrait is not
read sideways."

AD-15 governs the *row* and the storage path (correctly, and it doubles as the
path-traversal control). Nothing governs the bytes. The Stack table lists no image library
(no sharp, no libvips, no heic decoder), the Deferred list does not mention it, and no
convention says which module performs conversion. Given HEIC is the iPhone camera default
and the product is mobile-first camera capture, this is the default path, not an edge case.
EXIF orientation failure additionally degrades Extraction quality silently.

Byte-sniffing is also a security control (§10 Security, and the upload endpoint is the one
unauthenticated-adjacent large-payload surface AD-23 otherwise hardens).

### U-5. FR-24 — the Explanation cache key is undecided and has a safety dependent

FR-24: "A generated Explanation is **cached and re-shown without regeneration** on
subsequent views of the same Question and answer." FR-39: the free replacement "is generated
fresh rather than served from cache" and the suppressed original must not be re-served.
AD-14 depends on a key model ("A suppressed Explanation (FR-39) still counts as consumed;
the free regeneration it entitles carries a flag excluding it from the count").

§12.2 item 6 is an **open PRD question explicitly flagged as having an architecture-critical
dependent**: "a regeneration after a parent suppression must produce a *different* cached
entry from the suppressed one and must be served in its place for that Student Profile,
which every candidate key has to satisfy before it can be chosen. **A key that collides the
replacement with the suppressed original silently reinstates content a parent removed.**"

The spine names no cache key, no cache mechanism, and carries no Deferred entry for it. This
is the one open PRD item where the failure mode is a child-safety regression, and it is the
only §12.2 item owned by the architecture workflow's neighbourhood that the spine leaves
untouched. (By contrast §12.2 item 2, Topic normalization, is well resolved by AD-11, and
item 5, Extraction timeout, by AD-7.)

### U-6. FR-2 — PIN lockout state has no home

FR-2: "After **3 consecutive failed PIN entries**, Parent View entry is locked for a
cool-down period, and **the failure count persists across app restart**." FR-34 restates
that the cool-down applies identically to expiry-triggered prompts.

AD-1 covers argon2 hashing of the PIN. AD-13/AD-18 cover the token. Nothing owns the failure
counter or the lock window. It cannot live in the elevation token (there is none before the
PIN succeeds) and AD-18 forbids persisting parent credentials client-side; persistence
across app restart therefore forces a server-side entity, which appears in neither the
`identity` cluster description nor the ER diagram. AD-23's throttler covers *unauthenticated*
endpoints; the PIN endpoint is authenticated by the session cookie, so it is outside AD-23's
stated scope while being the highest-value brute-force target in the product (a 4-digit PIN,
attacked by someone holding the device).

### U-7. FR-30 / FR-30a — Admin authentication and authorization are ungoverned

FR-30: "**Admin surfaces are inaccessible to Parent Accounts.**" FR-30a exposes every
account, its tier, and its consumption. §6.3: "Admin is a separate surface, unreachable from
any Parent Account."

The spine's entire auth model (AD-13, AD-18, and the Auth convention row) describes exactly
two credentials — the parent session cookie and the in-memory elevation token. There is no
Admin principal, no Admin scope, no statement of how the Admin surface authenticates.
The Deferred list has "Admin-surface module **ownership**" — that entry is about entity
ownership in the decomposition, not about authentication, and does not cover this.

The PRD does carry a `[NOTE FOR PM]` that admin auth is "deliberately thin," which makes
*thin* acceptable — but "thin" still has to be a decision, and the spine does not make one
or mirror the deferral.

### U-8. FR-27 — threshold configuration has no mechanism

FR-27: "Both the 60% threshold and the 5-question floor are **system-level configuration,
tunable post-launch**; neither is a per-parent setting in v0." The spine's Config convention
row covers model ids and deploy secrets only. AD-6 hard-states the FR-26 window ("the 5 most
recent qualifying Attempts") as an invariant rather than as configuration, and says nothing
about FR-27's two numbers. Tunable-post-launch on a single-environment, deploy-on-push
droplet (AD-19) is a real constraint — it means either env vars on the host or a config
table — and neither is chosen.

Related, and also unmirrored: **§12.2 item 9** records that the FR-27 5-question floor "has
no stated window" and calls it "not a tuning question — a definition gap," owned by the PM,
revisit "before Mastery is implemented." AD-6 specifies the Mastery window precisely and is
silent on the floor's window, so the spine implements around an acknowledged gap without
recording it. Same for **§12.2 item 10** (a resolved *ungraded* batch retroactively creating
a Weak Area) and **§12.2 item 4** (the Practice Test question-count derivation, owner "the
PM, with the architecture workflow," revisit "before generation is implemented") — three
open items the spine neither resolves nor defers.

### U-9. Weakly governed (owner exists, rule does not)

- **FR-9a** — the thin-Extraction warning is a mandatory human gate *between* the extraction
  job completing and the generation job being enqueued. AD-3/AD-4 describe enqueue-and-poll
  but not a job whose completion parks awaiting parent disposition. The `[NOTE FOR PM]`-free
  consequence "Choosing to retake pages rather than proceed consumes no Generation
  Allowance" is satisfied by AD-14 by construction.
- **FR-16** — the fixed sort (all *released* first, then *completed* newest-first),
  indefinite retention, and the three distinguishable card conditions are stated by the PRD
  as load-bearing and not user-configurable, with a recorded remedy (bounded tail) if the
  list becomes unusable. No spine rule; AD-14's never-hard-delete happens to support the
  retention half.
- **FR-17** — the question map is treated by the spine as pure UI, but §10.1 makes it an
  accessibility contract (see Q-1) and FR-19 makes it the remedy its submit confirmation
  depends on.
- **FR-22 rationale** — "persisted with the Attempt and readable by the parent **on the
  Question's own row**... Writing it only to a log does not satisfy this requirement." The
  `grading` cluster is described as "grade state, Mastery"; the rationale is not named as an
  owned field, and AD-20 forbids it in logs (correctly) without placing it anywhere.
- **FR-25 override** — "retains the original AI grade and its rationale rather than
  overwriting them," and the overridden row is marked parent-adjusted. AD-10 governs the
  recompute; nothing governs the dual-value retention the FR requires.
- **FR-1 consent record** — "recorded against the Parent Account with the timestamp and the
  **version of the notice accepted**." No entity in the ER diagram, no field named in
  `identity`. This is the artifact the §12.2 item 1 legal review will be evidenced against.

---

## 3. Non-functional requirements (PRD §10)

| §10 NFR | Spine coverage | Verdict |
|---|---|---|
| **Performance** — Student Mode interactions instant on a mid-range tablet; generation async with progress; **Explanation generation is a foreground wait and must stay short enough not to break a study session** | AD-3/AD-4 make generation async and Explanation foreground. No latency budget anywhere; no rule bounding the foreground Explanation wait; no perf test tier in AD-22 | **Partial.** The one NFR with a stated behavioural consequence (the foreground wait) has no bound, though AD-4 deliberately chose the design that exposes it |
| **Reliability** — no AI failure loses student work | AD-3, AD-22's "the fake must be able to fail," AD-15's row-first rule | **Covered**, except the offline half (U-2) |
| **Security** — hashing, TLS, server-side authz per Parent Account for **every Page Image**, Practice Test, Attempt and Analytics query; Student Mode restrictions not client-side-only; expiry enforced server-side | AD-1 (argon2), AD-19 (Caddy/ACME TLS), AD-13/AD-18 (server-side scope checks) | **Mostly covered, one gap:** "authorization enforced server-side ... for every **Page Image**" is not carried. AD-19 mounts `uploads_data` behind Caddy and AD-15 derives paths from row ids, but nothing forbids serving image bytes as static files. Static serving is the natural implementation of that topology and would breach the NFR silently — an unguessable path is not authorization |
| **Observability** — outcome, latency, and **cost attribution per Parent Account** | AD-20 in full, plus correlation ids and a child-content denylist | **Covered well** — one of the spine's strongest areas |
| **Data lifecycle** — deletion propagates to Page Images, Extractions, Practice Tests, Attempts, Mastery | AD-15 | **Contradicted** — see C-2 |
| **Accessibility (§10.1)** | — | **Silently dropped in full** — see Q-1 |

### Additionally dropped from §6.1 / §9.1: dark mode

§6.1: "**Dark mode ships in v0**, on both Student Mode and Parent View. Every design token
has a dark counterpart, and every contrast pair required by §10.1 is verified in both modes
rather than in light only. **This is scope, not polish.**" §9.1 lists it as an in-scope
capability. §6.1 explains precisely why it is not an FR: "Dark mode carries no functional
requirement of its own ... so it is enforced as a §10.1 accessibility obligation."

The spine mentions MUI 9.4.0 and nothing else. There is no theming decision, no design-token
convention, no statement that both palettes ship. This is the textbook case the brief
predicted — a requirement the PRD deliberately expressed as an obligation rather than an FR,
which an AD structure organized around FRs drops without noticing.

§6.1's other stated constraints — mobile-first responsive, single codebase, no app store,
**camera access via the browser**, usable one-handed on a phone and on a family tablet,
desktop supported but not optimized — are likewise uncarried. The browser-camera constraint
in particular interacts with FR-5's camera-unavailable path, which is itself an emphasized
requirement ("not as a degraded fallback and not on a separate flow").

---

## 4. Quiet requirements the spine does not carry

Constraints expressed as tone, policy, child-safety, or copy rules. Each of these is
testable in the PRD and has an architectural consequence.

### Q-1. §10.1 Accessibility — dropped entirely

The PRD gives accessibility its own subsection with concrete, testable obligations, several
of which are structural rather than cosmetic:

- **Target WCAG 2.1 AA for student-facing surfaces**: sufficient contrast, adequate tap
  targets for a child's hands, screen-reader-labeled inputs, and "**correct/incorrect state
  never conveyed by color alone**" — this last one constrains how FR-23's answer key and
  FR-37's four grade states are rendered on every surface.
- **Contrast verified in both light and dark mode** — "a pair that passes in one mode and
  not the other fails this requirement."
- **Timer**: exposed to assistive technology *as a timer*, labeled with what it counts down,
  queryable on demand, and **deliberately not continuously announced** — it "speaks only at
  the three warning thresholds FR-15 sets and is otherwise silent, because a per-second
  announcement would make the test unusable with a screen reader."
- **Auto-submit on expiry is announced immediately and interrupts.**
- **Question map**: "built from **real buttons, not decorative cells**", fully keyboard
  navigable, each entry "**individually announced with its progress state**" rather than
  distinguished by color/fill/position, with the student's current position exposed to
  assistive technology. The PRD states the stakes: "the map is the only path back to a
  skipped Question, so a map that is visually navigable but not operable by keyboard or
  screen reader withdraws the remedy FR-19's confirmation depends on."
- **Fractions**: each rendered fraction "exposed to assistive technology as a single value
  with a spoken alternative that reads as the number ('five sixths', never 'five six' or
  'five slash six')" — and the PRD is explicit that the requirement lands on **generation
  output**, not styling. FR-9, FR-10 and FR-24 each carry the structured-emission clause.
- **SC 2.2.1 conformance argument**: the timer is claimed under the essential exception, the
  claim is narrowed by three facts (optional, off by default, parent-set per test), other
  exceptions are explicitly **not** claimed, and "any future change that makes the timer
  mandatory or system-set invalidates this claim and must revisit it."

**Spine coverage: none.** No AD, no convention row, no Deferred entry, no test tier. AD-22
defines three test tiers and none of them is accessibility; AD-9's structured-output rule is
the natural home for the fraction-emission constraint (it governs "every call whose output is
parsed rather than displayed") and does not mention it, even though FR-9/FR-10/FR-24 make
structured fractions a **schema** requirement on Extraction, Generation and Explanation
output — i.e. squarely inside AD-9's remit.

The fraction requirement is the clearest example of an accessibility rule with a hard
architectural consequence: it changes the Zod schemas AD-9 mandates, and it must survive
into the Explanation call, which AD-4 routes foreground.

### Q-2. §7 — the string/copy system is an architectural layer, and it is absent

§7: "**No result or analytics string is a fixed literal.** Every string that describes a
student's work — scores, Mastery figures, Weak Areas, activity summaries, dispute and flag
notices, at-cap messages about that child's practice — **takes the subject as a parameter
and resolves its mode of address by surface**: Student Mode addresses the student in the
second person ('you left 3 questions unanswered'), Parent View names the child in the third
person ('Noah left 3 questions unanswered'). **Writing the same sentence twice, or shipping
a Parent View string that says 'you', is a defect.**"

With the paired exception: "**grade-state labels** — *correct*, *incorrect*, *unanswered*,
*ungraded* — are fixed literals on purpose, identical on every surface, because a grade state
that is worded differently in two places reads as two different states." FR-37 restates this
("The four state labels are fixed literals, identical on every surface").

This is a shared, parameterized copy layer with a person/surface resolution rule and an
explicit carve-out list — a cross-cutting structural concern of exactly the kind the spine's
Consistency Conventions table exists to hold. §9.2 defers *localization* ("English only"),
which is a different thing and does not cover it. Nothing in the spine mentions strings,
copy, or address-mode. Two surfaces (`apps/web` Student Mode and Parent View) rendering the
same figures with no shared parameterized source is the default outcome, and the PRD calls
that outcome a defect.

### Q-3. Child-facing data-exposure rules — nothing enforces them server-side

Three PRD rules state that specific data must never reach the student surface:

- **FR-24:** "**No running Explanation counter, remaining balance, or usage bar is ever shown
  to the student.** The counter is a parent-facing figure and appears only in Parent View
  (FR-28, FR-31). The student meets the limit at most once, at the moment it blocks, and
  never as a tally that follows them through the results screen." Rationale: "a visible
  countdown teaches a child to ration the question they should be asking, which suppresses
  exactly the behavior SM-4 measures."
- **FR-25:** "In Student Mode the student sees the adjusted grade, with one plain line
  stating that a parent reviewed it. **The AI rationale and the override mechanics are not
  surfaced to the student.**"
- **FR-35:** retained uncommitted state "**excludes the AI grading rationale**. The rationale
  is re-read from the Attempt on restoration and is never carried in retained state" —
  because "retained state on a device that has fallen back to Student Mode must not become
  the route by which it is surfaced."

The spine has a precise analogue for the logging boundary (AD-20: "No log line, trace, error
report, or AiCall row ever carries Page Image bytes, extracted Question content, Explanation
text, or a child's Answers") and AD-21 hardens it at Sentry. It has **no equivalent rule for
the student-facing API boundary**. AD-13/AD-18 govern *authorization* — can this caller reach
this endpoint — not *response shaping*: the student is legitimately authorized to read their
own Attempt, and the rationale and the allowance counter both live on objects the student
legitimately reads. This is precisely the class of leak the PRD anticipated, and FR-35's
clause shows the PRD author already traced one route for it.

### Q-4. §5.2 — provider terms must exclude content from model training

"**Third-party AI processing must be under terms that exclude the content from provider model
training.** This covers **every model call class, not only the vision call over Page
Images**: Extraction, generation, grading, and Explanation. Grading (FR-22) sends the child's
own typed answers, is the highest-frequency call in the product, and is uncapped at every
tier — excluding photographs from training while sending a child's free-text answers
uncovered would be an incoherent commitment."

AD-1 makes OpenAI a hard dependency and reuses the n-electric client configuration; AD-8
pins snapshots; AD-20 keeps child content out of logs. Nothing binds the provider account,
organization settings, endpoint choice, or data-retention configuration to this commitment,
and nothing states it as a constraint on the `ai` module — which AD-17 makes the single
place where such a constraint could be enforced ("All AI calls are centralized in one `ai`
module, which owns the OpenAI client"). It is a privacy commitment made to parents in §5.2
and it survives nowhere in the build substrate.

### Q-5. §5.2 / §12.2 item 1 — the registration launch gate

"Legal review of this posture is a **launch gate**: it blocks opening public registration,
not development. **Until it clears, registration stays closed or invitation-only.**" §12.2
item 1 repeats it with a revisit condition ("before public registration opens").

AD-19 ships continuous deployment to a single production environment on every push to `main`
("**One environment, production only.** No staging tier in v0"), and AD-23 explicitly scopes
signup as a live public endpoint with rate limits, listing "email-verification gating" as
deliberately not in v0. Nothing carries the closed/invitation-only constraint, and the
one-environment topology means the first deploy that includes a signup form opens public
registration. The PRD's launch gate has no mechanism.

### Q-6. §5.1 — generation is constrained to the Source Test's academic subject matter

"Every AI-generated Question and every AI-generated Explanation is child-directed content.
**Generation must be constrained to the Source Test's academic subject matter**", and
"Uninterpretable Source Test content must not be hallucinated into Questions (FR-9)."

The spine's only prompt rule points the other way: AD-17's "**Carve-out: prompt text stays
in the domain module** that needs it." That is a defensible decomposition choice, but it
distributes the one place a child-directed-content constraint would be enforced across
`extraction`, `practicetest`, `explanation`, `grading` and `topics` with no shared rule, no
shared safety preamble, and no test. AD-22's fake "must be able to fail ... provider
refusals" — the closest thing — is about resilience, not content policy. FR-9's
uninterpretable-content rule ("recorded as uninterpretable rather than guessed at") is a
schema-level requirement that AD-9 could carry and does not.

### Q-7. §7 anti-gamification and the non-punitive register

- "**Anti-reference:** gamified ed-tech — no streaks, badges, mascots, or points in v0."
  §8 repeats it as a permanent stance.
- "a wrong answer must never read as punishment"; Explanations use "encouraging, plain,
  grade-appropriate language — no condescension, no exclamation-mark cheerleading."
- **FR-23 turns this into a structural rule:** "The answer key is presented in the **original
  Question order** of the Attempt. Wrong answers are never sorted, grouped, or promoted to
  the top, and there is **no 'show only what I got wrong' default view**." The rationale is
  explicitly §7 ("a student who scored 6/15 would meet a solid block of wrong answers before
  anything else").
- **FR-24 at-cap copy:** "**blames the plan, not the child** ... carries **no exclamation
  marks, no apology, and no upsell aimed at the child**"; a failed Explanation "is never
  framed as the student's fault or as a limit on their understanding."
- **FR-28 empty state:** "does not name the Account Tier as the cause and **carries no
  upsell**."
- **FR-39:** the student "is shown that the Explanation was removed by their parent rather
  than an empty space or an error."

FR-23's ordering rule is a query/rendering constraint, not a copy preference, and it has no
owner. The rest belong with Q-2's copy layer. None of it appears in the spine.

### Q-8. §11 success-metric instrumentation

Six SMs and three counter-metrics, each cross-referencing the FRs it validates: SM-1
upload-to-release completion, SM-2 completion rate within 7 days, SM-3 repeat upload within
30 days, SM-4 Explanation engagement, SM-5 parent edit rate on drafts, SM-6 dispute rate and
upheld share; counter-metrics SM-C1 tests per Source Test, SM-C2 student time in app, SM-C3
retake score improvement. SM-1 is named inside FR-5 as the reason the camera-unavailable
path must not dead-end.

The spine's only measurement decision is AD-20's AiCall table (provider cost). No product
event instrumentation is governed. Several SMs need events that no entity currently records —
SM-1 needs *started* uploads (AD-15's `uploading` rows are swept and deleted outright per
AD-16, destroying the denominator), SM-C2 needs session timing, SM-5 needs edit events on
draft Questions. Worth at least a Deferred entry, since AD-16's sweep actively removes SM-1's
data.

---

## 5. What the spine covers well (for contrast)

Recorded so the findings above are read as gaps in an otherwise sound artifact, not as a
verdict on it:

- **FR-31 / §5.3 allowances** — AD-14 is the strongest decision in the document. Deriving
  usage as a COUNT eliminates the reset job, the DST bug, the drift between four counting
  sites, and the refund-on-delete hole, and it correctly encodes "charges on first reaching
  draft and never again" and the FR-39 free-regeneration flag.
- **FR-26a Topic normalization** — the PRD's self-declared "highest-risk requirement" and
  §12.2 item 2. AD-11's three-stage cascade behind one interface, plus AD-12's provisional
  flag and operator queue, resolves both the mechanism and the §14 deferral that no operator
  capability curated the canonical set. AD-12's merge-recomputes-Mastery clause ("Built from
  the start, not retrofitted") is exactly right.
- **FR-26 Mastery** — AD-6 and AD-10 correctly make Mastery stored, single-writer,
  recomputed-not-incremented, and transactionally consistent with the grade change.
- **§12.2 item 5 (Extraction timeout)** — resolved by AD-7 with the reasoning shown.
- **§10 Observability** — AD-20 and AD-21 exceed what §10 asks for.
- **Deployment** — AD-19 is complete, including the migration race, the rollback pointer,
  and the uploads-volume backup gap the PRD never raised.

---

## 6. Recommended dispositions

| # | Finding | Disposition |
|---|---|---|
| C-1 | `ungraded` redefined by AD-4 | **Blocking.** Either drop queued grading, or introduce a fifth pending state and amend FR-37/FR-22 in the PRD. Cannot ship as two documents. |
| C-2 | Husk-everything vs FR-33 erasure | **Blocking.** Add a three-tier deletion taxonomy to AD-15; scope AD-14's countability argument to expiry and image deletion only. |
| C-3 | Sliding expiry vs idle timeout | Amend AD-13: refresh on user-initiated requests only, or hold a server-side last-interaction timestamp. |
| C-4 | FR-35 cross-profile rejection | Amend AD-15 to scope uncommitted state to the Student Profile, not only the Parent Account. |
| C-5 | Spend ceiling vs never-block-grading | Exempt Grading from AD-23's ceiling, or degrade to *ungraded* rather than refuse. |
| C-6 | 72h TTL vs "no Page Image is lost" | Extend TTL on activity for capture sessions, or warn before expiry. |
| U-1 | FR-8 legibility check | New AD or an extension of AD-2/AD-4/AD-8/AD-20 covering a fifth call class — or an explicit decision that it is non-AI. |
| U-2 | FR-36 offline | New AD: client-side Attempt state, reconnect reconciliation, no silent retry. Add an AD-22 tier-2 scenario. |
| U-3 | Timer authority | New rule: server-issued deadline at Attempt start; expiry timestamp is the authority for FR-15/FR-36 grading. |
| U-4 | Image pipeline | Name the library in the Stack table; assign conversion/byte-sniffing/EXIF to `sourcetest` under AD-15. |
| U-5 | Explanation cache key | Deferred entry at minimum, with the FR-39 collision constraint stated as the acceptance test. |
| U-6 | PIN lockout state | Add the counter to `identity`'s owned cluster and the ER diagram; note it is outside AD-23's scope. |
| U-7 | Admin auth | Make the thin decision explicitly, or mirror the PRD's `[NOTE FOR PM]` as a Deferred entry. |
| U-8 | FR-27 config + §12.2 items 4, 9, 10 | Add a configuration convention row; add Deferred entries mirroring the three open PM items the build will hit. |
| Q-1 | Accessibility | New AD. The fraction-emission clause belongs in AD-9 (schema-level); the rest needs an a11y gate in AD-22. |
| Q-2 | Copy/address-mode layer | New convention row plus an owner module or shared package. |
| Q-3 | Child-facing exposure rules | New AD mirroring AD-20's denylist at the student-facing API boundary. |
| Q-4 | Provider training-exclusion terms | Constraint on the `ai` module in AD-1 or AD-17. |
| Q-5 | Registration launch gate | Mechanism in AD-19/AD-23 (invite codes or a registration flag), or an explicit Deferred entry. |
| Q-6 | Subject-matter constraint on generation | Shared safety preamble rule despite AD-17's prompt carve-out. |
| Q-7 | Anti-punitive rendering (esp. FR-23 ordering) | Fold into Q-2's copy layer; FR-23's ordering needs a query-level rule. |
| Q-8 | SM instrumentation | Deferred entry; note AD-16's sweep destroys SM-1's denominator. |
| — | Dark mode (§6.1/§9.1) | New AD or convention: dual token set, contrast verified in both modes. Currently absent despite being named in-scope. |
| — | Page Image authorization (§10) | State that image bytes are served through an authorizing endpoint, never as static files from the uploads volume. |
| — | FR-1 consent record | Add the entity/fields to `identity` and the ER diagram. |
