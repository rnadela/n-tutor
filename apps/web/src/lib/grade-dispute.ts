import type { AttemptScore, GradeDisputeView, GradeState } from './parent-api';

/**
 * What a dispute control is showing, what a press of it means, how a changed score is
 * stated, and what a dispute list entry has come to — all as pure functions.
 *
 * They live here rather than inside the components because `apps/web` runs its unit tests
 * with `environment: 'node'` and no DOM: a rule that only exists inside an event handler
 * is a rule nothing can assert. The components' job is to hold state and draw it; **what a
 * press means** is this, exactly as `explain-panel.ts` holds the same line.
 */

/**
 * What a press of the dispute control should do.
 *
 * - `already` — this child has already said it. There is **no un-saying**, so a second
 *   press must send nothing: a record of an objection is not a toggle, and the API would
 *   answer the first instant anyway, which makes the round trip one nobody needs.
 * - `busy` — an objection is already out. A second press must not start a second one, or
 *   two responses land in either order and the child is told twice that something happened
 *   once.
 * - `offline` — no connection, so nothing is sent at all. Distinct from a failure, because
 *   "you are not connected" is a thing a child can act on.
 * - `request` — send it. A first press, or a person pressing again after a failure.
 *
 * The order of the arms is the rule. An existing objection wins over everything, including
 * being busy, because it means nothing needs sending whatever else is in flight; `busy` is
 * swallowed before the connection is consulted; and only then does a press become something
 * that leaves the device.
 *
 * **There is deliberately no arm for an unadjustable mark.** The API refuses an unanswered
 * or ungraded question only to a *parent* trying to change it; a child may say any mark
 * looks wrong, and a browser-side rule that stopped them would be enforcing a mechanic they
 * are never shown (AD-20).
 */
export type DisputePressDecision = 'already' | 'busy' | 'offline' | 'request';

export function disputeDecision(input: {
  online: boolean;
  /** Whether the row already carries this child's objection. */
  disputed: boolean;
  /** Whether an objection this panel sent is still out. */
  sending: boolean;
}): DisputePressDecision {
  if (input.disputed) return 'already';
  if (input.sending) return 'busy';
  if (!input.online) return 'offline';
  return 'request';
}

/**
 * The two figures a changed score is stated as, or `null` when there is no change to
 * state.
 *
 * **Null in two cases that are the same absence**: the server stated no prior score (no row
 * on the run carries an adjustment), and the two figures are over different denominators —
 * which cannot happen, because an adjustment moves a question between right and wrong and
 * never into or out of the count, but a screen handed a pair it cannot state as one
 * fraction-over-one-total must say nothing rather than invent a second denominator (FR-37).
 *
 * It **does not** compare `correct` values. An adjustment that ended where it started — a
 * parent who set a mark and then set it back — still means a mark was touched, and the
 * server says so by sending a prior score at all. Dropping the sentence because the numbers
 * agree would be this browser second-guessing that.
 *
 * Nothing here divides, subtracts or computes a percentage: both counts and the denominator
 * are handed to the copy, which states them.
 */
export interface ScoreChange {
  before: number;
  after: number;
  /** The one total both fractions are over. */
  denominator: number;
}

export function scoreChangeOf(
  score: AttemptScore,
  originalScore: AttemptScore | null,
): ScoreChange | null {
  if (originalScore === null) return null;
  if (originalScore.denominator !== score.denominator) return null;
  return {
    before: originalScore.correct,
    after: score.correct,
    denominator: score.denominator,
  };
}

/**
 * What one dispute list entry has come to, as a closed set of two.
 *
 * `awaiting` and `resolved`, and there is no third. **There is deliberately no
 * `dismissed`**: the one remedy is the parent setting the mark, so a parent who reads a
 * dispute and agrees with the marking leaves it awaiting — and a third value would be an
 * outcome nobody recorded, which the next reader would go looking for a writer for.
 *
 * It is derived from `overriddenAt` and from nothing else, which is the same rule the API
 * derives it by: resolution is the adjustment, not a column beside it. Comparing
 * `recordedState` with `effectiveState` would answer `awaiting` for a parent who set a mark
 * and then set it back, which is a decision they demonstrably made.
 */
export type DisputeOutcome = 'awaiting' | 'resolved';

export function disputeOutcomeOf(entry: Pick<GradeDisputeView, 'overriddenAt'>): DisputeOutcome {
  return entry.overriddenAt === null ? 'awaiting' : 'resolved';
}

/**
 * The mark a parent would be offered instead of the one that counts.
 *
 * The flip, stated once: `Correct` becomes `Incorrect` and `Incorrect` becomes `Correct`.
 * `null` for the two states that are not judgements of an answer — an unanswered question
 * and one nothing has graded — which is what keeps the control unrendered on exactly the
 * rows the API would refuse with a 409. One predicate, read by the control a parent is
 * offered and by the refusal they would get.
 *
 * **Exhaustive, with no `default`.** A fifth grade state added to the enum has to be
 * decided deliberately: a `default` arm would answer `null` and quietly make a new
 * judgement unadjustable, which is the opposite of a compile error.
 */
export function flipOf(state: GradeState): GradeState | null {
  switch (state) {
    case 'Correct':
      return 'Incorrect';
    case 'Incorrect':
      return 'Correct';
    case 'Unanswered':
    case 'Ungraded':
      return null;
    default: {
      const unhandled: never = state;
      throw new Error(`No flip is defined for ${String(unhandled)}.`);
    }
  }
}

/**
 * The scope one retained `GradeOverride` slot is filed under.
 *
 * **The Attempt *and* the Question, joined here and nowhere else.** One run holds many
 * rows, so a scope of the Attempt alone would restore one Question's pick onto every row of
 * the paper — and a scope of the Question alone would carry a pick across two runs of the
 * same practice test, which present the same Question ids. Spelled once, so the write and
 * the read cannot key a slot differently and leave a parent's decision unfindable.
 */
export function overrideScope(attemptId: string, questionId: string): string {
  return `${attemptId}:${questionId}`;
}

/**
 * One retained slot read back into a picked mark, or `null` for one this row cannot use.
 *
 * A picked-but-unsaved mark is the work FR-35 keeps across an idle expiry: a parent who read
 * the reason, picked the other mark and was sent back through the PIN should not have to read
 * it again to remember what they had decided. The **reason itself is deliberately not
 * retained** — it is re-read from the run, because it is the server's prose and a copy in a
 * slot would be a second one to keep in step.
 *
 * `null` in four cases, each one a pick that must not be offered:
 * - a slot of another kind, or one filed under another scope;
 * - a `payload` that is not an object, or whose `state` is not one of the two adjustable
 *   marks — a slot is opaque JSON, and an unchecked field would land in a control as
 *   `undefined` and take the row with it;
 * - a pick for the mark that **already counts**, which the API would refuse with its own
 *   409: offering a save that cannot succeed is worse than offering nothing, and a slot
 *   saved before somebody else set the same mark is exactly how that state arises.
 */
export function retainedOverrideOf(
  slot: { kind: string; scope: string; payload: unknown },
  scope: string,
  /** The mark that counts on the row right now. */
  effectiveState: GradeState,
): GradeState | null {
  if (slot.kind !== 'GradeOverride' || slot.scope !== scope) return null;
  const payload = slot.payload as { state?: unknown } | null;
  if (payload === null || typeof payload !== 'object') return null;
  if (payload.state !== 'Correct' && payload.state !== 'Incorrect') return null;
  if (payload.state === effectiveState) return null;
  return payload.state;
}
