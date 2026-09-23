'use client';

import { ThemeProvider } from '@mui/material/styles';
import { parentTheme } from '@/theme/theme';

/**
 * The `/parent` route group nests its own ThemeProvider, exactly as `/auth` and
 * `/admin` do: the base theme with `palette.primary` replaced by the Parent
 * View accent and nothing else. Story 1.7 owns the design system; nothing is
 * refactored here.
 */
export function ParentThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={parentTheme}>{children}</ThemeProvider>;
}
