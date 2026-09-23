# Epic 2 Context: Admin Content Governance

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the operator-facing Admin surface that owns the product's reference data: the Subject / Grade Level taxonomy and the per-account Account Tier assignment. Parents pick a Subject and Grade Level at upload time, and every allowance, limit, and generation path downstream keys off the tier — so nothing in Epics 3 onward has correct inputs until this epic exists. It is deliberately thin: one seeded operator, no roles, no self-service, no bespoke design work, and no enforcement (tier assignment and consumption are view-and-assign only here; blocking at cap ships in Epic 9).

## Stories

- Story 2.1: Subject & Grade Level Taxonomy
- Story 2.2: Parent Account Tier Assignment & Consumption View

## Requirements & Constraints

- An operator can create, rename, enable, and disable Subjects and Grade Levels, and control which Subjects are offered for which Grade Levels. Changes take effect immediately for new selections only.
- Disabling or renaming taxonomy items must never alter existing Source Tests, Practice Tests, or Analytics. Disable removes an item from new-upload selection; rename propagates by reference.
- An operator can list Parent Accounts, see the current Account Tier (Free / Plus / Family / Internal, Free by default), and assign a new one. Tier change is Admin-only — no self-serve upgrade exists — and takes effect immediately against the current period's counters.
- Per-account consumption shows all three allowances (Upload, Generation, Explanation) as usage against limit, rendered against that account's own reset period and stored timezone — never a shared or global period.
- Moving an account to a tier whose Student Profile limit is below its current profile count blocks new profiles; it never deletes existing ones. Internal tier is reachable only by Admin assignment.
- Tier limits and allowance figures are read from the single authoritative tiers table; no screen, message, or constant restates a number.
- Every admin write — taxonomy edits and tier changes — produces an audit row. Audit rows carry the admin action and the account identifier and never child content.
- Server-side authorization: an operator credential cannot satisfy a parent-scoped guard, and a parent credential cannot satisfy an admin guard.
- Passwords stored hashed; all traffic over TLS.

## Technical Decisions

- `admin` is its own NestJS module with a **separate credential store** — a distinct table, distinct login, its own API route namespace, and its own Next.js route group. Operator identities are not Parent Accounts. v0 ships one operator account seeded out-of-band: no roles, no invitations, no signup.
- `admin` **owns** the `Subject` and `GradeLevel` entities plus operator credentials and `AdminAudit` rows. It is the sole writer of them.
- Module boundary rule applies: Account Tier assignment writes `ParentAccount` **through `identity`'s service**, never through another module's Prisma delegate. Cross-module write methods take the caller's transaction client as their first parameter.
- Consumption figures are read through the `allowance` policy module, which owns no entity and computes period windows by reading counts across `sourcetest`, `practicetest`, and `explanation`. The admin view must use that same computation so admin and parent numbers can never disagree.
- Account timezone is an **effective-dated history**, not a mutable field. A period's window is computed from the zone in effect at that period's start; a timezone change applies from the next boundary onward. The admin consumption view reads the same history.
- The three counters are independent and reset atomically at the calendar-month boundary in the account's own zone. An allowance is consumed only on successful production of an artifact.
- Module naming convention: one lowercase single-word module per owned entity cluster; entities PascalCase singular, matching the glossary term.
- Audit rows deliberately survive account deletion (they retain action plus account identifier, never child content).
- `AdminAudit` rows must not carry Question, Explanation, or answer content — same redaction rule as logs and error reports.

## UX & Interaction Patterns

- Admin inherits the base theme **unchanged** and receives no bespoke craft — no custom layouts, no designed empty states, no fourth accent. It runs at `density.compact` on the Parent View accent, via a nested `ThemeProvider` overriding `palette.primary` only.
- Chrome, tables, and labels use the sans family; the `table-cell` type role covers admin tables. Per-account consumption counts use tabular figures so columns align.
- Tap-target floor for Admin is the parent/admin minimum (44px), not the student floor.
- Standing accessibility rules apply here too: every control is a real focusable element with an accessible name, visible focus ring, focus order follows reading order.
- Admin refers to accounts and Student Profiles by name in the third person.
- Admin navigation in v0 comprises three screens: Subjects & Grade Levels, Parent Accounts, and the Flagged Explanations queue (the queue itself belongs to a later epic).

## Cross-Story Dependencies

- Both stories depend on the admin credential store, login, and route group existing — build that once, in whichever story lands first.
- Story 2.1 output feeds Epic 3: the upload Subject/Grade Level picker offers only Admin-enabled combinations for the selected Grade Level.
- Grade Level is also required by Epic 1's Student Profile form (each profile carries exactly one Admin-configured Grade Level).
- Story 2.2 reads the `allowance` module's period-window computation and `identity`'s Parent Account service; it does not implement enforcement — hard blocking at cap is Epic 9.
- The admin nav's Flagged Explanations queue is out of scope here and arrives with Epics 6 and 7.
