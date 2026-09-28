import { afterEach, describe, expect, it } from 'vitest';
import { GradingModule } from './grading.module.js';
import { resetWeakAreaRuntime } from './weak-area-policy.js';

/**
 * `GradingModule`'s constructor resolves `weakAreaRuntime()` so a mistyped Weak Area
 * threshold fails the process at boot rather than the first dashboard read — this
 * pins that wiring itself, not just the pure resolver logic `weak-area-policy.spec.ts`
 * already covers.
 *
 * Without this file, deleting the one line from the module constructor leaves the
 * whole suite green: the matrix row says "API refuses to boot", and boot is here.
 */
describe('GradingModule construction', () => {
  const savedCeiling = process.env.WEAK_AREA_MASTERY_CEILING_PERCENT;
  const savedFloor = process.env.WEAK_AREA_ANSWERED_FLOOR;

  afterEach(() => {
    if (savedCeiling === undefined) delete process.env.WEAK_AREA_MASTERY_CEILING_PERCENT;
    else process.env.WEAK_AREA_MASTERY_CEILING_PERCENT = savedCeiling;
    if (savedFloor === undefined) delete process.env.WEAK_AREA_ANSWERED_FLOOR;
    else process.env.WEAK_AREA_ANSWERED_FLOOR = savedFloor;
    resetWeakAreaRuntime();
  });

  it('refuses to construct when the Mastery ceiling is not a percentage', () => {
    // Above 100: every Topic with any evidence would be a Weak Area, which is a
    // typo rather than a tuning.
    process.env.WEAK_AREA_MASTERY_CEILING_PERCENT = '140';
    resetWeakAreaRuntime();
    expect(() => new GradingModule()).toThrow(/WEAK_AREA_MASTERY_CEILING_PERCENT/);
  });

  it('refuses to construct when the answered floor is zero', () => {
    // A Topic nobody answered is not evidence, so a floor of zero is not a floor.
    process.env.WEAK_AREA_ANSWERED_FLOOR = '0';
    resetWeakAreaRuntime();
    expect(() => new GradingModule()).toThrow(/WEAK_AREA_ANSWERED_FLOOR/);
  });

  it('constructs cleanly with a valid environment', () => {
    delete process.env.WEAK_AREA_MASTERY_CEILING_PERCENT;
    delete process.env.WEAK_AREA_ANSWERED_FLOOR;
    resetWeakAreaRuntime();
    expect(() => new GradingModule()).not.toThrow();
  });
});
