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
  /** Base (Student View) accent. */
  primaryStudent: { light: '#0F6E78', dark: '#71C3CE' },
  /** Parent View accent — the Admin console's only palette override. */
  primaryParent: { light: '#0B5FA5', dark: '#7FB6E8' },
  onPrimary: { light: '#FFFFFF', dark: '#0E1620' },
  secondary: { light: '#4A6072', dark: '#9DB2C4' },
  success: { light: '#0F6B4F', dark: '#6FD1AC' },
  error: { light: '#B3261E', dark: '#F19B94' },
  warning: { light: '#8A5A00', dark: '#E3B457' },
  info: { light: '#2E6E9E', dark: '#8CC0E4' },
  backgroundDefault: { light: '#F6F8FA', dark: '#0E1620' },
  backgroundPaper: { light: '#FFFFFF', dark: '#16202C' },
  textPrimary: { light: '#10202E', dark: '#E7EEF5' },
  textSecondary: { light: '#4E6070', dark: '#A3B3C2' },
  /** The sole boundary of every control — one divider tier, no second. */
  divider: { light: '#7C8894', dark: '#6A747E' },
  tintHover: { light: '#EEF3F5', dark: '#1C2836' },
  tintSelected: { light: '#E8F1F2', dark: '#0D2A33' },

  /*
   * Camera chrome: the one inverted surface in the product (UX-DR4).
   *
   * All four are identical in light and dark on purpose — a viewfinder is dark
   * in both schemes, because the photograph is the content and the chrome
   * around it must not compete with it. There is deliberately no fifth token
   * that tracks the scheme.
   *
   * DELIBERATE DUPLICATE. `backgroundInverted` repeats light `textPrimary`,
   * `primaryOnInverted` repeats dark `primaryParent`, `dividerOnInverted`
   * repeats dark `divider`, and `textOnInverted` repeats light `onPrimary`.
   * Never alias, collapse or "tidy" any of them into the token they happen to
   * equal: the light parent primary measures ~2.5:1 on this ground and white
   * measures 16.56:1, so a future change to the parent palette must not reach
   * the camera, and "correcting" the duplication is a contrast regression
   * rather than a cleanup.
   */
  backgroundInverted: { light: '#10202E', dark: '#10202E' },
  primaryOnInverted: { light: '#7FB6E8', dark: '#7FB6E8' },
  dividerOnInverted: { light: '#6A747E', dark: '#6A747E' },
  textOnInverted: { light: '#FFFFFF', dark: '#FFFFFF' },
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
