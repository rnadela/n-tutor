import { describe, expect, it } from 'vitest';
import { parentCopy } from '@/copy/parent';
import { dateOnly, type AccountConsumption } from './consumption-format';
import { uploadAllowanceLeft, uploadAllowanceLine } from './upload-allowance';

describe('uploadAllowanceLeft', () => {
  it('has no remainder on an unlimited tier', () => {
    // `null` is unlimited, and an unlimited account has no number to state —
    // the caller says so in words rather than showing "0 left".
    expect(uploadAllowanceLeft({ used: 0, limit: null })).toBeNull();
    expect(uploadAllowanceLeft({ used: 42, limit: null })).toBeNull();
  });

  it('states what is left mid-period', () => {
    expect(uploadAllowanceLeft({ used: 1, limit: 5 })).toBe(4);
    expect(uploadAllowanceLeft({ used: 0, limit: 1 })).toBe(1);
  });

  it('is zero, not blank, when the allowance is exactly spent', () => {
    expect(uploadAllowanceLeft({ used: 5, limit: 5 })).toBe(0);
  });

  it('never goes negative when more was spent than the tier now allows', () => {
    // A tier can shrink under an account that already spent against the old
    // ceiling. "-2 left" describes nothing a parent can act on.
    expect(uploadAllowanceLeft({ used: 7, limit: 5 })).toBe(0);
  });
});

/**
 * A consumption payload shaped the way the API answers, and nothing like a
 * fixture of this app's own figures: every number and both instants below are
 * values the test hands in and then expects to read back.
 *
 * The zone is deliberately not the test machine's and not UTC, so a line
 * rendered in either of those has to be a failure rather than an invisible
 * regression — the same pinning `consumption-format.spec.ts` applies.
 */
function consumption(
  upload: { used: number; limit: number | null },
  resetAt = '2026-09-01T12:30:00.000Z',
  timezone = 'Pacific/Auckland',
): AccountConsumption {
  return {
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: resetAt,
    resetAt,
    timezone,
    tier: 'Free',
    studentProfileLimit: 1,
    allowances: {
      upload,
      generation: { used: 0, limit: 2 },
      explanation: { used: 0, limit: 10 },
    },
  };
}

describe('uploadAllowanceLine', () => {
  it('states nothing at all when there is no payload', () => {
    // The read has not landed, or it failed. A blank where a figure belongs is
    // better than a figure nobody vouched for, and the step works without it.
    expect(uploadAllowanceLine(null)).toBeNull();
  });

  it('says an unlimited allowance in words, with no figure in it', () => {
    const said = uploadAllowanceLine(consumption({ used: 9, limit: null }));
    expect(said).toBe(parentCopy.capture.legibility.allowanceUnlimited);
    // Never "0 left", and never the usage figure standing in for a remainder.
    expect(said).not.toMatch(/\d/u);
    expect(said).toContain(parentCopy.settings.uploadAllowance);
  });

  it('states what is left against the payload’s own ceiling and reset date', () => {
    const payload = consumption({ used: 1, limit: 5 });
    expect(uploadAllowanceLine(payload)).toBe(
      parentCopy.capture.legibility.allowanceLeft(
        4,
        5,
        dateOnly(payload.resetAt, payload.timezone),
      ),
    );
    // The arms are the right way round: a limited tier states its figure and
    // does not fall through to the unlimited sentence.
    expect(uploadAllowanceLine(payload)).toContain('4 of 5');
    expect(uploadAllowanceLine(payload)).not.toBe(parentCopy.capture.legibility.allowanceUnlimited);
  });

  it('renders the reset date in the account’s zone, not the viewer’s and not UTC', () => {
    // 2026-09-01T12:30Z is still 1 Sept in London and already 2 Sept in
    // Auckland. The account's zone decides, and the short month is whatever
    // `Intl` renders — "Sept", four letters, which is also why nothing
    // downstream may pin the date's shape. No date is composed here.
    const payload = consumption({ used: 1, limit: 5 });
    expect(uploadAllowanceLine(payload)).toContain(dateOnly(payload.resetAt, 'Pacific/Auckland'));
    expect(uploadAllowanceLine(payload)).not.toContain(dateOnly(payload.resetAt, 'Europe/London'));
  });

  it('says zero left rather than going blank or negative at the cap', () => {
    // The control is never gated on this; the figure simply tells the truth.
    expect(uploadAllowanceLine(consumption({ used: 2, limit: 2 }))).toContain('0 of 2');
    expect(uploadAllowanceLine(consumption({ used: 7, limit: 5 }))).toContain('0 of 5');
  });
});
