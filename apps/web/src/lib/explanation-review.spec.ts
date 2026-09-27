import { describe, expect, it } from 'vitest';
import { explanationsByQuestion, reviewStateFor } from '@/lib/explanation-review';
import type { ParentExplanationView } from '@/lib/parent-api';

function view(overrides: Partial<ParentExplanationView> = {}): ParentExplanationView {
  return {
    questionId: 'q1',
    body: [{ kind: 'text', value: 'Half of six is three.' }],
    parentFlaggedAt: null,
    ...overrides,
  };
}

describe('keying an Attempt’s Explanations onto its rows', () => {
  it('finds the Explanation of a Question that has one', () => {
    const byQuestion = explanationsByQuestion([view({ questionId: 'q2' }), view()]);
    expect(byQuestion.get('q1')).toBeDefined();
    expect(byQuestion.get('q2')).toBeDefined();
    expect(byQuestion.size).toBe(2);
  });

  it('misses a Question nobody asked about, which is the whole point of the join', () => {
    // The API answers only the Explanations that exist; the screen renders one row
    // per presented Question. The misses are what the row states as "not asked".
    const byQuestion = explanationsByQuestion([view()]);
    expect(byQuestion.get('q-never-asked')).toBeUndefined();
  });

  it('answers an empty map for an Attempt nobody asked anything about', () => {
    expect(explanationsByQuestion([]).size).toBe(0);
  });

  it('keeps the segments it was handed, without touching them', () => {
    // Stored segments are drawn by `components/RichText` and by nothing else (AD-32).
    // Anything reshaped here is a fraction that has lost its spoken reading.
    const body = [
      { kind: 'text' as const, value: 'Three quarters is ' },
      { kind: 'fraction' as const, whole: null, numerator: 3, denominator: 4 },
    ];
    const byQuestion = explanationsByQuestion([view({ body })]);
    expect(byQuestion.get('q1')!.body).toBe(body);
  });
});

describe('what the region beneath one row is', () => {
  it('is absent for a Question with no stored Explanation', () => {
    // The common case, and not an error: the child worked through it without asking.
    // Nothing on this surface generates one, so there is no action attached to it.
    expect(reviewStateFor(undefined)).toBe('absent');
  });

  it('is unflagged for prose nobody has reported', () => {
    expect(reviewStateFor(view({ parentFlaggedAt: null }))).toBe('unflagged');
  });

  it('is flagged once a parent has reported it', () => {
    expect(reviewStateFor(view({ parentFlaggedAt: '2026-09-28T10:15:00.000Z' }))).toBe('flagged');
  });

  it('decides on the instant being present, never on the string being truthy', () => {
    // An instant is the fact. A truthiness test would read an empty string — which
    // the API does not send, but which a future change could — as "never reported",
    // and a parent would watch their own flag disappear.
    expect(reviewStateFor(view({ parentFlaggedAt: '' }))).toBe('flagged');
  });

  it('has three states and no fourth', () => {
    // No `loading`: the Explanations arrive with the Attempt, in one read, so a row
    // is never waiting. No `failed`: a failure is the screen's and is stated once,
    // not repeated on every row of a paper.
    const states = new Set([
      reviewStateFor(undefined),
      reviewStateFor(view()),
      reviewStateFor(view({ parentFlaggedAt: '2026-09-28T10:15:00.000Z' })),
    ]);
    expect([...states].sort()).toEqual(['absent', 'flagged', 'unflagged']);
  });
});
