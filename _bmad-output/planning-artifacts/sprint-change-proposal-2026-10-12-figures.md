# Sprint Change Proposal — Figures (Shapes) in Extraction and Generated Questions

- **Date:** 2026-10-12
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Status:** Approved 2026-10-12; applied to epics.md, PRD, ARCHITECTURE-SPINE.md, DESIGN.md, EXPERIENCE.md, sprint-status.yaml
- **Scope classification:** Moderate (new rich-text segment kind = schema/wire contract change across `extraction`, `practicetest`, `grading`, web renderers; two new stories; PRD + architecture + DESIGN edits)

## 1. Issue Summary

**Trigger.** Rvnadela uploaded a Grade 2 Math test full of shapes (circles, half/quarter circles, composite figures, a shape-built house and robot, base-ten blocks, grid "slide the shape" items). The released Practice Test contains no shapes at all.

**Evidence (prod, checked 2026-10-12).**
- Source Test `9f295f36-6c1c-43ef-8e6a-fed6742a26d5` (Mathematics, 2 pages, submitted 2026-10-12 02:28). Extraction `c244311c…`: 20 questions, 1 uninterpretable region (page 2, `Cropped`).
- Extraction turned every figure into bracketed prose inside a `text` segment:
  - Q2 `"What is the figure shown at the right? [A half-circle figure is shown.]"`
  - Q5 `"Which shapes were used to make the house? [The house shown has a triangular roof and a rectangular base.]"`
  - Q6 `"… [A robot composed of circles, squares, and rectangles is shown.]"`
  - Q17–20 grid moves: `"… [The printed circle begins in the bott…"`
  - Choices are text only (`"B. Circle"`).
- Q12 (base-ten blocks) stored `dependsOnUninterpretable = true`, `usable = false` — dropped from generation.
- Released Practice Test `40bf6f22-187c-41aa-9172-a886bf9c24fe` (19 questions) rewrote every figure question as a word problem: `"A shape-sorting box is labeled 'no corners and no straight sides.' Which shape belongs in the box?"`; grid moves became "name the cell" text puzzles over lettered/numbered grids.

**Root cause.** Not a defect against spec — a capability gap. The one rich-text mechanism (`apps/api/src/extraction/rich-text.ts`, AD-32) has two segment kinds: `text` and `fraction`. No figure segment exists in the extraction schema, the generation schema, the stored JSON, or the web `RichText` renderer. A model that cannot emit a shape describes it. PRD FR-9 only covers *un-photographed* diagrams (record as uninterpretable); nothing in PRD, architecture, UX or epics says a figure on the page is carried into generated questions. For early-grade Math (geometry, place-value blocks, grids), this guts the product's core loop.

**Rejected alternatives.**
- *Crop the figure from the Page Image and reuse it* — generated questions are new, not copies (FR-10), and regeneration must work after Page Images expire (FR-9, §5.2).
- *Structured primitive DSL (circle/arc/polygon spec)* — considered; Rvnadela chose model-emitted SVG with server sanitization (simpler schema, wider expressiveness). Sanitizer carries the safety burden instead.
- *No visuals, tighten prompts only* — defers the real fix.

**Decisions taken (with Rvnadela, 2026-10-12).**
| Decision | Choice |
|---|---|
| Figure model | **New `figure` rich-text segment carrying model-emitted SVG, sanitized server-side by allowlist** |
| Review mode | Batch |

## 2. Impact Analysis

### Epic impact
- **Epic 3 (Extraction):** add Story 3.9 — Figures in Extraction (segment kind, sanitizer, renderer, extraction prompt). Epic already `in-progress`.
- **Epic 4 (Generation, Review, Editing):** add Story 4.8 — Figures in Generated Questions (generation emits figures, draft review shows them, draft editing preserves them). Epic already `in-progress`.
- **Epic 5 (Taking a Test & Results):** no new story; Story 4.8 AC covers student render on take, results and answer key because all go through the one `RichText` component.
- **Epic 6 (Explanations):** no change. Explanations stay text-only; figures reach the explanation model as their alt text via `plainTextOf`.
- Epics 1, 2, 7–10: no change.

### Story impact
- No completed story reopened; 3.5 / 4.1 / 4.4 ACs still hold. Their behaviour widens through the new stories.
- **Story 4.4 (Draft Editing) risk:** today the editor round-trips every field through `plainTextOf` → `richTextFromPlainText` (`practice-test.service.ts:4011`, web `drafts/[practiceTestId]/page.tsx:98`). Unchanged, an edit would **silently delete every figure** in the field. Story 4.8 must close this.

### Artifact conflicts
| Artifact | Conflict | Update |
|---|---|---|
| PRD FR-9 | Only un-photographed diagrams addressed; photographed figures fall through to prose. | **Add consequence** (4.3). |
| PRD FR-10 | Fractions are the only structured content named. | **Add consequence** (4.3). |
| Architecture AD-32 | Fraction rule only; no figure rule. | **Add figure bullet** (4.4). |
| Architecture AD-30 | Post-hoc validation canonical case is MC answer-in-options only. | **Add SVG sanitization as a post-hoc rule** (4.4). |
| `DESIGN.md` do/don't table | No figure row; "no surface hardcodes a color" would be violated by raw model SVG colors. | **Add row** (4.5). |
| `EXPERIENCE.md` | Accessibility floor covers fractions only. | **Add figure row** (4.5). |
| `epics.md` | — | **Add Stories 3.9, 4.8** (4.1, 4.2). |
| `sprint-status.yaml` | — | Add `3-9-figures-in-extraction`, `4-8-figures-in-generated-questions` as `backlog`. |

### Technical impact
- **API — `rich-text.ts`:** new `FigureSegment { kind: 'figure', svg: string, alt: string }` in the discriminated union (strict Structured Outputs compatible: both fields required strings). `parseRichText` runs the sanitizer on every figure; `plainTextOf` emits `[Figure: <alt>]` so grading, dedupe, explanation and topic prompts keep working on text.
- **API — sanitizer (new):** allowlist parse, not regex strip. Elements: `svg g circle ellipse rect line polyline polygon path text tspan`. Attributes: geometry (`x y x1 y1 x2 y2 cx cy r rx ry width height points d`), `viewBox`, `transform`, `stroke-width`, `stroke-dasharray`, `fill`, `stroke`, `font-size`, `text-anchor`, `dominant-baseline`. Drops everything else (`script`, `foreignObject`, `image`, `use`, `style`, `on*`, `href`/`xlink:href`, `url(...)`). Requires root `<svg>` with `viewBox`; strips root `width`/`height`. Rewrites `fill`/`stroke` to `currentColor` or `none` (keeps dark mode, AD-32). Size cap 16 KB. Failure = AD-30 content fault (question invalid; same route as other post-hoc rejections).
- **API — extraction prompt/schema:** photographed figure a question needs is reproduced as a `figure` segment in the prompt or choice where it appears, with an `alt`. Un-photographed/cropped/unreadable stays `uninterpretable`.
- **API — generation prompt/schema:** generation sees each source figure's SVG and may emit new figures in prompts and MC choices; must not copy a source figure verbatim when the question itself is new; may vary shapes/positions.
- **API — draft edit:** editing preserves figure segments. Either edit text segments only around figures, or send figure segments through unchanged and re-sanitize on save. Free-form SVG editing out of scope.
- **Web — `RichText.tsx`:** new `figure` branch. Re-sanitize client-side (DOMPurify SVG profile, same allowlist) before inline render; `role="img"` + `aria-label={alt}`; responsive width, max height; inherits text colour. `lib/rich-text.ts` `plainTextOf` mirrors API.
- **Cost:** SVG adds output tokens per figure question on extraction and generation. Bounded by size cap; note on AI spend ceiling (AD — global daily ceiling) — no allowance change.
- **Existing data:** prod extraction `c244311c…` is figure-less (persisted and reused). One-off re-extraction of Source Test `9f295f36…` after deploy (decided); no general backfill.
- **Tests:** rich-text + sanitizer unit tests (malicious corpus: script, onload, foreignObject, external href, `javascript:` url, CSS url, oversize); extraction/generation payload specs; draft edit preserve spec; `RichText.spec.tsx` figure render + a11y; E2E draft review shows a figure.

## 3. Recommended Approach

**Direct Adjustment** — two new stories within Epics 3 and 4. No rollback; nothing shipped is wrong, it is incomplete.

- **Effort:** Story 3.9 ≈ M (segment + sanitizer + renderer + prompt). Story 4.8 ≈ M (generation prompt/schema + edit preservation + surfaces).
- **Risk:** Medium. Main risks: (1) XSS via model SVG — mitigated by server allowlist sanitizer + client re-sanitize + inline render of only allowlisted nodes; (2) figure quality (model drawing wrong shape) — parent reviews every draft before release (Story 4.3), so wrong figures are caught before a child sees them; (3) edit path silently stripping figures — explicit AC.
- **Timeline:** fits current sprint after 4.7.

## 4. Detailed Change Proposals

### 4.1 `epics.md` — new Story 3.9 (after Story 3.8)

```
### Story 3.9: Figures in Extraction

As the system,
I want shapes and diagrams photographed on a Source Test carried into the Extraction as figures,
So that generation can build questions that show shapes instead of describing them.

**Acceptance Criteria:**

**Given** a rich-text field
**Then** it may hold a `figure` segment carrying an SVG string and a required, non-empty text alternative, alongside `text` and `fraction` segments

**Given** any figure segment, from any source (extraction, generation, edit)
**When** it is parsed for storage
**Then** its SVG passes an allowlist sanitizer: only basic shape, path, group and text elements and geometry/presentation attributes survive; scripts, event handlers, external references, embedded HTML, images and CSS are removed; the root carries a viewBox; colours are rewritten to the current text colour or none; and an SVG over the size cap or with no drawable content is rejected as a content fault (AD-30)

**Given** a question on a photographed page that needs a printed figure to be answered
**When** Extraction runs
**Then** the figure is reproduced as a figure segment in the prompt or choice it belongs to, and the question is usable; a figure that is cropped, un-photographed or unreadable is still recorded as uninterpretable, never guessed at

**Given** a figure segment
**When** any surface needs plain text (grading, explanation, dedupe, topic prompts)
**Then** it reads as its text alternative

**Given** a figure segment
**When** the web `RichText` component renders it
**Then** it is re-sanitized client-side, drawn inline at a responsive width, inherits the text colour in light and dark mode, and is exposed to assistive tech as one image named by its text alternative

**Given** a malicious SVG corpus (script, on* handler, foreignObject, external href, javascript: URL, CSS url(), oversize)
**Then** the sanitizer neutralizes or rejects every case in unit tests on both API and web
```

### 4.2 `epics.md` — new Story 4.8 (after Story 4.7)

```
### Story 4.8: Figures in Generated Questions

As a parent,
I want generated Practice Tests to show shapes when the Source Test used shapes,
So that my child practises the same kind of visual question they were tested on.

**Acceptance Criteria:**

**Given** an Extraction whose questions carry figures
**When** a Practice Test is generated
**Then** generated questions on those Topics carry their own figure segments in the prompt and, for Multiple Choice, in choices where the source used pictured options; figures are new, not verbatim copies of a source figure

**Given** a generated figure
**Then** it passes the same sanitizer and text-alternative rule as Story 3.9, and a figure that fails is a content fault routed per AD-30/AD-31

**Given** a draft with figures
**When** I review it (Story 4.3)
**Then** every figure is shown in the question and choices where it appears

**Given** a draft question with figures
**When** I edit its text, options or answer (Story 4.4)
**Then** every figure in the edited field is kept unchanged; editing a figure itself is not offered

**Given** a released Practice Test with figures
**When** the student takes it, and later views results and the answer key
**Then** every figure is shown where it appears, in both themes, with its text alternative available to a screen reader

**Given** the Source Test `9f295f36…` style input (circles, half/quarter circles, composite figures, base-ten blocks, shapes on a grid)
**Then** a generated test from it shows those kinds of shapes rather than text descriptions of them

**Given** a source question that asks the child to draw or move a shape on a grid
**When** it is generated from
**Then** the generated question shows the grid and shape as a figure and asks where the shape ends up, answered by Multiple Choice (pictured options) or a cell label — never by drawing
```

### 4.3 PRD (`prds/prd-n-test-reviewer-2026-08-29/prd.md`)

FR-9 Consequences — after the uninterpretable bullet:

```
OLD:
- Content the system cannot interpret (an un-photographed diagram, a handwriting-only region) is recorded as uninterpretable rather than guessed at, and questions depending on it are not used as a basis for generation.

NEW:
- Content the system cannot interpret (an un-photographed diagram, a handwriting-only region) is recorded as uninterpretable rather than guessed at, and questions depending on it are not used as a basis for generation.
- A shape or diagram photographed legibly on a Page Image, that a question needs, is carried into the Extraction as a figure with a text alternative rather than as a prose description of it.
```

FR-10 Consequences — after the "carries its correct answer" bullet:

```
NEW:
- Where the Source Test's questions on a Topic use figures, generated Questions on that Topic carry their own figures — in the prompt and, for Multiple Choice, in the options — each with a text alternative.
```

Rationale: closes the gap; testable.

### 4.4 Architecture (`ARCHITECTURE-SPINE.md`)

AD-32 Rule — after the fractions bullet:

```
NEW:
  - **Figures are structured too:** a shape or diagram is a `figure` rich-text segment holding sanitized SVG and a required text alternative, never prose describing it. It renders inline in the current text colour (dark mode holds) and is announced as one image by its alternative.
```

AD-30 Rule — after the canonical-case bullet:

```
NEW:
  - **Every figure SVG passes an allowlist sanitizer in code** — shape, path, group and text elements and geometry/presentation attributes only; no script, handler, external reference, embedded HTML, image or CSS; colours rewritten to current colour; size-capped. A figure that fails is a content fault. The web re-sanitizes before rendering; neither side trusts the other.
```

### 4.5 UX

`DESIGN.md` do/don't table — new row after the fractions row:

```
| Render figures inline from the sanitized `figure` segment, in the current text colour, at a responsive width | Ship a prose description of a shape ("[A half-circle is shown]"), hardcode a figure colour, or render model SVG unsanitized | [Typography](#typography) |
```

`EXPERIENCE.md` structural-decisions table — new row after the fractions row:

```
| Figures are a structured generation output | Extracted and generated Questions carry shapes as sanitized SVG figures with a text alternative; a screen reader hears the alternative once; figures are not editable in Draft Editing but survive every edit | [Accessibility Floor](#accessibility-floor) |
```

### 4.6 `sprint-status.yaml`

```
3-9-figures-in-extraction: backlog
4-8-figures-in-generated-questions: backlog
```

## 5. Implementation Handoff

- **Scope:** Moderate — PO/Dev: apply artifact edits above, then Developer agent implements (`bmad-build` / bmad-loop). Security review (`bmad-code-review` + sanitizer corpus) required on Story 3.9 before deploy.
- **Sequence:** artifact edits → Story 3.9 → Story 4.8 → deploy → one-off re-extract Source Test `9f295f36…` (explicit go-ahead) → generate from it on prod and check figures.
- **Success criteria:**
  - New upload of a shapes test: extracted questions carry `figure` segments; no bracketed `[… is shown]` prose.
  - Base-ten-block style questions are `usable = true` when legible.
  - Generated draft shows shapes in prompts and pictured MC options; parent can review, edit text without losing figures, release.
  - Student take, results, answer key show figures in light and dark mode; screen reader reads alt text.
  - Sanitizer corpus tests pass on API and web; no `<script>`, handler, `href`, `foreignObject` or `style` reaches the DOM.
  - Existing unit + E2E suites pass.

## Open Questions

None. Resolved 2026-10-12 with Rvnadela:
1. **Re-extract:** yes — one-off re-extraction of prod Source Test `9f295f36…` after deploy (pages still retained). Existing Practice Tests untouched; later generations get figures. Run by Claude after explicit go-ahead; costs one extraction AI call.
2. **SVG size cap:** 16 KB per figure.
3. **Grid "slide/draw the shape" items:** show the grid and shape as a figure; the student picks where it lands (Multiple Choice with pictured options, or a cell label). No drawing input.
