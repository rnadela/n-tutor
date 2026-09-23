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
} as const;

export const rounded = { control: 8 } as const;

export const focusRing = { width: 2, offset: 2 } as const;

export const sansStack =
  "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** The `table-cell` type role covers admin tables. */
export const typeRoles = {
  tableCell: { fontSize: 16, lineHeight: 1.45 },
} as const;
