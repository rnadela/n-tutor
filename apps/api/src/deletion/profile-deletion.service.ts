import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { UsageClass } from '../generated/prisma/enums.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import { ExplanationService } from '../explanation/explanation.service.js';
import { ParentAccountService } from '../identity/parent-account.service.js';
import { PROFILE_NOT_FOUND, StudentProfileService } from '../identity/student-profile.service.js';
import { PracticeTestService } from '../practicetest/practice-test.service.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { PageExpiryService } from '../sourcetest/page-expiry.service.js';
import { SourceTestService } from '../sourcetest/source-test.service.js';
import {
  DELETION_INCOMPLETE,
  DELETION_TRANSACTION_MAX_WAIT_MS,
  DELETION_TRANSACTION_TIMEOUT_MS,
  PASSWORD_INCORRECT,
  type ProfileDeletionSummary,
} from './deletion-policy.js';

/**
 * The label both log-writing routines carry on this path (AD-20).
 *
 * Passed explicitly rather than defaulted inside `PageExpiryService`: two
 * deletions share that one unlink site, and a caller that said nothing would log
 * the other one's name.
 */
const TRIGGER = 'Student Profile deletion' as const;

/** One tombstone to write: a period, a class and how many charges fell in it. */
interface TombstoneEntry {
  periodStart: Date;
  usageClass: UsageClass;
  count: number;
}

/**
 * The FR-33 deletion of a Student Profile and everything under it.
 *
 * **Deletion erases.** Rows are removed and bytes are unlinked. There is no
 * soft-delete, no husk row and no `deletedAt` column on `StudentProfile`: an
 * archive already exists for "hide this child but keep their history", and a
 * delete that kept the history would be a second archive under a word that
 * promises the opposite.
 *
 * **Why this module exists at all.** `sourcetest`, `practicetest`, `explanation`
 * and `grading` all import `IdentityModule` for the elevation guard, so injecting
 * any of their services into `StudentProfileService` would make every one of them
 * a cycle. `AnalyticsModule` already shows the shape: a leaf that imports many
 * and is imported by none. The entity owners keep their delegates (AD-17) and
 * expose narrow purge and count methods; this service decides only the **order**.
 *
 * **The order is the correctness argument.** The `Restrict` edges from
 * `SourceTest`, `PracticeTest` and `GenerationJob` to `StudentProfile` are
 * deliberate — nothing of a child's is ever removed as a side effect of
 * something else — so the deletion walks them inward-out itself: Practice Tests,
 * then the Generation Jobs that produced them, then the Source Tests (whose
 * pages and Extractions cascade with them), then the profile row (whose
 * Attempts, Explanations, Mastery and uncommitted work cascade with it). Not one
 * edge is weakened to `Cascade` to make this easier.
 *
 * **Bytes first, and any failure refuses everything.** Story 8.1 unlinks before
 * marking so a crash leaves a row whose file is already gone — recoverable,
 * because the next sweep re-selects it. Here the rows are about to disappear, so
 * there is no next pass: a file left behind after its row is gone is precisely
 * the orphan §5.2 says does not exist. Unlinking every page first and refusing
 * the whole deletion if any one fails is the only order with no orphan in it.
 *
 * **And if the transaction then fails, the rows are corrected rather than left
 * lying.** The bytes are already gone by then, and the rollback puts every row
 * back — including `PageImage` rows still saying `Ready` with a `storagePath`
 * pointing at nothing. So the released pages are marked exactly as the retention
 * sweep marks them, which is the one statement that makes the rows true again.
 * The parent is told nothing was deleted, which is also true: the profile, the
 * work and the history are all still there, and only the photographs are gone —
 * the same outcome the 90-day sweep produces on its own.
 *
 * **Tombstones and the charge collection are inside the transaction, with the
 * deletes.** Allowance is derived by counting artifacts (AD-14), so removing them
 * would refund the account's month and make delete-and-recreate a path to
 * unlimited free generation. Collecting the charging instants *outside* the
 * transaction would leave a window in which an artifact is charged, deleted and
 * never tombstoned — the same refund by a narrower door — so the collection, the
 * tombstones and the deletes all read and write one snapshot.
 *
 * **Every read and write is scoped by `parentAccountId`,** as every method on
 * `StudentProfileService` is: another account's id is a 404, never a 403, which
 * would confirm the profile exists somewhere.
 */
@Injectable()
export class ProfileDeletionService {
  private readonly logger = new Logger(ProfileDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: ParentAccountService,
    private readonly students: StudentProfileService,
    private readonly sourceTests: SourceTestService,
    // The one routine that unlinks a page's stored bytes, whichever trigger
    // asked (Story 8.1). Reached through it rather than through
    // `PageIngestService` directly, so the logging discipline and the
    // `ENOENT`-is-success contract stay stated exactly once.
    private readonly pageExpiry: PageExpiryService,
    private readonly practiceTests: PracticeTestService,
    private readonly explanations: ExplanationService,
    // Period windows, and nothing else. Which window a past charging instant
    // fell in is `allowance`'s computation (AD-14) and is not re-derived here.
    private readonly allowance: AllowanceService,
  ) {}

  /**
   * What deleting this profile would destroy, by count and by kind.
   *
   * The confirmation's content, because FR-33 requires the sentence the parent
   * confirms against to name what goes. Ownership-scoped like everything else:
   * another account's id is a 404 and never a 403.
   *
   * Counts and kinds only. A preview that listed titles or dates would be a
   * second way to read a child's work, reachable from a route whose whole
   * purpose is to destroy it.
   */
  async previewFor(parentAccountId: string, id: string): Promise<ProfileDeletionSummary> {
    await this.requireOwned(parentAccountId, id);
    const [uploads, tests, explained, masteryTopics] = await Promise.all([
      this.sourceTests.countsFor(id),
      this.practiceTests.countsFor(id),
      this.explanations.countsFor(id),
      // `grading`'s table, counted through this module's own `PrismaService`
      // rather than by importing `GradingModule` for one number. The same
      // arrangement `allowance` makes for its two counts and for the same
      // reason: what is read is a row count and not a behaviour, and a Mastery
      // row is a derived figure that cascades from the profile — nothing here
      // writes one, and nothing here could.
      this.prisma.topicMastery.count({ where: { studentProfileId: id } }),
    ]);
    return { ...uploads, ...tests, ...explained, masteryTopics };
  }

  /**
   * Deletes the profile and everything under it, or deletes nothing at all.
   *
   * Ownership, then the password, then the bytes, then one transaction that
   * proves the page set did not move, collects the charges, writes the
   * tombstones and walks the `Restrict` edges inward-out — in that order, and
   * the order is the whole of the method's correctness. It is written out in one
   * readable body rather than spread across helpers for exactly that reason.
   *
   * The only work outside the transaction is the unlinking, which cannot be
   * inside one: a filesystem does not roll back. That is what the marking on the
   * failure path is for.
   */
  async delete(parentAccountId: string, id: string, password: string): Promise<void> {
    // First, so a probe with any password against another account's id answers
    // 404 and never spends an argon2 verification on behalf of a stranger.
    await this.requireOwned(parentAccountId, id);

    // The **account password**, verified by account id inside its owner — never
    // the Parent PIN, which guards a different thing, and never re-resolved from
    // the token's email claim. A 409 and not a 401: the web client treats every
    // 401 as the elevation expiring and would sign the parent out of the screen
    // holding the refusal they need to read.
    if (!(await this.accounts.verifyPassword(parentAccountId, password))) {
      throw new ConflictException(PASSWORD_INCORRECT);
    }

    // Bytes before rows, and all of them. `releaseBytes` derives every path from
    // a page id (AD-15) and treats a file that is already absent as removed, so
    // `kept` is a real refusal and never a double-delete.
    const pageIds = await this.sourceTests.pageIdsFor(id);
    const released = await this.pageExpiry.releaseBytes(pageIds, TRIGGER);
    if (released.kept > 0) {
      // Which page refused is already logged by page id, and never by path,
      // inside the service that tried (AD-15, AD-20). No row is written here,
      // but `released.removedIds` are pages whose bytes are already gone: left
      // unmarked, their rows would still say `Ready` with a `storagePath`
      // pointing at nothing — the orphan this design says does not exist, just
      // on the rows that already lost the race instead of all of them.
      this.logger.warn(
        `A Student Profile deletion was refused: ${released.kept} of ${pageIds.length} stored page images could not be removed. Nothing was deleted.`,
      );
      await this.markReleasedPages(released.removedIds);
      throw new ServiceUnavailableException(DELETION_INCOMPLETE);
    }

    try {
      await this.prisma.withTransaction(
        async (tx) => {
          // A page can be photographed onto a Draft Source Test of this child
          // while the deletion is in flight. Its row would cascade away with the
          // Source Test below and its bytes would stay on disk, which is the one
          // outcome this design says cannot happen — so the page set is proved
          // unchanged inside the snapshot the deletes run against.
          const stillHere = await this.sourceTests.pageIdsFor(id, tx);
          const arrivedSince = stillHere.filter((pageId) => !pageIds.includes(pageId));
          if (arrivedSince.length > 0) {
            this.logger.warn(
              `A Student Profile deletion was refused: ${arrivedSince.length} page images were added while it was in flight.`,
            );
            throw new ServiceUnavailableException(DELETION_INCOMPLETE);
          }

          // Collected inside the transaction, against the same snapshot the
          // deletes below remove: an artifact charged between a collection made
          // outside and this commit would be deleted with no tombstone, which is
          // the silent refund the whole table exists to prevent.
          const [uploadInstants, generationInstants, explanationInstants] = await Promise.all([
            this.sourceTests.submittedInstantsFor(id, tx),
            this.practiceTests.chargedInstantsFor(id, tx),
            this.explanations.chargedInstantsFor(id, tx),
          ]);
          const tombstones = await this.tombstonesFor(parentAccountId, {
            Upload: uploadInstants,
            Generation: generationInstants,
            Explanation: explanationInstants,
          });

          // Before any row goes. A crash after the deletes and before these would
          // be that same refund.
          await this.writeTombstones(tx, parentAccountId, tombstones);
          // Innermost `Restrict` first: tests, then the jobs that produced them…
          await this.practiceTests.purgeForStudentProfile(tx, id);
          // …then the Source Tests, whose pages and Extractions cascade with them…
          await this.sourceTests.purgeForStudentProfile(tx, id);
          // …then the profile row, whose Attempts, Explanations, Mastery rows and
          // uncommitted work cascade with it.
          await this.students.removeOwned(tx, parentAccountId, id);
        },
        // Not an ordinary transaction: see the constants for why five seconds is
        // not enough for a child with a year of practice behind them.
        {
          timeout: DELETION_TRANSACTION_TIMEOUT_MS,
          maxWait: DELETION_TRANSACTION_MAX_WAIT_MS,
        },
      );
    } catch (cause) {
      // Every row is back, and every photograph is still gone. Saying so on the
      // rows is the only honest state available: leaving them `Ready` with a
      // `storagePath` would make the next read of that page raise in front of a
      // parent who was told nothing had happened.
      await this.markReleasedPages(pageIds);
      throw cause;
    }

    // No name, no id of anything under it, and no counts of a child's work: a
    // log line about a deletion must not be the one place the deleted thing
    // survives (AD-20).
    this.logger.log('A Student Profile and everything under it were deleted.');
  }

  // --- Internals ---------------------------------------------------------

  /**
   * Marks the pages whose bytes came away before the transaction failed.
   *
   * It must never replace the failure the caller is about to rethrow: the parent
   * needs to know the deletion did not happen, and a second fault while tidying
   * up is an operator's problem, not theirs. So it is logged and swallowed, the
   * way `remove()` swallows a failed unlink and for the same reason.
   */
  private async markReleasedPages(pageIds: readonly string[]): Promise<void> {
    if (pageIds.length === 0) return;
    try {
      await this.pageExpiry.markReleased(pageIds, new Date(), TRIGGER);
    } catch (cause) {
      // Counts and page ids only, never a path (AD-15, AD-20).
      this.logger.error(
        `A Student Profile deletion failed after removing ${pageIds.length} stored page images, and the rows could not be marked to match: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  /** The account scope is part of the lookup, never a check made afterwards. */
  private async requireOwned(parentAccountId: string, id: string): Promise<void> {
    const profile = await this.students.findOwned(parentAccountId, id);
    // Archiving is not a gate: an archived child is deleted like any other, so
    // the read is the unfiltered one. Unknown and another account's are one
    // answer, as they are everywhere else.
    if (profile === null) throw new NotFoundException(PROFILE_NOT_FOUND);
  }

  /**
   * Collapses charging instants into one row per period and class.
   *
   * Which period an instant fell in is `allowance`'s computation and is asked of
   * it, never re-derived here (AD-14). It is deterministic for a past instant,
   * because the window resolution reads the account's effective-dated timezone
   * history and so answers with the zone that was actually in force then — which
   * is what makes a tombstone's `periodStart` still true a year later.
   *
   * Windows already resolved are reused: a child's artifacts cluster heavily
   * into a handful of months, and one history read per artifact would be a query
   * per row for an answer that does not change.
   */
  private async tombstonesFor(
    parentAccountId: string,
    charged: Readonly<Record<UsageClass, readonly Date[]>>,
  ): Promise<TombstoneEntry[]> {
    const resolved: { start: Date; end: Date }[] = [];
    const counts = new Map<string, TombstoneEntry>();

    for (const [usageClass, instants] of Object.entries(charged) as [
      UsageClass,
      readonly Date[],
    ][]) {
      for (const instant of instants) {
        let window = resolved.find((each) => instant >= each.start && instant < each.end);
        if (window === undefined) {
          window = await this.allowance.windowFor(parentAccountId, instant);
          resolved.push(window);
        }
        const key = `${window.start.toISOString()}:${usageClass}`;
        const existing = counts.get(key);
        if (existing === undefined) {
          counts.set(key, { periodStart: window.start, usageClass, count: 1 });
        } else {
          existing.count += 1;
        }
      }
    }
    return [...counts.values()];
  }

  /**
   * Writes the tombstones, inside the caller's transaction.
   *
   * An upsert that **increments**, against `@@unique([parentAccountId,
   * periodStart, usageClass])`: a second profile deleted in the same period adds
   * to the row rather than inserting beside it, so the account's figure for that
   * month is one number and not a sum a reader has to remember to make.
   *
   * A profile with nothing charged under it writes nothing at all. An empty
   * tombstone row would be a claim that a charge happened.
   */
  private async writeTombstones(
    tx: TransactionClient,
    parentAccountId: string,
    entries: readonly TombstoneEntry[],
  ): Promise<void> {
    for (const entry of entries) {
      await tx.usageTombstone.upsert({
        where: {
          parentAccountId_periodStart_usageClass: {
            parentAccountId,
            periodStart: entry.periodStart,
            usageClass: entry.usageClass,
          },
        },
        create: {
          parentAccountId,
          periodStart: entry.periodStart,
          usageClass: entry.usageClass,
          count: entry.count,
        },
        update: { count: { increment: entry.count } },
      });
    }
  }
}
