import type { ParentExplanationView } from '@/lib/parent-api';

/**
 * The parent's Explanation review, as pure functions.
 *
 * `apps/web` runs its unit suite with `environment: 'node'` and no DOM, so a decision
 * a row makes has to be a function to be assertable at all. These two are that: the
 * keying of a flat API list onto the answer-key rows it belongs beside, and the one
 * state an inline region can be in. The rendering is the component's and the pressing
 * is the browser's.
 */

/**
 * The Explanations of one Attempt, keyed by the Question each is about.
 *
 * The API answers a flat list of **only the Explanations that exist**, and the screen
 * renders one row per *presented* Question — so the join is by Question id and the
 * misses are the point: a Question with no entry is one the child never asked about.
 *
 * A `Map` rather than a `find` per row, because a long paper would otherwise be
 * quadratic in the number of Questions for no reason. **Last entry wins** on a
 * repeated id, which cannot happen — the unique key
 * `(attemptId, questionId, studentProfileId)` allows one row per Question, and the
 * read is scoped to one Attempt and one child — and is stated rather than guarded, so
 * nothing here pretends to resolve an ambiguity the database does not permit.
 */
export function explanationsByQuestion(
  views: readonly ParentExplanationView[],
): Map<string, ParentExplanationView> {
  return new Map(views.map((view) => [view.questionId, view]));
}

/**
 * What one answer-key row's inline region is: nothing to read, prose nobody has
 * reported, or prose a parent has.
 *
 * Three states and no fourth. There is deliberately no `'loading'` here: the
 * Explanations of an Attempt arrive with the Attempt, in one read, so an individual
 * row is never waiting on anything — and no `'failed'`, because a failure is the
 * screen's and is stated once rather than repeated on every row of a paper.
 *
 * `'absent'` is the answer for a Question with no stored Explanation, which is the
 * common case and not an error: the child worked through it without asking. Nothing
 * on this surface generates one, so `'absent'` has no action attached to it.
 */
export type ExplanationReviewState = 'absent' | 'unflagged' | 'flagged';

/**
 * The state of the region beneath one row, from that row's Explanation or the lack of
 * one.
 *
 * `undefined` in rather than a boolean flag beside it: the caller looks the Question
 * up in the map above and hands over whatever came back, so "there is no Explanation"
 * and "there is one" are the same lookup rather than two branches at the call site.
 *
 * Flagged is decided on `parentFlaggedAt` being present, never on a truthiness test
 * of a string that could legitimately be empty — an instant is the fact, and the
 * screen states it.
 */
export function reviewStateFor(view: ParentExplanationView | undefined): ExplanationReviewState {
  if (view === undefined) return 'absent';
  return view.parentFlaggedAt === null ? 'unflagged' : 'flagged';
}

/**
 * What one row's **student** flag is: nothing, a concern nobody has decided about, or a
 * decision that has been made.
 *
 * Four states and no fifth, and its own function rather than a widening of
 * `reviewStateFor`: the parent's own flag and their child's are two independent facts
 * about one Explanation, and a single state that tried to carry both would have twelve
 * members describing two things. Each is its own pure decision, and the region draws
 * both.
 *
 * `'awaiting'` is the case the screen has controls for, and it is the **absence** of a
 * decision rather than a value anybody wrote: a report with no disposition is one nobody
 * has read yet. That is why it is decided on `studentFlaggedAt` being present *and* the
 * disposition being absent, rather than on a third enum member the API does not have.
 *
 * `'none'` covers both no Explanation at all and one the child never reported: neither
 * has anything for a parent to decide, and there is nothing a screen would do
 * differently between them — the `absent` case is `reviewStateFor`'s to state, once.
 *
 * Decided on the fields being **present**, never on a truthiness test of a string that
 * could legitimately be empty: an instant is the fact, and a report whose instant will
 * not parse is still a report.
 */
export function studentFlagStateFor(view: ParentExplanationView | undefined): StudentFlagState {
  if (view === undefined || view.studentFlaggedAt === null) return 'none';
  if (view.studentFlagDisposition === 'Confirmed') return 'confirmed';
  if (view.studentFlagDisposition === 'Dismissed') return 'dismissed';
  return 'awaiting';
}

/** The four states a row's student flag can be in. */
export type StudentFlagState = 'none' | 'awaiting' | 'confirmed' | 'dismissed';
