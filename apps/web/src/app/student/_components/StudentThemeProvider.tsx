'use client';

import { ThemeProvider } from '@mui/material/styles';
import { baseTheme } from '@/theme/theme';

/**
 * The `/student` route group nests its own ThemeProvider, exactly as `/auth`,
 * `/parent` and `/admin` do — but on `baseTheme` itself, which already carries
 * the Student View accent. No palette is created here: the parent-side groups
 * are the ones that override `palette.primary`, and this one simply does not.
 */
export function StudentThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={baseTheme}>{children}</ThemeProvider>;
}
