import { describe, expect, it } from 'vitest';
import {
  WARNING_THRESHOLDS_MS,
  WARNING_VISIBLE_MS,
  formatRemaining,
  remainingMs,
  warningFor,
} from './attempt-clock';

/** Twenty minutes, the way a start response states it. */
const SERVER_NOW = 1_000_000;
const SYNCED_AT = 1_000_000;
const EXPIRES_AT = SERVER_NOW + 20 * 60_000;

function remainingAt(now: number, expiresAt: number | null = EXPIRES_AT): number | null {
  return remainingMs({ expiresAt, serverNow: SERVER_NOW, syncedAt: SYNCED_AT, now });
}

describe('a countdown that is the wall clock and nothing else', () => {
  it('falls by exactly as much time as passed', () => {
    expect(remainingAt(SYNCED_AT)).toBe(20 * 60_000);
    expect(remainingAt(SYNCED_AT + 60_000)).toBe(19 * 60_000);
    expect(remainingAt(SYNCED_AT + 5 * 60_000)).toBe(15 * 60_000);
  });

  it('falls monotonically, including straight across a ten-minute gap', () => {
    // A backgrounded tab, a slept device: the next reading is simply the next
    // reading. Nothing pauses and nothing catches up.
    const readings = [0, 30_000, 60_000, 660_000, 661_000].map((elapsed) =>
      remainingAt(SYNCED_AT + elapsed),
    );
    expect(readings).toEqual([1_200_000, 1_170_000, 1_140_000, 540_000, 539_000]);
    for (let index = 1; index < readings.length; index += 1) {
      expect(readings[index]!).toBeLessThan(readings[index - 1]!);
    }
  });

  it('clamps at zero and never goes negative', () => {
    expect(remainingAt(SYNCED_AT + 20 * 60_000)).toBe(0);
    expect(remainingAt(SYNCED_AT + 40 * 60_000)).toBe(0);
  });

  it('measures against the server’s instants through a fixed offset', () => {
    // A device running ten minutes fast. The offset shifts only what is displayed:
    // twenty minutes remain at the moment the response arrived, whatever this
    // browser's clock happened to read.
    const fastBrowser = SYNCED_AT + 10 * 60_000;
    const atSync = remainingMs({
      expiresAt: EXPIRES_AT,
      serverNow: SERVER_NOW,
      syncedAt: fastBrowser,
      now: fastBrowser,
    });
    expect(atSync).toBe(20 * 60_000);
    const aMinuteLater = remainingMs({
      expiresAt: EXPIRES_AT,
      serverNow: SERVER_NOW,
      syncedAt: fastBrowser,
      now: fastBrowser + 60_000,
    });
    expect(aMinuteLater).toBe(19 * 60_000);
  });

  it('has nothing to count for an untimed Attempt', () => {
    expect(remainingAt(SYNCED_AT, null)).toBeNull();
    expect(remainingAt(SYNCED_AT + 10_000_000, null)).toBeNull();
  });
});

describe('the three warnings', () => {
  it('fires on the crossing and on no later reading', () => {
    // Above the threshold, then at it, then below it. Only the middle step crossed.
    expect(warningFor(300_001, 300_000)).toBe(300_000);
    expect(warningFor(300_000, 299_000)).toBeNull();
    expect(warningFor(299_000, 250_000)).toBeNull();
  });

  it('fires exactly three times on a run from full to zero, and no fourth', () => {
    let previous: number | null = null;
    const fired: number[] = [];
    // Every second of a twenty-minute test, which is what the screen actually does.
    for (let elapsed = 0; elapsed <= 20 * 60_000; elapsed += 1000) {
      const remaining = remainingAt(SYNCED_AT + elapsed);
      const warning = warningFor(previous, remaining);
      if (warning !== null) fired.push(warning);
      previous = remaining;
    }
    expect(fired).toEqual([...WARNING_THRESHOLDS_MS]);
    expect(fired).toHaveLength(3);
  });

  it('announces nothing on the first reading, whatever it reads', () => {
    // A child opening a test with four minutes left is not told five minutes remain.
    expect(warningFor(null, 240_000)).toBeNull();
    expect(warningFor(null, 0)).toBeNull();
  });

  it('names where the child actually is when one step crosses several', () => {
    // A device that slept through two thresholds. Announcing the largest would say
    // five minutes remain when twenty seconds do.
    expect(warningFor(400_000, 10_000)).toBe(20_000);
    expect(warningFor(400_000, 90_000)).toBe(300_000);
  });

  it('never warns on an untimed Attempt', () => {
    let previous: number | null = null;
    for (let elapsed = 0; elapsed <= 60 * 60_000; elapsed += 60_000) {
      const remaining = remainingAt(SYNCED_AT + elapsed, null);
      expect(warningFor(previous, remaining)).toBeNull();
      previous = remaining;
    }
  });

  it('holds three thresholds, in descending order, and they do not escalate', () => {
    expect(WARNING_THRESHOLDS_MS).toEqual([300_000, 60_000, 20_000]);
    expect([...WARNING_THRESHOLDS_MS].sort((a, b) => b - a)).toEqual([...WARNING_THRESHOLDS_MS]);
  });
});

describe('the two forms of the remaining time', () => {
  it('shows a clock and says the units, without either repeating the other', () => {
    const { display, spoken } = formatRemaining(5 * 60_000);
    expect(display).toBe('5:00');
    // The displayed form carries no unit word at all: the `role="timer"` label's job.
    expect(display).not.toMatch(/minute|second|min|sec/iu);
    expect(spoken).toBe('5 minutes');
    expect(spoken).toMatch(/minute/u);
  });

  it('carries both units when both are on the clock', () => {
    expect(formatRemaining(90_000)).toEqual({ display: '1:30', spoken: '1 minute and 30 seconds' });
  });

  it('says seconds alone under a minute', () => {
    expect(formatRemaining(20_000)).toEqual({ display: '0:20', spoken: '20 seconds' });
    expect(formatRemaining(1_000)).toEqual({ display: '0:01', spoken: '1 second' });
  });

  it('pads the seconds so the clock does not jump width', () => {
    expect(formatRemaining(61_000).display).toBe('1:01');
    expect(formatRemaining(3 * 60_000 + 9_000).display).toBe('3:09');
  });

  it('never shows zero with time still on it, and never shows a negative', () => {
    // Rounded up while any part of a second remains.
    expect(formatRemaining(1).display).toBe('0:01');
    expect(formatRemaining(0).display).toBe('0:00');
    expect(formatRemaining(-5_000).display).toBe('0:00');
  });

  it('says nothing about being right', () => {
    for (const ms of [0, 1_000, 20_000, 60_000, 300_000, 20 * 60_000]) {
      const { display, spoken } = formatRemaining(ms);
      expect(`${display} ${spoken}`).not.toMatch(/correct|wrong|score|grade|%/iu);
    }
  });
});

describe('a warning is an event rather than a state', () => {
  it('clears before the countdown reaches zero, at every threshold', () => {
    // The screen shows one warning for `WARNING_VISIBLE_MS` and then takes it down.
    // For that to never overlap the time-up sentence, the visible window has to be
    // shorter than the smallest threshold — otherwise the 20-second warning is still
    // up at 0:00 and the child reads that the time is up and that 20 seconds remain.
    const smallest = Math.min(...WARNING_THRESHOLDS_MS);
    expect(WARNING_VISIBLE_MS).toBeLessThan(smallest);
  });

  it('is long enough to read', () => {
    // Not a figure anybody needs to be precise about, but a warning that vanished in
    // a few hundred milliseconds would be a warning nobody saw.
    expect(WARNING_VISIBLE_MS).toBeGreaterThanOrEqual(5_000);
  });
});

describe('a clock reading that is not a number at all', () => {
  it('answers null rather than NaN when now is not finite', () => {
    // `Math.max(0, NaN)` is `NaN`, not 0 — so without the guard this renders
    // "NaN:NaN" and never reaches zero: a countdown that neither counts nor expires.
    expect(remainingAt(Number.NaN)).toBeNull();
    expect(remainingAt(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('answers null for a deadline or a sync that did not parse', () => {
    for (const instants of [
      { expiresAt: Number.NaN, serverNow: SERVER_NOW, syncedAt: SYNCED_AT, now: SERVER_NOW },
      { expiresAt: EXPIRES_AT, serverNow: Number.NaN, syncedAt: SYNCED_AT, now: SERVER_NOW },
      { expiresAt: EXPIRES_AT, serverNow: SERVER_NOW, syncedAt: Number.NaN, now: SERVER_NOW },
    ]) {
      expect(remainingMs(instants)).toBeNull();
    }
  });

  it('never yields a NaN from any reading the screen could take', () => {
    for (const now of [SERVER_NOW - 1, SERVER_NOW, EXPIRES_AT, EXPIRES_AT + 60_000]) {
      expect(Number.isNaN(remainingAt(now))).toBe(false);
    }
  });
});
