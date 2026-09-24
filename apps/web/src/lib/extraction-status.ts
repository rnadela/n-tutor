/**
 * The Generate step's rules, as pure functions.
 *
 * They live here rather than inside the capture screen for the same reason
 * `page-order.ts` does: `apps/web` runs its unit tests without a DOM, so a rule
 * reachable only through a rendered control is a rule no test can state.
 *
 * Not one product figure is here either. Whether an Extraction is *thin* is the
 * API's single server-side rule, read off the status body as `thin`; this
 * module only decides what the screen does with the answer.
 */

import type { ExtractionStatusView } from './parent-api';

/**
 * How often the status is re-read while the job is still going.
 *
 * A poll rather than a held connection because the job deliberately outlives
 * the request that enqueued it (AD-3).
 */
export const EXTRACTION_POLL_MS = 1_500;

/** Whether the job has finished, either way — the one condition polling stops on. */
export function isSettled(status: ExtractionStatusView['status']): boolean {
  return status === 'Succeeded' || status === 'Failed';
}

/**
 * Whether proceeding toward generation must be gated by the warning.
 *
 * Written as an explicit `thin === true` against a succeeded job rather than as
 * a truthiness test, because the third value is the one that matters: `null`
 * means there is no verdict yet, and an unfinished job must neither warn nor be
 * treated as healthy.
 *
 * It gates a *warning*, never the proceed itself: the parent may always
 * continue, and this only decides whether they read the counts first.
 */
export function warningNeeded(view: ExtractionStatusView | null): boolean {
  if (view === null) return false;
  return view.status === 'Succeeded' && view.thin === true;
}
