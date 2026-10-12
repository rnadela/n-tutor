---
title: 'Story 3.9 — Figures in Extraction'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_revision: 'e922b0142443224a0fe5c668a6cfccae261ddfd1'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Extraction bounds figures per rich-text field (MAX_FIGURES, MAX_FIGURE_BYTES)
      but not per document, so a payload with many questions could still persist
      several megabytes of figure SVG in one extraction.
    evidence: |-
      `requireBoundedRichText` in `apps/api/src/extraction/extraction-payload.ts`
      sums figure bytes within one rich-text field only; nothing in
      `validateExtractionPayload` sums figure bytes across every question and
      context body in a document, and `MAX_SEGMENTS` bounds segment count, not
      figure byte weight.
    location: >-
      apps/api/src/extraction/extraction-payload.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Rich text has only `text` and `fraction` segments, so a shape photographed on a Source Test page is extracted as bracketed prose (`"[A half-circle figure is shown.]"`) or dropped as uninterpretable — which guts early-grade Math, where the figure *is* the question.

**Approach:** Add a third rich-text segment kind, `figure`, carrying model-emitted SVG plus a required text alternative; sanitize every figure's SVG through one allowlist parse at parse-for-storage time on the API and again before rendering on the web; instruct Extraction to emit figures; render them inline, in the current text colour, as one image named by its alternative.

## Boundaries & Constraints

**Always:**
- The sanitizer is an **allowlist parse**, never a regex strip: unparseable input or any construct outside the grammar is a rejection, not a best-effort clean. Elements: `svg g circle ellipse rect line polyline polygon path text tspan`. Attributes: `viewBox transform x y x1 y1 x2 y2 cx cy r rx ry width height points d stroke-width stroke-dasharray fill stroke font-size text-anchor dominant-baseline`. Everything else — `script style image use foreignObject`, comments, doctype, processing instructions, `on*`, `href`/`xlink:href`, `url(...)`, `javascript:`, namespaces beyond the root, embedded HTML, CSS — is rejected or dropped per the matrix below.
- The root is `<svg>` and must carry a `viewBox`; root `width`/`height` are stripped; every `fill`/`stroke` is rewritten to `currentColor` or `none` (nothing else survives) — that is what keeps dark mode honest and keeps no colour hardcoded.
- Sanitization happens where rich text is **parsed for storage**, inside `parseRichText`, so every source (extraction now, generation and edit later) is covered by construction and no call site can opt out.
- A figure that fails sanitization is an AD-30 content fault: on the extraction path it raises `ExtractionPayloadInvalid(RICH_TEXT_INVALID)` and is routed `UpstreamFault`, exactly like every other post-hoc rejection. No new failure kind, no repair path, no partial payload.
- `alt` is a required, non-empty string on both API and web; `plainTextOf` emits a figure as `[Figure: <alt>]` on **both** sides, byte-identically, so grading, dedupe, explanation and topic prompts keep working on text alone.
- The web mirror is hand-written and DOM-free (same convention as `lib/rich-text.ts`): `apps/web` runs its unit tests with `environment: 'node'`, so a rule reachable only through a browser DOM is a rule no test can state. No new runtime dependency on either side — no DOMPurify, no XML parser, no jsdom.
- The web renders a figure as real React elements built from the parsed tree, never `dangerouslySetInnerHTML`.
- Exposed to assistive tech as exactly one image: `role="img"` + `aria-label={alt}` on the root `<svg>`, announced once.

**Block If:**
- The sanitizer cannot be made to reject every case of the malicious corpus below without a new runtime dependency.

**Never:**
- Do not implement generation-side figures, draft review/edit figure preservation, or the `plainTextOf` → `richTextFromPlainText` round-trip fix — that is Story 4.8. `richTextFromPlainText` stays text-and-fraction-only here; its figure loss is 4.8's to close.
- Do not touch `fakeExtractionPayload` or any e2e spec: the fake payload's exact text is asserted across Epic 3 and 4 specs, and extraction is not a browsable surface, so a figure has no browser-visible path until 4.8 ships generation. Figure e2e coverage belongs to 4.8.
- Do not offer figure editing, do not add a figure to the explanation prompt's instructions, do not back-fill existing extractions, do not re-extract any production Source Test.
- No regex-based SVG scrubbing, no `svgo`, no colour literal anywhere in the rendered figure, no prose fallback that describes the shape.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legible printed figure | Figure segment, `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="black"/></svg>`, alt `"A circle"` | Stored sanitized: root keeps `viewBox`, `stroke` becomes `currentColor`, `fill` stays `none`; question stays `usable` | No error expected |
| Root width/height | `<svg viewBox="0 0 8 8" width="200" height="200">…` | Root `width`/`height` stripped; inner shapes keep theirs | No error expected |
| Colour literal | `fill="#ff0000"`, `stroke="url(#grad)"` | Rewritten to `currentColor` (any non-`none` value) / rejected for `url(` | `url(...)` → content fault |
| Script element | `<svg viewBox="0 0 1 1"><script>alert(1)</script><circle …/></svg>` | Rejected | Content fault |
| Event handler | `<circle onload="x()" …/>` | Rejected | Content fault |
| `foreignObject` / `image` / `use` / `style` | Any of them present | Rejected | Content fault |
| External reference | `href`, `xlink:href`, `javascript:` URL anywhere | Rejected | Content fault |
| Comment / doctype / PI / CDATA | `<!-- … -->`, `<!DOCTYPE …`, `<?xml …?>`, `<![CDATA[…]]>` | Rejected | Content fault |
| No viewBox | `<svg><circle …/></svg>` | Rejected | Content fault |
| Non-svg root | `<div>…</div>`, bare text, empty string | Rejected | Content fault |
| No drawable content | `<svg viewBox="0 0 1 1"><g></g></svg>` | Rejected | Content fault |
| Oversize | SVG byte length > 16 KB, or element count over the ceiling | Rejected | Content fault / `PAYLOAD_TOO_LARGE` |
| Empty or blank alt | `alt: ""` or `"   "` | Rejected | Content fault |
| Overlong alt | `alt.length > MAX_TEXT_LENGTH` | Rejected | `PAYLOAD_TOO_LARGE` |
| Figure-only field | Segments are one figure, no text | Valid — a figure is content, so the field is not "empty" | No error expected |
| Plain-text projection | `[{text "What shape? "}, {figure alt "A half-circle"}]` | `"What shape? [Figure: A half-circle]"` on API and web alike | No error expected |
| Cropped / un-photographed figure | Model cannot read the printed shape | Recorded in `uninterpretable` with `dependsOnUninterpretable` on the question, never guessed at as a figure | No error expected |
| Web render of a stored figure | Sanitized figure reaches `RichText` | Re-sanitized, drawn inline, responsive width with a max height, inherits text colour, one `role="img"` named by `alt` | Re-sanitization failure renders nothing (no prose, no broken glyph) |

</intent-contract>

## Code Map

**Read-only anchors (patterns to follow, do not change):**
- `apps/api/src/extraction/rich-text.ts:13-21` — the note that one Zod schema is both storage shape and wire contract: strict Structured Outputs forbids `minItems`/`maxLength`/`refine` and requires every property, so shape lives in the schema and **constraints live in `parseRichText`**. The figure's non-empty `alt` and its sanitization are constraints, so they go there.
- `apps/api/src/extraction/rich-text.ts:40-45` — `FractionSegment`: the precedent for a structured segment whose parts cannot be recovered from a glyph, including the `nullable`-and-required idiom.
- `apps/api/src/extraction/extraction-payload.ts:12-25`, `:65-74` — AD-30 post-hoc pass: whole-document rejection, no repair; ceilings live here because the wire cannot carry them (`MAX_SEGMENTS = 200`, `MAX_TEXT_LENGTH = 5_000` at `:80-81`).
- `apps/api/src/extraction/extraction-payload.ts:231-238` — `requireBoundedRichText`: the one place a per-segment ceiling is enforced. The figure branch belongs here.
- `apps/api/src/extraction/extraction-payload.ts:334-339` (prompt + choices) and `:260-262` (context body) — today each site runs `isRichText` as a **guard** and then stores the value unchanged. Sanitization rewrites, so these three sites must store what the parse returns.
- `apps/api/src/extraction/extraction-payload.ts:143-148` — `usableFrom`: `!dependsOnUninterpretable && confidence !== 'Low'`. Untouched; a figure question is usable by the same rule.
- `apps/api/src/extraction/extraction.service.ts:587-640` — `fail()`: `ExtractionPayloadInvalid` is **not** in the `clientFault` set (`:601-608`), so it routes `UpstreamFault` and is retryable, and `failureReason` is a policy constant, never an exception message (AD-20).
- `apps/api/src/sourcetest/source-test-policy.ts:59` `MAX_PAGE_BYTES`, `:77` `MAX_DECODED_PIXELS` — the byte-cap and expansion-guard convention to mirror for the 16 KB figure cap and the element-count ceiling.
- `apps/api/src/extraction/rich-text.spec.ts:1-2` — the pure-helper spec convention: plain `vitest` imports, no Nest testing module.
- `apps/web/src/components/RichText.tsx:21-41` — the kind switch, the index-as-key rationale, and the deliberate `return null` for an unheard-of kind (`:35-39`). The figure branch goes beside the fraction branch; the `null` arm stays for kinds a later build adds.
- `apps/web/src/components/RichText.tsx:54-73` — `Fraction`: `role="math"` + `aria-label` replacing the subtree, MUI `Box component="span"` with `sx`, `data-testid` plus data attributes for assertions. `Figure` mirrors this shape with `role="img"`.
- `apps/web/src/lib/rich-text.ts:5-23` — the one-direction rule and the "pure and DOM-free because the unit suite has no DOM" constraint; `:25-33` the hand-mirrored `plainTextOf`.
- `apps/web/src/lib/parent-api.ts:285-287` — `RichTextSegment`, the hand-mirrored wire type (no shared package, no codegen).
- `apps/web/src/components/RichText.spec.tsx:9-15` — `renderToStaticMarkup` + `markup.toContain(...)`; `:54-60` the fraction a11y assertion to mirror; `:77-95` the unknown-kind test, which uses `kind: 'diagram'` and asserts no `aria-label` — it must keep passing, so the figure branch must not catch unknown kinds.
- `apps/web/src/theme/tokens.ts:5-13`, `apps/web/src/theme/theme.ts:93-106` — every colour carries a light and a dark value and nothing hardcodes a colour, a size or a spacing figure; `currentColor` appears nowhere in `apps/web/src` today, so the figure introduces it.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md:623` — the do/don't row this story implements, verbatim.
- `apps/api/src/extraction/extraction-prompt.ts:16-27` — `EXTRACTION_PROMPT`: numbered rules, each mirrored by a check in code; rule 2 is the fraction rule the figure rule sits beside, rule 4 is the never-guess rule it must not weaken.
- `apps/api/src/extraction/extraction-schema.ts:66-78` — `prompt: RichText`, `choices: z.array(RichText)`: the figure reaches the extraction wire through the union alone, so **no extraction schema change is needed**. The same union was reused by `practice-test-schema.ts:3` and `explanation-schema.ts:32`, which would have widened what those models may emit; both now take a narrowed `GeneratedRichText` (text and fractions only) until Story 4.8 lifts it, because a generated draft's edit path round-trips every field through `plainTextOf` → `richTextFromPlainText` and would silently delete a figure. Both paths also normalize through `parseRichText` on the way into storage, so the sanitizing is already in place for the build in which the wire widens.

**Files to create:**
- `apps/api/src/extraction/svg-figure.ts`, `apps/api/src/extraction/svg-figure.spec.ts`
- `apps/web/src/lib/svg-figure.ts`, `apps/web/src/lib/svg-figure.spec.ts`

**Files to change:**
- `apps/api/src/extraction/rich-text.ts`, `rich-text.spec.ts`
- `apps/api/src/extraction/extraction-payload.ts`, `extraction-payload.spec.ts`
- `apps/api/src/extraction/extraction-prompt.ts`
- `apps/web/src/lib/parent-api.ts`
- `apps/web/src/lib/rich-text.ts`, `rich-text.spec.ts`
- `apps/web/src/components/RichText.tsx`, `RichText.spec.tsx`

## Tasks & Acceptance

**Execution:**
- `apps/api/src/extraction/svg-figure.ts` (new) — one pure module: `parseFigureSvg(svg: string): FigureElement` (allowlist parse to a node tree, throwing on every rejection above), `serializeFigureSvg(root: FigureElement): string` (canonical, double-quoted attributes, escaped text), `sanitizeFigureSvg(svg: string): string` (parse → serialize), the allowlisted element/attribute sets, `MAX_FIGURE_SVG_BYTES = 16 * 1024`, an element-count ceiling, and one exported message constant per rejection reason. Written as a parse rather than a strip because a dropped-pattern scrubber is only as good as its pattern list, and written here (beside `rich-text.ts`, inside the module that owns rich text per AD-32) rather than in a shared package because there is none.
- `apps/api/src/extraction/svg-figure.spec.ts` (new) — the malicious corpus as cases, each asserting rejection: `<script>`, `on*` handler, `foreignObject`, `image`, `use`, `style`, `href`/`xlink:href`, `javascript:` URL, `url(...)` in a paint attribute, comment, doctype, processing instruction, CDATA, unknown element, unknown attribute, missing `viewBox`, non-`svg` root, unbalanced/unparseable markup, no drawable content, over-cap bytes, over-cap element count, blank input. Plus the positive cases: colours rewritten to `currentColor`/`none`, root `width`/`height` stripped, `viewBox` preserved, inner geometry preserved, idempotence (sanitizing a sanitized SVG is a no-op).
- `apps/api/src/extraction/rich-text.ts` — add `FigureSegment` (`kind: 'figure'`, `svg: z.string()`, `alt: z.string()` — both required strings, strict-Structured-Outputs compatible), add it to `RichTextSegment`'s discriminated union, and extend `parseRichText` to (a) reject a blank `alt`, (b) replace `svg` with `sanitizeFigureSvg(svg)` and return the normalized array, (c) count a figure as content for the `hasContent` rule. Extend `plainTextOf` to emit `[Figure: <alt>]`. Leave `richTextFromPlainText` text-and-fraction-only and document in its doc comment that a figure cannot survive the plain-text round trip and that closing it is Story 4.8's. Add `RICH_TEXT_FIGURE_ALT_EMPTY` beside the existing refusal constants.
- `apps/api/src/extraction/rich-text.spec.ts` — figure cases: sanitized `svg` comes back rewritten (so the parse is a normalizer, not a guard); blank/whitespace `alt` throws; a malicious `svg` throws through `parseRichText` and makes `isRichText` false; a figure-only field is valid; `plainTextOf` renders `[Figure: <alt>]` and a mixed text+figure field concatenates in order; `richTextFromPlainText` round-trip of a figure's plain text yields text segments (the documented loss, asserted so 4.8 has a failing-to-fixed anchor).
- `apps/api/src/extraction/extraction-payload.ts` — switch the three storage sites from guard-then-store to **store-what-the-parse-returns**: one internal helper (e.g. `richTextForStorage(value: unknown): RichText`) that runs `parseRichText` in a try/catch and throws `ExtractionPayloadInvalid(RICH_TEXT_INVALID)` on any failure, used at the context body, the question prompt and each choice, with its result assigned into the normalized document. Add the figure branch to `requireBoundedRichText`: `alt.length > MAX_TEXT_LENGTH` or `svg` byte length over `MAX_FIGURE_SVG_BYTES` → `PAYLOAD_TOO_LARGE`. No new error constant and no new `AiFailureKind`: a figure fault must route exactly like every other post-hoc rejection.
- `apps/api/src/extraction/extraction-payload.spec.ts` — a payload whose question prompt carries a figure stores the **sanitized** SVG (colour rewritten, root sizing stripped) and keeps the question `usable`; a figure in a choice body and in a context body sanitize the same way; a malicious figure anywhere raises `ExtractionPayloadInvalid` with `RICH_TEXT_INVALID`; an over-cap `svg` and an over-length `alt` raise `PAYLOAD_TOO_LARGE`; a question that depends on an unreadable region is still unusable even when it carries a figure.
- `apps/api/src/extraction/extraction-prompt.ts` — add one numbered rule, beside the fraction rule, stating: reproduce a printed shape or diagram a question needs as a `figure` segment in the prompt or the choice it belongs to, as a minimal SVG using only basic shapes, paths, groups and text, with a `viewBox`, no colours other than `currentColor`/`none`, no scripts, styles, external references or embedded images, under 16 KB; give every figure a short `alt` describing what is drawn; and never invent a figure for content you could not read — a cropped, un-photographed or unreadable figure stays in `uninterpretable` under the existing never-guess rule. Keep the existing rules' wording intact.
- `apps/web/src/lib/parent-api.ts` — add `| { kind: 'figure'; svg: string; alt: string }` to `RichTextSegment` and note in its doc comment that the SVG arriving here is already server-sanitized and is re-sanitized before render regardless (neither side trusts the other).
- `apps/web/src/lib/svg-figure.ts` (new) — the hand-written mirror of the API parser, same allowlists, same ceilings, same rejections, DOM-free: `parseFigureSvg(svg): FigureElement` returning the node tree the renderer walks, and the exported element/attribute allowlists plus an explicit allowlisted-attribute → React-prop map (`viewBox`, `strokeWidth`, `strokeDasharray`, `fontSize`, `textAnchor`, `dominantBaseline`, …) so the renderer can only ever set a prop that is on the list. Document that it is a hand mirror of `apps/api/src/extraction/svg-figure.ts` and that the two allowlists must be changed together.
- `apps/web/src/lib/svg-figure.spec.ts` (new) — the same malicious corpus as the API spec, asserting the mirror rejects every case, plus the positive parse cases and the attribute-map coverage (every allowlisted attribute has a mapping; nothing outside the allowlist has one).
- `apps/web/src/lib/rich-text.ts` — extend `plainTextOf` with the `figure` arm emitting `[Figure: <alt>]`, byte-identical to the API's.
- `apps/web/src/lib/rich-text.spec.ts` — assert the figure projection matches the API's wording exactly, including a mixed field's ordering.
- `apps/web/src/components/RichText.tsx` — add a `figure` branch rendering a `Figure` component beside `Fraction`: re-parse the stored SVG with `parseFigureSvg`, render the tree as real React elements (`React.createElement` over the allowlisted tag + mapped props — never `dangerouslySetInnerHTML`), root as MUI `Box component="svg"` with `role="img"`, `aria-label={segment.alt}`, `data-testid="rich-text-figure"`, the parsed `viewBox`, `sx` giving `width: '100%'`, `maxWidth` and `maxHeight` from `theme.spacing`, `fill: 'currentColor'`, `stroke: 'currentColor'` and `color: 'inherit'`. A parse failure renders `null` — no prose, no placeholder glyph. Keep the unknown-kind `return null` arm.
- `apps/web/src/components/RichText.spec.tsx` — a figure renders one `role="img"` whose `aria-label` is the alt verbatim, contains the parsed shape elements and the `viewBox`, and carries no `<script>`, no `on*` attribute, no `href`, no `style=` and no colour literal; a malicious stored figure renders nothing at all; `COMPONENT_SOURCE` contains no `dangerouslySetInnerHTML`; the existing text, fraction and unknown-kind tests still pass unchanged.

**Acceptance Criteria:**
- Given any rich-text field from any source, when it is parsed for storage, then the value stored is the parser's own output with every figure's SVG sanitized, and no call site stores a figure the sanitizer has not rewritten.
- Given a figure whose SVG violates the allowlist, when Extraction's payload is validated, then the whole payload is rejected as `ExtractionPayloadInvalid` and the job fails as an `UpstreamFault` with a policy failure reason, never as a new failure kind and never with the exception's message.
- Given an extraction run over a page with a legibly printed figure a question needs, when the payload is normalized, then the figure is a segment inside that question's prompt or choice, the question is `usable`, and no bracketed prose description of a shape is stored in its place.
- Given the same sanitizer corpus, when the API spec and the web spec run, then every malicious case is rejected on both sides and the two allowlists are identical in content.
- Given a stored figure on any surface that renders rich text, when the web draws it, then it is one image named by its text alternative, inherits the text colour in both themes, and its markup contains no script, handler, external reference, embedded HTML or colour literal.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 17: (high 0, medium 8, low 9)
- defer: 0
- reject: 11: (high 0, medium 1, low 10)
- addressed_findings:
  - `[medium]` `[patch]` Only the extraction path adopted store-what-the-parse-returns; the generation and explanation validators still guarded with `isRichText` and stored the value as received, so a figure there was persisted un-normalized. Both now store `parseRichText`'s output, with RAW/SANITIZED specs on each path.
  - `[medium]` `[patch]` A figure was legal on the generation and explanation wire today, and the draft-edit plain-text round trip would have silently deleted it in this build rather than 4.8's. Those two schemas now use a narrowed `GeneratedRichText` (text + fraction only) until 4.8 lifts it.
  - `[medium]` `[patch]` `FIGURE_SVG_NO_DRAWABLE_CONTENT` was bypassed by an element that draws nothing (`<text></text>`, `<circle/>` with no `r`); drawability now requires per-tag geometry, positive where a zero would draw nothing.
  - `[medium]` `[patch]` A text-only figure re-admitted the prose-description anti-pattern the story exists to remove; a figure must now hold at least one non-text drawable (`FIGURE_SVG_WORDS_ONLY`).
  - `[medium]` `[patch]` A nested `<svg>` kept its own viewport and sizing because `width`/`height` were stripped on the root only; `svg` as a child element is now rejected outright.
  - `[medium]` `[patch]` `viewBox`'s value was never validated (`viewBox=""` passed); it must now be four numbers with positive width and height.
  - `[medium]` `[patch]` The byte cap was checked on input only, so entity escaping on serialize could push the stored string over it and make the web mirror refuse the figure; the cap is now re-checked on the serialized output.
  - `[medium]` `[patch]` No budget above a single figure; added a per-field figure count and total figure byte budget beside the existing extraction ceilings.
  - `[low]` `[patch]` Duplicate attribute names were accepted last-wins; now refused as unparseable.
  - `[low]` `[patch]` Allowlisted attribute values were unvalidated (`cx="hello world"`, `r="-5"`); numeric and number-list attributes are now validated, with `d` and `transform` deliberately left alone and the reason stated in code.
  - `[low]` `[patch]` `alt` was stored untrimmed and could carry control characters into `aria-label` and `[Figure: …]`; now trimmed, with control characters refused.
  - `[low]` `[patch]` Four negative assertions in `RichText.spec.tsx` were satisfied by a component rendering nothing; each is now paired with a positive assertion.
  - `[low]` `[patch]` Added renderer coverage for the prop map, nested `text`/`tspan` characters, two figures each named, and identical sibling shapes.
  - `[low]` `[patch]` The malicious corpus was hand-duplicated in both workspaces with nothing comparing it; moved to a shared fixture module imported by both specs (29 → 47 rows) with a message-parity test.
  - `[low]` `[patch]` An `as never` cast in the web spec hid structural drift between the two parse trees; replaced with a structural walk of both parses.
  - `[low]` `[patch]` The payload spec's figure fixtures were cast out of the type system; now typed, so `pnpm typecheck` sees a figure inside a payload.
  - `[low]` `[patch]` Prompt rule 4 restated the allowlist and cap as unpinned prose with no spec for the prompt at all; added `extraction-prompt.spec.ts` pinning it to `FIGURE_ELEMENTS` and `MAX_FIGURE_SVG_BYTES`, plus a seam test running `sanitizeFigureSvg`'s own output through the web view type into `RichText`.

### 2026-10-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - `[medium]` `[patch]` `shapeDraws` (both `apps/api/src/extraction/svg-figure.ts` and its web mirror) let an ellipse with one radius zero, a `polyline`/`polygon` with fewer than two distinct points, and a `path` holding only `moveto`/`closepath` pass the "draws something" gate — each renders nothing, re-admitting the empty-figure case the gate exists to refuse. Ellipse now requires both radii positive; `polyline`/`polygon` require two distinct coordinate pairs; `path` requires a real drawing command (`L`/`H`/`V`/`C`/`S`/`Q`/`T`/`A`), on both sides. New shared-fixture rows pin all three; existing positive fixtures already exercised the fixed behavior and still pass.
  - `[low]` `[patch]` `resolveReference` (both copies) decoded a numeric character reference in the UTF-16 surrogate range (e.g. `&#55296;`) into an unpaired surrogate instead of refusing it, which would have corrupted whatever read the decoded text next. Now rejected as `FIGURE_SVG_UNPARSEABLE`, pinned by a new shared-fixture row.
  - `[low]` `[patch]` `hasControlCharacter` (API `rich-text.ts`) refused C0/DEL/C1 but not zero-width or bidi-override characters (ZWSP, ZWJ, LRM/RLM, the embedding/override and isolate controls, BOM), which can make a stored `alt` read or display differently from how it is spoken — the same unspeakable-character concern the existing control-character refusal already covers. Extended the same check; added the first test coverage for this refusal path, which had none.
  - `[low]` `[patch]` `richTextForStorage`'s doc comment claimed every oversize figure reports `PAYLOAD_TOO_LARGE`, but a figure whose raw bytes are under the cap and whose *escaped* canonical form exceeds it threw from deeper inside `parseRichText` and was reported as the generic `RICH_TEXT_INVALID` instead — the payload was still correctly rejected, only the reported reason was wrong. Now caught and remapped to `PAYLOAD_TOO_LARGE`, with a new test pinning it alongside the existing raw-input-oversize test.
- All four patches verified: `pnpm --filter api run test` (157 passed, up from 150) and `pnpm --filter web run test` (95 passed, up from 90) for the touched spec files; `pnpm typecheck` clean in both workspaces; `pnpm exec eslint` clean on every touched file; the `dangerouslySetInnerHTML` and new-dependency verification greps both still clean.
- One `defer`: no document-wide ceiling on total figure bytes across a whole extraction payload (only per-field `MAX_FIGURES`/`MAX_FIGURE_BYTES`) — recorded in frontmatter `deferred`, not blocking, pre-existing gap in `validateExtractionPayload`'s document-level budget rather than something this story's figure segment introduced.
- The other eleven reviewer findings (parser duplication between workspaces, lack of a document-wide test, `FIGURE_SVG_UNPARSEABLE` covering three distinct malformed-markup shapes, the `]`-delimiter ambiguity for Story 4.8's future plain-text parser, unvalidated `d`/`transform` complexity, no fuzz testing, weak wire-schema-rejection assertions, `MAX_FIGURES` not mirrored onto the practice-test edit path, missing `opacity` attributes, alt-whitespace collapsing, and several intent-alignment observations about scope choices already decided in this story's own Design Notes) were rejected: each is either an already-decided and documented design trade-off, bounded by an existing ceiling, explicitly out of this story's scope per the intent-contract's Never section (4.8 owns figure e2e coverage and the plain-text round trip), or — for the practice-test edit path — traced and found unreachable, since the edit DTO carries plain strings only and the generation/explanation wire excludes the `figure` kind, so no new figure can enter storage through that path.

### 2026-10-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` The field-level aggregate `MAX_FIGURE_BYTES` budget in `requireBoundedRichText` (`extraction-payload.ts`) was checked only on each figure's raw, pre-sanitization bytes. Sanitization's own canonical escaping can inflate a figure's stored bytes without any single figure crossing its individual 16 KB cap, so several middling figures could each pass both per-figure checks yet sum, once sanitized, past the 32 KB field budget — a real total the raw-byte check cannot see. Added `requireBoundedFigureTotal`, re-summing the sanitized figures `parseRichText` actually returns and throwing `PAYLOAD_TOO_LARGE` if that real total exceeds the cap. New regression test (`extraction-payload.spec.ts`) constructs four figures, individually under cap both raw and escaped, whose raw total stays under 32 KB but whose escaped total does not, and asserts the field is now refused.
  - `[medium]` `[patch]` `shapeDraws`'s `path` branch (`svg-figure.ts`, both copies) only recognized a literal draw-command letter (`l h v c s q t a`), so a path using SVG's implicit-lineto syntax — a bare `moveto` followed by a second coordinate pair with no command letter, e.g. `M0 0 10 10`, which SVG reads as a real drawn line — was wrongly rejected as `FIGURE_SVG_NO_DRAWABLE_CONTENT` on both API and web. Added a coordinate-pair-count fallback (`pathDraws`) alongside the existing letter check, on both sides. New shared `SANITIZED_FIGURES` fixture row pins the case on both specs.
  - `[low]` `[patch]` The `line` branch of `shapeDraws` (both copies) treated any *stated* endpoint as drawable, so a line whose endpoints are explicitly equal (`x1="1" y1="1" x2="1" y2="1"`, zero length, nothing visible) passed the drawable-content gate — re-admitting the same zero-area class the second review pass already closed for `ellipse`/`polyline`/`polygon`. Fixed on both sides to require the resolved endpoints actually differ. New shared `MALICIOUS_FIGURES` fixture row (`noDrawableContent`) pins the case on both specs.
- All three patches verified: `pnpm exec vitest run` on every touched/related spec file in both workspaces (API: 236 passed, up from 233; web: 96 passed, up from 95); `pnpm typecheck` clean in both workspaces; `pnpm exec eslint` clean on every touched file; the `dangerouslySetInnerHTML` and new-dependency verification greps both still clean.
- The twelve reject findings (the honest-reason mismatch between `FIGURE_SVG_TOO_MANY_ELEMENTS` and the raw-byte `PAYLOAD_TOO_LARGE` remap, no aggregate figure budget on the practice-test edit path, `apps/web`'s tests importing API fixtures/constants across the workspace boundary, the extraction prompt not restating the per-field `MAX_FIGURES`/`MAX_FIGURE_BYTES` ceilings, `Figure` rendering `null` on a re-sanitization failure with no telemetry, the edit path's draft `richTextFromPlainText` round trip remaining lossy for a figure, `decodeCharacterData`'s unbounded `&...;` lookahead, unvalidated `d`/`transform` attribute magnitude, no OpenAPI/doc update for the new wire variant, no build-time guard tying the two hand-mirrored sanitizers together beyond the shared test suite, no fuzz/property testing of the tokenizer, and `FigureSegment`'s unconstrained-string zod shape) were all rejected: each is either an already-decided and documented design trade-off (several re-raised from the prior two review passes and already resolved there), bounded by an existing ceiling or by actual unreachability through the current wire, cosmetic with no behavioral difference, or out of this story's scope per the intent-contract's Never section.

## Design Notes

**Why a hand-written parser instead of DOMPurify.** `apps/web` runs vitest with `environment: 'node'` and no jsdom; the API has no DOM and no XML library at all. DOMPurify would add jsdom to the API, a DOM to the web unit suite, and two different allowlist dialects to keep in agreement. An allowlist parse over a deliberately tiny grammar is less code than the configuration would be, runs identically in both workspaces, and is the thing the ACs actually ask to unit-test. The duplication is the convention already in force for `plainTextOf` (`apps/web/src/lib/rich-text.ts:5-23`): hand mirror, documented as a mirror, asserted on both sides.

**Why sanitization lives inside `parseRichText`.** It is the one function every stored field already goes through, from every source. Putting it there is what makes "from any source (extraction, generation, edit)" true by construction rather than by three call sites remembering. The cost is that `parseRichText` stops being a pure validator and becomes a normalizer — which is why the three extraction storage sites must switch from guard-then-store to store-the-result; a site that keeps the guard shape would silently persist unsanitized SVG.

Expected segment and projection shape (wording is the implementer's, the contract is not):

```ts
export const FigureSegment = z.object({
  kind: z.literal('figure'),
  svg: z.string(), // sanitized by `parseRichText`, never stored as received
  alt: z.string(), // required and non-empty; the only spoken form of the figure
});
// plainTextOf: `[Figure: ${segment.alt}]` — identical on API and web.
```

**Rendering as elements, not markup.** The sanitizer already produces a tree, so the renderer walking that tree costs nothing extra and removes `dangerouslySetInnerHTML` from the design entirely — three existing specs already assert that string against page sources, and the honest way to keep that property is to never need the escape hatch.

**Scope seam with 4.8.** Generation emitting figures, draft review and edit preservation, and the `plainTextOf`/`richTextFromPlainText` round trip that would silently delete a figure are all 4.8's. This story deliberately leaves `richTextFromPlainText` lossy and documents it, so 4.8 inherits a named problem instead of discovering one. Leaving it lossy is only safe because nothing can reach it with a figure in this build: the generation and explanation wires take the narrowed `GeneratedRichText`, so a figure there is refused by the schema rather than accepted and later lost. Independently of that, both paths store what `parseRichText` returns rather than the value they were handed, so the day 4.8 widens the wire no raw model-authored SVG is persisted by either — the narrowing is the seam, the normalization is the defence in depth behind it.

## Verification

**Commands:**
- `pnpm --filter api run test` -- expected: the new `svg-figure.spec.ts` passes, `rich-text.spec.ts` and `extraction-payload.spec.ts` pass with the figure cases added and every pre-existing case unchanged.
- `pnpm --filter web run test` -- expected: new `svg-figure.spec.ts` passes; `rich-text.spec.ts`, `RichText.spec.tsx` (including the untouched text/fraction/unknown-kind tests) pass.
- `pnpm typecheck` -- expected: clean in both workspaces (the widened union forces every `RichTextSegment` consumer to be exhaustive or explicitly fall through).
- `pnpm exec eslint <each touched file>` -- expected: clean. (The `pnpm --filter web run lint` wrapper reports a pre-existing workspace-wide parsing error unrelated to this story.)
- `grep -rn "dangerouslySetInnerHTML" apps/web/src` -- expected: only the pre-existing negative assertions in spec files; no production use.
- `grep -rniE "(dompurify|jsdom|sanitize-html|svgo|fast-xml-parser)" apps/api/package.json apps/web/package.json` -- expected: no match; no dependency was added.

## Auto Run Result

**Summary:** This pass was a follow-up review of an already-implemented story (figure rich-text segments, allowlist SVG sanitizer on API and web, extraction prompt rule, accessible rendering). No new feature code was added; three real correctness/safety gaps surfaced by this pass's review were patched in the existing sanitizer and payload-validation code.

**Files changed this pass:**
- `apps/api/src/extraction/extraction-payload.ts` — added `requireBoundedFigureTotal`, re-summing sanitized figure bytes after `parseRichText` so the field's aggregate `MAX_FIGURE_BYTES` budget is enforced on the real stored total, not just the pre-sanitize raw total.
- `apps/api/src/extraction/svg-figure.ts` and `apps/web/src/lib/svg-figure.ts` — fixed `shapeDraws` for `path` (implicit-lineto coordinate pairs now count as drawable) and `line` (equal endpoints no longer count as drawable), on both hand-mirrored copies.
- `apps/api/src/extraction/svg-figure.fixtures.ts` — added one `SANITIZED_FIGURES` row (implicit-lineto path) and one `MALICIOUS_FIGURES` row (zero-length line, `noDrawableContent`), shared by both specs.
- `apps/api/src/extraction/extraction-payload.spec.ts` — added a regression test for the aggregate-budget-after-escaping gap.

**Review findings breakdown (this pass):** 3 patch (2 medium, 1 low), 0 bad_spec, 0 intent_gap, 0 defer, 12 reject. Full detail in the Review Triage Log entry above.

**Follow-up review recommendation:** `true`. Scored on this pass's patch findings only (medium 2, low 1): `3 × 2 + 1 × 1 = 7 ≥ 5`.

**Verification performed:** `pnpm exec vitest run` on every touched/related spec file in both workspaces (API 236 passed, up from 233; web 96 passed, up from 95); `pnpm typecheck` clean in both workspaces; `pnpm exec eslint` clean on every touched file; `grep -rn "dangerouslySetInnerHTML" apps/web/src` and the dependency grep both still clean (pre-existing negative assertions only, no new dependency).

**Residual risks:** None newly introduced. Pre-existing, already-triaged-out items remain as documented in the Review Triage Log (e.g. no document-wide figure-byte ceiling across a whole extraction payload, tracked separately in frontmatter `deferred`; the practice-test edit path's lack of a figure count/byte ceiling, traced as unreachable through the current wire; `richTextFromPlainText`'s documented figure data loss, explicitly Story 4.8's to close).

