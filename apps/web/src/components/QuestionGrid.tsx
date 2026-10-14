'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { visuallyHidden } from '@/components/LiveRegion';
import { focusRing, rounded, typeRoles } from '@/theme/tokens';

/**
 * One cell of a question grid: which Question, what to draw in it, and what it says.
 *
 * `glyph` arrives as a node the **caller has already marked `aria-hidden`**. That is
 * not an oversight: the glyph's test id, its colour and its sizing are all part of a
 * vocabulary this primitive refuses to know, and wrapping the caller's node in an
 * `aria-hidden` span of our own would put a tag boundary between the attribute and the
 * test id that two specs match across in one expression.
 *
 * `sentence` is the cell's **whole** accessible name, stated as a sentence. A cell read
 * on its own is never a bare digit.
 */
export interface QuestionGridCell {
  /** React's key. The Question id, not the ordinal — two rows may share an ordinal of 0. */
  key: string;
  /** The stored ordinal, drawn and written out as `data-ordinal`. */
  ordinal: number;
  /** Already `aria-hidden`. See above. */
  glyph: ReactNode;
  sentence: string;
  current: boolean;
  /**
   * The cell's ground, and **nothing more**.
   *
   * `done` tints, `idle` does not, and neither word means anything on its own: the
   * progress map passes `done` for a Question that has been answered, and the results
   * map passes `done` for every cell, because after a hand-in every Question has been
   * dealt with. A ground is not a carrier here — the glyph and the sentence are.
   */
  tone: 'done' | 'idle';
  /** Extra non-colour carriers, written straight onto the button as attributes. */
  data?: Record<string, string>;
}

/**
 * A grid of Questions as real buttons, with no vocabulary of its own.
 *
 * **This is geometry, extracted once.** Two maps are built on it — the progress map a
 * child reads while they work, and the results map read once the marks are in — and the
 * thing they genuinely share is the drawing: the auto-filling grid at the surface's tap
 * target, the button's own box, the `aria-hidden` digit beside an `aria-hidden` glyph,
 * the single visually-hidden sentence that is the whole accessible name, and
 * `aria-current` on the one cell the screen is on.
 *
 * **It knows no words at all.** No glyph table, no heading, no summary line, no legend
 * and no progress bar: those are exactly what differ between the two moments. Progress
 * may not say a correctness word before a hand-in, and a results map says nothing else —
 * so a single component serving both could not satisfy either one's spec, and the split
 * is between the drawing and the vocabulary rather than between two modes of one thing.
 *
 * **The tap target and the gap come from `theme.density`**, never from an imported
 * density constant. That is the whole reason one grid serves a 48px cell in Student Mode
 * and a 44px cell in Parent View without a prop, a branch or a second component
 * (UX-DR9/UX-DR10).
 *
 * Every cell is a real `<button type="button">`, so it is keyboard reachable by
 * construction rather than by an added handler.
 */
export function QuestionGrid({
  cells,
  onJump,
  testId,
  cellTestId,
}: {
  /** Every cell, in the order it was given. Never re-sorted here. */
  cells: readonly QuestionGridCell[];
  /** The pressed cell's **index** in `cells`, so the caller decides what that means. */
  onJump(index: number): void;
  testId: string;
  cellTestId: string;
}) {
  return (
    <Box
      component="ul"
      // `listStyle: 'none'` strips list semantics in Safari/VoiceOver, and the item
      // count with them — which is exactly what a reader scanning a paper needs
      // announced. Put back by hand, as Student Home does.
      role="list"
      data-testid={testId}
      sx={(theme) => ({
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${theme.density.tapTarget}px, 1fr))`,
        gap: `${theme.density.gap / 2}px`,
        listStyle: 'none',
        p: 0,
        m: 0,
      })}
    >
      {cells.map((cell, index) => (
        <Box component="li" role="listitem" key={cell.key} sx={{ listStyle: 'none' }}>
          <Box
            component="button"
            type="button"
            data-testid={cellTestId}
            data-ordinal={cell.ordinal}
            {...cell.data}
            aria-current={cell.current ? 'true' : undefined}
            onClick={() => onJump(index)}
            sx={(theme) => ({
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              minWidth: `${theme.density.tapTarget}px`,
              minHeight: `${theme.density.tapTarget}px`,
              // A quarter of the 8px spacing base: the hairline between the digit and
              // the glyph, stated as spacing rather than as a figure of its own.
              gap: 0.25,
              cursor: 'pointer',
              color: 'inherit',
              backgroundColor: cell.current
                ? theme.vars.palette.action.selected
                : cell.tone === 'done'
                  ? theme.vars.palette.action.hover
                  : 'transparent',
              border: `1px solid ${
                cell.current ? theme.vars.palette.primary.main : theme.vars.palette.divider
              }`,
              // The current cell is heavier as well as tinted: a tint alone is a colour
              // claim, and colour alone never carries a state here.
              borderWidth: cell.current ? 2 : 1,
              borderRadius: `${rounded.control}px`,
              fontFamily: typeRoles.tableCell.fontFamily,
              fontSize: typeRoles.tableCell.fontSize,
              '&:focus-visible': {
                outline: `${focusRing.width}px solid ${theme.vars.palette.primary.main}`,
                outlineOffset: focusRing.offset,
              },
            })}
          >
            {/* Hidden from assistive technology, both of them: the cell's accessible
                name is the sentence below, stated once. */}
            <Box component="span" aria-hidden="true">
              {cell.ordinal}
            </Box>
            {cell.glyph}
            <Box component="span" sx={visuallyHidden}>
              {cell.sentence}
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
