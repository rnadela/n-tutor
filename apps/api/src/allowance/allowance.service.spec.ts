import { describe, expect, it, vi } from 'vitest';
import type { UsageClass } from '../generated/prisma/enums.js';
import type { ParentAccountService } from '../identity/parent-account.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SourceTestService } from '../sourcetest/source-test.service.js';
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
 * The service over stubbed owners: two live counts, one live count through the
 * owning module's service, and the tombstone table.
 *
 * The stubs answer fixed live counts on purpose. What is under test is the
 * *sum*, and a tombstone that moved a live count would be indistinguishable
 * from one that was added to it.
 */
function serviceWith(
  tombstones: readonly Tombstone[],
  live = { upload: 1, generation: 2, explanation: 3 },
): { service: AllowanceService; aggregateArgs: unknown[] } {
  const aggregateArgs: unknown[] = [];
  const prisma = {
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

  const sourceTests = {
    countSubmittedIn: vi.fn(async () => live.upload),
  } as unknown as SourceTestService;

  return { service: new AllowanceService(accounts, prisma, sourceTests), aggregateArgs };
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
