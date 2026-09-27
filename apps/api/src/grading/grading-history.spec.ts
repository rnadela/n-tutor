import { describe, expect, it } from 'vitest';
import type { GradeState } from '../generated/prisma/enums.js';
import type { AttemptRun } from '../practicetest/practice-test.service.js';
import { runsOf } from './grading-history.js';

/**
 * The run history's composition, case by case.
 *
 * Pure, so every claim here is about the rule rather than about a database: which
 * runs are named, how each one is scored, which one counts toward progress, and what
 * the shape says when there is only one run.
 */

function run(overrides: Partial<AttemptRun> = {}): AttemptRun {
  return {
    attemptId: 'attempt-1',
    practiceTestId: 'test-1',
    ordinal: 1,
    submittedAt: '2026-09-01T10:00:00.000Z',
    questionCount: 4,
    ...overrides,
  };
}

/** Grade states per Attempt, as the read hands them over: one array per run. */
function states(
  entries: Record<string, readonly (GradeState | null)[]>,
): Map<string, readonly (GradeState | null)[]> {
  return new Map(Object.entries(entries));
}

describe('runsOf, over more than one run', () => {
  const runs = [
    run({ attemptId: 'a1', ordinal: 1, submittedAt: '2026-09-01T10:00:00.000Z' }),
    run({ attemptId: 'a2', ordinal: 2, submittedAt: '2026-09-02T10:00:00.000Z' }),
    run({ attemptId: 'a3', ordinal: 3, submittedAt: '2026-09-03T10:00:00.000Z' }),
  ];
  const grades = states({
    a1: ['Correct', 'Incorrect', 'Incorrect', 'Unanswered'],
    a2: ['Correct', 'Correct', 'Incorrect', 'Incorrect'],
    a3: ['Correct', 'Correct', 'Correct', 'Unanswered'],
  });

  it('names the first and the latest, and counts every finished run', () => {
    const [view] = runsOf(runs, grades);
    expect(view!.practiceTestId).toBe('test-1');
    expect(view!.attemptCount).toBe(3);
    expect(view!.first.attemptId).toBe('a1');
    expect(view!.latest.attemptId).toBe('a3');
    expect(view!.first.ordinal).toBe(1);
    expect(view!.latest.ordinal).toBe(3);
    expect(view!.first.submittedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(view!.latest.submittedAt).toBe('2026-09-03T10:00:00.000Z');
  });

  it('scores each named run off its own rows, never off the other’s', () => {
    // Two runs of one test have rows for the same Questions. Keyed by Attempt, so
    // the latest run's verdicts can never score the first one.
    const [view] = runsOf(runs, grades);
    expect(view!.first.score).toEqual({ correct: 1, denominator: 4, excludedUngraded: 0 });
    expect(view!.latest.score).toEqual({ correct: 3, denominator: 4, excludedUngraded: 0 });
  });

  it('marks only the first run as the one that counts toward progress', () => {
    const [view] = runsOf(runs, grades);
    expect(view!.first.countsTowardMastery).toBe(true);
    expect(view!.latest.countsTowardMastery).toBe(false);
  });

  it('groups by practice test without reordering what it was given', () => {
    const views = runsOf(
      [
        run({ attemptId: 'a1', practiceTestId: 'test-a', ordinal: 1 }),
        run({ attemptId: 'a2', practiceTestId: 'test-a', ordinal: 2 }),
        run({ attemptId: 'b1', practiceTestId: 'test-b', ordinal: 1 }),
      ],
      states({
        a1: ['Correct', 'Correct', 'Correct', 'Correct'],
        a2: ['Correct', 'Correct', 'Correct', 'Correct'],
        b1: ['Correct', 'Correct', 'Correct', 'Correct'],
      }),
    );
    expect(views.map((view) => view.practiceTestId)).toEqual(['test-a', 'test-b']);
    expect(views[0]!.attemptCount).toBe(2);
    expect(views[1]!.attemptCount).toBe(1);
  });
});

describe('runsOf, over exactly one run', () => {
  it('names the same Attempt as first and as latest, with a count of one', () => {
    // The shape the surface tells the two cases apart by, without arithmetic.
    const views = runsOf(
      [run({ attemptId: 'only', ordinal: 1 })],
      states({ only: ['Correct', 'Correct', 'Incorrect', 'Unanswered'] }),
    );
    const view = views[0]!;
    expect(view.attemptCount).toBe(1);
    expect(view.first.attemptId).toBe('only');
    expect(view.latest.attemptId).toBe(view.first.attemptId);
    expect(view.latest).toEqual(view.first);
    expect(view.first.countsTowardMastery).toBe(true);
    expect(view.latest.countsTowardMastery).toBe(true);
  });
});

describe('what runsOf does about Questions nothing has judged', () => {
  it('excludes a stored Ungraded from the denominator and reports it', () => {
    const views = runsOf(
      [run({ attemptId: 'a1', questionCount: 4 })],
      states({ a1: ['Correct', 'Correct', 'Ungraded', 'Ungraded'] }),
    );
    expect(views[0]!.first.score).toEqual({ correct: 2, denominator: 2, excludedUngraded: 2 });
  });

  it('treats a run with fewer rows than Questions the same way', () => {
    // A row that was never written and a row that says `Ungraded` are one fact:
    // nothing has judged this. The padding to `questionCount` is what makes the
    // denominator describe the paper the child actually sat.
    const views = runsOf([run({ attemptId: 'a1', questionCount: 4 })], states({ a1: ['Correct'] }));
    expect(views[0]!.first.score).toEqual({ correct: 1, denominator: 1, excludedUngraded: 3 });
  });

  it('scores a run nothing judged at all as a zero denominator rather than failing', () => {
    // The state a crashed grading pass leaves behind. The figure has to say so.
    const views = runsOf([run({ attemptId: 'a1', questionCount: 3 })], states({}));
    expect(views[0]!.first.score).toEqual({ correct: 0, denominator: 0, excludedUngraded: 3 });
  });
});

describe('what the run history cannot carry', () => {
  it('has no rationale, Topic, cost, tier, allowance or model key anywhere in it', () => {
    // Asserted over the serialized output rather than field by field, so a key a
    // later edit adds is caught too. A rationale is parent-scoped (AD-20, AD-26) and
    // the read that composes this never selects one.
    const serialized = JSON.stringify(
      runsOf(
        [run({ attemptId: 'a1', ordinal: 1 }), run({ attemptId: 'a2', ordinal: 2 })],
        states({ a1: ['Correct'], a2: ['Incorrect'] }),
      ),
    );
    for (const key of [
      'rationale',
      'topic',
      'topics',
      'cost',
      'costMicros',
      'tier',
      'model',
      'allowance',
      'timerMinutes',
      'studentProfileId',
      'parentAccountId',
    ]) {
      expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'iu'));
    }
  });

  it('answers with nothing at all for a child with no finished run', () => {
    expect(runsOf([], states({}))).toEqual([]);
  });

  it('states exactly the keys the surface reads, and no more', () => {
    const view = runsOf([run({ attemptId: 'a1' })], states({ a1: ['Correct'] }))[0]!;
    expect(Object.keys(view).sort()).toEqual(
      ['attemptCount', 'first', 'latest', 'practiceTestId'].sort(),
    );
    expect(Object.keys(view.first).sort()).toEqual(
      ['attemptId', 'countsTowardMastery', 'ordinal', 'score', 'submittedAt'].sort(),
    );
  });
});
