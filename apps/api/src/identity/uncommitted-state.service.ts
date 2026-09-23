import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { UncommittedStateKind } from '../generated/prisma/enums.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { PROFILE_NOT_FOUND, StudentProfileService } from './student-profile.service.js';
import {
  UNCOMMITTED_STATE_NOT_FOUND,
  expiredAt,
  expiryFrom,
  isExpired,
  liveAt,
} from './uncommitted-state-policy.js';

/** A slot of uncommitted parent work as every read path returns it. */
export interface UncommittedStateView {
  id: string;
  studentProfileId: string;
  kind: UncommittedStateKind;
  scope: string;
  /** Returned byte-identical to what was saved. Never logged, never quoted. */
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  /** Creation plus the TTL. A later save into the same slot never moves it. */
  expiresAt: string;
}

export interface SaveUncommittedStateInput {
  studentProfileId: string;
  kind: UncommittedStateKind;
  scope: string;
  payload: object;
}

const STATE_FIELDS = {
  id: true,
  studentProfileId: true,
  kind: true,
  scope: true,
  payload: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
} as const;

interface StateRow {
  id: string;
  studentProfileId: string;
  kind: UncommittedStateKind;
  scope: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * The most rows one list read returns.
 *
 * A slot is created deliberately, one per kind and scope, so a parent reaching
 * this many is already pathological — but a read whose size is bounded only by
 * how many rows happen to exist is not a bound at all.
 */
export const RESTORABLE_PAGE_SIZE = 200;

/**
 * The most rows one sweep deletes.
 *
 * The sweep runs inside a parent's own save, so its cost has to have a ceiling:
 * without one, a single parent pays the latency of clearing the whole system's
 * backlog, and two concurrent saves issue overlapping unqualified deletes over
 * the same index. A backlog larger than this is simply cleared across the next
 * few saves — or in one pass by the scheduled sweep, when Epic 3 stands a
 * worker up.
 */
export const SWEEP_BATCH_SIZE = 100;

/**
 * How many times `save()` retries a slot write on a unique-constraint
 * collision before giving up.
 *
 * A single retry covers the common two-way race (two saves finding an empty
 * slot at once). Bounding it above one lets a rarer three-or-more-way
 * collision still resolve without turning the retry into an unbounded loop.
 */
export const SLOT_WRITE_MAX_ATTEMPTS = 3;

/**
 * Sole writer of UncommittedState (AD-17). Nothing outside this service touches
 * the delegate.
 *
 * Three rules hold every method together:
 *
 * - Every read and every write a *parent* reaches is scoped by
 *   `parentAccountId` inside the statement that reads or mutates — never by a
 *   check made just before it. An id belonging to another account therefore
 *   matches nothing and changes nothing: a 404, never a 403, which would
 *   confirm the row exists somewhere. `sweepExpired` is the one deliberate
 *   exception: it is housekeeping over every account's dead rows, it is reached
 *   by no route, and it can only ever remove rows that are already invisible to
 *   every read.
 * - The profile is confirmed through `StudentProfileService.findSelectable`
 *   rather than re-derived here. That one check is what makes the cross-profile,
 *   archived and other-account cases a single indistinguishable "no such
 *   profile".
 * - The TTL is enforced on read as well as by deletion. `expiresAt` is part of
 *   every read's `where`, so a row is invisible the instant the clock passes it,
 *   independent of any scheduler; `sweepExpired` then removes the bytes. AD-33
 *   puts the sweep on a pg-boss schedule — this repo has no worker yet, so it is
 *   called opportunistically on each save and the schedule will call the same
 *   method unchanged when the worker lands.
 *
 * Nothing here consumes the mechanism: no payload shape for a draft edit, a
 * grade override or a partial upload exists, by design. Story 1.6 ships the
 * mechanism only.
 */
@Injectable()
export class UncommittedStateService {
  private readonly logger = new Logger(UncommittedStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentProfileService,
  ) {}

  /**
   * Writes the slot — account, profile, kind and scope — and returns it.
   *
   * An existing **unexpired** row keeps its `createdAt` and `expiresAt` and
   * takes the new payload: re-saving is not a way to buy another 72 hours. An
   * existing **expired** row is deleted first, so the save lands on a fresh
   * window rather than resurrecting a dead one.
   *
   * Both happen in one transaction, which is not by itself enough: at READ
   * COMMITTED two simultaneous saves into one empty slot can each find nothing
   * and each try to create, and the loser of that race gets a unique-index
   * violation. Losing it would turn a write whose whole purpose is not losing
   * work into a 500, so the violation is caught and retried as the update it
   * has by then become — bounded, so a pile-up of collisions still fails loudly
   * rather than looping forever.
   *
   * The profile is confirmed once, up front. If it is archived or removed in
   * the instant between that check and the write, the foreign key itself
   * refuses the insert; that failure is answered exactly as the up-front check
   * would have answered it, so the two paths never diverge on the caller.
   */
  async save(
    parentAccountId: string,
    input: SaveUncommittedStateInput,
  ): Promise<UncommittedStateView> {
    const profile = await this.students.findSelectable(parentAccountId, input.studentProfileId);
    if (profile === null) throw new NotFoundException(PROFILE_NOT_FOUND);

    // One instant for the whole request: the row's window, the expiry branch and
    // the sweep are all judged against the same clock, so a row sitting exactly
    // on its boundary cannot be alive for one of them and dead for another.
    const now = new Date();
    const slot = {
      parentAccountId,
      studentProfileId: profile.id,
      kind: input.kind,
      scope: input.scope,
    };

    let row: StateRow | undefined;
    let lastCause: unknown;
    for (let attempt = 0; attempt < SLOT_WRITE_MAX_ATTEMPTS; attempt++) {
      try {
        row = await this.prisma.withTransaction((tx) =>
          this.writeSlot(tx, slot, input.payload, now),
        );
        break;
      } catch (cause) {
        if (isForeignKeyViolation(cause)) throw new NotFoundException(PROFILE_NOT_FOUND);
        if (!isUniqueViolation(cause)) throw cause;
        // The concurrent save won the create; this one is an update of the row
        // it made. Its window is that save's, which is correct either way: the
        // TTL runs from whichever creation actually happened. Retry rather than
        // fail, up to the bound above.
        lastCause = cause;
      }
    }
    if (row === undefined) throw lastCause;

    // Opportunistic, and never allowed to fail the save the parent just made:
    // the write is what they asked for, the sweep is housekeeping.
    await this.sweepExpired(now).catch((cause: unknown) => {
      this.logger.warn(
        `Sweeping expired uncommitted state failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    });

    return viewOf(row);
  }

  /** One attempt at the slot: drop it if dead, then write it. */
  private async writeSlot(
    tx: TransactionClient,
    slot: {
      parentAccountId: string;
      studentProfileId: string;
      kind: UncommittedStateKind;
      scope: string;
    },
    payload: object,
    now: Date,
  ): Promise<StateRow> {
    const existing = await tx.uncommittedState.findUnique({
      where: { parentAccountId_studentProfileId_kind_scope: slot },
      select: { id: true, expiresAt: true },
    });
    // The dead row never resurrects: it goes before the write, in the same
    // transaction, judged by the one predicate the reads are filtered by.
    if (existing !== null && isExpired(existing, now)) {
      await tx.uncommittedState.delete({ where: { id: existing.id } });
    }

    return tx.uncommittedState.upsert({
      where: { parentAccountId_studentProfileId_kind_scope: slot },
      // The payload alone. `createdAt` and `expiresAt` are untouched by an
      // update — the TTL is measured from creation and is never extended.
      update: { payload },
      create: { ...slot, payload, createdAt: now, expiresAt: expiryFrom(now) },
      select: STATE_FIELDS,
    });
  }

  /**
   * The unexpired rows saved under one profile, newest first.
   *
   * The profile is named by the caller and confirmed first: a read naming a
   * different profile, an archived one, or another account's finds nothing and
   * rebinds nothing.
   */
  async restorableFor(
    parentAccountId: string,
    studentProfileId: string,
  ): Promise<UncommittedStateView[]> {
    const profile = await this.students.findSelectable(parentAccountId, studentProfileId);
    if (profile === null) throw new NotFoundException(PROFILE_NOT_FOUND);

    const rows = await this.prisma.uncommittedState.findMany({
      // `expiresAt` is part of the read, not a filter applied afterwards: a row
      // past its window is invisible whether or not a sweep has run.
      where: { parentAccountId, studentProfileId: profile.id, expiresAt: liveAt(new Date()) },
      select: STATE_FIELDS,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RESTORABLE_PAGE_SIZE,
    });
    return rows.map(viewOf);
  }

  /**
   * One retained slot by id, for a caller that holds the id and is restoring it
   * into the profile it names.
   *
   * This is the read that makes AD-33's refusal expressible. It answers with the
   * row only when all three hold at once: the row is this account's, the named
   * profile is one this account may select, **and** the row's own profile is
   * that same profile. A row saved under a sibling is therefore refused rather
   * than silently rebound into the profile the caller asked for — which is the
   * exposure the profile key exists to close, since the device may now be in a
   * different child's hands.
   *
   * Every failure — sibling profile, unknown row, expired row, archived,
   * foreign or unknown profile — is the same 404 carrying the same message. No
   * ordering of the checks leaks which one fired, because the answer does not
   * depend on which one did.
   */
  async restorableItem(
    parentAccountId: string,
    id: string,
    studentProfileId: string,
  ): Promise<UncommittedStateView> {
    const profile = await this.students.findSelectable(parentAccountId, studentProfileId);
    // Not `PROFILE_NOT_FOUND`: on this route an unknown profile and an unknown
    // row must be one indistinguishable answer, and two messages would sort
    // them into two.
    if (profile === null) throw new NotFoundException(UNCOMMITTED_STATE_NOT_FOUND);

    const row = await this.prisma.uncommittedState.findFirst({
      // The account, the row's own profile and the window are all in the
      // statement that reads. Nothing is checked afterwards, so nothing can be
      // returned and then rejected.
      where: {
        id,
        parentAccountId,
        studentProfileId: profile.id,
        expiresAt: liveAt(new Date()),
      },
      select: STATE_FIELDS,
    });
    if (row === null) throw new NotFoundException(UNCOMMITTED_STATE_NOT_FOUND);
    return viewOf(row);
  }

  /**
   * Discards a slot once its work has been committed.
   *
   * `deleteMany` scoped by account in the delete statement itself, so the call
   * is idempotent and an id on another account deletes nothing and says nothing
   * about whether it exists.
   */
  async discard(parentAccountId: string, id: string): Promise<void> {
    await this.prisma.uncommittedState.deleteMany({ where: { id, parentAccountId } });
  }

  /**
   * Deletes up to one batch of rows past their expiry and reports how many went.
   *
   * The method a scheduled sweep will call when Epic 3 stands a worker up. It
   * is not what makes an expired row unreadable — the reads do that — so it can
   * run late, run short, or not run at all without changing what anyone can
   * see. That is exactly what lets it be capped: the ids are selected first and
   * only those are deleted, so a parent's save never pays for more than
   * `SWEEP_BATCH_SIZE` rows of someone else's backlog, and two concurrent saves
   * do not issue overlapping unqualified deletes across the whole index.
   */
  async sweepExpired(now: Date = new Date(), batchSize = SWEEP_BATCH_SIZE): Promise<number> {
    const dead = await this.prisma.uncommittedState.findMany({
      where: { expiresAt: expiredAt(now) },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: batchSize,
    });
    if (dead.length === 0) return 0;

    // By id, so a row that was written or refreshed between the select and the
    // delete is not caught by a predicate that has since stopped describing it.
    const { count } = await this.prisma.uncommittedState.deleteMany({
      where: { id: { in: dead.map((row) => row.id) }, expiresAt: expiredAt(now) },
    });
    return count;
  }
}

/** A unique-index violation: the slot was created concurrently, not a fault. */
function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002';
}

/**
 * A foreign-key violation: the profile named by `findSelectable` moments ago
 * was removed before the write landed. Answered as `PROFILE_NOT_FOUND`, the
 * same refusal the up-front check would have given.
 */
function isForeignKeyViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2003';
}

function viewOf(row: StateRow): UncommittedStateView {
  return {
    id: row.id,
    studentProfileId: row.studentProfileId,
    kind: row.kind,
    scope: row.scope,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
