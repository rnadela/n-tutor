import { Injectable } from '@nestjs/common';
import type { AccountTier, UsageClass } from '../generated/prisma/enums.js';
import { ParentAccountService } from '../identity/parent-account.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SourceTestService } from '../sourcetest/source-test.service.js';
import { resolveWindow, type PeriodWindow } from './period.js';
import { limitsFor } from './tiers.js';

/** One allowance: what was used this period, against the tier's limit. */
export interface AllowanceReading {
  used: number;
  /** `null` is unlimited — never a sentinel number. */
  limit: number | null;
}

export interface AccountConsumption {
  periodStart: string;
  periodEnd: string;
  /** The instant all three counters reset together — the window end. */
  resetAt: string;
  /** The zone the window was actually computed in. */
  timezone: string;
  tier: AccountTier;
  /**
   * The tier's Student Profile limit — the limit only, never a live count.
   * Checking it against the account's actual profiles is Story 9.2.
   */
  studentProfileLimit: number | null;
  allowances: {
    upload: AllowanceReading;
    generation: AllowanceReading;
    explanation: AllowanceReading;
  };
}

interface UsageCounts {
  upload: number;
  generation: number;
  explanation: number;
}

/** Counts one allowance's artifacts inside `[window.start, window.end)`. */
type ArtifactCounter = (accountId: string, window: PeriodWindow) => Promise<number>;

/**
 * The `allowance` policy module. It owns **no entity** (AD-14, AD-17): it holds
 * the tiers table, the period-window computation, and the three usage counts,
 * and it is the only place any of them is implemented. Admin and (later) parent
 * surfaces call `consumptionFor`, so their numbers can never disagree.
 *
 * Usage is *derived*: counted from artifacts inside the window, never a stored
 * counter column and never a reset job. That is also why a tier change takes
 * effect immediately against the current period — the window is unchanged, only
 * the limits it is measured against move.
 *
 * This story implements no enforcement: nothing here blocks at cap. Epic 9 owns
 * that.
 */
@Injectable()
export class AllowanceService {
  constructor(
    private readonly accounts: ParentAccountService,
    // Held so the counting seam can issue its own count. This module still owns
    // no entity (AD-14, AD-17): it reads a `chargedAt` column that
    // `practicetest` alone writes, and writes nothing anywhere. Injecting
    // `PracticeTestService` instead would make `allowance` — which every
    // surface reads — depend on a module that depends on it.
    private readonly prisma: PrismaService,
    // Upload usage is read **through** the owning module's service, never
    // through a Prisma delegate of this one's (AD-17). `sourcetest` does not
    // import `allowance`, so unlike `practicetest` this is a plain dependency
    // in one direction and needs no token indirection.
    private readonly sourceTests: SourceTestService,
  ) {}

  /**
   * The counting seam — the single place Epics 3–6 wire their counts in.
   *
   * Each entry counts artifacts produced for the account with a charging
   * instant inside the window: Upload from `sourcetest` (a Source Test
   * committed in the window), Generation from `practicetest` (charged on first
   * reaching draft), Explanation from `explanation`.
   *
   * Usage is **derived** and nothing here is ever decremented (AD-14). A
   * discard, a deletion, or a draft the parent never released does not give
   * the unit back, because the artifact was produced and the provider call was
   * paid for. There is no debit to reconcile either: reaching `Submitted` is
   * one transaction, so counting Submitted rows in the window *is* the Upload
   * charge — an abandoned or expired draft was never Submitted and so was
   * never charged, and a refused submit leaves the row a Draft.
   *
   * Explanation arrived with Story 6.1 and is counted here and **nowhere
   * else**: charged `explanation` rows inside the window, with no counter
   * column, period column or reset job introduced anywhere.
   *
   * Instance-bound rather than module-level, which is what puts the injected
   * services in reach; "counted here and nowhere else" is the part of the seam
   * that matters and it is unchanged.
   */
  private readonly counters: Readonly<Record<keyof UsageCounts, ArtifactCounter>> = {
    upload: async (accountId, window) =>
      (await this.sourceTests.countSubmittedIn(accountId, window)) +
      (await this.tombstonedIn(accountId, window, 'Upload')),
    generation: async (accountId, window) =>
      // The half-open window the whole module is stated in: `[start, end)`, so
      // a Practice Test charged at the instant a period ends belongs to the
      // next one and is counted exactly once.
      (await this.prisma.practiceTest.count({
        where: {
          parentAccountId: accountId,
          chargedAt: { gte: window.start, lt: window.end },
        },
      })) + (await this.tombstonedIn(accountId, window, 'Generation')),
    explanation: async (accountId, window) =>
      // The same half-open window and the same shape as `generation` above, over
      // `explanation`'s own charging column. Counted **here and nowhere else**:
      // there is no counter column, no period column and no reset job, and a row
      // whose `chargedAt` is null — Story 6.4's free regeneration — is simply not
      // counted, because it cost nothing.
      //
      // Through this module's own `PrismaService` rather than through
      // `ExplanationService`, for the reason the note on the injection says:
      // `explanation` imports `allowance`, so importing it back would be a cycle
      // bought for nothing, since what is counted is a column and not a
      // behaviour.
      (await this.prisma.explanation.count({
        where: {
          parentAccountId: accountId,
          chargedAt: { gte: window.start, lt: window.end },
        },
      })) + (await this.tombstonedIn(accountId, window, 'Explanation')),
  };

  /**
   * What this account's **deleted** artifacts of one class still count for in
   * this window.
   *
   * Usage stays derived (AD-14): there is still no counter column, no period
   * column and no reset job. A `usage_tombstone` row is not a counter — it is
   * written once, inside the transaction that erased the artifacts it stands in
   * for, and is never decremented, reset or moved. Adding it here is the one
   * place a deleted artifact keeps being counted, and it is here rather than in
   * `deletion` for the reason every other count is here: two places that compute
   * an allowance are two answers to it.
   *
   * The same half-open `[start, end)` the three live counts use, over
   * `periodStart` — which is the window start the charge fell in, resolved from
   * the artifact's own charging instant by `resolveWindow` and therefore stable
   * after the fact. A tombstone counted in the wrong period would be a silent
   * refund in one month and a silent double-charge in another.
   *
   * No rows is `0` and never `null`: `_sum` over an empty set is null, and a
   * null added to a count is `NaN`.
   */
  private async tombstonedIn(
    accountId: string,
    window: PeriodWindow,
    usageClass: UsageClass,
  ): Promise<number> {
    const summed = await this.prisma.usageTombstone.aggregate({
      where: {
        parentAccountId: accountId,
        usageClass,
        periodStart: { gte: window.start, lt: window.end },
      },
      _sum: { count: true },
    });
    return summed._sum.count ?? 0;
  }

  /** The window this account's counters are measured over, in its own zone. */
  async windowFor(accountId: string, now: Date = new Date()): Promise<PeriodWindow> {
    return resolveWindow(now, await this.accounts.timezoneHistory(accountId));
  }

  /** 404s through `identity` when the account is unknown. */
  async consumptionFor(accountId: string, now: Date = new Date()): Promise<AccountConsumption> {
    const account = await this.accounts.findById(accountId);
    const window = await this.windowFor(accountId, now);
    const used = await this.countArtifactsIn(accountId, window);
    const limits = limitsFor(account.tier);

    return {
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      resetAt: window.end.toISOString(),
      timezone: window.timezone,
      tier: account.tier,
      studentProfileLimit: limits.studentProfiles,
      allowances: {
        upload: { used: used.upload, limit: limits.upload },
        generation: { used: used.generation, limit: limits.generation },
        explanation: { used: used.explanation, limit: limits.explanation },
      },
    };
  }

  /**
   * Runs the counting seam for all three allowances.
   *
   * Usage is *derived* — nothing is stored and nothing is decremented — so this
   * is the only place any of the three is ever computed (AD-14).
   */
  private async countArtifactsIn(accountId: string, window: PeriodWindow): Promise<UsageCounts> {
    const [upload, generation, explanation] = await Promise.all([
      this.counters.upload(accountId, window),
      this.counters.generation(accountId, window),
      this.counters.explanation(accountId, window),
    ]);
    return { upload, generation, explanation };
  }
}
