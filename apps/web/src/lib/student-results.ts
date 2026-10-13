/**
 * The Results screen's one rule: which of the child's practice tests belong on it.
 *
 * Framework-free and argument-in/value-out, exactly like `practice-test-runs.ts`
 * and `bottom-nav.ts` — `apps/web` runs its unit tests in `environment: 'node'`
 * with no jsdom, so a rule living inside a component could only be pinned by
 * matching its source text, which passes on code that is structurally right and
 * behaviourally wrong.
 */
import type { StudentPracticeTestSummary } from './parent-api';

/**
 * The finished practice tests, in the order the server stated them.
 *
 * **The order is the server's and nothing here produces it.**
 * `GET /student/practice-tests` answers one flat list in two bands — everything
 * there is still to do first, then everything finished, band 2 most recently
 * submitted first. Filtering preserves relative order, so "newest first" on this
 * screen is the server's sentence repeated rather than a second answer to the
 * same question: nothing here sorts, reverses or compares a date, and
 * `StudentPracticeTestSummary` carries no timestamp it could compare anyway.
 *
 * Only the exact tag `'Completed'` is admitted. A state this browser does not
 * recognise is excluded rather than let through, for the reason
 * `studentCopy.practiceTestState` refuses to fall through to its last case:
 * telling a child that a test they have never touched is finished is the worst
 * answer available.
 *
 * Handed back `readonly`, as it was handed in: the rows are the server's and this
 * is the shape `PracticeTestList` takes. A mutable array would re-open what the
 * sentence above promises is untouched.
 */
export function completedTests(
  tests: readonly StudentPracticeTestSummary[],
): readonly StudentPracticeTestSummary[] {
  return tests.filter((test) => test.state === 'Completed');
}
