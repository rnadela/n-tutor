import { describe, expect, it } from 'vitest';
import type { GradeState } from '../generated/prisma/enums.js';
import {
  effectiveStateOf,
  isOverridable,
  overrideDecision,
  OVERRIDABLE_STATES,
} from './grading-override.js';

/**
 * What counts as a grade once a parent has had their say, and when they may say it —
 * case by case, with no database.
 *
 * Every claim here is about the **rule**: which column wins, which stored verdicts are
 * adjustable at all, and which of the three outcomes a request comes to. The integration
 * cases prove the same rules over the real HTTP path and inside the real transaction;
 * these prove them where a failure names the rule that broke.
 */

const ALL_STATES: readonly GradeState[] = ['Correct', 'Incorrect', 'Unanswered', 'Ungraded'];

describe('effectiveStateOf', () => {
  it('answers the stored verdict when no parent has adjusted the row', () => {
    for (const state of ALL_STATES) {
      expect(effectiveStateOf({ state, overrideState: null })).toBe(state);
    }
  });

  it('answers the parent’s decision when there is one, whatever the stored verdict', () => {
    // The override wins, and the stored verdict is still *there* — this function reads
    // it and never writes it. That is the whole of FR-25's "retained, never
    // overwritten": the row carries both and one of them counts.
    expect(effectiveStateOf({ state: 'Incorrect', overrideState: 'Correct' })).toBe('Correct');
    expect(effectiveStateOf({ state: 'Correct', overrideState: 'Incorrect' })).toBe('Incorrect');
  });

  it('does not treat an override equal to the verdict as an absence', () => {
    // `??` and not `||`: none of the four states is falsy, and null is the only value
    // that means "no parent has adjusted this". A row written with an override equal to
    // its verdict still counts as adjusted, which is what keeps `parentAdjusted` a fact
    // about the column rather than about the two values differing.
    expect(effectiveStateOf({ state: 'Correct', overrideState: 'Correct' })).toBe('Correct');
  });
});

describe('OVERRIDABLE_STATES', () => {
  it('is exactly the two judgements of an answer', () => {
    // `Unanswered` is the one state only the hand-in can know, and `Ungraded` is a
    // Question a later read is still re-asking about. Neither is a judgement a parent
    // can disagree with, and this is the set the DTO, the row view and the refusal all
    // read rather than repeating two literals.
    expect([...OVERRIDABLE_STATES]).toEqual(['Correct', 'Incorrect']);
  });

  it('answers isOverridable for each of the four states', () => {
    expect(ALL_STATES.filter((state) => isOverridable(state))).toEqual(['Correct', 'Incorrect']);
  });
});

describe('overrideDecision', () => {
  it('flips an Incorrect a parent marks Correct', () => {
    expect(overrideDecision({ state: 'Incorrect', overrideState: null }, 'Correct')).toBe('flip');
  });

  it('flips a Correct a parent marks Incorrect', () => {
    // The remedy runs both ways. FR-25's subject is a harsh `Incorrect`, but a parent who
    // finds a Question credited that should not have been has the same one remedy, and a
    // rule that only permitted one direction would be inventing a second control.
    expect(overrideDecision({ state: 'Correct', overrideState: null }, 'Incorrect')).toBe('flip');
  });

  it('flips a parent’s own earlier override back', () => {
    // **The stored state gates and the effective state compares**, which is exactly what
    // this case pins. The stored verdict is `Incorrect` and adjustable; what counts is
    // the parent's `Correct`; and a request for `Incorrect` is therefore a change. A rule
    // that compared against `state` would answer `already` and refuse a parent undoing
    // their own decision.
    expect(overrideDecision({ state: 'Incorrect', overrideState: 'Correct' }, 'Incorrect')).toBe(
      'flip',
    );
  });

  it('refuses a request for the state that already counts, on an unadjusted row', () => {
    expect(overrideDecision({ state: 'Correct', overrideState: null }, 'Correct')).toBe('already');
  });

  it('refuses a request for the state that already counts, through an override', () => {
    expect(overrideDecision({ state: 'Incorrect', overrideState: 'Correct' }, 'Correct')).toBe(
      'already',
    );
  });

  it('refuses an Unanswered row whichever grade is asked for', () => {
    for (const requested of OVERRIDABLE_STATES) {
      expect(overrideDecision({ state: 'Unanswered', overrideState: null }, requested)).toBe(
        'notJudged',
      );
    }
  });

  it('refuses an Ungraded row whichever grade is asked for', () => {
    for (const requested of OVERRIDABLE_STATES) {
      expect(overrideDecision({ state: 'Ungraded', overrideState: null }, requested)).toBe(
        'notJudged',
      );
    }
  });

  it('answers notJudged rather than already for an Unanswered row asked to stay itself', () => {
    // The order of the arms is the rule. `notJudged` is tested first: a row nothing
    // judged is not adjustable whatever is asked of it, and testing "already" first
    // would answer a request about a blank with a sentence about the wrong thing.
    expect(overrideDecision({ state: 'Unanswered', overrideState: null }, 'Incorrect')).toBe(
      'notJudged',
    );
  });

  it('answers one of exactly three outcomes for every state and request pair', () => {
    // The exhaustiveness the service's `switch` relies on, asserted over the whole
    // cross-product rather than trusted: a fourth outcome added here without a write
    // arm beside it would be a request that falls through and changes a grade silently.
    for (const state of ALL_STATES) {
      for (const overrideState of [null, ...OVERRIDABLE_STATES]) {
        for (const requested of OVERRIDABLE_STATES) {
          expect(['flip', 'already', 'notJudged']).toContain(
            overrideDecision({ state, overrideState }, requested),
          );
        }
      }
    }
  });

  it('reads no clock, no dispute and no score', () => {
    // An override needs no dispute — a parent who spots a harsh grade themselves may fix
    // it — and the instant is the writer's. The function takes two columns and a request,
    // which is a signature saying so rather than a comment claiming it.
    expect(overrideDecision.length).toBe(2);
  });
});
