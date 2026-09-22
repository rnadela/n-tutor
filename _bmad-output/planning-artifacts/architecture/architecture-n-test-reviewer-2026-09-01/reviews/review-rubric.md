# Rubric Walk — ARCHITECTURE-SPINE.md (n-test-reviewer)

**Reviewer role:** rubric walker, pre-handoff review gate
**Target:** `_bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md` (34 ADs, revised in place after a reconcile pass)
**Context consulted (not reviewed):** PRD `prd-n-test-reviewer-2026-08-29/prd.md`, architecture run `.memlog.md`
**Date:** 2026-09-02

---

## Verdict

**Conditional pass — 3 blocking findings, 4 material, several minor.**

This is a genuinely strong spine. It is written as a consistency contract rather than a design document: the ADs almost all state a constraint that a reviewer could fail a PR against, the `Prevents` clauses name real divergences rather than generic risks, and the hard invariants that actually keep independently-built units aligned (one writer per entity, one `ai` module, derived allowances, recompute-in-transaction, one TTL, one scheduler, one queue substrate) are present and sharp. The operational envelope — usually the silent dimension — is decided in detail (AD-19, AD-20, AD-21, AD-23). The Upstream Supersessions section is exemplary practice.

What holds it back from a clean pass is a small number of real forks left open: one whole dimension (Student-Mode profile scoping and device binding) is silent, one enforceable rule (the Upload countable predicate) contradicts two other places in the document and the PRD, and several entities that appear in the ER diagram have no declared owning module despite AD-17 making ownership the load-bearing invariant of the entire decomposition. Each is a place two units will diverge.

---

## Checklist walk

### 1. Does it fix the real divergence points for the level below, and miss none?

**Mostly yes; one whole class missed.**

Fixed well:

- **Async boundary** (AD-3/AD-4/AD-5): what is queued, what is foreground, on what substrate, and what state the progress surface reads. This is the single most likely place for two units to diverge and it is nailed down to the level of "no held connection, ever".
- **Provider boundary** (AD-17, AD-8, AD-9, AD-22): one `ai` module, pinned snapshots in configuration, one API shape, one test seam. The prompt-text carve-out is the right cut — it keeps domain knowledge in the domain and mechanism in the boundary.
- **Counting** (AD-14): the derived-not-decremented rule eliminates four drifting implementations at a stroke and the transaction-scoped cap check makes it enforceable rather than aspirational.
- **Deletion vs counting** (AD-14/AD-15): the tombstone mechanism is a real solution to a real conflict (erase the child's data, keep the count honest) and is stated precisely enough to build from.
- **Uncommitted state** (AD-16): collapsing FR-35 restore and orphan sweep into one mechanism at two moments is exactly the kind of unification a spine should make.
- **Time** (AD-27): effective-dated timezone history is the correct shape and the "admin reads the same history" clause closes the last fork.

**Missed — the divergence this spine does not fix:**

> **BLOCKING-1 — Student-Mode profile scoping and device binding are silent.**

AD-13 fixes what the token carries: "the token identifies the **Parent Account** and carries the mode". Nothing anywhere in the spine says how a request in Student Mode is scoped to **one Student Profile**. This is not a detail; it is the enforcement behind a hard PRD rule. PRD §3 glossary: Student Mode "shows only **one** Student Profile's Practice Tests, results, and Explanations". PRD FR-4 and FR-35 both treat cross-profile exposure as forbidden ("one child's retained draft state can strand on a device a sibling now operates — the cross-profile exposure FR-4 forbids").

The fork this leaves open is precisely the one AD-13's own `Prevents` clause claims to close ("Student Mode enforced by client routing on one surface and by a server check on another"). AD-13 closes it for the *parent/student* axis and leaves it wide open for the *which student* axis. Two units will build:

- unit A: `GET /practice-tests?studentProfileId=…`, server checks the profile belongs to the account — a sibling's id in a URL returns a sibling's data;
- unit B: bound profile as a token claim minted at mode switch, server derives scope, client-supplied ids rejected.

Both are defensible; they are incompatible; and A silently violates FR-4. Related and equally unstated:

- **Where does the device's last-bound Student Profile live?** FR-4 requires it to be defined at first profile creation and FR-34's *silent* expiry must fall back to it with no prompt. It is per-device, not per-account, so it cannot live on `ParentAccount` alone. Candidates — localStorage, a cookie, a `Device` row — are all viable and mutually incompatible, and one of them (a plain localStorage key) is trivially editable by a child to rebind to a sibling.
- AD-26 asserts client-side storage is "the only place student work lives outside the database"; the binding is not student *work*, so the assertion does not settle it either way.

This needs one AD: what identifies the bound profile, where it is held, who mints it, and that student-scoped endpoints derive profile scope server-side rather than accepting it from the client. It is the API-surface twin of AD-32's child-facing exposure rule and belongs next to it.

Two lesser gaps in the same family:

- **API contract shape is undecided.** AD-31 fixes the *taxonomy* of failure (client fault vs upstream fault) but nothing fixes its *wire representation* — error envelope, HTTP status mapping, pagination, whether `packages/` holds shared request/response types or web re-declares them. `packages/ # shared types/config` in the source tree is a hint, not a rule. The web app and the API are exactly the two independently-built units this altitude exists to keep aligned; a client-fault/upstream-fault distinction that each module encodes differently on the wire cannot be consumed uniformly by the client. Minor as spine content, real as a divergence.
- **Foreground latency budget** — see BLOCKING-3.

### 2. Is every AD's `Rule` enforceable, and does it prevent its stated `Prevents`?

Mostly yes, and unusually so — most rules are phrased as things a reviewer can fail a PR against ("a server-rendered parent screen is a bug", "a hardcoded user-facing string is a defect", "never through Prisma directly"). Exceptions:

> **BLOCKING-2 — AD-14's Upload countable predicate is wrong, and contradicts AD-15 and the PRD.**

AD-14: "Upload = **Source Tests created in window**." AD-15, four paragraphs later: "**An abandoned capture consumes nothing:** Upload Allowance is charged against the Source Test, not the pages." PRD §4.2 (FR-5 notes, line 299): "the Upload Allowance is consumed when the Source Test upload **succeeds**; a Source Test whose upload **or Extraction** fails consumes nothing and the parent may retry without a second charge." FR-31: "consumed on successful production, never on request."

A `SourceTest` row must exist before the first `PageImage` row (AD-15 requires a row before any byte), so "created in window" charges at the moment the parent taps capture — on request, not on successful production. Every abandoned or failed capture charges a Free-tier parent one of their few Upload units, which is the exact behaviour AD-15 and FR-5 forbid.

The fix is already in the document, one AD-14 bullet down, for Generation: "charges on **first reaching draft and never again**; the predicate is 'has ever reached draft', carried as a durable marker on the row." Upload needs the identical construction — a durable committed/succeeded marker on `SourceTest`, with the countable predicate being "has ever reached committed", not "created". Note the PRD makes *Extraction* failure non-charging too, so the marker's threshold needs deciding explicitly: upload-succeeded, or extraction-succeeded. Two units reading AD-14 and AD-15 respectively will implement two different Upload counts, and the parent-facing number and the FR-30a admin consumption view will disagree.

This is a strong AD with one stale bullet, not a weak AD; but as written the rule is enforceable *and wrong*, which is worse than vague.

> **BLOCKING-3 — AD-4's blocking submit has no latency budget, and AD-4 + AD-31 + AD-7 do not compose.**

AD-4: "**Submission blocks on grading** and returns the scored Attempt." AD-31: upstream faults are "Retried with backoff; on exhaustion surfaced as a transient failure". AD-7/AD-1: the inherited client is 30s timeout, `maxRetries: 2`; AD-7 overrides that to 180s **for the vision path only**.

Compose them on a 15-question Practice Test where the student answered eight Fill-in-the-Blank / Short Answer Questions. Whether those are one batched call or eight, the worst case under a rate-limited or degraded provider is 30s × 3 attempts × backoff, and AD-31 explicitly puts grading on the retry-with-backoff path (its last bullet: "Grading exhaustion writes `ungraded`"). That is minutes of a held HTTP request — behind Caddy's default proxy timeouts, behind whatever the browser does, on a phone in a kitchen. AD-3's `Prevents` clause objects to "one unit holding an HTTP connection open" as a divergence; AD-4 then mandates exactly that for grading without bounding it.

Three things are undecided and each is a fork:

1. **Batching** — one grading call for all answered Questions, or one per Question. This changes the retry granularity, the AiCall row count (AD-20), the cost attribution shape, and whether a single bad Question poisons the whole submit.
2. **Foreground retry policy** — AD-31's "retried with backoff" is written for the job path. Is a foreground call retried at all, and with what wall-clock ceiling? "Retry with backoff inside a request the user is waiting on" needs an explicit bound or an explicit prohibition.
3. **Wall-clock ceiling on the submit request**, and what happens at it. AD-4 says `ungraded` is written "only on grading failure" — is timeout-of-the-whole-submit a grading failure that writes `ungraded` and returns, or a 504 with the Attempt in limbo? The latter is a lost-work bug the spine currently permits.

AD-7 shows the author already knows the shape of the fix ("a timeout shorter than the provider's own worst case converts a slow success into a retry that pays twice") and applied it to vision. Grading needs the same treatment: a per-call timeout, a retry ceiling, and a total submit budget past which `ungraded` is written and the Attempt is returned. Without it, one unit builds a 10-second budget and another builds an unbounded retry loop, and FR-22's whole retry-on-open-results mechanism (AD-4) exists precisely so that returning `ungraded` fast is a *cheap* outcome — the spine has the escape hatch but never says when to take it.

Other enforceability notes (non-blocking):

- **AD-34's no-training clause is an aspiration by its own admission** — "a **deployment precondition**, not a code concern — recorded as a launch checklist item with a named owner". The spine is honest about this and pairs it with a mechanism where one exists (invitation codes checked at the endpoint, not in the UI — a genuinely enforceable rule). No code can assert a provider account setting, so this is the right call; flagged only because the checklist item has **no named owner** in the document. A named-owner slot with nobody in it is how launch checklists silently fail.
- **AD-32 is a large AD carrying four unrelated constraints.** All four are enforceable and each is well-phrased ("a hardcoded user-facing string is a defect"). The bundling is a legibility cost, not a correctness one — but "governed, not dropped" is the AD most likely to be skimmed, and it is the one carrying the child-facing exposure rule, which is a security control. Consider splitting the exposure rule out.
- **AD-23's throttler storage clause** — "In-process storage is valid only while the deployment is single-host; if that changes it moves to shared storage" — is a conditional with no trigger owner. AD-19 pins single-host for v0, so it holds today; it is a latent aspiration rather than a live one.

### 3. Could anything under `Deferred` let two units diverge?

**No.** Both deferrals are clean.

- *Offsite backup of Page Images* — an operational risk explicitly accepted, with the resolution named (R2 as an appended step), the blast radius characterised precisely ("survives a bad deploy, migration, or volume removal — **not** loss of the droplet"), and a concrete revisit trigger ("before the first real family's data lands, or at the first paying account"). Nothing downstream is built differently depending on how this resolves.
- *De-dup of Admin content-quality queue entries* — genuinely open, correctly scoped ("the queue's identity model is unresolved"), and confined to one admin surface. It does not fork any interface: `explanation` owns the flags either way (AD-17), and `admin` reads through its service (AD-25). Worth noting it is an **open question with no owner and no revisit trigger**, unlike the backup deferral which has both — it should carry the same.

Neither deferral leaves a fork open. The real open forks in this spine are the *undeclared* ones in findings 1–3, which is the more dangerous shape: a deferral is visible to a builder, silence is not.

### 4. Is named technology verified-current and plausible?

Deferred to the web-verification reviewer per the brief; only glaring items noted.

- The spine is admirably explicit about its own uncertainty: PostgreSQL major version and TypeScript are both marked `[ASSUMPTION]` inline in the Stack table with the resolution path named. That is the correct treatment.
- **PostgreSQL unpinned is load-bearing beyond the stack table.** AD-5 puts the queue in Postgres, AD-11 rejects pgvector and stores embedding vectors "in an ordinary Prisma column", and pg-boss 12.x has its own server-version floor. The unpinned major is not merely a version-table gap; it is a constraint three ADs depend on. Should be resolved before build, not during.
- AD-7's Prisma 7.10.0 note (pin both `prisma` and `@prisma/client`; driver adapter mandatory; generator `prisma-client` not `prisma-client-js`) is exactly the kind of sharp edge a spine should carry, and it is stated as a rule rather than a warning.
- Model snapshot ids (`gpt-5.6-sol` / `-terra` / `-luna`) are held in configuration per AD-8, which is what makes a retirement survivable — the right structural answer regardless of whether the ids verify.
- AD-29 says Legibility carries "its own pinned model snapshot" and the Stack table repeats "Legibility carries its own snapshot pin (AD-29)" — but no snapshot is actually named for it, unlike the other four classes. Minor, but it is a pin that does not exist yet.

### 5. Does it cover the driving PRD's capabilities?

**Yes.** All 43 FR ids (FR-1..FR-39 plus FR-9a, FR-24a, FR-26a, FR-30a) appear in `binds`, and cross-checking against the PRD's §3.1 index and §4 headings finds no FR omitted. The Capability → Architecture Map covers PRD §4.1–§4.10, §10, §10.1/§6.1, and abuse defense, each with a module and a governing AD set. Spot checks:

- FR-36 (offline answering, submission requires network, timer graded at expiry) → AD-26, which reproduces the PRD's rule including the reconnect/expiry distinction.
- FR-37 four grade states → AD-2 and AD-4, with AD-4 explicitly refusing a fifth state.
- FR-39 suppression + free regeneration → AD-14 (flag excluding from count, "not a second counter") and AD-33 (cache key includes Student Profile so a suppressed Explanation can never be served from cache). Well handled — this is a subtle interaction and the spine caught it.
- PRD §10.1 accessibility → AD-32, which correctly retains the SC 2.2.1 essential-timing argument as decided rather than re-deriving it.

One coverage note: the PRD's per-account timezone (§4.1, FR-1) is a **single mutable field** with an `[ASSUMPTION]`; AD-27 upgrades it to an effective-dated history. This is an improvement and the spine justifies it, but it is a change to a PRD-stated data shape that is **not listed in Upstream Supersessions** alongside the two addendum supersessions. A builder reading FR-1 will build a single field. Add it to that section.

### 6. Is every dimension the altitude owns decided, deferred, or an open question?

The operational/environmental envelope — the usual silent dimension — is **decided in unusual depth**: AD-19 (deploy shape, environments, TLS, migrations-as-discrete-step with the race explained, backups covering uploads, rollback-to-SHA, droplet sizing, and an explicit not-copied-from-reference list), AD-20 (logging, correlation, cost table, content denylist), AD-21 (error tracking with mandatory PII configuration), AD-23 (rate limits, global spend ceiling, edge limits, plus an explicit not-in-v0 list). The deployment mermaid agrees with AD-19 throughout. This dimension is a strength, not a gap.

Dimensions genuinely silent:

- **Student-Mode profile scoping / device binding** — see BLOCKING-1. This is the one whole dimension left silent.
- **Entity ownership is incomplete** — see MATERIAL-1 below. Since AD-17 makes ownership the load-bearing invariant, an entity with no owner is a silent dimension in miniature.
- **API/wire contract** — see finding 1's second half.
- **Runtime sizing knobs** — worker concurrency, job retry counts, pg-boss retention/archive policy, container restart policy and health checks. AD-19 pins the droplet at 4 GB but nothing bounds what runs on it. Lower severity: these are tunables discoverable in operation rather than forks that make two units incompatible. Worth one line in AD-19 or AD-33 naming where they live (compose + config, not code).

### 7. Internal consistency — contradictions and stale rules after the reconcile pass

The brief flags this as the highest-risk area given the in-place revision. Findings, in severity order:

> **MATERIAL-1 — Four entities in the ER diagram have no owning module.**

AD-17 enumerates every module's owned cluster and binds "every migration that adds an entity". The ER diagram introduces entities that appear in **no** cluster:

| Entity | Appears in | Declared owner |
| --- | --- | --- |
| `UsageTombstone` | ER, AD-14, AD-15, conventions table | **none** |
| `UncommittedState` | ER, AD-15, AD-16 | **none** |
| `TimezoneEntry` | ER, AD-27 | **none** |
| invitation codes | AD-34 | **none** (AD-25/AD-17 list `admin` as owning "Subject, GradeLevel, operator credentials, admin audit rows") |

`UsageTombstone` is the sharp case. AD-14 says `allowance` "**owns no entity**", yet the tombstone is purely an allowance artifact; AD-15 says it is written when a Student Profile is deleted, which is `identity`'s operation. So the entity that keeps the derived count honest is written by a module that does not own it, on behalf of a module that owns nothing. Under AD-17's one-writer rule this is unresolvable as written. Either `allowance` stops being an owns-nothing policy module and owns `UsageTombstone`, or `identity` owns it and `allowance` reads through `identity`'s service — both work, they are incompatible, and the spine picks neither.

`UncommittedState` has the same problem across `identity` (parent-scoped, AD-13-gated) and whichever module the uncommitted work belongs to. `TimezoneEntry` is plausibly `identity` by adjacency but is never said. Invitation codes are the smallest but the cleanest miss: AD-34 says "operator-managed through `admin`" while AD-25's ownership list omits them.

> **MATERIAL-2 — AD-5's stated rationale is stale after AD-14.**

AD-5: "**Enqueueing work and mutating state share one transaction** — required because FR-31 charges on successful production, so '**job succeeded, debit did not**' must be impossible."

There is no debit. AD-14: "**No counter column and no reset job.** Usage for a period is **counted artifacts plus usage tombstones**." The memlog confirms AD-5's wording predates the derived-allowance decision, and the reconcile pass amended AD-14 without revisiting AD-5's justification.

The *rule* survives on other grounds — AD-24's committed-as-it-lands drafts and AD-14's "cap check and artifact INSERT in the same transaction" both genuinely need the queue to be transactional with application data. But a builder reading AD-5 will go looking for the debit it names, not find one, and reasonably conclude the transaction requirement was superseded along with the counter. Re-justify against AD-24/AD-14's actual mechanism. (The conventions table row "Enqueue and mutate in one transaction (AD-5)" is fine as-is — it carries the rule without the stale reason.)

> **MATERIAL-3 — `extraction`'s ownership contradicts the ER diagram, and risks a one-writer violation.**

AD-17: "`extraction` (extracted Question content **on the Source Test**)". The ER diagram: `SourceTest ||--|| Extraction : yields` — a separate `Extraction` entity. "On the Source Test" reads as columns on the `SourceTest` row, which `sourcetest` owns. If a builder takes AD-17 literally, two modules write one table and AD-17's central invariant is broken on the first migration. The diagram's reading (a separate entity) is almost certainly the intent and is the one that preserves the invariant — but AD-17 is the normative text and the diagram is the seed, so the normative text is the wrong one. Reword AD-17 to "the `Extraction` entity, one per Source Test".

Also on that relationship: `||--||` asserts every Source Test has exactly one Extraction. AD-31 makes terminal client-fault Extraction failure a real outcome and AD-15 has `SourceTest` rows in `uploading` with no Extraction at all. Should be `||--o|`.

**MINOR — remaining consistency items:**

- **`analytics` read edges disagree between AD-33 and the diagram.** AD-33: "explicit read edges to `practicetest`, `grading`, `explanation`, and `allowance`" (four). Module diagram: those four **plus `analytics --> topics`** (five). The extra edge is well-justified — Mastery is per-Topic and FR-28/FR-29 need Topic labels — so the diagram is right and AD-33's enumeration is stale. Since AD-33 says "**explicit** read edges", a strict reader treats the list as exhaustive and the diagram edge as illegal. Add `topics` to AD-33.
- **`Explanation` has no `StudentProfile` edge in the ER diagram.** AD-33 requires "FR-24 Explanation cache key includes the Student Profile"; the ER shows only `Question ||--o{ Explanation`. Under the diagram alone, the cache key AD-33 mandates cannot be formed. Add the edge.
- **AD-13's own heading vs the memlog's superseded decision.** The memlog records "MODE IS CARRIED IN THE JWT, **WITH SLIDING EXPIRY**"; AD-13 correctly supersedes sliding expiry with client-clocked/server-capped. The spine is internally consistent here — noted only to confirm the amendment landed cleanly in both the heading and the rule body. It did.
- **AD-4 vs AD-10 wording.** AD-4: "Mastery recompute stays inside the grading transaction (AD-10), **which is now the submit request**." AD-10 was amended to match ("grading (in the foreground submit request, AD-4)"). Cleanly reconciled — no stale "grading job" language survives in AD-10. Good.
- **AD-3's title and AD-4's title overlap substantially** (both are about the queued/foreground split). Not a contradiction — AD-3 fixes the async contract, AD-4 fixes the class assignment — but a reader scanning headings will read them as one decision stated twice. Cosmetic.
- **AD-1 fixes the OpenAI client at 30s / `maxRetries: 2`; AD-7 and AD-33 both override vision to 180s.** Consistent (both name AD-33), but the 30s default now applies only to Grading, Explanation, Legibility and Topic stage 3 — which is precisely the set BLOCKING-3 says has no budget. The pins and the gap are the same issue seen from two sides.

### 8. Are the mermaid diagrams valid, and do they agree with the prose?

**All three parse.** Syntax checked: `graph TD` with quoted labels containing commas, colons and em-dashes; the `subgraph droplet[...]` block with correctly matched `end`; cylinder `[( )]` and hexless node shapes; solid and dotted edges with quoted `|labels|`; `erDiagram` cardinality tokens (`||--o{`, `||--||`, `}o--||`) with quoted relationship labels. No unescaped characters, no unclosed constructs, no undeclared node references.

Agreement with prose:

- **Module dependency graph** — agrees with AD-17 and AD-25 throughout. The `topics ↔ admin` bidirectional pair is called out in the prose immediately below the diagram with a correct justification, which is exactly the right way to handle an apparent violation of the stated arrow rule. Deviations: the `analytics --> topics` edge (see MINOR above).
- **Deployment graph** — agrees with AD-19 point for point: SHA+latest tagging, scp of compose and Caddyfile, `.env` tag rewrite, one-shot migrate before compose up, three named volumes, cron covering both `pgdata` and `uploads`, rollback pointing at the previous SHA, all three containers reporting to Sentry per AD-21. This diagram is doing real work rather than decorating.
- **ER diagram** — the two disagreements above (`SourceTest ||--|| Extraction` cardinality and the missing `Explanation`–`StudentProfile` edge), plus the ownership gap of MATERIAL-1. Otherwise agrees: `UsageTombstone` and `TimezoneEntry` reflect AD-14/AD-15 and AD-27; `AdminUser`/`AdminAudit` reflect AD-25's separate credential store and per-write audit row; `Question }o--|| Topic` and `Topic ||--o{ Mastery` reflect AD-11 and AD-6.

---

## Findings summary

| # | Severity | Finding | Where |
| --- | --- | --- | --- |
| B-1 | Blocking | Student-Mode profile scoping and device binding are silent — no AD says how a student-scoped request is bound to one Student Profile, or where the device's last-bound profile lives. Forks the API surface and permits the cross-profile exposure FR-4 forbids. | AD-13, AD-18, AD-26, AD-32 |
| B-2 | Blocking | Upload countable predicate "Source Tests created in window" charges on request, contradicting AD-15's "abandoned capture consumes nothing" and PRD FR-5/FR-31. Needs the durable-marker construction AD-14 already uses for Generation. | AD-14 vs AD-15, PRD §4.2 |
| B-3 | Blocking | Blocking submit (AD-4) + retry-with-backoff (AD-31) + 30s/`maxRetries: 2` (AD-1/AD-7) do not compose; no batching decision, no foreground retry ceiling, no total submit budget, no stated outcome at the ceiling. | AD-4, AD-31, AD-7 |
| M-1 | Material | `UsageTombstone`, `UncommittedState`, `TimezoneEntry` and invitation codes appear in the ER/ADs with no owning module, breaking AD-17's one-writer invariant at its own foundation. | AD-17, AD-14, AD-25, AD-34, ER |
| M-2 | Material | AD-5's stated justification ("job succeeded, debit did not") is stale — AD-14 removed the debit. Rule survives, reason does not. | AD-5 vs AD-14 |
| M-3 | Material | `extraction` owning "content **on the Source Test**" contradicts the ER's separate `Extraction` entity and risks two writers on one table. Cardinality should be `||--o|`. | AD-17 vs ER |
| M-4 | Material | No API/wire contract convention — error envelope, status mapping, shared-vs-duplicated types between `apps/web` and `apps/api`. | conventions table |
| m-1 | Minor | AD-33's "explicit read edges" list for `analytics` omits `topics`, which the diagram (correctly) has. | AD-33 vs diagram |
| m-2 | Minor | ER lacks the `Explanation`–`StudentProfile` edge that AD-33's cache key requires. | ER vs AD-33 |
| m-3 | Minor | AD-27's effective-dated timezone supersedes the PRD's single mutable field but is not listed in Upstream Supersessions. | Upstream Supersessions |
| m-4 | Minor | AD-34's no-training checklist item has a "named owner" slot with no name; AD-29's Legibility snapshot pin is required but never named. | AD-34, AD-29, Stack |
| m-5 | Minor | Runtime sizing knobs (worker concurrency, job retry counts, pg-boss retention, restart policy/health checks) unstated. | AD-19, AD-33 |
| m-6 | Minor | The second Deferred item (Admin queue de-dup) has no owner and no revisit trigger, unlike the first. | Deferred |

## What is working well

Worth recording so a revision does not sand it off:

- The `Prevents` clauses are *specific*. "Two failure models and two progress mechanisms for the same work", "splitting one concept into two Mastery values", "a directory scan and a table query disagreeing about what exists" — these name the actual divergence rather than gesturing at risk, which is what makes the rules above them checkable.
- AD-15's "stored bytes are never the authority; a row is, from the first byte" folds path-traversal defence, orphan cleanup, retention and deletion into one invariant. That is spine-shaped thinking.
- AD-22's "**the fake must be able to fail**" is the single highest-leverage sentence in the testing section and is the thing most spines omit.
- The Upstream Supersessions section exists at all, states *why* each supersession is not a reversal of the upstream reasoning, and closes with "should be pushed back into the addendum so upstream and this spine do not silently diverge".
- AD-19's "not copied from the reference" list inoculates against the specific mistakes a builder templating from n-electric would otherwise inherit.
- Explicit `[ASSUMPTION]` markers in the Stack table with named resolution paths, rather than silent guesses.

## Recommended disposition

Address B-1, B-2, B-3 and M-1 before handoff — each is a fork a builder will resolve wrongly and invisibly. B-1 and M-1 want one new AD apiece (or an amendment to AD-13 and AD-17 respectively); B-2 and M-2 are bullet-level edits to AD-14 and AD-5; B-3 wants a latency-budget clause in AD-4 or AD-33 mirroring AD-7's vision-timeout reasoning. M-3, m-1 and m-2 are wording and diagram fixes. M-4 and the remaining minors can ride a follow-up pass.
