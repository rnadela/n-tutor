import { describe, expect, it } from 'vitest';
import { adminQueueEntries, type AdminFlagRow } from './admin-flag-queue.js';
import { PARENT_FLAG_ORIGIN, STUDENT_FLAG_ORIGIN } from './explanation-flag.js';

/**
 * The Admin queue's de-duplication, which is the architecture's open question decided.
 *
 * It is decided as a **pure function** precisely so it can be asserted here: "one entry
 * per Explanation, both routes named, the earliest qualifying instant" is a claim, and a
 * claim that can only be checked by standing up Postgres is a claim nothing checks.
 *
 * What *qualifies* is the read's `where` and not this function's business — that an
 * awaiting or dismissed student flag never reaches an Admin response at all is a query
 * guarantee, and it is asserted in `test/student-explanation-flag.int-spec.ts` against
 * the real app.
 */

function explanation(id: string) {
  return {
    id,
    parentAccountId: `account-for-${id}`,
    studentProfileId: `child-for-${id}`,
    attemptId: `attempt-for-${id}`,
    questionId: `question-for-${id}`,
    body: [{ kind: 'text', value: `The prose of ${id}.` }],
  };
}

function parentRow(explanationId: string, at: string): AdminFlagRow {
  return {
    origin: PARENT_FLAG_ORIGIN,
    createdAt: new Date(at),
    explanation: explanation(explanationId),
  };
}

function studentRow(explanationId: string, at: string): AdminFlagRow {
  return {
    origin: STUDENT_FLAG_ORIGIN,
    createdAt: new Date(at),
    explanation: explanation(explanationId),
  };
}

describe('what an operator gets one of', () => {
  it('carries the prose, the identifiers, the routes and the instant — and nothing else', () => {
    const [entry] = adminQueueEntries([parentRow('e1', '2026-09-28T10:00:00.000Z')]);
    expect(Object.keys(entry!).sort()).toEqual([
      'attemptId',
      'body',
      'explanationId',
      'parentAccountId',
      'questionId',
      'raisedAt',
      'raisedBy',
      'studentProfileId',
    ]);
    // No child's display name, no account email, no cost, no tier, no model name, no
    // allowance figure and no grading rationale (AD-20, AD-26): judging a paragraph takes
    // the paragraph and the ids.
    for (const forbidden of [
      'displayName',
      'email',
      'costMicros',
      'tier',
      'model',
      'rationale',
      'chargedAt',
      'disposition',
    ]) {
      expect(Object.keys(entry!)).not.toContain(forbidden);
    }
  });

  it('passes the segments out exactly as stored, without re-parsing them', () => {
    // An operator judging a fraction has to be shown the fraction (AD-32). Re-parsing on
    // the way out would be a second chance for two readings of a row neither of them
    // wrote to disagree.
    const row = parentRow('e1', '2026-09-28T10:00:00.000Z');
    const [entry] = adminQueueEntries([row]);
    expect(entry!.body).toBe(row.explanation.body);
  });

  it('answers an empty queue with an empty list, which is the normal case', () => {
    expect(adminQueueEntries([])).toEqual([]);
  });
});

describe('one Explanation, one entry', () => {
  it('folds a parent flag and a confirmed student flag on one Explanation into one entry', () => {
    // Two rows legitimately qualify for one Explanation, and the operator's job is to
    // judge *the prose*, once. Two entries would make the same paragraph arrive twice
    // with nothing to tell them apart.
    const entries = adminQueueEntries([
      studentRow('e1', '2026-09-20T08:00:00.000Z'),
      parentRow('e1', '2026-09-28T10:00:00.000Z'),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.explanationId).toBe('e1');
  });

  it('names both routes rather than collapsing to one', () => {
    // A `DISTINCT` on the Explanation would silently lose which route raised it — which
    // is exactly the fact that says whether a child was involved.
    const [entry] = adminQueueEntries([
      studentRow('e1', '2026-09-20T08:00:00.000Z'),
      parentRow('e1', '2026-09-28T10:00:00.000Z'),
    ]);
    expect(entry!.raisedBy).toEqual(['Parent', 'Student']);
  });

  it('lists the routes in one fixed order, whatever order the rows arrive in', () => {
    // An order that varied per row would look like a fact about the flags and is not
    // one: two entries raised the same two ways must read identically.
    const [first] = adminQueueEntries([
      parentRow('e1', '2026-09-20T08:00:00.000Z'),
      studentRow('e1', '2026-09-28T10:00:00.000Z'),
    ]);
    const [second] = adminQueueEntries([
      studentRow('e2', '2026-09-20T08:00:00.000Z'),
      parentRow('e2', '2026-09-28T10:00:00.000Z'),
    ]);
    expect(first!.raisedBy).toEqual(second!.raisedBy);
  });

  it('takes the earliest qualifying instant as the queue position', () => {
    // The entry's place is when the concern was *first* raised by either route, not when
    // the row this fold happened to see first was.
    const [entry] = adminQueueEntries([
      parentRow('e1', '2026-09-28T10:00:00.000Z'),
      studentRow('e1', '2026-09-20T08:00:00.000Z'),
    ]);
    expect(entry!.raisedAt).toBe('2026-09-20T08:00:00.000Z');
  });

  it('never lists one route twice, which is the unique key restated', () => {
    // `@@unique([explanationId, origin])` allows one row per origin, so this is the
    // index stated rather than an ambiguity resolved.
    const [entry] = adminQueueEntries([
      parentRow('e1', '2026-09-20T08:00:00.000Z'),
      parentRow('e1', '2026-09-28T10:00:00.000Z'),
    ]);
    expect(entry!.raisedBy).toEqual(['Parent']);
    expect(entry!.raisedAt).toBe('2026-09-20T08:00:00.000Z');
  });

  it('keeps two different Explanations apart, even flagged the same way', () => {
    const entries = adminQueueEntries([
      parentRow('e1', '2026-09-20T08:00:00.000Z'),
      parentRow('e2', '2026-09-21T08:00:00.000Z'),
    ]);
    expect(entries.map((entry) => entry.explanationId)).toEqual(['e1', 'e2']);
  });
});

describe('the order the queue is worked in', () => {
  it('lists the oldest qualifying concern first', () => {
    const entries = adminQueueEntries([
      parentRow('e2', '2026-09-25T08:00:00.000Z'),
      parentRow('e1', '2026-09-20T08:00:00.000Z'),
      parentRow('e3', '2026-09-28T08:00:00.000Z'),
    ]);
    expect(entries.map((entry) => entry.explanationId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('sorts on the folded instant rather than trusting the read order', () => {
    // An entry's instant is the *minimum* over its rows, so a fold that leaned on the
    // caller's ordering would be one `orderBy` away from listing a queue in an order its
    // own `raisedAt` column contradicts.
    const entries = adminQueueEntries([
      parentRow('e1', '2026-09-28T10:00:00.000Z'),
      parentRow('e2', '2026-09-27T10:00:00.000Z'),
      // This is what makes e1 the older entry, and it arrives last.
      studentRow('e1', '2026-09-01T08:00:00.000Z'),
    ]);
    expect(entries.map((entry) => entry.explanationId)).toEqual(['e1', 'e2']);
    expect(entries.map((entry) => entry.raisedAt)).toEqual([
      '2026-09-01T08:00:00.000Z',
      '2026-09-27T10:00:00.000Z',
    ]);
  });

  it('breaks a tie on the Explanation id, so the order is stable', () => {
    // Two concerns raised inside the same millisecond still come back in one order,
    // rather than in whatever order the map happened to be built in.
    const together = '2026-09-20T08:00:00.000Z';
    const entries = adminQueueEntries([parentRow('e9', together), parentRow('e1', together)]);
    expect(entries.map((entry) => entry.explanationId)).toEqual(['e1', 'e9']);
  });
});
