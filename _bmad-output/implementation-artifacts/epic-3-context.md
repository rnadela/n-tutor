# Epic 3 Context: Source Test Capture, Upload & Extraction

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A parent digitizes a paper test: photograph or select its pages, classify it with one Subject and one Grade Level, confirm the pages are readable, and commit it. The system then extracts the paper into a persisted, structured document — questions with their formats, topics, fractions and figures — that becomes the reusable basis for every later Practice Test generation, including after the page photos expire. This epic is the product's entry point: everything downstream (generation, grading, explanations, mastery) is only as good as what lands here, so the emphasis is on honest extraction (never guessed content), a check that catches a bad capture while the paper is still in hand, and a stepper that never shows a parent work they cannot submit.

## Stories

- Story 3.1: Multi-Page Capture (camera + library)
- Story 3.2: Page Management Before Submit
- Story 3.3: Subject & Grade Level Assignment
- Story 3.4: Legibility Check & Upload Commit
- Story 3.5: Structured Extraction
- Story 3.6: Thin-Extraction Warning
- Story 3.7: Upload Stepper
- Story 3.8: Plain-Language Check Step & Upload Allowance Left
- Story 3.9: Figures in Extraction

## Requirements & Constraints

- **Page ceiling and mixing:** 1–10 page images per Source Test. Camera adds one at a time; photo-library multi-select adds all in one action. Both append in order and mix freely; the shot-vs-selected distinction is never surfaced. Library selection is a first-class path, not a fallback, and must be offered with guidance when camera access is unavailable or denied.
- **Format trust:** the page format is decided by byte inspection against an allowed set (jpeg, png, webp, heic, heif, avif), never from the client-declared type. HEIC/HEIF is converted server-side and EXIF orientation is honored before anything downstream reads the bytes.
- **Page management:** explicit, visible ordering before submit; delete renumbers remaining pages without reprocessing; submit is blocked at zero pages and blocked until both Subject and Grade Level are set.
- **Classification:** only Subjects an operator has enabled for the selected Grade Level are offered. Grade Level defaults from the selected Student Profile and is overridable per upload.
- **Legibility check:** runs once, as a single batch over all pages, immediately after capture finishes and never again. Reports per-page confidence rather than one pass/fail, names the failing page, and offers a retake scoped to that page alone. It is advisory — the parent may proceed — and it charges no allowance, because it produces nothing.
- **Allowance semantics:** Upload Allowance is charged against the Source Test on successful upload, not against pages and not when the parent taps proceed. Abandoning spends nothing; a failed upload or extraction spends nothing and may be retried without a second charge. The check step warns forward about the cost; it does not describe when a counter moves.
- **Allowance display:** the remaining figure and reset date are read from the parent allowances endpoint and never computed client-side. Unlimited plans state that in words with no figure. A failed read degrades to the cost sentence alone without breaking the step. After a successful continue the figure is re-read, never locally decremented. Being at cap routes to the existing at-cap behavior.
- **Extraction fidelity:** spans all pages as one document in page order, preserving cross-page context (a shared reading passage or data table binds to the questions that reference it on later pages). Every extracted question carries exactly one Question Format and at least one Topic. Anything uninterpretable is recorded as such, never guessed; questions that depend on it are not used as a generation basis. Extraction is persisted for reuse and is not a browsable product surface in v0.
- **Thin extraction:** when usable questions are low relative to pages, show both counts and offer proceed or retake. Never hard-blocks; retaking consumes no Generation Allowance.
- **Figures:** a legibly photographed shape or diagram a question needs is carried as a structured figure with a text alternative, never as prose describing it. A cropped, un-photographed or unreadable figure stays uninterpretable.
- **Copy:** no parent-facing string on the check step uses system vocabulary ("commit", "block"); everyday words describing what happens to the parent. "Upload allowance" is retained to match Settings. No hardcoded user-facing result strings.

## Technical Decisions

- **Ownership:** the `sourcetest` module owns Source Test and Page Image; `extraction` owns the extracted content on the Source Test; `allowance` is a policy module that owns nothing and derives counts. Cross-module access goes through the owning module's service — never another module's Prisma delegate.
- **Image ingest is a mandatory gate:** byte-sniff the format, EXIF-rotate, re-encode to JPEG q85, all on ingest, before the Page Image row leaves its `uploading` state, so no downstream vision call ever sees a format the model cannot read. Carry the known width-handling fix around auto-orient metadata.
- **Rows are the authority, not bytes:** insert the Page Image row before writing any byte, and derive the storage path from the row identifier — never from anything the client supplies (this is also the path-traversal control). Retention, orphan cleanup and deletion are one sweeper over rows, never a directory scan.
- **Uncommitted capture lifecycle:** a single 72-hour TTL from row creation, not extended by activity, covers both restorable in-progress capture and the orphan sweep — they are the same mechanism at two moments. Expiry deletes the row outright; nothing was charged, so no usage tombstone is written.
- **Allowances are derived, not decremented** — there is no counter column to keep in sync.
- **AI call classes:** Extraction is a queued job with status polling. The legibility check is a distinct, foreground, in-request call class with its own pinned model snapshot and its own cost rows, so its spend attributes separately from Extraction.
- **Confidence and validation:** every extraction schema field carries a self-assessed low/medium/high confidence, and prompts instruct the model to return null rather than guess — this is the mechanism behind both the uninterpretable rule and the legibility/thin-extraction signals. Deterministic post-hoc validation runs in code on every payload after schema validation, downgrading or rejecting.
- **Failure routing:** an unreadable or unusable *input* is a client fault — terminal, never retried, surfaced as a retake prompt. Provider timeouts, rate limits, refusals and outages are upstream faults — retried with backoff, then surfaced as a user-retryable transient failure. A schema or post-hoc validation failure counts as upstream (the input was fine; the model misbehaved). A figure that fails sanitization is a content fault on the same route.
- **Rich text is the one content primitive:** a discriminated union of `text`, `fraction` and `figure` segments. Fractions are structured, not plain strings, because a spoken alternative cannot be recovered from a glyph. A figure segment carries an SVG string plus a required non-empty text alternative, both required strings for strict structured-output compatibility.
- **SVG sanitizer is an allowlist parse, not a regex strip,** applied to every figure from every source (extraction, generation, edit) at parse-for-storage time. Permit only basic shape, path, group and text elements plus geometry and presentation attributes; drop scripts, event handlers, external references, embedded HTML, images and CSS. Require a root viewBox, strip root width/height, rewrite fill/stroke to the current colour or none (this is what keeps dark mode working), and cap size at 16 KB. Over-cap or no-drawable-content is a rejection.
- **Plain-text projection:** the rich-text-to-plain-text helper must emit a figure as its text alternative, so grading, dedupe, explanation and topic prompts keep working on text alone.
- **Defense in depth on render:** the web re-sanitizes with the same allowlist before drawing; neither side trusts the other. Both API and web sanitizers need unit tests against a malicious corpus (script, on* handlers, foreignObject, external href, javascript: URL, CSS url(), oversize).

## UX & Interaction Patterns

- **Upload stepper:** one screen, four steps — Details, Pages, Check, Generate. Only the current step's controls render. Details is complete only when a subject is chosen, so a grade level offering no subjects (or no grade levels at all) shows the classification controls and a message with no page controls beneath and Next disabled. Pages Next is disabled at zero pages. Back is free until commit; after commit the earlier steps are read-only and shown complete. Reopening an in-progress draft lands on the furthest step its saved state allows.
- **Continuous capture:** the viewfinder stays open across pages; captures accumulate in an ordered thumbnail strip below. Reorder, retake and delete act only on the strip afterwards, never inline in the viewfinder.
- **Camera chrome uses a dedicated inverted token set** (inverted background, primary-on-inverted, divider-on-inverted) used nowhere else. These values are deliberate duplicates of other tokens; they must never be aliased, collapsed or deduplicated by a tidying pass, and their contrast on the inverted ground is intentional.
- **Page thumbnail component:** visible ordinal plus an expired state rendered as a flat neutral tile captioned as a deleted photo — never a broken-image glyph or an error colour.
- **Accessibility:** focus moves to the new step's heading on each step change, and Back/Next are real buttons with accessible names. The capture strip is exposed as an ordered list naming each page's ordinal and legibility state. Icon-only capture-strip controls include the page ordinal in their accessible name. Every control is a real control — no div or span carries an action or state.
- **Figure rendering:** inline, at a responsive width with a max height, inheriting the text colour in both light and dark mode, exposed to assistive tech as a single image named by its text alternative (announced once).
- **Parent-facing surfaces use compact density and the parent accent;** no allowance figure, cost statement or tier label from this epic may ever be reachable from a student-scoped surface or endpoint.
- Install banner is not rendered on the camera capture view.

## Cross-Story Dependencies

- Stories 3.1–3.4 are sequential prerequisites: capture feeds page management, classification gates submit, and the legibility check is the commit point. Story 3.7's stepper is the container all four render inside, so it depends on their behavior rather than redefining it — its Check step is exactly Story 3.4.
- Story 3.8 extends 3.4/3.7's Check step and depends on the parent allowances read and on the at-cap enforcement behavior defined in the allowance epic (Story 9.3).
- Story 3.3 depends on operator-managed Subject and Grade Level taxonomy (Epic 2) and on Student Profile grade level (Epic 1).
- Story 3.5 depends on a committed Source Test from 3.4; Story 3.6 depends on 3.5's output and gates entry into generation (Epic 4, Story 4.1).
- Story 3.9 introduces the figure segment, the sanitizer and the web renderer that Epic 4's Story 4.8 reuses for generated questions — 4.8 must also stop the draft-edit path from round-tripping fields through plain text, which would silently drop figures. Epic 5's take/results/answer-key surfaces inherit figure rendering through the same shared component with no additional story.
- Extraction persistence is what lets regeneration keep working after page images expire under the retention epic (Epic 8); the uncommitted-capture TTL here is the same mechanism as that epic's sweep.
- Upload Allowance accounting here is consumed and surfaced by the allowance epic (Epic 9).
- Story 3.9 is flagged as requiring a security review of the sanitizer corpus before deploy.
