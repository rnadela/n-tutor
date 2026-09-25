'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@/components/LiveRegion';
import { studentCopy } from '@/copy/student';
import type { QuestionProgress } from '@/lib/answers';
import { comfortableDensity, focusRing, rounded, typeRoles } from '@/theme/tokens';

/**
 * The filled/hollow glyphs, named once.
 *
 * A state is carried by a **word plus a glyph**, never by colour or fill alone
 * (UX-DR20): printed in grayscale, photocopied, or read by someone who does not
 * see the accent colour at all, every cell still says where it stands — the
 * glyph differs in shape, and the sentence beside it says the same thing in
 * words.
 */
const GLYPH = { answered: '●', 'not-answered': '○' } as const;

/**
 * The question map: every Question, where each one stands, and a way to reach it
 * (UX-DR20, UX-DR32 case 3).
 *
 * **One component, used in both the rail and the overlay**, so the persistent
 * and the opened form can never drift into saying different things about the
 * same test.
 *
 * Every cell is a real `<button>` at the comfortable tap-target floor — keyboard
 * reachable by construction, because it is a button — and each announces its own
 * whole sentence rather than a bare digit. `aria-current` marks the one the child
 * is on. The visible number is `aria-hidden` so the accessible name is exactly
 * the sentence and never the digit twice.
 *
 * It states **Answered** or **Not answered** and nothing else. No score, no
 * percentage, no running tally, no correctness of any kind: correctness is
 * something only submission can claim, and this map is read while the child is
 * still working.
 */
export function QuestionMap({
  progress,
  currentIndex,
  onJump,
}: {
  /** Every Question's state, in the order the server gave them. Never re-sorted here. */
  progress: readonly QuestionProgress[];
  /** Which Question the screen is on, as its index in `progress`. */
  currentIndex: number;
  onJump(index: number): void;
}) {
  const answered = progress.filter((question) => question.state === 'answered').length;
  const notAnswered = progress.length - answered;

  return (
    <Box sx={{ display: 'grid', gap: `${comfortableDensity.gap}px` }}>
      <Typography component="h2" sx={{ ...typeRoles.cardTitle }}>
        {studentCopy.takeTest.mapHeading}
      </Typography>
      {/* Two counts and no third. There is no score to state. */}
      <Typography data-testid="question-map-summary" sx={{ ...typeRoles.caption }}>
        {studentCopy.takeTest.mapSummary(answered, notAnswered)}
      </Typography>
      <Box
        component="ul"
        // `listStyle: 'none'` strips list semantics in Safari/VoiceOver, and the
        // item count with them — which is exactly what a child scanning what is
        // left needs announced. Put back by hand, as Student Home does.
        role="list"
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${comfortableDensity.gap / 2}px`,
          listStyle: 'none',
          p: 0,
          m: 0,
        }}
      >
        {progress.map((question, index) => {
          const current = index === currentIndex;
          return (
            <Box component="li" role="listitem" key={question.id} sx={{ listStyle: 'none' }}>
              <Box
                component="button"
                type="button"
                data-testid="question-map-cell"
                data-ordinal={question.ordinal}
                data-state={question.state}
                aria-current={current ? 'true' : undefined}
                onClick={() => onJump(index)}
                sx={(theme) => ({
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: `${comfortableDensity.tapTarget}px`,
                  minHeight: `${comfortableDensity.tapTarget}px`,
                  gap: '2px',
                  cursor: 'pointer',
                  color: 'inherit',
                  backgroundColor: current ? theme.vars.palette.action.selected : 'transparent',
                  border: `1px solid ${theme.vars.palette.divider}`,
                  // The current cell is heavier as well as tinted: a tint alone
                  // is a colour claim, and colour alone never carries a state here.
                  borderWidth: current ? 2 : 1,
                  borderRadius: `${rounded.control}px`,
                  fontFamily: typeRoles.tableCell.fontFamily,
                  fontSize: typeRoles.tableCell.fontSize,
                  '&:focus-visible': {
                    outline: `${focusRing.width}px solid ${theme.vars.palette.primary.main}`,
                    outlineOffset: focusRing.offset,
                  },
                })}
              >
                {/* Hidden from assistive technology, both of them: the cell's
                    accessible name is the sentence below, stated once. */}
                <Box component="span" aria-hidden="true">
                  {question.ordinal}
                </Box>
                <Box component="span" aria-hidden="true" data-testid="question-map-glyph">
                  {GLYPH[question.state]}
                </Box>
                <Box component="span" sx={visuallyHidden}>
                  {studentCopy.takeTest.cellState(
                    question.ordinal,
                    question.state === 'answered',
                    current,
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
      {/* The legend, on screen. Without it the glyphs would be the only account
          of a state for anyone reading the map visually. */}
      <Box
        data-testid="question-map-legend"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: `${comfortableDensity.gap}px` }}
      >
        <Typography sx={{ ...typeRoles.caption }}>
          <Box component="span" aria-hidden="true">
            {GLYPH.answered}{' '}
          </Box>
          {studentCopy.takeTest.legendAnswered}
        </Typography>
        <Typography sx={{ ...typeRoles.caption }}>
          <Box component="span" aria-hidden="true">
            {GLYPH['not-answered']}{' '}
          </Box>
          {studentCopy.takeTest.legendNotAnswered}
        </Typography>
      </Box>
    </Box>
  );
}
