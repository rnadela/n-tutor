import { describe, expect, it } from 'vitest';
import { studentCopy } from '@/copy/student';
import type { AttemptRunView, PracticeTestRunsView } from './parent-api';
import { runLineOf, runsById } from './practice-test-runs';

function run(overrides: Partial<AttemptRunView> = {}): AttemptRunView {
  return {
    attemptId: 'a1',
    ordinal: 1,
    submittedAt: '2026-09-01T10:00:00.000Z',
    score: { correct: 5, denominator: 8, excludedUngraded: 0 },
    countsTowardMastery: true,
    ...overrides,
  };
}

function runs(overrides: Partial<PracticeTestRunsView> = {}): PracticeTestRunsView {
  const only = run();
  return {
    practiceTestId: 'test-1',
    attemptCount: 1,
    first: only,
    latest: only,
    ...overrides,
  };
}

describe('the line for a test with exactly one finished run', () => {
  it('is one figure, with no first/latest framing and no count', () => {
    const line = runLineOf(runs());
    expect(line.kind).toBe('single');
    expect(line).toEqual({ kind: 'single', figure: '5 out of 8' });
    // Not a word of framing: one run is one figure.
    expect(JSON.stringify(line)).not.toMatch(/First|Latest|attempt/u);
  });

  it('is chosen from the ids the API stated, not from the count alone', () => {
    // A count of one whose two ids differ is a response with no honest single-run
    // reading, so it is read as a history rather than collapsed.
    const line = runLineOf(
      runs({ attemptCount: 1, first: run({ attemptId: 'a1' }), latest: run({ attemptId: 'a2' }) }),
    );
    expect(line.kind).toBe('multi');
  });
});

describe('the line for a test with more than one finished run', () => {
  const history = runs({
    attemptCount: 3,
    first: run({
      attemptId: 'a1',
      ordinal: 1,
      score: { correct: 3, denominator: 8, excludedUngraded: 0 },
      countsTowardMastery: true,
    }),
    latest: run({
      attemptId: 'a3',
      ordinal: 3,
      score: { correct: 7, denominator: 8, excludedUngraded: 0 },
      countsTowardMastery: false,
    }),
  });

  it('states the first figure, the latest figure and the run count, in that order', () => {
    const line = runLineOf(history);
    expect(line.kind).toBe('multi');
    expect(line).toEqual({
      kind: 'multi',
      parts: ['First 3 out of 8', 'Latest 7 out of 8', '3 attempts'],
      note: studentCopy.runs.countsTowardProgress,
    });
  });

  it('tells the first from the latest in words rather than by position', () => {
    // The distinction has to survive being read aloud and being read out of order.
    const line = runLineOf(history);
    if (line.kind !== 'multi') throw new Error('expected a history');
    expect(line.parts[0]).toContain('First');
    expect(line.parts[1]).toContain('Latest');
    expect(line.parts[0]).not.toBe(line.parts[1]);
  });

  it('says which run counts toward progress, in the child’s own word for it', () => {
    const line = runLineOf(history);
    if (line.kind !== 'multi') throw new Error('expected a history');
    expect(line.note).toMatch(/first attempt/iu);
    expect(line.note).toMatch(/progress/u);
    // Never the parent's term, and nothing comparative.
    expect(line.note).not.toMatch(/mastery|average|best|%|!/iu);
  });

  it('says `1 attempt` rather than `1 attempts` where a count of one is stated', () => {
    expect(studentCopy.runs.count(1)).toBe('1 attempt');
    expect(studentCopy.runs.count(2)).toBe('2 attempts');
  });
});

describe('what the line does with a run nothing could judge', () => {
  it('says so in words rather than dividing by zero', () => {
    const line = runLineOf(
      runs({ first: run({ score: { correct: 0, denominator: 0, excludedUngraded: 8 } }) }),
    );
    expect(line).toEqual({ kind: 'single', figure: studentCopy.runs.notGradedYet });
  });

  it('replaces only the run it is about, on a history', () => {
    const line = runLineOf(
      runs({
        attemptCount: 2,
        first: run({
          attemptId: 'a1',
          score: { correct: 0, denominator: 0, excludedUngraded: 8 },
        }),
        latest: run({
          attemptId: 'a2',
          score: { correct: 6, denominator: 8, excludedUngraded: 0 },
        }),
      }),
    );
    if (line.kind !== 'multi') throw new Error('expected a history');
    expect(line.parts[0]).toBe(`First ${studentCopy.runs.notGradedYet}`);
    expect(line.parts[1]).toBe('Latest 6 out of 8');
  });
});

describe('what the line never computes', () => {
  it('states the server’s two numbers and derives no third', () => {
    // Both figures arrive; a percentage, a rounding or a difference computed here
    // would be a second answer to FR-37.
    const line = runLineOf(
      runs({ first: run({ score: { correct: 1, denominator: 3, excludedUngraded: 0 } }) }),
    );
    expect(line).toEqual({ kind: 'single', figure: '1 out of 3' });
    // Not `33%`, not `0.33`, and not a rounded figure of any kind.
    expect(JSON.stringify(line)).not.toMatch(/%|\d\.\d/u);
  });

  it('carries the excluded count through to no figure at all', () => {
    // `excludedUngraded` above zero with a denominator above zero is the server's
    // own partial figure. The row states the fraction it was given and nothing about
    // what is missing — the results screen is where that sentence belongs.
    const line = runLineOf(
      runs({ first: run({ score: { correct: 2, denominator: 5, excludedUngraded: 3 } }) }),
    );
    expect(line).toEqual({ kind: 'single', figure: '2 out of 5' });
  });
});

describe('looking a row’s runs up', () => {
  it('indexes by practice test and nothing else', () => {
    const map = runsById([
      runs({ practiceTestId: 'test-a' }),
      runs({ practiceTestId: 'test-b', attemptCount: 2 }),
    ]);
    expect([...map.keys()]).toEqual(['test-a', 'test-b']);
    expect(map.get('test-b')!.attemptCount).toBe(2);
  });

  it('answers nothing for a test with no finished run', () => {
    const map = runsById([runs({ practiceTestId: 'test-a' })]);
    expect(map.get('test-b')).toBeUndefined();
  });

  it('is empty for a read that answered with nothing', () => {
    expect(runsById([]).size).toBe(0);
  });
});
