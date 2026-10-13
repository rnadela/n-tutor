'use client';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { LiveRegionProvider } from '@/components/LiveRegion';
import { ColorModeMeta } from './ColorModeMeta';
import { baseTheme } from './theme';

/**
 * The single base theme, applied once at the root of every surface — and with
 * it the single live region (UX-DR33).
 *
 * The region is mounted here rather than per screen so there is exactly one
 * `role="status"` in the document: two would make "the region on this page" an
 * ambiguous thing to address, and none would make `useAnnounce()` throw the
 * first time a primitive reported a state change.
 *
 * This is also the **only** non-nested `ThemeProvider` in the app, which makes
 * it the only one that provides a colour-scheme context: the four route
 * providers hit MUI's nested branch and return their subtree unwrapped, so
 * every surface reads and writes one stored mode without any of them being
 * configured. That is why `ColorModeMeta` is mounted here — it is the one node
 * inside that context on all four surfaces at once.
 */
export function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={baseTheme}>
      <CssBaseline />
      <ColorModeMeta />
      <LiveRegionProvider>{children}</LiveRegionProvider>
    </ThemeProvider>
  );
}
