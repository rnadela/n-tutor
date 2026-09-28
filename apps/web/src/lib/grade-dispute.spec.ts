import { describe, expect, it } from 'vitest';
import {
  disputeDecision,
  disputeOutcomeOf,
  flipOf,
  overrideScope,
  retainedOverrideOf,
  scoreChangeOf,
} from './grade-dispute';
import type { AttemptScore, GradeState } from './parent-api';

/**
 * What a dispute press means, how a changed score is stated, what a dispute has come to, and
 * which mark a parent is offered — case by case, with no DOM.
 *
 * `apps/web` runs its unit tests with `environment: 'node'`, which is why these rules live in
 * `src/lib` at all: a rule that only existed inside an event handler would be a rule nothing
 * could assert. The rendered specs beside the components prove that each screen *uses* these;
 * this file proves what they say.
 */

const ALL_STATES: readonly GradeState[] = ['Correct', 'Incorrect', 'Unanswered', 'Ungraded'];

function score(correct: number, denominator = 4, excludedUngraded = 0): AttemptScore {
  return { correct, denominator, excludedUngraded };
}

describe('disputeDecision', () => {
  it('sends on a first press with a connection', () => {
    expect(disputeDecision({ online: true, disputed: false, sending: false })).toBe('request');
  });

  it('sends nothing at all once the objection is recorded', () => {
    // There is no un-saying: a record of an objection is not a toggle, and the API would
    // answer the first instant anyway — so the round trip is one nobody needs.
    expect(disputeDecision({ online: true, disputed: true, sending: false })).toBe('already');
  });

  it('prefers "already" over every other arm, busy and offline included', () => {
    // The order of the arms is the rule: an existing objection means nothing needs sending
    // whatever else is in flight and whatever the connection is doing.
    expect(disputeDecision({ online: false, disputed: true, sending: true })).toBe('already');
  });

  it('swallows a second press while one is out', () => {
    // Two responses landing in either order would tell the child twice that something
    // happened once.
    expect(disputeDecision({ online: true, disputed: false, sending: true })).toBe('busy');
  });

  it('swallows a press with no connection before anything leaves the device', () => {
    expect(disputeDecision({ online: false, disputed: false, sending: false })).toBe('offline');
  });

  it('checks busy before the connection', () => {
    expect(disputeDecision({ online: false, disputed: false, sending: true })).toBe('busy');
  });

  it('has no arm for a mark that could not be adjusted', () => {
    // The refusals for an unanswered or ungraded question are the *parent's*, at the point a
    // mark would change. A child may say any mark looks wrong, and a browser-side rule that
    // stopped them would be enforcing a mechanic they are never shown.
    expect(disputeDecision.length).toBe(1);
  });
});

describe('scoreChangeOf', () => {
  it('states nothing when the server sent no prior figure', () => {
    expect(scoreChangeOf(score(3), null)).toBeNull();
  });

  it('states both counts and the one denominator when there is a change', () => {
    expect(scoreChangeOf(score(3), score(2))).toEqual({ before: 2, after: 3, denominator: 4 });
  });

  it('still states a change when the two counts agree', () => {
    // A parent who set a mark and then set it back touched a mark, and the server says so by
    // sending a prior figure at all. Dropping the sentence because the numbers agree would be
    // this browser second-guessing that.
    expect(scoreChangeOf(score(2), score(2))).toEqual({ before: 2, after: 2, denominator: 4 });
  });

  it('states nothing for a pair over two different denominators', () => {
    // It cannot happen — an adjustment moves a question between right and wrong and never
    // into or out of the count — but a screen handed a pair it cannot state over one total
    // must say nothing rather than invent a second denominator.
    expect(scoreChangeOf(score(3, 4), score(2, 5))).toBeNull();
  });

  it('subtracts nothing and divides nothing', () => {
    // Both counts are handed on as the server stated them: no difference, no percentage.
    const change = scoreChangeOf(score(4), score(1));
    expect(change).toEqual({ before: 1, after: 4, denominator: 4 });
  });

  it('carries a zero denominator through rather than dividing by it', () => {
    expect(scoreChangeOf(score(0, 0, 4), score(0, 0, 4))).toEqual({
      before: 0,
      after: 0,
      denominator: 0,
    });
  });
});

describe('disputeOutcomeOf', () => {
  it('reads a dispute with no adjustment as awaiting', () => {
    expect(disputeOutcomeOf({ overriddenAt: null })).toBe('awaiting');
  });

  it('reads a dispute whose question a parent adjusted as resolved', () => {
    expect(disputeOutcomeOf({ overriddenAt: '2026-09-28T10:00:00.000Z' })).toBe('resolved');
  });

  it('has no third outcome, and in particular no dismissal', () => {
    // The one remedy is the parent setting the mark, so a parent who reads a dispute and
    // agrees with the marking leaves it awaiting. A third value would be an outcome nobody
    // recorded, which the next reader would go looking for a writer for.
    expect(
      [{ overriddenAt: null }, { overriddenAt: '2026-09-28T10:00:00.000Z' }].map(disputeOutcomeOf),
    ).toEqual(['awaiting', 'resolved']);
  });
});

describe('flipOf', () => {
  it('offers the other judgement for each of the two marks', () => {
    expect(flipOf('Correct')).toBe('Incorrect');
    expect(flipOf('Incorrect')).toBe('Correct');
  });

  it('offers nothing for a question that was never judged', () => {
    // The same set the API refuses with its own 409 — one predicate, read by the control a
    // parent is offered and by the refusal they would get, so a control is never drawn for a
    // press that cannot succeed.
    expect(flipOf('Unanswered')).toBeNull();
    expect(flipOf('Ungraded')).toBeNull();
  });

  it('answers for every state the enum has', () => {
    for (const state of ALL_STATES) {
      expect(() => flipOf(state)).not.toThrow();
    }
  });
});

describe('overrideScope', () => {
  it('names the Attempt and the Question together', () => {
    // A scope of the Attempt alone would restore one Question's pick onto every row of the
    // paper; a scope of the Question alone would carry a pick across two runs of the same
    // practice test, which present the same Question ids.
    expect(overrideScope('a1', 'q1')).toBe('a1:q1');
    expect(overrideScope('a1', 'q2')).not.toBe(overrideScope('a1', 'q1'));
    expect(overrideScope('a2', 'q1')).not.toBe(overrideScope('a1', 'q1'));
  });
});

describe('retainedOverrideOf', () => {
  const scope = overrideScope('a1', 'q1');
  function slot(overrides: Partial<{ kind: string; scope: string; payload: unknown }> = {}) {
    return { kind: 'GradeOverride', scope, payload: { state: 'Correct' }, ...overrides };
  }

  it('restores a pick a parent made before Parent View closed', () => {
    expect(retainedOverrideOf(slot(), scope, 'Incorrect')).toBe('Correct');
  });

  it('ignores a slot of another kind', () => {
    // The mechanism is shared with the draft editor, so the kind is what tells one parent's
    // retained work from another's.
    expect(retainedOverrideOf(slot({ kind: 'DraftEdit' }), scope, 'Incorrect')).toBeNull();
  });

  it('ignores a slot filed under another Question or another run', () => {
    expect(
      retainedOverrideOf(slot({ scope: overrideScope('a1', 'q2') }), scope, 'Incorrect'),
    ).toBeNull();
    expect(
      retainedOverrideOf(slot({ scope: overrideScope('a2', 'q1') }), scope, 'Incorrect'),
    ).toBeNull();
  });

  it('ignores a payload that is not an object', () => {
    // A slot is opaque JSON. An unchecked field would land in a control as `undefined` and
    // take the row with it.
    for (const payload of [null, 'Correct', 42, []]) {
      expect(retainedOverrideOf(slot({ payload }), scope, 'Incorrect')).toBeNull();
    }
  });

  it('ignores a state that is not one of the two adjustable marks', () => {
    for (const state of ['Unanswered', 'Ungraded', 'Perfect', 7, null, undefined]) {
      expect(retainedOverrideOf(slot({ payload: { state } }), scope, 'Incorrect')).toBeNull();
    }
  });

  it('ignores a pick for the mark that already counts', () => {
    // The API would refuse it with its own 409, and offering a save that cannot succeed is
    // worse than offering nothing. A slot saved before somebody else set the same mark is
    // exactly how this state arises.
    expect(
      retainedOverrideOf(slot({ payload: { state: 'Correct' } }), scope, 'Correct'),
    ).toBeNull();
  });

  it('retains no reason and nothing but the mark', () => {
    // The reason is the server's prose and is re-read from the run: a copy in a slot would be
    // a second one to keep in step. So a payload carrying one contributes nothing here.
    expect(
      retainedOverrideOf(
        slot({ payload: { state: 'Correct', rationale: 'kept out of the slot' } }),
        scope,
        'Incorrect',
      ),
    ).toBe('Correct');
  });
});
