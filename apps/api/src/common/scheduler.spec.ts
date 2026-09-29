import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  type BossLike,
  SCHEDULE_TIMEZONE,
  SchedulerService,
  type ScheduledHandler,
} from './scheduler.js';

/**
 * A pg-boss that records rather than connects.
 *
 * Everything this suite is about — that a registration made before start is
 * applied at start, that a failed start is not a boot failure, that a handler's
 * rejection is swallowed — happens between this class and `SchedulerService`,
 * with Postgres contributing nothing but latency. Without a fake there is no
 * test at all: deleting the replay loop in `onModuleInit` would leave every
 * other suite green, and the sweep would simply never be put on a clock.
 */
class FakeBoss implements BossLike {
  readonly scheduled: { queue: string; cron: string; tz: string | undefined }[] = [];
  readonly queues: string[] = [];
  readonly workers = new Map<string, (jobs: readonly unknown[]) => Promise<unknown>>();
  readonly stops: { graceful?: boolean; close?: boolean }[] = [];
  started = 0;
  errorListener: ((cause: unknown) => void) | null = null;

  constructor(
    private readonly faults: {
      startRejects?: boolean;
      scheduleRejects?: boolean;
      stopRejects?: boolean;
    } = {},
  ) {}

  on(_event: 'error', listener: (cause: unknown) => void): this {
    this.errorListener = listener;
    return this;
  }

  async start(): Promise<this> {
    this.started += 1;
    if (this.faults.startRejects) throw new Error('no database');
    return this;
  }

  async stop(options?: { graceful?: boolean; close?: boolean }): Promise<void> {
    this.stops.push(options ?? {});
    if (this.faults.stopRejects) throw new Error('would not stop');
  }

  async createQueue(name: string): Promise<void> {
    this.queues.push(name);
  }

  async work(
    name: string,
    handler: (jobs: readonly unknown[]) => Promise<unknown>,
  ): Promise<string> {
    this.workers.set(name, handler);
    return `worker-${name}`;
  }

  async schedule(
    name: string,
    cron: string,
    _data?: object | null,
    options?: { tz?: string },
  ): Promise<void> {
    if (this.faults.scheduleRejects) throw new Error('no schedule table');
    this.scheduled.push({ queue: name, cron, tz: options?.tz });
  }
}

/** The service with its one real-world seam — constructing pg-boss — replaced. */
class TestScheduler extends SchedulerService {
  constructed = 0;

  constructor(private readonly fake: FakeBoss) {
    super();
  }

  protected override createBoss(): BossLike {
    this.constructed += 1;
    return this.fake;
  }
}

/** Drives the worker pg-boss would have driven on a tick. */
async function tick(boss: FakeBoss, queue: string): Promise<void> {
  const worker = boss.workers.get(queue);
  if (worker === undefined) throw new Error(`No worker attached for ${queue}.`);
  await worker([]);
}

describe('SchedulerService', () => {
  const saved = process.env.SCHEDULER_ENABLED;
  let errors: string[];

  beforeEach(() => {
    process.env.SCHEDULER_ENABLED = 'true';
    process.env.DATABASE_URL ??= 'postgresql://unused/unused';
    errors = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = saved;
  });

  describe('registration', () => {
    it('applies a registration made before start, at start', async () => {
      // The ordinary case: every module registers as it initializes, which Nest
      // may well run before this service's own `onModuleInit`. Deleting the
      // replay loop has to fail here.
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      scheduler.register('early', '1 2 * * *', async () => undefined);
      expect(boss.scheduled).toEqual([]);

      await scheduler.onModuleInit();
      expect(boss.queues).toEqual(['early']);
      expect(boss.scheduled).toEqual([
        { queue: 'early', cron: '1 2 * * *', tz: SCHEDULE_TIMEZONE },
      ]);
    });

    it('applies a registration made after start, immediately', async () => {
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      await scheduler.onModuleInit();

      scheduler.register('late', '3 4 * * *', async () => undefined);
      // `register` is synchronous and the application it triggers is not, so the
      // assertion waits a turn rather than pretending otherwise.
      await vi.waitFor(() => expect(boss.scheduled).toHaveLength(1));
      expect(boss.scheduled[0]).toEqual({
        queue: 'late',
        cron: '3 4 * * *',
        tz: SCHEDULE_TIMEZONE,
      });
    });

    it('states the timezone rather than inheriting pg-boss’s default', async () => {
      // A retention promise measured in days must not shift by an hour because
      // a server observes daylight saving.
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      scheduler.register('zoned', '0 0 * * *', async () => undefined);
      await scheduler.onModuleInit();
      expect(boss.scheduled[0]?.tz).toBe('UTC');
    });

    it('keeps a schedule that could not be installed out of the way of the rest', async () => {
      const boss = new FakeBoss({ scheduleRejects: true });
      const scheduler = new TestScheduler(boss);
      scheduler.register('doomed', '0 0 * * *', async () => undefined);

      await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
      expect(errors.some((line) => line.includes('doomed'))).toBe(true);
    });
  });

  describe('being switched off', () => {
    it('constructs no pg-boss at all when the scheduler is disabled', async () => {
      // This is what the test tier relies on: no instance means no connection
      // pool, no pg-boss schema in the test database, and no cron racing a spec.
      process.env.SCHEDULER_ENABLED = 'false';
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      scheduler.register('never', '0 0 * * *', async () => undefined);

      await scheduler.onModuleInit();
      expect(scheduler.constructed).toBe(0);
      expect(boss.started).toBe(0);
      expect(boss.scheduled).toEqual([]);
    });
  });

  describe('a scheduler that cannot start', () => {
    it('logs and returns rather than failing the boot', async () => {
      // The API must still serve parents when its scheduler cannot reach
      // Postgres. A rethrow here is an outage.
      const boss = new FakeBoss({ startRejects: true });
      const scheduler = new TestScheduler(boss);
      scheduler.register('unreachable', '0 0 * * *', async () => undefined);

      await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
      expect(boss.scheduled).toEqual([]);
      expect(errors.some((line) => line.includes('could not be started'))).toBe(true);
    });

    it('is not stopped on shutdown, because it never started', async () => {
      const boss = new FakeBoss({ startRejects: true });
      const scheduler = new TestScheduler(boss);
      await scheduler.onModuleInit();

      await expect(scheduler.onModuleDestroy()).resolves.toBeUndefined();
      expect(boss.stops).toEqual([]);
    });
  });

  describe('shutdown', () => {
    it('stops the instance once, gracefully', async () => {
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      await scheduler.onModuleInit();

      await scheduler.onModuleDestroy();
      expect(boss.stops).toEqual([{ graceful: true, close: true }]);
    });

    it('is safe when it was never started', async () => {
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      await expect(scheduler.onModuleDestroy()).resolves.toBeUndefined();
      expect(boss.stops).toEqual([]);
    });

    it('is safe when called twice, and stops nothing the second time', async () => {
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      await scheduler.onModuleInit();

      await scheduler.onModuleDestroy();
      await expect(scheduler.onModuleDestroy()).resolves.toBeUndefined();
      expect(boss.stops).toHaveLength(1);
    });

    it('logs rather than throwing when the instance refuses to stop', async () => {
      // Shutdown is not a place to fail: a scheduler that will not close
      // cleanly is a log line, not a process that refuses to exit.
      const boss = new FakeBoss({ stopRejects: true });
      const scheduler = new TestScheduler(boss);
      await scheduler.onModuleInit();

      await expect(scheduler.onModuleDestroy()).resolves.toBeUndefined();
      expect(errors.some((line) => line.includes('could not be stopped'))).toBe(true);
    });
  });

  describe('what a tick does with the handler', () => {
    it('runs it', async () => {
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      let ran = 0;
      const handler: ScheduledHandler = async () => {
        ran += 1;
      };
      scheduler.register('work', '0 0 * * *', handler);
      await scheduler.onModuleInit();

      await tick(boss, 'work');
      expect(ran).toBe(1);
    });

    it('swallows its rejection rather than failing the job into a retry loop', async () => {
      // Every sweep on this scheduler is idempotent and the next tick is the
      // retry. A rejected job would be retried by pg-boss against whatever was
      // already broken, which is a loop rather than a recovery.
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      scheduler.register('failing', '0 0 * * *', async () => {
        throw new Error('the sweep blew up');
      });
      await scheduler.onModuleInit();

      await expect(tick(boss, 'failing')).resolves.toBeUndefined();
      expect(errors.some((line) => line.includes('failing'))).toBe(true);
    });
  });

  describe('the background error listener', () => {
    it('is attached, so a maintenance fault does not take the process down', async () => {
      // An EventEmitter that emits `error` with no listener throws, and a lost
      // connection in a pg-boss maintenance tick must not be a crash.
      const boss = new FakeBoss();
      const scheduler = new TestScheduler(boss);
      await scheduler.onModuleInit();

      expect(boss.errorListener).not.toBeNull();
      expect(() => boss.errorListener?.(new Error('maintenance'))).not.toThrow();
      expect(errors.some((line) => line.includes('reported an error'))).toBe(true);
    });
  });
});
