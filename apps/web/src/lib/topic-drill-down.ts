/**
 * The drill-down's two rules, as pure functions.
 *
 * They live here rather than inside the screen for `practice-test-count.ts`'s reason:
 * `apps/web` runs its unit tests without a DOM, so a rule reachable only through a
 * rendered button is a rule no test can state — and "the cost is stated before the
 * control can fire, and the control is dead when nothing is left" is exactly the kind
 * of rule that has to be assertable. UX Q12c makes the cost block the guard on this
 * screen, so its arithmetic is unit-tested rather than inlined in JSX.
 *
 * **Not one product figure is here.** The limit, what has been used and the
 * per-request ceiling all arrive from the API; the "left after this" arithmetic is
 * `remainingAfter`'s and is not repeated. There is no plan name and no price.
 */

import { parentCopy } from '@/copy/parent';
import type { GenerationAllowanceView, TopicDrillDownView, WeightedTargetView } from './parent-api';
import { readableInstant } from './parent-view';
import { remainingAfter } from './practice-test-count';

/**
 * How many practice tests one press of this control makes.
 *
 * **Fixed at one, and exported rather than written into the arithmetic below** so the
 * cost block states this number because it is the number that will be spent. UX Q12c:
 * the control is one tap from the evidence with the topic already chosen, and a count
 * picker here would be the generate screen rebuilt on a dashboard.
 */
export const DRILL_DOWN_GENERATION_COUNT = 1;

/** What one press of the drill-down's control costs, and what it leaves. */
export interface DrillDownCost {
  /** How many practice tests it makes. Always `DRILL_DOWN_GENERATION_COUNT`. */
  count: number;
  /**
   * What is left before it, or `null` on an account with no limit.
   *
   * `null` rather than the API's `remaining` figure, which on an unlimited account is
   * the per-request ceiling: printing that as "3 left" would be a number a parent
   * could plan around and be wrong about.
   */
  remaining: number | null;
  /** What would be left after it, or `null` when there is no remainder to state. */
  after: number | null;
  /**
   * Whether the control may fire at all.
   *
   * Read off the API's `remaining`, which is what one request may actually ask for —
   * never off a comparison of the limit against what has been used, which would be
   * this app computing an allowance of its own.
   */
  spendable: boolean;
}

/**
 * The cost of one press, from the allowance alone.
 *
 * Every figure is the API's: the count is the constant above, the remainder is
 * `remainingAfter`'s — the only "left after this" arithmetic in this app — and
 * whether anything can be spent is the API's `remaining`. Nothing here reads a
 * limit against a usage itself, and there is no second clamp: the server clamps
 * independently of whatever this app sent, and the response to the request is the
 * only account of what was spent.
 */
export function costOf(allowance: GenerationAllowanceView): DrillDownCost {
  const count = DRILL_DOWN_GENERATION_COUNT;
  return {
    count,
    remaining: allowance.limit === null ? null : allowance.remaining,
    after: remainingAfter(count, allowance.limit, allowance.used),
    spendable: allowance.remaining >= count,
  };
}

/**
 * Whether this drill-down has anything to show at all.
 *
 * **One predicate over `mastery`, and not a count of the two lists.** A topic whose
 * whole window the student answered correctly has a figure worth reading and no rows
 * beneath it, and a screen that called that "nothing to show" would hide a perfect
 * result. The absent figure is the only emptiness there is — and it is the same
 * answer a foreign profile id and an unknown topic get, which this app deliberately
 * does not try to tell apart.
 */
export function hasEvidence(view: TopicDrillDownView): boolean {
  return view.mastery !== null;
}

/**
 * The ordinal a row carries when its stored question could not be read back.
 *
 * Exported rather than written as a literal at the one place that tests for it, so the
 * sentinel the API sets and the sentinel the row heading reads are the same number.
 * Zero is safe as a sentinel because the numbers a child is shown are 1-based, so no
 * real question can collide with it.
 */
export const UNIDENTIFIED_ORDINAL = 0;

/**
 * Which upload a weighted regeneration would come from, as one sentence.
 *
 * **Four sentences, because there are four states and none of them may be assembled
 * out of another's words.** The subject can be absent — an upload whose classification
 * no longer resolves — and the instant can be unreadable independently of it, so all
 * four combinations exist. Written inline in the screen, the both-absent case dropped a
 * stand-in phrase into the slot a date belongs in and rendered "From the upload of From
 * a finished practice test"; as a named function each branch is a case a test states.
 *
 * Here rather than in the component for this module's whole reason: `apps/web` runs its
 * unit tests without a DOM, so a branch reachable only through rendered JSX is a branch
 * no test can name.
 */
export function targetSentence(
  target: Pick<WeightedTargetView, 'subjectName' | 'submittedAt'>,
): string {
  // Through `readableInstant`, so no parent screen renders the words "Invalid Date".
  const when = target.submittedAt === null ? null : readableInstant(target.submittedAt);
  if (target.subjectName === null) {
    return when === null
      ? parentCopy.topicDrillDown.generateFromUnknown
      : parentCopy.topicDrillDown.generateFromUnknownSubject(when);
  }
  return when === null
    ? parentCopy.topicDrillDown.generateFromUndated(target.subjectName)
    : parentCopy.topicDrillDown.generateFrom(target.subjectName, when);
}
