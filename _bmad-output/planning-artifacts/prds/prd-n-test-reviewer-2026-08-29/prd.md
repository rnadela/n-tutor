---
title: n-test-reviewer
status: final
created: 2026-08-29
updated: 2026-09-01
---

# PRD: n-test-reviewer
*Working title — confirm.*

## 0. Document Purpose

This PRD defines version 0 of **n-test-reviewer**, a mobile-first web app that turns a photographed school test into AI-generated practice tests a student can take, self-check, and have explained. It is written for the PM, the downstream architecture and UX workflows, and the implementing developer.

**How to read it.** Vocabulary is fixed in §3 Glossary and used verbatim everywhere else. Features are grouped in §4, with globally numbered functional requirements (FR-N) nested under them — every FR without exception, including FR-31, which lives in §4.10 and whose tier table and cost philosophy stay in §5.3. §3.1 indexes every FR to its section. Cross-cutting quality lives in §10.

**Conventions.**
- **Sub-blocks.** Each §4 subsection opens with `Description:` and `Functional Requirements:`. Inside an FR, only three labeled sub-blocks are permitted: `Consequences (testable):`, `Notes:`, and `Feature-specific NFRs:`. A fourth, `Out of Scope:`, is permitted at feature level only, after the last FR of a §4 subsection. No other labeled block appears anywhere in §4. Nothing in a `Consequences (testable):` list is argument; rationale belongs in `Notes:` or in an indented *Why:* line beneath the bullet it justifies.
- **Numbers.** §5.3's tier table is the single authoritative source for every allowance figure. Any other section names a limit by reference to that table, never by restating the number.
- **Tags.** Assumptions are tagged inline as `[ASSUMPTION]` and indexed in §13. Knowing deferrals are tagged inline as `[NOTE FOR PM]` and indexed in §14.

No prior UX doc, product brief, or research artifact exists. This PRD is the first planning artifact for the product, produced from a stakeholder brain dump and successive rounds of decision-making. Every question raised in drafting has been resolved and recorded in §12.1; the inferences that remain unconfirmed are indexed in §13 and are the intended review surface. §6.2 records an inherited technical constraint that bounds the downstream architecture workflow.

## 1. Vision

Kids study for tests by re-reading the test they already took. That is the worst possible study material — they remember the answers, not the topic. Meanwhile the highest-signal artifact about what a child is about to be tested on is sitting in their backpack: the last exam, on the same unit, from the same teacher, in the same format.

**n-test-reviewer** takes photos of that paper and turns it into fresh practice, as many rounds as the family needs. A parent snaps the pages of a returned or upcoming-unit test, picks the Subject and Grade Level, and the app reads the paper, understands what it was testing and how it asked, and generates a new Practice Test on the same topics in the same question formats — multiple choice, fill-in-the-blank, and short answer, mixed to match the source. The student takes it in the app like a real test, optionally on a timer. At the end, answers are revealed with a score, and any question can be expanded into a plain-language explanation of *why* the answer is what it is.

The parent stays in control and in the loop: only the parent uploads, only the parent releases a Practice Test to the student, and behind a PIN the parent sees every result, per-Topic Mastery, and where the child is actually weak — not just a score. Version 0 is deliberately one family, one flow, done well: photo in, practice out, mastery visible.

## 2. Target User

### 2.1 Jobs To Be Done

**Parent (primary buyer and operator)**
- When my child has a test next week, help me produce real practice material without me having to write questions myself.
- Show me where my child is actually weak, by topic, so my help is targeted instead of "study more."
- Let me check what the app is about to put in front of my child before it gets there.
- Let me do this in five minutes on my phone, standing in the kitchen, from a crumpled paper.

**Student (primary user)**
- Let me practice the way the real test will feel, so the real test is not the first time I see the format.
- Tell me immediately after I finish whether I got it right — not tomorrow.
- When I get one wrong, explain it in a way I actually understand, without asking a parent who may not remember Grade 5 fractions.
- Let me redo it until it stops being scary.

**Admin (operator of the service)**
- Keep the Subject and Grade Level taxonomy coherent across families so generation and analytics stay comparable.

### 2.2 Non-Users (v0)

- **Teachers and schools.** No classroom accounts, no roster import, no assignment distribution. The unit of the product is one family.
- **Students without a participating parent.** A student cannot self-onboard, self-upload, or use the app without a Parent Account.
- **Test-prep at exam-industry scale** (SAT, college entrance). Content is driven by whatever paper the parent uploads, not by a curated question bank.

### 2.3 Key User Journeys

- **UJ-1. Maria turns Friday's returned math test into Sunday practice.**
  Maria, working mom of a Grade 5 student, gets home Friday with a returned Math test covered in red pen. Already signed in on her phone from a prior session. She opens n-test-reviewer, taps **Upload Test**, selects the student profile "Noah," picks Subject *Math* and Grade Level *5*, and photographs all three pages in sequence — the app shows each captured page as a thumbnail she can reorder or retake. She taps **Generate**, chooses 2 Practice Tests, and waits through a progress state. When generation finishes she gets a review screen: 15 questions per test, each tagged with a topic like *equivalent fractions*, in the same mix of formats as the source. Two questions are garbage — one references a diagram that was never uploaded — so she deletes them and fixes a typo in a third. She taps **Release to Noah**.
  **Climax:** the two Practice Tests appear on Noah's home screen as unstarted cards.
  **Resolution:** Maria is done in under five minutes and did not write a single question.
  **Edge case:** if a page photo is too blurry to read, the app flags that specific page before generation and asks her to retake just that page, not all three.

- **UJ-2. Noah takes a practice test and finds out he doesn't understand remainders.**
  Noah, 10, opens the app on the family tablet on Sunday. No login — the app is already in Student Mode on his profile. His home screen shows two unstarted Practice Test cards for Math. He taps the first. A timer is on (Maria left the default), 20 minutes, counting down at the top. He answers 15 questions one at a time — some multiple choice, some fill-in-the-blank, two short answer he types out. He taps **Submit**.
  **Climax:** the results screen appears immediately: 11/15, with every question listed, his answer, the correct answer, and a green or red mark. On question 7 — a division-with-remainder word problem he got wrong — he taps **Explain this**. A short, plain-language explanation appears: what the question was really asking, why his answer was wrong, and how to get the right one.
  **Resolution:** he taps **Retake** and does the same test again, then a fresh variant.
  **Edge case:** if his typed short answer was semantically right but worded differently ("one half" vs "1/2"), the AI marks it correct; if he disagrees with a mark, he can flag it, and the flag surfaces to Maria in the parent view.

- **UJ-3. Maria checks the damage behind the PIN.**
  Sunday night, Maria opens the app on the tablet Noah just used. She taps the profile icon, then **Parent View**, and enters her 4-digit PIN. **Climax:** a dashboard shows Noah's Math mastery by topic — *equivalent fractions 90%*, *division with remainders 40%*, flagged in red as a weak area — plus a trend line over his last several Practice Tests and a list of his most-missed topics across subjects. She drills into the division topic and sees the three specific questions he missed and the answers he gave. **Resolution:** she now knows exactly what to sit down with him about, and taps **Generate more** to make another Practice Test weighted toward that topic. **Edge case:** three wrong PIN entries lock Parent View for a cool-down period so a curious 10-year-old cannot brute-force it.

- **UJ-4. Admin adds a subject before the school year.**
  The Admin signs into the admin surface and adds Subject *Science* for Grade Levels 4 through 6, so parents in those grades can select it at upload time. Existing Practice Tests are unaffected.

## 3. Glossary

Downstream workflows and readers must use these terms exactly.

- **Parent Account** — The only credentialed account in the system (email + password). Owns one or more Student Profiles, one Parent PIN, all Source Tests, and all consent. Carries exactly one Account Tier. Cardinality: 1 Parent Account → 1..N Student Profiles.
- **Account Tier** — An Admin-assigned label on a Parent Account that determines its Student Profile limit and its monthly Upload Allowance, Generation Allowance, and Explanation Allowance. One of: **Free**, **Plus**, **Family**, **Internal**. Carries no payment or billing meaning in v0.
- **Upload Allowance** / **Generation Allowance** / **Explanation Allowance** — The Account Tier's monthly limits on Source Test uploads, Practice Test generations, and newly generated Explanations respectively, counted on three separate counters. All three reset together on the calendar month boundary in the Parent Account's own timezone (FR-31).
- **Student Profile** — A named child under a Parent Account, carrying a Grade Level and all of that child's Practice Test history and Mastery data. Has no credentials and cannot sign in independently.
- **Admin** — A service operator account, outside any Parent Account, who configures the Subject and Grade Level taxonomy. Not a family role.
- **Parent PIN** — A short numeric code set by the Parent Account that gates entry into Parent View from a device already in Student Mode.
- **Student Mode** — The default app state on a device: shows only one Student Profile's Practice Tests, results, and Explanations. No upload, no generation, no analytics.
- **Parent View** — The PIN-gated app state: upload, generation, Practice Test review and release, results, and Analytics across all Student Profiles.
- **Subject** — An Admin-configured category (e.g. *Math*, *Science*) available for a given Grade Level. Selected by the parent at upload.
- **Grade Level** — An Admin-configured level (e.g. *5*). Attached to a Student Profile and to each Subject's availability.
- **Source Test** — The uploaded artifact: an ordered set of one or more Page Images plus the Subject and Grade Level the parent assigned. The basis for generation. Cardinality: 1 Source Test → 1..N Page Images, → 1..N Practice Tests.
- **Page Image** — One photograph of one physical page of a Source Test. Ordered within its Source Test.
- **Extraction** — The system's structured reading of a Source Test: the questions it contained, their Question Formats, and the Topics they tested. Intermediate artifact, not shown as a product surface in v0.
- **Practice Test** — A generated set of Questions derived from a Source Test, belonging to one Student Profile, in one of four states: *draft* (generated, parent has not released), *released* (visible in Student Mode, not yet completed), *completed* (submitted and scored), *discarded*.
- **Question** — One item in a Practice Test. Has exactly one Question Format, one correct answer, one or more Topics, and a generated Explanation available on demand.
- **Question Format** — One of: **Multiple Choice**, **Fill-in-the-Blank**, **Short Answer**. Determines the answer input and the grading method.
- **Attempt** — One student pass through one Practice Test, producing a score and per-Question grades. A Practice Test may have multiple Attempts (retakes). Cardinality: 1 Practice Test → 1..N Attempts.
- **Grade** (verb/noun) — The determination recorded for one Question within an Attempt. One of four grade states: *correct*, *incorrect*, *unanswered* (the student submitted without answering it — FR-37), *ungraded* (AI grading was unavailable — FR-22). All four are defined in one table in FR-37. Multiple Choice is deterministic; Fill-in-the-Blank and Short Answer are AI-graded. Grade vocabulary is separate from the progress vocabulary shown while a test is being taken (*Answered* / *Not answered*).
- **Explanation** — On-demand plain-language text explaining what a Question asked, why the correct answer is correct, and where a given wrong answer went wrong. Every Explanation shown to a student is retained and readable by the parent, who can stop it being served to their own child without removing it from the record (FR-39).
- **Topic** — A short subject-matter tag attached to each Question (e.g. *division with remainders*), the unit of Mastery tracking.
- **Mastery** — A Student Profile's rolling percentage of correctly answered Questions for a given Topic, across Attempts.
- **Weak Area** — A Topic whose Mastery falls below a configured threshold, surfaced prominently in Analytics.
- **Analytics** — The Parent View surface presenting Mastery by Topic, trends over time, and Weak Areas for a Student Profile.

### 3.1 Functional Requirement Index

Every FR in this document and the §4 feature it belongs to. FR numbers are stable identifiers and are never reassigned; the numbering is not sequential within a section because requirements were added over successive rounds.

| FR | Title | Section |
|---|---|---|
| FR-1 | Parent Account sign-up and sign-in | §4.1 Accounts, Profiles, and Mode Switching |
| FR-2 | Parent PIN set and enforcement | §4.1 |
| FR-3 | Student Profile management | §4.1 |
| FR-4 | Mode switching and Student Mode binding | §4.1 |
| FR-34 | Parent View idle timeout | §4.1 |
| FR-35 | Uncommitted Parent View work survives expiry | §4.1 |
| FR-5 | Multi-page capture and library selection | §4.2 Source Test Upload |
| FR-6 | Page ordering and correction | §4.2 |
| FR-7 | Source Test classification | §4.2 |
| FR-8 | Pre-generation legibility check | §4.2 |
| FR-9 | Extraction from Page Images | §4.3 Extraction and Practice Test Generation |
| FR-9a | Thin Extraction warning | §4.3 |
| FR-10 | Practice Test generation | §4.3 |
| FR-11 | Weighted regeneration from a Weak Area | §4.3 |
| FR-12 | Draft review surface | §4.4 Parent Review and Release |
| FR-13 | Question editing and deletion | §4.4 |
| FR-14 | Release and discard | §4.4 |
| FR-15 | Timer configuration | §4.4 |
| FR-16 | Practice Test list in Student Mode | §4.5 Taking a Practice Test |
| FR-17 | Answering Questions by format | §4.5 |
| FR-18 | Attempt persistence | §4.5 |
| FR-19 | Submission | §4.5 |
| FR-20 | Retake | §4.5 |
| FR-36 | Loss of network during an Attempt | §4.5 |
| FR-37 | The four grade states | §4.6 Grading, Answer Reveal, and Explanations |
| FR-21 | Deterministic grading for Multiple Choice | §4.6 |
| FR-22 | AI grading for Fill-in-the-Blank and Short Answer | §4.6 |
| FR-23 | Answer reveal | §4.6 |
| FR-24 | On-demand Explanation | §4.6 |
| FR-24a | Explanation visibility to the parent | §4.6 |
| FR-38 | Student-originated Explanation flag | §4.6 |
| FR-39 | Parent suppression of an Explanation | §4.6 |
| FR-25 | Grade dispute flag | §4.6 |
| FR-26a | Topic normalization | §4.7 Analytics and Mastery |
| FR-40 | Admin Topic curation | §4.7 |
| FR-26 | Per-Topic Mastery computation | §4.7 |
| FR-27 | Weak Area identification | §4.7 |
| FR-28 | Analytics dashboard | §4.7 |
| FR-29 | Drill-down and act | §4.7 |
| FR-30 | Subject and Grade Level taxonomy management | §4.8 Admin Configuration |
| FR-30a | Account Tier administration | §4.8 |
| FR-32 | Automatic Page Image expiry | §4.9 Data Retention and Deletion |
| FR-33 | Parent-initiated deletion | §4.9 |
| FR-31 | Account Tier enforcement | §4.10 Account Tiers and Allowance Enforcement |

## 4. Features

### 4.1 Accounts, Profiles, and Mode Switching

**Description:** One credentialed Parent Account owns everything. The parent signs up with email and password, sets a Parent PIN, and creates one Student Profile per child with a name and Grade Level. A device sits in Student Mode by default, bound to one Student Profile; entering Parent View requires the Parent PIN. This keeps the family on a single shared device (the common case — a family tablet) without giving a child access to upload, generation, or analytics, and without the friction of a second set of credentials a 10-year-old would forget. Parent View is also bounded in time: it expires silently after a period of inactivity and drops the device back to Student Mode, and because that expiry gives the parent no chance to save, every piece of uncommitted parent work survives it and is restored on re-entry. Realizes UJ-2, UJ-3. `[ASSUMPTION: the shared-device pattern is the dominant usage mode; a student on their own phone is served by the same mechanism with the parent entering the PIN when needed.]`

**Functional Requirements:**

#### FR-1: Parent Account sign-up and sign-in

A prospective parent can create a Parent Account with an email address and password, and sign in on any device.

**Consequences (testable):**
- Sign-up requires a verified-format email, a password meeting a stated minimum strength, and acceptance of the terms and the child-data consent notice (§5.2).
- Acceptance of the child-data consent notice is recorded against the Parent Account with the timestamp and the version of the notice accepted. Consent is taken at sign-up, before any Student Profile exists, so it attaches to the account and covers every Student Profile created under it.
- Duplicate email sign-up is rejected with a message that does not reveal whether the account exists beyond standard reset flows.
- A signed-in session persists across app launches until explicit sign-out.
- Password reset is available via emailed link.
- Exactly one timezone is captured and stored per Parent Account at sign-up, defaulted from the signing-up device and changeable in Settings. It is the boundary every allowance period is measured against (FR-31). `[ASSUMPTION: a single per-account timezone is sufficient; a family that moves or travels is served by editing it, not by per-device detection.]`

**Notes:**
- `[NOTE FOR PM]` The consent record above is account-scoped by necessity — consent is taken at sign-up, before any Student Profile exists, so there is no per-child consent artifact in v0. Whether a per-Student-Profile consent record is required is part of the §12.2 item 1 legal review, not a settled requirement here.

#### FR-2: Parent PIN set and enforcement

A Parent Account holder can set and change a numeric Parent PIN that gates entry into Parent View.

**Consequences (testable):**
- PIN is required on every transition from Student Mode into Parent View, including after app restart.
- Changing the PIN requires the current PIN or the account password.
- After 3 consecutive failed PIN entries, Parent View entry is locked for a cool-down period, and the failure count persists across app restart.
- The PIN is never displayed after being set and is stored hashed.

#### FR-3: Student Profile management

A parent, in Parent View, can create, rename, set the Grade Level of, and archive Student Profiles.

**Consequences (testable):**
- The number of active Student Profiles a Parent Account may hold is set by its Account Tier (FR-31); creation beyond that limit is blocked with a message naming the tier and its limit.
- Each Student Profile requires a display name and exactly one Grade Level, selected from the Admin-configured list.
- Archiving a Student Profile hides it from Student Mode selection but preserves its Attempt and Mastery history for Analytics.
- Changing a Student Profile's Grade Level does not alter existing Practice Tests.

#### FR-4: Mode switching and Student Mode binding

A user can switch a device between Student Mode (bound to one Student Profile) and Parent View.

**Consequences (testable):**
- Initial binding is set at first Student Profile creation: the first Student Profile created on a Parent Account becomes the device's bound profile, so "last-bound" is always defined, including on a device that has never left Parent View deliberately.
- On a device with more than one Student Profile, **deliberately** exiting Parent View prompts the parent to choose which Student Profile the device binds to. This prompt is scoped to the deliberate path only; a silent expiry (FR-34) cannot prompt and binds without one.
- The chosen profile becomes the device's last-bound Student Profile and is what a silent expiry (FR-34) falls back to.
- In Student Mode, no upload, generation, release, cross-profile data, or Analytics surface is reachable — not by navigation, not by direct URL.
- In Student Mode, the only path out is the PIN prompt.

#### FR-34: Parent View idle timeout

Parent View expires after a period of inactivity and the device returns to Student Mode without any user action.

**Consequences (testable):**
- The idle window is **15 minutes** with no parent interaction. `[ASSUMPTION: 15 minutes is long enough to review a draft Practice Test without re-entering the PIN, and short enough that a tablet left on the kitchen counter is not an open Parent View.]`
- Expiry fires **silently** — no warning, no countdown, no confirmation prompt. The parent is not asked whether to extend.
- On expiry the device lands in Student Mode bound to the Student Profile it was last bound to (FR-4), **without any prompt**. This is deliberately not the explicit-exit rule.
  *Why:* FR-4 prompts for a profile on a multi-profile device, and a silent path has nobody present to answer. Falling back to the last-bound profile is the only binding a silent expiry can make.
- Re-entry into Parent View after expiry requires the Parent PIN, and the 3-attempt cool-down of FR-2 applies identically — an expiry-triggered PIN prompt is not a privileged one.
- The timeout applies to every Parent View surface, including Upload, Draft review, Analytics, Settings, and the Admin-adjacent consumption views a parent can reach.

#### FR-35: Uncommitted Parent View work survives expiry

Every piece of uncommitted parent input in Parent View persists across an FR-34 expiry without an explicit save, and is restored exactly on re-entry.

**Consequences (testable):**
- Per-Question draft edits typed in Draft review (FR-13) are retained, including edits to question text, answer options, and the correct answer, whether or not the parent moved off the Question.
- The parent's position in Draft review — which Practice Test and which Question — is restored.
- An uncommitted grade override in progress (FR-25) is retained. The retained state **excludes the AI grading rationale**. The rationale is re-read from the Attempt on restoration and is never carried in retained state.
  *Why:* FR-25 forbids surfacing the rationale to the student, and retained state on a device that has fallen back to Student Mode must not become the route by which it is surfaced.
- A partially completed upload is retained: captured or selected Page Images, their order, and the Subject and Grade Level classification chosen so far (FR-5 through FR-7). No Page Image is lost to expiry.
- Restoration is exact rather than approximate — the parent resumes at the same state, not at the top of the flow.
- **The retained state is held server-side only, keyed to the Parent Account, and never written to client storage.**
  *Why:* §10 requires that Student Mode restrictions are not client-side-only; client-side retention would leave a route guard as the sole barrier while photographs of a child's schoolwork sat in the Student Mode origin's storage on a shared family tablet.
- **Restoration happens strictly after Parent PIN re-entry (FR-2), never before.** No retained content is fetched, rendered, or held in the client while the device is in Student Mode.
- **A fetch of retained state belonging to a different Student Profile is rejected server-side.**
  *Why:* Pending drafts span Student Profiles (§6.3) while FR-34 binds to the last-bound profile, so without this rejection one child's retained draft state can strand on a device a sibling now operates — the cross-profile exposure FR-4 forbids.
- **Retained state carries a time-to-live (TTL) and expires on its own clock** without any user action.
  *Why:* FR-32's 90-day clock starts at Source Test upload, which for abandoned captures never happened, and FR-33's deletion enumeration does not clearly reach this class — without a TTL this would be an indefinite store of children's schoolwork that no clock reaches.

**Notes:**
- This is stated as a requirement rather than a mitigation because FR-34 expiry is silent: the parent gets no chance to prevent the loss, so losing nothing is the only acceptable behavior.

**Out of Scope:**

*Feature-level, covering all of §4.1.*

- Per-Student-Profile PINs or student credentials.
- A warning, extension prompt, or countdown before FR-34 expiry.

### 4.2 Source Test Upload

**Description:** The parent, and only the parent, uploads. From Parent View they choose a Student Profile, a Subject, and a Grade Level, then capture or select multiple Page Images — one per physical page, since a school exam is routinely two to four pages. Captured pages appear as an ordered, reorderable thumbnail strip; any page can be retaken or removed before submission. Legibility is checked before generation so the parent fixes a bad page while the paper is still in front of them, not after a failed generation. Realizes UJ-1.

**Functional Requirements:**

#### FR-5: Multi-page capture and library selection

A parent can add multiple Page Images to a single Source Test, using the device camera or the device photo library.

**Consequences (testable):**
- A Source Test accepts 1 to 10 Page Images. `[ASSUMPTION: 10 pages covers the realistic ceiling for a primary/secondary school exam.]`
- Camera capture adds one Page Image at a time; library selection is **multi-select**, adding every selected image in one action. Both append to the end of the existing order.
- Camera-captured and library-selected pages mix freely within one Source Test, in any proportion and any order. Once a page is part of a Source Test, how it was added carries no meaning: ordering, correction (FR-6), legibility checking (FR-8), and Extraction (FR-9) treat every Page Image identically.
- Both camera capture and library multi-select are available on mobile web.
- Supported formats are JPEG, PNG, WebP, and HEIC/HEIF. Format is determined by inspecting the file's bytes, not by trusting the client-declared type.
- HEIC/HEIF — the iPhone camera default — is converted server-side before any AI processing.
- EXIF orientation is honored, so a page photographed in portrait is not read sideways.
- **Camera unavailability is not a dead end.** Where the camera permission is denied, revoked, or the device has no camera, photo-library selection remains offered as a **first-class path to the same Source Test** — not as a degraded fallback and not on a separate flow — together with plain guidance on how to re-enable camera access on that device.
  *Why:* the parent is standing over the paper with five minutes, and a permission dialog answered "no" once, possibly months ago by someone else on a shared family tablet, must not end the upload. SM-1 measures exactly this flow, so an abandonment here reads as a broken core loop.

#### FR-6: Page ordering and correction

A parent can reorder, retake, and delete individual Page Images before submitting a Source Test.

**Consequences (testable):**
- Page order is explicit and visible to the parent before submission — each page's position within the Source Test is stated, not inferred from layout alone.
- Deleting a page renumbers the remaining pages without reprocessing them.
- Submitting with zero pages is blocked.

#### FR-7: Source Test classification

A parent must assign exactly one Subject and one Grade Level to a Source Test before submitting it.

**Consequences (testable):**
- Subject options are limited to those the Admin has enabled for the selected Grade Level.
- Grade Level defaults to the selected Student Profile's Grade Level and is overridable per upload.
- Submission is blocked until both are set.

#### FR-8: Pre-generation legibility check

The system evaluates each Page Image for readability and reports unusable pages before generation begins.

**Consequences (testable):**
- The check runs **once, as a single batch over all pages, immediately after capture is finished** — not per page as each is added, and not again later. The parent sees one verdict covering the whole Source Test, at one moment.
- A page failing the check is identified individually, with a retake action scoped to that page.
- The check reports per-page readability confidence rather than a single pass/fail for the whole Source Test.
- The parent may override the warning and proceed. `[ASSUMPTION: overriding is allowed rather than blocking — the check is advisory, since false positives on a legible-but-shadowed page would be worse than a mediocre generation.]`
- The proceed action states, before it is taken, that proceeding **commits the Source Test and will spend one Upload Allowance** (FR-31). Abandoning at this point spends nothing.
- The allowance is not debited at the moment the parent taps proceed. Consistent with FR-31's "consumed on successful production, never on request", the Upload Allowance is consumed when the Source Test upload succeeds; a Source Test whose upload or Extraction fails consumes nothing and the parent may retry without a second charge.
  *Why:* The statement on the proceed action is a forward warning about what the parent is committing to, not a description of when the counter moves.

**Notes:**
- `[NOTE FOR PM]` The check should complete fast enough to feel like part of capture rather than a second wait. No latency bound is committed here because none has been established; it sits in Notes rather than in the testable list until a number exists.

### 4.3 Extraction and Practice Test Generation

**Description:** On submission the system reads the Source Test's Page Images and produces an Extraction: what the paper tested, in what Question Formats, on what Topics. From that Extraction it generates one or more Practice Tests of new Questions — same topics, same format mix, same difficulty band, not the same questions. The parent chooses how many Practice Tests to generate in one go, because "give me three so he can do one a night" is the actual behavior. Realizes UJ-1, including the cross-page context that must survive Extraction (FR-9), and UJ-3, whose weighted regeneration from a Weak Area is FR-11.

**Functional Requirements:**

#### FR-9: Extraction from Page Images

The system produces a structured Extraction from a submitted Source Test, capturing its Questions, Question Formats, and Topics.

**Consequences (testable):**
- Extraction spans all Page Images of the Source Test as a single document, in page order.
- Context spanning pages is preserved: a reading passage or data table on one page is associated with the questions that reference it on subsequent pages, and generation reproduces that structure rather than emitting orphaned questions.
- Each extracted question is classified into exactly one of the three Question Formats.
- Each extracted question carries at least one Topic.
- Content the system cannot interpret (an un-photographed diagram, a handwriting-only region) is recorded as uninterpretable rather than guessed at, and questions depending on it are not used as a basis for generation.
- Extraction is persisted and reused for subsequent generations from the same Source Test, so regeneration does not re-read Page Images and continues to work after the Page Images are deleted (§5.2).
- Fractions read off a Page Image are carried into the Extraction in a structured form, so that Questions generated from them inherit it (FR-10, §10.1).
- Extraction is not exposed as a product surface in v0.

#### FR-9a: Thin Extraction warning

When an Extraction yields few usable questions relative to the pages submitted, the system tells the parent before generation proceeds.

**Consequences (testable):**
- The parent is shown the count of usable questions and the count of pages submitted, and chooses to proceed or to retake pages.
- Generation is never hard-blocked on a low count — a genuinely short quiz is a valid Source Test.
- Choosing to retake pages rather than proceed consumes no Generation Allowance (FR-31).

#### FR-10: Practice Test generation

A parent can generate 1 to N Practice Tests from one Source Test, for one Student Profile.

**Consequences (testable):**
- The parent selects the number of Practice Tests before generation; the maximum per generation request is 5, and is further bounded by the Account Tier's remaining Generation Allowance (FR-31). `[ASSUMPTION: 5 is the per-request cap.]`
- The selector is bounded **at initiation**, not at completion. Counts exceeding the remaining Generation Allowance remain **visible to the parent as unavailable, with the reason stated**.
  *Why:* The parent can see the ceiling and why it is where it is, rather than finding a shorter list with no explanation.
- The bound is **enforced server-side on the generation request itself**, clamped independently of what the client sent. A request naming a count above the remaining allowance is clamped by the server to what remains; UI disablement alone does not satisfy this requirement.
- The cost of the pending action is stated **in Practice Tests, not in credits or abstract units**, before the parent confirms it, naming both what this action spends and what remains — on both the Generate action (FR-10) and the weighted regenerate action (FR-11).
- Each generated Practice Test contains a configurable number of Questions, defaulting to a count derived from the Source Test's own question count.
- Generated Questions cover the Extraction's Topics and reproduce its Question Format mix proportionally.
- Multiple Practice Tests from the same Source Test are materially different from each other, not reorderings of one set.
- No generated Question is a verbatim copy of a Source Test question.
- Each generated Question carries its correct answer, its Topic(s), and, for Multiple Choice, plausible distractors.
- Any fraction appearing in a generated Question, answer option, or correct answer is emitted in a **structured renderable form** carrying its numerator and denominator, not as an ambiguous inline string. This is a constraint on generation output, not on styling (§10.1).
- Generation runs asynchronously with a visible progress state; the parent can leave the screen and return.
- Generation failure leaves the Source Test intact and retryable without re-uploading photos.

#### FR-11: Weighted regeneration from a Weak Area

A parent can generate additional Practice Tests weighted toward a specific Topic from Analytics.

**Consequences (testable):**
- Generation initiated from a Topic in Analytics produces Questions predominantly on that Topic.
- The originating Source Test is reused; no new upload is required.
- Weighted regeneration is bounded, clamped, and priced identically to FR-10: the count selector is bounded by remaining Generation Allowance at initiation, clamped server-side, and the cost is stated in Practice Tests before the parent confirms it.

### 4.4 Parent Review and Release

**Description:** A generated Practice Test lands in *draft* and is invisible to the student until the parent releases it. The parent reads through the Questions, deletes bad ones, edits wording or answers, and then releases. This is the quality gate on AI output and the answer to "what if it generates something wrong or inappropriate" — a human who knows the child sees every question first. Realizes UJ-1.

**Functional Requirements:**

#### FR-12: Draft review surface

A parent can review every Question in a *draft* Practice Test before release, including its correct answer and Topic.

**Consequences (testable):**
- All Questions, answers, distractors, and Topics are visible in one reviewable list.
- A *draft* Practice Test never appears in Student Mode.

#### FR-13: Question editing and deletion

A parent can edit a Question's text, its answer options, and its correct answer, or delete the Question entirely.

**Consequences (testable):**
- Edits persist to the Practice Test and are what the student sees and is graded against.
- Questions can be deleted until one remains; deleting that last Question discards the Practice Test.
- Deleting the last Question requires a confirmation that says in words what happens: the Practice Test is discarded, and the Generation Allowance already spent producing it is **not refunded** (FR-31). The consequence is stated before the action, not after.
- Editing is available in *draft* state only.

#### FR-14: Release and discard

A parent can release a *draft* Practice Test to a Student Profile, or discard it.

**Consequences (testable):**
- Release transitions the Practice Test to *released* and makes it visible in that Student Profile's Student Mode.
- A discarded Practice Test is removed from all student-facing surfaces and excluded from Analytics.
- Release is irreversible in v0; a released Practice Test cannot be edited. `[ASSUMPTION: unrelease/recall is not needed for v0.]`

#### FR-15: Timer configuration

A parent can enable an optional countdown timer on a Practice Test and set its duration before release.

**Consequences (testable):**
- Timer is off by default with a suggested duration derived from question count. `[ASSUMPTION: default-off; a timer on a nervous 10-year-old's first practice run is a feature the parent should opt into.]`
- The timer is configurable **at any point up to release and never after** (FR-14), and the parent can set it while reviewing the draft it applies to rather than having to leave that context.
- The duration is pre-filled with the suggested value derived from the Practice Test's question count and is editable before release.
- When enabled, the remaining time is available to the student throughout the Attempt.
- Three pre-expiry warnings are mandatory, at **5 minutes**, **1 minute**, and **20 seconds** remaining. The sequence deliberately does **not** escalate: no warning is made more urgent than the one before it, in wording, prominence, or audibility.
  *Why:* A 20-second warning that shouts louder than the 5-minute one turns the last stretch of a practice test into an anxiety event, which is the opposite of what a timer is here for (§7).
  *Why these three figures:* they are **chosen, not derived**. The 5-minute mark is actionable because the question map (FR-17) makes it enough time to return to skipped Questions; 1 minute is the last point at which a Question can still be attempted; 20 seconds is a submit-now signal. `[ASSUMPTION: fixed thresholds of 5 minutes / 1 minute / 20 seconds serve every timer duration a parent will set. The rejected alternative was scaling the warnings to the duration — 25% and 5% of the configured time — which was set aside because on a short Practice Test it produces warnings too close together to act on, and because a fixed sequence is the same experience on every test the child takes. Revisit if parents routinely set durations far outside the 15–30 minute band the fixed figures assume.]`
- Auto-submit is announced at the moment it happens, so the transition to the results screen is never unexplained (§10.1).
- On timer expiry the Attempt auto-submits, and every Question the student did not answer is graded incorrect. This is the one path by which a Question the student did not answer is graded incorrect rather than *unanswered* — see the grade-state table in FR-37.

### 4.5 Taking a Practice Test

**Description:** In Student Mode the child sees their released Practice Tests as cards and taps one to start. Questions are presented one at a time with the input matching the Question Format — options for Multiple Choice, a blank field for Fill-in-the-Blank, a free text field for Short Answer. Answers are never revealed mid-test; the point is to simulate the real exam. Realizes UJ-2.

**Functional Requirements:**

#### FR-16: Practice Test list in Student Mode

A student can see their *released* and *completed* Practice Tests as a single flat list, each labeled by Subject and state.

**Consequences (testable):**
- Only Practice Tests belonging to the bound Student Profile are listed.
- The list is **flat — not grouped**. Every Practice Test carries its Subject and its state with it; a child with tests in two Subjects sees one list, not two sections.
- Sort order is fixed: **all *released* Practice Tests first — whether or not an Attempt is already in progress on them — then *completed*, newest first within each**. The ordering is not user-configurable in v0.
  *Why:* The next thing to do is always at the top.
  *Why it must not be weakened:* the list grows monotonically — nothing leaves it — so a family on Plus is looking at roughly two dozen entries by the end of a school year. The unstarted-first sort is doing all of the work of keeping the list usable, and is the accepted trade for retaining everything.
- **The current decision is indefinite retention: every *completed* Practice Test remains reachable from this list, with no age-out and no system-initiated archiving.**
  *Why:* A finished test is how a student returns to its answer key and Explanations (FR-23).
- **This is a decision with a recorded remedy, not an unconditional prohibition.** If the list becomes unusable in practice, the preferred remedy is a **bounded tail — every unstarted Practice Test plus the last 3–5 completed ones** — and explicitly *not* date-based expiry, which would take a test away on a calendar boundary that means nothing to the child holding it. *Revisit condition:* evidence from real accounts that the list length is costing students the ability to find the test they want.
- Three conditions are distinguishable on the list: a *released* Practice Test with no Attempt yet, a *released* Practice Test with an Attempt in progress, and a *completed* Practice Test.

#### FR-17: Answering Questions by format

A student can answer each Question using the input control appropriate to its Question Format.

**Consequences (testable):**
- Multiple Choice renders selectable options, of which exactly one can be selected at a time.
- Fill-in-the-Blank presents the question text with an answer input positioned at the blank.
- Short Answer accepts free text of more than one line.
- A student can navigate backward and forward within a Practice Test and change answers before submitting.
- **A student can reach any Question directly, not only by stepping through the sequence.** A question map is available throughout the Attempt, listing every Question with its progress state — *Answered* / *Not answered* (FR-19) — and jumping straight to any one of them.
  *Why:* FR-19's confirmation names the count of Questions not yet answered, and without a way to reach those Questions that warning tells a student about a problem it gives them no means to fix. It is also what makes FR-15's 5-minute warning actionable rather than merely informative.
- The question map shows progress state only. It shows no score, no correctness, and nothing else that would constitute mid-test feedback.
- No correctness feedback of any kind is shown before submission.

#### FR-18: Attempt persistence

An in-progress Attempt survives app backgrounding, refresh, and device sleep.

**Consequences (testable):**
- Answers entered are retained on return to the Practice Test.
- A running timer continues to reflect elapsed real time across interruption. `[ASSUMPTION: wall-clock, not paused — matching real exam conditions.]`

#### FR-19: Submission

A student can submit an Attempt, which grades it and transitions the Practice Test to *completed*.

**Consequences (testable):**
- Submission with unanswered Questions is allowed after an explicit confirmation naming the count of Questions not yet answered.
- **The confirmation offers a path back to those Questions** rather than only naming them, via the question map of FR-17. Submitting anyway stays available; the path back is an addition to the choice, not a block on it.
- Questions left unanswered on a manually submitted Attempt are recorded with the *unanswered* grade state rather than the *incorrect* state, whether or not the Practice Test was timed. Their scoring, Mastery, and display treatment is the grade-state table in FR-37.
  *Why:* the distinct state exists so the diagnosis can tell a blank from a wrong answer, not so the mark is forgiven.
- The confirmation and any in-test progress indicator use the progress vocabulary *Answered* / *Not answered*, which is deliberately distinct from the grade vocabulary the results screen uses (§3).
- Submission is irreversible for that Attempt.

#### FR-20: Retake

A student can retake a *completed* Practice Test, producing a new Attempt.

**Consequences (testable):**
- Each retake creates a distinct Attempt; prior Attempts remain in history.
- Question order may be shuffled on retake; Question content is unchanged.
- Retake Attempts are scored and visible to student and parent, but do not contribute to Mastery (FR-26).
  *Why:* A student cannot raise their Mastery by redoing the same Practice Test until it is correct.
- The first-versus-retake distinction is **visible, not merely true in the data**. Wherever a Practice Test with more than one Attempt is shown — the Practice Test card in Student Mode (FR-16), the Attempts list, and Attempt detail in Parent View — three facts are available together: the first Attempt's score, the most recent Attempt's score, and the number of Attempts, with the first identified as the one that counts toward Mastery (FR-26).
- A Practice Test with exactly one Attempt shows a single score with no first/latest framing.

#### FR-36: Loss of network during an Attempt

An in-progress Attempt tolerates losing the network: the student can keep working, and neither gains time nor loses work as a result.

**Consequences (testable):**
- Answering Questions and navigating backward and forward within the Practice Test (FR-17) continue to work with no network, on the same retention basis as FR-18.
- **Submission requires the network.** A submit attempted with no connection is refused with a plain statement that it needs a connection, and the Attempt stays in progress with every answer intact.
- Submission is **never retried silently**. The student is told the state they are in and submits again themselves.
  *Why:* No background retry may submit an Attempt the student believes is still open.
- **A timer that expires while offline auto-submits on reconnect, graded against the moment of expiry, not the moment of reconnect.** Answers recorded after the expiry moment are not counted, and the student is told at what point the test closed.
  *Why:* Losing signal buys no extra time.
- Nothing entered before the connection dropped is lost in any of these paths.
- This is the sole carve-out from the "network required" position of §9.2, which stands for everything else — the Practice Test list, generation, grading, and Explanations all require a connection.

### 4.6 Grading, Answer Reveal, and Explanations

**Description:** On submission the student immediately gets a score and a full answer key: every Question with their answer, the correct answer, and its grade state. Any Question can be expanded into an on-demand Explanation, which is the actual studying mechanism: understanding why, not just seeing what. Realizes UJ-2. The section runs in dependency order:

- **Grade states.** Every Question in an Attempt carries exactly one of four states — *correct*, *incorrect*, *unanswered*, *ungraded*. FR-37 holds the single table defining when each is written, whether it scores, whether it counts toward Mastery and the Weak Area floor, and how it displays. Every other requirement in this PRD points at that table rather than restating it.
- **Grading.** Multiple Choice grades deterministically (FR-21). Fill-in-the-Blank and Short Answer are graded by the AI on meaning, not string equality (FR-22) — "1/2", "one half", and "a half" are all correct, and a 10-year-old should not lose a point to spelling on a math question.
- **Reveal.** Score and full answer key appear immediately on submission and stay reachable from Attempt history (FR-23).
- **Explanations.** Generated on demand per Question and cached, with only generation bounded by an allowance (FR-24), and retained for the parent to read (FR-24a).
- **Flags and suppression.** A student can flag an Explanation, which reaches the Admin only once the parent confirms it (FR-38). The parent can then suppress it on their own child's screen and request a free replacement (FR-39) — the one mechanism that withdraws an Explanation a student has already seen.
- **Disputes.** A student can contest a grade; the parent sees it on the dashboard and overrides it in Attempt detail (FR-25).

**Functional Requirements:**

#### FR-37: The four grade states

Every Question within an Attempt carries exactly one of four grade states, and this FR is the single definition of all four.

**The grade-state table.** This table is authoritative. Where any other requirement in this PRD needs one of these facts, it points here rather than restating it.

| Grade state | Written when | In score denominator (FR-23) | In Mastery (FR-26) | Counts toward Weak Area floor (FR-27) | How displayed |
|---|---|---|---|---|---|
| *correct* | By grading, on a Question the student answered — deterministically for Multiple Choice (FR-21), by the AI for Fill-in-the-Blank and Short Answer (FR-22) | Yes, and earns the credit | Yes, in both terms of `correct / (correct + incorrect)` | Yes | Marked correct, with the student's answer and the correct answer |
| *incorrect* | By grading, on a Question the student answered; **and** on every blank of an Attempt that auto-submitted on timer expiry (FR-15) | Yes, and earns no credit | Yes, in the denominator term only | Yes | Marked incorrect, with the student's answer shown beside the correct answer |
| *unanswered* | At submission (FR-19), on a **manually submitted** Attempt where the student left the Question blank — timed or untimed. Grading never overwrites it | Yes, and earns no credit — a blank costs the mark exactly as on a paper test | **No** — contributes to neither term | **No** | Shows the correct answer with no student answer. Never presented, anywhere, as a wrong answer the student gave |
| *ungraded* | When AI grading is unavailable (FR-22); retried the next time the Attempt's results screen is opened | **Excluded**, with the number excluded and the reason stated on screen | No | No | Marked *ungraded* and surfaced to the parent; marked as newly graded on the view where it resolves |

**Consequences (testable):**
- All four states are first-class and carried through Attempt storage, the answer key (FR-23), Parent View drill-down (FR-29), and Mastery computation (FR-26). None is derived at display time from an empty answer field.
- The *unanswered* state is written at submission (FR-19) and grading does not overwrite it: FR-21 and FR-22 grade only Questions the student answered.
- **The *unanswered* state cannot arise from an expired timed Attempt.** FR-15 grades those Questions incorrect, and that consequence is unchanged.
  *Why:* A timed test that ran out is a test the student ran out of time on; a submitted test with blanks is a test the student chose to leave blanks on. The product treats those differently on purpose.
- The four state labels are fixed literals, identical on every surface (§7).
- The progress vocabulary used while a test is being taken — *Answered* / *Not answered* (FR-19) — remains deliberately separate from this grade vocabulary.
  *Why:* They are different things measured at different moments and must not share labels.

**Notes:**
- What the *unanswered* state protects is the **diagnosis**, not the mark. It is inside the score denominator and earns no credit, and it is excluded from Mastery, the Weak Area floor, and Topic drill-down — so a parent can tell a child who ran short of patience from a child who does not understand.

#### FR-21: Deterministic grading for Multiple Choice

The system grades Multiple Choice Questions by exact option match.

**Consequences (testable):**
- Grading is deterministic and identical across repeated Attempts with the same answer.
- No AI call is made for Multiple Choice grading.
- **This rule applies only to a Question the student actually answered.** A Multiple Choice Question with no option selected is not matched against the correct option and is not graded incorrect by this rule; see the grade-state table in FR-37 for what it takes instead.

#### FR-22: AI grading for Fill-in-the-Blank and Short Answer

The system grades Fill-in-the-Blank and Short Answer Questions on semantic equivalence to the correct answer.

**Consequences (testable):**
- **This rule applies only to a Question the student actually answered.** A Fill-in-the-Blank or Short Answer Question left blank is not sent for grading at all and consumes no model call; see the grade-state table in FR-37 for what it takes instead.
- Equivalent answers differing in spelling, casing, whitespace, notation, or phrasing are graded correct.
- Grading is scoped to the Question's subject matter — a math answer is not marked wrong for a spelling error in an accompanying word.
- Every AI-graded Question records both the grade and a short grading rationale.
- The rationale is **persisted with the Attempt and readable by the parent on the Question's own row** in Attempt detail, reachable without leaving that row. Writing it only to a log does not satisfy this requirement.
  *Why:* The rationale is the evidence a parent decides an FR-25 override on, and it must be where the decision is made.
- The rationale is retained for the life of the Attempt, including after an override (FR-25).
- If AI grading is unavailable, the Attempt still submits and scores; affected Questions are marked *ungraded* and surfaced to the parent rather than defaulted to incorrect.
- **An *ungraded* Question retries grading the next time the results screen for its Attempt is opened**, by either the student or the parent. There is no background job and no scheduled retry — viewing is the trigger.
- The retry never blocks rendering: the results screen appears immediately with the Questions it can show, and a resolving Question updates in place.
- A Question that resolves from *ungraded* to a real grade is **marked as newly graded** on that view.
  *Why:* A score that changes between two viewings must be explained rather than mysterious.
- While any Question in an Attempt is *ungraded*, the results header scores the Attempt over **only the gradable Questions** — the FR-23 denominator less the *ungraded* Questions — and states the number of Questions excluded and why. A denominator that silently includes *ungraded* Questions, or silently excludes them without saying so, fails this requirement.

#### FR-23: Answer reveal

A student sees the full answer key immediately after submitting an Attempt.

**Consequences (testable):**
- The results screen shows the overall score, and per Question: the question, the student's answer, the correct answer, and the grade state.
- **The score denominator is every Question presented in the Attempt.** The score is `correct / all presented Questions` — an Attempt of 15 Questions with 11 correct scores 11 out of 15 whether the other four were wrong or left blank. Per-state scoring behavior, including the *ungraded* carve-out that FR-22 states on screen when it applies, is the grade-state table in FR-37.
- All four grade states are distinguishable on the answer key, displayed as the grade-state table in FR-37 specifies.
- **The answer key is presented in the original Question order of the Attempt.** Wrong answers are never sorted, grouped, or promoted to the top, and there is no "show only what I got wrong" default view.
  *Why:* a student who scored 6/15 would meet a solid block of wrong answers before anything else, which is exactly the punitive reading of a result that §7 forbids. In test order, a wrong answer sits next to the ones either side of it, as it did on the paper.
- The answer key is reachable again later from Attempt history.

**Notes:**
- **The score and Mastery deliberately use different denominators, and this is not an inconsistency.** The score is what happened on the test: a blank is a lost mark. Mastery (FR-26) is what the student knows, so it excludes *unanswered* Questions from both terms, letting a parent tell "ran out of patience" from "does not understand". Score is the result; Mastery is the diagnosis.

#### FR-24: On-demand Explanation

A student can request an Explanation for any Question on the results screen.

**Consequences (testable):**
- An Explanation is generated on request via an explicit action per Question — not pre-generated for all Questions, and not shown unless asked for.
- An Explanation covers what the Question asked, why the correct answer is correct, and — when the student answered incorrectly — where their specific answer went wrong.
- Explanation language is pitched to the Practice Test's Grade Level — **the Grade Level assigned to the Source Test the Practice Test came from (FR-7), not the Student Profile's current Grade Level (FR-3).**
  *Why:* the Practice Test's Grade Level is fixed for the life of the Question, which is what keeps the Explanation cache key stable and makes FR-24a's retention requirement — every Explanation shown to a student stays readable by the parent — hold over time. Sourcing the pitch from the Student Profile instead would make a single FR-3 grade change either invalidate every cached Explanation under that profile or leave a body of stale ones whose recorded pitch no longer matches the profile they were generated for. This is the intuitive wiring and the wrong one; it is stated here so the cache design does not reach for it.
- A generated Explanation is cached and re-shown without regeneration on subsequent views of the same Question and answer.
- Any fraction in an Explanation is emitted in the same structured renderable form required of Questions and answer keys (FR-10, §10.1).
- **Explanation *generation* is bounded by the Explanation Allowance of the Account Tier (FR-31), whose values are set in the §5.3 tier table.** Requesting a new Explanation at a finite cap is blocked with the standard at-cap message naming the tier, the usage, and the reset date.
- **The at-cap message blames the plan, not the child.** It states that the account's Explanations for the month are used up and when they return. It must not imply the student asked too many questions, was excessive, or did anything wrong; it carries **no exclamation marks, no apology, and no upsell aimed at the child** — there is no self-serve upgrade path for a 10-year-old to take (§9.2), so an upsell on this screen asks someone who cannot act to feel responsible for a limit they did not set.
  *Why:* §5.3 is explicit that the Free Explanation Allowance is a spend ceiling rather than a positioning lever, and that a child reaching it is a signal the ceiling was set too low, not evidence the child overused anything. This is the only allowance wall in the product that lands on someone with no means of acting on it; FR-39 already carries this protection on the suppression path, and this closes the same gap on the at-cap path.
- **No running Explanation counter, remaining balance, or usage bar is ever shown to the student.** The counter is a parent-facing figure and appears only in Parent View (FR-28, FR-31). The student meets the limit at most once, at the moment it blocks, and never as a tally that follows them through the results screen.
  *Why:* a visible countdown teaches a child to ration the question they should be asking, which suppresses exactly the behavior SM-4 measures and the feature exists to produce.
- **An Explanation that fails to generate is reported inline on that Question, with a manual retry the student takes themselves.** There is **no automatic retry**.
  *Why:* Explanation generation is a foreground wait that §10 requires to stay short, and a silent auto-retry can double or treble that wait with nothing on screen explaining why.
- The rest of the results screen stays fully usable while an Explanation has failed: the score, the answer key, every other Question, and every other Explanation are unaffected.
- **The failure is never framed as the student's fault or as a limit on their understanding.** It says the explanation could not be produced right now, in the register of §7 — not that the question was too hard, not that there is nothing to explain.
- **Reading an already-generated Explanation is never blocked by an allowance, at any tier.** A cache hit consumes nothing and is always served, including after the cap is reached.
  *Why:* Nothing a student has already been shown is taken away from them by a cost limit.
- **The sole carve-out to the previous consequence is suppression (FR-39).** A suppressed Explanation is not served to the Student Profile it was suppressed for, cache hit or not.
  *Why:* That is a safety decision made by the child's own parent, not an allowance, and it is the one thing that can withdraw an Explanation a student has already seen.
- AI grading (FR-22) remains uncapped at every tier.

**Notes:**
- The Explanation cap has exactly two owners in this document: this FR defines the **serving** behavior — what is blocked, what is always served, and what the at-cap message says — and FR-31 defines the **enforcement** — the counters, the consumption rule, and the reset. §5.3 holds the numbers. Every other mention of the cap is a reference to one of those three.

#### FR-24a: Explanation visibility to the parent

A parent can read every Explanation that has been shown to their student, and flag one as bad.

**Consequences (testable):**
- Every Explanation shown to a student is retained against its Question and Attempt and is readable in Parent View.
- A parent can flag an Explanation; flagged Explanations are visible to the Admin as a content-quality signal.
- The parent can then suppress a flagged Explanation on their child's own screen and request a replacement (FR-39). A flag on its own changes nothing the student sees.
- A suppressed Explanation remains readable by the parent here; suppression removes it from the student, not from the record (FR-39).
- Explanations are shown to the student without prior parent review; FR-24a and FR-39 together are the after-the-fact accountability path (§5.1).

#### FR-38: Student-originated Explanation flag

A student can flag an Explanation as unhelpful or wrong, which surfaces it to their parent for confirmation before it reaches the Admin.

**Consequences (testable):**
- The flag action is available to the student on any Explanation they have been shown, on the results screen and in Attempt history.
- A student flag surfaces to the **parent** on the Analytics dashboard (FR-28), scoped to that Student Profile, alongside the Explanation text and the Question it explains.
- **Only a parent-confirmed flag reaches the Admin queue** (FR-30a). A raw student flag is never an Admin content-quality signal on its own.
  *Why:* A 10-year-old flagging an Explanation they did not like is not evidence the Explanation was bad.
- **The parent has exactly two dispositions on a student flag: confirm or dismiss.** Both are explicit actions taken on the flag where it surfaces, and a flag stays listed as awaiting disposition until one is taken.
- **Confirming a flag** records the parent's agreement against the Explanation, sends it to the Admin queue as a content-quality signal (FR-30a), and makes the suppression action of FR-39 available on that Explanation. Confirming does not itself suppress — suppression is a separate, stated choice.
- **Dismissing a flag** is recorded against the Explanation and goes no further: no Admin signal, no suppression.
- The parent's own path is unchanged: a parent may still originate a flag on any Explanation independently of any student flag, which is FR-24a's primary path and reaches the Admin directly.
- **The student's act of flagging never removes or alters the Explanation they are reading.** Only a parent decision does, via FR-39.

#### FR-39: Parent suppression of an Explanation

A parent can stop a flagged Explanation from being served to their own child, and can request a replacement for it at no cost to any allowance.

**Consequences (testable):**
- Suppression is available to the parent on any Explanation they have flagged themselves (FR-24a) or on a student flag they have confirmed (FR-38). It is never automatic: a flag alone does not suppress.
- **A suppressed Explanation stops being served to that Student Profile.** It is not shown on the results screen or in Attempt history, and it is not re-served from cache. This is the sole carve-out from FR-24's rule that reading an already-generated Explanation is never blocked.
- Suppression is scoped to the Student Profile whose parent suppressed it. It is not a service-wide takedown; that decision belongs to the Admin (FR-30a).
- **The Explanation is not deleted.** It remains retained against its Question and Attempt, readable by the parent (FR-24a), and still visible in the Admin queue as a content-quality signal (FR-30a).
  *Why:* Suppression governs what the child sees, not what the record holds.
- The student is shown that the Explanation was removed by their parent rather than an empty space or an error, in the plain, non-punitive register of §7.
- **The parent may request a regenerated Explanation for the same Question.** The replacement is generated fresh rather than served from cache.
- **A regeneration requested under this FR consumes no Explanation Allowance at any tier, including Free (FR-31).**
  *Why:* Charging a parent to replace bad output the product generated is not a defensible cost position, and the Free tier is exactly where a child would otherwise lose an Explanation and the means to replace it in the same action.
- A regenerated Explanation is itself flaggable and suppressible on the same terms, with no limit on how many times this loop can run.
  *Why:* The loop is bounded by parent effort rather than by allowance.
- Suppressing an Explanation does not alter the Question, the Attempt, its score, or Mastery, and does not remove the Practice Test from the student's list (FR-16).
- **Suppression is not reversible in v0.** There is no un-suppress action for the parent, the student, or the Admin, and the suppressed Explanation does not return to the child's screen. The remedy for a suppression the parent regrets is the free regeneration this FR already grants, which produces a **different** Explanation rather than restoring the original. **The parent-facing suppression control must state in words that the action cannot be undone, before it fires** — the same treatment FR-13's delete-to-zero discard receives.
  *Why:* The blast radius of a misclick is one Explanation on one Question, regeneration is free at every tier, and a reversal would need both a new requirement and a second student-facing state change — something reappearing where something was removed, which is harder to explain to a child than either the removal or the replacement. *Revisit condition:* if support signal shows parents suppressing in error, add reversal to FR-39 rather than softening the confirmation.

**Notes:**
- FR-39 is what makes §5.1's accountability argument terminate in an action. Without it the chain ran: child sees an unreviewed Explanation, flags it, parent confirms, Admin queue — and nothing changes on the child's screen, with deleting the Student Profile (FR-33) as the only remedy the parent held.

#### FR-25: Grade dispute flag

A student can flag a Question whose grade they believe is wrong, surfacing it to the parent.

**Consequences (testable):**
- Flagging is available on the results screen per Question and does not change the score.
- Flagged Questions appear in Parent View with the student's answer, the recorded grade, and the grading rationale (FR-22).
- **Disputes surface on the Analytics dashboard**, within or immediately beside the FR-28 activity summary, scoped to the currently selected Student Profile. There is no separate flagged-items destination in v0.
  *Why:* A parent who opens the dashboard to see how their child is doing is the same parent who needs to know a grade is contested.
- **The override itself is performed in Attempt detail**, reached from the dashboard entry.
  *Why:* The dashboard states that something is disputed; the Attempt detail is where the question, the answer, the grade, and the rationale sit together and the decision is made.
- Resolved disputes stay listed rather than disappearing, marked as resolved and showing the outcome.
  *Why:* The parent can see what they already dealt with.
- A parent can override the grade, which recomputes the Attempt score and the affected Topic's Mastery (FR-26).
- **An override retains the original AI grade and its rationale rather than overwriting them.** Both remain readable on the Question's row after the override.
- The overridden row is marked as parent-adjusted, distinguishable from a row the AI graded that way in the first place.
- The score change is shown **as a change**, not as a replacement — the prior score, the adjusted score, and the fact that a parent adjusted it are all visible together.
- In Student Mode the student sees the adjusted grade, with one plain line stating that a parent reviewed it. The AI rationale and the override mechanics are not surfaced to the student.

### 4.7 Analytics and Mastery

**Description:** Behind the PIN, the parent gets the thing a graded paper never gives them: which topics the child has and has not got, tracked across every Attempt. Each Question carries Topics, so every answer contributes to per-Topic Mastery. The dashboard leads with Weak Areas, shows Mastery trend over time, and lets the parent drill from a Topic into the specific missed Questions — and from there straight into generating targeted practice. Realizes UJ-3.

**Functional Requirements:**

#### FR-26a: Topic normalization

The system maps each Topic emitted at generation onto a canonical Topic within its Subject before that Topic is used for Mastery.

**Consequences (testable):**
- Generation is not constrained to a fixed Topic list; the system emits whatever Topic best describes the Question.
- An emitted Topic that matches an existing canonical Topic for that Subject is attributed to it, so "equivalent fractions", "fraction equivalence", and "equivalent fraction" contribute to one Mastery value rather than three.
- An emitted Topic with no canonical match becomes a new canonical Topic for that Subject.
- Canonical Topics are scoped per Subject, and deliberately **not** per Grade Level.
  *Why:* "Fractions" is the same concept whether a Grade 3 or a Grade 6 paper raises it, and splitting by level would fragment Mastery for a family with children at different levels.
- Normalization is invisible to both parent and student; Analytics displays canonical Topics only.

**Notes:**
- `[NOTE FOR PM]` This is the highest-risk requirement in the PRD. Without it, Mastery fragments as history accumulates and the Analytics dashboard degrades into noise over a term — the failure is slow and invisible until it is bad. The matching mechanism is an architecture decision; the product requirement is that one concept yields one Mastery value.
- `[NOTE FOR PM]` **RESOLVED, 2026-09-22.** §12.2 item 2's revisit condition — "at architecture, before Mastery is implemented" — has fired: architecture spine AD-9/AD-12 fixed the matching mechanism (free-form emission, embedding cosine-compare, LLM candidate resolution, provisional-flag-until-operator-action) and requires an Admin curation capability the PRD had deliberately left unspecified. See FR-40, which closes this gap.

#### FR-40: Admin Topic curation

The Admin can review provisional Topics and confirm, merge, or rename them within a Subject's canonical set.

**Consequences (testable):**
- A newly emitted Topic with no canonical match enters the canonical set carrying a provisional flag (FR-26a); Mastery accrues against it immediately, unaffected by its provisional status.
- Admin can confirm a provisional Topic as-is, merge it into an existing canonical Topic, or rename it.
- A merge re-points every Question tagged with the merged Topic to the surviving canonical Topic and recomputes Mastery for every affected Student Profile.
  *Why:* leaving stale per-Topic Mastery values after a merge would silently misreport what a child knows.
- Confirming or renaming a Topic does not affect existing Mastery values.
- This capability closes the gap FR-26a's Notes previously flagged: the canonical set no longer accumulates unreviewed near-duplicates with no remedy.

**Notes:**
- `[NOTE FOR PM]` Added 2026-09-22 during sprint-planning readiness review: architecture (AD-12) bound this capability to "the Admin surface (FR-30)" with no corresponding FR on record. Traced back to §12.2 item 2's now-satisfied revisit condition rather than invented fresh.

#### FR-26: Per-Topic Mastery computation

The system maintains a Mastery value per Topic per Student Profile, derived from graded Questions across all Attempts.

**Consequences (testable):**
- Mastery is the proportion of correctly answered Questions carrying that Topic, computed over a rolling window of the Student Profile's **5 most recent qualifying Attempts that included that Topic**, all weighted equally.
- The denominator is stated explicitly: Mastery is `correct / (correct + incorrect)` over the Questions carrying that Topic within the window. Which grade states enter which term is the grade-state table in FR-37.
  *Why:* An unanswered Question is not evidence the child got it wrong, and inflating the denominator with blanks would report a child who ran short of patience as a child who does not understand the Topic.
- **Only the first Attempt on a given Practice Test qualifies.** Retake Attempts (FR-20) are recorded, scored, and shown in history, but do not contribute to Mastery. A fresh Practice Test generated from the same Source Test is a different Practice Test and its first Attempt qualifies normally.
  *Why:* Repeating the same Questions measures memory of those Questions, not command of the Topic.
- Attempts outside the window do not affect Mastery.
  *Why:* A child who has since learned a Topic is not permanently penalized by an early Attempt.
- For a Topic with fewer than 5 qualifying Attempts, Mastery is computed over however many exist.
- A parent grade override (FR-25) recomputes affected Mastery.

#### FR-27: Weak Area identification

The system identifies and surfaces Topics whose Mastery falls below a threshold as Weak Areas.

**Consequences (testable):**
- A Topic is a Weak Area when its Mastery is **below 60%** and the Student Profile has answered **at least 5 Questions** carrying that Topic.
- "Answered" in the floor means **correct + incorrect only** — the same two terms as the FR-26 denominator. Which grade states count is the grade-state table in FR-37.
  *Why:* A child who skipped five questions on a Topic has produced no evidence about it, and must not trip a Weak Area alarm by doing so.
- Weak Areas are displayed first on the Analytics dashboard and visually distinguished.
- Both the 60% threshold and the 5-question floor are system-level configuration, tunable post-launch; neither is a per-parent setting in v0.

**Notes:**
- The 5-question floor prevents a single bad question from creating a false alarm.

#### FR-28: Analytics dashboard

A parent can view, per Student Profile, Mastery by Topic, score trend over time, and Weak Areas.

**Consequences (testable):**
- Mastery is presented per Topic, filterable by Subject.
- The dashboard leads with a per-Student-Profile activity summary — how many *released* Practice Tests have not been attempted versus how many are *completed* — so a parent can answer "did my child actually do it" without notifications (§9.2).
- **Where a Topic has Questions in the *unanswered* state (FR-37), the skipped count travels with the Mastery figure and is never dropped.** A Mastery percentage for a Topic with skipped Questions is never presented on its own. This pairing holds on the dashboard, in Topic drill-down (FR-29), and on the per-Attempt summary.
  *Why:* A parent seeing a low figure must be able to tell a child who got it wrong from a child who did not attempt it, because those call for opposite responses.
- The unanswered count covers **every Attempt the student submitted themselves, timed or untimed** — the scope the grade-state table in FR-37 defines. Only an Attempt that **auto-submitted on timer expiry** contributes no unanswered count, its blanks being graded incorrect instead.
- Score trend covers completed Attempts over time.
- The dashboard carries a **profile-level score trend**: one trend figure for the Student Profile as a whole, computed over the **5 most recent qualifying Attempts for that profile**, with retake Attempts excluded on the same basis as FR-26.
- **Grade disputes (FR-25) and student Explanation flags (FR-38) surface here**, in or beside the activity summary, scoped to the selected Student Profile, each linking to where it is acted on.
- **The Explanation Allowance counter surfaces here too** — usage against the account's limit and its reset date (FR-31) — alongside the disputes and flags, not only on the Parent View Allowances surface (§6.3). On a tier where the allowance is unlimited, the counter states that rather than showing a bar against no ceiling.
  *Why:* It is the one counter whose exhaustion lands on the child rather than on the parent; v0 has no notifications to announce it; and the dashboard is the Parent View surface a parent reliably opens.
- **The profile-level trend states its own scope on the chart itself** — that it covers the 5 most recent qualifying Attempts for the profile, retakes excluded — and the **per-Topic Mastery figures state theirs**, which is FR-26's per-Topic window over the same-numbered but differently-selected set of Attempts. The scope travels with the figure; putting it only in a legend elsewhere on the page, or only in this document, does not satisfy this.
- **The profile-level trend is never labeled as a record of everything the student did.** It is a window, and a label such as "his progress" or "all his tests" is a defect: it invites a parent to read a five-Attempt window as a complete history and to conclude that work outside the window did not happen.
  *Why:* the two windows can move in opposite directions on the same data, and a parent who cannot see which set each figure was computed over reads that as the dashboard contradicting itself.
- The dashboard is reachable only from Parent View.
- **With no completed Attempts, the dashboard states the mechanism and shows progress toward it rather than showing zeroed charts** — naming what has to happen for each figure to appear and how far the profile has got toward it, in the shape of "Mastery appears once N questions are answered on a topic; N so far." A blank panel, a zeroed chart, and a bare "no data yet" all fail this.
- **The empty state does not name the Account Tier as the cause and carries no upsell.** It describes the mechanism, not the plan.
  *Why:* there is no self-serve upgrade path in v0 (§9.2, FR-31), so naming the tier tells the parent their plan is the problem while offering them no action but to wait for an Admin — and the state is expected behavior on Free (§5.3), not a fault to be explained away.

**Notes:**
- The per-profile trend window is deliberately a different scope from FR-26's per-Topic window: FR-26 asks "how is this child doing on fractions", the profile-level trend asks "how is this child doing". The two can move in different directions on the same data, and that is correct — which is why the consequences above make the scope a stated part of each figure rather than a fact known only to this document's readers.

#### FR-29: Drill-down and act

A parent can drill from a Topic into the specific Questions the student missed on it, and initiate weighted generation from there.

**Consequences (testable):**
- Drill-down lists the missed Questions with the student's answers and the correct answers.
- Questions in the *unanswered* state (FR-37) are listed separately from missed Questions, and the Topic's Mastery figure in this view carries its unanswered count exactly as on the dashboard (FR-28).
- A generate action from the Topic view invokes FR-11.

### 4.8 Admin Configuration

**Description:** A small operator surface. The Admin defines the Subject and Grade Level taxonomy that every family selects from, keeping the vocabulary consistent so Topics and Mastery remain comparable across the user base. Realizes UJ-4.

**Functional Requirements:**

#### FR-30: Subject and Grade Level taxonomy management

An Admin can create, rename, enable, and disable Subjects and Grade Levels, and control which Subjects are available for which Grade Levels.

**Consequences (testable):**
- Disabling a Subject removes it from new-upload selection but does not affect existing Source Tests, Practice Tests, or Analytics.
- Renaming a Subject propagates to existing records by reference, not by copy.
- Admin surfaces are inaccessible to Parent Accounts.

#### FR-30a: Account Tier administration

An Admin can view Parent Accounts, assign their Account Tier, and inspect consumption against allowances.

**Consequences (testable):**
- An Admin can set any account to Free, Plus, Family, or Internal.
- A tier change takes effect immediately against the current month's counters.
- Consumption is visible per account on **three counters**: uploads used / allowance, generations used / allowance, and **Explanations generated / allowance** (FR-31).
- Each account's consumption is rendered against **its own reset period**, in its own stored timezone (FR-1, FR-31), with the period's start and end shown. Accounts on the list may be in different periods at the same moment, and the view must not imply a single shared month.
- Explanations flagged by parents (FR-24a), and student flags a parent has confirmed (FR-38), are visible here as a content-quality signal. An Explanation a parent has also suppressed on their own child's screen (FR-39) stays in this queue and is marked as suppressed.
  *Why:* Suppression is a stronger signal about the content, not a reason to drop it from review.
- The flagged Explanations queue shows the **Grade Level** of the Practice Test each flagged Explanation belongs to, as context (FR-24).
  *Why:* An Explanation pitched wrong for Grade 3 and one pitched wrong for Grade 8 are different failures.

**Notes:**
- `[NOTE FOR PM]` v0 assumes a single operator (the builder). Admin authentication depth, roles, and audit logging are deliberately thin and should be revisited before any third-party operator exists.

### 4.9 Data Retention and Deletion

**Description:** The system holds photographs of children's schoolwork and a longitudinal record of a named child's academic performance. Both are sensitive, and both must be disposable — automatically on a schedule, and on demand when a parent asks. The requirements below are the enforcement behind the commitments in §5.2; they are stated as FRs precisely so downstream story creation cannot drop them.

**Functional Requirements:**

#### FR-32: Automatic Page Image expiry

The system deletes Page Images 90 days after the upload of their Source Test, without requiring any user action.

**Consequences (testable):**
- Deletion covers the stored image bytes, not merely a database reference.
- The Source Test, its Extraction, and every Practice Test, Attempt, and Mastery value derived from it survive the deletion intact.
- Regeneration (FR-10, FR-11) continues to function on a Source Test whose Page Images have expired, because it operates on the persisted Extraction (FR-9).
- Surfaces that would otherwise display a Page Image show an expired state rather than a broken image or an error.

#### FR-33: Parent-initiated deletion

A parent can delete a Source Test's Page Images ahead of expiry, delete a Student Profile and its data, or delete the Parent Account entirely.

**Consequences (testable):**
- Early Page Image deletion behaves identically to expiry (FR-32) — derived data survives.
- Student Profile deletion removes that profile's Practice Tests, Attempts, Explanations, and Mastery. It is distinct from archiving (FR-3), which preserves history.
- Parent Account deletion removes the account, every Student Profile under it, and all Source Tests, Page Images, Extractions, Practice Tests, Attempts, Explanations, and Mastery belonging to them, together with any uncommitted Parent View state still held server-side under FR-35.
- Every deletion action requires an explicit confirmation naming what will be destroyed and stating that it cannot be undone.
- Deletion of a Student Profile or Parent Account requires the account password, not the Parent PIN — the PIN gates a mode, not a destructive action.
- Deletion completes without leaving orphaned stored files.

**Feature-specific NFRs:**
- Deletion must propagate to stored image bytes and derived records together; a partial deletion that leaves image bytes behind fails this requirement.

### 4.10 Account Tiers and Allowance Enforcement

**Description:** Every Parent Account carries exactly one Account Tier — an Admin-assigned label that sets the account's Student Profile limit and its three monthly allowances. This is the cost control for a product in which every upload, generation, AI grade, and Explanation is a paid model call and v0 has no revenue. The tier table, the numbers in it, and the reasoning behind them live in §5.3; the enforcement behavior is here.

**Functional Requirements:**

#### FR-31: Account Tier enforcement

The system assigns every Parent Account an Account Tier and enforces its Student Profile limit, Upload Allowance, Generation Allowance, and Explanation Allowance.

**Consequences (testable):**

*Assignment.*
- A newly registered Parent Account is assigned the **Free** tier.
- Only an Admin can change an account's Account Tier; there is no self-serve upgrade path in v0.
- The Student Profile limit is enforced at profile creation (FR-3). Moving an account to a tier whose Student Profile limit is below its current profile count does not delete profiles; it blocks creating more.

*Counting and reset.*
- Upload Allowance, Generation Allowance, and Explanation Allowance are tracked on **three separate counters** and enforced independently — exhausting one does not affect the others. Their values for each tier are the §5.3 table.
- **An allowance is consumed on successful production of the artifact, never on request.** A Source Test that fails the legibility check and is abandoned, an Extraction that fails, and a generation that errors all consume nothing. One successful Source Test upload consumes one Upload Allowance; each Practice Test that reaches *draft* consumes one Generation Allowance. A parent who discards a draft (FR-14) does not get the allowance back — it was spent producing it.
- One newly generated Explanation consumes one Explanation Allowance on the same rule. A failed Explanation generation consumes nothing; a cache hit consumes nothing.
- **A replacement Explanation regenerated after a parent suppression (FR-39) consumes no Explanation Allowance at any tier, including Free.**
  *Why:* It is the one production path that is deliberately free, because the parent is replacing output the product got wrong.
- All three allowances reset on the **calendar month** boundary **in the Parent Account's own stored timezone** (FR-1), independent of sign-up date. Two accounts in different timezones roll over at different absolute moments.
  *Why:* Each is correct for the family reading it — a parent told "resets 1 October" must see the reset happen on their own 1 October.
- The three counters reset **atomically per account**: at the boundary all three go to zero together. A partial reset that clears one counter and not another is a defect.

*Blocking and surfacing.*
- Reaching an allowance **hard-blocks** the operation. The message names the tier, the usage against the limit, and the reset date in the account's own timezone, in the units of the thing that was blocked. A generic error or silent failure fails this requirement.
- **AI grading (FR-22) is never blocked by an allowance at any tier.**
  *Why:* It is downstream of a Practice Test already counted against the Generation Allowance, so it is transitively bounded, and a student must never be unable to find out whether they were right.
- **Explanation generation is capped at whatever figure the §5.3 table gives for the account's tier**, and is uncapped on any tier the table marks unlimited. **Reading an already-generated Explanation is never capped at any tier**, including on an account sitting at its cap — the cap governs what is newly produced, never what has already been shown. FR-24 owns the serving behavior this enforcement backs.
- Every surface that reports usage renders an account against **its own period** (FR-30a).
- A parent can see all three counters — usage against limit and the reset date in the account's own timezone — on the Parent View Allowances surface (§6.3), without entering an at-cap state to find out where they stand. The Explanation Allowance counter additionally appears on the Analytics dashboard (FR-28).
- Admin can view per-account consumption against allowances (FR-30a).

## 5. Constraints and Guardrails

### 5.1 Safety

- Every AI-generated Question and every AI-generated Explanation is child-directed content. Generation must be constrained to the Source Test's academic subject matter, and the parent review gate (FR-12 through FR-14) is the required human check before any generated Question reaches a student.
- Explanations (FR-24) are shown to the student without a parent gate, because an Explanation is bounded to explaining a Question the parent already reviewed and released. Accountability is after the fact rather than preventive: every Explanation is retained and readable by the parent, who can flag a bad one (FR-24a) **and stop it being served to their child, with a free replacement (FR-39)**. The flag is a signal; the suppression is the remedy, and the argument for shipping Explanations ungated depends on the parent holding both. This is a deliberate trade — pre-generating and reviewing every Explanation would multiply generation cost by question count for explanations most students never open, and would put a *review* wall in front of a child mid-study-session. The absence of a review gate is not an absence of all limits: Explanation **generation** is capped wherever §5.3 gives a finite figure, so a child on such a tier can meet a wall — a cost wall, not a safety one. Reading an Explanation already generated is never gated by cost, and the one thing that can withdraw it is the child's own parent suppressing it. FR-24 governs what is served; FR-31 governs the counter.
- Uninterpretable Source Test content must not be hallucinated into Questions (FR-9).

### 5.2 Privacy

- The system processes photographs of children's schoolwork and stores per-child performance data. Both are sensitive.
- Page Images and student performance data are scoped to the owning Parent Account and never surfaced across accounts.
- Sign-up requires explicit parental consent to process the child's data (FR-1). Parent-provided consent at sign-up is the build posture, on the basis that no child ever holds an account or supplies data directly. **Legal review of this posture is a launch gate**: it blocks opening public registration, not development. Until it clears, registration stays closed or invitation-only.
- **Page Images are deleted 90 days after upload.** The window covers a school term's regeneration needs. Because the Extraction is persisted separately (FR-9), regeneration continues to work after the photos are gone, so deletion costs the parent nothing functional.
- Deletion is automatic and does not require a parent action; a parent may also delete a Source Test's Page Images earlier.
- A parent can delete a Student Profile's data and can delete the Parent Account and all associated data.
- Third-party AI processing must be under terms that exclude the content from provider model training. This covers **every model call class, not only the vision call over Page Images**: Extraction, generation, grading, and Explanation. Grading (FR-22) sends the child's own typed answers, is the highest-frequency call in the product, and is uncapped at every tier — excluding photographs from training while sending a child's free-text answers uncovered would be an incoherent commitment.
- Uncommitted Parent View state retained under FR-35 can contain Page Images that were never committed to a Source Test. It is held server-side, scoped to the Parent Account, and expires on its own TTL, so no class of children's schoolwork sits outside a deletion clock.

### 5.3 Cost and Account Tiers

Every upload, generation, AI grade, and Explanation is a paid model call, and v0 has no revenue. Unbounded usage is the primary cost risk, and **Source Test upload is the single most expensive operation** — a vision call over up to 10 photographs — so it is capped on its own counter rather than folded into generation.

Cost is controlled by **Account Tier**. Tiers are Admin-assigned labels carrying limits; they carry **no payment, pricing, or billing meaning in v0** (monetization remains a non-goal, §8). The tier field exists so pricing can be attached later without a data model change. This section holds the numbers and the reasoning; the enforcement behavior — assignment, counting, reset, blocking, and surfacing — is FR-31 in §4.10.

| Account Tier | Student Profiles | Upload Allowance / month | Generation Allowance / month | Explanation Allowance / month |
|---|---|---|---|---|
| **Free** | 1 | 2 | 2 | 10 |
| **Plus** | 2 | 8 | 20 | unlimited |
| **Family** | 5 | 20 | 60 | unlimited |
| **Internal** | unlimited | unlimited | unlimited | unlimited |

**This table is the single authoritative source for every allowance number in this document.** Where any other section names a limit, it does so by reference to this table rather than by restating the figure; a number written anywhere else is an error. All of these values are scheduled for recalibration after the first month of real accounts (§12.2 item 3).

The Explanation Allowance counts **newly generated** Explanations only. What is served and what is blocked at the cap is FR-24; how and when the counter moves, including the free replacement after a suppression, is FR-31. AI grading (FR-22) is uncapped at every tier and has no counter.

**The two Free-tier philosophies are different on purpose.** The Free Upload and Generation Allowances are **positioning levers**: they are deliberately set *below* what a family would find useful, so that Free demonstrates the loop and Plus is where the product becomes worth having. The Free Explanation Allowance is **not** a positioning lever — it is a **spend ceiling**, set *above* expected usage purely to bound the cost of an uncapped per-question call, and it is not there to make Free feel thin. Reading the Explanation number as a positioning lever leads to the wrong fix in both directions: raising it does not weaken the Free-to-Plus argument, and a child hitting it is a signal the ceiling was set too low, not evidence the tier is working as designed. §12.2 items 6, 7, and 8 all turn on this distinction.

**Internal** is Admin-assigned only, never reachable by sign-up, and exists for the operator, testers, and friends-and-family.

**Free is a taste, not a trial.** At the Free Generation Allowance in the table above, a Free account will not accumulate enough answered Questions on any one Topic to cross the Weak Area floor (FR-27) or fill the Mastery window (FR-26) within a useful period. A Free account's Analytics dashboard showing an empty or near-empty state is **expected behavior, not a defect** — Analytics is a Plus-and-above capability in practice. This is a deliberate position: Free demonstrates the core loop (photo in, practice out, answers and explanations), and Plus is the real entry point for the parent-facing value. Do not "fix" the empty Free dashboard by lowering the FR-27 floor; that would trade a truthful empty state for untrustworthy Weak Area calls.

## 6. Platform and Information Architecture

### 6.1 Platform

Mobile-first responsive web application. Single codebase, no app store, camera access via the browser. Must be usable on a phone held one-handed in a kitchen and on a family tablet. Desktop is supported but not optimized. Native apps are explicitly v2+.

**Dark mode ships in v0**, on both Student Mode and Parent View. Every design token has a dark counterpart, and every contrast pair required by §10.1 is verified in both modes rather than in light only. This is scope, not polish: the study session this product exists for happens in the evening, often on a tablet in a dim room, and a light-only app is the wrong tool at the hour it is most used.

Dark mode carries **no functional requirement of its own** — it adds no capability, state, user-visible choice, or behavior that differs between the two modes — so it is enforced as a §10.1 accessibility obligation and listed in §9.1 as scope that must be planned for, rather than as an FR.

### 6.2 Inherited technical constraint

This product is built on the same stack as the sibling `n-electric` project, and reuses its OpenAI client configuration directly (see `addendum.md`). This is a decided constraint, not an open architecture choice: Turborepo with pnpm workspaces, NestJS + Prisma + PostgreSQL on the API, Next.js + React + MUI on the web, JWT with argon2 hashing, local-filesystem storage, Playwright for E2E, Docker Compose in development. Two requirements are satisfied at no additional cost by the inheritance — argon2 covers the password and Parent PIN hashing in §10, and the existing local-filesystem storage covers Page Image storage and its 90-day deletion (§5.2). This is recorded here because it bounds the architecture workflow's decision space; the PRD otherwise stays at capability level.

### 6.3 Surfaces

Student Mode is the device default and is bound to one Student Profile (FR-4). Every Parent View surface below sits behind the Parent PIN (FR-2) and is subject to the idle timeout (FR-34). Admin is a separate surface, unreachable from any Parent Account.

| Surface | What it holds | FRs |
|---|---|---|
| **Auth** (ungated, outside both modes) | Sign-up, sign-in, the child-data consent notice, password reset | FR-1 |
| **Student Mode — Home** | The bound Student Profile's *released* and *completed* Practice Test cards | FR-16 |
| **Student Mode — Take Test** | One Question at a time by format, the timer if enabled, back/forward navigation, and the question map | FR-15, FR-17, FR-18, FR-19, FR-36 |
| **Student Mode — Results** | Score, answer key across all four grade states, on-demand Explanations, grade-dispute and Explanation flags | FR-19, FR-23, FR-24, FR-25, FR-37, FR-38 |
| **Parent View — Dashboard / Analytics** | Mastery by Topic, Weak Areas, activity summary, profile-level trend, surfaced disputes and student flags, the Explanation Allowance counter | FR-25, FR-27, FR-28, FR-31, FR-38 |
| **Parent View — Topic drill-down** | The Questions missed and left unanswered on one Topic, and the weighted generate action | FR-11, FR-29 |
| **Parent View — Upload** | Classify → capture pages → legibility check → generate | FR-5, FR-6, FR-7, FR-8, FR-9a, FR-10 |
| **Parent View — Pending drafts** | Every *draft* Practice Test awaiting review, across Student Profiles | FR-12 |
| **Parent View — Review draft** | Every Question of one *draft* Practice Test; edit, delete, set the timer, release or discard | FR-12, FR-13, FR-14, FR-15 |
| **Parent View — Source Tests** | Uploaded papers, their Page Images or expired state, and what was generated from each | FR-9, FR-32, FR-33 |
| **Parent View — Attempts / Attempt detail** | Per-Question grades, AI grading rationales, overrides, and the Explanations shown to the child | FR-22, FR-24a, FR-25, FR-39 |
| **Parent View — Allowances** | Usage against the account's three counters and its reset date in the account's own timezone | FR-31 |
| **Parent View — Students** | Student Profile creation, rename, Grade Level, archive | FR-3 |
| **Parent View — Settings** | PIN, timezone, account, data deletion | FR-1, FR-2, FR-33 |
| **Admin** | Subjects, Grade Levels, Parent Accounts and Account Tier assignment, per-account consumption, flagged Explanations | FR-30, FR-30a |

## 7. Aesthetic and Tone

- **Student-facing:** calm and low-stakes. A practice test that looks like a real test is the point, but a wrong answer must never read as punishment. Explanations use encouraging, plain, grade-appropriate language — no condescension, no exclamation-mark cheerleading.
- **Parent-facing:** dense and factual. A parent scanning Analytics for 30 seconds should leave knowing exactly what to work on. Weak Areas are stated plainly, not softened.
- **Anti-reference:** gamified ed-tech — no streaks, badges, mascots, or points in v0.
- **No result or analytics string is a fixed literal.** Every string that describes a student's work — scores, Mastery figures, Weak Areas, activity summaries, dispute and flag notices, at-cap messages about that child's practice — takes the subject as a parameter and resolves its mode of address by surface: **Student Mode addresses the student in the second person** ("you left 3 questions unanswered"), **Parent View names the child in the third person** ("Noah left 3 questions unanswered"). Writing the same sentence twice, or shipping a Parent View string that says "you", is a defect. This is what makes one dashboard readable by two different people about a third party without either reading as written for someone else.
- The exception is **grade-state labels** — *correct*, *incorrect*, *unanswered*, *ungraded* (§3). Those are fixed literals on purpose, identical on every surface, because a grade state that is worded differently in two places reads as two different states.

## 8. Non-Goals (Explicit)

These are **permanent product stances** — things this product is not, at any version. They are distinct from §9.2, which lists things deferred past MVP and expected to arrive later. Nothing here is repeated in §9.2.

- **Not a classroom tool.** No teacher accounts, rosters, assignments, or school-level anything.
- **Not a curriculum or content library.** The app generates only from what a parent uploads. It does not ship a question bank and does not claim curriculum alignment.
- **Not a grading system of record.** Scores are practice signal, never a substitute for a teacher's grade.
- **Not a tutor.** Explanations explain one question. There is no conversational back-and-forth, no follow-up questions, no chat.
- **Not gamified.** No streaks, points, leaderboards, or rewards.
- **Not a document scanner.** The app reads test papers; it is not a general OCR or PDF tool. PDF upload is out of v0.
- **Not multi-parent.** One Parent Account per family in v0; no co-parent sharing.

## 9. MVP Scope

### 9.1 In Scope

One line per capability, each naming the requirements that define it. This is an inventory, not a specification: where a line and its FRs appear to differ, the FRs govern, and no number is restated here.

- Parent Account with email/password auth, one Parent PIN, and multiple Student Profiles — FR-1, FR-2, FR-3.
- Student Mode / Parent View switching, with a silent Parent View idle timeout and full restoration of uncommitted parent work — FR-4, FR-34, FR-35.
- Account Tiers with three separate allowances and a Student Profile limit, Admin-assigned, reset monthly in the account's own timezone, hard-blocking at cap, with a parent-facing Allowances surface — FR-31, FR-30a, §5.3.
- **Dark mode** across Student Mode and Parent View, with contrast verified in both — §6.1, §10.1. Carried as an accessibility obligation rather than an FR.
- Multi-page photo upload from camera or photo library, with library selection as a first-class path when the camera is unavailable, plus reorder, retake, delete, and a pre-generation legibility check — FR-5, FR-6, FR-8.
- Subject and Grade Level classification of a Source Test from the Admin taxonomy — FR-7, FR-30.
- Extraction of the Source Test, including cross-page context such as a reading passage shared by later questions, persisted for reuse, with a thin-Extraction warning before generation — FR-9, FR-9a.
- Practice Test generation bounded by the tier's remaining Generation Allowance, and weighted regeneration targeting a Weak Area Topic — FR-10, FR-11.
- Parent review of *draft* Practice Tests with per-Question edit and delete, then release or discard — FR-12, FR-13, FR-14.
- Optional per-Practice-Test countdown timer, default off, set by the parent before release, with mandatory non-escalating warnings and an announced auto-submit — FR-15, §10.1.
- All three Question Formats, taken one Question at a time with back/forward navigation and a question map that reaches any Question directly, no mid-test feedback, and persistence across interruption and network loss — FR-17, FR-18, FR-36.
- Practice Test list in Student Mode, submission, and retake producing a new Attempt — FR-16, FR-19, FR-20.
- Four grade states, deterministic Multiple Choice grading, and AI semantic grading for the other two formats — FR-37, FR-21, FR-22.
- Immediate answer reveal with a full answer key and score — FR-23.
- On-demand cached Explanations, with generation bounded by the Explanation Allowance and re-reading never capped — FR-24, FR-31.
- Explanations retained and readable by the parent, a parent flag, a student flag that reaches the Admin only once the parent confirms it, and parent suppression on their own child's screen with a free regenerated replacement — FR-24a, FR-38, FR-39.
- Student grade-dispute flag with parent override that retains the original AI grade and rationale — FR-25.
- Topic normalization onto a per-Subject canonical set, per-Topic Mastery, Weak Area detection, the Analytics dashboard, and Topic drill-down — FR-26a, FR-26, FR-27, FR-28, FR-29.
- Admin management of Subjects and Grade Levels, Account Tier assignment, per-account consumption, and flagged-Explanation review — FR-30, FR-30a.
- Automatic Page Image expiry, parent-initiated early image deletion, Student Profile deletion, and full Parent Account deletion — FR-32, FR-33.

### 9.2 Out of Scope for MVP

Everything here is **deferred past MVP**, not refused — each is expected to become buildable later, and several carry a revisit condition. Permanent refusals live in §8 and are not repeated here.

- **Notifications** of any kind — no push, no email on student completion. Deferred to v1. The Analytics dashboard's activity summary (FR-28) is the v0 answer to "did my child do it", and it requires the parent to open the app. `[NOTE FOR PM: still the most likely first post-launch request; email infrastructure already exists for password reset (FR-1), so the incremental cost of adding it later is small.]`
- **Native mobile apps** — v2+.
- **PDF or scanned-document upload** — photos only.
- **Handwriting recognition of the student's own written answers on the Source Test** — the app reads the questions, not the child's marks.
- **Monetization, billing, payment** — v0 has no revenue. Account Tiers exist and are enforced, but carry no price and no self-serve upgrade; an Admin assigns them by hand.
- **AI provider abstraction** — v0 depends directly on OpenAI with no swappable provider interface, reusing the client configuration already proven in the sibling `n-electric` project (see `addendum.md`). `[NOTE FOR PM: a deliberate speed-over-insurance trade, made cheaper by the fact that a working configuration already exists to copy. A provider price change, terms change, or sustained outage means a real refactor across Extraction, generation, grading, and Explanations — the four most load-bearing paths in the product. Revisit if the AI spend becomes material.]`
- **Offline test-taking** — network required, with one carve-out (FR-36). Inside an already-started Attempt, answering Questions and navigating between them work offline. **Submission requires the network** and is never retried silently — the student is told, the Attempt stays open with every answer intact, and they submit again themselves. **A timer that expires while offline auto-submits on reconnect and is graded against the moment of expiry, not the moment of reconnect**, so losing signal neither buys the student extra time nor costs them work. Everything else — the Practice Test list, generation, grading, and Explanations — requires a connection.
- **Localization** — English only.
- **Recall of a released Practice Test** (FR-14) — parent discards and regenerates instead.
- **Parent-authored questions from scratch** without a Source Test.
- **Per-family Weak Area threshold configuration** — system-level only.

## 10. Cross-Cutting NFRs

- **Performance.** Student Mode interactions (question navigation, submission, results render) feel instant on a mid-range tablet over home wifi. Generation is explicitly asynchronous with progress feedback; a parent must be able to leave and return. Explanation generation is a foreground wait and must stay short enough not to break a study session.
- **Reliability.** No AI failure loses student work: an in-progress Attempt survives interruption (FR-18), a failed generation is retryable without re-upload (FR-10), and unavailable AI grading degrades to *ungraded* rather than to *wrong* (FR-22).
- **Security.** Passwords and Parent PINs stored hashed. All traffic over TLS. Authorization enforced server-side per Parent Account for every Page Image, Practice Test, Attempt, and Analytics query — Student Mode restrictions are not client-side-only (FR-4). Parent View is additionally bounded in time: it expires after 15 minutes of inactivity and returns the device to Student Mode (FR-34), so an unattended family tablet does not sit in an elevated state indefinitely. Expiry is enforced server-side; a client that fails to expire does not retain Parent View authority.
- **Observability.** Generation, Extraction, grading, and Explanation calls are logged with outcome, latency, and cost attribution per Parent Account, sufficient to answer "why was this test bad" and "what did this family cost."
- **Data lifecycle.** Deletion requests (§5.2) propagate to Page Images, Extractions, Practice Tests, Attempts, and Mastery.
- **Accessibility.** Its own subsection, §10.1.

### 10.1 Accessibility

Target WCAG 2.1 AA for student-facing surfaces: sufficient contrast, adequate tap targets for a child's hands, screen-reader-labeled inputs, and correct/incorrect state never conveyed by color alone. Contrast is verified in **both light and dark mode** (§6.1) — a pair that passes in one mode and not the other fails this requirement.

**Timer behavior.**
- **Every timer is exposed to assistive technology as a timer**, labeled with what it is counting down, so a screen reader user can query the remaining time on demand. It does **not** announce continuously: the timer speaks only at the three warning thresholds FR-15 sets and is otherwise silent, because a per-second announcement would make the test unusable with a screen reader.
- **Auto-submit on expiry is announced immediately and interrupts**, so a screen reader user learns that the test ended and where they now are in the same moment a sighted user does. Where the announcement leaves focus is a rendering choice recorded in the addendum.

**Question map.**
- The question map (FR-17) is built from **real buttons, not decorative cells**, is keyboard navigable in full, and each entry is **individually announced with its progress state** — *Answered* / *Not answered* (FR-19) — rather than distinguished by color, fill, or position alone.
- The student's **current position in the Practice Test is indicated** in the map and exposed to assistive technology, so a screen reader user can tell where they are without counting entries.
  *Why:* the map is the only path back to a skipped Question, so a map that is visually navigable but not operable by keyboard or screen reader withdraws the remedy FR-19's confirmation depends on.

**Fractions.**
- **Fractions render typographically; what is structured is the emission behind them.** Questions, answer keys, and Explanations emit fractions in a structured renderable form (FR-9, FR-10, FR-24) so that each one can be rendered as a true typographic fraction rather than as a plain `1/2` string, and each rendered fraction is exposed to assistive technology as a single value with a spoken alternative that reads as the number ("five sixths", never "five six" or "five slash six"). The requirement this PRD carries is on **generation output**, not on styling — a fraction styled to look right but exposed to assistive technology as two loose digits fails it.
- Student answer input is unaffected: a student types a **raw free-text string**, and that string is what is submitted and graded (FR-22). No structured-input control is imposed on a child answering a question.

**SC 2.2.1 (Timing Adjustable) — conformance argument.**

The optional timer (FR-15) is claimed under the standard's **essential exception**, and the argument is recorded here rather than assumed: the time limit *is the thing being simulated*. A practice test that removes the constraint of the real exam stops being practice for that exam, which is the product's entire premise (§1). The exception is narrowed by three facts — the timer is **optional**, it is **off by default**, and its **duration is set by the parent per Practice Test** for the specific child who will take it. The standard's other exceptions are explicitly **not** claimed: the duration is **not extendable** mid-Attempt, because an extendable simulated exam limit is not a simulated exam limit. Any future change that makes the timer mandatory or system-set invalidates this claim and must revisit it.

## 11. Success Metrics

Each SM cross-references the FR(s) it validates. **The targets are initial hypotheses, not derived commitments** — set pre-launch with no baseline, no comparable product, and no usage data. Recalibrate them after a month of real accounts, the same standing the tier values carry (§12.2). What is load-bearing here is *which* things are measured and which are named as counter-metrics; the numbers themselves are placeholders that should be argued with once there is evidence.

**Primary**
- **SM-1: Upload-to-release completion.** Share of started Source Test uploads that reach a released Practice Test. Target: ≥80%. Validates FR-5 through FR-14 — if parents abandon mid-flow, the core loop is broken.
- **SM-2: Practice Test completion rate.** Share of released Practice Tests with at least one completed Attempt within 7 days. Target: ≥70%. Validates FR-16 through FR-19 — the parent's effort must convert into the student actually practicing.
- **SM-3: Repeat family usage.** Share of Parent Accounts that upload a second Source Test within 30 days of the first. Target: ≥50%. Validates the product thesis end to end.

**Secondary**
- **SM-4: Explanation engagement.** Share of completed Attempts in which at least one Explanation is requested. Target: ≥40%. Validates FR-24 — the differentiator over a plain quiz generator.
- **SM-5: Parent edit rate on draft Practice Tests.** Share of Questions edited or deleted at review. Target: ≤10%, tracked as a generation-quality signal. Validates FR-9 through FR-13.
- **SM-6: Grade dispute rate.** Share of AI-graded Questions flagged by students, and share of flags the parent upholds. Target: upheld flags ≤3% of AI-graded Questions. Validates FR-25 — the dispute-and-override path, and through it the quality of FR-22's grading.

**Counter-metrics (do not optimize)**
- **SM-C1: Practice Tests generated per Source Test.** High volume looks like engagement but is mostly cost, and a child buried in ten practice tests will do none of them. Counterbalances SM-3 and SM-4.
- **SM-C2: Time in app for the student.** This is a study tool, not an attention product. Longer sessions are not better; a student who finishes, understands, and leaves is the success case. Counterbalances SM-2.
- **SM-C3: Score improvement on retakes of the same Practice Test.** Rising scores here measure memory of specific Questions, not command of a Topic. FR-26 already excludes retake Attempts from Mastery so the dashboard cannot be inflated this way; this metric exists to catch the softer failure — the product being *used* as a memorization loop rather than a practice loop. Counterbalances SM-2.

## 12. Resolved Decisions and Remaining Questions

### 12.1 Resolved

The eleven open questions raised in drafting are all closed. Recorded here because each drove a requirement, and downstream workflows should not relitigate them.

| # | Question | Decision | Lands in |
|---|---|---|---|
| 1 | COPPA / child-data posture | Parent consent at sign-up is the build posture; legal review is a **launch gate** blocking public registration, not a build blocker | §5.2, FR-1 |
| 2 | Page Image retention | Delete 90 days after upload; persisted Extraction keeps regeneration working photo-free | §5.2, FR-9 |
| 3 | Explanations shown unreviewed | Ship without a **review** gate; retain every Explanation, make it readable and flaggable by the parent, and let the parent suppress a flagged one on their own child's screen with a free replacement. Ungated on safety review, **not** on cost — the cap is FR-24 for what is served and FR-31 for what is counted | §5.1, FR-24, FR-24a, FR-39, FR-31 |
| 4 | Mastery weighting | Rolling window of the 5 most recent Attempts per Topic, equal weight — no decay constant guessed at with zero data | FR-26 |
| 5 | Weak Area threshold | Below 60% Mastery with a 5-question floor; both system config | FR-27 |
| 6 | Topic taxonomy | Free-form emission at generation plus normalization onto a per-Subject canonical set | FR-26a |
| 7 | Usage caps | Replaced by **Account Tiers** — Free / Plus / Family / Internal, with **three** separate counters: Upload, Generation, and Explanation Allowances. All three reset together on the calendar month in the account's own timezone. AI grading is uncapped at every tier | §5.3, FR-31, FR-30a, FR-1 |
| 8 | AI provider | **Hard OpenAI dependency**, no abstraction layer — speed over insurance, risk accepted | §9.2 |
| 9 | Thin Extraction | Warn with the usable-question count and let the parent proceed or retake; never hard-block | FR-9a |
| 10 | Cross-page context | Extraction treats all Page Images as one ordered document; shared reading passages supported in v0 | FR-9 |
| 11 | "Did my kid do it" | No notifications; dashboard leads with not-yet-attempted vs *completed* counts | FR-28, §9.2 |

### 12.2 Remaining

Each item carries the same four fields. Items 6, 7, and 8 are grouped: all three turn on the Free Explanation Allowance and should be decided together. Item numbers here are working references, not stable identifiers.

1. **Legal review of the COPPA posture** (from Q1).
   - *Question:* Does parent-consent-at-sign-up satisfy the applicable child-data regime, and is a per-Student-Profile consent artifact required?
   - *Why open:* No legal opinion has been obtained; the posture is a build assumption (§5.2, FR-1).
   - *Owner:* the builder.
   - *Revisit condition:* before public registration opens. Until it clears, registration is closed or invitation-only.

2. **Topic normalization mechanism** (from Q6). **RESOLVED at architecture, 2026-09-22** — spine AD-9/AD-12 fixed the mechanism (free-form emission, embedding cosine-compare, LLM candidate resolution) and the operator-curation half is now FR-40.
   - *Question:* By what mechanism is an emitted Topic matched onto a canonical Topic?
   - *Why open:* FR-26a fixes the product requirement — one concept, one Mastery value — but the matching approach is an architecture decision the PRD deliberately does not make.
   - *Owner:* the architecture workflow.
   - *Revisit condition:* at architecture, before Mastery is implemented. The highest-risk item in the build.

3. **Tier values and Success Metric targets are guesses.**
   - *Question:* What should the §5.3 allowance figures and the §11 targets actually be?
   - *Why open:* Every one of them was set without usage data, no baseline, and no comparable product.
   - *Owner:* the builder.
   - *Revisit condition:* after the first month of real accounts.

4. **Practice Test question count default.**
   - *Question:* What exact derivation turns a Source Test's question count into the generated Practice Test's question count?
   - *Why open:* FR-10 states that it derives from the source count and stops there.
   - *Owner:* the PM, with the architecture workflow.
   - *Revisit condition:* before generation is implemented.

5. **Extraction timeout.**
   - *Question:* Does Extraction get a per-call timeout override or is it chunked across pages?
   - *Why open:* The reused `n-electric` OpenAI client sets a 30-second call timeout tuned for a single-image call, and Extraction over a full Source Test will exceed it. The one inherited default that does not transfer cleanly — see `addendum.md`.
   - *Owner:* the architecture workflow.
   - *Revisit condition:* at architecture, before Extraction is implemented.

6. **The Explanation cache key includes the answer, so a retake charges again.**
   - *Question:* Key the cache on Question alone, charge only the first Explanation per Question, or leave it and accept the retake cost?
   - *Why open:* The three options have not been weighed against each other.
   - *Dependents:* two, not one. **FR-20 retakes** are the cost path described below. **FR-39's free replacement** is the second: a regeneration after a parent suppression must produce a *different* cached entry from the suppressed one and must be served in its place for that Student Profile, which every candidate key has to satisfy before it can be chosen. A key that collides the replacement with the suppressed original silently reinstates content a parent removed.
   - *Owner:* the PM.
   - *Revisit condition:* before the Free Explanation Allowance is set as a final number.

   FR-24 caches an Explanation against the same Question **and the same answer**. A student who retakes a Practice Test (FR-20) and gets the same Question wrong a *different* way is a cache miss, and generating the Explanation charges a **new** Explanation against the Free Explanation Allowance (§5.3). This is exactly the behavior UJ-2 ends on — get it wrong, explain, retake — so the interaction of the Free Explanation Allowance (§5.3) with FR-20 and FR-24 hits the product's own flagship journey. §5.3 names that allowance a spend ceiling rather than a positioning lever, which is what makes raising it a legitimate option here rather than a concession on Free.

7. **SM-4 is measured on a metric the Free cap suppresses.**
   - *Question:* Recalibrate SM-4, or restate it as measured on uncapped tiers only with a separate, lower, expected Free-tier figure?
   - *Why open:* SM-4's target and the Free Explanation cap were set against different assumptions, on the tier most new accounts sit in.
   - *Owner:* the PM.
   - *Revisit condition:* alongside item 3, after the first month of real accounts.

8. **Accepted cost of the Free Explanation Allowance, narrowed but not closed.**
   - *Question:* Does v0 ship with nothing that tells the parent, at the moment it happens, that their child hit the Explanation cap?
   - *Why open:* Three separately reasonable positions interact badly — a limit a child can actually reach (§5.3), **no notifications of any kind** (§9.2), and **no self-serve upgrade** (§9.2, FR-31). A Free-tier child hits the cap, is told, and stops asking.
   - *Owner:* the PM.
   - *Revisit condition:* with the first notification work, or sooner if Free-tier Explanation engagement collapses.

   **The discoverability half of this is addressed**: the Explanation Allowance counter appears on the Analytics dashboard (FR-28) and on the Parent View Allowances surface (§6.3), so a parent who opens the app can see the counter approaching rather than discovering it after the fact. **What remains open is the moment itself** — nothing in v0 tells the parent that the child hit the wall mid-session, and a parent who does not open the app that evening still learns nothing. Recorded as a narrowed accepted cost. The cheapest deferred fix, not taken in v0, is an "ask a parent" prompt on the at-cap message that leaves a marker the parent sees on the dashboard.

9. **The FR-27 5-question floor has no stated window.**
   - *Question:* Are the 5 answered Questions counted inside FR-26's rolling 5-qualifying-Attempt window, or over the Student Profile's lifetime?
   - *Why open:* The PRD states the floor and never states its window. The two readings give different Weak Area sets for any child with more than a term of history. Not a tuning question — a definition gap.
   - *Owner:* the PM.
   - *Revisit condition:* before Mastery is implemented.

10. **A resolved *ungraded* batch can retroactively create a Weak Area.**
    - *Question:* Is a retroactively created Weak Area marked as such, and is the parent shown that it appeared from a regrade rather than from new work?
    - *Why open:* When Questions resolve from *ungraded* to real grades on a later view (FR-22), Mastery recomputes, and a Topic that was not a Weak Area an hour ago can become one with no new student activity. FR-22 sets the results-screen rule for a score that changes; there is no parallel rule for the dashboard.
    - *Owner:* the PM.
    - *Revisit condition:* before the Analytics dashboard is implemented.

11. **Explanation Allowance scope: per Parent Account or per Student Profile?**
    - *Question:* Which of the two does a finite Explanation Allowance count against?
    - *Why open:* Moot by construction today — the only tier with a finite Explanation cap is also capped at one Student Profile, so the two are identical — which is precisely why it must be written down rather than left to be rediscovered as a bug.
    - *Owner:* the PM.
    - *Revisit condition:* before any multi-profile tier is given a finite Explanation cap.

## 13. Assumptions Index

Every `[ASSUMPTION]` still live in this document, surfaced for explicit confirmation:

Listed in document order. These index numbers are working references, not stable identifiers.

1. **§4.1** — The shared-device pattern (family tablet) is the dominant usage mode; a student on their own phone is served by the same PIN mechanism.
2. **§4.1 / FR-1** — One timezone per Parent Account, captured at registration from the signing-up device and editable in Settings, is sufficient for allowance period boundaries; no per-device or per-Student-Profile timezone is needed.
3. **§4.1 / FR-34** — 15 minutes is the right Parent View idle window: long enough to review a draft Practice Test without re-entering the PIN, short enough that a tablet left on the counter is not an open Parent View.
4. **§4.2 / FR-5** — 10 Page Images is a sufficient ceiling for a school exam.
5. **§4.2 / FR-8** — The legibility check is advisory and overridable rather than blocking.
6. **§4.3 / FR-10** — 5 Practice Tests is the right per-request generation cap.
7. **§4.4 / FR-14** — Recall/unrelease of a released Practice Test is not needed in v0.
8. **§4.4 / FR-15** — The timer defaults to off.
9. **§4.4 / FR-15** — The three pre-expiry warning thresholds are fixed at 5 minutes, 1 minute, and 20 seconds for every timer duration, rather than scaled to the configured duration (25% / 5%). *Revisit if parents routinely set durations far outside the 15–30 minute band.*
10. **§4.5 / FR-18** — A running timer tracks wall-clock across interruption and does not pause.

## 14. Deferred Decisions

Every `[NOTE FOR PM]` callout in this document. These are decisions made knowingly, each carrying a revisit condition rather than awaiting confirmation. They are distinct from §13, which indexes inferences that have not been confirmed, and from §12.2, which indexes questions still open.

- **§4.1 / FR-1** — Consent is account-scoped with no per-Student-Profile consent artifact, because consent is taken before any Student Profile exists. *Revisit as part of the §12.2 item 1 legal review.*
- **§4.2 / FR-8** — No latency bound is committed for the pre-generation legibility check. *Revisit once a measured figure exists.*
- **§4.7 / FR-26a** — Topic normalization is the highest-risk requirement in the build; the matching mechanism is unresolved. *Revisit at architecture.*
- **§4.7 / FR-26a — RESOLVED, 2026-09-22.** No operator capability curated the canonical Topic set. Closed by FR-40 (Admin Topic curation), following architecture spine AD-12.
- **§4.8 / FR-30a** — Thin Admin authentication, no roles, no audit logging. *Revisit before any third-party operator exists.*
- **§9.2** — No notifications. *Revisit post-launch; email infrastructure already exists for password reset.*
- **§9.2** — No AI provider abstraction. *Revisit if AI spend becomes material.*
