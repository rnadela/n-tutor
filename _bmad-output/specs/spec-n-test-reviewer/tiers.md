# Account Tiers and Allowances

Single authoritative numbers table for CAP-10. Any other document naming a limit must reference this file, never restate the figure.

| Account Tier | Student Profiles | Upload Allowance / month | Generation Allowance / month | Explanation Allowance / month |
|---|---|---|---|---|
| **Free** | 1 | 2 | 2 | 10 |
| **Plus** | 2 | 8 | 20 | unlimited |
| **Family** | 5 | 20 | 60 | unlimited |
| **Internal** | unlimited | unlimited | unlimited | unlimited |

All figures are pre-launch guesses with no usage data — recalibrate after the first month of real accounts (open question, tracked in SPEC.md).

## Two different philosophies, on purpose

- **Upload and Generation are positioning levers** — deliberately set below what a family would find useful, so Free demonstrates the loop and Plus is where the product becomes worth having. A Free account will not accumulate enough answered Questions on any Topic to cross the Weak Area floor or fill the Mastery window in a useful period — an empty/near-empty Free dashboard is expected behavior, not a defect. Do not "fix" it by lowering the Weak Area floor.
- **Explanation is a spend ceiling, not a positioning lever** — set above expected usage purely to bound the cost of an uncapped per-question call. A child hitting it is a signal the ceiling was set too low, not evidence Free is working as designed. Raising it does not weaken the Free→Plus argument.
- **Internal** is Admin-assigned only, never reachable by sign-up; for the operator, testers, and friends-and-family.

## Counting and reset

- Three separate counters (Upload, Generation, Explanation), enforced independently — exhausting one never affects the others.
- An allowance is consumed **on successful production of the artifact, never on request.** A failed/abandoned Source Test, a failed generation, and a failed Explanation all consume nothing. A discarded draft does **not** refund the Generation Allowance it already spent.
- A replacement Explanation regenerated after a parent suppression (FR-39) consumes **no** Explanation Allowance at any tier, including Free — the sole free-production path in the product.
- All three counters reset together, atomically, on the **calendar month boundary in the Parent Account's own stored timezone**. A timezone change applies from the next boundary onward, never retroactively.
- Only an Admin can change an account's tier; a tier change takes effect immediately against the current period's counters. No self-serve upgrade exists in v0.
- Moving an account to a tier whose Student Profile limit is below its current profile count blocks creating more profiles; it never deletes existing ones.

## Blocking and surfacing

- Reaching an allowance **hard-blocks** the operation, with a message naming the tier, usage against the limit, and the reset date in the account's own timezone.
- **AI grading is never blocked by any allowance, at any tier** — it is transitively bounded by the Generation Allowance already spent producing the Practice Test.
- **Reading an already-generated Explanation is never blocked by allowance, at any tier**, including at cap. The sole carve-out is FR-39 suppression: a suppressed Explanation is not re-served to that Student Profile, cache hit or not.
- A parent sees all three counters (usage, limit, reset date) on the Parent View Allowances surface without needing to hit a cap first. The Explanation counter additionally appears on the Analytics dashboard, since it is the one counter whose exhaustion lands on the child rather than the parent and v0 has no notifications to announce it otherwise.
- The at-cap message shown to a **student** (Explanation cap only — no other cap is ever a student-facing wall) blames the plan, never the child: no exclamation marks, no apology, no upsell aimed at someone who cannot act on it.
- No running Explanation counter or balance is ever shown to the student — they meet the limit once, at the moment it blocks.
