import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { UsageClass } from '../generated/prisma/enums.js';
import type { AllowanceService } from '../allowance/allowance.service.js';
import type { ExplanationService } from '../explanation/explanation.service.js';
import type { ParentAccountService } from '../identity/parent-account.service.js';
import type { StudentProfileService } from '../identity/student-profile.service.js';
import type { PracticeTestService } from '../practicetest/practice-test.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PageExpiryService } from '../sourcetest/page-expiry.service.js';
import type { SourceTestService } from '../sourcetest/source-test.service.js';
import {
  DELETION_INCOMPLETE,
  DELETION_TRANSACTION_MAX_WAIT_MS,
  DELETION_TRANSACTION_TIMEOUT_MS,
  PASSWORD_INCORRECT,
} from './deletion-policy.js';
import { ProfileDeletionService } from './profile-deletion.service.js';

const ACCOUNT_ID = '99999999-8888-7777-6666-555555555555';
const PROFILE_ID = '11111111-2222-3333-4444-555555555555';
const PASSWORD = 'correct-horse-battery-staple';

interface WrittenTombstone {
  parentAccountId: string;
  periodStart: string;
  usageClass: UsageClass;
  count: number;
}

interface Scenario {
  /** Whether the profile is this account's. `null` stands for "not found". */
  profile?: { archived: boolean } | null;
  passwordMatches?: boolean;
  uploads?: string[];
  generations?: string[];
  explanations?: string[];
  pageIds?: string[];
  /** How many pages the disk refuses to give up. */
  unlinkFailures?: number;
  /**
   * Pages that appear only on the re-read inside the transaction — a parent
   * photographing onto a Draft Source Test of this child while the deletion is
   * in flight.
   */
  pagesArrivingMidFlight?: string[];
  /** Makes the transaction body fail after its first delete, as a timeout would. */
  transactionFails?: boolean;
  /** Makes the marking of already-unlinked pages fail too. */
  markingFails?: boolean;
}

/**
 * The service over stubs of every owner it orchestrates.
 *
 * `steps` is the whole point of the harness: the **order** of the purges is this
 * service's correctness argument, and the only way to assert an order is to
 * record it. Everything else here exists so that order can be reached.
 */
function build(scenario: Scenario = {}) {
  const {
    profile = { archived: false },
    passwordMatches = true,
    uploads = [],
    generations = [],
    explanations = [],
    pageIds = [],
    unlinkFailures = 0,
    pagesArrivingMidFlight = [],
    transactionFails = false,
    markingFails = false,
  } = scenario;

  const steps: string[] = [];
  const tombstones: WrittenTombstone[] = [];
  /** What `markReleased` was handed, or `null` if it was never called. */
  let marked: { pageIds: readonly string[]; at: Date } | null = null;

  const tx = {
    usageTombstone: {
      upsert: vi.fn(async (args: Record<string, never>) => {
        steps.push('tombstones');
        const { create } = args as unknown as {
          create: {
            parentAccountId: string;
            periodStart: Date;
            usageClass: UsageClass;
            count: number;
          };
        };
        tombstones.push({
          parentAccountId: create.parentAccountId,
          periodStart: create.periodStart.toISOString(),
          usageClass: create.usageClass,
          count: create.count,
        });
      }),
    },
  };

  const transactionOptions: unknown[] = [];
  const prisma = {
    withTransaction: vi.fn(async <T>(fn: (client: unknown) => Promise<T>, options?: unknown) => {
      transactionOptions.push(options);
      return fn(tx);
    }),
    topicMastery: { count: vi.fn(async () => 4) },
  } as unknown as PrismaService;

  const accounts = {
    verifyPassword: vi.fn(async (_id: string, password: string) => {
      steps.push('password');
      return passwordMatches && password === PASSWORD;
    }),
  } as unknown as ParentAccountService;

  const students = {
    findOwned: vi.fn(async () => (profile === null ? null : { id: PROFILE_ID, ...profile })),
    removeOwned: vi.fn(async () => {
      steps.push('profile');
    }),
  } as unknown as StudentProfileService;

  const sourceTests = {
    // Every collector records whether it was handed the transaction client, so
    // "collected inside the transaction" is an assertion and not a hope.
    submittedInstantsFor: vi.fn(async (_id: string, client?: unknown) => {
      steps.push(client === tx ? 'collect:uploads(tx)' : 'collect:uploads(no-tx)');
      return uploads.map((at) => new Date(at));
    }),
    pageIdsFor: vi.fn(async (_id: string, client?: unknown) =>
      client === tx ? [...pageIds, ...pagesArrivingMidFlight] : [...pageIds],
    ),
    countsFor: vi.fn(async () => ({ sourceTests: 2, pageImages: 5 })),
    purgeForStudentProfile: vi.fn(async () => {
      steps.push('sourceTests');
      if (transactionFails) throw new Error('the transaction ran out of time');
    }),
  } as unknown as SourceTestService;

  const pageExpiry = {
    releaseBytes: vi.fn(async (ids: readonly string[]) => {
      steps.push('bytes');
      const removedIds = ids.slice(0, ids.length - unlinkFailures);
      return { removedIds, kept: unlinkFailures };
    }),
    markReleased: vi.fn(async (ids: readonly string[], at: Date) => {
      steps.push('markReleased');
      if (markingFails) throw new Error('the rows could not be marked');
      marked = { pageIds: [...ids], at };
      return ids.length;
    }),
  } as unknown as PageExpiryService;

  const practiceTests = {
    chargedInstantsFor: vi.fn(async (_id: string, client?: unknown) => {
      steps.push(client === tx ? 'collect:generations(tx)' : 'collect:generations(no-tx)');
      return generations.map((at) => new Date(at));
    }),
    countsFor: vi.fn(async () => ({ practiceTests: 3, attempts: 7 })),
    purgeForStudentProfile: vi.fn(async () => {
      steps.push('practiceTests');
    }),
  } as unknown as PracticeTestService;

  const explanationsService = {
    chargedInstantsFor: vi.fn(async (_id: string, client?: unknown) => {
      steps.push(client === tx ? 'collect:explanations(tx)' : 'collect:explanations(no-tx)');
      return explanations.map((at) => new Date(at));
    }),
    countsFor: vi.fn(async () => ({ explanations: 9 })),
  } as unknown as ExplanationService;

  // Calendar months in UTC, which is what `resolveWindow` answers for an account
  // with no timezone history. Stubbed rather than driven through the real one so
  // this tier stays free of a database.
  const allowance = {
    windowFor: vi.fn(async (_id: string, instant: Date) => {
      const start = new Date(
        Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      const end = new Date(
        Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1, 0, 0, 0, 0),
      );
      return { start, end, timezone: 'UTC' };
    }),
  } as unknown as AllowanceService;

  const service = new ProfileDeletionService(
    prisma,
    accounts,
    students,
    sourceTests,
    pageExpiry,
    practiceTests,
    explanationsService,
    allowance,
  );

  return {
    service,
    steps,
    tombstones,
    transactionOptions,
    markedPages: () => marked,
    accounts,
    students,
    sourceTests,
    pageExpiry,
    practiceTests,
    explanations: explanationsService,
    prisma,
  };
}

/** The purge and profile steps alone, so the collectors' noise stays readable. */
function purgeSteps(steps: readonly string[]): string[] {
  return steps.filter((step) => !step.startsWith('collect:'));
}

describe('deleting a Student Profile with everything under it', () => {
  it('removes the bytes, then the rows, innermost Restrict edge first', async () => {
    const h = build({ pageIds: ['page-1', 'page-2'], uploads: ['2026-09-04T09:00:00.000Z'] });

    await h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD);

    // The order *is* the design: bytes before any row, then Practice Tests (so
    // their Generation Jobs are free to go), then Source Tests (whose pages and
    // Extractions cascade), then the profile row (whose Attempts, Explanations
    // and Mastery cascade).
    expect(purgeSteps(h.steps)).toEqual([
      'password',
      'bytes',
      'tombstones',
      'practiceTests',
      'sourceTests',
      'profile',
    ]);
    expect(h.pageExpiry.releaseBytes).toHaveBeenCalledWith(['page-1', 'page-2']);
  });

  it('runs the tombstones and every delete in one transaction', async () => {
    const h = build({ uploads: ['2026-09-04T09:00:00.000Z'] });

    await h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD);

    // A crash between the tombstones and the deletes would refund the month.
    expect(h.prisma.withTransaction).toHaveBeenCalledTimes(1);
    expect(h.steps.indexOf('tombstones')).toBeLessThan(h.steps.indexOf('practiceTests'));
  });

  it('collapses the charges into one anonymous row per period and class', async () => {
    const h = build({
      uploads: ['2026-09-04T09:00:00.000Z', '2026-09-20T09:00:00.000Z', '2026-08-30T09:00:00.000Z'],
      generations: ['2026-09-06T09:00:00.000Z'],
      explanations: ['2026-09-07T09:00:00.000Z', '2026-09-08T09:00:00.000Z'],
    });

    await h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD);

    expect(h.tombstones).toEqual(
      expect.arrayContaining([
        {
          parentAccountId: ACCOUNT_ID,
          periodStart: '2026-09-01T00:00:00.000Z',
          usageClass: 'Upload',
          count: 2,
        },
        {
          parentAccountId: ACCOUNT_ID,
          periodStart: '2026-08-01T00:00:00.000Z',
          usageClass: 'Upload',
          count: 1,
        },
        {
          parentAccountId: ACCOUNT_ID,
          periodStart: '2026-09-01T00:00:00.000Z',
          usageClass: 'Generation',
          count: 1,
        },
        {
          parentAccountId: ACCOUNT_ID,
          periodStart: '2026-09-01T00:00:00.000Z',
          usageClass: 'Explanation',
          count: 2,
        },
      ]),
    );
    expect(h.tombstones).toHaveLength(4);
    // Nothing a child could be read out of: an account, a period, a class and a
    // number, and no fifth key.
    for (const row of h.tombstones) {
      expect(Object.keys(row).sort()).toEqual([
        'count',
        'parentAccountId',
        'periodStart',
        'usageClass',
      ]);
    }
  });

  it('writes no tombstone for a profile that was never charged for anything', async () => {
    const h = build();

    await h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD);

    // An empty tombstone row would be a claim that a charge happened.
    expect(h.tombstones).toEqual([]);
    expect(purgeSteps(h.steps)).toEqual([
      'password',
      'bytes',
      'practiceTests',
      'sourceTests',
      'profile',
    ]);
  });

  it('deletes an archived profile like any other: archiving is not a gate', async () => {
    const h = build({ profile: { archived: true } });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).resolves.toBeUndefined();
    expect(h.students.removeOwned).toHaveBeenCalled();
  });

  it('collects all three charges inside the transaction, never outside it', async () => {
    const h = build({
      uploads: ['2026-09-04T09:00:00.000Z'],
      generations: ['2026-09-06T09:00:00.000Z'],
      explanations: ['2026-09-07T09:00:00.000Z'],
    });

    await h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD);

    // An artifact charged between a collection made outside and the commit
    // would be deleted with no tombstone: a silent refund by a narrower door.
    const collected = h.steps.filter((step) => step.startsWith('collect:'));
    expect(collected).toEqual([
      'collect:uploads(tx)',
      'collect:generations(tx)',
      'collect:explanations(tx)',
    ]);
    // And every one of them runs before the first row is removed.
    for (const step of collected) {
      expect(h.steps.indexOf(step)).toBeLessThan(h.steps.indexOf('practiceTests'));
    }
  });

  it('gives the transaction a raised ceiling rather than Prisma’s five seconds', async () => {
    const h = build();

    await h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD);

    // A child with a year of practice behind them cascades through more rows
    // than the default allows, and an abort here is a deletion the parent is
    // told failed after its photographs are already gone.
    expect(h.transactionOptions).toHaveLength(1);
    const options = h.transactionOptions[0] as { timeout: number; maxWait: number };
    expect(options.timeout).toBe(DELETION_TRANSACTION_TIMEOUT_MS);
    expect(options.maxWait).toBe(DELETION_TRANSACTION_MAX_WAIT_MS);
    expect(options.timeout).toBeGreaterThan(5_000);
  });
});

describe('when the transaction fails after the bytes are already gone', () => {
  it('marks the released pages so the rows stop claiming they still hold bytes', async () => {
    const h = build({ pageIds: ['page-1', 'page-2'], transactionFails: true });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toThrow(
      /ran out of time/u,
    );

    // The rollback put every row back, and the files are not coming back with
    // them. A `Ready` row with a `storagePath` pointing at nothing would raise
    // on the next read, in front of a parent told nothing had happened.
    const marked = h.markedPages();
    expect(marked).not.toBeNull();
    expect(marked!.pageIds).toEqual(['page-1', 'page-2']);
    expect(marked!.at).toBeInstanceOf(Date);
  });

  it('rethrows the original failure rather than reporting a successful delete', async () => {
    const h = build({ pageIds: ['page-1'], transactionFails: true });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toThrow(Error);
    expect(h.steps).toContain('markReleased');
  });

  it('does not let a failed marking replace the failure the parent must hear', async () => {
    const h = build({ pageIds: ['page-1'], transactionFails: true, markingFails: true });

    // Two faults, one of which is the operator's problem and not the parent's.
    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toThrow(
      /ran out of time/u,
    );
  });

  it('marks nothing when the profile had no pages to release', async () => {
    const h = build({ transactionFails: true });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toThrow(Error);
    expect(h.steps).not.toContain('markReleased');
  });

  it('leaves the rows alone on a happy path', async () => {
    const h = build({ pageIds: ['page-1'] });

    await h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD);

    // The rows are gone; there is nothing left to mark, and marking would be a
    // write against ids that no longer exist.
    expect(h.markedPages()).toBeNull();
  });
});

describe('when the deletion must be refused', () => {
  it('refuses a wrong password with a 409 and a sentence, and removes nothing', async () => {
    const h = build({ passwordMatches: false, pageIds: ['page-1'] });

    // Not a 401: the web client treats every 401 as the elevation expiring and
    // would sign the parent out of the screen holding the refusal.
    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, 'hunter2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, 'hunter2')).rejects.toMatchObject({
      message: PASSWORD_INCORRECT,
    });
    expect(h.pageExpiry.releaseBytes).not.toHaveBeenCalled();
    expect(h.students.removeOwned).not.toHaveBeenCalled();
  });

  it('refuses an empty password the same way, and spends the same verification', async () => {
    const h = build();

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, '')).rejects.toMatchObject({
      message: PASSWORD_INCORRECT,
    });
    expect(h.accounts.verifyPassword).toHaveBeenCalledWith(ACCOUNT_ID, '');
  });

  it('answers another account’s profile id with a 404, before any password work', async () => {
    const h = build({ profile: null });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Never a 403, which would confirm the profile exists somewhere — and never
    // an argon2 verification spent on behalf of a stranger.
    expect(h.accounts.verifyPassword).not.toHaveBeenCalled();
  });

  it('refuses the whole deletion when a single unlink fails, and deletes nothing', async () => {
    const h = build({ pageIds: ['page-1', 'page-2', 'page-3'], unlinkFailures: 1 });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toMatchObject({
      message: DELETION_INCOMPLETE,
    });
    // A file left behind after its row is gone is the orphan §5.2 says does not
    // exist, and there is no next pass to converge on it.
    expect(h.prisma.withTransaction).not.toHaveBeenCalled();
    expect(h.practiceTests.purgeForStudentProfile).not.toHaveBeenCalled();
    expect(h.sourceTests.purgeForStudentProfile).not.toHaveBeenCalled();
    expect(h.students.removeOwned).not.toHaveBeenCalled();
    expect(h.tombstones).toEqual([]);
    // page-1 and page-2 were unlinked before page-3 refused: their rows must be
    // marked to match, or they would still say `Ready` over a file that is gone.
    expect(h.markedPages()?.pageIds).toEqual(['page-1', 'page-2']);
  });

  it('refuses when a page is photographed onto the child while the delete is in flight', async () => {
    const h = build({ pageIds: ['page-1'], pagesArrivingMidFlight: ['page-2'] });

    // `page-2` was never unlinked, because it did not exist when the bytes were
    // released — and deleting its Source Test now would leave its file on disk
    // with no row pointing at it. The one orphan this design says cannot exist.
    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toMatchObject({
      message: DELETION_INCOMPLETE,
    });
    expect(h.practiceTests.purgeForStudentProfile).not.toHaveBeenCalled();
    expect(h.sourceTests.purgeForStudentProfile).not.toHaveBeenCalled();
    expect(h.students.removeOwned).not.toHaveBeenCalled();
    expect(h.tombstones).toEqual([]);
  });

  it('marks the pages it did release when it refuses on a mid-flight arrival', async () => {
    const h = build({ pageIds: ['page-1'], pagesArrivingMidFlight: ['page-2'] });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    // `page-1`'s bytes are gone and its row survived the rollback; `page-2`'s
    // were never touched, so it is not marked.
    const marked = h.markedPages();
    expect(marked).not.toBeNull();
    expect(marked!.pageIds).toEqual(['page-1']);
  });

  it('does not refuse when the re-read finds exactly the set it released', async () => {
    const h = build({ pageIds: ['page-1', 'page-2'] });

    await expect(h.service.delete(ACCOUNT_ID, PROFILE_ID, PASSWORD)).resolves.toBeUndefined();
  });
});

describe('the deletion preview', () => {
  it('reports every count and kind the confirmation has to name', async () => {
    const h = build();

    await expect(h.service.previewFor(ACCOUNT_ID, PROFILE_ID)).resolves.toEqual({
      sourceTests: 2,
      pageImages: 5,
      practiceTests: 3,
      attempts: 7,
      explanations: 9,
      masteryTopics: 4,
    });
  });

  it('answers another account’s profile id with a 404 and counts nothing', async () => {
    const h = build({ profile: null });

    await expect(h.service.previewFor(ACCOUNT_ID, PROFILE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.sourceTests.countsFor).not.toHaveBeenCalled();
  });
});
