import { describe, expect, it } from 'vitest';
import { bestTopicMatch, cosine } from './topic-similarity.js';

describe('cosine', () => {
  it('is one for a vector against itself and zero for an orthogonal pair', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it('divides out magnitude, so length is not similarity', () => {
    expect(cosine([1, 1], [5, 5])).toBeCloseTo(1, 10);
  });

  it('answers zero for every degenerate comparison rather than throwing', () => {
    // All three mean the same thing to the only caller — *this candidate is not
    // the answer* — and none of them is a reason to fail a normalize that has a
    // perfectly good stage 3 behind it.
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([Number.NaN, 1], [1, 1])).toBe(0);
    expect(cosine([Number.POSITIVE_INFINITY, 1], [1, 1])).toBe(0);
  });
});

describe('bestTopicMatch', () => {
  const target = [1, 0];

  it('answers null when nothing reaches the threshold', () => {
    // Null is stage 2 declining, not failing: it is what hands the question to
    // stage 3, which is the only stage allowed to conclude that nothing fits.
    expect(bestTopicMatch(target, [{ id: 'a', embedding: [0, 1] }], 0.85)).toBeNull();
  });

  it('takes the closest candidate at or above the threshold', () => {
    const match = bestTopicMatch(
      target,
      [
        { id: 'far', embedding: [1, 1] },
        { id: 'near', embedding: [1, 0.1] },
      ],
      0.6,
    );
    expect(match?.id).toBe('near');
  });

  it('treats the threshold as a floor', () => {
    // Exactly at the threshold matches, which is what makes a vector compared
    // against itself a hit at any threshold up to one.
    expect(bestTopicMatch(target, [{ id: 'a', embedding: [1, 0] }], 1)?.id).toBe('a');
  });

  it('keeps the first candidate on a tie', () => {
    // The caller reads its candidates oldest-first, so a tie has to resolve the
    // same way twice — two identical normalizes cannot depend on row order.
    const match = bestTopicMatch(
      target,
      [
        { id: 'older', embedding: [1, 0] },
        { id: 'newer', embedding: [2, 0] },
      ],
      0.85,
    );
    expect(match?.id).toBe('older');
  });

  it('skips a candidate whose vector is unusable and still answers on the rest', () => {
    const match = bestTopicMatch(
      target,
      [
        { id: 'wrong-dimension', embedding: [1, 0, 0] },
        { id: 'zero', embedding: [0, 0] },
        { id: 'usable', embedding: [1, 0] },
      ],
      0.85,
    );
    expect(match?.id).toBe('usable');
  });

  it('answers null for an empty candidate set', () => {
    expect(bestTopicMatch(target, [], 0.85)).toBeNull();
  });
});
