# PRD Quality Review — n-test-reviewer

## Overall verdict

The PRD has a real thesis, honest trade-offs, and FRs that mostly carry testable consequences — it would survive contact with an architecture workflow. Two things put it at risk: the privacy commitments in §5.2 are stated as prose and listed in MVP scope but have no FRs behind them, so story creation will silently drop them; and the Free tier's allowance (2 tests/month) is arithmetically incompatible with the Analytics feature it is supposed to showcase, which is a product contradiction rather than a documentation gap. Both are fixable inside this document.

## Decision-readiness — strong

Decisions are stated as decisions. §12.1 is unusually good practice: eleven questions closed, each with the decision and where it landed, so downstream workflows cannot relitigate them. Trade-offs name what was given up — §9.2's provider-abstraction non-goal says plainly that a price or terms change "means a real refactor across Extraction, generation, grading, and Explanations," rather than burying it. §5.1's Explanation decision states the rejected alternative and why.

The `[NOTE FOR PM]` callouts land at real tensions (notifications being the likeliest first request; FR-26a being the highest-risk requirement) rather than at safe checkpoints.

### Findings
- **medium** Success Metric targets are undefended (§11) — Every target (≥80%, ≥70%, ≥50%, ≥40%, ≤10%, ≤3%) was set pre-launch with no baseline, comparable, or derivation. They read as rigor but nobody earned them, which is the "every NFR is important" failure in numeric clothing. *Fix:* label them explicitly as initial hypotheses to be reset after the first month of real accounts, consistent with how §12.2 item 4 already treats the tier values.

## Substance over theater — strong

No persona theater: three roles, each driving actual FRs, no standalone persona section. No innovation theater — §1 names the insight (the last exam is the highest-signal artifact about the next one) without claiming novelty. §10's NFRs mostly carry product-specific bounds rather than adjectives; the reliability entry in particular is concrete ("unavailable AI grading degrades to *ungraded* rather than to *wrong*").

The Vision would not swap into another PRD unchanged — the "they remember the answers, not the topic" framing is specific to this product.

### Findings
- **low** WCAG 2.1 AA target is unenforced (§10) — Named as a target with some specifics (tap targets, color-alone), but no FR requires it and no SM measures it. Weakest NFR in the section. *Fix:* acceptable as-is for the stakes; note it as a build-time checklist rather than an aspiration.

## Strategic coherence — adequate

The thesis holds and features follow from it. Counter-metrics are present and are the strongest part of §11 — SM-C1 and SM-C2 both name genuine ways success could be gamed.

But there is one unresolved contradiction and one arithmetic one.

### Findings
- **high** Free tier makes the Analytics feature unreachable (§5.3, FR-26, FR-27, FR-11) — Free allows 2 Practice Tests per month. FR-27 requires 5 answered Questions on a Topic before it can be a Weak Area, and FR-26 computes Mastery over the 5 most recent Attempts touching that Topic. A Free-tier family will take *months* to make a single Weak Area appear, so the dashboard a new user sees is an empty state. UJ-3's "Generate more" from a Weak Area (FR-11) then costs one of their two monthly tests. The tier that introduces the product cannot demonstrate the feature that differentiates it. *Fix:* either raise Free's Generation Allowance to the point where one Topic can reach the FR-27 floor within a month, or state explicitly that Free is a closed door and Plus is the real entry point — both are defensible, but the PRD currently implies the first while specifying the second.
- **high** SM-C3 contradicts FR-20 and UJ-2 (§11, §4.5) — SM-C3 says rising scores on retakes of the same Practice Test measure memorization, not Mastery, and should not be optimized. But retake is an in-scope feature (FR-20), UJ-2's resolution is Noah retaking, and FR-26's rolling 5-Attempt window means retaking until correct *raises* Mastery. The PRD simultaneously ships retake, rewards it in the Mastery model, and names its effect a counter-metric. *Fix:* resolve the intent — either exclude repeat Attempts on the *same* Practice Test from Mastery (keeping retake as practice, not measurement), or drop SM-C3 and accept retake as legitimate learning. The current state will confuse whoever implements FR-26.

## Done-ness clarity — adequate

Most FRs carry genuinely testable consequences, and several are unusually good — FR-2's "failure count persists across app restart," FR-22's degradation path, FR-31's at-cap message specification with a worked example. No instances of "handles X gracefully" or "user-friendly."

Three gaps would stall an engineer.

### Findings
- **critical** Privacy commitments have no FRs (§5.2, §9.1) — Automatic 90-day Page Image deletion, parent-initiated Source Test image deletion, per-Student-Profile data deletion, and Parent Account deletion are all stated in §5.2 prose and all listed in §9.1 MVP scope, but none has an FR. Story creation sources from §4, so these will be dropped from the build and discovered missing at the point they are legally load-bearing. *Fix:* add FRs covering the retention job and the deletion paths, with testable consequences naming what deletion propagates to (§10's data-lifecycle line already lists the targets).
- **high** Allowance decrement timing undefined (FR-31, FR-9a, FR-10) — FR-31 never says *when* an Upload or Generation Allowance is consumed. FR-10 requires a failed generation to be retryable without re-upload; does the failed attempt consume allowance? FR-9a says proceeding after a thin-Extraction warning "does not consume a Generation Allowance beyond the tests actually generated," which implies a partial-consumption model never defined anywhere. An engineer cannot implement the counter from this. *Fix:* state the rule once in FR-31 — allowance consumed on successful production of the artifact, not on request — and delete the implied partial semantics from FR-9a.
- **medium** Monthly reset boundary is an open question an FR depends on (FR-31, §12.2 item 3) — FR-31 requires allowances to "reset on a fixed monthly boundary, identical for all accounts" and requires the at-cap message to name the reset date, but §12.2 leaves calendar-vs-rolling undecided. The FR cannot be fully tested until it resolves. *Fix:* decide it — calendar month, since FR-31's own worked example ("Resets 1 October") already assumes it.

## Scope honesty — strong

Non-Goals does real work and is specific about what it forecloses. §9.2 gives reasons rather than bare lists, and marks the emotionally load-bearing deferral (notifications) with a `[NOTE FOR PM]`. The provider-abstraction non-goal honestly records a decision made against the PRD's own recommendation.

Open-items density is appropriate: 9 live assumptions and 6 remaining questions against a small-launch PRD, with 11 questions already closed. Not a blocker at these stakes.

### Findings
- **low** §0 overstates assumption density — It says "the `[ASSUMPTION]` density is deliberately high and §14 is the intended review surface," written when the draft had 13 live assumptions and 11 open questions. Four have since been promoted to requirements. *Fix:* soften to match the current state.

## Downstream usability — adequate

Glossary is thorough and terms are used consistently across FRs, UJs, and SM definitions — spot-checking Practice Test, Attempt, Source Test, and Account Tier shows no synonym drift. Cross-references resolve. Each §4 subsection reads standalone.

### Findings
- **medium** FR-26a is misnumbered (§4.7) — The `-a` suffix convention elsewhere marks a sub-requirement of its parent (FR-9a under FR-9, FR-24a under FR-24). FR-26a is Topic normalization in §4.7, while FR-25 is the grade dispute flag in §4.6 — unrelated requirements in different features. A reader will assume a relationship that does not exist. *Fix:* renumber to a free trailing ID, or to FR-26a since it is genuinely upstream of Mastery.
- **low** Topic canonicalization is not Grade-Level scoped (FR-26a) — Canonical Topics are scoped per Subject only, so Grade 3 "fractions" and Grade 6 "fractions" merge into one Mastery value for a family with two children at different levels. May be intended (a topic is a topic) but is currently unstated either way. *Fix:* one sentence confirming the scope is deliberate.

## Shape fit — strong

Consumer product with meaningful UX and multiple stakeholders, so named-protagonist UJs are load-bearing and correctly present. Maria and Noah carry persona context inline rather than in a standalone section, and UJ-4's single-sentence treatment of the Admin correctly scales down for a single-operator role. Length matches small-launch stakes.

Chain-top PRD feeding UX → architecture → stories, and §6's inherited-stack constraint is the right call for that position — it bounds the architecture workflow's decision space without the PRD drifting into implementation.

## Mechanical notes

- **ID continuity:** FR-1 through FR-31 plus FR-9a, FR-24a, FR-26a, FR-30a. No gaps, no duplicates. FR-30a precedes FR-31 in document order, which is correct given §4.8 sits before §5.3.
- **Assumptions Index roundtrip:** 9 index entries. Verified each appears inline; the retirement note correctly accounts for the four promoted to requirements.
- **UJ protagonists:** all four named. UJ-1/2/3 carry Maria and Noah consistently; UJ-4's "the Admin" is acceptable for an operator journey.
- **Glossary drift:** none found. Account Tier, Upload Allowance, and Generation Allowance were added late and are used consistently in §5.3, FR-3, FR-10, FR-31, and FR-30a.
- **§13 Renaming Note** is scaffolding rather than PRD content; it should be dropped once the rename completes.
