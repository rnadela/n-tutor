import { describe, expect, it } from 'vitest';
import {
  EXPLANATION_EMPTY,
  EXPLANATION_REPEATS_REMOVED,
  EXPLANATION_TOO_LONG,
  ExplanationPayloadInvalid,
  validateExplanationPayload,
} from './explanation-payload.js';
import { EXPLANATION_FAILED, MAX_EXPLANATION_LENGTH } from './explanation-policy.js';
import { ExplanationPayload, fakeExplanationPayload } from './explanation-schema.js';

/** A figure as a model would write it, and the only form that may be stored. */
const FIGURE_RAW =
  '<svg viewBox="0 0 10 10" width="200" height="200"><circle cx="5" cy="5" r="4" fill="#ff0000" stroke="black"/></svg>';
const FIGURE_SANITIZED =
  '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor" stroke="currentColor"/></svg>';

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

describe('a replacement for an explanation a parent removed', () => {
  const removed = ['Halve six: six split into two equal groups is three.'];

  it('is refused when it says the removed one again, however it is cased or spaced', () => {
    for (const value of [
      'Halve six: six split into two equal groups is three.',
      '  halve SIX — six split into two equal groups, is three ',
    ]) {
      const attempt = () =>
        validateExplanationPayload({ body: [{ kind: 'text', value }] }, removed);
      expect(attempt).toThrow(ExplanationPayloadInvalid);
      expect(attempt).toThrow(EXPLANATION_REPEATS_REMOVED);
    }
  });

  it('is accepted when it says something else', () => {
    const body = [
      { kind: 'text' as const, value: 'Three twos make six, so half of six is three.' },
    ];
    expect(validateExplanationPayload({ body }, removed)).toEqual(body);
  });

  it('is never compared against anything for a first explanation', () => {
    const body = [{ kind: 'text' as const, value: removed[0]! }];
    expect(validateExplanationPayload({ body })).toEqual(body);
  });
});

describe('what the fake transport answers with', () => {
  it('writes a usable explanation that names the question it is about', () => {
    const payload = fakeExplanationPayload({ ordinal: 7, failure: 'none' });
    // Equal, not identical: the pass normalizes (AD-32), so it answers with
    // its own array rather than the payload's.
    expect(validateExplanationPayload(payload)).toEqual(payload.body);
    expect(JSON.stringify(payload.body)).toContain('question 7');
  });

  it('writes a replacement that the post-hoc pass accepts over the first one', () => {
    const first = fakeExplanationPayload({ ordinal: 7, failure: 'none' });
    const second = fakeExplanationPayload({ ordinal: 7, failure: 'none', generation: 2 });
    const firstText = first.body
      .map((segment) => ('value' in segment ? segment.value : ''))
      .join('');
    expect(validateExplanationPayload(second, [firstText])).toEqual(second.body);
    expect(JSON.stringify(second.body)).toContain('question 7');
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

describe('a figure in an explanation', () => {
  /**
   * Narrowed on purpose until Story 4.8: nothing asks the explaining model to
   * draw, and the explanation prompt says nothing about figures.
   */
  it('is refused by the wire schema, so it never reaches this pass', () => {
    expect(
      ExplanationPayload.safeParse({
        body: [{ kind: 'figure', svg: FIGURE_SANITIZED, alt: 'A circle' }],
      }).success,
    ).toBe(false);
    expect(
      ExplanationPayload.safeParse({
        body: [
          { kind: 'text', value: 'Half of six is ' },
          { kind: 'fraction', whole: null, numerator: 6, denominator: 2 },
        ],
      }).success,
    ).toBe(true);
  });

  it('is stored sanitized if one ever reaches the pass anyway', () => {
    // Defence in depth, not a substitute for the narrowed wire: the body that
    // is returned — and stored — is `parseRichText`'s output, so the day 4.8
    // widens the schema no raw model markup is persisted by this path.
    //
    // Cast at the boundary because the wire type no longer admits a figure;
    // that is exactly the condition being simulated.
    const body = [
      { kind: 'text' as const, value: 'The shape is ' },
      { kind: 'figure' as const, svg: FIGURE_RAW, alt: '  A circle  ' },
    ];
    expect(validateExplanationPayload({ body } as unknown as ExplanationPayload)).toEqual([
      { kind: 'text', value: 'The shape is ' },
      { kind: 'figure', svg: FIGURE_SANITIZED, alt: 'A circle' },
    ]);
  });

  it('rejects a body whose figure the sanitizer does not admit', () => {
    const body = [
      {
        kind: 'figure' as const,
        svg: '<svg viewBox="0 0 2 2"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>',
        alt: 'A circle',
      },
    ];
    expect(() => validateExplanationPayload({ body } as unknown as ExplanationPayload)).toThrow(
      EXPLANATION_EMPTY,
    );
  });
});
