import type { AttemptScorePoint } from '../grading/grading.service.js';
import type { TopicMasteryView } from '../grading/grading.service.js';
import type { AnswerKeyRowView } from '../grading/grading-results.js';
import type { TopicEvidenceRef } from '../grading/topic-evidence.js';
import type { TopicDescription } from '../topics/topic.service.js';
import type {
  PracticeTestReleasedSummary,
  QuestionEvidenceView,
  WeightedTargetView,
} from '../practicetest/practice-test.service.js';

/**
 * The dashboard's shape and its ranking, as interfaces and pure functions.
 *
 * **Pure and database-free on purpose.** Which rows exist is an integration claim
 * and has an int-spec; what order they come out in, and what a tally of them is,
 * is arithmetic — and arithmetic asserted through a database is arithmetic nobody
 * can read the counter-examples of. The same split `mastery.ts` and
 * `weak-area-policy.ts` already make.
 *
 * **Nothing here re-decides a Weak Area.** `isWeakArea` is resolved once, on the
 * way out of `masteryFor`, and every function below reads the boolean it produced.
 * A comparison here would be a second classifier that disagreed with the first the
 * day either threshold moved.
 *
 * No cost, tier, model name or grading rationale has a field on any of these
 * (AD-20, AD-26).
 */

/** One Topic's stored Mastery, named. */
export interface MasteryTopicView {
  topicId: string;
  /**
   * The Topic's name, or `null` for a stored figure whose `Topic` no longer
   * resolves.
   *
   * The row keeps its place and loses its label, exactly as an unresolvable
   * Subject does everywhere else: the child answered those Questions, and the
   * figure is still true whatever became of the row that named it.
   */
  topicName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  correct: number;
  incorrect: number;
  /**
   * How many Questions of the window were left blank.
   *
   * **It travels with the figure and is never optional.** A Mastery percentage
   * read without it is a percentage over an unstated denominator, and the two are
   * one fact rather than a figure and a footnote.
   */
  unanswered: number;
  /** `correct + incorrect` — the fraction's denominator and the floor's measure. */
  answered: number;
  attemptsCounted: number;
  value: number | null;
  /** The one classifier's verdict, resolved in `grading` and restated nowhere. */
  isWeakArea: boolean;
}

/** One handed-in Attempt on the dashboard's trend. */
export interface TrendPointView {
  attemptId: string;
  submittedAt: string;
  correct: number;
  /** FR-37's denominator. Zero is legitimate: an Attempt nothing could grade. */
  denominator: number;
  excludedUngraded: number;
}

/**
 * The dashboard's one trend, with the window it is over stated on itself.
 *
 * `windowSize` is the resolved constant and not a literal a surface repeats, so a
 * chart that says "your last five" says five because five is what was counted.
 */
export interface TrendView {
  windowSize: number;
  /** Oldest first — the order a line is read in, decided in `grading`. */
  points: TrendPointView[];
}

/** What is waiting for this child, across every released Practice Test. */
export interface ActivitySummaryView {
  released: number;
  unstarted: number;
  inProgress: number;
  completed: number;
}

/** What is waiting for the **parent** to decide. Counts only — no prose, ever. */
export interface DigestView {
  /** Disputes with no override recorded. Awaiting is the absence of a decision. */
  disputesAwaiting: number;
  /** Reported Explanations with no disposition recorded. Same rule, same reason. */
  explanationFlagsAwaiting: number;
}

/**
 * The Explanation Allowance, which is an **account** figure and not this child's.
 *
 * It is on a per-child dashboard because that is where a parent is standing when
 * the number matters, and the surface says whose it is. No tier name and no price
 * (AD-26): how much is left is a fact, what plan it came from is not this read's.
 */
export interface ExplanationAllowanceView {
  used: number;
  /** `null` is unlimited, and is never rendered as a number. */
  limit: number | null;
  /** When the counter resets, in the account's own zone. */
  resetAt: string;
  timezone: string;
}

/**
 * The two tunables the verdict was resolved against, sent so no surface restates
 * one.
 *
 * The empty state has to say "Mastery appears once N questions are answered on a
 * topic", and the only correct N is the one this process resolved at boot. A web
 * app carrying its own copy would drift silently the first time an operator
 * changed the environment.
 */
export interface WeakAreaPolicyView {
  ceilingPercent: number;
  answeredFloor: number;
}

/** The whole dashboard, as one read. */
export interface ProfileAnalyticsView {
  studentProfileId: string;
  /** Ranked weakest-first. The order is the answer; nothing downstream re-sorts. */
  topics: MasteryTopicView[];
  trend: TrendView;
  activity: ActivitySummaryView;
  digest: DigestView;
  explanationAllowance: ExplanationAllowanceView;
  weakArea: WeakAreaPolicyView;
}

/**
 * The stored figures, named and ranked weakest-first.
 *
 * The rule, in order, and every clause of it is a tie-break on the one before:
 *
 * 1. **Weak Areas first.** The dashboard's whole promise is "where is my child
 *    weak", so the answer to that question is not something a parent scrolls for.
 *    The verdict is the boolean `grading` resolved — never a comparison made here.
 * 2. **Ascending `value` within a group**, so the worst of the Weak Areas leads
 *    and the strongest Topic comes last.
 * 3. **`value: null` last within its group.** A Topic whose window the child
 *    skipped entirely has no fraction to be worse than anything, and sorting an
 *    absent figure as a zero would put "not attempted" above "got most of it
 *    wrong" — which is the one comparison this table must not make.
 * 4. **More evidence first** on an equal fraction: 4 of 10 is a firmer claim than
 *    2 of 5, and a parent reading down the list should meet the better-evidenced
 *    one first.
 * 5. **Then name, then id.** Not a preference — a total order. Two Topics equal on
 *    every figure above would otherwise swap places between two reads of the same
 *    unchanged data, and a table that reorders itself on refresh reads as a table
 *    that is telling you something changed.
 *
 * A row whose name no longer resolves sorts as the empty string at clause 5, which
 * puts the unnamed rows together rather than scattered — they are the rows a
 * parent can do least with.
 */
export function rankTopics(rows: readonly MasteryTopicView[]): MasteryTopicView[] {
  return [...rows].sort((left, right) => {
    if (left.isWeakArea !== right.isWeakArea) return left.isWeakArea ? -1 : 1;
    if (left.value !== right.value) {
      // Absent last, and never compared as a number: `null < 0.4` is true in
      // JavaScript, which is exactly the wrong answer.
      if (left.value === null) return 1;
      if (right.value === null) return -1;
      return left.value - right.value;
    }
    if (left.answered !== right.answered) return right.answered - left.answered;
    const byName = (left.topicName ?? '').localeCompare(right.topicName ?? '');
    if (byName !== 0) return byName;
    return left.topicId.localeCompare(right.topicId);
  });
}

/**
 * The stored Mastery rows joined to their names.
 *
 * The join is a lookup and not a filter: a row whose Topic is missing from the map
 * keeps its place with `topicName: null`. Dropping it would silently shorten a
 * parent's dashboard by exactly the rows that are hardest to explain.
 */
export function describedTopics(
  rows: readonly TopicMasteryView[],
  names: ReadonlyMap<string, TopicDescription>,
): MasteryTopicView[] {
  return rows.map((row) => {
    const described = names.get(row.topicId) ?? null;
    return {
      topicId: row.topicId,
      topicName: described?.name ?? null,
      subjectId: described?.subjectId ?? null,
      subjectName: described?.subjectName ?? null,
      correct: row.correct,
      incorrect: row.incorrect,
      unanswered: row.unanswered,
      answered: row.answered,
      attemptsCounted: row.attemptsCounted,
      value: row.value,
      isWeakArea: row.isWeakArea,
    };
  });
}

/**
 * What the child's released Practice Tests are, as four counts.
 *
 * `released` is the total and the three states partition it, so a surface can
 * state "2 of 5 finished" without adding anything up itself. The state is the one
 * `practicetest` derived; nothing here re-derives it from Attempts.
 */
export function activityOf(released: readonly PracticeTestReleasedSummary[]): ActivitySummaryView {
  let unstarted = 0;
  let inProgress = 0;
  let completed = 0;
  for (const test of released) {
    // **Exhaustive, with a `never` default.** An `else` arm would quietly count a
    // fourth `StudentListState` as finished, which is the one direction the error
    // must not go: a parent told their child has completed work they have not is
    // told the opposite of the truth. The `never` makes a new member a compile
    // error at exactly the place a decision has to be taken about it.
    switch (test.state) {
      case 'NotStarted':
        unstarted += 1;
        break;
      case 'InProgress':
        inProgress += 1;
        break;
      case 'Completed':
        completed += 1;
        break;
      default: {
        const unreachable: never = test.state;
        throw new Error(`Unhandled practice test state: ${String(unreachable)}`);
      }
    }
  }
  return { released: released.length, unstarted, inProgress, completed };
}

/**
 * How many entries are still waiting on a decision.
 *
 * The predicate is the caller's, because "awaiting" is a different **absence** on
 * each list — a null `overriddenAt` on a dispute, a null `disposition` on a report
 * — and both are absences rather than values somebody wrote. One counter over two
 * predicates keeps the digest from growing two tallies that could drift.
 */
export function countAwaiting<T>(rows: readonly T[], awaiting: (row: T) => boolean): number {
  let count = 0;
  for (const row of rows) if (awaiting(row)) count += 1;
  return count;
}

/**
 * One row of the drill-down's evidence: the shared answer-key row, plus which run
 * it came off and when that run was handed in.
 *
 * **`AnswerKeyRowView` and not a shape of its own**, because the five redundant
 * grade carriers, the paper-role prompt and the "no answer" treatment are already in
 * `components/AnswerKeyRow` and Story 7.4 built `WeakAreaMarker` for this screen to
 * reuse. A second row shape here would be the place the two rooms' grade semantics
 * drift.
 *
 * `newlyGraded` is always `false` on this surface: nothing on the drill-down grades
 * anything, so no read of it can be what judged a Question.
 *
 * The two extra fields are what one Attempt's row needs and the results screen does
 * not: a drill-down lists Questions from up to five different runs, so each row has
 * to say which run it was and when.
 */
export interface TopicDrillDownRowView extends AnswerKeyRowView {
  attemptId: string;
  submittedAt: string;
}

/**
 * The weighted-generation target, re-exported rather than restated.
 *
 * It is `practicetest`'s shape because the label on it is `practicetest`'s to
 * resolve: a second interface here would be a second place the contract between the
 * resolver and `request()` could be written down, and the two would drift the first
 * time either moved.
 */
export type { WeightedTargetView };

/** The whole drill-down, as one read. */
export interface TopicDrillDownView {
  topicId: string;
  /** The Topic's name, or null for a stored figure whose `Topic` no longer resolves. */
  topicName: string | null;
  subjectName: string | null;
  /**
   * The stored figure, with its unanswered count — or `null`.
   *
   * `null` is the whole of the empty drill-down, and it is the same answer a foreign
   * profile id, an unknown profile id and a Topic this child has no row for all get
   * (AD-18). The screen states one sentence for it and offers no fire.
   */
  mastery: MasteryTopicView | null;
  /** The Questions the child got wrong, newest run first. */
  missed: TopicDrillDownRowView[];
  /** The Questions they left blank, listed **apart** from the ones they got wrong. */
  unanswered: TopicDrillDownRowView[];
  /** The one upload a weighted regeneration can be aimed at, or null for none. */
  target: WeightedTargetView | null;
  /** The figures the verdict was resolved against, so the web states neither. */
  weakArea: WeakAreaPolicyView;
}

/**
 * The format a row whose stored Question could not be found reports.
 *
 * Every word of such a row is null, so the format is the one field that cannot
 * degrade to an absence without changing `AnswerKeyRowView`'s shape for every other
 * surface. The plainest of the three is chosen deliberately: the row says the answer
 * is unavailable in words, and "Short answer" is the reading least likely to be
 * mistaken for a claim about the Question.
 */
const UNREADABLE_FORMAT: AnswerKeyRowView['format'] = 'ShortAnswer';

/**
 * The refs joined to their words — the drill-down's rows, in the order they are read.
 *
 * **Arithmetic over two maps, and assertable with no database.** `grading` says
 * which `(Attempt, Question)` pairs a Topic's window holds and what each counts as;
 * `practicetest` says what each one asked and what was put down. This is the join,
 * and it is a lookup rather than a filter: **a ref whose evidence is missing keeps
 * its place with null words**. Dropping it would silently shorten the evidence behind
 * a figure by exactly the rows that are hardest to explain — and the figure above
 * would then be over more Questions than the list under it.
 *
 * **The order is finished here**, and this is the only place it can be: the refs
 * arrive newest-Attempt-first from `partitionTopicEvidence`, and the `ordinal` tie-break
 * within one run needs the number the child was shown — which is `practicetest`'s
 * column and reaches the composition only with the words. So the attempt order is
 * taken from the refs as given, never re-derived from a timestamp, and `ordinal`
 * settles the rest. A row with no evidence sorts as ordinal 0, which is no ordinal any
 * Question carries: they are 1-based, so it leads its own run rather than landing in an
 * arbitrary place among rows it cannot be compared with.
 */
export function drillDownRowsOf(
  refs: readonly TopicEvidenceRef[],
  evidence: ReadonlyMap<string, QuestionEvidenceView>,
): TopicDrillDownRowView[] {
  // First appearance of each Attempt in the refs as given — which is newest first,
  // decided once in `partitionTopicEvidence` and not re-decided here.
  const rank = new Map<string, number>();
  for (const ref of refs) if (!rank.has(ref.attemptId)) rank.set(ref.attemptId, rank.size);

  const ordinalOf = (ref: TopicEvidenceRef): number =>
    evidence.get(`${ref.attemptId}:${ref.questionId}`)?.ordinal ?? 0;

  return [...refs]
    .sort((left, right) => {
      const byAttempt = (rank.get(left.attemptId) ?? 0) - (rank.get(right.attemptId) ?? 0);
      if (byAttempt !== 0) return byAttempt;
      return ordinalOf(left) - ordinalOf(right);
    })
    .map((ref) => {
      const words = evidence.get(`${ref.attemptId}:${ref.questionId}`) ?? null;
      return {
        questionId: ref.questionId,
        attemptId: ref.attemptId,
        submittedAt: ref.submittedAt,
        ordinal: words?.ordinal ?? 0,
        format: words?.format ?? UNREADABLE_FORMAT,
        prompt: words?.prompt ?? null,
        studentAnswer: words?.studentAnswer ?? null,
        correctAnswer: words?.correctAnswer ?? null,
        // Already one of the two states its list is named after: the partition
        // narrowed it, so this is an assignment rather than an assertion. A default
        // here would invent a verdict for a Question nothing judged.
        state: ref.state,
        // Nothing on this surface grades, so no read of it can be what judged a row.
        newlyGraded: false,
        parentAdjusted: ref.parentAdjusted,
        disputed: ref.disputed,
      };
    });
}

/** The trend's points, with the score flattened onto each. */
export function trendPointsOf(points: readonly AttemptScorePoint[]): TrendPointView[] {
  return points.map((point) => ({
    attemptId: point.attemptId,
    submittedAt: point.submittedAt,
    correct: point.score.correct,
    denominator: point.score.denominator,
    excludedUngraded: point.score.excludedUngraded,
  }));
}
