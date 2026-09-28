# Epic 7 Context: Mastery Analytics & Weak Areas

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic turns accumulated Attempt history into the thing a graded paper never gives a parent: a per-Topic picture of what their child has and has not got. Behind the PIN, a parent sees per-Topic Mastery ranked weakest-first, a profile-level score trend, and flagged Weak Areas for one Student Profile at a time, then drills from a Weak Topic into the specific missed Questions and launches targeted practice from that evidence. Underneath, free-form Topic labels emitted at generation are canonicalized per Subject so one concept yields one Mastery value instead of fragmenting into near-duplicates as history grows, and an Admin curates that canonical set. Without canonicalization and curation the dashboard degrades into noise over a term — a slow, invisible failure — so this epic is where the product's core parent-facing promise either holds or quietly rots.

## Stories

- Story 7.1: Topic Canonicalization
- Story 7.2: Mastery Computation
- Story 7.3: Weak Area Identification
- Story 7.4: Analytics Dashboard
- Story 7.5: Weak Area Drill-Down & Targeted Regeneration
- Story 7.6: Admin Topic Curation

## Requirements & Constraints

**Topic canonicalization**
- Generation stays unconstrained — it emits whatever label best describes a Question. Canonicalization happens only at the Mastery-write boundary.
- Canonical Topics are scoped per Subject and deliberately *not* per Grade Level; splitting by level would fragment Mastery for a family with children at different levels.
- A label with no canonical match mints a new canonical Topic carrying a provisional flag. Mastery accrues against a provisional Topic immediately.
- Canonicalization is invisible to parent and student; analytics displays canonical Topics only.

**Mastery**
- Mastery = `correct / (correct + incorrect)` over graded Questions carrying that Topic, across the **5 most recent qualifying Attempts that included that Topic**, weighted equally; fewer than 5 computes over however many exist. Attempts outside the window do not affect Mastery.
- Only the **first Attempt on a given Practice Test qualifies**. Retakes are recorded, scored, and shown in history but never contribute to Mastery. A fresh Practice Test from the same Source Test is a different Practice Test, and its first Attempt qualifies normally.
- `unanswered` and `ungraded` Questions contribute to **neither** term. An `ungraded` answer enters Mastery normally once retry resolves it. Blanks on a timer-expiry auto-submit are `incorrect`, not `unanswered`, and do count in the denominator.
- A parent grade override recomputes affected Mastery immediately.

**Weak Areas**
- A Topic is a Weak Area when Mastery is below 60% **and** at least 5 Questions carrying it have been answered (correct + incorrect only — a skipped Question is no evidence and must not trip the alarm).
- Both the 60% threshold and the 5-question floor are system-level configuration, tunable post-launch, never per-parent.
- Weak Areas sort first on the dashboard and are visually distinguished.

**Dashboard**
- Scoped to one Student Profile at a time, reachable only from Parent View, with a persistent profile switcher.
- Mastery by Topic, ranked weakest-first, filterable by Subject (filter defaults to all Subjects and is stated in the heading when narrowed).
- Leads with an activity summary: released Practice Tests unstarted vs. completed.
- Carries a **single dashboard-level score trend** over the 5 most recent qualifying Attempts **for the profile**, retakes excluded. This is the same count as the Mastery window but a **different scope** — the two select different Attempt sets whenever a profile has more than one Topic in play, and can legitimately move in opposite directions. Each figure must **state its own scope on itself**; a legend elsewhere on the page does not satisfy this. The trend must never be labeled as a record of everything the student did.
- **The skipped count travels with every Mastery figure and is never dropped.** A Topic reads "division with remainders — 40%, 3 unanswered", never a bare percentage, wherever unanswered Questions exist. This holds on the dashboard, in drill-down, and on the per-Attempt summary. Unanswered counts come only from student-submitted Attempts (timed or untimed); a timer-expiry auto-submit contributes none.
- Also surfaces, scoped to the selected profile: grade disputes awaiting resolution and student Explanation flags awaiting disposition, each linking to where it is acted on — plus the Explanation Allowance counter as an **account-level, not per-profile** figure, showing usage against the limit and its reset date, or stating unlimited where the tier has no ceiling.
- **Empty state:** with no completed Attempts, state the mechanism and progress toward it ("Mastery appears once N questions are answered on a topic; N so far"). A blank panel, a zeroed chart, and a bare "no data yet" all fail. The empty state must **not** name the Account Tier as the cause and must carry no upsell — there is no self-serve upgrade path.

**Drill-down**
- Lists the missed Questions with the student's answer and the correct answer. Questions in the `unanswered` state are listed **separately** from missed Questions, and the Topic's Mastery figure carries its unanswered count exactly as on the dashboard.
- A generate action from the Topic view invokes the existing weighted-generation capability, with cost stated before it fires.

**Admin Topic curation**
- Admin can confirm a provisional Topic as-is, merge it into an existing canonical Topic, or rename it — all within that Subject's canonical set.
- A **merge** re-points every Question tagged with the merged Topic to the surviving canonical Topic and recomputes Mastery for every affected Student Profile. Stale post-merge Mastery would silently misreport what a child knows.
- A **confirm or rename** leaves existing Mastery values untouched. Renames propagate by reference.

## Technical Decisions

- **Topic normalization is a three-stage cascade behind one interface:** `normalize(label, subjectId) -> canonical Topic id`. Callers see nothing else, and any stage may be replaced without touching a caller. Two call sites must never match Topics by different rules.
  - Stage 1 — normalize and exact-match (lowercase, strip stopwords, sort tokens).
  - Stage 2 — embed with `text-embedding-3-small`, cosine-compare **in application code** against cached canonical vectors for that Subject, threshold ≈ 0.85. Vectors live in an ordinary Prisma column.
  - Stage 3 — a single LLM call with the candidate list when cosine falls below threshold. This is the **only** stage permitted to conclude "none of these fit" and mint a new canonical Topic, and its output is the provisional one.
  - **pgvector is not adopted**: no unsupported vector column, no vector index, no pgvector Prisma extension.
- **Mastery recompute runs inside the transaction of whatever changed a grade.** Grading in the foreground submit request, the ungraded-retry resolution, the parent override path, and the Topic merge all recompute Mastery **before they commit**. There is no separate recompute job, and there must be no window where a grade exists but the dashboard can read stale Mastery.
- A merge reuses that same recompute path rather than its own — built in from the start, not retrofitted.
- Any call whose output is parsed rather than displayed — including Topic normalization's stage-3 resolution — uses the Responses API with Structured Outputs and a Zod-derived JSON schema. Never Chat Completions `response_format`, never legacy `json_object`.
- Admin Topic curation lives on the separate Admin surface, which inherits the shared theme unchanged at compact density with no bespoke styling.
- **No analytics or result string may be a fixed literal.** Every string describing student work takes the subject as a parameter and resolves address by surface — Student Mode speaks second person, Parent View names the profile in third person. This covers results headers, empty states, at-cap messages, and drill-down copy. Grade-state labels are the sole exception (fixed literals, identical in both rooms).

## UX & Interaction Patterns

- **Mastery table** (ranked, weakest-first, Subject-filterable). Each row carries: Topic name, Mastery % in tabular figures, an inline bar, the answered-question count behind the figure, and the unanswered count where any exist. Weak Areas use the shared Weak Area marker — triangle frame, exclamation glyph, the literal words "Weak Area", plus warning color — and their bar fill switches to the warning color. Row tap opens Topic drill-down. A bare percentage per Topic is explicitly rejected.
- **Trend sparkline.** One sparkline at dashboard level; **no per-Topic trend lines** (per-Topic trend over a rolling 5-Attempt window is noise and implies precision the data lacks). Every plotted Attempt carries a visible point marker so the point count is countable rather than inferred from line length, and the endpoint value is printed in tabular figures. No fill, no gradient, no draw-in animation. Its window and scope are stated with the chart.
- **Retake visibility.** Wherever an Attempt is listed — Parent View and Student Home alike — both scores are shown, the first is marked as the counted one, and retakes are marked as not contributing to Mastery. Neither number is hidden.
- **Drill-down flow.** Missed Questions are shown with the student's answers in the paper role typography used for generated Question content; "Generate more on this" sits directly beneath that evidence with the Topic pre-selected, stating how many Practice Tests it will make and what that leaves of the Generation Allowance, expressed in Practice Tests.
- **Responsive.** Phone: one column, Mastery table full-width, sparkline and summary stacked above. Tablet: sparkline and summary move into a fixed left column beside the table, and the phone row's stacked sub-line becomes real answered / unanswered / Weak Area columns — with no reduction in row density.
- The dashboard band carrying disputes, Explanation flags, and the Allowance counter is a **per-profile digest, not a work list** — two of its three item types have a disposition, the third is a standing figure with none.
- Voice: plain complete sentences, facts, no exclamation marks, no cheerleading, no error codes, no upsell aimed at a child.

## Cross-Story Dependencies

- **7.1 → 7.2 → 7.3 → 7.4:** canonicalization must be in place before Mastery writes; Mastery before Weak Area identification; both before the dashboard can render.
- **7.1 → 7.6:** 7.1 mints provisional Topics but explicitly defers confirm/merge/rename to 7.6.
- **7.6 → 7.2:** a merge must invoke 7.2's Mastery computation through the shared recompute path, not a parallel implementation.
- **7.5 → Epic 4:** targeted regeneration reuses the existing weighted-generation capability (Story 4.2) rather than adding a generation path, and must surface its cost preview before firing.
- **7.2 ← grading and override paths:** Mastery recompute is triggered from grading, ungraded-retry resolution, and the parent grade-override path — those transactions must be extended, not wrapped by a new job.
- **7.4 ← Epic 6 and grade disputes:** the dashboard surfaces student Explanation flags awaiting disposition and grade disputes, so those record types and their disposition actions must already exist and be linkable.
- **7.4 ← Account Tier / allowance enforcement:** the Explanation Allowance counter reads the account-level usage, limit, reset date, and unlimited case.
- **7.2/7.4 ← grade-state model:** which grade states enter which term, and the timer-expiry rule that converts blanks to incorrect, are owned by the grade-state definition and must not be re-derived here.
- **7.6 ← Admin surface:** curation attaches to the existing Admin surface and its role authorization.
