# Addendum: n-test-reviewer

Depth the stakeholder supplied or that the PRD's capability framing pushed out. Belongs to downstream architecture / UX work, not to the PRD narrative.

## Technology signals from the stakeholder

- **OpenAI is a hard dependency.** Decided: no provider abstraction layer in v0 (PRD §12.1 Q8, §9.2). Call the SDK directly. The vision-capable model tier is the constraining choice — Extraction (FR-9) reads photographed pages, so a text-only model does not satisfy the flow.
  - Accepted risk: a provider price change, terms change, or sustained outage means a refactor across all four call classes below. These are the four most load-bearing paths in the product.
  - Cheap hedge that is *not* an abstraction layer: keep the four call classes in four distinct modules rather than inlining OpenAI calls at their use sites. Costs nothing now and localizes the refactor if it ever comes.
- **Reuse the `n-electric` configuration.** Directed by the stakeholder — see the next section. The sibling project already runs the exact two patterns this product needs: a shared OpenAI client provider, and a production vision call that reads a photographed document into a strict JSON schema.

## Reuse from `~/projects/n-software/n-electric`

Stakeholder direction: adopt n-electric's OpenAI configuration rather than inventing one. Both patterns below are in production there and map cleanly onto this product's call classes.

### Client provider — adopt as-is

`apps/api/src/common/openai/openai-client.service.ts` + `openai-client.module.ts`. A `@Global()` NestJS module exposing one injectable that lazily constructs a singleton `OpenAI` client from `ConfigService`, with `timeout: 30_000` and `maxRetries: 2`, and throws if `OPENAI_API_KEY` is unset. Roughly 20 lines. Copy it verbatim.

Consequences for this product:
- Env var name stays **`OPENAI_API_KEY`** — one name across both projects.
- The 30s timeout is tuned for a single chat/vision call. **Extraction over up to 10 Page Images will exceed it.** Extraction must either run with a per-call timeout override or be chunked; it is the one place the inherited default does not transfer. This is a real gap, not a detail.
- `maxRetries: 2` is at the SDK level and is separate from FR-10's requirement that a failed generation be retryable by the parent without re-uploading.

### Vision extraction — adapt from the warranty-card OCR

`apps/api/src/inventory/vehicles/ocr/ocr.service.ts` is a working "photograph of a document → strict JSON" pipeline. The mechanics transfer to FR-9 almost directly:

| n-electric mechanic | Why it matters here |
|---|---|
| `file-type` sniffing against an `ALLOWED_MIMES` set (jpeg/png/webp/heic/heif/avif) | FR-5's supported-format requirement, already solved. Sniffs bytes rather than trusting the client-declared MIME. |
| `sharp(buffer).rotate()` to honor EXIF orientation, then re-encode to JPEG q85 | **Load-bearing.** A parent photographing a test on a phone produces EXIF-rotated images, and OpenAI vision does not accept HEIC/HEIF — the iPhone default. This is FR-5's "HEIC converted server-side" requirement. |
| `meta.autoOrient?.width` rather than `meta.width` | Documented bug fix in their code: `metadata()` reports pre-rotation dimensions, so extracting with the unswapped width throws `extract_area: bad extract area` on any portrait phone photo. Inherit the fix, not just the approach. |
| `response_format: { type: 'json_schema', strict: true }` with a `const` schema | Extraction (FR-9) must return structured questions, formats, and topics. Strict schema is how you stop the model returning prose. |
| Prompt instructs "return null for any field you cannot read with confidence — never guess" | Directly the FR-9 requirement that uninterpretable content is recorded as uninterpretable rather than hallucinated. Same instruction, different fields. |
| Per-field self-assessed `confidence: low \| medium \| high` | Reusable as the signal behind FR-8's legibility check and FR-9a's thin-Extraction warning — a page returning mostly low confidence is the page to ask the parent to retake. |
| Post-hoc `applyFormatChecks` downgrading confidence on values failing a regex | Deterministic validation layered on model output. Analogous use here: a generated Multiple Choice Question whose correct answer is not among its own options is malformed and should be caught in code, not trusted. |
| Errors mapped `BadRequestException` (bad input) vs `BadGatewayException` (provider failed) | Preserves the FR-10 / FR-22 distinction between "your photo is unusable, retake it" and "our AI is down, retry later" — which the PRD requires to degrade differently. |

**Does not transfer:** `cropTopHalf` crops to the top 55% because a warranty card's fields are all in the upper half. A test page must be read whole. Drop the crop, keep the rotate-and-normalize.

### Text call classes — pattern from the chatbot

`apps/api/src/messenger/openai.service.ts` shows the `chat.completions` + strict-schema tool-call pattern for text. Generation, grading, and Explanation follow it. No tool calls needed for this product — those three are schema-constrained completions, not agentic loops.

### Models in production use at n-electric

`gpt-4o` for vision, `gpt-4.1` for the chatbot, `gpt-4.1-mini` for cheaper paths. Grading (FR-22) is the high-frequency low-token class and is the obvious `-mini` candidate; Extraction needs the vision tier. Exact model selection is an architecture decision — the point of recording these is that the project already has a cost/quality tiering habit worth copying.

### Wider stack inherited by implication

If this product is built as a sibling to n-electric it inherits a proven setup: Turborepo + pnpm workspaces, NestJS + Prisma + PostgreSQL on the API, Next.js + React + MUI on the web, JWT with argon2 hashing (covers FR-1 and the FR-2 PIN hashing requirement), local-filesystem storage served via static assets (covers Page Image storage and the §5.2 90-day deletion), and Playwright for E2E. **Confirmed by the stakeholder** — this is a decided constraint, recorded in PRD §6, not an open architecture choice.
- Distinct model-call classes with different cost/latency profiles, worth separating in architecture:
  1. **Extraction** — vision, multi-image, one call per Source Test. Highest token cost.
  2. **Generation** — text, N calls per generation request, conditioned on the Extraction. Batchable.
  3. **Grading** — text, per free-text answer. High frequency, low tokens. Strong batching candidate (grade a whole Attempt in one call).
  4. **Explanation** — text, on demand, cached. Bounded by FR-24's cache.
- Extraction is an intermediate artifact deliberately not exposed as a product surface (FR-9) but is the natural caching boundary: regeneration (FR-11) should reuse a stored Extraction rather than re-reading Page Images, which is both the cost and the latency win.

## Rejected / deferred alternatives with rationale

- **Exact/fuzzy string matching for Fill-in-the-Blank grading.** Rejected in favor of AI semantic grading. Cheaper and deterministic, but harsh on phrasing and notation — "one half" vs "1/2" — which for a 10-year-old reads as the app being wrong. Accepted trade: a small grading-wrongness risk, mitigated by the student dispute flag + parent override (FR-25).
- **Separate student logins.** Rejected. Real usage is a shared family device; a second credential set is friction the child will lose and the parent will support. PIN-gated mode switching achieves the same isolation.
- **Local-only, no accounts.** Rejected. Kills cross-device use and, more importantly, kills longitudinal Mastery history, which is the parent-side value.
- **A single flat usage cap** for all accounts. Replaced by Account Tiers. Same spend ceiling per account, but the tier field is the hook monetization attaches to later without a data model change, and it lets the operator hand out an uncapped Internal tier to themselves and testers — which was needed regardless.
- **Combined credit pool** (one number, upload costs 3 credits, generation costs 1). Rejected in favor of two separate counters. More flexible for the parent and cleaner for pricing later, but introduces a "credits" concept to explain in a v0 that has no pricing to explain it with.
- **Self-serve tier upgrade requests.** Deferred. Needs approval UI plus a queue someone actually watches. Admin assigns by hand in v0.
- **Provider abstraction layer.** Rejected — see above. Ship on OpenAI directly.
- **Exponential decay for Mastery.** Rejected in favor of a rolling 5-Attempt window. Mathematically nicer and smoother, but the half-life constant would be a guess with zero usage data, and "his last 5 times on this topic" is explainable to a parent in one sentence.
- **Pre-generating Explanations at release for parent review.** Rejected. Multiplies generation cost by question count for explanations most students never open, and the parent review gate already covers the Questions the Explanations explain.
- **Basic scorecard analytics** (per-test score + subject average). Rejected in favor of topic mastery breakdown. Costs a topic-tagging requirement on every generated Question (FR-9, FR-10) but is the difference between "he got 11/15" and "he does not understand remainders."
- **Notifications on student completion.** Deferred out of v0 by the stakeholder. Flagged in PRD §9.2 as the likeliest first post-launch request.
- **Native mobile apps.** Deferred to v2+. Better camera/scan UX, but app-store friction and two codebases at v0 scale is not justified.

## Topic taxonomy — decided shape, open mechanism

**Decided** (PRD FR-26a): free-form emission at generation, plus a normalization pass mapping emitted Topics onto a per-Subject canonical set that grows as unmatched Topics arrive. Generation stays unconstrained; Mastery stays comparable.

Why the alternatives lost. Pure free-form is trivial to implement and fragments: "fractions", "equivalent fractions", "comparing fractions", and "fraction equivalence" become four Topics with four Mastery values, and the Analytics dashboard (FR-28) degrades into noise as history accumulates — slowly and invisibly, which is the worst failure profile. A controlled vocabulary per Subject × Grade Level fixes Mastery but requires Admin curation the Admin surface does not have (FR-30), and breaks the moment a parent uploads a paper covering an uncurated topic.

**Open for architecture:** the matching mechanism itself. Options, roughly in ascending cost:
- Normalized string match (lowercase, singularize, strip stopwords) — cheap, catches the "equivalent fraction" / "equivalent fractions" class of duplicate, misses "fraction equivalence".
- Embedding similarity against existing canonical Topics with a threshold — catches semantic near-duplicates, needs an embedding store and a threshold to tune.
- A model call that picks from the existing canonical list or declares a new Topic — most accurate, adds a call per generated Question.

Worth noting: the canonical set is small and per-Subject, so even the expensive option operates over tens of candidates, not thousands. Mis-merging two genuinely distinct Topics is worse than failing to merge two duplicates — a false merge produces a confidently wrong Mastery number, while a missed merge produces two honest ones.

## Naming

Renamed from `n-mhcs-reviewer` to `n-test-reviewer`, across both `_bmad/bmm/config.yaml` `project_name` and the repository directory itself.
