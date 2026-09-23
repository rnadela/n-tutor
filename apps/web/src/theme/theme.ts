import { createTheme, type Theme } from '@mui/material/styles';
import {
  colorTokens,
  density,
  focusRing,
  rounded,
  sansStack,
  typeRoles,
  type ColorScheme,
  type TokenPair,
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
 * Builds a theme from the token set, parameterised by the accent. Every colour
 * comes from a token that defines both a light and a dark value; nothing
 * hardcodes a colour, and nothing but `palette.primary` varies between the
 * base theme and the Admin console's theme.
 */
function buildTheme(primary: TokenPair): Theme {
  return createTheme({
    cssVariables: { colorSchemeSelector: 'data' },
    colorSchemes: {
      light: { palette: paletteFor('light', primary.light) },
      dark: { palette: paletteFor('dark', primary.dark) },
    },
    shape: { borderRadius: rounded.control },
    typography: {
      fontFamily: sansStack,
      button: { textTransform: 'none', fontWeight: 600 },
      body1: { fontSize: typeRoles.tableCell.fontSize, lineHeight: typeRoles.tableCell.lineHeight },
    },
    components: {
      // Every focusable element carries the same visible focus ring.
      MuiCssBaseline: {
        styleOverrides: (theme: Theme) => ({
          '*:focus-visible': {
            outline: `${focusRing.width}px solid ${theme.vars.palette.primary.main}`,
            outlineOffset: focusRing.offset,
          },
        }),
      },
      // Elevation 0 everywhere, with an explicit 1px solid divider instead.
      MuiPaper: {
        defaultProps: { elevation: 0, square: false },
        styleOverrides: { root: flatSurface },
      },
      MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: borderedSurface } },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: density.cardPadding,
            '&:last-child': { paddingBottom: density.cardPadding },
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
            minHeight: density.tapTarget,
            borderRadius: rounded.control,
            paddingInline: density.cardPadding,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            minWidth: density.tapTarget,
            minHeight: density.tapTarget,
            borderRadius: rounded.control,
          },
        },
      },
      MuiCheckbox: {
        styleOverrides: { root: { width: density.tapTarget, height: density.tapTarget } },
      },
      MuiSwitch: { styleOverrides: { root: { minHeight: density.tapTarget } } },
      MuiOutlinedInput: {
        styleOverrides: { root: { borderRadius: rounded.control, minHeight: density.tapTarget } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({
            fontSize: typeRoles.tableCell.fontSize,
            lineHeight: typeRoles.tableCell.lineHeight,
            height: density.rowHeight,
            paddingBlock: 0,
            paddingInline: density.cardPadding,
            borderBottom: `1px solid ${theme.vars.palette.divider}`,
          }),
        },
      },
      MuiTableRow: { styleOverrides: { root: { height: density.rowHeight } } },
    },
  });
}

/** The one base theme, on the Student View accent. */
export const baseTheme = buildTheme(colorTokens.primaryStudent);

/**
 * The Admin console's theme: the base theme with `palette.primary` replaced by
 * the Parent View accent, and nothing else. Asserting "only primary differs"
 * is a unit test, not a review step.
 */
export function createAdminTheme(): Theme {
  return buildTheme(colorTokens.primaryParent);
}

export const adminTheme = createAdminTheme();

/**
 * The parent auth screens' theme. Like the Admin console's, it is the base
 * theme with `palette.primary` replaced by the Parent View accent and nothing
 * else — the same override, applied to a different route group. Story 1.7 owns
 * any design-system work; this reuses what is already here.
 */
export function createParentTheme(): Theme {
  return buildTheme(colorTokens.primaryParent);
}

export const parentTheme = createParentTheme();
