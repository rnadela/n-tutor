---
title: 'Story 4.7: Obvious Progress Spinner & Sheet Tally'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_revision: '552c86a76b63c3a341cdebfd82d3f187cd98c6a1'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The web unit suite has no DOM tier, so a screen's mount of a component is
      verified only by a regex over the screen's own source text.
    evidence: |-
      `apps/web/src/app/parent/capture/page.spec.tsx` asserts the spinner mount
      with `expect(PAGE_SOURCE).toMatch(...)`; nothing renders the screen. Delete
      the `<WaitSpinner />` line and only that source regex fails - no executing
      test observes the spinner present while the Extraction is unsettled, and the
      e2e assertions on the capture side are deliberately negative (count 0 once
      the read has finished). The same holds for every other screen in the app;
      the missing DOM tier was already recorded as a deferred item on
      `spec-3-6-thin-extraction-warning.md`.
    location: >-
      apps/web/src/app/parent/capture/page.spec.tsx
    severity: medium
  - summary: >-
      An Extraction job that never settles leaves the capture screen's Generate
      step waiting forever, now with a spinner, and offers no retry.
    evidence: |-
      The poll at `apps/web/src/app/parent/capture/page.tsx:403-446` re-issues
      until `isSettled`, and only a failed *read* surfaces an error with Retry. A
      job stuck in `Running` server-side was already a silent forever-wait before
      this story; the spinner makes the wait obvious without bounding it. A
      "this is taking longer than expected" branch is a product decision, not a
      defect of this change.
    location: >-
      apps/web/src/app/parent/capture/page.tsx:1480-1497
    severity: low
---

<intent-contract>

## Intent

**Problem:** Both async waits in Parent View — the Extraction read on the capture screen's Generate step, and the generation job on the generate screen — are a bare sentence of text. Nothing on either card says "the app is working", and the generation wait says nothing about how far along it is.

**Approach:** One shared `WaitSpinner` (MUI `CircularProgress`, accent, ≥48px, `aria-hidden`) serves both waits, plus a `SheetTally` on the generate screen: one sheet icon per requested Practice Test, four states told apart by shape as well as colour, sitting directly above the unchanged progress sentence.

## Boundaries & Constraints

**Always:**
- One shared spinner component for both waits. On the generate screen it is the ring around the "being made" sheet — that ring *is* the generate screen's spinner, per the tally AC — so the component must render at a size that circles the sheet while still being ≥48px.
- Every colour comes from the theme (`theme.vars.palette.*`, or `success`/`primary`/`divider`/`text.secondary` sx keys), which `theme.ts` maps from `tokens.ts`. No hex literal outside `tokens.ts`. The ready tint is `color-mix(in srgb, <success var> 12%, transparent)`.
- Spinner and tally are both `aria-hidden="true"`. Neither adds a `role="status"`: the surface's one polite region is mounted once in `ThemeRegistry` (UX-DR33), and the status sentences on both screens stay byte-identical — same copy keys, same nodes, same `data-testid`s.
- Reduced motion is explicit in the component, not left to the global rule alone: a rotating mark and a static mark both render, and `@media (prefers-reduced-motion: reduce)` picks between them in CSS. No `useMediaQuery` or `matchMedia` — the existing screens' specs forbid it, and a hook would render the wrong branch first.
- The spinner is mounted inside the same conditional branch that the unsettled state already renders, so it disappears in the render the result appears in. No separate unmount effect, no timer.
- Durations and easing come from `motion` in `tokens.ts` (`durationStandard`, `easing`).
- Non-colour carriers are mirrored as `data-*` attributes, the way `GradeStateMarker`/`WeakAreaMarker` do, because the web unit suite runs without a DOM and strips colour.

**Block If:** nothing. Every AC is implementable from the existing job views (`requestedCount`, `producedCount`, `status`); no API, DB or copy change is required.

**Never:**
- No change to any status sentence's words, copy key or testid; no new copy keys.
- No new `role="status"`, `aria-live`, `aria-label` or visually hidden text anywhere in this story.
- No API/Prisma/server change; no new poll, counter or client-side progress estimate — the figures are the job's own.
- Not in scope: the mockup's big "3 of 5 ready" count line and its legend (no AC asks for them), the student-facing waits, and the attempt timer.

## I/O & Edge-Case Matrix

`sheetStates({ producedCount, requestedCount, status })` → one state per requested sheet, in order.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Job just started | produced 0, requested 5, `Running` | `['making','waiting','waiting','waiting','waiting']` | n/a |
| Mid-run | produced 3, requested 5, `Running` | `['ready','ready','ready','making','waiting']` | n/a |
| Succeeded | produced 5, requested 5, `Succeeded` | five `'ready'` | n/a |
| Partially complete | produced 3, requested 5, `PartiallyComplete` | `['ready','ready','ready','notMade','notMade']` | n/a |
| Failed, nothing landed | produced 0, requested 3, `Failed` | three `'notMade'` | n/a |
| Settled short of request | produced 1, requested 3, `Succeeded` | `['ready','notMade','notMade']` | Settled means no sheet is still coming: anything past `producedCount` is `notMade`, never `waiting` |
| Nothing requested | requested 0 (or `produced > requested`) | `[]` / length clamped to `requestedCount` | Caller renders nothing for an empty array |

</intent-contract>

## Code Map

**Read-only anchors (patterns to follow, do not change):**
- `apps/web/src/components/GradeStateMarker.tsx:31-71` and `components/WeakAreaMarker.tsx:41-78` — the exact component idiom to copy: no hooks, `aria-hidden` glyph, `data-state`/`data-frame`/`data-glyph` mirrors, colours via `theme.vars.palette.*`, geometry from `tokens.ts`.
- `apps/web/src/components/GradeStateMarker.spec.tsx:1-30` — `renderToStaticMarkup` + `ThemeProvider` + the `colourless()` helper that strips `class`/`style`/`color`. This is how "distinguishable by shape alone" is asserted.
- `apps/web/src/theme/theme.ts:150-161` — the global `prefers-reduced-motion` rule (every animation/transition duration and delay → `0ms !important`, iteration count 1). The component's own media query sits on top of this, not instead of it.
- `apps/web/src/theme/tokens.ts:16-101` colour tokens (`primaryParent`, `success`, `divider`, `textSecondary`), `:113-121` `density`, `:160` `rounded`, `:233-245` `motion`.
- `apps/web/src/components/LiveRegion.tsx:84-110` — the one app-wide `role="status"`; `:116` `useAnnounce`. Nothing in this story touches it.
- `apps/web/src/lib/practice-test-count.ts:103-115` `progressSentence` — the pure-helper-plus-sibling-spec pattern `sheet-tally.ts` follows; `lib/practice-test-count.ts:74-76` `isSettled` is the generation-side predicate (Succeeded, PartiallyComplete or Failed) that `sheet-tally.ts` must reuse — never `extraction-status.ts`'s, which does not know PartiallyComplete.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx:1-20` and `app/parent/capture/page.spec.tsx:22-24` — the `readFileSync` source-text assertion tier used for screens (no DOM in the web unit suite).
- `e2e/tests/parent-practice-test.spec.ts:222-223`, `:314-329` — the browser flows that already wait on `generate-progress` / `generate-progress-line`; the tally is added beside them.

**Files to change:**
- `apps/web/src/app/parent/capture/page.tsx:1478-1487` — the Generate-step section: `GENERATE_HEADING_ID` heading, then the `extraction === null || !isSettled(...)` branch holding `data-testid="extraction-reading"`. The spinner goes inside that branch, centred, above the sentence.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx:545-610` — the `generate-progress` panel: heading at `:562-565`, `generate-progress-line` at `:567-582`. The tally goes between the heading and that sentence; `job!.requestedCount`, `job!.producedCount` and `job!.status` are already in hand there.
- `apps/web/src/app/parent/capture/page.spec.tsx`, `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx` — source-text assertions for the two mounts.
- `e2e/tests/parent-practice-test.spec.ts` — assert the tally's sheets and states in the running and settled flows.

**Files to create:**
- `apps/web/src/lib/sheet-tally.ts`, `apps/web/src/lib/sheet-tally.spec.ts`
- `apps/web/src/components/WaitSpinner.tsx`, `apps/web/src/components/WaitSpinner.spec.tsx`
- `apps/web/src/components/SheetTally.tsx`, `apps/web/src/components/SheetTally.spec.tsx`

**Visual reference:** `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/mockups/key-generation-progress.html` — sheet geometry (lucide `file` body + per-state mark), sizes (56px cell, 44px glyph, 12px gap), state colours, order, and the reduced-motion answer. Illustration only: the spines win where they differ.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/lib/sheet-tally.ts` -- add `export type SheetState = 'ready' | 'making' | 'waiting' | 'notMade'` and `sheetStates({ producedCount, requestedCount, status })` implementing the I/O matrix, with `isSettled` reused from the generation status rules rather than re-listing statuses -- the rule is the story's one piece of logic and the web unit suite has no DOM, so it must be assertable as a function.
- `apps/web/src/lib/sheet-tally.spec.ts` -- cover every row of the I/O matrix, including the settled-short and zero-requested edges -- an off-by-one on the `making` index is the likeliest defect here.
- `apps/web/src/components/WaitSpinner.tsx` -- hookless `'use client'` component: `size` prop (default 48, minimum enforced in code), `aria-hidden="true"`, `data-testid="wait-spinner"`; renders an indeterminate `CircularProgress color="primary"` and a static `variant="determinate"` mark of the same size, with `@media (prefers-reduced-motion: reduce)` hiding the first and showing the second -- one component for both waits, and the reduced-motion swap stated in CSS so no hook decides it.
- `apps/web/src/components/WaitSpinner.spec.tsx` -- render it and assert: `CircularProgress` at ≥48px, `aria-hidden`, no `role="status"`/`aria-live`/`aria-label`, both marks present, and the reduced-motion query present in the emitted source -- the AC is about what reaches the markup.
- `apps/web/src/components/SheetTally.tsx` -- hookless `'use client'` component taking `producedCount`, `requestedCount`, `status`; renders `ul[aria-hidden="true"]` (`data-testid="sheet-tally"`) of `li`s (`data-testid="sheet"`, `data-state`, `data-glyph`) wrapping on narrow screens, each an inline lucide-geometry sheet SVG; `making` composes `WaitSpinner` as the ring around the sheet; `ready` draws its check in and settles from 85% scale over `motion.durationStandard` with `motion.easing` -- the shape mirrors prove the colourless AC, and reusing `WaitSpinner` is what makes the generate screen's spinner the same component.
- `apps/web/src/components/SheetTally.spec.tsx` -- `renderToStaticMarkup` + `colourless()`: each of the four states is distinguishable with colour stripped, the order matches `sheetStates`, the whole row is `aria-hidden` with no text and no `role="status"`, the `making` sheet contains the spinner, and nothing renders for `requestedCount` 0.
- `apps/web/src/app/parent/capture/page.tsx` -- mount `<WaitSpinner />` centred directly above `extraction-reading`, inside the same unsettled branch, with the heading the only other thing in that section -- keeps removal in the result's own render and keeps nothing competing with it.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx` -- mount `<SheetTally .../>` between the panel heading and `generate-progress-line`, fed from `job!` -- the sentence stays exactly as it is, directly under the tally.
- `apps/web/src/app/parent/capture/page.spec.tsx`, `apps/web/src/app/parent/generate/[sourceTestId]/page.spec.tsx` -- assert each mount by source text, that the status sentences and their testids are unchanged, and that neither screen gained a `role="status"` -- the screens' tier can only read their own source.
- `e2e/tests/parent-practice-test.spec.ts` -- in the running and settled flows, assert the tally is present with `requestedCount` sheets and the expected `data-state` values -- the only tier that runs real CSS and a real job.

**Acceptance Criteria:**
- Given the capture screen's Generate step with an Extraction that has not settled, when the step is shown, then one `WaitSpinner` of at least 48px sits centred above the unchanged `extraction-reading` sentence, and the section holds nothing else but its heading.
- Given that Extraction settles to `Succeeded` or `Failed`, when the next render happens, then the spinner is gone in the same render that shows the proceed button or the failure alert.
- Given the generate screen with a job that is running or settled, when the progress panel is shown, then a `sheet-tally` row of exactly `requestedCount` sheets is rendered directly above the unchanged `generate-progress-line`, in `sheetStates` order, and the running job's `making` sheet carries the shared spinner.
- Given the tally rendered with every colour, class and inline style stripped, when a reader looks at it, then the four states are still told apart by shape alone — check, ×, dashed outline, ring.
- Given a screen reader, when either wait is on screen, then the spinner and the tally are `aria-hidden`, no second `role="status"` exists on either screen, and the announced sentences are word-for-word what they were before this story.
- Given `prefers-reduced-motion: reduce`, when either wait is on screen, then no mark rotates, the static progress mark is shown instead, and the ready sheet appears with no draw-in or scale.
- Given the whole change, when the diff is searched, then no hex colour literal was added outside `tokens.ts` and no `useMediaQuery`/`matchMedia` call was added to either screen or either component.

## Spec Change Log

- **2026-10-12, implementation:** one file beyond the Code Map had to change —
  `apps/web/src/components/primitives.spec.tsx`. Its `motion` sweep forbids
  `@keyframes`, `animation:` and `transition:` in **every** file under
  `components/`, which the ready sheet's draw-in and scale (an acceptance
  criterion) necessarily emits. A `MOTION_IS_THE_POINT` set now exempts
  `SheetTally.tsx` from that one sweep — every other sweep in that file still
  applies to it — and a new case asserts that the exempted file still takes its
  duration and easing from `motion`, writes no literal `ms`, states
  `prefers-reduced-motion: reduce`, and uses neither `useMediaQuery` nor
  `matchMedia`. `WaitSpinner.tsx` needed no exemption.

## Review Triage Log

### 2026-10-12 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - none

Four review layers ran in parallel (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Edge-case-hunter and verification-gap both returned empty/clean. Blind-hunter raised 13 items; two were artifacts of the truncated diff excerpt handed to that subagent and do not exist in the actual files (a claimed unescaped apostrophe in `page.spec.tsx` — the source uses a curly `'` which is valid — and a claimed unused `STATES` const in the e2e spec, which is in fact referenced at `e2e/tests/parent-practice-test.spec.ts:265`). The remaining eleven were speculative, out-of-scope, or already resolved by this story's intentional design (hardcoded compact density, silent-clamp behavior, no dev-warning on invalid size, `useMemo`/`key` micro-nits, missing visual-regression/live-polling tests beyond the spec's ACs). Intent-alignment auditor surfaced three framing divergences (structural- vs functional-reading of "same conditional branch," `motion`-token scope, "same nodes" at source-text vs render-tree level) — all consistent with the Design Notes already in this spec and not defects. Nothing crossed the bar for patch, bad_spec, intent_gap, or defer.

### 2026-10-12 - Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 2: (high 0, medium 1, low 1)
- reject: 22: (high 0, medium 0, low 22)
- addressed_findings:
  - `[medium]` `[patch]` The reduced-motion assertions in `WaitSpinner.spec.tsx` matched a wildcard emotion class and never tied a declaration to a node, so swapping the two `sx` blocks - ring visible only under reduced motion, nothing visible otherwise - would still pass. Fixed: the spec now pulls each node's class off its testid and asserts that class's base and reduce-scoped declarations in both directions.
  - `[low]` `[patch]` `SheetTally.tsx` took its cell size from `comfortableDensity.rowHeight` (Student Mode's density set) on a Parent View surface while the glyph used `density.tapTarget`. Fixed: all three figures now derive from the compact set at the same pixel values.
  - `[low]` `[patch]` The reduced-motion static mark was a determinate `CircularProgress value={25}`, which reads as a 25%-complete progress figure for the whole wait. Fixed: it is now the mockup's own static dotted accent ring, stating no figure, with one shared ring thickness so the two marks cannot drift.
  - `[low]` `[patch]` `sheetStates` did not guard non-finite figures: `requestedCount: Infinity` threw a RangeError out of `Array.from` and took the progress panel with it, and a non-finite `producedCount` drew every sheet `waiting` with no spinner at all. Fixed with `Number.isFinite` falls-back-to-0 on both, plus two spec cases.
  - `[low]` `[patch]` A non-finite `size` on `WaitSpinner` emitted `width: NaNpx` and `data-size="NaN"`. Fixed: it falls back to the floor, covered for `NaN`, `Infinity` and `-Infinity`.
  - `[low]` `[patch]` The `MOTION_IS_THE_POINT` exemption in `primitives.spec.tsx` is keyed by filename, so renaming or deleting `SheetTally.tsx` would silently disable the motion sweep. Fixed: a new case asserts every exempted name is present in `SOURCES`.

## Design Notes

**Why the reduced-motion swap is two nodes and a media query.** `theme.ts` already zeroes every animation globally under `prefers-reduced-motion`, which stops the rotation — but "a static progress mark is shown" is a positive claim, and a zeroed indeterminate `CircularProgress` lands on whatever its first keyframe happens to be. Rendering both marks and choosing in CSS makes the reduced-motion state deliberate and assertable from the emitted markup, with no hook to render the wrong branch on the first paint.

**Why the generate screen has no second large spinner.** The spinner AC and the tally AC describe the same mark: the tally AC states that the ring around the "being made" sheet *is* the generate screen's spinner. One `WaitSpinner`, sized to circle the 56px sheet cell, satisfies both the "≥48px, above the status sentence" rule (the tally sits directly above the sentence) and the "one shared component" rule.

```tsx
// SheetTally: the making sheet is the shared spinner, drawn around the sheet.
<Box component="li" data-testid="sheet" data-state="making" data-glyph="ring"
     sx={{ position: 'relative', display: 'grid', placeItems: 'center', width: 56, height: 56 }}>
  <SheetGlyph tone="primary" />
  <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
    <WaitSpinner size={56} />
  </Box>
</Box>
```

## Verification

**Commands:**
- `pnpm --filter web typecheck` -- expected: no errors.
- `pnpm --filter web test` -- expected: `sheet-tally.spec.ts`, `WaitSpinner.spec.tsx`, `SheetTally.spec.tsx` and both screen specs pass.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` -- expected: the running and settled flows find the tally and its states.
- `pnpm exec eslint "apps/web/src/**/*.{ts,tsx}"` -- expected: clean. (`pnpm lint` is known-unusable in this repo — `eslint` is not on the root path.)
- `pnpm prettier --check .` -- expected: clean.
- `grep -rnE "#[0-9A-Fa-f]{6}" apps/web/src --include=*.tsx --include=*.ts | grep -v tokens` -- expected: no new matches from this story.

## Auto Run Result

**Summary:** One shared `WaitSpinner` now marks both of Parent View's async waits, and a `SheetTally` row sits above the generate screen's progress sentence, one sheet icon per requested Practice Test in one of four shape-distinguishable states. Implemented and committed in a prior run (`1b572d1`); this run performed a follow-up review pass only, with no code changes.

**Files changed (prior implementation commit, unchanged by this pass):**
- `apps/web/src/lib/sheet-tally.ts`, `sheet-tally.spec.ts` — new `sheetStates()` pure function and its I/O-matrix tests.
- `apps/web/src/components/WaitSpinner.tsx`, `WaitSpinner.spec.tsx` — new shared spinner component.
- `apps/web/src/components/SheetTally.tsx`, `SheetTally.spec.tsx` — new tally component, embedding `WaitSpinner` as the "making" sheet's ring.
- `apps/web/src/app/parent/capture/page.tsx`, `page.spec.tsx` — mounts `WaitSpinner` in the unsettled branch.
- `apps/web/src/app/parent/generate/[sourceTestId]/page.tsx`, `page.spec.tsx` — mounts `SheetTally` above `generate-progress-line`.
- `apps/web/src/components/primitives.spec.tsx` — `MOTION_IS_THE_POINT` exemption and token-usage case for `SheetTally.tsx`'s motion.
- `e2e/tests/parent-practice-test.spec.ts` — asserts the tally's sheets and states in the running and settled flows.

**Review findings breakdown (this pass):** 0 patched, 0 deferred, 13 rejected (2 were artifacts of a truncated diff excerpt and do not exist in the real files; the rest were speculative, out-of-scope, or already resolved by this story's design — see Review Triage Log above).

**Follow-up review recommendation:** `false`. No finding was triaged `patch` this pass (score: high 0, medium 0, low 0 patched → `3×0 + 1×0 = 0`, below the `5` threshold).

**Verification performed (this pass):**
- `pnpm --filter web test` — 87 test files / 1852 tests passed, including `sheet-tally.spec.ts`, `WaitSpinner.spec.tsx`, `SheetTally.spec.tsx`, and both screen specs.
- `pnpm --filter web typecheck` — clean.
- `pnpm exec eslint` on every file this story touches — clean.
- `pnpm prettier --check .` — clean for this story's files (one pre-existing, unrelated warning on `apps/api/src/extraction/rich-text.spec.ts`, outside this story's scope).
- `grep -rnE "#[0-9A-Fa-f]{6}" apps/web/src ... | grep -v tokens` — no new hex literal from this story.
- `pnpm exec playwright test e2e/tests/parent-practice-test.spec.ts` was not re-run this pass (no code changed); it ran as part of the prior implementation/review pass.

**Residual risks:** The two items already recorded under `deferred` in this spec's frontmatter stand unchanged: the web unit suite's lack of a DOM tier (so screen mounts are only regex-verified), and an Extraction job that never settles leaving the capture screen spinning with no bound or retry.

