# Sprint Change Proposal — Brand Palette (Warm Rebrand to Match App Icon)

- **Date:** 2026-10-11
- **Requested by:** Rvnadela
- **Mode:** Batch
- **Scope classification:** Minor (one new story; design-doc edits; token-level code change)

## 1. Issue Summary

**Trigger.** The real app icon shipped (commit `6902202`): a books-and-pencil "N" in forest green and pencil gold on warm ivory. The app it opens is still painted in "Clear Room — cool clinical daylight": grey-blue neutrals, a teal Student accent, a clinical-blue Parent accent. Tapping a warm, bookish icon opens a cool, clinical app. Rvnadela asked to bring the app's theme in line with the brand.

**Why this needs course correction rather than a token edit.** `DESIGN.md` is the normative source for every colour, owns the measured-contrast table, and states that changing the palette "is a design change, not an implementation detail". The swap also creates a semantic collision (below) that must be decided, not drifted into.

**Icon palette (sampled from `icon-512.png`).**
| Name | Hex | Where in icon |
|---|---|---|
| Ivory | `#FDFAF3` | Ground (already `brandGround`) |
| Forest | `#173D30` | Book spines, pencil body (already `brandInk`) |
| Moss | `#485848` | Book bands, shading |
| Pencil gold | `~#C99858` | Pencil cap and tip, bookmark |
| Page cream | `#F8E8C8` | Page edges |

**Decisions taken (with Rvnadela, 2026-10-11).**
| Decision | Choice |
|---|---|
| Scope | Full warm rebrand — accents **and** neutrals, light **and** dark |
| Green collision | Forest becomes the Student accent; **Correct (`success`) moves to teal `#0F6E78`** so accent still means *interactive* and semantic colours still mean *state* |
| Parent View accent | **Ink navy `#2C4F7C`** — the two-room split by hue is kept |
| Review mode | Batch |

## 2. Impact Analysis

### Epic impact
- Epics 1–9: no functional change. Story 1.7 (Design System Foundation) built the token mechanism; its **mechanism** is untouched, only **values** change.
- Epic 10: **add Story 10.3 — Brand Palette.**

### Story impact
- New: Story 10.3.
- Story 1.7 acceptance criteria reference DESIGN.md's ratios table, not literal hex values — no edit needed.
- No story is reopened.

### Artifact conflicts
| Artifact | Conflict | Update |
|---|---|---|
| PRD | §7 Aesthetic and Tone describes tone (calm, dense, no gamification), not colour. | **None.** |
| Architecture | AD-32 governs the presentation tier's mechanism; no hex values. | **None.** |
| `DESIGN.md` | Frontmatter tokens, "Brand & Style" concept, Colors tables, measured-contrast table, inverted-surface duplicates. | **Rewrite colour values and concept** (4.2). |
| `epics.md` | UX-DR1 quotes old accent hex values. | Edit UX-DR1; add Story 10.3 (4.1). |
| `EXPERIENCE.md` | No hex values; refers to DESIGN.md. | **None.** |
| Mockups (`mockups/*.html`) | Painted in the old palette. | Add a superseded note to DESIGN.md; no repaint (reference art, not spec). |
| Review/validation reports, `.memlog.md` | Historical records of the old palette. | **None** — history, not spec. |

### Technical impact
- `apps/web/src/theme/tokens.ts`: value changes only, every key unchanged. `theme.ts` maps tokens onto MUI and needs no change.
- No hard-coded hex values exist outside `tokens.ts` in non-spec code (verified by grep).
- `apps/web/src/app/parent/capture/page.spec.tsx:852` has a comment quoting `#10202E`; update the comment.
- Specs that compare against `colorTokens.*` follow automatically. Any spec pinning a literal is updated in-story.
- `brandGround` / `brandInk` stay as their own tokens: the icon's colours do not follow the in-app palette. `brandGround` now equals light `backgroundPaper` — a **deliberate duplicate** in the same sense as the camera-chrome tokens.
- No API, DB, worker, or infrastructure change.

### Risks
1. **Correct (teal) vs Not graded yet (info blue)** are close in lightness (1.09:1 between them) and separate by hue alone. Under deuteranopia both read blue. Already mitigated by design: every grade state carries glyph, word, and shape redundancy (UX-DR17), and colour is never the only carrier. Story 10.3 re-verifies that redundancy visually.
2. **Ink navy Parent accent vs `info` blue** — the same closeness existed with the old clinical blue. No new risk.
3. **Users notice the change** — this is cosmetic and every contrast pair improves or holds. No retraining.

## 3. Recommended Approach

**Direct Adjustment** — add Story 10.3 to Epic 10; update `DESIGN.md` values and concept; change token values.

- **Rationale:** the token architecture from Story 1.7 already routes every colour through `tokens.ts`, so the rebrand is a values swap backed by a re-measured contrast table. No component code should change.
- **Effort:** Small–medium, about 0.5–1 day: token swap, a spec sweep, light/dark visual pass across Student, Parent, Admin, and camera chrome.
- **Risk:** Low. Every pair is measured below and clears its WCAG floor in both modes.
- **Timeline:** independent of other work.

## 4. Detailed Change Proposals

### 4.1 Epics (`epics.md`)

**UX-DR1**

OLD:
> UX-DR1: Implement the Clear Room dual-accent theme — `primary-student` (#0F6E78 / dark #71C3CE) and `primary-parent` (#0B5FA5 / dark #7FB6E8) — as one base MUI theme plus a nested `ThemeProvider` overriding `palette.primary` only per surface; every other token stays byte-identical across Student Mode, Parent View, and Admin.

NEW:
> UX-DR1: Implement the Reading Room dual-accent theme — `primary-student` (#1E5A45 forest / dark #7FC4A4) and `primary-parent` (#2C4F7C ink navy / dark #8FB3E0) — as one base MUI theme plus a nested `ThemeProvider` overriding `palette.primary` only per surface; every other token stays byte-identical across Student Mode, Parent View, and Admin. *(Palette revised 2026-10-11 to match the app icon; see `sprint-change-proposal-2026-10-11-brand-palette.md`.)*

Rationale: UX-DR1 is the only requirement quoting hex values; UX-DR2/3 already defer to DESIGN.md.

**New story (append to Epic 10):**

> ### Story 10.3: Brand Palette
>
> As a family,
> I want the app to look like the icon I tapped,
> So that the installed app feels like one product.
>
> **Acceptance Criteria:**
>
> **Given** `DESIGN.md` (Reading Room) as revised 2026-10-11
> **When** `apps/web/src/theme/tokens.ts` is updated
> **Then** every colour token carries the DESIGN.md light and dark value, with no token added, removed, or renamed, and no hex literal introduced outside `tokens.ts`
>
> **Given** the measured-contrast table in DESIGN.md
> **Then** a unit spec computes each listed pair from `colorTokens` and asserts it meets its floor (4.5:1 text, 3:1 non-text/divider), in light and dark, so a future token change that breaks a pair fails CI
>
> **Given** the grade-state markers (UX-DR17)
> **When** rendered with Correct in teal and Not graded yet in info blue
> **Then** each state stays identifiable with colour removed (glyph, word, shape), verified in light and dark
>
> **Given** the camera capture chrome
> **Then** it takes the updated on-inverted set, and its deliberate-duplicate comments name the new values
>
> **Given** `brandGround` and `brandInk`
> **Then** they are unchanged and documented as deliberate duplicates (icon colours never follow the palette)
>
> **Given** Student Mode, Parent View, Admin, and camera capture, in light and dark
> **Then** a visual pass shows no surface left on an old palette value, and the existing unit and E2E suites pass

**Epic 10 summary line** — append "and its palette matches the icon" to the epic goal; sprint status gains `10-3-brand-palette: backlog`.

### 4.2 UX — `DESIGN.md`

**Frontmatter**

- `name: Clear Room` → `name: Reading Room`
- `description:` "Cool clinical daylight for…" → "Warm reading-lamp ivory for a product that turns a returned school test into practice. One palette, one type scale, two densities, two accents. Colours follow the app icon. MUI on Next.js + React; this DESIGN.md specifies the theme the app builds."
- `updated: 2026-10-11`
- Colour tokens (old → new):

| Token | Light old → new | Dark old → new |
|---|---|---|
| `primary-student` | `#0F6E78` → **`#1E5A45`** forest | `#71C3CE` → **`#7FC4A4`** |
| `primary-parent` | `#0B5FA5` → **`#2C4F7C`** ink navy | `#7FB6E8` → **`#8FB3E0`** |
| `on-primary` | `#FFFFFF` (unchanged) | `#0E1620` → **`#101713`** |
| `secondary` | `#4A6072` → **`#56634F`** moss | `#9DB2C4` → **`#A9B8A2`** |
| `success` | `#0F6B4F` → **`#0F6E78`** teal | `#6FD1AC` → **`#71C3CE`** |
| `error` | `#B3261E` (unchanged) | `#F19B94` (unchanged) |
| `warning` | `#8A5A00` (unchanged) | `#E3B457` (unchanged) |
| `info` | `#2E6E9E` (unchanged) | `#8CC0E4` (unchanged) |
| `background-default` | `#F6F8FA` → **`#F4EFE4`** warm ivory | `#0E1620` → **`#101713`** green-charcoal |
| `background-paper` | `#FFFFFF` → **`#FDFAF3`** brand ivory | `#16202C` → **`#17201B`** |
| `text-primary` | `#10202E` → **`#1B2620`** | `#E7EEF5` → **`#E6EDE8`** |
| `text-secondary` | `#4E6070` → **`#545F58`** | `#A3B3C2` → **`#A4B2AA`** |
| `divider` | `#7C8894` → **`#7E857C`** | `#6A747E` → **`#6C766F`** |
| `state.tintHover` | `#EEF3F5` → **`#EFE9DC`** | `#1C2836` → **`#1F2A24`** |
| `state.tintSelected` | `#E8F1F2` → **`#E7EEE5`** | `#0D2A33` → **`#142B23`** (moved off `#163027`, which measured 3.00:1 against the divider — tint moved, never the divider, per the existing rule) |
| `background-inverted` | `#10202E` → **`#1B2620`** (= light text-primary, deliberate duplicate) | same |
| `primary-on-inverted` | `#7FB6E8` → **`#8FB3E0`** (= dark primary-parent, deliberate duplicate) | same |
| `divider-on-inverted` | `#6A747E` → **`#6C766F`** (= dark divider, deliberate duplicate) | same |
| `text-on-inverted` | `#FFFFFF` (unchanged) | same |

The three `*-deliberateDuplicate` frontmatter markers are rewritten to name the new values.

**Brand & Style, first paragraph**

OLD:
> Clear Room is cool clinical daylight. … neutral grounds, a single accent, flat bordered surfaces, and one serif …

NEW:
> Reading Room is warm reading-lamp ivory: the colours of the app icon — ivory paper, forest-green book spines, a pencil. The product takes a returned school test — a thing that arrives home covered in red pen — and turns it into practice. Its job is to be accurate and calm, so the visual system still has almost no opinion of its own: warm neutral grounds, a single accent, flat bordered surfaces, and one serif reserved for the only thing a user actually reads slowly. Warmth comes from the grounds, never from decoration: no gold flourishes, no textures, no book illustrations inside the app.

All other Brand & Style paragraphs (paper metaphor, anti-gamification, two rooms) are unchanged.

**Colors section**

- "Clear Room is one palette with one divergent role." → "Reading Room is…"
- Accent-split table: swap to the new values; labels "calm teal" → "forest", "clinical blue" → "ink navy".
- Semantic table: swap the values above; `success` meaning stays "**Correct** grade state only".
- New paragraph after the semantic table:
  > **Why Correct is teal, not green.** The Student accent is forest green, and the accent means *interactive*. A green Correct would make "this is a button" and "this answer was right" the same colour. Correct therefore takes teal `#0F6E78` (the retired Student accent), a hue no interactive control uses. Teal and `info` blue are close in lightness, so their distinction rests on hue plus the non-colour carriers every grade state already has. That is the existing rule, not a new dependency.
- New paragraph:
  > **Brand tokens are not palette tokens.** `brandGround` `#FDFAF3` and `brandInk` `#173D30` are the icon's own colours, used only by the web manifest and the browser `theme-color`. `brandGround` equals light `background-paper` by deliberate duplication: never alias one to the other, because the icon must not change when the palette does.
- **Measured contrast ratios table — replaced:**

| Pair | Light | Dark |
|---|---|---|
| `question-body` (text-primary) on `background-paper` | 14.98:1 | 14.02:1 |
| `success` on `background-paper` | 5.72:1 | 8.26:1 |
| `error` on `background-paper` | 6.27:1 | 7.83:1 |
| `warning` on `background-paper` | 5.69:1 | 8.68:1 |
| `info` on `background-paper` | 5.25:1 | 8.56:1 |
| `secondary` on `background-paper` | 6.12:1 | 8.00:1 |
| `text-secondary` on `background-paper` | 6.39:1 | 7.57:1 |
| `text-secondary` on `background-default` | 5.81:1 | 8.26:1 |
| `text-primary` on `state.tintHover` | 12.91:1 | 12.47:1 |
| `text-primary` on `state.tintSelected` | 13.21:1 | 12.61:1 |
| `divider` on `background-paper` | **3.64:1** | **3.54:1** |
| `divider` on `background-default` | **3.31:1** | **3.86:1** |
| `divider` on `state.tintHover` | **3.14:1** | **3.15:1** |
| `divider` on `state.tintSelected` | **3.21:1** | **3.19:1** |
| `primary-student` on `background-paper` | 7.74:1 | 8.21:1 |
| `primary-student` on `background-default` | 7.03:1 | 8.96:1 |
| `primary-parent` on `background-paper` | 8.01:1 | 7.70:1 |
| `primary-parent` on `background-default` | 7.28:1 | 8.40:1 |
| `on-primary` on `primary-student` | 8.07:1 | 8.96:1 |
| `on-primary` on `primary-parent` | 8.34:1 | 8.40:1 |
| `success` on `state.tintSelected` | 5.04:1 | 7.43:1 |
| `primary-on-inverted` on `background-inverted` | **7.21:1** | n/a — one ground only |
| `divider-on-inverted` on `background-inverted` | **3.32:1** | n/a — one ground only |
| `text-on-inverted` on `background-inverted` | 15.62:1 | n/a |
| `background-default` → `background-paper` step | 1.10:1 | 1.09:1 |
| Rejected: light `primary-parent` on `background-inverted` | 1.87:1 — fails SC 1.4.11 | n/a |
| Rejected: dark `tintSelected` `#163027` with `divider` | n/a | 3.00:1 — at floor, moved |
| Superseded: Clear Room palette (2026-08-29 → 2026-10-11) | see git history | — |

- Paragraph "Both hover grounds clear the SC 1.4.11 floor…" — replace its figures with the new ones (3.14 / 3.15 hover; 3.21 / 3.19 selected) and note that the dark selected tint was moved from `#163027` to `#142B23`.
- Inverted-surface paragraph: `#10202E` → `#1B2620`.
- Mockups note (end of Colors):
  > The HTML mockups in `mockups/` were painted in the superseded Clear Room palette. They stay valid for layout, hierarchy, and state treatment; for colour, this file wins.

The existing line "Question body on paper clears AAA in both modes" still holds (14.98 / 14.02) and is kept.

### 4.3 PRD, Architecture, EXPERIENCE.md

No change.

### 4.4 Code (Story 10.3, for reference)

- `apps/web/src/theme/tokens.ts` — values per 4.2; camera-chrome comment updated to the new duplicate values and the new rejected ratio (1.87:1).
- `apps/web/src/app/parent/capture/page.spec.tsx:852` — comment `#10202E` → `#1B2620`.
- New spec: contrast pairs from the DESIGN.md table, computed from `colorTokens`.

## 5. Implementation Handoff

- **Scope:** Minor → **Developer agent** (`bmad-build`), Story 10.3.
- **Order:** apply doc edits (4.1, 4.2) on approval, then build 10.3.
- **Sprint status:** add `10-3-brand-palette: backlog`; `epic-10` returns to `in-progress`.

### Success criteria
1. `tokens.ts` matches DESIGN.md exactly. The contrast spec passes for every pair in light and dark.
2. Visual pass in light and dark across Student Home, Take Test, Results, Parent dashboard, Analytics, Capture (camera chrome), and Admin: no cool-grey or teal accent remains except `success`.
3. Grade states are identifiable in greyscale.
4. Existing unit and E2E suites pass.
5. The installed app's splash (`brandGround`) and in-app paper are the same ivory, so the transition is seamless.

## 6. Open Questions

None. All decisions taken above.

## 7. Approval

Approved by Rvnadela, 2026-10-12, after reviewing the swatch preview (light and dark, greyscale grade-state check). Doc edits applied; routed to Developer agent (`bmad-build`), Story 10.3.
