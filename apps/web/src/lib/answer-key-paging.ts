/**
 * The arithmetic of showing one answer-key Question at a time, as pure functions.
 *
 * **Pure and DOM-free on purpose.** `apps/web` runs its unit tests with
 * `environment: 'node'`, so the rules a paged answer key actually turns on — what a
 * junk `?q=` resolves to, where Previous and Next stop, and which key presses are a
 * page turn at all — are asserted here directly rather than inferred from a screen
 * that cannot be mounted. Nothing in this module reads a URL, a router or an event
 * object: the callers hand in the parts, which is also what makes "ArrowRight inside a
 * textarea moves the caret" a case a test can state in one line.
 *
 * **Ordinals, never array positions.** Every function here is about the *stored*
 * ordinal — the number the child was shown while they worked — because that is the only
 * unit the URL can carry and the only one that means the same thing to a reader, to a
 * deep link from a Grade dispute, and to the row's own heading. A position in the array
 * is a fact about one response's shape: it coincides with the ordinal only while the key
 * is complete and unfiltered, and nothing in the type says it is.
 *
 * `AnswerKeyRowView` is shared with the analytics drill-down, whose own view
 * (`apps/api/src/analytics/analytics-view.ts`) writes `ordinal: 0` for a row whose stored
 * Question it could no longer read. The paged surfaces are fed by
 * `apps/api/src/grading/grading-results.ts`, which emits the stored ordinal of every
 * presented Question — so in practice they arrive `1..n`. The *type* permits neither
 * claim, which is why nothing here assumes the ordinals are dense, ordered or even
 * distinct, and why the pager resolves the Question on screen to a single index rather
 * than to every row that shares its number.
 */

import type { Route } from 'next';

/**
 * The query parameter the shown Question rides in.
 *
 * **One definition for four files.** Two screens read it, and the Grade disputes and
 * Explanation flags lists write it onto their links. A literal in each would be four
 * places for the name to drift, and the drift would be silent: a link naming `question`
 * against a screen reading `q` opens on the first Question and looks like a clamp.
 */
export const QUESTION_PARAM = 'q';

/**
 * The link from a Grade dispute or an Explanation flag entry to its Attempt, carrying
 * `?q=` when the entry's Question is known.
 *
 * **One definition for four files**, the thing this module's own header promises: the
 * Grade disputes and Explanation flags lists both write this link, and a copy in each
 * is two places for `QUESTION_PARAM`'s name to drift from the one the Attempt screens
 * read. `questionOrdinal === null` omits the parameter rather than writing `?q=`,
 * which is a link into nothing rather than one Attempt detail already clamps for.
 */
export function attemptHref(
  attemptId: string,
  questionOrdinal: number | null,
): Route<`/parent/attempts/${string}`> {
  return questionOrdinal === null
    ? `/parent/attempts/${attemptId}`
    : `/parent/attempts/${attemptId}?${QUESTION_PARAM}=${questionOrdinal}`;
}

/**
 * Which Question a `?q=` names, clamped to one that actually exists.
 *
 * Missing, empty, non-numeric, fractional, zero, negative and out-of-range all resolve
 * to the **first** ordinal in the list, silently. A results screen is read after the
 * work is in: there is nothing a child or a parent could do about a malformed address
 * bar, and an alert about one would be the screen complaining about itself. So the
 * clamp is the whole error handling, and the caller writes the resolved figure back
 * over the bad one.
 *
 * `0` for an empty list, which is the degenerate "there are no rows" case the caller
 * guards before it writes anything.
 */
export function ordinalFromQuery(raw: string | null, ordinals: readonly number[]): number {
  const first = ordinals[0] ?? 0;
  if (raw === null) return first;
  const trimmed = raw.trim();
  // A digits-only test rather than `Number()`: `Number('')` is 0, `Number(' 7 ')` is 7
  // and `Number('7px')` is NaN — three different kinds of wrong from one coercion.
  if (!/^\d+$/u.test(trimmed)) return first;
  const asked = Number(trimmed);
  return ordinals.includes(asked) ? asked : first;
}

/**
 * The ordinal one step away, or `null` at each end.
 *
 * `null` rather than a clamp to the same ordinal, because the two ends are the one
 * thing Previous and Next have to *say*: a control that stayed enabled and did
 * nothing is a control that lies about there being more paper. The caller disables on
 * `null` and an arrow key ignores it.
 *
 * `null` too for a `current` that is not in the list at all — a caller mid-clamp —
 * because stepping from nowhere has no answer.
 */
export function stepOrdinal(
  ordinals: readonly number[],
  current: number,
  delta: number,
): number | null {
  const at = ordinals.indexOf(current);
  if (at < 0) return null;
  const next = at + delta;
  if (next < 0 || next >= ordinals.length) return null;
  return ordinals[next] ?? null;
}

/**
 * The parts of a keyboard event this decision needs, handed in rather than read.
 *
 * A shape instead of a `KeyboardEvent` so the rule is assertable without a DOM, and
 * so the one thing that is easy to get wrong — *what the press was aimed at* — is an
 * explicit argument rather than a chain of optional property reads inside a listener.
 */
export interface PagingKeyPress {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** `event.target`'s tag name, in any case. The empty string for no target at all. */
  targetTag: string;
  targetIsContentEditable: boolean;
  /**
   * The ARIA `role` the press landed inside — the target's own, or the nearest
   * ancestor's that has one. The empty string for a press inside nothing with a role.
   *
   * Needed because a composite widget built out of `div`s and `li`s is invisible to a
   * tag-name check: a MUI Select's open menu is a `ul role="listbox"` of
   * `li role="option"`, and an arrow key there is the widget's own way of moving
   * through it. Without this, one press would move the highlighted option **and** turn
   * the paper behind it.
   */
  targetRole: string;
}

/** Where typing happens. An arrow key in any of these belongs to the caret. */
const TEXT_ENTRY = new Set(['input', 'textarea', 'select']);

/**
 * Roles whose own keyboard interaction is the arrow keys.
 *
 * Every one of these is a widget an arrow key *does something inside*, and none of them
 * is reliably a native element: they are the roles a composite control is assembled from
 * on a `div`, a `ul` or an `li`, where `targetTag` says nothing at all. Listed rather
 * than inferred, because the alternative is a page that turns underneath whichever
 * widget a later story drops onto this screen.
 */
const WIDGET_ROLES = new Set([
  'combobox',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'slider',
  'spinbutton',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treeitem',
]);

/** What a dialog claiming the screen is marked with. MUI's own Dialog renders this pair. */
export const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';

/**
 * What the rest of the app is marked with while something else has the screen.
 *
 * A modal takes the page away from everything behind it, and both of these are how that
 * is said in markup — `aria-hidden` is what MUI puts on the other roots when a Dialog
 * opens, and `inert` is the platform's own version of the same claim.
 */
export const CLAIMED_SELECTOR = '[aria-hidden="true"],[inert]';

/**
 * Whether something modal has the screen, as judged **from where the press landed**.
 *
 * **Not a document-wide "is any modal open?".** That was the first shape of this rule and
 * it was wrong here: Parent View's sidebar is a permanently mounted MUI `Drawer`, whose
 * paper carries `role="dialog" aria-modal="true"` all the time, as page furniture. A
 * global query therefore reads as "a modal is always open" on every parent screen, and
 * arrow-key paging would be dead on the whole surface — which is exactly what
 * `parent-attempt-paging.spec.ts` caught.
 *
 * So the question is asked about the press instead, and it has two halves:
 *
 * - **Did the press land inside a dialog?** A dialog that is really up traps focus, so
 *   the press is delivered inside it. That covers the grade-override confirmation, the
 *   hand-in confirmation, the PIN prompt and the map's own overlay — including dialogs
 *   this component has never heard of. It also, correctly, leaves the arrow keys alone
 *   for a press aimed at the sidebar's own navigation.
 * - **Is what the press landed on hidden from the reader?** `aria-hidden` or `inert` over
 *   the paper means something else has claimed the screen, so the paper must not move
 *   underneath it — which covers an overlay that does not trap focus at all.
 *
 * Takes the element rather than reaching for `document`, so the rule stays in this module
 * and stays assertable without a DOM.
 */
export function modalHasTheScreen(target: { closest(selectors: string): unknown } | null): boolean {
  if (target === null) return false;
  return target.closest(MODAL_SELECTOR) !== null || target.closest(CLAIMED_SELECTOR) !== null;
}

/**
 * Whether a key press is a page turn, and which way: `-1`, `1`, or `null` for not one.
 *
 * Five refusals, and each is a real screen:
 *
 * - **An open overlay map, or anything else modal.** The map's cells are the way to a
 *   Question while it is up, and a page turning behind a dialog would move the thing the
 *   reader has to answer first. `overlayOpen` is the map's own path — the pager knows when
 *   it opened it — and `modalHasTheScreen` above is how the caller covers every other
 *   dialog on the screen, including ones this module has never heard of.
 * - **Any held Alt, Ctrl, Meta or Shift.** Those are the browser's and the operating
 *   system's — history, word jumps, selection — and stealing one is worse than not
 *   offering the shortcut at all.
 * - **A press aimed at an `input`, `textarea`, `select` or contenteditable region.**
 *   A parent part-way through typing a reason for an adjustment must not lose the
 *   caret, and the panels this pages past are full of text entry.
 * - **A press inside a widget whose own interaction is the arrow keys** — a listbox, a
 *   menu, a radio group, a slider. None of those is reliably a native tag, so the role
 *   is what catches them.
 * - **Anything that is not an arrow.** No other key pages, so nothing a reader presses
 *   by habit moves the paper.
 */
export function shouldPageOnKey(press: PagingKeyPress, overlayOpen: boolean): -1 | 1 | null {
  if (overlayOpen) return null;
  if (press.altKey || press.ctrlKey || press.metaKey || press.shiftKey) return null;
  if (press.targetIsContentEditable) return null;
  if (TEXT_ENTRY.has(press.targetTag.toLowerCase())) return null;
  if (WIDGET_ROLES.has(press.targetRole.toLowerCase())) return null;
  if (press.key === 'ArrowLeft') return -1;
  if (press.key === 'ArrowRight') return 1;
  return null;
}
