import '@mui/material/styles';

declare module '@mui/material/styles' {
  // Opts the theme into CSS variables, so `theme.vars` and `theme.colorSchemes`
  // are always present and every colour resolves through a token.
  interface CssThemeVariables {
    enabled: true;
  }
}
