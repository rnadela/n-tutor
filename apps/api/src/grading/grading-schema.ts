import { z } from 'zod';
import type { AiFakeFailure } from '../ai/ai-config.js';

/**
 * The shape a batch of grading verdicts must come back in: the JSON schema
 * `zodTextFormat` builds the Responses API's structured output from (AD-9), and
 * the same schema the fake transport's payload is parsed against, so both
 * transports are held to one contract.
 *
 * **It is a wire contract as much as a type.** Strict Structured Outputs accepts
 * a small subset of JSON Schema: every property must be `required`, and
 * `minItems`, `maxItems`, `maxLength` and `refine` are not expressible at all.
 * So nothing here is optional and nothing here is bounded — every ceiling lives
 * in `grading-payload.ts`, where it is actually enforced. A limit written here
 * would be one the API silently drops.
 *
 * A verdict is a boolean and not a state literal: `Unanswered` and `Ungraded` are
 * facts about the paper and about this service's own failures, and a model that
 * could name them could mark a child's answered Question as one of them.
 */

export const GradingVerdictPayload = z.object({
  /**
   * Which Question this is a verdict on, by the ordinal it was asked under.
   *
   * The ordinal rather than the Question's id: an id is a fact about this
   * deployment's rows and nothing the provider needs, and an opaque uuid in a
   * prompt is a token the model can mistranscribe into a verdict for a Question
   * nobody asked about.
   *
   * `int()` because an ordinal is a whole number: `1.5` and `-3` are neither of
   * them a Question, and left to `z.number()` they would parse cleanly here and
   * surface much later as the misleading "a verdict for a question nobody asked".
   */
  questionOrdinal: z.number().int(),
  correct: z.boolean(),
  /** One or two plain sentences addressed to the parent. */
  rationale: z.string(),
});

export const GradingPayload = z.object({
  verdicts: z.array(GradingVerdictPayload),
});

export type GradingVerdictPayload = z.infer<typeof GradingVerdictPayload>;
export type GradingPayload = z.infer<typeof GradingPayload>;

/** The name the structured-output format is declared under. */
export const GRADING_SCHEMA_NAME = 'grading_verdicts';

/** One Question as the fake is told about it, which is what it decides from. */
export interface FakeGradingQuestion {
  ordinal: number;
  /** Plain text of the stored correct answer. */
  correctAnswer: string;
  /** Exactly what the child typed or chose. */
  answerValue: string;
}

/**
 * What the `fake` transport answers with (AD-22).
 *
 * It lives here, beside the schema it has to satisfy, for the same reason the
 * prompt lives in this module: what a valid verdict looks like is domain
 * knowledge, and `ai` would otherwise have to know what grading is.
 *
 * **It decides `correct` by case- and whitespace-folded equality** of the child's
 * raw answer against the stored correct answer's plain text. That is what lets
 * the integration and end-to-end tiers assert a right answer, a wrong answer and
 * an equivalent-but-differently-written answer without a provider: the fixtures'
 * correct answers are the deterministic `Answer for <draftOrdinal>.<seq>` text,
 * so a padded and re-cased copy of one is `Correct` and anything else is not.
 *
 * The three failure latches each keep producing their own fault at this seam
 * (AD-22): `transport` and `schema` are `ai`'s to raise before this builder's
 * output is ever parsed, and `unusable` — which has no meaning for a text call,
 * there being no photograph to be unreadable — answers with an empty verdict
 * list, which the post-hoc pass rejects as a payload that judged nothing.
 */
export function fakeGradingPayload(context: {
  questions: readonly FakeGradingQuestion[];
  failure: AiFakeFailure;
}): GradingPayload {
  if (context.failure === 'unusable') return { verdicts: [] };
  return {
    verdicts: context.questions.map((question) => {
      const correct = fold(question.answerValue) === fold(question.correctAnswer);
      return {
        questionOrdinal: question.ordinal,
        correct,
        rationale: correct
          ? 'The answer matches what the question asked for.'
          : 'The answer does not match what the question asked for.',
      };
    }),
  };
}

/**
 * Casing and whitespace folded away, which is the tolerance the prompt asks a
 * real provider for and the most a deterministic fake can honestly offer.
 */
function fold(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}
