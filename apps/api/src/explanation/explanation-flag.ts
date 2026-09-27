import type { ExplanationFlagOrigin } from '../generated/prisma/enums.js';
import type { RichText } from '../extraction/rich-text.js';

/**
 * The origin a parent's flag is recorded under, named once.
 *
 * Spelled here rather than inline at the two places that use it — the `where` that
 * reads a row's flags and the `create` that writes one — because those two must
 * agree or a flag would be written under one origin and read under another, and a
 * parent pressing the control would watch nothing happen. One constant is what makes
 * that impossible rather than unlikely.
 *
 * Story 6.3's student-originated flag adds a second constant beside this one and no
 * enum migration: both members are already declared (`ExplanationFlagOrigin`).
 */
export const PARENT_FLAG_ORIGIN: ExplanationFlagOrigin = 'Parent';

/**
 * One stored Explanation as the **parent** reading it gets it back.
 *
 * `questionId` rather than the pair `ExplanationView` carries: a parent reads a
 * whole Attempt at once, so the Attempt id is the request and restating it on every
 * entry would be the same string repeated per Question.
 *
 * `parentFlaggedAt` is the instant a parent first recorded a concern about this
 * Explanation, or null for one nobody has. **It is an instant rather than a
 * boolean** because it is a record of when, and the screen states the state from it;
 * and it is the *first* flag's instant, which the upsert keeps, so a second press
 * cannot move it.
 *
 * There is **no `studentFlaggedAt`, no disposition and no suppression field**: those
 * are Stories 6.3 and 6.4, and a view with a shape for them would be this story
 * answering a question it has not been asked. There is no cost, no tier, no model
 * name, no allowance figure and no grading rationale either (AD-20, AD-26) — the
 * rationale is Story 6.5's, and it has nowhere here to sit.
 */
export interface ParentExplanationView {
  questionId: string;
  /** The stored segments, exactly as stored (AD-32). */
  body: RichText;
  /** When a parent first flagged it, or null. */
  parentFlaggedAt: string | null;
}

/**
 * One stored row, as it comes back from the read that composes the parent's view.
 *
 * `flags` is already filtered to the parent origin by that read's own `where`, which
 * is why the mapping below takes the *first* one rather than searching: the unique
 * key `[explanationId, origin]` means there is at most one, and a search here would
 * imply otherwise.
 */
export interface StoredExplanationRow {
  questionId: string;
  body: unknown;
  flags: readonly { createdAt: Date }[];
}

/**
 * The stored rows, mapped into what a parent reads — as one pure function.
 *
 * Pure and file-local so the mapping is assertable without a database, for the
 * reason `grading-results.ts` gives about `answerKeyRows`. What the rows *are* is an
 * integration claim; what they *become* is this.
 *
 * **Nothing here invents an entry.** A Question with no stored row is simply absent
 * from the list, and it is the screen that says nothing was explained — a synthesized
 * empty entry would be indistinguishable from an Explanation that came back blank,
 * and the parent would be told their child was shown prose that does not exist.
 *
 * The order is the read's order and nothing here sorts: the parent's screen keys
 * these by Question id onto answer-key rows that are already in the order the child
 * met them.
 */
export function parentExplanationViews(
  rows: readonly StoredExplanationRow[],
): ParentExplanationView[] {
  return rows.map((row) => ({
    questionId: row.questionId,
    // Stored segments travel out exactly as stored (AD-32). They were parsed on the
    // way in; re-parsing here would be a second chance for two readings of a row
    // neither of them wrote to disagree.
    body: row.body as RichText,
    // At most one, by the unique key. `?? null` rather than a length check, so an
    // unflagged row and a flagged one differ in the value and never in the shape.
    parentFlaggedAt: row.flags[0]?.createdAt.toISOString() ?? null,
  }));
}
