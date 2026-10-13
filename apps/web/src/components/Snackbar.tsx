'use client';

import { useEffect, useRef } from 'react';
import MuiSnackbar, { type SnackbarCloseReason } from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import { usePathname } from 'next/navigation';
import { commonCopy } from '@/copy/common';
import { barOffsetCss, bottomNavShown } from '@/lib/bottom-nav';
import { useCaptureOpen } from '@/lib/capture-open';
import { motion, spacing } from '@/theme/tokens';
import { useAnnounce } from './LiveRegion';

export interface AppSnackbarProps {
  open: boolean;
  /** The displayed copy. It is also, verbatim, what gets announced. */
  message: string;
  onClose(): void;
  autoHideDuration?: number;
}

/**
 * What the live region should carry for a given snackbar state.
 *
 * `null` means "leave it alone"; the empty string means "clear it". Extracted
 * as a pure function so both rules — announce what is shown, empty the region
 * when the message goes away — are assertable without a DOM.
 */
export function announcementFor(open: boolean, message: string): string | null {
  if (!open) return '';
  return message === '' ? null : message;
}

/**
 * Whether a close reason should actually close the snackbar.
 *
 * MUI reports `clickaway` for any click anywhere on the page. Dismissing a
 * message because the reader happened to click elsewhere loses the message
 * before it has been read; only the timeout and the dismiss control close it.
 */
export function closesOn(reason: SnackbarCloseReason): boolean {
  return reason !== 'clickaway';
}

/**
 * The snackbar primitive (UX-DR28): flat, bordered, shadowless — all three from
 * the theme's `MuiSnackbarContent` override.
 *
 * It announces through the surface's one live region rather than carrying a
 * second `role="status"` of its own, and it announces the message it displays
 * rather than a parallel string (UX-DR33). The dismiss control is a real
 * `<button>` with a label.
 */
export function AppSnackbar({
  open,
  message,
  onClose,
  autoHideDuration = motion.snackbarAutoHide,
}: AppSnackbarProps) {
  const { announce, clear } = useAnnounce();
  /**
   * Whether this route carries the bottom navigation bar, and so whether the
   * message has to sit above it.
   *
   * Gated by the shared rule rather than lifted blind: many screens mount this,
   * most of them carry the bar and a few — the PIN gate, the Attempt — do not,
   * and a message floating a bar's height above nothing reads as a mistake.
   * `usePathname` is `null` outside a router, which is how this renders in the
   * unit runner; treated as "no bar", because there is no bar there either.
   *
   * Also folds in the viewfinder: `/parent/capture` carries the bar by route,
   * but the live camera screen hides it (`barIsOnScreen` in
   * `ParentSidebarChrome.tsx`), and lifting for a bar that is not drawn would
   * leave a gap over nothing. `useCaptureOpen` reads `false` with no provider
   * above it, so this is harmless on every other screen.
   */
  const pathname = usePathname();
  const captureOpen = useCaptureOpen();
  const liftedOverBar = typeof pathname === 'string' && bottomNavShown(pathname) && !captureOpen;

  useEffect(() => {
    const next = announcementFor(open, message);
    if (next === null) return;
    // Closing empties the region rather than leaving the last message behind
    // for the next screen to inherit.
    if (next === '') clear();
    else announce(next);
  }, [open, message, announce, clear]);

  // A screen that unmounts this snackbar while it is still open (instead of
  // toggling `open` to false first) would otherwise leave its announcement in
  // the region for the next screen to inherit. Refs carry the latest values in
  // so this only fires on the true unmount, not on every prop change above.
  const openRef = useRef(open);
  openRef.current = open;
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(
    () => () => {
      if (openRef.current) clearRef.current();
    },
    [],
  );

  return (
    <MuiSnackbar
      open={open}
      message={message}
      onClose={(_event, reason) => {
        if (closesOn(reason)) onClose();
      }}
      autoHideDuration={autoHideDuration}
      action={
        <Button type="button" onClick={onClose}>
          {commonCopy.snackbar.dismiss}
        </Button>
      }
      sx={
        liftedOverBar
          ? // Below `lg` the bar is on screen, so the message clears it by the
            // bar's own height plus the device's bottom inset; from `lg` up it
            // returns to MUI's own offset. A message that covers the navigation
            // is a message that hides where you are.
            { bottom: { xs: barOffsetCss, lg: `${spacing[3]}px` } }
          : undefined
      }
    />
  );
}
