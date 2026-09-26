import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGIBILITY_PROMPT,
  LegibilityPayloadInvalid,
  fakeLegibilityPayload,
  fakeUnreadableBytes,
  validateLegibilityPayload,
} from './legibility.js';

/** One page as the call carries it; only the byte length is ever read here. */
function page(
  ordinal: number,
  bytes: number,
): { ordinal: number; buffer: Buffer; mimeType: string } {
  return { ordinal, buffer: Buffer.alloc(bytes, 1), mimeType: 'image/jpeg' };
}

function verdicts(...pairs: [number, string][]): unknown {
  return { pages: pairs.map(([ordinal, confidence]) => ({ ordinal, confidence })) };
}

describe('the legibility prompt', () => {
  it('asks for one verdict per page and never for a whole-test verdict', () => {
    // The prompt and the post-hoc pass are two halves of one rule, so the
    // instruction is asserted rather than left to be read: a prompt that
    // stopped asking for a verdict per page would leave the validator
    // rejecting every payload and nothing would say why.
    expect(LEGIBILITY_PROMPT).toContain('exactly one verdict for every page');
    expect(LEGIBILITY_PROMPT).toContain('Low, Medium or High');
    expect(LEGIBILITY_PROMPT.toLowerCase()).not.toContain('pass/fail');
  });
});

describe('validateLegibilityPayload', () => {
  it('accepts one verdict per stored ordinal and answers in stored order', () => {
    // Answered out of order on purpose: the caller writes in the order this
    // returns, and that order is the stored one, not the model's.
    const result = validateLegibilityPayload(
      verdicts([3, 'High'], [1, 'Low'], [2, 'Medium']),
      [1, 2, 3],
    );
    expect(result).toEqual([
      { ordinal: 1, legibility: 'Low' },
      { ordinal: 2, legibility: 'Medium' },
      { ordinal: 3, legibility: 'High' },
    ]);
  });

  it('rejects a payload that is not the shape at all', () => {
    expect(() => validateLegibilityPayload({ unparseable: true }, [1])).toThrow(
      LegibilityPayloadInvalid,
    );
  });

  it('rejects a confidence outside the enum', () => {
    expect(() => validateLegibilityPayload(verdicts([1, 'Blurry']), [1])).toThrow(
      LegibilityPayloadInvalid,
    );
  });

  it('rejects a verdict for an ordinal the Source Test does not hold', () => {
    // The AD-30 case the matrix names: the payload is schema-valid and still
    // describes a page set that is not this one.
    expect(() => validateLegibilityPayload(verdicts([1, 'High'], [9, 'Low']), [1, 2])).toThrow(
      LegibilityPayloadInvalid,
    );
  });

  it('rejects a payload missing a stored ordinal', () => {
    expect(() => validateLegibilityPayload(verdicts([1, 'High']), [1, 2])).toThrow(
      LegibilityPayloadInvalid,
    );
  });

  it('rejects the same ordinal answered twice rather than taking either', () => {
    // Last-one-wins would store a judgement nobody can account for, and the
    // count check alone would miss it: two verdicts for page 1 against two
    // stored pages is the right length and the wrong set.
    expect(() => validateLegibilityPayload(verdicts([1, 'High'], [1, 'Low']), [1, 2])).toThrow(
      LegibilityPayloadInvalid,
    );
  });

  it('rejects an empty payload against a page set that is not empty', () => {
    expect(() => validateLegibilityPayload({ pages: [] }, [1])).toThrow(LegibilityPayloadInvalid);
  });

  it('rejects whole, never partially — nothing is returned on a fault', () => {
    // The property the store depends on: a rejected payload yields no value at
    // all, so there is nothing a caller could write half of.
    let returned: unknown = 'not reached';
    try {
      returned = validateLegibilityPayload(verdicts([1, 'High'], [3, 'High']), [1, 2]);
    } catch {
      /* expected */
    }
    expect(returned).toBe('not reached');
  });
});

describe('the fake transport’s answer', () => {
  const saved = process.env.AI_FAKE_UNREADABLE_BYTES;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_FAKE_UNREADABLE_BYTES;
    else process.env.AI_FAKE_UNREADABLE_BYTES = saved;
  });

  it('calls a page below the threshold Low and one at or above it High', () => {
    const threshold = fakeUnreadableBytes();
    const build = fakeLegibilityPayload([
      page(1, threshold - 1),
      page(2, threshold),
      page(3, threshold * 2),
    ]);
    expect(build({ imageCount: 3 })).toEqual({
      pages: [
        { ordinal: 1, confidence: 'Low' },
        { ordinal: 2, confidence: 'High' },
        { ordinal: 3, confidence: 'High' },
      ],
    });
  });

  it('answers under the ordinals it was given, so the validator accepts it', () => {
    const build = fakeLegibilityPayload([page(1, 10_000), page(2, 10_000)]);
    expect(validateLegibilityPayload(build({ imageCount: 2 }), [1, 2])).toEqual([
      { ordinal: 1, legibility: 'High' },
      { ordinal: 2, legibility: 'High' },
    ]);
  });

  it('reads the threshold per call, so a test can move it', () => {
    process.env.AI_FAKE_UNREADABLE_BYTES = '100';
    const build = fakeLegibilityPayload([page(1, 150)]);
    expect(build({ imageCount: 1 }).pages[0]!.confidence).toBe('High');
  });

  it('refuses a threshold that is not a positive whole number', () => {
    process.env.AI_FAKE_UNREADABLE_BYTES = 'soon';
    const build = fakeLegibilityPayload([page(1, 10)]);
    expect(() => build({ imageCount: 1 })).toThrow();
  });

  it('reads the threshold only when the fake actually answers', () => {
    // The factory is built on every check, including under a live provider
    // where this builder is never invoked. Throwing at construction would put
    // a malformed override outside the four faults the service recognises and
    // surface it to a parent as a 500.
    process.env.AI_FAKE_UNREADABLE_BYTES = 'soon';
    expect(() => fakeLegibilityPayload([page(1, 10)])).not.toThrow();
  });
});
