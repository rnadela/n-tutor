'use client';

import { useEffect, useRef } from 'react';
import MuiSnackbar, { type SnackbarCloseReason } from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import { commonCopy } from '@/copy/common';
import { motion } from '@/theme/tokens';
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
    />
  );
}
