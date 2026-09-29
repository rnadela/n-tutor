import { describe, expect, it } from 'vitest';
import { uploadAllowanceExhausted } from './allowance-policy.js';
import { limitsFor } from './tiers.js';

/** The tier under test throughout: the one with the smallest Upload Allowance. */
const TIER = 'Free' as const;
/** Read, never written: no allowance figure may appear as a literal in a test. */
const LIMIT = limitsFor(TIER).upload!;

/**
 * A zone far enough east that its calendar date at the boundary is **not** the
 * UTC one: local midnight on the first of the next month falls on the previous
 * UTC day. That is the whole point of rendering the reset in the account's own
 * zone, and a formatter that quietly used UTC would read a day early here.
 */
const FAR_EAST = 'Pacific/Kiritimati';
/** Local 2026-10-01T00:00 in `FAR_EAST` (UTC+14) — 2026-09-30 in UTC. */
const RESET_AT = new Date('2026-09-30T10:00:00.000Z');

function sentence(overrides: Partial<Parameters<typeof uploadAllowanceExhausted>[0]> = {}): string {
  return uploadAllowanceExhausted({
    tier: TIER,
    used: LIMIT,
    limit: LIMIT,
    resetAt: RESET_AT,
    timezone: FAR_EAST,
    ...overrides,
  });
}

describe('the Upload Allowance refusal', () => {
  it('names the Account Tier the account is on', () => {
    expect(sentence()).toContain(`${TIER} Account Tier`);
    // The domain's own name for it. "Plan" is a word this product uses nowhere.
    expect(sentence().toLowerCase()).not.toContain('plan');
  });

  it('states the usage against the limit, in uploads', () => {
    expect(sentence()).toContain(`${LIMIT} of ${LIMIT}`);
    expect(sentence()).toContain(`${LIMIT} uploads`);
  });

  it('reads the figures from the tiers table rather than restating them', () => {
    // A sentence built for a tier with a different Upload Allowance states that
    // tier's figure, which is only possible if nothing here is a literal.
    const other = limitsFor('Plus').upload!;
    expect(other).not.toBe(LIMIT);
    expect(sentence({ tier: 'Plus', used: other, limit: other })).toContain(`${other} of ${other}`);
  });

  it('renders the reset date in the account’s own zone, not in UTC', () => {
    expect(sentence()).toContain('October 1, 2026');
    expect(sentence()).not.toContain('September 30, 2026');
    // And the same instant genuinely reads as the day before in UTC, so the
    // assertion above is about the zone and not about the fixture.
    expect(sentence({ timezone: 'UTC' })).toContain('September 30, 2026');
  });

  it('names no figure beyond the two counts and the date', () => {
    const figures = sentence().match(/\d+/gu) ?? [];
    expect(figures).toEqual([String(LIMIT), String(LIMIT), String(LIMIT), '1', '2026']);
  });

  it('still produces a sentence when the stored zone is not one the platform knows', () => {
    // A single unrecognised row must never turn a 409 a parent can act on into
    // a 500 they cannot.
    const fallback = sentence({ timezone: 'Mars/Olympus_Mons' });
    expect(fallback).toContain(`${TIER} Account Tier`);
    expect(fallback).toContain('September 30, 2026');
  });

  it('says it without an exclamation mark and without an apology', () => {
    expect(sentence()).not.toContain('!');
    expect(sentence().toLowerCase()).not.toContain('sorry');
  });

  it('agrees in number when a tier allows exactly one upload', () => {
    const singular = sentence({ used: 1, limit: 1 });
    expect(singular).toContain('1 upload each period');
    // The verb agrees with `used`, not with the sentence's default plural.
    expect(singular).toContain('1 of 1 has been used');
    expect(singular).not.toContain('have been used');
  });

  it('keeps the plural verb for every other usage', () => {
    expect(sentence()).toContain(`${LIMIT} of ${LIMIT} have been used`);
    expect(sentence({ used: 0 })).toContain(`0 of ${LIMIT} have been used`);
  });
});
