import type { GradeState } from '../generated/prisma/enums.js';

/**
 * FR-37's denominator column, as one pure function.
 *
 * **One function, so no surface can compute a second denominator.** The score of
 * an Attempt is a count over its grade rows and FR-37 fixes how it is counted, so
 * a second implementation beside a read would be a second answer to the same
 * question — and the two would disagree the first time either `Unanswered` or
 * `Ungraded` was reconsidered.
 *
 * Pure and file-local so the column is assertable without a database.
 */

/**
 * What one Attempt came to, over its **presented** Questions.
 *
 * `correct` over `denominator` is the fraction a surface states. `excludedUngraded`
 * is not a footnote: an Attempt with Questions nothing could judge has a score over
 * fewer Questions than the child sat, and a surface that showed the fraction without
 * the count would be quietly restating the paper.
 */
export interface AttemptScore {
  /** How many presented Questions are `Correct`. */
  correct: number;
  /**
   * Every presented Question except the ones nothing has judged: `Correct`,
   * `Incorrect` and `Unanswered` count, and `Ungraded` does not.
   *
   * Zero is a legitimate value — an Attempt nothing could grade at all — and a
   * caller that divides must say what zero over zero means on its own surface.
   */
  denominator: number;
  /** How many presented Questions were left out of the denominator. */
  excludedUngraded: number;
}

/**
 * The score of one Attempt, from one entry per **presented** Question.
 *
 * `null` is a Question with no grade row, and it is treated exactly as `Ungraded`
 * is: excluded and counted as excluded. The two are the same fact — nothing has
 * judged this — and `resolveUngraded` re-asks for both, so a score that told them
 * apart would report a different denominator than the retry path works from.
 *
 * `Unanswered` is in the denominator and earns no credit, which is the whole
 * difference between it and `Ungraded`: a Question the child chose to leave blank
 * is a Question they got no marks for, and a Question a provider could not judge is
 * not a Question at all until something judges it.
 */
export function scoreOf(states: readonly (GradeState | null)[]): AttemptScore {
  let correct = 0;
  let excludedUngraded = 0;
  for (const state of states) {
    if (state === 'Correct') correct += 1;
    if (state === 'Ungraded' || state === null) excludedUngraded += 1;
  }
  return { correct, denominator: states.length - excludedUngraded, excludedUngraded };
}
