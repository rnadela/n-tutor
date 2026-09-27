'use client';

import NextLink from 'next/link';
import type { Route } from 'next';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { studentCopy } from '@/copy/student';
import type { StudentPracticeTestSummary } from '@/lib/parent-api';
import { comfortableDensity } from '@/theme/tokens';

export interface PracticeTestRowProps {
  test: StudentPracticeTestSummary;
}

/**
 * One row of Student Home's practice-test list, as a component with no hooks
 * in it.
 *
 * Separated from the screen for the reason `PageStrip.tsx` is: what the
 * acceptance criteria are about — a Subject on every row and a condition told
 * in **words** — is a claim about what a child sees, and `apps/web` runs its
 * tests with `environment: 'node'` and no router, so a claim reachable only
 * through the whole page is a claim no test can state. This can be rendered on
 * its own and read back.
 *
 * It holds no state, no fetch and no router of its own.
 *
 * **The state is a text label, never a colour.** Every one of the three
 * conditions has to survive with all styling stripped, so the difference
 * between them is the sentence and nothing else. An unrecognized state renders
 * no label at all rather than guessing — `studentCopy.practiceTestState` is
 * exhaustive over the three tags and falls through to nothing.
 *
 * The Subject line is omitted on a falsy label, empty string included: a
 * styled line with nothing in it is worse than no line.
 */
export function PracticeTestRow({ test }: PracticeTestRowProps) {
  const state = studentCopy.practiceTestState(test.state);
  return (
    <Box
      component="li"
      // `listStyle: 'none'` strips list semantics in Safari/VoiceOver along
      // with the item count, which is the one thing a child scanning what is
      // waiting needs announced. Put back by hand, as `PageStrip.tsx` does.
      role="listitem"
      sx={{ listStyle: 'none', display: 'grid', gap: `${comfortableDensity.gap / 2}px` }}
      data-testid="student-practice-test"
    >
      {/* Guarded on trimmed content rather than on `!= null`, so an empty or
          whitespace-only label renders no line at all instead of an empty
          styled one. */}
      {test.subjectName?.trim() ? (
        <Typography sx={{ fontWeight: 700 }} data-testid="student-practice-test-subject">
          {test.subjectName}
        </Typography>
      ) : null}
      {/* The sentence **is** the link's accessible name — no `aria-label` over
          the top of it. A label would read identically on every row, hiding the
          one thing that tells them apart, and would replace the visible words
          for anyone speaking them (WCAG 2.5.3). A client-side navigation,
          because Take Test is inside Student Mode rather than past it. */}
      <Link
        component={NextLink}
        href={`/student/tests/${test.id}` as Route}
        sx={{ minHeight: comfortableDensity.tapTarget }}
      >
        {studentCopy.practiceTest(test.questionCount)}
      </Link>
      {state === null ? null : (
        <Typography data-testid="student-practice-test-state">{state}</Typography>
      )}
    </Box>
  );
}
