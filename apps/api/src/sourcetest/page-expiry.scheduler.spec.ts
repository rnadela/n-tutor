import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { SchedulerService, ScheduledHandler } from '../common/scheduler.js';
import { PAGE_EXPIRY_QUEUE, PageExpiryScheduler } from './page-expiry.scheduler.js';
import type { PageExpiryService } from './page-expiry.service.js';
import { DEFAULT_PAGE_EXPIRY_CRON, resetPageExpiryRuntime } from './source-test-policy.js';

/**
 * That the FR-32 sweep is actually put on a clock.
 *
 * Nothing else asserts it: `page-expiry.service.spec.ts` drives `sweepExpired`
 * directly and the integration spec does the same, both by design — so deleting
 * the one `register` call below would leave the retention promise unkept and the
 * whole suite green.
 */
describe('PageExpiryScheduler', () => {
  const savedEnabled = process.env.PAGE_EXPIRY_WORKER_ENABLED;
  const savedCron = process.env.PAGE_EXPIRY_CRON;
  let errors: string[];

  interface Registered {
    queue: string;
    cron: string;
    handler: ScheduledHandler;
  }

  function harness(options: { sweepRejects?: boolean } = {}) {
    const registered: Registered[] = [];
    let swept: Date | null = null;
    const scheduler = {
      register(queue: string, cron: string, handler: ScheduledHandler) {
        registered.push({ queue, cron, handler });
      },
    } as unknown as SchedulerService;
    const expiry = {
      async sweepExpired(now: Date) {
        swept = now;
        if (options.sweepRejects) throw new Error('the database went away');
        return 3;
      },
    } as unknown as PageExpiryService;
    return {
      scheduler: new PageExpiryScheduler(scheduler, expiry),
      registered,
      sweptAt: () => swept,
    };
  }

  beforeEach(() => {
    delete process.env.PAGE_EXPIRY_WORKER_ENABLED;
    delete process.env.PAGE_EXPIRY_CRON;
    resetPageExpiryRuntime();
    errors = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedEnabled === undefined) delete process.env.PAGE_EXPIRY_WORKER_ENABLED;
    else process.env.PAGE_EXPIRY_WORKER_ENABLED = savedEnabled;
    if (savedCron === undefined) delete process.env.PAGE_EXPIRY_CRON;
    else process.env.PAGE_EXPIRY_CRON = savedCron;
    resetPageExpiryRuntime();
  });

  it('registers exactly one schedule, on the queue and cron the policy states', () => {
    const h = harness();
    h.scheduler.onModuleInit();
    expect(h.registered).toHaveLength(1);
    expect(h.registered[0]!.queue).toBe(PAGE_EXPIRY_QUEUE);
    expect(h.registered[0]!.cron).toBe(DEFAULT_PAGE_EXPIRY_CRON);
  });

  it('takes the cron from the environment when one is set', () => {
    process.env.PAGE_EXPIRY_CRON = '5 4 * * *';
    resetPageExpiryRuntime();
    const h = harness();
    h.scheduler.onModuleInit();
    expect(h.registered[0]!.cron).toBe('5 4 * * *');
  });

  it('registers nothing when the sweep is switched off in this process', () => {
    // What the test tier relies on, and the operational switch for a process
    // that should serve traffic without also being the one that sweeps.
    process.env.PAGE_EXPIRY_WORKER_ENABLED = 'false';
    resetPageExpiryRuntime();
    const h = harness();
    h.scheduler.onModuleInit();
    expect(h.registered).toEqual([]);
  });

  it('sweeps at the instant of the tick when the handler is invoked', async () => {
    const h = harness();
    h.scheduler.onModuleInit();
    const before = Date.now();
    await h.registered[0]!.handler();
    const swept = h.sweptAt();
    expect(swept).not.toBeNull();
    expect(swept!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('swallows a failed sweep rather than throwing out of the tick', async () => {
    // A throw here becomes a failed pg-boss job, retried against whatever was
    // already broken. The next day's tick is the retry, and the sweep converges.
    const h = harness({ sweepRejects: true });
    h.scheduler.onModuleInit();
    await expect(h.registered[0]!.handler()).resolves.toBeUndefined();
    expect(errors.some((line) => line.includes('retention sweep failed'))).toBe(true);
  });
});
