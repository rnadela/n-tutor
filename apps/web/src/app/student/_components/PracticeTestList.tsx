'use client';

import Box from '@mui/material/Box';
import type { PracticeTestRunsView, StudentPracticeTestSummary } from '@/lib/parent-api';
import { comfortableDensity } from '@/theme/tokens';
import { PracticeTestRow } from './PracticeTestRow';

export interface PracticeTestListProps {
  tests: readonly StudentPracticeTestSummary[];
  /**
   * Each test's finished runs, by practice test id.
   *
   * **A lookup, never an order.** It is read once per row to hand that row its own
   * entry, and it decides nothing about which rows there are or what order they come
   * in — an entry for a test not in `tests` is simply never looked up. Absent, or
   * absent for a row, means that row renders exactly as it did in Story 5.1.
   */
  runs?: ReadonlyMap<string, PracticeTestRunsView>;
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
export function PracticeTestList({ tests, runs }: PracticeTestListProps) {
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
        // Its own entry, looked up by its own id. A row with none renders no run line
        // at all, which is what a failed run read and a test with nothing finished
        // both come to.
        <PracticeTestRow key={test.id} test={test} runs={runs?.get(test.id)} />
      ))}
    </Box>
  );
}
