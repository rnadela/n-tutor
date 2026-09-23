'use client';

import { ThemeProvider } from '@mui/material/styles';
import { adminTheme } from '@/theme/theme';

/**
 * The `/admin` route group nests its own ThemeProvider. The theme it applies is
 * the base theme with `palette.primary` replaced by the Parent View accent and
 * nothing else — no bespoke Admin theme, no fourth accent. One instance, the
 * same one the unit test asserts against.
 */
export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={adminTheme}>{children}</ThemeProvider>;
}
