import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedJob, ExtractionService } from './extraction.service.js';
import { ExtractionRunner } from './extraction.runner.js';
import { DEFAULT_POLL_MS, resetExtractionRuntime } from './extraction-policy.js';

/**
 * The worker loop, with the clock under the test's control.
 *
 * What matters here is not that a job runs — the integration tier proves that
 * against a real queue — but the three properties that keep the loop a loop: a
 * pass never overlaps the one before it, work is drained rather than trickled,
 * and a claim that throws does not end the process's only worker.
 */

/** A stand-in queue: scripted claims, and a run the test can hold open. */
function extractionStub(options: { claims?: (ClaimedJob | null)[]; claimThrows?: boolean } = {}) {
  const claims = [...(options.claims ?? [])];
  const running: { resolve: () => void }[] = [];
  const log: string[] = [];

  const service = {
    claimNext: vi.fn(async () => {
      log.push('claim');
      if (options.claimThrows) throw new Error('the database went away');
      return claims.shift() ?? null;
    }),
    runJob: vi.fn(async (job: ClaimedJob) => {
      log.push(`run:${job.id}`);
      await new Promise<void>((resolve) => running.push({ resolve }));
      log.push(`done:${job.id}`);
    }),
  } as unknown as ExtractionService;

  return { service, running, log };
}

const job = (id: string): ClaimedJob => ({ id, sourceTestId: `source-${id}`, attempts: 1 });

beforeEach(() => {
  resetExtractionRuntime();
  process.env.EXTRACTION_WORKER_ENABLED = 'true';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.EXTRACTION_WORKER_ENABLED;
  resetExtractionRuntime();
});

describe('one pass', () => {
  it('reports whether it found work', async () => {
    const { service, running } = extractionStub({ claims: [job('a'), null] });
    const runner = new ExtractionRunner(service);
    vi.spyOn(runner['logger'], 'log').mockImplementation(() => undefined);

    const first = runner.runOnce();
    // The claim is a promise of its own, so the run has not begun yet.
    await vi.advanceTimersByTimeAsync(0);
    running.shift()!.resolve();
    expect(await first).toBe(true);
    expect(await runner.runOnce()).toBe(false);
  });
});

describe('the loop', () => {
  it('never starts a pass while the one before it is still running', async () => {
    const { service, running, log } = extractionStub({ claims: [job('a'), job('b')] });
    const runner = new ExtractionRunner(service);
    vi.spyOn(runner['logger'], 'log').mockImplementation(() => undefined);

    runner.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['claim', 'run:a']);

    // The clock moves well past a poll interval while the first job is still
    // in flight. A second claim here would hand another worker's worth of work
    // to a process that has no capacity for it.
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS * 5);
    expect(log).toEqual(['claim', 'run:a']);

    running.shift()!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['claim', 'run:a', 'done:a', 'claim', 'run:b']);

    runner.onModuleDestroy();
  });

  it('looks again at once after finding work, and waits a poll interval after not', async () => {
    const { service, running, log } = extractionStub({ claims: [job('a')] });
    const runner = new ExtractionRunner(service);
    vi.spyOn(runner['logger'], 'log').mockImplementation(() => undefined);

    runner.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    running.shift()!.resolve();
    // A submitted batch should drain rather than trickle out one job per poll.
    await vi.advanceTimersByTimeAsync(0);
    expect(log.filter((entry) => entry === 'claim')).toHaveLength(2);

    // Having found nothing, it now waits.
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS - 1);
    expect(log.filter((entry) => entry === 'claim')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(log.filter((entry) => entry === 'claim')).toHaveLength(3);

    runner.onModuleDestroy();
  });

  it('swallows a claim failure and keeps looking', async () => {
    const { service, log } = extractionStub({ claimThrows: true });
    const runner = new ExtractionRunner(service);
    const error = vi.spyOn(runner['logger'], 'error').mockImplementation(() => undefined);

    runner.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS * 3);

    expect(log.filter((entry) => entry === 'claim').length).toBeGreaterThan(1);
    // Named by error class alone — never by a message that might carry content.
    expect(String(error.mock.calls[0]![0])).toBe('An extraction claim pass failed: Error.');

    runner.onModuleDestroy();
  });

  it('claims nothing at all when the worker is disabled', async () => {
    process.env.EXTRACTION_WORKER_ENABLED = 'false';
    resetExtractionRuntime();
    const { service, log } = extractionStub({ claims: [job('a')] });
    const runner = new ExtractionRunner(service);
    vi.spyOn(runner['logger'], 'log').mockImplementation(() => undefined);

    runner.onModuleInit();
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS * 5);
    expect(log).toEqual([]);

    // And `runOnce` still works, which is how an integration test drives it.
    expect(runner.runOnce()).toBeInstanceOf(Promise);
    runner.onModuleDestroy();
  });

  it('stops scheduling once the module is destroyed', async () => {
    const { service, log } = extractionStub();
    const runner = new ExtractionRunner(service);
    runner.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    const claimed = log.length;

    runner.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS * 10);
    expect(log).toHaveLength(claimed);
  });
});
