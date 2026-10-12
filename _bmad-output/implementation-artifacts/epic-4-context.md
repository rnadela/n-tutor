# Epic 4 Context: Practice Test Generation, Review & Release

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A parent turns a captured Source Test into fresh practice material: they request 1–5 Practice Tests, watch an async job produce them, review every generated question, fix or delete what's wrong, optionally set a countdown timer, and then release the test to a Student Profile — or discard it. This epic is the gate between AI output and anything a child ever sees: nothing reaches Student Mode without a parent reading it first, and release is the irreversible commitment point.

## Stories

- Story 4.1: Practice Test Generation (bounded, priced, async)
- Story 4.2: Topic-Weighted Regeneration
- Story 4.3: Draft Review
- Story 4.4: Draft Editing
- Story 4.5: Release or Discard
- Story 4.6: Optional Timer Configuration
- Story 4.7: Obvious Progress Spinner & Sheet Tally
- Story 4.8: Figures in Generated Questions

## Requirements & Constraints

**Bounding and pricing.** Per-request maximum is 5 Practice Tests, further bounded by the remaining Generation Allowance. Counts above the remaining allowance are shown disabled with the reason stated — never hidden. The count is clamped server-side regardless of what the client sends. Cost is stated in Practice Tests (never "requests" or "generations") before the parent confirms.

**Allowance accounting.** A Practice Test is charged on first reaching draft and never again; the predicate is a durable "has ever reached draft" marker on the row. A job producing 3 of 5 drafts charges 3 and reports partially complete; a job where nothing landed charges nothing and reports failed. Discarding or deleting down to zero questions does not refund — the confirmation must say so.

**Generation output quality.** Each Practice Test defaults its question count from the Source Test's own count, covers the Extraction's Topics, and reproduces its format mix proportionally. Multiple tests from one Source Test must be materially different from each other and from the source, with no verbatim copies. Every question carries its correct answer, its Topic(s), and plausible distractors for Multiple Choice. Generation must stay inside the Source Test's academic subject matter; uninterpretable source content must never be hallucinated into questions.

**Async behavior.** Generation is a queued job: the request enqueues and returns, progress surfaces read job status (never a held connection), and the parent can leave and return without losing work. A failed generation leaves the Source Test intact and retryable without re-upload.

**Lifecycle.** A draft never appears in Student Mode. Questions are editable and deletable in draft state only, down to a minimum of one; deleting the last one discards the test. Release makes the test visible in Student Mode and is irreversible — no further edits, including the timer. Discard removes it from all student-facing surfaces and from Analytics.

**Timer.** Off by default, with a suggested duration derived from question count. Configurable up to release, never after. During a timed Attempt, remaining time is visible throughout with three non-escalating warnings at 5 minutes, 1 minute, and 20 seconds. On expiry the Attempt auto-submits (announced) and every unanswered question is graded incorrect — the only path by which a blank becomes incorrect rather than unanswered.

**Accessibility is a build constraint, not a review step.** WCAG 2.1 AA; timers exposed as timers and silent except at the three thresholds; state never conveyed by color alone; contrast verified in light and dark.

## Technical Decisions

- **Queued jobs in the application database.** Generation (like Extraction) is a database-backed job in the same Postgres — no broker, no second datastore. Enqueueing work and mutating state share one transaction, because "job succeeded, debit did not" must be impossible.
- **Module ownership.** The `practicetest` module is the only writer of Practice Test, Question, Attempt and Answer; everything else reads through its service. `allowance` is a policy module owning no entity and must expose both the current period window and the next boundary.
- **Released-state write barrier.** The API refuses any write to a released Practice Test — timer included — independent of what the UI offers. Timer config is written at generation and immutable thereafter, because changing it would retroactively change how expiry graded past Attempts.
- **Server is timer authority.** The Attempt carries a server-issued started-at and duration; the client renders a countdown but never decides expiry. Expiry is evaluated at submit.
- **Strict-schema AI calls plus deterministic post-hoc validation.** Generation uses the strict-schema tool-call pattern through the single `ai` provider boundary. Schema validity is not semantic validity: validation runs in code on every payload — the canonical case being a Multiple Choice question whose correct answer is absent from its own options. Output carries per-field confidence.
- **Fault split.** Validation failure is a *content* fault, distinct from a transport fault, and degrades differently. Generation exhaustion leaves the job failed with whatever drafts already landed committed and charged.
- **Structured question content, not prose.** Fractions are a structured numerator/denominator value in the question payload (never a plain string) so typographic rendering and a spoken alternative are both possible. Figures are a `figure` rich-text segment holding sanitized SVG plus a required text alternative — never prose describing a shape. Figures render inline in the current text colour so both themes hold, and announce as a single image by their alternative.
- **Figure sanitization on both sides.** Every figure SVG passes an allowlist sanitizer in code (shape/path/group/text elements and geometry/presentation attributes only; no script, handler, external reference, embedded HTML, image or CSS; colours rewritten to current colour; 16 KB cap). The web re-sanitizes before rendering; neither side trusts the other. A figure that fails is a content fault.
- **Figure-preserving edits.** Draft editing currently round-trips fields through plain text, which would silently delete figure segments. Edit paths must preserve every figure in an edited field unchanged; editing a figure itself is not offered.
- **Child-facing exposure rule.** No allowance counter, cost figure, tier label, model name, or grading rationale is reachable from a student-scoped endpoint.
- **No hex values outside the design tokens module.** Progress, tally and timer states take their colours from tokens; a shared progress component serves both the extraction wait and the generation wait.

## UX & Interaction Patterns

- **Screens.** Generate (count selector, thin-extraction warning, cost statement) → Generation progress (live async job) → Pending drafts (a first-class, persistent Parent View destination listing unreleased drafts) → Draft review (one draft at a time, full question list in original order, per-question edit/delete, timer configuration, release or discard).
- **Progress.** A large centred spinner (accent colour, ≥48px) sits above the status sentence with nothing competing; it is removed in the same render the result appears. Under `prefers-reduced-motion` it does not rotate — a static progress mark keeps the wait obvious. The spinner is `aria-hidden`; the existing `role="status"` sentence is the announcement.
- **Sheet tally.** One sheet icon per requested Practice Test, wrapping on narrow screens, with four states — ready (check, success tint), being made (spinner ring, accent), waiting (dashed outline), not made (×). Each state is distinguishable by shape alone with colour removed. Ready sheets draw in and settle from 85% scale over the standard motion duration; no motion under `prefers-reduced-motion`. The tally is `aria-hidden` and sits directly above the unchanged progress sentence.
- **Timer display.** Tabular figures changing in place with no per-tick animation; at each warning threshold the value takes the warning colour *and* gains a text label (never colour or motion alone). `role="timer"` with `aria-live` raised only at the thresholds, an `aria-label` carrying a spoken unit-bearing value in every variant, and auto-submit announced via `role="alert"` with focus moved to the results heading before the route change.
- **Copy.** Generation-progress copy must never claim work will be lost if the parent leaves — that would be false and contradicts retry-without-re-upload. Allowance copy is always denominated in Practice Tests. Destructive confirmations state the consequence plainly, with no exclamation marks and no urgency.
- **Reference mockups.** `key-capture.html` (capture, legibility, generate step) and `key-generation-progress.html` (progress and tally states) illustrate this epic. Where a mockup and the design/experience specs disagree, the specs win.

## Cross-Story Dependencies

- 4.1 establishes bounding, pricing, clamping and the async job; **4.2 reuses all of it** — weighted regeneration adds Topic weighting only, reusing the originating Source Test with no new upload. The analytics-dashboard and missed-question entry points that trigger weighted generation are wired in Epic 7, not here.
- 4.3 → 4.4 → 4.5 form the draft lifecycle chain; 4.6 (timer) must land before or with 4.5, since release closes the timer permanently.
- 4.7 is independent of the rest of the epic and shares one progress component with Epic 3's extraction-reading wait.
- 4.8 depends on Epic 3's figure work in Extraction (figures must exist in the Extraction before generation can carry them) and must close the figure-stripping edit path in 4.4. It also covers the student-facing render in Epic 5 (take, results, answer key), since all of it flows through one rich-text component — no extra Epic 5 story.
- Downstream: Epic 5 consumes released Practice Tests and the timer contract (auto-submit, unanswered-becomes-incorrect); Epic 7 reads Practice Test and grading data for Analytics and supplies 4.2's entry points; Epic 9 owns the Generation Allowance limits this epic enforces.
