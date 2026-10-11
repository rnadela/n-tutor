---
title: 'Story 10.3: Brand Palette'
type: 'feature'
created: '2026-10-12'
baseline_revision: 'bce4a226a0bb9add9226cc1f2ca75ffec97c72a1'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/apps/web/AGENTS.md']
warnings: ['oversized']
deferred:
  - summary: >-
      Nothing mechanically compares `colorTokens` against DESIGN.md's `colors:`
      and `state:` frontmatter, so the token module and its normative source can
      drift apart with the whole suite green.
    evidence: |-
      The new specs read only `colorTokens` and `tokens.ts`'s own bytes, and
      `contrast.spec.ts` recomputes ratios *from the tokens* — so a value and the
      document drifting together, or the document moving alone, breaks nothing.
      Transcription was verified by hand for this story (every key matched byte
      for byte), which is exactly the check that will not repeat itself next
      time. Mechanising it would couple the web package's unit suite to
      `_bmad-output/planning-artifacts`, which is a decision worth taking
      deliberately rather than inside a palette swap.
    location: >-
      apps/web/src/theme/contrast.spec.ts
    severity: medium
  - summary: >-
      The source-read specs' comment strippers are string-unaware, so they can
      both hide a hex they should catch and eat live code.
    evidence: |-
      `withoutComments` in `tokens.spec.ts` truncates a line at any `//`, so a
      hex after a protocol-bearing string on the same line is never swept, and
      its block-comment regex can consume real code containing `*/`. The same
      line-based idiom is pasted into `page.spec.tsx` and the other source-read
      specs — a pre-existing convention in this codebase, already recorded as a
      deferral on Story 10.2 from the opposite direction (it fails to strip the
      body lines of a multi-line comment). One shared, tokenizer-based helper
      would close both.
    location: >-
      apps/web/src/theme/tokens.spec.ts:63
    severity: low
---

<intent-contract>

## Intent

**Problem:** The real app icon shipped — a books-and-pencil "N" in forest green on warm ivory — but the app it opens is still painted in the superseded "Clear Room" palette: cool grey-blue neutrals, a teal Student accent, a clinical-blue Parent accent. Tapping a warm, bookish icon opens a cool, clinical app, so the installed product does not read as one thing.

**Approach:** Swap the values in `apps/web/src/theme/tokens.ts` to the Reading Room palette that `DESIGN.md` (revised 2026-10-11) now specifies, and back the swap with a unit spec that computes every pair in DESIGN.md's measured-contrast table from `colorTokens` and asserts its WCAG floor in both schemes — so this palette is pinned and any future token edit that breaks a pair fails CI. No component changes: Story 1.7 already routes every colour through the token module.

## Boundaries & Constraints

**Always:**
- Values only in `colorTokens`: every key keeps its name, and no key is added or removed. `theme.ts`, `grade-state-palette.ts` and the MUI mapping are untouched.
- The authority for every value is `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md` frontmatter (`colors:` and `state:`). Transcribe it; never re-derive or "improve" a value.
- No hex literal anywhere in `apps/web/src` outside `tokens.ts`. Comments may *name* a value as prose evidence.
- `brandGround` `#FDFAF3` and `brandInk` `#173D30` stay exactly as they are: they are the icon's own colours, read only by the manifest and `theme-color`. `brandGround` equals the new light `backgroundPaper` by deliberate duplication — never alias, collapse or dedupe.
- The four camera-chrome `*OnInverted` / `backgroundInverted` tokens stay deliberate duplicates too, and their explanatory comment is rewritten to name the new values and the new measured figures.
- Floors: 4.5:1 for text pairs, 3:1 for non-text pairs (divider, focus boundary) — WCAG 2.1 SC 1.4.3 / 1.4.11.

**Block If:**
- A DESIGN.md value disagrees with the sprint change proposal's table, or a pair in the measured-contrast table does not actually clear its floor when computed. (Both were checked during planning and agree — this triggers only if the docs move underneath.)

**Never:**
- Do not repaint `mockups/*.html` — reference art, not spec; DESIGN.md already carries the superseded note.
- Do not add a token, a second divider tier, a theme mode, or a dependency.
- Do not touch API, DB, worker, Compose, or any component file.
- Do not change `brandGround`/`brandInk`, and do not change `error`, `warning`, `info` or light `onPrimary` — DESIGN.md keeps those values.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Text pair, both schemes | e.g. `textSecondary` on `backgroundPaper` | computed ratio ≥ 4.5 | spec fails naming the pair, scheme and ratio |
| Non-text pair, both schemes | `divider` on `backgroundPaper` / `backgroundDefault` / `tintHover` / `tintSelected` | computed ratio ≥ 3.0 | as above |
| Inverted ground (one ground only) | `primaryOnInverted` / `dividerOnInverted` / `textOnInverted` on `backgroundInverted` | 7.21 / 3.32 / 15.62, each above its floor | as above |
| Why the inverted duplicate exists | light `primaryParent` on `backgroundInverted` | ratio < 3.0 (1.87), so the camera must not take the light accent | spec fails if the parent accent ever becomes usable there and the comment goes stale |
| Ground step is a cue, not a boundary | `backgroundDefault` → `backgroundPaper` | ratio < 1.2 in both schemes (1.10 / 1.09) | as above — proves the divider still carries the whole boundary |
| Superseded value survives | any of the 20 Clear Room hexes present in `colorTokens` | spec fails | as above |
| Grade states, colour removed | all four markers rendered with colour/class/style stripped | still told apart by frame, border, glyph, rule, label | existing `GradeStateMarker.spec.tsx` already asserts this and must stay green |

</intent-contract>

## Code Map

- `apps/web/src/theme/tokens.ts:16-67` -- `colorTokens`, the single place colour exists. Lines 18-34 are the palette keys to re-value; 36-52 is the camera-chrome comment block to rewrite (it currently cites "~2.5:1" and "16.56:1", both superseded — the new figures are 1.87:1 and 15.62:1); 53-56 are the four inverted tokens; 58-66 are `brandGround`/`brandInk` and their rationale, which do **not** change.
- `_bmad-output/planning-artifacts/ux-designs/ux-n-test-reviewer-2026-08-29/DESIGN.md` -- normative. Frontmatter `colors:`/`state:` hold every new value; the "Measured contrast ratios" table holds every pair and figure the new spec must cover; the three `*-deliberateDuplicate` markers state the duplication rules verbatim.
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-11-brand-palette.md` -- the decision record (forest Student, ink-navy Parent, Correct→teal, batch scope). §4.2 carries the old→new table; §4.4 lists exactly the three code changes.
- `apps/web/src/theme/theme.ts:14-30` -- `buildTheme` maps `colorTokens` onto MUI per scheme. Read-only: it names tokens, never values, so the swap flows through it untouched.
- `apps/web/src/theme/theme.spec.ts:1-60` -- the spec idiom to mirror for the new file: `vitest`, `const schemes = ['light','dark'] as const`, assertions against `colorTokens[name][scheme]` rather than literals. `environment: 'node'` is the project default (`apps/web/vitest.config.ts`), so a pure-computation spec needs no pragma.
- `apps/web/src/theme/grade-state-palette.ts:29-34` -- `GRADE_PALETTE` maps the four marker tokens (`success`, `error`, `textSecondary`, `info`) onto `theme.vars`. Read-only: `Correct` already names `success`, so Correct becomes teal by the token swap alone, with no change here or in `tokens.ts:167`.
- `apps/web/src/components/GradeStateMarker.spec.tsx:62` -- "tells all four states apart with every colour, class and style stripped". This is the existing, palette-independent proof of UX-DR17 redundancy; it must stay green and needs no edit. Do not duplicate it in the new spec.
- `apps/web/src/app/parent/capture/page.spec.tsx:838-862` -- the camera-chrome specs. They assert against `colorTokens.*` values, so they follow the swap automatically; line 852's comment is the one hard-coded hex in the whole app and is the only edit needed here (`#10202E` → `#1B2620`, and "~2.5:1" → 1.87:1).
- `e2e/tests/pwa-installability.spec.ts` -- its `colorToken()` helper reads `tokens.ts` by regex to check the manifest's `theme_color`/`background_color`. Those read `brandGround`/`brandInk`, which do not change, so this E2E stays green; read-only reference.
- Verified during planning: `grep -rn -E '#[0-9A-Fa-f]{6}' apps/web/src e2e` matches nothing outside `tokens.ts` except that one comment — so re-valuing the token module is sufficient for "no surface left on an old value", and the no-literal sweep below is what keeps that true.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/theme/tokens.ts` -- re-value lines 18-34 and 53-55 to the DESIGN.md Reading Room values, and rewrite the camera-chrome comment block to name the new duplicates and figures. New values: `primaryStudent` `#1E5A45`/`#7FC4A4`, `primaryParent` `#2C4F7C`/`#8FB3E0`, `onPrimary` `#FFFFFF`/`#101713`, `secondary` `#56634F`/`#A9B8A2`, `success` `#0F6E78`/`#71C3CE`, `backgroundDefault` `#F4EFE4`/`#101713`, `backgroundPaper` `#FDFAF3`/`#17201B`, `textPrimary` `#1B2620`/`#E6EDE8`, `textSecondary` `#545F58`/`#A4B2AA`, `divider` `#7E857C`/`#6C766F`, `tintHover` `#EFE9DC`/`#1F2A24`, `tintSelected` `#E7EEE5`/`#142B23`, `backgroundInverted` `#1B2620` both, `primaryOnInverted` `#8FB3E0` both, `dividerOnInverted` `#6C766F` both. `error`, `warning`, `info`, `textOnInverted`, `brandGround`, `brandInk` unchanged. Add a short note on `success` saying why Correct is teal and not green (the accent means *interactive*), and on `primaryStudent`/`primaryParent` that the pair is the two-rooms hue split -- so the one surprising value in the module carries its reason where a reader meets it.
- `apps/web/src/theme/contrast.spec.ts` -- new spec: a local `contrastRatio(hex, hex)` built from the WCAG relative-luminance formula, then a table-driven `it.each` over every pair in DESIGN.md's measured-contrast table, each with its floor (4.5 text / 3 non-text), asserted in both schemes; the inverted trio against the single inverted ground; the two documented negatives (light `primaryParent` on `backgroundInverted` below 3:1, and the `backgroundDefault`→`backgroundPaper` step below 1.2:1); and a sweep asserting no superseded Clear Room hex appears anywhere in `colorTokens`. Pairs are named by token name and read through `colorTokens`, never pasted as literals -- that is what makes a future token edit fail CI.
- `apps/web/src/theme/tokens.spec.ts` -- new spec: read `apps/web/src/theme/tokens.ts`'s own source and every other `.ts`/`.tsx` under `apps/web/src`, and assert no 3- or 6-digit hex colour literal occurs outside the token module (comments excluded, since the camera-chrome and capture-spec comments legitimately name values as evidence). Also assert the `colorTokens` key set is exactly the 21 names it has today, so "no token added, removed or renamed" is enforced rather than reviewed.
- `apps/web/src/app/parent/capture/page.spec.tsx` -- update the line-852 comment: the light parent primary measures 1.87:1 on `#1B2620`, not ~2.5:1 on `#10202E`. Assertions unchanged.

**Acceptance Criteria:**
- Given `DESIGN.md` frontmatter as revised 2026-10-11, when `colorTokens` is compared against it key by key, then every light and dark value matches it exactly and the key set is unchanged.
- Given the measured-contrast table, when `pnpm --filter web test` runs, then every listed pair is computed from `colorTokens` and passes its floor in both schemes, and the superseded-palette sweep finds nothing.
- Given the grade-state markers with Correct on teal `success` and Not-graded-yet on `info` blue, when the existing `GradeStateMarker` and `AnswerKeyRow` specs run, then the four states are still told apart with every colour, class and style stripped — in both schemes, since the proof uses no colour at all.
- Given the camera capture chrome, when its specs run, then it still draws only the four on-inverted values and still never reaches for the light parent primary or the light divider, and its comments name the new values and the 1.87:1 figure.
- Given `brandGround` and `brandInk`, when the manifest and `theme-color` E2E run, then both are unchanged and the installed splash still matches the icon.
- Given the whole web suite, when `pnpm --filter web test`, `typecheck`, `lint`, `build` and `pnpm e2e` run, then every pre-existing result is unchanged — no component file was touched.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 4, low 8)
- defer: 2: (high 0, medium 1, low 1)
- reject: 19: (high 0, medium 0, low 19)
- addressed_findings:
  - `[medium]` `[patch]` `CameraViewfinder.tsx:19` carried a third copy of the superseded "~2.5:1" claim, which the swap made false — the same sentence was updated in `tokens.ts` and `page.spec.tsx` but missed here, against the story's own acceptance criterion that the camera chrome's deliberate-duplicate comments name the new values. Updated to 1.87:1, below the 3:1 non-text floor.
  - `[medium]` `[patch]` The shutter button fills with `primaryOnInverted` and paints its label in `backgroundInverted` (normal-size text under SC 1.4.3), but that pair was pinned only at the 3:1 non-text floor — a future mid-tone accent would keep every test green while the capture screen's primary action became unreadable. Added a `TEXT_FLOOR` assertion for the pair (7.21:1), naming the shutter as the consumer.
  - `[medium]` `[patch]` `onPrimary` on `warning` is a rendered text pair (`WeakAreaMarker` fills with `warning.main` and draws its glyph in `contrastText`, which maps to `onPrimary`) whose dark value this story moved, and no assertion covered it. Added to `TEXT_PAIRS` (5.93:1 / 9.47:1).
  - `[medium]` `[patch]` The `brandGround`/`brandInk` comment did not name the duplication the swap created — `brandGround` is now byte-identical to light `backgroundPaper` — although the story requires those two to be documented as deliberate duplicates. Added the marker paragraph in the camera block's own terms, plus a note that `onPrimary.dark` equalling `backgroundDefault.dark` is incidental and deliberately unmarked, so the convention keeps its signal value.
  - `[low]` `[patch]` Added `textPrimary` on `backgroundDefault` to `TEXT_PAIRS`: both values moved in this story and it is the most-rendered text pair in the app (13.62:1 / 15.29:1).
  - `[low]` `[patch]` The formula sanity check pasted `#7E857C` — the live `divider.light` value — as a self-contrast case, contradicting the hex-allowlist's own stated reason and able to go stale silently. Replaced with an arbitrary non-token mid-tone.
  - `[low]` `[patch]` `tokens.ts` forbids collapsing four duplicate pairs but nothing asserted the identities, so a palette edit could break the documented duplication with no failure. Added assertions pinning all four.
  - `[low]` `[patch]` The superseded sweep uppercased the token value but assumed its own list was uppercase; a lowercase entry added later would never match. Both sides normalised.
  - `[low]` `[patch]` The ground-step test bounded only the upper side, so collapsing the two grounds to one value passed at 1.00:1 with the reading cue gone. Bounded below as well.
  - `[low]` `[patch]` The header docstring claimed the 3:1 floor covered "the focus boundary" although `NON_TEXT_PAIRS` holds only the four divider pairs. Scoped the claim to what the file asserts and explained where the ring's pairs actually live.
  - `[low]` `[patch]` `primaryStudent`'s comment called `#1E5A45` "the app icon's own book-spine hue", an identity that does not hold — the icon's ink is `brandInk` `#173D30`. Reworded to "drawn from" and names the other green.
  - `[low]` `[patch]` `COLOR_TOKEN_NAMES` was a bare `as const`, so a typo read as a palette change at runtime instead of failing to compile. Now `satisfies readonly ColorTokenName[]`.

### 2026-10-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 16: (high 0, medium 0, low 16)
- addressed_findings:
  - `[low]` `[patch]` `brandGround`'s identity with light `backgroundPaper` was the only one of the story's five documented deliberate duplications with no pinning assertion — the camera-chrome quartet all got one, this one didn't, so a future edit could break it silently. Added `expect(colorTokens.brandGround.light).toBe(colorTokens.backgroundPaper.light)` to `contrast.spec.ts`.
  - `[low]` `[patch]` `page.spec.tsx`'s allowlist comment described `contrast.spec.ts` as computing only "the inverted trio's contrast", understating that it also runs the full `TEXT_PAIRS`/`NON_TEXT_PAIRS` matrix. Reworded to name both.

## Design Notes

**Why a computed contrast spec rather than a copied table.** The point of the swap is that DESIGN.md's figures stay true. A spec that stored the ratios as numbers would pass forever; one that computes them from `colorTokens` fails the moment a value moves. The ratios in DESIGN.md were re-verified during planning against the new values — all 21 table pairs, the inverted trio, both ground steps, and both rejected candidates matched the document to two decimals — so the spec is pinning a table that is already correct, not discovering one.

```ts
// contrast.spec.ts — the shape, not the whole file
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) =>
  [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255))
    .reduce((sum, c, i) => sum + [0.2126, 0.7152, 0.0722][i] * c, 0);
const contrastRatio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// TEXT_PAIRS / NON_TEXT_PAIRS are [tokenName, tokenName] tuples — never hexes.
```

**Why Correct moves to teal.** The Student accent is now forest green and the accent means *interactive*. A green Correct would paint "this is a button" and "this answer was right" the same colour, so `success` takes `#0F6E78` — the retired Student accent, a hue no interactive control uses. Teal and `info` blue sit 1.09:1 apart in lightness and separate by hue alone, which under deuteranopia is no separation at all; that is survivable only because every grade state already carries frame, border, glyph, rule texture and a literal word, and `GradeStateMarker.spec.tsx:62` proves it with colour stripped. This story leans on that existing guarantee rather than adding a second one.

**Why `brandGround` stays its own token even though it now equals light `backgroundPaper`.** The icon must not change when the palette does. Aliasing them would make the next palette move repaint the installed splash and the browser chrome, which is exactly the mismatch this story exists to fix.

## Verification

**Commands:**
- `pnpm --filter web test` -- expected: all specs pass, including the new contrast and token-sweep specs; no pre-existing spec changes result
- `pnpm --filter web typecheck` -- expected: no errors
- `pnpm --filter web lint` -- expected: no errors
- `npx prettier --check` on every changed file -- expected: clean
- `pnpm --filter web build` -- expected: build succeeds
- `pnpm e2e` -- expected: every spec's result unchanged (the manifest E2E reads `brandGround`/`brandInk`, which did not move)
- `grep -rn -E '#[0-9A-Fa-f]{3,6}' apps/web/src --include='*.ts' --include='*.tsx'` -- expected: matches only `tokens.ts` values and comments that name a value as evidence

**Manual checks (if no CLI):**
- `colorTokens` read side by side with DESIGN.md's `colors:`/`state:` frontmatter: every key present in both, every value identical, nothing added or renamed.

## Auto Run Result

**Summary:** Fresh review pass over the already-landed Reading Room palette swap (commit `d09fa380d3981dbd3c2494bde7807e1cc96cb997` on top of baseline `bce4a226a0bb9add9226cc1f2ca75ffec97c72a1`). Four reviewers (blind hunter, edge-case hunter, verification-gap, intent-alignment auditor) ran against the full diff — `tokens.ts`'s value swap, the two new palette specs, and the two comment-only updates in the capture page. Two low-severity patches landed; everything else was rejected as noise or already covered by prior review/design decisions.

**Files changed this pass:**
- `apps/web/src/theme/contrast.spec.ts` — added an assertion pinning `brandGround.light` to light `backgroundPaper`, closing the one documented duplication the original pass left unpinned.
- `apps/web/src/app/parent/capture/page.spec.tsx` — corrected an allowlist comment that understated `contrast.spec.ts`'s scope.

**Review findings breakdown:** 2 patches applied (0 high, 0 medium, 2 low); 0 items deferred; 16 items rejected (all low — speculative hardening beyond what the intent-contract requires, a cross-pass duplicate of already-deferred DW-323's comment-stripper gap, an unreachable symlink-cycle edge case, and intent-alignment divergences that resolve under the contract's own carve-outs — the camera-chrome comment rewrite is explicitly required by the "Always" bullet, and the hex-literal exception for the sweep test's own data has no workable alternative).

**Follow-up review recommendation:** `false`. This pass's patched findings: 0 high, 0 medium, 2 low → score `3 × 0 + 1 × 2 = 2`, below the 5 threshold.

**Verification performed:**
- `pnpm --filter web test` — 81 files, 1669 tests, all pass.
- `pnpm --filter web typecheck`, `pnpm --filter web lint` — clean.
- `npx prettier --check` on both changed files — clean.
- Verification-gap reviewer independently recomputed every WCAG ratio in `contrast.spec.ts` from the live token values and confirmed each matches its asserted/commented figure; confirmed both new spec files run in the normal `vitest run` path; confirmed no stale hardcoded Clear Room hex survives outside planning docs.

**Residual risks:** unchanged from the prior pass (recorded there and not re-litigated here) — the full `pnpm e2e` suite's pre-existing flakiness, the source-level (not rendered) guarantee that no surface holds a retired hex, and the `success`/`info` hue-only separation that relies on `GradeStateMarker.spec.tsx`'s colour-stripped proof.

