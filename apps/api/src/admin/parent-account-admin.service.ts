import { Injectable } from '@nestjs/common';
import { AllowanceService, type AccountConsumption } from '../allowance/allowance.service.js';
import type { AccountTier } from '../generated/prisma/enums.js';
import {
  ParentAccountService,
  type ParentAccountSummary,
} from '../identity/parent-account.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminAuditService } from './admin-audit.service.js';

export interface ParentAccountDetail {
  account: ParentAccountSummary;
  consumption: AccountConsumption;
}

/**
 * The Admin console's view of Parent Accounts.
 *
 * `admin` never touches the `parentAccount` or `accountTimezone` delegates: it
 * reads through `identity`, writes through `identity.setTier`, and reads every
 * allowance figure through `allowance` (AD-17). The only thing it owns here is
 * the audit row.
 */
@Injectable()
export class ParentAccountAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: ParentAccountService,
    private readonly allowance: AllowanceService,
    private readonly audit: AdminAuditService,
  ) {}

  list(): Promise<ParentAccountSummary[]> {
    return this.accounts.list();
  }

  /** The account plus its full consumption payload, in its own period and zone. */
  async detail(accountId: string, now: Date = new Date()): Promise<ParentAccountDetail> {
    const account = await this.accounts.findById(accountId);
    const [timezone, consumption] = await Promise.all([
      this.accounts.effectiveTimezoneAt(accountId, now),
      this.allowance.consumptionFor(accountId, now),
    ]);
    return { account: { ...account, timezone }, consumption };
  }

  /**
   * The only path that changes an Account Tier. One transaction: read the
   * current tier, write the new one through `identity`, and record the audit
   * row beside it — so a failing audit write rolls the tier change back too
   * (AD-25). The action is recorded even when the value is unchanged.
   */
  async assignTier(
    actorId: string,
    accountId: string,
    tier: AccountTier,
    now: Date = new Date(),
  ): Promise<ParentAccountSummary> {
    const updated = await this.prisma.withTransaction(async (tx) => {
      // The lock is taken here, before the read, so two concurrent assignments
      // serialise and each records a truthful `from`.
      const before = await this.accounts.findByIdForUpdate(tx, accountId);
      const after = await this.accounts.setTier(tx, accountId, tier);
      await this.audit.record(tx, actorId, 'parentAccount.tierChange', 'ParentAccount', accountId, {
        from: before.tier,
        to: after.tier,
      });
      return after;
    });

    // The same summary shape the list returns, so the client has one type.
    return { ...updated, timezone: await this.accounts.effectiveTimezoneAt(accountId, now) };
  }
}
