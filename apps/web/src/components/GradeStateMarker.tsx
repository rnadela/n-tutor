'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { commonCopy } from '@/copy/common';
import type { GradeState } from '@/lib/parent-api';
import { GRADE_PALETTE } from '@/theme/grade-state-palette';
import { comfortableDensity, gradeStateMarker, rounded, typeRoles } from '@/theme/tokens';

/** The glyph-in-its-frame's own size on a row, in px. One figure, stated once. */
const ROW_GLYPH_SIZE = comfortableDensity.gap * 1.5;

/**
 * The glyph in its frame, on its own, with every non-colour carrier written onto it.
 *
 * **Extracted so a results-map cell can show a grade state without the text label.**
 * On a row the label is not optional and never will be: it is the announcement, and a
 * tick with no word beside it is a colour claim. A map cell is the one exception
 * DESIGN.md's results-map-cell paragraph names — there the fixed grade label lives in
 * the cell's own accessible sentence and in the map's on-screen legend instead, so the
 * word is still said twice and the glyph is still never the only carrier. Nothing else
 * may use the label-less form.
 *
 * `data-state`, `data-frame`, `data-border` and `data-glyph` ride on this element as
 * well as on the labelled marker's wrapper, so the four carriers survive into a cell
 * that has no wrapper of its own to put them on. `apps/web` runs its specs with every
 * colour, class and inline style stripped, which is how "these four are still
 * distinguishable" stays a claim about markup rather than about a stylesheet.
 *
 * `aria-hidden`, always: a tick read out beside the word `Correct` says the same thing
 * twice, and inside a cell the sentence is already the whole accessible name.
 */
export function GradeStateGlyph({
  state,
  size = ROW_GLYPH_SIZE,
  testId = 'grade-state-glyph',
}: {
  state: GradeState;
  /**
   * The frame's square size: a px number, or any CSS length.
   *
   * It defaults to the figure a row has always used, so the three existing row
   * consumers are byte-identical. A map cell passes a relative length instead, so one
   * cell geometry serves a 48px Student Mode cell and a 44px Parent View one without
   * either surface's density being written into a shared component.
   */
  size?: number | string;
  testId?: string;
}) {
  const marker = gradeStateMarker[state];
  return (
    <Box
      component="span"
      aria-hidden="true"
      data-testid={testId}
      data-state={state}
      data-frame={marker.frame}
      data-border={marker.border}
      data-glyph={marker.glyph}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        // The shape: a circle for the two verdicts and the blank, a square for
        // the one state that is not a judgement at all.
        borderRadius: marker.frame === 'circle' ? '50%' : `${rounded.paper}px`,
        border: `2px ${marker.border} ${GRADE_PALETTE[marker.color](theme)}`,
        color: GRADE_PALETTE[marker.color](theme),
        lineHeight: 1,
      })}
    >
      {marker.glyph}
    </Box>
  );
}

/**
 * One grade state, drawn on five carriers at once, with no hooks in it.
 *
 * **The label is real text, and it is the announcement.** There is no `aria-label`
 * over the top of it and no visually-hidden duplicate: the same string is what is
 * shown and what is spoken, so the two cannot come apart (WCAG 2.5.3). It comes
 * from `commonCopy.gradeState`, which is the one place the four literals exist.
 *
 * **The glyph is `aria-hidden`.** A tick read out beside the word `Correct` says
 * the same thing twice, and a glyph has no reading of its own worth having.
 *
 * Every non-colour carrier is also written as a `data-` attribute. That is not
 * decoration: `apps/web` runs its specs without a DOM and with every colour, class
 * and inline style stripped, so the attributes are how "these four are still
 * distinguishable" is a claim a test can make about the markup rather than about a
 * stylesheet.
 *
 * Separated from the row for the reason `PracticeTestRow` is separated from the
 * screen: what the acceptance criterion is about is what reaches the markup, and
 * this can be rendered on its own and read back.
 */
export function GradeStateMarker({ state }: { state: GradeState }) {
  const marker = gradeStateMarker[state];
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${comfortableDensity.gap / 2}px`,
      }}
      data-testid="grade-state-marker"
      data-state={state}
      data-frame={marker.frame}
      data-border={marker.border}
      data-glyph={marker.glyph}
    >
      <GradeStateGlyph state={state} />
      {/* The `label` role, because this is chrome about the content rather than
          content. It is never the only carrier and never the only announcement. */}
      <Typography component="span" sx={{ ...typeRoles.label }} data-testid="grade-state-label">
        {commonCopy.gradeState[state]}
      </Typography>
    </Box>
  );
}
