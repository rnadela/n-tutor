import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { PageImageState, SourceTestStatus } from '../generated/prisma/enums.js';
import { PROFILE_NOT_FOUND, StudentProfileService } from '../identity/student-profile.service.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { PageIngestService, UnsupportedImageFormat } from './page-ingest.service.js';
import {
  MAX_PAGES,
  NO_PAGES_TO_SUBMIT,
  PAGE_LIMIT_REACHED,
  PAGE_NOT_FOUND,
  PageOrderMismatch,
  SOURCE_TEST_NOT_DRAFT,
  SOURCE_TEST_NOT_FOUND,
  UNSUPPORTED_IMAGE_FORMAT,
  canAddPage,
  canSubmit,
  expiryFrom,
  isExpired,
  liveAt,
  renumbered,
  reorderedOrThrow,
} from './source-test-policy.js';

/**
 * One page as every read path states it.
 *
 * There is no `storagePath` and no URL: stored image bytes are never served as
 * static files, and a path in a response body would be the first half of doing
 * exactly that. The dimensions and the byte size are the normalized ones — what
 * is stored, never what arrived.
 */
export interface PageImageView {
  id: string;
  ordinal: number;
  state: PageImageState;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  createdAt: string;
}

/** A Source Test as every read path states it, pages in stored order. */
export interface SourceTestView {
  id: string;
  studentProfileId: string;
  status: SourceTestStatus;
  createdAt: string;
  /** Creation plus the one TTL. Activity never moves it. */
  expiresAt: string;
  submittedAt: string | null;
  /** The ceiling, stated by the API so no figure is a literal in the web app. */
  maxPages: number;
  pages: PageImageView[];
}

const PAGE_FIELDS = {
  id: true,
  ordinal: true,
  state: true,
  width: true,
  height: true,
  byteSize: true,
  createdAt: true,
} as const;

const SOURCE_TEST_FIELDS = {
  id: true,
  studentProfileId: true,
  status: true,
  createdAt: true,
  expiresAt: true,
  submittedAt: true,
} as const;

/**
 * How many times an add re-reads the page count after losing the ordinal race.
 * Small on purpose: two parallel taps is the case this exists for, and a number
 * large enough to mask real contention would only turn a fast conflict into a
 * slow one.
 */
const ORDINAL_CLAIM_ATTEMPTS = 3;

/**
 * Prisma's unique-constraint fault, identified by its code alone.
 *
 * Matched structurally rather than by `instanceof`: the generated client's
 * error classes are not stable to import across generator settings, and the
 * code is the part of the contract that is.
 */
function isUniqueViolation(cause: unknown): boolean {
  return (cause as { code?: unknown } | null)?.code === 'P2002';
}

interface SourceTestRow {
  id: string;
  studentProfileId: string;
  status: SourceTestStatus;
  createdAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
}

/**
 * Sole writer of SourceTest and PageImage, and the only caller of ingest
 * (AD-17).
 *
 * Four rules hold every method together:
 *
 * - The account comes from the caller — which took it from `req.elevated`, and
 *   never from a path or a body (AD-18). Every read and every write is scoped
 *   by it in the same query, so a foreign or unknown id matches nothing: a 404,
 *   never a 403, which would confirm the row exists somewhere.
 * - An expired draft is invisible to every read. It is *not* deleted here —
 *   the sweeper and the deletion semantics are Epic 8's — so expiry is a filter
 *   this module applies, not a destruction it performs.
 * - A `PageImage` row exists before any byte does, and its path comes from its
 *   own id (AD-15). Ingest completes before it leaves `Uploading` (AD-28).
 * - Ordinals are contiguous `1..N` at every committed transaction boundary.
 *   Reorder and delete rewrite them inside one transaction and never re-read,
 *   re-encode or re-write a single stored byte.
 *
 * Nothing here charges an Upload Allowance, runs a legibility check, or assigns
 * a Subject: those are Stories 3.3 and 3.4.
 */
@Injectable()
export class SourceTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: PageIngestService,
    private readonly students: StudentProfileService,
  ) {}

  // --- Reads -------------------------------------------------------------

  /**
   * The account's live draft for one child, opened if there is not one.
   *
   * Open-or-resume rather than create-always: a parent who reloaded the capture
   * screen must land back on the pages they have already taken, and a second
   * draft per child would be a silent way to strand the first.
   */
  async openDraft(parentAccountId: string, studentProfileId: string): Promise<SourceTestView> {
    // Ownership of the child is established through `identity`'s sole writer,
    // never through a Prisma delegate of this module's own (AD-17). An
    // archived, unknown or foreign profile is a 404 there, as it is here.
    const profile = await this.students.findSelectable(parentAccountId, studentProfileId);
    if (profile === null) throw new NotFoundException(PROFILE_NOT_FOUND);

    const now = new Date();
    const existing = await this.prisma.sourceTest.findFirst({
      where: {
        parentAccountId,
        studentProfileId,
        status: 'Draft',
        expiresAt: liveAt(now),
      },
      select: SOURCE_TEST_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.viewOf(existing);

    try {
      const created = await this.prisma.sourceTest.create({
        data: {
          parentAccountId,
          studentProfileId,
          // Both from the same instant, so `expiresAt` really is `createdAt`
          // plus the TTL rather than that plus however long the INSERT took.
          // Letting the column default to the database clock would make the two
          // disagree by a few milliseconds, and the rule is stated as an
          // equality.
          createdAt: now,
          // Written once, from the row's own creation instant, and never moved.
          expiresAt: expiryFrom(now),
        },
        select: SOURCE_TEST_FIELDS,
      });
      return this.viewOf(created);
    } catch (cause) {
      // A double-tap, or a second tab. The partial unique index on
      // (parentAccountId, studentProfileId) WHERE status = 'Draft' is what makes
      // "one draft per child" true rather than intended; losing the race is not
      // an error, it is the other request having already opened the draft this
      // one was about to. Without the index the loser would open a *second*
      // draft and the read's `orderBy createdAt desc` would silently strand the
      // first one, pages and all.
      if (!isUniqueViolation(cause)) throw cause;
      const raced = await this.prisma.sourceTest.findFirst({
        where: {
          parentAccountId,
          studentProfileId,
          status: 'Draft',
          expiresAt: liveAt(new Date()),
        },
        select: SOURCE_TEST_FIELDS,
        orderBy: { createdAt: 'desc' },
      });
      // The winner raced ahead of us and is gone again by the time we look —
      // submitted, expired, or removed between the collision and this read. A
      // legitimate race outcome, not a fault: answer the same 404 a vanished
      // draft always does, rather than leaking the raw constraint-violation
      // error this catch block exists to translate away from.
      if (raced === null) throw new NotFoundException(SOURCE_TEST_NOT_FOUND);
      return this.viewOf(raced);
    }
  }

  /** One Source Test, draft or submitted, with its pages in stored order. */
  async read(parentAccountId: string, sourceTestId: string): Promise<SourceTestView> {
    return this.viewOf(await this.requireLive(parentAccountId, sourceTestId));
  }

  // --- Writes ------------------------------------------------------------

  /**
   * Appends one page.
   *
   * The order is the whole of AD-15 and AD-28 made sequential: the limit is
   * checked and the row INSERTed in `Uploading` **before any byte is written**;
   * ingest then sniffs, rotates and re-encodes; only then is the row promoted
   * to `Ready` with the path its own id derives. A failure anywhere after the
   * INSERT removes the row and whatever bytes reached disk, so no `Ready` row
   * and no orphan ever survives the failure path.
   */
  async addPage(
    parentAccountId: string,
    sourceTestId: string,
    buffer: Buffer,
  ): Promise<SourceTestView> {
    await this.requireDraft(parentAccountId, sourceTestId);

    const page = await this.claimOrdinal(sourceTestId);

    try {
      await this.storeBytes(page.id, buffer);
    } catch (cause) {
      // The row was the authority; it must not outlive the bytes it stood for.
      await this.discardPage(page.id);
      throw this.ingestFailure(cause);
    }

    return this.read(parentAccountId, sourceTestId);
  }

  /**
   * Replaces one page's bytes, leaving its ordinal and every sibling row
   * exactly as they were.
   *
   * Ingest runs before anything is written, so a retake that turns out to be
   * unreadable leaves the page the parent already had intact rather than
   * destroying it in favour of nothing.
   */
  async retakePage(
    parentAccountId: string,
    sourceTestId: string,
    pageId: string,
    buffer: Buffer,
  ): Promise<SourceTestView> {
    await this.requireDraft(parentAccountId, sourceTestId);
    const page = await this.prisma.pageImage.findFirst({
      where: { id: pageId, sourceTestId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException(PAGE_NOT_FOUND);

    try {
      await this.storeBytes(page.id, buffer);
    } catch (cause) {
      // Nothing is removed: the page that was already there is still the page.
      throw this.ingestFailure(cause);
    }
    return this.read(parentAccountId, sourceTestId);
  }

  /**
   * Removes one page and renumbers the survivors, without touching their bytes.
   *
   * The transaction writes exactly two things: the row is deleted, and every
   * surviving row's `ordinal` is rewritten. No `storagePath`, no `mimeType` and
   * no dimension is read or written, so "renumbers without reprocessing" is a
   * property of the statement rather than a claim about it.
   */
  async deletePage(parentAccountId: string, sourceTestId: string, pageId: string): Promise<void> {
    await this.requireDraft(parentAccountId, sourceTestId);

    const removed = await this.prisma.withTransaction(async (tx) => {
      const deleted = await tx.pageImage.deleteMany({ where: { id: pageId, sourceTestId } });
      if (deleted.count !== 1) throw new NotFoundException(PAGE_NOT_FOUND);
      const survivors = await tx.pageImage.findMany({
        where: { sourceTestId },
        select: { id: true },
        orderBy: { ordinal: 'asc' },
      });
      await this.rewriteOrdinals(
        tx,
        sourceTestId,
        survivors.map((survivor) => survivor.id),
      );
      return pageId;
    });

    // Only once the row is certainly gone: bytes removed before a transaction
    // that then rolled back would leave a `Ready` row pointing at nothing.
    //
    // Nothing is read back: the route answers 204 and the client re-reads for
    // itself, so a view built here would be two queries nobody consumes.
    await this.ingest.remove(removed);
  }

  /**
   * Applies an explicit permutation of the stored page ids.
   *
   * The client computes the move and sends the whole resulting order; a body
   * that is not a permutation of exactly the stored ids is rejected whole and
   * never partially applied. The server keeps no direction vocabulary of its
   * own, so there is nothing here that could drift out of step with the strip.
   */
  async reorderPages(
    parentAccountId: string,
    sourceTestId: string,
    pageIds: readonly string[],
  ): Promise<SourceTestView> {
    await this.requireDraft(parentAccountId, sourceTestId);

    await this.prisma.withTransaction(async (tx) => {
      const stored = await tx.pageImage.findMany({
        where: { sourceTestId },
        select: { id: true },
        orderBy: { ordinal: 'asc' },
      });
      let ordered: string[];
      try {
        ordered = reorderedOrThrow(
          stored.map((page) => page.id),
          pageIds,
        );
      } catch (cause) {
        if (cause instanceof PageOrderMismatch) throw new BadRequestException(cause.message);
        throw cause;
      }
      await this.rewriteOrdinals(tx, sourceTestId, ordered);
    });

    return this.read(parentAccountId, sourceTestId);
  }

  /**
   * Submits the draft, refusing while no page has actually landed.
   *
   * The count is of `Ready` rows alone, and the distinction is the whole point:
   * a row stranded in `Uploading` has a null `storagePath` and no bytes behind
   * it, so counting it would let a byte-less page through to the legibility
   * check and the Extraction that follow. The 10-page ceiling counts every row
   * including `Uploading` — that one is a race guard and must stay pessimistic
   * — but the submit gate is an assertion about what exists, and an `Uploading`
   * row is precisely a page that does not yet.
   *
   * The refusal is the control; the disabled button on the strip is a courtesy
   * that a direct call simply does not have to respect. The count and the
   * status change share one transaction, so a page deleted concurrently cannot
   * slip between them and produce a Submitted Source Test with no pages.
   */
  async submit(parentAccountId: string, sourceTestId: string): Promise<SourceTestView> {
    await this.requireDraft(parentAccountId, sourceTestId);

    await this.prisma.withTransaction(async (tx) => {
      const count = await tx.pageImage.count({ where: { sourceTestId, state: 'Ready' } });
      if (!canSubmit(count)) throw new BadRequestException(NO_PAGES_TO_SUBMIT);
      const written = await tx.sourceTest.updateMany({
        // Account-scoped and state-guarded in the statement that writes: a
        // concurrent submit matches nothing here, so the first one stands.
        where: { id: sourceTestId, parentAccountId, status: 'Draft' },
        data: { status: 'Submitted', submittedAt: new Date() },
      });
      if (written.count !== 1) throw new ConflictException(SOURCE_TEST_NOT_DRAFT);
    });

    return this.read(parentAccountId, sourceTestId);
  }

  // --- Internals ---------------------------------------------------------

  /**
   * The two-phase ordinal rewrite `@@unique([sourceTestId, ordinal])` forces.
   *
   * A straight rewrite collides mid-statement — moving page B from 2 to 1 hits
   * the row still sitting at 1 — so every ordinal is first moved out of the
   * positive range in one statement, then written back as `1..N`. Both phases
   * are inside the caller's transaction, so no other reader ever observes the
   * negative interval and the contiguity invariant holds at every committed
   * boundary.
   */
  private async rewriteOrdinals(
    tx: TransactionClient,
    sourceTestId: string,
    orderedIds: readonly string[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    await tx.$executeRaw`UPDATE "page_image" SET "ordinal" = -"ordinal" WHERE "sourceTestId" = ${sourceTestId}`;
    for (const { id, ordinal } of renumbered(orderedIds)) {
      // `updateMany`, not `update`: a page removed between the read above and
      // this statement would make `update` throw Prisma's missing-row fault,
      // which would escape as a 500 rather than as this module's own answer.
      // `ordinal` alone: nothing about the stored bytes is in this statement.
      await tx.pageImage.updateMany({ where: { id, sourceTestId }, data: { ordinal } });
    }
  }

  /**
   * Takes the next ordinal, checking the ceiling in the same transaction that
   * writes — so the limit is part of the statement that creates rather than a
   * check made just before it.
   *
   * Under Read Committed two concurrent adds both read the same count and both
   * insert `count + 1`; the unique index rejects the loser, and the loser has
   * simply read a stale count rather than hit the ceiling, so it re-reads and
   * tries again. Past a small number of attempts the contention is no longer
   * plausible as a race and the documented conflict is the honest answer — what
   * must never happen is a raw Prisma fault escaping as a 500.
   */
  private async claimOrdinal(sourceTestId: string): Promise<{ id: string }> {
    for (let attempt = 0; attempt < ORDINAL_CLAIM_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.withTransaction(async (tx) => {
          const count = await tx.pageImage.count({ where: { sourceTestId } });
          if (!canAddPage(count)) throw new ConflictException(PAGE_LIMIT_REACHED);
          return tx.pageImage.create({
            data: { sourceTestId, ordinal: count + 1 },
            select: { id: true },
          });
        });
      } catch (cause) {
        if (!isUniqueViolation(cause)) throw cause;
      }
    }
    throw new ConflictException(PAGE_LIMIT_REACHED);
  }

  /** Ingest, then the write, then the promotion out of `Uploading` (AD-28). */
  private async storeBytes(pageId: string, buffer: Buffer): Promise<void> {
    const normalized = await this.ingest.normalize(buffer, UNSUPPORTED_IMAGE_FORMAT);
    const storagePath = await this.ingest.write(pageId, normalized.buffer);
    await this.prisma.pageImage.update({
      where: { id: pageId },
      data: {
        state: 'Ready',
        storagePath,
        mimeType: normalized.mimeType,
        width: normalized.width,
        height: normalized.height,
        byteSize: normalized.byteSize,
      },
    });
  }

  /** The failure path's clean-up: the row, then whatever bytes reached disk. */
  private async discardPage(pageId: string): Promise<void> {
    await this.prisma.pageImage.deleteMany({ where: { id: pageId } });
    await this.ingest.remove(pageId);
  }

  /**
   * Ingest's own rejection becomes the 415 the matrix names; anything else is
   * a fault and is re-thrown untouched rather than reported as a bad photo.
   */
  private ingestFailure(cause: unknown): unknown {
    if (cause instanceof UnsupportedImageFormat) {
      return new UnsupportedMediaTypeException(cause.message);
    }
    return cause;
  }

  /**
   * The Source Test, whatever its status, provided it is this account's and has
   * not expired. Expiry answers the same 404 an unknown id does: a parent whose
   * draft is over is returned to the start of the flow, not told about a row.
   */
  private async requireLive(parentAccountId: string, id: string): Promise<SourceTestRow> {
    const row = await this.prisma.sourceTest.findFirst({
      where: { id, parentAccountId },
      select: SOURCE_TEST_FIELDS,
    });
    if (!row || isExpired(row, new Date())) throw new NotFoundException(SOURCE_TEST_NOT_FOUND);
    return row;
  }

  /** The same, plus the one state page management is allowed to act on. */
  private async requireDraft(parentAccountId: string, id: string): Promise<SourceTestRow> {
    const row = await this.requireLive(parentAccountId, id);
    if (row.status !== 'Draft') throw new ConflictException(SOURCE_TEST_NOT_DRAFT);
    return row;
  }

  private async viewOf(row: SourceTestRow): Promise<SourceTestView> {
    const pages = await this.prisma.pageImage.findMany({
      where: { sourceTestId: row.id },
      select: PAGE_FIELDS,
      orderBy: { ordinal: 'asc' },
    });
    return {
      id: row.id,
      studentProfileId: row.studentProfileId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      maxPages: MAX_PAGES,
      pages: pages.map((page) => ({
        id: page.id,
        ordinal: page.ordinal,
        state: page.state,
        width: page.width,
        height: page.height,
        byteSize: page.byteSize,
        createdAt: page.createdAt.toISOString(),
      })),
    };
  }
}
