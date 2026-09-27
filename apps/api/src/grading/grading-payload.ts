import type { GradingPayload } from './grading-schema.js';

/**
 * The deterministic post-hoc pass (AD-30): a schema-valid payload is not a
 * trusted payload.
 *
 * Everything here is pure and everything here is a rejection of the whole batch.
 * There is no repair path and no partial store: a verdict list that does not
 * answer exactly what was asked is a payload that judged nothing, and the call is
 * an upstream fault — the model was asked for a shape and answered with another.
 * `GradingService` therefore re-issues the call on a rejection, up to
 * `AI_MAX_ATTEMPTS`, and on exhaustion writes `Ungraded` rather than a guess.
 *
 * The canonical case is the one a model actually produces: told to answer for four
 * Questions, it answers for three. Three verdicts stored against four Questions
 * would leave the fourth silently unjudged with nothing to say so, and a verdict
 * matched to the wrong ordinal would be a grade for an answer nobody gave.
 */

/** The provider's fault (AD-31): retryable, and nothing is stored. */
export class GradingPayloadInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradingPayloadInvalid';
  }
}

export const VERDICT_COUNT_MISMATCH =
  'The payload does not hold one verdict for every question that was asked.';
export const VERDICT_ORDINAL_UNKNOWN = 'The payload holds a verdict for a question nobody asked.';
export const VERDICT_ORDINAL_DUPLICATED = 'The payload holds two verdicts for one question.';
export const VERDICT_ORDINAL_MISSING =
  'The payload holds no verdict for a question that was asked.';
export const RATIONALE_REQUIRED = 'A verdict must say why, in words.';

/**
 * The ceiling on a stored rationale, stated here because the wire schema cannot
 * carry it.
 *
 * Strict Structured Outputs expresses no `maxLength`, so a string's only bound is
 * whatever the model happens to emit — and this one becomes a column. Two plain
 * sentences fit inside it several times over, so a rationale longer than this is
 * a model that ignored the instruction rather than a parent who needs the detail:
 * it is **capped rather than rejected**, because a correct verdict is worth
 * keeping and re-asking would spend a second call to shorten a sentence.
 */
export const MAX_RATIONALE_LENGTH = 1_000;

/** One verdict, normalized and matched to the Question it answers. */
export interface NormalizedVerdict {
  ordinal: number;
  correct: boolean;
  /** Trimmed, collapsed and capped. Never blank. */
  rationale: string;
}

/**
 * One normalized verdict per asked ordinal, **in the order they were asked**.
 *
 * Rejects a missing ordinal, a duplicated one, an unknown one and a rationale
 * that is blank once trimmed. Returns in the asked order rather than the payload's
 * so a caller writing rows walks the Questions in the order the child was shown
 * them, whatever order the model answered in.
 */
export function validateGradingPayload(
  payload: GradingPayload,
  askedOrdinals: readonly number[],
): NormalizedVerdict[] {
  // Counted first, so the common shortfall gets the sentence that names it rather
  // than the one about whichever ordinal happened to be missing.
  if (payload.verdicts.length !== askedOrdinals.length) {
    throw new GradingPayloadInvalid(VERDICT_COUNT_MISMATCH);
  }

  const asked = new Set(askedOrdinals);
  const byOrdinal = new Map<number, NormalizedVerdict>();
  for (const verdict of payload.verdicts) {
    if (!asked.has(verdict.questionOrdinal)) {
      throw new GradingPayloadInvalid(VERDICT_ORDINAL_UNKNOWN);
    }
    if (byOrdinal.has(verdict.questionOrdinal)) {
      throw new GradingPayloadInvalid(VERDICT_ORDINAL_DUPLICATED);
    }
    const rationale = verdict.rationale.trim().replace(/\s+/gu, ' ');
    // A verdict with no reason is half a verdict: the rationale is the evidence a
    // parent decides an FR-25 override on, and an empty one would be a row that
    // looks explained and is not.
    if (rationale.length === 0) throw new GradingPayloadInvalid(RATIONALE_REQUIRED);
    byOrdinal.set(verdict.questionOrdinal, {
      ordinal: verdict.questionOrdinal,
      correct: verdict.correct,
      rationale: rationale.slice(0, MAX_RATIONALE_LENGTH),
    });
  }

  return askedOrdinals.map((ordinal) => {
    const verdict = byOrdinal.get(ordinal);
    // Unreachable while the count matches and no ordinal repeated, and checked
    // anyway: the alternative is a `!` that turns a future change to either rule
    // into an undefined row.
    if (verdict === undefined) throw new GradingPayloadInvalid(VERDICT_ORDINAL_MISSING);
    return verdict;
  });
}
