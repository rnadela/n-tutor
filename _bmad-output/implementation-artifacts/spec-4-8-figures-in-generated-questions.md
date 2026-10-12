---
title: 'Story 4.8 — Figures in Generated Questions'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_revision: '8cac3a70c75149df5f661728c9e1a22edca8df19'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      No test exercises a figure in a FillInTheBlank question's prompt, even
      though the schema permits one there as it does for every format.
    evidence: |-
      `practice-test-schema.ts` widens `prompt` to full `RichText` for every
      question format uniformly, and the figure-bounding pass in
      `practice-test-payload.ts` is format-agnostic. The unit, integration and
      e2e suites added by this story exercise ShortAnswer and MultipleChoice
      prompts and MultipleChoice choice bodies, but no FillInTheBlank case.
    location: apps/api/src/practicetest/practice-test-prompt.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 3.9 gave rich text a `figure` segment and a sanitizer, but deliberately stopped at the extraction boundary: the generation and explanation wires take the narrowed `GeneratedRichText` (text and fractions only), so a Practice Test generated from a figure-bearing Source Test asks about shapes in prose or not at all — and the draft-edit path still round-trips every field through `plainTextOf` → `richTextFromPlainText`, which would silently delete a figure the day one arrived.

**Approach:** Widen the generation wire to carry figures in question prompts and Multiple Choice choice bodies (never in the free-text `answer`), show the model each source figure's own SVG and instruct it to draw new ones, bound and reject figures in the generation post-hoc pass exactly as extraction does, and close the edit path by making the plain-text inverse figure-aware: the stored field's figures are grafted back onto the parent's typed text at their `[Figure: <alt>]` tokens, and an edit that does not restate every token is refused rather than silently stripping a drawing.

## Boundaries & Constraints

**Always:**
- Figures reach the generation wire through `prompt` and a Multiple Choice choice `body` only. The free-text `answer` stays `GeneratedRichText`: grading compares `plainTextOf` strings, so an answer whose only content is a drawing is an answer nothing can be graded against. The explanation wire stays `GeneratedRichText` too — explanations are text, and a figure reaches that model as its `[Figure: <alt>]` projection.
- Every figure that enters storage from generation or from an edit is the sanitizer's own output: both paths already store what `parseRichText` returns (`practice-test-payload.ts:168-177`), so the normalization is already in place and must stay that way — no call site may store the value it was handed.
- The generation post-hoc pass gains the figure ceilings extraction already has, mirroring `extraction-payload.ts:290-331` field for field: per-figure bytes, per-field figure count, per-field aggregate figure bytes, `alt` length, and the post-sanitize re-sum that catches escaping growth. A breach is `PAYLOAD_TOO_LARGE`; a figure outside the grammar is `RICH_TEXT_INVALID`. Both are `GenerationPayloadInvalid`, so a figure fault retries and finally routes as the same upstream fault every other post-hoc rejection does (AD-30/AD-31). No new `AiFailureKind`, no repair path.
- A generated figure whose sanitized SVG is byte-identical to any source figure's sanitized SVG is a copy, and is refused by the same kind of deterministic rule that refuses a copied prompt — the instruction in the prompt and the check in code are two halves of one rule.
- The figure instructions are added to the generation prompt **only when the source Extraction actually carries a figure**. A figure-less request must produce Story 4.1/4.2's prompt byte for byte.
- An edit preserves every figure in the edited field unchanged, enforced rather than hoped for: the plain-text inverse takes the stored field's figures, splits the typed text on each figure's exact `[Figure: <alt>]` token in stored order, and refuses the whole edit with one fixed sentence when a token is missing, reordered or altered. A `[Figure: …]` a parent types themselves stays text — it is not a way to author a drawing.
- The web mirrors that refusal as a disabled save control only (the API refuses regardless), and says once, in the editor, that the `[Figure: …]` text must be left as it is. Copy lives in `copy/parent.ts`; no sentence is written at a call site.
- Draft review, Take Test, results and the answer key render figures with no new component: all four already pass segments to `RichText`, which has carried a `figure` branch since 3.9. Their work here is coverage, not code.

**Block If:**
- Carrying figures in generated choice bodies cannot be made to hold the existing "options are distinct" rule — i.e. two pictured options whose `plainTextOf` keys collide cannot be told apart without comparing drawings.

**Never:**
- Do not widen `GeneratedRichText` itself, do not let a figure into the generated `answer` field, and do not add figures to the explanation schema or the explanation prompt.
- Do not offer figure editing, figure deletion, or figure authoring anywhere in the editor; do not add a figure picker, upload or drawing surface.
- Do not touch `fakeExtractionPayload` or the extraction prompt — 3.9 owns both, and Epic 3's and 4's specs assert the fake extraction's exact text.
- Do not require a draft to contain figures: a post-hoc rule that rejected a figure-less draft from a figure-bearing source would burn provider attempts and fail a job over a model's drawing judgement.
- Do not back-fill, re-extract or re-generate any existing row; no migration, no data change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Figure-bearing source | Extraction holds a figure in a question prompt | Generation prompt names the figure rules and lists each source figure's `alt` and sanitized SVG; the generated draft may carry its own figure segments | No error expected |
| Figure-less source | No figure anywhere in the Extraction | Prompt is byte-identical to the Story 4.1/4.2 prompt; no figure rules, no figure list | No error expected |
| Generated figure | Valid figure in a prompt or MC choice body | Stored sanitized (colours `currentColor`/`none`, root sizing stripped), draft lands and is charged as usual | No error expected |
| Malicious generated figure | `<script>`, `on*`, `href`, `url(...)`, no `viewBox`, unparseable | Whole draft refused, call re-issued up to `AI_MAX_ATTEMPTS`, last rejection fails the job as `UpstreamFault` | `GenerationPayloadInvalid(RICH_TEXT_INVALID)` |
| Oversize figure | One figure over `MAX_FIGURE_SVG_BYTES`, or a field over `MAX_FIGURES` / `MAX_FIGURE_BYTES`, or `alt` over `MAX_TEXT_LENGTH` | Draft refused | `GenerationPayloadInvalid(PAYLOAD_TOO_LARGE)` |
| Copied figure | Generated figure's sanitized SVG equals a source figure's | Draft refused and re-issued | `GenerationPayloadInvalid(FIGURE_NOT_NEW)` |
| Figure in generated `answer` | Model emits a figure in `answer` | Schema refuses the payload shape | `GenerationPayloadInvalid(PAYLOAD_SHAPE_INVALID)` |
| Pictured options | Two MC choices differing only by their drawing, same `alt` | Refused as a repeated option — alts are what distinguishes pictured options, so each must read differently | `GenerationPayloadInvalid(CHOICES_NOT_DISTINCT)` |
| Edit around a figure | Stored prompt `[{text "What shape? "}, {figure alt "A half-circle"}]`, typed `"Which shape? [Figure: A half-circle]"` | Stored as `[{text "Which shape? "}, {figure …}]` with the figure's `svg` and `alt` byte-identical to what was stored | No error expected |
| Untouched save | Field saved exactly as prefilled | Stored segments identical to before the edit | No error expected |
| Edit drops a figure token | Typed text omits, reorders or alters a `[Figure: …]` token | Nothing is written; the whole edit is refused | `400` with the rich-text module's fixed figure sentence |
| Parent types a figure token | Field held no figure; typed `"[Figure: A circle]"` | Stored as plain text; no figure is created | No error expected |
| Draft review / take / results | Stored draft or released test with figures in prompt and choices | Each figure drawn where it appears, one `role="img"` named by its `alt`, inheriting text colour in both themes | A figure the web re-sanitizer refuses renders nothing |

</intent-contract>

## Code Map

**Read-only anchors (patterns to follow, do not change):**
- `apps/api/src/extraction/rich-text.ts:47-70` `FigureSegment`; `:99-103` `GeneratedRichText` — the narrowing this story lifts for two fields only. Its doc comment names 4.8 as the owner of both the widening and the round-trip fix; both claims must be updated to describe what now exists.
- `apps/api/src/extraction/rich-text.ts:134-166` `parseRichText` — the normalizer that trims `alt` and replaces `svg` with the sanitizer's output. Unchanged.
- `apps/api/src/extraction/rich-text.ts:212-222` `plainTextOf`'s figure arm (`[Figure: <alt>]`) — the exact token the inverse must split on; the web's mirror is `apps/web/src/lib/rich-text.ts:27-36`.
- `apps/api/src/extraction/extraction-payload.ts:82-92` `MAX_FIGURES = 4` / `MAX_FIGURE_BYTES = 32 * 1024`, `:240-298` `richTextForStorage`, `:283-298` `requireBoundedFigureTotal`, `:300-331` `requireBoundedRichText` — the figure-bounding pass to mirror in generation, including why the raw sum is not the last word.
- `apps/api/src/extraction/svg-figure.ts` — `sanitizeFigureSvg`, `figureSvgByteLength`, `MAX_FIGURE_SVG_BYTES`, `FIGURE_SVG_TOO_LARGE`. The canonical serializer is what makes "byte-identical to a source figure" a sound copy test.
- `apps/api/src/extraction/svg-figure.fixtures.ts` — `SANITIZED_FIGURES` / `MALICIOUS_FIGURES`, the shared corpus both sanitizer specs already run; reuse it rather than writing new SVG literals.
- `apps/api/src/practicetest/practice-test-payload.ts:33-78` the rejection constants and ceilings (`MAX_SEGMENTS`, `MAX_TEXT_LENGTH`); `:156-177` `normalizedRichText` — the one place a generated and an edited field are both normalized, and where the figure ceilings belong; `:212-269` the question walk; `:241-254` the distinct-options rule; `:355-397` `validateEditedQuestion`.
- `apps/api/src/practicetest/practice-test-prompt.ts:55-61` `describeSource` (source questions as one plain-text line each — where a figure is currently flattened to its alt); `:104-147` `buildGenerationPrompt`, rules 1–5 at `:130-135`; rule 4 is the fraction rule the figure rule sits beside, rule 5 the never-copy rule it extends.
- `apps/api/src/practicetest/practice-test-schema.ts:30-56` the generated payload shapes; `:92-186` `fakePracticeTestPayload` — the fake's prompt text is asserted by the int tier, so a figure must be *added* to it under a flag, never substituted into existing text.
- `apps/api/src/practicetest/practice-test.service.ts:3364-3390` the `buildGenerationPrompt` / `fakePracticeTestPayload` / `validateGenerationPayload` call site; `:4043-4087` `GenerationPlan` and `planFor` (where `sourcePrompts` is computed and where source figures belong); `:3989-3994` `EditQuestionInput`; `:4009-4015` `parsed()` — the one place a parent's plain text becomes segments; `:2837-2920` `editQuestion`'s merge of stored columns with the edit.
- `apps/api/src/extraction/extraction-reader.ts:27-36` `ExtractionQuestionForGeneration` — prompts and choices already arrive as full `RichText`, so the source figures are already in hand; no reader change.
- `apps/web/src/components/RichText.tsx` — already renders `figure` (3.9). Untouched.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx:93-107` `editorFor` (prefill via `plainTextOf`, so the token is already in the field); `:111-124` `editPayload`; `:126-140` `canSave`; `:920-923` the `draft-edit-hint` paragraph; `:1050`, `:1093`, `:1133` the three review renders that already pass segments to `RichText`.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx:1149`, `apps/web/src/app/student/_components/AnswerInput.tsx:69`, `apps/web/src/components/AnswerKeyRow.tsx:220`, `:258`, `:286` — the student-facing renders. No change; coverage only.
- `apps/web/src/copy/parent.ts:1178-1182` `editHint` — the one-sentence-before-the-act convention the figure hint follows.
- `apps/api/test/practice-test.int-spec.ts:122-140` `generatable()` (a real extraction through the real pipeline), `:2181-2400` the draft-editing cases, `:877-947` the post-hoc rejection cases.
- `e2e/fixtures.ts:400-470` `spreadPracticeTestFormatsFixture` — the convention for shaping a landed draft by SQL for a browser test.

**Files to change:**
- `apps/api/src/extraction/rich-text.ts`, `rich-text.spec.ts`
- `apps/api/src/practicetest/practice-test-schema.ts`
- `apps/api/src/practicetest/practice-test-prompt.ts`
- `apps/api/src/practicetest/practice-test-payload.ts`, `practice-test-payload.spec.ts`
- `apps/api/src/practicetest/practice-test.service.ts`
- `apps/api/test/practice-test.int-spec.ts`
- `apps/web/src/lib/rich-text.ts`, `rich-text.spec.ts`
- `apps/web/src/copy/parent.ts`
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx`, `page.spec.tsx`
- `e2e/fixtures.ts`, `e2e/tests/parent-practice-test.spec.ts`, `e2e/tests/student-submit-attempt.spec.ts`

**Files to create:**
- `apps/api/src/practicetest/practice-test-prompt.spec.ts`

## Tasks & Acceptance

**Execution:**
- `apps/api/src/extraction/rich-text.ts` — make the inverse figure-aware: `richTextFromPlainText(text, figures: readonly FigureSegment[] = [])` splits `text` on each figure's exact `[Figure: <alt>]` token, in stored order, runs the existing fraction parse over the runs between tokens, and interleaves the stored figure segments unchanged. A token that is absent (searched from the previous token's end, so order is enforced) throws the new fixed sentence `RICH_TEXT_FIGURE_MISSING`. Split on the literal projection rather than a regex, because an `alt` may itself contain brackets. Replace the "knowingly left open / Story 4.8's" paragraph with what the function now does and the one loss that remains (a parent-typed token is text, by design); update `GeneratedRichText`'s doc comment to say figures now reach the generation wire in prompts and choice bodies and why `answer` and explanations stay narrowed.
- `apps/api/src/extraction/rich-text.spec.ts` — figures grafted back at their tokens with `svg`/`alt` identical to the stored ones; a prefill-then-save-untouched round trip is a no-op on the segments; text edited around a token keeps the figure and the edited text; two figures in one field keep their order; a missing, reordered or altered token throws `RICH_TEXT_FIGURE_MISSING`; an `alt` containing `]` still round-trips; a typed token with no stored figure stays text; the no-figures call is unchanged behaviour.
- `apps/api/src/practicetest/practice-test-schema.ts` — type `prompt` and `GeneratedChoicePayload.body` as the full `RichText`, leave `answer: GeneratedRichText.nullable()`, and state in the doc comment why the two differ. Extend `fakePracticeTestPayload` with a `withFigures: boolean` input: when true, append a figure segment to each prompt and, for Multiple Choice, to each option body, each `alt` distinct per draft/question/option so the distinctness and copy rules are exercised rather than dodged. Existing text is appended to, never replaced.
- `apps/api/src/practicetest/practice-test-prompt.ts` — when any source question carries a figure, `describeSource` lists that question's figures (the `alt` and the sanitized SVG, prompt figures and choice figures labelled apart) beneath its line, and `buildGenerationPrompt` adds the figure rules after rule 5: reproduce a shape a question needs as a `figure` segment in the prompt, or in the options where the source used pictured options; draw a *new* figure, never a copy of a source one, and vary shape, size, count or position; minimal SVG, `viewBox`, only `currentColor`/`none`, no script/style/external reference/embedded image, under 16 KB, at most four per field; give every figure a short `alt` that reads differently from every other option's; never invent a figure for source content you could not read; and where the source asked the child to draw or move a shape on a grid, show the grid and shape and ask where the shape ends up — answered by pictured options or a cell label, never by drawing. A figure-less Extraction takes neither branch.
- `apps/api/src/practicetest/practice-test-prompt.spec.ts` (new) — a figure-less input produces a prompt with no figure wording and no SVG (the Story 4.1 shape); a figure-bearing input lists each source figure's alt and SVG and carries the figure rules; prompt figures and choice figures are distinguishable in the listing; the weighted and unweighted branches both still read as before around the addition.
- `apps/api/src/practicetest/practice-test-payload.ts` — add the figure ceilings to `normalizedRichText`, mirroring `extraction-payload.ts`: `MAX_FIGURES`, `MAX_FIGURE_BYTES`, per-figure `MAX_FIGURE_SVG_BYTES`, `alt.length > MAX_TEXT_LENGTH`, and the post-sanitize re-sum; distinguish the oversize refusal (`PAYLOAD_TOO_LARGE`) from the grammar refusal (`RICH_TEXT_INVALID`) the way `richTextForStorage` does, including the `FIGURE_SVG_TOO_LARGE` cause. Add `FIGURE_NOT_NEW` and `GenerationExpectation.forbiddenFigures: ReadonlySet<string>`; reject a question whose prompt or choice body holds a figure whose sanitized `svg` is in that set. Both ceilings and the copy rule apply to the edit path too, through the same helper — an edit cannot introduce a figure, but it can carry stored ones, and a field that was within bounds must stay within them.
- `apps/api/src/practicetest/practice-test-payload.spec.ts` — a figure in a prompt and in an MC choice body stores sanitized; a figure in `answer` is `PAYLOAD_SHAPE_INVALID`; malicious SVG is `RICH_TEXT_INVALID`; over-cap figure count, aggregate bytes, single-figure bytes and `alt` length are each `PAYLOAD_TOO_LARGE`; a figure matching `forbiddenFigures` is `FIGURE_NOT_NEW`; two pictured options with the same `alt` are `CHOICES_NOT_DISTINCT`; `validateEditedQuestion` keeps a stored figure and still enforces the ceilings. Reuse `svg-figure.fixtures.ts`.
- `apps/api/src/practicetest/practice-test.service.ts` — `GenerationPlan` gains `sourceFigures: Set<string>` (every sanitized figure SVG in the source's prompts and choices) and `hasFigures: boolean`; `planFor` computes them once; the call site passes `hasFigures` to the fake as `withFigures`, the source questions already reach the prompt builder, and `forbiddenFigures: plan.sourceFigures` reaches `validateGenerationPayload`. In `editQuestion`, give `parsed()` the stored field's figures — the stored prompt's for `prompt`, that option's for each choice body, the stored answer's for `answer` — so the inverse can graft them back, and map `RICH_TEXT_FIGURE_MISSING` to the same `BadRequestException` every other parse refusal gets.
- `apps/api/test/practice-test.int-spec.ts` — one figure-bearing case built by patching the real Extraction's stored prompt to carry a figure (the fake extraction payload stays untouched): the job runs, the landed draft question carries a figure segment whose SVG is sanitized, and the draft read answers with it. In the draft-editing block: editing the text around a figure keeps the figure byte-identical in the stored row; an edit whose text drops the `[Figure: …]` token is a 400 and writes nothing.
- `apps/web/src/lib/rich-text.ts` — add `figureTokensPreserved(segments, text): boolean`, the client mirror of the server's rule (every stored figure's `[Figure: <alt>]` token present once, in order), documented as a mirror that disables a doomed save and never as the enforcement.
- `apps/web/src/lib/rich-text.spec.ts` — the mirror agrees with the server rule on the same cases: untouched prefill passes; text edited around tokens passes; dropped, reordered or altered token fails; a field with no figures always passes.
- `apps/web/src/copy/parent.ts` — one sentence for the editor, in the `drafts` block beside `editHint`, saying the `[Figure: …]` text stands for a picture and must be left as it is for the picture to stay. No exclamation marks, no urgency.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx` — show that sentence in the editor only when the question actually holds a figure in any field, with its own `data-testid`, and extend `canSave` with `figureTokensPreserved` for the prompt, each option body and the answer.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` — source-text assertions for the figure hint, its conditional mount and the `canSave` guard, following the file's existing tier.
- `e2e/fixtures.ts` — a fixture that writes a figure segment into a landed draft's question prompt and into one Multiple Choice option body (SQL, like `spreadPracticeTestFormatsFixture`), returning what the test needs to assert.
- `e2e/tests/parent-practice-test.spec.ts` — draft review shows the figure in the question and in the option; opening the editor shows the hint and the `[Figure: …]` token in the field; saving text edited around the token keeps the figure on the re-read; dropping the token leaves the save control disabled.
- `e2e/tests/student-submit-attempt.spec.ts` — a released test with a figure shows it on the question, on the pictured option, and on the results answer key, each as one `role="img"` named by its alternative.

**Acceptance Criteria:**
- Given an Extraction whose questions carry figures, when a Practice Test is generated, then the model is shown each source figure's drawing and told to draw new ones in prompts and pictured options, and a generated figure identical to a source figure is refused rather than stored.
- Given a generated figure, when the payload is validated, then it passes the same sanitizer, text-alternative rule and byte/count ceilings extraction applies, and a figure that fails refuses the whole draft as a content fault that retries and finally routes as an upstream fault with a policy failure reason.
- Given a draft whose questions carry figures, when a parent reviews it, then every figure is drawn in the question and in the options where it appears, with no change to the review surfaces.
- Given a draft question with figures, when its text, options or answer are edited, then every figure in the edited field is stored byte-identical to what was there, an edit that drops a figure's token is refused with nothing written, and no surface offers a way to edit, add or remove a figure.
- Given a released Practice Test with figures, when the student takes it and later views results and the answer key, then every figure is drawn where it appears, in both themes, as one image named by its text alternative.
- Given a Source Test with no figures anywhere, when a Practice Test is generated, then the prompt and the validation are byte-for-byte what Stories 4.1 and 4.2 produced, and no behaviour changes.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 3, low 8)
- defer: 0
- reject: 13: (high 0, medium 2, low 11)
- addressed_findings:
  - `[medium]` `[patch]` The generation prompt quoted `extraction-payload`'s `MAX_FIGURES` while the refusal used `practice-test-payload`'s own copy — two symbols that could drift. The prompt now quotes the symbols the generation validator enforces.
  - `[medium]` `[patch]` `canSave` paired option bodies by array index while the server pairs them by `ordinal`, and failed open on a missing body. The mirror is now keyed by ordinal and fails closed.
  - `[medium]` `[patch]` Nothing proved `plan.sourceFigures` reaches `validateGenerationPayload` — deleting the wiring left every test green. An int case now patches the source Extraction with the exact bytes the fake draws and asserts the job is refused and nothing is charged (mutation-checked).
  - `[low]` `[patch]` The fake's figures collided across questions, contradicting the comment claiming distinct bytes; `fakeFigureSvg` now folds draft, question and field into the drawing.
  - `[low]` `[patch]` Three documented refusal paths were unexercised: `FIGURE_NOT_NEW` on an option body, the `FIGURE_SVG_TOO_LARGE` remap, and the post-sanitize aggregate re-sum. A payload-spec case was added for each.
  - `[low]` `[patch]` A source Extraction whose figures live only in option bodies never drove `planFor`; an int case now patches an extracted choice body and asserts the prompt carries that option's drawing and the figure rules.
  - `[low]` `[patch]` The graft's byte-identity rested on an unstated sanitizer-idempotence assumption; `rich-text.spec.ts` now pins it explicitly.
  - `[low]` `[patch]` `explanation-payload.ts` still said figures are not generated anywhere; the prose now names the explanation wire alone as the narrowed one.
  - `[low]` `[patch]` The editor sentence and two service comments claimed a figure keeps its *place*, while only its order is enforced; copy and comments reworded to the rule that is actually held.
  - `[low]` `[patch]` The student e2e asserted a `viewBox` under a comment about colour inheritance; it now asserts the drawing's stroke resolves to the inherited text colour.
  - `[low]` `[patch]` The disabled-save mirror was exercised on the prompt field only; the parent e2e now alters and restores the token in a pictured option's field too.

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 1: (high 0, medium 0, low 1)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` `editFigureHint` hardcoded "keep two of them in the order they are in," wrong whenever a field holds one figure (the common case) or more than two. Reworded to "keep every one of them" to match the rule actually enforced, with no change to the existing test assertions.
  - `[low]` `[patch]` A `page.spec.tsx` comment claimed a figure "can sit in a... free-text answer," contradicting the schema's own narrowing of generated `answer` to `GeneratedRichText`. Reworded to say the `answer` mirror is defensive, not load-bearing on that invariant.


## Design Notes

**Why the inverse grafts rather than re-parses.** The alternative is sending segments from the browser, which would make the editor an authoring surface for figures and fractions and put a second inverse in the web app — exactly what `rich-text.ts:5-23` and AD-32 exist to prevent. Grafting keeps one inverse, keeps the browser one-directional, and makes "the figure is kept unchanged" literally true: the stored segment is reused, never reconstructed. Splitting on the literal `[Figure: <alt>]` projection rather than a pattern is what makes it exact when an `alt` contains brackets.

**Why a dropped token is a refusal, not a restore.** "Every figure in the edited field is kept unchanged" can be honoured two ways: put the figure back where the parent deleted it, or refuse the edit. Restoring would move a drawing to a position the parent did not choose and would make the field they saved differ from the field they typed. Refusing says what happened and writes nothing, and it is the same shape as `CHOICES_MISMATCHED`: an edit either restates what is there or it is not an edit of it.

**Why no rule requires a generated figure.** Whether a shape is needed is the model's judgement about a question it is writing; a post-hoc rule demanding one would spend `AI_MAX_ATTEMPTS` provider calls and then fail a parent's whole job over drawing style. The parent's review (Story 4.3) is the gate the epic actually relies on for figure quality, and it is already in place.

**Why pictured options lean on `alt`.** Distinctness is computed on `plainTextOf` keys, which render a figure as `[Figure: <alt>]`. Two pictured options therefore read apart exactly when their alternatives do — which is also what a screen-reader user needs — so the existing rule is kept and the prompt is told to make alternatives differ, rather than teaching the validator to compare drawings.

**Expected shape of the widened inverse** (wording is the implementer's, the contract is not):

```ts
export function richTextFromPlainText(
  text: string,
  figures: readonly FigureSegment[] = [],
): RichText
// `[{text 'What shape? '}, figure]` prefills as "What shape? [Figure: A half-circle]";
// saving "Which shape? [Figure: A half-circle]" stores the same figure segment,
// and omitting the token throws RICH_TEXT_FIGURE_MISSING.
```

**Out of this story, by sequence rather than scope.** The sprint change proposal's post-deploy step — re-extracting Source Test `9f295f36…` on production and generating from it — is release work after this ships, not an acceptance criterion; the `9f295f36…`-style ACs are met here by figure corpora of those kinds (circles, half/quarter circles, composite figures, base-ten blocks, shapes on a grid) in the test tiers.

## Verification

**Commands:**
- `pnpm --filter api run test` -- expected: new `practice-test-prompt.spec.ts` passes; `rich-text.spec.ts`, `practice-test-payload.spec.ts` pass with the figure cases added and every pre-existing case unchanged.
- `pnpm --filter web run test` -- expected: `rich-text.spec.ts` and the drafts `page.spec.tsx` pass with the new cases; `RichText.spec.tsx` untouched and passing.
- `pnpm typecheck` -- expected: clean in both workspaces (widening `prompt`/`body` to `RichText` forces every consumer to stay exhaustive).
- `pnpm exec eslint <each touched file>` -- expected: clean. (The `pnpm --filter web run lint` wrapper reports a pre-existing workspace-wide parsing error unrelated to this story.)
- `pnpm --filter api run test:int -- practice-test` -- expected: the generation-with-figures case and both figure-edit cases pass; every pre-existing case unchanged.
- `pnpm --filter e2e run test -- parent-practice-test student-submit-attempt` -- expected: the figure assertions pass on parent review, take and results.
- `grep -rn "dangerouslySetInnerHTML" apps/web/src` -- expected: only the pre-existing negative assertions in spec files.
- `grep -rn "GeneratedRichText" apps/api/src/explanation` -- expected: still the explanation schema's type; explanations stay text-only.

## Auto Run Result

**Summary:** Fresh review pass over the already-implemented Story 4.8 (generated-figure support across the generation wire, the payload validator's figure ceilings and copy rule, the plain-text inverse's figure-aware grafting, and the parent-draft editor's disabled-save mirror). Four review layers (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment) ran over the full diff since baseline `8cac3a70c75149df5f661728c9e1a22edca8df19`; two real issues were found and patched, one test-coverage gap was deferred, the rest were rejected as noise, false premises, or intentional parity with `extraction-payload.ts`'s existing ceiling-checking pattern.

**Files changed this pass:**
- `apps/web/src/copy/parent.ts` — `editFigureHint` no longer hardcodes "two" figures; now says "every one of them."
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx` — corrected a comment that claimed a generated `answer` field can hold a figure; it cannot, by the schema's own narrowing.

**Review findings breakdown:** patch 2 (medium 1, low 1), defer 1 (low 1), reject 12 (low 12), intent_gap 0, bad_spec 0.

**Follow-up review recommendation:** `false` — score `3×1 (medium) + 1×1 (low) = 4`, below the threshold of 5, and no high-severity patch.

**Verification performed:**
- `pnpm --filter web run test -- drafts` — 87 files / 1861 tests passed, including `rich-text.spec.ts`, `page.spec.tsx`, `copy/parent.spec.ts`.
- `pnpm exec eslint "apps/web/src/copy/parent.ts" "apps/web/src/app/parent/drafts/[practiceTestId]/page.spec.tsx"` (from `apps/web`) — clean.
- `pnpm typecheck` — clean in both workspaces.
- Did not re-run `pnpm --filter api run test` (api test suite, unrelated to this pass's changes) or the e2e/int suites: this pass touched only two web files already covered by the web unit run above; the full `api test` run timed out in this session at 5 minutes and was not material to verifying a web-only patch.

**Residual risks:** None introduced by this pass. The deferred FillInTheBlank figure-prompt test-coverage gap is pre-existing to this story's test tier and carries no known functional risk — the figure-bounding and prompt-listing logic it would cover is format-agnostic, not FillInTheBlank-specific code.

