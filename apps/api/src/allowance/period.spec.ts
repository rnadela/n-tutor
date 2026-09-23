import { describe, expect, it } from 'vitest';
import { zoneInEffectAt, type TimezoneEntry } from '../identity/parent-account.service.js';
import { monthWindowFor, resolveWindow, wallClockAt } from './period.js';

/** The local wall clock as `YYYY-MM-DDTHH:mm:ss`, to assert on a boundary. */
function localOf(instant: Date, zone: string): string {
  const w = wallClockAt(instant, zone);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

describe('month window', () => {
  it('cuts the calendar month in the account zone, expressed as UTC instants', () => {
    // Manila is UTC+8 with no DST, so local midnight on the 1st is 16:00 UTC
    // on the last day of the previous month.
    const window = monthWindowFor(new Date('2026-09-23T04:15:00.000Z'), 'Asia/Manila');

    expect(window.timezone).toBe('Asia/Manila');
    expect(window.start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(localOf(window.start, 'Asia/Manila')).toBe('2026-09-01T00:00:00');
    expect(localOf(window.end, 'Asia/Manila')).toBe('2026-10-01T00:00:00');
  });

  it('rolls December into the following January', () => {
    const window = monthWindowFor(new Date('2026-12-20T00:00:00.000Z'), 'UTC');
    expect(window.start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('resolves each boundary of a DST-spanning month independently', () => {
    // US DST ends 2026-11-01: New York is UTC-4 at the month start and UTC-5 at
    // the month end. A fixed-offset computation would drift by an hour.
    const window = monthWindowFor(new Date('2026-10-15T12:00:00.000Z'), 'America/New_York');

    expect(window.start.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(localOf(window.start, 'America/New_York')).toBe('2026-10-01T00:00:00');
    expect(localOf(window.end, 'America/New_York')).toBe('2026-11-01T00:00:00');

    // And the month that opens on the far side of the switch.
    const after = monthWindowFor(new Date('2026-11-15T12:00:00.000Z'), 'America/New_York');
    expect(after.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(after.end.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(localOf(after.end, 'America/New_York')).toBe('2026-12-01T00:00:00');
  });

  it('never assumes a fixed offset for a southern-hemisphere DST month', () => {
    // Auckland switches to NZDT on 2026-09-27; the September window opens in
    // NZST (+12) and closes in NZDT (+13).
    const window = monthWindowFor(new Date('2026-09-10T00:00:00.000Z'), 'Pacific/Auckland');
    expect(localOf(window.start, 'Pacific/Auckland')).toBe('2026-09-01T00:00:00');
    expect(localOf(window.end, 'Pacific/Auckland')).toBe('2026-10-01T00:00:00');
    expect(window.end.getTime() - window.start.getTime()).not.toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('window resolution against a timezone history', () => {
  const history = (entries: [string, string][]): TimezoneEntry[] =>
    entries.map(([timezone, effectiveFrom]) => ({
      timezone,
      effectiveFrom: new Date(effectiveFrom),
    }));

  it('falls back to UTC for a zone this platform does not recognise', () => {
    // Defence in depth for a row that got in before validation existed: a read
    // must degrade to UTC, never throw a RangeError out of the request.
    expect(() =>
      monthWindowFor(new Date('2026-09-23T04:15:00.000Z'), 'Mars/Olympus'),
    ).not.toThrow();
    expect(monthWindowFor(new Date('2026-09-23T04:15:00.000Z'), 'Mars/Olympus')).toMatchObject({
      timezone: 'UTC',
    });

    const window = resolveWindow(
      new Date('2026-09-23T04:15:00.000Z'),
      history([['Mars/Olympus', '2026-01-01T00:00:00.000Z']]),
    );
    expect(window.timezone).toBe('UTC');
    expect(window.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('skips an unrecognised entry in favour of a usable earlier one', () => {
    const window = resolveWindow(
      new Date('2026-09-23T04:15:00.000Z'),
      history([
        ['Asia/Manila', '2026-01-01T00:00:00.000Z'],
        ['Not/AZone', '2026-02-01T00:00:00.000Z'],
      ]),
    );
    expect(window.timezone).toBe('Asia/Manila');
  });

  it('breaks a tie on effectiveFrom deterministically, whatever the row order', () => {
    const at = new Date('2026-09-23T04:15:00.000Z');
    const tied: [string, string][] = [
      ['UTC', '2026-01-01T00:00:00.000Z'],
      ['Asia/Manila', '2026-05-01T00:00:00.000Z'],
      ['America/New_York', '2026-05-01T00:00:00.000Z'],
    ];
    const forward = zoneInEffectAt(history(tied), at);
    const reversed = zoneInEffectAt(history([...tied].reverse()), at);

    expect(forward).toBe(reversed);
    // Same instant: the higher zone name wins, so the answer is stable.
    expect(forward).toBe('Asia/Manila');
  });

  it('falls back to UTC when the account has no timezone entry', () => {
    const window = resolveWindow(new Date('2026-09-23T04:15:00.000Z'), []);
    expect(window.timezone).toBe('UTC');
    expect(window.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('falls back to UTC when every entry is still in the future', () => {
    const window = resolveWindow(
      new Date('2026-09-23T04:15:00.000Z'),
      history([['Pacific/Auckland', '2027-01-01T00:00:00.000Z']]),
    );
    expect(window.timezone).toBe('UTC');
  });

  it('uses the zone in effect at the period start, not the one in effect now', () => {
    // UTC from account creation, Auckland effective mid-period: the running
    // period must still be the UTC one.
    const entries = history([
      ['UTC', '2026-01-01T00:00:00.000Z'],
      ['Pacific/Auckland', '2026-09-23T00:00:00.000Z'],
    ]);

    const current = resolveWindow(new Date('2026-09-23T04:15:00.000Z'), entries);
    expect(current.timezone).toBe('UTC');
    expect(current.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(current.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');

    // The next period opens after the boundary and does use Auckland.
    const next = resolveWindow(new Date('2026-10-05T00:00:00.000Z'), entries);
    expect(next.timezone).toBe('Pacific/Auckland');
    expect(localOf(next.start, 'Pacific/Auckland')).toBe('2026-10-01T00:00:00');
  });

  it('never shortens or re-slices the running period when the zone changes', () => {
    const before = resolveWindow(
      new Date('2026-09-10T00:00:00.000Z'),
      history([['UTC', '2026-01-01T00:00:00.000Z']]),
    );
    const after = resolveWindow(
      new Date('2026-09-24T00:00:00.000Z'),
      history([
        ['UTC', '2026-01-01T00:00:00.000Z'],
        ['Asia/Manila', '2026-09-23T00:00:00.000Z'],
      ]),
    );

    expect(after.start.toISOString()).toBe(before.start.toISOString());
    expect(after.end.toISOString()).toBe(before.end.toISOString());
  });

  it('picks the latest entry in force when several already apply', () => {
    const window = resolveWindow(
      new Date('2026-09-23T04:15:00.000Z'),
      history([
        ['UTC', '2026-01-01T00:00:00.000Z'],
        ['America/New_York', '2026-05-01T00:00:00.000Z'],
        ['Asia/Manila', '2026-08-01T00:00:00.000Z'],
      ]),
    );
    expect(window.timezone).toBe('Asia/Manila');
    expect(window.start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });

  it('iterates to a window whose own start resolves to the zone it was cut in', () => {
    // Three entries placed so that each recut start crosses the next one:
    //   zone now      → Kiritimati (+14), start 2026-08-31T10:00Z
    //   that start    → UTC,              start 2026-09-01T00:00Z
    //   that start    → Midway (-11),     start 2026-09-01T11:00Z
    //   that start    → Midway            — fixpoint.
    // A fixed two-pass resolution stops at the UTC window, whose own start
    // resolves to Midway, so its zone and start disagree.
    const entries = history([
      ['UTC', '2026-01-01T00:00:00.000Z'],
      ['Pacific/Midway', '2026-08-31T18:00:00.000Z'],
      ['Pacific/Kiritimati', '2026-09-10T00:00:00.000Z'],
    ]);

    const window = resolveWindow(new Date('2026-09-23T04:00:00.000Z'), entries);

    expect(window.timezone).toBe('Pacific/Midway');
    expect(window.start.toISOString()).toBe('2026-09-01T11:00:00.000Z');
    // The invariant, stated directly: the window's start resolves to its zone.
    expect(zoneInEffectAt(entries, window.start)).toBe(window.timezone);
  });

  it('always returns a window, even for a history that cannot settle', () => {
    // An entry sitting between two candidate starts makes the two zones chase
    // each other. The bounded loop must still terminate with a usable window.
    const entries = history([
      ['UTC', '2026-01-01T00:00:00.000Z'],
      ['Pacific/Kiritimati', '2026-08-31T20:00:00.000Z'],
    ]);

    const window = resolveWindow(new Date('2026-09-23T04:00:00.000Z'), entries);

    expect(window.start.getTime()).toBeLessThan(window.end.getTime());
    expect(['UTC', 'Pacific/Kiritimati']).toContain(window.timezone);
  });

  it('gives two accounts in different zones different reset instants at one moment', () => {
    const now = new Date('2026-09-23T04:15:00.000Z');
    const manila = resolveWindow(now, history([['Asia/Manila', '2026-01-01T00:00:00.000Z']]));
    const newYork = resolveWindow(now, history([['America/New_York', '2026-01-01T00:00:00.000Z']]));

    expect(manila.end.toISOString()).not.toBe(newYork.end.toISOString());
    expect(manila.end.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(newYork.end.toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });
});
