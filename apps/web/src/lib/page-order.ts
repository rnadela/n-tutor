/**
 * The page-strip rules, as pure functions.
 *
 * They live here rather than inside the capture screen because `apps/web` runs
 * its unit tests without a DOM: a rule reachable only through a rendered
 * control's `disabled` attribute is a rule no test can state. The screen reads
 * them; it never restates them.
 *
 * Not one figure is stated here either. The page ceiling is the API's — it
 * comes back on every Source Test read as `maxPages` — so `canAddPage` takes it
 * as an argument rather than closing over a `10` the web app would then own a
 * second copy of.
 */

/** Which way a move goes. Two values, so no string comparison is open-ended. */
export type MoveDirection = 'up' | 'down';

/**
 * The order after moving one page one place, or the same order when the move
 * has nowhere to go.
 *
 * A no-op at the ends rather than a wrap-around or a throw: the first page's
 * move-up control is disabled, and a request the screen never issues must not
 * become a silent reordering if it somehow is. An id that is not in the list is
 * the same no-op, for the same reason.
 *
 * The input array is never mutated — the caller holds the order that is
 * currently on screen, and a move that is about to be rejected by the server
 * must leave it exactly as it was.
 */
export function movedOrder(ids: readonly string[], id: string, direction: MoveDirection): string[] {
  const index = ids.indexOf(id);
  if (index === -1) return [...ids];
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  next[index] = ids[target]!;
  next[target] = ids[index]!;
  return next;
}

/** Whether the page at this index can move up at all — the first one cannot. */
export function canMoveUp(index: number): boolean {
  return index > 0;
}

/** And its mirror: the last page cannot move down. */
export function canMoveDown(index: number, count: number): boolean {
  return index < count - 1;
}

/**
 * Whether the submit control is offered.
 *
 * The client mirror of the server's refusal, and deliberately only a mirror: a
 * disabled button is a courtesy, and the server refuses a zero-page submission
 * whatever the browser did.
 */
export function canSubmitPages(count: number): boolean {
  return count >= 1;
}

/** Whether another page may be added, against the ceiling the API states. */
export function canAddPage(count: number, maxPages: number): boolean {
  return count < maxPages;
}
