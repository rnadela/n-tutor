import type { ExplanationFlagOrigin } from '../generated/prisma/enums.js';
import type { RichText } from '../extraction/rich-text.js';

/**
 * One **Explanation** an operator has to judge, which is the queue's unit.
 *
 * **The identity of a queue entry is the Explanation, not the flag.** Two rows can
 * legitimately qualify for one Explanation — a parent who originated a flag, and a
 * student flag the same parent later confirmed — and the operator's job is to judge
 * *the prose*, once. Two entries would make the same paragraph arrive twice with
 * nothing to tell them apart; a `DISTINCT` on the Explanation would silently lose
 * which route raised it, which is exactly the fact that says whether a child was
 * involved.
 *
 * `raisedBy` is therefore a list rather than a single origin, and `raisedAt` is the
 * **earliest qualifying** instant, which is the entry's place in the queue.
 *
 * The identifiers are here because an operator acting on an Explanation needs to be
 * able to name it. **No child's display name, no account email, no cost, no tier, no
 * model name and no allowance figure** (AD-20, AD-26): an operator judging prose needs
 * the prose and the ids, and every one of those other facts would be a detail about a
 * family that reading a paragraph does not require.
 */
export interface AdminFlaggedExplanationView {
  explanationId: string;
  parentAccountId: string;
  studentProfileId: string;
  attemptId: string;
  questionId: string;
  /** The stored segments, exactly as stored (AD-32). The thing being judged. */
  body: RichText;
  /**
   * Which routes raised it, each at most once, in a fixed order.
   *
   * Fixed rather than the order the rows arrived in, so two entries raised the same
   * two ways read identically: an order that varied per row would look like a fact
   * about the flags and is not one.
   */
  raisedBy: ExplanationFlagOrigin[];
  /** The earliest instant any qualifying flag was raised. The queue position. */
  raisedAt: string;
}

/**
 * One qualifying flag row, as the queue read selects it.
 *
 * Which rows *qualify* is the read's `where` and not this function's business: the
 * filter is "parent-origin, or student-origin confirmed", it lives in the service, and
 * it is a `where` rather than a pass here because an unconfirmed student flag must be
 * unable to reach an Admin response at all — filtering it out after the fact would
 * make the guarantee a discipline rather than a query.
 */
export interface AdminFlagRow {
  origin: ExplanationFlagOrigin;
  createdAt: Date;
  explanation: {
    id: string;
    parentAccountId: string;
    studentProfileId: string;
    attemptId: string;
    questionId: string;
    body: unknown;
  };
}

/** The order `raisedBy` is always listed in, whatever order the rows arrive in. */
const ROUTE_ORDER: readonly ExplanationFlagOrigin[] = ['Parent', 'Student'];

/**
 * Where one route sorts, with anything unlisted ranked **last** rather than first.
 *
 * A bare `indexOf` answers `-1` for a route this file does not know, which sorts it
 * ahead of `Parent` — so the day a third origin is added, the fixed order this file
 * promises would quietly become "the new one, then the two named here". Ranking it last
 * keeps the guarantee true of the routes that exist while the enum grows, and the new
 * origin still appears rather than being dropped.
 */
function rankOf(origin: ExplanationFlagOrigin): number {
  const at = ROUTE_ORDER.indexOf(origin);
  return at === -1 ? ROUTE_ORDER.length : at;
}

/**
 * Qualifying flag rows, folded into one entry per Explanation — as one pure function.
 *
 * Pure and file-local so the de-duplication is assertable without a database, which
 * is the point: "one entry, both routes, the earliest instant" is the architecture's
 * open question decided, and a decision that can only be checked by standing up
 * Postgres is a decision nothing checks.
 *
 * **Ordered oldest qualifying first**, and sorted here rather than trusted from the
 * caller: the instant an entry takes is the *minimum* over its rows, so a fold that
 * leaned on the read's ordering would be one `orderBy` away from listing a queue in an
 * order its own `raisedAt` column contradicts. Ties break on the Explanation id, so
 * two concerns raised in the same millisecond still come back in a stable order.
 *
 * A row whose `explanation` is absent cannot occur — the relation is required and the
 * edge cascades — so nothing here invents an entry for one.
 */
export function adminQueueEntries(rows: readonly AdminFlagRow[]): AdminFlaggedExplanationView[] {
  const byExplanation = new Map<string, { view: AdminFlaggedExplanationView; raisedAt: Date }>();

  for (const row of rows) {
    const held = byExplanation.get(row.explanation.id);
    if (held === undefined) {
      byExplanation.set(row.explanation.id, {
        raisedAt: row.createdAt,
        view: {
          explanationId: row.explanation.id,
          parentAccountId: row.explanation.parentAccountId,
          studentProfileId: row.explanation.studentProfileId,
          attemptId: row.explanation.attemptId,
          questionId: row.explanation.questionId,
          // Stored segments travel out exactly as stored (AD-32): a fraction an
          // operator has to judge keeps its structure.
          body: row.explanation.body as RichText,
          raisedBy: [row.origin],
          raisedAt: row.createdAt.toISOString(),
        },
      });
      continue;
    }
    // The earliest qualifying instant, not the first row seen: the queue position is
    // when the concern was first raised by either route.
    if (row.createdAt < held.raisedAt) {
      held.raisedAt = row.createdAt;
      held.view.raisedAt = row.createdAt.toISOString();
    }
    // At most one row per origin by `@@unique([explanationId, origin])`, so this guard
    // is the unique key restated rather than an ambiguity being resolved.
    if (!held.view.raisedBy.includes(row.origin)) held.view.raisedBy.push(row.origin);
  }

  const entries = [...byExplanation.values()];
  for (const entry of entries) {
    entry.view.raisedBy.sort((left, right) => rankOf(left) - rankOf(right));
  }
  entries.sort(
    (left, right) =>
      left.raisedAt.getTime() - right.raisedAt.getTime() ||
      left.view.explanationId.localeCompare(right.view.explanationId),
  );
  return entries.map((entry) => entry.view);
}
