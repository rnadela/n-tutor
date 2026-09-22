---
stepsCompleted: ["step-01", "step-01-dedup", "step-01-confirmed", "step-02", "step-03", "step-04"]
inputDocuments:
  [
    _bmad-output/planning-artifacts/prds/prd-n-test-reviewer-2026-08-29/prd.md,
    _bmad-output/planning-artifacts/architecture/architecture-n-test-reviewer-2026-09-01/ARCHITECTURE-SPINE.md,
    _bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md,
    _bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/EXPERIENCE.md,
  ]
---

# n-test-reviewer - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for n-test-reviewer, decomposing the requirements from the PRD, UX Design, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: A prospective parent can create a Parent Account with an email address and password, and sign in on any device. Includes email/password validation, terms + child-data consent acceptance recorded with timestamp and notice version, duplicate-email rejection that does not reveal account existence, persistent session until explicit sign-out, emailed password reset, and one per-account timezone captured at sign-up (device default, editable in Settings) that bounds every allowance period.

FR-2: A Parent Account holder can set and change a numeric Parent PIN that gates entry into Parent View. Required on every Student Mode → Parent View transition including after restart; changing it requires the current PIN or account password; 3 consecutive failed entries lock Parent View for a cool-down that persists across restart; the PIN is hashed and never displayed after being set.

FR-3: A parent, in Parent View, can create, rename, set the Grade Level of, and archive Student Profiles. Active-profile count is bounded by Account Tier (FR-31); each profile requires a display name and exactly one Admin-configured Grade Level; archiving hides from Student Mode selection but preserves Attempt/Mastery history; changing Grade Level does not alter existing Practice Tests.

FR-4: A user can switch a device between Student Mode (bound to one Student Profile) and Parent View. Initial binding is set at first Student Profile creation; on a multi-profile device, deliberately exiting Parent View prompts for which profile to bind to (a silent expiry per FR-34 cannot prompt and falls back to last-bound); in Student Mode no upload, generation, release, cross-profile data, or Analytics surface is reachable by navigation or direct URL, and the only path out is the PIN prompt.

FR-34: Parent View expires after a period of inactivity and the device returns to Student Mode without any user action. The idle window is 15 minutes; expiry is silent (no warning, no countdown); it falls back to the last-bound Student Profile without a prompt; re-entry requires the PIN and the FR-2 cool-down applies identically; applies to every Parent View surface.

FR-35: Every piece of uncommitted parent input in Parent View persists across an FR-34 expiry without an explicit save, and is restored exactly on re-entry. Covers per-Question draft edits, draft review position, an in-progress grade override (excluding the AI rationale, which is re-read on restoration), and a partially completed upload (captured/selected Page Images, order, Subject/Grade Level chosen so far). Retained state is held server-side only, keyed to the Parent Account, never written to client storage; restoration happens strictly after PIN re-entry; a cross-profile fetch of retained state is rejected server-side; retained state carries its own TTL.

FR-5: A parent can add multiple Page Images to a single Source Test, using the device camera or the device photo library. Accepts 1 to 10 Page Images; camera adds one at a time, library selection is multi-select adding all in one action, both append to the end and mix freely in any order; supported formats are JPEG, PNG, WebP, and HEIC/HEIF determined by byte inspection, not client-declared type; HEIC/HEIF is converted server-side; EXIF orientation is honored; when camera is unavailable, denied, or absent, photo-library selection remains a first-class path to the same Source Test with guidance on re-enabling camera access.

FR-6: A parent can reorder, retake, and delete individual Page Images before submitting a Source Test. Page order is explicit and visible before submission; deleting a page renumbers the remaining pages without reprocessing them; submitting with zero pages is blocked.

FR-7: A parent must assign exactly one Subject and one Grade Level to a Source Test before submitting it. Subject options are limited to those the Admin has enabled for the selected Grade Level; Grade Level defaults to the Student Profile's Grade Level and is overridable; submission is blocked until both are set.

FR-8: The system evaluates each Page Image for readability and reports unusable pages before generation begins. Runs once, as a single batch over all pages, immediately after capture finishes; a failing page is identified individually with a retake action scoped to it; reports per-page confidence rather than one pass/fail; the parent may override and proceed; the proceed action states it commits the Source Test and spends one Upload Allowance, charged only on successful upload — abandoning spends nothing.

FR-9: The system produces a structured Extraction from a submitted Source Test, capturing its Questions, Question Formats, and Topics. Spans all Page Images as one document in page order; cross-page context (e.g. a shared reading passage) is preserved and reproduced in generation; each question gets exactly one Question Format and at least one Topic; uninterpretable content is recorded as such rather than guessed at; Extraction is persisted and reused for later generations, including after Page Images expire; fractions are carried in structured form; not exposed as a product surface in v0.

FR-9a: When an Extraction yields few usable questions relative to the pages submitted, the system tells the parent before generation proceeds, showing the usable-question count and the page count, offering proceed or retake. Never hard-blocks; choosing to retake pages consumes no Generation Allowance.

FR-10: A parent can generate 1 to N Practice Tests from one Source Test, for one Student Profile. The per-request maximum is 5, further bounded by remaining Generation Allowance, bounded at initiation with unavailable counts shown disabled and the reason stated, and clamped server-side independent of what the client sent. Cost is stated in Practice Tests before confirmation. Each generated Practice Test defaults its Question count from the Source Test's own count, covers the Extraction's Topics, reproduces its format mix proportionally, and multiple Practice Tests from one Source Test are materially different from each other and from the source. No verbatim copies. Every Question carries its correct answer, Topic(s), and (for Multiple Choice) plausible distractors; fractions are emitted in structured renderable form. Generation runs asynchronously with visible progress the parent can leave and return to; failure leaves the Source Test intact and retryable without re-upload.

FR-11: A parent can generate additional Practice Tests weighted toward a specific Topic from Analytics. Reuses the originating Source Test (no new upload); bounded, clamped, and priced identically to FR-10.

FR-12: A parent can review every Question in a draft Practice Test before release, including its correct answer and Topic, in one reviewable list. A draft Practice Test never appears in Student Mode.

FR-13: A parent can edit a Question's text, answer options, and correct answer, or delete the Question entirely, in draft state only. Edits are what the student is later graded against; Questions can be deleted until one remains; deleting the last Question discards the Practice Test after a confirmation stating that the already-spent Generation Allowance is not refunded.

FR-14: A parent can release a draft Practice Test to a Student Profile, or discard it. Release transitions to released and makes it visible in Student Mode; discard removes it from all student-facing surfaces and Analytics; release is irreversible — a released Practice Test cannot be edited.

FR-15: A parent can enable an optional countdown timer on a Practice Test and set its duration before release. Off by default with a suggested duration derived from question count; configurable up to release, never after; when enabled, remaining time is visible throughout the Attempt; three non-escalating warnings are mandatory at 5 minutes, 1 minute, and 20 seconds remaining; auto-submit is announced when it happens; on expiry the Attempt auto-submits and every unanswered Question is graded incorrect (the one path by which a blank becomes incorrect rather than unanswered).

FR-16: A student can see their released and completed Practice Tests as a single flat list (not grouped by Subject), each labeled by Subject and state. Sort order is fixed: all released first (whether or not an Attempt is in progress), then completed newest-first within each band; every completed Practice Test remains reachable indefinitely with no system-initiated archiving; three list conditions are distinguishable — released/no Attempt, released/Attempt in progress, completed.

FR-17: A student can answer each Question using the input control appropriate to its Question Format — single-select options for Multiple Choice, an inline blank for Fill-in-the-Blank, multi-line free text for Short Answer. The student can navigate backward/forward and change answers before submitting; a question map lists every Question with Answered/Not answered progress state and jumps directly to any one; the map shows progress state only, never correctness or a score; no correctness feedback is shown before submission.

FR-18: An in-progress Attempt survives app backgrounding, refresh, and device sleep; entered answers are retained on return; a running timer continues to reflect elapsed wall-clock time across interruption, never pausing.

FR-19: A student can submit an Attempt, which grades it and transitions the Practice Test to completed. Submission with unanswered Questions requires an explicit confirmation naming the count, with a path back to those Questions via the question map; unanswered Questions on a manual submission are recorded as unanswered (not incorrect), regardless of whether the test was timed; submission is irreversible for that Attempt.

FR-20: A student can retake a completed Practice Test, producing a new distinct Attempt; prior Attempts remain in history; Question order may shuffle, content is unchanged; retake Attempts are scored and visible but excluded from Mastery; wherever a multi-Attempt Practice Test is shown, the first Attempt's score, the latest Attempt's score, and the Attempt count are shown together with the first identified as the one counting toward Mastery; a single-Attempt Practice Test shows one score with no first/latest framing.

FR-36: An in-progress Attempt tolerates loss of network: answering and navigating continue to work offline on the same retention basis as FR-18. Submission requires the network — a submit attempted offline is refused with a plain statement and the Attempt stays open with every answer intact, never retried silently. A timer that expires while offline auto-submits on reconnect, graded against the expiry moment, not the reconnect moment; nothing entered before the drop is lost. This is the sole network-optional carve-out in the product.

FR-37: Every Question within an Attempt carries exactly one of four grade states — correct, incorrect, unanswered, ungraded — per the single authoritative table: written-when, score-denominator inclusion, Mastery inclusion, Weak Area floor inclusion, and display treatment for each. The unanswered state is written only at manual submission with a blank and cannot arise from an expired timed Attempt (which grades blanks incorrect instead). Grading never overwrites an unanswered state. All four labels are fixed literals identical on every surface, kept deliberately distinct from the in-test progress vocabulary (Answered/Not answered).

FR-21: The system grades Multiple Choice Questions by exact option match, deterministically and identically across repeated Attempts with the same answer, with no AI call. Applies only to a Question the student actually answered — an unselected option is not graded incorrect by this rule.

FR-22: The system grades Fill-in-the-Blank and Short Answer Questions on semantic equivalence to the correct answer, tolerant of spelling/casing/whitespace/notation/phrasing differences and scoped to the Question's subject matter. Applies only to an actually-answered Question. Every AI-graded Question records a grade and a short rationale, persisted with the Attempt and readable by the parent on the Question's own row in Attempt detail. If AI grading is unavailable, the Attempt still submits and scores, with affected Questions marked ungraded and retried the next time that Attempt's results screen is opened (by either party, view-triggered, no background job); the results header scores only the gradable Questions while any remain ungraded, stating the excluded count and reason; a Question that resolves is marked as newly graded.

FR-23: A student sees the full answer key immediately after submitting an Attempt, and it stays reachable from Attempt history.

FR-24: A student can request an Explanation for any Question on the results screen. On-demand, cached after first generation, generation bounded by the Explanation Allowance (FR-31) while re-reading an already-generated Explanation is never capped. Explanation language is pitched to the Practice Test's Grade Level (not the Student Profile's).

FR-24a: A parent can read every Explanation that has been shown to their student, and flag one as bad. The parent may originate a flag on any Explanation directly, independent of whether the student flagged it.

FR-38: A student can flag an Explanation as unhelpful or wrong; the flag surfaces to their parent (never directly to Admin) for confirmation or dismissal; only a parent-confirmed flag reaches the Admin Flagged Explanations queue. Flagging never changes what the student is currently reading.

FR-39: A parent can stop a flagged Explanation from being served to their own child, and can request a free replacement at no cost to any allowance, at any tier including Free. Suppression is available only once a flag exists on that Explanation (parent-originated or parent-confirmed-student flag); it is scoped to one Student Profile, not a service-wide takedown; the Explanation record is retained, still readable by the parent, and still reaches the Admin queue. Suppression is checked at serve time on every read path (not encoded only in a cache key) so a suppressed entry is never re-served from cache. Suppression is not reversible in v0 — the parent-facing confirmation states this — and the only forward path is the free regeneration, which produces a different Explanation.

FR-25: A student can flag a Question whose grade they believe is wrong, surfacing it to the parent on the Analytics dashboard for that Student Profile; the parent can override the grade in Attempt detail, which recomputes the Attempt score and the affected Topic's Mastery while retaining the original AI grade and rationale.

FR-26a: The system maps each Topic emitted at generation onto a canonical Topic within its Subject before that Topic is used for Mastery, keeping generation unconstrained while keeping Mastery comparable across Attempts.

FR-26: The system maintains a Mastery value per Topic per Student Profile — correct / (correct + incorrect) over graded Questions carrying that Topic, computed over the 5 most recent qualifying Attempts weighted equally (fewer than 5 computes over however many exist). Only the first Attempt on a given Practice Test qualifies; retakes are recorded and shown but never contribute. Unanswered and ungraded Questions contribute to neither term. A parent grade override recomputes affected Mastery immediately.

FR-27: The system identifies and surfaces Topics whose Mastery falls below a configured threshold (60%) and which have at least 5 answered Questions carrying that Topic, as Weak Areas; both figures are system-level configuration, never per-parent.

FR-28: A parent can view, per Student Profile, Mastery by Topic (ranked weakest first, filterable by Subject), a score trend over time (single dashboard-level sparkline, retakes excluded, same 5-qualifying-Attempt window as Mastery but a different per-profile scope), and Weak Areas. The dashboard also carries the activity summary, surfaced grade disputes and student Explanation flags awaiting disposition for the selected profile, and the Explanation Allowance counter (an account-level, not per-profile, figure).

FR-29: A parent can drill from a Topic into the specific Questions the student missed on it, and initiate weighted generation from there, with cost stated before it fires.

FR-30: An Admin can create, rename, enable, and disable Subjects and Grade Levels, and control which Subjects are available for which Grade Levels; existing Practice Tests are unaffected by later changes.

FR-30a: An Admin can view Parent Accounts, assign their Account Tier, and inspect consumption against all three allowances, each rendered against that account's own reset period.

FR-32: The system deletes Page Images 90 days after the upload of their Source Test, without requiring any user action. Deletion covers stored image bytes, not merely a database reference; the Source Test, Extraction, and every derived Practice Test/Attempt/Mastery value survive intact; regeneration continues to work from the persisted Extraction; surfaces show an expired state, never a broken image.

FR-33: A parent can delete a Source Test's Page Images ahead of expiry, delete a Student Profile and its data, or delete the Parent Account entirely. Early image deletion behaves like expiry; Student Profile deletion removes that profile's Practice Tests/Attempts/Explanations/Mastery and is distinct from archiving; Parent Account deletion removes the account and everything under it including any FR-35 uncommitted state; every deletion requires an explicit confirmation naming what is destroyed and that it cannot be undone; Student Profile and Parent Account deletion require the account password, not the Parent PIN; deletion leaves no orphaned stored files.

FR-31: The system assigns every Parent Account an Account Tier (Free/Plus/Family/Internal, Admin-assigned, Free by default, no self-serve upgrade) and enforces its Student Profile limit and its Upload/Generation/Explanation Allowances per the §5.3 tier table. The three counters are tracked separately and enforced independently; each allowance is consumed only on successful production of the artifact, never on request or failed attempt; an FR-39 regeneration never consumes an Explanation Allowance unit at any tier. All three reset atomically on the calendar-month boundary in the Parent Account's own stored timezone. Reaching an allowance hard-blocks the operation with a message naming the tier, usage, and reset date; AI grading is never blocked by any allowance; Explanation generation is capped per the tier table while reading an already-generated Explanation is never capped. A parent can see all three counters (usage, limit, reset date) on the Allowances surface without hitting the cap; the Explanation counter additionally appears on the Analytics dashboard.

### NonFunctional Requirements

NFR1: Performance — Student Mode interactions (question navigation, submission, results render) feel instant on a mid-range tablet over home wifi.

NFR2: Performance — Generation is explicitly asynchronous with progress feedback; a parent must be able to leave the screen and return without losing work.

NFR3: Performance — Explanation generation is a foreground wait and must stay short enough not to break a study session.

NFR4: Reliability — No AI failure loses student work: an in-progress Attempt survives interruption (FR-18).

NFR5: Reliability — A failed generation is retryable without re-upload (FR-10).

NFR6: Reliability — Unavailable AI grading degrades to ungraded rather than to wrong (FR-22).

NFR7: Security — Passwords and Parent PINs are stored hashed; all traffic is over TLS.

NFR8: Security — Authorization is enforced server-side per Parent Account for every Page Image, Practice Test, Attempt, and Analytics query; Student Mode restrictions are not client-side-only (FR-4).

NFR9: Security — Parent View is time-bounded: it expires after 15 minutes of inactivity and returns the device to Student Mode (FR-34), enforced server-side — a client that fails to expire does not retain Parent View authority.

NFR10: Observability — Generation, Extraction, grading, and Explanation calls are logged with outcome, latency, and cost attribution per Parent Account, sufficient to answer "why was this test bad" and "what did this family cost."

NFR11: Data lifecycle — Deletion requests propagate to Page Images, Extractions, Practice Tests, Attempts, and Mastery together; a partial deletion that leaves image bytes behind fails the requirement.

NFR12: Accessibility — WCAG 2.1 AA for student-facing surfaces: sufficient contrast, adequate tap targets for a child's hands, screen-reader-labeled inputs, and correct/incorrect state never conveyed by color alone; contrast verified in both light and dark mode.

NFR13: Accessibility — Every timer is exposed to assistive technology as a timer, labeled with what it is counting, and silent except at the three FR-15 warning thresholds; auto-submit on expiry is announced immediately and interrupts, landing focus predictably.

NFR14: Accessibility — The question map is built from real, keyboard-navigable buttons, each individually announced with its progress state, with the student's current position indicated and exposed to assistive technology.

NFR15: Accessibility — Fractions render typographically in generated content via a structured emission, each exposed to assistive technology as a single value with a spoken alternative reading as the number; student answer input remains a raw free-text string, unaffected by the rendering mechanism.

NFR17: Privacy — Third-party AI processing terms must exclude content from provider model training, covering every model call class (Extraction, generation, grading, Explanation), not only the vision call over Page Images.

NFR18: Safety — Every AI-generated Question and Explanation is child-directed content: generation must be constrained to the Source Test's academic subject matter, and uninterpretable Source Test content must not be hallucinated into Questions.

### Additional Requirements

- No starter/generator template: the stack is an inherited, hand-assembled configuration copied from the sibling `n-electric` project (Turborepo + pnpm workspaces, NestJS + Prisma + PostgreSQL, Next.js + React + MUI, Playwright, Docker Compose), not a scaffolding CLI — Epic 1 Story 1 sets up this monorepo directly rather than running a generator.
- Modular monolith with a Postgres-backed queued worker: one NestJS application, `api` and `worker` are the same image with different entrypoints sharing one Postgres; each module owns an entity cluster and is the sole writer of it; every other module reads only through that module's service; the module that initiates a unit of work opens its transaction and every cross-module write method takes that transaction client as its first parameter.
- `ai` is the single provider boundary and the only test seam for nondeterminism: three test tiers — unit/integration with `ai` faked against a real Postgres in a container; E2E (Playwright) full-stack with `ai` still faked; a small opt-in live-provider suite never run in CI. The fake must be able to fail (timeouts, refusals, schema-invalid responses, partial multi-draft success), not only succeed.
- `admin` is a separate module with its own separate credential store, unreachable from any Parent Account.
- `allowance` and `analytics` are policy/read-only modules that own no entity; `allowance`'s cap check runs inside the owning module's own insert transaction under a transaction-scoped advisory lock keyed on Parent Account plus call class, to serialize concurrent requests against the same cap.
- Auth: session = httpOnly/Secure/SameSite=Strict cookie for identity; elevation = an in-memory parent-scoped token for Parent View; entering Student Mode for a profile mints a new session token carrying that Student Profile, and every student-scoped endpoint reads the profile from the token, never from a request parameter; switching profiles requires re-crossing the mode gate.
- Destructive actions (Student Profile deletion, Parent Account deletion, early Page Image deletion) require a fresh account-password re-authentication verified server-side, not the Parent PIN, which gates a mode rather than destruction.
- Job payloads (queue jobs for Extraction/Generation) carry identifiers and parameters only, never Question/Answer/Explanation content or image bytes; handlers load content from the database at execution time.
- Deletion enumeration is exhaustive across all stores: AiCall rows anonymized on Student Profile deletion and deleted on Parent Account deletion; AdminAudit rows retain the admin action and account identifier but never child content and deliberately survive deletion; queued jobs referencing deleted rows fail closed and are discarded; client-held Attempt answers are bound to Attempt+Student Profile, cleared on any profile switch/sign-out/mode-gate crossing, and carry the same 72-hour TTL as server-side uncommitted state.
- Uncommitted Parent View state (FR-35) and the orphaned-capture sweep are one lifecycle with a single 72-hour TTL from row creation, not extended by activity, expiring by outright row deletion; gated on the parent-scoped token within the window so a child cannot restore it either.
- Cost attribution: an `ai`-owned `AiCall` row per completed provider call carrying Parent Account, call class, pinned model snapshot, token counts, computed cost, latency, and a correlation id minted at request/job entry and threaded through every log line, error report, and AiCall row; no log line, trace, error report, or AiCall row ever carries Page Image bytes, extracted Question content, Explanation text, or a child's answers.
- Sentry error tracking on all three runtime containers (api, web, worker), free tier (one project, 5,000 errors/month, one seat, 30-day retention) with `sendDefaultPii: false`, request-body/local-variable/cookie/header capture off, and an explicit `beforeSend` hook that redacts message and exception-value text for validation and provider-fault error classes (default-deny for any unrecognized error type); a client-side rate limit on error reporting is required to protect the monthly quota.
- A global daily spend ceiling is the abuse-defense backstop behind the per-account allowances, surfaced as its own terminal, non-retried fault class with an operator alert, distinct from a client-fault or upstream-fault.
- Operational envelope: single hand-provisioned DigitalOcean Droplet (4 GB minimum) running Docker Compose; images built in CI for linux/amd64, pushed to GHCR tagged by commit SHA and `latest`; `compose.production.yml` and the Caddyfile are scp'd from the repo on every deploy (repo is the source of truth, host copies disposable); Caddy terminates TLS via automatic ACME; one environment, production only, no staging tier in v0; migrations run as a discrete one-shot step before `compose up`, never on container boot; CI/CD via GitHub Actions `deploy.yml` on push to `main` with secrets `DROPLET_IP`, `SSH_PRIVATE_KEY`, `GHCR_TOKEN`; backups cover the uploads volume alongside `pg_dump` with 7-day local retention; rollback targets the previous SHA tag, never `:latest`.
- Stack pins requiring resolution before build: OpenAI model family GPT-5.6 is currently configured with rolling aliases (sol/terra/luna), not resolved snapshot ids — must be pinned in configuration before build.

### UX Design Requirements

UX-DR1: Implement the Clear Room dual-accent theme — `primary-student` (#0F6E78 / dark #71C3CE) and `primary-parent` (#0B5FA5 / dark #7FB6E8) — as one base MUI theme plus a nested `ThemeProvider` overriding `palette.primary` only per surface; every other token stays byte-identical across Student Mode, Parent View, and Admin.

UX-DR2: Implement the full semantic color set (secondary, success, error, warning, info, background-default, background-paper, text-primary, text-secondary, divider) in both light and dark, matched to the measured contrast ratios in DESIGN.md's ratios table, with `divider` held to the SC 1.4.11 3:1 floor as the product's only non-text boundary.

UX-DR3: Implement the two sanctioned state tint tokens (`tintHover`, `tintSelected`) as the only surface tints in the product; neither is ever the sole carrier of a state.

UX-DR4: Implement the inverted surface token set (`background-inverted`, `primary-on-inverted`, `divider-on-inverted`) exclusively for the camera viewfinder chrome; these values are deliberate duplicates of other tokens and must never be aliased, collapsed, or deduplicated by a tidying pass.

UX-DR5: Implement the two-family typography system — Literata (serif, self-hosted) for all generated content (Question text, Explanations, answer keys, wherever they appear including Parent View and Admin) and Source Sans 3 (sans, self-hosted) for all interface chrome — assigned strictly by content type, never by surface.

UX-DR6: Implement the eight-role type scale (question-body, explanation-body, card-title, dashboard-body, table-cell, label, caption, timer) at the fixed sizes/weights/line-heights specified, one scale shared identically across Student Mode and Parent View.

UX-DR7: Apply `tabular-nums` selectively to every numeral that aligns in a column or ticks in place (countdown timer, Mastery percentage, score displays, allowance usage counts, sparkline value readouts), explicit on Literata and declared (harmlessly redundant) on Source Sans 3.

UX-DR8: Implement typographic fraction rendering for all generated content via Literata's native `frac` feature, requiring generation to emit fractions in a structured renderable (numerator/denominator) form rather than a plain string.

UX-DR9: Implement the two density token sets (`density.comfortable` for Student Mode, `density.compact` for Parent View and Admin) governing row-height, card-padding, gap, and section-margin; every component reads the density token, never a hardcoded spacing number; density is independent of breakpoint.

UX-DR10: Implement the two tap-target floors (48px Student Mode, 44px Parent View/Admin) as a minimum `density.compact` must never shrink below.

UX-DR11: Implement the flat-with-borders elevation model — MUI `elevation={0}` everywhere, a 1px `divider`-colored border as every control's sole boundary, and a scrim plus border (never a shadow) separating overlay surfaces (dialogs, menus, Parent PIN entry).

UX-DR12: Implement the semantic radius system — paper role (0–2px square) for anything carrying generated Question or Explanation content, control role (8px rounded) for everything tappable — with the glyph-frame exception limited to grade-state icons and the Weak Area marker only.

UX-DR13: Implement the single focus-ring mechanism — 2px solid outline in the current surface's primary color at 2px offset, evaluated against the surface behind the control rather than the control's own fill — as the sole focus carrier on every focusable element.

UX-DR14: Build the Practice Test card component: pre-tap info (Subject, Grade Level, question count, timer presence and duration, state, score), and the post-retake dense state (`First 11/15 · Latest 14/15 · 3 attempts`, first Attempt marked as the counted one, typeset as fact rather than a scoreboard).

UX-DR15: Build the Question container component (paper role, Literata, capped at the 34rem measure regardless of viewport).

UX-DR16: Build the Explanation panel component as an inline expand beneath its row (never a separate screen or modal), with five states: loading, error (manual retry only), at-cap, loaded, and suppressed.

UX-DR17: Build the Grade-state marker component covering all four states (correct, incorrect, unanswered, ungraded), each carrying four redundant carriers — icon frame shape/border style, glyph, fixed literal text label, row left-rule texture — plus color as a fifth, never-load-bearing-alone carrier.

UX-DR18: Build the Weak Area marker component (solid triangle frame, exclamation glyph, fixed label "Weak Area", warning color), deliberately distinct in shape and glyph from every grade-state marker.

UX-DR19: Build the Answer-key row component (paper role) combining the Question, the student's answer, the correct answer, and the full grade-state marker.

UX-DR20: Build the Question map component: real keyboard-navigable buttons, each individually announced with its progress state, current position indicated and exposed to assistive technology; renders as an openable overlay on phone and a persistently visible rail beside the Question on tablet.

UX-DR21: Build the Mastery table / Mastery row component: ranked weakest-first, Subject filter (defaulting to all, stated in heading when narrowed), inline bar (success fill above threshold, warning fill for a Weak Area), tabular Mastery percentage, the answered-question count behind the figure, and the unanswered count wherever any exist.

UX-DR22: Build the Trend sparkline component: one dashboard-level line only (no per-Topic lines), the 5-qualifying-Attempt window stated with the chart, retakes excluded, a filled dot per plotted Attempt, no draw-in animation.

UX-DR23: Build the Text field component (control role, divider border, focus ring on focus, surface-appropriate minimum tap target).

UX-DR24: Build the Smart fraction field component: a real text input whose value is always the raw typed string and the sole accessible/submitted value, with an adjacent `aria-hidden` typographic-render sibling (never overlaid on the input), degrading to plain text on render failure; flag as carrying real implementation risk requiring its own estimate and test coverage, with the recorded fallback being display-only typographic fractions with a plain input if alignment proves unreliable.

UX-DR25: Build the Page thumbnail component with a visible ordinal and an "expired" state — a flat neutral tile captioned "Photo deleted," never a broken-image glyph or an error color.

UX-DR26: Build the Primary button and Destructive button components per token spec — destructive intent carried by label text and an outlined error-color border, never a filled red button.

UX-DR27: Build the Dialog and Destructive-confirm dialog components — scrim-plus-border separation; the destructive variant names exactly what will be destroyed, requires an account-password re-authentication field, and states the action cannot be undone.

UX-DR28: Build the Snackbar component (flat, bordered, no shadow, no elevation).

UX-DR29: Build the Timer display component: tabular figures that change value in place with no per-tick animation; at the three pre-expiry warning thresholds the value takes the warning color and gains a text label beside it (never color or motion alone); `role="timer"` with `aria-live` raised only at the three thresholds; an `aria-label` with a spoken unit-bearing value on every instance including collapsed and tablet-rail variants; auto-submit announced via `role="alert"` with focus moved to the results heading before the route change.

UX-DR30: Enforce the "every control is a real control" primitive across the product — no `<div>` or `<span>` ever carries an action, `aria-expanded`, or state.

UX-DR31: Enforce the no-fixed-literal-string rule for every result/analytics string describing student work: each takes the subject as a parameter and resolves second-person (Student Mode) or third-person-by-name (Parent View) address at render time through a shared surface-aware address-resolution component (not per-surface duplicated copy); the four grade-state labels are the sole fixed-literal exception.

UX-DR32: Meet the WCAG 2.1 AA floor on student-facing surfaces plus the four explicit hard-case specs: (1) generated-content fractions as `role="img"` with a spoken text alternative, student-input fractions via the real-input-plus-`aria-hidden`-sibling mechanism; (2) the SC 2.2.1 essential-exception argument for the optional, off-by-default, parent-configured, non-extendable timer; (3) question-map keyboard navigation, individual per-cell announcement, and `aria-current` on the active Question; (4) all four grade states announced distinctly via their displayed literal label, never by color alone, and fully readable in a grayscale rendering.

UX-DR33: Implement the standing accessibility requirements across the app: focus order follows reading order; icon-only controls are labeled with the object they act on (including the page ordinal on capture-strip controls); the capture strip is exposed as an ordered list naming each page's ordinal and legibility state; `role="status"` on the generation-progress step list; a live-region announcement using the displayed copy verbatim on every state change that matters (grade resolution, grade override, save, submit confirmation, allowance block, Explanation suppressed); `prefers-reduced-motion` honored everywhere.

UX-DR34: Implement the Take Test responsive layout: single column capped at the 34rem measure with the question map as an overlay on phone; a persistently visible question-map rail (state-only, no score or correctness) beside the Question on tablet, using the extra width the capped measure leaves unused.

UX-DR35: Implement the Analytics dashboard responsive layout: stacked single column (Mastery table full-width, sparkline and summary above) on phone; a fixed left column carrying sparkline and summary beside the Mastery table on tablet, with the phone's stacked sub-line becoming real answered/unanswered/Weak-Area columns and no reduction in row density.

UX-DR36: Every other screen is a single fluid layout per surface, unchanged between phone and tablet; desktop is supported but not optimized, with no desktop-specific work in v0.

UX-DR37: Implement the motion policy: permitted only for question-to-question transitions, Explanation expand/collapse, question-map open/close, page/route transitions, and the generation wait; explicitly banned — any results-reveal flourish (count-up, sweep, celebration), per-tick timer animation, sparkline draw-in animation, streaks/badges/mascots/points/confetti, infinite scroll, hover-only affordances on touch viewports, and modal stacks more than one level deep; `prefers-reduced-motion` honored throughout.

UX-DR38: Implement the continuous-capture interaction: the camera viewfinder stays open across pages with captures accumulating in an ordered thumbnail strip; reorder/retake/delete act only on the strip after capture, never inline in the viewfinder; photo-library multi-select mixes freely into the same Source Test with the shot-vs-selected distinction never surfaced.

UX-DR39: Implement test navigation as linear (Back/Next as the primary path) plus the question map as an escape hatch — never a linear-only flow.

UX-DR41: Implement the seven binding copy constraints from Voice and Tone: an Explanation failure is never framed as the student's fault; the Explanation at-cap message blames the plan, never the child, with no exclamation marks or upsell language; generation-progress copy never claims work will be lost if the parent leaves; Explanation language adapts per Grade Level sourced from the Practice Test (not the Student Profile); Generation Allowance copy is always denominated in Practice Tests; a wrong answer is reported, never punished; suppressed-Explanation copy names the Explanation as the thing that fell short, never the student, with no blame, correction, instruction, or exclamation mark.

### FR Coverage Map

FR-1: Epic 1 - Parent Account sign-up/sign-in
FR-2: Epic 1 - Parent PIN set/change/lockout
FR-3: Epic 1 - Student Profile create/rename/grade/archive
FR-4: Epic 1 - Mode switching Student Mode ↔ Parent View
FR-34: Epic 1 - Parent View idle expiry
FR-35: Epic 1 - Uncommitted parent input persistence across expiry
FR-30: Epic 2 - Admin Subject/Grade Level taxonomy
FR-30a: Epic 2 - Admin Account Tier assignment + consumption view
FR-5: Epic 3 - Multi-page Source Test capture (camera/library)
FR-6: Epic 3 - Page reorder/retake/delete before submit
FR-7: Epic 3 - Subject/Grade Level assignment to Source Test
FR-8: Epic 3 - Per-page legibility check before generation
FR-9: Epic 3 - Structured Extraction (Questions/Formats/Topics)
FR-9a: Epic 3 - Thin-extraction warning
FR-10: Epic 4 - Practice Test generation (1-N, bounded/clamped/priced)
FR-11: Epic 4 - Topic-weighted regeneration from Analytics
FR-12: Epic 4 - Draft review list
FR-13: Epic 4 - Draft Question edit/delete
FR-14: Epic 4 - Release/discard draft
FR-15: Epic 4 - Optional countdown timer config
FR-16: Epic 5 - Student's test list (released/completed)
FR-17: Epic 5 - Answering by Question Format + question map
FR-18: Epic 5 - Attempt survives interruption
FR-19: Epic 5 - Submit Attempt, unanswered confirmation
FR-20: Epic 5 - Retake producing new Attempt
FR-36: Epic 5 - Offline tolerance during Attempt
FR-21: Epic 5 - Deterministic Multiple Choice grading
FR-22: Epic 5 - AI grading of Fill-in-Blank/Short Answer
FR-23: Epic 5 - Answer key on results
FR-37: Epic 5 - Four-state grade model
FR-24: Epic 6 - On-demand Explanation generation
FR-24a: Epic 6 - Parent reads/flags any Explanation
FR-25: Epic 6 - Student grade dispute → parent override
FR-38: Epic 6 - Student flags Explanation → parent confirms
FR-39: Epic 6 - Parent suppresses Explanation + free regen
FR-26: Epic 7 - Mastery per Topic per Student Profile
FR-26a: Epic 7 - Topic canonicalization mapping
FR-40: Epic 7 - Admin Topic curation (confirm/merge/rename provisional Topics)
FR-27: Epic 7 - Weak Area identification
FR-28: Epic 7 - Analytics dashboard (Mastery/trend/Weak Areas)
FR-29: Epic 7 - Drill Topic → missed Questions → weighted regen
FR-32: Epic 8 - Page Image 90-day expiry
FR-33: Epic 8 - Parent-initiated deletion (image/profile/account)
FR-31: Epic 9 - Account Tier + three-allowance enforcement

## Epic List

### Epic 1: Parent Accounts, PINs & Student Profiles
Parent can sign up, sign in, secure Parent View behind a PIN, create and manage Student Profiles, and the device can switch safely between Student Mode and Parent View, including idle expiry and uncommitted-work recovery.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-34, FR-35

### Epic 2: Admin Content Governance
Admin can configure the Subject/Grade Level taxonomy and assign Account Tiers, providing the reference data every later epic depends on.
**FRs covered:** FR-30, FR-30a

### Epic 3: Source Test Capture, Upload & Extraction
Parent can photograph or select a paper test's pages, assign Subject/Grade Level, and the system extracts it into a reusable structured Source Test.
**FRs covered:** FR-5, FR-6, FR-7, FR-8, FR-9, FR-9a

### Epic 4: Practice Test Generation, Review & Release
Parent can generate one or more Practice Tests from a Source Test, review and edit the draft, optionally configure a timer, and release it to a Student Profile.
**FRs covered:** FR-10, FR-11, FR-12, FR-13, FR-14, FR-15

### Epic 5: Taking a Test & Results
Student can take a released Practice Test — answering, navigating, surviving interruption and offline gaps — submit it, and see a graded result with an answer key.
**FRs covered:** FR-16, FR-17, FR-18, FR-19, FR-20, FR-36, FR-21, FR-22, FR-23, FR-37

### Epic 6: Explanations & Grade Disputes
Student can request an Explanation for any Question and flag one as wrong; parent can read every Explanation, override a disputed grade, and suppress a bad Explanation with a free replacement.
**FRs covered:** FR-24, FR-24a, FR-25, FR-38, FR-39

### Epic 7: Mastery Analytics & Weak Areas
Parent can see per-Topic Mastery, a score trend, and Weak Areas per Student Profile, drill from a Weak Area into a targeted regeneration, and Admin can curate the canonical Topic set.
**FRs covered:** FR-26, FR-26a, FR-27, FR-28, FR-29, FR-40

### Epic 8: Retention & Deletion
Page Images expire automatically 90 days after upload, and a parent can delete images early, a Student Profile, or the whole Parent Account, with every deletion propagating completely.
**FRs covered:** FR-32, FR-33

### Epic 9: Account Tiers & Allowance Enforcement
Every Parent Account's Upload, Generation, and Explanation Allowances are tracked and enforced against its Account Tier, resetting atomically on the account's own monthly boundary.
**FRs covered:** FR-31

## Epic 1: Parent Accounts, PINs & Student Profiles

Parent can sign up, sign in, secure Parent View behind a PIN, create and manage Student Profiles, and the device can switch safely between Student Mode and Parent View, including idle expiry and uncommitted-work recovery.

**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-34, FR-35
**Relevant NFRs:** NFR7 (hashed creds/TLS), NFR8 (server-side authz), NFR9 (Parent View server-enforced time bound)
**Relevant UX-DRs:** UX-DR1, UX-DR2, UX-DR3, UX-DR5, UX-DR6, UX-DR7, UX-DR9, UX-DR10, UX-DR11, UX-DR12, UX-DR13, UX-DR23, UX-DR26, UX-DR27, UX-DR28, UX-DR30, UX-DR31, UX-DR33, UX-DR36, UX-DR37 (design system foundation, Story 1.7)

### Story 1.1: Parent Account Sign-Up & Sign-In

As a prospective parent,
I want to create an account with email/password and sign in on any device,
So that I can start using the product.

**Acceptance Criteria:**

**Given** a valid email, password, and terms/child-data-consent acceptance
**When** I sign up
**Then** the account is created, consent is recorded with a timestamp and notice version, and I'm signed in with a persistent session

**Given** an email already registered
**When** I try to sign up with it again
**Then** the request is rejected with a generic message that does not reveal the account already exists

**Given** I've forgotten my password
**When** I request a reset
**Then** I receive an email link that lets me set a new password

**Given** sign-up completes
**When** the account is created
**Then** an account timezone is captured from the device default, editable later in Settings, which bounds later allowance reset periods (Epic 9)

### Story 1.2: Parent PIN for Parent View

As a Parent Account holder,
I want to set and require a PIN to enter Parent View,
So that my child cannot access parent-only controls.

**Acceptance Criteria:**

**Given** no PIN is set
**When** I set one for the first time
**Then** it is stored hashed and required on every Student Mode → Parent View transition, including after app restart

**Given** a PIN is already set
**When** I try to change it
**Then** I must supply the current PIN or my account password

**Given** 3 consecutive failed PIN entries
**When** I attempt another entry
**Then** Parent View locks for a cool-down that persists across restart

**Given** a PIN is set
**When** it has been entered
**Then** it is never displayed back to me

### Story 1.3: Student Profile Management

As a parent,
I want to create, rename, set the Grade Level of, and archive Student Profiles,
So that I can manage practice work per child.

**Acceptance Criteria:**

**Given** Parent View
**When** I create a Student Profile
**Then** it requires a display name and exactly one Admin-configured Grade Level

**Given** an existing profile
**When** I rename it or change its Grade Level
**Then** existing Practice Tests for that profile are unaffected

**Given** an existing profile
**When** I archive it
**Then** it is hidden from Student Mode selection but its Attempt and Mastery history is preserved

**And** active-profile count is not yet capped by Account Tier in this story — that enforcement lands in Epic 9 (FR-31)

### Story 1.4: Student Mode ↔ Parent View Switching

As a parent,
I want to bind a device to a Student Profile and switch between Student Mode and Parent View,
So that my child can use the device safely without supervision.

**Acceptance Criteria:**

**Given** the first Student Profile is created
**When** setup completes
**Then** the device binds to it as the initial Student Mode

**Given** a multi-profile device
**When** I deliberately exit Parent View
**Then** I am prompted which profile to bind to

**Given** Student Mode
**When** any upload, generation, release, cross-profile-data, or Analytics surface is attempted by navigation or direct URL
**Then** it is unreachable

**And** the PIN prompt is the only path from Student Mode to Parent View

### Story 1.5: Parent View Idle Expiry

As a parent,
I want Parent View to automatically return to Student Mode after a period of inactivity,
So that my child is not exposed to parent controls if I walk away.

**Acceptance Criteria:**

**Given** Parent View has been idle for 15 minutes
**When** the window elapses
**Then** it silently (no warning, no countdown) returns to Student Mode bound to the last-bound Student Profile, with no prompt

**Given** expiry has occurred
**When** I re-enter Parent View
**Then** the PIN is required and the Story 1.2 cool-down rule applies identically

**And** this behavior applies uniformly across every Parent View surface

### Story 1.6: Uncommitted Parent Input Survives Expiry (mechanism)

As a parent,
I want in-progress work in Parent View to survive an idle expiry,
So that I don't lose what I was doing.

**Acceptance Criteria:**

**Given** uncommitted parent state exists, held server-side and keyed to the Parent Account, never written to client storage
**When** idle expiry fires
**Then** the state is retained past expiry, carrying its own TTL

**Given** I re-enter Parent View
**When** the PIN is verified
**Then** retained state is restored, and restoration happens strictly after PIN verification, never before

**Given** retained state belongs to a Student Profile different from the one currently bound
**When** restoration is attempted
**Then** the cross-profile fetch is rejected server-side

**And** this story ships the general persistence mechanism only (architecture AD-16); specific content types — draft Question edits (Epic 4), an in-progress grade override (Epic 6), a partially completed upload (Epic 3) — plug into this mechanism as those epics land, each adding one AC here rather than rebuilding it

### Story 1.7: Design System Foundation

As a developer,
I want the base design tokens and primitive components in place,
So that every later epic builds on one consistent system.

**Acceptance Criteria:**

**Given** the dual-accent theme (UX-DR1), full semantic color set (UX-DR2), and the two state-tint tokens (UX-DR3)
**Then** they are implemented as the one base MUI theme every surface reads from

**Given** the two-family typography system and the eight-role type scale (UX-DR5, UX-DR6), and the `tabular-nums` rule (UX-DR7)
**Then** every text role in the product resolves through them, never a one-off style

**Given** the density tokens, tap-target floors, flat elevation model, radius system, and focus ring (UX-DR9, UX-DR10, UX-DR11, UX-DR12, UX-DR13)
**Then** they are implemented as shared primitives, not per-component values

**Given** the Text field, Primary/Destructive button, Dialog/Destructive-confirm dialog, and Snackbar components (UX-DR23, UX-DR26, UX-DR27, UX-DR28)
**Then** they exist as reusable components before any feature story needs them

**Given** the "every control is a real control" primitive, the no-fixed-literal-string/address-resolution rule, the standing accessibility requirements, the single-fluid-layout default, and the motion policy (UX-DR30, UX-DR31, UX-DR33, UX-DR36, UX-DR37)
**Then** they are enforced as shared, cross-cutting rules from the first screen onward

**And** Stories 1.1–1.6 are built on this foundation, not ahead of it

## Epic 2: Admin Content Governance

Admin can configure the Subject/Grade Level taxonomy and assign Account Tiers, providing the reference data every later epic depends on.

**FRs covered:** FR-30, FR-30a

### Story 2.1: Subject & Grade Level Taxonomy

As an Admin,
I want to manage Subjects and Grade Levels and which Subjects apply to which Grade Levels,
So that parents get a correct picker when uploading.

**Acceptance Criteria:**

**Given** the Admin console
**When** I create, rename, enable, or disable a Subject or Grade Level
**Then** the change takes effect immediately for new selections

**Given** a Subject–Grade Level mapping
**When** I enable or disable it
**Then** it controls what is offered to parents at upload (feeds FR-7, Epic 3)

**Given** existing Practice Tests reference a Subject or Grade Level
**When** I later change that item's availability
**Then** those Practice Tests are unaffected

### Story 2.2: Parent Account Tier Assignment & Consumption View

As an Admin,
I want to view Parent Accounts, assign their Account Tier, and see allowance consumption,
So that I can manage the account base.

**Acceptance Criteria:**

**Given** the Admin console
**When** I view a Parent Account
**Then** I see its current Account Tier (Free/Plus/Family/Internal, Free by default)

**Given** a Parent Account
**When** I assign a new tier
**Then** the change is Admin-only (no self-serve upgrade) and effective-dated against the current period

**Given** a Parent Account
**When** I inspect consumption
**Then** I see usage against all three allowances (Upload/Generation/Explanation) rendered against that account's own reset period and timezone

**And** hard enforcement (blocking at cap) is out of scope for this story and ships in Epic 9 — this story is view and assign only

## Epic 3: Source Test Capture, Upload & Extraction

Parent can photograph or select a paper test's pages, assign Subject/Grade Level, and the system extracts it into a reusable structured Source Test.

**FRs covered:** FR-5, FR-6, FR-7, FR-8, FR-9, FR-9a
**Relevant:** architecture AD-28 (byte-sniffed image ingest via sharp/file-type)
**Relevant UX-DRs:** UX-DR4 (inverted surface tokens, camera viewfinder), UX-DR25 (Page thumbnail w/ expired state), UX-DR38 (continuous-capture interaction)

### Story 3.1: Multi-Page Capture (camera + library)

As a parent,
I want to add multiple pages to a Source Test via camera or photo library,
So that I can digitize a full paper test.

**Acceptance Criteria:**

**Given** camera or photo library
**When** I add pages
**Then** 1 to 10 Page Images are accepted; camera adds one at a time, library multi-select adds all in one action; both append to the end and mix freely in any order

**Given** a page is uploaded
**When** its format is determined
**Then** it is decided by byte inspection (JPEG, PNG, WebP, HEIC/HEIF), never by client-declared type; HEIC/HEIF is converted server-side; EXIF orientation is honored

**Given** camera is unavailable, denied, or absent
**When** I need to add a page
**Then** photo-library selection remains a first-class path with guidance on re-enabling camera access

### Story 3.2: Page Management Before Submit

As a parent,
I want to reorder, retake, and delete pages before submitting,
So that I can fix a bad capture.

**Acceptance Criteria:**

**Given** captured pages
**When** I reorder them
**Then** the order is explicit and visible before submission

**Given** a page
**When** I delete it
**Then** remaining pages renumber without reprocessing

**Given** zero pages remain
**When** I try to submit
**Then** submission is blocked

### Story 3.3: Subject & Grade Level Assignment

As a parent,
I want to assign a Subject and Grade Level to a Source Test,
So that the system knows how to extract and generate from it.

**Acceptance Criteria:**

**Given** a Source Test in progress
**When** I select a Subject
**Then** only Subjects the Admin has enabled for the selected Grade Level are offered

**Given** a Student Profile
**When** I start a Source Test
**Then** Grade Level defaults to the profile's Grade Level and is overridable

**Given** Subject or Grade Level is unset
**When** I try to submit
**Then** submission is blocked

### Story 3.4: Legibility Check & Upload Commit

As a parent,
I want to know before generation if any pages are unreadable,
So that I don't waste an upload on a bad capture.

**Acceptance Criteria:**

**Given** capture has finished
**When** the batch legibility check runs once over all pages
**Then** each page reports individual per-page confidence, not just pass/fail

**Given** a failing page
**When** it is identified
**Then** a retake action is offered scoped to that page

**Given** I proceed despite a failing page
**When** I confirm
**Then** the confirmation states it commits the Source Test and spends one Upload Allowance

**And** if I abandon instead, nothing is spent — the Upload Allowance is charged only on successful upload

### Story 3.5: Structured Extraction

As the system,
I want to extract a structured document (Questions/Formats/Topics) from a submitted Source Test,
So that it can drive generation.

**Acceptance Criteria:**

**Given** all Page Images for a Source Test
**When** Extraction runs
**Then** it spans all pages as one document in page order, preserving cross-page context such as a shared reading passage

**Given** each extracted Question
**Then** it carries exactly one Question Format and at least one Topic

**Given** content that cannot be interpreted
**Then** it is recorded as such, never guessed at

**Given** Extraction completes
**Then** it is persisted and reused for later generations, including after Page Images later expire (Epic 8)

**And** a fraction appearing in source content is carried in structured, not plain-string, form; Extraction is not a directly browsable product surface in v0

### Story 3.6: Thin-Extraction Warning

As a parent,
I want to be warned if few usable questions were extracted relative to the pages submitted,
So that I can decide whether to retake before spending a generation.

**Acceptance Criteria:**

**Given** Extraction yields a low usable-question count relative to pages submitted
**When** I proceed toward generation
**Then** I am shown the usable-question count and the page count with a choice to proceed or retake

**And** this warning never hard-blocks, and choosing retake consumes no Generation Allowance

## Epic 4: Practice Test Generation, Review & Release

Parent can generate one or more Practice Tests from a Source Test, review and edit the draft, optionally configure a timer, and release it to a Student Profile.

**FRs covered:** FR-10, FR-11, FR-12, FR-13, FR-14, FR-15
**Relevant UX-DRs:** UX-DR8 (structured fraction emission), UX-DR29 (Timer display component), UX-DR41 (generation-progress copy never claims lost work)

### Story 4.1: Practice Test Generation (bounded, priced, async)

As a parent,
I want to generate one or more Practice Tests from a Source Test for one Student Profile,
So that I get fresh practice material.

**Acceptance Criteria:**

**Given** a Source Test
**When** I choose how many Practice Tests to generate
**Then** the per-request maximum is 5, further bounded by remaining Generation Allowance, unavailable counts are shown disabled with the reason stated, and the count is clamped server-side regardless of what the client sent

**Given** a chosen count
**When** I confirm
**Then** the cost is stated in Practice Tests before confirmation

**Given** generation completes
**When** each Practice Test is produced
**Then** it defaults its Question count from the Source Test's own count, covers the Extraction's Topics, reproduces its format mix proportionally, and is materially different from every other generated Practice Test and from the source, with no verbatim copies

**Given** each Question
**Then** it carries its correct answer and Topic(s), plausible distractors for Multiple Choice, and fractions in structured renderable form

**Given** generation is running
**When** I leave the screen
**Then** it continues asynchronously with visible progress and I can return without losing it

**Given** generation fails
**Then** the Source Test stays intact and retryable without re-upload

### Story 4.2: Topic-Weighted Regeneration

As a parent,
I want to generate additional Practice Tests weighted toward a specific Topic,
So that I can target my child's weak area.

**Acceptance Criteria:**

**Given** a Topic to weight toward
**When** I request weighted generation
**Then** it reuses the originating Source Test with no new upload

**Given** weighted generation
**Then** it is bounded, clamped, and priced identically to Story 4.1

**And** this story ships the weighted-generation capability itself; the Analytics-dashboard entry point (FR-11) and the missed-question drill-down entry point (FR-29) are wired in Epic 7

### Story 4.3: Draft Review

As a parent,
I want to review every Question in a draft Practice Test before release,
So that I can check it's appropriate.

**Acceptance Criteria:**

**Given** a draft Practice Test
**When** I open it
**Then** every Question is shown in one reviewable list with its correct answer and Topic

**Given** a draft
**Then** it never appears in Student Mode

### Story 4.4: Draft Editing

As a parent,
I want to edit or delete Questions in a draft,
So that I can fix or remove anything wrong.

**Acceptance Criteria:**

**Given** a draft Question
**When** I edit its text, answer options, or correct answer
**Then** the edit is what the student will later be graded against

**Given** a draft
**When** I delete Questions
**Then** I can do so until one remains

**Given** I delete the last Question
**When** I confirm
**Then** the confirmation states the already-spent Generation Allowance is not refunded, and the Practice Test is discarded

### Story 4.5: Release or Discard

As a parent,
I want to release a draft to my child or discard it,
So that only tests I've approved reach them.

**Acceptance Criteria:**

**Given** a draft
**When** I release it
**Then** it transitions to released and becomes visible in Student Mode

**Given** a draft
**When** I discard it
**Then** it is removed from all student-facing surfaces and Analytics

**Given** a released Practice Test
**Then** release is irreversible and it can no longer be edited

### Story 4.6: Optional Timer Configuration

As a parent,
I want to optionally set a countdown timer on a Practice Test before release,
So that I can simulate timed conditions.

**Acceptance Criteria:**

**Given** a draft
**Then** the timer is off by default with a suggested duration derived from question count

**Given** a draft not yet released
**When** I configure the timer
**Then** it is editable up to release, never after

**Given** a timed Attempt is in progress
**Then** remaining time is visible throughout, with three non-escalating warnings mandatory at 5 minutes, 1 minute, and 20 seconds remaining

**Given** the timer expires
**Then** auto-submit is announced when it happens, the Attempt auto-submits, and every unanswered Question is graded incorrect

## Epic 5: Taking a Test & Results

Student can take a released Practice Test — answering, navigating, surviving interruption and offline gaps — submit it, and see a graded result with an answer key.

**FRs covered:** FR-16, FR-17, FR-18, FR-19, FR-20, FR-36, FR-21, FR-22, FR-23, FR-37
**Relevant UX-DRs:** UX-DR14 (Practice Test card), UX-DR15 (Question container), UX-DR17 (Grade-state marker), UX-DR19 (Answer-key row), UX-DR20 (Question map), UX-DR24 (Smart fraction field, flagged risk), UX-DR32 (WCAG AA + 4 hard cases), UX-DR34 (Take Test responsive layout), UX-DR39 (linear nav + map escape hatch)

### Story 5.1: Student's Test List

As a student,
I want to see my released and completed Practice Tests as one list,
So that I know what to do next.

**Acceptance Criteria:**

**Given** released and completed Practice Tests
**Then** they are shown as a single flat list, not grouped by Subject, each labeled by Subject and state

**Given** the sort order
**Then** all released Practice Tests come first (whether or not an Attempt is in progress), then completed ones newest-first within each band

**Given** a completed Practice Test
**Then** it remains reachable indefinitely with no system-initiated archiving

**Given** the list
**Then** three conditions are distinguishable: released/no Attempt, released/Attempt in progress, and completed

### Story 5.2: Answering a Question

As a student,
I want to answer each Question with the right input control and navigate freely,
So that I can work through the test my way.

**Acceptance Criteria:**

**Given** a Question's Format
**Then** Multiple Choice gets single-select options, Fill-in-the-Blank an inline blank, Short Answer multi-line free text

**Given** answers entered
**When** I navigate backward or forward
**Then** I can change them before submitting

**Given** a question map
**Then** it lists every Question with Answered/Not-answered progress state and jumps directly to any one, showing progress state only, never correctness or a score

**Given** any point before submission
**Then** no correctness feedback is shown

### Story 5.3: Attempt Resilience (interruption & offline)

As a student,
I want my in-progress Attempt to survive interruption and network loss,
So that I don't lose work.

**Acceptance Criteria:**

**Given** app backgrounding, refresh, or device sleep
**When** I return
**Then** entered answers are retained and a running timer continues to reflect elapsed wall-clock time, never pausing

**Given** network loss
**Then** answering and navigating continue to work offline on the same retention basis

**Given** an offline submit attempt
**Then** it is refused with a plain statement, the Attempt stays open, every answer stays intact, and it is never retried silently

**Given** a timer expires while offline
**Then** it auto-submits on reconnect, graded against the expiry moment, not the reconnect moment, with nothing entered before the drop lost

### Story 5.4: Submitting an Attempt

As a student,
I want to submit my Attempt and see it graded,
So that I know how I did.

**Acceptance Criteria:**

**Given** unanswered Questions at submission
**When** I submit
**Then** an explicit confirmation names the count with a path back to those Questions via the question map

**Given** a manual submission with unanswered Questions
**Then** they are recorded as unanswered, not incorrect, regardless of whether the test was timed

**Given** submission completes
**Then** it is irreversible for that Attempt and the Practice Test transitions to completed

### Story 5.5: Grading Engine & Four Grade States

As the system,
I want to grade every Question deterministically or via AI and assign one of four fixed grade states,
So that scoring is trustworthy and consistent.

**Acceptance Criteria:**

**Given** a Multiple Choice Question that was answered
**Then** it is graded by exact option match, deterministically, with no AI call

**Given** a Fill-in-the-Blank or Short Answer Question that was answered
**Then** it is graded by AI on semantic equivalence, tolerant of spelling/casing/whitespace/notation/phrasing differences, scoped to subject matter, with a grade and short rationale recorded and persisted, readable by the parent on the Question's row in Attempt detail

**Given** AI grading is unavailable at submission
**Then** the Attempt still submits and scores, affected Questions are marked ungraded and retried the next time the results screen is opened by either party (view-triggered, no background job); the results header scores only gradable Questions while any remain ungraded, stating the excluded count and reason; a resolved Question is marked newly graded

**Given** any Question
**Then** it carries exactly one of four grade states — correct, incorrect, unanswered, ungraded — per the fixed rules for written-when, score-denominator inclusion, Mastery inclusion, and Weak Area floor inclusion; unanswered is written only at manual submission with a blank and never arises from an expired timed Attempt, which grades blanks incorrect instead; grading never overwrites an unanswered state; the four labels are fixed literals, kept distinct from the in-test Answered/Not-answered vocabulary

### Story 5.6: Results & Answer Key

As a student,
I want to see the full answer key right after submitting,
So that I can review what I got right and wrong.

**Acceptance Criteria:**

**Given** an Attempt is submitted
**Then** the full answer key is shown immediately

**Given** later visits
**Then** it stays reachable from Attempt history

### Story 5.7: Retaking a Practice Test

As a student,
I want to retake a completed Practice Test,
So that I can practice again.

**Acceptance Criteria:**

**Given** a completed Practice Test
**When** I retake it
**Then** a new distinct Attempt is produced, prior Attempts remain in history, and Question order may shuffle while content stays unchanged

**Given** a retake Attempt
**Then** it is scored and visible but excluded from Mastery

**Given** a multi-Attempt Practice Test
**Then** the first Attempt's score, the latest Attempt's score, and the Attempt count are shown together, with the first identified as the one counting toward Mastery

**Given** a single-Attempt Practice Test
**Then** one score is shown with no first/latest framing

## Epic 6: Explanations & Grade Disputes

Student can request an Explanation for any Question and flag one as wrong; parent can read every Explanation, override a disputed grade, and suppress a bad Explanation with a free replacement.

**FRs covered:** FR-24, FR-24a, FR-25, FR-38, FR-39
**Relevant UX-DRs:** UX-DR16 (Explanation panel component), UX-DR41 (five of the seven binding copy constraints: Explanation failure never the student's fault, at-cap message blames the plan, language adapts per Grade Level, wrong answer reported not punished, suppressed-Explanation copy names the Explanation not the student)

### Story 6.1: On-Demand Explanations

As a student,
I want to request an Explanation for any Question on the results screen,
So that I understand why an answer is right or wrong.

**Acceptance Criteria:**

**Given** a Question on results
**When** I request an Explanation
**Then** it is generated on-demand and cached after first generation

**Given** generation
**Then** it is bounded by the Explanation Allowance; re-reading an already-generated Explanation is never capped

**Given** the Explanation is generated
**Then** its language is pitched to the Practice Test's Grade Level, not the Student Profile's

### Story 6.2: Parent Review of Explanations

As a parent,
I want to read every Explanation shown to my child and flag one as bad,
So that I can catch bad AI content.

**Acceptance Criteria:**

**Given** Explanations shown to my child
**Then** I can read every one of them

**Given** any Explanation
**Then** I can originate a flag on it directly, independent of whether my child flagged it

### Story 6.3: Student Explanation Flagging

As a student,
I want to flag an Explanation as unhelpful or wrong,
So that my parent can review it.

**Acceptance Criteria:**

**Given** an Explanation
**When** I flag it
**Then** the flag surfaces to my parent, never directly to Admin

**Given** my parent confirms or dismisses it
**Then** only a parent-confirmed flag reaches the Admin Flagged Explanations queue

**Given** I flag it
**Then** what I am currently reading does not change

### Story 6.4: Explanation Suppression & Free Regeneration

As a parent,
I want to stop a flagged Explanation from reaching my child and get a free replacement,
So that I can act on bad AI content.

**Acceptance Criteria:**

**Given** a flag exists on an Explanation, parent-originated or parent-confirmed-student
**When** I suppress it
**Then** it stops being served to that Student Profile only, checked at serve time on every read path, never just a cache-key trick

**Given** suppression
**Then** I can request a free replacement at no allowance cost, at any tier including Free

**Given** the suppressed record
**Then** it is retained, still parent-readable, and still reaches the Admin queue

**Given** suppression
**Then** it is not reversible in v0 — the confirmation states this — and the only forward path is the free regeneration, which produces a different Explanation

### Story 6.5: Grade Dispute & Override

As a student,
I want to flag a Question grade I think is wrong,
So that my parent can review it.

**Acceptance Criteria:**

**Given** a Question grade I believe is wrong
**When** I flag it
**Then** it surfaces to my parent on the Analytics dashboard for my profile

**Given** the parent overrides the grade in Attempt detail
**Then** the Attempt score and the affected Topic's Mastery are recomputed

**Given** an override happens
**Then** the original AI grade and rationale are retained, not erased

## Epic 7: Mastery Analytics & Weak Areas

Parent can see per-Topic Mastery, a score trend, and Weak Areas per Student Profile, drill from a Weak Area into a targeted regeneration, and Admin can curate the canonical Topic set.

**FRs covered:** FR-26, FR-26a, FR-27, FR-28, FR-29, FR-40
**Relevant UX-DRs:** UX-DR18 (Weak Area marker), UX-DR21 (Mastery table/row), UX-DR22 (Trend sparkline), UX-DR35 (Analytics dashboard responsive layout)

### Story 7.1: Topic Canonicalization

As the system,
I want to map each generated Topic onto a canonical Topic within its Subject,
So that Mastery stays comparable across Attempts.

**Acceptance Criteria:**

**Given** a Topic emitted at generation
**When** it is used for Mastery
**Then** it is first mapped onto a canonical Topic within its Subject

**Given** generation
**Then** Topic emission itself stays unconstrained and free-form — canonicalization happens only at the Mastery-write boundary

**And** a Topic with no canonical match is created carrying a provisional flag; confirming, merging, or renaming a provisional Topic is out of scope for this story — see Story 7.6

### Story 7.2: Mastery Computation

As the system,
I want to maintain a Mastery value per Topic per Student Profile,
So that parents can see what their child knows.

**Acceptance Criteria:**

**Given** graded Questions carrying a Topic
**Then** Mastery is correct / (correct + incorrect), computed over the 5 most recent qualifying Attempts weighted equally, or however many exist if fewer than 5

**Given** a Practice Test with multiple Attempts
**Then** only the first Attempt qualifies; retakes are recorded and shown but never contribute to Mastery

**Given** unanswered or ungraded Questions
**Then** they contribute to neither term

**Given** a parent grade override
**Then** affected Mastery recomputes immediately

### Story 7.3: Weak Area Identification

As the system,
I want to surface Topics with low Mastery and enough data,
So that parents know where to focus.

**Acceptance Criteria:**

**Given** a Topic's Mastery below 60% and at least 5 answered Questions carrying that Topic
**Then** it is surfaced as a Weak Area

**Given** both figures
**Then** they are system-level configuration, never per-parent

### Story 7.4: Analytics Dashboard

As a parent,
I want a per-Student-Profile dashboard of Mastery, trend, and Weak Areas,
So that I can track progress.

**Acceptance Criteria:**

**Given** a Student Profile
**Then** Mastery by Topic is shown ranked weakest-first, filterable by Subject

**Given** the same profile
**Then** a single dashboard-level score trend sparkline is shown, retakes excluded, using the same 5-qualifying-Attempt window as Mastery but a per-profile scope

**Given** Weak Areas exist
**Then** they are shown on the dashboard

**Given** the dashboard
**Then** it also carries an activity summary, surfaced grade disputes and student Explanation flags awaiting disposition for the selected profile, and the Explanation Allowance counter as an account-level, not per-profile, figure

### Story 7.5: Weak Area Drill-Down & Targeted Regeneration

As a parent,
I want to drill from a Weak Topic into the specific missed Questions and generate more targeted practice,
So that I can help my child improve.

**Acceptance Criteria:**

**Given** a Topic
**When** I drill in
**Then** I see the specific Questions the student missed on it

**Given** that view
**When** I initiate generation
**Then** it uses the Story 4.2 weighted-generation capability, with cost stated before it fires

### Story 7.6: Admin Topic Curation

As an Admin,
I want to review provisional Topics and confirm, merge, or rename them within a Subject's canonical set,
So that the canonical Topic set stays clean instead of accumulating unreviewed near-duplicates.

**Acceptance Criteria:**

**Given** a newly emitted Topic with no canonical match (Story 7.1)
**Then** it enters the canonical set carrying a provisional flag; Mastery accrues against it immediately, unaffected by its provisional status

**Given** a provisional Topic
**When** I confirm it as-is, merge it into an existing canonical Topic, or rename it
**Then** the action applies within that Subject's canonical set

**Given** a merge
**Then** every Question tagged with the merged Topic re-points to the surviving canonical Topic and Mastery recomputes for every affected Student Profile, through Story 7.2's Mastery computation

**Given** a confirm or rename
**Then** existing Mastery values are unaffected

## Epic 8: Retention & Deletion

Page Images expire automatically 90 days after upload, and a parent can delete images early, a Student Profile, or the whole Parent Account, with every deletion propagating completely.

**FRs covered:** FR-32, FR-33

### Story 8.1: Automatic Page Image Expiry

As the system,
I want to delete Page Images 90 days after upload without any user action,
So that storage stays lean and privacy commitments hold.

**Acceptance Criteria:**

**Given** a Source Test's upload date
**When** 90 days pass
**Then** stored image bytes are deleted, not merely a database reference

**Given** expiry
**Then** the Source Test, Extraction, and every derived Practice Test/Attempt/Mastery value survive intact

**Given** a later regeneration request
**Then** it continues to work from the persisted Extraction

**Given** the UI shows an expired Page Image
**Then** it shows an expired state, never a broken-image glyph

### Story 8.2: Early Image Deletion

As a parent,
I want to delete a Source Test's Page Images ahead of the 90-day expiry,
So that I can proactively control what's stored.

**Acceptance Criteria:**

**Given** a Source Test
**When** I delete its Page Images early
**Then** it behaves exactly like the 90-day expiry in Story 8.1

### Story 8.3: Student Profile Deletion

As a parent,
I want to delete a Student Profile and its data,
So that I can fully remove a child's record, distinct from archiving.

**Acceptance Criteria:**

**Given** a Student Profile
**When** I delete it
**Then** its Practice Tests, Attempts, Explanations, and Mastery are removed — distinct from archiving (Story 1.3), which preserves history

**Given** deletion
**Then** it requires an explicit confirmation naming what is destroyed and stating it cannot be undone

**Given** deletion
**Then** it requires the account password, not the Parent PIN

### Story 8.4: Parent Account Deletion

As a parent,
I want to delete my Parent Account entirely,
So that I can remove everything if I choose to leave.

**Acceptance Criteria:**

**Given** account deletion
**When** confirmed
**Then** the account and everything under it is removed, including any Story 1.6 uncommitted state

**Given** deletion
**Then** it requires an explicit confirmation naming what is destroyed, states it cannot be undone, and requires the account password, not the Parent PIN

**Given** deletion completes
**Then** no orphaned stored files remain

## Epic 9: Account Tiers & Allowance Enforcement

Every Parent Account's Upload, Generation, and Explanation Allowances are tracked and enforced against its Account Tier, resetting atomically on the account's own monthly boundary.

**FRs covered:** FR-31
**Relevant UX-DRs:** UX-DR41 (Generation Allowance copy always denominated in Practice Tests)

### Story 9.1: Account Tier Assignment Data Model & Effect

As the system,
I want every Parent Account to carry an Account Tier defaulting to Free with no self-serve upgrade,
So that entitlements are governed by Admin only.

**Acceptance Criteria:**

**Given** account creation
**Then** it defaults to Free tier

**Given** the tier
**Then** it can only change via Admin assignment (Epic 2 Story 2.2), never self-serve

**Given** the tier table (§5.3)
**Then** it determines the Student Profile limit and all three allowance caps

### Story 9.2: Student Profile Limit Enforcement

As the system,
I want to cap active Student Profile count per Account Tier,
So that usage matches the assigned tier.

**Acceptance Criteria:**

**Given** a Parent Account at its Student Profile limit
**When** creation of a new profile (Story 1.3) is attempted
**Then** it is blocked with a message naming the tier and the limit

### Story 9.3: Upload Allowance Enforcement

As the system,
I want to cap successful Source Test uploads per Account Tier per period,
So that usage matches the assigned tier.

**Acceptance Criteria:**

**Given** the Upload Allowance is reached
**When** a parent attempts to commit a Source Test upload (Story 3.4)
**Then** the operation hard-blocks with a message naming the tier, usage, and reset date

**Given** the allowance
**Then** it is consumed only on successful upload commit, never on a failed or abandoned attempt

### Story 9.4: Generation Allowance Enforcement

As the system,
I want to cap successful Practice Test generations per Account Tier per period,
So that usage matches the assigned tier.

**Acceptance Criteria:**

**Given** the Generation Allowance is reached
**When** a parent attempts to generate (Story 4.1 or 4.2)
**Then** the operation hard-blocks with a message naming the tier, usage, and reset date

**Given** the allowance
**Then** it is consumed only per Practice Test that successfully lands as a draft, never per request or failed generation

### Story 9.5: Explanation Allowance Enforcement

As the system,
I want to cap Explanation generations per Account Tier per period without ever capping re-reads or free suppression-regenerations,
So that usage matches the assigned tier while remedies stay free.

**Acceptance Criteria:**

**Given** the Explanation Allowance is reached
**When** a student requests a new Explanation (Story 6.1)
**Then** generation hard-blocks with a message naming the tier, usage, and reset date, while re-reading any already-generated Explanation stays uncapped

**Given** a Story 6.4 free regeneration after suppression
**Then** it never consumes an Explanation Allowance unit, at any tier including Free

**Given** any allowance state
**Then** AI grading (Story 5.5) is never blocked by any allowance

### Story 9.6: Allowances Surface & Atomic Monthly Reset

As a parent,
I want to see all three allowance counters and know when they reset,
So that I can plan ahead of hitting a cap.

**Acceptance Criteria:**

**Given** the Allowances surface
**Then** it shows usage, limit, and reset date for all three counters (Upload/Generation/Explanation), viewable without hitting any cap

**Given** the calendar-month boundary in the Parent Account's own stored timezone
**Then** all three counters reset atomically together

**Given** the Analytics dashboard (Story 7.4)
**Then** the Explanation counter additionally appears there
