import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  forwardRef,
} from '@nestjs/common';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import { uploadAllowanceExhausted } from '../allowance/allowance-policy.js';
import { limitsFor } from '../allowance/tiers.js';
import { ParentAccountService } from '../identity/parent-account.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import { TaxonomyService, type TaxonomyItem } from '../admin/taxonomy.service.js';
import type {
  PageImageState,
  PageLegibility,
  SourceTestStatus,
} from '../generated/prisma/enums.js';
import {
  GRADE_LEVEL_NOT_SELECTABLE,
  PROFILE_NOT_FOUND,
  StudentProfileService,
} from '../identity/student-profile.service.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { PageExpiryService } from './page-expiry.service.js';
import { PageIngestService, UnsupportedImageFormat } from './page-ingest.service.js';
import type { PageBytes, SourceTestReader } from './source-test-reader.js';
import {
  LEGIBILITY_PROMPT,
  LEGIBILITY_SCHEMA_NAME,
  LegibilityPayload,
  LegibilityPayloadInvalid,
  fakeLegibilityPayload,
  validateLegibilityPayload,
} from './legibility.js';
import {
  CLASSIFICATION_REQUIRED,
  CLASSIFICATION_REQUIRED_FOR_CHECK,
  EXTRACTION_NOT_PERSISTED,
  LEGIBILITY_CHECK_FAILED,
  LEGIBILITY_CHECK_REQUIRED,
  MAX_PAGES,
  NO_PAGES_TO_SUBMIT,
  NOTHING_TO_CLASSIFY,
  PAGE_LIMIT_REACHED,
  PAGE_NOT_FOUND,
  PageOrderMismatch,
  SOURCE_TEST_NOT_DRAFT,
  SOURCE_TEST_NOT_FOUND,
  SOURCE_TEST_NOT_SUBMITTED,
  STORED_MIME,
  SUBJECT_NOT_AVAILABLE,
  UNSUPPORTED_IMAGE_FORMAT,
  canAddPage,
  canSubmit,
  expiryFrom,
  isChecked,
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
  /**
   * This page's own verdict from the one batch check (AD-29), or null while
   * the check has not run over the current page set. Per page, never a
   * whole-test pass/fail — the screen names the page it flags.
   */
  legibility: PageLegibility | null;
  createdAt: string;
  /**
   * When the FR-32 retention sweep removed this page's stored bytes, or null
   * while they are still there. The row states its own availability and the
   * date it changed — that is the whole of what the strip needs to say a
   * photograph is gone, and it is still not a path and still not a URL.
   */
  bytesDeletedAt: string | null;
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
  /**
   * When the one batch legibility check ran, or null while it has not. It is
   * the whole of the submit gate, so the screen reads it to know whether to
   * offer the commit control at all.
   */
  legibilityCheckedAt: string | null;
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
  legibility: true,
  createdAt: true,
  bytesDeletedAt: true,
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
  legibilityCheckedAt: true,
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
  legibilityCheckedAt: Date | null;
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
 * The legibility check is one batch over every `Ready` page, foreground and
 * in-request (AD-4, AD-29), run once and stored.
 *
 * The Upload Allowance is **enforced here**, in `submit` and nowhere else,
 * because `submit` is the one statement that charges one. The charge is still
 * the `Submitted` row and nothing else: usage stays derived (AD-14), counted by
 * `allowance` from committed rows in the window, so there is no counter column,
 * no charge write and no reset job to reconcile. Every other path on this
 * service — opening a draft, adding, reordering, retaking or deleting a page,
 * classifying, the legibility check — is uncapped and untouched by it.
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
    // The only way anything here reaches a provider (AD-17). This module hands
    // over a typed request and the prompt it owns; it never sees a client, a
    // model id, a retry policy or a cost row.
    private readonly ai: AiService,
    // The one routine that removes a page's stored bytes, whichever trigger
    // asked. No `forwardRef`: it depends on Prisma and `PageIngestService`
    // alone, so injecting it here adds no cycle — and re-typing its
    // unlink-then-mark sequence for the early deletion is precisely the defect
    // Epic 8 forbids.
    private readonly pageExpiry: PageExpiryService,
    // The account row `submit` locks while it checks the cap. `identity` owns
    // the lock idiom (`findByIdForUpdate`) and this module reuses it rather
    // than writing a second `SELECT … FOR UPDATE` of its own.
    private readonly accounts: ParentAccountService,
    // The period window, the tier's limit and the Upload count — all three of
    // them `allowance`'s, and none of them re-derived here. The dependency runs
    // `sourcetest -> allowance` only, so it needs no `forwardRef`.
    private readonly allowance: AllowanceService,
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

  /**
   * One Source Test, draft or submitted, with its pages in stored order.
   *
   * `requireReadable`, not `requireLive`: `expiresAt` is the *draft's* 72-hour
   * capture TTL and submit deliberately does not clear it, so honouring it here
   * would make every committed upload disappear three days after the photograph
   * was taken — for a stored document that is complete and is designed to
   * outlive its images. `ExtractionService.statusFor` already reads through the
   * same check for the same reason, and the surfaces that come back to an upload
   * in a later session (the generate route, the weak-area drill-down) read it
   * through here.
   *
   * An expired **draft** is still a 404, because an expired draft genuinely is
   * over — `requireReadable` keeps that, so nothing about a draft changes. The
   * write paths that tail-call this are unaffected either way: each has already
   * proved its own state through `requireDraft`, which is `requireLive` plus the
   * status check.
   */
  async read(parentAccountId: string, sourceTestId: string): Promise<SourceTestView> {
    return this.viewOf(await this.requireReadable(parentAccountId, sourceTestId));
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
      // The promotion to `Ready` and the check-clear are one transaction: the
      // page set the check ran over is no longer the page set that would be
      // committed, and a window in which the new page is `Ready` while
      // `legibilityCheckedAt` still stands is a window a concurrent `submit`
      // commits an unchecked page set through. A failed add clears nothing,
      // because the transaction never commits.
      await this.storeBytes(page.id, buffer, { parentAccountId, sourceTestId });
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
      // One transaction, for the reason `addPage` states: the ordinals did not
      // move, but the bytes under one verdict did — so the stored result
      // describes a photograph that no longer exists, and it must stop
      // standing at the same instant the new bytes start.
      await this.storeBytes(page.id, buffer, { parentAccountId, sourceTestId });
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
      // Inside the same transaction as the delete and the renumber: a Source
      // Test whose page set shrank but whose check survived would let a
      // submission through on a batch that no longer covers it.
      await this.clearCheck(parentAccountId, sourceTestId, tx);
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
   * Removes the photographs of a committed Source Test at the parent's request,
   * ahead of the 90-day clock (FR-33).
   *
   * The outcome is deliberately indistinguishable from an expiry, because it is
   * the same routine: `PageExpiryService` unlinks the bytes and marks each row
   * `Deleted` with `bytesDeletedAt` and a null `storagePath`, and the rows
   * survive so the strip can say which page is gone rather than showing a hole.
   * Nothing derived is touched — not the `SourceTest`, not the Extraction, and
   * not one Practice Test, Attempt, Explanation or Mastery value.
   *
   * The whole page set, never one page: the sweep's unit is the Source Test and
   * a second unit of deletion would be a second set of rules and a strip mixing
   * live and removed photographs by choice rather than by the clock. `deletePage`
   * above is a different action on a different object — it removes a *row* from
   * a draft and renumbers its siblings.
   *
   * Idempotent by construction: `expireNow` selects `Ready` rows, so a second
   * call finds none, unlinks nothing and re-dates nothing.
   *
   * No password and no PIN re-prompt: the elevation guard in front of the route
   * is the whole authorization, and it is the one destructive action in Epic 8
   * that is allowed that, because nothing derived is lost.
   */
  async deletePageImages(parentAccountId: string, sourceTestId: string): Promise<SourceTestView> {
    // `requireReadable`, never `requireLive`: `expiresAt` is the draft's 72-hour
    // capture TTL and submit does not clear it, so proving ownership against it
    // would 404 exactly the committed uploads this action exists for — every
    // one older than three days, which is all of them for most of the 90-day
    // window being shortened.
    const row = await this.requireReadable(parentAccountId, sourceTestId);

    // A draft's photographs are not removable early: they are the only copy of
    // work that has not been read yet, and the 72h TTL already owns them.
    if (row.status !== 'Submitted') throw new ConflictException(SOURCE_TEST_NOT_SUBMITTED);

    // The safety argument, checked rather than assumed. A `Queued` or `Running`
    // job has not stored anything yet, so deleting the images would destroy its
    // only input; a `Failed` retryable job could never be retried. The sweep
    // never meets this case — ninety days on, the job has long settled — so
    // this gate belongs to the early trigger alone.
    if (!(await this.extraction.hasPersistedExtraction(sourceTestId))) {
      throw new ConflictException(EXTRACTION_NOT_PERSISTED);
    }

    await this.pageExpiry.expireNow(sourceTestId, new Date());

    // Re-read through `requireReadable` by name rather than through `read()`,
    // so this answer cannot be changed by a future edit to which check that
    // method happens to use: a `requireLive` here would 404 the committed Source
    // Test this call has just emptied, every time its 72h draft `expiresAt` has
    // passed. The two are the same read today, and this one says why it must be.
    return this.viewOf(await this.requireReadable(parentAccountId, sourceTestId));
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
   * The one batch legibility check: every `Ready` page, one provider call,
   * foreground and in-request (AD-4, AD-29).
   *
   * It runs **once**. The verdicts and `legibilityCheckedAt` are stored, and a
   * second call answers with the stored result and makes no provider call —
   * which is what keeps the cost row count equal to the number of distinct
   * page sets checked rather than to the number of times a parent tapped.
   *
   * It charges no allowance, because it produces nothing (AD-29), and it
   * blocks nothing: `Low` is advisory and the submit gate never reads a
   * verdict.
   *
   * The whole payload is validated in code after the schema has had its say
   * (AD-30) and rejected whole on any fault, so a partial or invented verdict
   * is never stored and `legibilityCheckedAt` is never set over a page set the
   * model did not actually judge. Both the transport fault and the content
   * fault answer the same 503: from the parent's side they are one fact, the
   * check may be run again, and nothing was stored either way.
   *
   * A page set that moved while the provider call was in flight answers that
   * **same 503**, and the reason it must is the whole of this method's
   * contract: nothing was stored, so answering 200 would hand back a view with
   * `legibilityCheckedAt: null` under a response that says the check ran — and
   * the screen would announce "the pages were checked" over a check that never
   * happened. Every path here either stores the whole result or fails.
   */
  async checkLegibility(parentAccountId: string, sourceTestId: string): Promise<SourceTestView> {
    const row = await this.requireDraft(parentAccountId, sourceTestId);
    // The stored result, untouched and without a provider call. Answered
    // before the page read, so a repeat check costs one query rather than ten
    // file reads.
    if (isChecked(row)) return this.viewOf(row);

    // `Ready` alone, exactly as the submit gate counts: a row stranded in
    // `Uploading` holds no bytes, so judging it is not possible and counting it
    // would make the batch disagree with what gets committed.
    const pages = await this.readPageBytes(sourceTestId);
    if (pages.length === 0) throw new BadRequestException(NO_PAGES_TO_SUBMIT);
    // Asserted once there is a batch to price, not only before submit: the
    // disabled "Check pages" control is a courtesy the same way the disabled
    // submit control is, and a direct call must not be able to spend a
    // provider call on a Source Test the parent has not classified yet.
    if (!isClassified(row)) throw new BadRequestException(CLASSIFICATION_REQUIRED_FOR_CHECK);
    const ordinals = pages.map((page) => page.ordinal);
    // What the batch is a judgement *of*, captured before the call and
    // re-read inside the transaction that writes. Ordinals alone are not
    // enough: a retake leaves the ordinal set identical and replaces the bytes
    // under one of them, so the stamp carries `updatedAt` — which `storeBytes`
    // moves on every retake — and the row id, which an add or a delete moves.
    const stamp = await this.pageSetStamp(this.prisma, sourceTestId);

    let verdicts;
    try {
      const { payload } = await this.ai.run({
        callClass: 'Legibility',
        parentAccountId,
        // Stated, never defaulted: this is the call that looks at photographs.
        modality: 'vision',
        // Already in ordinal order, and sent that way, so the ordinal the
        // model answers under is the ordinal the page actually has.
        images: pages,
        prompt: LEGIBILITY_PROMPT,
        schema: LegibilityPayload,
        schemaName: LEGIBILITY_SCHEMA_NAME,
        // The fake's verdict is a function of each page's stored size, so the
        // builder closes over the bytes here rather than `ai` knowing what a
        // page is (AD-17, AD-22).
        fakePayload: fakeLegibilityPayload(pages),
      });
      verdicts = validateLegibilityPayload(payload, ordinals);
    } catch (cause) {
      throw this.checkFailure(cause);
    }

    const checkedAt = new Date();
    const stored = await this.prisma.withTransaction(async (tx) => {
      // The page set is re-asserted inside the transaction that writes: a page
      // added, retaken or deleted while the call was in flight means the batch
      // no longer covers what is stored, and attaching these verdicts to it
      // would file a judgement about bytes nobody looked at.
      //
      // The stamp rather than the ordinals, because a retake is invisible to
      // the ordinals: it replaces one page's bytes and leaves `1..N` exactly
      // as it was.
      if ((await this.pageSetStamp(tx, sourceTestId)) !== stamp) return false;

      const written = await tx.sourceTest.updateMany({
        // Account-scoped, state-guarded and compare-and-set on the check
        // itself, like every other write here: a draft that was submitted,
        // or already checked, under this call matches nothing and stores
        // nothing.
        where: { id: sourceTestId, parentAccountId, status: 'Draft', legibilityCheckedAt: null },
        data: { legibilityCheckedAt: checkedAt },
      });
      if (written.count !== 1) return false;

      for (const verdict of verdicts) {
        // `updateMany` and scoped by the Source Test, so a page removed under
        // this statement writes nothing rather than raising Prisma's
        // missing-row fault as a 500.
        await tx.pageImage.updateMany({
          where: { sourceTestId, ordinal: verdict.ordinal },
          data: { legibility: verdict.legibility },
        });
      }
      return true;
    });

    if (!stored) {
      // The write lost its compare-and-set, but that has two causes and only
      // one of them is a fault: a page added, retaken or deleted under the
      // call (a real staleness), or a concurrent call for the same page set
      // winning the race and storing first. The second case already holds the
      // exact verdicts this call would have written, so answering it as
      // checked is correct, not stale — and it is what stops the loser of the
      // race from paying for a provider call and then being told it failed.
      const current = await this.requireLive(parentAccountId, sourceTestId);
      if (isChecked(current)) return this.viewOf(current);
      // Nothing was stored, so nothing may be reported as checked. The same
      // retryable 503 every other nothing-was-stored path answers: the parent
      // runs the check again over the page set they now have.
      throw new ServiceUnavailableException(LEGIBILITY_CHECK_FAILED);
    }

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
   *
   * The Upload Allowance is the fourth gate, and it is last on purpose: the
   * three above are assertions about the draft and cost nothing to fail, while
   * this one takes a row lock on the account. A draft that was never
   * submittable must not queue behind another account's commit to be told so.
   */
  async submit(parentAccountId: string, sourceTestId: string): Promise<SourceTestView> {
    await this.requireDraft(parentAccountId, sourceTestId);

    // One instant for the whole commit: the window is resolved from it and the
    // row is stamped with it. Reading the clock twice would let a submit that
    // straddles a period boundary be counted against the window it started in
    // and stamped into the next one — an upload charged to nobody.
    const now = new Date();
    // Resolved before the transaction: it reads the account's zone history and
    // holding the lock across that read buys nothing. A zone change landing in
    // between moves the *next* boundary, never the running period (AD-27).
    const window = await this.allowance.windowFor(parentAccountId, now);

    await this.prisma.withTransaction(async (tx) => {
      const count = await tx.pageImage.count({ where: { sourceTestId, state: 'Ready' } });
      if (!canSubmit(count)) throw new BadRequestException(NO_PAGES_TO_SUBMIT);
      // Read inside the same transaction as the count and the status change,
      // for the same reason: a classification cleared concurrently must not
      // slip between the check and the write. Non-null is the whole assertion
      // — enablement is deliberately never re-checked, so an Admin disabling a
      // Subject cannot invalidate a parent's finished work.
      const gates = await tx.sourceTest.findUniqueOrThrow({
        where: { id: sourceTestId },
        select: { subjectId: true, gradeLevelId: true, legibilityCheckedAt: true },
      });
      if (!isClassified(gates)) throw new BadRequestException(CLASSIFICATION_REQUIRED);
      // The third gate, read in the same transaction for the same reason: a
      // page added concurrently clears the check, and a submission that
      // slipped between the read and the write would commit a page set the
      // check never covered. It asserts the check *ran* and nothing about what
      // it said — `Low` is a warning, never a refusal (AD-29).
      if (!isChecked(gates)) throw new BadRequestException(LEGIBILITY_CHECK_REQUIRED);
      // The fourth gate, and the only one that is about the account rather than
      // the draft. The lock is what closes the race the `explanation` charging
      // seam documented and could not close: under READ COMMITTED two commits
      // would otherwise read the same pre-charge usage and both write. One
      // account's commits are exactly what should serialise, and
      // `findByIdForUpdate` is `identity`'s existing idiom for it — no second
      // lock, and no application-level clamp.
      const account = await this.accounts.findByIdForUpdate(tx, parentAccountId);
      const limit = limitsFor(account.tier).upload;
      // `null` is unlimited: no count is issued and no figure is compared. The
      // row lock above is still taken — reading the tier is what decides this,
      // and the read is the lock — so an unlimited account pays for the lock
      // and for no count.
      if (limit !== null) {
        // The same method every surface reads its Upload usage through, issued
        // on this transaction's client so it runs behind the lock this
        // transaction holds. The lock is the whole of the correctness: under
        // READ COMMITTED every statement takes its own snapshot, so a count and
        // a write in one transaction see nothing consistent by themselves —
        // what serialises them is that no other commit for this account can be
        // between them. Committed rows plus `Upload` tombstones; a deleted
        // upload is not a refund (AD-14).
        const used = await this.allowance.uploadUsedIn(parentAccountId, window, tx);
        if (used >= limit) {
          throw new ConflictException(
            uploadAllowanceExhausted({
              tier: account.tier,
              used,
              limit,
              // The window's exclusive end *is* the reset instant, stated in
              // the zone the window was actually cut in.
              resetAt: window.end,
              timezone: window.timezone,
            }),
          );
        }
      }
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
          // The legibility gate joins the other two as a where-clause rather
          // than being left to the read above, so the assertion is made by the
          // statement that writes: a page added between the two cannot produce
          // a Submitted row whose check was being cleared.
          legibilityCheckedAt: { not: null },
        },
        // The instant the window was cut from, so the row always falls inside
        // the period it was just counted against.
        data: { status: 'Submitted', submittedAt: now },
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

  // --- Story 8.3: what this module contributes to a profile deletion -------

  /**
   * When each of this child's committed Source Tests was committed.
   *
   * The Upload charge is *derived* from exactly these instants (AD-14), so a
   * deletion has to collect them before the rows go: each one resolves to the
   * period window it fell in, and the tombstone written for that window keeps
   * the count honest once the row is gone. The *count* of them is `allowance`'s
   * own read of `submittedAt` under the AD-17 carve-out; the per-child
   * collection a deletion needs is this module's, and nothing else assembles
   * it.
   *
   * Drafts are excluded by the same condition `allowance`'s Upload count uses:
   * a draft was never committed, so it was never charged and leaves nothing
   * behind.
   *
   * `tx` is **not optional in practice**: the deletion reads this inside the same
   * transaction that deletes the rows, so a Source Test committed between the
   * collection and the commit is either seen here or not deleted there. Reading
   * it outside would leave a window in which an upload is charged, deleted, and
   * never tombstoned — a silent refund of the account's month.
   */
  async submittedInstantsFor(studentProfileId: string, tx?: TransactionClient): Promise<Date[]> {
    const rows = await (tx ?? this.prisma).sourceTest.findMany({
      where: { studentProfileId, status: 'Submitted', submittedAt: { not: null } },
      select: { submittedAt: true },
    });
    return rows.flatMap((row) => (row.submittedAt === null ? [] : [row.submittedAt]));
  }

  /**
   * Every page of this child that may still have bytes on disk.
   *
   * Ids alone, never paths: the caller hands them back to the one service that
   * unlinks, which derives the path from the id (AD-15). `Deleted` pages are
   * excluded because their bytes are already gone and their `storagePath` is
   * already null; `Uploading` ones are **not**, because a row can be left
   * mid-ingest with a file already written, and a file whose row is about to be
   * deleted is precisely the orphan §5.2 says does not exist.
   *
   * Read **twice** by the deletion: once outside the transaction, to know what to
   * unlink, and once inside it with `tx`, to prove nothing appeared in between. A
   * parent can photograph a page onto a Draft Source Test of the child they are
   * deleting while the deletion is in flight, and that page's row would cascade
   * away with its Source Test while its bytes stayed on disk.
   */
  async pageIdsFor(studentProfileId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await (tx ?? this.prisma).pageImage.findMany({
      where: { sourceTest: { studentProfileId }, state: { not: 'Deleted' } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** What this module would destroy, for the confirmation the parent reads. */
  async countsFor(studentProfileId: string): Promise<{ sourceTests: number; pageImages: number }> {
    const [sourceTests, pageImages] = await Promise.all([
      this.prisma.sourceTest.count({ where: { studentProfileId } }),
      this.prisma.pageImage.count({ where: { sourceTest: { studentProfileId } } }),
    ]);
    return { sourceTests, pageImages };
  }

  /**
   * Deletes every Source Test of this child, inside the caller's transaction.
   *
   * One statement, because everything hanging off a Source Test cascades from
   * it: its `PageImage` rows, its `ExtractionJob` and its `Extraction` with the
   * whole extracted tree. What does **not** cascade is what `Restrict` holds —
   * Practice Tests and Generation Jobs — so this raises rather than removing
   * them as a side effect, which is exactly why the caller purges those first.
   *
   * Profile-scoped and not account-scoped: the ownership check that decides
   * whether this may run at all lives in the deletion service, with the password
   * gate, and this stays a pure purge with no opinion about who asked.
   */
  async purgeForStudentProfile(tx: TransactionClient, studentProfileId: string): Promise<void> {
    await tx.sourceTest.deleteMany({ where: { studentProfileId } });
  }

  // --- Story 8.4: the same three, one level out (the whole account) --------

  /**
   * Every page of this **account** that may still have bytes on disk.
   *
   * `pageIdsFor` one level out, and matched on the Source Test's own
   * `parentAccountId` rather than on its child: an account deletion removes every
   * Source Test on the account, including any whose `studentProfileId` names a
   * child of somebody else's — which cannot happen, and would be a file left on
   * disk with no row if it did.
   *
   * Read **twice** by the account deletion, for the reason the profile one is:
   * once outside the transaction to know what to unlink, and once inside it with
   * `tx` to prove nothing was photographed onto a draft while the deletion was in
   * flight. Ids alone, never paths (AD-15).
   */
  async pageIdsForAccount(parentAccountId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await (tx ?? this.prisma).pageImage.findMany({
      where: { sourceTest: { parentAccountId }, state: { not: 'Deleted' } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** What this module would destroy with the whole account, for the confirmation. */
  async countsForAccount(
    parentAccountId: string,
  ): Promise<{ sourceTests: number; pageImages: number }> {
    const [sourceTests, pageImages] = await Promise.all([
      this.prisma.sourceTest.count({ where: { parentAccountId } }),
      this.prisma.pageImage.count({ where: { sourceTest: { parentAccountId } } }),
    ]);
    return { sourceTests, pageImages };
  }

  /**
   * Deletes every Source Test on this account, inside the caller's transaction.
   *
   * One statement for the same reason `purgeForStudentProfile` is one: everything
   * under a Source Test cascades from it, and what does not cascade is what
   * `Restrict` holds — Practice Tests and Generation Jobs — so this raises rather
   * than removing them as a side effect, which is why the caller purges those
   * first. The `Restrict` edge to `ParentAccount` is not weakened either: this is
   * the statement that frees it.
   *
   * No collection of charging instants beside it, unlike the profile path: an
   * account deletion writes no tombstone, because the tombstones cascade away
   * with the account row and there is no surviving account for a usage figure to
   * be about.
   */
  async purgeForAccountAllProfiles(tx: TransactionClient, parentAccountId: string): Promise<void> {
    await tx.sourceTest.deleteMany({ where: { parentAccountId } });
  }

  /**
   * The Subject label of each given Source Test, keyed by Source Test id.
   *
   * One `findMany` over the ids, then one `resolveSubject` per **distinct**
   * non-null subject id. Distinct Subjects across one child's released tests
   * are a handful, so this reuses the existing single-id taxonomy call rather
   * than adding a batch API to `admin` for a set that size.
   *
   * `resolveSubject` **throws** `NotFoundException` for an id it cannot find —
   * it never returns nullish — so each resolution is caught on its own and
   * recorded as `null`. One unresolvable Subject costs that row its label; it
   * must never cost the caller its whole read, on a route whose documented
   * contract is that it answers `[]` and never a refusal.
   *
   * Resolution keeps succeeding for a **disabled** Subject, because
   * `resolveSubject` is the read that succeeds for a disabled row: a stored
   * reference resolves for as long as it is stored, and a Subject retired
   * after a test was classified must not blank the label on work already done.
   *
   * An id this reader cannot see is simply **absent** from the map, which is
   * how a caller tells "no classification" (`null`) from "no such row".
   */
  async readSubjectLabels(sourceTestIds: readonly string[]): Promise<Map<string, string | null>> {
    const labels = new Map<string, string | null>();
    const ids = [...new Set(sourceTestIds)];
    if (ids.length === 0) return labels;

    const rows = await this.prisma.sourceTest.findMany({
      where: { id: { in: ids } },
      select: { id: true, subjectId: true },
    });

    const names = new Map<string, string | null>();
    const distinctSubjectIds = [
      ...new Set(rows.map((row) => row.subjectId).filter((id): id is string => id !== null)),
    ];
    // Resolved together rather than one `await` at a time: the list this
    // serves is one read, and a caller waiting on it should not pay for N
    // distinct Subjects sequentially when they resolve independently.
    const resolved = await Promise.all(
      distinctSubjectIds.map(async (subjectId) => {
        try {
          return { subjectId, name: (await this.taxonomy.resolveSubject(subjectId)).name };
        } catch (cause) {
          // Only the "no such Subject" refusal is absorbed: that one is a stored
          // id that no longer names a row, and the row it labels loses its label
          // while the list keeps every other one. A dropped connection or a bug
          // in the taxonomy read is neither of those — swallowing it would blank
          // a real Subject silently and say nothing about why, so it is rethrown
          // and the caller's read fails honestly.
          if (!(cause instanceof NotFoundException)) throw cause;
          return { subjectId, name: null };
        }
      }),
    );
    for (const { subjectId, name } of resolved) {
      names.set(subjectId, name);
    }

    for (const row of rows) {
      labels.set(row.id, row.subjectId === null ? null : (names.get(row.subjectId) ?? null));
    }
    return labels;
  }

  /**
   * The Subject id of each given Source Test, keyed by Source Test id.
   *
   * One statement and no taxonomy call: the column *is* the answer, so unlike
   * `readSubjectLabels` there is nothing to resolve, nothing that can throw and
   * nothing to degrade. A disabled Subject answers with its id unchanged, because a
   * stored reference resolves for as long as it is stored — a Subject retired after a
   * test was classified must not cost a child their Mastery history.
   *
   * Its caller is `grading`, through `practicetest`, on the canonicalization path:
   * AD-11's canonical Topic set is scoped by Subject, and a Subject *name* is not a
   * key. An id this reader cannot see is **absent** from the map, which is how the
   * caller tells "no classification" (`null`) from "no such row".
   */
  async readSubjectIds(sourceTestIds: readonly string[]): Promise<Map<string, string | null>> {
    const subjectIds = new Map<string, string | null>();
    const ids = [...new Set(sourceTestIds)];
    if (ids.length === 0) return subjectIds;

    const rows = await this.prisma.sourceTest.findMany({
      where: { id: { in: ids } },
      select: { id: true, subjectId: true },
    });
    for (const row of rows) {
      subjectIds.set(row.id, row.subjectId);
    }
    return subjectIds;
  }

  /**
   * The Grade Level name of each given Source Test, keyed by Source Test id.
   *
   * `readSubjectLabels`'s sibling, written the same way and for the same reason
   * (AD-17): the column is this module's and the *name* behind it is `admin`'s,
   * so a caller outside `sourcetest` reaches it through here rather than by
   * acquiring a `sourceTest` or a `gradeLevel` delegate of its own.
   *
   * Every rule above applies unchanged. `resolveGradeLevel` **throws** for an id
   * it cannot find, so each resolution is caught on its own and recorded as
   * `null`; one unresolvable Grade Level costs that row its label and must never
   * cost the caller its whole read. Resolution keeps succeeding for a **disabled**
   * Grade Level, because a stored reference resolves for as long as it is stored —
   * a grade retired after a test was classified must not blank the label on work
   * already done. An id this reader cannot see is **absent** from the map, which
   * is how a caller tells "no classification" from "no such row".
   *
   * Its one caller uses the label as a prompt instruction, so `null` there costs
   * the prompt a clause and nothing else.
   */
  async readGradeLevelLabels(
    sourceTestIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const labels = new Map<string, string | null>();
    const ids = [...new Set(sourceTestIds)];
    if (ids.length === 0) return labels;

    const rows = await this.prisma.sourceTest.findMany({
      where: { id: { in: ids } },
      select: { id: true, gradeLevelId: true },
    });

    const names = new Map<string, string | null>();
    const distinctGradeLevelIds = [
      ...new Set(rows.map((row) => row.gradeLevelId).filter((id): id is string => id !== null)),
    ];
    // Resolved together, for the reason the Subject labels are.
    const resolved = await Promise.all(
      distinctGradeLevelIds.map(async (gradeLevelId) => {
        try {
          return { gradeLevelId, name: (await this.taxonomy.resolveGradeLevel(gradeLevelId)).name };
        } catch (cause) {
          // Only the "no such Grade Level" refusal is absorbed; anything else is
          // rethrown, so a dropped connection never quietly blanks a real label.
          if (!(cause instanceof NotFoundException)) throw cause;
          return { gradeLevelId, name: null };
        }
      }),
    );
    for (const { gradeLevelId, name } of resolved) {
      names.set(gradeLevelId, name);
    }

    for (const row of rows) {
      labels.set(row.id, row.gradeLevelId === null ? null : (names.get(row.gradeLevelId) ?? null));
    }
    return labels;
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

  /**
   * What the stored `Ready` page set *is*, as one comparable string.
   *
   * The id and the ordinal catch an add, a delete and a reorder; `updatedAt`
   * catches a retake, which is the one mutation the other two are blind to —
   * it replaces a page's bytes and leaves `1..N` exactly as it was, so a
   * comparison on ordinals alone would call the set unchanged and let a
   * verdict be filed against bytes nobody judged.
   *
   * A string rather than a structure because the only thing ever done with it
   * is `!==` across a provider call, and a structural compare would be a
   * second way of saying the same thing.
   */
  private async pageSetStamp(
    client: TransactionClient | PrismaService,
    sourceTestId: string,
  ): Promise<string> {
    const pages = await client.pageImage.findMany({
      where: { sourceTestId, state: 'Ready' },
      select: { id: true, ordinal: true, updatedAt: true },
      orderBy: { ordinal: 'asc' },
    });
    return pages.map((page) => `${page.id}:${page.ordinal}:${page.updatedAt.getTime()}`).join('|');
  }

  /**
   * Ingest, then the write, then the promotion out of `Uploading` (AD-28).
   *
   * `clearCheckFor` promotes the row and forgets the stored check in **one
   * transaction**, and the two callers that pass it — `addPage` and
   * `retakePage` — need that atomicity rather than tidiness: clearing in a
   * transaction of its own leaves a window in which the new or retaken page is
   * already `Ready` and `legibilityCheckedAt` is still set, and a `submit`
   * landing inside it passes both the in-transaction read gate and the
   * `updateMany` where-clause and commits a page set the check never covered.
   * `deletePage` already clears inside its own transaction for the same
   * reason.
   */
  private async storeBytes(
    pageId: string,
    buffer: Buffer,
    clearCheckFor?: { parentAccountId: string; sourceTestId: string },
  ): Promise<void> {
    const normalized = await this.ingest.normalize(buffer, UNSUPPORTED_IMAGE_FORMAT);
    const storagePath = await this.ingest.write(pageId, normalized.buffer);
    await this.prisma.withTransaction(async (tx) => {
      await tx.pageImage.update({
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
      if (clearCheckFor) {
        await this.clearCheck(clearCheckFor.parentAccountId, clearCheckFor.sourceTestId, tx);
      }
    });
  }

  /**
   * Forgets the stored check: `legibilityCheckedAt` and every page's verdict,
   * in one transaction so neither can survive the other.
   *
   * Called by the three page-set mutations and by none of the others.
   * `reorderPages` deliberately does not call it: the verdicts hang off the
   * `PageImage` rows, so moving ordinals moves the verdicts with them and the
   * batch still covers exactly the pages it ran over. Adding or deleting
   * changes the set, and a retake changes the bytes under a verdict — in all
   * three the stored result no longer describes what would be committed.
   *
   * Account-scoped and `Draft`-guarded in the statements that write, like
   * every other mutation in this module: a Source Test submitted or moved
   * under the caller matches nothing, rather than having a committed upload's
   * verdicts quietly wiped by a write that never checked whose it was.
   *
   * `legibilityCheckedAt: { not: null }` is in the where-clause for a reason
   * beyond tidiness. This now runs inside the transaction that promotes a page
   * to `Ready`, so an unconditional write would take a row lock on the Source
   * Test for **every** add — and several pages added at once would serialize
   * on it, each waiting out the one before inside an interactive transaction.
   * Guarded, an unchecked draft matches no row, takes no lock, and concurrent
   * adds stay concurrent; a checked one serializes, which is correct and is
   * the rare case. The verdicts and the instant are only ever written together
   * (`checkLegibility` stores both in one transaction), so "no instant" and
   * "no verdicts" are the same state and skipping both is exact.
   */
  private async clearCheck(
    parentAccountId: string,
    sourceTestId: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const run = async (client: TransactionClient | PrismaService): Promise<void> => {
      const cleared = await client.sourceTest.updateMany({
        where: {
          id: sourceTestId,
          parentAccountId,
          status: 'Draft',
          legibilityCheckedAt: { not: null },
        },
        data: { legibilityCheckedAt: null },
      });
      // The page verdicts hang off the same gate, so they are cleared only
      // when the Source Test itself was: a matched-nothing header write and a
      // wiped set of verdicts would be exactly the half-state the single
      // transaction exists to prevent.
      if (cleared.count === 0) return;
      await client.pageImage.updateMany({
        where: { sourceTestId },
        data: { legibility: null },
      });
    };
    if (tx) return run(tx);
    await this.prisma.withTransaction(run);
  }

  /**
   * The check's own faults, and only those, become the one 503 the matrix
   * names.
   *
   * Four causes collapse into it: the provider could not be reached, it
   * refused the request, the request could not be made at all, and the payload
   * did not survive validation. From the parent's side they are one fact —
   * the pages were not checked, nothing was stored, and the check may be run
   * again — and none of the differences is something they could act on.
   *
   * Anything else is re-thrown untouched rather than reported as a bad check:
   * a missing stored page or a database fault is not the provider's doing, and
   * dressing it as one would hide it behind a retry that can never succeed.
   */
  private checkFailure(cause: unknown): unknown {
    if (
      cause instanceof AiUpstreamError ||
      cause instanceof AiRejectedError ||
      cause instanceof AiInputError ||
      cause instanceof LegibilityPayloadInvalid
    ) {
      return new ServiceUnavailableException(LEGIBILITY_CHECK_FAILED);
    }
    return cause;
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
      legibilityCheckedAt: row.legibilityCheckedAt?.toISOString() ?? null,
      maxPages: MAX_PAGES,
      pages: pages.map((page) => ({
        id: page.id,
        ordinal: page.ordinal,
        state: page.state,
        width: page.width,
        height: page.height,
        byteSize: page.byteSize,
        legibility: page.legibility,
        createdAt: page.createdAt.toISOString(),
        bytesDeletedAt: page.bytesDeletedAt?.toISOString() ?? null,
      })),
    };
  }
}
