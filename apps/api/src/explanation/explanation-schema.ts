import { z } from 'zod';
import type { AiFakeFailure } from '../ai/ai-config.js';
import { RichText } from '../extraction/rich-text.js';

/**
 * The shape an Explanation must come back in: the JSON schema `zodTextFormat`
 * builds the Responses API's structured output from (AD-9), and the same schema
 * the fake transport's payload is parsed against, so both transports are held to
 * one contract.
 *
 * **It reuses `RichText` rather than declaring a string.** An Explanation talks
 * about fractions — that is most of what it is for — and a fraction that arrives
 * as `"1/2"` has already lost the reading "one half" that a child listening to the
 * page needs. One segment array, one parser, one renderer (AD-32): asking the
 * model for the same structure the Questions are stored in is what keeps a second
 * flattening from ever existing.
 *
 * **It is a wire contract as much as a type.** Strict Structured Outputs accepts a
 * small subset of JSON Schema: every property must be `required`, and `minItems`,
 * `maxItems`, `maxLength` and `refine` are not expressible at all. So nothing here
 * is optional and nothing here is bounded — both bounds live in
 * `explanation-payload.ts`, where they are actually enforced. A limit written here
 * would be one the API silently drops.
 *
 * There is exactly one field. No confidence, no difficulty rating, no "was the
 * student close" and no grade word: an Explanation is prose about the Question,
 * and a model that could name a verdict could contradict the one `grading`
 * already reached.
 */
export const ExplanationPayload = z.object({
  /** The explanation prose, as rich-text segments. */
  body: RichText,
});

export type ExplanationPayload = z.infer<typeof ExplanationPayload>;

/** The name the structured-output format is declared under. */
export const EXPLANATION_SCHEMA_NAME = 'question_explanation';

/**
 * What the `fake` transport answers with (AD-22).
 *
 * It lives here, beside the schema it has to satisfy, for the same reason the
 * prompt lives in this module: what a valid Explanation looks like is domain
 * knowledge, and `ai` would otherwise have to know what an Explanation is.
 *
 * The ordinal is written into the text so that an integration or end-to-end tier
 * can assert *which* Question was explained without a provider, and so two
 * explanations on one screen are visibly two.
 *
 * The three failure latches each keep producing their own fault at this seam
 * (AD-22): `transport` and `schema` are `ai`'s to raise before this builder's
 * output is ever parsed, and `unusable` — which has no meaning for a text call,
 * there being no photograph to be unreadable — answers with an empty segment
 * array, which the post-hoc pass rejects as an Explanation that explained nothing.
 */
export function fakeExplanationPayload(context: {
  ordinal: number;
  failure: AiFakeFailure;
}): ExplanationPayload {
  if (context.failure === 'unusable') return { body: [] };
  return {
    body: [
      {
        kind: 'text',
        value: `Here is why question ${context.ordinal} works the way it does. Start from what the question gives you, then take one step at a time until you reach the answer.`,
      },
    ],
  };
}
