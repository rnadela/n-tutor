# Epic 2 Context: Admin Content Governance

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Build the operator-facing governance surface: an Admin can manage the Subject and Grade Level taxonomy that every family selects from at upload, assign each Parent Account its Account Tier, and inspect that account's consumption against all three monthly allowances. This epic produces the reference data nearly every later epic depends on — upload classification, topic canonicalization, mastery comparability across families, and tier-driven limits — and it keeps the vocabulary consistent service-wide so analytics stay comparable. A seed ships the standard Philippine K-12 subject set so a fresh environment can accept uploads without manual taxonomy entry.

## Stories

- Story 2.1: Subject & Grade Level Taxonomy
- Story 2.2: Parent Account Tier Assignment & Consumption View
- Story 2.3: Default Subject Seed

## Requirements & Constraints

**Taxonomy**
- Admin can create, rename, enable, and disable Subjects and Grade Levels, and control which Subjects are available for which Grade Levels. Changes take effect immediately for new selections.
- The Subject–Grade Level mapping is what bounds the parent's upload picker; nothing outside the enabled mapping is offered.
- Disabling removes an item from new selection only. Existing Source Tests, Practice Tests, Mastery, and Analytics are unaffected. Renaming propagates to existing records by reference, never by copying a label onto them.

**Tiers and consumption**
- Tiers are Free / Plus / Family / Internal; Free is the default for a newly registered account. Only an Admin can change a tier — no self-serve upgrade path exists in v0. Internal is Admin-assignable only and never reachable from sign-up.
- Tiers carry no payment or billing meaning in v0; the field exists so pricing can attach later without a data model change.
- A tier change is effective-dated and takes effect immediately against the current period's counts. Moving an account to a tier whose Student Profile limit is below its current profile count never deletes profiles; it only blocks creating more.
- The consumption view shows three independent counters — Upload (Source Tests), Generation (Practice Tests reaching draft), Explanation (newly generated Explanations) — each as usage against that tier's allowance.
- Each account is rendered against **its own** reset period, in its own stored timezone, with period start and end shown. Accounts in a list may sit in different periods simultaneously; the view must not imply a shared month. Admin and parent-facing numbers must never disagree.
- Hard enforcement (blocking at cap) is explicitly out of scope here and ships in the allowance-enforcement epic. This epic is view-and-assign only.
- Allowance figures per tier live in the PRD tier table; it is the single authoritative source — never restate a number elsewhere.

**Seed**
- The default-subject seed is idempotent, keyed on Subject `nameKey` and on the (Subject, Grade Level) pair: re-running creates nothing twice.
- Operator intent wins: a renamed, disabled, or unlinked subject or link is never recreated, re-enabled, or relinked by a later seed run.
- A grade level missing from the mapping causes its links to be skipped, the seed still succeeds, and the skip is reported. The run reports subjects created and links created.
- The approved default mapping (Kindergarten through Grade 12) is in the epics file; use it verbatim.

**Known unresolved**
- De-duplication of flagged-Explanation queue entries reaching Admin by two routes (parent-originated vs. parent-confirmed student flag) is an open question; the queue's identity model is undecided. The flagged queue itself is not a story in this epic.

## Technical Decisions

- `admin` is a separate module with a **separate credential store**: a distinct table, a distinct login, its own API route namespace, and its own frontend route group. An operator credential can never satisfy a parent-scoped guard and vice versa. Admin surfaces are unreachable from any Parent Account.
- v0 admin is deliberately thin: one operator account seeded out-of-band, no roles, no invitations, no self-service operator signup. Revisit before any third-party operator exists.
- **Every admin write produces an audit row** — tier changes, taxonomy edits, queue dispositions. Thin authentication does not mean thin accountability. Audit rows retain the admin action and account identifier but never child content, and deliberately survive account deletion.
- `admin` owns the `Subject` and `GradeLevel` entities and is their sole writer. Account Tier assignment writes the Parent Account **through the identity module's service**, not directly. Topic/Explanation reads go through those modules' services.
- Each module owns an entity cluster and is the only writer of it; cross-module writes take the initiating transaction's client as their first parameter.
- **Allowances are derived, not decremented.** There is no counter column and no reset job. Usage for a period is counted artifacts plus anonymous usage tombstones, scoped to the Parent Account and to the period window. The consumption view computes from the same source the parent-facing and enforcement paths use — do not introduce a second counting implementation.
- The account timezone is an **effective-dated history**, not a mutable field. A period's window is computed from the zone in effect at that period's start; a timezone change applies from the next boundary onward and never re-slices a running period. The admin consumption view reads that same history.
- Generation charges on a Practice Test first reaching draft and never again; a deletion never refunds (tombstones preserve the count).
- The taxonomy's Subject rows scope the canonical Topic set, so Subject identity is load-bearing beyond the upload picker.
- Naming: one lowercase single-word module per entity cluster; entities PascalCase singular matching the PRD glossary term.

## UX & Interaction Patterns

- The Admin surface inherits the shared design theme unchanged, runs at compact density on the Parent View accent, and gets no bespoke craft. Tap targets follow the parent/admin (not student) sizing.
- Admin navigation holds three areas: Subjects & Grade Levels (taxonomy CRUD plus per-grade availability), Parent Accounts (tier assignment plus per-account consumption), and the flagged-Explanation queue.
- Admin addresses accounts and profiles by name in the third person.
- **Data tables** (Taxonomy, Availability, Accounts) follow the shared responsive rule: cards one column on phone, cards two columns on tablet, a real table only at desktop width (≥1200px). Each card uses the row's identifying value as its title, puts row actions at top-right, and renders every other column as a labeled field — nothing the table shows may be dropped.
- **Row actions** follow the shared pattern: icon-only buttons, at most 2 per row including the overflow ⋮; more than 2 actions means all of them go in the ⋮ menu with icon *and* label. Only self-evident icons stand alone (pencil = rename, trash = delete, chevron = expand). Every icon is labeled with the row's object and carries a tooltip; destructive items sit last, after a divider, in the error color.
- State changes that matter (save, enable/disable, tier change) are announced via a live region using the same words displayed.
- Consumption copy names the period's own start and end dates per account rather than a generic "this month".

## Cross-Story Dependencies

- **2.1 → 2.3:** the seed writes against the taxonomy model and respects operator edits made through 2.1, so the taxonomy entities and enable/link semantics must exist first.
- **2.1 → Epic 3:** upload Subject/Grade Level classification reads only what the taxonomy enables for the selected Grade Level. Grade Level also feeds Student Profile creation in Epic 1.
- **2.1 → Epic 7:** Subject scopes the canonical Topic set used by topic canonicalization, mastery, and admin topic curation.
- **2.2 → Epic 9:** this epic surfaces consumption; Epic 9 adds hard blocking at cap. Both must read the same derived-usage computation.
- **2.2 → Epic 1:** tier assignment writes the Parent Account through the identity module and gates the Student Profile limit enforced at profile creation.
- **Epic 1 (1.8, 1.9) → 2.1/2.2:** Admin taxonomy and accounts tables consume the already-shipped shared row-action and card-below-desktop table patterns; reuse them rather than reimplementing.
- The flagged-Explanation queue in the Admin nav depends on Epic 6 explanation flagging and is not delivered by this epic's stories.
