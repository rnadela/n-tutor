import type { GradeState } from '../generated/prisma/enums.js';

/**
 * What a grade "counts as" once a parent has had their say, and the flip rule that
 * decides whether they may — both as pure functions.
 *
 * **One place a grade is "what counts."** FR-25 requires the original AI verdict and
 * its rationale to remain stored and readable after an override, so the override is
 * its own nullable column beside them rather than an edit of them — and the moment
 * two columns describe one Question, "which one counts" is a rule that has to live
 * somewhere. If it lived at each read, the student's results, the parent's Attempt
 * detail, the dispute list and the score would be four answers to one question, and
 * they would disagree the first time any of them was tuned.
 *
 * Pure and file-local so the rule is assertable without a database, for the reason
 * `grading-score.ts` and `mastery-eligibility.ts` give: what the rows *are* is an
 * integration claim, what they *mean* is this.
 */

/** The two columns every effective-state reader needs, and no more. */
export interface OverridableGrade {
  state: GradeState;
  /** What a parent decided, or null for a Question none has adjusted. */
  overrideState: GradeState | null;
}

/**
 * What one Question counts as: the parent's decision where there is one, and the
 * provider's otherwise.
 *
 * `??` and not `||`, because the states are strings and none of them is falsy — but
 * the distinction is the point: null is "no parent has adjusted this", and there is no
 * other value that means it.
 *
 * Nothing here reads `overriddenAt`. An override with no instant beside it is never
 * written — the two columns move in one statement — so a second condition here would
 * be a guard against a row the writer cannot produce, and the next reader would
 * believe it can.
 */
export const effectiveStateOf = (row: OverridableGrade): GradeState =>
  row.overrideState ?? row.state;

/**
 * The only two states an override may move a Question **between**.
 *
 * `Unanswered` is the one state only the hand-in itself can know — a blank on a paper
 * handed in early — and `Ungraded` is the state a later read is still re-asking about.
 * Neither is a judgement of an answer, so neither is a judgement a parent can disagree
 * with: there is nothing there yet to be harsh about phrasing. FR-25's whole subject is
 * an answer a provider judged, and this is that set.
 *
 * Exported as the set rather than written into the comparisons below, so a surface or a
 * later read that needs to know which rows are adjustable reads *this* rather than
 * repeating two literals.
 */
export const OVERRIDABLE_STATES: readonly GradeState[] = ['Correct', 'Incorrect'];

/** Whether a stored verdict is one a parent may disagree with at all. */
export const isOverridable = (state: GradeState): boolean => OVERRIDABLE_STATES.includes(state);

/**
 * What an override request comes to, before anything is written.
 *
 * - `flip` — the requested state differs from what currently counts, and the stored
 *   verdict is one a parent may disagree with. Write it.
 * - `already` — the requested state is exactly what already counts. A 409 rather than
 *   a silent 200, because the parent is asking for a change and there is none to
 *   make: answering 200 would make a stale tab's second press look like a second
 *   decision, and answering 200 with the same row would make "nothing happened" and
 *   "it worked" the same response.
 * - `notJudged` — the **stored** verdict is `Unanswered` or `Ungraded`. A 409 and not
 *   a 404: the parent is entitled to the Attempt and to the row — they are reading
 *   it — and what is missing is a judgement to disagree with.
 */
export type OverrideDecision = 'flip' | 'already' | 'notJudged';

/**
 * Whether this override may be written, from the row and the request alone.
 *
 * **The stored state gates, the effective state compares.** Those are two different
 * columns doing two different jobs, and conflating them is the bug this function
 * exists to make impossible. Adjustability is a fact about what a provider judged —
 * a parent may not invent a verdict for a blank, however many times the row is
 * flipped afterwards — while "already recorded" is a fact about what currently
 * counts, which is the override where there is one. Comparing the request against
 * `state` instead would refuse a parent flipping their own earlier override back.
 *
 * The order of the arms is the rule. `notJudged` comes first: a row nothing judged is
 * not adjustable whatever is asked of it, and testing "already" first would answer a
 * request to mark an `Unanswered` blank `Incorrect`... with "that grade is already
 * recorded", which is a sentence about the wrong thing entirely.
 *
 * Nothing here writes, reads a clock or looks at a dispute: an override needs no
 * dispute (a parent who spots a bad grade themselves may fix it), and the instant is
 * the writer's.
 */
export function overrideDecision(row: OverridableGrade, requested: GradeState): OverrideDecision {
  if (!isOverridable(row.state)) return 'notJudged';
  if (effectiveStateOf(row) === requested) return 'already';
  return 'flip';
}
