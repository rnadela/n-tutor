import { describe, expect, it } from 'vitest';
import { adminTheme, baseTheme } from './theme';
import { colorTokens } from './tokens';

const schemes = ['light', 'dark'] as const;

/**
 * The palette entries the token set defines. MUI additionally derives a few
 * per-component colours (LinearProgress, Skeleton, …) from `primary`; those are
 * consequences of the one override, not separate palette entries.
 */
const tokenPaletteEntries = [
  'secondary',
  'success',
  'error',
  'warning',
  'info',
  'background',
  'text',
  'divider',
  'action',
  'common',
  'grey',
  'mode',
] as const;

describe('admin theme', () => {
  it.each(schemes)('overrides palette.primary only, in %s', (scheme) => {
    const base = baseTheme.colorSchemes[scheme]!.palette as unknown as Record<string, unknown>;
    const admin = adminTheme.colorSchemes[scheme]!.palette as unknown as Record<string, unknown>;

    // The two themes must genuinely differ: the base carries the Student View
    // accent, the admin theme the Parent View one.
    expect(base.primary).toMatchObject({ main: colorTokens.primaryStudent[scheme] });
    expect(admin.primary).toMatchObject({ main: colorTokens.primaryParent[scheme] });
    for (const key of tokenPaletteEntries) {
      expect(Object.keys(admin), key).toContain(key);
      expect(admin[key], key).toEqual(base[key]);
    }
    expect(admin.primary).not.toEqual(base.primary);
  });

  it.each(schemes)('uses the Parent View accent in %s', (scheme) => {
    const primary = adminTheme.colorSchemes[scheme]!.palette.primary;
    expect(primary.main).toBe(colorTokens.primaryParent[scheme]);
    expect(primary.contrastText).toBe(colorTokens.onPrimary[scheme]);
  });

  it.each(schemes)('matches the token set entry for entry, in %s', (scheme) => {
    const palette = adminTheme.colorSchemes[scheme]!.palette;
    expect(palette.secondary.main).toBe(colorTokens.secondary[scheme]);
    expect(palette.success.main).toBe(colorTokens.success[scheme]);
    expect(palette.error.main).toBe(colorTokens.error[scheme]);
    expect(palette.warning.main).toBe(colorTokens.warning[scheme]);
    expect(palette.info.main).toBe(colorTokens.info[scheme]);
    expect(palette.background.default).toBe(colorTokens.backgroundDefault[scheme]);
    expect(palette.background.paper).toBe(colorTokens.backgroundPaper[scheme]);
    expect(palette.text.primary).toBe(colorTokens.textPrimary[scheme]);
    expect(palette.text.secondary).toBe(colorTokens.textSecondary[scheme]);
    expect(palette.divider).toBe(colorTokens.divider[scheme]);
    expect(palette.action.hover).toBe(colorTokens.tintHover[scheme]);
    expect(palette.action.selected).toBe(colorTokens.tintSelected[scheme]);
  });

  it('renders no surface above elevation 0', () => {
    expect(adminTheme.components?.MuiPaper?.defaultProps?.elevation).toBe(0);
    expect(adminTheme.components?.MuiCard?.defaultProps?.elevation).toBe(0);
    expect(adminTheme.components?.MuiAppBar?.defaultProps?.elevation).toBe(0);
    expect(adminTheme.components?.MuiButton?.defaultProps?.disableElevation).toBe(true);
  });

  it('defines both a light and a dark value for every colour token', () => {
    for (const [name, pair] of Object.entries(colorTokens)) {
      expect(pair.light, `${name}.light`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(pair.dark, `${name}.dark`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
