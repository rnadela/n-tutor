import type { GradeState } from '../generated/prisma/enums.js';
import type { AttemptRun } from '../practicetest/practice-test.service.js';
import { countsTowardMastery } from './mastery-eligibility.js';
import { scoreOf, type AttemptScore } from './grading-score.js';

/**
 * One finished run of a Practice Test, as the child's own home screen reads it.
 *
 * Which run it is, when it went in, what it came to, and whether it is the one that
 * counts toward progress. `score` is `scoreOf`'s — FR-37's one denominator — so no
 * surface can reach a second one.
 *
 * **There is deliberately no `rationale` field, no Topic, no cost, no tier, no
 * allowance and no model name.** Not omitted by a mapper that could be changed: the
 * read that composes this never selects a rationale at all, and this shape has no
 * field one could travel in (AD-20, AD-26).
 */
export interface AttemptRunView {
  attemptId: string;
  ordinal: number;
  submittedAt: string;
  score: AttemptScore;
  /** `grading`'s one predicate, stamped here rather than decided here. */
  countsTowardMastery: boolean;
}

/**
 * One Practice Test's run history, as one row of the child's home screen reads it.
 *
 * `attemptCount` is over **handed-in** runs only — a run still open is not a score
 * and is not counted — and `first` and `latest` are the two ends of that list.
 *
 * **Only two runs are scored, because only two are ever stated.** A child with five
 * finished runs is told the first one's figure, the latest one's figure and how many
 * there are; scoring the three in between would be three more reads answering a
 * question nothing asks.
 *
 * **A single run answers with `first` and `latest` naming the same `attemptId`.**
 * That is the shape a surface tells the two cases apart by: one run is
 * `first.attemptId === latest.attemptId` with `attemptCount: 1`, and the card then
 * states one figure with no first/latest framing. No arithmetic, no flag to get
 * wrong, and nothing that reads `attemptCount` as a proxy for "is there a history".
 */
export interface PracticeTestRunsView {
  practiceTestId: string;
  attemptCount: number;
  first: AttemptRunView;
  latest: AttemptRunView;
}

/**
 * The finished runs and their stored grade states, composed into one entry per
 * Practice Test — as one pure function.
 *
 * **In the order the runs arrive**, which is `practiceTestId asc, ordinal asc`: the
 * grouping is a walk rather than a sort, so this function neither reorders the runs
 * nor decides which test comes first. The surface that renders them has its own
 * order, and this is a lookup, never an order.
 *
 * Each named run is scored by padding its grade states to the run's own
 * `questionCount` with `null` per Question that has no row — exactly what
 * `GradingService.scoreFor` does, and for the same reason `scoreOf`'s doc gives: a
 * missing row and a stored `Ungraded` are the same fact, so a score that told them
 * apart would report a different denominator than the retry path works from.
 *
 * The states are keyed by `attemptId` and by nothing else, because two runs of the
 * same test have rows for the same Questions and a map keyed by Question alone
 * would let one run's verdicts score the other's. Each run's states arrive as a
 * list rather than per Question: `scoreOf` tallies them, so which Question a
 * verdict belongs to changes no figure here.
 *
 * Pure and file-local so the composition is assertable without a database, for the
 * reason `grading-score.ts` gives.
 */
export function runsOf(
  runs: readonly AttemptRun[],
  statesByAttempt: ReadonlyMap<string, readonly (GradeState | null)[]>,
): PracticeTestRunsView[] {
  const byTest = new Map<string, AttemptRun[]>();
  for (const run of runs) {
    const group = byTest.get(run.practiceTestId);
    if (group === undefined) byTest.set(run.practiceTestId, [run]);
    else group.push(run);
  }

  const views: PracticeTestRunsView[] = [];
  for (const [practiceTestId, group] of byTest) {
    const firstRun = group[0]!;
    const latestRun = group[group.length - 1]!;
    const first = viewOf(firstRun, statesByAttempt);
    // The **same object's data** when there is one run, so `first` and `latest`
    // cannot drift apart into two differently-rounded accounts of one run — and the
    // matching `attemptId` is what the surface reads the single-run case off.
    const latest = latestRun === firstRun ? first : viewOf(latestRun, statesByAttempt);
    views.push({ practiceTestId, attemptCount: group.length, first, latest });
  }
  return views;
}

/**
 * One run's view: its own score, over its own Questions, with the predicate stamped
 * from `mastery-eligibility` and never decided here.
 *
 * A run with no states given at all is a run nothing has judged, which scores as
 * every Question excluded rather than as an error: that is the state a crashed
 * grading pass leaves behind, and the figure has to say so.
 */
function viewOf(
  run: AttemptRun,
  statesByAttempt: ReadonlyMap<string, readonly (GradeState | null)[]>,
): AttemptRunView {
  const states = statesByAttempt.get(run.attemptId) ?? [];
  // Padded to the **presented** count, one entry per Question the child sat: a
  // Question with no row is `null`, which `scoreOf` excludes and counts as excluded.
  const padded = Array.from({ length: run.questionCount }, (_unused, at) => states[at] ?? null);
  return {
    attemptId: run.attemptId,
    ordinal: run.ordinal,
    submittedAt: run.submittedAt,
    score: scoreOf(padded),
    countsTowardMastery: countsTowardMastery(run.ordinal),
  };
}
