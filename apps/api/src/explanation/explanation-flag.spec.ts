import { describe, expect, it } from 'vitest';
import { PRACTICE_TEST_NOT_FOUND } from '../practicetest/practice-test-policy.js';
import { NO_EXPLANATION_TO_FLAG } from './explanation-policy.js';
import {
  PARENT_FLAG_ORIGIN,
  parentExplanationViews,
  type StoredExplanationRow,
} from './explanation-flag.js';

/**
 * The pure parts of the parent's Explanation review: what a stored row becomes on
 * the way to a parent, and the reasoning the origin and the unique key encode.
 *
 * The **stateful** rows of the story's matrix — that a foreign Attempt is refused,
 * that a sibling's Explanation is never returned, that the first press writes one
 * row and the second writes none, and that neither read moves the Explanation
 * Allowance — need the real app and the real database, and live in
 * `test/parent-explanation-review.int-spec.ts`. What is here needs neither.
 */

function row(overrides: Partial<StoredExplanationRow> = {}): StoredExplanationRow {
  return {
    questionId: 'q1',
    body: [{ kind: 'text', value: 'Two halves make one whole.' }],
    flags: [],
    ...overrides,
  };
}

describe('what a stored Explanation becomes on the way to a parent', () => {
  it('carries the Question, the stored segments and nothing else', () => {
    const [view] = parentExplanationViews([row()]);
    expect(Object.keys(view!).sort()).toEqual(['body', 'parentFlaggedAt', 'questionId']);
    expect(view!.questionId).toBe('q1');
    expect(view!.body).toEqual([{ kind: 'text', value: 'Two halves make one whole.' }]);
  });

  it('passes the segments out exactly as stored, without re-parsing them', () => {
    // Stored segments travel out as stored (AD-32). They were parsed on the way in;
    // re-parsing here would be a second chance for two readings of a row neither of
    // them wrote to disagree — and a fraction flattened on the way out is a reading
    // a parent could not hear.
    const body = [
      { kind: 'text', value: 'Three quarters is ' },
      { kind: 'fraction', whole: null, numerator: 3, denominator: 4 },
    ];
    const [view] = parentExplanationViews([row({ body })]);
    expect(view!.body).toBe(body);
  });

  it('reads an unflagged Explanation as null rather than as an absent field', () => {
    // Null rather than a missing key, so an unflagged row and a flagged one differ
    // in the value and never in the shape: a screen reading the state cannot take
    // "the field is not there" for "there is no flag".
    const [view] = parentExplanationViews([row({ flags: [] })]);
    expect(view!.parentFlaggedAt).toBeNull();
  });

  it('states when the concern was first raised, as an instant and not a boolean', () => {
    const first = new Date('2026-09-28T10:15:00.000Z');
    const [view] = parentExplanationViews([row({ flags: [{ createdAt: first }] })]);
    expect(view!.parentFlaggedAt).toBe('2026-09-28T10:15:00.000Z');
  });

  it('takes the one flag the unique key allows, without searching for it', () => {
    // The read that composes this filters `flags` to the parent origin, and
    // `[explanationId, origin]` is unique — so there is at most one, and the mapping
    // takes the first rather than implying a set to choose from.
    const [view] = parentExplanationViews([
      row({ flags: [{ createdAt: new Date('2026-09-28T09:00:00.000Z') }] }),
    ]);
    expect(view!.parentFlaggedAt).toBe('2026-09-28T09:00:00.000Z');
  });

  it('invents no entry for a Question nobody asked about', () => {
    // A Question with no stored row is absent from the list, and it is the screen
    // that says nothing was explained. A synthesized empty entry would be
    // indistinguishable from prose that came back blank, and a parent would be told
    // their child was shown something that does not exist.
    expect(parentExplanationViews([])).toEqual([]);
    expect(parentExplanationViews([row(), row({ questionId: 'q2' })])).toHaveLength(2);
  });

  it('preserves the read order and sorts nothing', () => {
    // The parent's screen keys these by Question id onto answer-key rows that are
    // already in the order the child met them. A sort here would be a second
    // opinion about an order this has no part in.
    const views = parentExplanationViews([
      row({ questionId: 'q3' }),
      row({ questionId: 'q1' }),
      row({ questionId: 'q2' }),
    ]);
    expect(views.map((view) => view.questionId)).toEqual(['q3', 'q1', 'q2']);
  });

  it('has no field a rationale, a cost, a tier or an allowance could travel in', () => {
    // Not a habit of the mapper but a property of the shape: the rationale is Story
    // 6.5's and suppression is Story 6.4's, and neither has anywhere here to sit
    // (AD-20, AD-26).
    const [view] = parentExplanationViews([row()]);
    const keys = Object.keys(view!);
    for (const forbidden of [
      'rationale',
      'chargedAt',
      'costMicros',
      'tier',
      'model',
      'suppressedAt',
      'studentFlaggedAt',
      'disposition',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('what the origin and the unique key mean', () => {
  it('names the parent origin once, so the read and the write cannot disagree', () => {
    // The `where` that reads a row's flags and the `create` that writes one must
    // agree, or a flag would be written under one origin and read under another —
    // and a parent pressing the control would watch nothing happen.
    expect(PARENT_FLAG_ORIGIN).toBe('Parent');
  });

  it('refuses a flag with the one sentence every ownership refusal reuses', () => {
    // A Question the child never asked about, a Question of another account's
    // Attempt, an unknown Attempt and one still open are four facts and one
    // sentence: spelling them apart is how the outside reads which of another
    // account's ids exist (AD-18).
    expect(NO_EXPLANATION_TO_FLAG).toBe(PRACTICE_TEST_NOT_FOUND);
  });
});
