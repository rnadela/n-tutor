import { describe, expect, it } from 'vitest';
import type { Theme } from '@mui/material/styles';
import { adminTheme, baseTheme, parentTheme, studentTheme, typographyFor } from './theme';
import {
  colorTokens,
  comfortableDensity,
  density,
  motion,
  rounded,
  sansStack,
  serifStack,
  spacing,
  typeRoles,
  type DensitySet,
  type TypeRoleName,
} from './tokens';

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

describe('the student theme', () => {
  it.each(schemes)('differs from the base theme in nothing at all, in %s', (scheme) => {
    // Student Mode shares the base accent; its only divergence is density,
    // which does not live in the palette.
    const base = baseTheme.colorSchemes[scheme]!.palette as unknown as Record<string, unknown>;
    const student = studentTheme.colorSchemes[scheme]!.palette as unknown as Record<
      string,
      unknown
    >;
    for (const key of ['primary', ...tokenPaletteEntries]) {
      expect(student[key], key).toEqual(base[key]);
    }
  });

  it.each(schemes)('matches the parent theme entry for entry but for primary, in %s', (scheme) => {
    const student = studentTheme.colorSchemes[scheme]!.palette as unknown as Record<
      string,
      unknown
    >;
    const parent = parentTheme.colorSchemes[scheme]!.palette as unknown as Record<string, unknown>;
    for (const key of tokenPaletteEntries) {
      expect(student[key], key).toEqual(parent[key]);
    }
    expect(student.primary).not.toEqual(parent.primary);
  });

  it('carries the comfortable density set, and the parent surfaces the compact one', () => {
    expect(studentTheme.density).toEqual(comfortableDensity);
    expect(baseTheme.density).toEqual(density);
    expect(parentTheme.density).toEqual(density);
    expect(adminTheme.density).toEqual(density);
  });

  it('shares its whole type scale with the compact surfaces', () => {
    // One ramp across both rooms (UX-DR6): density divergence is carried by
    // spacing alone, never by a smaller typeface on the parent's console.
    for (const role of Object.keys(typeRoles) as TypeRoleName[]) {
      const variant = role as keyof typeof studentTheme.typography;
      expect(studentTheme.typography[variant], role).toEqual(parentTheme.typography[variant]);
    }
  });
});

describe('the type scale', () => {
  it('maps every one of the eight roles onto a named typography variant', () => {
    for (const role of Object.keys(typeRoles) as TypeRoleName[]) {
      const variant = baseTheme.typography[role as keyof typeof baseTheme.typography];
      expect(variant, role).toBeDefined();
    }
  });

  it('resolves question-body at the DESIGN figures, in the serif family', () => {
    expect(baseTheme.typography.questionBody).toMatchObject({
      fontFamily: serifStack,
      fontSize: '1.375rem',
      fontWeight: 400,
      lineHeight: 1.6,
    });
  });

  it('resolves explanation-body at the DESIGN figures, in the serif family', () => {
    expect(baseTheme.typography.explanationBody).toMatchObject({
      fontFamily: serifStack,
      fontSize: '1.1875rem',
      fontWeight: 400,
      lineHeight: 1.65,
    });
  });

  it('gives every chrome role the sans family and every content role the serif', () => {
    // Family follows content, never surface (UX-DR5).
    expect(typeRoles.questionBody.fontFamily).toBe(serifStack);
    expect(typeRoles.explanationBody.fontFamily).toBe(serifStack);
    for (const role of ['cardTitle', 'dashboardBody', 'tableCell', 'label', 'caption', 'timer']) {
      expect(typeRoles[role as TypeRoleName].fontFamily, role).toBe(sansStack);
    }
  });

  it('declares both families with the DESIGN fallback stacks', () => {
    expect(serifStack).toContain("'Literata'");
    expect(serifStack).toContain('serif');
    expect(sansStack).toContain("'Source Sans 3'");
    expect(sansStack).toContain('sans-serif');
  });

  it('gives label its +0.02em letter-spacing', () => {
    expect(baseTheme.typography.label).toMatchObject({ letterSpacing: '0.02em' });
  });

  it('maps the MUI default variants onto named roles rather than leaving them stock', () => {
    // `body1`/`body2` are what every variant-less `<Typography>` on the shipped
    // 1.1-1.6 screens resolves to; an accidental revert here would silently
    // change their font size, weight and line-height with nothing else to catch it.
    expect(baseTheme.typography.body1).toEqual(typographyFor(typeRoles.dashboardBody));
    expect(baseTheme.typography.body2).toEqual(typographyFor(typeRoles.tableCell));
  });
});

describe('tabular figures', () => {
  it('rides on the ticking and column-aligned roles', () => {
    for (const role of ['timer', 'tableCell', 'label', 'caption'] as TypeRoleName[]) {
      expect(typographyFor(typeRoles[role]), role).toMatchObject({
        fontVariantNumeric: 'tabular-nums',
      });
    }
  });

  it('is absent from running prose, Question text and Explanations', () => {
    // Literata needs `tnum` explicitly, so an accidental global would apply it
    // where DESIGN.md keeps proportional figures.
    for (const role of ['questionBody', 'explanationBody', 'dashboardBody'] as TypeRoleName[]) {
      expect(typographyFor(typeRoles[role]), role).not.toHaveProperty('fontVariantNumeric');
    }
  });
});

describe('density', () => {
  /**
   * Every override a density set reaches. Asserted against the token rather
   * than against a restated figure: a token change the overrides fail to
   * follow is the defect worth catching, and a literal here would hide it.
   */
  function overridesFollow(theme: Theme, set: DensitySet) {
    expect(theme.density).toEqual(set);
    expect(theme.components?.MuiButton?.styleOverrides?.root).toMatchObject({
      minHeight: set.tapTarget,
      paddingInline: set.cardPadding,
    });
    expect(theme.components?.MuiIconButton?.styleOverrides?.root).toMatchObject({
      minHeight: set.tapTarget,
      minWidth: set.tapTarget,
    });
    expect(theme.components?.MuiOutlinedInput?.styleOverrides?.root).toMatchObject({
      minHeight: set.tapTarget,
    });
    expect(theme.components?.MuiCheckbox?.styleOverrides?.root).toMatchObject({
      width: set.tapTarget,
      height: set.tapTarget,
    });
    expect(theme.components?.MuiSwitch?.styleOverrides?.root).toMatchObject({
      minHeight: set.tapTarget,
    });
    expect(theme.components?.MuiTableRow?.styleOverrides?.root).toMatchObject({
      height: set.rowHeight,
    });
    expect(theme.components?.MuiCardContent?.styleOverrides?.root).toMatchObject({
      padding: set.cardPadding,
    });
  }

  it('gives Student Mode the comfortable set throughout', () => {
    overridesFollow(studentTheme, comfortableDensity);
  });

  it('holds Parent View and Admin to the compact set throughout', () => {
    for (const theme of [parentTheme, adminTheme]) overridesFollow(theme, density);
  });

  it('keeps the two floors apart, and never lets the compact one shrink', () => {
    // The one place the figures are named, because here they are the
    // requirement rather than a restatement: 44 for a parent's console, 48 for
    // a child's (UX-DR10).
    expect(density.tapTarget).toBe(44);
    expect(comfortableDensity.tapTarget).toBe(48);
    expect(comfortableDensity.tapTarget).toBeGreaterThan(density.tapTarget);
  });
});

describe('the semantic radius set', () => {
  it('separates the paper role from the control role', () => {
    expect(rounded.paper).toBe(2);
    expect(rounded.control).toBe(8);
    expect(rounded.none).toBe(0);
  });

  it('gives every control the control radius', () => {
    expect(baseTheme.shape.borderRadius).toBe(rounded.control);
    expect(baseTheme.components?.MuiButton?.styleOverrides?.root).toMatchObject({
      borderRadius: rounded.control,
    });
    expect(baseTheme.components?.MuiOutlinedInput?.styleOverrides?.root).toMatchObject({
      borderRadius: rounded.control,
    });
  });

  it('gives Paper the paper role, and Card the control role over it', () => {
    // Paper is what carries generated Question and Explanation content, so it
    // is the near-square role; a Card is a control surface and rounds.
    expect(baseTheme.components?.MuiPaper?.styleOverrides?.root).toMatchObject({
      borderRadius: rounded.paper,
    });
    const card = baseTheme.components?.MuiCard?.styleOverrides?.root as (arg: never) => {
      borderRadius: number;
    };
    expect(card({ theme: baseTheme } as never).borderRadius).toBe(rounded.control);
  });
});

describe('the spacing scale', () => {
  it("is the theme's own spacing unit, not MUI's default", () => {
    // CSS variables are on, so a spacing call resolves to the var with the
    // token as its fallback rather than to a bare figure.
    expect(spacing.base).toBe(8);
    expect(baseTheme.spacing(1)).toContain(`${spacing.base}px`);
    // Step 3 is three of those units, which is the scale's own 24px.
    expect(baseTheme.spacing(3)).toContain(`3 * var(--mui-spacing, ${spacing.base}px)`);
    expect(spacing[3]).toBe(spacing.base * 3);
  });
});

describe('overlay separation', () => {
  const probe = { theme: baseTheme } as never;

  it.each(['MuiDialog', 'MuiMenu', 'MuiPopover'] as const)(
    '%s is a scrim plus a 1px divider border, never a shadow',
    (name) => {
      const overrides = baseTheme.components?.[name]?.styleOverrides as
        | Record<string, (arg: never) => Record<string, unknown>>
        | undefined;
      const paper = overrides?.paper?.(probe);
      expect(paper?.boxShadow).toBe('none');
      expect(String(paper?.border)).toContain('1px solid');
    },
  );

  it('keeps the snackbar flat and bordered', () => {
    const overrides = baseTheme.components?.MuiSnackbarContent?.styleOverrides as
      | Record<string, (arg: never) => Record<string, unknown>>
      | undefined;
    const root = overrides?.root?.(probe);
    expect(root?.boxShadow).toBe('none');
    expect(String(root?.border)).toContain('1px solid');
    expect(baseTheme.components?.MuiSnackbarContent?.defaultProps?.elevation).toBe(0);
  });
});

describe('reduced motion', () => {
  /** Every declaration the theme emits under the reduced-motion query. */
  function reducedMotionRules(): Record<string, string> {
    const build = baseTheme.components?.MuiCssBaseline?.styleOverrides as (
      theme: typeof baseTheme,
    ) => Record<string, Record<string, Record<string, string>>>;
    return build(baseTheme)['@media (prefers-reduced-motion: reduce)']!['*, *::before, *::after']!;
  }

  it('resolves every transition and animation duration to 0ms', () => {
    const rules = reducedMotionRules();
    expect(motion.durationReduced).toBe(0);
    expect(rules.transitionDuration).toBe('0ms !important');
    expect(rules.animationDuration).toBe('0ms !important');
  });

  it('zeroes the delays too: a zeroed duration still stalls for its delay', () => {
    const rules = reducedMotionRules();
    expect(rules.transitionDelay).toBe('0ms !important');
    expect(rules.animationDelay).toBe('0ms !important');
  });

  it('emits real durations when reduced motion is not asked for', () => {
    // The rule only means something if there is motion to disable.
    expect(baseTheme.transitions.duration.standard).toBe(motion.durationStandard);
    expect(baseTheme.transitions.duration.standard).toBeGreaterThan(motion.durationReduced);
  });

  it("keeps MUI's own easing semantics for everything but the standard curve", () => {
    // `sharp` exists precisely to differ on leaving states; flattening all
    // four to one curve would erase a distinction DESIGN.md never asked to
    // lose.
    expect(baseTheme.transitions.easing.easeInOut).toBe(motion.easing);
    expect(baseTheme.transitions.easing.sharp).not.toBe(motion.easing);
    expect(baseTheme.transitions.easing.easeIn).not.toBe(motion.easing);
    expect(baseTheme.transitions.easing.easeOut).not.toBe(motion.easing);
  });
});
