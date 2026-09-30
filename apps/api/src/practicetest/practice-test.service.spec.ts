import { describe, expect, it, vi } from 'vitest';
import type { AiService } from '../ai/ai.service.js';
import type { AllowanceService } from '../allowance/allowance.service.js';
import type { ParentAccountService } from '../identity/parent-account.service.js';
import type { PrismaService, TransactionClient } from '../prisma/prisma.service.js';
import type { ExtractionReader } from '../extraction/extraction-reader.js';
import { PracticeTestService } from './practice-test.service.js';
import type { SourceTestReader } from '../sourcetest/source-test-reader.js';

/**
 * `profilesWithSubmittedAttemptsOn` — whose Mastery a set of papers can have moved.
 *
 * **Its own spec, because Story 7.6's merge cannot state these rules.** That story's
 * unit spec stubs this method outright — it is testing the partition and the union, and
 * a stub is the right seam for both — so the statement this method actually issues is
 * asserted nowhere else. Two of its clauses are load-bearing and silent if dropped:
 *
 * - **`submittedAt: { not: null }`.** An open Attempt is not evidence of anything, and a
 *   child who started a paper and walked away is not a profile whose figures moved.
 * - **`distinct`.** A heavily-retaken paper would otherwise return one row per Attempt,
 *   and the merge would recompute the same child once per run it has ever sat.
 *
 * Deliberately **not** filtered by `countsTowardMastery`: which run counts is
 * `grading/mastery-eligibility.ts`'s predicate, and recomputing a profile that turns out
 * to have no qualifying evidence is a delete, which is the right answer for it anyway.
 * `test/topic-curation.int-spec.ts` proves the resulting rows against real Postgres.
 */
function serviceWith(rows: { studentProfileId: string }[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const tx = { attempt: { findMany } } as unknown as TransactionClient;
  const service = new PracticeTestService(
    {} as unknown as PrismaService,
    {} as unknown as AiService,
    {} as unknown as AllowanceService,
    {} as unknown as ParentAccountService,
    {} as unknown as SourceTestReader,
    {} as unknown as ExtractionReader,
  );
  return { service, tx, findMany };
}

describe('the profiles of a set of Practice Tests', () => {
  it('reads only handed-in Attempts, and only one row per profile', async () => {
    const { service, tx, findMany } = serviceWith([
      { studentProfileId: 'profile-a' },
      { studentProfileId: 'profile-b' },
    ]);

    expect(await service.profilesWithSubmittedAttemptsOn(tx, ['pt-1', 'pt-2'])).toEqual([
      'profile-a',
      'profile-b',
    ]);

    // Both clauses stated on the statement itself: an open Attempt is not evidence, and
    // a retaken paper must not name its child once per run.
    expect(findMany).toHaveBeenCalledWith({
      where: { practiceTestId: { in: ['pt-1', 'pt-2'] }, submittedAt: { not: null } },
      distinct: ['studentProfileId'],
      select: { studentProfileId: true },
    });
  });

  it('reads on the caller’s transaction and never a client of its own', async () => {
    // The caller is inside the transaction re-pointing the tags; a read of this
    // service's own pooled client would be a second snapshot of rows it is writing.
    const { service, tx, findMany } = serviceWith([]);

    await service.profilesWithSubmittedAttemptsOn(tx, ['pt-1']);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.instances[0]).toBe(
      (tx as unknown as { attempt: unknown }).attempt as object,
    );
  });

  it('asks about each Practice Test once however many times it is named', async () => {
    const { service, tx, findMany } = serviceWith([]);

    await service.profilesWithSubmittedAttemptsOn(tx, ['pt-1', 'pt-1', 'pt-2', 'pt-1']);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { practiceTestId: { in: ['pt-1', 'pt-2'] }, submittedAt: { not: null } },
      }),
    );
  });

  it('never reaches the database for an empty set', async () => {
    // A merged Topic with no tags touches no paper, which is the ordinary case for a
    // Topic the cascade minted and nobody has handed a paper in on.
    const { service, tx, findMany } = serviceWith([]);

    expect(await service.profilesWithSubmittedAttemptsOn(tx, [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
