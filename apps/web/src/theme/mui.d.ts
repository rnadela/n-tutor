import '@mui/material/styles';
import type { TypographyStyle } from '@mui/material/styles';
import type { DensitySet } from './tokens';

declare module '@mui/material/styles' {
  /**
   * The surface's density set, carried on the theme itself (UX-DR9). A
   * primitive reads `theme.density.tapTarget`; it never imports a figure, so
   * the same component is compact in Parent View and comfortable in Student
   * Mode without a prop or a branch.
   */
  interface Theme {
    density: DensitySet;
  }

  interface ThemeOptions {
    density?: DensitySet;
  }

  // Opts the theme into CSS variables, so `theme.vars` and `theme.colorSchemes`
  // are always present and every colour resolves through a token.
  interface CssThemeVariables {
    enabled: true;
  }

  /**
   * The eight-role scale (UX-DR6), reachable as `<Typography variant="…">`.
   * A role is named, never restated as a one-off `sx` size. `caption` is a
   * MUI variant already, so it is mapped in `theme.ts` rather than declared.
   */
  interface TypographyVariants {
    questionBody: TypographyStyle;
    explanationBody: TypographyStyle;
    cardTitle: TypographyStyle;
    dashboardBody: TypographyStyle;
    tableCell: TypographyStyle;
    label: TypographyStyle;
    timer: TypographyStyle;
  }

  interface TypographyVariantsOptions {
    questionBody?: TypographyStyle;
    explanationBody?: TypographyStyle;
    cardTitle?: TypographyStyle;
    dashboardBody?: TypographyStyle;
    tableCell?: TypographyStyle;
    label?: TypographyStyle;
    timer?: TypographyStyle;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    questionBody: true;
    explanationBody: true;
    cardTitle: true;
    dashboardBody: true;
    tableCell: true;
    label: true;
    timer: true;
  }
}
