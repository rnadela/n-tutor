# PRD Quality Review — n-test-reviewer

*Supersedes an earlier rubric run against the pre-UX-update PRD. This run reviews the post-update document (`updated: 2026-08-31`, FR-1 through FR-38, 838 lines) plus `addendum.md`.*

## Overall verdict

This is a genuinely strong PRD and the UX-session edit made it stronger, not looser: the five new FRs (FR-34 to FR-38) sit under the right §4 features, carry real "Consequences (testable):" bullets, and stay at capability level rather than drifting into implementation. The Free-tier Explanation cap — the change with the widest blast radius — reads consistently in all five required places plus the Glossary and both Admin headers; I could not find a drift. What the surgical edit did leave behind is a small number of seams: one three-way contradiction about whether a parent can see their own allowance usage, one scope line (dark mode) that entered §9.1 without an FR to build from, and two places where a refined FR now describes a slightly narrower or slightly earlier condition than the FR it cites. None of these are structural; all are one-paragraph fixes. The larger judgment call is that a document marked `status: final` now carries eleven remaining questions, three of which (§12.2 items 8, 9, 10) are definition gaps that must close before Mastery and Analytics can be implemented at all.

## Decision-readiness — strong

Decisions read as decisions. §12.1 closes eleven drafting questions with the decision *and* what it costs, and the rewritten rows 3 and 7 are better than what they replaced — row 3 now says explicitly that Explanations are "Ungated on safety review, **not** on cost," which is the honest framing. §5.3's "Free is a taste, not a trial" paragraph is the best example: it names a consequence most PRDs would hide (a Free dashboard will look empty) and then pre-emptively forbids the wrong fix — "Do not 'fix' the empty Free dashboard by lowering the FR-27 floor." That is a decision-maker being handed a real trade rather than a smoothed one. The §10 SC 2.2.1 essential-exception argument is likewise recorded rather than assumed, with the narrowing facts stated and an invalidation condition attached.

The six new §12.2 entries are the strongest evidence the UX session was doing real work. Items 6 and 7 in particular are self-incriminating in the right way: item 6 finds that the Explanation cache key defeats the product's own flagship journey (UJ-2 ends on *explain, then retake*), and item 7 finds that SM-4's ≥40% target and the Free 10/month cap were set against different assumptions. Neither is rhetorical; both name options and a revisit condition.

The pressure point is volume against status. `status: final` with 11 open questions, 10 live assumptions, and 4 deferred `[NOTE FOR PM]` decisions is 25 open items. Most are correctly deferred (tier values, SM targets, legal review). Three are not deferrable in the same way — items 8, 9, and 10 are definition gaps in Mastery/Analytics semantics, and a story-writer reaching FR-26/FR-27 will stall on all three. They are honestly flagged, which is why this dimension is still strong, but "final" oversells the readiness of §4.7.

### Findings
- **medium** `status: final` sits on three unresolved semantic definitions (§12.2 items 8, 9, 10; front matter) — Items 8 (does the FR-27 5-question floor count inside FR-26's rolling window or over lifetime), 9 (does a retroactively created Weak Area get marked as such), and 10 (Explanation Allowance per Parent Account or per Student Profile) are definition gaps, not tuning questions. Each has to be answered before FR-26/FR-27/FR-31 can be implemented, and item 8's two readings "give different Weak Area sets for any child with more than a term of history." *Fix:* either close the three inline as decisions with rationale, or downgrade the front-matter status and mark §4.7 as blocked pending them.

## Substance over theater — strong

Nothing here reads as furniture. §2.1 uses three JTBD groups rather than personas, and each one drives something traceable — the parent's "let me check what the app is about to put in front of my child" is FR-12 through FR-14; the student's "explain it in a way I actually understand, without asking a parent who may not remember Grade 5 fractions" is FR-24 and the §7 tone constraint. The Admin JTBD is a single line, which is correct proportion for a single-operator surface.

The NFRs in §10 are product-specific rather than boilerplate. "Correct/incorrect state never conveyed by color alone," the `role="timer"` politeness rule ("a per-second live region would make the test unusable with a screen reader"), and the fractions-render-structurally requirement are all thresholds someone could fail. The new §7 paragraph forbidding fixed literals in result strings — with the deliberate carve-out that grade-state labels *are* fixed literals "because a grade state that is worded differently in two places reads as two different states" — is a real product position, not tone-section padding.

The §11 preamble is unusually honest: "The targets are initial hypotheses, not derived commitments... the numbers themselves are placeholders that should be argued with once there is evidence." Counter-metrics exist and are pointed — SM-C3 explicitly exists to catch the product being used as a memorization loop, and names FR-26 as the structural defense already in place.

### Findings
*(none)*

## Strategic coherence — strong

The thesis is stated in one sentence in §1 and never abandoned: "the highest-signal artifact about what a child is about to be tested on is sitting in their backpack." Every §4 feature serves it. The features that could have been scope creep are either non-goals (§8: not a tutor, not a curriculum, not gamified) or explicitly deferred with a revisit condition (§9.2).

Prioritization follows the thesis rather than ease. FR-26a (Topic normalization) is the hardest requirement in the document and is carried in v0 with a `[NOTE FOR PM]` naming it "the highest-risk requirement in the PRD" and describing the failure mode precisely — "the failure is slow and invisible until it is bad." The addendum's rejection of "basic scorecard analytics" makes the same bet in cost terms: topic tagging on every generated Question is the price of "he does not understand remainders" over "he got 11/15."

The dark-mode addition is argued as thesis-consistent rather than as polish — "the study session this product exists for happens in the evening, often on a tablet in a dim room" (§6). That is the right kind of justification for a scope addition.

### Findings
*(none)*

## Done-ness clarity — adequate

Most FRs would survive an engineer. FR-31's "An allowance is consumed on successful production of the artifact, never on request" is exactly the kind of bright line story creation needs, as is FR-22's insistence that a rationale written "only to a log does not satisfy this requirement." FR-20's `First 11/15 · Latest 14/15 · 3 attempts` example and FR-22's `11/14 graded — 1 question could not be graded yet` example convert prose into acceptance criteria. FR-37 defines a fourth grade state and then traces it through storage, answer key, drill-down, and Mastery — that is the traceability pattern the rest of the document should be held to.

The new FRs match the house conventions cleanly. FR-34, FR-35, FR-36, FR-37, and FR-38 each live under an existing §4 feature (§4.1, §4.1, §4.5, §4.6, §4.6), each carries a "Consequences (testable):" block, and none names a technology. FR-35's requirement that restoration is "exact rather than approximate — the parent resumes at the same state, not at the top of the flow" is testable. §4.1 also gained an "Out of Scope:" block naming the FR-34 warning prompt as deliberately absent, which is correct placement.

The seams are where a refined FR describes a condition its cited FR states differently:

**FR-8 vs FR-31 on when an Upload Allowance is spent.** FR-8 tells the parent that the proceed action "spends one Upload Allowance (FR-31)" at the moment they override the legibility warning. FR-31 says an allowance "is consumed on successful production of the artifact, never on request," and that "an Extraction that fails... consumes nothing." Those are different moments. If Extraction subsequently fails, FR-31 refunds nothing because nothing was charged — but the parent was told at the proceed button that it was already spent. An engineer has to pick one.

**FR-28 vs FR-37 on which Attempts produce unanswered counts.** FR-37 says the *unanswered* state "arises only from a **manually submitted** Attempt." FR-28 says the unanswered count applies "only to **untimed and manually submitted** Attempts." A timed Attempt the student submits manually before expiry, with blanks, satisfies FR-37 and produces *unanswered* Questions — but FR-28's added "untimed" excludes it from the dashboard pairing that FR-28 itself calls non-negotiable ("never a bare '40%'"). The two conditions must match.

**Dark mode has no FR.** §9.1 lists "**Dark mode** across Student Mode and Parent View, with contrast verified in both modes (§6, §10)" as an in-scope item. Every other §9.1 bullet maps to at least one FR. §6 and §10 do give it testable content ("every design token has a dark counterpart"; "a pair that passes in one mode and not the other fails this requirement"), so it is not undefined — but a story-writer extracting from §4 will not find it.

**§7's addressing rule has no FR home either.** "Writing the same sentence twice, or shipping a Parent View string that says 'you', is a defect" is a hard, testable, cross-cutting requirement sitting in the Aesthetic and Tone section, which downstream workflows read as advisory.

Two pre-existing adjectives survive: FR-8's "completes fast enough to feel like part of capture rather than a second wait," and §10's "feel instant" / "short enough not to break a study session." Given how thresholded the rest of the document is, these stand out.

### Findings
- **medium** FR-8 charges the Upload Allowance at a different moment than FR-31 does (§4.2 FR-8, §5.3 FR-31) — FR-8: proceeding past the legibility warning "**spends one Upload Allowance** (FR-31)". FR-31: "An allowance is consumed on successful production of the artifact, never on request," and a failed Extraction "consume[s] nothing." Proceeding is a request, not a produced artifact. *Fix:* restate FR-8's disclosure as "commits you to spending one Upload Allowance if the upload succeeds," or move the charge point to proceed in FR-31 and drop the failed-Extraction carve-out.
- **medium** FR-28 narrows the *unanswered* count to untimed Attempts; FR-37 does not (§4.7 FR-28, §4.6 FR-37) — FR-28: "applies **only to untimed and manually submitted** Attempts." FR-37: "arises only from a **manually submitted** Attempt." A manually submitted *timed* Attempt with blanks produces *unanswered* Questions that FR-28 would then drop from the dashboard, contradicting its own "never a bare '40%'" rule. *Fix:* change FR-28 to "manually submitted Attempts, timed or not" and keep the exclusion scoped to expired timed Attempts only, matching FR-15/FR-37.
- **medium** Dark mode is a §9.1 scope item with no FR (§9.1, §6, §10) — The only §9.1 bullet not backed by a numbered requirement. Its content lives in §6 and §10, which story creation does not source FRs from. *Fix:* add a short FR under §4.1 (or a cross-cutting §10 sub-requirement with an ID) covering token parity, mode selection/persistence, and dual-mode contrast verification, and point §9.1 at it.
- **medium** FR-38 specifies dismissal but not confirmation, while FR-30a depends on confirmation (§4.6 FR-38, §4.8 FR-30a) — FR-38 states "**Only a parent-confirmed flag reaches the Admin queue**" and gives the parent a dismiss action ("a dismissed flag is recorded against the Explanation and goes no further"), but never states the confirm action, where it lives, or what a confirmed flag looks like to the parent afterward. FR-30a then consumes "student flags a parent has confirmed (FR-38)" as an input. *Fix:* add a consequence to FR-38 naming the confirm action, its surface, and the resulting state on the Explanation.
- **low** FR-35's closing bullet is rationale, not a testable consequence (§4.1 FR-35) — "This is stated as a requirement rather than a mitigation because FR-34 expiry is silent..." is an argument for the FR, listed among its consequences. Every other bullet in the document's "Consequences (testable):" blocks is verifiable. *Fix:* move it into the §4.1 feature description or a **Notes:** block, matching how FR-26a and FR-30a carry their rationale.
- **low** Two adjective-bounded requirements remain (§4.2 FR-8, §10 Performance) — "fast enough to feel like part of capture"; "feel instant"; "short enough not to break a study session." *Fix:* give the legibility check and the Explanation foreground wait numeric ceilings, as §10's other bullets already do.

## Scope honesty — strong

Omissions are stated, not inferred. §8 draws seven hard lines and §9.2 defers fourteen more, each with a reason and most with a revisit condition. The `[NOTE FOR PM]` on the OpenAI dependency names the exact refactor surface if the bet goes wrong: "a real refactor across Extraction, generation, grading, and Explanations — the four most load-bearing paths in the product."

§12.2 item 11 is the standout, and it is new. It names three individually defensible decisions — a reachable Free Explanation cap, no notifications, no self-serve upgrade — and shows that they compose into a dead end: "A Free-tier child hits the cap, is told, stops asking — and the parent finds out only if they open Settings and look. Nothing in v0 tells them." It then records this as an accepted cost with the cheapest deferred fix named. That is scope honesty doing real work rather than hedging.

Which makes the one contradiction underneath it worth flagging: §6's Parent View surface list includes "**Allowances** (usage against the account's three counters and its reset date)," Assumption 8 (FR-31, §13 item 8) says "no parent-facing metering beyond the at-cap message," and §12.2 item 11 says the parent "finds out only if they open Settings and look." Three descriptions of three different products. If the §6 Allowances surface ships, Assumption 8 is false and item 11's accepted cost is much smaller than stated. If it does not, §6 lists a surface nobody is building. §9.1's Account Tier bullet is silent on any parent-facing usage view, which leaves the tie unbroken.

The `[ASSUMPTION]` roundtrip is clean: ten inline tags, ten index entries, no orphans in either direction, and each index entry names the right §/FR. The four `[NOTE FOR PM]` callouts likewise roundtrip into §13's "Deferred, not assumed" block. The retirement note ("Retired by the §12.1 decisions...") is the right way to handle assumptions that became decisions.

### Findings
- **high** Three-way contradiction on whether a parent can see their own allowance usage (§6 Surfaces, §5.3 FR-31 / §13 item 8, §12.2 item 11) — §6 lists a Parent View "Allowances (usage against the account's three counters and its reset date)" surface. Assumption 8 asserts "no parent-facing metering beyond the at-cap message." §12.2 item 11 assumes the parent must "open Settings and look." All three cannot hold, and the answer determines whether item 11's "accepted cost" is a real cost or an artifact of a stale assumption. *Fix:* decide whether the Allowances surface is in v0; then either delete it from §6 and keep Assumption 8, or delete Assumption 8, add the surface to §9.1, and rewrite item 11 to reflect that the parent has a place to look.
- **low** FR-34 names a Parent View surface by a name used nowhere else (§4.1 FR-34) — "the Admin-adjacent consumption views a parent can reach." §6 calls this "Allowances"; §4.8 FR-30a's consumption view is Admin-only and per §10/FR-30a inaccessible to Parent Accounts. *Fix:* use the §6 surface name, and resolve against the finding above.

## Downstream usability — adequate

This PRD is explicitly chain-top (§0: "written for the PM, the downstream architecture and UX workflows, and the implementing developer"), so this dimension carries full weight.

The Glossary is strong and load-bearing. Domain nouns are used identically across FRs, UJs, §5, §9, and §11 — I checked *Practice Test*, *Attempt*, *Grade*, *Mastery*, *Topic*, *Weak Area*, *Account Tier*, and the four grade states, and found no drift in case, plurality, or synonym. The Glossary's `Grade` entry was correctly updated to carry all four states with their FR references, and the "Grade vocabulary is separate from the progress vocabulary" note is reinforced identically at FR-19, FR-37, and §7. Cardinality is stated where it matters (Parent Account → Student Profiles, Source Test → Page Images → Practice Tests, Practice Test → Attempts).

ID continuity: FR-1 through FR-38 are all present with no gaps or duplicates, plus FR-9a, FR-24a, FR-26a, FR-30a. Every FR cross-reference I followed resolves to an FR that says what the citing FR claims it says, with the two exceptions logged under Done-ness above. The reciprocal references introduced by the edit are consistent in both directions — FR-25 ↔ FR-28, FR-38 ↔ FR-28 ↔ FR-30a, FR-37 ↔ FR-15/FR-19/FR-23/FR-26/FR-27/FR-28/FR-29, FR-36 ↔ §9.2. FR-26a is placed before FR-26 in §4.7, which is deliberate (normalization precedes Mastery) but is the one place FR order does not ascend.

**The Free-tier Explanation cap check requested for this run: clean.** All five sites plus the Glossary and both Admin-facing headers agree on 10 new Explanations per month on Free, unlimited on Plus/Family/Internal, generation-only, reads never capped, AI grading uncapped —
- FR-31: "capped on Free at 10 new Explanations per calendar month... **Reading an already-generated Explanation is never capped at any tier**"
- FR-24: "10 new Explanations per month on Free, unlimited on Plus, Family, and Internal" + "**Reading an already-generated Explanation is never blocked, at any tier**" + "AI grading (FR-22) remains uncapped at every tier"
- §5.1: "Explanation **generation** is capped at 10 per month... a cost wall, not a safety one"
- §9.1: "capped at 10 new Explanations per month on the Free tier and uncapped on Plus, Family, and Internal, with re-reading an existing Explanation never capped at any tier"
- §5.3 table: Free = 10, Plus/Family/Internal = unlimited, plus the prose "counts **newly generated** Explanations only"
- §3 Glossary (Explanation Allowance): "monthly limits on... newly generated Explanations respectively, counted on three separate counters"
- FR-30a: three counters including "**Explanations generated / allowance**"
- §12.1 row 3: "Free-tier Explanation *generation* is capped at 10/month; reading an existing Explanation is never capped at any tier"

No drift in the number, the unit, the generation-vs-read distinction, or the uncapped-grading carve-out.

What holds this dimension to *adequate* is section-standalone-ness and two small reference defects. §12.2 items 6 and 11 both refer to "the O-1 cap" / "the Free Explanation cap (O-1)". There is no O-1 anywhere in the PRD — no open-question numbering scheme, no §12.2 item labelled O-1, nothing in the Glossary. A downstream reader has to guess it means the Free Explanation Allowance. And SM-6 is titled "Grade dispute rate," measures "share of AI-graded Questions flagged by students, and share of flags the parent upholds," and then says "Validates FR-22" — the flag-and-uphold mechanism is FR-25.

### Findings
- **low** Undefined identifier "O-1" used twice as a cross-reference (§12.2 items 6 and 11) — "the interaction of the O-1 cap with FR-20 and FR-24"; "Accepted cost of the Free Explanation cap (O-1)". No O-1 exists in the document. *Fix:* replace with "the Free Explanation Allowance (FR-31)" in both places, or define the O-n scheme if one is intended.
- **low** SM-6 cites the wrong FR (§11) — SM-6 measures student flags and parent upholds, which is FR-25's mechanism; it says "Validates FR-22." *Fix:* "Validates FR-22 and FR-25."
- **low** UJ-4 has no named protagonist (§2.3) — UJ-1 through UJ-3 carry Maria and Noah; UJ-4 opens "The Admin signs into the admin surface." Every other UJ names a person and carries context inline. *Fix:* name the operator, or state explicitly that UJ-4 is intentionally role-level because the Admin is a single service operator (§4.8's `[NOTE FOR PM]` already assumes one).

## Shape fit — strong

The shape matches the product. This is a consumer product with a genuine two-audience UX problem (a child and a parent reading the same data about the child), and UJs with named protagonists are correctly load-bearing — UJ-1's edge case ("if a page photo is too blurry... asks her to retake just that page, not all three") is the seed of FR-8's per-page scoping, and UJ-2's edge case ("'one half' vs '1/2'") is FR-22. The §7 second-person/third-person addressing rule exists precisely because of the shape; a single-operator tool would not need it.

Formalization is proportionate rather than uniform. §4.8 Admin gets three FRs and a `[NOTE FOR PM]` admitting the depth is deliberately thin; §4.1 through §4.7, the family-facing surface, get thirty. §4.9 Data Retention is stated as FRs rather than as §5 prose, with the reason given inline: "they are stated as FRs precisely so downstream story creation cannot drop them." That is shape awareness, not template compliance.

Brownfield-adjacent inheritance is handled correctly: §6 records the `n-electric` stack as a *decided constraint* that "bounds the architecture workflow's decision space," and pushes the mechanics into the addendum rather than into the FRs. The addendum's per-mechanic transfer table, including "Does not transfer: `cropTopHalf`," and its flagging of the 30-second timeout as "a real gap, not a detail" (which round-trips into §12.2 item 5), is exactly the right division of labor between PRD and addendum.

### Findings
*(none)*

## Mechanical notes

- **Glossary drift:** none found. All Glossary terms used with consistent case and plurality across §4, §5, §9, §11, and §12. The four grade-state literals (*correct*, *incorrect*, *unanswered*, *ungraded*) are identical at §3, FR-22, FR-23, FR-37, §7, and §9.1.
- **ID continuity:** FR-1…FR-38 complete, no gaps, no duplicates; plus FR-9a, FR-24a, FR-26a, FR-30a. SM-1…SM-6 and SM-C1…SM-C3 contiguous. UJ-1…UJ-4 contiguous. FR-31 lives in §5.3 rather than §4 (pre-existing placement).
- **Broken cross-references:** "O-1" (§12.2 items 6, 11) resolves to nothing. SM-6 → FR-22 should be FR-22 + FR-25. All other FR→FR references resolve and are semantically accurate except the FR-8→FR-31 and FR-28→FR-37 mismatches logged above.
- **Assumptions Index roundtrip:** clean. Ten inline `[ASSUMPTION]` tags (§4.1 description, FR-1, FR-5, FR-8, FR-10, FR-14, FR-15, FR-18, FR-31, FR-34) ↔ ten §13 entries, each with a correct §/FR locator. The two new entries (9: FR-34 idle window; 10: FR-1 timezone) are correctly indexed. No index entry lacks an inline tag.
- **`[NOTE FOR PM]` roundtrip:** four callouts (FR-26a, FR-30, §9.2 notifications, §9.2 provider) ↔ four "Deferred, not assumed" entries in §13, each with a revisit condition.
- **§12.1 count:** the preamble says "The eleven open questions"; the table has eleven rows. Consistent.
- **§9.1 ↔ FR coverage:** every §9.1 bullet traces to at least one FR except the dark-mode bullet (see Done-ness). §9.2's FR-36 offline paragraph reproduces FR-36's four consequences verbatim in substance, with no drift.
- **§12.2 item 5 ↔ addendum:** the Extraction-timeout gap is stated identically in both, including the "one inherited default that does not transfer" framing.
- **FR ordering:** FR-26a precedes FR-26 in §4.7 (deliberate); FR-34/35 follow FR-4 in §4.1, FR-36 follows FR-20 in §4.5, FR-37/38 follow FR-25 in §4.6. Non-sequential but consistent with grouping-by-feature, which the document establishes in §0.
