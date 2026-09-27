import { describe, expect, it } from 'vitest';
import type { GradeState } from '../generated/prisma/enums.js';
import { scoreOf } from './grading-score.js';

/**
 * FR-37's denominator column, case by case.
 *
 * Every claim here is about **one** literal's treatment, because that is what the
 * table fixes: whether a state earns credit, whether it is counted against the
 * child, and whether it is in the denominator at all. Pure, so the column is
 * assertable without a database and without a provider.
 */
describe('scoreOf', () => {
  it('gives Correct credit and counts it', () => {
    expect(scoreOf(['Correct', 'Correct'])).toEqual({
      correct: 2,
      denominator: 2,
      excludedUngraded: 0,
    });
  });

  it('counts Incorrect and gives it no credit', () => {
    expect(scoreOf(['Correct', 'Incorrect'])).toEqual({
      correct: 1,
      denominator: 2,
      excludedUngraded: 0,
    });
  });

  it('counts Unanswered and gives it no credit', () => {
    // The whole difference between this and `Ungraded`: a Question the child chose
    // to leave blank is a Question they got no marks for.
    expect(scoreOf(['Correct', 'Unanswered'])).toEqual({
      correct: 1,
      denominator: 2,
      excludedUngraded: 0,
    });
  });

  it('excludes Ungraded from the denominator and reports how many it excluded', () => {
    expect(scoreOf(['Correct', 'Incorrect', 'Ungraded'])).toEqual({
      correct: 1,
      denominator: 2,
      excludedUngraded: 1,
    });
  });

  it('treats a Question with no row exactly as it treats Ungraded', () => {
    // The two are one fact — nothing has judged this — and `resolveUngraded`
    // re-asks for both, so a score that told them apart would report a different
    // denominator than the retry path works from.
    const withNull = scoreOf(['Correct', null]);
    const withUngraded = scoreOf(['Correct', 'Ungraded']);
    expect(withNull).toEqual(withUngraded);
    expect(withNull).toEqual({ correct: 1, denominator: 1, excludedUngraded: 1 });
  });

  it('answers a zero denominator for an Attempt nothing could grade, and does not divide by it', () => {
    expect(scoreOf(['Ungraded', 'Ungraded', null])).toEqual({
      correct: 0,
      denominator: 0,
      excludedUngraded: 3,
    });
    // Nothing here divides: the fraction is the caller's to state, and this says
    // plainly that there is no denominator to state it over.
    expect(scoreOf([])).toEqual({ correct: 0, denominator: 0, excludedUngraded: 0 });
  });

  it('excludes nothing from a fully graded Attempt', () => {
    const states: GradeState[] = ['Correct', 'Correct', 'Incorrect', 'Unanswered'];
    expect(scoreOf(states)).toEqual({ correct: 2, denominator: 4, excludedUngraded: 0 });
  });

  it('answers the matrix case the story states', () => {
    // 15 presented: 11 Correct, 2 Incorrect, 1 Unanswered, 1 Ungraded.
    const states: (GradeState | null)[] = [
      ...Array.from({ length: 11 }, () => 'Correct' as GradeState),
      'Incorrect',
      'Incorrect',
      'Unanswered',
      'Ungraded',
    ];
    expect(scoreOf(states)).toEqual({ correct: 11, denominator: 14, excludedUngraded: 1 });
  });
});
