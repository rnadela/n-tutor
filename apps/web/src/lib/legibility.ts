/**
 * The legibility rules, as pure functions.
 *
 * They live here rather than inside the capture screen for the reason
 * `classification.ts` does: `apps/web` runs its unit tests without a DOM, so a
 * rule reachable only through a rendered badge is a rule no test can state.
 *
 * Every one of them mirrors the server and only mirrors it. The server decides
 * each page's verdict, the server refuses an unchecked submission whatever the
 * browser did, and nothing here computes a verdict or a threshold of its own
 * beyond restating which verdict is the failing one.
 */

import type { PageImageView } from './parent-api';

/** As much of a Source Test as the check rules actually read. */
export interface Checkable {
  legibilityCheckedAt: string | null;
}

/** As much of a page as the verdict rules actually read. */
export interface PageVerdict {
  ordinal: number;
  legibility: PageImageView['legibility'];
}

/**
 * Whether the one batch check has run over the page set as it stands.
 *
 * The whole of the third submit gate, and it reads no verdict: the server
 * accepts a commit over a flagged page, so a rule here that did otherwise
 * would disable a control the server would have honoured.
 */
export function isChecked(view: Checkable): boolean {
  return view.legibilityCheckedAt !== null;
}

/**
 * Whether one page's stored verdict is a readable one.
 *
 * `Low` is the only failing verdict — the same threshold the server states —
 * and an unchecked page reads as readable rather than flagged, because nothing
 * has judged it yet. `isChecked` is the rule that cares about that.
 */
export function isPageReadable(page: PageVerdict): boolean {
  return page.legibility !== 'Low';
}

/**
 * The ordinals the check flagged, in page order.
 *
 * Ordinals rather than pages, because every control the result offers names an
 * ordinal: the flag sentence, the badge's accessible name and the per-page
 * retake all say which page they are about.
 */
export function unreadablePages(pages: readonly PageVerdict[]): number[] {
  return pages.filter((page) => !isPageReadable(page)).map((page) => page.ordinal);
}

/**
 * Which requirement the commit is refused for. Three of them now, and the
 * order is the order the screen states them in.
 *
 * Re-exported from `classification.ts` rather than defined twice: one function
 * decides why the submit is refused, and one type says what the answers are.
 */
export type { SubmitBlocker } from './classification';
