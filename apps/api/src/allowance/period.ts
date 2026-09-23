import { DEFAULT_TIMEZONE, isSupportedTimeZone } from '../common/timezone.js';
import { zoneInEffectAt, type TimezoneEntry } from '../identity/parent-account.service.js';

/**
 * One allowance period: the calendar month in the account's own zone, expressed
 * as UTC instants. `end` is exclusive and is also the reset instant.
 */
export interface PeriodWindow {
  start: Date;
  end: Date;
  /** The zone the window was actually computed in. */
  timezone: string;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Zone arithmetic uses the platform's `Intl` time-zone data — no stored offset
 * and no new runtime dependency. Formatters are not cheap to build, so the ones
 * we build get reused.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const built = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, built);
  return built;
}

/** The wall-clock reading of `instant` in `timeZone`. */
export function wallClockAt(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number(part?.value ?? '0');
  };
  // `en-US` renders midnight in an h23 cycle as hour 24 on some ICU builds.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** The zone's UTC offset, in milliseconds, at a given instant. */
function offsetAt(instant: Date, timeZone: string): number {
  const wall = wallClockAt(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Seconds resolution is enough: no zone in the IANA database has a sub-second
  // offset in any era this product computes a period for.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time in `timeZone`. The offset is
 * probed at the candidate instant and then re-probed at the corrected one, so a
 * boundary that falls on a DST switch resolves against the offset actually in
 * force there rather than a fixed one carried over from elsewhere in the month.
 */
function instantOfLocal(wall: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  let instant = asUtc - offsetAt(new Date(asUtc), timeZone);
  instant = asUtc - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
}

const MIDNIGHT = { day: 1, hour: 0, minute: 0, second: 0 } as const;

/**
 * The calendar-month window containing `instant`, in `timeZone`. Start and end
 * are each the local midnight of the first of a month, each resolved
 * independently, so a month spanning a DST switch drifts by nothing.
 */
export function monthWindowFor(instant: Date, requestedZone: string): PeriodWindow {
  // Defence in depth: a zone the platform does not recognise makes every `Intl`
  // call throw, which would turn one bad row into a permanent 500 on this
  // account. Writes reject such a zone; a read falls back instead of throwing.
  const timeZone = isSupportedTimeZone(requestedZone) ? requestedZone : DEFAULT_TIMEZONE;
  const { year, month } = wallClockAt(instant, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: instantOfLocal({ year, month, ...MIDNIGHT }, timeZone),
    end: instantOfLocal({ year: nextYear, month: nextMonth, ...MIDNIGHT }, timeZone),
    timezone: timeZone,
  };
}

/** Enough to settle any real history; the loop exits on the first fixpoint. */
const MAX_RESOLUTION_PASSES = 3;

/**
 * The window for `instant` against an effective-dated zone history (AD-27).
 *
 * The invariant is that **the window's own start decides the zone it was cut
 * in**, so a zone change taking effect mid-period cannot re-slice the running
 * period — it applies from the next boundary onward.
 *
 * Reaching that takes iteration, not a fixed two passes: recutting the window
 * in a new zone moves its start, and the moved start can fall on the other side
 * of yet another history entry, leaving a two-pass result whose zone and start
 * disagree. So the window is recut until it agrees with the zone its own start
 * resolves to, bounded by `MAX_RESOLUTION_PASSES` — each pass moves the start
 * by at most a zone offset, so a real history settles in one or two.
 */
export function resolveWindow(instant: Date, history: readonly TimezoneEntry[]): PeriodWindow {
  let zone = zoneInEffectAt(history, instant) ?? DEFAULT_TIMEZONE;
  let window = monthWindowFor(instant, zone);

  for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
    const fromStart = zoneInEffectAt(history, window.start) ?? DEFAULT_TIMEZONE;
    if (fromStart === zone) return window; // Fixpoint: start and zone agree.
    zone = fromStart;
    window = monthWindowFor(instant, zone);
  }
  return window;
}
