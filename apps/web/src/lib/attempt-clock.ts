/**
 * The countdown, as a rule rather than as a render.
 *
 * The browser may hold the child's answers; it may never hold the clock. Nothing
 * here decides expiry — the server does that at submit, against its own column —
 * and nothing here counts its own ticks. Every figure is computed from the two
 * instants the server stated and the wall clock, so a backgrounded tab, a slept
 * device and a throttled timer all come back to a countdown that has fallen by
 * exactly as much time as passed.
 *
 * Pure, and framework-free: `apps/web` runs its unit tests with no DOM, and "the
 * clock never pauses and warns exactly three times" has to be assertable by
 * advancing a number rather than by sleeping a device.
 */

/**
 * The instants a countdown is computed from.
 *
 * `serverNow` and `syncedAt` are the two halves of one offset: the server's clock
 * when it answered, and this browser's clock when the answer arrived. The
 * difference is applied to every later reading, so a device running ten minutes
 * fast shifts only what is *displayed* and never what is decided.
 */
export interface ClockInstants {
  /** The server's deadline, or null for an untimed Attempt. */
  expiresAt: number | null;
  /** The server's clock at the moment it answered the start call. */
  serverNow: number;
  /** This browser's clock at that same moment. */
  syncedAt: number;
  /** This browser's clock now. */
  now: number;
}

/**
 * How much time is left, in milliseconds, or `null` for an untimed Attempt.
 *
 * Clamped at zero and never negative: "past the deadline" is one state, and a
 * negative figure would render as a countdown running backwards into a second
 * minute.
 *
 * The offset is what makes this the server's clock rather than the browser's:
 *
 *     offset    = serverNow - syncedAt
 *     remaining = max(0, expiresAt - (now + offset))
 *
 * `performance.now()` was rejected for the `now` this takes. It counts the page's
 * life, not the wall clock, so a device that slept for ten minutes would come back
 * with ten minutes it never had.
 */
export function remainingMs({ expiresAt, serverNow, syncedAt, now }: ClockInstants): number | null {
  if (expiresAt === null) return null;
  // Every one of the four, `now` included. A `Date.parse` of something unexpected
  // yields `NaN`, and a `NaN` here does not clamp: `Math.max(0, NaN)` is `NaN`, which
  // renders as `NaN:NaN` and never reaches zero — so the countdown neither counts nor
  // ever expires. `null` is the state the screen already renders (an untimed
  // Attempt): no clock, and no deadline to reach.
  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(serverNow) ||
    !Number.isFinite(syncedAt) ||
    !Number.isFinite(now)
  ) {
    return null;
  }
  const offset = serverNow - syncedAt;
  return Math.max(0, expiresAt - (now + offset));
}

/**
 * The three points at which the child is told, in descending order.
 *
 * Three and no more, and the treatment at each is identical: nothing escalates,
 * because a countdown that got louder as it ran out would be pressure rather than
 * information. Milliseconds, so nothing downstream converts a unit twice.
 */
export const WARNING_THRESHOLDS_MS = [300_000, 60_000, 20_000] as const;

/**
 * How long one warning stays on screen before it goes again.
 *
 * A warning is an **event**, not a state, and this is what makes it one. A sentence
 * that stayed mounted after its moment would sit inside a live region between
 * thresholds — which the intent forbids ("`aria-live` off in steady state") — and at
 * zero the screen would state that the time is up and that twenty seconds remain in
 * the same breath.
 *
 * Shorter than the smallest threshold on purpose: at 20 seconds remaining the
 * warning must have cleared itself before the countdown reaches zero, or the two
 * statements overlap again. Ten seconds is comfortably inside that and is long
 * enough to read a short sentence.
 */
export const WARNING_VISIBLE_MS = 10_000;

/**
 * The threshold just crossed, or `null`.
 *
 * A crossing, not a comparison: a threshold fires on the render that went from
 * above it to at-or-below it and on no later one, which is what makes "each
 * threshold produces one announcement and nothing announces between them" a
 * property of this function instead of a flag somebody remembers to unset.
 *
 * `previousMs` is `null` on the first reading, which therefore crosses nothing: a
 * child opening a test with four minutes on the clock is not told that five
 * minutes remain.
 *
 * When one step crosses more than one threshold — a device that slept through both
 * — the **smallest** crossed threshold is returned. It is the one that describes
 * where the child actually is; announcing the largest would tell them five minutes
 * remain when twenty seconds do.
 */
export function warningFor(previousMs: number | null, remaining: number | null): number | null {
  if (remaining === null || previousMs === null) return null;
  let crossed: number | null = null;
  for (const threshold of WARNING_THRESHOLDS_MS) {
    if (previousMs > threshold && remaining <= threshold) crossed = threshold;
  }
  return crossed;
}

/** The countdown in both forms: the one on screen, and the one read aloud. */
export interface RemainingText {
  /** `m:ss`. Figures only — the unit is the `role="timer"` label's job. */
  display: string;
  /** The same figure in words, carrying its units, for the accessible name. */
  spoken: string;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * The remaining time as a child reads it and as a screen reader says it.
 *
 * Two forms because they answer different needs and must not be the same string.
 * The display is `m:ss`, which is what a clock looks like and is unreadable spoken;
 * the spoken form carries its units and would be noise on screen beside a figure
 * that ticks. Seconds round **up** while any part of one remains, so a countdown
 * never shows `0:00` with time still on it.
 */
export function formatRemaining(ms: number): RemainingText {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const display = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const spoken =
    minutes === 0
      ? plural(seconds, 'second')
      : seconds === 0
        ? plural(minutes, 'minute')
        : `${plural(minutes, 'minute')} and ${plural(seconds, 'second')}`;
  return { display, spoken };
}

/**
 * How often the screen re-reads the wall clock.
 *
 * A re-read, never a tick it counts: the interval only decides how *stale* the
 * displayed figure may be, and every reading is computed from `Date.now()` against
 * the server's instants. A browser that throttled this to once a minute in a
 * background tab therefore shows a correct figure on the next reading rather than
 * a countdown that lost the minutes it was asleep.
 */
export const CLOCK_TICK_MS = 1000;
