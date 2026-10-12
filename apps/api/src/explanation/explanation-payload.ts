import { parseRichText, plainTextOf, type RichText } from '../extraction/rich-text.js';
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
 * `parseRichText` is what decides that, so this covers an empty array, an array
 * of blanks, and a fraction with a zero denominator alike — all three are a
 * model that claimed to have written an explanation and did not. A figure the
 * sanitizer refuses lands here too, for the same reason and with the same
 * answer: ask again, store nothing.
 */
export const EXPLANATION_EMPTY = 'The payload holds no explanation.';

/** The body is longer than a child is ever going to be handed. */
export const EXPLANATION_TOO_LONG = 'The payload holds more prose than an explanation may carry.';

/** A replacement that says again what a parent removed. */
export const EXPLANATION_REPEATS_REMOVED = 'The payload repeats an explanation a parent removed.';

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
 *
 * The body is **normalized, not merely checked**: `parseRichText` rewrites what
 * it is given (AD-32), so the value returned here — and stored — is its output
 * and never the payload's own copy. The *explanation* wire still cannot carry a
 * figure (`GeneratedRichText`): an explanation is a sentence, and a figure
 * reaches that model as its `[Figure: <alt>]` projection. The generation wire is
 * no longer narrowed — since Story 4.8 a generated question prompt and a
 * Multiple Choice option body carry figures — so this normalization is what
 * holds the line here rather than the narrowing doing it.
 */
export function validateExplanationPayload(
  payload: ExplanationPayload,
  removed: readonly string[] = [],
): RichText {
  // The shape parsed; whether it says anything is this pass's question.
  let body: RichText;
  try {
    body = parseRichText(payload.body);
  } catch {
    throw new ExplanationPayloadInvalid(EXPLANATION_EMPTY);
  }
  const text = plainTextOf(body);
  if (text.length > MAX_EXPLANATION_LENGTH) {
    throw new ExplanationPayloadInvalid(EXPLANATION_TOO_LONG);
  }
  // A replacement exists because the earlier one was judged bad. The same prose back
  // — differing only in case, spacing or punctuation — is not a replacement, so it is
  // asked for again like any other payload that broke a rule.
  const said = comparable(text);
  if (removed.some((earlier) => comparable(earlier) === said)) {
    throw new ExplanationPayloadInvalid(EXPLANATION_REPEATS_REMOVED);
  }
  return body;
}

/** Prose reduced to its words, for "is this the same explanation" and nothing else. */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
