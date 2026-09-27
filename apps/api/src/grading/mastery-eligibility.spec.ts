import { describe, expect, it } from 'vitest';
import { MASTERY_ATTEMPT_ORDINAL, countsTowardMastery } from './mastery-eligibility.js';

/**
 * The Mastery predicate, case by case.
 *
 * Small on purpose: the whole value of the rule is that it exists **once**, so what
 * is asserted here is the rule itself and not a surface that happens to use it.
 */
describe('countsTowardMastery', () => {
  it('counts the first run', () => {
    expect(countsTowardMastery(1)).toBe(true);
  });

  it('does not count any retake', () => {
    // A retake is excluded by being a later run, not by a filter somebody wrote at a
    // call site — which is the whole point of stating it here.
    expect(countsTowardMastery(2)).toBe(false);
    expect(countsTowardMastery(3)).toBe(false);
    for (let ordinal = 4; ordinal <= 20; ordinal += 1) {
      expect(countsTowardMastery(ordinal)).toBe(false);
    }
  });

  it('compares against the exported constant rather than a literal of its own', () => {
    // The constant is what Epic 7 will read. If the predicate stopped agreeing with
    // it, two answers to "which run counts" would exist in the one file that is
    // supposed to hold exactly one.
    expect(countsTowardMastery(MASTERY_ATTEMPT_ORDINAL)).toBe(true);
    expect(countsTowardMastery(MASTERY_ATTEMPT_ORDINAL + 1)).toBe(false);
  });

  it('says nothing about an ordinal no Attempt can have', () => {
    // `ordinal` is 1-based and written by the insert, never by a request. Zero and
    // negatives are not runs, and the predicate does not invent a meaning for them.
    expect(countsTowardMastery(0)).toBe(false);
    expect(countsTowardMastery(-1)).toBe(false);
  });
});
