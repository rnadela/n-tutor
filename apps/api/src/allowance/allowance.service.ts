import { Injectable } from '@nestjs/common';
import type { AccountTier } from '../generated/prisma/enums.js';
import { ParentAccountService } from '../identity/parent-account.service.js';
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
  /** The tier's Student Profile limit. No profile count exists yet (Epic 1). */
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
 * The counting seam — the single place Epics 3–6 wire their counts in.
 *
 * Each entry counts artifacts produced for the account with a creation instant
 * inside the window, read from the owning module's service: Upload from
 * `sourcetest`, Generation from `practicetest` (charged on first reaching
 * draft), Explanation from `explanation`.
 *
 * None of those entities exists yet, so all three read zero and no query is
 * issued. When they arrive they are counted here and **nowhere else**, and no
 * counter column, period column, or reset job is introduced anywhere (AD-14).
 */
const ARTIFACT_COUNTERS: Readonly<Record<keyof UsageCounts, ArtifactCounter>> = {
  upload: async () => 0,
  generation: async () => 0,
  explanation: async () => 0,
};

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
  constructor(private readonly accounts: ParentAccountService) {}

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
      ARTIFACT_COUNTERS.upload(accountId, window),
      ARTIFACT_COUNTERS.generation(accountId, window),
      ARTIFACT_COUNTERS.explanation(accountId, window),
    ]);
    return { upload, generation, explanation };
  }
}
