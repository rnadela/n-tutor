'use client';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { LiveRegionProvider } from '@/components/LiveRegion';
import { baseTheme } from './theme';

/**
 * The single base theme, applied once at the root of every surface — and with
 * it the single live region (UX-DR33).
 *
 * The region is mounted here rather than per screen so there is exactly one
 * `role="status"` in the document: two would make "the region on this page" an
 * ambiguous thing to address, and none would make `useAnnounce()` throw the
 * first time a primitive reported a state change.
 */
export function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={baseTheme}>
      <CssBaseline />
      <LiveRegionProvider>{children}</LiveRegionProvider>
    </ThemeProvider>
  );
}
