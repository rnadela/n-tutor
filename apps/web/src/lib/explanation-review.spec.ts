import { describe, expect, it } from 'vitest';
import {
  decidableOf,
  explanationsByQuestion,
  latestOf,
  reviewStateFor,
  studentFlagStateFor,
  suppressionStateFor,
} from '@/lib/explanation-review';
import type { ParentExplanationView } from '@/lib/parent-api';

function view(overrides: Partial<ParentExplanationView> = {}): ParentExplanationView {
  return {
    questionId: 'q1',
    generation: 1,
    suppressedAt: null,
    canSuppress: false,
    body: [{ kind: 'text', value: 'Half of six is three.' }],
    parentFlaggedAt: null,
    studentFlaggedAt: null,
    studentFlagDisposition: null,
    studentFlagDispositionAt: null,
    ...overrides,
  };
}

describe('grouping an Attempt’s Explanations onto its rows', () => {
  it('finds the Explanations of a Question that has one', () => {
    const byQuestion = explanationsByQuestion([view({ questionId: 'q2' }), view()]);
    expect(byQuestion.get('q1')).toHaveLength(1);
    expect(byQuestion.get('q2')).toHaveLength(1);
    expect(byQuestion.size).toBe(2);
  });

  it('keeps every generation of a Question, in the order the API sent them', () => {
    // The collision is the feature since Story 6.4: a removed explanation and its
    // replacement are two entries of one Question, and dropping all but one of them would
    // hide either the prose an operator is judging or the prose the child is being served.
    const byQuestion = explanationsByQuestion([
      view({ generation: 1, suppressedAt: '2026-09-29T11:00:00.000Z' }),
      view({ generation: 2 }),
      view({ questionId: 'q2' }),
    ]);
    expect(byQuestion.get('q1')!.map((entry) => entry.generation)).toEqual([1, 2]);
    expect(byQuestion.get('q2')).toHaveLength(1);
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
    expect(byQuestion.get('q1')![0]!.body).toBe(body);
  });
});

describe('which generation counts', () => {
  it('is the highest ordinal, never the last element', () => {
    // A list index would be right only for as long as the API's order held; the ordinal is
    // the fact the API maintains and its unique key enforces.
    const latest = latestOf([view({ generation: 2 }), view({ generation: 3 }), view()]);
    expect(latest?.generation).toBe(3);
  });

  it('is undefined for a Question nobody asked about, and for nothing at all', () => {
    // `undefined` in and `undefined` out, so the caller hands over whatever the map gave it
    // rather than branching on a miss.
    expect(latestOf(undefined)).toBeUndefined();
    expect(latestOf([])).toBeUndefined();
  });
});

describe('what a parent may do about one Question’s explanation', () => {
  it('is locked for a Question nobody asked about', () => {
    // Nothing to remove and nothing to replace — and the screen renders no control at all,
    // rather than a disabled one that would invite a parent to wonder what they did wrong.
    expect(suppressionStateFor(undefined)).toBe('locked');
    expect(suppressionStateFor([])).toBe('locked');
  });

  it('is locked while no concern is recorded', () => {
    // The API's own answer, read rather than re-derived: a second derivation in the browser
    // would fail silently in the worst direction — a control offered for a concern nobody
    // confirmed.
    expect(suppressionStateFor([view({ canSuppress: false })])).toBe('locked');
  });

  it('is available once the API says a concern is recorded', () => {
    expect(suppressionStateFor([view({ canSuppress: true })])).toBe('available');
  });

  it('is suppressed once it has been removed, and offers no second removal', () => {
    // Not reversible, and pressing again is not a second decision. The API says so with
    // `canSuppress: false`, and this state is where the *replacement* is offered instead.
    expect(
      suppressionStateFor([view({ suppressedAt: '2026-09-29T11:00:00.000Z', canSuppress: false })]),
    ).toBe('suppressed');
  });

  it('reads the latest generation and not an older one', () => {
    // A Question whose generation 1 was removed and whose generation 2 is live is a Question
    // the child can read: the decision to be made is about the one being served.
    expect(
      suppressionStateFor([
        view({ generation: 1, suppressedAt: '2026-09-29T11:00:00.000Z' }),
        view({ generation: 2, canSuppress: true }),
      ]),
    ).toBe('available');
    // And the other way round, whichever order the entries arrive in.
    expect(
      suppressionStateFor([
        view({ generation: 2, suppressedAt: '2026-09-30T11:00:00.000Z' }),
        view({ generation: 1, suppressedAt: '2026-09-29T11:00:00.000Z' }),
      ]),
    ).toBe('suppressed');
  });

  it('decides on the removal instant being present, never on the string being truthy', () => {
    // An instant is the fact. A truthiness test would read an empty string as "still being
    // served", and a parent would watch their own decision disappear.
    expect(suppressionStateFor([view({ suppressedAt: '', canSuppress: true })])).toBe('suppressed');
  });

  it('has three states and no fourth', () => {
    const states = new Set([
      suppressionStateFor(undefined),
      suppressionStateFor([view({ canSuppress: true })]),
      suppressionStateFor([view({ suppressedAt: '2026-09-29T11:00:00.000Z' })]),
    ]);
    expect([...states].sort()).toEqual(['available', 'locked', 'suppressed']);
  });
});

describe('which generation a decision would land on', () => {
  it('is the oldest undecided report, not the latest generation', () => {
    // This mirrors the API's own pick, and it has to: `disposeStudentFlag` decides the oldest
    // undecided student report across every generation. A screen that put Agree and Dismiss
    // beside the latest would have a parent press next to generation 2 and watch generation 1
    // get decided, with the region they pressed in not changing at all.
    const decidable = decidableOf([
      view({ generation: 1, studentFlaggedAt: '2026-09-20T08:00:00.000Z' }),
      view({ generation: 2, studentFlaggedAt: '2026-09-30T08:00:00.000Z' }),
    ]);
    expect(decidable?.generation).toBe(1);
  });

  it('skips a generation whose report is already decided', () => {
    const decidable = decidableOf([
      view({
        generation: 1,
        studentFlaggedAt: '2026-09-20T08:00:00.000Z',
        studentFlagDisposition: 'Confirmed',
        studentFlagDispositionAt: '2026-09-21T08:00:00.000Z',
      }),
      view({ generation: 2, studentFlaggedAt: '2026-09-30T08:00:00.000Z' }),
    ]);
    expect(decidable?.generation).toBe(2);
  });

  it('falls back to the newest decided report where none is undecided', () => {
    // The API's own fallback, which is what its 200-on-a-repeat and 409-on-a-reversal arms read
    // against: a parent pressing again on a Question whose every report is decided is answered
    // by the most recent decision rather than by the oldest one they made.
    const decidable = decidableOf([
      view({
        generation: 1,
        studentFlaggedAt: '2026-09-20T08:00:00.000Z',
        studentFlagDisposition: 'Confirmed',
        studentFlagDispositionAt: '2026-09-21T08:00:00.000Z',
      }),
      view({
        generation: 2,
        studentFlaggedAt: '2026-09-30T08:00:00.000Z',
        studentFlagDisposition: 'Dismissed',
        studentFlagDispositionAt: '2026-10-01T08:00:00.000Z',
      }),
    ]);
    expect(decidable?.generation).toBe(2);
  });

  it('reads the ordinal and not the list order', () => {
    // The ordinal is the fact the API maintains; a list index would be right only for as long
    // as the read's order held.
    const decidable = decidableOf([
      view({ generation: 3, studentFlaggedAt: '2026-09-30T08:00:00.000Z' }),
      view({ generation: 2, studentFlaggedAt: '2026-09-20T08:00:00.000Z' }),
    ]);
    expect(decidable?.generation).toBe(2);
  });

  it('is undefined where no generation carries a report at all', () => {
    // The case the screen draws no decision controls for, and the API answers with its
    // shared 404.
    expect(decidableOf(undefined)).toBeUndefined();
    expect(decidableOf([])).toBeUndefined();
    expect(decidableOf([view(), view({ generation: 2 })])).toBeUndefined();
  });

  it('ignores a generation the parent flagged but the child did not report', () => {
    // A parent-origin flag is their own judgement; there is nothing for them to decide about
    // it, and the API's 404 says so.
    expect(decidableOf([view({ parentFlaggedAt: '2026-09-28T09:00:00.000Z' })])).toBeUndefined();
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
