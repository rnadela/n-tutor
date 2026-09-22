---
title: n-test-reviewer
status: final
created: 2026-08-29
updated: 2026-09-01
sources:
  - ../../prds/prd-n-test-reviewer-2026-08-29/prd.md
  - ../../prds/prd-n-test-reviewer-2026-08-29/addendum.md
  - ./DESIGN.md
---

# n-test-reviewer — Experience Spine

## Foundation

**How to read this file.** Bold text is binding. A trailing `*Why:*` clause is reasoning and binds nothing on its own. `DESIGN.md` owns appearance; this file owns behavior. The mocks in `mockups/` illustrate both spines and decide neither. A reader who only needs the rules that land on build work should go straight to [Constraints landing on architecture and prompt work](#constraints-landing-on-architecture-and-prompt-work), which indexes them.

Mobile-first responsive web. Single codebase, no app store, camera access through the browser. Must work on a phone held one-handed in a kitchen and on a family tablet; desktop is supported but not optimized.

Next.js + React + MUI **are** inherited from the `n-electric` stack — a decided constraint, not an open choice. `DESIGN.md` is the visual identity reference and owns the theme (Clear Room palette, Literata/Source Sans 3, the paper-vs-control radius rule, flat bordered surfaces, the two density token sets, the grade-state encoding). This spine owns behavior. Where they disagree, `DESIGN.md` wins on appearance and this file wins on mechanics.

Four surfaces: **Auth** (unauthenticated, Parent Account only), **Student Mode** (default state of the device), **Parent View** (gated by the Parent PIN), **Admin** (separate operator surface). Light and dark both ship.

Four reference mocks sit in `mockups/` and are linked inline from the sections they illustrate — [`key-take-test.html`](mockups/key-take-test.html), [`key-results.html`](mockups/key-results.html), [`key-analytics.html`](mockups/key-analytics.html), [`key-capture.html`](mockups/key-capture.html). They are illustrations of this spine and of `DESIGN.md`, not sources: **where a mock and either spine disagree, the spines win.** A value or behavior appearing only in a mock has not been adopted. Three earlier exploration artifacts — `.working/color-themes-1.html`, `.working/color-themes-2.html`, `.working/type-pairings-1.html` — remain in `.working/` and are not promoted; they record how the palette and type pairing were chosen and carry no normative weight.

## Information Architecture

| Surface | Screen | Reached from | Purpose |
|---|---|---|---|
| Auth | Sign up | App open, no session | Email, password, terms + child-data consent acceptance (FR-1) |
| Auth | Child-data consent notice | Sign up, and Settings → Legal | The consent text itself, readable before acceptance and afterwards |
| Auth | Sign in | App open, no session; explicit sign-out | Email + password |
| Auth | Password reset request | Sign in | Email entry; always the same response regardless of account existence |
| Auth | Password reset | Emailed link | New password entry |
| Student Mode | Student Home | App open with a session (default state) | Flat list of this Student Profile's Practice Test cards |
| Student Mode | Take Test | Practice Test card tap | One Question at a time, optional timer, question map |
| Student Mode | Results | Submit, or a completed card tap | Score header, full answer key, inline Explanations, flags, Retake |
| Parent View | PIN entry | Profile icon → Parent View | Gate; three wrong attempts trigger cooldown |
| Parent View | Analytics dashboard | PIN success (default landing) | One Student Profile at a time: activity summary, **grade disputes raised on this profile (FR-25)**, **Explanations this student flagged as bad (FR-38), awaiting the parent's disposition**, **the Parent Account's Explanation Allowance counter**, trend sparkline, Mastery table with Subject filter |
| Parent View | Topic drill-down | Mastery row tap | Missed Questions for that Topic + weighted regenerate |
| Parent View | Attempts | Parent View nav, or Analytics activity summary | Per Student Profile: every Attempt, first-Attempt and retake distinguished |
| Parent View | Attempt detail | Attempts row tap, Analytics dashboard dispute or flag entry | Full answer key, per-Question grading rationale (FR-22), Explanations read + flag (FR-24a), **confirm or dismiss a student flag (FR-38)**, **suppress an Explanation and request a free regeneration (FR-39)**, disputed grades and **grade override** (FR-25) |
| Parent View | Upload → Classify | Upload Test | Student Profile, Subject, Grade Level |
| Parent View | Capture pages | After Classify | Continuous camera + photo library, ordered thumbnail strip |
| Parent View | Legibility check | After capture, before Generate | Batch per-page pass/fail, retake-one-page, override |
| Parent View | Generate | After legibility check | Count of Practice Tests, thin-Extraction warning, cost statement, fires generation |
| Parent View | Generation progress | Generate | Live progress for an async job |
| Parent View | Pending drafts | Parent View nav (persistent) | Discoverable list of unreleased draft Practice Tests |
| Parent View | Draft review | Pending drafts row, or generation completion | One draft at a time, full question list, per-Question edit/delete, **timer configuration**, release or discard |
| Parent View | Source Tests | Parent View nav | Uploaded Source Tests per Student Profile, with Page Image state |
| Parent View | Source Test detail | Source Tests row tap | Page Images in order, expired state, early Page Image deletion, regenerate from this Source Test |
| Parent View | Students | Parent View nav | Student Profile list; create, rename, set Grade Level, archive |
| Parent View | Student Profile detail | Students row tap | One profile's name, Grade Level, archive state, and delete |
| Parent View | Settings | Parent View nav | Account, PIN, allowances, data deletion, legal |
| Parent View | Account & security | Settings | Change PIN, change password, **change the Parent Account timezone**, sign out |
| Parent View | Allowances | Settings | Current Account Tier, usage against all three counters, reset date |
| Parent View | Data & deletion | Settings | Delete Page Images early, delete a Student Profile, delete the Parent Account |
| Admin | Subjects & Grade Levels | Admin sign-in | Taxonomy CRUD and per-grade availability |
| Admin | Parent Accounts | Admin nav | Account Tier assignment; per-account consumption for uploads, Practice Tests generated, and Explanations generated |
| Admin | Flagged Explanations | Admin nav | FR-24a / FR-38 content-quality queue — **parent-confirmed and parent-originated flags only**. A suppressed Explanation (FR-39) stays in this queue; suppression is per Student Profile and is never a service-wide takedown, which remains the operator's decision |

**Persistent chrome.** The Student Profile switcher is reachable from anywhere in Parent View — never buried in Settings — and carries a per-child at-a-glance signal of outstanding work where that is cheap. Switching preserves the current view rather than resetting to a dashboard root. **Pending drafts** and **Source Tests** are first-class Parent View destinations, not places you only land after a flow.

**There is no separate `Flagged items` destination.** A grade dispute (FR-25) surfaces on the **Analytics dashboard**, in or beside the FR-28 unstarted/completed summary band, scoped to the currently selected Student Profile like every other figure on that screen; the parent drills from there into **Attempt detail**, which is where the override is performed. *Why:* the dashboard is the one Parent View surface a parent reliably opens, and v0 has no notifications. A dispute parked in a destination the parent has no independent reason to visit could go unread, and a disputed grade is time-sensitive in a way an analytics figure is not.

**A student's flagged Explanation (FR-38) surfaces to the parent first. Only a parent-confirmed flag reaches the Admin Flagged Explanations queue.** The flow: the student flags a bad Explanation in the results-screen Explanation panel; it surfaces on the **Analytics dashboard band** for that Student Profile; the parent opens it, reads the Explanation in full, and either **confirms** it — which sends it to the Admin queue — or **dismisses** it. **The parent can also originate a flag directly while reading any Explanation, and that path never depends on the student having flagged it first** — it is FR-24a's primary path. *Why:* the PRD's justification for showing Explanations to a student without a parent review gate is that accountability is after the fact — every Explanation is retained, readable by the parent, and flaggable — so a student flag that bypassed the parent would remove the exact safeguard that made ungated Explanations acceptable. The parent is the accountable adult; the operator handles product quality. **A parent-confirmed or parent-originated flag unlocks suppression (FR-39), and suppression is performed in Attempt detail.** Suppression stops the Explanation being served to that Student Profile; the record survives, stays readable by the parent (FR-24a), and still reaches the Admin queue (FR-30a). Its full specification is [Explanation suppressed by a parent](#explanation-suppressed-by-a-parent). *Why:* the FR-24a justification for showing a student an unreviewed Explanation is that accountability is after the fact, and before FR-39 that chain terminated in an Admin queue that could not change anything on the child's screen — the only remedy the parent held was deleting the Student Profile. **Suppression is the action that makes the argument true, so it is a requirement of the accountability path rather than an addition to it.**

**Accepted cost:** the dashboard band now carries three item types — grade disputes, Explanation flags awaiting disposition, and the Explanation Allowance counter — while not being a queue. **Two of the three are items with a disposition; the third is a standing figure with none**, so the band is a per-profile digest rather than a work list, and the note that it is not a queue still holds. The revisit condition recorded against it is strengthened accordingly. See the dashboard mock: [`mockups/key-analytics.html`](mockups/key-analytics.html) — dashboard, ranked Mastery table, Topic drill-down, weighted regenerate with its cost block, empty state, and the tablet layout.

**Student Mode carries no parent functionality.** The student's flag actions raise items *out of* Student Mode — both a grade dispute and a bad Explanation go to the parent's dashboard; they never open a Parent View screen and never reach Admin directly. Reading Explanations as a parent happens in Attempt detail, never through Student Mode.

## Voice and Tone

Microcopy only. Aesthetic posture lives in `DESIGN.md`.

**Address is surface-aware.** Student Mode speaks in the **second person**. Parent View refers to the Student Profile **by name in the third person**. Admin refers to accounts and profiles by name in the third person.

| Content | Student Mode | Parent View |
|---|---|---|
| Score | "You answered 11 of 15." | "Noah answered 11 of 15." |
| Empty Analytics | — | "Mastery appears once Noah has answered at least 5 questions on a topic. His highest topic is at 3 so far." |
| At cap | "You've used all 10 explanations this month. They reset on October 1." | "Noah has used all 10 explanations this month. They reset on October 1." |

**Load-bearing for implementation: no result or analytics string may be a fixed literal.** Every string describing student work takes the subject as a parameter and resolves address by surface, so shared components render correctly in either room. This covers results headers, empty states, at-cap messages, and drill-down copy. **Grade-state labels are the exception and are fixed literals** — the four values of `{components.grade-state-marker.*.label}` — identical in both rooms. *Why:* they are state vocabulary, not address. **Never mix registers within one screen.**

| Do | Don't |
|---|---|
| "Couldn't load that explanation." | "Explanation unavailable (ERR_502)" |
| "You haven't answered 2 questions." | "Oops! You missed some questions!" |
| "division with remainders — 40%, 3 unanswered" | "division with remainders — 40%", where unanswered Questions exist for that Topic |
| "You answered 11 of 11 graded questions correctly. 4 aren't graded yet." | "11/15 so far" |
| "Page 2 is hard to read. You can retake just that page, or continue anyway." | "Upload failed." |
| "Generating 2 practice tests. That uses **both** practice tests left in your allowance this month." | "Generate more" |
| "This deletes Noah's profile, his 6 practice tests, every attempt, and his mastery data. It cannot be undone." | "Are you sure?" |
| Plain, complete sentences. Facts. | Exclamation marks, cheerleading, apology paragraphs, error codes, upsell aimed at a child. |

**Binding copy constraints.**

1. An Explanation failure is **never** framed as the student's fault or as a limit on their understanding.
2. The Explanation at-cap message blames **the plan, never the child**. It must not imply the student asked too many questions or did anything wrong. No exclamation marks, no apology, no upsell language aimed at the child.
3. The generation progress copy must **not claim work will be lost** if the parent leaves. *Why:* that would be false, and would contradict retry-without-re-upload and allowance-charged-on-success.
4. Explanation language **adapts per Grade Level**, per grade rather than in bands: sentence length, vocabulary, and assumed prior knowledge shift with the grade. **The authoritative Grade Level is the Practice Test's, not the Student Profile's**, matching FR-24 as written. Tone constraints hold at every grade — plain, encouraging without cheerleading, no condescension, no exclamation marks, never implying the student should have known better. *Why:* the sourcing argument and its architectural consequences are in [Constraints landing on architecture and prompt work](#constraints-landing-on-architecture-and-prompt-work), which owns it.
5. A wrong answer is reported, never punished. Weak Areas are stated plainly to the parent, never softened.
6. **Allowance copy always denominates the Generation Allowance in Practice Tests**, never in requests or "generations". A sign-in error never reveals whether an account exists. A destructive confirmation always names the specific objects it destroys.
7. **Suppressed-Explanation copy (FR-39) names the Explanation as the thing that fell short, never the student and never the question they asked.** It does not say or imply that the student should not have read it, should not have asked, or did anything wrong; it does not thank, apologize, or reassure; and it carries no exclamation mark. It states plainly that a parent removed the explanation and that the removal is about the explanation's quality. *Why:* the student did the one thing this product wants — asked why — and a message about output the product itself generated must never land on them.

## Grade States

Four states. All four are carried through Attempt storage, the results answer key, the parent Attempt detail and drill-down, and Mastery computation. All four are conveyed on the **four redundant carriers** specified in `{components.grade-state-marker}` — icon frame shape and border style, glyph, literal text label, and row left-rule texture — with color as a fourth, never-alone carrier, and each is announced distinctly to screen readers using the same literal label.

| Stored state | Meaning | Color role | In Mastery denominator? | Label (visible and announced) |
|---|---|---|---|---|
| `correct` | Answered and graded correct | `{colors.success}` | Yes (numerator + denominator) | `{components.grade-state-marker.correct.label}` |
| `incorrect` | Answered and graded incorrect, **or unanswered at timer expiry** | `{colors.error}` | Yes (denominator only) | `{components.grade-state-marker.incorrect.label}` |
| `unanswered` | Skipped on an **untimed** Practice Test, or on a timed one **submitted manually before expiry** | `{colors.text-secondary}` | **No — excluded entirely** | `{components.grade-state-marker.unanswered.label}` |
| `ungraded` | AI grading unavailable; degrades to ungraded, never to wrong | `{colors.info}` | **No — excluded until it resolves** | `{components.grade-state-marker.ungraded.label}` |

The four label strings themselves are rendered in `DESIGN.md` §Components, which owns them. Nothing in this file retypes them.

**Progress vocabulary and grade vocabulary are two vocabularies for two moments.** Progress vocabulary governs the **test-taking surface**, where nothing has been graded and a Question may simply not have been reached yet: the question map reads **Answered / Not answered**. Grade vocabulary governs **results, Analytics, and the parent drill-down**, after submission: the four labels above. `Unanswered` is therefore not the same as `Not answered` — it means *submitted without an answer*, a claim only submission can make. *Why:* one word covering both moments would assert a grade before any grading occurred. The two mocks legitimately differ and neither is reconciled to the other — [`mockups/key-take-test.html`](mockups/key-take-test.html) showing `Not answered` and [`mockups/key-analytics.html`](mockups/key-analytics.html) showing `Unanswered` are both correct.

### Timer expiry and the `unanswered` state

Stated explicitly because it is subtle enough to be implemented wrongly by default.

**A Question left blank when a timer expires is graded `incorrect`, not `unanswered`.** This aligns with FR-15 as written. `unanswered` **cannot arise from a timed Attempt that reached expiry** — if the Attempt ended by expiry, every blank Question in it is `incorrect`.

`unanswered` arises in exactly two cases:

1. The Practice Test has **no timer** and the student submits with gaps.
2. The Practice Test **has a timer** and the student submits **manually, before expiry**, with gaps.

*Why:* FR-15's scope is expiry only, and expiry means the student had the full configured time. A deliberate skip inside available time is a different signal from running out of clock, and only the former tells the parent something about intent. The distinction is what keeps the parent-facing reading honest: a Topic reading "40% — 3 unanswered" says *the student chose to move past these*, and that reading would be false if the same display absorbed a clock running out.

**Consequence for the skipped-count display: it survives, but only for untimed Attempts and manually submitted timed Attempts.** A timed Attempt that expired shows no unanswered count, because it has none.

## Mastery

**Mastery (per Topic, per Student Profile) = correct / (correct + incorrect)**, counting only graded Questions carrying that Topic, computed over the **5 most recent qualifying Attempts that included that Topic**, all weighted equally. This refines FR-26; it does not replace it. Fewer than 5 qualifying Attempts computes over however many exist. Attempts outside the window do not affect Mastery. *Why:* a child who has since learned a Topic must not be permanently penalized by an early Attempt.

**Only the first Attempt on a given Practice Test qualifies.** Retake Attempts (FR-20) are recorded, scored, and shown in history to both student and parent, but never contribute to Mastery. *Why:* repeating the same Questions measures memory of those Questions, not command of the Topic. A fresh Practice Test generated from the same Source Test is a different Practice Test, and its first Attempt qualifies normally.

**This must be visible, not only true.** The Practice Test card, the Attempts list, and Attempt detail all mark a retake as a retake and say it does not count toward Mastery, and the trend sparkline excludes retakes for the same reason. **The first-versus-latest distinction is carried wherever an Attempt is listed**, in Parent View as on the Student Home card — both scores are shown, the first is marked as the counted one, and retakes are marked non-qualifying. Neither number is hidden. *Why:* the card is truthful about what happened while teaching what the product wants understood: the first try is the one that measures what you know.

**`unanswered` contributes to neither term.** *Why:* scoring a skipped Question as incorrect would tell the parent the student does not understand a Topic the student simply chose to move past, corrupting the Weak Area signal that is the parent-facing value of the product.

**`ungraded` is excluded on the same reasoning**, and enters Mastery normally once it resolves on retry. *Why:* an ungraded answer says nothing about whether the student knows the Topic, and a transient outage must not permanently thin the signal.

**A parent grade override (FR-25) recomputes affected Mastery** immediately.

**Weak Area = Mastery below 60% *and* at least 5 answered Questions carrying that Topic** (FR-27). *Why:* the 5-question floor prevents a single bad question from creating a false alarm. Both the 60% threshold and the 5-question floor are **system-level configuration, tunable post-launch, and never a per-parent setting**. Weak Areas sort first on the Analytics dashboard.

**Unanswered at timer expiry does not exist** — those Questions are `incorrect`, per FR-15, and count in the denominator. See [Timer expiry and the `unanswered` state](#timer-expiry-and-the-unanswered-state).

**Accepted cost:** a student who skips heavily on untimed tests accrues Mastery data more slowly and reaches the five-question Weak Area floor more slowly.

**The skipped count is surfaced to the parent alongside Mastery**, for untimed and manually submitted Attempts only. A Topic reads as "division with remainders — 40%, 3 unanswered", never as a bare percentage, wherever unanswered Questions exist for that Topic. *Why:* "40%" and "40% with 3 skipped" are different findings, and the parent-facing promise is a truthful Weak Area call, not a tidy number. This applies to the Analytics dashboard, the Topic drill-down, and the per-Attempt summary.

**FR-26 and FR-27 must be read with these refinements.** Nothing above is optional or a later tuning.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md`. Four reference mocks are linked from the rows and states they illustrate; the spines win wherever a mock disagrees.

Five components carry rules too heavy for a table cell and are specified beneath the table: **Practice Test card**, **Timer**, **Explanation panel**, **Mastery table**, **Trend sparkline**.

| Component | Use | Behavioral rules |
|---|---|---|
| Sign-up form | Auth | Email format validated inline; password strength minimum stated **before** submission, not only on rejection. Terms and the child-data consent notice must be explicitly accepted, each linked to its readable text, and the acceptance is recorded against the Parent Account with its timestamp. A duplicate email is rejected with wording identical to a generic failure — it never reveals that the account exists. |
| Sign-in form | Auth | Session persists across app launches until explicit sign-out. Failed sign-in and password-reset request return the same message regardless of whether the email is registered. |
| Student Home list | Student Home | Flat list, **no Subject grouping** — a logged departure from FR-16. Sorted **unstarted first, then completed, newest first within each band**. Every completed Practice Test stays visible indefinitely. *Why:* the sort is what keeps the list usable, so it must not be weakened. |
| Question container | Take Test | One Question at a time. Persistent "Question 7 of 15" counter with Back / Next as the primary path. |
| Question map | Take Test | Openable overlay showing every Question with its `Answered` / `Not answered` progress state; tap jumps directly. Uses the permitted expand/collapse motion. Cells are real buttons, keyboard navigable, and individually announced with their state. Rendered in [`mockups/key-take-test.html`](mockups/key-take-test.html), alongside the test-taking surface, submit-with-gaps, the smart fraction input, and the timer states including the pre-expiry warning. |
| Answer input | Take Test | Multiple Choice: option list, exactly one selectable. Fill-in-the-Blank: inline input at the blank position. Short Answer: multi-line free text. **No format lock-in on Fill-in-the-Blank or Short Answer input.** |
| Smart fraction field | Fill-in-the-Blank | Specified in full at [Accessibility Floor hard case 1](#accessibility-floor), which owns the behavioral rules. Built and confirmed in [`mockups/key-take-test.html`](mockups/key-take-test.html). |
| Score header | Results, Attempt detail | Score appears; it does not perform. No count-up, no reveal animation. Names any `ungraded` gap (see Grade States). The results structure, all four grade states, and degraded grading are rendered in [`mockups/key-results.html`](mockups/key-results.html). |
| Answer-key row | Results, Attempt detail, drill-down, draft review | Full question list in **original order** — correct and incorrect alike. Each row: the Question, the student's answer, the correct answer, and the grade state on all four carriers from `{components.grade-state-marker}`. |
| Grading rationale | Attempt detail | Every AI-graded Question's short grading rationale (FR-22) is readable by the parent on the row, collapsed by default. *Why:* it is the evidence a grade override is decided on, so it must be present on every disputed row without a further navigation. |
| Grade override | Attempt detail | Parent-only. Flips a Question's grade between `correct` and `incorrect` on the recorded Attempt. Requires no PIN beyond the one already spent entering Parent View. On confirm it **recomputes the Attempt score and the affected Topic's Mastery**, and the row is thereafter marked as parent-adjusted with the original AI grade still readable. Never available in Student Mode. |
| Dispute entry | Analytics dashboard | Grade disputes for the **currently selected Student Profile only**, in or beside the FR-28 unstarted/completed summary band, newest first, each naming the Practice Test, the Question, and the recorded grade. Tap opens Attempt detail scrolled to that Question. Entries stay listed after resolution, marked resolved. *Why:* a dispute is a record, not a to-do that vanishes. |
| Flag disposition | Attempt detail | Parent-only, on the Explanation panel of a flagged row. A student flag (FR-38) carries exactly two dispositions — **confirm**, which records the parent's agreement and sends the Explanation to the Admin queue, or **dismiss**, which is recorded and goes no further. A flag stays listed on the dashboard band as awaiting disposition until one is taken, and stays listed afterwards marked with the disposition taken. **Confirming does not suppress** — suppression is a separate, stated choice on the same panel. |
| Explanation suppression control | Attempt detail | Parent-only, and **available only once a flag exists** on that Explanation — one the parent originated, or a student flag the parent confirmed. Never available in Student Mode, never on the dashboard band, and never automatic. Its confirmation names what suppression does and what it does not do in the same breath: the Explanation stops being served to **this Student Profile**, it is not deleted, the parent can still read it here, the operator still sees it, and the Question, the Attempt, its score, and Mastery are unchanged. States that scope is this profile, not the service. **The confirmation also says, in words, that the action cannot be undone** — suppression is not reversible in v0, and the only forward path is the free regeneration below, which produces a different Explanation rather than restoring this one. *Why:* nothing else in Parent View behaves this way, and the closest comparable — FR-13's delete-to-zero discard — is confirmed in words rather than left to be inferred. This control gets the same treatment. |
| Explanation regeneration control | Attempt detail | Parent-only, offered with the suppression outcome. Generates a **fresh** Explanation for the same Question rather than re-serving the cached one, and the replacement serves to the student in place of the suppressed state. **Must state its cost before it fires, and its cost is nothing** — it consumes no Explanation Allowance at any tier, Free included. *Why:* every other generation path in the product states a cost before firing, so the free path must state it too rather than stay silent; silence reads as an unstated charge on the one tier that counts. The replacement is itself flaggable and suppressible on the same terms, with no ceiling on the loop. |
| Explanation Allowance readout | Analytics dashboard | Free tier only. Sits in the summary band with the Account's usage and reset date. **It is the one figure in the band not scoped to the selected Student Profile** — the allowance is held by the Parent Account and spent across every profile under it — and the readout says so rather than letting a per-profile screen imply a per-profile counter. Never rendered in Student Mode. |
| Capture strip | Capture pages | Camera stays open across pages; captured pages accumulate as an ordered thumbnail strip in view. Photo-library selection is **multi-select** and mixes freely into the same Source Test; both paths append in order. Reorder, retake, and delete act on the strip after capture, never inline in the viewfinder. Source (shot vs selected) is never surfaced as a distinction. 1–10 Page Image ceiling applies identically to both. Every thumbnail names its ordinal in text. Continuous capture and page management are rendered in [`mockups/key-capture.html`](mockups/key-capture.html), together with the batch legibility check, the generate step, and generation progress. |
| Legibility result | Legibility check | Runs as a **batch, once, immediately after capture finishes and before any other step** — rendered in [`mockups/key-capture.html`](mockups/key-capture.html). Identifies **which** page failed and offers retake of **that page alone**. States plainly that proceeding is allowed, and that proceeding consumes an Upload Allowance. |
| Thin-Extraction warning | Generate | States the **count of usable questions and the count of pages submitted**, then offers proceed or retake pages. Never hard-blocks. Must state that **choosing to retake pages consumes no Generation Allowance**. *Why:* the parent is otherwise choosing blind between a bad generation and an unknown cost. |
| Generate control | Generate | Count selector for Practice Tests, **bounded at initiation by the remaining Generation Allowance** — a parent with 2 remaining cannot select 5. Options above the remaining allowance are shown disabled with the reason stated, not hidden. States the cost in Practice Tests before it fires. |
| Draft review list | Draft review | **One draft Practice Test at a time**, shown as its full question list. Per-Question edit and delete act **in place** without navigating away. Persistent progress context ("draft 2 of 5"). Question rows are paper role in Literata — this is generated Question content. |
| Release control | Draft review | **Per draft.** No batch release. Released Practice Tests appear on Student Home as each is released, not all at once. Discard is per draft too. Release is irreversible; a released Practice Test cannot be edited. |
| Source Test row | Source Tests | Names the Subject, Grade Level, Student Profile, page count, upload date, and the Page Image state (available, or deleted with the date). Carries regenerate-from-this-Source-Test and delete-photos-early. |
| Weighted regenerate | Topic drill-down only | Sits with the evidence that justifies it, Topic pre-selected. **Must state its cost before it fires** — the number of Practice Tests about to be generated and the remaining Generation Allowance in Practice Tests. A one-tap generate from a drill-down without a cost statement is a defect, not a convenience. No duplicate entry point at the dashboard in v0. |
| Profile switcher | Parent View, global | Persistent and reachable from anywhere. Preserves the current view on switch. |
| Student Profile form | Students, Student Profile detail | Display name and exactly one Grade Level from the Admin-configured list, both required. Archive is presented as *hides from Student Mode, keeps history* and is visibly distinct from delete. Changing Grade Level does not alter existing Practice Tests, and the form says so. |
| Destructive confirmation | Data & deletion, Student Profile detail | Names **exactly what will be destroyed** by count and kind, states it cannot be undone, and requires the **account password** — never the Parent PIN. *Why:* the PIN gates a mode rather than a destructive action. Early Page Image deletion is the one destructive action that does not take the password, because derived data survives it unchanged; it still names what goes. |
| Allowance readout | Allowances, Generate, weighted regenerate | Names the Account Tier, usage against the limit, and the reset date. The Generation Allowance is always denominated in **Practice Tests**. |
| Empty state | Everywhere in Parent View | **Mechanism plus progress**, never a bare absence. See State Patterns. |

#### Practice Test card

**Surface.** Student Home.

**Binding rules.**

- Informative before tap: Subject, Grade Level, question count, timer presence **and duration when set**, state (not started / in progress / completed), and score when completed.
- **After a retake the card shows both scores plus the Attempt count, the first marked as the counted one** — the pattern is `First 11/15 · Latest 14/15 · 3 attempts`.
- The *counted* distinction must be legible without a paragraph of explanation.
- Because this is the densest state on a surface deliberately kept calm, it is **typeset as fact, not as a scoreboard**.
- Tap anywhere opens Take Test or Results. State is reported factually, never as pressure or encouragement.

**Rejected alternatives.** Showing the first score alone was rejected — it reads as a bug to a student who scored higher on a later Attempt. Showing the latest alone was rejected — it makes the retake score the number the student optimizes, which is precisely what SM-C3 warns against.

#### Timer

**Surface.** Take Test, with configuration in Draft review.

**This entry is the single owner of timer behavior.** Two rules live elsewhere by necessity and are named here rather than restated: the grade consequence of expiry belongs to [Timer expiry and the `unanswered` state](#timer-expiry-and-the-unanswered-state), and the SC 2.2.1 requirements belong to [Accessibility Floor hard case 2](#accessibility-floor). No other section states a timer rule.

**Binding rules.**

- Optional, **off by default**, configured by the parent per Practice Test before release.
- Configuration lives with the draft in Draft review, with a suggested duration derived from the question count. Duration is entered in minutes.
- Editable up to release; after release the Practice Test is immutable, so the timer is too.
- Counts down wall-clock across interruption; the clock does not pause on backgrounding, refresh, or device sleep.
- Value changes in place, never animates per tick.
- **Warns three times before expiry — at 5 minutes, 1 minute, and 20 seconds remaining** — and announces at auto-submit. All four moments are mandatory, not optional polish. *Why these thresholds:* on a 20-minute Practice Test the 5-minute mark is genuinely actionable, because it is enough time to return to skipped Questions through the question map; the 20-second warning is a final submit-now signal.
- **Each warning is information, not alarm.** Three interruptions is real pressure on a surface deliberately kept calm, so the treatment is **identical at all three thresholds and never escalates**: no escalating color, no urgency styling, no exclamation marks, no motion. Each is carried by text, and announced through the timer's `aria-live` **at the thresholds only, never continuously**.
- Expiry auto-submits, and every blank Question is graded `incorrect`.
- The card on Student Home reports whatever this control set. *Why:* that is what makes a timed test never a surprise.

**Rejected alternatives.** An extendable duration is explicitly not taken — see Accessibility Floor hard case 2 for the exemption argument and the requirements accepted in exchange. Scaling the warnings to test duration (25% and 5% remaining) was rejected for v0: it is more correct for very short or very long tests and is the only option needing real logic. Recorded as the revisit if fixed thresholds prove wrong for atypical durations. A single warning was rejected — the SC 2.2.1 essential-exception argument rests partly on the student being warned with enough lead to act.

#### Explanation panel

**Surface.** Results (student), Attempt detail (parent).

**Binding rules.**

- Opens as an **inline expand beneath its row**; the row grows in place, the reader never loses position, and the Question stays adjacent.
- Holds its own loading, error, and at-cap states, all three rendered in [`mockups/key-results.html`](mockups/key-results.html) with the inline expand.
- In Student Mode it carries the FR-38 bad-Explanation flag and the FR-25 grade-dispute flag, **both of which raise to the parent's Analytics dashboard, never to Admin**. In Attempt detail it carries the parent's own FR-24a flag, which the parent may **originate** on any Explanation or use to **confirm or dismiss** one the student raised; only a confirmed flag reaches the Admin queue.
- **The student's flag never changes what the student is reading.** The panel stays open, the Explanation stays on screen, and the flag is recorded and raised. Only a parent decision removes it.
- **In Attempt detail the panel is also where suppression and regeneration live** (FR-39), both offered only after a flag exists on that Explanation. The parent reads the Explanation in full on this panel before either is reachable — the reading is the evidence, exactly as the grading rationale is the evidence a grade override is decided on.
- **In Student Mode the panel holds a fifth state — suppressed** — alongside loading, error, at-cap, and loaded. See [Explanation suppressed by a parent](#explanation-suppressed-by-a-parent).
- A failed, capped, or suppressed Explanation never blocks the rest of the screen — see State Patterns.

**Rejected alternatives.** A separate Explanation screen or modal was rejected: it separates the Explanation from the Question it explains, which is the one adjacency the pattern exists to preserve.

#### Mastery table

**Surface.** Analytics dashboard.

**Binding rules.**

- Ranked table with inline bars, **sorted weakest first**, **filterable by Subject** (FR-28), the filter defaulting to all Subjects and stated in the heading when narrowed.
- Each row: Topic, Mastery % (tabular figures), inline bar, the answered-question count behind the figure, and the `unanswered` count where any exist.
- Weak Areas marked with `{components.weak-area-marker}`.
- Row tap → Topic drill-down.
- The ranked table, the drill-down, the weighted-regenerate cost block, the empty state, and the tablet layout are rendered in [`mockups/key-analytics.html`](mockups/key-analytics.html).

**Rejected alternatives.** A bare percentage per Topic was rejected — see Mastery for why the skipped count travels with the figure.

#### Trend sparkline

**Surface.** Analytics dashboard.

**Binding rules.**

- **One dashboard-level sparkline** across the Student Profile's recent completed Attempts. No per-Topic trend lines.
- **Retake Attempts are excluded.**
- **The window is the 5 most recent qualifying Attempts**, and is stated with the chart. It is **the same count as FR-26's Mastery window but a different scope, and the two figures are not computed over the same Attempt set**: Mastery's window is per-Topic — the 5 most recent qualifying Attempts *that included that Topic* — while the sparkline's is per-profile. They select different Attempts whenever a profile has more than one Topic in play. *Why one count:* a reader must never be comparing a 5-Attempt figure against a longer-window one.
- Because *qualifying* excludes retakes, 5 qualifying Attempts may span considerably more than 5 sittings, so the sparkline **must never be labeled as a record of everything the student did**.

**Rejected alternatives.** Including retakes was rejected: the line would draw exactly the number SM-C3 warns against optimizing, and would rise on memorization. Per-Topic trend lines were rejected: per-Topic trend over a rolling 5-Attempt window is noise, and drawing it would imply precision the data does not support. A second, longer window for the trend was rejected: the sparkline and the Mastery table sit on the same screen, and two *lengths* of "recent" would let a parent compare a 5-Attempt Mastery figure against a longer-window trend and reach a conclusion neither figure supports, with no way to see that the windows differ. Matching the count does not make the two figures interchangeable — the scopes still differ, which is why the scope difference is stated with the chart rather than left to be inferred.

## State Patterns

Five states carry rules too heavy for a table cell and are specified beneath the table: **Offline during an Attempt**, **Explanation at cap**, **Explanation suppressed by a parent**, **Grade overridden by the parent**, **PIN idle timeout**.

| State | Surface | Treatment |
|---|---|---|
| Submit with gaps | Take Test | Confirmation names the count — "You haven't answered 2 questions" — with a path back to them through the question map. **The student can still submit.** Rendered in [`mockups/key-take-test.html`](mockups/key-take-test.html). Blocking was rejected (it traps a student on a question they cannot do); silent submission was rejected (it punishes a mis-tap). |
| Timer expiry | Take Test | **Auto-submits, and every blank Question is graded `incorrect`**, per FR-15. Work already entered is preserved and graded normally. See the Timer entry in Component Patterns. |
| Interrupted Attempt | Take Test | Survives backgrounding, refresh, and device sleep; resumes in place. |
| Camera permission denied | Capture pages | Not a dead end. States plainly that the camera is unavailable and offers **photo-library selection**, which is a first-class path for the same Source Test, plus a line on where to re-enable camera access. The same treatment covers a device with no camera. |
| Generation offline | Generate | The generate control states that a connection is needed and does not fire. Nothing is charged, since allowance is consumed on successful production. |
| Explanation first tap | Results, Attempt detail | **Foreground wait** on a model call, with the loading state living *inside* the expanded region, using the permitted progress motion. Cached thereafter — only the first tap waits. |
| Explanation failure | Results, Attempt detail | Inline error with a **manual retry**, no automatic retry. "Couldn't load that explanation." plus a retry control. *Why:* auto-retry can silently double a wait the product requires to stay short. The rest of the screen stays fully usable — a failed Explanation never blocks the answer key, another Question, a grade-dispute flag, or Retake. |
| Explanation suppressed | Results, Attempt history | FR-39. The student is shown that a parent removed the explanation — never an empty row, never an error, never silence. Specified in full at [Explanation suppressed by a parent](#explanation-suppressed-by-a-parent). |
| Grading unavailable | Results | Score **only the gradable Questions and name the gap**: "You answered 11 of 11 graded questions correctly. 4 aren't graded yet." No false denominator. Degraded grading is rendered in [`mockups/key-results.html`](mockups/key-results.html). |
| Ungraded resolves later | Results, Attempt detail | Grading **retries on next view** of the results screen, by student or parent. Retry must not block rendering. A resolved Question must be visibly a **newly graded item**, not a silently altered one. *Why:* a score can legitimately change between two viewings, and that must never read as the app changing its mind about the student's work. The parent's Attempt detail must not present a changed score as though it had always been that value. |
| Generation in flight | Generation progress | Progress screen the parent is **advised to stay on**, with progress motion — rendered in [`mockups/key-capture.html`](mockups/key-capture.html) after the generate step. Work continues server-side and **nothing is lost** on leaving; a parent who leaves finds the finished drafts in Pending drafts. *Why:* the warning is about discoverability, since v0 has no notifications and this screen is the only live completion signal — what is lost is immediacy, not progress. *This reading of the durability question was recorded as an interpretation of an ambiguous answer and is awaiting confirmation — see Open Questions.* |
| Generation failure | Generation progress | Retryable **without re-upload**. Allowance is charged on successful production, so a failed generation costs nothing. |
| Draft interrupted | Draft review | Drafts are **durable**. Unreleased drafts persist indefinitely with review position and any per-Question edits preserved. Released stays released; unreleased stays an editable draft. Pending drafts is where a returning parent finds them. |
| Delete to zero | Draft review | Deleting Questions is allowed down to one remaining (FR-13). **Deleting the last Question discards the Practice Test**, and the confirmation says so in those words before it happens. *Why:* the parent is choosing to discard, not to empty. The Generation Allowance already spent is not refunded, and the message says that too. |
| Page Images expired | Source Test detail | 90 days after upload the photos are gone by design (FR-32). Surfaces show a labeled empty tile reading *Photo deleted*, never a broken image or an error. The Source Test, its Extraction, and everything derived from it are intact, and regeneration still works — the screen states this. *Why:* an expired Source Test must not read as a broken one. |
| Early Page Image deletion | Source Test detail | Behaves identically to expiry. Confirmation names the page count being deleted and states that Practice Tests, Attempts, and Mastery survive. |
| Student Profile at limit | Students | Creation is blocked with a message naming the **Account Tier and its Student Profile limit**, and stating that only an Admin can change the tier in v0. No upsell, since there is no self-serve upgrade path to send the parent to. |
| Destructive deletion | Data & deletion, Student Profile detail | FR-33. Confirmation names what is destroyed by count and kind, states it cannot be undone, and takes the **account password**. Student Profile deletion removes that profile's Practice Tests, Attempts, Explanations, and Mastery, and is stated as distinct from archiving. Parent Account deletion names every Student Profile under it. Completion returns to Sign in for account deletion, or to Students for profile deletion, with a plain confirmation of what was removed. |
| Deliberate handover | Parent View | An explicit "Back to Student Mode" control always exists. **On an account with more than one Student Profile it prompts which profile the device should bind to** (FR-4), defaulting to the last-bound one. The silent timeout cannot prompt, so it uses the last-bound profile — the departure is logged. Initial binding is set when the first Student Profile is created, and thereafter by this prompt. |
| Empty Analytics | Analytics | **State the mechanism and show progress toward it:** "Mastery appears once Noah has answered at least 5 questions on a topic. His highest topic is at 3 so far." *Why:* an absence becomes a countdown, so an empty dashboard reads as working-correctly-not-yet rather than broken. A near-empty Free-tier dashboard is expected behavior, and must never be fixed by lowering the five-question Weak Area floor. Rendered in [`mockups/key-analytics.html`](mockups/key-analytics.html). |
| Other empty states | Parent View (no Source Tests, no Practice Tests, no Attempts, no Weak Areas, no open disputes) | Same mechanism-plus-progress pattern, so absence consistently reads as a threshold not yet met. |
| Empty Student Home | Student Home | Names the mechanism in the student's register: nothing to do yet, work appears when a parent releases it. No call to action the student cannot perform. |
| PIN cooldown | PIN entry | Three wrong entries lock Parent View for a cooldown. The failure count persists across app restart. Message states the lock and when it lifts; no attempt counter framed as a taunt. |

#### Offline during an Attempt

**Surface.** Take Test, Results.

**Binding rules.**

- Answering and navigating keep working — answers are held locally and the Attempt survives.
- **Submission requires the network.** A submit attempted offline states plainly that it needs a connection, keeps every answer, and retries on a person's action, never silently.
- **If a timer expires while offline, the Attempt is auto-submitted as soon as connectivity returns, graded against the expiry moment, not the reconnect moment.** *Why:* the student never gains time by losing signal, and never loses work by it either.
- Requesting an Explanation offline shows a connection statement distinct from both the generation-failure copy and the at-cap copy.

**Rejected alternatives.** Silent background retry of a submission was rejected — a submission is the moment the Attempt becomes a record, and it must never happen without the person knowing.

#### Explanation at cap (Free tier, Student Mode)

**Surface.** Results.

**Binding rules.**

- Plain statement naming the limit and the reset date: "You've used all 10 explanations this month. They reset on October 1."
- **No running counter is ever shown to the student.**
- Everything else stays functional at cap: the complete answer key, every previously generated Explanation on any test, the grade-dispute flag, and Retake.
- The copy blames the plan, never the child. *Why:* this is the one allowance wall that lands on someone who cannot act on it.
- Rendered alongside the loading and failed states in [`mockups/key-results.html`](mockups/key-results.html).

**Rejected alternatives.** A visible "6 of 10 left" readout was rejected — it would discourage a child from using a feature that exists to encourage asking. Blocking the rest of the results screen was rejected outright.

#### Explanation suppressed by a parent

**Surface.** Results and Attempt history (student); Attempt detail (parent).

This is the student-facing half of FR-39, and it is delicate for a reason worth stating: **the student already read this Explanation, and it is now gone.** They will return to the row that held it.

**Binding rules.**

- **The row says what happened.** The Explanation panel renders a **suppressed state** in place of the Explanation — never an empty expand, never a blank row, never the loading or error state, and never nothing at all. *Why:* saying nothing is the worse option here. A student who returns to a row that used to hold an explanation and finds it empty has three readings available — the app lost it, the app is broken, or their work is being altered without them — and every one of those is worse than the true one. The true one is short, and it is not about them.
- **The copy names the Explanation as the thing that fell short, and names the parent as the person who removed it.** It carries no blame, no correction, no instruction, and no exclamation mark, per [Voice and Tone](#voice-and-tone) constraint 7. Student Mode register, second person: **"A parent removed this explanation. It wasn't a good enough explanation of this question."** Nothing is said about why the student opened it or whether they should have.
- **No reason text, and no relay of the parent's flag.** The student is told the fact and its cause, not the parent's judgement in the parent's words. *Why:* a parent's note about a bad Explanation is written for an operator, and forwarding it to the child turns a quality signal into a message the parent did not address to them.
- **The `Explain this` control does not return on that Question while the Explanation is suppressed.** A student who could re-request it would undo the parent's decision with one tap — and on the Free tier would spend an Explanation Allowance unit doing it. The suppressed state replaces the control; it does not sit beside it.
- **Nothing else on the row or the screen changes.** The Question, the student's answer, the correct answer, the grade state on all four carriers, the score, Mastery, the grade-dispute flag, Retake, and every other Explanation on the test are untouched and stay fully usable. Suppression removes one Explanation, not a screen.
- **No call to action the student cannot perform.** The state does not tell the student to ask for a new one — regeneration is the parent's action, and the parent already knows, being the person who suppressed it. *Why:* this matches the Empty Student Home rule and keeps the deferred "ask a parent" prompt (revisit trigger 12) a single future decision rather than one made twice in two places.
- **Suppression is not reversible in v0, and the parent-facing confirmation says so before it fires.** There is no un-suppress: the suppressed state is not lifted, and the Explanation the student read does not come back. The remedy for a misclick is the free regeneration, which produces a **different** Explanation. *Why:* the blast radius of a misclick is one Explanation on one Question, regeneration is free at every tier, and an undo would need a second student-facing state change — something reappearing where something was removed, which is harder to explain to a child than either the removal or the replacement.
- **A regenerated Explanation replaces the suppressed state and is shown as a new one, not as the old one restored** — the same rule that governs a resolved `ungraded` Question and a parent grade override. The student sees a plain line that this is a new explanation. *Why:* the panel must never read as the app having changed its mind about what it said before.
- The suppressed state is announced through the same live region as every other state change that matters, using the same copy that is displayed.

**Rejected alternatives.** Silent removal was rejected on the reading above. Removing the whole answer-key row was rejected — it would delete the Question from the student's record to remove an Explanation, and the Attempt is a record. Framing the removal as a correction the student should learn from ("this explanation was wrong, here is the right one") was rejected: it makes a product-quality failure into a teaching moment aimed at the child. Offering the student a retry control was rejected for the same reason the control is withdrawn — it would defeat the parent's decision and could spend the Free-tier allowance to do it.

#### Grade overridden by the parent

**Surface.** Attempt detail, Results.

**Binding rules.**

- The same rule as `ungraded` resolution, and the answer is deliberately identical: the Attempt score changes, and the change is shown **as a change** rather than as the value having always been so.
- The row is marked parent-adjusted, the original AI grade and its rationale stay readable, and the affected Topic's Mastery is recomputed.
- In Student Mode the student sees the adjusted grade with a plain line saying a parent reviewed it — never framed as the student having been right or wrong to flag it.

**Rejected alternatives.** Overwriting the AI grade was rejected: the rationale is the evidence the override was decided on and must survive it. Silently restating the new score was rejected for the same reason a silently resolved `ungraded` Question is rejected.

#### PIN idle timeout

**Surface.** Parent View.

**Binding rules.**

- Fires **silently at 15 minutes of inactivity** — inactivity, not wall-clock session age — and returns to Student Mode on the **last-bound Student Profile**.
- Re-entry requires the PIN, and the three-wrong-attempts cooldown applies to re-entry identically.
- **Because there is no warning, in-progress parent work must persist without an explicit save:** a per-Question edit typed but not committed, review position within a draft, an uncommitted grade override, and any partially completed upload or classification step all survive.
- Re-entry returns the parent to where the session ended, not to the Parent View root.

**Rejected alternatives.** A warning before the timeout was rejected — a prompt on a shared family tablet is itself a disclosure that Parent View is open. The persistence requirement is the price of that choice, and it is a requirement rather than a mitigation.

## Allowances & Limits

Three counters, tracked separately, reset on the same calendar-month boundary **in the Parent Account's local timezone, not UTC**.

| Counter | Unit | Charged when | Visible to student | Visible to parent |
|---|---|---|---|---|
| **Upload Allowance** | Source Tests | A Source Test is successfully produced | No | Yes — and shown at the legibility-check override point, so a warned-about upload is a knowing spend |
| **Generation Allowance** | **Practice Tests** | Each Practice Test that reaches *draft* consumes one unit | No | Yes — in Allowances, and stated **before** the Generate and weighted-regenerate controls fire |
| **Explanation Allowance** (Free tier only, 10 new Explanations per calendar month) | Explanations | A **new** Explanation is generated, **except an FR-39 regeneration, which is never charged** | **Only on reaching it** — never as a running counter | Yes — in Allowances and on the Analytics dashboard band. The parent is the only person who can act on it |

At-cap behavior is owned by State Patterns: Upload and Generation both hard-block with a message naming tier, usage, and reset date; the Explanation at-cap state has its own entry.

**The boundary is the calendar month in the Parent Account's own timezone.** *Why:* FR-31 requires the at-cap message to name the reset date, which makes that message a promise with a date in it. A parent in Manila reading *Resets 1 October* and still being blocked at 08:00 on 1 October local sees an off-by-one at exactly the moment she is already frustrated by a wall. Rejected: UTC midnight with a locally rendered date, which creates that off-by-one; and UTC midnight with the timezone named in the message, which is honest but puts UTC jargon in front of a parent in a family product. **The timezone is captured at registration and is editable by the parent in Settings → Account & security.** *Why:* a family moves, and a stored-once timezone would leave the reset date the at-cap message promises pointing at a place the parent no longer lives. **A change applies from the next boundary onward and never to the period already running:** counts never move, no period is shortened, lengthened, or reset twice, and the control states which reset date the change takes effect on before it is saved. *Why:* a boundary that can be dragged mid-month is both a way to reset an allowance early and a way to make a stated reset date retroactively wrong, and the second is the failure the local-timezone rule exists to prevent. **Architecture consequences:** a timezone is stored per Parent Account, captured at registration and mutable thereafter; resets run **per account**, not as one global sweep; **all three counters for an account reset atomically** at the same instant so they never diverge; and the FR-30a Admin consumption view renders each account against **that account's own period** rather than a shared one. Accepted cost: this is genuinely more to build than a single sweep, and v0 has one operator and no users yet.

**The Generation Allowance is denominated in Practice Tests, not requests.** One unit = one Practice Test reaching *draft*, exactly as FR-31 states. A single FR-10 request may produce 1–5 Practice Tests and therefore consumes 1–5 units. **The request is bounded at initiation by the remaining allowance:** a parent with 2 remaining cannot request 5, and the selector disables the unreachable counts with the reason stated. *Why:* this is the reading that preserves the PRD's tier arithmetic and the "Free is a taste, not a trial" position — at 2 Practice Tests per month a Free account genuinely cannot cross the five-question Weak Area floor, which is what makes the empty-dashboard behavior correct rather than a defect. Denominating in requests would have allowed up to 10 Practice Tests per month on Free. **Every allowance surface, in both spines and every mock, uses Practice Tests as the unit.**

Discarding a draft does not refund the unit — it was spent producing the draft. Retaking pages after a thin-Extraction warning consumes no Generation Allowance, and the warning says so. A failed generation costs nothing.

**An FR-39 regeneration is free at every tier, Free included, and the control says so before it fires.** *Why:* the replacement exists because the product generated bad output, and charging the parent to fix that is not a defensible cost position — least of all on the tier where a child would otherwise lose an Explanation and the means to replace it in one action. **The loop is bounded by parent effort, not by allowance:** a regenerated Explanation is itself flaggable and suppressible on the same terms, with no ceiling. **Architecture consequence:** the Explanation counter must distinguish a charged generation from a free one at the point of generation, since both produce a retained Explanation and only one moves a counter.

**AI grading is never capped, at any tier.** **Reading an already-generated Explanation is never capped, at any tier** — with **exactly one carve-out, an Explanation suppressed under FR-39**, which stops being served to that Student Profile and is not re-served from cache. It is the only case in the product where an Explanation a student already read stops being available to them, and it exists because a person decided it should, never because a counter ran out. Otherwise previously generated Explanations remain accessible indefinitely, which is free to honor because every Explanation is already retained and readable by the parent. **The Plus, Family, and Internal tiers** are uncapped on Explanations.

*Why capping generation rather than access:* identical cost control, but no student ever loses access to an Explanation already read **because of an allowance**, and the limit is only ever met on genuinely new content. The FR-39 carve-out does not weaken this: an allowance never takes an Explanation away, and a parent judgement is not an allowance.

The Explanation Allowance is **the only allowance wall in the product that lands on a person who cannot act on it** — a student cannot upgrade, cannot request more, and did not know a limit existed. Its copy is constrained accordingly (see Voice and Tone). The **Admin per-account consumption view carries all three counters**, including Explanations generated. *Why:* it is the only place the cost of the override is observable.

## Interaction Primitives

- **Tap to act.** No long-press affordances beyond system text selection.
- **Every control is a real control.** Buttons are `<button>`, links are `<a>`, fields are `<input>` / `<textarea>`. No `<div>` or `<span>` carries an action, an `aria-expanded`, or a state anywhere in the product. *Why:* this is stated as a primitive because the original reference mocks all violated it.
- **Test navigation is linear plus a question map.** Back / Next is the primary path; the map is the escape hatch. *Why:* linear-only was rejected on three grounds — it makes the submit-with-unanswered warning unactionable, paper tests let you flip pages freely so linear-only is *less* faithful to the metaphor, and on-screen standardized tests behave this way, which serves *no surprises on test day*.
- **Continuous capture.** The viewfinder stays open across pages. Corrections happen on the thumbnail strip afterwards.
- **Motion is functional plus progress only.** Permitted: question-to-question transitions, Explanation expand/collapse, question-map open/close, page and route transitions, and the generation wait. Motion is never decorative and never expressive of brand character.
- **Banned:** any flourish on the results reveal (no score count-up, no reveal sweep, no celebration), per-tick timer animation, sparkline draw-in, streaks, badges, mascots, points, confetti, infinite scroll, hover-only affordances on touch viewports, modal stacks more than one level deep.
- `prefers-reduced-motion` is honored across the product.

## Accessibility Floor

Behavioral. Contrast values live in `DESIGN.md`.

Scope is the **WCAG 2.1 AA floor plus explicit answers for the four hard cases this product creates**. No broader AAA commitment. *Why:* full AAA would effectively rule out the optional countdown timer, which is a real feature. Where AAA is met without additional cost, it is kept.

**1. Typographic fractions.** A stacked or CSS-composed fraction is announced badly by screen readers — a rendered one-half can read as "one two" — and a math question read aloud incorrectly is a wrong question. Two mechanisms, deliberately different:

- **Generated content** (Question text, answer keys, Explanations): the rendered fraction is marked `role="img"` with a spoken text alternative — "five sixths", not "five six". **This half is decided and closed.**
- **Student input — this is the sole owner of the smart fraction field's behavioral spec.** The field is a **real labeled `<input>`** whose value is always the raw typed string, and **that raw string is the accessible value** — there is no second representation to disagree with it. **The raw typed string is what is submitted** for AI semantic grading, which already accepts `one half`, `1/2` and `0.5` as equivalent. The typographic stacked render lives in an `aria-hidden` sibling, so nothing is announced twice. Rendering must never move the caret, lose input, or block typing a non-fraction answer, and it degrades to plain text on failure. Pattern recognition may announce once through a polite live region; the input itself must never be replaced, overlaid, or transformed. **This half is decided, and the mechanism is built** — see [`mockups/key-take-test.html`](mockups/key-take-test.html): the caret never moves because the input is untouched, a non-fraction answer types freely, and the raw string is what is submitted for grading. **It carries real implementation risk and is not a styling detail.** *Why:* keeping an `aria-hidden` sibling aligned with the input's text across font loading, zoom, text scaling, and variable-width digits is difficult to keep reliable, and it has never been built outside a mock. **If alignment proves unreliable, the fallback is display-only typographic fractions in Questions, Explanations and the answer key with a plain unstyled input** — never a numerator/denominator widget, which would reintroduce the format lock-in this design already rejected.

**2. The timed test — SC 2.2.1 Timing Adjustable, exemption argued explicitly.**

The countdown timer imposes a time limit, and auto-submit at expiry is exactly the pattern SC 2.2.1 governs. **The exemption taken is the essential exception**, and it is argued here rather than assumed:

- **The time limit is part of what is being simulated.** The product's thesis is *no surprises on test day*. A Practice Test with an extendable clock is no longer a practice of the thing the student is preparing for; removing or extending the limit would invalidate the activity, which is the definition the essential exception turns on.
- **The timer is optional and off by default** (FR-15). The default path through the entire product has no time limit at all. A student who cannot work under a clock is never obliged to meet one.
- **The limit is parent-configured, not system-imposed.** A human who knows this child sets the duration per Practice Test in Draft review before release, and can set it longer, or not at all. *Why this half matters:* without a reachable configuration surface the exemption would rest on a control nobody could use, and the argument would be an assertion rather than a fact. The surface is named in the IA and specified in the Timer entry.

**The extendable-duration option is explicitly not taken.** In exchange, the following are requirements, not enhancements, and are defects until built:

- **A pre-expiry warning with enough lead to act.** Announced politely at 5 minutes, 1 minute, and 20 seconds remaining, each with a **matching visible change carried by text**, not by color or motion alone.
- **`role="timer"` on the countdown**, with `aria-live` off in steady state so the value is not announced every second. `aria-live` is raised only at the three warning thresholds above.
- **An `aria-label` on every timer instance**, including the collapsed and tablet-rail variants, carrying a spoken unit-bearing value. Every timer state is rendered in [`mockups/key-take-test.html`](mockups/key-take-test.html), pre-expiry warning included.
- **An announcement at auto-submit**, fired via `role="alert"` before the route change, with focus landing on the results heading. *Why:* a screen-reader user must never be silently submitted, and must never discover expiry by finding a different screen.

**3. The question map.** 15 cells of `Answered` / `Not answered` progress state must be **keyboard navigable and individually announced with their state**, not merely visually distinguishable. Cells are real buttons carrying a per-cell state string, `aria-current` on the active Question, a `{spacing.tap-target.student}` minimum target, a visible focus ring, and an on-screen legend.

**4. Four grade states.** `correct`, `incorrect`, `unanswered`, `ungraded` — each conveyed on all four carriers from `{components.grade-state-marker}` and **announced distinctly using the same literal label that is displayed**, never by color alone. A grayscale rendering must remain fully readable. All four are rendered in [`mockups/key-results.html`](mockups/key-results.html).

Standing requirements: tap targets at `{spacing.tap-target.student}` in Student Mode and `{spacing.tap-target.parent}` in Parent View and Admin; every control a real focusable element with an accessible name; icon-only controls labeled with the object they act on, including the page ordinal on capture-strip controls; the capture strip exposed as an ordered list naming each page's ordinal and legibility state; `role="status"` on the generation-progress step list; visible focus everywhere via `{components.focus-ring}`; focus order follows reading order; `prefers-reduced-motion` honored; and every state change that matters — grade resolution, grade override, save, submit confirmation, allowance block, and an Explanation's suppressed state — announced via a live region, using the same words that are displayed.

## Key Flows

Journey names mirror PRD §2.3 verbatim.

### UJ-1 — Maria turns Friday's returned math test into Sunday practice

1. Maria opens n-test-reviewer on her phone, already signed in from a prior session. She taps **Parent View** and enters her Parent PIN.
2. She taps **Upload Test**, selects the Student Profile *Noah*, and picks Subject *Math*, Grade Level *5*.
3. The camera opens and stays open. She shoots page 1, 2, 3 without leaving the viewfinder; each lands in the ordered thumbnail strip below. (She could equally have multi-selected the photos from her library — mixed freely, same Source Test, the distinction never surfaced. Had the camera been unavailable, the library path would have been offered rather than a dead end.)
4. She finishes capture. The batch legibility check runs immediately, before anything else. All three pass. Had page 2 failed, the result would name *that page*, offer a retake of it alone, state that proceeding is allowed, and show that proceeding spends an Upload Allowance.
5. She taps **Generate** and chooses 2 Practice Tests. The selector is bounded by what her allowance can actually produce, and the control states the cost in Practice Tests before it fires.
6. The generation progress screen advises her to stay. She stays. (Had she left, the work would have continued and the drafts would have appeared in **Pending drafts**.)
7. Draft review opens on draft 1 of 2 — the full question list, 15 Questions, each tagged with a Topic, set in Literata as paper-role content. Two questions are garbage; one references a diagram that was never uploaded. She deletes both in place and fixes a typo in a third.
8. Still in Draft review, she turns the **timer** on and sets 20 minutes. It was off by default; the suggested duration came from the question count.
9. She taps **Release to Noah**. Draft 1 is released on its own; draft 2 stays a draft until she reviews it. She reviews and releases it too.
10. **Climax:** the two Practice Tests appear on Noah's Student Home as unstarted cards, sorted to the top of the list — each card already telling him the Subject, the Grade Level, that there are 15 Questions, and that a 20-minute timer is on.
11. Under five minutes, and she did not write a single question.

*Interruption at any point costs position only: drafts are durable down to uncommitted field input, and the PIN timeout returns her to where she was.*

### UJ-2 — Noah takes a practice test and finds out he doesn't understand remainders

1. Noah picks up the family tablet on Sunday. No login — the app is already in Student Mode on his profile.
2. Student Home shows two unstarted Math cards at the top. He taps the first, having already seen from the card that it is timed at 20 minutes.
3. Take Test opens: one Question at a time, "Question 1 of 15", the timer counting down in tabular figures at the top, changing value in place without moving.
4. He answers through the set — some Multiple Choice, some Fill-in-the-Blank (one typed as `1/2`, live-rendering as a proper fraction beside the field while the field itself still holds the raw string), two Short Answer he types out. He skips one and uses the question map to jump back to it.
5. He taps **Submit** with 8 minutes still on the clock. Two Questions are unanswered, so a confirmation names the count and offers a path back through the map. He submits anyway. Because he submitted manually rather than running out of time, those two record as **Unanswered**. Had the clock reached zero instead, the Attempt would have auto-submitted — announced, not silent — and both would have been graded **Not correct**.
6. **Climax:** the results screen appears immediately. "You answered 11 of 15." The score simply appears — no count-up, no animation. Below it, every Question in original order with his answer, the correct answer, and its grade state carried on icon frame, glyph, literal label, left-rule texture, and color; the two he skipped read *Unanswered*, not *Not correct*.
7. On Question 7 — a division-with-remainders word problem — he taps **Explain this**. The row expands in place; the Explanation loads in a foreground wait inside the expanded region, then appears in Literata, pitched at Grade 5. He never loses his position in the list, and the Question is still right there above it.
8. He taps **Retake**. The new Attempt is scored and kept in his history. His card now reads `First 11/15 · Latest 14/15 · 2 attempts` — both numbers, the first marked as the counted one, set as fact rather than as a scoreboard — and his mother's Attempts list marks the retake as non-qualifying in the same terms.

*Failure: the Explanation doesn't load → "Couldn't load that explanation." plus a retry control inside the expanded region. Nothing else on the screen stops working. At the Free-tier cap: a plain statement of the limit and reset date, no counter, everything else still working. Disagrees with a mark: he flags it (FR-25), and the dispute appears on Maria's **Analytics dashboard** beside the activity summary for Noah, opening **Attempt detail** at that Question — where she reads the AI's grading rationale and can override the grade, recomputing his score and the Topic's Mastery. Thinks the Explanation itself is wrong: he flags it (FR-38), and it waits on Maria's dashboard band for a disposition. She reads it in full, confirms the flag — which sends it to the operator — then suppresses it and asks for a replacement, which costs her nothing and says so before it runs. Next time Noah opens that row it reads "A parent removed this explanation. It wasn't a good enough explanation of this question.", with the rest of the row untouched; the replacement, when it lands, arrives plainly marked as a new explanation.*

### UJ-3 — Maria checks the damage behind the PIN

1. Sunday night, Maria picks up the tablet Noah just used. She taps the profile icon, then **Parent View**, and enters her PIN.
2. The Analytics dashboard opens on Noah — one Student Profile at a time, with the profile switcher persistent in the chrome. The activity summary leads: how many released Practice Tests are unstarted versus completed — and beside it, the grade Noah disputed, which is the one time-sensitive thing on the screen.
3. The Mastery by Topic table is ranked weakest first and filterable by Subject: *division with remainders 40%, 3 unanswered* with a Weak Area marker (triangle frame, exclamation glyph, the words *Weak Area*, color), then the rest, each row carrying an inline bar and the answered-question count behind the figure. *equivalent fractions 90%* sits near the bottom. A single dashboard-level sparkline shows the trend across his recent qualifying Attempts — retakes excluded, so the line cannot rise on memorization.
4. Her 30-second scan begins exactly where the work is, and the "3 unanswered" tells her the 40% is partly a choice-to-skip problem, not only a knowledge problem. It would not have said that if the clock had run out — expiry grades blanks as incorrect, so an expired Attempt contributes no unanswered count at all.
5. She taps the division row. The Topic drill-down shows the three specific Questions he missed with the answers he gave — Literata, paper role, because this is generated Question content shown to a parent.
6. **Climax:** she now knows exactly what to sit down with him about. **Generate more on this** sits directly beneath the evidence, Topic pre-selected — and states before it fires how many Practice Tests it will make and what that leaves of her Generation Allowance, in Practice Tests. She taps it knowingly.

*Edge case: three wrong PIN entries lock Parent View for a cooldown, so a curious 10-year-old cannot brute-force it. If she walks away mid-drill-down, the session ends silently at 15 minutes and returns to Student Mode on the last-bound profile; her uncommitted work is intact when she PINs back in.*

### UJ-4 — Admin adds a subject before the school year

1. The Admin signs into the separate Admin surface. It inherits the `DESIGN.md` theme unchanged and runs at `density.compact` on the Parent View accent — same tokens, no bespoke craft.
2. Subjects & Grade Levels: he adds Subject *Science* and enables it for Grade Levels 4 through 6.
3. **Climax:** parents of students in those grades can now select *Science* at upload time. Existing Practice Tests, Source Tests, and Analytics are unaffected; disabling a Subject later removes it from new-upload selection only, and renaming propagates by reference.
4. He passes through **Parent Accounts** to set one account to Internal — where consumption reads as uploads used, Practice Tests generated, and Explanations generated, all against allowance — and glances at the **Flagged Explanations** queue.

*The flagged-Explanation queue is the one Admin screen with a claim on real attention: Explanations ship to students without a parent gate, so the parent-confirmed flag is the entire after-the-fact accountability mechanism for child-facing AI content. It needs the flagged Explanation, its Question, the Practice Test and Student Profile context, and the **Grade Level** (Explanations are written per grade, so an operator must judge against the right one) visible fast enough that the queue actually gets worked.*

## Responsive & Platform

**Breakpoint-specific layouts only where the device changes the task.** Most screens are a single fluid layout per surface, unchanged between phone and tablet.

| Screen | Phone | Tablet |
|---|---|---|
| **Take Test** | Single column at the `{typography.measure.questionMaxWidth}` measure; question map opens as an overlay. | Tablet-first, read at arm's length. The `{typography.measure.questionMaxWidth}` measure caps line length regardless of viewport, so real width is left over — it is allocated to a **persistently visible question map** beside the Question rather than to a wider column. The rail shows answered / not-answered state only: no score, no correctness hint, nothing that would constitute mid-test feedback. |
| **Analytics dashboard** | Phone-first, in-hand: Mastery table full-width, sparkline and summary above, one column. | Remains scannable seated: sparkline and summary sit in a fixed left column alongside the Mastery table rather than stacking, and the phone row's stacked sub-line becomes real answered / unanswered / Weak Area columns. No reduction in row density. Rendered in [`mockups/key-analytics.html`](mockups/key-analytics.html). |

**Density is split by surface; breakpoint is independent.** `DESIGN.md` owns the rule: components read `{spacing.density.comfortable}` or `{spacing.density.compact}` by surface, never by breakpoint.

Desktop is supported but not optimized. The fluid layouts must not break there; no desktop-specific work is in v0.

## Open Questions

Unresolved items first, then every recorded revisit condition. Numbers are stable and are cited elsewhere.

### Unresolved

| # | Question | Status |
|---|---|---|
| 1 | How does the parent switcher's "outstanding work" at-a-glance signal render when it is not cheap to compute? | Open — mitigation stated, mechanism not specified |
| 3 | **No Key Flow reaches Students or Settings.** Both now carry Component and State Pattern rows, but no journey exercises profile management, PIN change, allowance review, or deletion end to end — inherited from the PRD, since none of UJ-1 to UJ-4 covers them. A flow that has never been walked has never been pressure-tested. | Open — coverage gap, surfaced not invented |
| 4 | **Generation-progress durability** was recorded explicitly as an interpretation of an ambiguous answer ("A" among three A-variants): generation continues server-side and no work is lost, the warning being about discoverability only. The hedge is repeated inline everywhere the reading is used. **Confirm this reading.** | Needs confirmation |
| 17 | Should the flagged-Explanation review queue receive craft beyond the inherited theme? Its claim is stated in the UJ-4 footnote. | Open — candidate, not a v0 commitment |

### Revisit triggers

| # | Condition | Status |
|---|---|---|
| 5 | **Accepted weakness of the dashboard summary band.** The band now carries **three** item types — FR-25 grade disputes, FR-38 student Explanation flags awaiting disposition, and the Free-tier Explanation Allowance readout — while not being a queue. Two of the three carry a disposition and one is a standing figure, so it reads less well as either count grows. If either flag type becomes frequent enough that the band cannot carry it, promote **both flag types** to a dedicated destination with a dashboard badge, rather than splitting them across two patterns; **the allowance readout stays on the dashboard either way**, since it is a figure among figures and belongs where the parent already reads them. | Accepted weakness, revisit condition recorded and strengthened twice |
| 6 | If the `aria-hidden` fraction render proves impossible to keep aligned with the input across font loading, zoom, text scaling, and variable-width digits, fall back to display-only typographic fractions with a plain input — never a numerator/denominator widget. | Fallback decided, trigger is build evidence |
| 7 | If students scroll past a long completed tail on Student Home to reach unstarted work, introduce a **bounded tail** (unstarted plus last 3–5 completed), not a date-based expiry — a fixed ceiling behaves predictably across tiers, a calendar rule has no relationship to how a student studies | Post-launch trigger |
| 8 | If SM-1 (upload-to-release completion, ≥80%) comes in below target, **per-page capture-time legibility checking** is the first thing to try | Post-launch trigger |
| 9 | If parents routinely generate 3+ drafts per request, add the **draft index screen** rejected for v0 | Post-launch trigger |
| 10 | If Family-tier accounts become common, add the **all-children overview strip** above the per-child Analytics detail | Post-launch trigger |
| 11 | If parents report missing completed generations, add the **persistent cross-app generation indicator** (rejected option B) | Post-launch trigger |
| 12 | If support signal shows children stuck at the Explanation cap, add the **"ask a parent" prompt** — deferred, not dismissed | Post-launch trigger |
| 13 | Naming the Free tier's 2-Practice-Test monthly allowance as the cause of an empty dashboard becomes the right answer **the moment a self-serve upgrade path exists**; until then it is a frustration with no exit | Gated on upgrade path |
| 14 | Results-screen depth — an intermediate **per-Topic summary band** between the score and the question list is the natural first addition | Deferred |
| 15 | The question map is the natural home for a **flag-for-review** affordance; out of v0 scope, but the choice leaves the door open | Deferred |
| 16 | Admin auth depth, roles, and audit logging are deliberately thin and must be revisited **before any third-party operator exists** | Gated |
| 18 | If support signal shows parents suppressing Explanations in error, **add reversal to FR-39** rather than softening the confirmation. The v0 position is no reversal, with the free regeneration as the remedy | Post-launch trigger |

*Closed since the last revision: suppression reversal (question 18), decided as **no reversal in v0** with the free regeneration as the only forward path — the rule now lives with the suppression control and the suppressed-state pattern, and its revisit condition is recorded above under the same number; the smart fraction input mechanism, now built and confirmed in `mockups/key-take-test.html` with its fallback recorded above; the trend sparkline window, now fixed at 5 qualifying Attempts per profile; the Practice Test card's post-retake score display; FR-25's Parent View destination, now the Analytics dashboard; the Explanation at-cap state, now rendered in `mockups/key-results.html`; and the allowance reset boundary, now the calendar month in the Parent Account's local timezone. Closed earlier: the `role="img"` plus spoken-alternative rule for generated fractions; the SC 2.2.1 exemption, argued explicitly rather than recorded as an open call.*

## Decisions That Travel Upstream

Recorded here because they change documents this workflow does not own. Architecture must not inherit a contradiction.

### PRD overrides

- **FR-31 / §5.3 is partially overridden, user-directed and explicitly confirmed.** The PRD states AI grading and Explanations are *never* blocked by an allowance and that a student must never hit a wall mid-study-session. **New rule: the Free tier gets an Explanation Allowance of 10 new Explanations per calendar month.** Generation of a new Explanation is capped; **reading** an already-generated Explanation is never capped, at any tier. **AI grading remains uncapped at every tier, unchanged.** Plus / Family / Internal remain uncapped on Explanations. Consequences: a third counter, a new at-cap state in Student Mode, and an Explanation column in the Admin consumption view. **This belongs in a PRD update.**

### Raised back to the PRD by this revision

- **Suppression reversal is unspecified.** FR-39 gives the parent suppression and regeneration and says nothing about undoing a suppression. This spine took the position that **v0 offers no reversal** and treats regeneration as the only forward path. **That position is now confirmed and carried in FR-39 itself**, together with the requirement that the parent-facing confirmation state the action is not reversible. Question 18 is closed; its revisit condition is recorded above. Nothing else in the FR-39 back-update needs a PRD change.
- **The Explanation Allowance is an account-level figure now rendered on a per-profile screen.** FR-31 holds the allowance against the Parent Account, while the Analytics dashboard is scoped to one Student Profile and every other figure on it is per-profile. The readout therefore states its own scope. **No PRD change is required, but a workflow deriving acceptance criteria from FR-28 must not write a per-profile Explanation counter.**

### Corrections to this workflow's own record

- **FR-15 was never silent on timer expiry.** This workflow asserted during design that the PRD did not say what expiry does, and filed the resulting "unanswered at expiry, not wrong" decision as a **gap closure**. That premise was false: FR-15 states expiry auto-submits **with unanswered Questions graded incorrect**. The design is now **aligned with FR-15**, not overriding it — expiry grades blanks `incorrect`, and `unanswered` survives only for untimed Attempts and manually submitted timed ones. **No PRD change is required for this, and none should be raised.** The auto-submit behavior itself is compliance with an existing requirement, not a UX-originated addition.
- **Camera roll is not a PRD gap.** FR-5 is titled *Multi-page capture **and library selection*** and already mandates photo-library access with library multi-select on mobile web. The earlier "gap closed" framing would have produced a duplicate PRD requirement. The behavioral elaborations stand and are worth keeping: library images mix freely into one Source Test, the shot-vs-selected distinction is never surfaced, and the 1–10 ceiling and legibility check apply identically. FR-5's own ambiguity — multi-select required, yet "captured or selected one at a time" — is resolved in favor of **multi-select**, and that resolution is stated in the Capture strip pattern.

### Departures from the PRD, logged

Each of these diverges from a stated requirement. None is silently absorbed.

| # | PRD source | Departure | Disposition |
|---|---|---|---|
| D1 | **FR-16** — Practice Tests "grouped and labeled by Subject and state" | Student Home is a **flat list with no Subject grouping**, sorted unstarted-first then completed-newest-first | **Departure stands.** Grouping adds a header for nothing at the UJ-2 case of two Math cards, and the sort does the work at 15 cards across three Subjects. A workflow deriving acceptance criteria from FR-16 must not write a grouping requirement. |
| D3 | **§9.1 MVP scope** — dark mode is not listed | **Dark mode ships in v0**, with every token given a dark counterpart and every pair verified in both modes | **Departure stands.** Scope addition, not a contradiction. Cost is doubled contrast verification, already paid. |
| D4 | **No PRD basis** | **Parent View idle timeout at 15 minutes**, firing silently and returning to Student Mode | **New requirement, UX-originated.** The PRD gates Parent View by PIN but never bounds the session, which on the shared-family-tablet pattern it names as dominant leaves a forgotten session open all evening. Carries a hard consequence: uncommitted parent input must persist without an explicit save. Belongs in a PRD update. |
| D5 | **FR-4** — exiting Parent View on a multi-profile device prompts which profile to bind | Prompt **restored** on the deliberate "Back to Student Mode" path. The **silent idle timeout cannot prompt** and binds to the **last-bound Student Profile** | **Partial departure, scoped to the silent path only.** Initial binding is set at first Student Profile creation. The earlier undefined "the correct Student Profile" is replaced by this rule. |
| D6 | **FR-28** — "Mastery is presented per Topic, filterable by Subject" | Filter was dropped | **Restored.** The Mastery table carries a Subject filter defaulting to all Subjects. Invisible with one Subject; necessary the moment two are released, since Topics are scoped per Subject under FR-26a. |
| D7 | **FR-9a** — thin-Extraction warning states usable-question and page counts, and retaking consumes no Generation Allowance | Both were dropped | **Restored.** Both are now in the thin-Extraction warning pattern. The allowance guarantee is the load-bearing half: without it the parent chooses blind between a bad generation and an unknown cost. |
| D8 | **FR-30a** — Admin consumption view | The Explanation counter created by the FR-31 override was missing | **Restored.** Admin per-account consumption shows uploads, Practice Tests generated, and Explanations generated. |

**Retired departure.** D2 is retired — it is not a row in the table above and carries no disposition. It logged a departure from FR-24 that pitched Explanation language to the Student Profile's Grade Level. The design now pitches to the **Practice Test's** Grade Level, which is what FR-24 says, so there is no departure and no override to carry: Grade Level is passed into Explanation generation from the Practice Test. The remaining departure numbers are unchanged so that anything already citing D1 or D3–D8 still resolves.

### Constraints landing on architecture and prompt work

A pointer index. Each rule is binding where its owner section states it; this table exists so an architecture reader can find all of them without reading the spine end to end.

| Rule | Binding line | Owner |
|---|---|---|
| Grade-adaptive Explanation language | Explanation generation receives a Grade Level, and it is **the Practice Test's**, passed in from the Practice Test rather than read from the Student Profile (FR-24 as written) | Below, plus [Voice and Tone](#voice-and-tone) constraint 4 |
| Fractions are a structured generation output | Questions, answer keys, and Explanations emit fractions in a renderable structured form, each rendered fraction carrying a spoken text alternative; student input stays a free-text string | [Accessibility Floor](#accessibility-floor) hard case 1 |
| Smart fraction field carries real implementation risk | Estimate and test it as a component in its own right; the recorded fallback is display-only typographic fractions with a plain input | [Accessibility Floor](#accessibility-floor) hard case 1 |
| FR-25 dispute surface | The Analytics dashboard, scoped to the selected Student Profile, drilling into Attempt detail; no separate flagged-items destination in v0 | [Information Architecture](#information-architecture) |
| FR-38 flag routing | A student's flag surfaces to the parent on the same dashboard band and reaches the **Admin Flagged Explanations queue only once the parent confirms it**; the parent can also originate a flag on any Explanation independently (FR-24a). Admin never receives an unconfirmed student flag, and a student flag never alters what the student is reading | [Information Architecture](#information-architecture) |
| FR-39 suppression is a per-Student-Profile serving rule, not a deletion | A suppressed Explanation is **retained, readable by the parent, and still visible to Admin**, and stops being served to that Student Profile from every surface including cache. Serving is therefore filtered per profile at read time rather than by removing the record; suppression touches no Question, Attempt, score, or Mastery value | [Explanation suppressed by a parent](#explanation-suppressed-by-a-parent) |
| FR-39 regeneration is uncharged | The Explanation counter must **distinguish a charged generation from a free one at the point of generation** — both produce a retained Explanation and only one moves a counter — and the replacement is generated fresh rather than served from cache | [Allowances & Limits](#allowances--limits) |
| Parent Account timezone is mutable | Editable in Settings; a change applies **from the next boundary onward, never to the period already running**, so no period is shortened, lengthened, or reset twice and no already-stated reset date becomes retroactively wrong | [Allowances & Limits](#allowances--limits) |
| Three allowance counters | Upload (Source Tests), Generation (**Practice Tests**), Explanation (Explanations), tracked separately on one calendar-month boundary **in the Parent Account's local timezone**; a timezone is stored per account at registration, resets run per account, all three reset atomically, and the Admin consumption view carries all three against each account's own period | [Allowances & Limits](#allowances--limits) |
| Generation request bounded at initiation | FR-10's up-to-5-per-request cap and FR-31's per-Practice-Test charge interact, so **the selector must be clamped server-side, not only in the UI** | [Allowances & Limits](#allowances--limits) |
| Third and fourth grade value | `unanswered` and `ungraded` carried through Attempt storage, the answer key, Mastery computation, and the parent drill-down, with the expiry rule deciding which of `incorrect` or `unanswered` a blank Question receives | [Grade States](#grade-states) |
| Parent grade override is a write path into a submitted Attempt | Recomputes the Attempt score and the affected Topic's Mastery, retains the original AI grade and rationale rather than overwriting them, and is reflected in Student Mode as a visible change | [Grade overridden by the parent](#grade-overridden-by-the-parent) |
| FR-22's grading rationale | **Persisted and readable, not merely logged** — it is the evidence the override is decided on | [Component Patterns](#component-patterns), Grading rationale |
| Uncommitted parent input persists without an explicit save | Per-Question edits, draft review position, an uncommitted grade override, and a partially completed upload or classification step all survive the silent timeout and are restored exactly | [PIN idle timeout](#pin-idle-timeout) |
| Ungraded Questions retry grading on next view | By either student or parent; **no background job**, and the transition must be legible rather than silent | [State Patterns](#state-patterns), Ungraded resolves later |
| Timer expiry must be resolvable offline | An Attempt whose timer expires offline auto-submits on reconnect, graded against the expiry moment | [Offline during an Attempt](#offline-during-an-attempt) |

**The Grade Level sourcing argument, stated here because it lands outside UX.** Sourcing the Explanation's Grade Level from the Practice Test rather than the Student Profile makes the Explanation cache key stable for the life of the Question, which FR-24a's retention requirement depends on: sourcing from the Student Profile would mean an FR-3 Grade Level change either invalidates every cached Explanation for that profile or leaves stale ones that no longer satisfy the rule. The two sources diverge only on old Practice Tests after a parent changes a profile's Grade Level, and old material is exactly where the original grade framing is the correct teaching frame — an Explanation exists to explain one specific Question, generated for a reader at the Source Test's Grade Level in that grade's vocabulary, and pitching the Explanation elsewhere would have the question and the explanation talking past each other inside a single screen. Two costs land outside UX: Explanation quality becomes harder to evaluate and regression-test, since there is no single target reading level and quality assessment needs per-grade expectations; and the flagged-Explanation review queue must show Grade Level as context so an operator judges against the right bar.
