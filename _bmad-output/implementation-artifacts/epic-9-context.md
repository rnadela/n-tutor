# Epic 9 Context: Account Tiers & Allowance Enforcement

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every Parent Account carries exactly one Admin-assigned Account Tier that sets its Student Profile limit and three independent monthly allowances — Upload, Generation, and Explanation. This is the product's only cost control: every upload, generation, AI grade, and Explanation is a paid model call and v0 has no revenue. This epic makes the tier's limits real — enforced at the point of production, surfaced to the parent before they hit a wall, and rolled over on the account's own monthly boundary — without ever taking away something a child has already been shown.

## Stories

- Story 9.1: Account Tier assignment data model & effect
- Story 9.2: Student Profile limit enforcement
- Story 9.3: Upload Allowance enforcement
- Story 9.4: Generation Allowance enforcement
- Story 9.5: Explanation Allowance enforcement
- Story 9.6: Allowances surface & atomic monthly reset

## Requirements & Constraints

**Tier table — the single authoritative source for every allowance figure. Never restate these numbers elsewhere; read them from one place.**

| Account Tier | Student Profiles | Upload / month | Generation / month | Explanation / month |
|---|---|---|---|---|
| Free | 1 | 2 | 2 | 10 |
| Plus | 2 | 8 | 20 | unlimited |
| Family | 5 | 20 | 60 | unlimited |
| Internal | unlimited | unlimited | unlimited | unlimited |

Tiers carry no payment, pricing, or billing meaning in v0; the field exists so pricing can attach later without a data-model change. Internal is Admin-assigned only and never reachable by sign-up. All figures are scheduled for recalibration after the first month of real accounts.

**Assignment.** New accounts default to Free. Only Admin can change a tier (via the Epic 2 admin surface); no self-serve upgrade exists. Moving an account to a tier whose profile limit is below its current profile count never deletes profiles — it only blocks creating more.

**Consumption semantics — charged on successful production of the artifact, never on request.**
- Upload: one unit per successfully committed Source Test. An abandoned capture, a failed legibility check, and a failed Extraction charge nothing. The charge attaches to the Source Test, not to pages.
- Generation: one unit per Practice Test that reaches *draft* — denominated in **Practice Tests**, not requests. One request may produce 1–5 drafts and therefore charge 1–5 units; a job that fails after three drafts land has charged three. Discarding a draft never refunds. Retaking pages after a thin-Extraction warning charges nothing.
- Explanation: one unit per newly generated Explanation. A cache hit charges nothing, a failed generation charges nothing, and a free post-suppression regeneration charges nothing at any tier including Free.
- Three separate counters, enforced independently — exhausting one never affects the others.
- Deletion never refunds, and delete-and-recreate must not become a path to unlimited Free tier.

**Blocking.** Reaching a cap hard-blocks the operation with a message naming the tier, the usage against the limit, and the reset date in the account's own timezone, in the units of the thing blocked. A generic error or silent failure fails this requirement. AI grading is never blocked by any allowance, at any tier — a student must always be able to find out whether they were right. Reading an already-generated Explanation is never capped at any tier.

**Reset.** All three counters roll over on the calendar-month boundary in the Parent Account's own stored timezone, independent of sign-up date, and **atomically together** — a partial reset that clears one counter and not another is a defect. Accounts in different timezones roll over at different absolute moments. A timezone change applies from the next boundary onward and never re-slices the period already running: counts never move, and no period is shortened, lengthened, or reset twice.

**Surfacing.** A parent can read all three counters — usage, limit, and reset date — on the Parent View Allowances surface without entering an at-cap state. The Explanation counter additionally appears on the Analytics dashboard. Admin can view per-account consumption against allowances, rendered against that account's own period so admin and parent views can never disagree.

**Free-tier philosophy (affects how to read a wall, not how to code it).** Free Upload and Generation are deliberate positioning levers set *below* useful. The Free Explanation Allowance is *not* — it is a spend ceiling set *above* expected usage. A child reaching it means the ceiling was set too low, not that the tier is working as designed.

## Technical Decisions

- **Allowances are derived, never decremented.** No counter column and no reset job anywhere. Usage for a period = countable artifacts in the period window plus usage tombstones, scoped to the Parent Account. Upload = Source Tests created in window; Generation = Practice Tests whose status has *ever* reached draft (a durable marker on the row, so a test charges once and never again); Explanation = Explanation rows generated in window. This is what makes the atomic reset and the never-refund rule true by construction rather than by a job.
- **The cap check and the artifact INSERT happen in the same transaction**; database serialization enforces the cap, not an application-level clamp. Racing requests against a cap is an owned test case.
- **Student Profile deletion leaves an anonymous usage tombstone** — Parent Account, period, call class, count, nothing else. Everything about the child is hard-deleted. Parent Account deletion erases fully, tombstones included. A swept uncommitted-capture row leaves no tombstone, since it charged nothing.
- **A suppressed Explanation still counts as consumed**; the free regeneration it entitles carries a flag excluding it from the count — a flag on the row, not a second counter. The counter must distinguish a charged generation from a free one at the point of generation.
- **The account timezone is an effective-dated history, not a single mutable field.** Any period's window is computed from the zone in effect at that period's *start*.
- **`allowance` is a policy module owning no entity** — it holds the period-window computation and the countable predicates, and reads counts through the `sourcetest`, `practicetest`, and `explanation` module services. It must expose the *next* period boundary as a read, not only the current window, because the at-cap message names a reset date. `analytics` reads `allowance`; Account Tier writes go through `identity`'s service, and every admin tier change writes an audit row.
- **No allowance counter, cost figure, or tier label is ever reachable from a student-scoped endpoint.**
- Allowances are not the abuse defense — a global daily spend ceiling across all accounts is the backstop.

## UX & Interaction Patterns

- **Generation Allowance copy is always denominated in Practice Tests**, never in requests or "generations", on every surface and mock. This is a hard copy rule.
- **The generate request is bounded at initiation by remaining allowance**: a parent with 2 remaining cannot select 5. Unreachable counts are shown disabled with the reason stated, never hidden. Both the generate control and the weighted regenerate state their cost in Practice Tests before firing.
- The legibility-check override point states that proceeding spends an Upload Allowance, so a warned-about upload is a knowing spend. The thin-Extraction warning states that retaking pages costs nothing. The free post-suppression regeneration states that its cost is nothing before it fires — silence would read as an unstated charge.
- **No running allowance counter is ever shown to a student.** The Explanation at-cap state is the only allowance figure a student ever sees: a plain statement naming the limit and the reset date, blaming the plan and never the child. Everything else on Results stays functional at cap — the full answer key, every previously generated Explanation, the dispute flag, and Retake.
- The Explanation readout on the Analytics dashboard is the one figure in that band not scoped to the selected Student Profile — the allowance is held by the Parent Account and spent across every profile under it, and the readout must say so.
- Allowance blocks are announced via a live region using the same words displayed. Usage figures use tabular numerals.
- The Allowances surface lives under Parent View Settings and names the current Account Tier, usage against each limit, and the reset date. The timezone control in Settings states which reset date a change takes effect on before saving.

## Cross-Story Dependencies

- Tier assignment is written by the Admin surface (Epic 2, Story 2.2); this epic owns the data model, the default, and the effect of the tier.
- Enforcement points sit inside features owned by earlier epics: profile creation (1.3), Source Test upload commit (3.4), generation and weighted regeneration (4.1, 4.2), Explanation request (6.1), free regeneration after suppression (6.4), and the Analytics dashboard (7.4).
- The reset boundary depends on the per-account timezone captured at registration (Epic 1) and editable in Settings.
- Usage tombstones interact with the deletion paths in Epic 8 (profile deletion husks to a tombstone; account deletion removes tombstones too).
- Grading (5.5) must remain reachable regardless of allowance state.
