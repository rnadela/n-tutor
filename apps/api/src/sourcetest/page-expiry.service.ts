import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PageIngestService } from './page-ingest.service.js';
import { PAGE_EXPIRY_SWEEP_BATCH_SIZE, pageImageExpiryCutoff } from './source-test-policy.js';

/**
 * The FR-32 retention sweep: 90 days after a Source Test was submitted, the
 * photographs of the child's schoolwork stop existing.
 *
 * Three rules hold it together:
 *
 * - **Unlink, then mark.** Never the other way round. Marking first turns any
 *   crash between the two into bytes on disk that no row points at and no clock
 *   will ever reach again — the one thing §5.2 says does not exist. Unlinking
 *   first turns the same crash into a `Ready` row whose file is already gone,
 *   which the next pass re-selects and converges on, because `remove()` treats
 *   `ENOENT` as success. The window is safe to read through: `readPageBytes()`
 *   filters to `state: 'Ready'` and `ingest.read()` raises the typed
 *   `PageBytesUnavailable`, never a raw fs error carrying a path.
 * - **Nothing derived is touched.** The Source Test, its Extraction, and every
 *   Practice Test, Attempt, Explanation and Mastery value built on it survive
 *   untouched — generation reads the persisted Extraction and never a page, so
 *   a fully expired Source Test still generates. This service reads exactly one
 *   delegate, `pageImage`, and writes exactly one.
 * - **It never throws out of a pass and never logs a path.** A failed unlink
 *   leaves the row `Ready` for the next pass and is logged by page id alone
 *   (AD-15, AD-20).
 */
@Injectable()
export class PageExpiryService {
  private readonly logger = new Logger(PageExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: PageIngestService,
  ) {}

  /**
   * One pass: removes the bytes of up to `PAGE_EXPIRY_SWEEP_BATCH_SIZE` due
   * pages and marks the rows whose bytes actually came away, returning how many
   * were marked.
   *
   * A plain public method rather than anything the schedule owns, so an
   * integration test drives exactly one pass and asserts on what it did — the
   * way `ExtractionRunner.runOnce()` is driven. A test that waits on a cron is
   * a test that is slow when it passes and flaky when it does not.
   */
  async sweepExpired(now: Date): Promise<number> {
    const cutoff = pageImageExpiryCutoff(now);

    // `submittedAt` null is excluded by the comparison itself: a null is never
    // `<=` anything, so a draft is never selected here and stays with the 72h
    // TTL that owns it (AD-16). `state: 'Ready'` excludes both the row still
    // being written and the row a previous pass already swept, so a second pass
    // over the same backlog unlinks nothing twice.
    const due = await this.prisma.pageImage.findMany({
      where: { state: 'Ready', sourceTest: { submittedAt: { lte: cutoff } } },
      select: { id: true },
      // No ordering: every row this matches is already past its promise, so
      // which hundred a pass takes does not matter — a daily schedule drains a
      // backlog of any size and the clock does not move while it drains. The
      // unordered take is what lets `@@index([state])` be the whole index this
      // sweep needs.
      take: PAGE_EXPIRY_SWEEP_BATCH_SIZE,
    });
    if (due.length === 0) return 0;

    const gone = (
      await Promise.all(
        due.map(async (page) => ((await this.ingest.remove(page.id)) ? page.id : null)),
      )
    ).filter((id): id is string => id !== null);

    // The one failure mode that silently breaks the retention promise: a page
    // whose unlink keeps failing is re-selected every pass, stays `Ready`, and
    // is otherwise invisible — `remove()` warns per page and the returned count
    // reports only what was marked. One line per pass names the shortfall, so a
    // disk that has been refusing the same page for a week is something an
    // operator can see. Counts and page ids only, never a path (AD-15, AD-20).
    const kept = due.length - gone.length;
    if (kept > 0) {
      this.logger.warn(
        `Retention sweep could not remove the stored bytes of ${kept} of ${due.length} due page images; they stay Ready and are retried next pass.`,
      );
    }
    if (gone.length === 0) return 0;

    // `state: 'Ready'` is repeated in the update's own `where` so a row another
    // pass swept between the select and here is not marked a second time, and
    // `bytesDeletedAt` keeps the date of the pass that actually removed it.
    const marked = await this.prisma.pageImage.updateMany({
      where: { id: { in: gone }, state: 'Ready' },
      data: { state: 'Deleted', bytesDeletedAt: now, storagePath: null },
    });

    if (marked.count > 0) {
      this.logger.log(`Retention sweep removed the stored bytes of ${marked.count} page images.`);
    }
    return marked.count;
  }
}
