import { afterEach, describe, expect, it } from 'vitest';
import {
  ELEVATION_CEILING_MS,
  MAX_PIN_ATTEMPTS,
  PIN_COOLDOWN_MS,
  PIN_LENGTH,
  elevationCeilingFrom,
  isLocked,
  isWellFormedPin,
  isWithinCeiling,
  lockReachedAt,
  pinCooldownMinutes,
  pinRuntime,
  resetPinRuntime,
} from './pin-policy.js';

const NOW = new Date('2026-09-23T10:00:00.000Z');

describe('PIN shape', () => {
  it('accepts exactly the stated number of digits and nothing else', () => {
    expect(isWellFormedPin('1'.repeat(PIN_LENGTH))).toBe(true);
    expect(isWellFormedPin('1'.repeat(PIN_LENGTH - 1))).toBe(false);
    expect(isWellFormedPin('1'.repeat(PIN_LENGTH + 1))).toBe(false);
  });

  it('keeps leading zeros meaningful — a PIN is a string, not a number', () => {
    expect(isWellFormedPin('0000')).toBe(true);
    expect(isWellFormedPin('0123')).toBe(true);
  });

  it('rejects anything that is not a digit, spaces and signs included', () => {
    expect(isWellFormedPin('12a4')).toBe(false);
    expect(isWellFormedPin('12 4')).toBe(false);
    expect(isWellFormedPin('+123')).toBe(false);
    expect(isWellFormedPin('١٢٣٤')).toBe(false);
    expect(isWellFormedPin('')).toBe(false);
  });

  it('rejects a non-string outright rather than coercing it', () => {
    expect(isWellFormedPin(1234)).toBe(false);
    expect(isWellFormedPin(null)).toBe(false);
    expect(isWellFormedPin(undefined)).toBe(false);
  });
});

describe('lock expiry', () => {
  it('is open when no lock is written', () => {
    expect(isLocked({ pinLockedUntil: null }, NOW)).toBe(false);
  });

  it('is shut strictly before the instant and open at it', () => {
    const until = new Date(NOW.getTime() + 1000);
    expect(isLocked({ pinLockedUntil: until }, NOW)).toBe(true);
    expect(isLocked({ pinLockedUntil: until }, new Date(until.getTime() - 1))).toBe(true);
    // Exactly at the boundary the cool-down has lapsed.
    expect(isLocked({ pinLockedUntil: until }, until)).toBe(false);
    expect(isLocked({ pinLockedUntil: until }, new Date(until.getTime() + 1))).toBe(false);
  });
});

describe('elevation ceiling', () => {
  it('runs from the PIN crossing, not from the token', () => {
    expect(elevationCeilingFrom(NOW, ELEVATION_CEILING_MS)).toEqual(
      new Date(NOW.getTime() + ELEVATION_CEILING_MS),
    );
  });

  it('is exclusive at the boundary, exactly as a reset token’s expiry is', () => {
    const ceiling = NOW.getTime() + ELEVATION_CEILING_MS;
    expect(isWithinCeiling(NOW, new Date(ceiling - 1), ELEVATION_CEILING_MS)).toBe(true);
    expect(isWithinCeiling(NOW, new Date(ceiling), ELEVATION_CEILING_MS)).toBe(false);
    expect(isWithinCeiling(NOW, new Date(ceiling + 1), ELEVATION_CEILING_MS)).toBe(false);
  });
});

describe('the lock decision on an already-counted failure', () => {
  it('locks at the ceiling and not before, whatever produced the count', () => {
    for (let attempts = 1; attempts < MAX_PIN_ATTEMPTS; attempts += 1) {
      expect(lockReachedAt(attempts, NOW, PIN_COOLDOWN_MS)).toBeNull();
    }
    expect(lockReachedAt(MAX_PIN_ATTEMPTS, NOW, PIN_COOLDOWN_MS)).toEqual(
      new Date(NOW.getTime() + PIN_COOLDOWN_MS),
    );
  });

  it('still locks when concurrency carried the count past the ceiling', () => {
    // Parallel wrong entries can produce a count above the ceiling; every one
    // of them past it must still close the gate rather than fall through.
    expect(lockReachedAt(MAX_PIN_ATTEMPTS + 2, NOW, PIN_COOLDOWN_MS)).not.toBeNull();
  });
});

describe('published figures', () => {
  it('states the cool-down in whole minutes, never rounded away to zero', () => {
    expect(pinCooldownMinutes()).toBeGreaterThanOrEqual(1);
  });
});

describe('the runtime overrides', () => {
  const saved = {
    cooldown: process.env.PIN_COOLDOWN_MS,
    ttl: process.env.ELEVATION_TTL_SECONDS,
    ceiling: process.env.ELEVATION_CEILING_MS,
  };

  afterEach(() => {
    restore('PIN_COOLDOWN_MS', saved.cooldown);
    restore('ELEVATION_TTL_SECONDS', saved.ttl);
    restore('ELEVATION_CEILING_MS', saved.ceiling);
    resetPinRuntime();
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it('refuses an override that is not a whole number, rather than yielding NaN', () => {
    process.env.PIN_COOLDOWN_MS = 'fifteen minutes';
    resetPinRuntime();
    expect(() => pinRuntime()).toThrow(/PIN_COOLDOWN_MS/);
  });

  it('refuses a token life that outlives the ceiling bounding it', () => {
    process.env.ELEVATION_TTL_SECONDS = '3600';
    process.env.ELEVATION_CEILING_MS = '60000';
    resetPinRuntime();
    expect(() => pinRuntime()).toThrow(/ELEVATION_TTL_SECONDS/);
  });

  it('accepts a token life exactly equal to the ceiling', () => {
    process.env.ELEVATION_TTL_SECONDS = '60';
    process.env.ELEVATION_CEILING_MS = '60000';
    resetPinRuntime();
    expect(pinRuntime()).toMatchObject({ elevationTtlSeconds: 60, elevationCeilingMs: 60_000 });
  });

  it('resolves once and does not re-read the environment per call', () => {
    resetPinRuntime();
    const first = pinRuntime();
    process.env.PIN_COOLDOWN_MS = '1';
    // The resolved values are what the process booted with; a later change to
    // the environment must not take effect halfway through a run.
    expect(pinRuntime()).toBe(first);
  });
});
