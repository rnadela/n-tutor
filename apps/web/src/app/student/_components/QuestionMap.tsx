'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { QuestionGrid, type QuestionGridCell } from '@/components/QuestionGrid';
import { studentCopy } from '@/copy/student';
import type { QuestionProgress } from '@/lib/answers';
import { comfortableDensity, rounded, typeRoles } from '@/theme/tokens';

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
 * **The geometry is not here any more.** Since Story 5.8 the grid rule, the button's
 * box, the `aria-hidden` digit, the glyph slot, the single visually-hidden sentence and
 * `aria-current` all live in `components/QuestionGrid`, which the results map is built
 * on too — so the two maps cannot drift on the carriers accessibility depends on. What
 * stays here is this component's actual job: **the progress vocabulary**. The glyph
 * table, the heading, the two-count summary, the drawn bar and the two-entry legend are
 * the words and figures of a test still being worked, and they are exactly what must not
 * be shared with a map read after the marks are in.
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

  const cells: QuestionGridCell[] = progress.map((question, index) => {
    const current = index === currentIndex;
    const done = question.state === 'answered';
    return {
      key: question.id,
      ordinal: question.ordinal,
      current,
      tone: done ? 'done' : 'idle',
      data: { 'data-state': question.state },
      // Marked `aria-hidden` here rather than by the grid: the test id and the colour
      // are this vocabulary's, and the grid is not allowed to know either.
      glyph: (
        <Box
          component="span"
          aria-hidden="true"
          data-testid="question-map-glyph"
          sx={{ color: done ? 'primary.main' : 'text.secondary', lineHeight: 1 }}
        >
          {GLYPH[question.state]}
        </Box>
      ),
      sentence: studentCopy.takeTest.cellState(question.ordinal, done, current),
    };
  });

  return (
    <Box sx={{ display: 'grid', gap: `${comfortableDensity.gap}px` }}>
      <Typography component="h2" sx={{ ...typeRoles.cardTitle }}>
        {studentCopy.takeTest.mapHeading}
      </Typography>
      {/* Two counts and no third. There is no score to state. */}
      <Typography data-testid="question-map-summary" sx={{ ...typeRoles.caption }}>
        {studentCopy.takeTest.mapSummary(answered, notAnswered)}
      </Typography>
      {/* The same two counts, drawn: one segment per state, sized by the counts
          themselves rather than by a percentage. Hidden from assistive technology,
          because the sentence above already says it. */}
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          height: comfortableDensity.gap / 2,
          borderRadius: `${rounded.control}px`,
          overflow: 'hidden',
          bgcolor: 'action.hover',
        }}
      >
        <Box sx={{ flexGrow: answered, bgcolor: 'primary.main' }} />
        <Box sx={{ flexGrow: notAnswered }} />
      </Box>
      <QuestionGrid
        cells={cells}
        onJump={onJump}
        testId="question-map"
        cellTestId="question-map-cell"
      />
      {/* The legend, on screen. Without it the glyphs would be the only account
          of a state for anyone reading the map visually. */}
      <Box
        data-testid="question-map-legend"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: `${comfortableDensity.gap}px` }}
      >
        <Typography sx={{ ...typeRoles.caption }}>
          <Box component="span" aria-hidden="true" sx={{ color: 'primary.main' }}>
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
