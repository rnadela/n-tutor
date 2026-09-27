import { describe, expect, it } from 'vitest';
import type { GradeState } from '../generated/prisma/enums.js';
import type { AttemptAnswerKey } from '../practicetest/practice-test.service.js';
import { answerKeyRows } from './grading-results.js';
import { scoreOf } from './grading-score.js';

/**
 * The answer key and the grade states, composed — case by case, with no database.
 *
 * Every claim here is about the **mapping**: which rows come back, in what order,
 * what a missing grade row reads as, what `newlyGraded` is true of, and what the
 * shape may never carry. The integration cases prove the same rules over the real
 * HTTP path; these prove them where a failure names the rule that broke.
 */

/** Three presented Questions, in stored ordinal order. */
function key(): AttemptAnswerKey {
  return {
    attemptId: 'attempt-1',
    practiceTestId: 'test-1',
    subjectName: 'Mathematics',
    questionCount: 3,
    questions: [
      {
        questionId: 'q1',
        ordinal: 1,
        format: 'MultipleChoice',
        prompt: [{ kind: 'text', value: 'What is two halves?' }],
        studentAnswer: [{ kind: 'text', value: 'Option A for 1.1' }],
        correctAnswer: [{ kind: 'text', value: 'Option A for 1.1' }],
      },
      {
        questionId: 'q2',
        ordinal: 2,
        format: 'FillInTheBlank',
        prompt: [{ kind: 'text', value: 'Write one half.' }],
        studentAnswer: null,
        correctAnswer: [{ kind: 'fraction', whole: null, numerator: 1, denominator: 2 }],
      },
      {
        questionId: 'q3',
        ordinal: 3,
        format: 'ShortAnswer',
        prompt: [{ kind: 'text', value: 'Say why.' }],
        studentAnswer: [{ kind: 'text', value: 'Because.' }],
        correctAnswer: null,
      },
    ],
  };
}

function states(entries: Record<string, GradeState>): Map<string, GradeState> {
  return new Map(Object.entries(entries));
}

describe('answerKeyRows', () => {
  it('returns one row per presented Question, in the key’s order', () => {
    const rows = answerKeyRows(
      key(),
      states({ q1: 'Correct', q2: 'Unanswered', q3: 'Incorrect' }),
      [],
    );

    expect(rows.map((row) => row.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(rows.map((row) => row.ordinal)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.state)).toEqual(['Correct', 'Unanswered', 'Incorrect']);
  });

  it('carries the key’s own text fields through untouched', () => {
    const source = key();
    const rows = answerKeyRows(source, states({ q1: 'Correct' }), []);

    expect(rows[0]!.prompt).toEqual(source.questions[0]!.prompt);
    expect(rows[0]!.studentAnswer).toEqual(source.questions[0]!.studentAnswer);
    expect(rows[0]!.correctAnswer).toEqual(source.questions[0]!.correctAnswer);
    // A blank stays null, and an unreadable stored key stays null: the row is
    // rendered and the fact is stated, never invented.
    expect(rows[1]!.studentAnswer).toBeNull();
    expect(rows[2]!.correctAnswer).toBeNull();
  });

  it('reads a Question with no grade row as Ungraded', () => {
    // `scoreOf`'s own doc treats a missing row and a stored `Ungraded` as one fact
    // — nothing has judged this — and `resolveUngraded` re-asks for both. So the
    // screen has four states to draw rather than five.
    const rows = answerKeyRows(key(), states({ q1: 'Correct' }), []);

    expect(rows.map((row) => row.state)).toEqual(['Correct', 'Ungraded', 'Ungraded']);
  });

  it('marks newlyGraded true only for the ids this pass judged', () => {
    const rows = answerKeyRows(key(), states({ q1: 'Correct', q2: 'Incorrect', q3: 'Correct' }), [
      'q2',
    ]);

    expect(rows.map((row) => row.newlyGraded)).toEqual([false, true, false]);
  });

  it('ignores a newly-graded id that is not a presented Question', () => {
    // The list comes from a write, the rows from the key. An id in one and not the
    // other must not add a row or move one.
    const rows = answerKeyRows(key(), states({ q1: 'Correct' }), ['not-on-this-paper']);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => !row.newlyGraded)).toBe(true);
  });

  it('carries no field named rationale, on any row and in any state', () => {
    // Asserted over the serialized form rather than field by field, so a key a
    // later edit adds is caught too. There is no shape for one to travel in, and
    // this is what keeps it that way.
    const serialized = JSON.stringify(
      answerKeyRows(key(), states({ q1: 'Correct', q2: 'Ungraded', q3: 'Incorrect' }), ['q3']),
    );

    for (const field of ['rationale', 'topic', 'topics', 'cost', 'tier', 'model']) {
      expect(serialized).not.toMatch(new RegExp(`"${field}"\\s*:`, 'iu'));
    }
  });

  it('hands scoreOf exactly the states of the rows it returned', () => {
    // The one denominator, over the rows in the same response. A missing row is
    // `Ungraded` here, so it is excluded there — the two cannot disagree, because
    // there is only one derivation.
    const rows = answerKeyRows(key(), states({ q1: 'Correct', q2: 'Unanswered' }), []);

    expect(scoreOf(rows.map((row) => row.state))).toEqual({
      correct: 1,
      denominator: 2,
      excludedUngraded: 1,
    });
  });

  it('states a zero denominator rather than hiding it, when nothing could be judged', () => {
    const rows = answerKeyRows(key(), states({}), []);

    expect(rows.map((row) => row.state)).toEqual(['Ungraded', 'Ungraded', 'Ungraded']);
    expect(scoreOf(rows.map((row) => row.state))).toEqual({
      correct: 0,
      denominator: 0,
      excludedUngraded: 3,
    });
  });
});
