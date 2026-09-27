'use client';

import { ParentApiError } from '@/lib/parent-api';

/**
 * The three rules every screen inside Parent View shares.
 *
 * They were the Students screen's, and stayed inside it while it was the only
 * one. A second parent-scoped screen makes them shared, and a shared rule with
 * two copies is a rule that has already started to drift — so they live here
 * and the screens import them. `students/page.tsx` re-exports them, because its
 * spec has always addressed them there.
 */

/**
 * Whether a failure means the parent has to cross the PIN again, as opposed to
 * something transient they should be able to retry from where they stand.
 *
 * Only the elevation guard's own refusal ends Parent View. A 500, a 429, or a
 * 400 is a fault to show with a Retry, not a reason to throw away a token that
 * is still perfectly good.
 */
export function endsParentView(cause: unknown): boolean {
  return cause instanceof ParentApiError && (cause.notElevated || cause.status === 401);
}

/**
 * The staleness guard: a response is applied only while it is still the most
 * recent request. Without it a superseded in-flight read — outlived by Retry,
 * or by the parent switching to another child — could resolve after the fact
 * and overwrite fresher state.
 */
export function applyIfCurrent<T>(
  current: { readonly value: number },
  issued: number,
  apply: (value: T) => void,
): (value: T) => void {
  return (value: T) => {
    if (current.value !== issued) return;
    apply(value);
  };
}

/**
 * A stored instant, in the device's own formatting — or `null` when it is not an
 * instant at all.
 *
 * Every parent screen states a stored instant by handing it to `Date` and then to
 * `toLocaleString`, and `Date` answers an unparsable string with `Invalid Date`, whose
 * `toLocaleString` is the literal words **"Invalid Date"**. Those words on a parent's
 * screen are worse than no date: they read as a fault in the thing being described
 * rather than in the string, and a screen reader says them.
 *
 * So the parse is checked here, once, and the caller chooses a sentence: the dated one
 * for a real instant, an undated one for `null`. Which keeps "there is no date to show"
 * a copy decision rather than a rendering accident.
 *
 * It is deliberately **not** a guard on the value's presence. Whether a flag exists is
 * decided elsewhere, on the field being present, and an unreadable instant is still a
 * flag that was raised — it is only the *date* that cannot be stated.
 */
export function readableInstant(value: string): string | null {
  const instant = new Date(value);
  // `NaN` is the only thing an unparsable date produces, and it is not equal to itself,
  // which is why this is a `Number.isNaN` and never a comparison.
  if (Number.isNaN(instant.getTime())) return null;
  return instant.toLocaleString();
}

/** What the live region holds: the sentence, and which announcement it is. */
export interface Announcement {
  text: string;
  /** Bumped per announcement, so a repeat is still a change. */
  seq: number;
}

export const NOTHING_ANNOUNCED: Announcement = { text: '', seq: 0 };

/**
 * The live region's content.
 *
 * A screen reader announces a polite region when its text *changes*, so
 * archiving, restoring and archiving again — three actions, two distinct
 * sentences — would announce only twice. Alternating an invisible zero-width
 * space makes every announcement a change, while leaving the sentence a sighted
 * reader sees, and a test asserts on, exactly as written.
 */
export function announcedText(announcement: Announcement): string {
  if (announcement.text === '') return '';
  // The escape, never a literal: an invisible character is unreviewable in a
  // diff, and a whitespace-stripping pass would silently delete it and break
  // repeat announcements without failing anything.
  return announcement.seq % 2 === 0 ? announcement.text : `${announcement.text}\u200B`;
}
