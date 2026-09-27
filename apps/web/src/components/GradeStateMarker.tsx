'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { commonCopy } from '@/copy/common';
import type { GradeState } from '@/lib/parent-api';
import { GRADE_PALETTE } from '@/theme/grade-state-palette';
import { comfortableDensity, gradeStateMarker, rounded, typeRoles } from '@/theme/tokens';

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
      <Box
        component="span"
        aria-hidden="true"
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: comfortableDensity.gap * 1.5,
          height: comfortableDensity.gap * 1.5,
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
      {/* The `label` role, because this is chrome about the content rather than
          content. It is never the only carrier and never the only announcement. */}
      <Typography component="span" sx={{ ...typeRoles.label }} data-testid="grade-state-label">
        {commonCopy.gradeState[state]}
      </Typography>
    </Box>
  );
}
