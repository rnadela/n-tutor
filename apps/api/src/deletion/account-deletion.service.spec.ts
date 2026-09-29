import { ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AiService } from '../ai/ai.service.js';
import type { ExplanationService } from '../explanation/explanation.service.js';
import type { ParentAccountService } from '../identity/parent-account.service.js';
import type { StudentProfileService } from '../identity/student-profile.service.js';
import type { PracticeTestService } from '../practicetest/practice-test.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PageExpiryService } from '../sourcetest/page-expiry.service.js';
import type { SourceTestService } from '../sourcetest/source-test.service.js';
import { AccountDeletionService } from './account-deletion.service.js';
import {
  ACCOUNT_DELETION_TRANSACTION_TIMEOUT_MS,
  DELETION_INCOMPLETE,
  DELETION_TRANSACTION_MAX_WAIT_MS,
  DELETION_TRANSACTION_TIMEOUT_MS,
  PASSWORD_INCORRECT,
} from './deletion-policy.js';

const ACCOUNT_ID = '99999999-8888-7777-6666-555555555555';
const PASSWORD = 'correct-horse-battery-staple';

interface Scenario {
  passwordMatches?: boolean;
  pageIds?: string[];
  /** How many pages the disk refuses to give up. */
  unlinkFailures?: number;
  /**
   * Pages that appear only on the re-read inside the transaction — a parent
   * photographing onto a draft of some child of this account while the deletion
   * is in flight.
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
 * `steps` is the whole point of the harness, exactly as it is for the profile
 * path's spec: the **order** of the purges is this service's correctness
 * argument, and the only way to assert an order is to record it.
 *
 * `tombstones` records any write to `usageTombstone` at all — not because one is
 * expected, but because none is. A tombstone on this path would be a statement
 * about an account the same transaction removes, so the absence is asserted
 * rather than assumed from the reading of the code.
 */
function build(scenario: Scenario = {}) {
  const {
    passwordMatches = true,
    pageIds = [],
    unlinkFailures = 0,
    pagesArrivingMidFlight = [],
    transactionFails = false,
    markingFails = false,
  } = scenario;

  const steps: string[] = [];
  const tombstoneWrites: string[] = [];
  /** What `markReleased` was handed, or `null` if it was never called. */
  let marked: { pageIds: readonly string[]; at: Date; trigger: unknown } | null = null;

  const tx = {
    usageTombstone: {
      upsert: vi.fn(async () => {
        tombstoneWrites.push('upsert');
      }),
      create: vi.fn(async () => {
        tombstoneWrites.push('create');
      }),
    },
  };

  const transactionOptions: unknown[] = [];
  const prisma = {
    withTransaction: vi.fn(async <T>(fn: (client: unknown) => Promise<T>, options?: unknown) => {
      transactionOptions.push(options);
      return fn(tx);
    }),
    topicMastery: { count: vi.fn(async () => 11) },
  } as unknown as PrismaService;

  const accounts = {
    verifyPassword: vi.fn(async (_id: string, password: string) => {
      steps.push('password');
      return passwordMatches && password === PASSWORD;
    }),
    removeAccount: vi.fn(async () => {
      steps.push('account');
    }),
  } as unknown as ParentAccountService;

  const students = {
    countOwned: vi.fn(async () => 2),
    removeAllOwned: vi.fn(async () => {
      steps.push('students');
      return 2;
    }),
  } as unknown as StudentProfileService;

  const sourceTests = {
    pageIdsForAccount: vi.fn(async (_id: string, client?: unknown) =>
      client === tx ? [...pageIds, ...pagesArrivingMidFlight] : [...pageIds],
    ),
    countsForAccount: vi.fn(async () => ({ sourceTests: 4, pageImages: 9 })),
    purgeForAccountAllProfiles: vi.fn(async () => {
      steps.push('sourceTests');
      if (transactionFails) throw new Error('the transaction ran out of time');
    }),
  } as unknown as SourceTestService;

  const pageExpiry = {
    releaseBytes: vi.fn(async (ids: readonly string[], trigger?: unknown) => {
      steps.push(`bytes(${String(trigger)})`);
      const removedIds = ids.slice(0, ids.length - unlinkFailures);
      return { removedIds, kept: unlinkFailures };
    }),
    markReleased: vi.fn(async (ids: readonly string[], at: Date, trigger?: unknown) => {
      steps.push('markReleased');
      if (markingFails) throw new Error('the rows could not be marked');
      marked = { pageIds: [...ids], at, trigger };
      return ids.length;
    }),
  } as unknown as PageExpiryService;

  const practiceTests = {
    countsForAccount: vi.fn(async () => ({ practiceTests: 6, attempts: 13 })),
    purgeForAccountAllProfiles: vi.fn(async () => {
      steps.push('practiceTests');
    }),
  } as unknown as PracticeTestService;

  const explanations = {
    countsForAccount: vi.fn(async () => ({ explanations: 21 })),
  } as unknown as ExplanationService;

  const ai = {
    purgeForAccount: vi.fn(async () => {
      steps.push('aiCalls');
      return 7;
    }),
  } as unknown as AiService;

  const service = new AccountDeletionService(
    prisma,
    accounts,
    students,
    sourceTests,
    pageExpiry,
    practiceTests,
    explanations,
    ai,
  );

  return {
    service,
    steps,
    tombstoneWrites,
    transactionOptions,
    markedPages: () => marked,
    accounts,
    students,
    sourceTests,
    pageExpiry,
    practiceTests,
    explanations,
    ai,
    prisma,
  };
}

describe('deleting a Parent Account with everything under it', () => {
  it('removes the bytes, then the rows, innermost Restrict edge first', async () => {
    const h = build({ pageIds: ['page-1', 'page-2'] });

    await h.service.delete(ACCOUNT_ID, PASSWORD);

    // The order *is* the design, one level out from the profile path: bytes
    // before any row, then Practice Tests (so their Generation Jobs are free to
    // go), then Source Tests (whose pages and Extractions cascade), then every
    // child (whose Attempts, Explanations, Mastery and uncommitted work cascade),
    // then the cost rows — the one Restrict child that is not profile-scoped —
    // and only then the account row, which takes its consents, reset tokens,
    // timezone history and usage tombstones with it.
    expect(h.steps).toEqual([
      'password',
      'bytes(Parent Account deletion)',
      'practiceTests',
      'sourceTests',
      'students',
      'aiCalls',
      'account',
    ]);
    expect(h.pageExpiry.releaseBytes).toHaveBeenCalledWith(
      ['page-1', 'page-2'],
      'Parent Account deletion',
    );
  });

  it("logs no id and no count of a child's work on success (AD-20)", async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const h = build({ pageIds: ['page-1', 'page-2'] });

    await h.service.delete(ACCOUNT_ID, PASSWORD);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message] = logSpy.mock.calls[0] as [string];
    expect(message).not.toContain(ACCOUNT_ID);
    expect(message).not.toContain('page-1');
    expect(message).not.toContain('page-2');
    expect(message).not.toMatch(/\d/);
    logSpy.mockRestore();
  });

  it('runs every delete in one transaction, and the account row inside it', async () => {
    const h = build();

    await h.service.delete(ACCOUNT_ID, PASSWORD);

    expect(h.prisma.withTransaction).toHaveBeenCalledTimes(1);
    // The account row cannot come away until its last Restrict child has, so a
    // second transaction for it would be a window in which the account is a husk.
    for (const method of [
      h.practiceTests.purgeForAccountAllProfiles,
      h.sourceTests.purgeForAccountAllProfiles,
      h.students.removeAllOwned,
      h.ai.purgeForAccount,
      h.accounts.removeAccount,
    ]) {
      expect(method).toHaveBeenCalledTimes(1);
    }
  });

  it('writes no usage tombstone, and never preserves one', async () => {
    const h = build({ pageIds: ['page-1'] });

    await h.service.delete(ACCOUNT_ID, PASSWORD);

    // A tombstone exists so a deleted artifact keeps being counted against a
    // *surviving* account. There is none: `UsageTombstone` cascades from the row
    // being removed, so anything written here would be deleted by the same
    // transaction that wrote it.
    expect(h.tombstoneWrites).toEqual([]);
    // And no window is resolved for one either — this path asks `allowance`
    // nothing, which is why it does not hold it.
    expect(h.steps).not.toContain('tombstones');
  });

  it('deletes the cost rows through `ai`, the sole writer of `ai_call`', async () => {
    const h = build();

    await h.service.delete(ACCOUNT_ID, PASSWORD);

    // The one thing account deletion erases that profile deletion does not, and
    // it is erased by its owner (AD-17) — never by a delegate reached from here.
    expect(h.ai.purgeForAccount).toHaveBeenCalledTimes(1);
    expect(h.steps.indexOf('aiCalls')).toBeLessThan(h.steps.indexOf('account'));
  });

  it('deletes an account with nothing under it', async () => {
    const h = build();

    await expect(h.service.delete(ACCOUNT_ID, PASSWORD)).resolves.toBeUndefined();
    // No children, no uploads, no bytes — and still the account row, its consents
    // and its timezone history go.
    expect(h.accounts.removeAccount).toHaveBeenCalledTimes(1);
    expect(h.markedPages()).toBeNull();
  });

  it('gives the transaction its own, higher ceiling', async () => {
    const h = build();

    await h.service.delete(ACCOUNT_ID, PASSWORD);

    expect(h.transactionOptions).toHaveLength(1);
    const options = h.transactionOptions[0] as { timeout: number; maxWait: number };
    // An account is several children's worth of the statement tree the profile
    // ceiling was chosen for, and it cannot be split.
    expect(options.timeout).toBe(ACCOUNT_DELETION_TRANSACTION_TIMEOUT_MS);
    expect(options.timeout).toBeGreaterThan(DELETION_TRANSACTION_TIMEOUT_MS);
    // The wait for a connection is a fact about the pool, so it is shared.
    expect(options.maxWait).toBe(DELETION_TRANSACTION_MAX_WAIT_MS);
  });
});

describe('when the account deletion must be refused', () => {
  it('refuses a wrong password with a 409 and a sentence, and removes nothing', async () => {
    const h = build({ passwordMatches: false, pageIds: ['page-1'] });

    // Not a 401: the web client reads every 401 as the elevation expiring and
    // would take the parent off the screen holding the refusal.
    await expect(h.service.delete(ACCOUNT_ID, 'hunter2')).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.delete(ACCOUNT_ID, 'hunter2')).rejects.toMatchObject({
      message: PASSWORD_INCORRECT,
    });
    expect(h.pageExpiry.releaseBytes).not.toHaveBeenCalled();
    expect(h.prisma.withTransaction).not.toHaveBeenCalled();
    expect(h.accounts.removeAccount).not.toHaveBeenCalled();
  });

  it('refuses an empty password the same way, and spends the same verification', async () => {
    const h = build();

    await expect(h.service.delete(ACCOUNT_ID, '')).rejects.toMatchObject({
      message: PASSWORD_INCORRECT,
    });
    expect(h.accounts.verifyPassword).toHaveBeenCalledWith(ACCOUNT_ID, '');
  });

  it('refuses the whole deletion when a single unlink fails, and deletes nothing', async () => {
    const h = build({ pageIds: ['page-1', 'page-2', 'page-3'], unlinkFailures: 1 });

    // One attempt, so `markedPages()` below is what *this* refusal marked rather
    // than what a second run happened to leave behind.
    const refusal = await h.service.delete(ACCOUNT_ID, PASSWORD).catch((cause: unknown) => cause);

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(refusal).toMatchObject({ message: DELETION_INCOMPLETE });
    expect(h.prisma.withTransaction).not.toHaveBeenCalled();
    expect(h.practiceTests.purgeForAccountAllProfiles).not.toHaveBeenCalled();
    expect(h.sourceTests.purgeForAccountAllProfiles).not.toHaveBeenCalled();
    expect(h.students.removeAllOwned).not.toHaveBeenCalled();
    expect(h.ai.purgeForAccount).not.toHaveBeenCalled();
    expect(h.accounts.removeAccount).not.toHaveBeenCalled();
    // page-1 and page-2 came away before page-3 refused: their rows must be
    // marked to match, or they would still say `Ready` over a file that is gone.
    expect(h.markedPages()?.pageIds).toEqual(['page-1', 'page-2']);
    // And marked under this path's own label, so the log names the right caller.
    expect(h.markedPages()?.trigger).toBe('Parent Account deletion');
  });

  it('refuses when a page is photographed onto the account while the delete is in flight', async () => {
    const h = build({ pageIds: ['page-1'], pagesArrivingMidFlight: ['page-2'] });

    // `page-2` was never unlinked, because it did not exist when the bytes were
    // released — and deleting its Source Test now would leave its file on disk
    // with no row pointing at it.
    await expect(h.service.delete(ACCOUNT_ID, PASSWORD)).rejects.toMatchObject({
      message: DELETION_INCOMPLETE,
    });
    expect(h.practiceTests.purgeForAccountAllProfiles).not.toHaveBeenCalled();
    expect(h.students.removeAllOwned).not.toHaveBeenCalled();
    expect(h.accounts.removeAccount).not.toHaveBeenCalled();
    // `page-1`'s bytes are gone and its row survived the rollback; `page-2`'s
    // were never touched, so it is not marked.
    expect(h.markedPages()?.pageIds).toEqual(['page-1']);
  });

  it('does not refuse when the re-read finds exactly the set it released', async () => {
    const h = build({ pageIds: ['page-1', 'page-2'] });

    await expect(h.service.delete(ACCOUNT_ID, PASSWORD)).resolves.toBeUndefined();
  });
});

describe('when the transaction fails after the bytes are already gone', () => {
  it('marks the released pages so the rows stop claiming they still hold bytes', async () => {
    const h = build({ pageIds: ['page-1', 'page-2'], transactionFails: true });

    await expect(h.service.delete(ACCOUNT_ID, PASSWORD)).rejects.toThrow(/ran out of time/u);

    const marked = h.markedPages();
    expect(marked).not.toBeNull();
    expect(marked!.pageIds).toEqual(['page-1', 'page-2']);
    expect(marked!.at).toBeInstanceOf(Date);
  });

  it('rethrows the original failure rather than reporting a successful delete', async () => {
    const h = build({ pageIds: ['page-1'], transactionFails: true });

    await expect(h.service.delete(ACCOUNT_ID, PASSWORD)).rejects.toThrow(Error);
    expect(h.accounts.removeAccount).not.toHaveBeenCalled();
  });

  it('does not let a failed marking replace the failure the parent must hear', async () => {
    const h = build({ pageIds: ['page-1'], transactionFails: true, markingFails: true });

    // Two faults, one of which is the operator's problem and not the parent's.
    await expect(h.service.delete(ACCOUNT_ID, PASSWORD)).rejects.toThrow(/ran out of time/u);
  });

  it('marks nothing when the account had no pages to release', async () => {
    const h = build({ transactionFails: true });

    await expect(h.service.delete(ACCOUNT_ID, PASSWORD)).rejects.toThrow(Error);
    expect(h.steps).not.toContain('markReleased');
  });

  it('leaves the rows alone on a happy path', async () => {
    const h = build({ pageIds: ['page-1'] });

    await h.service.delete(ACCOUNT_ID, PASSWORD);

    // The rows are gone; marking would be a write against ids that no longer
    // exist.
    expect(h.markedPages()).toBeNull();
  });
});

describe('the account deletion preview', () => {
  it('reports every count and kind the confirmation has to name', async () => {
    const h = build();

    await expect(h.service.previewFor(ACCOUNT_ID)).resolves.toEqual({
      students: 2,
      sourceTests: 4,
      pageImages: 9,
      practiceTests: 6,
      attempts: 13,
      explanations: 21,
      masteryTopics: 11,
    });
  });

  it('names no cost figure, because a parent has never been shown one', async () => {
    const h = build();

    const preview = await h.service.previewFor(ACCOUNT_ID);

    // The `AiCall` rows go, but what they hold is this deployment's spend and
    // latency, not anything the parent uploaded (AD-26).
    expect(Object.keys(preview).sort()).toEqual([
      'attempts',
      'explanations',
      'masteryTopics',
      'pageImages',
      'practiceTests',
      'sourceTests',
      'students',
    ]);
    expect(h.ai.purgeForAccount).not.toHaveBeenCalled();
  });

  it('reads nothing and removes nothing: a preview is not a deletion', async () => {
    const h = build({ pageIds: ['page-1'] });

    await h.service.previewFor(ACCOUNT_ID);

    expect(h.pageExpiry.releaseBytes).not.toHaveBeenCalled();
    expect(h.prisma.withTransaction).not.toHaveBeenCalled();
    expect(h.accounts.verifyPassword).not.toHaveBeenCalled();
  });
});
