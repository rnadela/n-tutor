import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerService } from '../common/scheduler.js';
import { PageExpiryService } from './page-expiry.service.js';
import { pageExpiryRuntime } from './source-test-policy.js';

/** The pg-boss queue the retention sweep runs under. Stated once. */
export const PAGE_EXPIRY_QUEUE = 'page-image-expiry';

/**
 * What puts the FR-32 sweep on a clock.
 *
 * Deliberately a separate, tiny provider: the *mechanism* is `SchedulerService`
 * in `common`, the *policy* — which sweep, how often — stays in the module that
 * owns Page Image (AD-17), and `PageExpiryService` itself stays a plain method
 * an integration test calls directly, with no schedule anywhere near it.
 */
@Injectable()
export class PageExpiryScheduler implements OnModuleInit {
  private readonly logger = new Logger(PageExpiryScheduler.name);

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly expiry: PageExpiryService,
  ) {}

  onModuleInit(): void {
    const { workerEnabled, cron } = pageExpiryRuntime();
    if (!workerEnabled) {
      this.logger.log('The page image retention sweep is disabled in this process.');
      return;
    }
    this.scheduler.register(PAGE_EXPIRY_QUEUE, cron, async () => {
      // Never throws out of the tick. `sweepExpired` already swallows a failed
      // unlink; anything that reaches here is the database, and a sweep that
      // could not run is one the next tick runs instead.
      try {
        await this.expiry.sweepExpired(new Date());
      } catch (cause) {
        this.logger.error(
          `The page image retention sweep failed: ${cause instanceof Error ? cause.name : 'unknown'}.`,
        );
      }
    });
  }
}
