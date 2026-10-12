---
title: 'Story 4.9 — Figure Placement'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_revision: 'e1a038113c20223dfaf0b29e1423577bc5da369a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      No unit case exercises a figure inside a Multiple Choice option tile in
      `AnswerInput.spec.tsx`, so the tile's own markup around a drawing is
      stated only by the browser tier.
    evidence: |-
      `AnswerInput.spec.tsx` renders to static markup with no DOM and its
      Multiple Choice cases assert `aria-labelledby`, `checked` and the
      `label for` pairing on text-only choice bodies; a figure-bearing body
      appears nowhere in the file. The gap predates this story — Story 4.8
      added the figure to the generated choice body without a unit case here —
      and the story's own Block If is now exercised in the browser tier, which
      is the only tier that can observe a press.
    location: apps/web/src/app/student/_components/AnswerInput.spec.tsx
    severity: low
  - summary: >-
      No unit case covers a field with text interleaved between two or more
      figures (text, figure, text, figure), so ordering and per-figure
      isolation in that shape is unverified at the unit tier.
    evidence: |-
      `RichText.spec.tsx`'s two-figure case (`[circle, square]`) has no text
      segment between the figures, and the new layout e2e test interleaves
      trailing text only after the last of three figures, never between two of
      them. No existing case renders `[text, figure, text, figure]` and checks
      that each figure still lands in a block of its own in stored order.
    location: apps/web/src/components/RichText.spec.tsx
    severity: low
  - summary: >-
      `classOf`/`rulesFor` in `RichText.spec.tsx` match the first node with a
      given `data-testid` via a non-global regex, so a markup string with two
      nodes sharing the same test id would silently read only the first one's
      rule.
    evidence: |-
      `classOf` uses `new RegExp(...).exec(markup)` without the `g` flag, so a
      second `data-testid="rich-text-figure"` node in the same markup is never
      reached. No current test renders two figures in one field and then calls
      `rulesFor` on that shared test id, so the gap is latent rather than
      presently masking a failing assertion.
    location: apps/web/src/components/RichText.spec.tsx
    severity: low
  - summary: >-
      The `boxOf` locator-geometry helper is defined twice, nearly identically,
      once in each of the two e2e spec files this story extended.
    evidence: |-
      `e2e/tests/parent-practice-test.spec.ts` and
      `e2e/tests/student-submit-attempt.spec.ts` each declare their own local
      `boxOf(locator)` returning a bounding-box shape; the two differ only in
      that the former also returns `right`. Neither existed before this story
      added layout assertions that needed one.
    location: e2e/tests/parent-practice-test.spec.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 3.9 drew a figure as an `inline-block` svg with `verticalAlign: 'middle'` and a 240px ceiling (`RichText.tsx:118-133`), so a drawing sits *beside* the sentence it belongs to instead of beneath it — the base-ten blocks in the live draft's Q12 read as a picture wedged into a line of words, and a pictured option's text runs alongside its shape. Worse, three of the surfaces that place `RichText` put the segments directly inside a flex row (`drafts/[practiceTestId]/page.tsx:1110-1130`), where a block-level svg alone would still be laid out as a flex item on the same line.

**Approach:** Keep one rule in the one renderer: a field that holds a figure renders its segments inside a block wrapper, which gives the segments a normal-flow formatting context no matter what layout the placing surface uses, and the figure itself becomes a block with vertical spacing from the spacing scale. A field with no figure renders exactly the markup it renders today, so every figure-less surface and its tests are untouched.

## Boundaries & Constraints

**Always:**
- Placement is decided in `apps/web/src/components/RichText.tsx` and nowhere else. No placing surface gains figure-aware layout, no new component appears, and no API, schema, `plainTextOf` or stored-row change is part of this story — where a drawing sits on screen is a render concern and the wire already carries everything needed to decide it.
- A figure is a block: it starts on a new line after the text before it and the text after it starts on a new line below it, at any width, in every field kind (question prompt, Multiple Choice choice body, answer key) and on all four surfaces that render them (draft review, Take Test, results, answer key).
- Two or more figures in one field each take their own line, in stored order — the order `segments` arrives in, which `RichText` already renders in and must keep rendering in.
- The wrapper mounts **only when a figure segment is present** in that field. A field of text and fractions renders the fragment of spans it renders today, byte for byte, because that is every field of every draft generated from a source test with nothing drawn on it, and AC4's "only figures change" is a parity claim about those fields.
- The wrapper is a `span` with `display: block`, never a `div`: every placing surface renders `RichText` inside a `Typography component="p"` or a `component="li"`, and a `div` inside a `p` is markup a browser re-parses out from under the app.
- Story 3.9's drawing rules survive unchanged: responsive `width: 100%`, the `maxWidth`/`maxHeight` ceilings read from `theme.spacing`, `currentColor` paint with no colour set anywhere, `role="img"` with the alternative as the name, and a figure that fails the browser's mirror parse still renders nothing.
- Every size and space in the figure's own rule comes from `theme.spacing` — the vertical spacing this story adds included. No literal px and no colour literal enters this file (AD-32).
- The left edge of the figure lines up with the left edge of the text above it: the wrapper introduces no inset of its own and the figure takes no horizontal margin.

**Block If:**
- Giving a figure its own line cannot be made to hold inside a Multiple Choice option tile without the option ceasing to be one tap target (`AnswerInput.tsx:62-85`) — i.e. the pictured option can no longer be checked by pressing the row the figure is drawn in.

**Never:**
- Do not change `plainTextOf`, `figureTokensPreserved`, `richTextFromPlainText`, the sanitizer, the figure schema, the generation prompt or any stored row. A `[Figure: …]` token's rendering in an editor textarea is text in a form control and is not touched by this story.
- Do not add a caption, a border, a background, a frame, a placeholder or a label around a figure, and do not centre it.
- Do not make text or fraction segments block-level, and do not introduce a line break between two text segments or around a fraction.
- Do not alter the flex, grid or gap layout of any placing surface to make room for this: a surface changed to suit a figure is a second place the rule lives.
- Do not re-extract, re-generate or back-fill the live draft named in the story; its content is already stored correctly and only its rendering was wrong.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Text then figure | `[text 'Which shape is this? ', figure]` | The wrapper mounts; the text draws on its own line and the figure as a block beneath it | No error expected |
| Figure then text | `[figure, text ' Count the parts.']` | The trailing text begins on a new line below the drawing, never beside it | No error expected |
| Two figures | `[text, figure A, figure B]` | Each figure on its own line, A above B, matching stored order | No error expected |
| Figure-only field | `[figure]` (a pictured option) | The figure draws as a block inside the option tile; the tile stays one checkable target | No error expected |
| No figure | `[text, fraction, text]` | No wrapper, no block, markup identical to the pre-story render — segments flow inline | No error expected |
| Figure in a flex row | A pictured option inside the draft-review `display: flex` list item | The wrapper is the one flex item; the figure still breaks the line inside it | No error expected |
| Unparseable figure | `[text, figure with refused svg]` | The figure renders nothing (3.9's rule); the wrapper may still mount and the text is unaffected | No error, nothing drawn |

</intent-contract>

## Code Map

**Files to change:**
- `apps/web/src/components/RichText.tsx` -- the whole implementation. `:28-50` the segment map (where the wrapper decision belongs); `:102-135` `Figure` and its `sx` — `display: 'inline-block'`/`verticalAlign: 'middle'` at `:125-126` are what this story replaces, and `:122-132`'s comment already names the width/height ceilings as spacing-scale reads to preserve.
- `apps/web/src/components/RichText.spec.tsx` -- the unit tier. `:14-20` `render` (SSR under `parentTheme`); `:22` `COMPONENT_SOURCE` (source assertions); `:36-41` the "no role of its own" parity test the wrapper must not break; `:116-250` the figure block, including `:221` the two-figures case to extend with order and placement.

**Read-only anchors (patterns to follow, do not change):**
- `apps/web/src/components/WaitSpinner.spec.tsx:19-46` `classOf` / `rulesFor` -- the project's way to assert a node's *own* emitted declarations from SSR markup, tied to the emotion class the node carries rather than matched by wildcard. The placement assertions need exactly this; copy the idiom, do not export it.
- `apps/web/src/theme/tokens.ts:216-223` `spacing` (`base: 8`) -- what `theme.spacing(n)` resolves to, so a test states the token and not the px.
- `apps/web/src/app/parent/drafts/[practiceTestId]/page.tsx:1086-1092` the prompt render (`Typography component="p"`); `:1109-1130` the choice list item (`display: 'flex'`, `alignItems: 'center'`, `flexWrap: 'wrap'`, `gap`) with the `ml: 'auto'` correct-answer label at `:1134-1142` -- the one flex-parent case, and the reason the wrapper exists rather than `display: block` alone.
- `apps/web/src/app/student/tests/[practiceTestId]/page.tsx:1148-1150`, `apps/web/src/app/student/_components/AnswerInput.tsx:62-85` (`FormControlLabel label`), `apps/web/src/components/AnswerKeyRow.tsx:214-220`, `:246-258`, `:276-286` -- the other three surfaces. All place `RichText` inside a paragraph or a label; none changes.
- `apps/web/src/app/student/_components/ExplainPanel.tsx:537`, `apps/web/src/app/parent/_components/ExplanationReview.tsx:703`, `apps/web/src/app/admin/flagged-explanations/page.tsx:279` -- explanation bodies are `GeneratedRichText` (text and fractions only, 4.8), so the wrapper never mounts there and those surfaces are provably unaffected.
- `apps/web/src/lib/rich-text.ts:30-43` `plainTextOf` and `:64-86` `figureTokensPreserved` -- the edit path's rules. Untouched; named here so the implementer does not go looking for a placement rule in them.
- `e2e/fixtures.ts:472-553` `drawOnPracticeTestFixture` / `DrawnDraft` -- the figure fixture to extend. Its default prompt shape (`text` then `figure`) is asserted verbatim by 4.8's editor cases, so the extension must be opt-in.
- `e2e/tests/parent-practice-test.spec.ts:675-745` the draft figure test, and `e2e/tests/student-submit-attempt.spec.ts:662-732` the released-test figure test -- the two browser cases that already reach a figure on all four surfaces; they are where geometry can be measured, because `apps/web` runs its unit tests without a DOM and no unit test can observe a line box.

**Files to change (browser tier):**
- `e2e/fixtures.ts`, `e2e/tests/parent-practice-test.spec.ts`, `e2e/tests/student-submit-attempt.spec.ts`

## Tasks & Acceptance

**Execution:**
- `apps/web/src/components/RichText.tsx` -- give `RichText` a block wrapper when and only when `segments` holds a `figure`: a `Box component="span"` with `display: 'block'`, `width: '100%'` and no inset, carrying `data-testid="rich-text-block"`; otherwise return today's fragment unchanged. In `Figure`'s `sx`, replace `display: 'inline-block'` with `display: 'block'`, drop `verticalAlign`, keep `width`/`maxWidth`/`maxHeight`/`color`/`fill`/`stroke` as they are, and add vertical spacing with `marginBlock: theme.spacing(1)` and no horizontal margin. Document in the component's own comment why the wrapper is conditional (parity for figure-less fields) and why it is a `span` with `display: block` rather than a `div` (every caller renders it inside a `p` or an `li`).
- `apps/web/src/components/RichText.spec.tsx` -- cover the matrix on the tier that can see it: the figure's own emitted rule says `display:block` and no longer says `inline-block` or `vertical-align`; its vertical spacing and both ceilings are the resolved values of `parentTheme.spacing(1)`, `(30)` and `(24)` rather than written px; it sets no horizontal margin; the wrapper mounts for a field holding a figure and carries `display:block`; a text-and-fraction field mounts no wrapper and renders markup identical to the pre-story render (assert the absence of `rich-text-block` and that the segment spans are still siblings); two figures in one field appear in stored order with the wrapper mounted once; a field whose only figure is refused by the mirror still renders its text. Use a local `classOf`/`rulesFor` pair in the `WaitSpinner.spec.tsx` idiom. Add a `COMPONENT_SOURCE` assertion that no px literal and no `textAlign` entered the file.
- `e2e/fixtures.ts` -- extend `drawOnPracticeTestFixture(parentEmail, options?)` with an opt-in `{ layout?: true }` (default off, so 4.8's cases see the exact prompt they assert): when on, the question's prompt is stored as text, the half-circle figure, a second base-ten-blocks-style figure (a `<g>` of rects, the shape the live draft's Q12 holds), then trailing text. Widen `DrawnDraft` with `secondAlt` and `tailText` (both `null` when the option is off) so the test asserts what was written.
- `e2e/tests/parent-practice-test.spec.ts` -- one new test on draft review with the layout fixture: inside `draft-question-prompt`, the first text span's bottom is at or above the first figure's top, the first figure's bottom is at or above the second figure's top, the second figure's bottom is at or above the trailing text's top, and each figure's left edge equals the first text span's left edge (one-pixel tolerance, measured from `boundingBox()`). Assert the same breaking in the pictured option (`draft-choice`) with the figure-only body, and that the option tile still reads as one row.
- `e2e/tests/student-submit-attempt.spec.ts` -- extend the released-test figure test with the same measured assertions on the two student surfaces the fixture reaches: the figure in `take-test-question` sits below the question text and is left-aligned with it, and so does the one in the answer key row's `answer-key-prompt` after hand-in.

**Acceptance Criteria:**
- Given any field that holds a figure, when it renders on draft review, Take Test, results or the answer key at any width, then the figure occupies its own line beneath the text before it and nothing is drawn beside it on that line.
- Given a pictured Multiple Choice option, when it renders inside the draft-review list item's flex row or the student's option tile, then the figure still breaks the line and the tile remains one checkable target.
- Given a field of text and fractions only, when it renders anywhere, then the markup is what it was before this story — no wrapper, inline flow, no new element — and every pre-existing `RichText`, drafts-page, answer-key and explanation test passes untouched.
- Given a figure drawn on any surface, when its computed box is measured, then its width is still responsive under Story 3.9's ceilings, its paint still resolves to the surrounding text colour in both themes, and every space around it resolves to a spacing-scale value.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 19: (high 0, medium 0, low 19)
- addressed_findings:
  - `[medium]` `[patch]` A figure taller than it is wide was not left-aligned with the text above it, which AC3 requires: the element box is the full column under the height ceiling, so a tall drawing letterboxes inside it and the default `xMidYMid` centred it — a `0 0 4 40` number line floated ~108px from the left edge. `preserveAspectRatio="xMinYMid meet"` is now set after the attribute spread (the attribute is absent from the allowlist, so no stored row can carry one), proven by a tall figure added to the e2e layout fixture and mutation-checked: removing the line fails that assertion with `Expected: <= 8, Received: 108`.
  - `[medium]` `[patch]` The story's own Block If — a pictured option stays one checkable target — was unexercised: the student test checked `getByRole('radio').first().check()`, which Playwright performs on the input and bypasses the tile entirely. The test now presses the figure inside its own `answer-choice` tile and asserts that option's radio became checked.
  - `[low]` `[patch]` The new doc comment claimed every placing surface renders `RichText` inside a `p` or an `li`, which is wrong — the student option tile passes it as a `FormControlLabel` label. The enumeration now names all three placements and keeps the conclusion that holds across them.
  - `[low]` `[patch]` The layout test read `spans.first()`/`spans.last()` with no count guard, so a fixture change leaving one text segment would silently point both reads at one node and make the stacking assertions vacuous. The segment count is asserted first, and the trailing text's left edge is now checked flush with the lead text's.
  - `[low]` `[patch]` AC1 says "at any width" and the browser tier measured one viewport. The measurement block is now a closure run at the desktop width and again at 390×844, with no extra test and no second generation run.
  - `[low]` `[patch]` `apps/web/next-env.d.ts` rode along in the reviewed diff — a generated file whose imports `next build` flips between dev and build paths, unrelated to figure placement. Reverted after the final build and browser run, so it stays out of this story's commit.

### 2026-10-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 3: (high 0, medium 0, low 3)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - none

## Design Notes

**Why a wrapper rather than `display: block` alone.** `display: block` on the svg is sufficient inside a paragraph, and insufficient in the one surface that matters most: the draft-review option list item is `display: flex`, so segments are flex items and a block svg is simply the next item on the row — the bug the story is about, surviving the obvious fix. The wrapper re-establishes normal flow around the segments wherever they are placed, which is what makes the AC's "at any width, on every surface" a property of the renderer instead of a coincidence of four call sites. It is conditional so that the far commoner figure-less field keeps its exact current markup and this story cannot regress a surface it never wanted to touch.

**Why geometry is proved in the browser tier.** `apps/web`'s unit tests render to static markup with no DOM, so they can assert the declarations a node carries but never that one box sits below another. The unit tier therefore pins the rule (`display:block`, spacing-scale margins, wrapper presence) and the browser tier pins the consequence (measured boxes, stacked and left-aligned). Neither alone is the acceptance criterion.

**Expected shape** (wording is the implementer's; the contract is not):

```tsx
const hasFigure = segments.some((segment) => segment.kind === 'figure');
const drawn = segments.map(/* unchanged */);
return hasFigure ? (
  <Box component="span" data-testid="rich-text-block" sx={{ display: 'block', width: '100%' }}>
    {drawn}
  </Box>
) : (
  <>{drawn}</>
);
```

**The live draft named in the ACs.** `1075e3d5…`'s Q12 already stores its base-ten blocks correctly; only the placement was wrong, so it is met by rendering — no data change, no re-generation, nothing owed outside the repo. The browser tier carries a base-ten-blocks-shaped figure for exactly that reason, and seeing it on production is release observation after this ships, not an acceptance criterion (the same sequencing 4.8 recorded for `9f295f36…`).

## Verification

**Commands:**
- `pnpm --filter web run test -- RichText` -- expected: the new placement cases pass and every pre-existing figure, fraction and text case passes unchanged.
- `pnpm --filter web run test` -- expected: clean; in particular the drafts `page.spec.tsx`, `AnswerKeyRow`, `AnswerInput` and explanation specs pass with no edits, which is the parity claim.
- `pnpm typecheck` -- expected: clean in both workspaces.
- `pnpm exec eslint apps/web/src/components/RichText.tsx apps/web/src/components/RichText.spec.tsx e2e/fixtures.ts e2e/tests/parent-practice-test.spec.ts e2e/tests/student-submit-attempt.spec.ts` -- expected: clean. (The `pnpm --filter web run lint` wrapper reports a pre-existing workspace-wide parsing error unrelated to this story.)
- `pnpm --filter e2e run test -- parent-practice-test student-submit-attempt` -- expected: the measured placement assertions pass on draft review, Take Test and the answer key, and 4.8's editor and token cases pass unchanged.
- `grep -n "px\|#" apps/web/src/components/RichText.tsx` -- expected: no px literal and no colour literal; every size and space is a `theme.spacing` read.
- `git diff --stat -- apps/api apps/web/src/lib apps/web/src/copy` -- expected: empty. Placement is a render concern; nothing on the wire, in the inverse or in copy changes.

## Auto Run Result

**Summary:** This pass is a fresh, unattended review of the already-implemented and already-committed figure-placement change (commit `969d987`, baseline `e1a0381`). No code was changed in this pass; the pass re-reviewed the diff against the intent and triaged new findings.

**Files changed (from the original implementation, unchanged this pass):**
- `apps/web/src/components/RichText.tsx` -- figure wrapper (`rich-text-block`) mounted only when a segment is a figure; `Figure`'s `sx` switched from `inline-block`/`vertical-align:middle` to `display:block` with `marginBlock` and `preserveAspectRatio="xMinYMid meet"`.
- `apps/web/src/components/RichText.spec.tsx` -- unit coverage for the wrapper, the figure's own block rule, spacing-scale values, no-figure parity, and the letterboxing `preserveAspectRatio` case.
- `e2e/fixtures.ts` -- opt-in `{ layout: true }` on `drawOnPracticeTestFixture` adding a second and third (tall) figure plus trailing text.
- `e2e/tests/parent-practice-test.spec.ts`, `e2e/tests/student-submit-attempt.spec.ts` -- browser-tier geometry assertions (stacking order, left-alignment, tap-target survival) across draft review, Take Test and the answer key.

**Review findings breakdown (this pass):** patches applied: 0; items deferred: 3 (all low — a missing interleaved-text-and-multiple-figures unit case, a latent non-global-regex gap in `classOf`/`rulesFor` on a shared `data-testid`, and a near-duplicate `boxOf` e2e helper across two spec files); items rejected: 14 (all low — scope-out-of-bounds suggestions such as RTL handling, changelog notes, AX-tree assertions, and points already covered by the existing allowlist, spec-mandated test idiom, or matrix-permitted behavior).

**Follow-up review recommendation:** `false` — this pass triaged 0 `patch` findings (score 0, below the 5 threshold; no high-severity patch).

**Verification performed:** No commands were re-run this pass since no code changed; the prior implementation pass's verification commands (listed above under `## Verification`) remain the record of what was checked when the code was written.

**Residual risks:** The three newly deferred items are test-coverage gaps, not behavior defects — none affects what ships to the four placing surfaces this story covers.

