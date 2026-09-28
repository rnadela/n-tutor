import type {
  ExplanationFlagDisposition,
  ExplanationFlagOrigin,
} from '../generated/prisma/enums.js';
import {
  PARENT_FLAG_ORIGIN,
  QUEUED_FLAG_DISPOSITION,
  STUDENT_FLAG_ORIGIN,
} from './explanation-flag.js';

/**
 * The pure part of suppression: when a parent may take an Explanation away from their
 * child, and which generation of a Question counts.
 *
 * Pure and file-local so every rule here is assertable with no database, for the reason
 * `explanation-flag.ts`'s mapper is: what the rows *are* is an integration claim; what
 * they *mean* is this.
 */

/**
 * The flag facts the unlock predicate reads, and nothing else.
 *
 * Its own narrow shape rather than the stored row's, so the predicate can be applied to
 * a `select` that fetched two columns and to a mapper's input alike — and so nothing
 * about a body, a cost or a child can reach it.
 */
export interface SuppressionFlag {
  origin: ExplanationFlagOrigin;
  disposition: ExplanationFlagDisposition | null;
}

/**
 * Whether a recorded concern exists that entitles a parent to suppress this
 * Explanation.
 *
 * **This is the Admin queue's own predicate, named once.** `flaggedForAdmin`'s `where`
 * has exactly these two arms — a parent-origin flag qualifies outright, and a
 * student-origin one only once the parent confirmed it — and stating the rule a second
 * time in a suppression guard would be two spellings of one thing. The failure would be
 * silent in the worst direction: a control offered for something the API refuses, or
 * worse, a control offered for a concern nobody has confirmed.
 *
 * It is what both the API's refusal (`SUPPRESSION_NEEDS_A_FLAG`) and the view's
 * `canSuppress` read, which is what keeps the control a parent is offered and the answer
 * they would get from disagreeing.
 *
 * **Never automatic and never a student's own doing.** A row with no flags at all, one
 * whose only student flag is awaiting a decision, and one whose student flag the parent
 * *dismissed* are each locked: a concern nobody has read is not a judgement, and a
 * dismissal is the parent having read the same prose and said it was fine.
 *
 * `Dismissed` is excluded by not being `QUEUED_FLAG_DISPOSITION` rather than by an arm
 * of its own, for the reason that constant's doc gives: a second arm naming it would be
 * a place for the two spellings to disagree.
 */
export function suppressionUnlocked(flags: readonly SuppressionFlag[]): boolean {
  return flags.some(
    (flag) =>
      flag.origin === PARENT_FLAG_ORIGIN ||
      (flag.origin === STUDENT_FLAG_ORIGIN && flag.disposition === QUEUED_FLAG_DISPOSITION),
  );
}

/**
 * One stored row, reduced to what "which generation counts" needs.
 *
 * Three fields and no body: this is applied to a `select` that deliberately reads no
 * prose, because the list of Questions a child may not be shown an explanation for is
 * not a list of explanations.
 */
export interface GenerationRow {
  questionId: string;
  generation: number;
  suppressedAt: Date | null;
}

/**
 * The highest generation of each Question, out of a list that may hold several of some.
 *
 * **The highest, and never the newest by `createdAt`.** `generation` is the ordinal the
 * writes maintain and the unique key enforces; two rows written inside the same
 * millisecond have an unambiguous order by it and none by their instants.
 *
 * A `Map` rather than a sort-and-scan, so a paper the parent regenerated on every
 * Question is linear rather than quadratic. Ties are impossible by
 * `@@unique([attemptId, questionId, studentProfileId, generation])`, and the `>`
 * comparison would keep the first of two anyway rather than pretend to resolve one.
 */
export function latestGenerations<Row extends GenerationRow>(
  rows: readonly Row[],
): Map<string, Row> {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const held = latest.get(row.questionId);
    if (held === undefined || row.generation > held.generation) latest.set(row.questionId, row);
  }
  return latest;
}

/**
 * The Questions whose **latest** generation is suppressed — the list a child's results
 * screen reads before it draws a control.
 *
 * Ids and nothing else. Not a body, not an instant, not a reason and not who decided: a
 * student surface learns that a parent removed this explanation and no more than that
 * (AD-20, AD-26), and a shape with nowhere for the rest to sit is what makes it so.
 *
 * **The latest generation is the one that counts**, which is why a Question whose
 * generation 1 is suppressed and whose generation 2 is live is *absent* from this list:
 * the child is being served the replacement, and the suppressed row behind it is a
 * parent-side and operator-side fact.
 *
 * The order is the read's order and nothing here sorts. The caller is a screen looking
 * ids up, not a list anybody reads.
 */
export function suppressedQuestionIds(rows: readonly GenerationRow[]): string[] {
  return [...latestGenerations(rows).values()]
    .filter((row) => row.suppressedAt !== null)
    .map((row) => row.questionId);
}
