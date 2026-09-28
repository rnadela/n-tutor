import { describe, expect, it } from 'vitest';
import type { PracticeTestReleasedSummary } from '../practicetest/practice-test.service.js';
import {
  activityOf,
  countAwaiting,
  describedTopics,
  rankTopics,
  trendPointsOf,
  type MasteryTopicView,
} from './analytics-view.js';

/**
 * The dashboard's ranking and its tallies, asserted with no database.
 *
 * Which rows exist is `test/analytics.int-spec.ts`'s claim. What order they come
 * out in, and what a count of them is, is arithmetic — and the counter-examples
 * that matter (an absent fraction, two Topics equal on every figure) are ones a
 * fixture would have to be contorted to produce.
 */

/** One ranked row, with only the figures the comparator reads spelled out. */
function topic(over: Partial<MasteryTopicView> & { topicId: string }): MasteryTopicView {
  return {
    topicName: over.topicId,
    subjectId: 'subject-1',
    subjectName: 'Maths',
    correct: 0,
    incorrect: 0,
    unanswered: 0,
    answered: 0,
    attemptsCounted: 1,
    value: null,
    isWeakArea: false,
    ...over,
  };
}

const namesOf = (rows: readonly MasteryTopicView[]) => rows.map((row) => row.topicName);

describe('ranking the Mastery table', () => {
  it('puts the Weak Areas first, whatever their fractions are', () => {
    // The dashboard's whole promise is "where is my child weak", so a healthy
    // Topic never sits above a weak one — even one with a higher fraction, which
    // happens the moment the floor keeps a worse Topic out of the weak group.
    const ranked = rankTopics([
      topic({ topicId: 'healthy', value: 0.9, answered: 10 }),
      topic({ topicId: 'weak', value: 0.4, answered: 5, isWeakArea: true }),
      topic({ topicId: 'thin', value: 0.25, answered: 4 }),
    ]);
    expect(namesOf(ranked)).toEqual(['weak', 'thin', 'healthy']);
  });

  it('orders ascending by value inside each group', () => {
    const ranked = rankTopics([
      topic({ topicId: 'weaker', value: 0.2, answered: 5, isWeakArea: true }),
      topic({ topicId: 'weak', value: 0.5, answered: 5, isWeakArea: true }),
      topic({ topicId: 'best', value: 0.95, answered: 5 }),
      topic({ topicId: 'good', value: 0.7, answered: 5 }),
    ]);
    expect(namesOf(ranked)).toEqual(['weaker', 'weak', 'good', 'best']);
  });

  it('sorts a Topic with no fraction after every Topic that has one, never first', () => {
    // A window the child skipped entirely has no fraction to be worse than
    // anything. Sorted as a zero it would lead the table, which would put "not
    // attempted" above "got most of it wrong" — the one comparison this must not
    // make. `null < 0.4` is true in JavaScript, so this is a real hazard.
    const ranked = rankTopics([
      topic({ topicId: 'skipped', value: null, unanswered: 3 }),
      topic({ topicId: 'poor', value: 0.1, answered: 10 }),
      topic({ topicId: 'fine', value: 0.8, answered: 10 }),
    ]);
    expect(namesOf(ranked)).toEqual(['poor', 'fine', 'skipped']);
  });

  it('breaks an equal fraction by evidence, most answered first', () => {
    // 4 of 10 is a firmer claim than 2 of 5, and both are 40%.
    const ranked = rankTopics([
      topic({ topicId: 'thin', value: 0.4, correct: 2, incorrect: 3, answered: 5 }),
      topic({ topicId: 'firm', value: 0.4, correct: 4, incorrect: 6, answered: 10 }),
    ]);
    expect(namesOf(ranked)).toEqual(['firm', 'thin']);
  });

  it('breaks an equal fraction and equal evidence by name', () => {
    const ranked = rankTopics([
      topic({ topicId: 'b', topicName: 'decimals', value: 0.5, answered: 4 }),
      topic({ topicId: 'a', topicName: 'algebra', value: 0.5, answered: 4 }),
    ]);
    expect(namesOf(ranked)).toEqual(['algebra', 'decimals']);
  });

  it('falls back to the id, so the order is total and a refresh cannot reshuffle it', () => {
    // Two rows equal on every figure above, both unnamed. Without this clause the
    // table would reorder itself between two reads of unchanged data, which reads
    // as a table saying something changed.
    const rows = [
      topic({ topicId: 'zzz', topicName: null, value: 0.5, answered: 4 }),
      topic({ topicId: 'aaa', topicName: null, value: 0.5, answered: 4 }),
    ];
    expect(rankTopics(rows).map((row) => row.topicId)).toEqual(['aaa', 'zzz']);
    // And the same answer from the other input order.
    expect(rankTopics([...rows].reverse()).map((row) => row.topicId)).toEqual(['aaa', 'zzz']);
  });

  it('never re-decides a Weak Area from the figures', () => {
    // The verdict is `grading`'s, resolved once against the tunables. A row marked
    // weak at 90% is nonsense the ranking must still honour, because the day it
    // stops honouring it is the day two surfaces disagree about what weak means.
    const ranked = rankTopics([
      topic({ topicId: 'healthy-looking', value: 0.9, answered: 10, isWeakArea: true }),
      topic({ topicId: 'low', value: 0.1, answered: 10, isWeakArea: false }),
    ]);
    expect(namesOf(ranked)).toEqual(['healthy-looking', 'low']);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [
      topic({ topicId: 'b', value: 0.9, answered: 4 }),
      topic({ topicId: 'a', value: 0.1, answered: 4 }),
    ];
    rankTopics(rows);
    expect(rows.map((row) => row.topicId)).toEqual(['b', 'a']);
  });
});

describe('naming the stored rows', () => {
  const stored = [
    {
      topicId: 't-1',
      correct: 2,
      incorrect: 2,
      unanswered: 3,
      answered: 4,
      attemptsCounted: 1,
      value: 0.5,
      isWeakArea: true,
    },
    {
      topicId: 't-gone',
      correct: 1,
      incorrect: 0,
      unanswered: 0,
      answered: 1,
      attemptsCounted: 1,
      value: 1,
      isWeakArea: false,
    },
  ];

  it('keeps a row whose Topic no longer resolves, unnamed rather than absent', () => {
    // The child answered those Questions and the figure is still true. Dropping
    // the row would shorten the dashboard by exactly the rows hardest to explain.
    const named = describedTopics(
      stored,
      new Map([
        [
          't-1',
          {
            topicId: 't-1',
            name: 'fractions',
            subjectId: 's-1',
            subjectName: 'Maths',
            provisional: true,
          },
        ],
      ]),
    );
    expect(named.map((row) => [row.topicId, row.topicName, row.subjectName])).toEqual([
      ['t-1', 'fractions', 'Maths'],
      ['t-gone', null, null],
    ]);
  });

  it('carries the unanswered count onto every named row', () => {
    // The count travels with the figure wherever it goes: a percentage without it
    // is a percentage over an unstated denominator.
    const named = describedTopics(stored, new Map());
    expect(named.map((row) => row.unanswered)).toEqual([3, 0]);
    expect(named.map((row) => row.answered)).toEqual([4, 1]);
  });
});

/** A released list in the given states, which is all `activityOf` reads. */
const released = (states: readonly PracticeTestReleasedSummary['state'][]) =>
  states.map((state, index) => ({
    id: `pt-${index}`,
    subjectName: null,
    questionCount: 4,
    state,
  }));

describe('the activity summary', () => {
  it('partitions the released tests into the three states', () => {
    expect(
      activityOf(released(['NotStarted', 'NotStarted', 'InProgress', 'Completed', 'Completed'])),
    ).toEqual({ released: 5, unstarted: 2, inProgress: 1, completed: 2 });
  });

  it('answers four zeroes for a child with nothing released', () => {
    expect(activityOf([])).toEqual({ released: 0, unstarted: 0, inProgress: 0, completed: 0 });
  });
});

describe('the digest counts', () => {
  it('counts only the entries awaiting a decision, on each list by its own absence', () => {
    // Two disputes, one overridden. Three reports, one disposed.
    const disputes = [{ overriddenAt: null }, { overriddenAt: '2026-01-02T00:00:00.000Z' }];
    const flags = [{ disposition: null }, { disposition: null }, { disposition: 'Dismissed' }];
    expect(countAwaiting(disputes, (entry) => entry.overriddenAt === null)).toBe(1);
    expect(countAwaiting(flags, (entry) => entry.disposition === null)).toBe(2);
  });

  it('counts nothing on an empty list rather than refusing one', () => {
    expect(countAwaiting([], () => true)).toBe(0);
  });
});

describe('the trend points', () => {
  it('flattens the score and keeps the excluded count beside it', () => {
    expect(
      trendPointsOf([
        {
          attemptId: 'a-1',
          submittedAt: '2026-01-01T00:00:00.000Z',
          score: { correct: 3, denominator: 4, excludedUngraded: 1 },
        },
      ]),
    ).toEqual([
      {
        attemptId: 'a-1',
        submittedAt: '2026-01-01T00:00:00.000Z',
        correct: 3,
        denominator: 4,
        excludedUngraded: 1,
      },
    ]);
  });

  it('keeps the order it was given, because the order was decided upstream', () => {
    const points = ['a-1', 'a-2', 'a-3'].map((attemptId, index) => ({
      attemptId,
      submittedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      score: { correct: index, denominator: 3, excludedUngraded: 0 },
    }));
    expect(trendPointsOf(points).map((point) => point.attemptId)).toEqual(['a-1', 'a-2', 'a-3']);
  });
});

describe('the activity summary is exhaustive', () => {
  it('refuses a state it does not know rather than counting it as finished', () => {
    // An `else` arm would silently tally a future `StudentListState` as completed,
    // which is the one direction the error must not go: a parent told their child
    // has finished work they have not is told the opposite of the truth. The cast
    // stands in for the member a later story adds.
    expect(() =>
      activityOf([
        {
          id: 'pt-1',
          subjectName: null,
          questionCount: 4,
          state: 'Abandoned' as PracticeTestReleasedSummary['state'],
        },
      ]),
    ).toThrow(/Unhandled practice test state/u);
  });

  it('counts each known state on its own arm, and none of them by default', () => {
    // Every member named explicitly, so the throw above is about an unknown state
    // and never about one this table simply forgot.
    expect(activityOf(released(['NotStarted']))).toMatchObject({ unstarted: 1, completed: 0 });
    expect(activityOf(released(['InProgress']))).toMatchObject({ inProgress: 1, completed: 0 });
    expect(activityOf(released(['Completed']))).toMatchObject({ completed: 1, unstarted: 0 });
  });
});
