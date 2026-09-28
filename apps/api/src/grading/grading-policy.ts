/**
 * Every sentence this module refuses an override or a dispute with.
 *
 * One file, exactly as `explanation-policy.ts` and `practice-test-policy.ts` are one
 * file each: a refusal written at its throw site is a refusal that gets reworded by the
 * next person who touches that line, and a student surface whose whole discipline is
 * "one sentence per refusal" cannot afford two spellings of the same one.
 *
 * Nothing here names a child, a Question, a number, a tier, a price, a model or a
 * provider (AD-20, AD-26). The instants and figures are the responses' and the screens
 * state them from there; a refusal that restated one would be a second source for it.
 */

import { PRACTICE_TEST_NOT_FOUND } from '../practicetest/practice-test-policy.js';

/**
 * There is no graded Question here for a child to object to.
 *
 * **It is `PRACTICE_TEST_NOT_FOUND`, deliberately and by value**, for the reason
 * `NO_EXPLANATION_TO_FLAG` is. A child disputing a Question of a sibling's Attempt, one
 * of another account's, one of an Attempt that never existed, one of an Attempt still
 * open and one of a Question that is not on that Practice Test are five facts — and a
 * surface that spelled them apart would let anything outside read which of another
 * account's ids exist by reading which sentence came back (AD-18). So the wording is the
 * one sentence every ownership refusal in this system already reuses, aliased here
 * rather than re-spelled.
 *
 * **A dispute needs no 409 and has none.** A second press is not a conflict: it is the
 * same objection, and the unique key `[attemptId, questionId]` is what makes it the same
 * row. So a repeat answers 200 with the instant the dispute was first recorded — there
 * is nothing for a child to be told they already did, and no sentence to write about it.
 *
 * It is also the only refusal the student side of this story has, which is what keeps
 * "every refusal on that surface is one sentence" literally true here.
 */
export const NO_GRADE_TO_DISPUTE = PRACTICE_TEST_NOT_FOUND;

/**
 * There is no graded Question here for a parent to adjust.
 *
 * **`PRACTICE_TEST_NOT_FOUND` again, and by value for the reason
 * `NO_GRADE_TO_DISPUTE` is.** A parent adjusting a Question of another account's
 * Attempt, one of an Attempt that never existed, one of an Attempt still open and one of
 * a Question with no grade row at all are four facts, and spelling them apart would let
 * anything outside read which of another account's ids exist by reading which sentence
 * came back (AD-18).
 *
 * Its own name rather than the same constant reused at the throw site, because the
 * *reason* differs and this file follows `explanation-policy.ts`'s convention that each
 * reason gets its own name: there, a child is objecting; here, a parent is adjusting.
 * Two names for one sentence is the honest shape — one spelling, two documented
 * reasons — and the day the wording has to change, this file is where both are.
 *
 * It is **not** either 409 below. A Question with no grade row at all is this 404; a
 * Question whose grade is not a judgement is `GRADE_NOT_JUDGED`, which is a state the
 * parent can read and understand rather than an id that names nothing.
 */
export const NO_GRADE_TO_OVERRIDE = PRACTICE_TEST_NOT_FOUND;

/**
 * The grade the parent is asking for is the grade that already counts.
 *
 * **A 409 and not a 200.** The parent is asking for a change and there is none to make:
 * answering 200 with the unchanged row would make "nothing happened" and "it worked" the
 * same response, and a stale tab's second press would read as a second decision. It is
 * not a 403 either — they are entitled to the Attempt and to the row, which is how they
 * came to be looking at it.
 *
 * **Unlike a repeat suppression, a repeat override is not absorbed.** Suppression is one
 * irreversible act whose first instant is the fact, so a double-tap there is one
 * decision; an override is a *statement* about a grade that may legitimately be made
 * again in the other direction, so "it is already that" is information rather than
 * noise.
 *
 * It names **no child, no Question, no number, no instant and no tier**: the effective
 * grade and the score are on the response and the screen states them from there.
 *
 * No apology and no instruction to try again, because trying again is exactly what this
 * refuses.
 */
export const GRADE_ALREADY_RECORDED = 'That grade is already recorded for this question.';

/**
 * Nothing judged this answer, so there is nothing to disagree with.
 *
 * **A 409 and not a 404.** The parent is entitled to the Attempt and to the row, and
 * what is missing is a *judgement* — the stored state is `Unanswered` (a blank on a
 * paper handed in early, which only the hand-in can know) or `Ungraded` (a Question a
 * later read is still re-asking about). Neither is a verdict on an answer, and FR-25's
 * whole subject is an answer a provider judged.
 *
 * It names no child, no Question, no number and no tier — and in particular it does not
 * name which of the two states the row is in: that is a fact about the system's own
 * plumbing, and the parent's screen already says whether a Question was left blank or is
 * still being graded. This is the sentence a parent would see only by pressing a control
 * the screen does not render — the row view and this refusal read the one predicate
 * (`OVERRIDABLE_STATES`) — so it is written for a stale tab rather than for a dead end.
 *
 * No instruction beyond the one thing that would change the answer: a graded answer.
 */
export const GRADE_NOT_JUDGED =
  'Only a question that was marked right or wrong can be adjusted. This one was not.';
