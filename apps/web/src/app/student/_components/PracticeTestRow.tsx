'use client';

import NextLink from 'next/link';
import type { Route } from 'next';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { studentCopy } from '@/copy/student';
import type { PracticeTestRunsView, StudentPracticeTestSummary } from '@/lib/parent-api';
import { runLineOf } from '@/lib/practice-test-runs';
import { comfortableDensity, typeRoles } from '@/theme/tokens';

export interface PracticeTestRowProps {
  test: StudentPracticeTestSummary;
  /**
   * This test's finished runs, or absent.
   *
   * Absent covers both "the run read failed" and "nothing is finished here yet", and
   * both render the same thing: **nothing at all**. A row with no figure on it is the
   * row that shipped in Story 5.1 and is still complete — the Subject, the link and
   * the state word are the whole of what a child needs to act on.
   */
  runs?: PracticeTestRunsView;
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
 *
 * **The run line is an annotation, not a requirement.** It renders only when this
 * row was handed an entry, and both figures in it are the server's — this component
 * states no denominator and computes no fraction. Which figure is the first and
 * which is the latest lives in the words, so the distinction survives with all
 * colour, class and inline style stripped away.
 */
export function PracticeTestRow({ test, runs }: PracticeTestRowProps) {
  const state = studentCopy.practiceTestState(test.state);
  // Chosen by `practice-test-runs`, so the single-run and history shapes are one
  // rule with its own spec rather than a branch in a render.
  const line = runs === undefined ? null : runLineOf(runs);
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
      {/* Beneath the state label, and absent entirely without an entry. */}
      {line !== null && (
        <Typography sx={{ ...typeRoles.caption }} data-testid="student-practice-test-runs">
          {line.kind === 'single' ? line.figure : line.parts.join(studentCopy.runs.separator)}
        </Typography>
      )}
      {/* Which run counts, said once and only where there is more than one. With a
          single run there is nothing to distinguish, and the sentence would be
          telling a child that the only thing they did is the thing that counted. */}
      {line !== null && line.kind === 'multi' && (
        <Typography sx={{ ...typeRoles.caption }} data-testid="student-practice-test-runs-note">
          {line.note}
        </Typography>
      )}
    </Box>
  );
}
