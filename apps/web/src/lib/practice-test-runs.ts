import { studentCopy } from '@/copy/student';
import type { AttemptRunView, PracticeTestRunsView } from './parent-api';

/**
 * What a row on Student Home says about a practice test's finished runs, as a rule
 * rather than as a render.
 *
 * `apps/web` runs its unit tests without a DOM, so a claim reachable only through
 * markup is a claim no test can state — the same reason `results-summary.ts` exists.
 * What this module holds is exactly the choice between the two shapes and the parts
 * each one is made of, so the choice can be asserted where a failure names the rule
 * that broke.
 *
 * **It computes no score and no denominator, and never will.** Both figures are the
 * API's one answer to FR-37, stated per run; a fraction derived here would be a
 * second answer to the same question, and nothing here divides, rounds or turns one
 * into a percentage. The returned shapes are what say so: strings assembled out of
 * figures that arrived, and no arithmetic anywhere.
 */

/** One practice test with exactly one finished run: one figure, and no framing. */
export interface SingleRunLine {
  kind: 'single';
  /** The one run's figure, or the words said when there is nothing to divide. */
  figure: string;
}

/** One practice test with more than one finished run: the line, and what counts. */
export interface MultiRunLine {
  kind: 'multi';
  /**
   * The parts of the line, in the order they are read: the first run's figure, the
   * latest run's figure, then how many runs there are.
   *
   * Returned as parts rather than as one joined string so the choice is assertable
   * part by part, and so the row decides how they are joined.
   */
  parts: string[];
  /** Which run counts toward progress, said once beneath the figures. */
  note: string;
}

export type RunLine = SingleRunLine | MultiRunLine;

/**
 * Which of the two shapes this test's runs are read in.
 *
 * **Decided by the data the API states, not by arithmetic.** One finished run arrives
 * with `first` and `latest` naming the same `attemptId` *and* `attemptCount: 1`, and
 * both are required: a count of one with two different ids, or two matching ids with a
 * higher count, is a response this browser has no honest reading of — so it is read
 * the same way as a history, which states the figures it was given rather than
 * choosing between them.
 *
 * The first/latest distinction lives in the **words** (`First …`, `Latest …`), never
 * in an order, a colour or a position, so it survives being read aloud.
 */
export function runLineOf(runs: PracticeTestRunsView): RunLine {
  if (runs.attemptCount === 1 && runs.first.attemptId === runs.latest.attemptId) {
    return { kind: 'single', figure: figureOf(runs.first) };
  }
  return {
    kind: 'multi',
    parts: [
      studentCopy.runs.first(figureOf(runs.first)),
      studentCopy.runs.latest(figureOf(runs.latest)),
      studentCopy.runs.count(runs.attemptCount),
    ],
    note: studentCopy.runs.countsTowardProgress,
  };
}

/**
 * One run's figure, or the words said in place of one.
 *
 * A zero denominator is a legitimate answer — a run nothing could judge — and it is
 * replaced rather than divided, exactly as the results screen's own score line does.
 * Both numbers are the server's; this reads them and writes neither.
 */
function figureOf(run: AttemptRunView): string {
  if (run.score.denominator === 0) return studentCopy.runs.notGradedYet;
  return studentCopy.runs.figure(run.score.correct, run.score.denominator);
}

/**
 * The run history indexed by practice test, for a row to look its own entry up by.
 *
 * **A lookup, never an order.** The list's order is the server's and Student Home
 * renders what it was given; this map only answers "is there a figure for this row",
 * and a test with no entry is a row that shows no extra line at all. Nothing here
 * sorts, filters or groups the tests.
 */
export function runsById(runs: readonly PracticeTestRunsView[]): Map<string, PracticeTestRunsView> {
  return new Map(runs.map((entry) => [entry.practiceTestId, entry]));
}
