import { describe, expect, it } from 'vitest';
import { PRACTICE_TEST_NOT_FOUND } from '../practicetest/practice-test-policy.js';
import {
  FLAG_ALREADY_DISPOSED,
  NO_EXPLANATION_TO_FLAG,
  NO_STUDENT_FLAG_TO_DISPOSE,
} from './explanation-policy.js';
import {
  PARENT_FLAG_ORIGIN,
  STUDENT_FLAG_ORIGIN,
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
    // The first and, for most rows, only generation. Stated rather than defaulted away,
    // because `generation` is what tells two entries of one Question apart.
    generation: 1,
    suppressedAt: null,
    flags: [],
    ...overrides,
  };
}

/** One parent-originated flag. A parent's own judgement, so never a disposition. */
function parentFlag(at: string): StoredExplanationRow['flags'][number] {
  return {
    origin: PARENT_FLAG_ORIGIN,
    createdAt: new Date(at),
    disposition: null,
    dispositionAt: null,
  };
}

/**
 * One student-originated flag, awaiting a decision unless one is given.
 *
 * `decidedAt` is a **different instant** from `at`, deliberately and by default: the two
 * are separate columns written at separate moments, and a fixture where they agreed
 * would let a mapper that read `createdAt` into `studentFlagDispositionAt` pass every
 * case here. When a child raised a concern and when their parent decided about it are
 * not the same fact.
 */
function studentFlag(
  at: string,
  disposition: 'Confirmed' | 'Dismissed' | null = null,
  decidedAt = '2026-09-25T17:45:00.000Z',
): StoredExplanationRow['flags'][number] {
  return {
    origin: STUDENT_FLAG_ORIGIN,
    createdAt: new Date(at),
    disposition,
    // Null exactly where the disposition is: the API writes the two in one statement.
    dispositionAt: disposition === null ? null : new Date(decidedAt),
  };
}

describe('what a stored Explanation becomes on the way to a parent', () => {
  it('carries the Question, the stored segments and nothing else', () => {
    const [view] = parentExplanationViews([row()]);
    expect(Object.keys(view!).sort()).toEqual([
      'body',
      'canSuppress',
      'generation',
      'parentFlaggedAt',
      'questionId',
      'studentFlagDisposition',
      'studentFlagDispositionAt',
      'studentFlaggedAt',
      'suppressedAt',
    ]);
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
    expect(view!.studentFlaggedAt).toBeNull();
    expect(view!.studentFlagDisposition).toBeNull();
    expect(view!.studentFlagDispositionAt).toBeNull();
  });

  it('states when the concern was first raised, as an instant and not a boolean', () => {
    const first = new Date('2026-09-28T10:15:00.000Z');
    const [view] = parentExplanationViews([
      row({ flags: [{ ...parentFlag('2026-09-28T10:15:00.000Z'), createdAt: first }] }),
    ]);
    expect(view!.parentFlaggedAt).toBe('2026-09-28T10:15:00.000Z');
  });

  it('folds both origins by origin, never by position in the list', () => {
    // `flags[0]` was safe while the read filtered to one origin. With both origins in
    // the list it would be whichever row the planner happened to return first — which
    // is how a child's concern gets reported to a parent as their own. So the order is
    // deliberately the *wrong* way round here, and both fields must still be right.
    const [view] = parentExplanationViews([
      row({
        flags: [studentFlag('2026-09-20T08:00:00.000Z'), parentFlag('2026-09-28T09:00:00.000Z')],
      }),
    ]);
    expect(view!.parentFlaggedAt).toBe('2026-09-28T09:00:00.000Z');
    expect(view!.studentFlaggedAt).toBe('2026-09-20T08:00:00.000Z');
  });

  it('reports a student flag nobody has decided about as awaiting, not as absent', () => {
    // Awaiting is the *lack* of a decision, and it is told from "no student flag at
    // all" by `studentFlaggedAt` — which is why the two are separate fields and not one
    // three-state string. A screen that could not tell them apart would show a parent
    // nothing to decide about a concern their child raised.
    const [view] = parentExplanationViews([
      row({ flags: [studentFlag('2026-09-20T08:00:00.000Z')] }),
    ]);
    expect(view!.studentFlaggedAt).toBe('2026-09-20T08:00:00.000Z');
    expect(view!.studentFlagDisposition).toBeNull();
    expect(view!.studentFlagDispositionAt).toBeNull();
  });

  it('keeps reporting a dismissed student flag, with its decision', () => {
    // A dismissal is not a deletion. The concern was raised, the parent decided, and
    // the entry says both — a view that dropped it would make the parent's own decision
    // look like the concern never happened.
    const [view] = parentExplanationViews([
      row({ flags: [studentFlag('2026-09-20T08:00:00.000Z', 'Dismissed')] }),
    ]);
    expect(view!.studentFlaggedAt).toBe('2026-09-20T08:00:00.000Z');
    expect(view!.studentFlagDisposition).toBe('Dismissed');
    // The decision's **own** instant, which is not the instant the concern was raised: a
    // mapper reading `createdAt` into this field would date every decision to the moment
    // the child pressed, and a parent would read that they decided before they did.
    expect(view!.studentFlagDispositionAt).toBe('2026-09-25T17:45:00.000Z');
    expect(view!.studentFlagDispositionAt).not.toBe(view!.studentFlaggedAt);
  });

  it('never gives a parent-origin flag a disposition, whatever is on the row', () => {
    // A parent-origin flag *is* the parent's own judgement, so there is nothing for
    // them to decide about it. The disposition is read off the student's flag and only
    // ever that one — here the parent's row carries a value it has no business carrying,
    // and it still does not reach the view.
    const [view] = parentExplanationViews([
      row({
        flags: [
          {
            ...parentFlag('2026-09-28T09:00:00.000Z'),
            disposition: 'Confirmed',
            dispositionAt: new Date('2026-09-28T09:30:00.000Z'),
          },
        ],
      }),
    ]);
    expect(view!.parentFlaggedAt).toBe('2026-09-28T09:00:00.000Z');
    expect(view!.studentFlaggedAt).toBeNull();
    expect(view!.studentFlagDisposition).toBeNull();
    expect(view!.studentFlagDispositionAt).toBeNull();
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
    // 6.5's and has nowhere here to sit, and nothing about what a row cost does either —
    // including the free one (AD-20, AD-26). `suppressedAt` *is* here now, deliberately:
    // it is a serving rule the parent decided and the parent reads.
    const [view] = parentExplanationViews([row()]);
    const keys = Object.keys(view!);
    for (const forbidden of [
      'rationale',
      'chargedAt',
      'costMicros',
      'tier',
      'model',
      'suppressionReason',
      'disputeFlag',
      'mastery',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('when a parent may take an Explanation away from their child', () => {
  it('offers it for a parent-origin flag', () => {
    // A parent-origin flag *is* the parent's own judgement: there is nothing further to
    // ask them, which is why it qualifies outright in the Admin queue's `where` too.
    const [view] = parentExplanationViews([
      row({ flags: [parentFlag('2026-09-28T09:00:00.000Z')] }),
    ]);
    expect(view!.canSuppress).toBe(true);
  });

  it('offers it for a student flag the parent confirmed', () => {
    const [view] = parentExplanationViews([
      row({ flags: [studentFlag('2026-09-20T08:00:00.000Z', 'Confirmed')] }),
    ]);
    expect(view!.canSuppress).toBe(true);
  });

  it('withholds it where nothing at all is recorded', () => {
    // Never automatic. Suppression follows a recorded concern, and no concern is recorded
    // here — so the control is not offered and the API's own 409 says the same thing.
    const [view] = parentExplanationViews([row({ flags: [] })]);
    expect(view!.canSuppress).toBe(false);
  });

  it('withholds it while the child\u2019s report is awaiting a decision', () => {
    // A concern nobody has read is not a judgement. Its own case beside the two below,
    // because "awaiting" is the *absence* of a disposition and a predicate that tested
    // truthiness rather than the value would let it through.
    const [view] = parentExplanationViews([
      row({ flags: [studentFlag('2026-09-20T08:00:00.000Z')] }),
    ]);
    expect(view!.canSuppress).toBe(false);
  });

  it('withholds it where the parent dismissed the child\u2019s report', () => {
    // A dismissal is the parent having read the same prose and judged it fine. Its own
    // case, because a predicate that only asked whether a disposition exists would offer
    // suppression for exactly the decision that says not to.
    const [view] = parentExplanationViews([
      row({ flags: [studentFlag('2026-09-20T08:00:00.000Z', 'Dismissed')] }),
    ]);
    expect(view!.canSuppress).toBe(false);
  });

  it('withholds it on one already removed, however it was unlocked', () => {
    // Suppression is not reversible and pressing again is not a second decision. The
    // control's availability is the server's answer, so this is where that is stated.
    const [view] = parentExplanationViews([
      row({
        flags: [parentFlag('2026-09-28T09:00:00.000Z')],
        suppressedAt: new Date('2026-09-29T11:00:00.000Z'),
      }),
    ]);
    expect(view!.canSuppress).toBe(false);
    expect(view!.suppressedAt).toBe('2026-09-29T11:00:00.000Z');
  });

  it('keeps reporting a removed generation\u2019s body and both flag facts', () => {
    // A suppressed row is retained and stays parent-readable: the parent who decided
    // about it remains able to read what they decided about, and so does the operator.
    const [view] = parentExplanationViews([
      row({
        suppressedAt: new Date('2026-09-29T11:00:00.000Z'),
        flags: [
          parentFlag('2026-09-28T09:00:00.000Z'),
          studentFlag('2026-09-20T08:00:00.000Z', 'Confirmed'),
        ],
      }),
    ]);
    expect(view!.body).toEqual([{ kind: 'text', value: 'Two halves make one whole.' }]);
    expect(view!.parentFlaggedAt).toBe('2026-09-28T09:00:00.000Z');
    expect(view!.studentFlaggedAt).toBe('2026-09-20T08:00:00.000Z');
    expect(view!.studentFlagDisposition).toBe('Confirmed');
  });

  it('maps two generations of one Question to two entries, each with its own state', () => {
    // The view carries one entry **per generation** since Story 6.4, not one per Question:
    // the removed explanation and its replacement are two rows, and the screen groups them
    // by `questionId`. Each keeps its own flags, its own removal instant and its own
    // answer about whether it may be removed.
    const views = parentExplanationViews([
      row({
        generation: 1,
        suppressedAt: new Date('2026-09-29T11:00:00.000Z'),
        flags: [parentFlag('2026-09-28T09:00:00.000Z')],
      }),
      row({ generation: 2, body: [{ kind: 'text', value: 'Try it with a picture.' }] }),
    ]);
    expect(views.map((view) => view.questionId)).toEqual(['q1', 'q1']);
    expect(views.map((view) => view.generation)).toEqual([1, 2]);
    expect(views[0]!.suppressedAt).toBe('2026-09-29T11:00:00.000Z');
    expect(views[0]!.canSuppress).toBe(false);
    expect(views[1]!.suppressedAt).toBeNull();
    // Nothing is recorded against the replacement yet, so it cannot be removed either —
    // a concern has to be raised first, on every generation, with no ceiling and no
    // carry-over from the one it replaced.
    expect(views[1]!.canSuppress).toBe(false);
  });
});

describe('what the origin and the unique key mean', () => {
  it('names the parent origin once, so the read and the write cannot disagree', () => {
    // The `where` that reads a row's flags and the `create` that writes one must
    // agree, or a flag would be written under one origin and read under another —
    // and a parent pressing the control would watch nothing happen.
    expect(PARENT_FLAG_ORIGIN).toBe('Parent');
  });

  it('names the student origin once, beside the parent\u2019s, and not as an enum change', () => {
    // Both members were declared by Story 6.2 precisely so the student route would be a
    // code path. Two constants are what keep the write and three reads — the child's own
    // response, the parent's, and the Admin queue — agreeing about one word.
    expect(STUDENT_FLAG_ORIGIN).toBe('Student');
    expect(STUDENT_FLAG_ORIGIN).not.toBe(PARENT_FLAG_ORIGIN);
  });

  it('refuses a flag with the one sentence every ownership refusal reuses', () => {
    // A Question the child never asked about, a Question of another account's
    // Attempt, an unknown Attempt and one still open are four facts and one
    // sentence: spelling them apart is how the outside reads which of another
    // account's ids exist (AD-18).
    expect(NO_EXPLANATION_TO_FLAG).toBe(PRACTICE_TEST_NOT_FOUND);
  });
});

describe('what a disposition is, and what refuses a second one', () => {
  it('refuses a missing student flag with the same sentence every ownership refusal reuses', () => {
    // A Question with no Explanation, one whose Explanation nobody reported, a foreign
    // Attempt and one still open are four facts and one sentence: spelling them apart is
    // how the outside reads which of another account's ids exist (AD-18). It is its own
    // constant because the *reason* differs, not the wording.
    expect(NO_STUDENT_FLAG_TO_DISPOSE).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(NO_STUDENT_FLAG_TO_DISPOSE).toBe(NO_EXPLANATION_TO_FLAG);
  });

  it('states that the first decision stands, and states nothing else', () => {
    // The one 409 this surface has. A repeat of the *same* decision is 200 with the
    // first instant, because a double-tap is one decision; a different one is this.
    expect(FLAG_ALREADY_DISPOSED).not.toBe(PRACTICE_TEST_NOT_FOUND);
    expect(FLAG_ALREADY_DISPOSED).toMatch(/first decision stands/u);
    // No child, no Question, no instant, no tier, no number, no apology, and no
    // instruction to try again — trying again is exactly what it refuses.
    expect(FLAG_ALREADY_DISPOSED).not.toMatch(/\d/u);
    expect(FLAG_ALREADY_DISPOSED).not.toMatch(/sorry|apolog|try again|tier|plan|cost/iu);
    expect(FLAG_ALREADY_DISPOSED).not.toContain('!');
  });
});
