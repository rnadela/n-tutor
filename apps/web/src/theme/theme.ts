import { createTheme, type Theme, type TypographyStyle } from '@mui/material/styles';
import {
  colorTokens,
  comfortableDensity,
  density,
  focusRing,
  motion,
  rounded,
  sansStack,
  spacing,
  typeRoles,
  type ColorScheme,
  type DensitySet,
  type TokenPair,
  type TypeRole,
} from './tokens';

function paletteFor(scheme: ColorScheme, primaryMain: string) {
  return {
    primary: { main: primaryMain, contrastText: colorTokens.onPrimary[scheme] },
    secondary: { main: colorTokens.secondary[scheme], contrastText: colorTokens.onPrimary[scheme] },
    success: { main: colorTokens.success[scheme] },
    error: { main: colorTokens.error[scheme] },
    warning: { main: colorTokens.warning[scheme] },
    info: { main: colorTokens.info[scheme] },
    background: {
      default: colorTokens.backgroundDefault[scheme],
      paper: colorTokens.backgroundPaper[scheme],
    },
    text: {
      primary: colorTokens.textPrimary[scheme],
      secondary: colorTokens.textSecondary[scheme],
    },
    divider: colorTokens.divider[scheme],
    action: {
      hover: colorTokens.tintHover[scheme],
      selected: colorTokens.tintSelected[scheme],
    },
  };
}

/**
 * One type role as MUI typography. `tabular-nums` rides on the role's own flag
 * (UX-DR7) rather than on a global: the serif roles deliberately omit it, since
 * running prose, Question text and Explanations keep proportional figures.
 */
export function typographyFor(role: TypeRole): TypographyStyle {
  return {
    fontFamily: role.fontFamily,
    fontSize: role.fontSize,
    fontWeight: role.fontWeight,
    lineHeight: role.lineHeight,
    ...(role.letterSpacing === undefined ? {} : { letterSpacing: role.letterSpacing }),
    ...(role.tabular ? { fontVariantNumeric: 'tabular-nums' as const } : {}),
  };
}

/** Elevation 0 with no shadow; the boundary is drawn only where one is wanted. */
const flatSurface = {
  backgroundImage: 'none',
  boxShadow: 'none',
};

/**
 * The single 1px divider boundary. Applied to Card only — putting it on every
 * Paper would double the border on components that draw their own outline,
 * such as `Alert variant="outlined"`, Menu, Popover and Tooltip.
 */
const borderedSurface = ({ theme }: { theme: Theme }) => ({
  ...flatSurface,
  border: `1px solid ${theme.vars.palette.divider}`,
  borderRadius: rounded.control,
});

const focusOutline = ({ theme }: { theme: Theme }) => ({
  '&:focus-visible': {
    outline: `${focusRing.width}px solid ${theme.vars.palette.primary.main}`,
    outlineOffset: focusRing.offset,
  },
});

/**
 * Overlay separation is scrim plus a 1px divider border — never a shadow
 * (UX-DR11). The scrim is the theme's own backdrop; the border is what makes
 * the overlay's own edge readable against it.
 */
const overlaySurface = ({ theme }: { theme: Theme }) => ({
  ...flatSurface,
  border: `1px solid ${theme.vars.palette.divider}`,
  borderRadius: rounded.control,
});

/**
 * Builds a theme from the token set, parameterised by the accent and by the
 * surface's density set. Every colour comes from a token that defines both a
 * light and a dark value; nothing hardcodes a colour, a size or a spacing
 * figure, and nothing but `palette.primary` and the density set varies between
 * the surfaces' themes.
 */
export function buildTheme(primary: TokenPair, d: DensitySet): Theme {
  return createTheme({
    cssVariables: { colorSchemeSelector: 'data' },
    colorSchemes: {
      light: { palette: paletteFor('light', primary.light) },
      dark: { palette: paletteFor('dark', primary.dark) },
    },
    shape: { borderRadius: rounded.control },
    // The 8px base, from the token rather than MUI's own default.
    spacing: spacing.base,
    // The surface's density, readable from any component as `theme.density`.
    density: d,
    transitions: {
      duration: {
        shortest: motion.durationShort,
        shorter: motion.durationShort,
        short: motion.durationStandard,
        standard: motion.durationStandard,
        complex: motion.durationLong,
        enteringScreen: motion.durationStandard,
        leavingScreen: motion.durationShort,
      },
      // Only the standard curve is ours. `sharp`, `easeIn` and `easeOut` keep
      // MUI's own values: `sharp` exists precisely to differ on leaving
      // states, and DESIGN.md asks for no such flattening.
      easing: { easeInOut: motion.easing },
    },
    typography: {
      fontFamily: sansStack,
      button: { textTransform: 'none', fontWeight: typeRoles.label.fontWeight },
      body1: typographyFor(typeRoles.dashboardBody),
      body2: typographyFor(typeRoles.tableCell),
      caption: typographyFor(typeRoles.caption),
      questionBody: typographyFor(typeRoles.questionBody),
      explanationBody: typographyFor(typeRoles.explanationBody),
      cardTitle: typographyFor(typeRoles.cardTitle),
      dashboardBody: typographyFor(typeRoles.dashboardBody),
      tableCell: typographyFor(typeRoles.tableCell),
      label: typographyFor(typeRoles.label),
      timer: typographyFor(typeRoles.timer),
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme: Theme) => ({
          // Every focusable element carries the same visible focus ring.
          '*:focus-visible': {
            outline: `${focusRing.width}px solid ${theme.vars.palette.primary.main}`,
            outlineOffset: focusRing.offset,
          },
          // Reduced motion is not optional polish: every transition the theme
          // emits resolves to zero, and nothing is left to animate (UX-DR37).
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: `${motion.durationReduced}ms !important`,
              animationDelay: `${motion.durationReduced}ms !important`,
              animationIterationCount: '1 !important',
              transitionDuration: `${motion.durationReduced}ms !important`,
              // A zeroed duration still stalls for its delay; both go.
              transitionDelay: `${motion.durationReduced}ms !important`,
              scrollBehavior: 'auto !important',
            },
          },
        }),
      },
      // Elevation 0 everywhere, with an explicit 1px solid divider instead.
      // Paper is the paper role: near-square, because it is what carries
      // generated Question and Explanation content (UX-DR12). Card, every
      // control and the overlay surfaces draw their own control radius over it.
      MuiPaper: {
        defaultProps: { elevation: 0, square: false },
        styleOverrides: { root: { ...flatSurface, borderRadius: rounded.paper } },
      },
      MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: borderedSurface } },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: d.cardPadding,
            '&:last-child': { paddingBottom: d.cardPadding },
          },
        },
      },
      MuiAppBar: { defaultProps: { elevation: 0, color: 'transparent' } },
      MuiButtonBase: {
        defaultProps: { disableRipple: false },
        styleOverrides: { root: focusOutline },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, variant: 'outlined' },
        styleOverrides: {
          root: {
            minHeight: d.tapTarget,
            borderRadius: rounded.control,
            paddingInline: d.cardPadding,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            minWidth: d.tapTarget,
            minHeight: d.tapTarget,
            borderRadius: rounded.control,
          },
        },
      },
      MuiCheckbox: {
        styleOverrides: { root: { width: d.tapTarget, height: d.tapTarget } },
      },
      MuiSwitch: { styleOverrides: { root: { minHeight: d.tapTarget } } },
      MuiOutlinedInput: {
        styleOverrides: { root: { borderRadius: rounded.control, minHeight: d.tapTarget } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({
            ...typographyFor(typeRoles.tableCell),
            height: d.rowHeight,
            paddingBlock: 0,
            paddingInline: d.cardPadding,
            borderBottom: `1px solid ${theme.vars.palette.divider}`,
          }),
        },
      },
      MuiTableRow: { styleOverrides: { root: { height: d.rowHeight } } },
      // Overlays: scrim plus a 1px divider border, never a shadow (UX-DR11).
      // Each of these ships its own elevation default (Dialog's is 24), which
      // would otherwise reintroduce a shadow the flat model has no room for.
      MuiDialog: {
        defaultProps: { slotProps: { paper: { elevation: 0 } } },
        styleOverrides: { paper: overlaySurface },
      },
      MuiMenu: {
        defaultProps: { slotProps: { paper: { elevation: 0 } } },
        styleOverrides: { paper: overlaySurface },
      },
      MuiPopover: {
        defaultProps: { slotProps: { paper: { elevation: 0 } } },
        styleOverrides: { paper: overlaySurface },
      },
      MuiSnackbarContent: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: overlaySurface },
      },
    },
  });
}

/** The one base theme, on the Student View accent and the compact density. */
export const baseTheme = buildTheme(colorTokens.primaryStudent, density);

/**
 * Student Mode's theme: the base theme's accent on the comfortable density set
 * — the 48px tap-target floor and the roomier spacing (UX-DR9/UX-DR10). Because
 * density is a parameter of the theme rather than a figure inside a screen,
 * every shipped Student Mode screen picks this up without being edited.
 */
export const studentTheme = buildTheme(colorTokens.primaryStudent, comfortableDensity);

/**
 * The Admin console's theme: the base theme with `palette.primary` replaced by
 * the Parent View accent, and nothing else. Asserting "only primary differs"
 * is a unit test, not a review step.
 */
export function createAdminTheme(): Theme {
  return buildTheme(colorTokens.primaryParent, density);
}

export const adminTheme = createAdminTheme();

/**
 * The parent auth screens' theme. Like the Admin console's, it is the base
 * theme with `palette.primary` replaced by the Parent View accent and nothing
 * else — the same override, applied to a different route group.
 */
export function createParentTheme(): Theme {
  return buildTheme(colorTokens.primaryParent, density);
}

export const parentTheme = createParentTheme();
