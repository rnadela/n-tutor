'use client';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { density } from '@/theme/tokens';

/**
 * The floor for either wait's spinner, in px.
 *
 * A mark small enough to be mistaken for an icon says nothing; the figure is
 * the parent tap-target floor plus half the gap, so it is at least as large as
 * anything else a parent is asked to notice on the same card.
 */
export const WAIT_SPINNER_MIN_SIZE = density.tapTarget + density.gap / 2;

/**
 * How thick the ring is, in MUI's own `CircularProgress` units.
 *
 * One figure for both marks, so the rotating ring and the static one cannot
 * come apart: the rotating one takes it as `thickness` and the static one draws
 * a border of the same weight. It is the mockup's 3, not a figure of this
 * component's own.
 */
const WAIT_RING_THICKNESS = 3;

/**
 * The one "the app is working" mark, shared by both of Parent View's async
 * waits — the Extraction read on the capture screen's Generate step, and the
 * generation job on the generate screen, where it is the ring drawn around the
 * sheet currently being made.
 *
 * **It announces nothing.** `aria-hidden`, no `role="status"`, no `aria-live`
 * and no `aria-label`: the surface has exactly one polite region, mounted once
 * in `ThemeRegistry` (UX-DR33), and the status sentence beside this spinner is
 * what is already being read out. A spinner that spoke would say the same thing
 * a second time, in worse words.
 *
 * **Reduced motion is decided in CSS, not by a hook.** Both marks render — the
 * rotating indeterminate ring and a static dotted one — and
 * `@media (prefers-reduced-motion: reduce)` picks between them. `theme.ts`
 * already zeroes every animation globally under that preference, which stops
 * the rotation, but "a static progress mark is shown" is a positive claim and a
 * zeroed indeterminate `CircularProgress` lands on whatever its first keyframe
 * happens to be. Deciding in CSS also means no `useMediaQuery`/`matchMedia`,
 * which would render the wrong branch on the first paint and then correct
 * itself in front of the parent.
 *
 * **The static mark states no figure.** It is the mockup's own reduced-motion
 * answer — the same ring, whole and dotted rather than part-drawn. A
 * determinate arc would read as a percentage for the length of the wait, and a
 * percentage is exactly the progress estimate this component has no business
 * inventing: nothing here knows how far along either wait is.
 *
 * **It has no lifecycle.** No hooks, no timer and no unmount effect: the caller
 * mounts it inside the same conditional branch the unsettled state already
 * renders, so it disappears in the very render the result appears in.
 */
export function WaitSpinner({ size = WAIT_SPINNER_MIN_SIZE }: { size?: number }) {
  // The floor is enforced here rather than trusted to callers: a caller sizing
  // this to circle a smaller glyph would otherwise silently shrink it below the
  // size the acceptance criterion names. A figure that is not a figure at all —
  // `NaN` out of an arithmetic slip, or an infinity — resolves to the floor
  // rather than to `width: NaNpx`, which renders nothing and takes the whole
  // "something is happening" claim with it.
  const resolved = Number.isFinite(size)
    ? Math.max(WAIT_SPINNER_MIN_SIZE, Math.round(size))
    : WAIT_SPINNER_MIN_SIZE;
  return (
    <Box
      aria-hidden="true"
      data-testid="wait-spinner"
      // The resolved size, mirrored where a DOM-less spec can read it.
      data-size={resolved}
      sx={{
        display: 'inline-grid',
        placeItems: 'center',
        width: resolved,
        height: resolved,
        // The two marks are stacked, never laid out side by side: only one of
        // them is ever visible, and a hidden sibling must not take up a column.
        '& > *': { gridArea: '1 / 1' },
      }}
    >
      <Box
        data-testid="wait-spinner-moving"
        sx={{
          display: 'inline-flex',
          '@media (prefers-reduced-motion: reduce)': { display: 'none' },
        }}
      >
        <CircularProgress color="primary" size={resolved} thickness={WAIT_RING_THICKNESS} />
      </Box>
      <Box
        data-testid="wait-spinner-static"
        sx={(theme) => ({
          display: 'none',
          '@media (prefers-reduced-motion: reduce)': { display: 'inline-flex' },
          // The mockup's reduced-motion answer: the whole ring, dotted, at the
          // ring's own weight — no arc, no percentage, nothing to read as a
          // figure. The colour is the accent the rotating ring uses, so the two
          // are the same mark in two states rather than two marks.
          width: resolved,
          height: resolved,
          borderRadius: '50%',
          borderWidth: `${WAIT_RING_THICKNESS}px`,
          borderStyle: 'dotted',
          borderColor: theme.vars.palette.primary.main,
          boxSizing: 'border-box',
        })}
      />
    </Box>
  );
}
