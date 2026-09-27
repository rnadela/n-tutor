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
 * for a Topic label, a cost, a tier and a model name.
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
  /** One of the four states. A Question with no grade row reads `Ungraded`. */
  state: GradeState;
  /** Whether the read that produced this response is what judged it. */
  newlyGraded: boolean;
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
  states: ReadonlyMap<string, GradeState>,
  newlyGradedQuestionIds: readonly string[],
): AnswerKeyRowView[] {
  const newly = new Set(newlyGradedQuestionIds);
  return key.questions.map((question) => ({
    questionId: question.questionId,
    ordinal: question.ordinal,
    format: question.format,
    prompt: question.prompt,
    studentAnswer: question.studentAnswer,
    correctAnswer: question.correctAnswer,
    state: states.get(question.questionId) ?? 'Ungraded',
    newlyGraded: newly.has(question.questionId),
  }));
}
