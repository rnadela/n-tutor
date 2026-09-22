# Glossary

Reserved vocabulary. Downstream work must use these terms exactly — a synonym for any of them is a defect, not a style choice.

- **Parent Account** — the only credentialed account (email + password). Owns 1..N Student Profiles, one Parent PIN, all Source Tests, one Account Tier, one timezone.
- **Account Tier** — Admin-assigned label (Free / Plus / Family / Internal) setting the Student Profile limit and the three monthly allowances. No payment meaning in v0.
- **Upload Allowance / Generation Allowance / Explanation Allowance** — three separately tracked monthly counters. See `tiers.md`.
- **Student Profile** — a named child under a Parent Account. No credentials, cannot sign in independently.
- **Admin** — a service-operator account outside any Parent Account; configures Subject/Grade Level taxonomy and Account Tiers.
- **Parent PIN** — short numeric code gating entry into Parent View from a device in Student Mode. Gates a *mode*, never a destructive action (those require the account password).
- **Student Mode** — device default: one Student Profile's Practice Tests, results, Explanations only. No upload/generation/analytics.
- **Parent View** — PIN-gated state: upload, generation, review/release, results, Analytics across all profiles. Silently expires after 15 minutes idle.
- **Subject** / **Grade Level** — Admin-configured taxonomy; Subject availability is scoped per Grade Level.
- **Source Test** — the uploaded artifact: an ordered set of 1..N Page Images + Subject + Grade Level. 1 Source Test → 1..N Page Images → 1..N Practice Tests.
- **Page Image** — one photo of one physical page, ordered within its Source Test. Bytes deleted 90 days after upload.
- **Extraction** — the system's structured reading of a Source Test (Questions, Question Formats, Topics). Persisted, reused for regeneration, never a product surface.
- **Practice Test** — a generated set of Questions for one Student Profile, in one state: *draft* / *released* / *completed* / *discarded*.
- **Question** — one item: one Question Format, one correct answer, 1..N Topics, an Explanation available on demand.
- **Question Format** — Multiple Choice / Fill-in-the-Blank / Short Answer.
- **Attempt** — one student pass through one Practice Test; 1 Practice Test → 1..N Attempts (retakes).
- **Grade** — the per-Question determination within an Attempt. See the grade-state table below.
- **Explanation** — on-demand plain-language text for one Question. Every one shown to a student is retained and parent-readable; a parent can suppress it per FR-39 (see `tiers.md` for allowance interaction).
- **Topic** — a short subject-matter tag on a Question; the unit of Mastery. Normalized onto one canonical set per Subject (not per Grade Level).
- **Mastery** — a Student Profile's rolling correct-answer percentage for a Topic, over its 5 most recent qualifying Attempts.
- **Weak Area** — a Topic below 60% Mastery with ≥5 answered Questions.
- **Analytics** — the Parent View surface: Mastery by Topic, trends, Weak Areas.

## The four grade states

Single authoritative table. Every other reference to grade behavior points here.

| State | Written when | In score | In Mastery | Counts toward Weak Area floor | Display |
|---|---|---|---|---|---|
| **correct** | Student answered, graded correct (deterministic MC / AI semantic for the other two formats) | Yes, earns credit | Yes, both terms | Yes | `Correct` |
| **incorrect** | Student answered and graded wrong; **or** any blank on an Attempt that auto-submitted on timer expiry | Yes, no credit | Yes, denominator only | Yes | `Not correct` |
| **unanswered** | Student left it blank on a **manually submitted** Attempt (timed or untimed) — never written by an expired timer | Yes, no credit (a blank costs the mark) | **No** | **No** | Correct answer shown, no student answer, never presented as a wrong answer |
| **ungraded** | AI grading was unavailable; retried the next time that Attempt's results screen opens | Excluded, with the excluded count and reason stated | No | No | `Not graded yet`, updates in place when resolved |

Score = `correct / all presented Questions`. Mastery = `correct / (correct + incorrect)` over the Topic's window — deliberately a different denominator; see the CAP-6 kernel entry.

## Fixed literal strings (never reworded, never translated per-surface)

- Grade-state labels: `Correct`, `Not correct`, `Unanswered`, `Not graded yet`.
- In-test progress vocabulary (distinct from grade state): `Answered` / `Not answered`.
- Every other result/analytics string is parameterized and resolves address by surface: Student Mode = second person ("you"), Parent View = third person naming the child.
