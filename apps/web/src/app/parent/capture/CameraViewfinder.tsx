'use client';

import type { RefObject } from 'react';
import Box from '@mui/material/Box';

import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { colorTokens, density, rounded } from '@/theme/tokens';
import { controlSx } from './PageStrip';

/**
 * The inverted surface, and the only place in the product that reads the
 * on-inverted tokens (UX-DR4).
 *
 * Every colour here is taken from the `…Inverted` / `…OnInverted` pairs and from
 * nothing else: they are identical in light and dark because a viewfinder is
 * dark in both schemes — the photograph is the content, and the chrome around it
 * must not compete with it. The light parent primary measures about 2.5:1 on
 * this ground, so reaching for `primary.main` here would be a contrast failure
 * rather than a consistency win. `light` is read off the pair for the same
 * reason the values are duplicated: the surface does not track the scheme.
 */
const INVERTED = {
  ground: colorTokens.backgroundInverted.light,
  accent: colorTokens.primaryOnInverted.light,
  divider: colorTokens.dividerOnInverted.light,
  text: colorTokens.textOnInverted.light,
} as const;

/**
 * What a bare `<button>` needs to look like a control: the browser's own chrome
 * off, the surface's type inherited, and a pointer. No colour and no size — both
 * come from the tokens above and from `controlSx`.
 */
const BUTTON_RESET = {
  font: 'inherit',
  cursor: 'pointer',
  px: `${density.gap}px`,
} as const;

/** The viewfinder's heading, which the surface is named by rather than repeating. */
export const VIEWFINDER_HEADING_ID = 'capture-viewfinder-heading';

export interface CameraViewfinderProps {
  /**
   * Where the live stream is attached. Held by the owner, because the stream and
   * its teardown are the owner's: this component has no hooks and no lifecycle.
   */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** How many pages the upload already holds, and the ceiling, both the API's. */
  pageCount: number;
  maxPages: number;
  /** A write is in flight; the shutter locks with the rest of the strip. */
  busy: boolean;
  onCapture(): void;
  onClose(): void;
}

/**
 * The viewfinder, as a component with no hooks in it.
 *
 * Separated from `AddPages` for the same reason `PageStrip` is separated from
 * the screen: `apps/web` runs its tests without a DOM, so the rules this surface
 * carries — the inverted tokens, the `<video>`'s accessible name, the tap-target
 * floor on the shutter and on Done, the framing guidance naming the next
 * ordinal — have to be reachable by rendering markup and reading it.
 */
export function CameraViewfinder({
  videoRef,
  pageCount,
  maxPages,
  busy,
  onCapture,
  onClose,
}: CameraViewfinderProps) {
  const camera = parentCopy.capture.camera;
  /** The page this shot will become. One past what the server currently holds. */
  const nextOrdinal = pageCount + 1;
  /** The cap is the API's; the surface only mirrors it. */
  const full = pageCount >= maxPages;

  return (
    <Box
      component="section"
      aria-labelledby={VIEWFINDER_HEADING_ID}
      sx={{
        display: 'grid',
        gap: `${density.gap}px`,
        p: `${density.cardPadding}px`,
        borderRadius: `${rounded.control}px`,
        // The one boundary this surface has, on its own divider tier.
        border: `1px solid ${INVERTED.divider}`,
        backgroundColor: INVERTED.ground,
        color: INVERTED.text,
      }}
    >
      <Typography
        id={VIEWFINDER_HEADING_ID}
        component="h3"
        sx={{ fontSize: 18, fontWeight: 700, color: INVERTED.text }}
      >
        {camera.heading}
      </Typography>

      {/*
        A live camera view is content, not decoration, so it carries a name. It
        is muted and `playsInline` because an inline autoplaying stream is
        blocked otherwise on iOS, and it holds no controls: the shutter below is
        the only thing a parent does with it.
      */}
      <Box
        component="video"
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label={camera.viewfinderLabel}
        sx={{
          width: '100%',
          display: 'block',
          borderRadius: `${rounded.control}px`,
          border: `1px solid ${INVERTED.divider}`,
          backgroundColor: INVERTED.ground,
        }}
      />

      {/* What to frame, named by the page the shot will become. */}
      <Typography component="p" data-testid="viewfinder-framing" sx={{ color: INVERTED.text }}>
        {camera.framing(nextOrdinal)}
      </Typography>

      {/* The live count, both figures from the server's answer. */}
      <Typography component="p" data-testid="viewfinder-count" sx={{ color: INVERTED.text }}>
        {camera.captured(pageCount, maxPages)}
      </Typography>

      {/*
        Plain `<button>`s rather than MUI's variants, and deliberately so: every
        `MuiButton` variant resolves its colour from the surface palette, which
        would put the light parent primary into this surface's own stylesheet.
        The tap-target floor and the focus ring still come from `controlSx`, so
        nothing about the control is written as a figure here either.
      */}
      <Box sx={{ display: 'flex', gap: `${density.gap}px`, flexWrap: 'wrap' }}>
        <Box
          component="button"
          type="button"
          disabled={busy || full}
          onClick={onCapture}
          data-testid="viewfinder-shutter"
          sx={{
            ...controlSx,
            ...BUTTON_RESET,
            backgroundColor: INVERTED.accent,
            color: INVERTED.ground,
            border: `1px solid ${INVERTED.accent}`,
            '&:disabled': { opacity: 0.5, cursor: 'default' },
            '&:focus-visible': {
              ...controlSx['&:focus-visible'],
              outlineColor: INVERTED.text,
            },
          }}
        >
          {camera.shutter}
        </Box>
        {/*
          Closing is not a cancel: the pages already captured stay. It is the
          way out of the surface, and it stays usable while an add is in flight
          so a parent is never trapped on a locked viewfinder.
        */}
        <Box
          component="button"
          type="button"
          onClick={onClose}
          data-testid="viewfinder-done"
          sx={{
            ...controlSx,
            ...BUTTON_RESET,
            backgroundColor: 'transparent',
            color: INVERTED.text,
            border: `1px solid ${INVERTED.divider}`,
            '&:focus-visible': {
              ...controlSx['&:focus-visible'],
              outlineColor: INVERTED.text,
            },
          }}
        >
          {camera.done}
        </Box>
      </Box>
    </Box>
  );
}
