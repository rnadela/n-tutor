import { describe, expect, it } from 'vitest';
import {
  GradingPayloadInvalid,
  MAX_RATIONALE_LENGTH,
  RATIONALE_REQUIRED,
  VERDICT_COUNT_MISMATCH,
  VERDICT_ORDINAL_DUPLICATED,
  VERDICT_ORDINAL_UNKNOWN,
  validateGradingPayload,
} from './grading-payload.js';
import type { GradingPayload } from './grading-schema.js';

/**
 * The post-hoc pass over a batch of verdicts (AD-30).
 *
 * The case that matters most is the one a model actually produces: told to answer
 * for four Questions, it answers for three. Everything here is a rejection of the
 * whole batch, because a verdict matched to the wrong ordinal is a grade for an
 * answer nobody gave.
 */
function payload(
  verdicts: { questionOrdinal: number; correct: boolean; rationale: string }[],
): GradingPayload {
  return { verdicts };
}

function verdict(ordinal: number, correct = true, rationale = 'Because it matches.') {
  return { questionOrdinal: ordinal, correct, rationale };
}

function refusedWith(input: GradingPayload, asked: number[], reason: string) {
  expect(() => validateGradingPayload(input, asked)).toThrow(GradingPayloadInvalid);
  expect(() => validateGradingPayload(input, asked)).toThrow(reason);
}

describe('validateGradingPayload', () => {
  it('normalizes a well-formed payload to one verdict per asked ordinal', () => {
    const asked = [1, 2, 3];
    const result = validateGradingPayload(
      payload([verdict(1, true), verdict(2, false, '  It  says something else. '), verdict(3)]),
      asked,
    );

    expect(result).toEqual([
      { ordinal: 1, correct: true, rationale: 'Because it matches.' },
      { ordinal: 2, correct: false, rationale: 'It says something else.' },
      { ordinal: 3, correct: true, rationale: 'Because it matches.' },
    ]);
  });

  it('comes back in the order the questions were asked, not the order they were answered', () => {
    // So a caller writing rows walks the Questions in the order the child was
    // shown them, whatever order the model happened to answer in.
    const result = validateGradingPayload(payload([verdict(7), verdict(2), verdict(4)]), [2, 4, 7]);
    expect(result.map((entry) => entry.ordinal)).toEqual([2, 4, 7]);
  });

  it('rejects a payload that answers for fewer questions than were asked', () => {
    // The canonical failure: three verdicts stored against four Questions would
    // leave the fourth silently unjudged with nothing to say so.
    refusedWith(
      payload([verdict(1), verdict(2), verdict(3)]),
      [1, 2, 3, 4],
      VERDICT_COUNT_MISMATCH,
    );
  });

  it('rejects a payload that answers for more questions than were asked', () => {
    refusedWith(payload([verdict(1), verdict(2)]), [1], VERDICT_COUNT_MISMATCH);
  });

  it('rejects a verdict for an ordinal nobody asked about', () => {
    refusedWith(payload([verdict(1), verdict(9)]), [1, 2], VERDICT_ORDINAL_UNKNOWN);
  });

  it('rejects two verdicts for one question', () => {
    // Same length as the asked list, so only the duplicate check catches it — and
    // it must, because the second verdict would silently overwrite the first.
    refusedWith(payload([verdict(1), verdict(1, false)]), [1, 2], VERDICT_ORDINAL_DUPLICATED);
  });

  it('rejects a rationale that is blank once trimmed', () => {
    refusedWith(payload([verdict(1, true, '   \n  ')]), [1], RATIONALE_REQUIRED);
    refusedWith(payload([verdict(1, true, '')]), [1], RATIONALE_REQUIRED);
  });

  it('caps an over-long rationale rather than rejecting the batch', () => {
    // A correct verdict is worth keeping: re-asking would spend a second call to
    // shorten a sentence.
    const long = 'a'.repeat(MAX_RATIONALE_LENGTH + 500);
    const result = validateGradingPayload(payload([verdict(1, false, long)]), [1]);
    expect(result[0]!.rationale).toHaveLength(MAX_RATIONALE_LENGTH);
    expect(result[0]!.correct).toBe(false);
  });

  it('accepts an empty batch asked for nothing', () => {
    expect(validateGradingPayload(payload([]), [])).toEqual([]);
  });
});
