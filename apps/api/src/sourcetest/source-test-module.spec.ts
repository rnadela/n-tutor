import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_EXPIRY_CRON,
  pageExpiryRuntime,
  resetPageExpiryRuntime,
} from './source-test-policy.js';
import { SourceTestModule } from './source-test.module.js';

/**
 * `SourceTestModule`'s constructor resolves `pageExpiryRuntime()` so a mistyped
 * cron or retention flag fails the process at boot rather than turning into a
 * retention promise that quietly stopped being kept.
 *
 * Without this file, deleting that one line — or the five-field check inside the
 * resolver — leaves the whole suite green: a schedule that never fires looks
 * exactly like a schedule with nothing due.
 */
describe('the Page Image retention runtime', () => {
  const savedCron = process.env.PAGE_EXPIRY_CRON;
  const savedEnabled = process.env.PAGE_EXPIRY_WORKER_ENABLED;

  afterEach(() => {
    if (savedCron === undefined) delete process.env.PAGE_EXPIRY_CRON;
    else process.env.PAGE_EXPIRY_CRON = savedCron;
    if (savedEnabled === undefined) delete process.env.PAGE_EXPIRY_WORKER_ENABLED;
    else process.env.PAGE_EXPIRY_WORKER_ENABLED = savedEnabled;
    resetPageExpiryRuntime();
  });

  function withCron(cron: string): void {
    process.env.PAGE_EXPIRY_CRON = cron;
    resetPageExpiryRuntime();
  }

  it('resolves the daily default when nothing overrides it', () => {
    delete process.env.PAGE_EXPIRY_CRON;
    delete process.env.PAGE_EXPIRY_WORKER_ENABLED;
    resetPageExpiryRuntime();
    expect(pageExpiryRuntime()).toEqual({
      workerEnabled: true,
      cron: DEFAULT_PAGE_EXPIRY_CRON,
    });
  });

  it('runs the sweep unless a process is told not to', () => {
    // Defaulting off would mean a fresh deployment keeps children's schoolwork
    // for ever and nothing says so.
    delete process.env.PAGE_EXPIRY_WORKER_ENABLED;
    resetPageExpiryRuntime();
    expect(pageExpiryRuntime().workerEnabled).toBe(true);

    process.env.PAGE_EXPIRY_WORKER_ENABLED = 'false';
    resetPageExpiryRuntime();
    expect(pageExpiryRuntime().workerEnabled).toBe(false);
  });

  it('refuses a cron with too few fields', () => {
    withCron('3 * * *');
    expect(() => pageExpiryRuntime()).toThrow(/PAGE_EXPIRY_CRON/);
  });

  it('refuses a cron with too many fields', () => {
    // Six fields is the seconds-precision dialect other schedulers accept, and
    // it is the mistake most likely to be made here.
    withCron('0 17 3 * * *');
    expect(() => pageExpiryRuntime()).toThrow(/PAGE_EXPIRY_CRON/);
  });

  it('accepts a five-field expression whatever the spacing', () => {
    withCron('  5   4 * * *  ');
    expect(pageExpiryRuntime().cron).toBe('5   4 * * *');
  });

  it('refuses to construct the module on a cron it cannot accept', () => {
    // Boot is where this has to fail, which is what the module constructor is
    // for and what this case pins.
    withCron('not a cron');
    expect(() => new SourceTestModule()).toThrow(/PAGE_EXPIRY_CRON/);
  });

  it('constructs cleanly on a valid environment', () => {
    delete process.env.PAGE_EXPIRY_CRON;
    delete process.env.PAGE_EXPIRY_WORKER_ENABLED;
    resetPageExpiryRuntime();
    expect(() => new SourceTestModule()).not.toThrow();
  });
});
