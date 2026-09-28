import type { GradeState } from '../generated/prisma/enums.js';

/**
 * FR-26's window and FR-26's fraction, as two pure functions.
 *
 * **One window rule and one formula, so no surface can compute a second Mastery.**
 * Every Epic 7 read — the dashboard, Weak Areas, the drill-down — states a figure
 * over the same five Attempts, and a second implementation beside any of them would
 * be a second answer that disagreed the first time either the window size or the
 * treatment of `Unanswered` was reconsidered.
 *
 * Not `grading-score.ts` reused, deliberately: an Attempt's score counts
 * `Unanswered` in its denominator because a Question the child chose to skip is a
 * Question they got no marks for *on that paper*. Mastery is a claim about what the
 * child knows, so a skipped Question is evidence of neither knowing nor not knowing
 * — it is reported, in its own count, and divided by nothing. Two denominators, two
 * functions, and the difference stated where both can be read.
 *
 * Pure and dependency-free, for the reason `mastery-eligibility.ts` gives: which
 * rows exist is an integration claim, what they come to is this.
 */

/**
 * How many qualifying Attempts a Mastery figure is over: the five most recent that
 * included the Topic.
 *
 * Exported as a constant rather than written into the slice below, so a later read
 * that needs to say "over your last five runs" reads *this* number instead of
 * repeating a literal.
 *
 * **Five and not all of them**, because Mastery is meant to move: a child who has
 * sat twenty papers on fractions and has got the last five right is not 40% at
 * fractions, and a figure that never recovered from a bad term would be a figure a
 * parent learned to ignore.
 */
export const MASTERY_ATTEMPT_WINDOW = 5;

/** One qualifying Attempt, as the window rule needs it. Nothing about its grades. */
export interface MasteryWindowAttempt {
  attemptId: string;
  /** Which paper it was a run at — what decides whether it included the Topic. */
  practiceTestId: string;
}

/**
 * The Attempts one Topic's Mastery is over, newest first.
 *
 * `attempts` arrives **already ordered newest-first and already qualifying** — the
 * caller has applied `countsTowardMastery` and the `submittedAt` filter, and the
 * order is the caller's deterministic `(submittedAt desc, id desc)`. Nothing here
 * sorts: a second ordering rule expressed over a subset of the columns would be a
 * second answer to "which five", and ties on a millisecond-resolution timestamp are
 * exactly where the two would differ.
 *
 * `testIds` is the set of Practice Tests that carry a tag for the Topic. An Attempt
 * at a paper that never mentioned the Topic is not part of that Topic's history, so
 * it is filtered out **before** the window is taken rather than after — otherwise a
 * child working through five papers on other subjects would push their fractions
 * history out of view without ever answering a question about fractions.
 */
export function masteryWindowOf(
  attempts: readonly MasteryWindowAttempt[],
  testIds: ReadonlySet<string>,
): MasteryWindowAttempt[] {
  return attempts
    .filter((attempt) => testIds.has(attempt.practiceTestId))
    .slice(0, MASTERY_ATTEMPT_WINDOW);
}

/**
 * One canonical Topic tag, as the window rule reads it: which Topic, which
 * Question, and which paper the Question is on.
 *
 * The three columns of `question_topic` and no more. Nothing about a grade, a
 * state or an ordinal — which paper mentions a Topic is the only question the
 * window asks.
 */
export interface TopicWindowTag {
  topicId: string;
  questionId: string;
  practiceTestId: string;
}

/**
 * One Topic's window, and the tagged Questions of each paper in it.
 *
 * Two groupings because the window rule and every rule downstream of it ask two
 * different questions: "which papers mention this Topic" settles the window, and
 * "which Questions of this paper are on it" is what the window is then read over.
 */
export interface TopicWindow {
  /** Newest first, capped at `MASTERY_ATTEMPT_WINDOW`. */
  window: MasteryWindowAttempt[];
  /** This Topic's tagged Question ids, keyed by Practice Test id. */
  questionIdsByTest: Map<string, string[]>;
}

/**
 * Every named Topic's window, resolved once from one set of Attempts and one set
 * of tags.
 *
 * **The one place a Topic's window is selected, and it has two callers.** The
 * recompute writes a figure from it; the drill-down lists the *members* of the
 * very same window so a parent reads the evidence the stored figure is over. A
 * second copy of this grouping beside either would be a second answer to "which
 * five", and the two would disagree the first time `MASTERY_ATTEMPT_WINDOW` or the
 * caller's tie-break moved — with one of them a stored number nobody could then
 * reconcile against the list under it.
 *
 * `attempts` arrives **already ordered newest-first and already qualifying**, on
 * `masteryWindowOf`'s terms and for its reasons: nothing here sorts, filters by
 * ordinal or reads a clock.
 *
 * A Topic no tag mentions answers an empty window and an empty grouping rather
 * than being absent from the map: every named Topic gets an answer, because a
 * caller that had to tell "no evidence" from "not asked about" would be a caller
 * deciding this rule for itself.
 */
export function topicWindowsOf(
  attempts: readonly MasteryWindowAttempt[],
  tags: readonly TopicWindowTag[],
  topicIds: readonly string[],
): Map<string, TopicWindow> {
  const testIdsByTopic = new Map<string, Set<string>>();
  const questionIdsByTopic = new Map<string, Map<string, string[]>>();
  for (const tag of tags) {
    const testIds = testIdsByTopic.get(tag.topicId);
    if (testIds === undefined) testIdsByTopic.set(tag.topicId, new Set([tag.practiceTestId]));
    else testIds.add(tag.practiceTestId);

    let byTest = questionIdsByTopic.get(tag.topicId);
    if (byTest === undefined) {
      byTest = new Map<string, string[]>();
      questionIdsByTopic.set(tag.topicId, byTest);
    }
    const questionIds = byTest.get(tag.practiceTestId);
    if (questionIds === undefined) byTest.set(tag.practiceTestId, [tag.questionId]);
    else questionIds.push(tag.questionId);
  }

  const windows = new Map<string, TopicWindow>();
  for (const topicId of topicIds) {
    windows.set(topicId, {
      window: masteryWindowOf(attempts, testIdsByTopic.get(topicId) ?? new Set()),
      questionIdsByTest: questionIdsByTopic.get(topicId) ?? new Map(),
    });
  }
  return windows;
}

/** What one Topic's window came to. The stored row is this plus `attemptsCounted`. */
export interface MasteryCounts {
  /** How many Questions of the window counted as `Correct`. */
  correct: number;
  /** How many counted as `Incorrect`. */
  incorrect: number;
  /**
   * How many were left blank on an unexpired hand-in — in neither term of the
   * fraction, and reported in its own right.
   */
  unanswered: number;
  /**
   * `correct / (correct + incorrect)`, or null when that denominator is zero.
   *
   * Null rather than `0`, because a window nobody answered is not a window the child
   * got nothing right on. A caller that shows a percentage has to say what null
   * means on its own surface.
   */
  value: number | null;
}

/**
 * One Topic's Mastery, from one entry per tagged Question of the window.
 *
 * The states are **effective** states — `effectiveStateOf` has already been applied,
 * so a parent's override is what counts here and the provider's stored verdict is
 * not. That resolution is `grading-override.ts`'s and is not repeated.
 *
 * `null` is a Question with no grade row, and it is treated exactly as `Ungraded`
 * is: in neither term and in no count at all. The two are the same fact — nothing
 * has judged this — and a Mastery that told them apart would report a different
 * denominator than the retry path works from.
 *
 * `Unanswered` is counted and divided by nothing, which is the whole difference
 * between Mastery and an Attempt's score. A blank on an **expired** Attempt never
 * reaches here as `Unanswered`: those are stored `Incorrect` at hand-in, so they
 * land in the denominator without any rule here saying so.
 */
export function masteryFrom(states: readonly (GradeState | null)[]): MasteryCounts {
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  for (const state of states) {
    if (state === 'Correct') correct += 1;
    if (state === 'Incorrect') incorrect += 1;
    if (state === 'Unanswered') unanswered += 1;
  }
  const denominator = correct + incorrect;
  return {
    correct,
    incorrect,
    unanswered,
    value: denominator === 0 ? null : correct / denominator,
  };
}

/**
 * Whether these counts are worth a stored row at all.
 *
 * **A row with no evidence is deleted, never stored as `0/0`.** A Topic whose whole
 * window is `Ungraded` or row-less has no Mastery, and a stored zero-everything row
 * would make Story 7.4's empty state — "Mastery appears once questions are answered"
 * — indistinguishable from a real zero.
 *
 * A window of nothing but blanks *is* evidence: the child was asked and skipped, and
 * that is a fact a parent is entitled to see reported even though it divides into no
 * fraction. So `unanswered` counts here while it counts in neither term of `value`.
 */
export function hasEvidence(counts: MasteryCounts): boolean {
  return counts.correct + counts.incorrect + counts.unanswered > 0;
}
