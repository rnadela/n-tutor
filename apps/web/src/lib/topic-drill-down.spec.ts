import { describe, expect, it } from 'vitest';
import type { GenerationAllowanceView, TopicDrillDownView } from './parent-api';
import { parentCopy } from '@/copy/parent';
import {
  DRILL_DOWN_GENERATION_COUNT,
  UNIDENTIFIED_ORDINAL,
  costOf,
  hasEvidence,
  targetSentence,
} from './topic-drill-down';

/**
 * The cost block's arithmetic and the empty-state predicate, asserted with no DOM.
 *
 * The cost block is UX Q12c's guard — a fire with no cost stated is a defect, and a
 * control that fires on a spent allowance is a worse one — so both are functions with
 * cases here rather than expressions inside JSX a node-environment test cannot reach.
 */

function allowance(over: Partial<GenerationAllowanceView> = {}): GenerationAllowanceView {
  return {
    used: 2,
    limit: 5,
    remaining: 3,
    maxPerRequest: 5,
    resetAt: '2026-10-01T00:00:00.000Z',
    timezone: 'Europe/London',
    // Nothing blocked by default: the at-cap sentence is the API's, and no
    // fixture here states a tier, a figure or a date of its own.
    exhaustedReason: null,
    ...over,
  };
}

function view(over: Partial<TopicDrillDownView> = {}): TopicDrillDownView {
  return {
    topicId: 'topic-1',
    topicName: 'fractions',
    subjectName: 'Maths',
    mastery: null,
    missed: [],
    unanswered: [],
    target: null,
    weakArea: { ceilingPercent: 60, answeredFloor: 5 },
    ...over,
  };
}

describe('what one press of the drill-down’s control costs', () => {
  it('always spends exactly one practice test', () => {
    // One tap, one practice test, the topic already chosen: a count picker here would
    // be the generate screen rebuilt on a dashboard.
    expect(costOf(allowance()).count).toBe(DRILL_DOWN_GENERATION_COUNT);
    expect(DRILL_DOWN_GENERATION_COUNT).toBe(1);
  });

  it('states what is left and what would be left afterwards', () => {
    expect(costOf(allowance({ used: 2, limit: 5, remaining: 3 }))).toEqual({
      count: 1,
      remaining: 3,
      after: 2,
      spendable: true,
    });
  });

  it('states no remainder at all on an account with no limit', () => {
    // An unlimited account has no remainder, and inventing one — "four will be left" —
    // would be a figure a parent could plan around and be wrong about. `remaining` on
    // such an account is the per-request ceiling, which is not a remainder either.
    expect(costOf(allowance({ limit: null, remaining: 5, used: 40 }))).toEqual({
      count: 1,
      remaining: null,
      after: null,
      spendable: true,
    });
  });

  it('is spendable on a remaining of exactly one, and leaves nothing', () => {
    expect(costOf(allowance({ used: 4, limit: 5, remaining: 1 }))).toEqual({
      count: 1,
      remaining: 1,
      after: 0,
      spendable: true,
    });
  });

  it('is not spendable on a remaining of zero', () => {
    // The control is disabled and the reason stated; nothing is sent.
    expect(costOf(allowance({ used: 5, limit: 5, remaining: 0 }))).toMatchObject({
      remaining: 0,
      after: 0,
      spendable: false,
    });
  });

  it('never lets the remainder fall below zero', () => {
    // `remainingAfter` clamps, and it is the only place this arithmetic lives.
    expect(costOf(allowance({ used: 9, limit: 5, remaining: 0 })).after).toBe(0);
  });
});

describe('whether a drill-down has anything to show', () => {
  it('is false for a topic with no stored figure', () => {
    // The same answer a foreign profile id and an unknown topic get, which this app
    // does not try to tell apart.
    expect(hasEvidence(view())).toBe(false);
  });

  it('is true for a stored figure with no rows beneath it', () => {
    // A window the student answered correctly throughout has a figure worth reading
    // and no missed questions; calling that "nothing to show" would hide a perfect
    // result.
    expect(
      hasEvidence(
        view({
          mastery: {
            topicId: 'topic-1',
            topicName: 'fractions',
            subjectId: 'subject-1',
            subjectName: 'Maths',
            correct: 5,
            incorrect: 0,
            unanswered: 0,
            answered: 5,
            attemptsCounted: 1,
            value: 1,
            isWeakArea: false,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('naming the upload a regeneration would come from', () => {
  const WHEN = '2026-09-08T10:00:00.000Z';
  /** What `readableInstant` will render that instant as, in this machine's locale. */
  const readable = new Date(WHEN).toLocaleString();

  it('names the subject and the date when both are known', () => {
    expect(targetSentence({ subjectName: 'Maths', submittedAt: WHEN })).toBe(
      parentCopy.topicDrillDown.generateFrom('Maths', readable),
    );
  });

  it('drops only the date when the instant is absent', () => {
    expect(targetSentence({ subjectName: 'Maths', submittedAt: null })).toBe(
      parentCopy.topicDrillDown.generateFromUndated('Maths'),
    );
  });

  it('drops only the date when the stored instant will not parse', () => {
    // Through `readableInstant`, so no parent screen renders the words "Invalid Date".
    expect(targetSentence({ subjectName: 'Maths', submittedAt: 'not-an-instant' })).toBe(
      parentCopy.topicDrillDown.generateFromUndated('Maths'),
    );
  });

  it('drops only the subject when the upload no longer carries one', () => {
    expect(targetSentence({ subjectName: null, submittedAt: WHEN })).toBe(
      parentCopy.topicDrillDown.generateFromUnknownSubject(readable),
    );
  });

  it('uses its own sentence when neither the subject nor the date is known', () => {
    // The regression this covers: passing a stand-in phrase into the slot a date belongs
    // in rendered "From the upload of From a finished practice test".
    const sentence = targetSentence({ subjectName: null, submittedAt: null });
    expect(sentence).toBe(parentCopy.topicDrillDown.generateFromUnknown);
    expect(sentence).not.toContain(parentCopy.topicDrillDown.rowFromUndated);
    // And the same for an instant that will not parse, which is the other way to get
    // here.
    expect(targetSentence({ subjectName: null, submittedAt: 'not-an-instant' })).toBe(sentence);
  });

  it('never leaves a sentence with two "From" clauses in it', () => {
    for (const subjectName of ['Maths', null]) {
      for (const submittedAt of [WHEN, null, 'not-an-instant']) {
        const sentence = targetSentence({ subjectName, submittedAt });
        expect(sentence.match(/From/gu)).toHaveLength(1);
      }
    }
  });
});

describe('the sentinel for a question that cannot be identified', () => {
  it('is a number no real question can carry', () => {
    // The numbers a child is shown are 1-based, so zero cannot collide with one.
    expect(UNIDENTIFIED_ORDINAL).toBe(0);
  });
});
