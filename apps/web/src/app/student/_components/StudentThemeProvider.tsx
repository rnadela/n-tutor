'use client';

import { ThemeProvider } from '@mui/material/styles';
import { studentTheme } from '@/theme/theme';

/**
 * The `/student` route group nests its own ThemeProvider, exactly as `/auth`,
 * `/parent` and `/admin` do. It overrides no palette — the Student View accent
 * is the base theme's own — but it does carry the comfortable density set, so
 * every control on this surface gets the 48px tap-target floor and the roomier
 * spacing without a single screen restating a figure (UX-DR9/UX-DR10).
 */
export function StudentThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={studentTheme}>{children}</ThemeProvider>;
}
