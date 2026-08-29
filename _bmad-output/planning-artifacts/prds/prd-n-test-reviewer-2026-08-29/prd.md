---
title: n-test-reviewer
status: final
created: 2026-08-29
updated: 2026-08-29
---

# PRD: n-test-reviewer
*Working title — confirm.*

## 0. Document Purpose

This PRD defines version 0 of **n-test-reviewer**, a mobile-first web app that turns a photographed school test into AI-generated practice tests a student can take, self-check, and have explained. It is written for the PM, the downstream architecture and UX workflows, and the implementing developer. Structure: vocabulary is fixed in §3 Glossary and used verbatim everywhere else; features are grouped in §4 with globally numbered functional requirements (FR-N) nested under them; cross-cutting quality lives in §10; assumptions are tagged inline as `[ASSUMPTION]` and indexed in §13.

No prior UX doc, product brief, or research artifact exists. This PRD is the first planning artifact for the product, produced Fast path from a stakeholder brain dump and successive rounds of decision-making. Every question raised in drafting has been resolved and recorded in §12.1; the inferences that remain unconfirmed are indexed in §13 and are the intended review surface. §6 records an inherited technical constraint that bounds the downstream architecture workflow.

## 1. Vision

Kids study for tests by re-reading the test they already took. That is the worst possible study material — they remember the answers, not the topic. Meanwhile the highest-signal artifact about what a child is about to be tested on is sitting in their backpack: the last exam, on the same unit, from the same teacher, in the same format.

**n-test-reviewer** takes photos of that paper and turns it into fresh practice, as many rounds as the family needs. A parent snaps the pages of a returned or upcoming-unit test, picks the Subject and Grade Level, and the app reads the paper, understands what it was testing and how it asked, and generates a new Practice Test on the same topics in the same question formats — multiple choice, fill-in-the-blank, and short answer, mixed to match the source. The student takes it in the app like a real test, optionally on a timer. At the end, answers are revealed with a score, and any question can be expanded into a plain-language explanation of *why* the answer is what it is.

The parent stays in control and in the loop: only the parent uploads, only the parent releases a Practice Test to the student, and behind a PIN the parent sees every result, per-topic mastery, and where the child is actually weak — not just a score. Version 0 is deliberately one family, one flow, done well: photo in, practice out, mastery visible.

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
  Maria, working mom of a Grade 5 student, gets home Friday with a returned Math test covered in red pen. Already signed in on her phone from a prior session. She opens n-test-reviewer, taps **Upload Test**, selects the student profile "Noah," picks Subject *Math* and Grade Level *5*, and photographs all three pages in sequence — the app shows each captured page as a thumbnail she can reorder or retake. She taps **Generate**, chooses 2 Practice Tests, and waits through a progress state. When generation finishes she gets a review screen: 15 questions per test, each tagged with a topic like *equivalent fractions*, in the same mix of formats as the source. Two questions are garbage — one references a diagram that was never uploaded — so she deletes them and fixes a typo in a third. She taps **Release to Noah**. **Climax:** the two Practice Tests appear on Noah's home screen as unstarted cards. **Resolution:** Maria is done in under five minutes and did not write a single question. **Edge case:** if a page photo is too blurry to read, the app flags that specific page before generation and asks her to retake just that page, not all three.

- **UJ-2. Noah takes a practice test and finds out he doesn't understand remainders.**
  Noah, 10, opens the app on the family tablet on Sunday. No login — the app is already in Student Mode on his profile. His home screen shows two unstarted Practice Test cards for Math. He taps the first. A timer is on (Maria left the default), 20 minutes, counting down at the top. He answers 15 questions one at a time — some multiple choice, some fill-in-the-blank, two short answer he types out. He taps **Submit**. **Climax:** the results screen appears immediately: 11/15, with every question listed, his answer, the correct answer, and a green or red mark. On question 7 — a division-with-remainder word problem he got wrong — he taps **Explain this**. A short, plain-language explanation appears: what the question was really asking, why his answer was wrong, and how to get the right one. **Resolution:** he taps **Retake** and does the same test again, then a fresh variant. **Edge case:** if his typed short answer was semantically right but worded differently ("one half" vs "1/2"), the AI marks it correct; if he disagrees with a mark, he can flag it, and the flag surfaces to Maria in the parent view.

- **UJ-3. Maria checks the damage behind the PIN.**
  Sunday night, Maria opens the app on the tablet Noah just used. She taps the profile icon, then **Parent View**, and enters her 4-digit PIN. **Climax:** a dashboard shows Noah's Math mastery by topic — *equivalent fractions 90%*, *division with remainders 40%*, flagged in red as a weak area — plus a trend line over his last several Practice Tests and a list of his most-missed topics across subjects. She drills into the division topic and sees the three specific questions he missed and the answers he gave. **Resolution:** she now knows exactly what to sit down with him about, and taps **Generate more** to make another Practice Test weighted toward that topic. **Edge case:** three wrong PIN entries lock Parent View for a cool-down period so a curious 10-year-old cannot brute-force it.

- **UJ-4. Admin adds a subject before the school year.**
  The Admin signs into the admin surface and adds Subject *Science* for Grade Levels 4 through 6, so parents in those grades can select it at upload time. Existing Practice Tests are unaffected.

## 3. Glossary

Downstream workflows and readers must use these terms exactly.

- **Parent Account** — The only credentialed account in the system (email + password). Owns one or more Student Profiles, one Parent PIN, all Source Tests, and all consent. Carries exactly one Account Tier. Cardinality: 1 Parent Account → 1..N Student Profiles.
- **Account Tier** — An Admin-assigned label on a Parent Account that determines its Student Profile limit and its monthly Upload Allowance and Generation Allowance. One of: **Free**, **Plus**, **Family**, **Internal**. Carries no payment or billing meaning in v0.
- **Upload Allowance** / **Generation Allowance** — The Account Tier's monthly limits on Source Test uploads and Practice Test generations respectively, counted separately. Reset on a fixed monthly boundary.
- **Student Profile** — A named child under a Parent Account, carrying a Grade Level and all of that child's Practice Test history and Mastery data. Has no credentials and cannot sign in independently.
- **Admin** — A service operator account, outside any Parent Account, who configures the Subject and Grade Level taxonomy. Not a family role.
- **Parent PIN** — A short numeric code set by the Parent Account that gates entry into Parent View from a device already in Student Mode.
- **Student Mode** — The default app state on a device: shows only one Student Profile's Practice Tests, results, and explanations. No upload, no generation, no analytics.
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
- **Grade** (verb/noun) — The correct/incorrect determination for one answered Question within an Attempt. Multiple Choice is deterministic; Fill-in-the-Blank and Short Answer are AI-graded.
- **Explanation** — On-demand plain-language text explaining what a Question asked, why the correct answer is correct, and where a given wrong answer went wrong. Every Explanation shown to a student is retained and readable by the parent.
- **Topic** — A short subject-matter tag attached to each Question (e.g. *division with remainders*), the unit of Mastery tracking.
- **Mastery** — A Student Profile's rolling percentage of correctly answered Questions for a given Topic, across Attempts.
- **Weak Area** — A Topic whose Mastery falls below a configured threshold, surfaced prominently in Analytics.
- **Analytics** — The Parent View surface presenting Mastery by Topic, trends over time, and Weak Areas for a Student Profile.

## 4. Features

### 4.1 Accounts, Profiles, and Mode Switching

**Description:** One credentialed Parent Account owns everything. The parent signs up with email and password, sets a Parent PIN, and creates one Student Profile per child with a name and Grade Level. A device sits in Student Mode by default, bound to one Student Profile; entering Parent View requires the Parent PIN. This keeps the family on a single shared device (the common case — a family tablet) without giving a child access to upload, generation, or analytics, and without the friction of a second set of credentials a 10-year-old would forget. Realizes UJ-2, UJ-3. `[ASSUMPTION: the shared-device pattern is the dominant usage mode; a student on their own phone is served by the same mechanism with the parent entering the PIN when needed.]`

**Functional Requirements:**

#### FR-1: Parent Account sign-up and sign-in

A prospective parent can create a Parent Account with an email address and password, and sign in on any device.

**Consequences (testable):**
- Sign-up requires a verified-format email, a password meeting a stated minimum strength, and acceptance of the terms and the child-data consent notice (see FR-30).
- Duplicate email sign-up is rejected with a message that does not reveal whether the account exists beyond standard reset flows.
- A signed-in session persists across app launches until explicit sign-out.
- Password reset is available via emailed link.

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
- On a device with more than one Student Profile, exiting Parent View prompts which Student Profile the device should bind to.
- In Student Mode, no upload, generation, release, cross-profile data, or Analytics surface is reachable — not by navigation, not by direct URL.
- In Student Mode, the only path out is the PIN prompt.

**Out of Scope:**
- Per-Student-Profile PINs or student credentials.

### 4.2 Source Test Upload

**Description:** The parent, and only the parent, uploads. From Parent View they choose a Student Profile, a Subject, and a Grade Level, then capture or select multiple Page Images — one per physical page, since a school exam is routinely two to four pages. Captured pages appear as an ordered, reorderable thumbnail strip; any page can be retaken or removed before submission. Legibility is checked before generation so the parent fixes a bad page while the paper is still in front of them, not after a failed generation. Realizes UJ-1.

**Functional Requirements:**

#### FR-5: Multi-page capture and library selection

A parent can add multiple Page Images to a single Source Test, using the device camera or the device photo library.

**Consequences (testable):**
- A Source Test accepts 1 to 10 Page Images. `[ASSUMPTION: 10 pages covers the realistic ceiling for a primary/secondary school exam.]`
- Pages are captured or selected one at a time and appended in order.
- Both camera capture and library multi-select are available on mobile web.
- Supported formats include JPEG, PNG, WebP, and HEIC/HEIF. Format is determined by inspecting the file's bytes, not by trusting the client-declared type.
- HEIC/HEIF — the iPhone camera default — is converted server-side before any AI processing.
- EXIF orientation is honored, so a page photographed in portrait is not read sideways.

#### FR-6: Page ordering and correction

A parent can reorder, retake, and delete individual Page Images before submitting a Source Test.

**Consequences (testable):**
- Page order is explicit and displayed as numbered thumbnails.
- Deleting a page renumbers the remainder without reprocessing the others.
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
- A page failing the check is identified individually, with a retake action scoped to that page.
- The check reports per-page readability confidence rather than a single pass/fail for the whole Source Test.
- The parent may override the warning and proceed. `[ASSUMPTION: overriding is allowed rather than blocking — the check is advisory, since false positives on a legible-but-shadowed page would be worse than a mediocre generation.]`
- The check completes fast enough to feel like part of capture rather than a second wait.

### 4.3 Extraction and Practice Test Generation

**Description:** On submission the system reads the Source Test's Page Images and produces an Extraction: what the paper tested, in what Question Formats, on what Topics. From that Extraction it generates one or more Practice Tests of new Questions — same topics, same format mix, same difficulty band, not the same questions. The parent chooses how many Practice Tests to generate in one go, because "give me three so he can do one a night" is the actual behavior. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-9: Extraction from Page Images

The system produces a structured Extraction from a submitted Source Test, capturing its Questions, Question Formats, and Topics.

**Consequences (testable):**
- Extraction spans all Page Images of the Source Test as a single document, in page order.
- Context spanning pages is preserved: a reading passage or data table on one page is associated with the questions that reference it on subsequent pages, and generation reproduces that structure rather than emitting orphaned questions. Realizes UJ-1.
- Each extracted question is classified into exactly one of the three Question Formats.
- Each extracted question carries at least one Topic.
- Content the system cannot interpret (an un-photographed diagram, a handwriting-only region) is recorded as uninterpretable rather than guessed at, and questions depending on it are excluded from being used as a generation basis.
- Extraction is persisted and reused for subsequent generations from the same Source Test, so regeneration does not re-read Page Images and continues to work after the Page Images are deleted (§5.2).
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
- Each generated Practice Test contains a configurable number of Questions, defaulting to a count derived from the Source Test's own question count.
- Generated Questions cover the Extraction's Topics and reproduce its Question Format mix proportionally.
- Multiple Practice Tests from the same Source Test are materially different from each other, not reorderings of one set.
- No generated Question is a verbatim copy of a Source Test question.
- Each generated Question carries its correct answer, its Topic(s), and, for Multiple Choice, plausible distractors.
- Generation runs asynchronously with a visible progress state; the parent can leave the screen and return.
- Generation failure leaves the Source Test intact and retryable without re-uploading photos.

#### FR-11: Weighted regeneration from a Weak Area

A parent can generate additional Practice Tests weighted toward a specific Topic from Analytics.

**Consequences (testable):**
- Generation initiated from a Topic in Analytics produces Questions predominantly on that Topic. Realizes UJ-3.
- The originating Source Test is reused; no new upload is required.

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
- Deleting Questions is allowed down to a minimum of 1 remaining Question; deleting the last one discards the Practice Test.
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
- When enabled, the remaining time is visible to the student throughout the Attempt.
- On timer expiry the Attempt auto-submits with unanswered Questions graded incorrect.

### 4.5 Taking a Practice Test

**Description:** In Student Mode the child sees their released Practice Tests as cards and taps one to start. Questions are presented one at a time with the input matching the Question Format — options for Multiple Choice, a blank field for Fill-in-the-Blank, a free text field for Short Answer. Answers are never revealed mid-test; the point is to simulate the real exam. Realizes UJ-2.

**Functional Requirements:**

#### FR-16: Practice Test list in Student Mode

A student can see their *released* and *completed* Practice Tests, grouped and labeled by Subject and state.

**Consequences (testable):**
- Only Practice Tests belonging to the bound Student Profile are listed.
- Unstarted, in-progress, and completed states are visually distinguishable.

#### FR-17: Answering Questions by format

A student can answer each Question using the input control appropriate to its Question Format.

**Consequences (testable):**
- Multiple Choice renders selectable options with exactly one selectable at a time.
- Fill-in-the-Blank renders the question text with an inline input at the blank position.
- Short Answer renders a multi-line free text field.
- A student can navigate backward and forward within a Practice Test and change answers before submitting.
- No correctness feedback of any kind is shown before submission.

#### FR-18: Attempt persistence

An in-progress Attempt survives app backgrounding, refresh, and device sleep.

**Consequences (testable):**
- Answers entered are retained on return to the Practice Test.
- A running timer continues to reflect elapsed real time across interruption. `[ASSUMPTION: wall-clock, not paused — matching real exam conditions.]`

#### FR-19: Submission

A student can submit an Attempt, which grades it and transitions the Practice Test to *completed*.

**Consequences (testable):**
- Submission with unanswered Questions is allowed after an explicit confirmation naming the unanswered count.
- Submission is irreversible for that Attempt.

#### FR-20: Retake

A student can retake a *completed* Practice Test, producing a new Attempt.

**Consequences (testable):**
- Each retake creates a distinct Attempt; prior Attempts remain in history.
- Question order may be shuffled on retake; Question content is unchanged.
- Retake Attempts are scored and visible to student and parent, but do not contribute to Mastery (FR-26) — a student cannot raise their Mastery by redoing the same Practice Test until it is correct.

### 4.6 Grading, Answer Reveal, and Explanations

**Description:** On submission the student immediately gets a score and a full answer key: every Question with their answer, the correct answer, and a correct/incorrect mark. Multiple Choice grades deterministically. Fill-in-the-Blank and Short Answer are graded by the AI on meaning, not string equality — "1/2", "one half", and "a half" are all correct, and a 10-year-old should not lose a point to spelling on a math question. Any Question can be expanded into an on-demand Explanation, which is the actual studying mechanism: understanding why, not just seeing what. Realizes UJ-2.

**Functional Requirements:**

#### FR-21: Deterministic grading for Multiple Choice

The system grades Multiple Choice Questions by exact option match.

**Consequences (testable):**
- Grading is deterministic and identical across repeated Attempts with the same answer.
- No AI call is made for Multiple Choice grading.

#### FR-22: AI grading for Fill-in-the-Blank and Short Answer

The system grades Fill-in-the-Blank and Short Answer Questions on semantic equivalence to the correct answer.

**Consequences (testable):**
- Equivalent answers differing in spelling, casing, whitespace, notation, or phrasing are graded correct.
- Grading is scoped to the Question's subject matter — a math answer is not marked wrong for a spelling error in an accompanying word.
- Every AI-graded Question records both the grade and a short grading rationale, available to the parent in the results detail view.
- If AI grading is unavailable, the Attempt still submits and scores; affected Questions are marked *ungraded* and surfaced to the parent rather than defaulted to incorrect.

#### FR-23: Answer reveal

A student sees the full answer key immediately after submitting an Attempt.

**Consequences (testable):**
- The results screen shows the overall score, and per Question: the question, the student's answer, the correct answer, and the correct/incorrect mark.
- The answer key is reachable again later from Attempt history.

#### FR-24: On-demand Explanation

A student can request an Explanation for any Question on the results screen.

**Consequences (testable):**
- Explanation is generated on request via an explicit action per Question — not pre-generated for all Questions, and not shown unless asked for.
- Explanation covers what the Question asked, why the correct answer is correct, and — when the student answered incorrectly — where their specific answer went wrong.
- Explanation language is pitched to the Practice Test's Grade Level.
- A generated Explanation is cached and re-shown without regeneration on subsequent views of the same Question and answer.
- Explanation generation is never blocked by an Account Tier allowance (FR-31).

#### FR-24a: Explanation visibility to the parent

A parent can read every Explanation that has been shown to their student, and flag one as bad.

**Consequences (testable):**
- Every Explanation shown to a student is retained against its Question and Attempt and is readable in Parent View.
- A parent can flag an Explanation; flagged Explanations are visible to the Admin as a content-quality signal.
- Explanations are shown to the student without prior parent review; this FR is the after-the-fact accountability path (§5.1).

#### FR-25: Grade dispute flag

A student can flag a Question whose grade they believe is wrong, surfacing it to the parent.

**Consequences (testable):**
- Flagging is available on the results screen per Question and does not change the score.
- Flagged Questions appear in Parent View with the student's answer, the recorded grade, and the grading rationale.
- A parent can override the grade, which recomputes the Attempt score and the affected Topic's Mastery.

### 4.7 Analytics and Mastery

**Description:** Behind the PIN, the parent gets the thing a graded paper never gives them: which topics the child has and has not got, tracked across every Attempt. Each Question carries Topics, so every answer contributes to per-Topic Mastery. The dashboard leads with Weak Areas, shows mastery trend over time, and lets the parent drill from a Topic into the specific missed Questions — and from there straight into generating targeted practice. Realizes UJ-3.

**Functional Requirements:**

#### FR-26a: Topic normalization

The system maps each Topic emitted at generation onto a canonical Topic within its Subject before that Topic is used for Mastery.

**Consequences (testable):**
- Generation is not constrained to a fixed Topic list; the model emits whatever Topic best describes the Question.
- An emitted Topic that matches an existing canonical Topic for that Subject is attributed to it, so "equivalent fractions", "fraction equivalence", and "equivalent fraction" contribute to one Mastery value rather than three.
- An emitted Topic with no canonical match becomes a new canonical Topic for that Subject.
- Canonical Topics are scoped per Subject, and deliberately **not** per Grade Level — "fractions" is the same concept whether a Grade 3 or a Grade 6 paper raises it, and splitting by level would fragment Mastery for a family with children at different levels.
- Normalization is invisible to both parent and student; Analytics displays canonical Topics only.

**Notes:**
- `[NOTE FOR PM]` This is the highest-risk requirement in the PRD. Without it, Mastery fragments as history accumulates and the Analytics dashboard degrades into noise over a term — the failure is slow and invisible until it is bad. The matching mechanism is an architecture decision; the product requirement is that one concept yields one Mastery value.

#### FR-26: Per-Topic Mastery computation

The system maintains a Mastery value per Topic per Student Profile, derived from graded Questions across all Attempts.

**Consequences (testable):**
- Mastery is the proportion of correctly answered Questions carrying that Topic, computed over a rolling window of the Student Profile's **5 most recent qualifying Attempts that included that Topic**, all weighted equally.
- **Only the first Attempt on a given Practice Test qualifies.** Retake Attempts (FR-20) are recorded, scored, and shown in history, but do not contribute to Mastery — repeating the same Questions measures memory of those Questions, not command of the Topic. A fresh Practice Test generated from the same Source Test is a different Practice Test and its first Attempt qualifies normally.
- Attempts outside the window do not affect Mastery, so a child who has since learned a Topic is not permanently penalized by an early attempt.
- A Topic with fewer than 5 qualifying Attempts computes Mastery over however many exist.
- Questions marked *ungraded* (FR-22) are excluded from Mastery.
- A parent grade override (FR-25) recomputes affected Mastery.

#### FR-27: Weak Area identification

The system identifies and surfaces Topics whose Mastery falls below a threshold as Weak Areas.

**Consequences (testable):**
- A Topic is a Weak Area when its Mastery is **below 60%** and the Student Profile has answered **at least 5 Questions** carrying that Topic.
- The 5-question floor prevents a single bad question from creating a false alarm.
- Weak Areas are displayed first on the Analytics dashboard and visually distinguished.
- Both the 60% threshold and the 5-question floor are system-level configuration, tunable post-launch; neither is a per-parent setting in v0.

#### FR-28: Analytics dashboard

A parent can view, per Student Profile, Mastery by Topic, score trend over time, and Weak Areas.

**Consequences (testable):**
- Mastery is presented per Topic, filterable by Subject.
- The dashboard leads with a per-Student-Profile activity summary — how many released Practice Tests are unstarted versus completed — so a parent can answer "did my child actually do it" without notifications (§9.2).
- Score trend covers completed Attempts over time.
- The dashboard is reachable only from Parent View.
- With no completed Attempts, the dashboard shows a meaningful empty state rather than zeroed charts.

#### FR-29: Drill-down and act

A parent can drill from a Topic into the specific Questions the student missed on it, and initiate weighted generation from there.

**Consequences (testable):**
- Drill-down lists the missed Questions with the student's answers and the correct answers.
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
- Consumption is visible per account as uploads used / allowance and generations used / allowance.
- Explanations flagged by parents (FR-24a) are visible here as a content-quality signal.

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
- Parent Account deletion removes the account, every Student Profile under it, and all Source Tests, Page Images, Extractions, Practice Tests, Attempts, Explanations, and Mastery belonging to them.
- Every deletion action requires an explicit confirmation naming what will be destroyed and stating that it cannot be undone.
- Deletion of a Student Profile or Parent Account requires the account password, not the Parent PIN — the PIN gates a mode, not a destructive action.
- Deletion completes without leaving orphaned stored files.

**Feature-specific NFRs:**
- Deletion must propagate to stored image bytes and derived records together; a partial deletion that leaves image bytes behind fails this requirement.

## 5. Constraints and Guardrails

### 5.1 Safety

- Every AI-generated Question and every AI-generated Explanation is child-directed content. Generation must be constrained to the Source Test's academic subject matter, and the parent review gate (FR-12 through FR-14) is the required human check before any generated Question reaches a student.
- Explanations (FR-24) are shown to the student without a parent gate, because an Explanation is bounded to explaining a Question the parent already reviewed and released. Accountability is after the fact rather than preventive: every Explanation is retained and readable by the parent, who can flag a bad one (FR-24a). This is a deliberate trade — pre-generating and reviewing every Explanation would multiply generation cost by question count for explanations most students never open, and would put a wall in front of a child mid-study-session.
- Uninterpretable Source Test content must not be hallucinated into Questions (FR-9).

### 5.2 Privacy

- The system processes photographs of children's schoolwork and stores per-child performance data. Both are sensitive.
- Page Images and student performance data are scoped to the owning Parent Account and never surfaced across accounts.
- Sign-up requires explicit parental consent to process the child's data (FR-1). Parent-provided consent at sign-up is the build posture, on the basis that no child ever holds an account or supplies data directly. **Legal review of this posture is a launch gate**: it blocks opening public registration, not development. Until it clears, registration stays closed or invitation-only.
- **Page Images are deleted 90 days after upload.** The window covers a school term's regeneration needs. Because the Extraction is persisted separately (FR-9), regeneration continues to work after the photos are gone, so deletion costs the parent nothing functional.
- Deletion is automatic and does not require a parent action; a parent may also delete a Source Test's Page Images earlier.
- A parent can delete a Student Profile's data and can delete the Parent Account and all associated data.
- Third-party AI processing of Page Images must be under terms that exclude the content from provider model training.

### 5.3 Cost and Account Tiers

Every upload, generation, AI grade, and Explanation is a paid model call, and v0 has no revenue. Unbounded usage is the primary cost risk, and **Source Test upload is the single most expensive operation** — a vision call over up to 10 photographs — so it is capped on its own counter rather than folded into generation.

Cost is controlled by **Account Tier**. Tiers are Admin-assigned labels carrying limits; they carry **no payment, pricing, or billing meaning in v0** (monetization remains a non-goal, §8). The tier field exists so pricing can be attached later without a data model change.

| Account Tier | Student Profiles | Upload Allowance / month | Generation Allowance / month |
|---|---|---|---|
| **Free** | 1 | 2 | 2 |
| **Plus** | 2 | 8 | 20 |
| **Family** | 5 | 20 | 60 |
| **Internal** | unlimited | unlimited | unlimited |

**Internal** is Admin-assigned only, never reachable by sign-up, and exists for the operator, testers, and friends-and-family.

**Free is a taste, not a trial.** At 2 Practice Tests per month, a Free account will not accumulate enough answered Questions on any one Topic to cross the Weak Area floor (FR-27) or fill the Mastery window (FR-26) within a useful period. A Free account's Analytics dashboard showing an empty or near-empty state is **expected behavior, not a defect** — Analytics is a Plus-and-above capability in practice. This is a deliberate position: Free demonstrates the core loop (photo in, practice out, answers and explanations), and Plus is the real entry point for the parent-facing value. Do not "fix" the empty Free dashboard by lowering the FR-27 floor; that would trade a truthful empty state for untrustworthy Weak Area calls.

#### FR-31: Account Tier enforcement

The system assigns every Parent Account an Account Tier and enforces its Student Profile limit, Upload Allowance, and Generation Allowance.

**Consequences (testable):**
- A newly registered Parent Account is assigned the **Free** tier.
- Only an Admin can change an account's Account Tier; there is no self-serve upgrade path in v0.
- Upload Allowance and Generation Allowance are tracked on **separate counters** and enforced independently — exhausting one does not affect the other.
- **An allowance is consumed on successful production of the artifact, never on request.** A Source Test that fails the legibility check and is abandoned, an Extraction that fails, and a generation that errors all consume nothing. One successful Source Test upload consumes one Upload Allowance; each Practice Test that reaches *draft* consumes one Generation Allowance. A parent who discards a draft (FR-14) does not get the allowance back — it was spent producing it.
- Both allowances reset on the **calendar month** boundary, identical for all accounts and independent of sign-up date.
- Reaching an allowance **hard-blocks** the operation. The message names the tier, the usage against the limit, and the reset date (e.g. "You've used 2 of 2 practice tests this month on the Free tier. Resets 1 October."). A generic error or silent failure fails this requirement.
- The Student Profile limit is enforced at profile creation (FR-3). Reducing an account's tier below its current profile count does not delete profiles; it blocks creating more.
- **AI grading (FR-22) and Explanations (FR-24) are never blocked by an allowance.** Both are downstream of a Practice Test that was already counted against the Generation Allowance, so they are transitively bounded. A student must never hit a wall mid-study-session.
- Admin can view per-account consumption against allowances. `[ASSUMPTION: a minimal operator view is enough for v0; no parent-facing metering beyond the at-cap message.]`

## 6. Platform and Information Architecture

**Platform:** Mobile-first responsive web application. Single codebase, no app store, camera access via the browser. Must be usable on a phone held one-handed in a kitchen and on a family tablet. Desktop is supported but not optimized. Native apps are explicitly v2+.

**Inherited technical constraint.** This product is built on the same stack as the sibling `n-electric` project, and reuses its OpenAI client configuration directly (see addendum). This is a decided constraint, not an open architecture choice: Turborepo with pnpm workspaces, NestJS + Prisma + PostgreSQL on the API, Next.js + React + MUI on the web, JWT with argon2 hashing, local-filesystem storage, Playwright for E2E, Docker Compose in development. Two requirements are satisfied for free by the inheritance — argon2 covers the password and Parent PIN hashing in §10, and the existing local-filesystem storage covers Page Image storage and its 90-day deletion (§5.2). This is recorded here because it bounds the architecture workflow's decision space; the PRD otherwise stays at capability level.

**Surfaces:**

- **Student Mode** — Home (Practice Test cards) → Take Test → Results (answer key, Explanations, flag).
- **Parent View** (PIN-gated) — Dashboard/Analytics → Topic drill-down; Upload → Classify → Capture pages → Generate → Review draft → Release; Students (profile management); Settings (PIN, account, data deletion).
- **Admin** — Separate surface: Subjects, Grade Levels, Parent Accounts and Account Tier assignment, per-account consumption, flagged Explanations.

## 7. Aesthetic and Tone

- **Student-facing:** calm and low-stakes. A practice test that looks like a real test is the point, but a wrong answer must never read as punishment. Explanations use encouraging, plain, grade-appropriate language — no condescension, no exclamation-mark cheerleading.
- **Parent-facing:** dense and factual. A parent scanning Analytics for 30 seconds should leave knowing exactly what to work on. Weak Areas are stated plainly, not softened.
- **Anti-reference:** gamified ed-tech — no streaks, badges, mascots, or points in v0.

## 8. Non-Goals (Explicit)

- **Not a classroom tool.** No teacher accounts, rosters, assignments, or school-level anything.
- **Not a curriculum or content library.** The app generates only from what a parent uploads. It does not ship a question bank and does not claim curriculum alignment.
- **Not a grading system of record.** Scores are practice signal, never a substitute for a teacher's grade.
- **Not a tutor.** Explanations explain one question. There is no conversational back-and-forth, no follow-up questions, no chat.
- **Not gamified.** No streaks, points, leaderboards, or rewards.
- **Not a document scanner.** The app reads test papers; it is not a general OCR or PDF tool. PDF upload is out of v0.
- **Not multi-parent.** One Parent Account per family in v0; no co-parent sharing.

## 9. MVP Scope

### 9.1 In Scope

- Parent Account with email/password auth; Parent PIN; multiple Student Profiles; Student Mode / Parent View switching.
- Account Tiers (Free / Plus / Family / Internal) with separate Upload and Generation Allowances and a Student Profile limit; Admin assignment; hard block at cap with a message naming tier, usage, and reset date.
- Multi-page photo upload (1–10 pages) with reorder, retake, delete, and pre-generation legibility check.
- Subject + Grade Level classification of a Source Test from the Admin taxonomy.
- Extraction of the Source Test — including cross-page context such as a reading passage shared by later questions — persisted for reuse, with a thin-Extraction warning before generation.
- Generation of 1–5 Practice Tests per request, bounded by the tier's remaining Generation Allowance.
- Weighted regeneration targeting a Weak Area Topic.
- Parent review of *draft* Practice Tests with per-Question edit and delete; release or discard.
- Optional per-Practice-Test countdown timer, default off.
- All three Question Formats: Multiple Choice, Fill-in-the-Blank, Short Answer.
- Taking a Practice Test in Student Mode with back/forward navigation and no mid-test feedback; attempt persistence across interruption.
- Retake producing a new Attempt.
- Deterministic Multiple Choice grading; AI semantic grading for Fill-in-the-Blank and Short Answer.
- Immediate answer reveal with full answer key; on-demand cached Explanation per Question, retained and readable by the parent with a bad-Explanation flag; student grade-dispute flag with parent override.
- Topic-tagged Questions with normalization onto a per-Subject canonical set; per-Topic Mastery over a rolling 5-Attempt window; Weak Area detection at <60% Mastery with a 5-question floor; Analytics dashboard with unstarted/completed activity summary, trend, and drill-down.
- Admin management of Subjects and Grade Levels; Account Tier assignment; per-account consumption view; flagged-Explanation review.
- Automatic Page Image expiry 90 days after upload (FR-32); parent-initiated early image deletion, Student Profile deletion, and full Parent Account deletion (FR-33).

### 9.2 Out of Scope for MVP

- **Notifications** of any kind — no push, no email on student completion. Deferred to v1. The Analytics dashboard's unstarted/completed summary (FR-28) is the v0 answer to "did my child do it", and it requires the parent to open the app. `[NOTE FOR PM: still the most likely first post-launch request; email infrastructure already exists for password reset (FR-1), so the incremental cost of adding it later is small.]`
- **Native mobile apps** — v2+.
- **PDF or scanned-document upload** — photos only.
- **Handwriting recognition of the student's own written answers on the Source Test** — the app reads the questions, not the child's marks.
- **Teacher/school accounts, rosters, sharing between families** — see §8.
- **Monetization, billing, payment** — v0 has no revenue. Account Tiers exist and are enforced, but carry no price and no self-serve upgrade; an Admin assigns them by hand.
- **AI provider abstraction** — v0 depends directly on OpenAI with no swappable provider interface, reusing the client configuration already proven in the sibling `n-electric` project (see addendum). `[NOTE FOR PM: a deliberate speed-over-insurance trade, made cheaper by the fact that a working configuration already exists to copy. A provider price change, terms change, or sustained outage means a real refactor across Extraction, generation, grading, and Explanations — the four most load-bearing paths in the product. Revisit if the AI spend becomes material.]`
- **Co-parent / multi-adult accounts.**
- **Offline test-taking** — network required.
- **Localization** — English only.
- **Recall of a released Practice Test** (FR-14) — parent discards and regenerates instead.
- **Conversational follow-up on an Explanation** — see §8.
- **Parent-authored questions from scratch** without a Source Test.
- **Per-family Weak Area threshold configuration** — system-level only.

## 10. Cross-Cutting NFRs

- **Performance.** Student Mode interactions (question navigation, submission, results render) feel instant on a mid-range tablet over home wifi. Generation is explicitly asynchronous with progress feedback; a parent should be able to leave and return. Explanation generation is a foreground wait and must stay short enough not to break a study session.
- **Reliability.** No AI failure loses student work: an in-progress Attempt survives interruption (FR-18), a failed generation is retryable without re-upload (FR-10), and unavailable AI grading degrades to *ungraded* rather than to *wrong* (FR-22).
- **Security.** Passwords and Parent PINs stored hashed. All traffic over TLS. Authorization enforced server-side per Parent Account for every Page Image, Practice Test, Attempt, and Analytics query — Student Mode restrictions are not client-side-only (FR-4).
- **Accessibility.** Target WCAG 2.1 AA for student-facing surfaces: sufficient contrast, adequate tap targets for a child's hands, screen-reader-labeled inputs, and correct/incorrect state never conveyed by color alone.
- **Observability.** Generation, Extraction, grading, and Explanation calls are logged with outcome, latency, and cost attribution per Parent Account, sufficient to answer "why was this test bad" and "what did this family cost."
- **Data lifecycle.** Deletion requests (§5.2) propagate to Page Images, Extractions, Practice Tests, Attempts, and Mastery.

## 11. Success Metrics

Each SM cross-references the FR(s) it validates. **The targets are initial hypotheses, not derived commitments** — set pre-launch with no baseline, no comparable product, and no usage data. Recalibrate them after a month of real accounts, the same standing the tier values carry (§12.2). What is load-bearing here is *which* things are measured and which are named as counter-metrics; the numbers themselves are placeholders that should be argued with once there is evidence.

**Primary**
- **SM-1: Upload-to-release completion.** Share of started Source Test uploads that reach a released Practice Test. Target: ≥80%. Validates FR-5 through FR-14 — if parents abandon mid-flow, the core loop is broken.
- **SM-2: Practice Test completion rate.** Share of released Practice Tests with at least one completed Attempt within 7 days. Target: ≥70%. Validates FR-16 through FR-19 — the parent's effort must convert into the student actually practicing.
- **SM-3: Repeat family usage.** Share of Parent Accounts that upload a second Source Test within 30 days of the first. Target: ≥50%. Validates the product thesis end to end.

**Secondary**
- **SM-4: Explanation engagement.** Share of completed Attempts in which at least one Explanation is requested. Target: ≥40%. Validates FR-24 — the differentiator over a plain quiz generator.
- **SM-5: Parent edit rate on draft Practice Tests.** Share of Questions edited or deleted at review. Target: ≤10%, tracked as a generation-quality signal. Validates FR-9 through FR-13.
- **SM-6: Grade dispute rate.** Share of AI-graded Questions flagged by students, and share of flags the parent upholds. Target: upheld flags ≤3% of AI-graded Questions. Validates FR-22.

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
| 3 | Explanations shown unreviewed | Ship ungated; retain every Explanation and make it readable and flaggable by the parent | §5.1, FR-24a |
| 4 | Mastery weighting | Rolling window of the 5 most recent Attempts per Topic, equal weight — no decay constant guessed at with zero data | FR-26 |
| 5 | Weak Area threshold | Below 60% Mastery with a 5-question floor; both system config | FR-27 |
| 6 | Topic taxonomy | Free-form emission at generation plus normalization onto a per-Subject canonical set | FR-26a |
| 7 | Usage caps | Replaced by **Account Tiers** — Free / Plus / Family / Internal, separate Upload and Generation Allowances | §5.3, FR-31, FR-30a |
| 8 | AI provider | **Hard OpenAI dependency**, no abstraction layer — speed over insurance, risk accepted | §9.2 |
| 9 | Thin Extraction | Warn with the usable-question count and let the parent proceed or retake; never hard-block | FR-9a |
| 10 | Cross-page context | Extraction treats all Page Images as one ordered document; shared reading passages supported in v0 | FR-9 |
| 11 | "Did my kid do it" | No notifications; dashboard leads with unstarted vs completed counts | FR-28, §9.2 |

### 12.2 Remaining

1. **Legal review of the COPPA posture** (from Q1). Owner: the builder. Revisit condition: before public registration opens. Until it clears, registration is closed or invitation-only.
2. **Topic normalization mechanism** (from Q6). FR-26a fixes the product requirement — one concept, one Mastery value — but the matching approach is an open architecture decision and the highest-risk item in the build.
3. **Tier values and Success Metric targets are guesses.** The Free / Plus / Family numbers and every target in §11 were set without usage data. Revisit condition: after the first month of real accounts.
4. **Practice Test question count default.** FR-10 derives it from the Source Test's own question count; the exact derivation is unspecified.
5. **Extraction timeout.** The reused `n-electric` OpenAI client sets a 30-second call timeout tuned for a single-image call. Extraction over up to 10 Page Images will exceed it, so Extraction needs either a per-call override or chunking. The one inherited default that does not transfer cleanly — see addendum.

## 13. Assumptions Index

Every `[ASSUMPTION]` still live in this document, surfaced for explicit confirmation:

1. **§4.1** — The shared-device pattern (family tablet) is the dominant usage mode; a student on their own phone is served by the same PIN mechanism.
2. **§4.2 / FR-5** — 10 Page Images is a sufficient ceiling for a school exam.
3. **§4.2 / FR-8** — The legibility check is advisory and overridable rather than blocking.
4. **§4.3 / FR-10** — 5 Practice Tests is the right per-request generation cap.
5. **§4.4 / FR-14** — Recall/unrelease of a released Practice Test is not needed in v0.
6. **§4.4 / FR-15** — The timer defaults to off.
7. **§4.5 / FR-18** — A running timer tracks wall-clock across interruption and does not pause.
8. **§5.3 / FR-31** — A minimal Admin consumption view is enough for v0; no parent-facing metering beyond the at-cap message.

*Retired by the §12.1 decisions: the earlier assumptions on Mastery weighting, COPPA posture, Page Image retention, and unreviewed Explanations are now stated requirements, not inferences.*

**Deferred, not assumed.** These four `[NOTE FOR PM]` callouts are decisions made knowingly, each carrying a revisit condition rather than awaiting confirmation:

- **§4.8 / FR-30** — Thin Admin authentication, no roles, no audit logging. *Revisit before any third-party operator exists.*
- **§4.7 / FR-26a** — Topic normalization is the highest-risk requirement in the build; the matching mechanism is unresolved. *Revisit at architecture.*
- **§9.2** — No notifications. *Revisit post-launch; email infrastructure already exists for password reset.*
- **§9.2** — No AI provider abstraction. *Revisit if AI spend becomes material.*
