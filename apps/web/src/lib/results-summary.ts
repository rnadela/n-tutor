import type { GradeState } from './parent-api';

/**
 * The two counts the results header's meta line states, as a rule rather than as a
 * render.
 *
 * `apps/web` runs its unit tests without a DOM, so a claim reachable only through
 * markup is a claim no test can state — the same reason `answers.ts` exists. What
 * this module holds is exactly the derivations, so they can be asserted where a
 * failure names the rule that broke.
 *
 * **It computes no denominator, and never will.** FR-37's denominator is the API's
 * one answer, stated in `score` on the same response as the rows — a second one
 * derived here would be a second answer to the same question, and the two would
 * disagree the first time either `Unanswered` or `Ungraded` was reconsidered. The
 * returned shape is what says so: two counts, no total and no fraction.
 */

/** As much of one row as these counts depend on. */
export interface ResultRowRef {
  state: GradeState;
  /** Whether the read that produced the row is what judged it. */
  newlyGraded: boolean;
}

/**
 * The meta line's two counts.
 *
 * `Correct` is deliberately absent: the score sentence above the line already
 * states it, and a second copy of the same figure beside it is a second place for
 * it to be wrong. `Ungraded` is absent too — the gap has its own sentence, because
 * a count with no explanation of what it means for the score is a count that reads
 * as a fourth kind of wrong.
 */
export interface ResultsSummary {
  incorrect: number;
  unanswered: number;
}

/**
 * How many of these rows are wrong and how many were left blank, **over the rows
 * given**.
 *
 * Counted over the array as it arrives, so a row for a Question that is not on this
 * paper can neither inflate a figure nor hide one. Nothing here sorts or filters the
 * rows themselves.
 */
export function summaryOf(rows: readonly ResultRowRef[]): ResultsSummary {
  let incorrect = 0;
  let unanswered = 0;
  for (const row of rows) {
    if (row.state === 'Incorrect') incorrect += 1;
    if (row.state === 'Unanswered') unanswered += 1;
  }
  return { incorrect, unanswered };
}

/**
 * How many of these rows **this read** judged.
 *
 * Read off the rows rather than counted from a separate list, so the number the
 * announcement names and the rows that say `Just graded.` are one derivation. Zero
 * is the ordinary answer — most reads resolve nothing — and it is what means no
 * announcement is made at all.
 */
export function newlyGradedCount(rows: readonly ResultRowRef[]): number {
  return rows.reduce((count, row) => (row.newlyGraded ? count + 1 : count), 0);
}
