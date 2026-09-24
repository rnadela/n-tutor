---
title: 'Story 4.4: Draft Editing'
type: 'feature'
created: '2026-09-25'
baseline_revision: '3d13b21bcdcbfd42c1581c672df0f1b76cc91abd'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-draft-review.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The two Parent View draft screens are covered by specs that grep their own source text
      rather than render them, so no executing test drives the edit, delete or slot-restore
      states in a DOM.
    evidence: |-
      `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` asserts with
      `expect(PAGE_SOURCE).toContain(...)` against `readFileSync(page.tsx)`. Inverting the
      slot filter to `slot.kind === 'DraftEdit'` would leave every searched string in place
      and ship green with restore entirely dead. `apps/web/vitest.config.ts` sets
      `environment: 'node'` and no testing-library dependency exists under `apps/web`, so a
      real render test needs a DOM the web tier does not have. Carried from Story 4.3; this
      story adds more instances of it. The Playwright pass is the compensating surface.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx
    severity: medium
  - summary: >-
      Two deletes committing concurrently on one draft can collide on the ordinal renumber
      rather than serialising.
    evidence: |-
      `deleteQuestion` reads the survivors and rewrites their ordinals without locking the
      parent `practice_test` row first, so two overlapping transactions can both negate and
      both renumber; the loser surfaces a unique-constraint violation as a 500 rather than as
      this module's own answer. The window needs two in-flight deletes from one elevated
      parent, which the screen does not produce (its controls disable while a mutation is in
      flight), and the fix is a `SELECT ... FOR UPDATE` on the parent row whose interaction
      with the charging fence deserves its own pass.
    location: >-
      apps/api/src/practicetest/practice-test.service.ts (deleteQuestion)
    severity: medium
  - summary: >-
      The `DraftEdit` slot's restore, debounced save and discard mechanism, and the screen's
      error path on a failed edit or delete, run through no test that actually renders or
      executes them.
    evidence: |-
      `page.spec.tsx`'s slot-restore cases (e.g. "holds a typed-but-unsaved edit in the
      DraftEdit slot", "restores the held edits once per draft id", "checks every field of a
      restored slot", "debounces the slot write") are all `expect(PAGE_SOURCE).toContain(...)`
      assertions against the raw source text, same as the general gap already deferred above.
      Neither of the new Playwright specs in `e2e/tests/parent-practice-test.spec.ts` leaves an
      editor open and reloads to observe a restore, or forces a 4xx/network failure to observe
      `data-testid="draft-action-error"`. Swapping the merge-precedence spread at
      `setEdits((open) => ({ ...restored, ...open }))` to `{ ...open, ...restored }` -- which
      would let a slow slot fetch clobber text a parent is actively typing, exactly the race the
      surrounding comment says the ordering prevents -- would not fail any test in this diff.
    location: >-
      apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx (restore effect, debounced slot
      save, discardSlot/discardEverySlot); apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Story 4.3 gave the parent a screen that shows every generated Question, but nothing to do about a bad one. The epic's whole reason for existing is a human quality gate, and a gate that can only be looked through is not a gate: a wrong answer, a mangled prompt or a duplicated option can only be accepted whole or left to reach the child.

**Approach:** Add the write half on the draft the review screen already reads. Two elevation-guarded, `Draft`-only mutations on `practicetest` — edit one Question (its prompt, its free-text answer, its option bodies, which option is correct) and delete one Question — plus the in-place edit and delete controls on the review screen. Deleting the last Question discards the Practice Test behind a confirmation that says so and says the spent Generation Allowance is not refunded. A parent's typed-but-uncommitted edit is held in the `DraftEdit` uncommitted-state slot Story 1.6 built for it, so an idle expiry does not eat their work.

## Boundaries & Constraints

**Always:**
- Both mutations sit behind `ParentElevationGuard` in `PracticeTestController`, take the account from `req.elevated`, and answer **404 `PRACTICE_TEST_NOT_FOUND`**, never 403, for a Practice Test that belongs to another account, does not exist, or is not `Draft`. A `Released` or `Discarded` row is the released-state write barrier: the API refuses regardless of what any UI offered.
- An edit is stored exactly as the student will later be graded against it: the edited rich text **is** the Question, with no second "original" column, no revision history and no shadow copy.
- Parents type plain text; the server converts it to stored rich-text segments through one shared inverse of `plainTextOf`, so a fraction stays structure (AD-32) and `numerator/denominator` is never stored as the glyph string. The round trip `richTextFromPlainText(plainTextOf(rich))` reproduces any fraction a generated field holds.
- Every edited field goes through `parseRichText` plus this module's existing ceilings (`MAX_SEGMENTS`, `MAX_TEXT_LENGTH`, `MAX_CHOICES`) before it is written. An empty or whitespace-only field is refused, not stored.
- A Multiple Choice Question keeps exactly one option flagged correct and a null `answer` column; every other format keeps a non-null `answer` and no options. An edit that would break either invariant is refused with the module's own existing sentence (`ONE_CORRECT_CHOICE_REQUIRED`, `ANSWER_REQUIRED`, `ANSWER_FORBIDDEN`), 400, before a row is written.
- Deleting a Question deletes it, renumbers the survivors to a contiguous `1..N` inside the same transaction, and rewrites `questionCount` to match — one transaction, or the heading numbering and the stored count drift.
- Deleting the **last** Question sets the Practice Test to `Discarded` in that same transaction. `chargedAt` is never cleared and never rewritten: a discard does not refund (AD-14).
- The delete confirmation names what is destroyed **before** the action. The last-Question variant states, in words, that the Practice Test is discarded and that the already-spent Generation Allowance is not refunded.
- No refusal sentence, log line or error message added here carries Question text, an option body, a Topic label, an allowance figure, a tier label or a model name (AD-20). Identifiers and counts only.
- A typed-but-unsaved edit is persisted to the `DraftEdit` uncommitted-state slot keyed to the draft's own `studentProfileId`, scoped by Question id, and is restored when the parent returns to that Question. The slot is discarded the moment the edit is committed or cancelled. Nothing is written to any browser storage API.
- Every user-facing string is parameterized in `apps/web/src/copy/parent.ts`, third person about the student, plain fact — no exclamation marks, no cheerleading, no upsell.
- The review screen stays `'use client'` and carries the in-memory elevation token; edit and delete act **in place** without navigating away, and every control is a real focusable element with an accessible name.

**Block If:**
- Nothing. The epic's acceptance criteria and the existing schema fully specify this story.

**Never:**
- No release control, no discard control of its own, no `Released` transition, no timer field (Stories 4.5 and 4.6). Delete-to-zero reaches `Discarded` because this story's acceptance criterion says so, and by no other path.
- No editing of a Question's `format`, no adding or removing an option, no editing of Topic labels — Topics stay raw as generated (AD-11, Epic 7).
- No new table, column, migration, queue job or AI call. No regeneration of a Question, and no provider call on any edit path.
- No refund, no `chargedAt` rewrite, no allowance figure anywhere on these screens.
- No edit or delete reachable from a student-scoped surface; `StudentModeController` stays one read.
- No revision history, no undo, no soft-deleted Question row.
- No server-rendered parent data, and no localStorage/sessionStorage carrying draft text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit a free-text prompt | `PATCH /parent/practice-tests/:id/questions/:questionId` with a new prompt on a `ShortAnswer` question | The stored prompt is the parsed segment array; the full draft view comes back with it | No error expected |
| Edit with a fraction | Prompt text `What is 1/2 of 8?` | Stored as text + `{kind:'fraction',whole:null,numerator:1,denominator:2}` + text — never one `"1/2"` string | No error expected |
| Edit a mixed number | Answer text `2 3/4` | One fraction segment with `whole: 2` | No error expected |
| Edit option bodies and the correct one | MC question, new bodies for two options and `correctOrdinal` moved to option 3 | Exactly one option carries `isCorrect`, in stored order; `answer` stays null | No error expected |
| Edit leaves no correct option | MC edit naming no `correctOrdinal`, or one that is not an option's ordinal | Refused before any write | 400 `ONE_CORRECT_CHOICE_REQUIRED` |
| Answer sent for an MC question | MC edit carrying `answer` | Refused; the flagged option is the answer | 400 `ANSWER_FORBIDDEN` |
| Options sent for a non-MC question | `FillInTheBlank` edit carrying `choices` | Refused | 400 `ANSWER_FORBIDDEN`/`CHOICES_FORBIDDEN` as the payload rules already state |
| Empty field | Prompt of `"   "` | Refused; nothing is written | 400, the rich-text emptiness sentence |
| Oversized field | Prompt beyond `MAX_TEXT_LENGTH`, or more segments than `MAX_SEGMENTS` | Refused whole | 400 |
| Delete a Question, others remain | Draft of 5, delete #2 | #2 gone; survivors renumbered `1..4`; `questionCount` is 4; the draft stays `Draft` | No error expected |
| Delete the last Question | Draft of 1, delete it | The Question is gone, the Practice Test is `Discarded`, `chargedAt` unchanged | No error expected |
| Read a discarded draft afterwards | `GET /parent/practice-tests/:id` for the just-discarded id | The same 404 an unknown id gets | 404 `PRACTICE_TEST_NOT_FOUND` |
| Edit or delete on a released draft | Owned row with `status: 'Released'` | Refused identically to an unknown id — the write barrier | 404 `PRACTICE_TEST_NOT_FOUND` |
| Foreign draft | Either mutation with another account's id | Refused as though it did not exist | 404 `PRACTICE_TEST_NOT_FOUND` |
| Question of another draft | A valid question id that belongs to a different Practice Test | Refused; the pair must match | 404 `PRACTICE_TEST_NOT_FOUND` |
| Malformed id | Either path segment not a UUID | Refused on shape before a row is read | 400 from `ParseUUIDPipe` |
| Unelevated call | Either mutation with no elevation token | Refused by the guard | 401 |
| Screen: edit committed | Parent edits a prompt and saves | The row re-renders from the returned view, in place, with no navigation | Server's own sentence surfaced on a 4xx |
| Screen: delete confirmation | Parent deletes one of several Questions | A confirmation naming the Question before anything is deleted | Cancel leaves the draft untouched |
| Screen: delete-to-zero | Parent deletes the only remaining Question | The confirmation says the practice test is discarded and the spent allowance is not refunded; on confirm the screen goes to Pending drafts | Cancel leaves the draft untouched |
| Screen: idle expiry mid-edit | Parent types an edit, Parent View expires, they re-enter and return to the draft | The typed text is restored into that Question's editor from the `DraftEdit` slot | Slot read failure leaves the stored text; it never blocks the screen |

</intent-contract>

## Code Map

**Change these:**

- `apps/api/src/extraction/rich-text.ts` -- add `richTextFromPlainText(text)` beside `plainTextOf` (:96) as its exact inverse for the forms `plainTextOf` emits: `n/d` and `w n/d` with integer parts become one fraction segment, everything else is text. Adjacent text is not merged into a fraction, and the result goes through `parseRichText` before it is returned. One mechanism, one file (AD-32) — this is the only place plain text becomes segments.
- `apps/api/src/extraction/rich-text.spec.ts` -- round-trip cases: every fraction shape survives `richTextFromPlainText(plainTextOf(rich))`; `24/7` in prose is documented as a fraction by this rule; a zero denominator and an empty string are refused.
- `apps/api/src/practicetest/practice-test-payload.ts` -- reuse, do not restate: `MAX_CHOICES`, `MAX_SEGMENTS`, `MAX_TEXT_LENGTH`, `ONE_CORRECT_CHOICE_REQUIRED`, `ANSWER_REQUIRED`, `ANSWER_FORBIDDEN`, `CHOICES_REQUIRED`, `CHOICES_FORBIDDEN`, `CHOICE_BODY_EMPTY` (:33-69). Export a small `validateEditedQuestion(...)` here if the shared rules need a seam; a parent edit and a generated payload obey the same Question invariants and must not obey two copies of them.
- `apps/api/src/practicetest/practice-test-policy.ts` -- messages section (:82-190). Add only what does not exist: `QUESTION_NOT_FOUND` is **not** added — the draft reads' `PRACTICE_TEST_NOT_FOUND` (:120) is the one sentence all ownership/state refusals share (AD-18).
- `apps/api/src/practicetest/dto/practice-test.dto.ts` -- add `EditDraftQuestionDto`: optional `prompt`, optional `answer`, optional `choices: [{ordinal, body}]`, optional `correctOrdinal`. Shape and ceilings only; every row-dependent rule stays in the service, exactly as `RequestPracticeTestsDto` leaves affordability to the write path.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `editQuestion(parentAccountId, practiceTestId, questionId, input)` and `deleteQuestion(parentAccountId, practiceTestId, questionId)` beside `draftFor` (:525). Both scope by `parentAccountId` **and** `status: 'Draft'` in the `where`, so the refusal is by construction. Delete renumbers survivors with the two-phase negation `source-test.service.ts:675-698` already uses for `@@unique([practiceTestId, ordinal])`, rewrites `questionCount`, and sets `status: 'Discarded'` when none remain. Both return the draft view `draftFor` builds — factor its mapper out rather than writing a second one. `land()` :612 and the charging fence are untouched.
- `apps/api/src/practicetest/practice-test.controller.ts` -- add `PATCH practice-tests/:id/questions/:questionId` and `DELETE practice-tests/:id/questions/:questionId` below `draft()` (:145), same guard, same `ParseUUIDPipe` on both ids. Extend the header comment: the module now writes what a parent reviewed, and the released-state barrier is why that is still a gate.
- `apps/api/test/practice-test.int-spec.ts` -- every matrix row that touches a row, against real Postgres: the edit's storage shape, the fraction round trip, each refusal, the renumbering, the `questionCount` rewrite, delete-to-zero reaching `Discarded` with `chargedAt` unchanged, and the released/foreign/cross-draft 404s.
- `apps/api/test/student-mode.int-spec.ts` -- extend the existing negative: the student cookie reaches neither new mutation on a real draft id.
- `apps/web/src/lib/rich-text.ts` (new) + `rich-text.spec.ts` -- the web-side `plainTextOf` that prefills an editor from stored segments, mirroring the API's (:96). Pure, DOM-free, like `page-order.ts` — the browser never parses text into segments; that is the server's single answer.
- `apps/web/src/lib/parent-api.ts` -- add `editDraftQuestion` and `deleteDraftQuestion` beside `practiceTestDraft` (:845), returning `PracticeTestDraftView`; and the `DraftEdit` slot calls already there (`saveUncommittedState` :618, `uncommittedState` :632, `discardUncommittedState` :654) get their first caller.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` -- per-Question edit and delete in place. The read, `applyIfCurrent`/`endsParentView` and the missing/error states (:68-105) stay exactly as they are; the mutations re-render from the returned view. Confirmations use `AppDialog` (`apps/web/src/components/Dialog.tsx:30`) — **not** `DestructiveConfirmDialog`, which re-asks for the account password and is the account/profile-deletion ceremony, not a question's.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` -- the screen's cases, in the file's existing style.
- `apps/web/src/copy/parent.ts` -- extend the `drafts` block (:353+) with the edit labels, the save/cancel controls, the two confirmation bodies (ordinary delete, and delete-to-zero naming the discard and the non-refund), and the two failure sentences.
- `e2e/tests/parent-practice-test.spec.ts` -- extend the browser pass: edit a Question's prompt, reload, see the edit; delete a Question, see the survivors renumbered.

**Read-only evidence (do not change):**
- `apps/api/prisma/schema.prisma:849-945` — `PracticeTest`, `PracticeTestQuestion`, `PracticeTestChoice`, `PracticeTestQuestionTopic`. `@@unique([practiceTestId, ordinal])` is what forces the two-phase renumber; `chargedAt` (:862) is the row this story must never touch. No migration.
- `apps/api/src/identity/uncommitted-state.controller.ts` / `uncommitted-state.service.ts` — the slot mechanism, complete since Story 1.6. This story is a caller, not a change to it.
- `apps/web/src/components/RichText.tsx` — renders segments; unchanged.

## Tasks & Acceptance

**Execution:**

- `apps/api/src/extraction/rich-text.ts` + `rich-text.spec.ts` -- add `richTextFromPlainText` as the exact inverse of `plainTextOf` -- a parent edits text, the schema stores structure, and without one shared inverse every call site would invent its own and a fraction would silently become a glyph one story after the schema went to the trouble of keeping it apart.
- `apps/api/src/practicetest/dto/practice-test.dto.ts` -- add `EditDraftQuestionDto` -- shape and ceilings at the edge; nothing row-dependent, so the service stays the one place that knows what a Question is.
- `apps/api/src/practicetest/practice-test-payload.ts` + `practice-test-payload.spec.ts` -- expose the Question invariants to the edit path -- a parent edit and a generated payload must satisfy one set of rules, or an edit could store the malformed MC question the post-hoc pass exists to catch.
- `apps/api/src/practicetest/practice-test.service.ts` -- add `editQuestion` and `deleteQuestion` -- the story is the write; scoping by account **and** `Draft` inside the `where` is what makes a foreign id and a released id the same 404 by construction rather than by remembering to check.
- `apps/api/src/practicetest/practice-test.controller.ts` -- add the two routes and extend the header comment -- the module that refused to expose a Question now rewrites one, and why that is still the gate belongs beside the routes.
- `apps/api/test/practice-test.int-spec.ts` -- integration-cover every matrix row that touches a row -- especially renumbering, the `questionCount` rewrite, delete-to-zero and the untouched `chargedAt`.
- `apps/api/test/student-mode.int-spec.ts` -- probe both mutations with the student cookie against a real draft id -- a negative nothing asserts is a negative that quietly stops being true.
- `apps/web/src/lib/rich-text.ts` + `rich-text.spec.ts` -- the web's plain rendering for prefilling an editor -- DOM-free, so the rule is assertable without a render.
- `apps/web/src/lib/parent-api.ts` + `parent-api.spec.ts` -- add the two mutations -- method, URL, bearer and the returned view, asserted like every sibling call.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` + `page.spec.tsx` -- in-place edit and delete, both confirmations, and the `DraftEdit` slot save/restore/discard -- the gate a parent can act on, and typed work that survives the idle expiry the UX promises it survives.
- `apps/web/src/copy/parent.ts` -- extend the `drafts` copy block -- parameterized strings only; the delete-to-zero sentence states the discard and the non-refund in plain words.
- `e2e/tests/parent-practice-test.spec.ts` -- extend with an edit and a delete -- the screen must prove rendered behaviour, not that a source file contains the right tokens.

**Acceptance Criteria:**

- Given a draft Question, when the parent edits its prompt, its free-text answer, an option body or which option is correct, then the stored Question is exactly what was typed — parsed to segments, with no original kept beside it — and the review screen re-renders it in place.
- Given a draft of several Questions, when the parent deletes one, then it is gone, the survivors are numbered contiguously from 1, the stored `questionCount` equals the number remaining, and the Practice Test is still a draft.
- Given a draft with one Question left, when the parent asks to delete it, then before anything is deleted the confirmation says the practice test will be discarded and that the already-spent Generation Allowance is not refunded; on confirm the Practice Test is `Discarded`, its `chargedAt` is unchanged, and its id answers 404 to the draft read.
- Given a Practice Test that is `Released` or `Discarded`, or one belonging to another account, when either mutation is called with a valid elevation token, then the answer is a 404 whose sentence is identical to the one an unknown id gets.
- Given a Multiple Choice Question, when an edit would leave it with no correct option, more than one, or a non-null free-text answer, then it is refused with the module's existing sentence and nothing is written.
- Given any log line or error message produced by these mutations, then it carries identifiers and counts only — no Question text, no option body, no Topic label, no allowance figure.
- Given a parent who has typed an edit and not saved it, when Parent View expires and they re-enter and return to the draft, then the typed text is restored into that Question's editor, and it is discarded once the edit is saved or cancelled.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 16: (high 0, medium 5, low 11)
- defer: 2: (high 0, medium 2, low 0)
- reject: 29: (high 0, medium 6, low 23)
- addressed_findings:
  - `[medium]` `[patch]` `richTextFromPlainText` dropped an adjacent valid fraction whenever the preceding digit run was not a safe integer — `matchAll` had already consumed the span, so `"99999999999999999999 1/2"` stored as plain text with no fraction at all. The loop now emits the bare `n/d` when only the whole part is unparseable, with spec cases for an unsafe whole part, an unsafe denominator and a bare solidus.
  - `[medium]` `[patch]` The slot-restore effect depended on `draft`, and every save re-set it, so `uncommittedState` was re-read after each mutation; with `discardSlot` fire-and-forget, a slow DELETE reopened an editor the parent had just saved or cancelled, holding abandoned text. Restore now runs once per `practiceTestId` behind a ref guard.
  - `[medium]` `[patch]` `parentCopy.drafts.discarded` had no caller: the discard branch navigated away before announcing, so the most consequential outcome on the screen was stated only before the act and never after. The review screen now hands the fact to Pending drafts, which renders it.
  - `[medium]` `[patch]` Neither opening an editor, saving one, nor deleting a card moved focus, so keyboard and screen-reader users lost their place on every action of the epic's quality gate. Focus now enters the prompt field on open, returns to that row's edit control on save or cancel, and moves to the question-total line on a delete.
  - `[medium]` `[patch]` The last-question discard — the one acceptance criterion that is purely about wording shown before a destructive act — was driven in no browser test. The Playwright pass now reaches a one-question draft, asserts both required facts in the confirmation, cancels once, then confirms and asserts the landing on Pending drafts.
  - `[low]` `[patch]` `editQuestion` logged inside its transaction, so a rollback left a log line asserting an edit that never landed — moved after the commit, as `deleteQuestion` already did.
  - `[low]` `[patch]` Each choice `updateMany` result was ignored, so an edit could answer 200 having written no option row. The count is now asserted per choice and a miss rolls the edit back as `PRACTICE_TEST_NOT_FOUND`.
  - `[low]` `[patch]` The int-spec helper read a draft with an unscoped, unordered `findFirstOrThrow`, depending on table emptiness and insertion order — now scoped to the account and source test and ordered explicitly.
  - `[low]` `[patch]` No test sent an option restatement repeating one ordinal, the only new refusal with zero coverage: the duplicate collapses in the body map and the set comparison passes, so one body a parent sent would be dropped silently. Added, with the stored bodies asserted unchanged.
  - `[low]` `[patch]` A restored slot payload type-guarded three fields but not `choices[].body`, and could restore a `correctOrdinal` naming an option the question no longer has — both now guarded.
  - `[low]` `[patch]` The live region never cleared and a repeated identical sentence did not re-announce, so a second save of the same question announced nothing and a stale success sat beside a later failure.
  - `[low]` `[patch]` `liveSlots.current` was assigned in the render body — unsafe under StrictMode and concurrent rendering; moved into an effect.
  - `[low]` `[patch]` A delete-to-zero left behind the draft's other `DraftEdit` slots, which would return as restored edits of a practice test that no longer exists — the discard branch now drops every slot the draft held.
  - `[low]` `[patch]` The page spec had dropped the `onSubmit`/`contentEditable` bans and narrowed the allowance ban, and its API-call regex matched any `.foo(token` call — all three restored or re-anchored on `parentApi`.
  - `[low]` `[patch]` `EditQuestionInput` and its web wrapper both documented every field as optional while an MC edit omitting `correctOrdinal` is refused — the comments now state the exception the matrix requires.
  - `[low]` `[patch]` The web rich-text spec asserted that the API module's source literally contained a given ternary, so a prettier reflow would break a web test for no behavioural reason — replaced with a shared fixture table asserted against both renderings.

  Rejected as noise or as decisions the intent already settles: the "delete until one remains is a floor" reading (the third acceptance criterion states the discard outright), adding or removing an option (the intent says edit them), duplicate prompts after an edit (a parent's own call, unlike a generated payload), leading zeros and `24/7`-style prose read as a fraction (documented costs of plain-text editing, identical on screen), the hardcoded physical table name in the renumber (the repo's own existing precedent), an empty PATCH body re-writing identical values, and a navigation guard for a dirty editor (the slot already holds it).

### 2026-09-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[low]` `[patch]` `editQuestion` wrote the Question row with a bare `update`, so a Question deleted between the read and this statement would escape as Prisma's own missing-row fault instead of this module's `PRACTICE_TEST_NOT_FOUND`, unlike the choices loop two lines below it which already guards this. Switched to `updateMany` with a `count !== 1` check, matching the choices loop's own pattern.
  - `[low]` `[patch]` `deleteQuestion`'s delete-to-zero branch re-read the just-discarded row with `findFirstOrThrow`, so the row vanishing before that read (a second, concurrent action on the same draft) would surface as Prisma's own fault rather than the module's sentence. Switched to `findFirst` with an explicit `NotFoundException(PRACTICE_TEST_NOT_FOUND)`.
  - `[low]` `[patch]` The debounced `DraftEdit` slot-save effect never cleared an edit's `dirty` flag after a successful write, so every later `edits` state change (typing in an unrelated Question) re-sent the same already-saved payload to the slot endpoint until the edit was committed or cancelled. The write now clears `dirty` once it lands, but only when the field state on screen still matches exactly what was just saved -- a keystroke that arrived after the write started stays dirty and is saved on its own next pause.
  - `[low]` `[patch]` No test sent more than `MAX_CHOICES` options on an edit, the one payload-size ceiling on the edit path with zero coverage. Added an integration case restating `MAX_CHOICES + 1` options and asserting the write lands nowhere.

## Design Notes

**Why the server parses plain text, and the browser never does.** A parent types `What is 1/2 of 8?`; the schema stores a fraction as structure (AD-32). If the browser built the segments, the app would hold a second answer to what a fraction is, and the two would eventually disagree about a row neither of them wrote. So the web sends text, the API converts it once, and the view that comes back is the only account of what is stored. `richTextFromPlainText` is written as the exact inverse of `plainTextOf`, which is what makes editing lossless: prefill the field with `plainTextOf(stored)`, save it back untouched, and the stored segments are byte-identical. The known cost is documented rather than defended away: `24/7` in prose becomes a fraction. It renders as `24/7` either way; only its spoken reading differs, and that is a better failure than storing every parent-edited fraction as a glyph.

**Why delete-to-zero lands in this story and `Released` does not.** The acceptance criterion names the discard and the non-refund explicitly, so `Discarded` is reachable here — by deleting the last Question and by nothing else. `Released` is Story 4.5's transition and has no path here, which keeps "no path may auto-release" a property of the code rather than a promise about it.

**Why the ordinary delete confirms too.** The epic mandates a confirmation only for the last Question. Confirming every delete is a superset that still satisfies the criterion, and the alternative — a one-tap destroy of generated work with no undo, no history and no refund — is the kind of loss this whole screen exists to prevent.

**The renumber, as the unique index forces it:**

```ts
// Two-phase, exactly as source-test.service.ts:690 does it: a straight rewrite
// collides mid-statement against @@unique([practiceTestId, ordinal]).
await tx.$executeRaw`UPDATE "practice_test_question" SET "ordinal" = -"ordinal" WHERE "practiceTestId" = ${practiceTestId}`;
for (const { id, ordinal } of renumbered(survivorIds)) {
  await tx.practiceTestQuestion.updateMany({ where: { id, practiceTestId }, data: { ordinal } });
}
await tx.practiceTest.update({
  where: { id: practiceTestId },
  data: { questionCount: survivorIds.length, ...(survivorIds.length === 0 ? { status: 'Discarded' } : {}) },
  // `chargedAt` is absent on purpose: a discard does not refund (AD-14).
});
```

**The `DraftEdit` slot.** `UncommittedStateKind.DraftEdit` has existed since Story 1.6 with no caller; this is it. Keyed to the draft's own `studentProfileId`, scoped by Question id, payload the typed text. Saved as the parent types (debounced), restored on mount, discarded on save or cancel — nothing in browser storage, because a device that has fallen back to Student Mode must hold no trace of the work.

## Verification

**Commands:**
- `pnpm --filter api typecheck` and `pnpm --filter web typecheck` -- expected: no errors.
- `pnpm --filter api test` -- expected: the unit suite passes, including the new `rich-text` round-trip cases and the payload rules the edit path reuses.
- `pnpm --filter api test:int` -- expected: `practice-test.int-spec.ts` and `student-mode.int-spec.ts` pass against real Postgres, covering both mutations, every refusal, the renumbering and delete-to-zero.
- `pnpm --filter web test` -- expected: `rich-text.spec.ts`, `parent-api.spec.ts` and the draft review page spec pass.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- expected: the extended pass edits a Question and deletes one, reading both results back from the DOM.
- `pnpm prettier --check .` -- expected: clean. (`pnpm lint` is known-unusable here — `eslint` is not installed; run `pnpm exec eslint` on changed files instead.)

## Auto Run Result

**Summary:** Story 4.4 (draft editing) was implemented in a prior run: two elevation-guarded, `Draft`-only mutations (`editQuestion`, `deleteQuestion`) on `PracticeTestController`/`PracticeTestService`, the server's single plain-text-to-rich-text inverse (`richTextFromPlainText`), a shared `validateEditedQuestion` invariant path reused from generation, in-place edit/delete controls on the parent draft review screen backed by the `DraftEdit` uncommitted-state slot, and copy/E2E coverage for the edit and delete-to-zero flows. This pass is a follow-up review of that implementation (`status: done` → fresh review), not a new build.

**Files changed:** see the diff `3d13b21bcdcbfd42c1581c672df0f1b76cc91abd..HEAD` for the full prior implementation. This review pass additionally touched:
- `apps/api/src/practicetest/practice-test.service.ts` -- `editQuestion`'s question-row write and `deleteQuestion`'s delete-to-zero re-read now surface the module's own `PRACTICE_TEST_NOT_FOUND` on a concurrent removal instead of an unmapped Prisma fault, matching the pattern the choices-write loop already used.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` -- the debounced `DraftEdit` slot-save effect now clears an edit's `dirty` flag once its write lands (only when nothing changed since), instead of re-sending every dirty edit's payload on every later, unrelated `edits` state change.
- `apps/api/test/practice-test.int-spec.ts` -- added a case sending more than `MAX_CHOICES` options on an edit, the one edit-path payload ceiling that had no coverage.

**Review findings breakdown:** patch 4 (low 4), defer 1 (medium 1), reject 14 (low 14, mostly claims contradicted by the code itself — e.g. cascade deletes already configured in the schema, `canSaveField` explicitly documented as a partial mirror, message reuse that reads correctly on inspection).

**Follow-up review recommendation:** `false`. This pass's patched findings were all low severity: `3 × 0 medium + 1 × 4 low = 4`, below the `5` threshold, and none was high.

**Verification performed:**
- `pnpm --filter api typecheck` -- clean.
- `pnpm --filter web typecheck` -- clean.
- `pnpm --filter api test` -- full run flakes on two unrelated files (`extraction.int-spec.ts`, `source-test.int-spec.ts`) that touch neither this story nor this pass's patches; both pass cleanly in isolation, and re-running the full suite reproduces the same class of flake against a *different*, again-unrelated file. Isolated run of every file this pass changed (`practice-test.int-spec.ts`, `student-mode.int-spec.ts`, `rich-text.spec.ts`, `practice-test-payload.spec.ts`) — 171 tests, all pass.
- `pnpm --filter web test` -- 454 tests pass, including the reformatted `page.tsx` and its existing spec.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- 8/8 pass.
- `pnpm prettier --check .` -- clean (the dirty-flag patch to `page.tsx` needed one `--write` pass, applied and reverified).

**Residual risks:**
- The full `pnpm --filter api test` run is flaky across unrelated files when run together (see above) — pre-existing, not introduced by this story or this pass, and not something this review's scope authorizes fixing.
- The two pre-existing deferred items (source-grep-only page spec; concurrent-delete ordinal race) remain open, plus the new deferred item added this pass (the `DraftEdit` slot's restore/debounce/discard mechanism and the screen's error path run through no test that actually renders or executes them).

