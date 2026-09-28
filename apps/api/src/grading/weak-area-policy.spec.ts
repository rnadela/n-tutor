import { afterEach, describe, expect, it } from 'vitest';
import type { MasteryCounts } from './mastery.js';
import { masteryFrom } from './mastery.js';
import {
  WEAK_AREA_ANSWERED_FLOOR,
  WEAK_AREA_MASTERY_CEILING_PERCENT,
  answeredOf,
  isWeakArea,
  resetWeakAreaRuntime,
  weakAreaRuntime,
} from './weak-area-policy.js';

/**
 * Every row of the story's I/O matrix that needs no database.
 *
 * The counts are built through `masteryFrom` wherever the shape allows it, so these
 * cases are statements about the figures this system actually produces rather than
 * about hand-written literals that happen to be shaped like them.
 */

/** Counts as `masteryFrom` would produce them, without a window to run. */
function counts(correct: number, incorrect: number, unanswered = 0): MasteryCounts {
  return masteryFrom([
    ...Array.from({ length: correct }, () => 'Correct' as const),
    ...Array.from({ length: incorrect }, () => 'Incorrect' as const),
    ...Array.from({ length: unanswered }, () => 'Unanswered' as const),
  ]);
}

const SAVED = {
  ceiling: process.env.WEAK_AREA_MASTERY_CEILING_PERCENT,
  floor: process.env.WEAK_AREA_ANSWERED_FLOOR,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('WEAK_AREA_MASTERY_CEILING_PERCENT', SAVED.ceiling);
  restore('WEAK_AREA_ANSWERED_FLOOR', SAVED.floor);
  resetWeakAreaRuntime();
});

/** Puts the process on the shipped defaults, whatever the environment carries. */
function atDefaults(): void {
  delete process.env.WEAK_AREA_MASTERY_CEILING_PERCENT;
  delete process.env.WEAK_AREA_ANSWERED_FLOOR;
  resetWeakAreaRuntime();
}

describe('the answered count', () => {
  it('is the two answered terms and never the blanks', () => {
    expect(answeredOf(counts(2, 2, 9))).toBe(4);
  });

  it('is the denominator the fraction is over, so the two can never disagree', () => {
    const c = counts(3, 1, 5);
    expect(c.value).toBe(3 / answeredOf(c));
  });
});

describe('the Weak Area verdict', () => {
  afterEach(atDefaults);

  it('calls a Topic below the ceiling with enough evidence a Weak Area', () => {
    atDefaults();
    // 40% over five answered.
    expect(isWeakArea(counts(2, 3))).toBe(true);
  });

  it('withholds the verdict below the answered floor, however bad the fraction', () => {
    atDefaults();
    // 25%, but over four answered Questions — too little evidence to judge.
    expect(isWeakArea(counts(1, 3))).toBe(false);
  });

  it('treats exactly the ceiling as not a Weak Area — "below" is strict', () => {
    atDefaults();
    // 6/10 is exactly 60%.
    expect(isWeakArea(counts(6, 4))).toBe(false);
    // And one wrong answer more is under it.
    expect(isWeakArea(counts(5, 5))).toBe(true);
  });

  it('reaches the same boundary verdict whatever ratio produced the percentage', () => {
    atDefaults();
    // 3/5 and 6/10 are both exactly 60%; neither is a Weak Area, and the float
    // `value` is not what decides it.
    expect(isWeakArea(counts(3, 2))).toBe(false);
    expect(isWeakArea(counts(6, 4))).toBe(false);
    expect(isWeakArea(counts(12, 8))).toBe(false);
  });

  it('never lets blanks trip the alarm — `unanswered` is not evidence', () => {
    atDefaults();
    // 50% looks bad, but only four Questions were answered; the nine blanks count
    // toward neither the fraction nor the floor.
    const c = counts(2, 2, 9);
    expect(c.value).toBe(0.5);
    expect(isWeakArea(c)).toBe(false);
  });

  it('answers false for a Topic with no fraction at all', () => {
    atDefaults();
    const c = counts(0, 0, 8);
    expect(c.value).toBeNull();
    expect(isWeakArea(c)).toBe(false);
  });
});

describe('the figures as configuration', () => {
  afterEach(atDefaults);

  it('ships the stated defaults when nothing overrides them', () => {
    atDefaults();
    expect(weakAreaRuntime()).toEqual({
      ceilingPercent: WEAK_AREA_MASTERY_CEILING_PERCENT,
      answeredFloor: WEAK_AREA_ANSWERED_FLOOR,
    });
    expect(WEAK_AREA_MASTERY_CEILING_PERCENT).toBe(60);
    expect(WEAK_AREA_ANSWERED_FLOOR).toBe(5);
  });

  it('reclassifies the very same counts when the floor is lowered', () => {
    atDefaults();
    const c = counts(1, 3);
    expect(isWeakArea(c)).toBe(false);

    process.env.WEAK_AREA_ANSWERED_FLOOR = '3';
    resetWeakAreaRuntime();
    // Nothing about the counts changed: the verdict is derived, never stored.
    expect(isWeakArea(c)).toBe(true);
  });

  it('reclassifies the very same counts when the ceiling is lowered', () => {
    atDefaults();
    const c = counts(2, 3);
    expect(isWeakArea(c)).toBe(true);

    process.env.WEAK_AREA_MASTERY_CEILING_PERCENT = '30';
    resetWeakAreaRuntime();
    expect(isWeakArea(c)).toBe(false);
  });

  it('resolves once, so a change nothing reset is not seen mid-process', () => {
    atDefaults();
    expect(weakAreaRuntime().answeredFloor).toBe(WEAK_AREA_ANSWERED_FLOOR);
    process.env.WEAK_AREA_ANSWERED_FLOOR = '1';
    expect(weakAreaRuntime().answeredFloor).toBe(WEAK_AREA_ANSWERED_FLOOR);
  });
});

describe('a bad override', () => {
  afterEach(atDefaults);

  it('refuses a ceiling above 100, naming the variable', () => {
    process.env.WEAK_AREA_MASTERY_CEILING_PERCENT = '140';
    resetWeakAreaRuntime();
    expect(() => weakAreaRuntime()).toThrow(/WEAK_AREA_MASTERY_CEILING_PERCENT/);
  });

  it('accepts exactly 100 — every Topic with evidence, which is a tuning', () => {
    process.env.WEAK_AREA_MASTERY_CEILING_PERCENT = '100';
    resetWeakAreaRuntime();
    expect(weakAreaRuntime().ceilingPercent).toBe(100);
    expect(isWeakArea(counts(5, 0))).toBe(false);
    expect(isWeakArea(counts(4, 1))).toBe(true);
  });

  it('refuses a ceiling that is not a whole number rather than yielding NaN', () => {
    process.env.WEAK_AREA_MASTERY_CEILING_PERCENT = 'sixty percent';
    resetWeakAreaRuntime();
    expect(() => weakAreaRuntime()).toThrow(/WEAK_AREA_MASTERY_CEILING_PERCENT/);
  });

  it('refuses a floor of zero — a Topic nobody answered is not evidence', () => {
    process.env.WEAK_AREA_ANSWERED_FLOOR = '0';
    resetWeakAreaRuntime();
    expect(() => weakAreaRuntime()).toThrow(/WEAK_AREA_ANSWERED_FLOOR/);
  });
});
