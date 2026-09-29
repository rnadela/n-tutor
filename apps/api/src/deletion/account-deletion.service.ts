import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { ExplanationService } from '../explanation/explanation.service.js';
import { ParentAccountService } from '../identity/parent-account.service.js';
import { StudentProfileService } from '../identity/student-profile.service.js';
import { PracticeTestService } from '../practicetest/practice-test.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PageExpiryService } from '../sourcetest/page-expiry.service.js';
import { SourceTestService } from '../sourcetest/source-test.service.js';
import {
  ACCOUNT_DELETION_TRANSACTION_TIMEOUT_MS,
  DELETION_INCOMPLETE,
  DELETION_TRANSACTION_MAX_WAIT_MS,
  PASSWORD_INCORRECT,
  type AccountDeletionSummary,
} from './deletion-policy.js';

/** The label both log-writing routines carry on this path (AD-20). */
const TRIGGER = 'Parent Account deletion' as const;

/**
 * The FR-33 deletion of a whole Parent Account and everything under it.
 *
 * `ProfileDeletionService` one level out: every account-scoped purge in place of
 * every profile-scoped one, plus the one thing only account deletion erases. It
 * shares that service's policy file, its unlink routine and its password
 * verifier, and it deliberately does **not** restate that service's reasoning
 * about why bytes come away before rows, why a shortfall refuses everything, or
 * why the released pages are marked when the transaction then fails — all of
 * that is written out there, once, and holds here unchanged.
 *
 * **Why a second service rather than a flag on the first.** The profile path
 * writes usage tombstones and refuses to refund the account's month; this path
 * erases the tombstones and has no allowance left to keep honest. One method
 * with a boolean would carry two contradictory contracts under one name, and the
 * tombstone branch is exactly the part that must never be reached by accident.
 *
 * **The order, one level out.** The account row is held by five `Restrict` edges
 * — `PracticeTest`, `GenerationJob`, `SourceTest`, `StudentProfile` and `AiCall`
 * — and not one of them is weakened to make this expressible. They are walked
 * inward-out: Practice Tests (then the jobs that produced them), then Source
 * Tests (whose pages and Extractions cascade), then every Student Profile (whose
 * Attempts, Explanations, Mastery and uncommitted work cascade), then the
 * `AiCall` cost rows, then the account row itself — which takes its consents,
 * its reset tokens, its timezone history, its uncommitted Parent View state and
 * its usage tombstones with it by `Cascade`.
 *
 * **No tombstone is written, and none is preserved.** A tombstone exists so a
 * deleted artifact keeps being counted against a *surviving* account. There is no
 * surviving account: `UsageTombstone` cascades from the row being removed, so a
 * tombstone written here would be a statement about an account that no longer
 * exists, deleted by the same transaction that wrote it.
 *
 * **`AdminAudit` is not touched.** Those rows hold no foreign key at all and
 * carry no child content, so they survive by construction and there is nothing
 * to write either way — which is the point: an operator's record of what was done
 * to an account must not be erasable by the account.
 *
 * **The account comes from the elevation, never from a payload or a path**
 * (AD-18), so there is no ownership check to make here: the only account this
 * service can be asked about is the one the guard already established.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: ParentAccountService,
    private readonly students: StudentProfileService,
    private readonly sourceTests: SourceTestService,
    // The one routine that unlinks a page's stored bytes, whichever trigger
    // asked (Story 8.1), reached through the same service the profile path
    // reaches it through so there is never a second unlink site.
    private readonly pageExpiry: PageExpiryService,
    private readonly practiceTests: PracticeTestService,
    private readonly explanations: ExplanationService,
    // The sole writer of `ai_call` (AD-17). Nothing else may remove a cost row.
    private readonly ai: AiService,
  ) {}

  /**
   * What deleting this account would destroy, by count and by kind.
   *
   * The confirmation's whole content, with the number of children first because
   * that is the figure a parent recognises before any count of uploads or runs.
   * Counts and kinds only, and no breakdown per child: a preview is a warning,
   * not a last reading of each child's work from the route that destroys it.
   *
   * No allowance figure is named either. The month's allowance is not "given
   * back" or kept on this path — there is no account left for it to be about.
   */
  async previewFor(parentAccountId: string): Promise<AccountDeletionSummary> {
    const [students, uploads, tests, explained, masteryTopics] = await Promise.all([
      this.students.countOwned(parentAccountId),
      this.sourceTests.countsForAccount(parentAccountId),
      this.practiceTests.countsForAccount(parentAccountId),
      this.explanations.countsForAccount(parentAccountId),
      // `grading`'s table, counted through this module's own `PrismaService` for
      // the reason `ProfileDeletionService` states: what is read is a row count
      // and not a behaviour, and importing `GradingModule` for one number would
      // be an arrow into this leaf for nothing. Scoped through the profile,
      // because a Mastery row carries no account column of its own.
      this.prisma.topicMastery.count({ where: { studentProfile: { parentAccountId } } }),
    ]);
    return { students, ...uploads, ...tests, ...explained, masteryTopics };
  }

  /**
   * Erases the account and everything under it, or erases nothing at all.
   *
   * The password, then the bytes, then one transaction that re-proves the page
   * set and walks the five `Restrict` edges inward-out. The order is the whole of
   * this method's correctness, so it is written out in one readable body rather
   * than spread across helpers — as `ProfileDeletionService.delete` is, and for
   * the same reason.
   *
   * The only work outside the transaction is the unlinking, which cannot be
   * inside one: a filesystem does not roll back.
   */
  async delete(parentAccountId: string, password: string): Promise<void> {
    // The **account password**, verified by account id inside its owner — never
    // the Parent PIN. A 409 and not a 401: the web client reads every 401 on a
    // parent-scoped route as the elevation expiring and would take the parent
    // off the screen holding the refusal they need to read.
    if (!(await this.accounts.verifyPassword(parentAccountId, password))) {
      throw new ConflictException(PASSWORD_INCORRECT);
    }

    // Bytes before rows, and all of them. Every path is derived from a page id
    // inside `releaseBytes` (AD-15), and a file already absent counts as removed,
    // so `kept` is a real refusal and never a double-delete.
    const pageIds = await this.sourceTests.pageIdsForAccount(parentAccountId);
    // Built once, for the membership test the transaction makes below. An
    // account's page set is every child's every upload, drafts included, so the
    // array scan that reads fine for one child is quadratic here.
    const releasedIds = new Set(pageIds);
    const released = await this.pageExpiry.releaseBytes(pageIds, TRIGGER);
    if (released.kept > 0) {
      this.logger.warn(
        `A Parent Account deletion was refused: ${released.kept} of ${pageIds.length} stored page images could not be removed. Nothing was deleted.`,
      );
      // The pages whose bytes did come away still have rows, and those rows
      // would otherwise say `Ready` over a file that is gone.
      await this.markReleasedPages(released.removedIds);
      throw new ServiceUnavailableException(DELETION_INCOMPLETE);
    }

    try {
      await this.prisma.withTransaction(
        async (tx) => {
          // A page can be photographed onto a draft of any child on this account
          // while the deletion is in flight. Its row would cascade away with its
          // Source Test below and its bytes would stay on disk, which is the one
          // outcome this design says cannot happen — so the page set is proved
          // unchanged inside the snapshot the deletes run against.
          const stillHere = await this.sourceTests.pageIdsForAccount(parentAccountId, tx);
          const arrivedSince = stillHere.filter((pageId) => !releasedIds.has(pageId));
          if (arrivedSince.length > 0) {
            this.logger.warn(
              `A Parent Account deletion was refused: ${arrivedSince.length} page images were added while it was in flight.`,
            );
            throw new ServiceUnavailableException(DELETION_INCOMPLETE);
          }

          // Innermost `Restrict` first: tests, then the jobs that produced them…
          await this.practiceTests.purgeForAccountAllProfiles(tx, parentAccountId);
          // …then the Source Tests, whose pages and Extractions cascade…
          await this.sourceTests.purgeForAccountAllProfiles(tx, parentAccountId);
          // …then every child, whose Attempts, Explanations, Mastery rows and
          // uncommitted work cascade…
          await this.students.removeAllOwned(tx, parentAccountId);
          // …then the cost rows, the one `Restrict` child that is not
          // profile-scoped and the one thing only this path erases…
          await this.ai.purgeForAccount(tx, parentAccountId);
          // …then the account row, which takes its consents, reset tokens,
          // timezone history, uncommitted Parent View state and usage tombstones
          // with it. No tombstone is written first: there is no account left for
          // one to be a statement about.
          await this.accounts.removeAccount(tx, parentAccountId);
        },
        // Not an ordinary transaction, and a ceiling of its own: an account is
        // several children's worth of the statement tree the profile ceiling was
        // chosen for, and it cannot be split — the account row does not come away
        // until its last `Restrict` child has.
        {
          timeout: ACCOUNT_DELETION_TRANSACTION_TIMEOUT_MS,
          maxWait: DELETION_TRANSACTION_MAX_WAIT_MS,
        },
      );
    } catch (cause) {
      // Every row is back, and every photograph is still gone. Saying so on the
      // rows is the only honest state available, and it is exactly the state the
      // retention sweep would have left them in.
      await this.markReleasedPages(pageIds);
      throw cause;
    }

    // No email, no name, no id and no count of anybody's work: a log line about
    // a deletion must not be the one place the deleted thing survives (AD-20).
    this.logger.log('A Parent Account and everything under it were deleted.');
  }

  // --- Internals ---------------------------------------------------------

  /**
   * Marks the pages whose bytes came away before the transaction failed.
   *
   * It must never replace the failure the caller is about to rethrow: the parent
   * needs to know the deletion did not happen, and a second fault while tidying
   * up is an operator's problem. So it is logged and swallowed, exactly as the
   * profile path's twin is.
   */
  private async markReleasedPages(pageIds: readonly string[]): Promise<void> {
    if (pageIds.length === 0) return;
    try {
      await this.pageExpiry.markReleased(pageIds, new Date(), TRIGGER);
    } catch (cause) {
      // Counts and page ids only, never a path (AD-15, AD-20).
      this.logger.error(
        `A Parent Account deletion failed after removing ${pageIds.length} stored page images, and the rows could not be marked to match: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }
}
