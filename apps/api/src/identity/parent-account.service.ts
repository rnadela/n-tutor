import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DEFAULT_TIMEZONE, isSupportedTimeZone } from '../common/timezone.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AccountTier } from '../generated/prisma/enums.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';

export { DEFAULT_TIMEZONE };

export interface ParentAccount {
  id: string;
  email: string;
  displayName: string | null;
  tier: AccountTier;
  createdAt: Date;
}

/** One entry of the effective-dated timezone history (AD-27). */
export interface TimezoneEntry {
  timezone: string;
  effectiveFrom: Date;
}

/** A Parent Account plus the zone in effect for it right now. */
export interface ParentAccountSummary extends ParentAccount {
  timezone: string;
}

const ACCOUNT_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  tier: true,
  createdAt: true,
} as const;

const HISTORY_FIELDS = { timezone: true, effectiveFrom: true } as const;

/**
 * The stored email: trimmed and lowercased. The unique index is
 * case-sensitive, so without this `Ada@example.test` and `ada@example.test`
 * would become two accounts — including through Epic 1's sign-up, which lands
 * on the same `create`.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The zone in effect at `instant`: the entry in force with the latest
 * `effectiveFrom`, ties broken by zone name so the result never depends on row
 * order. `null` when no entry is yet in force — the caller decides the
 * fallback. An entry naming a zone this platform does not recognise is skipped
 * rather than returned, so one bad row cannot take a read path down.
 */
export function zoneInEffectAt(history: readonly TimezoneEntry[], instant: Date): string | null {
  let winner: TimezoneEntry | null = null;
  for (const entry of history) {
    if (entry.effectiveFrom.getTime() > instant.getTime()) continue;
    if (!isSupportedTimeZone(entry.timezone)) continue;
    if (winner === null) {
      winner = entry;
      continue;
    }
    const delta = entry.effectiveFrom.getTime() - winner.effectiveFrom.getTime();
    // Deterministic tiebreaker: same instant, higher zone name wins.
    if (delta > 0 || (delta === 0 && entry.timezone > winner.timezone)) winner = entry;
  }
  return winner?.timezone ?? null;
}

function requireSupportedTimeZone(zone: string): string {
  if (!isSupportedTimeZone(zone)) {
    throw new BadRequestException(`Unknown timezone: ${zone}`);
  }
  return zone;
}

/** A unique-index violation on email is a duplicate account, not a 500. */
async function conflictOnDuplicateEmail<T>(email: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      throw new ConflictException(`A Parent Account already exists for ${email}.`);
    }
    throw cause;
  }
}

/**
 * Sole writer of ParentAccount and AccountTimezone (AD-17).
 *
 * `admin` changes a tier by calling `setTier` with its own transaction client,
 * exactly as it writes an audit row — the two commit or roll back together.
 * Nothing about an allowance lives here: limits and period windows belong to
 * the `allowance` policy module.
 */
@Injectable()
export class ParentAccountService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Reads -------------------------------------------------------------

  /** Every Parent Account with its currently-effective zone, ordered by email. */
  async list(now: Date = new Date()): Promise<ParentAccountSummary[]> {
    const accounts = await this.prisma.parentAccount.findMany({
      select: { ...ACCOUNT_FIELDS, timezones: { select: HISTORY_FIELDS } },
      orderBy: { email: 'asc' },
    });
    return accounts.map(({ timezones, ...account }) => ({
      ...account,
      timezone: zoneInEffectAt(timezones, now) ?? DEFAULT_TIMEZONE,
    }));
  }

  async findById(id: string): Promise<ParentAccount> {
    const account = await this.prisma.parentAccount.findUnique({
      where: { id },
      select: ACCOUNT_FIELDS,
    });
    if (!account) throw new NotFoundException('Parent Account not found.');
    return account;
  }

  /**
   * Reads the row inside the caller's transaction and holds a row lock on it
   * until that transaction ends.
   *
   * The lock is the point: under READ COMMITTED two concurrent tier changes
   * would otherwise both read the same `from` tier and write two audit rows
   * claiming the same origin, so the trail would record a transition that never
   * happened. Serialising them here makes every `from` truthful.
   */
  async findByIdForUpdate(tx: TransactionClient, id: string): Promise<ParentAccount> {
    const rows = await tx.$queryRaw<ParentAccount[]>`
      SELECT "id", "email", "displayName", "tier", "createdAt"
      FROM "parent_account"
      WHERE "id" = ${id}
      FOR UPDATE
    `;
    const account = rows[0];
    if (!account) throw new NotFoundException('Parent Account not found.');
    return account;
  }

  /**
   * The full history, oldest first, ties broken by zone name so the row order
   * handed to `zoneInEffectAt` is itself deterministic.
   */
  timezoneHistory(accountId: string): Promise<TimezoneEntry[]> {
    return this.prisma.accountTimezone.findMany({
      where: { parentAccountId: accountId },
      select: HISTORY_FIELDS,
      orderBy: [{ effectiveFrom: 'asc' }, { timezone: 'asc' }],
    });
  }

  /** The zone in effect at `instant`, falling back to UTC when none is. */
  async effectiveTimezoneAt(accountId: string, instant: Date): Promise<string> {
    return zoneInEffectAt(await this.timezoneHistory(accountId), instant) ?? DEFAULT_TIMEZONE;
  }

  // --- Writes ------------------------------------------------------------

  /**
   * Sets the Account Tier. Takes the caller's transaction client first, so the
   * tier change and the audit row `admin` writes beside it share one
   * transaction (AD-25). The caller is responsible for the 404 check and for
   * taking the row lock through `findByIdForUpdate`.
   */
  setTier(tx: TransactionClient, accountId: string, tier: AccountTier): Promise<ParentAccount> {
    return tx.parentAccount.update({
      where: { id: accountId },
      data: { tier },
      select: ACCOUNT_FIELDS,
    });
  }

  /**
   * Creates a Parent Account, optionally with its first timezone entry. Used by
   * tests and by Epic 1's sign-up; no admin route reaches it. `tier` is left to
   * the schema default (`Free`) unless a caller states one.
   */
  async create(input: {
    email: string;
    displayName?: string | null;
    tier?: AccountTier;
    timezone?: string;
    effectiveFrom?: Date;
  }): Promise<ParentAccount> {
    const email = normaliseEmail(input.email);
    // Rejected before the transaction opens: an unrecognised zone must never
    // reach a row, because every read of it would then throw.
    const timezone = input.timezone ? requireSupportedTimeZone(input.timezone) : undefined;

    return conflictOnDuplicateEmail(email, () =>
      this.prisma.withTransaction(async (tx) => {
        const account = await tx.parentAccount.create({
          data: {
            email,
            displayName: input.displayName ?? null,
            ...(input.tier ? { tier: input.tier } : {}),
          },
          select: ACCOUNT_FIELDS,
        });
        if (timezone) {
          await tx.accountTimezone.create({
            data: {
              parentAccountId: account.id,
              timezone,
              effectiveFrom: input.effectiveFrom ?? account.createdAt,
            },
          });
        }
        return account;
      }),
    );
  }

  /**
   * Appends a timezone entry. The history is append-only: an existing entry is
   * never edited, so a period already computed from an earlier zone stays as it
   * was resolved (AD-27).
   */
  async appendTimezone(accountId: string, timezone: string, effectiveFrom: Date): Promise<void> {
    await this.prisma.accountTimezone.create({
      data: {
        parentAccountId: accountId,
        timezone: requireSupportedTimeZone(timezone),
        effectiveFrom,
      },
    });
  }
}
