import { describe, expect, it } from 'vitest';
import type { GradeState } from './parent-api';
import { newlyGradedCount, summaryOf, type ResultRowRef } from './results-summary';

/** Rows in the order given, each in the state named. Nothing newly graded. */
function rows(...states: GradeState[]): ResultRowRef[] {
  return states.map((state) => ({ state, newlyGraded: false }));
}

describe('summaryOf', () => {
  it('counts the wrong answers', () => {
    expect(summaryOf(rows('Incorrect', 'Correct', 'Incorrect')).incorrect).toBe(2);
  });

  it('counts the blanks', () => {
    expect(summaryOf(rows('Unanswered', 'Correct', 'Unanswered')).unanswered).toBe(2);
  });

  it('keeps the two apart, and counts neither Correct nor Ungraded as either', () => {
    // `Unanswered` is a Question the child chose to leave and it counts against
    // them; `Ungraded` is one nothing has judged and it is not a wrong answer at
    // all. A line that folded them together would tell a child they got something
    // wrong because grading failed.
    expect(summaryOf(rows('Correct', 'Ungraded', 'Ungraded'))).toEqual({
      incorrect: 0,
      unanswered: 0,
    });
    expect(summaryOf(rows('Incorrect', 'Unanswered'))).toEqual({ incorrect: 1, unanswered: 1 });
  });

  it('answers two zeroes for no rows at all', () => {
    expect(summaryOf([])).toEqual({ incorrect: 0, unanswered: 0 });
  });

  it('computes no denominator, and its shape is what says so', () => {
    // FR-37's denominator is the API's one answer, stated in `score` on the same
    // response as the rows. This module must never grow a second one, and the
    // assertion is over the whole returned shape rather than over one absent key —
    // so a `total`, a `denominator` or a `percentage` added later fails here.
    expect(
      Object.keys(summaryOf(rows('Correct', 'Incorrect', 'Unanswered', 'Ungraded'))).sort(),
    ).toEqual(['incorrect', 'unanswered']);
  });
});

describe('newlyGradedCount', () => {
  it('counts the rows this read judged, and only those', () => {
    expect(
      newlyGradedCount([
        { state: 'Correct', newlyGraded: true },
        { state: 'Incorrect', newlyGraded: true },
        { state: 'Correct', newlyGraded: false },
        { state: 'Ungraded', newlyGraded: false },
      ]),
    ).toBe(2);
  });

  it('answers zero when nothing was resolved, which is the ordinary read', () => {
    expect(newlyGradedCount(rows('Correct', 'Incorrect', 'Ungraded'))).toBe(0);
    expect(newlyGradedCount([])).toBe(0);
  });
});
