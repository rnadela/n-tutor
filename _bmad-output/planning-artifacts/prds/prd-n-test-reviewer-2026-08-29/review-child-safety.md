# Review: Child Privacy and Safety Lens

**Artifact:** `prd.md` (838 lines, FR-1 – FR-38) + `addendum.md`
**Date:** 2026-08-31
**Lens:** Child privacy and safety. This product photographs children's schoolwork, stores a longitudinal record of a named child's academic performance, is operated on a shared family tablet, is used directly by children aged ~10, and puts AI-generated text in front of those children without a human reading it first. Every finding below is assessed against that, not against product polish.

**Counts:** 2 Critical · 5 High · 6 Medium · 3 Low (16 total)
**Confirmed defects:** 11 · **Risks needing a decision:** 5

---

## Section A — Confirmed defects

### C-1 (CRITICAL) — FR-35 retains a child's schoolwork photos and cross-profile draft state across the Student Mode boundary, on a device the PRD says is shared with the child

**Sections:** FR-35, against FR-4, FR-34, FR-25, §10 Security, §5.2

FR-4 is unambiguous: *"In Student Mode, no upload, generation, release, cross-profile data, or Analytics surface is reachable — not by navigation, not by direct URL."* FR-35 requires that *"a partially completed upload is retained: captured or selected Page Images, their order, and the Subject and Grade Level classification chosen so far… No Page Image is lost to expiry"* — across a silent, no-warning, no-confirmation transition (FR-34) into Student Mode on a family tablet.

The update was applied on the reading that **retained state is not a reachable surface**. Assessed on its merits, that reading is *defensible in principle and unsupported in this document*. It holds only under a storage model the PRD never states, and both models the PRD leaves open breach something:

**If the retained state lives client-side** (in-memory SPA state, `localStorage`, or IndexedDB — the natural implementation for pre-submission camera captures, which is what "captured or selected Page Images" describes):

- The image bytes of a child's schoolwork sit in the Student Mode origin's storage, on the tablet the child is now holding, for an unbounded period.
- FR-4's "not by direct URL" is satisfied trivially and vacuously — an in-memory blob has no URL. The protection that matters, which is that the data is *not present*, is absent.
- §10 Security states: *"Authorization enforced server-side per Parent Account for every Page Image… Student Mode restrictions are not client-side-only (FR-4)."* Client-side retention makes a route guard the sole barrier for this one data class, which is precisely the arrangement §10 forbids. FR-35 would silently carve an exception into the PRD's own strongest security sentence.
- Concretely: Maria photographs three pages of Noah's returned Math test, is interrupted, puts the tablet down. Fifteen minutes later the tablet is in Student Mode. Noah — or his sibling, or a visiting friend, or anyone who picks the tablet up — is on a device that is holding those three photographs in a store the running application can read. Nothing in the PRD says otherwise.

**If the retained state lives server-side** (the safe model), FR-35 creates a new class of Page Image bytes that:

- Have **no Source Test**, because the parent has not submitted. FR-32's expiry clock is defined as *"90 days after the upload of their Source Test"* — a clock that never starts for an artifact that has no Source Test. See H-1.
- Are stored **before** the parent has committed an Upload Allowance. FR-8 and FR-31 both promise that abandoning before the proceed action *"spends nothing"* — a promise about cost that the parent will read as a promise about commitment. Server-side pre-commit persistence quietly makes "abandon" mean "we kept it anyway."

**A second, independent breach in the same FR.** FR-35 also retains *"an uncommitted grade override in progress (FR-25), including the original AI grade and rationale it was being decided against"* and the parent's position in Draft review. Two problems:

1. FR-25 states explicitly: *"The AI rationale and the override mechanics are not surfaced to the student."* FR-35 requires carrying exactly that payload across a transition into the student's own mode.
2. §6 defines Pending drafts as *"every draft Practice Test awaiting review, **across Student Profiles**."* FR-34 binds the device on expiry to *"the Student Profile it was last bound to."* Those two are independent. A parent reviewing a draft for child A, expiring onto a device bound to child B, produces retained cross-profile state on a device now operated by a sibling — the exact category FR-4 names as forbidden ("cross-profile data"). This is intra-account so §5.2's cross-*account* clause does not reach it, but FR-4 does, and it is a real child-privacy exposure: one child's test performance and draft material sitting behind a sibling's session.

**Verdict:** The "retained state is not a reachable surface" reading is not wrong as an abstract distinction — it is unsupported here. FR-35 asserts a persistence guarantee without saying where the state lives, and FR-4's guarantee is only meaningful as a statement about *where data is*, not about *what is routable*. As written this is a confirmed contradiction, not a difference of interpretation.

**Fix (all four, as added Consequences on FR-35):**

1. *"All uncommitted Parent View state, including captured Page Images, is persisted server-side against the Parent Account session. No uncommitted parent state — image bytes, draft edits, grading rationale, or Draft-review position — is retained in client-side storage or in client memory once Parent View expires. On expiry the client discards it; on PIN re-entry it is fetched again."*
2. *"Restoration occurs only after successful Parent PIN entry (FR-2). No retained state is fetched, rehydrated, or rendered while the device is in Student Mode."*
3. *"Retained state referencing a Student Profile other than the one the device is bound to is never fetched by a client in Student Mode, and server-side authorization rejects such a request rather than relying on the client not making it."*
4. *"Pre-commit Page Images retained under this FR are subject to their own TTL and deletion path"* — see H-1.

Add the mirrored guarantee to FR-4: *"This includes retained uncommitted Parent View state (FR-35), which is not readable by a client in Student Mode."*

---

### C-2 (CRITICAL) — The AI-content accountability chain has no remediation terminus: nothing in the PRD can remove a bad Explanation from a child's screen

**Sections:** §5.1, FR-24, FR-24a, FR-38, FR-30a

§5.1 stakes the case for showing children un-reviewed AI content on this argument: *"Accountability is after the fact rather than preventive: every Explanation is retained and readable by the parent, who can flag a bad one (FR-24a)."* FR-38 extends the chain with a student-originated flag, correctly routed parent-first.

Trace the chain to its end:

1. Child is shown an Explanation (FR-24) — no review.
2. Child or parent flags it (FR-38 / FR-24a).
3. Parent confirms; it reaches the Admin queue (FR-30a).
4. FR-30a: flagged Explanations are *"visible here as a content-quality signal."*
5. **Nothing.**

No FR in the document permits anyone — parent, Admin, or system — to remove, suppress, regenerate, or replace an Explanation. FR-38 states the opposite explicitly: *"Flagging never removes or alters the Explanation the student is reading."* FR-24's cache guarantee compounds it: *"A generated Explanation is cached and re-shown without regeneration on subsequent views"* and *"Reading an already-generated Explanation is never blocked, at any tier."* FR-16 guarantees every completed Practice Test *"remains visible indefinitely."*

Composed: an Explanation that a parent has read, judged harmful, flagged, and escalated remains permanently reachable by the child from a permanently visible test card, served from cache, with every party in the chain informed and none of them able to act. FR-33 gives one blunt instrument — delete the entire Student Profile and its whole history — which is not a proportionate response to one bad paragraph.

FR-38's "never removes or alters" clause is correct for the *student* flag: a child must not be able to make content disappear, and a raw student flag is not evidence. But that clause has been written as a property of flagging in general, and no counterpart authority exists anywhere else.

This is the single most serious finding in the review, because it is the one place where the document's stated safety model — "we accept unreviewed AI content in front of a child because we can account for it afterwards" — is load-bearing for the whole design and does not actually terminate in anything.

**Fix:** Add **FR-24b: Explanation suppression**.
- A parent can suppress an Explanation on their own child's Question. A suppressed Explanation is removed from all student-facing surfaces and its cache entry is invalidated. The Question and the Attempt are unaffected.
- The student sees a neutral, non-punitive state in its place (§7 tone), with no implication that they did something wrong.
- Suppression is available regardless of who originated the flag, and is available at every tier.
- Regeneration of a suppressed Explanation does not consume an Explanation Allowance (FR-31) — a family must not be charged to replace content the product got wrong.
- An Admin can suppress an Explanation across all accounts where the same content was served, for a content-safety failure rather than a quality one. This is the only cross-account Admin write in v0 and should be logged (see M-5, L-3).

Then amend §5.1 to name the terminus: retention + flag + **suppression** is an accountability chain; retention + flag alone is a record-keeping chain.

---

### H-1 (HIGH) — FR-35's persisted uncommitted state has no expiry clock, no TTL, and no deletion path

**Sections:** FR-35, FR-32, FR-33, §5.2, §10 Data lifecycle

FR-32 deletes Page Images *"90 days after the upload of their Source Test."* An uncommitted upload has no Source Test. FR-33's Parent Account deletion enumerates *"all Source Tests, Page Images, Extractions, Practice Tests, Attempts, Explanations, and Mastery"* — a pre-commit Page Image is reachable through none of those parents unless the implementation happens to model it as one. §10 Data lifecycle repeats the same enumeration.

Concretely: a parent starts an upload, photographs three pages of their child's test, gets interrupted, never returns. The photographs persist indefinitely — past 90 days, past a Student Profile deletion, and plausibly past a Parent Account deletion, because no requirement names them. FR-33's own closing consequence — *"Deletion completes without leaving orphaned stored files"* — is exactly the guarantee this breaks, and it breaks it via an FR added in the same update.

**Fix:** Add to FR-35: *"Retained uncommitted upload state expires on its own TTL — no longer than 7 days from last parent interaction — and is destroyed in full, including image bytes."* Add to FR-33: *"Parent Account and Student Profile deletion also destroy any retained uncommitted Parent View state (FR-35), including pre-commit Page Images."* Add the same class to §10's Data lifecycle enumeration.

---

### H-2 (HIGH) — Flagged Explanations in the Admin queue sit outside §5.2's deletion propagation

**Sections:** FR-30a, FR-24a, FR-38, FR-33, §5.2

§5.2 commits that a parent can delete a Student Profile's data and the entire Parent Account and all associated data. §10 requires deletion to propagate. FR-30a places flagged Explanations — with the Explanation text, the Question it explains, and the Grade Level — in an **Admin** surface, which §3 defines as *"outside any Parent Account."*

Nothing states what happens to that queue entry when the family deletes. The most likely implementations both fail: if the queue holds copies, the child's content survives deletion in an operator surface; if it holds references, deletion produces dangling entries the Admin surface must handle, which no FR describes.

This update materially widened the exposure — FR-38 adds a second, higher-volume feed into the same queue (parent-confirmed student flags), and FR-30a adds Grade Level, which is an age signal about a specific child.

**Fix:** State on FR-30a: *"A flagged Explanation is deleted from the Admin queue when the Student Profile or Parent Account it belongs to is deleted (FR-33). If a content-safety signal must outlive the family's data, it is retained only as a de-identified record carrying no Explanation text, no Question text, no Grade Level, and no account or profile reference."* Add the Admin queue to §10's Data lifecycle enumeration.

---

### H-3 (HIGH) — §5.2's model-training exclusion covers one of four model call classes; the child's own typed answers are outside it

**Sections:** §5.2, §5.3, FR-22, FR-10, FR-24, addendum §"Distinct model-call classes"

§5.2 says: *"**Third-party AI processing of Page Images** must be under terms that exclude the content from provider model training."* Page Images only.

§5.3 enumerates, in the same document: *"Every upload, generation, AI grade, and Explanation is a paid model call."* The addendum names all four classes explicitly. Three of them are outside §5.2's clause:

- **Generation** (FR-10) — sends the Extraction, i.e. the structured content of a named child's school test.
- **Grading** (FR-22) — sends **the child's own free-text answer**, typed by the child, alongside the question. §10 makes this explicit: *"a student types a raw free-text string, and that string is what is submitted and graded."* This is child-authored content and is arguably more sensitive than the photograph, since the photograph is the teacher's paper and this is the child's own writing. It is the highest-frequency call class in the product (addendum: *"High frequency… grade a whole Attempt in one call"*) and it is **uncapped at every tier** (FR-31).
- **Explanation** (FR-24) — sends the Question and the child's wrong answer.

I confirmed the update **did not add a new model call path that escapes the requirement**: FR-38 is a flag-routing FR with no model call, FR-35 adds no call, FR-37 is a state definition, and FR-24's new cap strictly *reduces* calls. The defect is pre-existing narrow scope, not a regression — but §5.3's new four-way enumeration makes the mismatch visible on the face of the document, and the fix is one sentence.

**Fix:** Rewrite the §5.2 clause: *"All content sent to third-party AI providers — Page Images, Extractions, generated Questions and answers, students' own typed answers, and Explanations — must be under terms that exclude it from provider model training and from provider-side retention beyond the duration of the request."* Add zero-data-retention confirmation to the launch gate in §12.2 item 1.

---

### H-4 (HIGH) — The consent posture is not implemented by any FR: broken cross-reference, no consent record, and consent taken before any child exists

**Sections:** FR-1, FR-3, §5.2, §12.1 Q1, §12.2 item 1

§5.2 makes parent consent at sign-up the build posture and legal review a launch gate. Assessed against the FRs, the posture is asserted but not built:

1. **Broken cross-reference (confirmed defect).** FR-1 requires *"acceptance of the terms and the child-data consent notice (see FR-30)."* FR-30 is Subject and Grade Level taxonomy management. Nothing in the document defines the consent notice, its content, or what it discloses. A reader following the pointer lands nowhere.
2. **No consent record.** §3 states the Parent Account *"owns… all consent"*, but no FR creates a consent artifact — no timestamp, no notice version, no re-consent when the notice changes. When legal review arrives (the §12.2 item 1 launch gate), there is no record to review and no way to demonstrate consent was obtained for any given family. The gate is unpassable as specified.
3. **Consent precedes the child.** FR-1 captures consent at sign-up. FR-3 creates Student Profiles later, and a Family tier holds up to five. A parent adding a second child four months later has consented to processing that child's data before that child was named in the system, and FR-3 has no consent step. For a verifiable-parental-consent regime this is the weakest structural point in the whole posture.
4. **The notice would now be materially incomplete.** This update widened the data footprint: FR-22 persists a grading rationale per AI-graded Question; FR-25 retains the original AI grade and rationale after an override; FR-24a retains every Explanation shown; FR-38 records student flag events including dismissals; FR-30a routes child content to an operator surface; FR-35 persists pre-commit Page Images. None of these are named anywhere as disclosed processing. The footprint grew; the (undefined) notice did not.

**Fix:** Repoint FR-1's cross-reference. Add **FR-1a: Consent record** — the notice version, the accepting parent, and the timestamp are stored; a material change to the notice requires re-acceptance before further processing; the record is deletable with the account under FR-33. Add a consent acknowledgement to FR-3 profile creation naming the child being added. Enumerate the full processing footprint (including the six items above) in the notice content requirement.

---

### H-5 (HIGH) — The Free Explanation cap is a child-facing wall with no adult in the loop, and this update built the exact rail its own deferred fix needs

**Sections:** FR-24, FR-31, §5.1, §9.2, §12.2 items 6, 7, 11; interacts with FR-20, FR-38, FR-28

§12.2 item 11 records this honestly and completely, and names the cheapest fix. My finding is not that the interaction was missed — it is that it is filed as a **product** cost when the material part of it is a **child-wellbeing** cost, and that it is filed as *accepted* when the update itself has now made the fix nearly free.

The safety reading, stated concretely:

- The cap is met by a **child**, alone, on a tablet, at the exact moment they got a question wrong and do not understand why. That is the moment of maximum need and minimum resilience.
- §7 requires that *"a wrong answer must never read as punishment."* A refusal to explain a wrong answer, delivered at the moment of the wrong answer, is very close to the thing §7 forbids — regardless of wording.
- The child **cannot resolve it**: no self-serve upgrade (§9.2, FR-31), no notifications of any kind (§9.2), no in-product way to tell a parent. The reset date may be up to 30 days out.
- The parent finds out only by opening Settings and looking, with nothing prompting them to look.
- **The flagship journey burns the cap fastest.** UJ-2 ends on *wrong → explain → retake*. §12.2 item 6 establishes that a retake producing a different wrong answer is a cache miss and charges again. So the child who follows the product's own intended study loop most diligently is the child who hits the wall soonest. The most engaged Free-tier child is the one the product cuts off first.
- 10/month against a 15-question Practice Test and a Free tier of 2 generations/month: a child who wants an Explanation on most of what they missed will meet the wall inside their second test.

**Why this is now cheap to fix.** §12.2 item 11 names the deferred fix: *"an 'ask a parent' prompt on the at-cap message that leaves a marker the parent sees on the dashboard."* This update **built that exact rail** — FR-38 establishes a student-originated signal routed to the parent, and FR-28 now surfaces student-originated signals on the Analytics dashboard scoped to the Student Profile. The at-cap marker is one more item type on a surface this update already created. It requires no notification infrastructure, no upgrade flow, and no new concept. The cost argument for deferring it was sound before FR-38 existed and is much weaker now.

**Fix (recommended, and I would treat the decision as a launch gate rather than an accepted build cost):** Add to FR-24: *"At the Free Explanation cap, the student can raise an 'ask a parent' marker, which surfaces on the Analytics dashboard (FR-28) alongside grade disputes and Explanation flags, scoped to that Student Profile."* One item type, one existing surface, closes the only place in the product where a child hits a wall with no adult reachable.

---

### M-1 (MEDIUM) — FR-31's at-cap message content is written for a parent and shown to a child, contradicting §7

**Sections:** FR-31, FR-24, §7

FR-31 requires the at-cap message to name *"the tier, the usage against the limit, and the reset date"* — e.g. *"You've used 2 of 2 practice tests this month on the Free tier. Resets 1 October."* FR-24 applies the *"standard at-cap message naming the tier, the usage, and the reset date"* to Explanation generation, which is a **student-facing surface**.

§7 already anticipates this and requires the opposite: at-cap messages about that child's practice are in the parameterized set, and *"Student Mode addresses the student in the second person"* in grade-appropriate language. "Account Tier", "allowance", and "usage against the limit" are the parent's billing vocabulary and are not grade-appropriate for a Grade 3 reader. §7 says shipping the wrong register is a defect; FR-31 specifies the wrong register.

**Fix:** State on FR-24 that the student-facing at-cap message is a distinct string in the student's register, naming neither tier nor allowance, and pair it with the H-5 "ask a parent" action. Confine FR-31's tier/usage/reset-date wording to Parent View surfaces.

---

### M-2 (MEDIUM) — §10 Observability creates per-child logs that appear in no deletion path

**Sections:** §10 Observability, §10 Data lifecycle, FR-33, §5.2

§10 requires that *"Generation, Extraction, grading, and Explanation calls are logged with outcome, latency, and **cost attribution per Parent Account**."* That is a per-family, per-call record of a child's study activity, retained on an unstated schedule. §10's own Data lifecycle line and FR-33's enumerations do not mention it.

FR-22 compounds it by pointedly *excluding* the log as a home for grading rationale (*"Writing it only to a log does not satisfy this requirement"*) without saying the rationale must therefore **not** also be logged — leaving the child's answer and the AI's reasoning about it plausibly duplicated into an operational log outside every deletion path.

**Fix:** Add to §10: *"Observability records carry account-level cost attribution only — no Student Profile identifier, no Question text, no student answer, and no Explanation or rationale text — and are retained no longer than [N] days."* Or, if child-linked detail is required, add the log store to FR-33's propagation.

---

### M-3 (MEDIUM) — §10's Data lifecycle enumeration omits Explanations, contradicting FR-33

**Sections:** §10 Data lifecycle, FR-33

§10: *"Deletion requests (§5.2) propagate to Page Images, Extractions, Practice Tests, Attempts, and Mastery."* FR-33 correctly includes Explanations in both the Student Profile and Parent Account cases. §10 is the line an implementer reads as the cross-cutting checklist, and it is the shorter of the two. Explanations are AI-generated text about a specific named child's mistakes — precisely the class you least want left behind.

**Fix:** Align §10's list to FR-33's, and extend both with the three classes named in H-1, H-2, and M-2.

---

### M-4 (MEDIUM) — Nothing bounds what an Admin may see of a family's data; §5.2's isolation promise is scoped only cross-Parent-Account

**Sections:** §5.2, FR-30, FR-30a

§5.2 commits that *"Page Images and student performance data are scoped to the owning Parent Account and never surfaced across accounts."* FR-30 adds *"Admin surfaces are inaccessible to Parent Accounts."* Both bounds run in the same direction. Neither says what the **Admin** may see, and §3 places the Admin outside any Parent Account — so as written, Admin access is not covered by the isolation commitment at all.

FR-30a now grants the Admin: per-account consumption, and, for each flagged Explanation, its text, the Question it explains, and the Grade Level. That is child-specific generated content, derived from a photographed test, tagged with an age band. This update widened the flow (FR-38 adds a second feed) without stating a bound.

This is not an accusation that the design leaks — an operator reviewing a content-quality report is legitimate and necessary. The finding is that the privacy commitment has a hole shaped exactly like the operator, and the document should say so deliberately rather than by omission.

**Fix:** Add to §5.2: *"Admin access to family data is limited to what an operator needs to run the service and is enumerated in FR-30a."* Add to FR-30a a minimum-data-set consequence: *"The flagged Explanations queue exposes the Explanation, its Question, and the Grade Level. It does not expose the Student Profile name, any Page Image, any Attempt or Mastery data, or any other Question from the same Practice Test."*

---

### M-5 (MEDIUM) — No requirement excludes child identifiers from provider prompts, while Grade Level is required to be sent

**Sections:** FR-24, FR-10, FR-22, §5.2

FR-24 requires *"Explanation language is pitched to the Practice Test's Grade Level"*, so an age band about a specific child is in the prompt by design. Nothing anywhere forbids the Student Profile's display name, the parent's email, or an account identifier from also being included. §5.2's commitment is about training exclusion, not about minimization.

Grade Level is defensible and necessary. A child's name is neither.

**Fix:** Add to §5.2: *"Prompts sent to third-party AI providers carry no direct identifiers — no Student Profile name, no parent email, no account identifier. Grade Level is the only child attribute transmitted, and only where the output depends on it."*

---

### L-1 (LOW) — FR-22 rationale and FR-25 retained original grades: retention lifetime stated, deletion path implied only

**Sections:** FR-22, FR-25, FR-33

FR-22 retains a grading rationale *"for the life of the Attempt, including after an override"*; FR-25 retains the original AI grade and rationale after a parent override. Both are AI-authored assessments of a specific child's work, and both ride on the Attempt, so FR-33's deletion of Attempts should carry them. That is an inference, not a statement. Given how carefully FR-33 enumerates elsewhere, the omission reads as an oversight rather than a decision.

**Fix:** Name grading rationales and retained pre-override grades explicitly in FR-33's two enumerations.

---

### L-2 (LOW) — §12.2 item 10 (Explanation Allowance scope) is a child-fairness question, not only a definition question

**Sections:** §12.2 item 10, FR-31, FR-24

Correctly flagged as moot today (Free = 1 profile) and correctly insisted upon as a written definition. Worth adding the reason it matters beyond data modelling: if a finite Explanation cap is ever applied to a multi-profile tier at the **account** level, one child can exhaust their sibling's ability to get help, with no visibility and no recourse for either. When settled, settle it **per Student Profile** for that reason, not per account.

---

### L-3 (LOW) — Thin Admin auth plus no audit logging, now combined with Admin access to child content

**Sections:** §4.8 `[NOTE FOR PM]`, FR-30, FR-30a, §13

The note defers Admin authentication depth, roles, and audit logging with the revisit condition *"before any third-party operator exists."* That condition was set when the Admin surface was taxonomy management. FR-30a now puts child-specific AI content in that surface, and this update doubled its feeds. Unlogged operator access to child content is a different risk class from unlogged operator access to a subject list, even with a single trusted operator — because with no audit log there is no way to demonstrate afterwards that access was appropriate.

**Fix:** Narrow the revisit condition to: *"Admin access to any surface exposing child-specific content (FR-30a's flagged Explanations queue) is audit-logged from v0. Roles and authentication depth remain deferred to the third-party-operator condition."* An append-only access log is a small build and is the difference between a defensible posture and an undemonstrable one.

---

## Section B — Risks needing a decision (not defects)

### R-1 — Does the FR-8 legibility check send Page Images to a third party before the parent commits?

**Sections:** FR-8, FR-31, §5.2, addendum

FR-8 requires the check to run *"once, as a single batch over all pages, immediately after capture is finished"*, and to be fast enough to feel like part of capture. The addendum proposes reusing the vision model's per-field self-assessed confidence as *"the signal behind FR-8's legibility check"* — which would make the check a third-party model call over the child's schoolwork.

If so, then a parent who photographs three pages, reads the legibility warning, and abandons has already had their child's schoolwork transmitted to OpenAI — despite FR-8 and FR-31 both promising that abandoning *"spends nothing."* That promise is about cost; a parent will read it as being about commitment. Combined with H-1 (the images are also now persisted), "I backed out" would mean "the photos were sent and kept."

The PRD does not say whether the check is a model call or a local heuristic (blur/exposure detection needs neither). This is a genuine fork, not an error.

**Decide:** (a) implement the check locally and state that no image leaves the device before the parent's explicit proceed action — the strongest posture and probably cheap; or (b) accept the model call and disclose it plainly in the capture flow and the consent notice, and confirm the abandoned images are destroyed immediately.

### R-2 — Is the Free Explanation cap acceptable at launch, or is it a launch gate?

See H-5. §12.2 item 11 records it as accepted. I am asking for the acceptance to be re-taken now that FR-38/FR-28 have made the fix nearly free, and re-taken as a child-wellbeing decision rather than a cost one.

### R-3 — Where does the FR-35 state live?

See C-1. Server-side is the only safe answer, and it carries the H-1 consequences. This needs an explicit decision written into the FR, not left to architecture.

### R-4 — Should suppression (C-2) be parent-only or parent-and-Admin?

Parent suppression is uncontroversial. Admin cross-account suppression is the only cross-account write in v0 and needs a deliberate call: it is the right tool if the same generated Explanation reaches multiple families, and it is a new and consequential Admin power in a surface with no audit logging (L-3).

### R-5 — Does consent need re-taking at FR-3 profile creation?

See H-4 item 3. This is partly a legal-review question (§12.2 item 1) and should be routed there rather than decided in the PRD — but the FR should exist as a placeholder so legal review has something to approve or strike, rather than a gap to discover.

---

## Section C — Where the PRD is stronger than required

These are deliberate child-safety and wellbeing positions. They cost something, they are correct, and a later edit optimizing for cost or simplicity would plausibly remove them. Do not.

1. **FR-38's parent-first routing.** *"Only a parent-confirmed flag reaches the Admin queue… a 10-year-old flagging an Explanation they did not like is not evidence."* This is the correct trust model — it takes the child's signal seriously without treating it as adjudication, and it keeps the operator out of the child's direct reach. Excellent, and the best thing in the update.
2. **FR-24 / FR-31: reading an already-generated Explanation is never blocked, at any tier, including at the Free cap.** *"Nothing a student has already been shown is taken away from them."* A cost boundary that never retroactively removes something a child already relied on. Preserve verbatim.
3. **FR-31: AI grading is never blocked by an allowance at any tier** — *"a student must never be unable to find out whether they were right."* The one uncapped model call class in a cost-constrained v0, and the right one.
4. **FR-37, the *unanswered* grade state**, and FR-26/FR-27's exclusion of unanswered Questions from both the Mastery denominator and the Weak Area floor. A child who ran out of patience is not reported as a child who does not understand. FR-28's insistence that the skipped count travels with the Mastery figure — *"never a bare 40%"* — is the same instinct applied to the parent's reading. This is unusually careful.
5. **FR-15 / §7: three non-escalating timer warnings.** *"A 20-second warning that shouts louder than the 5-minute one turns the last stretch of a practice test into an anxiety event."* Correct, and the kind of thing a later "make the urgency clearer" edit would break.
6. **§10's SC 2.2.1 essential-exception argument**, with the exception deliberately narrowed by optional / off-by-default / parent-set-per-child, and the other escape hatches explicitly declined. It also states its own invalidation condition. This is better than most shipped accessibility reasoning.
7. **FR-25: the AI rationale and override mechanics are not surfaced to the student**, and the student sees *"one plain line stating that a parent reviewed it."* Correct — a child does not need to read a machine's reasoning about why they were wrong.
8. **FR-33: destructive actions require the account password, not the Parent PIN** — *"the PIN gates a mode, not a destructive action."* Right threat model for a device a child holds.
9. **FR-32 / §5.2: image deletion is automatic and requires no parent action**, and the persisted Extraction (FR-9) makes deletion functionally free. Privacy by default, with the disincentive to delete engineered out.
10. **FR-2's PIN cool-down persisting across app restart**, and FR-34's expiry *"enforced server-side; a client that fails to expire does not retain Parent View authority."* Both anticipate the actual adversary — a curious child on the device — rather than an abstract one.
11. **§7's parameterized strings with per-surface mode of address.** The mechanism that lets one data set be read by two people about a third without either reading as written for someone else. Also the reason M-1 is a small fix rather than a large one.
12. **§5.3's standing instruction not to "fix" the empty Free dashboard by lowering the FR-27 floor** — *"that would trade a truthful empty state for untrustworthy Weak Area calls."* A parent acting on a false Weak Area is a real harm to a child. Preserve.
13. **§4.9's framing** — the retention FRs are stated as FRs *"precisely so downstream story creation cannot drop them."* The right instinct; H-1, H-2, and M-2 are the classes that escaped it.
