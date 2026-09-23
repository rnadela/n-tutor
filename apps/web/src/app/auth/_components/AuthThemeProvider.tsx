'use client';

import { ThemeProvider } from '@mui/material/styles';
import { parentTheme } from '@/theme/theme';

/**
 * The `/auth` route group nests its own ThemeProvider, exactly as `/admin`
 * does: the base theme with `palette.primary` replaced by the Parent View
 * accent and nothing else. No bespoke auth theme, no fourth accent.
 */
export function AuthThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={parentTheme}>{children}</ThemeProvider>;
}
