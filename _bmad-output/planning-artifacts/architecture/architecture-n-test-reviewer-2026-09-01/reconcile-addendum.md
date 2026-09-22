---
title: Addendum → Spine reconciliation
type: architecture-review
created: 2026-09-02
sources:
  - _bmad-output/planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md
---

# Reconciliation: PRD addendum → ARCHITECTURE-SPINE

**Verdict.** The spine picks up every item the addendum's "Open for architecture" index handed forward — that axis is clean. What it fails to pick up sits in the other three axes: one live contradiction against a rejected alternative, one undeclared reversal of an inherited pattern, two load-bearing libraries dropped without trace, and several third-party/infra choices that appear in the spine with no upstream sanction.

---

## 1. Open for architecture — walked item by item

The addendum names five, plus a sixth flagged inline outside the index.

| # | Addendum item | Spine disposition | Status |
|---|---|---|---|
| 1 | 30-second OpenAI client timeout gap (does not cover Extraction) | **AD-7** — vision path overrides to 120–180s per request; explicitly reasons about `maxRetries: 2` multiplying the budget | Decided |
| 2 | Topic normalization matching mechanism (3 options, ascending cost) | **AD-11** — all three options adopted as a cascade behind one `normalize(label, subjectId)` interface; pgvector explicitly excluded | Decided |
| 3 | FR-35 TTL value (unset) | **AD-16** — 72 hours from row creation, not extended by activity | Decided |
| 4 | Uncommitted-image storage lifecycle (same store w/ different lifecycle, or a separate expiring one) | **AD-15 + AD-16** — same store, one row treatment, one lifecycle; expiry deletes outright rather than husking | Decided |
| 5 | De-duplication of Admin-queue entries for one Explanation (FR-24a vs FR-38 → FR-30a) | Spine **Deferred**, last bullet, restated faithfully including the identity-model framing | Explicitly deferred |
| 6 | Exact model selection (flagged inline under *Models in production use at n-electric*, not in the index of five) | **AD-8** — `gpt-5.6-sol` / `-terra` / `-luna`, snapshot ids in configuration; preserves the cost-tiering habit the addendum asked to copy | Decided |

**Nothing is neither-decided-nor-deferred.** Item 4's answer is implicit rather than stated in the addendum's own either/or vocabulary — AD-16 never says "the same store", it just applies one uniform row treatment — but the decision is unambiguous on reading. Item 5 is the only true carry-forward, and it is carried forward correctly.

Two minor observations on this axis:

- **AD-16 vs the addendum's stated purpose for the TTL.** The addendum asks for a TTL "long enough that a parent interrupted mid-capture in a kitchen can come back the next evening." AD-16 chose 72h *from row creation*, explicitly not extended by activity. A parent who captures over two sessions on consecutive evenings gets less than the full window on the second. The choice is defensible and stated; the reasoning the addendum supplied is not echoed, so a later reader cannot tell whether the "next evening" constraint was weighed. Low severity, documentation-only.
- **AD-16's merge of FR-35 restorable state with the orphan sweep** is a genuine architectural improvement over what the addendum contemplated (it framed these as two questions). Worth noting as value added, not a gap.

---

## 2. Inherited stack — addendum vs spine Stack table

### 2a. Sanctioned upstream, present in spine ✅

Turborepo + pnpm workspaces · NestJS + Prisma + PostgreSQL · Next.js + React + MUI · Playwright E2E · JWT + argon2 (FR-1 password and FR-2 PIN) · local-filesystem Page Image storage · `OPENAI_API_KEY` env name · `@Global()` client module, 30s default, `maxRetries: 2` · no provider abstraction layer (see §3, contested) · OpenAI as hard dependency.

All present, in AD-1 and the Stack table.

### 2b. Named in the addendum, ABSENT from the spine ❌

Both are from the *Vision extraction — adapt from the warranty-card OCR* table, and both were marked as directly transferring to FR-5/FR-9.

**`sharp` — missing entirely.** The addendum calls this "**Load-bearing**" in bold. Three separate obligations ride on it:
1. HEIC/HEIF conversion. The iPhone default format, and **OpenAI vision does not accept it**. This is FR-5's "HEIC converted server-side" requirement.
2. `.rotate()` to honor EXIF orientation — a parent photographing a test with a phone produces rotated images.
3. The inherited bug fix: use `meta.autoOrient?.width`, not `meta.width`, because `metadata()` reports pre-rotation dimensions and the unswapped width throws `extract_area: bad extract area` on any portrait phone photo. The addendum is explicit: "Inherit the fix, not just the approach."

The spine has no image-preprocessing AD, no `sharp` entry in the Stack table, and no mention of format normalization anywhere. AD-15 governs the *row* for a Page Image and the path derivation, and stops at the byte boundary. Read literally, the spine describes a system that writes an iPhone HEIC to disk and hands it to a vision model that will refuse it.

**`file-type` — missing entirely.** The addendum specifies byte-sniffing against an `ALLOWED_MIMES` set (jpeg/png/webp/heic/heif/avif) "rather than trusting the client-declared MIME," and ties it to FR-5's supported-format requirement. The spine's only upload-side control is AD-15's path derivation, which it correctly identifies as the path-traversal control — but that is a different control. Content-type validation on untrusted uploaded bytes has no owner in the spine.

Both belong in a new AD (or an extension of AD-15) covering the ingest pipeline: sniff → normalize/rotate → re-encode → write. Note also the addendum's negative instruction that must survive into that AD: **drop `cropTopHalf`** (which despite its name crops to 55%) — a test page must be read whole.

### 2c. Present in the spine, NOT sanctioned upstream ⚠️

Architecture is permitted to introduce technology the PRD never named; the concern is unmarked provenance, especially where an AD carries an `[ADOPTED]` tag implying inheritance.

| Spine item | Where | Upstream sanction |
|---|---|---|
| **Sentry** (AD-21, Stack table) | Third-party error tracking, all three containers | None. Neither the PRD addendum's inherited stack nor the n-electric reuse section mentions error tracking. This introduces a **third-party processor receiving data from a product handling children's schoolwork**. AD-21's mandatory-hardening rule (`sendDefaultPii: false`, body/local/cookie capture off, `beforeSend` denylist) is exactly the right response and is well specified — but the *decision to send anything off-box at all* is new here and should be flagged as an architecture-originated choice, not presented as settled. |
| **DigitalOcean Droplet, Caddy, GHCR, GitHub Actions** (AD-19) | Whole operational envelope | AD-19 is tagged **`[ADOPTED]`** and attributed to "the n-electric deploy pattern." The addendum's *Wider stack inherited by implication* section — the only place it records what n-electric hands down — lists app-layer technology only and **says nothing about deployment**. The pattern may well exist in n-electric, but the addendum does not sanction it, so the `[ADOPTED]` tag overstates its provenance. Retag as a decision made in this run, or cite the n-electric artifact directly. |
| **pg-boss 12.29.0** | Stack table | AD-5 sanctions "Postgres-backed, no new datastore or broker service," which pg-boss satisfies (it is a library over the app database, not a broker). Consistent — but see the inconsistency below. |
| **`@nestjs/throttler`** (AD-23) | Rate limiting | Reasonable and unsanctioned-but-uncontroversial. Missing from the Stack table, unlike every other pinned dependency. |
| **`text-embedding-3-small`** | AD-11 stage 2, Stack table | Follows directly from the addendum's embedding-similarity option. Sanctioned by implication. ✅ |

### 2d. Internal stack inconsistency

**pg-boss is pinned in the Stack table while the spine's Deferred section says the scheduling mechanism is unbound.** Deferred bullet 2 reads: "Scheduling mechanism for FR-32 expiry and the FR-35/orphan TTL sweep — served by the queue itself or by exactly one named companion (AD-5); which, is not yet bound." pg-boss ships cron/scheduled-job support. Either the deferral is already resolved by the pinned dependency, or the pin is premature. One of the two statements should move.

**PostgreSQL "not pinned in this run"** appears both in the Stack table and as a Deferred bullet — duplicated, harmless, but the Stack table entry reads as an oversight rather than a decision.

---

## 3. Rejected alternatives — resurrection check

Walked every entry in the addendum's Rejected and Deferred lists against all 23 ADs.

### CONTRADICTION — the provider abstraction layer

The addendum rejects it twice, and prescribes a specific replacement:

> **Provider abstraction layer.** Rejected — see above. Ship on OpenAI directly.

> Cheap hedge that is *not* an abstraction layer: **keep the four call classes in four distinct modules** rather than inlining OpenAI calls at their use sites. Costs nothing now and localizes the refactor if it ever comes.

Also: "These four model-call classes have different cost/latency profiles and **must be kept separate in architecture**."

**AD-17 does the opposite of the prescribed hedge:**

> **All AI calls are centralized in one `ai` module**, which owns the OpenAI client, the pinned model snapshots, Responses-API/`zodTextFormat` plumbing, retry and timeout policy, and token/cost accounting. Domain modules call it with a typed request.

A single module that every domain calls **with a typed request**, owning the client and the retry/timeout policy, is structurally a provider abstraction layer. It is precisely the seam a provider swap would be performed at — which AD-22 then confirms by making it "the only test seam for nondeterminism" that "every test double swaps."

This also sets **AD-1 against AD-17 inside the spine**: AD-1 states "no provider abstraction layer" as an inherited constraint, and AD-17 builds one four ADs later without acknowledging the tension.

Two further consequences of the merge:
- The four call classes are **not** kept in four distinct modules. They are distinguished only as an enum value in AD-20's AiCall `call class` column and as separate model pins in AD-8. The addendum's stated benefit — localizing a refactor across "the four most load-bearing paths in the product" — is not realized by a single module with four branches.
- AD-17's carve-out ("prompt text stays in the domain module") preserves *part* of the separation, which suggests the tension was felt but not named.

**Recommended resolution.** Do not necessarily reverse AD-17 — centralizing the client, model pins, cost accounting, and the test seam is defensible and AD-22 depends on it. But the spine must either (a) amend AD-1 to state that the rejection covered a *multi-provider* abstraction (interchangeable providers), not an internal call-plumbing module, and say so explicitly; or (b) split the `ai` module's public surface into four call-class services over one shared client, honoring the addendum's hedge at low cost. Option (b) costs almost nothing and satisfies both documents. Leaving AD-1 and AD-17 as written leaves a builder unable to tell which rule binds.

### Clean — every other rejected alternative holds

| Rejected in addendum | Spine position | OK |
|---|---|---|
| Exact/fuzzy string matching for Fill-in-the-Blank grading | AD-4/AD-6 keep AI grading; the only string matching in the spine is AD-11 stage 1, which is **Topic normalization, not grading** — a different subject, no resurrection | ✅ |
| Separate student logins | AD-2: "Student Profiles have no credentials"; AD-13/AD-18 PIN-gated mode | ✅ |
| Local-only, no accounts | AD-2, AD-18, whole persistence model | ✅ |
| Single flat usage cap | AD-14 keeps tiers (Free tier named explicitly) | ✅ |
| Combined credit pool | AD-14 keeps three separate allowances derived independently | ✅ |
| Exponential decay for Mastery | AD-6: rolling window of 5 most recent qualifying Attempts | ✅ |
| Pre-generating Explanations at release | AD-4: Explanation is foreground and on-demand; AD-14 counts per generated Explanation | ✅ |
| Admin-only removal of a bad Explanation | AD-14 preserves parent suppression (FR-39); AD-12 keeps the Admin queue for the service-wide call | ✅ |
| Reversible suppression | AD-14 encodes suppression-consumes + free-regeneration-flagged, with no un-suppress path | ✅ |
| Scoring over answered Questions only | AD-6 excludes unanswered/ungraded from the **Mastery** denominator only, exactly as FR-26 requires; no AD touches the FR-23 score denominator | ✅ |
| Showing both score figures | Not resurrected | ✅ |
| Narrowing FR-35 to exclude Page Images | AD-16 applies the TTL "whether or not it carries bytes" — images are retained | ✅ |
| Basic scorecard analytics | AD-6/AD-11/AD-12 build the full Topic Mastery path | ✅ |
| *Deferred:* self-serve tier upgrade, completion notifications, native mobile | None appear in the spine | ✅ |

### Adjacent — an inherited pattern discarded without declaration

Not a rejected-alternative resurrection, but the same class of problem in the opposite direction. The addendum records the n-electric text pattern as the one to follow:

> `apps/api/src/messenger/openai.service.ts` shows the `chat.completions` + strict-schema tool-call pattern for text. **Generation, Grading, and Explanation follow it.**

and, for vision, `response_format: { type: 'json_schema', strict: true }`.

**AD-9 explicitly forbids both:** "use the **Responses API with Structured Outputs**... **Never Chat Completions `response_format`**, never legacy `json_object`."

AD-9 is almost certainly the better call on SDK 7.8.0, and the addendum's real requirement — strict schema, no prose — is fully satisfied. But it reverses a named inherited decision silently. AD-9 should carry one line stating that it supersedes the inherited `chat.completions` pattern and why, so that a builder reading n-electric's `openai.service.ts` as a template does not follow it into a forbidden API. Note also that AD-1 still describes the inherited client config as reused verbatim, and that config is the chat-completions-era client — worth confirming nothing in it conflicts with Responses-API usage.

---

## 4. UX implementation decisions — architectural constraints not carried

Most of the table is genuinely rendering-only and correctly absent from the spine. Four entries carry a constraint that reaches past rendering.

**a. FR-15 — "the timer is configurable before release and never after."** This is an immutability invariant on a released Practice Test, not a rendering choice: the API must refuse a timer change once the test is released, regardless of what the UI shows. The spine has no release-state lock. AD-2 enumerates the four grade states but nothing about Practice Test lifecycle states, and AD-14 mentions "has ever reached draft" as a durable marker for charging without extending it to a released-state write barrier. `practicetest` owns the entity (AD-17), so the rule has an owner — it just has no rule. **Recommend:** add the released-state write barrier to AD-17's ownership rule or to the `practicetest` cluster description.

**b. FR-16 — "no age-out, no archive, no progressive disclosure; every completed Practice Test reachable indefinitely."** An unbounded, unpaginated, growing list is a load characteristic, and the recorded fallback remedy is explicitly *not* a date cutoff but "a bounded tail — unstarted plus the last 3–5 completed." The spine carries no read-path or pagination convention, and AD-14's "chargeable artifacts are never hard-deleted" guarantees the underlying set only grows. Low severity at v0 scale; worth a line in Consistency Conventions so the remedy, if taken, is taken in the sanctioned shape.

**c. FR-22 — "the partial-score header names the excluded Questions" (e.g. "11/14 graded — 1 question could not be graded yet").** Requires the ungraded set to be individually enumerable at read time, not merely counted. AD-4 establishes `ungraded` as the queue-pending state, which supports this, and AD-2 carries `ungraded` as a stored grade state — so it is covered, but only implicitly. No action needed beyond awareness.

**d. FR-31 — "at-cap message names tier, usage, and reset date."** The reset date is a *forward* boundary. AD-14 deliberately removes any reset job and computes period windows from the account's stored IANA timezone, so the next boundary is derivable — but AD-14's rule text only describes computing the *current* window for counting. The `allowance` module must also expose the next boundary as a read. Minor; recommend one clause in AD-14.

**e. Accessibility rendering table (§10).** All six entries (`role="timer"`, threshold-gated `aria-live`, `role="alert"` on auto-submit with focus move, `role="img"` + text alternative on fractions, per-Question `<button>` with state string and legend, `aria-current`) are pure client-side rendering. Correctly absent from the spine — but note that the fraction requirement implies **fractions are a structured value in the Question payload, not free text**, otherwise a text alternative cannot be generated. The spine's `extraction`/`practicetest` clusters say nothing about Question content shape. AD-9's Zod schemas are where this would land. Flagging as a shape constraint worth confirming when the Extraction schema is authored.

---

## 5. Additional transferable mechanics named in the addendum with no home in the spine

These are from the same n-electric vision table as `sharp` and `file-type` (§2b), each explicitly mapped to an FR by the addendum, and none appears in any AD.

1. **Per-field self-assessed `confidence: low | medium | high`.** The addendum designates this "the signal behind FR-8's legibility check and FR-9a's thin-Extraction warning — a page returning mostly low confidence is the page to ask the parent to retake it." FR-8 and FR-9a are both in the spine's `binds` list, and the Capability Map routes §4.2/§4.3 to `sourcetest`/`extraction`, but no AD carries a confidence field or a retake trigger. Without it, FR-8 and FR-9a have no mechanism.

2. **Deterministic post-hoc validation of model output** (n-electric's `applyFormatChecks`). The addendum gives the exact analogue: "a generated Multiple Choice Question whose correct answer is not among its own options is malformed and **should be caught in code, not trusted**." AD-9 guarantees the response *parses* against a schema; it does not guarantee semantic validity. Nothing in the spine owns post-generation validation, and AD-22's fake-must-be-able-to-fail rule lists "schema-invalid responses" but not schema-valid-yet-malformed ones.

3. **Provider error taxonomy — `BadRequestException` (bad input) vs `BadGatewayException` (provider failed).** The addendum ties this directly to a PRD requirement: it "preserves the FR-10/FR-22 distinction between 'your photo is unusable, retake it' and 'our AI is down, retry later' — which the PRD requires to degrade differently." AD-17 gives the `ai` module "retry and timeout policy" but no error classification, and AD-4's retry rules (foreground manual retry for Explanation, re-enqueue for grading) do not distinguish a user-fixable failure from a provider failure — re-enqueueing an unusable photo retries it forever. This one has a functional consequence, not just a documentation one.

4. **The `null`-not-guess prompt instruction** ("return null for any field you cannot read with confidence — never guess"), mapped by the addendum to FR-9's requirement that uninterpretable content is recorded as uninterpretable rather than hallucinated. AD-17's carve-out puts prompt text in the domain module, so this has a home by convention — but as an FR-9 *requirement* rather than a prompt preference, it deserves to be stated where FR-9's mechanism is decided.

---

## Summary of recommended spine changes

| Priority | Change |
|---|---|
| P0 | Resolve AD-1 vs AD-17 on the provider abstraction layer — either restate AD-1's rejection as multi-provider-only, or split `ai` into four call-class services over one shared client (honors the addendum's hedge, preserves AD-22's seam). |
| P0 | New AD (or AD-15 extension) for the image ingest pipeline: `file-type` byte-sniffing against `ALLOWED_MIMES`, `sharp` rotate + HEIC→JPEG q85 re-encode, the `meta.autoOrient?.width` fix, and the explicit instruction to drop `cropTopHalf`. Add `sharp` and `file-type` to the Stack table. |
| P1 | Add provider error taxonomy (bad-input vs provider-failed) to AD-17 or AD-4, so FR-10/FR-22 degrade differently and unusable input is not retried forever. |
| P1 | Add per-field confidence to the Extraction schema and name it as the FR-8 / FR-9a mechanism. |
| P1 | Add deterministic post-generation validation (schema-valid-but-malformed, e.g. MCQ correct answer absent from its options). |
| P2 | Add one line to AD-9 declaring that it supersedes the inherited `chat.completions` + `response_format` pattern, so n-electric's `openai.service.ts` is not followed as a template. |
| P2 | Retag AD-19 — drop `[ADOPTED]` or cite the n-electric deploy artifact directly; the addendum does not sanction the deployment stack. Mark Sentry (AD-21) as an architecture-originated third-party choice. |
| P2 | Resolve pg-boss pinned-in-Stack vs scheduling-mechanism-Deferred. |
| P2 | Add the FR-15 released-state write barrier (timer immutable after release) to `practicetest` ownership. |
| P3 | AD-14: state that `allowance` exposes the next period boundary (FR-31 reset date), not only the current window. |
| P3 | Confirm fractions are a structured value in the Extraction/Question Zod schema (FR §10 accessibility text alternative depends on it). |
| P3 | Note the FR-16 unbounded-list read path and its sanctioned remedy shape in Consistency Conventions. |
