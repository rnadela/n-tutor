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

import { PRACTICE_TEST_NOT_FOUND } from '../practicetest/practice-test-policy.js';

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

/**
 * There is no Explanation here to raise a concern about.
 *
 * **It is `PRACTICE_TEST_NOT_FOUND`, deliberately and by value.** A parent flagging
 * a Question their child never asked about, a parent flagging a Question of another
 * account's Attempt, one flagging an Attempt that never existed and one flagging an
 * Attempt still open are four facts, and a surface that spelled them apart would let
 * anything outside read which of another account's ids exist by reading which
 * sentence came back (AD-18). So the wording is the one sentence every ownership
 * refusal in this system already reuses, aliased here rather than re-spelled —
 * re-spelling it is how the two copies start to drift, and this file exists because
 * a refusal written at its throw site gets reworded by the next person on that line.
 *
 * **A flag needs no 409 and has none.** The second press is not a conflict: it is
 * the same concern, and the unique key `[explanationId, origin]` is what makes it
 * the same row rather than a refusal. So a repeat answers 200 with the instant the
 * flag was first recorded — there is nothing for a parent to resolve, nothing for
 * them to be told they already did, and no sentence to write about it.
 */
export const NO_EXPLANATION_TO_FLAG = PRACTICE_TEST_NOT_FOUND;

/**
 * There is no concern of the child's here for a parent to decide about.
 *
 * **`PRACTICE_TEST_NOT_FOUND` again, and by value for the same reason
 * `NO_EXPLANATION_TO_FLAG` is.** A parent disposing of a Question their child never
 * asked about, one whose Explanation nobody has reported, one on another account's
 * Attempt and one on an Attempt that never existed are four facts, and spelling them
 * apart would let anything outside read which of another account's ids exist by
 * reading which sentence came back (AD-18).
 *
 * It is a separate constant rather than the same one reused at the throw site because
 * the *reason* differs: there, no Explanation exists; here, one does and no child has
 * raised a concern about it. Two names for one sentence is the honest shape — one
 * spelling, two documented reasons — and the day either wording has to change, this
 * file is where both are.
 */
export const NO_STUDENT_FLAG_TO_DISPOSE = PRACTICE_TEST_NOT_FOUND;

/**
 * The parent already decided about this one, and the other way.
 *
 * **The one 409 the flag surface has.** A repeat of the *same* decision is not a
 * conflict — a double-tap is one decision, and it answers 200 with the instant the
 * decision was first recorded, exactly as a repeat flag press answers the first
 * flag's instant. A *different* decision is a conflict, because the first one stands:
 * reversal is not in FR-38, and a confirm that could be taken back would mean an
 * Explanation entering and leaving an operator's queue underneath them.
 *
 * It states that a decision is already recorded and that it stands. It names **no
 * child**, no Question, no instant, no tier and no number: the instants are the
 * response's and the screen states them from there, and a refusal that restated one
 * would be a second source for it.
 *
 * No apology and no instruction to try again, because trying again is exactly what
 * this refuses.
 */
export const FLAG_ALREADY_DISPOSED =
  'This report has already been decided, and the first decision stands.';
