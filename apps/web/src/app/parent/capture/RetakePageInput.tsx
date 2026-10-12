'use client';

import { type ChangeEvent } from 'react';
import Box from '@mui/material/Box';

import { parentCopy } from '@/copy/parent';

/** Off screen but in the tab order and reachable by `setInputFiles`. */
const VISUALLY_HIDDEN_INPUT = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

export interface RetakePageInputProps {
  /** The page whose bytes this replaces. Its id makes the input's own id. */
  pageId: string;
  /** The ordinal the accessible name states, so the control names its page. */
  ordinal: number;
  /** A write is in flight, so no second one may be started. */
  busy: boolean;
  /** The one retake write. Both callers hand it the same screen-level handler. */
  onRetake: (pageId: string, file: File) => void;
}

/**
 * One page's retake affordance: the same plain file input the add control is,
 * scoped to this page alone.
 *
 * It exists as its own component because two steps of the upload stepper offer
 * the retake — the Pages step, from the page's own row on the strip, and the
 * Check step, beside the verdict that flagged it — and only one step renders at
 * a time, so `capture-retake-{pageId}` is never in the document twice. Sharing
 * the element keeps one id, one accessible name and one write path instead of a
 * second way to replace a page's bytes.
 *
 * It renders the input and nothing else: the visible, pressable label is the
 * caller's, placed immediately after it so the label's
 * `input:focus-visible + &` rule still shows this input's focus ring.
 */
export function RetakePageInput({
  pageId,
  ordinal,
  busy,
  onRetake,
}: RetakePageInputProps): React.ReactElement {
  return (
    <Box
      component="input"
      id={`capture-retake-${pageId}`}
      type="file"
      accept="image/*"
      disabled={busy}
      aria-label={parentCopy.capture.retakeFor(ordinal)}
      sx={VISUALLY_HIDDEN_INPUT}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Cleared so retaking the same photo twice still fires a change event
        // the second time.
        event.target.value = '';
        if (file) onRetake(pageId, file);
      }}
    />
  );
}
