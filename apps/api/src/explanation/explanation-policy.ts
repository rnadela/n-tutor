/**
 * Every sentence this module refuses with, and the one bound it enforces.
 *
 * One file, exactly as `practice-test-policy.ts` is one file: a refusal written at
 * its throw site is a refusal that gets reworded by the next person who touches
 * that line, and a student surface whose whole discipline is "one sentence per
 * refusal" cannot afford two spellings of the same one.
 *
 * Nothing here names a tier, a limit, a price, a model or a provider (AD-20,
 * AD-26). None of those is a student-scoped fact, and a sentence a child reads is
 * the last place one should first appear.
 */

/**
 * Nothing of the Explanation Allowance is left this period.
 *
 * It names the allowance and states that it comes back; it does not name the
 * tier, the number, or what an upgrade would buy. **The blame is on the plan**,
 * never on the child and never on the asking: a child who has read ten
 * explanations has done nothing wrong, and a sentence that implied otherwise
 * would teach them not to ask.
 *
 * No exclamation mark and no apology. The web renders it with the instant the
 * period turns over, which the API states separately and this sentence therefore
 * does not restate — one figure, one source.
 */
export const NO_EXPLANATION_ALLOWANCE =
  'No Explanation Allowance is left this period. It resets at the start of the next one.';

/**
 * The Explanation could not be written.
 *
 * **One sentence for every failure class.** A provider that timed out, one that
 * refused on its own merits, one that answered in a shape the post-hoc pass kept
 * rejecting, and a request this service could not make are four different facts
 * about a system, and none of them is a fact about the Question or about the
 * child. Telling them apart on this surface would be publishing the shape of the
 * upstream to the one reader who can do nothing with it.
 *
 * It says what did not happen rather than what went wrong, and it leaves the
 * asking available: the results screen is untouched and the control is still
 * there to press.
 */
export const EXPLANATION_FAILED = 'This explanation could not be written just now.';

/**
 * The ceiling on a stored Explanation, in plain-text characters.
 *
 * Stated here because the wire schema cannot carry it: strict Structured Outputs
 * expresses no `maxLength`, so a string's only bound is whatever the model happens
 * to emit — and this one becomes a column and then a paragraph a child reads.
 *
 * **Re-asked rather than truncated**, which is the difference from
 * `MAX_RATIONALE_LENGTH`. A rationale is capped because a correct verdict is worth
 * keeping and the sentence is evidence beside it; an Explanation *is* the artifact,
 * and one cut off mid-thought is a paragraph that stops making sense exactly where
 * a child needed it to keep going. So an over-long payload is a rejection the
 * generation loop asks again on, and the whole thing is thrown away if it will not
 * come back short enough.
 *
 * A few short paragraphs pitched at a school grade fit inside this several times
 * over, so exceeding it is a model that ignored the instruction rather than a child
 * who needed the detail.
 */
export const MAX_EXPLANATION_LENGTH = 2_000;
