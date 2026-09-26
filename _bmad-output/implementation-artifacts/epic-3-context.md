# Epic 3 Context: Source Test Capture, Upload & Extraction

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give a parent standing over a returned paper test a path from physical pages to a reusable, structured Source Test: photograph or pick 1–10 pages, fix the bad ones, classify the test by Subject and Grade Level, get told before committing whether any page is unreadable, and have the system read the whole thing into a persisted Extraction of Questions, Question Formats, and Topics. This epic is the front door of the product's core loop — nothing in Epic 4 onward can generate a Practice Test without an Extraction, and the Extraction is deliberately built to outlive the photos it came from.

## Stories

- Story 3.1: Multi-Page Capture (camera + library)
- Story 3.2: Page Management Before Submit
- Story 3.3: Subject & Grade Level Assignment
- Story 3.4: Legibility Check & Upload Commit
- Story 3.5: Structured Extraction
- Story 3.6: Thin-Extraction Warning

## Requirements & Constraints

- A Source Test accepts 1–10 Page Images. Camera adds one at a time; photo-library selection is multi-select and adds all chosen images in one action. Both append to the end and mix freely in any order; how a page was added carries no meaning downstream and is never surfaced as a distinction.
- Supported formats: JPEG, PNG, WebP, HEIC/HEIF. Format is decided by inspecting the file's bytes — the client-declared type is never trusted. HEIC/HEIF is converted server-side and EXIF orientation is honored before any AI call sees the image.
- Camera unavailable, denied, or absent is never a dead end: library selection is a first-class path to the same Source Test, with plain guidance on re-enabling camera access.
- Page order is explicit and visible before submission. Deleting a page renumbers the rest without reprocessing them. Submitting with zero pages is blocked.
- Exactly one Subject and one Grade Level per Source Test. Subject options are limited to those an operator has enabled for the selected Grade Level; Grade Level defaults to the chosen Student Profile's and is overridable per upload. Submission is blocked until both are set.
- The legibility check runs **once, as a single batch over all pages, immediately after capture finishes** — never per-page as pages are added, never again later. It reports per-page readability confidence, not a whole-test pass/fail, identifies which page failed, and offers a retake scoped to that page alone.
- The check is advisory: the parent may proceed over a failing page. The proceed action states beforehand that it commits the Source Test and will spend one Upload Allowance; abandoning spends nothing.
- The allowance is consumed on **successful production** of the Source Test, not at the moment the parent taps proceed. An upload or Extraction that fails consumes nothing and may be retried without a second charge. Upload Allowance is charged against the Source Test, never against pages.
- Extraction spans all Page Images as one document in page order and preserves cross-page context — a passage or data table on one page stays associated with the questions referencing it on later pages.
- Each extracted question carries exactly one Question Format (Multiple Choice / Fill-in-the-Blank / Short Answer) and at least one Topic.
- Content that cannot be interpreted (an un-photographed diagram, a handwriting-only region) is recorded as uninterpretable rather than guessed at, and questions depending on it are not used as a basis for generation.
- The Extraction is persisted and reused for later generations, so regeneration never re-reads Page Images and keeps working after the images expire. Extraction is not a browsable product surface in v0.
- A fraction read off a page is carried into the Extraction in structured form, not as a plain string, so generated Questions inherit it.
- A low usable-question count relative to pages submitted produces a warning that states both counts and offers proceed or retake. It never hard-blocks — a genuinely short quiz is valid — and it must state that retaking pages consumes no Generation Allowance.
- No log line, error report, or cost row ever carries Page Image bytes or extracted Question content. Identifiers only.

## Technical Decisions

- `sourcetest` owns the Source Test and Page Image entities and **owns image ingest**. `extraction` owns the extracted Question content on the Source Test. Cross-module access goes through the owning module's service, never another module's Prisma delegate.
- Ingest is mandatory before any vision call: byte-sniff with `file-type` against an allowed-MIME set, then `sharp(buffer).rotate()` to honor EXIF orientation and re-encode to JPEG q85. Normalization completes **before the Page Image row leaves `uploading`**, so no downstream consumer ever sees a format the model cannot read. Carry the n-electric fix around `meta.autoOrient` width handling.
- A `PageImage` row is INSERTed in state `uploading` **before any byte is written**, and its storage path is derived from the row identifier — never supplied or influenced by the client. This is also the path-traversal control. A row is the authority; a directory scan never is.
- Uncommitted capture state lives under one lifecycle with a single **72-hour TTL from row creation**, not extended by activity. The same mechanism serves parent work-recovery and orphan sweeping. An expired or swept `uploading` row is deleted outright, charged nothing, and leaves no tombstone.
- **Extraction is a queued job**, enqueued by the request and outliving the connection; progress surfaces read job status, never a held connection. The queue substrate is Postgres-backed — enqueueing work and mutating state share one transaction.
- **The legibility check is foreground and in-request**, with an inline loading state and manual retry — it gates whether the parent retakes a page while the paper is still in hand. It is a distinct AI call class with its own pinned model snapshot and its own cost rows, and it charges no allowance because it produces nothing.
- All AI calls go through the single `ai` module (client, pinned model snapshots, retry/timeout policy, cost accounting); prompt text stays in the owning domain module. Extraction uses the vision model pin and may span up to 10 images.
- Every AI schema field carries a self-assessed confidence of low / medium / high, and prompts instruct the model to return `null` for anything it cannot read confidently rather than guess. Aggregate low confidence across a page is the signal behind both the legibility verdict and the thin-Extraction warning.
- **Deterministic post-hoc validation runs in code on every AI payload after schema validation**, downgrading confidence or rejecting outright. A schema-valid payload is not a trusted payload.
- Allowances are derived, not decremented: Upload usage = Source Tests created in the period window. The cap check and the artifact INSERT occur in the same transaction; database serialization enforces the cap. No counter column, no reset job.
- Parent-scoped data is never server-rendered; capture and upload surfaces fetch client-side carrying the in-memory elevation token.

## UX & Interaction Patterns

- **Continuous capture**: the viewfinder stays open across pages; each capture lands in an ordered thumbnail strip below it. Reorder, retake, and delete act on the strip after capture, never inline in the viewfinder.
- Camera viewfinder chrome is the product's **only inverted surface** — a dark ground inside the light theme. It takes the dedicated on-inverted token set and must not be "corrected" back to the light primary palette; that swap reintroduces a contrast failure. No other surface may claim those tokens.
- Page thumbnail is a control-role element: rounded control radius, divider border, minimum 44px target, ordinal number visible in text. Its **expired state** is a flat default-background tile captioned "Photo deleted" — never a broken-image glyph, never an error color, because expiry is designed behavior.
- The legibility result names the failing page, offers retake of that page alone, states plainly that proceeding is allowed, and states that proceeding consumes an Upload Allowance.
- The thin-Extraction warning states the usable-question count and the page count, then offers proceed or retake pages, and says retaking costs no Generation Allowance.
- Copy is plain, complete sentences and facts — no error codes, no cheerleading, no apology paragraphs. Parent-facing copy addresses the parent in the third person about the student. No user-facing string is a hardcoded literal.
- Accessibility: parent-tier tap targets; the capture strip is exposed as an ordered list naming each page's ordinal and legibility state; icon-only strip controls name the page ordinal they act on; every control is focusable with a visible focus ring; reduced motion honored.
- Reference mock for this flow: the capture mockup in the UX design's `mockups/` directory covers continuous capture, page management, the batch legibility check, and the generate step.

## Open Implementation Gaps (as of 2026-09-26)

Recorded by `/bmad-loop-resolve`; both stories are `backlog` in `sprint-status.yaml` and both are correct to be.

**Story 3.1 (Multi-Page Capture) — no spec on disk, implementation missing.** `apps/web/src/app/parent/capture/page.tsx` exists, but Story 3.2 wrote it for its own needs; 3.1's acceptance criteria are unmet: no format decision by byte inspection, no HEIC/HEIF conversion, no EXIF-orientation handling, no library multi-select, no camera-unavailable/denied guidance. The deferred dev session's tree is at `refs/attempt-preserve-dirty/20260923-210321-45b5-b38a8047-2` and its spec exists **only** inside that ref. That snapshot is parented on `b38a804` (Story 1.7), **13 commits behind** HEAD and predating the entire rest of Epic 3, so it is evidence of intent, not a restore candidate: re-plan and re-implement this story, reading the snapshot for what it attempted.

**Story 3.4 (Legibility Check & Upload Commit) — spec committed, implementation missing.** See that spec's own Spec Change Log for the verified gap and the diff-apply procedure for its snapshot (`...-9ce972f1-2`, 11 commits behind, conflicts expected against Story 3.5's rewrites).

**Queue order** (human-decided): 3.1 and 3.4, then Story 5.3, then Story 5.4. Story 5.4 stays blocked until 5.3 is committed.

## Cross-Story Dependencies

- Story 3.3 depends on Epic 2's Subject / Grade Level taxonomy (only Admin-enabled Subject × Grade Level combinations are offered) and on Epic 1's Student Profile carrying a Grade Level to default from.
- Story 3.4 commits the Source Test that Story 3.5's Extraction job consumes; Story 3.5's output count is what Story 3.6 warns on.
- Stories 3.1–3.2 depend on the uncommitted-state TTL and orphan sweep mechanism shared with Epic 1's work-recovery story — one mechanism, not two.
- Upload Allowance counting is read here, but **hard-blocking at cap ships in Epic 9**; this epic must charge correctly and state cost in copy without implementing enforcement.
- Extraction persistence is what makes Epic 8's 90-day Page Image expiry safe — nothing in generation may couple to stored image bytes.
- The extracted Topics feed Epic 7's Topic normalization and Mastery; Question Format and topic mix feed Epic 4's generation.
