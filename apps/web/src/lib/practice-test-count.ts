/**
 * The generate step's rules, as pure functions.
 *
 * They live here rather than inside the screen for the same reason
 * `extraction-status.ts`'s do: `apps/web` runs its unit tests without a DOM, so
 * a rule reachable only through a rendered radio button is a rule no test can
 * state — and "the count above the remaining allowance is disabled, with the
 * reason stated, and never removed from the list" is exactly the kind of rule
 * that has to be assertable.
 *
 * Not one product figure is here. The per-request ceiling and the remaining
 * allowance both arrive from the API; this module only decides what the screen
 * does with them.
 */

import type { GenerationJobView } from './parent-api';

/**
 * How often the job is re-read while it is still going.
 *
 * A poll rather than a held connection because the job deliberately outlives
 * the request that enqueued it (AD-5).
 */
export const GENERATION_POLL_MS = 1_500;

/** One count a parent may pick, and whether this account can afford it. */
export interface CountOption {
  count: number;
  available: boolean;
}

/**
 * Every count from one to the per-request ceiling, each marked available or
 * not.
 *
 * Every count is always in the list. A count above what remains is rendered
 * disabled with the reason stated beside it, never trimmed away: a list that
 * silently shrinks tells a parent that five was never offered, rather than that
 * five costs more than they have left.
 *
 * `maxPerRequest` is a parameter rather than a constant here because the figure
 * is the API's, and a second copy of it in the browser is a second figure to
 * recalibrate.
 */
export function countOptions(remaining: number, maxPerRequest: number): CountOption[] {
  const ceiling = Math.max(0, Math.floor(maxPerRequest));
  return Array.from({ length: ceiling }, (_unused, index) => ({
    count: index + 1,
    available: index + 1 <= remaining,
  }));
}

/**
 * The count the screen starts on, or `null` when nothing is affordable.
 *
 * The largest affordable count, because that is what a parent who can afford
 * anything is most likely to want and it makes the cost sentence state a real
 * figure immediately rather than a placeholder.
 */
export function defaultCount(remaining: number, maxPerRequest: number): number | null {
  const affordable = countOptions(remaining, maxPerRequest).filter((option) => option.available);
  return affordable.length === 0 ? null : affordable[affordable.length - 1]!.count;
}

/**
 * Whether the job has finished, whichever way — the one condition polling stops
 * on.
 *
 * `PartiallyComplete` settles it: the job is over, some drafts landed and were
 * charged, and continuing to poll a row that will never move again is a request
 * issued forever.
 */
export function isSettled(status: GenerationJobView['status']): boolean {
  return status === 'Succeeded' || status === 'PartiallyComplete' || status === 'Failed';
}

/**
 * What is left after a request of `count`, or `null` on an unlimited tier.
 *
 * `null` rather than a number, because an unlimited account has no remainder to
 * state and inventing one — "five will be left" — would be a figure a parent
 * could reasonably plan around and be wrong about.
 */
export function remainingAfter(count: number, limit: number | null, used: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - used - count);
}
