import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PracticeTestService } from './practice-test.service.js';
import { practiceTestRuntime } from './practice-test-policy.js';

/**
 * The generation worker: a timer that claims one job and runs it, over and
 * over.
 *
 * It is `ExtractionRunner` in every structural respect, and deliberately so —
 * a timer in the application process rather than a broker (AD-5), passes that
 * never overlap, and log lines that carry job and Source Test identifiers and
 * nothing else (AD-20). The reason it is a second runner rather than a second
 * caller of the first is that the two queues are separate tables with separate
 * claim rules, and a runner that polled both would have to decide which one
 * starves when the other is busy.
 */
@Injectable()
export class PracticeTestRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PracticeTestRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly practiceTests: PracticeTestService) {}

  onModuleInit(): void {
    if (!practiceTestRuntime().workerEnabled) {
      this.logger.log('The generation worker is disabled; jobs will be claimed by nothing here.');
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
    const job = await this.practiceTests.claimNext();
    if (job === null) return false;
    this.logger.log(`Running generation job ${job.id} for source test ${job.sourceTestId}.`);
    // `runJob` handles its own failures and does not throw, which is what lets
    // the loop below stay a loop.
    await this.practiceTests.runJob(job);
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
      this.logger.error(`A generation claim pass failed: ${(cause as Error)?.name ?? 'unknown'}.`);
    }
    // A pass that found work looks again immediately: a queue of requests
    // should drain rather than trickle out one job per poll interval.
    this.schedule(found ? 0 : practiceTestRuntime().pollMs);
  }
}
