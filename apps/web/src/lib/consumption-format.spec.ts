import { describe, expect, it } from 'vitest';
import { adminCopy } from '@/copy/admin';
import {
  ACCOUNT_TIERS,
  dateOnly,
  inZone,
  limitLabel,
  tierLabel,
  type AccountTier,
} from './consumption-format';

/**
 * A single instant, read in three zones that disagree about both the hour and
 * the calendar day. If a formatter ever rendered in the viewer's zone or in
 * UTC, at least two of these assertions would fail wherever the suite runs.
 */
const INSTANT = '2026-09-30T16:00:00.000Z';

describe('rendering in the account’s own timezone', () => {
  it('renders one instant differently in each account zone', () => {
    // 2026-10-01 00:00 in Manila (UTC+8) is still 2026-09-30 in New York.
    expect(inZone(INSTANT, 'Asia/Manila')).toBe('01 Oct 2026, 00:00');
    expect(inZone(INSTANT, 'America/New_York')).toBe('30 Sept 2026, 12:00');
    expect(inZone(INSTANT, 'UTC')).toBe('30 Sept 2026, 16:00');
  });

  it('never falls back to the machine zone', () => {
    // Whatever zone the test machine is in, a zone 14 hours away cannot agree
    // with a zone 11 hours the other way on the rendered day and hour.
    const kiritimati = inZone(INSTANT, 'Pacific/Kiritimati');
    const midway = inZone(INSTANT, 'Pacific/Midway');
    expect(kiritimati).not.toBe(midway);
    expect(kiritimati).toBe('01 Oct 2026, 06:00');
    expect(midway).toBe('30 Sept 2026, 05:00');
  });

  it('renders a date-only value in the account zone, crossing the day boundary', () => {
    expect(dateOnly(INSTANT, 'Asia/Manila')).toBe('01 Oct 2026');
    expect(dateOnly(INSTANT, 'America/New_York')).toBe('30 Sept 2026');
  });

  it('renders a period start at local midnight as midnight', () => {
    // The API sends the UTC instant of local midnight on the 1st; the screen
    // must read it back as 00:00 in that zone, not as the shifted UTC hour.
    expect(inZone('2026-08-31T16:00:00.000Z', 'Asia/Manila')).toBe('01 Sept 2026, 00:00');
    expect(inZone('2026-10-01T04:00:00.000Z', 'America/New_York')).toBe('01 Oct 2026, 00:00');
  });
});

describe('limit labels', () => {
  it('renders an unlimited allowance in words, never as a number', () => {
    expect(limitLabel(null)).toBe(adminCopy.accounts.unlimited);
    expect(Number.isNaN(Number(limitLabel(null)))).toBe(true);
  });

  it('renders a numeric limit as the API sent it', () => {
    // An arbitrary number, not a figure from the tiers table: the point is that
    // whatever the API sends is what renders.
    expect(limitLabel(37)).toBe('37');
    expect(limitLabel(0)).toBe('0');
  });

  it('renders a zero limit as zero, not as unlimited', () => {
    expect(limitLabel(0)).not.toBe(adminCopy.accounts.unlimited);
  });
});

describe('tier labels', () => {
  it('renders a non-empty label for every Account Tier', () => {
    // Every tier the API can send has somewhere to render: a missing entry would
    // otherwise surface as "undefined" on the screen.
    for (const tier of ACCOUNT_TIERS) {
      expect(tierLabel(tier)).toBe(adminCopy.accounts.tiers[tier]);
      expect(tierLabel(tier).length).toBeGreaterThan(0);
    }
  });

  it('reads the label from the copy file rather than from the enum value', () => {
    // The assertion is the indirection, not today's strings: a label edited in the
    // copy file has to move the rendered tier, and no surface may restate one.
    const labels = ACCOUNT_TIERS.map((tier) => tierLabel(tier));
    expect(labels).toEqual(ACCOUNT_TIERS.map((tier) => adminCopy.accounts.tiers[tier]));
    expect(new Set(labels).size).toBe(ACCOUNT_TIERS.length);
  });

  it('never renders the word "undefined" for a tier this build has not heard of', () => {
    // `tier` arrives on an unchecked API payload and `ACCOUNT_TIERS` is this app's
    // mirror of the API's enum, so a tier added on the API side reaches here first.
    // The cast is the point: it is exactly the value the type system cannot stop.
    const unknown = tierLabel('Enterprise' as AccountTier);

    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown).not.toBe('undefined');
    expect(unknown).toBe(adminCopy.accounts.noName);
  });
});
