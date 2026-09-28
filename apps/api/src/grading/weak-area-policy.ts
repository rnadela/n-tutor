/**
 * What makes a Topic a **Weak Area** — the two figures and the single predicate,
 * stated here and restated nowhere.
 *
 * Story 7.2 stores a Mastery figure per (Student Profile, Topic). Nothing in that
 * row says whether the Topic is one the child is struggling with: that is a
 * judgement, and this module is the only place it is made. Every later surface —
 * Story 7.4's dashboard, Story 7.5's drill-down — classifies by calling
 * `isWeakArea`, never by comparing a percentage of its own.
 *
 * **Both figures are system-level and account-blind.** There is no per-parent,
 * per-profile or per-tier value and no column storing one: a Weak Area means the
 * same thing for every child in the system, and a parent cannot tune the bar their
 * own child is judged against. The env overrides below exist so the *operator* can
 * retune the product post-launch, which is a different act entirely.
 *
 * **The verdict is derived at read time and never persisted.** A stored boolean
 * would be correct only until the first retune and would then need a backfill
 * across every profile — the same silent-misreport failure a stale Mastery value
 * would be. The counts are already stored; the comparison is free.
 *
 * Pure apart from the one resolve-once env read, so every row of the story's
 * matrix is assertable without a database.
 */

import { requireIntEnv } from '../common/env.js';
import type { MasteryCounts } from './mastery.js';

/**
 * Below this percentage of answered Questions correct, a Topic is a Weak Area.
 *
 * **Strictly below.** Exactly 60% is not a Weak Area: the figure is the bar a child
 * has to fall under, not one they have to clear.
 */
export const WEAK_AREA_MASTERY_CEILING_PERCENT = 60;

/**
 * How many **answered** Questions a Topic needs before the fraction is allowed to
 * say anything at all.
 *
 * `unanswered` is not evidence and counts toward neither the fraction nor this
 * floor: a child who skipped nine Questions and answered four has answered four.
 *
 * The floor is measured over the **same five-Attempt window the Mastery figure is
 * over** — the stored counts *are* that window. A lifetime counter would be a
 * second answer to "how much has this child done on this Topic", and there is no
 * stored data supporting one. The ambiguity is recorded as still open at
 * `_bmad-output/specs/spec-n-test-reviewer/SPEC.md:113`; the window is the only
 * reading the stored data supports and the only one Story 7.2 built.
 */
export const WEAK_AREA_ANSWERED_FLOOR = 5;

export interface WeakAreaRuntime {
  /** The strict percentage ceiling, `1..100`. */
  ceilingPercent: number;
  /** The minimum answered Questions, at least 1. */
  answeredFloor: number;
}

let resolved: WeakAreaRuntime | null = null;

/**
 * Reads and checks both overrides once.
 *
 * Resolved at boot (`GradingModule` asks for it as it is constructed) rather than
 * on the first dashboard read, so a mistyped threshold is a process that refuses to
 * start — the way `pin-policy.ts` behaves — and never a 500 the first parent to
 * open the dashboard discovers.
 */
export function weakAreaRuntime(): WeakAreaRuntime {
  if (resolved === null) resolved = resolveWeakAreaRuntime();
  return resolved;
}

function resolveWeakAreaRuntime(): WeakAreaRuntime {
  const runtime: WeakAreaRuntime = {
    ceilingPercent: requireIntEnv(
      'WEAK_AREA_MASTERY_CEILING_PERCENT',
      WEAK_AREA_MASTERY_CEILING_PERCENT,
    ),
    answeredFloor: requireIntEnv('WEAK_AREA_ANSWERED_FLOOR', WEAK_AREA_ANSWERED_FLOOR),
  };
  // `requireIntEnv` already refuses zero, a negative and anything non-numeric. What
  // it cannot know is that this particular figure is a percentage: a ceiling above
  // 100 would make every Topic with any evidence a Weak Area, which is not a tuning
  // but a typo.
  if (runtime.ceilingPercent > 100) {
    throw new Error(
      `Environment variable WEAK_AREA_MASTERY_CEILING_PERCENT must be a percentage of 100 or less, got "${runtime.ceilingPercent}".`,
    );
  }
  return runtime;
}

/** Test seam: forgets the resolved values so a new environment is read. */
export function resetWeakAreaRuntime(): void {
  resolved = null;
}

/**
 * How many Questions of the window the child actually answered.
 *
 * The denominator of the Mastery fraction, and the figure the floor is measured
 * against — one definition for both, so the evidence the verdict rests on is always
 * exactly the evidence the percentage is over. `unanswered` is in neither.
 */
export function answeredOf(counts: MasteryCounts): number {
  return counts.correct + counts.incorrect;
}

/**
 * Whether these counts make the Topic a Weak Area.
 *
 * Two conditions, both required: enough answered Questions to be worth a judgement,
 * and a fraction strictly below the ceiling.
 *
 * **Integer arithmetic, deliberately.** `counts.value` is a float produced by
 * `correct / (correct + incorrect)`, and not every ratio equal to 60% is equal to
 * `0.6` once it has been through a division. Comparing
 * `correct * 100 < ceiling * answered` makes "exactly 60% is not a Weak Area" an
 * exact claim about whole numbers rather than one that depends on which ratio
 * produced the figure. `value` never decides this.
 *
 * A Topic with no answered Questions at all (`value` null) is below the floor for
 * every permitted floor, so it answers false without a special case.
 */
export function isWeakArea(counts: MasteryCounts): boolean {
  const { ceilingPercent, answeredFloor } = weakAreaRuntime();
  const answered = answeredOf(counts);
  if (answered < answeredFloor) return false;
  return counts.correct * 100 < ceilingPercent * answered;
}
