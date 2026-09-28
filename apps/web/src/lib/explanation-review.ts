import type { ParentExplanationView } from '@/lib/parent-api';

/**
 * The parent's Explanation review, as pure functions.
 *
 * `apps/web` runs its unit suite with `environment: 'node'` and no DOM, so a decision
 * a row makes has to be a function to be assertable at all. These are that: the grouping of
 * a flat API list onto the answer-key rows it belongs beside, which generation of a Question
 * counts, and the states an inline region can be in. The rendering is the component's and
 * the pressing is the browser's.
 */

/**
 * The Explanations of one Attempt, keyed by the Question each is about.
 *
 * The API answers a flat list of **only the Explanations that exist**, and the screen
 * renders one row per *presented* Question — so the join is by Question id and the
 * misses are the point: a Question with no entry is one the child never asked about.
 *
 * A `Map` rather than a `find` per row, because a long paper would otherwise be
 * quadratic in the number of Questions for no reason.
 *
 * **A list per Question, because a Question legitimately holds several rows now.** Since
 * Story 6.4 the unique key is `(attemptId, questionId, studentProfileId, generation)`: an
 * explanation a parent removed and the replacement that followed it are two entries of one
 * Question, and the screen renders both. So the old "last entry wins, which cannot happen"
 * note is gone — the collision is the feature, and dropping all but one of them would hide
 * either the prose the operator is judging or the prose the child is being served.
 *
 * The order inside each list is **the API's**, which states a Question's generations oldest
 * first. Nothing here sorts: a second opinion about an order would be a second place it is
 * decided.
 */
export function explanationsByQuestion(
  views: readonly ParentExplanationView[],
): Map<string, ParentExplanationView[]> {
  const byQuestion = new Map<string, ParentExplanationView[]>();
  for (const view of views) {
    const held = byQuestion.get(view.questionId);
    if (held === undefined) byQuestion.set(view.questionId, [view]);
    else held.push(view);
  }
  return byQuestion;
}

/**
 * The generation that counts: the one the child is being served, or the one that was last
 * removed from them.
 *
 * **The highest `generation`, never the last element.** A list index would be right only
 * for as long as the API's order held, and the ordinal is the fact the API maintains and its
 * unique key enforces. `undefined` in and `undefined` out, so a Question nobody asked about
 * and one that holds rows are the same lookup at the call site rather than two branches.
 *
 * It is what `reviewStateFor` and `studentFlagStateFor` are applied to: the parent's own
 * flag and their child's report on the *latest* explanation are what a screen offers
 * controls for, and an older generation is read-only history.
 */
export function latestOf(
  views: readonly ParentExplanationView[] | undefined,
): ParentExplanationView | undefined {
  if (views === undefined) return undefined;
  let latest: ParentExplanationView | undefined;
  for (const view of views) {
    if (latest === undefined || view.generation > latest.generation) latest = view;
  }
  return latest;
}

/**
 * What a parent may do about this Question's explanation right now: nothing, remove it, or
 * replace it.
 *
 * Three states and no fourth, read off the **latest** generation.
 *
 * `'locked'` is the answer both for a Question nobody asked about and for one where no
 * concern is recorded, and the screen renders no control at all in it: a control that
 * appeared disabled would invite a parent to wonder what they did wrong, and there is
 * nothing they did.
 *
 * `'available'` is a concern recorded and the explanation still being served. `'suppressed'`
 * is one already removed, which is where the replacement is offered and where no second
 * removal is — suppression is not reversible and pressing again is not a second decision.
 *
 * **It reads the API's own `canSuppress` rather than re-deriving the rule.** The server
 * computes it from the same predicate its refusal reads, so the control offered here and the
 * answer a press would get cannot disagree — and a second derivation in the browser would
 * fail silently in the worst direction: a control offered for a concern nobody confirmed.
 *
 * Decided on `suppressedAt` being **present**, never on a truthiness test of a string that
 * could legitimately be empty: an instant is the fact.
 */
export function suppressionStateFor(
  views: readonly ParentExplanationView[] | undefined,
): SuppressionState {
  const latest = latestOf(views);
  if (latest === undefined) return 'locked';
  if (latest.suppressedAt !== null) return 'suppressed';
  return latest.canSuppress ? 'available' : 'locked';
}

/** The three states a Question's latest explanation can be in, for a parent. */
export type SuppressionState = 'locked' | 'available' | 'suppressed';

/**
 * The generation whose student report a decision would land on.
 *
 * **This mirrors the API's own pick, deliberately, and it has to.** `disposeStudentFlag`
 * decides the oldest **undecided** student flag across every generation of the Question,
 * falling back to the newest decided one for its 200 and 409 arms — so a screen that put
 * Agree and Dismiss beside the *latest* generation would have a parent press next to
 * generation 2 and watch generation 1 get decided, with the region they pressed in not
 * changing at all. Worse, an undecided report on an older generation would be undecidable
 * from this screen at any point.
 *
 * The API stays authoritative: this only decides **which row draws the control**, so that
 * the control a parent presses and the flag the API writes are the same row. If the two ever
 * drift the failure is visible rather than silent — the sentence that appears names the
 * generation the API actually decided, and it is the one this returned.
 *
 * `undefined` where no generation carries a student report at all, which is the case the
 * screen draws no decision controls for and the API answers with its shared 404.
 *
 * The oldest undecided is found by ordinal and not by list position, for the reason
 * `latestOf` is: the ordinal is the fact the API maintains.
 */
export function decidableOf(
  views: readonly ParentExplanationView[] | undefined,
): ParentExplanationView | undefined {
  if (views === undefined) return undefined;
  const reported = [...views]
    .filter((view) => view.studentFlaggedAt !== null)
    .sort((left, right) => left.generation - right.generation);
  return reported.find((view) => view.studentFlagDisposition === null) ?? reported.at(-1);
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
