import { isRichText, plainTextOf, type RichText } from '../extraction/rich-text.js';
import { MAX_EXPLANATION_LENGTH } from './explanation-policy.js';
import type { ExplanationPayload } from './explanation-schema.js';

/**
 * The deterministic post-hoc pass (AD-30): a schema-valid payload is not a
 * trusted payload.
 *
 * Everything here is pure and everything here is a rejection of the whole
 * payload. There is no repair path and no partial store: an Explanation that
 * explains nothing, or one that runs to a wall of text, is the provider's fault
 * (AD-31) — it was asked for a shape and answered with another — so
 * `ExplanationService` re-issues the call on a rejection, up to
 * `ai.config.maxAttempts`, and on exhaustion writes nothing and charges nothing.
 *
 * Both bounds are here rather than in the schema because strict Structured
 * Outputs can express neither: `minItems` and `maxLength` are silently dropped on
 * the wire, and a rule nothing enforces is worse than a rule nobody wrote.
 */

/** The provider's fault (AD-31): retryable, and nothing is stored. */
export class ExplanationPayloadInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExplanationPayloadInvalid';
  }
}

/**
 * The body held no usable segments.
 *
 * `isRichText` is what decides that, so this covers an empty array, an array of
 * blanks, and a fraction with a zero denominator alike — all three are a model
 * that claimed to have written an explanation and did not.
 */
export const EXPLANATION_EMPTY = 'The payload holds no explanation.';

/** The body is longer than a child is ever going to be handed. */
export const EXPLANATION_TOO_LONG = 'The payload holds more prose than an explanation may carry.';

/**
 * The stored segments, or a rejection.
 *
 * Returned rather than mutated, and **never truncated**: an Explanation cut off
 * mid-thought stops making sense exactly where the child needed it to keep going,
 * so an over-long payload is asked again for and thrown away if it will not come
 * back short enough. That is the one place this differs from grading's rationale
 * cap, and `MAX_EXPLANATION_LENGTH`'s own doc says why.
 *
 * Length is measured over the **plain rendering**, not over the JSON: a fraction
 * is one idea however many keys carry it, and counting the encoding would make
 * the ceiling depend on how the prose happened to be segmented.
 */
export function validateExplanationPayload(payload: ExplanationPayload): RichText {
  // The shape parsed; whether it says anything is this pass's question.
  if (!isRichText(payload.body)) throw new ExplanationPayloadInvalid(EXPLANATION_EMPTY);
  const body = payload.body as RichText;
  if (plainTextOf(body).length > MAX_EXPLANATION_LENGTH) {
    throw new ExplanationPayloadInvalid(EXPLANATION_TOO_LONG);
  }
  return body;
}
