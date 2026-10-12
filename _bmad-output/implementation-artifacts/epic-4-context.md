# Epic 4 Context: Practice Test Generation, Review & Release

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A parent turns an uploaded Source Test into fresh practice material: generate one or more Practice Tests (optionally weighted toward a weak Topic), review and edit the resulting drafts question by question, optionally set a countdown timer, and release each draft to a Student Profile — or discard it. This is the product's core value loop: it is the only path by which generated content reaches a child, and it is deliberately gated behind parent review so nothing unapproved, wrong, or inappropriate is ever visible in Student Mode.

## Stories

- Story 4.1: Practice Test Generation (bounded, priced, async)
- Story 4.2: Topic-Weighted Regeneration
- Story 4.3: Draft Review
- Story 4.4: Draft Editing
- Story 4.5: Release or Discard
- Story 4.6: Optional Timer Configuration
- Story 4.7: Obvious Progress Spinner & Sheet Tally
- Story 4.8: Figures in Generated Questions
- Story 4.9: Figure Placement

## Requirements & Constraints

**Bounding and pricing.** Per-request maximum is 5 Practice Tests, further bounded by the account's remaining Generation Allowance at initiation. Counts above the remaining allowance render disabled with the reason stated, never hidden, and the count is clamped server-side regardless of what the client sent. Cost is stated before any generation fires — always denominated in Practice Tests, never in "requests" or "generations". Weighted regeneration is bounded, clamped, and priced identically, and reuses the originating Source Test with no new upload.

**Generation output quality.** Each generated Practice Test defaults its question count from the Source Test's own count, covers the Extraction's Topics, and reproduces its format mix proportionally. Multiple Practice Tests from one Source Test must be materially different from each other and from the source; no verbatim copies. Every question carries its correct answer and Topic(s), plausible distractors for Multiple Choice, and fractions in structured renderable form. Generation is constrained to the Source Test's academic subject matter; uninterpretable source content is never hallucinated into questions.

**Asynchrony and failure.** Generation is explicitly asynchronous with visible progress the parent can leave and return to without losing work. Progress copy must never claim work will be lost if the parent leaves. Failure leaves the Source Test intact and retryable with no re-upload.

**Draft lifecycle.** A draft never appears in Student Mode. Edits to question text, options, or correct answer become what the student is graded against. Questions can be deleted until one remains; deleting the last one discards the Practice Test after a confirmation that states the already-spent Generation Allowance is not refunded. Release is irreversible and makes the test visible in Student Mode; a released Practice Test can no longer be edited. Discard removes it from all student-facing surfaces and from Analytics.

**Timer.** Off by default, with a suggested duration derived from question count, entered in minutes. Editable only up to release. During a timed attempt remaining time is visible throughout, with three mandatory non-escalating warnings at 5 minutes, 1 minute, and 20 seconds. On expiry the attempt auto-submits (announced when it happens) and every unanswered question is graded incorrect — the single path by which a blank becomes incorrect rather than unanswered.

**Observability and spend.** Every generation call is logged with outcome, latency, and cost attribution per Parent Account. No log line, error report, or cost row ever carries question content or a child's answers.

## Technical Decisions

- **Generation is a queued job on a Postgres-backed queue.** The triggering request enqueues and returns; the job outlives the connection. Progress surfaces read job status, never a held connection. Enqueueing work and mutating state share one transaction.
- **Job payloads carry identifiers and parameters only** — never question content or image bytes. Handlers load content from the database at execution time.
- **Generation is incremental; partial success is a real user-visible outcome.** Each draft is committed as it lands and charges one allowance unit at that moment; landed drafts are never discarded if the job later fails. 3 of 5 produced reports as partially complete and charges 3. A job where nothing landed charges nothing and reports as failed. The progress surface must render the partial state.
- **Allowances are derived, not decremented**, and the cap check runs inside the owning module's insert transaction under a transaction-scoped advisory lock keyed on account plus call class.
- **One writer per entity.** The practice-test module owns Practice Tests and Questions; every other module reads through its service. Cross-module write methods take the caller's transaction client as their first parameter.
- **All model output is structured output through the single `ai` provider boundary**, with schemas built from Zod. Generation uses its own configured model snapshot; model ids live in configuration, never inlined.
- **Post-hoc deterministic validation runs in code on every payload after schema validation.** Canonical case: a Multiple Choice question whose correct answer is not among its own options is malformed and must be rejected in code. Validation failures are *content* faults.
- **Fault split:** an unusable input is a client fault — terminal, never retried, surfaced as a retake prompt. Provider timeout/rate-limit/refusal/outage, and any schema or post-hoc validation failure, are upstream faults — retried with backoff; on exhaustion the job is left failed with whatever drafts landed committed and charged.
- **Rich text is the one content mechanism.** Question prompts, choices, and answer keys are segment arrays: text, fraction, and figure. Fractions are a schema constraint, not a CSS concern, because a spoken alternative cannot be recovered from a glyph.
- **Figures are structured too.** A shape or diagram is a `figure` segment holding sanitized SVG plus a required text alternative — never prose describing it. Generation may emit new figures in prompts and in Multiple Choice choices where the source used pictured options, but must not copy a source figure verbatim. Every figure SVG passes an allowlist sanitizer in code (shape/path/group/text elements and geometry and presentation attributes only; no script, handler, external reference, embedded HTML, image, or CSS; colours rewritten to current colour; size-capped). The web re-sanitizes before rendering — neither side trusts the other. A figure that fails is a content fault.
- **The draft edit path must preserve figures.** The editor historically round-tripped fields through a plain-text conversion, which would silently delete figure segments. Either edit text segments around figures, or pass figure segments through unchanged and re-sanitize on save. Editing a figure itself is out of scope.
- **The plain-text projection of rich text must render a figure as its alternative text**, so grading, dedupe, Topic, and Explanation prompts continue to operate on text.
- **No hardcoded user-facing strings and no hardcoded colours.** Copy is a parameterized layer; person differs by surface — third person to the parent. Every design token has a light and dark value.
- **Child-facing exposure rule:** no allowance counter, cost figure, tier label, or model name is ever reachable from a student-scoped endpoint.

## UX & Interaction Patterns

- **Generate step:** a count selector bounded at initiation by remaining allowance, with the thin-Extraction warning (usable question count plus pages submitted, stating that retaking pages consumes no Generation Allowance) and an explicit cost statement before firing.
- **Generation progress:** a single large centred spinner above the status sentence with nothing competing with it, plus a row of sheet icons — one per requested test — showing ready / being made / waiting / not made. Each state must be distinguishable by shape alone with colour removed. The spinner and tally are `aria-hidden`; the existing `role="status"` sentence is the sole announcement, positioned directly beneath the tally. Under `prefers-reduced-motion` nothing rotates or animates, but the wait stays obvious. The spinner disappears in the same render the result appears. One shared spinner component serves both the extraction wait and the generation wait.
- **Draft review:** one draft at a time as its full question list, with per-question edit and delete acting in place without navigating away, and persistent progress context ("draft 2 of 5"). Timer configuration lives here. Pending drafts is a first-class Parent View destination, not only a post-flow landing.
- **Release:** per draft; no batch release. Released tests appear on Student Home as each is released. Discard is per draft too.
- **Weighted regenerate** is entered only from the Topic drill-down, with the Topic pre-selected and its cost stated before it fires — no duplicate dashboard entry point.
- **Timer display:** tabular figures changing value in place with no per-tick animation; at each warning threshold the value takes the warning colour *and* gains a text label (never colour or motion alone). Exposed as a timer to assistive technology, labelled with what it counts, silent except at the three thresholds, with a spoken unit-bearing label on every variant. Auto-submit is announced assertively with focus moved to the results heading before the route change.
- **Figure placement:** a figure always starts on a new line after the text preceding it, and any text after it begins on a new line below — never flowing beside it. Multiple figures in one field each sit on their own line in stored order. Figures keep a responsive width and a height ceiling, are left-aligned with the text above, and take vertical spacing from the spacing scale. Text and fraction segments still flow inline unchanged.
- **Reference mockup** `ux-designs/.../mockups/key-generation-progress.html` illustrates the generation-progress states, colours, and order. Where a mockup and the written design or architecture spines disagree, the spines win.

## Cross-Story Dependencies

- **Upstream (Epic 3):** generation consumes a committed Source Test and its Extraction, including usable-question flags, Topics, format mix, and figure segments. Story 4.8 depends on the figure segment kind, the sanitizer, and the renderer landing in Story 3.9; Story 4.9 refines how that renderer lays figures out.
- **Within the epic:** 4.2 reuses 4.1's bounding, clamping, and pricing path. 4.3 and 4.4 operate only on drafts 4.1/4.2 produced. 4.6 attaches to a draft and locks at the moment 4.5 releases it. 4.7 renders progress for 4.1/4.2 jobs and shares its spinner component with Epic 3's extraction wait. 4.8 widens 4.1's generation schema, 4.3's review surface, and 4.4's edit path simultaneously.
- **Downstream (Epic 5):** released Practice Tests, their questions, their figures, and their timer configuration are consumed by test taking, grading, results, and the answer key — all through the one rich-text component, which is why no separate Epic 5 figure story exists.
- **Epic 7:** Story 4.2 ships the weighted-generation capability only; the Analytics dashboard and missed-question drill-down entry points into it are wired in Epic 7.
- **Epic 9:** generation consumes and is bounded by the Generation Allowance, charged per landed draft on the account's own monthly boundary.
