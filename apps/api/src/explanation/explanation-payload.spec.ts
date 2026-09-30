import { describe, expect, it } from 'vitest';
import {
  EXPLANATION_EMPTY,
  EXPLANATION_TOO_LONG,
  ExplanationPayloadInvalid,
  validateExplanationPayload,
} from './explanation-payload.js';
import { EXPLANATION_FAILED, MAX_EXPLANATION_LENGTH } from './explanation-policy.js';
import { fakeExplanationPayload } from './explanation-schema.js';

/**
 * The post-hoc pass and the two figures around it.
 *
 * Both bounds live here because strict Structured Outputs can carry neither: a
 * `minItems` and a `maxLength` written into the wire schema are silently dropped,
 * so without this pass an empty body and a wall of text both parse and both get
 * stored.
 */
describe('what a payload has to be before it is stored', () => {
  it('accepts a body with something in it and hands the segments back unchanged', () => {
    const body = [{ kind: 'text' as const, value: 'Halving six gives three.' }];
    expect(validateExplanationPayload({ body })).toEqual(body);
  });

  it('keeps fraction segments as fractions rather than flattening them', () => {
    // The whole reason the payload is `RichText`: "one half" cannot be recovered
    // from a glyph (AD-32).
    const body = [
      { kind: 'text' as const, value: 'Half of six is ' },
      { kind: 'fraction' as const, whole: null, numerator: 6, denominator: 2 },
    ];
    expect(validateExplanationPayload({ body })).toEqual(body);
  });

  it('rejects a body with no segments at all', () => {
    expect(() => validateExplanationPayload({ body: [] })).toThrow(ExplanationPayloadInvalid);
    expect(() => validateExplanationPayload({ body: [] })).toThrow(EXPLANATION_EMPTY);
  });

  it('rejects a body that is present but says nothing', () => {
    // Whitespace is the same "declined to fill it" case an empty array is, just
    // spelled differently.
    expect(() => validateExplanationPayload({ body: [{ kind: 'text', value: '   ' }] })).toThrow(
      EXPLANATION_EMPTY,
    );
  });

  it('rejects arithmetic nonsense that would render as a division by zero', () => {
    expect(() =>
      validateExplanationPayload({
        body: [{ kind: 'fraction', whole: null, numerator: 1, denominator: 0 }],
      }),
    ).toThrow(EXPLANATION_EMPTY);
  });

  it('accepts prose exactly at the ceiling', () => {
    const body = [{ kind: 'text' as const, value: 'a'.repeat(MAX_EXPLANATION_LENGTH) }];
    expect(validateExplanationPayload({ body })).toEqual(body);
  });

  it('rejects prose one character over it, and never truncates', () => {
    // Re-asked rather than cut: an explanation that stops mid-thought stops making
    // sense exactly where the child needed it to keep going.
    const body = [{ kind: 'text' as const, value: 'a'.repeat(MAX_EXPLANATION_LENGTH + 1) }];
    expect(() => validateExplanationPayload({ body })).toThrow(EXPLANATION_TOO_LONG);
  });

  it('measures the plain rendering rather than the encoding', () => {
    // A fraction is one idea however many keys carry it; counting the JSON would
    // make the ceiling depend on how the prose happened to be segmented.
    const body = Array.from({ length: 200 }, () => ({
      kind: 'fraction' as const,
      whole: null,
      numerator: 1,
      denominator: 2,
    }));
    // `1/2` is three characters each, so 200 of them is far inside the ceiling
    // while their JSON is not.
    expect(validateExplanationPayload({ body })).toHaveLength(200);
  });
});

describe('what the fake transport answers with', () => {
  it('writes a usable explanation that names the question it is about', () => {
    const payload = fakeExplanationPayload({ ordinal: 7, failure: 'none' });
    expect(validateExplanationPayload(payload)).toBe(payload.body);
    expect(JSON.stringify(payload.body)).toContain('question 7');
  });

  it('keeps producing the `unusable` fault at this seam, as an empty body', () => {
    // A text call has no photograph to be unreadable, so the latch lands on the one
    // thing the post-hoc pass can still reject (AD-22).
    const payload = fakeExplanationPayload({ ordinal: 1, failure: 'unusable' });
    expect(() => validateExplanationPayload(payload)).toThrow(EXPLANATION_EMPTY);
  });
});

/**
 * This module's own refusal sentence, and the only one left here.
 *
 * **The at-cap refusal is not this file's any more.** Its wording is asserted in
 * `allowance/allowance-policy.spec.ts`, beside the sentence itself and beside its
 * Upload and Generation siblings.
 *
 * **Nor is the cap arithmetic.** Neither Explanation cap check goes through
 * `remainingFor` any more — both compare `used >= limit` directly, against a limit
 * that is `null` for an unlimited tier and returned early on — so cases pinning
 * `remainingFor` from here were pinning a function this module's paths no longer
 * call. `remainingFor` is covered where it is the subject and still has callers,
 * in `practicetest/practice-test-policy.spec.ts`, and that every Explanation
 * figure matches `tiers.md` is `allowance/tiers.spec.ts`'s, row for row.
 */
describe('the failure sentence', () => {
  it('says one sentence for every failure class, and apologises for none of them', () => {
    for (const forbidden of [/sorry/iu, /!/u, /error/iu, /timeout/iu, /provider/iu, /model/iu]) {
      expect(EXPLANATION_FAILED).not.toMatch(forbidden);
    }
  });
});
