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

  // --- The two per-row facts Story 6.5 added ----------------------------

  it('reads both per-row facts as false when neither list is given', () => {
    // The default is "nothing happened", not "unknown": a row with no dispute and no
    // adjustment is the ordinary row, and every existing caller passes neither list.
    const rows = answerKeyRows(key(), states({ q1: 'Correct' }), []);

    expect(rows.every((row) => !row.parentAdjusted)).toBe(true);
    expect(rows.every((row) => !row.disputed)).toBe(true);
  });

  it('marks parentAdjusted and disputed on exactly the ids given, independently', () => {
    // The two are independent by construction: an override needs no dispute, and a
    // dispute a parent has not decided on carries no override. A row may be either,
    // both or neither, and a mapper that folded them would make one imply the other.
    const rows = answerKeyRows(
      key(),
      states({ q1: 'Correct', q2: 'Unanswered', q3: 'Incorrect' }),
      [],
      ['q1'],
      ['q3'],
    );

    expect(rows.map((row) => row.parentAdjusted)).toEqual([true, false, false]);
    expect(rows.map((row) => row.disputed)).toEqual([false, false, true]);
  });

  it('ignores an adjusted or disputed id that is not a presented Question', () => {
    // The lists come from grade and dispute rows, the rows from the key. An id in one
    // and not the other must not add a row or move one.
    const rows = answerKeyRows(key(), states({ q1: 'Correct' }), [], ['gone'], ['also-gone']);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => !row.parentAdjusted && !row.disputed)).toBe(true);
  });

  it('takes the state it is given and resolves nothing of its own', () => {
    // The caller applies `effectiveStateOf`; this mapper must not have a second
    // opinion. Handed `Correct` for a row it also knows was adjusted, it states
    // `Correct` — there is no `?? state` here to reach for the AI's verdict.
    const rows = answerKeyRows(key(), states({ q1: 'Correct' }), [], ['q1']);

    expect(rows[0]!.state).toBe('Correct');
    expect(rows[0]!.parentAdjusted).toBe(true);
  });

  it('carries no field for the AI verdict, the override instant or a dispute decision', () => {
    // The student row's shape is the guarantee. `parentAdjusted` and `disputed` are the
    // whole of what a child is told; `aiState`, `overriddenAt`, `disputedAt` and any
    // disposition live on the parent's superset and have nowhere here to sit.
    const serialized = JSON.stringify(
      answerKeyRows(key(), states({ q1: 'Correct' }), ['q1'], ['q1'], ['q1']),
    );

    for (const field of ['aiState', 'overrideState', 'overriddenAt', 'disputedAt', 'disposition']) {
      expect(serialized).not.toMatch(new RegExp(`"${field}"\\s*:`, 'iu'));
    }
  });

  it('scores the same rows twice — effective and stored — over one denominator', () => {
    // The whole of "11 of 15 became 12 of 15": two calls to one `scoreOf`, never a
    // stored prior score and never a subtraction. The excluded count is identical,
    // because an override never moves a row into or out of the denominator.
    const stored: Record<string, GradeState> = { q1: 'Incorrect', q2: 'Unanswered' };
    const effective: Record<string, GradeState> = { q1: 'Correct', q2: 'Unanswered' };
    const adjusted = answerKeyRows(key(), states(effective), [], ['q1']);

    expect(scoreOf(adjusted.map((row) => row.state))).toEqual({
      correct: 1,
      denominator: 2,
      excludedUngraded: 1,
    });
    expect(scoreOf(key().questions.map((question) => stored[question.questionId] ?? null))).toEqual(
      { correct: 0, denominator: 2, excludedUngraded: 1 },
    );
  });
});
