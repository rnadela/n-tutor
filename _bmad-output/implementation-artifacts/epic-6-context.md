# Epic 6 Context: Explanations & Grade Disputes

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Close the accountability loop on AI-generated content. A student can ask why an answer is right or wrong and get an Explanation on demand, and can raise a hand when either the Explanation or the grade looks wrong. Every one of those hands reaches the parent — never the operator directly — and the parent has real remedies: read any Explanation, confirm or dismiss a student's flag, override a wrong grade, or suppress a bad Explanation for their own child and get a free replacement. This epic is what makes ungated student-facing AI content defensible: accountability is after the fact, so the parent must be able to see everything and actually change what reaches their child.

## Stories

- Story 6.1: On-Demand Explanations
- Story 6.2: Parent Review of Explanations
- Story 6.3: Student Explanation Flagging
- Story 6.4: Explanation Suppression & Free Regeneration
- Story 6.5: Grade Dispute & Override

## Requirements & Constraints

- Explanations are generated **on demand per Question, cached after first generation**. Only the first request waits. Generation is bounded by the Explanation Allowance; **re-reading an already-generated Explanation is never capped at any tier** — with exactly one carve-out, a suppressed Explanation.
- Explanation language is pitched **per grade** (not in bands) to the **Practice Test's Grade Level, never the Student Profile's**. Sentence length, vocabulary, and assumed prior knowledge shift with the grade.
- A parent can read **every** Explanation shown to their child, and can **originate** a flag on any Explanation independently of whether the student flagged it. That is the primary flag path, not a fallback.
- A student flag surfaces **to the parent only, never directly to Admin**. Exactly two dispositions: confirm (sends it to the Admin Flagged Explanations queue) or dismiss (recorded, goes no further). A flag stays listed while awaiting disposition and stays listed afterwards marked with the disposition taken. **Confirming does not suppress** — suppression is a separate, explicit choice.
- **Flagging never changes what the student is reading.** The panel stays open and the Explanation stays on screen. Only a parent decision removes it.
- Suppression is available **only once a flag exists** on that Explanation (parent-originated, or a student flag the parent confirmed). Never automatic, never available in Student Mode.
- Suppression is **scoped to one Student Profile**, not a service-wide takedown, and must be **checked at serve time on every read path** — never encoded only in a cache key. The record is retained, stays parent-readable, and still reaches the Admin queue.
- Suppression is **not reversible in v0**, and the parent confirmation must say so in words before it fires. The only forward path is the free regeneration, which produces a **different** Explanation, shown to the student as a new one rather than the old one restored.
- A regeneration **consumes no Explanation Allowance at any tier including Free**, and the control must state that cost (nothing) before it fires. The replacement is itself flaggable and suppressible on the same terms with no ceiling — the loop is bounded by parent effort, not allowance.
- Suppression changes **one Explanation and nothing else**: the Question, the student's answer, the correct answer, the grade state, the Attempt score, Mastery, the dispute flag, Retake, and every other Explanation on the test are untouched.
- A grade dispute raised by the student surfaces on the **parent's Analytics dashboard for that Student Profile** (not a separate flagged-items destination), naming the Practice Test, the Question, and the recorded grade. The parent performs the **override in Attempt detail**. Disputes stay listed after resolution, marked resolved — a dispute is a record, not a vanishing to-do.
- An override flips a Question between `correct` and `incorrect` on the recorded Attempt, **recomputes the Attempt score and the affected Topic's Mastery**, and marks the row parent-adjusted. The **original AI grade and rationale are retained, not erased** — the rationale is the evidence the override was decided on. Requires no PIN beyond entering Parent View.
- **AI grading is never capped by any allowance.** An allowance must never take away an Explanation a student already read; only a parent judgement can.
- Nothing parent-scoped — allowance counters, cost figures, tier labels, model names, grading rationales — is reachable from any student-scoped surface **or endpoint**.
- No log line, trace, error report, or cost row may carry Explanation text, Question content, or a child's answers. Identifiers only.

## Technical Decisions

- The `explanation` module owns Explanation rows, suppression state, and flags, and is their only writer. It reads `practicetest` and `ai` through their services. `grading` owns grade state and Mastery and is the sole writer of both — the override path must go through `grading`, never write Mastery directly.
- Explanation generation is a **foreground, in-request AI call** with an inline loading state inside the expanded region and **manual retry only, no automatic retry** (auto-retry silently doubles a wait this product requires to stay short). It is not a queued job.
- The **Explanation cache key includes the Student Profile**, so a suppression for one child can never serve from cache and a free regeneration is a distinct entry rather than an overwrite. This is in addition to — not instead of — the serve-time suppression check.
- Allowances are **derived, not decremented**: Explanation usage for a period is counted Explanation rows generated in the window on Free tier, scoped to the Parent Account. A suppressed Explanation **still counts as consumed**; the free regeneration it entitles carries a **flag excluding it from the count** — not a second counter. The counter must therefore distinguish a charged generation from a free one **at the point of generation**.
- **Mastery is recomputed from the rolling window, never incremented**, and the recompute runs **inside the transaction of whatever changed the grade** — the override commits the new grade and the new Mastery together, with no window where a parent could read one without the other. All recompute triggers share one code path.
- AI failure classes: an upstream fault (timeout, rate limit, refusal, outage, or schema/post-hoc validation failure) is retried with backoff and surfaced as a user-retryable transient failure; a client fault is terminal. Explanation failures land as transient, user-retryable.
- Structured output goes through the Responses API with `zodTextFormat`, not `chat.completions` + `response_format`. Grading and Explanation share the same pinned model alias. Every completed provider call writes an AiCall row (account, call class, pinned model, tokens, cost, latency, correlation id) owned by the `ai` module.
- **Fractions in Explanations are a schema constraint, not CSS**: the Explanation schema emits structured fractions so a spoken text alternative exists; the rendered fraction is `role="img"` with that alternative ("five sixths", not "five six").
- The Admin Flagged Explanations queue reads **through `explanation`'s service**, and contains parent-confirmed and parent-originated flags only. A suppressed Explanation stays in the queue; service-wide takedown remains an operator decision outside this epic.
- **No user-facing string is a fixed literal** — copy is a parameterized layer, and person differs by surface: second person to the student, third person to the parent.

## UX & Interaction Patterns

- The **Explanation panel is an inline expand beneath its row** — never a separate screen or modal. A separate screen was rejected because it breaks the Question/Explanation adjacency the pattern exists to preserve.
- Panel states: **loading, error (manual retry), at-cap, loaded**, plus a **fifth suppressed state in Student Mode**. A failed, capped, or suppressed Explanation never blocks the rest of the screen — the answer key, other Questions, the dispute flag, and Retake stay fully usable.
- Student Mode carries the bad-Explanation flag and the grade-dispute flag. Attempt detail carries the parent's own flag (originate, or confirm/dismiss a student's), and is **also where suppression and regeneration live** — the parent must read the Explanation in full on that panel before either is reachable; the reading is the evidence.
- The suppressed state **says what happened** and never renders as an empty expand, a blank row, an error, or silence. The copy names **the Explanation** as the thing that fell short and the parent as the person who removed it — no blame, no correction, no instruction, no exclamation mark, no reason text, and no relay of the parent's words to the child. The `Explain this` control **does not return** on that Question while suppressed; the suppressed state replaces the control rather than sitting beside it.
- The at-cap message is a plain statement of the limit and reset date. It **blames the plan, never the child**, with no running counter shown to the student, no exclamation marks, no apology, and no upsell language aimed at a child. A wrong answer is **reported, never punished**. An Explanation failure is never framed as the student's fault.
- Requesting an Explanation while offline shows a connection statement distinct from both the generation-failure and at-cap copy.
- The suppression confirmation names, in one breath, what suppression does and does not do: stops serving to **this Student Profile** only, is not a deletion, stays parent-readable here, still visible to the operator, leaves the Question/Attempt/score/Mastery unchanged, is scoped to this profile not the service, and **cannot be undone**.
- The Analytics dashboard band is a **per-profile digest, not a queue**, carrying three item types: grade disputes, Explanation flags awaiting disposition, and the Explanation Allowance readout. The allowance readout is **Free tier only, account-scoped not profile-scoped, and must say so** on a per-profile screen. Never rendered in Student Mode.
- Grading rationale is readable by the parent on every Attempt detail row, collapsed by default, so a disputed row needs no further navigation.
- Uncommitted parent work persists without an explicit save — including an **uncommitted grade override**.
- Accessibility: an Explanation's suppressed state, grade resolution, and grade override are each announced via a live region using the same words displayed. Explanation expand/collapse is permitted motion; `prefers-reduced-motion` is honored.

## Cross-Story Dependencies

- Depends on Epic 5 for the results screen, Attempt detail, answer key, the four grade states, and grading rationales — Explanations and dispute flags hang off those rows.
- Depends on Epic 9 for the Explanation Allowance mechanism (derived counting, period windows, at-cap behavior) and on the tier table for the Free-tier cap. Story 6.4's free-regeneration exclusion flag is the one allowance carve-out this epic introduces.
- Depends on Epic 7 for Mastery and the Analytics dashboard: the dispute band and the Explanation Allowance readout live on that dashboard, and the override's Mastery recompute uses Epic 7's Topic/Mastery model.
- Depends on Epic 2 / Epic 1 for the Admin surface and Parent View PIN gating: the Flagged Explanations queue is an Admin destination, and every parent action here is behind Parent View.
- Within the epic: 6.3 (student flag) and 6.2 (parent-originated flag) are both preconditions for 6.4 — suppression requires a flag from either route. 6.1 must exist before any flag path is meaningful. 6.5 is independent of 6.1–6.4 and can be built in parallel.
- **Open question carried from architecture:** de-duplication of Admin content-quality queue entries for a single Explanation when both a parent-originated flag and a confirmed student flag reach the queue — the queue's identity model is unresolved and needs a decision in 6.3/6.4.
