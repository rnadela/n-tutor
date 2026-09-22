---
title: n-test-reviewer
status: final
created: 2026-08-29
updated: 2026-09-01
---

# Addendum: n-test-reviewer

Depth that the stakeholder supplied, or that the PRD's capability framing pushed out. Belongs to downstream architecture/UX work, not to the PRD narrative.

Not here: the audit trail, override records, and the PRD's own requirements — those live in the PRD or the memlog.

Section map: open architecture items, then stakeholder technology signals, the four model call classes, text call classes, reuse from `n-electric`, rejected and deferred alternatives, Topic taxonomy, UX implementation choices, and FR-35 retention.

## Open for architecture

Five items are unresolved. Each is listed with the section that carries its rationale.

- **The 30-second OpenAI client timeout gap.** The inherited default does not cover Extraction. See *Client provider — adopt as-is*.
- **The Topic normalization matching mechanism.** Three options, ascending cost. See *Topic taxonomy — decided shape, open mechanism*.
- **The FR-35 TTL value.** Unset. See *Server-side retention of uncommitted Parent View work (FR-35)*.
- **The uncommitted-image storage lifecycle.** Same store with a different lifecycle, or a separate expiring one. See *Server-side retention of uncommitted Parent View work (FR-35)*.
- **De-duplication of Admin-queue entries for one Explanation.** A single Explanation has two independent routes into the Admin content-quality queue (PRD FR-30a): the parent's own flag (FR-24a), which reaches the Admin directly, and a student flag (FR-38) the same parent then confirms. A parent who flags an Explanation their child has also flagged produces both. Whether the queue holds one entry carrying both signals, or two entries the operator must recognize as the same item, is unspecified — and so is what happens when the two arrive in either order, or when the parent dismisses one route after confirming the other. The PRD fixes the dispositions and the routing; it does not fix the queue's identity model. An operator working a duplicated queue will suppress or act on one copy and leave the other live.

## Technology signals from the stakeholder

- **OpenAI is a hard dependency.** **Decided:** no provider abstraction layer in v0 (PRD §12.1 Q8, §9.2). Call the SDK directly. The vision-capable model tier is the constraining choice — Extraction (FR-9) reads photographed pages, so a text-only model does not satisfy the flow.
  - Accepted risk: a provider price change, terms change, or sustained outage means a refactor across all four call classes below — the four most load-bearing paths in the product.
  - Cheap hedge that is *not* an abstraction layer: keep the four call classes in four distinct modules rather than inlining OpenAI calls at their use sites. Costs nothing now and localizes the refactor if it ever comes.
- **Reuse the `n-electric` configuration.** Directed by the stakeholder — see *Reuse from `~/projects/n-software/n-electric`*. The sibling project already runs the exact two patterns this product needs: a shared OpenAI client provider, and a production vision call that reads a photographed document into a strict JSON schema.

## Model call classes

These four model-call classes have different cost/latency profiles and must be kept separate in architecture:

1. **Extraction** — vision, multi-image, one call per Source Test. Highest token cost.
2. **Generation** — text, N calls per generation request, conditioned on the Extraction. Batchable.
3. **Grading** — text, per free-text answer. High frequency, low tokens. Strong batching candidate (grade a whole Attempt in one call).
4. **Explanation** — text, on demand, cached. Bounded by FR-24's cache.

Extraction is an intermediate artifact deliberately not exposed as a product surface (FR-9) but is the natural caching boundary: regeneration (FR-11) should reuse a stored Extraction rather than re-reading Page Images, which is both the cost and the latency win.

## Text call classes — pattern from the chatbot

`apps/api/src/messenger/openai.service.ts` shows the `chat.completions` + strict-schema tool-call pattern for text. Generation, Grading, and Explanation follow it. No tool calls needed for this product — those three are schema-constrained completions, not agentic loops.

## Reuse from `~/projects/n-software/n-electric`

Stakeholder direction: adopt n-electric's OpenAI configuration rather than inventing one. Both patterns below are in production there and map cleanly onto this product's call classes.

### Client provider — adopt as-is

**Decided.** `apps/api/src/common/openai/openai-client.service.ts` + `openai-client.module.ts`. A `@Global()` NestJS module exposing one injectable that lazily constructs a singleton `OpenAI` client from `ConfigService`, with `timeout: 30_000` and `maxRetries: 2`, and throws if `OPENAI_API_KEY` is unset — roughly 20 lines. Copy it verbatim.

Consequences for this product:
- Env var name stays **`OPENAI_API_KEY`** — one name across both projects.
- **Open for architecture:** the 30s timeout is tuned for a single chat/vision call. **Extraction across as many as 10 Page Images will exceed it.** Extraction must either run with a per-call timeout override or be chunked; it is the one place the inherited default does not transfer. This is a real gap, not a detail.
- `maxRetries: 2` is at the SDK level and is separate from FR-10's requirement that a failed generation be retryable by the parent without re-uploading.

### Vision extraction — adapt from the warranty-card OCR

`apps/api/src/inventory/vehicles/ocr/ocr.service.ts` is a working "photograph of a document → strict JSON" pipeline. The mechanics transfer to FR-9 almost directly:

| n-electric mechanic | Why it matters here |
|---|---|
| `file-type` sniffing against an `ALLOWED_MIMES` set (jpeg/png/webp/heic/heif/avif) | FR-5's supported-format requirement, already solved. Sniffs bytes rather than trusting the client-declared MIME. |
| `sharp(buffer).rotate()` to honor EXIF orientation, then re-encode to JPEG q85 | **Load-bearing.** A parent photographing a test on a phone produces EXIF-rotated images, and OpenAI vision does not accept HEIC/HEIF — the iPhone default. This is FR-5's "HEIC converted server-side" requirement. |
| `meta.autoOrient?.width` rather than `meta.width` | Documented bug fix in their code: `metadata()` reports pre-rotation dimensions, so extracting with the unswapped width throws `extract_area: bad extract area` on any portrait phone photo. Inherit the fix, not just the approach. |
| `response_format: { type: 'json_schema', strict: true }` with a `const` schema | Extraction (FR-9) must return structured questions, formats, and topics. Strict schema is how you stop the model from returning prose. |
| Prompt instructs "return null for any field you cannot read with confidence — never guess" | Directly the FR-9 requirement that uninterpretable content is recorded as uninterpretable rather than hallucinated. Same instruction, different fields. |
| Per-field self-assessed `confidence: low \| medium \| high` | Reusable as the signal behind FR-8's legibility check and FR-9a's thin-Extraction warning — a page returning mostly low confidence is the page to ask the parent to retake it. |
| Post-hoc `applyFormatChecks` downgrading confidence on values failing a regex | Deterministic validation layered on model output. Analogous use here: a generated Multiple Choice Question whose correct answer is not among its own options is malformed and should be caught in code, not trusted. |
| Errors mapped `BadRequestException` (bad input) vs `BadGatewayException` (provider failed) | Preserves the FR-10/FR-22 distinction between "your photo is unusable, retake it" and "our AI is down, retry later" — which the PRD requires to degrade differently. |

**Does not transfer:** `cropTopHalf` crops to the top 55% (the identifier says half, the behavior is 55% — a name/behavior mismatch inherited from `n-electric`; do not trust the name) because a warranty card's fields are all in the upper half. A test page must be read whole. Drop the crop, keep the rotate-and-normalize.

### Models in production use at n-electric

`gpt-4o` for vision, `gpt-4.1` for the chatbot, `gpt-4.1-mini` for cheaper paths. Grading (FR-22) is the high-frequency low-token class and is the obvious `-mini` candidate; Extraction needs the vision tier. **Open for architecture:** exact model selection — the point of recording these models is that the project already has a cost/quality tiering habit worth copying.

### Wider stack inherited by implication

If this product is built as a sibling to `n-electric`, it inherits a proven setup: Turborepo + pnpm workspaces, NestJS + Prisma + PostgreSQL on the API, Next.js + React + MUI on the web, JWT with argon2 hashing (covers FR-1 and the FR-2 PIN hashing requirement), local-filesystem storage served via static assets (covers Page Image storage and the §5.2 90-day deletion), and Playwright for E2E. Decided constraint (PRD §6), not an open architecture choice.

## Rejected/deferred alternatives with rationale

### Rejected

- **Exact/fuzzy string matching for Fill-in-the-Blank grading.** Rejected in favor of AI semantic grading. Cheaper and deterministic, but harsh on phrasing and notation — "one half" vs "1/2" — which for a 10-year-old reads as the app being wrong. Accepted trade: a small grading-wrongness risk, mitigated by the student dispute flag + parent override (FR-25).
- **Separate student logins.** Rejected. Real usage is a shared family device; a second credential set is friction the child will lose and the parent will support. PIN-gated mode switching achieves the same isolation.
- **Local-only, no accounts.** Rejected. Kills cross-device use and, more importantly, kills longitudinal Mastery history, which is the parent-side value.
- **A single flat usage cap** for all accounts. Replaced by Account Tiers. Same spend ceiling per account, but the tier field is the hook monetization attaches to later without a data model change, and it lets the operator hand out an uncapped Internal tier to themselves and testers — which was needed regardless.
- **Combined credit pool** (one number, upload costs 3 credits, generation costs 1). Rejected in favor of the three separate counters the PRD now carries — Upload, Generation, and Explanation Allowances (PRD §5.3, FR-31). More flexible for the parent and cleaner for pricing later, but introduces a "credits" concept that a v0 with no pricing gives the parent no reason to understand.
- **Provider abstraction layer.** Rejected — see above. Ship on OpenAI directly.
- **Exponential decay for Mastery.** Rejected in favor of a rolling 5-Attempt window. Mathematically nicer and smoother, but the half-life constant would be a guess with zero usage data, and "his last 5 times on this topic" is explainable to a parent in one sentence.
- **Pre-generating Explanations at release for parent review.** Rejected. Multiplies generation cost by question count for explanations most students never open, and the parent review gate already covers the Questions the Explanations explain.
- **Admin-only removal of a bad Explanation.** Rejected in favor of parent suppression (PRD FR-39). Routing every bad Explanation through the operator keeps one consistent judgement over service-wide content, but it leaves the parent — the person sitting next to the child tonight, who already read the thing and already decided it was wrong — unable to do anything about it, and it makes the remedy depend on a single operator who may be asleep. The suppression scope is deliberately the parent's own child, not the service; the service-wide call remains the Admin's (FR-30a).
- **Reversible suppression** (an un-suppress action restoring the original Explanation to the child's screen). Rejected for v0 in favor of the free regeneration FR-39 already grants, which produces a different Explanation rather than the one that was removed. The blast radius of a misclick is one Explanation on one Question, and regeneration is free at every tier — so an undo would buy back very little for the cost of a new requirement plus a second student-facing state change, something reappearing where something was removed, which is harder to explain to a child than either the removal or the replacement. Accepted trade: the parent has no undo, paid for by a confirmation that says in words the action cannot be reversed. *Revisit if support signal shows parents suppressing in error — add reversal to FR-39 rather than softening the confirmation.*
- **Scoring over answered Questions only** (denominator excludes blanks). Rejected in favor of scoring over every Question presented (PRD FR-23). Superficially kinder, and it makes score and Mastery agree, but it changes what a score *means* to a student — a child who answers 6 of 15 and scores 6/6 has been told something untrue about the test they just took — and paper tests do not work that way. It would also require rewriting every worked example and both student-facing journeys in this document, since each carries a denominator. **The memlog flags this as unrecoverable once Attempt records exist:** scores already written cannot be reinterpreted after the fact without silently restating a child's history, so the reasoning is recorded here rather than left to be rediscovered. Mastery is where blanks are excluded, and FR-23's note states why the two denominators differ on purpose.
- **Showing both score figures** (over all presented Questions and over answered Questions only, side by side). Rejected. It is the honest option and it costs nothing to compute, but it puts two numbers and an explanation of their difference into a results header that §7 requires to stay calm and immediately legible to a 10-year-old who has just finished a test. One number is the result; the diagnosis lives in Parent View.
- **Narrowing FR-35 to exclude Page Images** (retain only classification and draft edits across a Parent View expiry). Rejected. It is by far the smallest data footprint and would have removed the uncommitted-image storage question entirely — but it defeats the purpose of the requirement, because **capture is the step most likely to be interrupted**: it is the longest, it happens standing over a paper with a child nearby, and it is the one where the parent has physical work they cannot cheaply redo. Retaining everything except the photographs would lose exactly what a silent expiry is most likely to take.
- **Basic scorecard analytics** (per-test score + subject average). Rejected in favor of Topic Mastery breakdown. Costs a Topic-tagging requirement on every generated Question (FR-9, FR-10) but is the difference between "he got 11/15" and "he does not understand remainders."

### Deferred

- **Self-serve tier upgrade requests.** Deferred. Needs approval UI plus a queue someone actually watches. Admin assigns by hand in v0.
- **Notifications on student completion.** Deferred out of v0 by the stakeholder. Flagged in PRD §9.2 as the likeliest first post-launch request.
- **Native mobile apps.** Deferred to v2+. Better camera/scan UX, but app-store friction and two codebases at v0 scale is not justified.

## Topic taxonomy — decided shape, open mechanism

**Decided** (PRD FR-26a): free-form emission at generation, plus a normalization pass mapping emitted Topics onto a per-Subject canonical set that grows as unmatched Topics arrive. Generation stays unconstrained; Mastery stays comparable.

Why the alternatives lost. Pure free-form is trivial to implement, and it fragments: "fractions", "equivalent fractions", "comparing fractions", and "fraction equivalence" become four Topics with four Mastery values, and the Analytics dashboard (FR-28) degrades into noise as history accumulates — slowly and invisibly, which is the worst failure profile. A controlled vocabulary per Subject × Grade Level fixes Mastery but requires Admin curation that the Admin surface does not support (FR-30), and breaks the moment a parent uploads a paper covering an uncurated Topic.

**Open for architecture:** the matching mechanism itself. Options, roughly in ascending cost:
- Normalized string match (lowercase, singularize, strip stopwords) — cheap, catches the "equivalent fraction"/"equivalent fractions" class of duplicate, misses "fraction equivalence".
- Embedding similarity against existing canonical Topics with a threshold — catches semantic near-duplicates, needs an embedding store and a threshold to tune.
- A model call that picks from the existing canonical list or declares a new Topic — most accurate, adds a call per generated Question.

Two constraints on the choice: the canonical set is small and per-Subject, so even the expensive option operates over tens of candidates, not thousands. Mis-merging two genuinely distinct Topics is worse than failing to merge two duplicates — a false merge produces a confidently wrong Mastery number, while a missed merge produces two honest ones.

## UX implementation choices lifted out of the PRD

These are rendering choices, not capabilities. The PRD's capability statements bind; these do not.

| Where | Capability the PRD keeps | Implementation choice recorded here |
|---|---|---|
| FR-5 | Page Images are treated identically however they were added | No shot-versus-selected affordance anywhere in the capture UI |
| FR-6 | Page order is explicit and visible before submission | Render the pages as a reorderable strip of **numbered thumbnails**, the number carrying the position rather than layout order alone |
| FR-10 | Counts above the remaining Generation Allowance stay visible with the reason stated | Render them as disabled options rather than hiding them; reason phrased as used-of-limit |
| FR-15 | The timer is configurable before release and never after | Put the control in Draft review beside the questions it applies to, rather than in a separate settings surface or a post-release step |
| FR-15 | The duration is pre-filled from question count and editable | Express and enter it in whole minutes |
| FR-15 | Warnings at 5 min/1 min/20 s that never escalate | Identical treatment for all three — same wording pattern, same visual weight, same audibility |
| FR-16 | Every Practice Test carries its Subject and state with it in one flat list | Put both **as labels on the card itself** rather than in section headers or a filter control |
| FR-16 | Every *completed* Practice Test stays reachable indefinitely under the current decision | No "show older" control, no **progressive-disclosure** control, no archive, no age-out. If the recorded remedy is ever taken, it is a bounded tail — unstarted plus the last 3–5 completed — never a date cutoff |
| FR-17 | Fill-in-the-Blank presents an answer input positioned at the blank | Render it as an **inline input at the blank position** within the question text, not as a separate field below it |
| FR-17 | Short Answer accepts free text of more than one line | Render it as a **multi-line free text field** |
| FR-17 | Any Question is reachable directly via a question map showing progress state | An openable overlay of per-Question cells on narrow viewports; a persistently visible rail beside the Question where the measure leaves room |
| FR-20 | First, latest, and Attempt count shown together with the first marked as counting | A single inline summary line, for example `First 11/15 · Latest 14/15 · 3 attempts`. UX chooses the separator and field order |
| FR-22 | The grading rationale is readable on the Question's own row | Collapsed by default, expandable in place |
| FR-22 | The partial-score header names the excluded Questions | For example, "11/14 graded — 1 question could not be graded yet" |
| FR-25 | Prior and adjusted score both visible as a change | For example, "11/15 → 12/15, adjusted by parent" |
| FR-28 | A profile-level score trend over the last 5 qualifying Attempts | Draw it as a sparkline |
| FR-28 | Mastery never shown without its unanswered count | For example, "division with remainders — 40%, 3 unanswered" |
| FR-31 | At-cap message names tier, usage, and reset date | For example, "You've used 2 of 2 practice tests this month on the Free tier. Resets 1 October." |

### Accessibility rendering (§10)

| Capability the PRD keeps | Implementation choice recorded here |
|---|---|
| The timer is exposed as a timer | `role="timer"` + `aria-label` |
| The timer announces only at the three thresholds | `aria-live` raised only at thresholds |
| Auto-submit is announced and interrupting | `role="alert"` on auto-submit, with focus moved to the results heading |
| Fractions are exposed as one spoken value | `role="img"` plus a text alternative on each rendered fraction |
| Question map cells are real buttons, individually announced with their state | `<button>` per Question carrying its own `Answered` / `Not answered` state string, a visible focus ring, and an on-screen legend — never fill or color alone |
| The student's current position in the map is indicated | `aria-current` on the active Question's cell |

## Server-side retention of uncommitted Parent View work (FR-35)

**Decided.** PRD FR-35 states four properties as requirements: server-side only keyed to the Parent Account, restored strictly after PIN re-entry, cross-profile fetch rejected server-side, and a TTL. The mechanism is an architecture call.

- **Open for architecture:** the TTL value is unset and must be chosen in architecture. It needs to be long enough that a parent interrupted mid-capture in a kitchen can come back the next evening, and short enough that abandoned photographs of a child's schoolwork do not linger. It is the only clock that reaches this class of data — FR-32's 90-day clock starts at Source Test upload, which for an abandoned capture never happened.
- **Open for architecture:** uncommitted Page Images are the bulky part of this state and share a storage problem with committed ones (local filesystem, §6). Whether they land in the same store with a different lifecycle, or a separate expiring one, is an architecture call.
- **Decided.** FR-35 excludes the FR-25 AI grading rationale from retained state and re-reads it from the Attempt on restoration. The cheap implementation is to retain a reference to the Attempt and Question rather than the rationale text.
