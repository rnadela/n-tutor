import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { completedTests } from './student-results';
import type { StudentPracticeTestSummary } from './parent-api';

const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'student-results.ts'), 'utf8');

function test(
  id: string,
  state: StudentPracticeTestSummary['state'] | string,
): StudentPracticeTestSummary {
  return {
    id,
    subjectName: 'Mathematics',
    questionCount: 8,
    state: state as StudentPracticeTestSummary['state'],
  };
}

describe('which practice tests the Results screen lists', () => {
  it('keeps the finished ones and drops everything else', () => {
    const listed = completedTests([
      test('a', 'NotStarted'),
      test('b', 'Completed'),
      test('c', 'InProgress'),
      test('d', 'Completed'),
    ]);
    expect(listed.map((row) => row.id)).toEqual(['b', 'd']);
  });

  it('keeps the server’s order across the filter, which is where newest-first comes from', () => {
    // Band 2 is stated most recently submitted first. Filtering preserves
    // relative order; this screen never restates it.
    const listed = completedTests([
      test('newest', 'Completed'),
      test('older', 'Completed'),
      test('oldest', 'Completed'),
    ]);
    expect(listed.map((row) => row.id)).toEqual(['newest', 'older', 'oldest']);
  });

  it('answers nothing when nothing is finished', () => {
    expect(completedTests([test('a', 'NotStarted'), test('b', 'InProgress')])).toEqual([]);
  });

  it('answers nothing for a child with nothing at all', () => {
    expect(completedTests([])).toEqual([]);
  });

  it('admits only the exact tag, never a state it does not recognise', () => {
    // A fall-through here would put a test the child has never touched on a
    // screen that says they finished it.
    for (const state of ['completed', 'Completed ', 'Graded', 'Expired', '']) {
      expect(completedTests([test('x', state)])).toEqual([]);
    }
  });

  it('hands back rows untouched, and does not mutate what it was given', () => {
    const rows = [test('a', 'Completed'), test('b', 'NotStarted')];
    const listed = completedTests(rows);
    expect(rows).toHaveLength(2);
    expect(listed[0]).toBe(rows[0]);
  });
});

describe('how the order is arrived at', () => {
  it('is never a sort taken here', () => {
    // "Newest first" is the server's band-2 order, and the summary carries no
    // timestamp a client sort could even read. A sort grown here later would
    // make the *order* of the screen depend on the run read, which is allowed
    // to fail silently.
    expect(SOURCE).not.toMatch(/\.sort\(|\.reverse\(|toSorted|submittedAt/u);
  });
});
