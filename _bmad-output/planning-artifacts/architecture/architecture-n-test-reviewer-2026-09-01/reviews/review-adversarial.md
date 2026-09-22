# Adversarial Lens — Architecture Spine Review

**Target:** `ARCHITECTURE-SPINE.md` (n-test-reviewer v0, updated 2026-09-02)
**Lens:** adversarial — construct pairs of units one level down that each obey every AD to the letter and still build incompatibly.
**Method:** for each finding, two concrete units (epics/stories/devs), the exact AD text each one is complying with, and the resulting incompatibility.
**Result:** 20 findings. Ranked by likelihood of actually shipping broken.

---

## TIER 1 — These ship broken

### F1. No AD says who owns a transaction that spans two modules. Three ADs demand such transactions; AD-17 forbids the only obvious mechanism.

**The ADs in tension**

- AD-5: "**Enqueueing work and mutating state share one transaction**"
- AD-10: grading, the ungraded-retry resolution, and the parent override "each recompute Mastery **before they commit**"
- AD-14: "The cap check and the artifact INSERT occur in the **same transaction**; DB serialization enforces the cap"
- AD-17: "Every other module reads through the owning module's service and **never through Prisma directly** — no module touches another module's Prisma delegate, for read or write."

**Unit A — Story "Submit Attempt and return scored result"** (owner: `practicetest`)
Complies: `practicetest` owns Attempt and Answer (AD-17). It opens `prisma.$transaction(async tx => …)`, writes Answers via its own delegate, then calls `gradingService.gradeAttempt(tx, attemptId)` passing the transaction client so AD-10's "before they commit" holds. It never touches grading's delegate — grading's service does that.

**Unit B — Story "Grade a submitted Attempt and recompute Mastery"** (owner: `grading`)
Complies: `grading` owns grade state and Mastery (AD-17), and AD-10 names *grading* as the party that recomputes before commit. So `gradingService.gradeAttempt(attemptId)` opens its own `$transaction`, calls `practicetestService.readAnswers()` through the owning service (AD-17), writes grades and Mastery, commits. It never touches practicetest's delegate.

**Incompatibility**
Both are literally compliant. Composed, you get either a nested `$transaction` (Prisma opens a *second* connection — the inner work commits independently, and AD-10's "no window where a grade exists and Mastery does not" is silently false), or two sequential transactions with a crash window between them, or a compile error because `gradeAttempt` has two signatures. The bug is invisible in tests unless someone kills the process between commits. This is the single highest-probability defect in the spine because *every* multi-module write path hits it: submit, generation-draft-commit, upload, Topic merge, profile deletion.

**Close it with:** a new AD naming the transaction-boundary rule. Suggested: *the module that owns the entity whose write initiates the unit of work opens the transaction and is the only module that may open one; every cross-module service method that participates in a write accepts a transaction client as its first parameter and never opens its own; a service method that accepts no transaction client may not write.* That also makes AD-17's "never through Prisma directly" enforceable by lint (grep for `$transaction` outside the owner).

---

### F2. AD-14's cap check cannot be implemented without reversing a dependency arrow the Structural Seed declares irreversible.

**The ADs in tension**

- AD-14: "The cap check and the artifact INSERT occur in the **same transaction**."
- AD-17 / Structural Seed: `allowance --> sourcetest`, `allowance --> practicetest`, `allowance --> explanation`. "**No arrow may be reversed without moving entity ownership.**"
- AD-17: `allowance` "**owns no entity** — a policy module."

**Unit A — Story "Enforce Generation Allowance on draft commit"** (dev on `practicetest`)
Complies with AD-14 by calling `allowanceService.assertCapacity(tx, accountId, 'generation')` immediately before the `PracticeTest` INSERT, in the same `tx`. Result: a `practicetest --> allowance` edge that does not exist in the graph and is the reverse of a declared arrow.

**Unit B — Story "Allowance-gated artifact creation"** (dev on `allowance`)
Complies with the graph by keeping all arrows pointing out of `allowance`: `allowanceService.createChargeableArtifact()` opens the transaction, counts, then calls `practicetestService.insertDraft(tx, …)`. Result: `allowance`, which "owns no entity", is now the transaction owner and effective write-coordinator for three other modules' entities — and by F1's rule would be the owner of writes it does not own.

**Incompatibility**
Two different call directions for the same gate, and the two are not composable — if Unit A ships for uploads and Unit B ships for generation, `allowance` both depends on and is depended on by `sourcetest`/`practicetest`, which in NestJS is a circular module dependency requiring `forwardRef`, which then makes the "no arrow may be reversed" rule meaningless. Worse, whichever loses, one of the three chargeable paths ends up doing the count *outside* the insert transaction, and AD-14's "DB serialization enforces the cap, not an application-level clamp" quietly becomes an application-level clamp — the exact failure AD-14 exists to prevent.

**Close it with:** decide explicitly. Cleanest: give `allowance` a *pure* interface — `allowance.predicateFor(callClass)` returning a count query + window that the owning module executes inside its own transaction (`SELECT … FOR UPDATE` or a unique/exclusion constraint). Then `allowance` stays a policy module with no runtime edge in either direction, and the cap is enforced by a DB constraint as AD-14 demands. State the constraint mechanism in the AD; "DB serialization enforces the cap" is not a mechanism, it is a hope.

---

### F3. Generation Allowance has two defensible charge points and the spine endorses both.

**The ADs in tension**

- AD-3/AD-5: "a request that triggers Extraction or Generation **enqueues it and returns**" and "Enqueueing work and mutating state share one transaction — required because FR-31 charges on successful production, so 'job succeeded, debit did not' must be impossible."
- AD-14: "Generation = Practice Tests whose status has **ever reached draft**… A Practice Test charges on **first reaching draft and never again**."
- AD-24: "Each draft is **committed as it lands** and charges one Generation Allowance unit."

**Unit A — Story "Enqueue a generation request"** (dev on the API endpoint)
Reads AD-5's "enqueue and mutate state share one transaction" plus AD-14's "cap check and artifact INSERT in the same transaction" and concludes the cap must be checked at enqueue for the full requested count (5 drafts requested → require 5 units), because that is the only transaction the *request* has. Refuses the request if fewer than 5 remain.

**Unit B — Story "Commit a generated draft"** (dev on the worker)
Reads AD-24 and AD-14 literally: the chargeable artifact is the draft, charged as it lands, and the cap check must share the draft's INSERT transaction. Checks capacity per draft inside the job.

**Incompatibility**
Three distinct broken behaviours depending on which ships:
- Only A: a parent with 2 units remaining is refused a 5-draft request outright, but a 5-draft request that partially fails to 3 drafts has reserved 5 and charged 3 — and AD-14 has no reservation concept ("No counter column"), so nothing releases the other 2. There is no row to release; the count is derived. A therefore *cannot* reserve, which means A's check is a check against nothing.
- Only B: the request is accepted, the job runs, drafts 1–2 land and charge, draft 3 is refused mid-job. The parent gets a partial completion (AD-24 says report as partially complete) whose cause is "you ran out", which AD-32 forbids surfacing to a student but says nothing about how a parent learns it, and the job burned two provider calls to discover a cap that was knowable at enqueue.
- Both: double-gating with two different denominators, and a race where the enqueue check passes and every draft check fails.

**Close it with:** amend AD-14/AD-24 to state the charge point *and* the gate point explicitly, and reconcile the derived-count model with request-level admission: e.g. *the enqueue transaction inserts N `PracticeTest` rows in a pre-draft state under the cap check; the job transitions them to draft; the countable predicate remains "has ever reached draft" and unlanded rows are swept.* That makes the artifact exist before the job and gives the cap a row to serialize against — which is what AD-14's model actually requires.

---

### F4. A Topic merge must recompute Mastery, but there is no legal path from `topics`/`admin` to `grading` and no legal execution vehicle.

**The ADs in tension**

- AD-12: "A merge re-points every Question tagged with the merged Topic **and** recomputes Mastery for every affected Student Profile, through the same recompute path as every other trigger (AD-10). Built from the start, not retrofitted."
- AD-6: "**no module other than `grading` writes it** [Mastery]."
- AD-10: "**No separate recompute job.**"
- AD-3/AD-4: "No other call class is queued."
- Structural Seed: edges are `grading --> topics`, `admin --> topics`, `topics --> admin`. There is **no** `topics --> grading` and **no** `admin --> grading`. "No arrow may be reversed without moving entity ownership."

**Unit A — Story "Operator merges two provisional Topics"** (dev on `admin`)
Complies with AD-12 by calling `gradingService.recomputeMasteryFor(profileIds)`. This creates an `admin --> grading` edge that does not exist and reverses nothing declared — it simply is not in the graph, so the dev believes it is fine to add. But `grading --> topics` exists, so once `topics` is involved in the merge (it owns the canonical set, AD-17), the cycle `grading --> topics --> grading` is real.

**Unit B — Story "Topic merge re-points Questions"** (dev on `topics`)
Complies with the graph by refusing to add the reversing edge, and instead has `grading` subscribe: `topics` writes the merge, and Mastery is corrected the next time a qualifying grade change occurs for that profile (AD-6: "All recompute triggers hit the same code path"). Nothing violated on the letter — but AD-12's "recomputes Mastery for every affected Student Profile" never happens, and Mastery is silently stale for every profile that stops practising that Topic.

**Incompatibility**
A and B produce different Mastery values for the same data for an unbounded period, and A introduces a module cycle. Compounding: a merge affecting 200 profiles is a foreground admin request; AD-10 forbids a separate recompute job and AD-3/AD-4 forbid queueing anything but Extraction and Generation, so the *only* compliant implementation is a single synchronous transaction recomputing every affected Mastery row while holding locks — which will time out and, per F1, has no defined owner.

**Close it with:** (a) add the `topics --> grading` (or `admin --> grading`) edge explicitly with a note that it is a write-through-owner call, not a reversal; (b) carve an exception into AD-10 and AD-3 for bulk recompute — either a named queued `mastery-recompute` job class (and then AD-4's "no other call class is queued" must be amended to say it governs *AI call classes*, not all work — as written it forbids any queued work at all, including the AD-33 sweepers, which is itself a defect) or a documented batched-transaction rule with a size bound.

---

### F5. "Grade state" is an attribute, not an entity, and the ownership list splits it from the row it lives on.

**The ADs in tension**

- AD-17: "`practicetest` (Practice Test, Question, Attempt, Answer) · `grading` (**grade state**, Mastery)"
- AD-2: "Four grade states — correct, incorrect, **unanswered**, ungraded (FR-37) — carried through **Attempt storage**, the answer key, parent drill-down, and Mastery."
- ER diagram: `Attempt ||--o{ Answer`, `Question ||--o{ Answer`. There is no `Grade` entity.

**Unit A — Story "Persist grade results"** (dev on `grading`)
Puts `gradeState` as a column on `Answer` because AD-2 says grade state is "carried through Attempt storage" and the ER diagram has nowhere else to put it. `grading` writes that column. Complies with AD-17's "grading owns grade state."

**Unit B — Story "Record student answers on submit"** (dev on `practicetest`)
Owns `Answer` per AD-17 and writes the row. Complies with "one writer per entity."

**Incompatibility**
Two modules write the same row. AD-17's headline — "One writer per entity; the module that writes an entity owns it" — reads as satisfied by both devs and is in fact violated. Concretely: the submit path (F1) has `practicetest` INSERT the Answer and `grading` UPDATE the same row microseconds later in the same or a different transaction; a `Prisma` update from grading's delegate on practicetest's model is a *direct* AD-17 violation ("no module touches another module's Prisma delegate"), so grading must call back into `practicetest` to write its own grade — at which point practicetest is the writer of grade state and AD-6's "no module other than grading writes it" is false.

Second-order: `unanswered` is a grade state for a Question with **no Answer row at all**. If grade state lives on `Answer`, unanswered questions have no row to carry it, and Mastery's denominator (AD-6: "unanswered and ungraded excluded from the denominator") is computed from absence rather than from a value — two devs will disagree on whether an absent Answer is `unanswered` or "not part of this attempt".

**Close it with:** make grade state a first-class owned entity. Add `QuestionGrade` (attemptId, questionId, state, gradedAt, rationale) owned by `grading`, one row per Question per Attempt including unanswered ones, and remove grade state from `Answer`. Update the ER diagram. This also gives F14 (rationale exposure) a clean DTO boundary.

---

### F6. When is a `SourceTest` row created? The Upload-count predicate and the abandoned-capture rule give opposite answers.

**The ADs in tension**

- AD-14: "Upload = **Source Tests created in window**."
- AD-15: "An abandoned capture consumes nothing: Upload Allowance is charged against the **Source Test, not the pages**. A swept `uploading` row is deleted outright and leaves no tombstone — **it never charged anything**."
- AD-15: "A `PageImage` row is INSERTed in state `uploading` **before any byte is written**."
- AD-16: FR-35 restorable capture state is a row with a 72h TTL.
- ER diagram: `SourceTest ||--o{ PageImage`.

**Unit A — Story "Multi-page capture with restore"** (dev on `sourcetest`)
Creates the `SourceTest` row at the start of capture, because `PageImage` has a required FK to it (ER diagram) and AD-15 requires the PageImage row before the first byte. The half-finished SourceTest is the FR-35 restorable state (AD-16). Fully compliant.

**Unit B — Story "Count Upload Allowance"** (dev on `allowance`)
Implements AD-14's predicate exactly: `count(SourceTest where createdAt in window and parentAccountId = …)`. Fully compliant.

**Incompatibility**
Under A+B, a parent who opens the camera, shoots one page, and closes the app has **created a Source Test in the window** and is therefore charged an Upload — directly contradicting AD-15's "an abandoned capture consumes nothing." The two ADs are not reconcilable as written: AD-14's predicate keys on creation, AD-15's rule keys on commitment, and no state discriminator is named. The mirrored bug is equally reachable: a dev who fixes it by only counting committed Source Tests, without amending AD-14, makes `allowance` depend on a state field whose name and value set nobody has defined, and the Generation predicate ("has ever reached draft") shows the spine *does* know how to express this — it just did not here.

**Close it with:** amend AD-14's Upload predicate to mirror the Generation one: *Upload = Source Tests that have **ever reached committed**, carried as a durable marker on the row*, and state that `uploading`/uncommitted Source Tests are not countable. One sentence, and it also makes the AD-16 sweeper's behaviour ("deleted outright, no tombstone") consistent.

---

### F7. Grading call granularity is undefined; batched and per-question implementations differ in latency, cost rows, and failure blast radius.

**The AD**

- AD-4: "**Submission blocks on grading** and returns the scored Attempt. Only Fill-in-the-Blank and Short Answer Questions the student **actually answered** are sent; blank Questions consume no model call."
- AD-4/AD-31: "Grading exhaustion writes `ungraded`."
- AD-4: FR-22 retry — "a **resolving Question** updates in place marked as newly graded."
- AD-20: "an **AiCall row per completed provider call**."
- AD-1: inherited client config, "30s default timeout, `maxRetries: 2`". AD-7 overrides to 180s **for the vision path only**.

**Unit A — dev reads "sent" as one batched call.** One `gpt-5.6-luna` request carrying all answered FITB/SA questions, one structured-output schema with an array, one AiCall row, one cost figure per submission.

**Unit B — dev reads it as one call per question.** N requests, N AiCall rows, per-question failure isolation — which is what FR-22's "a resolving *Question*" language implies.

**Incompatibility**
- **Failure blast radius:** in A, one upstream fault ungrades the entire attempt; in B, one question. AD-31's "Grading exhaustion writes `ungraded`" is silent on the unit, so both are compliant and the user-visible behaviour differs completely.
- **Latency, in the foreground:** AD-4 makes submission *block*. B on a 20-question attempt with `maxRetries: 2` at a 30s timeout is a worst case of 20 × 90s = 30 minutes inside one HTTP request. There is no AD setting a grading timeout budget — AD-7 pins 180s for vision and leaves grading on the inherited 30s per request with no ceiling on total request time. A blocking submit has no stated deadline anywhere in the spine.
- **Cost attribution:** A and B produce order-of-magnitude different AiCall row counts, which feeds AD-23's global daily spend ceiling — a ceiling tuned against A's row volume behaves differently against B's.

**Close it with:** an AD stating the grading call unit (recommend: one batched call per submission with a per-question result array, and per-question `ungraded` on partial schema failure), plus an explicit **total wall-clock budget for the blocking submit request** and what happens when it is exceeded (write `ungraded` for the unresolved remainder and return, letting FR-22 pick them up).

---

### F8. AD-23's spend ceiling refuses AI work, but AD-31 has only two fault classes and neither is "policy refusal".

**The ADs in tension**

- AD-23: "A global daily spend ceiling enforced against the AiCall table… Crossing the configured limit **refuses new AI work** and fires an alert."
- AD-31: "**Client fault (BadRequest class):** an unreadable or unusable *input*. **Terminal, never retried**, surfaced to the parent as a **retake prompt per FR-10**." / "**Upstream fault (BadGateway class):** provider timeout, rate limit, refusal, or outage. **Retried with backoff.**"

**Unit A — dev on the `ai` module** classifies the ceiling refusal as BadGateway (it is a refusal, and AD-31 literally lists "refusal" under upstream). Result: every queued Extraction and Generation job retries with backoff against a ceiling that will not lift until the daily window rolls, and the FR-22 results-screen retry loop (F11) re-fires on every screen open. The system spends its entire retry budget discovering it has no budget.

**Unit B — dev on `sourcetest`** classifies it as BadRequest, because it is terminal and not worth retrying. Result: AD-31 mandates the FR-10 **retake prompt** — the parent is told their photograph is unreadable and asked to re-shoot a perfectly good page, repeatedly, while the real cause is that the operator's daily budget blew. This is a support nightmare that a test suite will never catch, because AD-22's fake is specified to produce "timeouts, provider refusals, schema-invalid responses" — not policy refusals.

**Incompatibility**
Two units, two classifications, both citing AD-31 text, opposite user-facing behaviour and opposite retry behaviour. Note also that AD-31 already conflates two things under "upstream": a provider *content* refusal and a provider *availability* failure — and AD-30 then routes schema/post-hoc validation failures to "upstream" too, so a systematically malformed prompt retries forever burning spend, which is the exact failure AD-31's preamble says it prevents ("a retry policy re-enqueuing an unusable photograph forever, burning spend on input that can never succeed").

**Close it with:** add a **third class to AD-31 — policy fault (ServiceUnavailable class)**: terminal for this attempt, never retried, never a retake prompt, surfaced as "temporarily unavailable, try later", excluded from job retry accounting. Assign the ceiling refusal, and separately cap post-hoc-validation retries at a small integer before they become terminal content faults.

---

### F9. Timezone is effective-dated; Account Tier is not — and the Explanation count predicate keys on tier.

**The ADs in tension**

- AD-27: "The Parent Account holds a **timezone history of effective-dated entries**, not a single mutable field… a change takes effect from the **next** period boundary." (Prevents: "a timezone change moving counts.")
- AD-14: "Explanation = **Explanation rows generated in window on Free tier**."
- AD-25: "**Account Tier assignment** writes `ParentAccount` **through `identity`'s service**."

**Unit A — Story "Operator changes an account's tier"** (dev on `admin`/`identity`)
Writes `parentAccount.tier = 'paid'` through `identity`. Complies with AD-25 exactly; nothing in the spine hints tier needs history, and AD-27's effective-dating is scoped by its own Binds line to "every period-window computation in `allowance`" and timezone only.

**Unit B — Story "Count Explanation Allowance"** (dev on `allowance`)
Implements AD-14 literally. But "on Free tier" has no timestamp: does it mean rows generated *while* the account was Free, or rows generated in the window *if the account is Free now*?

**Incompatibility**
Both readings are live and produce different numbers, and the mutable field makes the honest reading unimplementable — once tier is overwritten, "while the account was Free" is unrecoverable. Concrete exploit and concrete bug in the same mechanism: an account upgraded mid-month and downgraded before month end has, under the "is Free now" reading, an Explanation count that includes its paid-tier usage (over-charging a customer) or, under a naive fix, zero (unlimited free Explanations for a month). AD-27 built the exact machinery to prevent this class of error and applied it to only one of the two fields that need it. This is the amended-rule-vs-unamended-rule shape the brief warned about: AD-27 was clearly written to fix the timezone problem and never swept for siblings.

**Close it with:** extend AD-27 to *every account attribute that participates in a period-window or countable predicate* — explicitly naming Account Tier — and store tier as effective-dated entries with the same "takes effect at the next period boundary" rule. Then AD-14's predicate becomes "Explanation rows generated in window while the account's effective tier was Free."

---

### F10. Three entities in the ER diagram have no owning module.

**The ADs in tension**

- AD-17 enumerates every module's owned cluster. It does **not** name `UncommittedState`, `UsageTombstone`, or `TimezoneEntry`.
- ER diagram declares all three as real entities hanging off `ParentAccount`.
- AD-17 headline: "One writer per entity."

**Unit A — Story "Delete a Student Profile"** (dev on `identity`)
AD-15: "What survives a Student Profile deletion is an anonymous `UsageTombstone`." The deletion is `identity`'s (it owns Student Profile), so `identity` writes the tombstone. Compliant.

**Unit B — Story "Preserve allowance counts across deletion"** (dev on `allowance`)
AD-14 is the AD that defines the tombstone, it is `allowance`'s counting model, and `allowance` is the only module that reads it. So `allowance` writes it. Compliant — except `allowance` "**owns no entity**", so this is also an AD-17 violation the dev will not notice because no list assigns the entity anywhere.

**Incompatibility**
Two writers of `UsageTombstone` with no arbiter, and a tombstone whose count is computed by whichever module wrote it — with two different countable-predicate implementations if `identity` computes it (it does not have the predicates; they live in `allowance`, which `identity` has no edge to — there is no `identity --> allowance` arrow, and adding one reverses nothing but is undeclared). Same shape for `UncommittedState`: AD-15 and AD-16 govern it, the sweeper (AD-33) writes/deletes it, FR-35 restore reads it, `sourcetest` creates it during capture, and no module owns it. `TimezoneEntry` is written by `identity` (account settings) and read by `allowance` (AD-27) with no `allowance --> identity` edge in the graph.

**Close it with:** assign all three in AD-17. Suggested: `identity` owns `TimezoneEntry` and `UsageTombstone` (both are Parent Account facts and survive profile deletion), `sourcetest` owns `UncommittedState` — or promote it to a shared `uncommitted` module since AD-16 explicitly generalises it to "any future uncommitted-work surface". Add the missing `allowance --> identity` and `analytics`/`admin` edges to the graph.

---

## TIER 2 — These ship subtly wrong

### F11. FR-22's retry trigger has no idempotency, no lock, and no rate limit — and the trigger is a screen a student can refresh.

**The AD**

- AD-4: "FR-22 retry is triggered by **opening the results screen**, by student or parent — no scheduled retry, no job."
- AD-14: Grading charges **no** allowance (only Upload, Generation, Explanation exist).
- AD-32: no allowance counter, cost figure, or tier label is reachable from a student-scoped endpoint.

**Unit A — the student results screen** fires a retry for every `ungraded` Question on mount.
**Unit B — the parent drill-down** does the same, per AD-4's "by student or parent".

**Incompatibility / failure**
Nothing in the spine makes this idempotent. Student and parent open the same attempt simultaneously → two provider calls per ungraded Question, two AiCall charges, and two Mastery recomputes racing inside two AD-10 transactions with no stated isolation level — last writer wins, and since AD-6 recomputes "from the window, never incremented", the loser's grade may or may not be inside the window the winner read. Worse: a student holding refresh on a results screen with 10 ungraded questions issues unbounded paid `gpt-5.6-luna` calls. The only backstop is AD-23's *global* ceiling, i.e. one child's refresh key can starve every other account, and AD-32 forbids telling the child anything about why.

**Close it with:** add to AD-4 — *an ungraded Question carries a `gradingAttemptCount` and a `nextRetryEligibleAt`; retry-on-open is a no-op unless eligible; the resolve path takes a row-level lock on the Question grade so concurrent openers coalesce; after N attempts the Question is terminally ungraded and the screen offers no further automatic retry.*

### F12. Confidence aggregation is named as "the signal" behind FR-8 and FR-9a but never defined — and legibility has no fields to be per-field about.

- AD-30: "Every **Extraction schema field** carries a self-assessed confidence of low/medium/high… **Aggregate low confidence across a page** is the signal behind FR-8 and FR-9a."
- AD-29: legibility "output feeds **the same per-field confidence signal** as Extraction."

**Unit A — FR-8 legibility gate (`sourcetest`)** implements "any field low → prompt retake" so the parent re-shoots while the paper is in hand.
**Unit B — FR-9a uninterpretable marking (`extraction`)** implements "≥30% of fields low → mark the page uninterpretable."

Both cite the same undefined phrase. The same page is passed at capture and rejected after extraction (or the reverse), and the parent has thrown the paper away by then — which is precisely the outcome AD-29's "while the physical paper is still in hand" exists to prevent. Separately, AD-29 says legibility is a distinct call class feeding a *per-field* signal, but legibility runs **before** extraction, so there are no extracted fields yet; the legibility schema's shape is undefined and two devs will invent different ones (page-level score vs. per-region array), with no shared consumer contract.

**Close it with:** define the aggregation function and threshold once, in AD-30, as a named shared function owned by `ai` (or a shared package), with the legibility schema stated explicitly and the FR-8 and FR-9a thresholds given as two configured numbers over the *same* function — so they can differ deliberately rather than accidentally.

### F13. AD-13's idle clock is a client-honor rule with no server enforcement point.

- AD-13: "**The client owns the idle clock**… **Polling does not touch the clock**; polling is not interaction."
- AD-18: "Parent surfaces fetch client-side carrying the elevation token."

**Unit A — the auth guard dev** implements a server-side "last request seen" and extends validity on any authenticated parent request, because that is the natural server implementation and AD-13 says the elevation token has a 15-minute window. Polling requests therefore keep the session alive forever — the exact failure AD-13's *Prevents* line names.
**Unit B — the client dev** implements interaction listeners and only calls `/elevation/refresh` on real interaction.

The server cannot tell a poll from an interaction; the only enforcement is that the refresh *endpoint* is called sparingly. Nothing in the spine says the refresh endpoint is the **sole** extension mechanism, or that no other endpoint may extend. A single guard written the obvious way silently defeats FR-34 and the rule decays with no test that would catch it (AD-22 Tier 1 owns "elevation-token scope enforcement", not idle expiry semantics).

Related ambiguity in the same AD: "the elevation token expires on its own 15-minute window and the **server mints any replacement**" vs "the client may only **request** a refresh, never extend a token". What does `/refresh` require to authorise minting? If the session cookie suffices, AD-18's "the session cookie **alone never satisfies** a parent-scoped endpoint" is violated (or `/refresh` is declared not-parent-scoped, which makes the PIN gate bypassable by calling it). If the current elevation token is required, then a token that expires while the parent is reading (the AD-13 scenario) cannot be refreshed and the parent is dropped — reintroducing the problem.

**Close it with:** state in AD-13 that **`POST /elevation/refresh` is the only endpoint that may extend elevation; no guard, middleware, or interceptor may extend it as a side effect**, and state exactly what `/refresh` requires (recommend: session cookie **and** an unexpired elevation token, both).

### F14. `AiCall.parentAccountId` nullability is undecided, and the spend ceiling sums the column.

- AD-20: "The `ai` module writes an AiCall row per completed provider call: **Parent Account**, call class, …"
- AD-23: "A global daily spend ceiling enforced **against the AiCall table** — total across all accounts."

Admin-initiated Topic-normalization calls (AD-12 merge/disposition) and any operator-triggered work have no Parent Account. **Unit A** makes the column non-null and blocks or mis-attributes admin-initiated calls (attributing an operator's spend to whichever account happened to trigger the provisional Topic). **Unit B** makes it nullable; then PRD §10 per-account attribution silently under-reports, and any `GROUP BY parentAccountId` cost view drops rows. Both comply with "Parent Account" as written.

**Close it with:** state the column as nullable with an explicit `initiator` discriminator (`parent` | `operator` | `system`), and state that the AD-23 ceiling sums **all** rows regardless of initiator.

### F15. Five call classes or six? Embedding calls may be invisible to the spend ceiling.

- AD-2: "**Four** AI call classes… plus FR-8 legibility as a **fifth** class."
- AD-20: call class enumeration lists **six**: "Extraction, Generation, Grading, Explanation, Legibility, **Topic normalization**."
- AD-11 stage 2: "**embed the label with `text-embedding-3-small`**" — a provider call.
- AD-8 enumerates model pins for four classes only; AD-29 says legibility "carries its own snapshot pin" and the Stack table repeats that without giving a value.

**Unit A (`topics` dev)** treats stage-2 embeddings as internal plumbing, not one of AD-2's classes, and writes no AiCall row. Embedding spend becomes invisible to AD-23's ceiling and to PRD §10.
**Unit B** writes AiCall rows under class `Topic normalization` for both the stage-2 embedding and the stage-3 completion — two very differently-priced calls collapsed into one class, so the cost-per-class view is meaningless and the pinned-model column holds two different models under one class.

Also unresolved: the legibility model snapshot has no named value anywhere, so two devs will pick two models, and AD-8's "Model ids are snapshot ids held in configuration" gives no default to disagree about.

**Close it with:** publish the canonical call-class enum in one place (AD-20), with `Embedding` as its own class, reconcile AD-2's "five" to that list, and name the legibility snapshot in the Stack table.

### F16. "Timer configuration is written once at generation" vs. the parent setting the timer at release.

- AD-33: "**FR-15 timer immutability:** a Practice Test's timer configuration is written **once at generation** and is immutable thereafter."
- Capability map: "§4.4 Parent review and release (FR-12..**FR-15**) | `practicetest`, web Parent View".

**Unit A (generation job)** writes a default timer when the draft lands (AD-24: committed as it lands), making it immutable before the parent ever sees it. **Unit B (parent review UI)** builds a timer control on the review screen per §4.4's mapping of FR-15 to parent review. B's control writes a field A declared immutable; whichever guard ships wins, and the product either has a parent-set timer or does not — a user-visible feature decided by an implementation-order accident.

The ambiguity is in "at generation": generation-the-job vs. generation-the-lifecycle-stage-ending-at-release.

**Close it with:** amend AD-33 to "written once **at release** (the transition out of draft) and immutable thereafter", or explicitly state the timer is a generation parameter the parent supplies *before* enqueue. Either is fine; the spine must pick.

### F17. Rollback targets the previous image SHA, but migrations are forward-only with no compatibility rule.

- AD-19: "**Migrations are a discrete one-shot step** run **before** `compose up`." / "**Rollback targets the previous SHA tag, never `:latest`.**"

**Unit A (a story adding a column)** writes an additive migration. Rollback works.
**Unit B (a story renaming/dropping a column)** writes a destructive migration; it is a perfectly ordinary Prisma migration and no AD forbids it. Deploy runs the migration, the app fails for an unrelated reason, the operator rolls back to the previous SHA — and the previous image's Prisma client queries a column that no longer exists. The rollback restores a build that cannot boot. AD-19's *Prevents* line says "a rollback that restores the build that just failed"; it does not prevent a rollback that restores a build the *schema* has moved past. With one environment and no staging (AD-19), this is discovered in production.

**Close it with:** an AD rule — *every migration must be backward-compatible with the immediately previous release (expand/contract: add and backfill in release N, stop writing in N, drop in N+1); a destructive migration may not ship in the same release as the code that stops using the column.* Also state the rollback procedure for the case where the schema has moved (there is currently none).

### F18. Does the 72-hour TTL sweep delete in-progress Attempts?

- AD-16: "**One TTL, 72 hours from row creation**, applied uniformly to uncommitted state whether or not it carries bytes… The TTL is a floor on retention, not a ceiling on protection: within the window the state stays gated on a parent-scoped token. **Sole exception:** in-progress Attempt state, which is client-owned and student-reachable (AD-26)."

**Unit A (sweeper dev)** reads the exception as attached to the *gating* sentence it immediately follows — Attempt state is exempt from parent-gating, not from the TTL. Sweeps open Attempts older than 72 hours.
**Unit B (attempt dev)** reads the exception as exempting Attempt state from AD-16 entirely, since AD-26 gives Attempts their own lifecycle ("the Attempt stays open with every answer intact").

Under A, a student who starts a test Friday and returns Monday finds it gone — while AD-26 promised "the Attempt stays open with every answer intact" and the client still holds the answers keyed to a now-deleted Attempt id. Submission then fails with a foreign-key error and AD-26's "never retried silently, the student is told" produces an error the student can never clear. This is a real data-loss path that both devs believe is compliant.

**Close it with:** state Attempt lifetime explicitly in AD-26 — open Attempts are exempt from the AD-16 TTL and expire only by their own timer (AD-26) or by an explicitly stated longer bound — and move the "sole exception" clause so its scope is unambiguous.

### F19. Stage-2 vector column: shape undefined, and nothing invalidates it on rename or merge.

- AD-11: "cosine-compare **in application code** against **cached canonical vectors** for that Subject… vectors stored in an **ordinary Prisma column**. **pgvector is not adopted.**"
- AD-12: an operator may "confirm, **merge**, or **rename**" a Topic.

**Unit A** stores `Float[]`; **Unit B** stores `Bytes` (packed float32) or a JSON string — all three are "an ordinary Prisma column", and they are not interchangeable across the boundary between the mint path and the compare path if those are two stories. Dimension and normalisation (unit-normalised at write vs. normalised at compare) are equally undefined, and a mismatch produces a silently wrong cosine rather than an error — the worst failure mode, because Topic splitting is exactly what AD-11 exists to prevent.

Invalidation: after an operator renames a Topic (AD-12), the cached vector still encodes the old label. After a merge, vectors for the merged-away Topic must be removed from the candidate set. `admin` initiates both but `topics` owns the vectors, and no AD assigns the invalidation. It will simply not be written.

**Close it with:** pin the column type, dimension, and normalisation convention in AD-11 (recommend `Float[]`, 1536, unit-normalised at write so compare is a dot product), and add to AD-12: *confirm/merge/rename each re-embed or delete the affected canonical vectors in the same transaction as the disposition.*

### F20. Explanation counting vs. FR-39 suppression: the "free regeneration" is one row-lifecycle decision away from being free forever.

- AD-14: "Explanation = **Explanation rows generated in window** on Free tier." / "A suppressed Explanation (FR-39) **still counts as consumed**; the free regeneration it entitles carries a **flag excluding it from the count** — not a second counter."
- AD-33: "the **free regeneration is a distinct entry** rather than an overwrite."
- AD-15: "**Deletion erases.**"

**Unit A (`explanation` dev)** implements suppression by marking the row `suppressed` and inserting the regeneration as a distinct flagged row. Count = 1 (the suppressed original). Correct.
**Unit B (`explanation` dev on a different story)** implements suppression as "the bad content must not persist" — AD-15's "deletion erases" and AD-32's child-facing exposure rule both push toward removing the offending text — deletes the suppressed row, inserts the flagged regeneration. Count = 0. Every suppression now yields a free Explanation, and a Free-tier user who flags every Explanation has an unlimited allowance.

Nothing in the spine says a suppressed Explanation row is retained, and AD-15's deletion rule actively argues for erasure. The counting model depends on a row-retention decision made in a different module for a different reason.

**Close it with:** state in AD-14/AD-33 that *a suppressed Explanation's row is retained (content nulled if necessary) precisely because it is the countable fact*, and that only content is erased, not the row — mirroring the tombstone principle already established for deletion.

---

## Cross-cutting observations

**A. AD-4's "No other call class is queued" is over-broad.** Read literally with AD-3, it forbids *any* queued work other than Extraction and Generation — which contradicts AD-5 and AD-33, both of which require pg-boss **schedules** for the FR-32 expiry and the 72-hour sweep, and blocks the bulk Mastery recompute of F4. Amend to "no other **AI call class** is queued."

**B. Amended-vs-unamended pairs.** AD-4 was clearly revised to make grading foreground ("which is now the submit request"), and AD-10 was updated in step — but AD-31's grading-retry language, AD-1's inherited 30s/maxRetries:2, and the absence of any request-deadline rule were not swept (F7). AD-27 introduced effective-dating for one field and not its sibling (F9). AD-24 introduced per-draft charging and AD-14 was updated to match, but the *enqueue-time gate* implied by AD-5 was not reconciled (F3).

**C. Rules with no enforcement point** (they will decay silently): AD-13's idle clock (F13), AD-17's "never another module's Prisma delegate" (no lint rule named), AD-32's "a hardcoded user-facing string is a defect" (no check named), AD-32's child-facing exposure rule (no DTO boundary named), AD-34's provider no-training precondition (explicitly "a launch checklist item with a named owner" — the owner is not named), AD-30's post-hoc validation (no shared location named, so each call site writes its own).

**D. The one-writer rule is stated but not testable.** AD-17 is the load-bearing invariant of the whole paradigm and there is no proposed mechanism for it. Recommend a build-time check: each module's Prisma delegates are exposed only via a module-scoped repository class, and an ESLint rule / dependency-cruiser config forbids importing another module's repository. Without it, F1, F2, F5, and F10 all resolve themselves at runtime, silently, in whichever direction the first dev picked.
