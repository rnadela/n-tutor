import { describe, expect, it } from 'vitest';
import {
  emptyStateProgress,
  filterBySubject,
  masteryPercent,
  subjectOptions,
} from './analytics-view';
import type { MasteryTopicView } from './parent-api';
import { parentCopy } from '@/copy/parent';

/**
 * The dashboard's presentation rules, as behaviour.
 *
 * `apps/web` runs with `environment: 'node'`, so these are the rules that can be
 * asserted outright rather than through a component's source — which is exactly
 * why they live outside the component.
 */

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

describe('the subjects a parent may narrow to', () => {
  it('offers only the subjects actually in the table, in the order they appear', () => {
    // Offering a subject the student has no topic in would be a filter that
    // empties the table and tells the parent nothing.
    expect(
      subjectOptions([
        topic({ topicId: 'a', subjectId: 's-2', subjectName: 'Science' }),
        topic({ topicId: 'b', subjectId: 's-1', subjectName: 'Maths' }),
        topic({ topicId: 'c', subjectId: 's-2', subjectName: 'Science' }),
      ]),
    ).toEqual([
      { subjectId: 's-2', subjectName: 'Science' },
      { subjectId: 's-1', subjectName: 'Maths' },
    ]);
  });

  it('collapses the rows with no subject into one option, not one each', () => {
    // They are not several subjects; they are the rows that lost their label.
    expect(
      subjectOptions([
        topic({ topicId: 'a', subjectId: null, subjectName: null }),
        topic({ topicId: 'b', subjectId: null, subjectName: null }),
      ]),
    ).toEqual([{ subjectId: null, subjectName: null }]);
  });

  it('offers nothing for an empty table', () => {
    expect(subjectOptions([])).toEqual([]);
  });
});

describe('narrowing the table', () => {
  const rows = [
    topic({ topicId: 'maths-1', subjectId: 's-1' }),
    topic({ topicId: 'science-1', subjectId: 's-2' }),
    topic({ topicId: 'orphan', subjectId: null, subjectName: null }),
  ];

  it('keeps everything when no choice has been made', () => {
    expect(filterBySubject(rows, undefined).map((row) => row.topicId)).toEqual([
      'maths-1',
      'science-1',
      'orphan',
    ]);
  });

  it('tells "no choice" apart from "the rows with no subject"', () => {
    // `undefined` is an absence of a choice; `null` is a choice. Folding the two
    // together would make selecting the unlabelled rows show the whole table.
    expect(filterBySubject(rows, null).map((row) => row.topicId)).toEqual(['orphan']);
  });

  it('keeps the rows of one subject, in the order they arrived', () => {
    // The order is the API's ranking answer; a filter must not re-decide it.
    expect(filterBySubject(rows, 's-2').map((row) => row.topicId)).toEqual(['science-1']);
  });

  it('does not mutate the rows it was given', () => {
    const before = rows.map((row) => row.topicId);
    filterBySubject(rows, 's-1');
    expect(rows.map((row) => row.topicId)).toEqual(before);
  });
});

describe('the figure a row states', () => {
  it('rounds to whole percent, so no float error reaches a parent', () => {
    expect(masteryPercent(2 / 3)).toBe(67);
    expect(masteryPercent(0.4)).toBe(40);
  });

  it('answers null for a topic with no fraction, and never a zero', () => {
    // 0% would tell a parent their child got everything wrong on a topic they
    // never answered.
    expect(masteryPercent(null)).toBeNull();
  });

  it('still answers zero for a real zero', () => {
    // A student who answered and got none right is a different fact from one who
    // answered nothing, and the two must stay distinguishable.
    expect(masteryPercent(0)).toBe(0);
  });
});

describe('the progress an empty dashboard states', () => {
  it('reads the work signal off the activity summary, which the empty branch can reach', () => {
    // This function is only ever called when there are **no topic rows**, so a
    // signal derived from those rows would be a constant and the progress
    // sentence would be structurally unreachable.
    expect(emptyStateProgress({ completed: 2, inProgress: 1 }, 5)).toEqual({
      answeredFloor: 5,
      completed: 2,
      inProgress: 1,
      hasWork: true,
    });
  });

  it('counts work in progress as work, not as nothing', () => {
    // A student part-way through their first test has started; telling them
    // nothing has been started is false.
    expect(emptyStateProgress({ completed: 0, inProgress: 1 }, 5).hasWork).toBe(true);
  });

  it('says there is no work only when nothing is finished and nothing is started', () => {
    expect(emptyStateProgress({ completed: 0, inProgress: 0 }, 5)).toEqual({
      answeredFloor: 5,
      completed: 0,
      inProgress: 0,
      hasWork: false,
    });
  });

  it('states no floor of its own — whatever it is handed comes back out', () => {
    // The floor is a tunable the API resolved at boot. A figure this app knew
    // would drift the first time an operator changed it.
    const none = { completed: 0, inProgress: 0 };
    expect(emptyStateProgress(none, 3).answeredFloor).toBe(3);
    expect(emptyStateProgress(none, 9).answeredFloor).toBe(9);
  });
});

describe('the sentence an empty dashboard actually renders', () => {
  it('tells a student who has finished work apart from one who has not', () => {
    // The bug this replaced: a child with two finished tests and no topic figure
    // read "no practice test has been started yet", which is false and reads as a
    // broken product rather than as a product that is waiting.
    const withWork = emptyStateProgress({ completed: 2, inProgress: 0 }, 5);
    const sentence = parentCopy.analytics.emptyProgress(withWork);
    expect(sentence).toContain('2 practice tests finished');
    expect(sentence).not.toBe(parentCopy.analytics.emptyNoWork);
  });

  it('mentions work in progress only when there is some', () => {
    expect(parentCopy.analytics.emptyProgress({ completed: 1, inProgress: 2 })).toContain(
      '2 in progress',
    );
    expect(parentCopy.analytics.emptyProgress({ completed: 1, inProgress: 0 })).not.toContain(
      'in progress',
    );
    // And it agrees with itself about the singular.
    expect(parentCopy.analytics.emptyProgress({ completed: 1, inProgress: 0 })).toContain(
      '1 practice test finished',
    );
  });
});
