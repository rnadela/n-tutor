/**
 * What "answered" means on the Take Test screen, as a rule rather than as a
 * render.
 *
 * The question map's entire content is this claim, repeated once per Question,
 * and `apps/web` runs its unit tests without a DOM — so the rule lives here,
 * where it can be stated, rather than inside a component where it could only be
 * inspected through markup.
 *
 * Two words and no third. `Answered` and `Not answered` are the whole
 * vocabulary: nothing here knows or could know whether an answer is right, and
 * `Unanswered` is avoided on purpose because it reads as a grade state only
 * submission can claim.
 */

/**
 * The longest one answer may be, as the input enforces it.
 *
 * The same figure and the same rule as the API's own `MAX_ANSWER_LENGTH`, restated
 * here for the reason `attempt-store.ts` restates the TTL: this is a different
 * mechanism in a different place rather than the same one read twice. The server's
 * copy refuses a body; this one stops a child from typing past it in the first place,
 * which is the only version of the bound they ever experience.
 *
 * Without it the ceiling is discovered as an unexplained hand-in failure, after the
 * work is done — the one moment on this screen where a refusal cannot be acted on.
 */
export const MAX_ANSWER_LENGTH = 2000;

/** Where one Question stands. There is no correctness state, and never will be here. */
export type AnswerState = 'answered' | 'not-answered';

/** A Question, as much of it as progress depends on. */
export interface QuestionRef {
  id: string;
  /** The stored ordinal, which is what the child is shown and told. */
  ordinal: number;
}

/** One Question's place in the map. */
export interface QuestionProgress extends QuestionRef {
  state: AnswerState;
}

/**
 * Whether a Question has been answered.
 *
 * Trimmed, so a field emptied back to spaces returns to `Not answered` rather
 * than staying answered on whitespace nobody typed on purpose. An untouched
 * Question is `undefined` — absent from the map of answers, never `''` — so that
 * "never answered" and "answered then cleared" are the same state, because to a
 * child they are.
 */
export function isAnswered(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/**
 * How many of these Questions are answered.
 *
 * Counted over the order given, so a stale answer left behind for a Question
 * that is not in this test cannot inflate the figure.
 */
export function answeredCount(
  order: readonly QuestionRef[],
  answers: Readonly<Record<string, string>>,
): number {
  return order.reduce(
    (count, question) => (isAnswered(answers[question.id]) ? count + 1 : count),
    0,
  );
}

/**
 * Every Question's state, **in the order given**.
 *
 * The order is the server's stored ordinal order and this function preserves it
 * exactly: nothing here sorts, filters, reverses or groups. A map that reordered
 * itself as answers arrived would move the cell under the child's finger.
 */
export function progressOf(
  order: readonly QuestionRef[],
  answers: Readonly<Record<string, string>>,
): QuestionProgress[] {
  return order.map((question) => ({
    id: question.id,
    ordinal: question.ordinal,
    state: isAnswered(answers[question.id]) ? 'answered' : 'not-answered',
  }));
}
