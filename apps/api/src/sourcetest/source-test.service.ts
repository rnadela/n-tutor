import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
  forwardRef,
} from '@nestjs/common';
import { ExtractionService } from '../extraction/extraction.service.js';
import { TaxonomyService, type TaxonomyItem } from '../admin/taxonomy.service.js';
import type { PageImageState, SourceTestStatus } from '../generated/prisma/enums.js';
import {
  GRADE_LEVEL_NOT_SELECTABLE,
  PROFILE_NOT_FOUND,
  StudentProfileService,
} from '../identity/student-profile.service.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { PageIngestService, UnsupportedImageFormat } from './page-ingest.service.js';
import type { PageBytes, SourceTestReader } from './source-test-reader.js';
import {
  CLASSIFICATION_REQUIRED,
  MAX_PAGES,
  NO_PAGES_TO_SUBMIT,
  NOTHING_TO_CLASSIFY,
  PAGE_LIMIT_REACHED,
  PAGE_NOT_FOUND,
  PageOrderMismatch,
  SOURCE_TEST_NOT_DRAFT,
  SOURCE_TEST_NOT_FOUND,
  STORED_MIME,
  SUBJECT_NOT_AVAILABLE,
  UNSUPPORTED_IMAGE_FORMAT,
  canAddPage,
  canSubmit,
  expiryFrom,
  isClassified,
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
  /**
   * The classification. Both are null until set — the Grade Level is seeded
   * from the Student Profile on open, so in practice only the Subject is — and
   * the names are resolved on read rather than stored, so an Admin rename
   * changes what this says without the row being written.
   */
  subjectId: string | null;
  subjectName: string | null;
  gradeLevelId: string | null;
  gradeLevelName: string | null;
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
  subjectId: true,
  gradeLevelId: true,
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

export interface SourceTestRow {
  id: string;
  studentProfileId: string;
  status: SourceTestStatus;
  createdAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  subjectId: string | null;
  gradeLevelId: string | null;
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
 * The classification obeys the same shape: a Subject and a Grade Level are held
 * as ids, resolved on read through `admin`'s `TaxonomyService` and never copied
 * as labels — and this module never writes a taxonomy row.
 *
 * Nothing here charges an Upload Allowance or runs a legibility check: that is
 * Story 3.4.
 */
@Injectable()
export class SourceTestService implements SourceTestReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: PageIngestService,
    private readonly students: StudentProfileService,
    // The sole reader of the taxonomy tables (AD-17). Selectability is computed
    // there and re-derived nowhere.
    private readonly taxonomy: TaxonomyService,
    // A genuine cycle, expressed honestly: `submit` enqueues the Extraction
    // job, and the job reads this module's page bytes back. `forwardRef` is
    // Nest's sanctioned answer, and it keeps each table with exactly one
    // writer — the alternative is a Prisma delegate reach-across in one
    // direction or the other (AD-17).
    @Inject(forwardRef(() => ExtractionService))
    private readonly extraction: ExtractionService,
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
          // The default, not a copy of the child: the parent may override it
          // for this upload, and doing so never touches the Student Profile.
          // Seeded only here — the resume path above returns the stored
          // classification untouched, so a draft whose Grade Level was already
          // changed is never quietly put back to the child's.
          gradeLevelId: profile.gradeLevelId,
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

  /**
   * The Subjects offered for a Grade Level, straight from the taxonomy.
   *
   * A delegation and nothing more: the three-flag conjunction, the 404 for an
   * unknown Grade Level and the empty list for a disabled one are all
   * `listSelectableSubjects`'s, computed there and nowhere else. Restating any
   * part of that rule here would be the second reader AD-17 forbids.
   *
   * Not account-scoped, because the taxonomy is not: it is the same catalogue
   * for every parent, exactly as `GET /parent/grade-levels` is. The elevation
   * guard still stands in front of the route.
   */
  async listSubjectsFor(gradeLevelId: string): Promise<TaxonomyItem[]> {
    return this.taxonomy.listSelectableSubjects(gradeLevelId);
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
   * Sets the Subject, the Grade Level, or both.
   *
   * Availability is a property of the **pair**, so the patch is resolved to the
   * single `(subjectId, gradeLevelId)` the row will hold afterwards and that
   * pair is what is validated. Field-by-field checking would let
   * `{ subjectId: X, gradeLevelId: Y }` through whenever X happened to be
   * offered for the *old* Y.
   *
   * A Grade Level change that drops the stored Subject clears it rather than
   * refusing the whole write: refusing would strand a parent who picked the
   * wrong grade first, with no route that unsets a Subject to recover through.
   * The submit gate is what then keeps them honest.
   *
   * The validation reads rows and the write is a separate statement, so the
   * write is a compare-and-set against the exact pair the validation saw: two
   * overlapping patches could otherwise each validate against the pre-write
   * state and leave a pair neither of them ever validated together — A setting
   * Subject S against GL1 while B moves the row to GL2, which does not offer S.
   * A lost race re-reads and re-validates once against what is now stored, and
   * only then gives up.
   */
  async classify(
    parentAccountId: string,
    sourceTestId: string,
    patch: { subjectId?: string; gradeLevelId?: string },
  ): Promise<SourceTestView> {
    // One retry and no more: a second lost race is contention no parent is
    // producing by hand, and a bounded attempt cannot spin.
    if (await this.tryClassify(parentAccountId, sourceTestId, patch)) {
      return this.read(parentAccountId, sourceTestId);
    }
    if (await this.tryClassify(parentAccountId, sourceTestId, patch)) {
      return this.read(parentAccountId, sourceTestId);
    }
    throw new ConflictException(SOURCE_TEST_NOT_DRAFT);
  }

  /**
   * One read-validate-write attempt. `false` means only that the row moved
   * underneath it — every refusal the patch itself earns is thrown from here
   * and never retried.
   */
  private async tryClassify(
    parentAccountId: string,
    sourceTestId: string,
    patch: { subjectId?: string; gradeLevelId?: string },
  ): Promise<boolean> {
    const row = await this.requireDraft(parentAccountId, sourceTestId);

    // `!= null` rather than `!== undefined`: `@IsOptional()` skips a null as
    // well as an absent value, so `{ subjectId: null }` reaches here having
    // been validated against nothing. It is not an unset route — there is no
    // way to clear a Subject by hand — so it means the same as sending
    // nothing at all.
    const changesGradeLevel = patch.gradeLevelId != null;
    const changesSubject = patch.subjectId != null;
    // "Neither field was sent" is a statement about the patch as a whole, which
    // is why it is here and not a per-property validator.
    if (!changesGradeLevel && !changesSubject) {
      throw new BadRequestException(NOTHING_TO_CLASSIFY);
    }

    // The Grade Level the row will hold after this write — the one the Subject
    // has to be offered for.
    const gradeLevelId = changesGradeLevel ? patch.gradeLevelId! : row.gradeLevelId;
    if (changesGradeLevel) {
      // Unknown is 404 and disabled is 400, raised exactly as
      // `identity`'s own `requireSelectableGradeLevel` splits them, against the
      // same exported sentence.
      const gradeLevel = await this.taxonomy.resolveGradeLevel(gradeLevelId!);
      if (!gradeLevel.enabled) throw new BadRequestException(GRADE_LEVEL_NOT_SELECTABLE);
    }

    const subjectId = await this.resultingSubject({
      storedSubjectId: row.subjectId,
      requestedSubjectId: changesSubject ? patch.subjectId! : null,
      gradeLevelId,
      gradeLevelChanged: changesGradeLevel,
    });

    const written = await this.prisma.sourceTest.updateMany({
      // Account-scoped and state-guarded in the statement that writes, like
      // every other mutation here: a Source Test submitted between the check
      // above and this line matches nothing.
      //
      // And compare-and-set on the classification itself: the pair validated
      // above is the pair this matches, so a concurrent patch that moved either
      // half lands zero rows here rather than a pair nothing validated.
      where: {
        id: sourceTestId,
        parentAccountId,
        status: 'Draft',
        subjectId: row.subjectId,
        gradeLevelId: row.gradeLevelId,
      },
      data: { subjectId, gradeLevelId },
    });
    return written.count === 1;
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
   * The classification is the second gate, and it asserts non-null alone: the
   * Subject and the Grade Level must both be set, and neither is re-checked for
   * enablement, so an Admin disabling one afterwards never invalidates a
   * parent's finished work.
   *
   * The refusal is the control; the disabled button on the strip is a courtesy
   * that a direct call simply does not have to respect. Both checks and the
   * status change share one transaction, so nothing deleted or cleared
   * concurrently can slip between them and produce a Submitted Source Test with
   * no pages or no classification.
   */
  async submit(parentAccountId: string, sourceTestId: string): Promise<SourceTestView> {
    await this.requireDraft(parentAccountId, sourceTestId);

    await this.prisma.withTransaction(async (tx) => {
      const count = await tx.pageImage.count({ where: { sourceTestId, state: 'Ready' } });
      if (!canSubmit(count)) throw new BadRequestException(NO_PAGES_TO_SUBMIT);
      // Read inside the same transaction as the count and the status change,
      // for the same reason: a classification cleared concurrently must not
      // slip between the check and the write. Non-null is the whole assertion
      // — enablement is deliberately never re-checked, so an Admin disabling a
      // Subject cannot invalidate a parent's finished work.
      const classification = await tx.sourceTest.findUniqueOrThrow({
        where: { id: sourceTestId },
        select: { subjectId: true, gradeLevelId: true },
      });
      if (!isClassified(classification)) throw new BadRequestException(CLASSIFICATION_REQUIRED);
      const written = await tx.sourceTest.updateMany({
        // Account-scoped and state-guarded in the statement that writes: a
        // concurrent submit matches nothing here, so the first one stands.
        //
        // The classification gate is repeated as a where-clause rather than
        // left to the read above, so the assertion is made by the statement
        // that writes: a classify committing between the two cannot produce a
        // Submitted row whose classification was being cleared. Non-null only,
        // never enabled — that is the whole rule.
        where: {
          id: sourceTestId,
          parentAccountId,
          status: 'Draft',
          subjectId: { not: null },
          gradeLevelId: { not: null },
        },
        data: { status: 'Submitted', submittedAt: new Date() },
      });
      if (written.count !== 1) throw new ConflictException(SOURCE_TEST_NOT_DRAFT);
      // Inside, not after (AD-5). The job row and the status change are one
      // transaction, so a Submitted Source Test with no Extraction job is
      // unreachable and a refused submit — the page gate, the classification
      // gate, the concurrent-submit conflict above — leaves no job behind.
      await this.extraction.enqueue(tx, sourceTestId);
    });

    return this.read(parentAccountId, sourceTestId);
  }

  /**
   * Every `Ready` page's stored bytes, in ordinal order.
   *
   * This is how the Extraction job reaches the images, and it is deliberately
   * the *only* way: `extraction` holds no Prisma delegate for `page_image` and
   * derives no storage path of its own (AD-17, AD-15). What it gets back is
   * buffers and ordinals — never a path, for the same reason `PAGE_FIELDS`
   * excludes one.
   *
   * `Ready` alone, like the submit gate: an `Uploading` row has a null
   * `storagePath` and no bytes behind it, so including it would send the model
   * a page that does not exist yet.
   *
   * No account parameter: the caller is the job, which has already been
   * enqueued against a Source Test this module admitted. Ownership is proven
   * once, at the boundary, and not re-asserted by a byte read that has no
   * principal to assert it against.
   */
  async readPageBytes(sourceTestId: string): Promise<PageBytes[]> {
    const pages = await this.prisma.pageImage.findMany({
      where: { sourceTestId, state: 'Ready' },
      select: { id: true, ordinal: true, mimeType: true },
      orderBy: { ordinal: 'asc' },
    });
    return Promise.all(
      pages.map(async (page) => ({
        ordinal: page.ordinal,
        buffer: await this.ingest.read(page.id),
        // Everything that left ingest is JPEG (AD-28); the stored column is
        // read anyway rather than assumed, and falls back to the one format
        // ingest can produce.
        mimeType: page.mimeType ?? STORED_MIME,
      })),
    );
  }

  // --- Internals ---------------------------------------------------------

  /**
   * The Subject the row will hold, against the Grade Level it will hold.
   *
   * Two reachable cases — `tryClassify` already refuses a patch that moves
   * neither field with `NOTHING_TO_CLASSIFY`, so this is never called with
   * both `requestedSubjectId === null` and `gradeLevelChanged === false`:
   *
   * - A Subject was sent: it must be among the ones offered for the resulting
   *   Grade Level, or the whole request is refused and nothing is written. A
   *   resulting Grade Level of null offers nothing, so a Subject cannot be set
   *   before one is.
   * - Only the Grade Level moved: the stored Subject is kept if the new Grade
   *   Level still offers it and cleared if it does not, so the parent re-chooses
   *   from a list that is actually true.
   */
  private async resultingSubject(resolution: {
    storedSubjectId: string | null;
    requestedSubjectId: string | null;
    gradeLevelId: string | null;
    gradeLevelChanged: boolean;
  }): Promise<string | null> {
    const { storedSubjectId, requestedSubjectId, gradeLevelId, gradeLevelChanged } = resolution;

    if (requestedSubjectId !== null) {
      // The same split the Grade Level gets: a uuid naming no Subject row at
      // all is a 404 raised by `resolveSubject` itself, and only a Subject that
      // exists but is not offered here is the 400 below. Collapsing the two
      // would answer "not available for that grade level" about a row that is
      // not a Subject anywhere.
      await this.taxonomy.resolveSubject(requestedSubjectId);
      if (gradeLevelId === null) throw new BadRequestException(SUBJECT_NOT_AVAILABLE);
      if (!(await this.isSubjectOffered(requestedSubjectId, gradeLevelId))) {
        throw new BadRequestException(SUBJECT_NOT_AVAILABLE);
      }
      return requestedSubjectId;
    }

    if (!gradeLevelChanged || storedSubjectId === null) return storedSubjectId;

    return (await this.isSubjectOffered(storedSubjectId, gradeLevelId!)) ? storedSubjectId : null;
  }

  /**
   * Whether a Subject is offered for a Grade Level, asked of the one service
   * that knows — never re-derived from the three `enabled` flags here.
   */
  private async isSubjectOffered(subjectId: string, gradeLevelId: string): Promise<boolean> {
    const offered = await this.taxonomy.listSelectableSubjects(gradeLevelId);
    return offered.some((subject) => subject.id === subjectId);
  }

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
   * The Source Test as a committed-work reader sees it: this account's, and
   * expired only while it is still a draft.
   *
   * `expiresAt` is the uncommitted-capture TTL (AD-16) and submit deliberately
   * does not clear it, so honouring it here would make the Extraction status —
   * and everything Epic 4 reads through it — disappear 72 hours after the photo
   * was taken, for a stored document that is complete and is *designed* to
   * outlive its images. A Draft stays invisible once expired, because an
   * expired draft genuinely is over.
   */
  async requireReadable(parentAccountId: string, id: string): Promise<SourceTestRow> {
    const row = await this.prisma.sourceTest.findFirst({
      where: { id, parentAccountId },
      select: SOURCE_TEST_FIELDS,
    });
    if (!row) throw new NotFoundException(SOURCE_TEST_NOT_FOUND);
    if (row.status === 'Draft' && isExpired(row, new Date())) {
      throw new NotFoundException(SOURCE_TEST_NOT_FOUND);
    }
    return row;
  }

  /**
   * The Source Test, whatever its status, provided it is this account's and has
   * not expired. Expiry answers the same 404 an unknown id does: a parent whose
   * draft is over is returned to the start of the flow, not told about a row.
   */
  async requireLive(parentAccountId: string, id: string): Promise<SourceTestRow> {
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
    // The labels are resolved, never stored. `resolveSubject` and
    // `resolveGradeLevel` succeed for a disabled row on purpose, so a stored
    // reference always resolves and a later Admin disable changes the label
    // this reads and nothing else about the row.
    const [pages, subject, gradeLevel] = await Promise.all([
      this.prisma.pageImage.findMany({
        where: { sourceTestId: row.id },
        select: PAGE_FIELDS,
        orderBy: { ordinal: 'asc' },
      }),
      row.subjectId === null ? null : this.taxonomy.resolveSubject(row.subjectId),
      row.gradeLevelId === null ? null : this.taxonomy.resolveGradeLevel(row.gradeLevelId),
    ]);
    return {
      id: row.id,
      studentProfileId: row.studentProfileId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      subjectId: row.subjectId,
      subjectName: subject?.name ?? null,
      gradeLevelId: row.gradeLevelId,
      gradeLevelName: gradeLevel?.name ?? null,
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
