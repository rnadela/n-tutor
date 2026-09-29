import { describe, expect, it, vi } from 'vitest';
import type { UsageClass } from '../generated/prisma/enums.js';
import type { ParentAccountService } from '../identity/parent-account.service.js';
import type { PrismaService, TransactionClient } from '../prisma/prisma.service.js';
import { AllowanceService } from './allowance.service.js';

const ACCOUNT_ID = '99999999-8888-7777-6666-555555555555';
/** Mid-month, so the window under test is unambiguously September 2026 in UTC. */
const NOW = new Date('2026-09-15T12:00:00.000Z');

interface Tombstone {
  periodStart: Date;
  usageClass: UsageClass;
  count: number;
}

/**
 * The service over a stubbed Prisma: three live counts — Upload among them now
 * that it reads `source_test` through this module's own delegate — and the
 * tombstone table.
 *
 * The stubs answer fixed live counts on purpose. What is under test is the
 * *sum*, and a tombstone that moved a live count would be indistinguishable
 * from one that was added to it.
 */
function serviceWith(
  tombstones: readonly Tombstone[],
  live = { upload: 1, generation: 2, explanation: 3 },
): {
  service: AllowanceService;
  aggregateArgs: unknown[];
  /** This module's own Source Test count, so a test can read what it was asked. */
  sourceTestCount: ReturnType<typeof vi.fn>;
} {
  const aggregateArgs: unknown[] = [];
  const sourceTestCount = vi.fn(async () => live.upload);
  const prisma = {
    sourceTest: { count: sourceTestCount },
    practiceTest: { count: vi.fn(async () => live.generation) },
    explanation: { count: vi.fn(async () => live.explanation) },
    usageTombstone: {
      aggregate: vi.fn(async (args: Record<string, never>) => {
        aggregateArgs.push(args);
        const where = (args as unknown as { where: Record<string, never> }).where;
        const { usageClass, periodStart } = where as unknown as {
          usageClass: UsageClass;
          periodStart: { gte: Date; lt: Date };
        };
        const matched = tombstones.filter(
          (row) =>
            row.usageClass === usageClass &&
            row.periodStart >= periodStart.gte &&
            row.periodStart < periodStart.lt,
        );
        // Prisma answers an aggregate over no rows with `null`, not `0`.
        return {
          _sum: {
            count:
              matched.length === 0 ? null : matched.reduce((total, row) => total + row.count, 0),
          },
        };
      }),
    },
  } as unknown as PrismaService;

  const accounts = {
    findById: vi.fn(async () => ({ id: ACCOUNT_ID, tier: 'Family' as const })),
    // No history: every window is cut in the default zone, which is UTC.
    timezoneHistory: vi.fn(async () => []),
  } as unknown as ParentAccountService;

  return { service: new AllowanceService(accounts, prisma), aggregateArgs, sourceTestCount };
}

function tombstone(periodStart: string, usageClass: UsageClass, count: number): Tombstone {
  return { periodStart: new Date(periodStart), usageClass, count };
}

describe('usage tombstones keep a deleted artifact counted', () => {
  it('adds to each of the three counts, and to no other', async () => {
    const { service } = serviceWith([
      tombstone('2026-09-01T00:00:00.000Z', 'Upload', 4),
      tombstone('2026-09-01T00:00:00.000Z', 'Generation', 7),
      tombstone('2026-09-01T00:00:00.000Z', 'Explanation', 11),
    ]);

    const consumption = await service.consumptionFor(ACCOUNT_ID, NOW);

    expect(consumption.allowances.upload.used).toBe(1 + 4);
    expect(consumption.allowances.generation.used).toBe(2 + 7);
    expect(consumption.allowances.explanation.used).toBe(3 + 11);
  });

  it('does not cross classes: an Upload tombstone never lifts the Generation count', async () => {
    const { service } = serviceWith([tombstone('2026-09-01T00:00:00.000Z', 'Upload', 5)]);

    const consumption = await service.consumptionFor(ACCOUNT_ID, NOW);

    expect(consumption.allowances.upload.used).toBe(1 + 5);
    expect(consumption.allowances.generation.used).toBe(2);
    expect(consumption.allowances.explanation.used).toBe(3);
  });

  it('sums several tombstones of one class in one period', async () => {
    // Two profiles deleted in the same month, whichever way the rows landed.
    const { service } = serviceWith([
      tombstone('2026-09-01T00:00:00.000Z', 'Generation', 3),
      tombstone('2026-09-01T00:00:00.000Z', 'Generation', 2),
    ]);

    const consumption = await service.consumptionFor(ACCOUNT_ID, NOW);

    expect(consumption.allowances.generation.used).toBe(2 + 5);
  });

  it('leaves every count untouched when there is no tombstone at all', async () => {
    // The `_sum` of no rows is null, and a null added to a count is NaN.
    const { service } = serviceWith([]);

    const consumption = await service.consumptionFor(ACCOUNT_ID, NOW);

    expect(consumption.allowances.upload.used).toBe(1);
    expect(consumption.allowances.generation.used).toBe(2);
    expect(consumption.allowances.explanation.used).toBe(3);
  });

  it('ignores a tombstone from another period, in either direction', async () => {
    // A tombstone counted in the wrong period is a silent refund in one month
    // and a silent double-charge in another.
    const { service } = serviceWith([
      tombstone('2026-08-01T00:00:00.000Z', 'Upload', 9),
      tombstone('2026-10-01T00:00:00.000Z', 'Upload', 9),
    ]);

    const consumption = await service.consumptionFor(ACCOUNT_ID, NOW);

    expect(consumption.allowances.upload.used).toBe(1);
  });

  it('reads the tombstones over the same half-open window as the live counts', async () => {
    const { service, aggregateArgs } = serviceWith([]);

    const consumption = await service.consumptionFor(ACCOUNT_ID, NOW);

    expect(aggregateArgs).toHaveLength(3);
    for (const args of aggregateArgs) {
      const { where } = args as { where: { periodStart: { gte: Date; lt: Date } } };
      // `[start, end)`: a charge at the instant a period ends belongs to the
      // next one and is counted exactly once.
      expect(where.periodStart.gte.toISOString()).toBe(consumption.periodStart);
      expect(where.periodStart.lt.toISOString()).toBe(consumption.periodEnd);
    }
  });
});

describe('the Upload count the submit gate enforces against', () => {
  /**
   * The guard in `sourcetest` counts inside its own transaction, behind the
   * account row lock. A count that quietly ran on this module's connection
   * instead would read outside that snapshot and outside that lock — the exact
   * race the lock exists to close — so which client the queries went to is the
   * assertion.
   */
  it('issues both halves of the count on the client it is handed, and on no other', async () => {
    const { service, sourceTestCount, aggregateArgs } = serviceWith([]);
    const count = vi.fn(async () => 4);
    const aggregate = vi.fn(async () => ({ _sum: { count: 3 } }));
    const tx = {
      sourceTest: { count },
      usageTombstone: { aggregate },
    } as unknown as TransactionClient;
    const window = await service.windowFor(ACCOUNT_ID, NOW);

    expect(await service.uploadUsedIn(ACCOUNT_ID, window, tx)).toBe(4 + 3);
    expect(count).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(1);
    // The negative half, and the one that matters: a query that leaked onto
    // this module's own connection would be a count taken outside the lock.
    expect(sourceTestCount).not.toHaveBeenCalled();
    expect(aggregateArgs).toHaveLength(0);
  });

  it('runs on this module’s own client when it is handed none', async () => {
    const { service, aggregateArgs, sourceTestCount } = serviceWith([
      tombstone('2026-09-01T00:00:00.000Z', 'Upload', 2),
    ]);
    const window = await service.windowFor(ACCOUNT_ID, NOW);

    expect(await service.uploadUsedIn(ACCOUNT_ID, window)).toBe(1 + 2);
    expect(sourceTestCount).toHaveBeenCalledTimes(1);
    expect(aggregateArgs).toHaveLength(1);
  });

  /**
   * The predicate this change moved across a module boundary. It was
   * `sourcetest`'s and is now `allowance`'s, so it is asserted here rather than
   * trusted: an account scope dropped, a status widened or a `lt` turned into
   * an `lte` would each be a silent miscount that every other case still
   * passes.
   */
  it('counts this account’s committed Source Tests over the half-open window', async () => {
    const { service, sourceTestCount } = serviceWith([]);
    const window = await service.windowFor(ACCOUNT_ID, NOW);

    await service.uploadUsedIn(ACCOUNT_ID, window);

    expect(sourceTestCount).toHaveBeenCalledWith({
      where: {
        parentAccountId: ACCOUNT_ID,
        status: 'Submitted',
        // `[start, end)`: a commit at the instant a period ends belongs to the
        // next one and is counted exactly once.
        submittedAt: { gte: window.start, lt: window.end },
      },
    });
  });

  it('is the same number the readout states, by construction', async () => {
    const { service } = serviceWith([tombstone('2026-09-01T00:00:00.000Z', 'Upload', 6)]);
    const window = await service.windowFor(ACCOUNT_ID, NOW);

    const consumption = await service.consumptionFor(ACCOUNT_ID, NOW);
    expect(await service.uploadUsedIn(ACCOUNT_ID, window)).toBe(consumption.allowances.upload.used);
  });
});
