---
id: SPEC-n-test-reviewer
companions:
  - glossary.md
  - tiers.md
  - ../../planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/EXPERIENCE.md
sources:
  - ../../planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/prd.md
  - ../../planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/addendum.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. `sources:` are for traceability only.

# n-test-reviewer v0

## Why

A **pain to solve**, for two users at once. A student studying for a test re-reads the test they already took — the worst possible material, since they remember answers, not topics — while the highest-signal artifact for what they're about to be tested on sits unused: the last exam, same unit, same teacher, same format. A parent wants to help but has no way to turn a returned paper into fresh, comparable practice without writing questions themselves, and no way to see *where* their child is actually weak rather than just a score.

n-test-reviewer turns a photographed school test into fresh AI-generated practice: same topics, same question-format mix, new questions. The parent stays the operator and the safety gate — they upload, they review and release every generated Question before a child sees it, and behind a PIN they see every result and per-Topic Mastery. v0 is one family, one flow, done well: photo in, practice out, mastery visible. It is not a classroom tool and not a curriculum library — see Non-goals.

Every model call in the product costs real money against no revenue, which is why Account Tiers and allowances (CAP-10) are load-bearing from day one, not a later add-on.

## Capabilities

- **CAP-1 — Parent account, PIN, Student Profiles, mode switching**
  - **intent:** A parent can create an account with a PIN and one or more Student Profiles, and a shared device can switch between a PIN-gated Parent View and a restricted Student Mode without losing any in-progress parent work to a silent session timeout.
  - **success:** Sign-up creates an account and requires the child-data consent notice; a device defaults to Student Mode bound to one profile; the PIN is required into Parent View (3-strike lockout); after 15 minutes idle in Parent View the device silently returns to Student Mode; on the next PIN entry, every uncommitted draft edit, upload-in-progress, and grade-override-in-progress is restored exactly where it was left.

- **CAP-2 — Source Test upload**
  - **intent:** A parent can turn 1–10 photographed pages of a test into a classified, legibility-checked Source Test ready for generation.
  - **success:** Pages captured by camera or selected from the library (freely mixed) appear as a reorderable, retakable, deletable strip; Subject and Grade Level are required before submit; a single batch legibility check flags unreadable pages by number with a scoped retake; committing consumes exactly one Upload Allowance unit, and only on success.

- **CAP-3 — Extraction and Practice Test generation**
  - **intent:** The system reads a committed Source Test into a structured, reusable Extraction, then generates 1–5 new Practice Tests reproducing its topic and format mix, plus a weighted regeneration targeted at one Weak Area Topic.
  - **success:** Extraction spans all pages as one ordered document, preserves cross-page context (e.g. a shared passage), records uninterpretable content rather than guessing, and persists so regeneration works after Page Images expire; no generated Question is verbatim from the source; the requested count is clamped server-side to the remaining Generation Allowance and its cost is stated before the parent confirms.

- **CAP-4 — Parent review and release**
  - **intent:** A parent reviews every Question of a *draft* Practice Test, edits or deletes any of them, optionally sets a countdown timer, then releases it to the student or discards it.
  - **success:** No *draft* Practice Test is ever visible in Student Mode; an edited Question is exactly what the student is graded against; deleting the last Question discards the test with an explicit no-refund warning; release is irreversible and immediately visible in Student Mode; an enabled timer carries three fixed, non-escalating warnings (5 min / 1 min / 20 s).

- **CAP-5 — Taking a Practice Test**
  - **intent:** A student takes a *released* Practice Test one Question at a time, in the input matching its format, can jump to any Question via a question map, submits (with a path back to any unanswered Question), and can retake a completed test.
  - **success:** The Student Mode list is flat, unstarted-first then completed-newest; an in-progress Attempt survives backgrounding, refresh, and lost network (answering/navigating keep working offline); submission itself requires network and is never silently retried; a timer that expires offline auto-submits on reconnect graded at the expiry moment; a retake creates a new, separately-visible Attempt without touching Mastery.

- **CAP-6 — Grading, reveal, Explanations, flags, suppression, disputes**
  - **intent:** Every Question resolves to exactly one of four grade states; the student sees an immediate score and full answer key; can request a cached, on-demand Explanation for any Question; can flag an Explanation or dispute a grade; a parent can confirm a flag, suppress the Explanation for their own child with a free regenerated replacement, or override a disputed grade.
  - **success:** Grade-state writing follows the single table in `glossary.md` exactly (an expired-timer blank is `incorrect`; a manually-submitted blank is `unanswered` and never overwritten by grading); score = correct / all presented Questions, shown in original test order; an Explanation is generated only on request, cached, and reading a cached one is never blocked by allowance except by suppression; a student flag reaches the Admin queue only after parent confirmation; a suppressed Explanation stops being served to that Student Profile (cache hit or not) but stays retained and parent-readable; a parent's grade override recomputes score and Mastery while keeping the original AI grade and rationale visible and marked as parent-adjusted.

- **CAP-7 — Analytics and Mastery**
  - **intent:** The system normalizes every generation-time Topic label onto one canonical Topic per Subject, computes a rolling per-Topic Mastery and Weak Areas from it, and gives the parent a dashboard with drill-down into missed Questions and a weighted-regeneration action.
  - **success:** Two differently-worded emissions of the same concept resolve to one Mastery value; a Topic is a Weak Area at <60% Mastery with ≥5 answered Questions (correct+incorrect only); Mastery is a rolling window of the 5 most recent qualifying Attempts (retakes excluded); the dashboard never shows a Mastery percentage without its paired unanswered count; an all-empty Free-tier dashboard states the mechanism and progress toward it, never the tier as the cause.

- **CAP-8 — Admin configuration**
  - **intent:** An Admin manages the Subject/Grade-Level taxonomy, assigns Account Tiers, and reviews per-account allowance consumption and flagged Explanations.
  - **success:** Disabling a Subject removes it from new uploads only, leaving existing data untouched; renaming propagates by reference; a tier change takes effect immediately against the current period; consumption is rendered against each account's own reset period; the flagged-Explanation queue carries the Practice Test's Grade Level as context and keeps a suppressed item listed, marked suppressed.

- **CAP-9 — Data retention and deletion**
  - **intent:** Page Image bytes are removed automatically 90 days after upload without breaking future regeneration, and a parent can delete images early, a Student Profile, or the whole account on demand.
  - **success:** Expiry and early deletion delete stored bytes, not just references, while the Extraction and everything derived from it survive; Student Profile deletion removes that profile's data and is distinct from archiving; account deletion removes everything including any FR-35 uncommitted state; every deletion path requires the account password and an explicit irreversibility confirmation naming what is destroyed; no deletion leaves orphaned files.

- **CAP-10 — Account Tiers and allowance enforcement**
  - **intent:** Every Parent Account carries exactly one Admin-assigned Tier that fixes its Student Profile limit and three independently-tracked monthly allowances, enforced with named, atomic, hard blocks.
  - **success:** A new account is Free by default; the three counters (Upload, Generation, Explanation — figures in `tiers.md`) reset together atomically on the account's own calendar-month boundary in its stored timezone; consumption is charged only on successful production; a blocked action states tier, usage, and reset date; AI grading and reading an already-produced Explanation are never blocked by any allowance.

## Constraints

- Hard OpenAI dependency; no provider-abstraction layer in v0 — a provider price, terms, or outage event means a real refactor across Extraction, Generation, Grading, and Explanation, an accepted risk.
- The parent review gate (CAP-4) is mandatory between generation and student visibility — no path may auto-release a generated Question.
- Every AI call class (not only the vision call) must run under provider terms excluding submitted content — including a child's typed free-text answers — from model training.
- Page Image bytes hard-delete 90 days after upload; the Extraction is the thing that must survive so regeneration keeps working photo-free. Nothing may couple regeneration to stored image bytes.
- One credentialed Parent Account per family; Student Profiles carry no credentials of their own; a shared device is bound to one Student Profile with PIN-gated Parent View — rules out per-child login and any co-parent/multi-account sharing model.
- Score (`correct / all presented Questions`) and Mastery (`correct / (correct+incorrect)` excluding *unanswered*) are deliberately different measures and must never be collapsed into one figure — see `glossary.md`.
- Every allowance block is a named hard stop (tier, usage, reset date), never a silent failure or generic error; AI grading and reading an already-generated Explanation are exempt from every allowance at every tier.
- The inherited stack — Turborepo/pnpm workspaces, NestJS+Prisma+PostgreSQL, Next.js+React+MUI, JWT+argon2, local-filesystem image storage, Playwright — is a decided constraint from the sibling `n-electric` project, not an open choice; exact versions and module boundaries are authoritative in the architecture-spine companion.
- Student-facing surfaces target WCAG 2.1 AA; dark mode ships in v0 across both Student Mode and Parent View with every contrast pair verified in both modes — not a stretch scope item.
- Destructive account actions (Student Profile deletion, Parent Account deletion, early Page Image deletion) require the account password, never the Parent PIN — the PIN gates a mode, the password gates destruction.

## Non-goals

- Not a classroom tool: no teacher accounts, rosters, or assignment distribution.
- Not a curriculum or content library: generates only from what a parent uploads, no question bank, no curriculum-alignment claim.
- Not a grading system of record, and not a tutor — Explanations explain one Question with no conversational back-and-forth.
- Not gamified: no streaks, points, leaderboards, badges, or rewards, in v0 or ever.
- Not a document scanner: photos only; PDF and general OCR are out of v0.
- Not multi-parent: one Parent Account per family, no co-parent sharing, in v0.
- No monetization, billing, or self-serve tier upgrade in v0 — tiers exist and are enforced but are Admin-assigned only, unpriced.
- No notifications of any kind in v0 (push or email on student completion) — the Analytics activity summary is the v0 answer to "did my child do it."
- No native mobile apps; no offline test-taking beyond the CAP-5 in-Attempt carve-out; English only; no recall of a released Practice Test; no per-family Weak-Area-threshold configuration.

## Success signal

A parent photographs a returned test, reviews and releases a generated Practice Test, and their child completes it and reads at least one Explanation — all inside one sitting, without the parent writing a single question. Concretely, against the PRD's own hypotheses (recalibrate after the first month of real accounts, see Open Questions): ≥80% of started uploads reach a released Practice Test (SM-1), ≥70% of released Practice Tests get a completed Attempt within 7 days (SM-2), and ≥50% of Parent Accounts upload a second Source Test within 30 days of the first (SM-3) — the last one being the product thesis end to end: a family came back.

## Assumptions

- Shared-device pattern (one family tablet) is the dominant usage mode; a student on their own phone is served by the same PIN mechanism.
- One timezone per Parent Account, captured at sign-up and editable in Settings, is sufficient for allowance-period boundaries.
- 15 minutes is the right Parent View idle window; 10 Page Images is a sufficient per-Source-Test ceiling; the legibility check is advisory, not blocking; 5 Practice Tests is the right per-request generation cap; recall/unrelease of a released Practice Test is unneeded in v0; the timer defaults off; the fixed 5 min/1 min/20 s timer-warning thresholds serve every configured duration; a running timer tracks wall-clock across interruption without pausing.
- The architecture-spine companion's OpenAI model family (GPT-5.6, aliases sol/terra/luna) is real and correctly tiered, but the configured ids are still rolling aliases, not resolved snapshots — must be pinned in configuration before build.

## Open Questions

- Legal review of the parent-consent-at-sign-up child-data posture is outstanding; blocks opening public registration, not development.
- The Topic-normalization matching mechanism has an architecture answer, but the PRD calls FR-26a the single highest-risk requirement in the build and there is still no operator remedy for a bloated canonical Topic set — a build-time watch item.
- Tier allowance values (`tiers.md`) and the Success signal's targets are pre-launch guesses with no usage data; recalibrate after the first month of real accounts.
- The exact derivation from a Source Test's question count to a generated Practice Test's default question count is unspecified by the PRD and unresolved by the architecture spine.
- The Explanation cache key includes the specific answer, so a retake that misses the same Question a different way charges a new Explanation Allowance unit; three unweighed options exist, and the choice also gates the free-replacement (suppression) cache-key design.
- SM-4 (Explanation engagement, ≥40% target) was set against different assumptions than the Free-tier Explanation cap of 10/month — recalibrate together, or restate SM-4 as measured on uncapped tiers only.
- Nothing in v0 tells a parent, at the moment it happens, that their child hit the Explanation cap mid-session — the discoverability half (dashboard + Allowances counters) is addressed, the moment itself is not; accepted as a narrowed cost.
- The Weak Area 5-question floor never states its counting window — inside Mastery's rolling 5-Attempt window, or lifetime — the two readings produce different Weak Area sets for any child with more than a term of history.
- Whether a retroactively-resolved-`ungraded` batch that creates a new Weak Area is marked as such, distinct from new student work, is unresolved.
- Whether the Explanation Allowance is scoped per Parent Account or per Student Profile is moot today (the only finite tier is single-profile) but unwritten — must be settled before any multi-profile tier gets a finite Explanation cap.
- Admin-queue de-duplication when one Explanation is flagged via both the parent's own flag and a parent-confirmed student flag is unspecified.
- (From the UX companion, still open there) How the parent-switcher's per-child "outstanding work" signal renders when it isn't cheap to compute; no Key User Journey exercises Student Profile management, PIN change, Allowances review, or deletion end-to-end; the reading that generation-progress durability means only "immediacy is lost, not the work" needs explicit stakeholder confirmation; whether the flagged-Explanation Admin queue deserves design craft beyond the inherited theme is an open candidate.
