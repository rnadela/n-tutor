'use client';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import type { GenerationJobView } from '@/lib/parent-api';
import { type SheetState, sheetStates } from '@/lib/sheet-tally';
import { density, motion } from '@/theme/tokens';
import { WaitSpinner } from './WaitSpinner';

/**
 * One sheet's cell, its glyph and the gap between cells — all three named from
 * tokens rather than written, so the row cannot acquire a geometry of its own.
 *
 * All three come from the **compact** set, which is Parent View's: the tally is
 * only ever drawn on a parent's screen, and reaching into Student Mode's
 * roomier set for one of the three figures would make the row's geometry
 * respond to a density change in the room it is not in.
 *
 * The glyph is the tap-target floor and the cell is that plus the gap, so a
 * sheet is a hair larger than the smallest thing a parent is asked to touch.
 */
const SHEET_CELL = density.tapTarget + density.gap * 1.5;
const SHEET_GLYPH = density.tapTarget;
const SHEET_GAP = density.gap * 1.5;

/** The lucide `file` body, and the folded corner that reads as paper. */
const SHEET_BODY = 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z';
const SHEET_FOLD = 'M14 2v4a2 2 0 0 0 2 2h4';

/**
 * The mark drawn inside each sheet, and the glyph name mirrored beside it.
 *
 * **These are the colourless carriers.** Strip every colour, class and inline
 * style and the four states are still told apart: a check, a cross, a dashed
 * outline and a ring. `ready` and `notMade` differ by their path geometry;
 * `waiting` carries a `stroke-dasharray` **attribute** rather than a CSS rule,
 * precisely so that stripping style does not take it away; and `making` is the
 * one cell that contains the shared spinner.
 */
const SHEET_GLYPH_NAME = {
  ready: 'check',
  making: 'ring',
  waiting: 'dashed',
  notMade: '×',
} as const satisfies Record<SheetState, string>;

/** The stroke each state draws in. Every one of them is a theme variable. */
const SHEET_STROKE: Record<SheetState, (theme: Theme) => string> = {
  ready: (theme) => theme.vars.palette.success.main,
  making: (theme) => theme.vars.palette.primary.main,
  waiting: (theme) => theme.vars.palette.divider,
  notMade: (theme) => theme.vars.palette.text.secondary,
};

/** The ruled lines of a blank sheet — what is on it before anything is made. */
function SheetRules() {
  return (
    <>
      <path d="M8 13h6" />
      <path d="M8 17h4" />
    </>
  );
}

/**
 * One sheet of paper, in one of its four states.
 *
 * The geometry is lucide's (`file`, with `file-check-2`'s check and
 * `file-x-2`'s cross), inlined rather than imported as icon components,
 * because the body has to carry a per-state dash attribute and a per-state
 * fill that an icon component's single `color` prop cannot express.
 */
function SheetGlyph({ state }: { state: SheetState }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      sx={(theme) => ({
        width: SHEET_GLYPH,
        height: SHEET_GLYPH,
        fill: 'none',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        stroke: SHEET_STROKE[state](theme),
      })}
    >
      <Box
        component="path"
        d={SHEET_BODY}
        // An attribute and not a CSS rule: this is one of the four shapes the
        // colourless acceptance criterion is about, and a spec that strips
        // style must still be able to read it.
        strokeDasharray={state === 'waiting' ? '3 3' : undefined}
        sx={
          state === 'ready'
            ? (theme) => ({
                // The ready tint, mixed from the token rather than written as a
                // second colour: there is no "success at 12%" token, and a hex
                // literal outside `tokens.ts` is the thing this palette forbids.
                fill: `color-mix(in srgb, ${theme.vars.palette.success.main} 12%, transparent)`,
              })
            : undefined
        }
      />
      <path d={SHEET_FOLD} />
      {state === 'ready' ? (
        <Box
          component="path"
          d="m9 15 2 2 4-4"
          strokeDasharray="12"
          sx={{
            strokeWidth: 2.25,
            strokeDashoffset: 0,
            '@keyframes sheetMarkDraw': { from: { strokeDashoffset: 12 } },
            animation: `sheetMarkDraw ${motion.durationStandard}ms ${motion.easing} both`,
            // Stated here as well as globally: with no animation the dash
            // offset stays at its resting 0, so the check is simply there.
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      ) : state === 'notMade' ? (
        <>
          <path d="m14.5 12.5-5 5" strokeWidth={2.25} />
          <path d="m9.5 12.5 5 5" strokeWidth={2.25} />
        </>
      ) : (
        <SheetRules />
      )}
    </Box>
  );
}

/**
 * One sheet of paper per requested Practice Test, four states told apart by
 * shape as well as colour, sitting directly above the progress sentence.
 *
 * **It announces nothing.** `aria-hidden`, no text, and no `role="status"`: the
 * sentence underneath it already says how far along the job is, in the words
 * the live region reads out (UX-DR33). A row of sheets spoken sheet by sheet
 * would be the same fact, counted aloud.
 *
 * **The "being made" sheet is the generate screen's spinner.** The ring around
 * it *is* `WaitSpinner`, at the sheet cell's size — one shared component for
 * both of Parent View's waits, rather than a second rotating mark that could
 * drift away from the first.
 *
 * **It decides nothing.** `sheetStates` resolves which sheet is which, from the
 * job's own three figures; this draws the answer. No hooks, no counter and no
 * client-side estimate.
 */
export function SheetTally({
  producedCount,
  requestedCount,
  status,
}: {
  producedCount: number;
  requestedCount: number;
  status: GenerationJobView['status'];
}) {
  const states = sheetStates({ producedCount, requestedCount, status });
  // Nothing requested is nothing to draw — not an empty row with a gap in it.
  if (states.length === 0) return null;
  return (
    <Box
      component="ul"
      aria-hidden="true"
      data-testid="sheet-tally"
      sx={{
        display: 'flex',
        // Wraps rather than scrolls or shrinks: the largest request still fits
        // a phone, as two short rows if it has to.
        flexWrap: 'wrap',
        gap: `${SHEET_GAP}px`,
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {states.map((state, index) => (
        <Box
          component="li"
          // The ordinal is the identity: the sheets are positions in a request,
          // not rows with ids of their own.
          key={index}
          data-testid="sheet"
          data-state={state}
          data-glyph={SHEET_GLYPH_NAME[state]}
          sx={{
            position: 'relative',
            display: 'grid',
            placeItems: 'center',
            width: SHEET_CELL,
            height: SHEET_CELL,
            ...(state === 'ready'
              ? {
                  '@keyframes sheetLand': {
                    from: { transform: 'scale(0.85)', opacity: 0.4 },
                    to: { transform: 'none', opacity: 1 },
                  },
                  animation: `sheetLand ${motion.durationStandard}ms ${motion.easing} both`,
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }
              : {}),
          }}
        >
          <SheetGlyph state={state} />
          {state === 'making' && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <WaitSpinner size={SHEET_CELL} />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
