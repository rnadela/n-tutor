// Type-only, so it is erased at compile time: this module is imported by the
// theme itself and must not acquire a runtime dependency on a `'use client'`
// module. The four states are the API's own literals, named once.
import type { GradeState } from '@/lib/parent-api';

/**
 * DESIGN tokens as data, not CSS. Every colour token carries both a light and
 * a dark value — dark mode is scope, not polish (AD-32). `theme.ts` is the only
 * place these are mapped onto MUI.
 */
export interface TokenPair {
  light: string;
  dark: string;
}

export const colorTokens = {
  /**
   * Base (Student View) accent — forest green, drawn from the app icon's forest
   * family. It is not the icon's own ink: that is `brandInk` `#173D30`, a
   * different green, and the two are never interchanged.
   *
   * This and `primaryParent` are the two-rooms hue split: the accent is the one
   * role that differs between Student Mode and Parent View, and it differs by
   * hue (forest vs ink navy) rather than by lightness, so the two surfaces read
   * as two rooms in the same house. Every other token is byte-identical across
   * Student Mode, Parent View and Admin.
   */
  primaryStudent: { light: '#1E5A45', dark: '#7FC4A4' },
  /** Parent View accent — ink navy; the Admin console's only palette override. */
  primaryParent: { light: '#2C4F7C', dark: '#8FB3E0' },
  onPrimary: { light: '#FFFFFF', dark: '#101713' },
  secondary: { light: '#56634F', dark: '#A9B8A2' },
  /**
   * Correct is teal, not green, and that is the point.
   *
   * The accent means *interactive*; a green `success` beside a forest accent
   * would paint "this is a button" and "this answer was right" the same colour.
   * `success` therefore takes the retired Student accent — a hue no interactive
   * control uses. Teal sits close to `info` in lightness and separates from it
   * by hue alone, which is survivable only because every grade state already
   * carries frame, border, glyph, rule texture and a literal word
   * (`GradeStateMarker.spec.tsx` proves it with colour stripped).
   */
  success: { light: '#0F6E78', dark: '#71C3CE' },
  error: { light: '#B3261E', dark: '#F19B94' },
  warning: { light: '#8A5A00', dark: '#E3B457' },
  info: { light: '#2E6E9E', dark: '#8CC0E4' },
  backgroundDefault: { light: '#F4EFE4', dark: '#101713' },
  backgroundPaper: { light: '#FDFAF3', dark: '#17201B' },
  textPrimary: { light: '#1B2620', dark: '#E6EDE8' },
  textSecondary: { light: '#545F58', dark: '#A4B2AA' },
  /** The sole boundary of every control — one divider tier, no second. */
  divider: { light: '#7E857C', dark: '#6C766F' },
  tintHover: { light: '#EFE9DC', dark: '#1F2A24' },
  tintSelected: { light: '#E7EEE5', dark: '#142B23' },

  /*
   * Camera chrome: the one inverted surface in the product (UX-DR4).
   *
   * All four are identical in light and dark on purpose — a viewfinder is dark
   * in both schemes, because the photograph is the content and the chrome
   * around it must not compete with it. There is deliberately no fifth token
   * that tracks the scheme.
   *
   * DELIBERATE DUPLICATE. `backgroundInverted` repeats light `textPrimary`
   * (#1B2620), `primaryOnInverted` repeats dark `primaryParent` (#8FB3E0),
   * `dividerOnInverted` repeats dark `divider` (#6C766F), and `textOnInverted`
   * repeats light `onPrimary` (#FFFFFF). Never alias, collapse or "tidy" any of
   * them into the token they happen to equal: on this ground the light parent
   * primary measures 1.87:1 — below the 3:1 non-text floor — while the
   * on-inverted accent measures 7.21:1, the on-inverted divider 3.32:1 and
   * white 15.62:1. A future change to the parent palette must not reach the
   * camera, so "correcting" the duplication is a contrast regression rather
   * than a cleanup.
   */
  backgroundInverted: { light: '#1B2620', dark: '#1B2620' },
  primaryOnInverted: { light: '#8FB3E0', dark: '#8FB3E0' },
  dividerOnInverted: { light: '#6C766F', dark: '#6C766F' },
  textOnInverted: { light: '#FFFFFF', dark: '#FFFFFF' },

  /*
   * The app icon's own two colours, read by the manifest and the browser's
   * `theme-color` — never by the in-app palette. The installed window's chrome
   * and splash have to match the icon the family tapped, not the page beneath.
   * Identical in both schemes for the same reason: the icon does not change
   * with the device's preference.
   *
   * DELIBERATE DUPLICATE. Since the Reading Room swap `brandGround` `#FDFAF3`
   * is byte-identical to light `backgroundPaper`. Never alias, collapse or
   * dedupe the two: the icon must not change when the palette does, and
   * aliasing them would make the next palette move repaint the installed
   * splash and the browser chrome — exactly the mismatch this palette exists
   * to fix.
   *
   * Not every equality in this module is one of those. `onPrimary.dark`
   * `#101713` also happens to equal `backgroundDefault.dark`, but that is
   * incidental arithmetic rather than a stated rule, and it carries no marker:
   * DELIBERATE DUPLICATE means "a tidying pass must not touch this", so it is
   * spent only where the duplication is load-bearing.
   */
  brandGround: { light: '#FDFAF3', dark: '#FDFAF3' },
  brandInk: { light: '#173D30', dark: '#173D30' },
} as const satisfies Record<string, TokenPair>;

export type ColorTokenName = keyof typeof colorTokens;
export type ColorScheme = keyof TokenPair;

export function token(name: ColorTokenName, scheme: ColorScheme): string {
  return colorTokens[name][scheme];
}

/** `density.compact` — the Admin console's density. */
export const density = {
  rowHeight: 40,
  cardPadding: 12,
  gap: 8,
  sectionMargin: 20,
  /** Parent/Admin tap-target floor. */
  tapTarget: 44,
} as const satisfies DensitySet;

/**
 * `density.comfortable` — Student Mode's set.
 *
 * A child's surface is roomier than a parent's console: taller rows, more air,
 * and a larger tap-target floor. It stands beside `density` rather than
 * replacing or parameterising it, so the Admin and Parent surfaces keep the
 * compact set they were built against.
 */
export const comfortableDensity = {
  rowHeight: 56,
  cardPadding: 20,
  gap: 16,
  sectionMargin: 32,
  /** Student Mode's tap-target floor. No component restates the figure. */
  tapTarget: 48,
} as const satisfies DensitySet;

/**
 * The shape both density sets share (UX-DR9). `buildTheme` takes one of these
 * rather than closing over a single import, so a surface's density is a
 * parameter of the theme and never a figure inside a component.
 */
export interface DensitySet {
  rowHeight: number;
  cardPadding: number;
  gap: number;
  sectionMargin: number;
  /** The surface's tap-target floor: 44 compact, 48 comfortable (UX-DR10). */
  tapTarget: number;
}

/**
 * Radius is semantic: it encodes is-this-paper-or-a-control (UX-DR12).
 *
 * `paper` is the near-square role for anything carrying generated Question or
 * Explanation content; `control` is the rounded role for everything tappable;
 * `none` is the deliberate zero, so a component never writes `0` inline.
 */
export const rounded = { paper: 2, control: 8, none: 0 } as const;

export const focusRing = { width: 2, offset: 2 } as const;

/**
 * How one grade state is drawn, on five carriers.
 *
 * `frame` and `border` are the icon's shape and its outline; `glyph` is the mark
 * inside it; `rule` is the texture of the row's left rule; `color` is a token name.
 * **Colour is the fifth carrier and never alone** — strip every colour, class and
 * inline style and the four states are still told apart by the shape, the outline,
 * the glyph, the rule texture and the literal text label beside them (UX-DR33).
 */
export interface GradeStateMarker {
  frame: 'circle' | 'square';
  border: 'solid' | 'dashed' | 'dotted';
  /** Drawn `aria-hidden`: the label beside it is what is announced. */
  glyph: string;
  rule: 'solid' | 'hatch' | 'dashed' | 'dotted';
  color: ColorTokenName;
}

/** The left rule's width, in px. One figure, so no component writes its own. */
export const GRADE_RULE_WIDTH = 4;

/**
 * The four states as data, and the only place their drawing is decided.
 *
 * **`Correct` and `Incorrect` share a frame shape on purpose.** They are the two
 * verdicts — the same *kind* of fact about the work — and giving them different
 * outlines would group `Incorrect` with the two non-verdicts instead. They separate
 * on every other axis: the glyph, the row rule's texture and the colour. The two
 * non-verdicts take the other shapes, so "nothing judged this" is legible as a
 * different kind of row before a word is read.
 *
 * `hatch` for `Incorrect` rather than a second solid: a solid rule in another
 * colour is a colour-only distinction, which is the one thing this table exists to
 * avoid. The rule is `GRADE_RULE_WIDTH` px wide in every state, so the texture and
 * never the weight is what differs.
 *
 * **No new colour token.** All four name tokens that already exist.
 */
export const gradeStateMarker = {
  Correct: { frame: 'circle', border: 'solid', glyph: '✓', rule: 'solid', color: 'success' },
  Incorrect: { frame: 'circle', border: 'solid', glyph: '✗', rule: 'hatch', color: 'error' },
  Unanswered: {
    frame: 'circle',
    border: 'dashed',
    glyph: '—',
    rule: 'dashed',
    color: 'textSecondary',
  },
  Ungraded: { frame: 'square', border: 'dotted', glyph: '⋯', rule: 'dotted', color: 'info' },
} as const satisfies Record<GradeState, GradeStateMarker>;

/**
 * The bottom navigation bar's own geometry, from DESIGN.md's `bottom-nav`
 * block (`height: 56px`, `currentCarrier: … a 3px indicator bar`).
 *
 * One figure in one place: three shells mount the bar, and the shared snackbar
 * and every scrollable screen offset themselves by its height. If any of them
 * held its own copy of 56 they could disagree, and the disagreement would read
 * as a row of a list sitting half under the navigation.
 */
export const bottomNav = { height: 56, indicator: 3 } as const;

/** MUI's 8px base, named. No component writes a raw spacing number (UX-DR9). */
export const spacing = {
  base: 8,
  1: 8,
  2: 16,
  3: 24,
  4: 32,
  5: 40,
} as const;

/** Question content is capped at this measure regardless of viewport. */
export const measure = { questionMaxWidth: '34rem' } as const;

/**
 * Motion is permitted only for the transitions UX-DR37 sanctions, and every
 * one of them collapses to `0` under `prefers-reduced-motion`. The reduced
 * duration is a token rather than a literal so the rule is assertable.
 */
export const motion = {
  durationShort: 120,
  durationStandard: 200,
  durationLong: 320,
  /** `prefers-reduced-motion: reduce` resolves every duration to this. */
  durationReduced: 0,
  /**
   * How long a snackbar stays up before dismissing itself. Long enough to read
   * a sentence twice; a message that never leaves is a message that stacks.
   */
  snackbarAutoHide: 6000,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const sansStack =
  "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Generated content — Question text, Explanations, answer keys — only. */
export const serifStack = "'Literata', Georgia, 'Iowan Old Style', 'Times New Roman', serif";

export interface TypeRole {
  fontFamily: string;
  /** rem, so the role honours the browser's root size. */
  fontSize: string;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: string;
  /**
   * Whether the role's figures align in a column or tick in place (UX-DR7).
   * Deliberately false on the serif roles: Literata needs `tnum` applied
   * explicitly, and running prose keeps proportional figures.
   */
  tabular: boolean;
}

/**
 * The eight-role scale, one ramp shared identically by Student Mode and Parent
 * View (UX-DR6). Family follows content, never surface: the two generated
 * -content roles are serif, the six chrome roles sans.
 */
export const typeRoles = {
  questionBody: {
    fontFamily: serifStack,
    fontSize: '1.375rem',
    fontWeight: 400,
    lineHeight: 1.6,
    tabular: false,
  },
  explanationBody: {
    fontFamily: serifStack,
    fontSize: '1.1875rem',
    fontWeight: 400,
    lineHeight: 1.65,
    tabular: false,
  },
  cardTitle: {
    fontFamily: sansStack,
    fontSize: '1.25rem',
    fontWeight: 600,
    lineHeight: 1.35,
    tabular: false,
  },
  dashboardBody: {
    fontFamily: sansStack,
    fontSize: '1.0625rem',
    fontWeight: 400,
    lineHeight: 1.55,
    tabular: false,
  },
  tableCell: {
    fontFamily: sansStack,
    fontSize: '1rem',
    fontWeight: 400,
    lineHeight: 1.45,
    tabular: true,
  },
  label: {
    fontFamily: sansStack,
    fontSize: '0.875rem',
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: '0.02em',
    tabular: true,
  },
  caption: {
    fontFamily: sansStack,
    fontSize: '0.8125rem',
    fontWeight: 400,
    lineHeight: 1.4,
    tabular: true,
  },
  timer: {
    fontFamily: sansStack,
    fontSize: '1.75rem',
    fontWeight: 600,
    lineHeight: 1.2,
    tabular: true,
  },
} as const satisfies Record<string, TypeRole>;

export type TypeRoleName = keyof typeof typeRoles;
