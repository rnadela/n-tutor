import type { GradeState } from '../generated/prisma/enums.js';
import type { AnswerKeyQuestion, AttemptAnswerKey } from '../practicetest/practice-test.service.js';
import type { RichText } from '../extraction/rich-text.js';
import type { AttemptScore } from './grading-score.js';

/**
 * One row of a handed-in Attempt's results, as the child reads it.
 *
 * `practicetest`'s answer key row plus the one fact only this module can state:
 * which of the four grade states the Question is in, and whether **this pass** is
 * what put it there.
 *
 * **There is deliberately no `rationale` field.** Not omitted by a mapper that
 * could be changed, and not selected by the read that composes this: a grading
 * rationale is a parent-scoped fact (AD-20, AD-26), and the way to keep it off a
 * child's screen is for the shape it would travel in not to exist. The same goes
 * for a Topic label, a cost, a tier and a model name — and, since Story 6.5, for the
 * AI's own verdict where a parent overrode it, the instant they did, and anything about
 * a dispute beyond the fact that this child raised one. The parent's superset row lives
 * in `parent-results.ts`, a separate shape, so the student response stays *incapable* of
 * carrying any of it rather than merely not carrying it today.
 *
 * `newlyGraded` is about this response and nothing else. A Question that was
 * already judged when this read began is not newly graded, however recently it was
 * judged.
 */
export interface AnswerKeyRowView {
  questionId: string;
  ordinal: number;
  format: AnswerKeyQuestion['format'];
  /** The stored segments, exactly as stored (AD-32). Null when unreadable. */
  prompt: RichText | null;
  /** What the child answered, as words. Null for a Question left blank. */
  studentAnswer: RichText | null;
  /** What the answer was, as words. Null when the stored key is unreadable. */
  correctAnswer: RichText | null;
  /**
   * One of the four states, and the one that **counts**. A Question with no grade row
   * reads `Ungraded`.
   *
   * Since Story 6.5 this is the *effective* state — `overrideState ?? state`, resolved
   * by `effectiveStateOf` — and not the provider's own verdict where a parent has
   * adjusted it. The field did not gain a sibling for the AI's verdict, deliberately:
   * that fact is parent-scoped (FR-25 makes the original grade the evidence a parent
   * decides on), and on this view it would be an AI-versus-parent mechanic on a child's
   * screen. It lives on `ParentAnswerKeyRowView` instead, which is a separate shape for
   * exactly that reason.
   */
  state: GradeState;
  /** Whether the read that produced this response is what judged it. */
  newlyGraded: boolean;
  /**
   * Whether a parent adjusted this grade.
   *
   * **A boolean, and the whole of what a child is told about it.** Not which way, not
   * from what, not when and not by whom: the row reads as the grade it now is, plus one
   * plain line that a parent reviewed it (AD-20, AD-26). A `from`/`to` pair here would
   * be the AI-versus-parent mechanic in a field, and an instant would be a date the
   * child would read as a deadline.
   *
   * It is what makes the adjustment visible at all. A grade that silently changed
   * between two visits would be a child doubting what they read the first time.
   */
  parentAdjusted: boolean;
  /**
   * Whether this Question has a dispute recorded against it.
   *
   * **The child's own objection and nobody else's.** A dispute is raised only by the
   * child who sat the Attempt, so there is no other person's this could be — which is
   * why it is a boolean and not an origin. It rides on this read rather than having one
   * of its own, so the control's state survives a reload with no second request.
   *
   * It says nothing about a decision: there is no dispute disposition in this system (the
   * override is the remedy, and `parentAdjusted` above is that fact), and a field for one
   * would be somewhere for a parent's judgement of their child to travel.
   */
  disputed: boolean;
}

/**
 * One handed-in Attempt's whole results, in one response.
 *
 * Every **presented** Question in stored ordinal order, plus the one score FR-37
 * allows. The score describes exactly the rows in this same response and is
 * computed by `scoreOf` over their states, so no surface can reach a second
 * denominator — and `denominator` may legitimately be 0, which the screen has to
 * say something true about rather than divide.
 *
 * It carries no rationale, no Topic label and no allowance, tier, cost or model
 * figure. None of those is a student-scoped fact, and nothing on this view has a
 * shape one could travel in.
 */
export interface AttemptResultsView {
  attemptId: string;
  practiceTestId: string;
  /** Null for a test whose Subject carries no classification or no longer resolves. */
  subjectName: string | null;
  questionCount: number;
  score: AttemptScore;
  /**
   * What this Attempt came to **before** any parent adjustment, or null when no row on
   * it carries an override.
   *
   * **`scoreOf` again, never a stored prior score.** `score` above is `scoreOf` over
   * effective states and this is `scoreOf` over the stored AI ones, so "11 of 15 became
   * 12 of 15" is derived from the same denominator rule as the figure it replaces. A
   * second column, or a subtraction here, would be a second answer to FR-37.
   *
   * **Null is the whole of "nothing was adjusted".** Not an identical fraction beside
   * the current one: every surface would then have to compare two figures and decide
   * for itself whether that counts as a change, which is four screens deriving one
   * fact. Null means there is no change to state, and a present value means there is.
   */
  originalScore: AttemptScore | null;
  questions: AnswerKeyRowView[];
}

/**
 * The answer key and the grade states, composed into rows — as one pure function.
 *
 * **In the key's order, which is stored ordinal order.** Nothing here sorts,
 * filters or groups: correct and incorrect rows sit where the child met them, and
 * a results screen that put the wrong answers together would be re-writing the
 * paper.
 *
 * **A Question with no grade row is `Ungraded`.** `scoreOf`'s own doc already
 * treats a missing row and a stored `Ungraded` as one fact — nothing has judged
 * this — and `resolveUngraded` re-asks for both. Flattening them here means the
 * screen has four states to draw rather than five, and the row a crash left behind
 * reads as the thing it is.
 *
 * Pure and file-local so the mapping is assertable without a database, for the
 * reason `grading-score.ts` gives.
 */
export function answerKeyRows(
  key: AttemptAnswerKey,
  /**
   * The state that **counts**, per Question — `effectiveStateOf` already applied by the
   * caller.
   *
   * The resolution is the caller's rather than this function's, and deliberately: there
   * is exactly one place a grade is "what counts" (`grading-override.ts`), and a second
   * `?? state` here would be a second one. What arrives is a decided state, so nothing
   * downstream of this can resolve it differently.
   */
  states: ReadonlyMap<string, GradeState>,
  newlyGradedQuestionIds: readonly string[],
  /** The Questions a parent adjusted. Absent is the same as none. */
  parentAdjustedQuestionIds: readonly string[] = [],
  /** The Questions the child objected to. Absent is the same as none. */
  disputedQuestionIds: readonly string[] = [],
): AnswerKeyRowView[] {
  const newly = new Set(newlyGradedQuestionIds);
  const adjusted = new Set(parentAdjustedQuestionIds);
  const disputed = new Set(disputedQuestionIds);
  return key.questions.map((question) => ({
    questionId: question.questionId,
    ordinal: question.ordinal,
    format: question.format,
    prompt: question.prompt,
    studentAnswer: question.studentAnswer,
    correctAnswer: question.correctAnswer,
    state: states.get(question.questionId) ?? 'Ungraded',
    newlyGraded: newly.has(question.questionId),
    parentAdjusted: adjusted.has(question.questionId),
    disputed: disputed.has(question.questionId),
  }));
}
