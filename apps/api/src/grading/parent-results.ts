import type { GradeState } from '../generated/prisma/enums.js';
import type { AttemptScore } from './grading-score.js';
import type { AnswerKeyRowView, AttemptResultsView } from './grading-results.js';

/**
 * One handed-in Attempt's results as the **parent** reads them: the child's row plus
 * the evidence an FR-25 override is decided on.
 *
 * **A separate shape rather than a widened `AttemptResultsView`, and that is the whole
 * point of the file.** `resultsFor`'s own comment — "a rationale this never selects is a
 * rationale no mapper can put on a student response" — is load-bearing, and a nullable
 * `rationale` on the shared row would make one field's presence depend on a runtime
 * branch: one read serving two audiences, with a scope check standing between a child
 * and a parent-scoped fact. A superset interface keeps the *shape* of the child's
 * response incapable of carrying any of this, which is a property of the type rather
 * than a habit of a mapper.
 *
 * It carries no cost, no tier, no model name and no allowance figure (AD-20, AD-26).
 * The rationale is prose a provider wrote for a parent to read, which is the one
 * parent-scoped fact here that has ever been anything but an id or an instant.
 */
export interface ParentAnswerKeyRowView extends AnswerKeyRowView {
  /**
   * Why the provider judged this answer the way it did, or null.
   *
   * **The evidence, and the reason the override exists at all.** FR-25's mitigation for
   * AI grading being harsh on phrasing is a parent reading the reason and disagreeing
   * with it, so the decision and the evidence are on one response and drawn beside each
   * other.
   *
   * Null for a deterministic Multiple Choice verdict, for `Unanswered` and for
   * `Ungraded`, because none of those is a judgement a provider explained — a row with
   * no rationale is not a row whose rationale failed to load.
   */
  rationale: string | null;
  /**
   * What the provider itself judged, whatever a parent later decided.
   *
   * **Retained and never overwritten**, which is the schema's promise made visible: the
   * `state` field above is the *effective* grade, and this is the stored one. On a row
   * nobody adjusted the two are equal, which is deliberate — a screen that had to infer
   * the AI's verdict from the absence of an override would be re-deriving a stored
   * column.
   */
  aiState: GradeState;
  /**
   * When a parent adjusted it, or null for a Question none has.
   *
   * Beside `parentAdjusted` rather than folded into it, because the parent's screen
   * states *when* a decision was made and a decision with no instant is one nobody can
   * date. Null exactly where `parentAdjusted` is false, and written in the same
   * statement the override is — so a screen never has to handle half an override.
   */
  overriddenAt: string | null;
  /**
   * When the child objected, or null for a Question they did not.
   *
   * The **first** instant, which the upsert keeps, so a second press cannot move it.
   * There is deliberately nothing beside it: no reason text, because the child is given
   * nowhere to write one, and no disposition, because FR-25 grants exactly one remedy and
   * it is the override. A dispute is resolved exactly when its Question carries one.
   */
  disputedAt: string | null;
}

/**
 * One handed-in Attempt's whole results as the parent reads them.
 *
 * The child's view's fields with the row type replaced, which is why this restates
 * `questions` rather than extending cleanly: TypeScript will not narrow an inherited
 * array member, and a cast at the mapper would be the type agreeing to something the
 * shape does not say.
 *
 * `originalScore` means here exactly what it means on the child's view — `scoreOf` over
 * the stored AI states, or null when no row on the Attempt carries an override — because
 * it is the same function over the same rows. One denominator, two calls, three surfaces.
 */
export interface ParentAttemptResultsView extends Omit<AttemptResultsView, 'questions'> {
  /**
   * Which child sat this run.
   *
   * **On the parent's view and not the child's**, where it would be the response telling a
   * child their own id back. It is here because FR-35's retained-work slot is keyed per
   * Student Profile server-side: a parent's picked-but-unsaved override has to be saved
   * under the child whose run it is, and a screen that guessed would restore one child's
   * decision onto another's paper.
   *
   * **Resolved from the Attempt row, never taken from a request.** There is no profile id in
   * any path on this surface — the account alone is the entitlement — so a child's id cannot
   * be paired with another child's Attempt because there is nowhere to put one, exactly as
   * `attemptProfileFor`'s own doc says.
   */
  studentProfileId: string;
  questions: ParentAnswerKeyRowView[];
}

/**
 * One dispute, as the parent's per-child list of them reads it.
 *
 * Modelled on `StudentFlagListEntry`: the ids, the instant, and the run and Question
 * context resolved through one batched `practicetest` read. Every context field is
 * nullable **together**, for a run or Question that no longer resolves — the entry keeps
 * its place and loses its labels, because whether an objection was raised is not
 * contingent on being able to name what it was about.
 *
 * **Resolution is derived and is not a column: a dispute is resolved exactly when its
 * Question carries an override.** So `overriddenAt` being set *is* the resolution, and
 * there is no `resolvedAt` and no `resolution` here for the same reason there is none on
 * the table — a second statement of a fact the grade row already makes is a second
 * statement that will drift.
 *
 * **It is emphatically not "the two states differ".** A parent who sets a mark and then
 * sets it back has decided twice and left `overriddenAt` set with `recordedState` and
 * `effectiveState` equal; reading resolution off the pair would report that dispute as
 * still awaiting them. `recordedState` and `effectiveState` are here so the parent can
 * see *what the decision came to*, which is a different question from whether one was
 * made.
 *
 * No prose here — a rationale is read next to the Question it is about, on the
 * Attempt-detail screen — and no score, cost, tier, model name or Mastery figure
 * (AD-20, AD-26). A dispute list is not the Analytics dashboard.
 */
export interface GradeDisputeListEntry {
  attemptId: string;
  questionId: string;
  /** When the child raised it. The first instant, which a repeat press cannot move. */
  disputedAt: string;
  /** What the provider judged, which is what the child objected to. */
  recordedState: GradeState;
  /** What counts now: the parent's decision where there is one, the provider's otherwise. */
  effectiveState: GradeState;
  /**
   * When a parent adjusted it, or null for one still awaiting a decision.
   *
   * This is the resolution, and the only field that states it. Null is "awaiting",
   * which is the absence of a decision rather than one somebody recorded.
   */
  overriddenAt: string | null;
  practiceTestId: string | null;
  /** Which run of that practice test it was, or null for a context that no longer resolves. */
  runOrdinal: number | null;
  /** The number the child was shown, or null for a context that no longer resolves. */
  questionOrdinal: number | null;
  subjectName: string | null;
  submittedAt: string | null;
}

/**
 * The prior figure, or null when there is no change to state — as one pure function.
 *
 * **Null rather than an identical fraction** is the rule, and it is stated once here so
 * that no surface has to compare two scores and decide for itself whether that counts as
 * a change. A parent who overrode an `Incorrect` to `Correct` and then back again has an
 * Attempt with two overrides on it and a prior score identical to the current one; that
 * is still a change *to the rows*, and the surfaces are told so, because the alternative
 * is a screen quietly dropping the fact that a grade was touched at all.
 *
 * So the condition is "does any row carry an override", not "do the two fractions
 * differ". `anyOverride` is the caller's answer to that, off the stored column.
 */
export function originalScoreOf(
  anyOverride: boolean,
  storedScore: AttemptScore,
): AttemptScore | null {
  return anyOverride ? storedScore : null;
}
