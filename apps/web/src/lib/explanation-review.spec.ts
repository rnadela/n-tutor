import { describe, expect, it } from 'vitest';
import {
  explanationsByQuestion,
  reviewStateFor,
  studentFlagStateFor,
} from '@/lib/explanation-review';
import type { ParentExplanationView } from '@/lib/parent-api';

function view(overrides: Partial<ParentExplanationView> = {}): ParentExplanationView {
  return {
    questionId: 'q1',
    body: [{ kind: 'text', value: 'Half of six is three.' }],
    parentFlaggedAt: null,
    studentFlaggedAt: null,
    studentFlagDisposition: null,
    studentFlagDispositionAt: null,
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

describe('what one row’s student flag is', () => {
  it('is nothing for an Explanation with no entry at all', () => {
    // A Question the child never asked about has nothing for a parent to decide, and the
    // `absent` case is `reviewStateFor`'s to state, once.
    expect(studentFlagStateFor(undefined)).toBe('none');
  });

  it('is nothing for an Explanation the child never reported', () => {
    // The common case, and not an error: the child read it and moved on.
    expect(studentFlagStateFor(view())).toBe('none');
  });

  it('is awaiting when the child reported it and nobody has decided', () => {
    // Awaiting is the **absence** of a decision rather than a value anybody wrote, which
    // is why it is decided on two fields rather than on a third enum member the API does
    // not have. This is the one state the screen has controls for.
    expect(studentFlagStateFor(view({ studentFlaggedAt: '2026-09-20T08:00:00.000Z' }))).toBe(
      'awaiting',
    );
  });

  it('is the decision once one is recorded, either way', () => {
    expect(
      studentFlagStateFor(
        view({
          studentFlaggedAt: '2026-09-20T08:00:00.000Z',
          studentFlagDisposition: 'Confirmed',
          studentFlagDispositionAt: '2026-09-21T08:00:00.000Z',
        }),
      ),
    ).toBe('confirmed');
    expect(
      studentFlagStateFor(
        view({
          studentFlaggedAt: '2026-09-20T08:00:00.000Z',
          studentFlagDisposition: 'Dismissed',
          studentFlagDispositionAt: '2026-09-21T08:00:00.000Z',
        }),
      ),
    ).toBe('dismissed');
  });

  it('never reads the parent’s own flag as the child’s concern', () => {
    // Two people raising a concern, and two independent facts. A region that read either
    // one for the other would tell a parent their child said something they did not.
    expect(studentFlagStateFor(view({ parentFlaggedAt: '2026-09-28T09:00:00.000Z' }))).toBe('none');
    // And `reviewStateFor` stays exactly what it was: it reads the parent's flag alone.
    expect(reviewStateFor(view({ studentFlaggedAt: '2026-09-20T08:00:00.000Z' }))).toBe(
      'unflagged',
    );
  });

  it('is still a report when the instant will not parse', () => {
    // Decided on the field being **present**, never on a truthiness test of a string: an
    // unreadable instant is still a report, and only the date is unstateable.
    expect(studentFlagStateFor(view({ studentFlaggedAt: 'not-an-instant' }))).toBe('awaiting');
  });
});
