---
review: child-data-privacy-and-safety
target: ARCHITECTURE-SPINE.md (n-test-reviewer, 2026-09-01, updated 2026-09-02)
against: prd.md §5.1, §5.2, §4.9 (FR-32, FR-33), FR-35, FR-38, FR-39, FR-4, §10
date: 2026-09-02
verdict: CHANGES REQUIRED
---

# Child-Data Privacy and Safety Review

## Question under review

Can this architecture actually keep the product's promises about children's data, or does it merely not contradict them?

## Verdict

**Mostly the latter.** Where the spine saw a child-data problem it built a real mechanism, and those mechanisms are good: AD-15's row-before-bytes rule makes orphaned schoolwork structurally impossible; AD-18's split credentials make the PIN gate something a persisted cookie cannot defeat; AD-14's anonymous `UsageTombstone` is a genuinely thoughtful answer to "how do you keep the count honest without keeping the child." Those are mechanisms, not assertions, and they hold.

But on four of the five questions asked here the spine states the property and never builds the thing that enforces it. The FR-39 suppression remedy — the entire load-bearing beam under §5.1's argument for shipping Explanations ungated — is specified with a mechanism that does not suppress. FR-33's requirement that destructive deletion take the account password rather than the PIN has no AD at all, so as written a child who knows the PIN can erase a sibling's academic record. FR-4's cross-profile prohibition is enforced only in the one place (AD-33/FR-35) where somebody happened to notice it. And AD-26 creates exactly the "class of children's schoolwork outside a deletion clock" that §5.2 declares does not exist.

The pattern is diagnostic: this spine is strong on invariants that were *derived* (allowances, ownership, deletion of owned rows) and weak on invariants that must hold at a *boundary* it does not own — the browser's storage, the queue's own tables, the backup tarball, a third-party error report's message string. Child data escapes at boundaries.

---

## 1. Deletion — what survives FR-33

AD-15 enumerates what is erased: Page Image files and rows, extracted Question content, Answers, grading rationales, Explanations, Mastery, the Student Profile. What survives a Student Profile deletion is the anonymous `UsageTombstone`; a Parent Account deletion "erases fully, tombstones included."

That enumeration is a list of *owned domain entities*. It is not a list of *stored artifacts*. Walking every place a byte of child data comes to rest:

### 1.1 pg-boss job payloads and the pg-boss archive — NOT COVERED

AD-5 puts the queue in the application database, and AD-3 queues Extraction and Generation. The Generation job's input is derived from the persisted Extraction — that is, the text of the child's test paper. pg-boss retains job rows after completion and moves them to an archive table, where the `data` payload and the failure `output` persist for its configured retention window before deletion.

Nothing in the spine:

- constrains job payloads to identifiers only (AD-20's no-content rule enumerates "log line, trace, error report, or AiCall row" — job payloads are conspicuously not in that list);
- names pg-boss's job or archive tables as in scope for FR-33 deletion;
- configures pg-boss retention at all.

AD-15's sweeper is explicitly "one sweeper over rows" of owned artifacts, and pg-boss's tables are owned by no module under AD-17. **Result: after a parent invokes FR-33, extracted child schoolwork can remain in `pgboss.archive` for the pg-boss retention window, in a table with no owner, no foreign key to the Parent Account, and no rule pointing at it.** On the failure path this is worse: AD-31 routes schema-validation failures as retryable upstream faults, and a failed job's recorded output is the natural place for the model's malformed response — i.e. generated child-directed content — to be stored verbatim.

Required: state that job payloads carry identifiers only (the same rule as AD-20, extended), pin pg-boss retention explicitly, and either bring the job tables into the FR-33 deletion path or prove by the payload rule that they never hold content.

### 1.2 Database and uploads backups — NOT COVERED

AD-19 runs a nightly `pg_dump` plus a snapshot of the `uploads_data` volume, 7-day local retention. FR-33 deletion touches neither. So for up to seven days after a parent deletes their account, a complete full-fidelity copy of every photograph of their child's schoolwork and every row of their performance record sits on the same droplet.

A seven-day lag between deletion and backup expiry is a defensible position — most consumer products take it. What is not defensible is that **the spine never states it.** FR-33's testable consequence is "deletion completes without leaving orphaned stored files," and the uploads snapshot is, on a plain reading, a stored file containing exactly the bytes the parent asked to destroy. A builder implementing FR-33 from this spine has no way to know whether backups are in scope, and the deployment checklist has no line for it.

Two further consequences that follow only from the backup design and are addressed nowhere:

- **Restore re-imports expired data with no clock on it.** A backup taken on day 89 of a Source Test's life contains its Page Images. Restoring that backup on day 200 returns images FR-32 already deleted. Unless restore re-runs the retention sweep and replays the deletion log, a disaster recovery is also a privacy regression. No AD says restore re-runs anything.
- **The Deferred item sanctions an unbudgeted egress.** "Push the local snapshot to Cloudflare R2" adds a fourth-party processor holding photographs of children, and §5.2's third-party commitments contemplate only the AI provider. The revisit trigger — "before the first real family's data lands" — is the same moment the risk materializes, and no rule is written for that decision in advance. Either the offsite copy needs its own §5.2 clause and its own encryption and retention rule now, or the deferral needs to say plainly that v0 accepts losing every family's photographs to a droplet failure.

### 1.3 The `AiCall` cost-attribution table — CONFLICTED, UNRESOLVED

AD-20 gets the important part right: `AiCall` holds Parent Account, call class, model snapshot, token counts, cost, latency, correlation id, and explicitly no content. As a *content* vector it is clean.

But it is not in AD-15's deletion enumeration, and it is keyed to the Parent Account. So:

- On **Student Profile deletion**, `AiCall` rows survive. Defensible: they are Parent-scoped, and AD-14 already accepts that the count must survive as a tombstone. Consistent.
- On **Parent Account deletion**, AD-15 says the account "erases fully, tombstones included" — naming tombstones specifically and `AiCall` not at all. If `AiCall` survives, FR-33's "removes the account and all associated data" is violated by a longitudinal per-account activity trace.
- And there is a live force pulling the other way: **AD-23's global daily spend ceiling is "enforced against the AiCall table."** Deleting a departing account's rows retroactively lowers today's measured spend. Keeping them violates FR-33.

AD-14 resolved exactly this tension for allowances by inventing the anonymous tombstone. The identical tension exists for `AiCall` and the spine does not notice it. Resolve it the same way — an account-anonymous daily spend rollup that survives, with the per-account rows erased — or state explicitly that `AiCall` is erased on account deletion and that the ceiling reads a separate aggregate.

### 1.4 `AdminAudit` rows — NOT COVERED

AD-25 mandates "an audit row for every admin write — tier changes, taxonomy edits, **flagged-queue dispositions**." A flagged-queue disposition is a decision about one child's Explanation. AD-25 places no content constraint on what an audit row records, and AD-20's no-content rule does not cover `AdminAudit`. `admin` owns these rows; FR-33 deletion reaches into `identity`, `sourcetest`, `practicetest`, `grading`, `explanation` — not `admin`.

So an audit row recording "operator dismissed flag on Explanation X" survives FR-33, and if it captured the Explanation text or the Question for context — the natural thing to do, since the Explanation it references is about to be hard-deleted — child-directed content generated about a named child's specific mistake outlives the deletion of that child's profile, in a table no deletion path visits. Constrain audit rows to identifiers and dispositions, and accept the consequence that a disposition audit becomes unresolvable once its subject is deleted (which is correct).

### 1.5 The Extraction has no clock at all — CORRECT PER PRD, BUT WORTH SAYING OUT LOUD

FR-32 deliberately preserves the Extraction so regeneration keeps working, and the spine implements that faithfully. But the Extraction is the *verbatim text of the child's test paper*. §5.2's headline commitment — "Page Images are deleted 90 days after upload" — reads as a 90-day retention promise, and what actually happens is that the photograph is deleted at 90 days while the transcribed content of the schoolwork persists indefinitely until FR-33. §5.2 also asserts "no class of children's schoolwork sits outside a deletion clock," and the Extraction has no clock.

This is a PRD position the spine correctly inherits, not a spine defect. Flagged because the architecture is the document where the distinction becomes concrete, and because any privacy copy derived from "90 days" will be misleading if it does not distinguish the photograph from the transcript.

### 1.6 Provisional Topic labels — MINOR

AD-11 stage 3 mints a new canonical Topic when nothing fits, from a label the model proposed off a child's paper. AD-12 flags it provisional pending operator disposition. Topics are global and shared across all accounts, and are not in any deletion path — correctly, since they are shared taxonomy. But nothing in AD-11 or AD-12 constrains a minted Topic to a generic curricular label, so an idiosyncratic label lifted off one family's worksheet can enter the global canonical set and survive that family's deletion. Add a constraint that stage 3 emits curriculum-level labels, and that the operator queue is where non-generic ones are caught.

### 1.7 What is genuinely well handled

`UncommittedState` (AD-15, AD-16) is covered end to end: owned, TTL'd, parent-gated, swept without a tombstone, and reached by FR-33. The `uploading`-state row deleted outright with no tombstone is exactly right. AD-15's derived-path rule kills path traversal and directory/table divergence in one move. Credit where due.

---

## 2. Third-party egress

Three hops leave the machine: OpenAI (AD-1, AD-8, AD-9, AD-11), Sentry (AD-21), and GHCR (images only, no data). A fourth is queued in Deferred (Cloudflare R2, §1.2 above).

### 2.1 Sentry — the no-content rule is field-level and does not cover the message string

**This is the sharpest live hole.** AD-21's controls are a list of *fields*: `sendDefaultPii: false`, request-body capture off, local-variable capture off, cookie and header capture off, "an explicit `beforeSend` denylist." Every one of those governs structured context. None of them governs `error.message` or the exception value itself, which is what Sentry's grouping is built around and what is always sent.

Now read AD-30 and AD-31 together. AD-30 mandates Zod schema validation on every AI payload plus deterministic post-hoc validation. AD-31 makes a schema-validation or post-hoc-validation failure a routine, retried, *upstream* fault — an expected operational path, not an exotic one. A `ZodError` embeds the received value in its message. A post-hoc validation throw on the canonical case AD-30 names — "a generated Multiple Choice Question whose correct answer is not among its own options" — will, written naturally, put the malformed Question in the error message.

The Question is child-directed generated content. Under AD-21 as written it goes to Sentry on every occurrence, and AD-21's stated purpose is explicitly "third-party capture of child content."

The fix is not a bigger denylist. It is a structural one: content-bearing validation failures must throw an error type that carries **only** the correlation id and the failure kind, with the payload logged nowhere or logged only to a local sink that is not wired to Sentry. Then `beforeSend` becomes a backstop rather than the control.

The same hole exists on the `web` container, where the browser SDK's default console breadcrumbs will capture any `console.log` of a response body during development that survives into production.

### 2.2 AD-20's no-content rule has no enforcing seam

Compare AD-15 and AD-20. AD-15 does not say "never write an orphaned file" — it says the row exists first and the path is derived from it, which makes the bad state unconstructible. AD-20 says "**no** log line, trace, error report, or AiCall row **ever** carries" child content, and provides no mechanism whatsoever. It is a rule a developer must remember at every call site, forever, including in the debugging session at 2am where logging the payload is the obvious move.

For the single most load-bearing privacy invariant in the product, that is the wrong shape. Give it a seam: a typed logging interface that structurally cannot accept a content-bearing type, and a Tier 1 test under AD-22 that asserts the rule (AD-22's tier list — races against a cap, deletion that must not refund, the TTL sweep, elevation scope — is well chosen and this belongs on it). Right now nothing in AD-22 tests the no-content rule at all.

### 2.3 Caddy access logs — unaddressed

AD-19 puts Caddy in front of everything and AD-20 governs "structured JSON to stdout with Docker log-driver rotation." Caddy's own access log is neither. It records request URIs, which under AD-15's identifier-derived paths are identifiers only — probably fine — but it has no stated retention, no rotation rule, and is not reached by FR-33. State it, if only to say it holds identifiers and rotates.

### 2.4 AD-34's no-training commitment has no mechanism, and conflates two different provider settings

The spine is honest that this is "a deployment precondition, not a code concern — recorded as a launch checklist item with a named owner." Given §5.2 makes this commitment cover *every* call class explicitly, and given the whole product depends on it, a checklist line is thin — but it is at least declared, and I do not think code can assert a provider's contractual terms.

The substantive gap is a conflation. §5.2 and AD-34 both say *training*. Excluding data from training is distinct from **retention**: by default an API provider retains inputs for an abuse-monitoring window, which means photographs of a named child's schoolwork sit in a third party's store for that window regardless of the training setting, and are untouched by FR-32 and FR-33. A builder reading AD-34 will procure the training opt-out and stop. If the intent is that children's images are not retained at all by the provider, AD-34 must say **zero data retention** and the checklist must name it as a separate item. If the intent is only no-training, §5.2's claim that "no class of children's schoolwork sits outside a deletion clock" needs a carve-out, because the provider's copy is exactly such a class.

Also add: a rule that images and answers are sent as request payloads only and never uploaded to a provider-side persistent files/vector store, which some SDK paths make easy and which would create a second undeleted copy.

---

## 3. The mode gate

AD-13 and AD-18 are the strongest pair in the spine. Mode in the token, scope checked server-side, elevation credential held in memory only and lost on any full page load, no parent-scoped data ever server-rendered, session cookie alone never satisfying a parent endpoint. A refresh dropping the parent to the PIN is the correct trade and FR-35 exists precisely to pay for it. AD-25 similarly closes operator-to-parent credential crossover cleanly: distinct table, distinct login, distinct route namespaces, neither credential satisfying the other's guard.

Three sequences the ADs nonetheless permit:

### 3.1 The bound Student Profile is not in the token — a child can reach a sibling's data

FR-4 is unambiguous: "In Student Mode, no upload, generation, release, **cross-profile data**, or Analytics surface is reachable — not by navigation, not by direct URL." §10 reinforces it: "Student Mode restrictions are not client-side-only."

AD-13 says the token "identifies the Parent Account and carries the mode." It does not carry the bound Student Profile. AD-18 says the session cookie "answers *which account*." So on a student-scoped endpoint the server knows the account and the mode, and **the bound profile exists only as a client-side device concept.** Authorization on `GET /practice-tests?profileId=…` or `/attempts/{id}` can therefore only check account ownership — which a sibling's data passes. Device A bound to child A serves child B's practice tests, attempts, results, and Explanations to any request that names child B's id, from the browser address bar.

That is the cross-profile exposure FR-4 forbids, enforced by client routing, which §10 forbids.

The authors saw this problem exactly once. AD-33 carries "FR-35 cross-profile rejection: retained uncommitted parent state is keyed to the Parent Account **and** the Student Profile it was created under; restoring it into a different profile is refused, not silently rebound." That rule is correct and it is the general rule stated in one special case. Generalize it: the student-scoped credential must carry the bound Student Profile, and every student-scoped endpoint must check it, with rebinding requiring a parent-scoped token (which FR-4 already implies, since only a deliberate exit from Parent View chooses the binding).

### 3.2 Destructive deletion is not gated on the account password — a child with the PIN can erase the record

FR-33 states it plainly, and states *why*: "Deletion of a Student Profile or Parent Account requires the account password, not the Parent PIN — the PIN gates a mode, not a destructive action."

**No AD implements this.** AD-13 and AD-18 define exactly two credentials: the session cookie (which account) and the elevation token (Parent View scope). Every parent-scoped endpoint checks the elevation scope. Deletion is a parent-scoped endpoint. So under the ADs as written, the credential sufficient to delete a Student Profile and all of its history — or the entire Parent Account — is the PIN-derived elevation token.

The threat model FR-33 is written against is not exotic: the PIN is typed on a shared family tablet in front of the children who use it, FR-2 gates a *mode* precisely because it is a low-entropy secret, and a 10-year-old who has watched it entered can, under this spine, irreversibly destroy their own or a sibling's entire academic record. AD-13 even notes the elevation token can be silently refreshed for up to 8 hours.

Add an AD: destructive operations (Student Profile deletion, Parent Account deletion, and arguably Page Image deletion) require password re-authentication at the moment of the action, verified server-side, and are not satisfied by an elevation token alone. This is a third credential step and the spine currently has a two-credential model, so it is a real structural addition, not a note.

### 3.3 The operator sees unminimized child content, and only writes are audited

AD-25 keeps the operator out of parent credentials, but FR-30a puts the operator *inside* every family's content by design: the flagged-Explanation queue shows the Explanation text and the Question it explains, and FR-24 specifies that an Explanation covers "where their specific answer went wrong" — so the queue routinely surfaces a named child's wrong answer to the operator.

§5.2 commits that per-child data is "scoped to the owning Parent Account and never surfaced across accounts." The admin surface crosses every account, and the spine never reconciles the two. Nor does it minimize: no rule says the queue shows the Explanation and Question without the Student Profile identity, which is all the operator needs to judge content quality. And AD-25 audits **writes** only — "an audit row for every admin write" — so an operator browsing family content leaves no trace at all.

With v0's thinness stacked on top (one seeded operator, no roles, no MFA, and AD-23's throttle scoped to *unauthenticated* endpoints, which likely excludes the admin login), the accountability story for operator access to children's data is: none. Minimum fixes — de-identify the flagged queue to Explanation, Question, and Grade Level; audit reads of family content, not only writes; and put the admin login behind the AD-23 throttle explicitly.

### 3.4 The idle clock is honest but the server cannot verify it

AD-13's design is thoughtful — the client tracks real interaction, polling explicitly does not count, the client may only *request* a refresh and never extend a token, and there is an 8-hour absolute ceiling. Noted approvingly.

The residual: the server has no independent evidence of interaction and mints on request. Any client-side condition that fires interaction events without a human — a stuck listener, an animation, an errant synthetic event — silently holds Parent View open for up to 8 hours on a family tablet, against FR-34's 15-minute intent. AD-18's in-memory token bounds the blast radius to a single un-reloaded tab, which is a genuine mitigation. Acceptable for v0; worth writing the ceiling down as the security boundary it actually is, rather than as a backstop.

---

## 4. The AI accountability chain (§5.1, FR-38, FR-39)

§5.1's argument for serving Explanations to children with no parent review gate is explicitly conditional: "Accountability is after the fact... The flag is a signal, **the suppression is the remedy**, and the argument for shipping Explanations ungated depends on the parent holding both." FR-39's notes say the same: without suppression, the chain terminates in nothing changing on the child's screen.

So FR-39 is the beam under the entire safety position. It is the thing this review must check hardest.

### 4.1 The stated suppression mechanism does not suppress — CRITICAL

AD-33, verbatim:

> **FR-24 Explanation cache key includes the Student Profile**, so an Explanation suppressed under FR-39 for one child can never be served to that child from cache, and a free regeneration is a distinct entry rather than an overwrite.

The reasoning is wrong. Including the Student Profile in the cache key does not suppress anything — it *partitions* the cache per child. The suppressed entry is keyed `(profile, question)`, and a subsequent request from that same child for that same question computes that same key and gets a hit on **exactly the entry that was suppressed**. Per-profile keying is what makes suppression *expressible* (you can suppress for one child without affecting another) but it is not what makes it *happen*.

What actually implements FR-39 is a **suppression check at serve time**: every path that returns an Explanation to a student must consult the suppression state for that (Explanation, Student Profile) pair and return the removed-by-parent state instead. The spine never states this check anywhere. `explanation` is listed in AD-17 as owning "Explanation, suppression, flags" — so the state has an owner — but no AD says who reads it, or that reading it is mandatory on the serve path, or that the cache is subordinate to it.

A builder implementing AD-33 literally ships a cache that serves suppressed Explanations to the child whose parent suppressed them. That is a direct FR-39 violation ("it is not re-served from cache") and it collapses §5.1's argument for ungated Explanations.

Compounding it: **the spine never says where the cache lives.** If "cache" means the persisted `Explanation` row itself — which FR-24a and FR-39 jointly require, since the Explanation must be retained and readable by the parent and visible in the Admin queue after suppression — then serving is a query and the suppression check is a predicate on it, and the fix is trivial. If "cache" means a separate in-process or HTTP layer, the check is bypassable by construction and the layer must be removed or made suppression-aware. The ambiguity is itself the defect; AD-33 should name the store.

Also unstated: FR-38 makes the flag available "on the results screen **and in Attempt history**," so suppression must remove the Explanation from both surfaces. AD-33 speaks only of "cache." Every read path needs the predicate, and the parent's own read (FR-24a) must be explicitly exempted from it, since the parent must still see what they suppressed.

**This is the finding I would block the gate on.** Everything else in this review is a hole to plug; this one is a stated mechanism that does not do the job it is named as doing, in the one place the product's safety argument has no fallback.

### 4.2 What the chain gets right

- **The free regeneration is correctly modelled.** AD-14: "A suppressed Explanation (FR-39) still counts as consumed; the free regeneration it entitles carries a flag excluding it from the count — not a second counter." That is precisely right, and the refusal to introduce a second counter is the correct instinct.
- **Regeneration must not be a cache hit** (FR-39: "generated fresh rather than served from cache"). AD-33's "a free regeneration is a distinct entry rather than an overwrite" covers this, and the overwrite refusal also preserves FR-24a/FR-30a retention of the original. Good.
- **The unbounded loop is bounded by the right thing.** FR-39 allows the flag→suppress→regenerate loop to run without limit, "bounded by parent effort." Since every iteration is a free paid model call, the cost exposure is real, and AD-23's global daily spend ceiling is the correct backstop rather than a per-account cap that would defeat FR-39's whole point. Correctly reasoned, even if not stated as the reason.
- **AD-32's child-facing exposure rule** — no allowance counter, cost figure, tier label, model name, or grading rationale reachable from a student-scoped endpoint — is a genuine mechanism and correctly identified as the API-surface twin of AD-20. It also correctly backs FR-25's and FR-35's rationale restrictions.

### 4.3 Does the parent hold a real remedy?

Assuming 4.1 is fixed: yes, and the design is sound. The parent can read every Explanation (FR-24a via a parent-scoped read), flag it, confirm a child's flag, suppress with a stated-irreversible confirmation, and regenerate free. The one-writer rule puts suppression state under `explanation` where the flags already live, and `admin` reads it through that service rather than around it. The chain terminates in an action, which is what §5.1 requires.

Unfixed, the parent's only remedy is the one FR-39's notes name as unacceptable: delete the Student Profile.

---

## 5. What the spine makes possible that the PRD forbids

### 5.1 Client-stored student answers with no clock and no clearing rule — contradicts §5.2

AD-26: "Answers within an open Attempt are held in **client-side persistent storage keyed to the Attempt**... This is the only place student work lives outside the database." Cleared on successful submission.

The rule is correct for its purpose — it is what makes FR-36's offline answering work, and AD-26 is candid that this is the one uncommitted-state mechanism that is not parent-gated. But three things follow that no AD addresses:

- **Nothing clears an abandoned Attempt's answers.** AD-16 gives every other uncommitted-state class a uniform 72-hour TTL for exactly this reason. AD-26 has no TTL. A child who starts a test and never submits leaves their answers in the shared origin's storage indefinitely.
- **Nothing clears them on profile rebinding.** FR-4 lets a parent rebind the device to a sibling. Sibling B then operates a browser whose storage holds sibling A's in-progress answers, in the same origin, under the same Student Mode session. That is cross-profile exposure of student work, forbidden by FR-4.
- **FR-33 cannot reach them.** Server-side deletion has no path to a device's local storage, so a deleted account's answers persist on the family tablet.

§5.2 states flatly: "no class of children's schoolwork sits outside a deletion clock." AD-26 creates precisely such a class, and FR-35's own reasoning names this exact hazard as the reason parent state is server-side only — "photographs of a child's schoolwork sat in the Student Mode origin's storage on a shared family tablet." The same objection applies to answers, and was not carried across.

Minimum: give AD-26 a TTL matching AD-16's 72 hours, clear on profile rebind and on sign-out, and add both to AD-22's Tier 1 lifecycle tests alongside the existing TTL sweep test.

### 5.2 AD-32's exposure rule makes FR-31's at-cap message unimplementable

AD-32: "no allowance counter, cost figure, **tier label**, model name, or AI grading rationale is ever reachable from a student-scoped endpoint."

FR-31: "Reaching an allowance hard-blocks the operation. **The message names the tier, the usage against the limit, and the reset date**... A generic error or silent failure fails this requirement."

The Explanation allowance is the one cap that lands on a child (FR-24 spends four bullets on this, precisely because it is). So the at-cap Explanation message must, per FR-31, name the tier and the usage — and must not, per AD-32, name the tier or carry a counter. FR-24 already resolves this in the PRD's favour: no counter is ever shown to the student, and the message "blames the plan, not the child."

The spine's AD-32 is stricter than the PRD and does not carve out this case, so the two rules as written cannot both be satisfied. Add the carve-out to AD-32 explicitly: the student-facing at-cap message may state that the account's Explanations for the month are used up and when they return, without a tier label, a counter, or an upsell — which is what FR-24 actually requires. Leaving this unresolved risks a builder resolving it the other way and shipping a tier label to a 10-year-old.

### 5.3 The live provider suite has no stated data boundary

AD-22 Tier 3 is "a small, explicitly opt-in live provider suite, not in CI." AD-19 declares one environment, production only, and no staging tier. Nothing says what data Tier 3 runs against or where it runs from. If it is run by a developer against real fixtures on the production database, or with a production key against local copies of real family content, children's data leaves through a path no AD governs. State that Tier 3 runs only against synthetic fixtures, and never against a database containing real Parent Accounts.

---

## Summary of required changes

Blocking:

1. **AD-33 / FR-39** — replace the cache-key reasoning with an explicit serve-time suppression check on every student-facing Explanation read path (results screen and Attempt history), name where the Explanation cache lives, and exempt the parent's FR-24a read. Add a Tier 1 test.
2. **New AD / FR-33** — destructive deletion requires account-password re-authentication server-side; an elevation token alone is insufficient.
3. **AD-13 / FR-4** — carry the bound Student Profile in the student-scoped credential and check it server-side on every student-scoped endpoint; generalize AD-33's FR-35 cross-profile rejection into the general rule.
4. **AD-26 / §5.2** — 72-hour TTL on client-held Attempt answers, cleared on profile rebind and sign-out; test in Tier 1.

Required before build:

5. **AD-15 / AD-20 / AD-5** — extend the no-content rule to job payloads and `AdminAudit` rows; pin pg-boss retention; state whether `pgboss` tables and backups are in FR-33 scope; state that restore re-runs the retention sweep.
6. **AD-15 / AD-23** — resolve the `AiCall` conflict: erase per-account rows on Parent Account deletion and read the spend ceiling from an anonymous rollup.
7. **AD-21** — content-bearing validation failures must throw an error type carrying only correlation id and failure kind; `beforeSend` becomes a backstop, not the control.
8. **AD-34** — distinguish no-training from zero-data-retention and add ZDR (or amend §5.2's no-class-without-a-clock claim); forbid provider-side persistent file/vector stores.
9. **AD-25 / FR-30a** — de-identify the flagged-Explanation queue, audit reads of family content, throttle the admin login.

Worth doing:

10. **AD-20 / AD-22** — give the no-content rule an enforcing seam (a typed logger that cannot accept content) and a test.
11. **AD-32** — carve out the student-facing at-cap Explanation message against FR-31's naming requirement.
12. **AD-11 / AD-12** — constrain stage-3 minted Topic labels to curriculum-level terms.
13. **AD-19 Deferred** — write the R2 egress rule now (encryption, retention, §5.2 clause) or state plainly that v0 accepts total loss of Page Images.
14. **AD-22** — Tier 3 runs against synthetic fixtures only.
15. **§5.2 copy** — distinguish the 90-day photograph clock from the indefinitely-retained Extraction in any parent-facing privacy language.
