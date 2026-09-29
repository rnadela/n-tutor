/**
 * Every refusal sentence the deletion path can produce, and the shape of what it
 * reports before it runs — in one file, as `source-test-policy.ts` holds the
 * Source Test mechanism's.
 *
 * Nothing here is a behaviour and nothing here reads a row. The reason it is a
 * file of its own is the reason each module has one: a sentence a parent reads
 * must not be authored twice, and a refusal the web app has to recognise must
 * have exactly one wording to recognise.
 */

/**
 * The wrong-password refusal, answered as a **409 and never a 401**.
 *
 * The web client treats every 401 on a parent-scoped route as the elevation
 * expiring (`endsParentView`) and responds by clearing elevation and routing to
 * the PIN prompt. A mistyped password is not an expired session, and signing the
 * parent out of the screen they are standing on would hide the refusal they most
 * need to read. A 409 already carries a policy sentence to the client, which is
 * the mechanism the rest of the API's rule-refusals use.
 */
export const PASSWORD_INCORRECT =
  'That is not the account password. Check it and try again — nothing has been deleted.';

/**
 * The refusal when a stored photograph could not be removed from disk.
 *
 * "No orphaned stored files" is the requirement, and a half-done delete is the
 * failure mode it names. So the bytes come away **before** any row does, and if
 * even one unlink fails the whole deletion is refused: every row and every other
 * byte stay exactly where they were, and the parent retries. Nothing was lost.
 *
 * A 503, because it is a fault on this side that is worth retrying, and not
 * anything the parent got wrong. Logged by page id alone, never by path (AD-15,
 * AD-20).
 */
export const DELETION_INCOMPLETE =
  'The stored photographs could not all be removed, so nothing was deleted. Try again in a moment.';

/**
 * How long the one deletion transaction may run, in milliseconds.
 *
 * Prisma's default interactive-transaction ceiling is five seconds, and this
 * transaction is not an ordinary one: deleting a child's Practice Tests cascades
 * through their Questions, Choices and topic labels, their Attempts, Answers,
 * grades and disputes, and the Explanations hanging off those — and the profile
 * row then cascades through Mastery and uncommitted work. A child with a year of
 * practice behind them is a lot of rows for one statement tree, and a
 * transaction that aborts on the ceiling is a deletion the parent is told failed
 * after its photographs have already been unlinked.
 *
 * Raised rather than split, because splitting is not available here: the
 * tombstones and the deletes have to commit together or the account's month is
 * refunded. This is exactly the "legitimately long" transaction
 * `PrismaService.withTransaction` documents its `options` for.
 */
export const DELETION_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * How long to wait for a connection before the transaction even starts.
 *
 * Raised with the ceiling above rather than left at the default, because a pool
 * busy enough to make the work slow is a pool busy enough to make acquiring it
 * slow, and failing to start is the same outcome for the parent as failing
 * halfway.
 */
export const DELETION_TRANSACTION_MAX_WAIT_MS = 10_000;

/**
 * What is about to be destroyed, by count and by kind.
 *
 * This is the confirmation's whole content: FR-33 requires the sentence the
 * parent confirms against to name what goes, and "this profile and everything
 * under it" names nothing. Counts and kinds only — no titles, no dates and no ids
 * — because a preview is a warning and not a second way to read a child's work.
 */
export interface ProfileDeletionSummary {
  /** Uploads: the Source Tests photographed for this child, drafts included. */
  sourceTests: number;
  /** The photographs themselves, which is the count a parent recognises. */
  pageImages: number;
  practiceTests: number;
  attempts: number;
  explanations: number;
  /** Topics this child has a stored Mastery figure on. */
  masteryTopics: number;
}
