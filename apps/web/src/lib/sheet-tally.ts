/**
 * The sheet tally's one rule, as a pure function.
 *
 * Here rather than inside `SheetTally` for the reason every rule in this folder
 * is here: `apps/web` runs its unit tests without a DOM, so a rule reachable
 * only through a rendered `<li>` is a rule no test can state — and "which sheet
 * is the one being made" is an off-by-one waiting to happen.
 *
 * It decides nothing about drawing and holds no colour, no geometry and no
 * copy. It answers one question — what each requested sheet's state is — from
 * the job's own three figures.
 */

import type { GenerationJobView } from './parent-api';
import { isSettled } from './practice-test-count';

/**
 * One sheet's state.
 *
 * `notMade` rather than `failed` or `missed`: the sheet is not a job and did
 * not fail — the run it belonged to ended without it. The four are told apart
 * by shape as well as colour wherever they are drawn (UX-DR33).
 */
export type SheetState = 'ready' | 'making' | 'waiting' | 'notMade';

/**
 * One state per requested sheet, in order.
 *
 * `isSettled` is reused from the generation status rules rather than
 * re-listing the statuses, because this module and the progress sentence must
 * agree on when a job is over: `PartiallyComplete` settles it, and
 * `extraction-status.ts`'s predicate does not know that status at all.
 *
 * Settled means no sheet is still coming, so anything past `producedCount` is
 * `notMade` and never `waiting` — a dashed "still to come" sheet on a finished
 * job is a promise the job has already broken.
 *
 * The length is `requestedCount` and nothing else. A `producedCount` above the
 * request is a figure this browser cannot reconcile and must not grow the row
 * over; the caller renders nothing at all for an empty array.
 */
export function sheetStates({
  producedCount,
  requestedCount,
  status,
}: {
  producedCount: number;
  requestedCount: number;
  status: GenerationJobView['status'];
}): SheetState[] {
  // A figure that is not a figure is no sheets, never a row of them. An
  // infinite `requestedCount` would make `Array.from` throw a `RangeError` and
  // take the whole progress panel down with it, and a `NaN` `producedCount`
  // would lose both index comparisons — drawing a running job as every sheet
  // still to come, with no spinner anywhere on it.
  const total = Number.isFinite(requestedCount) ? Math.max(0, Math.floor(requestedCount)) : 0;
  const produced = Number.isFinite(producedCount)
    ? Math.min(total, Math.max(0, Math.floor(producedCount)))
    : 0;
  const settled = isSettled(status);
  return Array.from({ length: total }, (_unused, index): SheetState => {
    if (index < produced) return 'ready';
    if (settled) return 'notMade';
    // Exactly one sheet is being made at a time, and it is the next one.
    return index === produced ? 'making' : 'waiting';
  });
}
