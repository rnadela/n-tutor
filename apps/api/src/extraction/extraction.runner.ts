import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ExtractionService } from './extraction.service.js';
import { extractionRuntime } from './extraction-policy.js';

/**
 * The worker: a timer that claims one job and runs it, over and over.
 *
 * A timer in the application process rather than a broker, a second datastore
 * or `pg-boss` (AD-5). The reason is the transaction rule: enqueueing the job
 * and flipping the Source Test to `Submitted` must be one transaction, and a
 * queue that owns its own pool cannot enlist in a Prisma transaction at all.
 * `FOR UPDATE SKIP LOCKED` over a table in the application database gives the
 * same at-most-one-worker guarantee without giving that up. AD-33's scheduler
 * arrives with the sweeps that actually need a schedule.
 *
 * Two rules hold it together:
 *
 * - Passes never overlap. The next pass is scheduled only once the previous one
 *   has finished, so a slow vision call cannot cause a second pass to pile up
 *   behind it and claim the next job with no capacity to run it.
 * - It logs job and Source Test identifiers and nothing else (AD-20).
 */
@Injectable()
export class ExtractionRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExtractionRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly extraction: ExtractionService) {}

  onModuleInit(): void {
    if (!extractionRuntime().workerEnabled) {
      this.logger.log('The extraction worker is disabled; jobs will be claimed by nothing here.');
      return;
    }
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Claims at most one job and runs it to completion, returning whether there
   * was one.
   *
   * Exposed so an integration test drives exactly one pass rather than racing a
   * timer: a test that waits for an interval is a test that is slow when it
   * passes and flaky when it does not.
   */
  async runOnce(): Promise<boolean> {
    const job = await this.extraction.claimNext();
    if (job === null) return false;
    this.logger.log(`Running extraction job ${job.id} for source test ${job.sourceTestId}.`);
    // `runJob` handles its own failures and does not throw, which is what lets
    // the loop below stay a loop.
    await this.extraction.runJob(job);
    return true;
  }

  // --- Internals ---------------------------------------------------------

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.pass();
    }, delayMs);
    // Nothing about this process's lifetime should depend on the poll timer:
    // an idle worker must not be the reason a shutdown hangs.
    this.timer.unref?.();
  }

  private async pass(): Promise<void> {
    let found = false;
    try {
      found = await this.runOnce();
    } catch (cause) {
      // `runJob` swallows a job's own failure, so anything here is the claim
      // itself — a database that went away, most likely. Named by class alone
      // and never allowed to stop the loop.
      this.logger.error(`An extraction claim pass failed: ${(cause as Error)?.name ?? 'unknown'}.`);
    }
    // A pass that found work looks again immediately: a submitted batch should
    // drain rather than trickle out one job per poll interval.
    this.schedule(found ? 0 : extractionRuntime().pollMs);
  }
}
