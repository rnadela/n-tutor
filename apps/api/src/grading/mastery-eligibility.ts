/**
 * Which Attempt of a Practice Test counts toward Mastery — the **single**
 * definition, and the only one there is.
 *
 * FR-26 and every Mastery figure are Epic 7's. What this story owes Epic 7 is that
 * "which run counts" is already decided, stated in one place, and true of the data:
 * the **first** run counts and no other does. A retake is `ordinal > 1`, so it is
 * excluded **by construction** rather than by a filter at each call site — and a
 * filter somebody has to remember at each call site is a filter that will be
 * forgotten at one of them.
 *
 * It is stated here, in `grading`, because Mastery is `grading`'s (AD-6) even
 * though `ordinal` is `practicetest`'s column: the predicate is a rule about what a
 * grade means, not a rule about how an Attempt is stored.
 *
 * Pure and dependency-free, so the rule is assertable without a database, without a
 * provider and without a Mastery table.
 *
 * **Every trigger calls the recompute from inside a transaction.** AD-10 puts the
 * recompute of whatever a grade changes inside the transaction that changed it, and
 * these are the statements in this system that change one:
 *
 * 1. **Handing in** (`submitAttempt`), which writes every verdict a paper comes to.
 * 2. **A parent's override** (`overrideGrade`, Story 6.5), which changes what one
 *    Question counts as and therefore what the Attempt's score is.
 * 3. **A results read** (`resolveUngraded`), which re-asks for the Questions nothing
 *    judged and writes the verdicts that come back.
 *
 * All three call `GradingService.recomputeMastery` inside their own transaction — one line in one unit
 * of work per trigger, never a queue, a timer or a read-time derivation — and "which run
 * counts" is decided below and nowhere else.
 *
 * The override does not widen `countsTowardMastery`: which run counts is still decided by
 * *which run it is*, and a parent adjusting a grade on a retake does not promote that
 * retake to the run that counts. An override on the **first** run changes the figure that
 * run contributes, which is exactly why the seam is in its transaction.
 */

/**
 * The one run of a Practice Test that counts: the child's first.
 *
 * Exported as a constant rather than written into the comparison below, so a surface
 * or a later Epic 7 read that needs the number reads *this* number instead of
 * repeating a literal `1`.
 */
export const MASTERY_ATTEMPT_ORDINAL = 1;

/**
 * Whether an Attempt at this `ordinal` counts toward Mastery.
 *
 * Every retake answers `false`, because every retake is at a higher ordinal than the
 * first run. Nothing here reads a grade, a score or a date: what counts is decided
 * by *which run it is*, and a run's place is fixed the instant it is inserted.
 */
export function countsTowardMastery(ordinal: number): boolean {
  return ordinal === MASTERY_ATTEMPT_ORDINAL;
}
