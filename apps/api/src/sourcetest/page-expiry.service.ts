import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PageIngestService } from './page-ingest.service.js';
import { PAGE_EXPIRY_SWEEP_BATCH_SIZE, pageImageExpiryCutoff } from './source-test-policy.js';

/**
 * Which of the three triggers asked for a removal, as it appears in the log.
 *
 * A closed union rather than a free string: the log line is the only place they
 * are distinguishable after the fact, and "whatever the caller passed" is not a
 * distinction an operator can rely on.
 */
type ExpiryTrigger = 'Retention sweep' | 'Parent-requested deletion' | 'Student Profile deletion';

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
 *
 * Three triggers reach the unlink and only three: the 90-day schedule
 * (`sweepExpired`), the parent's own early deletion (`expireNow`, FR-33), and
 * Story 8.3's Student Profile deletion (`releaseBytes`). The first two delegate
 * to `removeAndMark`, so the rules above are stated once and the outcome of an
 * early deletion is indistinguishable from an expiry; the third unlinks and
 * marks nothing up front, because the rows it belongs to are about to be deleted
 * outright — and `markReleased` puts the rows right in the one case where that
 * deletion then fails. All three go through `unlink` below, which is the **one**
 * unlink site that reports a shortfall, and the one place it is logged by page
 * id. (`SourceTestService` removes bytes in two other places, where the row goes
 * with them and nothing survives to be inconsistent; neither is an expiry.)
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
    return this.removeAndMark(due, now, 'Retention sweep');
  }

  /**
   * The same removal, for one Source Test and at the parent's own request
   * (FR-33), rather than for a batch the clock has reached.
   *
   * A second trigger on **one** routine: the unlink-then-mark sequence, its
   * crash-safety order, its `state: 'Ready'` guard on both the select and the
   * update, and its refusal to throw are all `removeAndMark`'s and are stated
   * exactly once. A second copy of that sequence is the defect this method
   * exists to avoid.
   *
   * No cutoff, because the parent asking *is* the clock here, and no batch cap,
   * because a Source Test holds at most `MAX_PAGES` pages — the cap exists to
   * bound a backlog of unknown size, and this select has a bound of its own.
   *
   * Every gate that decides whether this may be called at all — ownership, the
   * `Submitted` status, the persisted Extraction — lives with the ownership
   * check in `SourceTestService`, so this stays a pure deletion routine with no
   * opinion about who asked.
   */
  async expireNow(sourceTestId: string, now: Date): Promise<number> {
    // `state: 'Ready'` again: a Source Test whose pages a previous call (or the
    // sweep) already emptied selects nothing, unlinks nothing and marks
    // nothing, which is what makes the route idempotent.
    const due = await this.prisma.pageImage.findMany({
      where: { sourceTestId, state: 'Ready' },
      select: { id: true },
    });
    return this.removeAndMark(due, now, 'Parent-requested deletion');
  }

  /**
   * Unlinks the bytes of the given pages and marks **nothing** — the third
   * trigger, for Story 8.3's Student Profile deletion.
   *
   * The rows these pages belong to are about to be deleted outright, so in the
   * ordinary case there is no row left to mark and no next pass to converge: a
   * file still on disk after its row is gone is precisely the orphan §5.2 says
   * does not exist. So this reports `kept` and the caller refuses the whole
   * deletion on any shortfall, leaving every row and every other byte exactly
   * where they were. The parent retries; nothing was lost.
   *
   * When the deletion that asked for this **fails after the fact**, the rows do
   * survive, and they are then rows whose bytes are already gone — which is what
   * `markReleased` below exists to correct.
   *
   * `removedIds` and not a count: a partial shortfall still removed some pages'
   * bytes, and the caller must mark exactly those rows before refusing — never
   * the ones that were never unlinked, whose files are still on disk. Which page
   * refused is already in the log line below and in `remove()`'s own warning,
   * both by page id and never by path (AD-15, AD-20).
   */
  async releaseBytes(pageIds: readonly string[]): Promise<{ removedIds: string[]; kept: number }> {
    const gone = await this.unlink(pageIds, 'Student Profile deletion');
    return { removedIds: gone, kept: pageIds.length - gone.length };
  }

  /**
   * Says on the rows what `releaseBytes` already did to the files.
   *
   * The one caller is a Student Profile deletion whose transaction failed *after*
   * the bytes came away. The rows are still there, because the transaction rolled
   * back — but their photographs are not, and a `Ready` row with a `storagePath`
   * pointing at a file that no longer exists is a row lying about what it holds.
   * `readPageBytes` would select it and `ingest.read()` would raise
   * `PageBytesUnavailable` in front of a parent who was told nothing had happened.
   *
   * Marking it here puts it in exactly the state the sweep would have left it in,
   * so the strip says "photograph removed" with a date, which is true.
   *
   * The guard is `state: { not: 'Deleted' }` rather than the sweep's
   * `state: 'Ready'`, because `releaseBytes` selects `Uploading` rows too: a row
   * left mid-ingest can have a file already written, and once that file is gone
   * the row must not be promoted to `Ready` over nothing. A row another pass
   * already marked is excluded, so its original `bytesDeletedAt` stands.
   */
  async markReleased(pageIds: readonly string[], now: Date): Promise<number> {
    if (pageIds.length === 0) return 0;
    const marked = await this.prisma.pageImage.updateMany({
      where: { id: { in: [...pageIds] }, state: { not: 'Deleted' } },
      data: { state: 'Deleted', bytesDeletedAt: now, storagePath: null },
    });
    if (marked.count > 0) {
      this.logger.warn(
        `A Student Profile deletion did not complete after its bytes were removed; ${marked.count} page images were marked to match what is actually on disk.`,
      );
    }
    return marked.count;
  }

  /**
   * The one call site of `ingest.remove` that carries the shortfall logging, and
   * the routine all three expiry triggers reach it through. Returns the ids whose
   * bytes are actually gone, in no order.
   *
   * (`SourceTestService` calls `ingest.remove` in two other places — the failure
   * path of an add that never finished, and the parent's own page delete — where
   * the row goes in the same breath and there is no shortfall to report. Those
   * are not expiry, and they are not this.)
   *
   * The failure mode this log line exists for: a page whose unlink keeps failing
   * is otherwise invisible — `remove()` warns per page and every caller reports
   * only a count. One line per pass names the shortfall, so a disk that has been
   * refusing the same page for a week is something an operator can see. Counts
   * and page ids only, never a path (AD-15, AD-20).
   *
   * **Unlinked in chunks**, not all at once. The sweep is already bounded by
   * `PAGE_EXPIRY_SWEEP_BATCH_SIZE`, but a Student Profile deletion is bounded
   * only by how much a child uploaded: one `Promise.all` over a year of pages is
   * that many concurrent `unlink` syscalls, which is how a process runs out of
   * file handles. The same constant bounds the fan-out here, because it is the
   * same question — how many page removals may be in flight at once — and two
   * numbers for it would be two answers.
   */
  private async unlink(pageIds: readonly string[], trigger: ExpiryTrigger): Promise<string[]> {
    if (pageIds.length === 0) return [];

    const gone: string[] = [];
    for (let from = 0; from < pageIds.length; from += PAGE_EXPIRY_SWEEP_BATCH_SIZE) {
      const chunk = pageIds.slice(from, from + PAGE_EXPIRY_SWEEP_BATCH_SIZE);
      const removed = await Promise.all(
        chunk.map(async (id) => ((await this.ingest.remove(id)) ? id : null)),
      );
      for (const id of removed) if (id !== null) gone.push(id);
    }

    const kept = pageIds.length - gone.length;
    if (kept > 0) {
      this.logger.warn(
        `${trigger} could not remove the stored bytes of ${kept} of ${pageIds.length} page images.`,
      );
    }
    return gone;
  }

  /**
   * Unlink, then mark — the whole of both triggers' behaviour, in one place.
   *
   * `trigger` names which one asked, because the two lines are otherwise
   * identical and an operator reading a log needs to know whether a disk that
   * refused a page did so under the schedule or in front of a waiting parent.
   */
  private async removeAndMark(
    due: readonly { id: string }[],
    now: Date,
    trigger: ExpiryTrigger,
  ): Promise<number> {
    if (due.length === 0) return 0;

    const gone = await this.unlink(
      due.map((page) => page.id),
      trigger,
    );
    if (gone.length === 0) return 0;

    // `state: 'Ready'` is repeated in the update's own `where` so a row another
    // pass swept between the select and here is not marked a second time, and
    // `bytesDeletedAt` keeps the date of the pass that actually removed it.
    const marked = await this.prisma.pageImage.updateMany({
      where: { id: { in: gone }, state: 'Ready' },
      data: { state: 'Deleted', bytesDeletedAt: now, storagePath: null },
    });

    if (marked.count > 0) {
      this.logger.log(`${trigger} removed the stored bytes of ${marked.count} page images.`);
    }
    return marked.count;
  }
}
