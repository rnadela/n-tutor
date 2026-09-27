'use client';

import Box from '@mui/material/Box';
import type { StudentPracticeTestSummary } from '@/lib/parent-api';
import { comfortableDensity } from '@/theme/tokens';
import { PracticeTestRow } from './PracticeTestRow';

export interface PracticeTestListProps {
  tests: readonly StudentPracticeTestSummary[];
}

/**
 * The child's practice tests, **in the order they were handed over**.
 *
 * Extracted for the same reason the row was, and for one more: "the page
 * renders what the server chose" is itself a claim about what a child sees,
 * and a claim about what a child sees is verified by rendering it. A test that
 * assembled its own list out of rows would satisfy the words while verifying
 * nothing, and a ban on `.sort(` in the page's source is walked straight past
 * by `.reverse()`, `.toSorted()` or a named grouping helper. So the order is
 * rendered here and read back off the markup.
 *
 * It holds no state, no fetch, no router — and no sort, no filter and no
 * grouping. The server decided the order and the bands; there is exactly one
 * flat list, and the Subject is a label on a row rather than a heading over a
 * section.
 */
export function PracticeTestList({ tests }: PracticeTestListProps) {
  return (
    <Box
      component="ul"
      // `listStyle: 'none'` strips list semantics in Safari/VoiceOver, and the
      // item count with them — which is the one thing a child scanning what is
      // waiting needs announced. Put back by hand, as `PageStrip.tsx` does.
      role="list"
      sx={{ display: 'grid', gap: `${comfortableDensity.gap}px`, p: 0, m: 0 }}
      data-testid="student-practice-test-list"
    >
      {tests.map((test) => (
        <PracticeTestRow key={test.id} test={test} />
      ))}
    </Box>
  );
}
