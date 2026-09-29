import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { DEFAULT_TIMEZONE, isSupportedTimeZone } from '../common/timezone.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AccountTier } from '../generated/prisma/enums.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { DUMMY_HASH } from './auth-policy.js';

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
    /** Epic 1 sign-up: the credential is written with the account, or not at all. */
    passwordHash?: string;
    /** Epic 1 sign-up: the first, append-only acceptance record. */
    consent?: { termsVersion: string; noticeVersion: string; acceptedAt: Date };
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
            ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
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
        if (input.consent) {
          await tx.accountConsent.create({
            data: {
              parentAccountId: account.id,
              termsVersion: input.consent.termsVersion,
              noticeVersion: input.consent.noticeVersion,
              acceptedAt: input.consent.acceptedAt,
            },
          });
        }
        return account;
      }),
    );
  }

  /**
   * The credential row for a sign-in attempt, or `null` when no such email
   * exists. The caller must take the same path for both (AD-23) — the absence
   * of a row is not an early return.
   */
  findCredentialByEmail(email: string): Promise<{
    id: string;
    email: string;
    passwordHash: string | null;
    sessionEpoch: number;
  } | null> {
    return this.prisma.parentAccount.findUnique({
      where: { email: normaliseEmail(email) },
      // The epoch travels with the credential so minting a session needs no
      // second read, which could observe the row already deleted.
      select: { id: true, email: true, passwordHash: true, sessionEpoch: true },
    });
  }

  /**
   * What the session guard needs and nothing more — notably not the password
   * hash, which no read path serving a request has any use for.
   */
  findSessionSubject(
    id: string,
  ): Promise<{ id: string; email: string; sessionEpoch: number } | null> {
    return this.prisma.parentAccount.findUnique({
      where: { id },
      select: { id: true, email: true, sessionEpoch: true },
    });
  }

  /**
   * The PIN state, and the only read anywhere that selects the hash. It is
   * never returned to a caller that serialises its result: `ParentPinService`
   * verifies against it and throws the hash away.
   */
  findPinState(id: string): Promise<{
    pinHash: string | null;
    pinFailedAttempts: number;
    pinLockedUntil: Date | null;
    sessionEpoch: number;
  } | null> {
    return this.prisma.parentAccount.findUnique({
      where: { id },
      select: {
        pinHash: true,
        pinFailedAttempts: true,
        pinLockedUntil: true,
        sessionEpoch: true,
      },
    });
  }

  /**
   * The credential row by account id. The elevation surface knows the account
   * authoritatively, so it must not re-resolve it from an email claim.
   */
  findCredentialById(id: string): Promise<{
    id: string;
    email: string;
    passwordHash: string | null;
  } | null> {
    return this.prisma.parentAccount.findUnique({
      where: { id },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  /**
   * Whether `password` is this account's, by account id.
   *
   * The hash is read and verified **inside its owner** and never leaves it
   * (AD-17): a caller elsewhere that wanted to re-authenticate a parent would
   * otherwise need `passwordHash` in hand, and a credential that travels is a
   * credential that gets logged. Resolved by id, never by a token's email claim
   * — the guard has already established which account this is, and that is the
   * account whose password must be the one verified.
   *
   * An account with no credential verifies against `DUMMY_HASH` and answers
   * `false`: the work is done either way, so a credential-less account is
   * indistinguishable in cost from a wrong password. A malformed stored hash
   * makes argon2 throw, and that is `false` too — a verification that could not
   * be made is not a verification that succeeded.
   */
  async verifyPassword(accountId: string, password: string): Promise<boolean> {
    const credential = await this.findCredentialById(accountId);
    const hash = credential?.passwordHash ?? DUMMY_HASH;
    try {
      const matched = await argon2.verify(hash, password);
      // The dummy is a real hash, so a caller who somehow supplied its
      // pre-image would `verify` against it. The presence of a stored
      // credential is therefore part of the answer, not only of the cost.
      return matched && credential?.passwordHash != null;
    } catch {
      return false;
    }
  }

  /**
   * Writes the PIN and clears the failure state with it, inside the caller's
   * transaction: a PIN that has just been set or changed must not land behind a
   * lock left over from the entries that preceded it.
   */
  async setPin(tx: TransactionClient, accountId: string, pinHash: string): Promise<void> {
    await tx.parentAccount.update({
      where: { id: accountId },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }

  /**
   * Sets the **first** PIN, and only if there is still none. `false` means
   * another request set one in between; the caller turns that into the same
   * conflict a prior read would have produced.
   *
   * Conditional rather than a read followed by a write, because two concurrent
   * first-set requests would both pass a prior check and the loser would
   * silently replace the winner's PIN.
   */
  async setFirstPin(tx: TransactionClient, accountId: string, pinHash: string): Promise<boolean> {
    const written = await tx.parentAccount.updateMany({
      where: { id: accountId, pinHash: null },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
    return written.count === 1;
  }

  /**
   * Counts one wrong entry and returns the counter it produced.
   *
   * The increment happens in the database (`pinFailedAttempts + 1`, under the
   * row lock that statement takes), never as a read-modify-write in JS: a
   * parallel guessing run would otherwise have every request read the same
   * count and write the same value back, so the ceiling — the whole of the
   * brute-force defence — would never be reached.
   */
  async recordPinFailure(tx: TransactionClient, accountId: string): Promise<number> {
    const row = await tx.parentAccount.update({
      where: { id: accountId },
      data: { pinFailedAttempts: { increment: 1 } },
      select: { pinFailedAttempts: true },
    });
    return row.pinFailedAttempts;
  }

  /** Closes the gate until `lockedUntil`, with the counter zeroed behind it. */
  async lockPin(tx: TransactionClient, accountId: string, lockedUntil: Date): Promise<void> {
    await tx.parentAccount.update({
      where: { id: accountId },
      data: { pinFailedAttempts: 0, pinLockedUntil: lockedUntil },
    });
  }

  /** A correct PIN takes the account back to a zero counter and an open gate. */
  async clearPinFailures(tx: TransactionClient, accountId: string): Promise<void> {
    await tx.parentAccount.update({
      where: { id: accountId },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }

  /**
   * Replaces the credential and bumps the session epoch in one step, inside the
   * caller's transaction. The bump is what makes a reset actually lock out
   * whoever prompted it: every session token minted at the old epoch dies here.
   */
  async setPasswordHash(
    tx: TransactionClient,
    accountId: string,
    passwordHash: string,
  ): Promise<void> {
    await tx.parentAccount.update({
      where: { id: accountId },
      data: { passwordHash, sessionEpoch: { increment: 1 } },
    });
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
