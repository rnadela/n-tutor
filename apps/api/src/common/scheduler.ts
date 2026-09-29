import {
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { optionalBoolEnv, requireEnv } from './env.js';

/** What a registered schedule runs. It is handed nothing: a schedule is a tick. */
export type ScheduledHandler = () => Promise<void>;

/**
 * The whole of what this service asks a scheduler to be.
 *
 * Named as an interface rather than used as `PgBoss` throughout so the seam
 * below has something to be: a spec substitutes a fake and asserts what this
 * class *does with* a scheduler, which is the part that would otherwise be
 * verified by nothing but a running Postgres.
 */
export interface BossLike {
  on(event: 'error', listener: (cause: unknown) => void): unknown;
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean; close?: boolean; timeout?: number }): Promise<void>;
  createQueue(name: string): Promise<void>;
  // The handler is declared as taking whatever pg-boss hands it, and is called
  // with nothing: a schedule is a tick, and this service deliberately never
  // passes job data through to a sweep.
  work(name: string, handler: (jobs: readonly unknown[]) => Promise<unknown>): Promise<string>;
  schedule(
    name: string,
    cron: string,
    data?: object | null,
    options?: { tz?: string },
  ): Promise<void>;
}

interface Registration {
  queue: string;
  cron: string;
  handler: ScheduledHandler;
}

/**
 * Every schedule in this codebase runs in UTC, stated rather than inherited.
 *
 * pg-boss has a default, and a retention promise measured in days must not
 * quietly shift by an hour because a server's zone observes daylight saving or
 * because a library changed what it assumes.
 */
export const SCHEDULE_TIMEZONE = 'UTC';

/**
 * The one scheduling mechanism in this process (AD-5, AD-33).
 *
 * pg-boss and nothing else: not `@nestjs/schedule`, not a second `setInterval`
 * sweep loop. The schedule lives in Postgres, so several API processes behind a
 * load balancer produce one run of a sweep rather than one run each, which is
 * exactly what a *retention* sweep needs — N processes racing to unlink the
 * same files is N−1 spurious warnings a night.
 *
 * It owns the pg-boss instance and its lifecycle alone and knows nothing about
 * what is scheduled: modules register their own policy against it, so the
 * mechanism stays here in `common` and the decision about *what* expires stays
 * in the module that owns the entity (AD-17).
 *
 * Nothing here is ever worth a boot failure. Constructing the instance, starting
 * it, and installing each schedule are all caught: an API that cannot reach
 * Postgres for its scheduler must still serve the parents it can serve, and the
 * sweep it missed is a sweep the next process to start installs.
 *
 * The *claim loops* — extraction and generation — deliberately stay as they
 * are. They are job claimers, not schedules, and their enqueue must share the
 * Prisma transaction that submits the work; a queue with its own pool cannot
 * enlist in one. This is the first thing in the codebase that genuinely needs a
 * clock rather than a claim.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly registrations: Registration[] = [];
  private boss: BossLike | null = null;
  private started = false;

  /**
   * Declares a schedule. Safe to call before or after `onModuleInit`, because
   * Nest's initialization order across modules is not something a provider
   * should have to know: a registration made before start is applied at start,
   * and one made after is applied immediately.
   */
  register(queue: string, cron: string, handler: ScheduledHandler): void {
    const registration = { queue, cron, handler };
    this.registrations.push(registration);
    if (this.started) {
      void this.apply(registration);
    }
  }

  async onModuleInit(): Promise<void> {
    if (!schedulerEnabled()) {
      this.logger.log('The scheduler is disabled; no schedule runs in this process.');
      return;
    }
    let boss: BossLike;
    try {
      // One instance, over the application's own database: the schedule and the
      // rows it sweeps live in the same place, so there is no second datastore
      // to keep alive and no second thing to be down.
      boss = this.createBoss(requireEnv('DATABASE_URL'));
      // pg-boss emits `error` on a background maintenance failure. An
      // EventEmitter with no `error` listener throws, and a lost connection in a
      // maintenance tick must not take the API process down with it.
      boss.on('error', (cause: unknown) => {
        this.logger.error(`The scheduler reported an error: ${errorName(cause)}.`);
      });
      // `start()` installs or migrates pg-boss's own schema, which is exactly
      // the step most likely to fail on a database that is up but not ready.
      await boss.start();
    } catch (cause) {
      // Deliberately not rethrown, and `boss` is deliberately not retained: a
      // half-started instance is not something shutdown should try to stop.
      this.logger.error(`The scheduler could not be started: ${errorName(cause)}.`);
      this.boss = null;
      this.started = false;
      return;
    }
    this.boss = boss;
    this.started = true;
    for (const registration of this.registrations) {
      await this.apply(registration);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const boss = this.boss;
    // Cleared first, so a handler firing during shutdown cannot register
    // against an instance that is on its way out, and so a second call — Nest
    // will not make one, but a test and a signal handler both might — is free.
    this.boss = null;
    this.started = false;
    // Null covers both "disabled" and "start failed": the only instance that
    // ever reaches this field is one that started, so there is nothing to stop
    // in either case.
    if (boss === null) return;
    try {
      // `graceful` asks pg-boss to stop taking new work and to let what it is
      // holding finish; it is a request with its own timeout, not a guarantee,
      // and this does not wait for the `stopped` event. That is deliberate: a
      // sweep cut off mid-pass leaves a `Ready` row whose file is already gone,
      // which the next pass re-selects and converges, so a shutdown that
      // outruns a handler costs nothing and a shutdown that hangs costs a
      // deploy.
      await boss.stop({ graceful: true, close: true });
    } catch (cause) {
      // Shutdown is not a place to fail. A scheduler that cannot be stopped
      // cleanly is a line in the log, not a process that refuses to exit.
      this.logger.error(`The scheduler could not be stopped cleanly: ${errorName(cause)}.`);
    }
  }

  // --- Internals ---------------------------------------------------------

  /**
   * The one place a real pg-boss is constructed.
   *
   * `protected` so a spec can substitute a fake and pin what this class does
   * with a scheduler — the registration replay, the swallowed handler failure,
   * the lifecycle — without a Postgres and without a pg-boss schema.
   */
  protected createBoss(connectionString: string): BossLike {
    return new PgBoss(connectionString);
  }

  /** Creates the queue, attaches the worker, and writes the cron entry. */
  private async apply({ queue, cron, handler }: Registration): Promise<void> {
    const boss = this.boss;
    if (boss === null) return;
    try {
      await boss.createQueue(queue);
      await boss.work(queue, async () => {
        // The handler's own failure is its own business and must never fail the
        // job in a way that retries a sweep into a loop: every sweep here is
        // idempotent and the next tick is the retry.
        try {
          await handler();
        } catch (cause) {
          this.logger.error(`Scheduled work on ${queue} failed: ${errorName(cause)}.`);
        }
      });
      // Idempotent by queue name: restarting the process re-states the cron
      // rather than accumulating a second entry for the same sweep. The zone is
      // stated rather than inherited from whatever pg-boss defaults to.
      await boss.schedule(queue, cron, null, { tz: SCHEDULE_TIMEZONE });
      this.logger.log(`Scheduled ${queue} on "${cron}" (${SCHEDULE_TIMEZONE}).`);
    } catch (cause) {
      // A schedule that could not be installed is worth a loud line and not
      // worth a boot failure: the API still serves parents without it.
      this.logger.error(`Could not schedule ${queue}: ${errorName(cause)}.`);
    }
  }
}

/**
 * Whether this process runs schedules at all.
 *
 * Off in the test tier, where a cron firing beside a spec is a coin toss, and
 * available as an operational switch for a process that should serve traffic
 * without also being the one that sweeps.
 */
export function schedulerEnabled(): boolean {
  return optionalBoolEnv('SCHEDULER_ENABLED', true);
}

function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : 'unknown';
}

/**
 * Registered once, in `AppModule`, and imported by each module that has a sweep
 * to put on a clock — a scheduler per injector would be several pg-boss
 * instances and several connection pools for one clock, and Nest gives a module
 * one instance across every importer, so that does not happen.
 */
@Module({
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
