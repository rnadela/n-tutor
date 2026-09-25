# Epic 5 Context: Taking a Test & Results

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the student the actual product: a released Practice Test they can pick up, work through one Question at a time, survive a dropped network or a closed lid, submit, and immediately read a full answer key. This epic owns the student-facing surface end to end — the flat test list, the Take Test screen with its three input controls and question map, client-owned in-progress Attempt state, server-authoritative timer expiry, the grading engine and its four fixed grade states, the results answer key, and retakes. It is where trust is either earned or lost: no student work may be lost to an interruption, no grade may be wrong because AI was unavailable, and nothing a parent sees (cost, tier, allowance, grading rationale) may leak onto a child's screen.

## Stories

- Story 5.1: Student's Test List
- Story 5.2: Answering a Question
- Story 5.3: Attempt Resilience (interruption & offline)
- Story 5.4: Submitting an Attempt
- Story 5.5: Grading Engine & Four Grade States
- Story 5.6: Results & Answer Key
- Story 5.7: Retaking a Practice Test

## Requirements & Constraints

- The student's list is a **single flat list**, never grouped by Subject, each item labeled by Subject and state. Fixed sort: all released first (regardless of whether an Attempt is open), then completed newest-first. Completed tests stay reachable indefinitely — no system archiving. Three list conditions must be visually distinguishable: released/no Attempt, released/Attempt in progress, completed.
- Input control is driven by Question Format: single-select for Multiple Choice, an inline blank for Fill-in-the-Blank, multi-line free text for Short Answer. Free backward/forward navigation and answer changes until submit.
- The question map lists **every** Question with Answered / Not answered progress state and jumps to any one. It shows progress only — never correctness, never a score. **No correctness feedback of any kind before submission.**
- An in-progress Attempt survives backgrounding, refresh, and device sleep with answers intact; a running timer keeps reflecting elapsed wall-clock time and **never pauses**.
- Offline is the product's **sole network-optional carve-out**: answering and navigating work offline; **submission requires the network**. An offline submit is refused with a plain statement, the Attempt stays open with every answer intact, and it is **never silently retried**. A timer expiring offline auto-submits on reconnect, graded **against the expiry moment**, not reconnect, losing nothing entered before the drop.
- Submitting with blanks requires an explicit confirmation naming the count with a path back through the question map. Submission is irreversible for that Attempt and transitions the Practice Test to completed.
- Multiple Choice grades by exact option match — deterministic, repeatable, **no AI call**, and only for a Question actually answered.
- Fill-in-the-Blank and Short Answer grade on semantic equivalence, tolerant of spelling/casing/whitespace/notation/phrasing, scoped to the Question's subject matter, only for answered Questions. Each records a grade **and a short rationale**, persisted, readable by the parent on that Question's row in Attempt detail — and never reachable from a student surface.
- Grading unavailability degrades to `ungraded`, never to wrong. The Attempt still submits and scores; affected Questions are retried **when the results screen is next opened** by either party (view-triggered, no background job); while any remain ungraded the results header scores only gradable Questions and states the excluded count and reason; a resolving Question is marked newly graded.
- Four grade states, fixed literals, identical on every surface: `correct`, `incorrect`, `unanswered`, `ungraded`. Denominator/Mastery rules: correct counts in numerator and denominator; incorrect in denominator only; unanswered and ungraded are excluded entirely. `unanswered` is written **only at manual submission with a blank** and never arises from an expired timed Attempt (which grades blanks `incorrect`). Grading never overwrites an `unanswered` state.
- Grade vocabulary and in-test progress vocabulary are deliberately separate: `Unanswered` (a claim only submission can make) is not `Not answered`. Do not reconcile them.
- Full answer key shown immediately on submit and reachable thereafter from Attempt history.
- Retake produces a new distinct Attempt; prior Attempts stay in history; Question order may shuffle but content is unchanged. **Retakes are scored and visible but excluded from Mastery.** Any multi-Attempt Practice Test shows first score, latest score, and Attempt count together, with the first marked as the one counting toward Mastery; a single-Attempt test shows one score with no first/latest framing.
- Student Mode interactions (navigation, submission, results render) must feel instant on a mid-range tablet over home wifi.
- Nothing parent-scoped — allowance counters, cost figures, tier labels, model names, AI grading rationales, cross-profile data — is reachable from any student-scoped surface **or endpoint**.
- No log line, error report, or cost row may carry Question content, Explanation text, or a child's answers. Identifiers only.

## Technical Decisions

- `practicetest` owns Practice Test, Question, Attempt, and Answer. `grading` owns grade state and Mastery and is their sole writer. Cross-module access goes through the owning module's service, never its Prisma delegate.
- **Grading is foreground, not queued.** The submit request blocks on grading and returns the scored Attempt. Only answered Fill-in-the-Blank and Short Answer Questions are sent to the model — blanks consume no model call. There is no pending/fifth state: `ungraded` is written only on grading failure.
- Mastery recompute runs **inside the transaction** of whatever changed a grade — the submit request, an ungraded-retry resolution, a parent override. No separate recompute job, no window where a grade exists and Mastery lags. Mastery is recomputed from a rolling window (5 most recent qualifying first-Attempts per Topic), never incremented.
- **In-progress Attempt state is client-owned**: answers live in client-side persistent storage keyed to the Attempt, surviving refresh and backgrounding with no round trip. This is the only place student work lives outside the database, and it is what makes offline answering work. It is the one uncommitted-state mechanism that is *not* parent-gated. Client-held answers are bound to Attempt + Student Profile, cleared on successful submission and on any profile switch, sign-out, or mode-gate crossing, and carry the same 72-hour TTL as server-side uncommitted state.
- **Timer authority is the server, evaluated at submit.** The Attempt carries a server-issued started-at and duration; the client renders a countdown but never decides expiry. Expiry decides `incorrect` vs `unanswered`, which propagates into Mastery — so this must not be client-trusted.
- Every student-scoped endpoint reads the Student Profile **from the session token**, never from a request parameter. Authorization is enforced server-side per Parent Account for every Attempt and Practice Test query; Student Mode restriction is never client-side-only.
- All AI calls go through the single `ai` module (client, pinned model snapshots, retry/timeout, cost accounting, one `AiCall` row per completed provider call with a correlation id). Grading is its own call class. Structured output uses the Responses API with a Zod-derived JSON schema — never Chat Completions `response_format`.
- AI failure classes split: a client fault (unusable input) is terminal; an upstream fault (timeout, rate limit, refusal, outage, or schema/post-hoc validation failure) retries with backoff. Grading exhaustion writes `ungraded`.
- Fractions in generated content are a **schema** guarantee (structured numerator/denominator emission), not styling. Student answer input stays a raw free-text string and that raw string is what is submitted for grading.
- Every user-facing string is parameterized; person differs by surface — second person to the student, third person to the parent. A hardcoded user-facing string is a defect. Dark mode is scope: every token has both values and no surface hardcodes a color.
- The `ai` module boundary is the only test seam for nondeterminism; the fake must be able to fail (timeouts, refusals, schema-invalid responses), not only succeed.

## UX & Interaction Patterns

- Three student surfaces: **Student Home** (flat Practice Test card list) → **Take Test** → **Results**. Student Mode carries no parent functionality and no path into Parent View except the PIN gate.
- Navigation is **linear (Back/Next) plus the question map as an escape hatch** — never linear-only. Linear-only was rejected because it makes the unanswered-submit warning unactionable.
- Responsive split: on phone, a single column capped at the question measure with the map as an overlay; on tablet, the capped measure leaves width over, allocated to a **persistently visible question-map rail** beside the Question — state only, no score, no correctness hint.
- The Practice Test card shows pre-tap info (Subject, Grade Level, question count, timer presence and duration, state, score) and a dense post-retake state (`First 11/15 · Latest 14/15 · 3 attempts`) typeset as fact, not as a scoreboard.
- The grade-state marker carries **four redundant carriers** — icon frame shape/border style, glyph, fixed literal text label, row left-rule texture — with color as a never-alone fifth. A grayscale rendering must stay fully readable.
- The answer-key row combines Question, student's answer, correct answer, and the full grade-state marker, in original Question order, in the paper role (serif) type.
- Results appear with **no flourish**: no score count-up, no reveal sweep, no celebration. Banned throughout: per-tick timer animation, streaks, badges, points, confetti, mascots, infinite scroll, hover-only affordances. `prefers-reduced-motion` honored.
- Accessibility is a build constraint: WCAG 2.1 AA on student surfaces, student-sized tap targets, every control a real element with an accessible name, visible focus rings, focus order following reading order. Four hard cases are specified and must not be re-derived — (1) fractions: generated content as `role="img"` with a spoken alternative, student input as a real `<input>` holding the raw string with an `aria-hidden` typographic sibling that never overlays the input, moves the caret, or blocks typing, degrading to plain text on failure; (2) the SC 2.2.1 essential-timing exception for the optional, off-by-default, parent-configured, non-extendable timer; (3) the question map as real keyboard-navigable buttons, each individually announced with its state, `aria-current` on the active Question, with an on-screen legend; (4) all four grade states announced distinctly by their displayed literal label.
- Timer: `role="timer"` with an `aria-label` carrying a spoken unit-bearing value on every instance including collapsed and rail variants; `aria-live` off in steady state, raised only at the 5-minute, 1-minute, and 20-second warnings; each warning carries a **matching visible text change**, never color or motion alone, and warnings never escalate. Auto-submit fires a `role="alert"` announcement before the route change, with focus landing on the results heading.
- Every state change that matters — submit confirmation, grade resolution, grade override — is announced via a live region using the same words that are displayed.
- Copy is plain fact: no error codes, no cheerleading, no exclamation marks.
- **The smart fraction field is flagged as carrying real implementation risk** and needs its own estimate and test coverage. Recorded fallback if alignment proves unreliable: display-only typographic fractions with a plain unstyled input — never a numerator/denominator widget.
- Reference mocks in the UX design's `mockups/` directory cover Take Test (all timer states, the fraction mechanism) and Results (all four grade states).

## Cross-Story Dependencies

- The epic's input is Epic 4's **released** Practice Test with its Questions, correct answers, Question Formats, Topics, structured fractions, and optional timer configuration. Epic 4 writes timer configuration only; the countdown, expiry evaluation, auto-submit, and the `incorrect`-vs-`unanswered` consequence are all here. Epic 4's released-state write barrier is what keeps a timer from being mutated mid-life and retroactively changing how past Attempts graded.
- Story 5.5 is the spine: 5.4's submit path, 5.6's answer key, and 5.7's Mastery exclusion all depend on the four-state model and the grading engine. Build it before or alongside them.
- Story 5.3's client-owned Attempt storage underpins 5.2's free navigation and 5.4's submit; the server-authoritative timer in 5.3 is what makes 5.5's expiry rule enforceable.
- Grade states, grading rationales, and Mastery produced here are consumed by Epic 6 (Explanations, grade disputes and parent overrides — an override re-enters the same grading/Mastery code path) and Epic 7 (per-Topic Mastery, trend, Weak Areas, drill-down). Topic labels on graded Questions flow into Topic normalization.
- Parent-side Attempt detail (where grading rationales are read) belongs to Parent View, but the rationale must be persisted here at grading time.
- Attempts, Answers, and grading rationales are hard-deleted by Epic 8's deletion paths; nothing here may make a Question's grade depend on stored Page Image bytes.
