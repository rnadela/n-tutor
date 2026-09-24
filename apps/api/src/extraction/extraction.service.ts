import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AiFailureKind, ExtractionJobStatus } from '../generated/prisma/enums.js';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import {
  PageBytesUnavailable,
  SOURCE_TEST_READER,
  type SourceTestReader,
} from '../sourcetest/source-test-reader.js';
import {
  EXTRACTION_FAILED,
  EXTRACTION_INPUT_UNUSABLE,
  EXTRACTION_NOT_FOUND,
  EXTRACTION_PAGES_GONE,
  EXTRACTION_UPSTREAM_REJECTED,
  MAX_JOB_ATTEMPTS,
  claimTimeoutMs,
} from './extraction-policy.js';
import {
  ExtractionInputUnusable,
  ExtractionPayloadInvalid,
  type NormalizedExtraction,
  validateExtractionPayload,
} from './extraction-payload.js';
import { EXTRACTION_PROMPT } from './extraction-prompt.js';
import {
  EXTRACTION_SCHEMA_NAME,
  ExtractionPayload,
  fakeExtractionPayload,
} from './extraction-schema.js';

/**
 * Prisma's unique-constraint fault, identified by its code alone — matched the
 * same way `sourcetest` matches it, because the generated client's error
 * classes are not stable to import and the code is the part that is.
 */
function isUniqueViolation(cause: unknown): boolean {
  return (cause as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * The pages this job was to read are no longer there — the Source Test was
 * removed, or its stored bytes were. Terminal: a retry reads the same nothing.
 */
export class ExtractionTargetMissing extends Error {
  constructor() {
    super(EXTRACTION_PAGES_GONE);
    this.name = 'ExtractionTargetMissing';
  }
}

/**
 * This pass was superseded: the job row has moved on since it was claimed —
 * re-enqueued, or reclaimed after this pass's lock went stale. Thrown to roll
 * the store back, and deliberately silent afterwards, because whatever moved
 * the row on is the run whose verdict should stand.
 */
export class ExtractionFenced extends Error {
  constructor() {
    super('This extraction pass was superseded by a newer one.');
    this.name = 'ExtractionFenced';
  }
}

/**
 * How long the store gets. The provider call is already paid for by the time a
 * row is written, so a five-second default that aborts a ten-page document is a
 * transaction limit deciding to spend the money again.
 */
const STORE_TIMEOUT_MS = 30_000;
const STORE_MAX_WAIT_MS = 10_000;

/** A job as the claim pass hands it to the run. Identifiers only. */
export interface ClaimedJob {
  id: string;
  sourceTestId: string;
  attempts: number;
}

/**
 * The status read's whole answer: where the job stands, and how much was found.
 *
 * No question content, no choice, no topic, no passage. Extraction is not a
 * browsable product surface in v0, and a body that carried one question would
 * be the first half of making it one. Counts plus a status is exactly what
 * Story 3.6's warning and Epic 4's generate step read.
 */
export interface ExtractionStatusView {
  status: ExtractionJobStatus;
  /** Null until the job has succeeded. */
  pageCount: number | null;
  questionCount: number | null;
  usableQuestionCount: number | null;
  uninterpretableRegionCount: number | null;
  completedAt: string | null;
  /** Whose fault it was, or null (AD-31). Named, so a retake prompt can read it. */
  failureKind: AiFailureKind | null;
  failureReason: string | null;
  retryable: boolean;
}

/**
 * Sole owner and sole writer of every extraction table (AD-17).
 *
 * Four rules hold it together:
 *
 * - It reads Page Image bytes **through `SourceTestService`** and never through
 *   a Prisma delegate of its own or a storage path of its own (AD-15, AD-28).
 * - It makes provider calls **through `AiService`** and never constructs a
 *   client, a pin, a retry policy or a cost row (AD-17, AD-20).
 * - Enqueue takes the caller's `tx` as its first parameter, so the job row and
 *   the Source Test's status change are one transaction (AD-5).
 * - A payload is stored **whole or not at all**. There is no repair path: half
 *   an Extraction is worse than none, because Epic 4 would generate from it
 *   without ever knowing what was missing.
 */
@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    // Injected by token against a type-only interface, never against the class
    // itself: under ESM, two services importing each other as values cannot
    // both be decorated, whatever `forwardRef` says. `source-test-reader.ts`
    // explains why, and `SourceTestModule` binds the token to the one instance
    // of `SourceTestService`, so this is still the module's own service and
    // still the only way `extraction` reaches a Source Test (AD-17).
    @Inject(SOURCE_TEST_READER)
    private readonly sourceTests: SourceTestReader,
  ) {}

  /**
   * Puts the Source Test's one job back in the queue, inside the caller's
   * transaction.
   *
   * `tx` first, per the convention `rewriteOrdinals` documents: a cross-service
   * write enlists in the caller's transaction rather than opening one of its
   * own, which is the whole of AD-5's rule here.
   *
   * An upsert rather than a create, and `sourceTestId` is unique: a re-run
   * returns the single row to `Queued` with its failure fields cleared, so a
   * Source Test can never accumulate a second job.
   */
  async enqueue(tx: TransactionClient, sourceTestId: string): Promise<void> {
    // Scoped to the three states a job may be re-queued from. A `Running` job
    // is left exactly as it is: moving it back to `Queued` would clear a claim
    // that a worker is still holding, and the next pass would read — and pay
    // for — the same pages alongside it.
    const written = await tx.extractionJob.updateMany({
      where: { sourceTestId, status: { in: ['Queued', 'Succeeded', 'Failed'] } },
      data: {
        status: 'Queued',
        // A re-run is a fresh run: the previous run's attempts were spent on a
        // question that has since been asked again.
        attempts: 0,
        lockedAt: null,
        failureKind: null,
        failureReason: null,
        retryable: false,
        completedAt: null,
      },
    });
    if (written.count > 0) return;

    const existing = await tx.extractionJob.findUnique({
      where: { sourceTestId },
      select: { id: true },
    });
    // There is a row and it is `Running`: already being read, nothing to do.
    if (existing !== null) return;

    try {
      await tx.extractionJob.create({ data: { sourceTestId } });
    } catch (cause) {
      // Another enqueue won the race and wrote the one row this Source Test is
      // allowed. That is the outcome this method wanted.
      if (!isUniqueViolation(cause)) throw cause;
    }
  }

  /**
   * Takes the oldest claimable job, or nothing.
   *
   * `FOR UPDATE SKIP LOCKED` is the whole of the concurrency control: two
   * workers running the same pass at the same instant cannot both take the same
   * row, and the loser skips it rather than blocking on it — so a second worker
   * is useful rather than merely patient.
   *
   * Claimable means `Queued`, or `Running` with a claim that has outlived the
   * timeout. Without the second case a worker that died mid-run would strand
   * its job forever.
   */
  async claimNext(): Promise<ClaimedJob | null> {
    const staleBefore = new Date(Date.now() - claimTimeoutMs());
    return this.prisma.withTransaction(async (tx) => {
      // A job that has used every attempt is given up on, once, before anything
      // tries to claim it again. Without this it is a job that kills its worker
      // on every pass and bills a vision call each time, forever.
      await tx.extractionJob.updateMany({
        where: {
          status: 'Running',
          lockedAt: { lte: staleBefore },
          attempts: { gte: MAX_JOB_ATTEMPTS },
        },
        data: {
          status: 'Failed',
          lockedAt: null,
          failureKind: 'UpstreamFault',
          failureReason: EXTRACTION_FAILED,
          // Not retryable by the worker: it has already tried. A parent
          // re-submitting is what re-enqueues it, and that resets `attempts`.
          retryable: false,
          completedAt: new Date(),
        },
      });

      // Claimable is `Queued`, or `Running` with a claim that has outlived the
      // timeout — a worker that died mid-run would otherwise strand its job
      // forever. The comparison is against the enum type rather than a cast to
      // text, so `@@index([status, createdAt])` is actually usable: under `FOR
      // UPDATE SKIP LOCKED` a sequential scan locks its way through the table.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "extraction_job"
        WHERE "attempts" < ${MAX_JOB_ATTEMPTS}
          AND ("status" = 'Queued'::"extraction_job_status"
            OR ("status" = 'Running'::"extraction_job_status"
                AND "lockedAt" IS NOT NULL
                AND "lockedAt" <= ${staleBefore}))
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const id = rows[0]?.id;
      if (id === undefined) return null;
      const claimed = await tx.extractionJob.update({
        where: { id },
        data: { status: 'Running', lockedAt: new Date(), attempts: { increment: 1 } },
        select: { id: true, sourceTestId: true, attempts: true },
      });
      return claimed;
    });
  }

  /**
   * Reads every page as one document and stores what came back, or fails the
   * job saying whose fault it was.
   *
   * Never throws: a worker loop that has to catch is a worker loop that will
   * one day fail to, and a job whose failure escaped is a job that stays
   * `Running` until its claim expires.
   */
  async runJob(job: ClaimedJob): Promise<void> {
    try {
      const sourceTest = await this.prisma.sourceTest.findUnique({
        where: { id: job.sourceTestId },
        select: { parentAccountId: true },
      });
      // The Source Test went away between the enqueue and the claim. Nothing to
      // read and nobody to bill — and not a case to tell a parent to retake
      // photographs of, which is why it has a reason of its own.
      if (sourceTest === null) throw new ExtractionTargetMissing();

      const pages = await this.sourceTests.readPageBytes(job.sourceTestId);
      if (pages.length === 0) throw new ExtractionTargetMissing();

      const { payload } = await this.ai.run({
        callClass: 'Extraction',
        parentAccountId: sourceTest.parentAccountId,
        // Already in ordinal order, and sent that way: the model is told the
        // images are the pages of one document in the order given.
        images: pages,
        prompt: EXTRACTION_PROMPT,
        schema: ExtractionPayload,
        schemaName: EXTRACTION_SCHEMA_NAME,
        fakePayload: fakeExtractionPayload,
      });

      const document = validateExtractionPayload(
        payload,
        pages.map((page) => page.ordinal),
      );
      await this.store(job, document);
      this.logger.log(`Extraction job ${job.id} succeeded.`);
    } catch (cause) {
      await this.fail(job, cause);
    }
  }

  /**
   * Where the job stands and how much it found, for this account's Source Test.
   *
   * Ownership is proven by `sourcetest`, which is what makes a foreign or
   * unknown id a 404 rather than a 403 (AD-18), and the counts are read from
   * the extraction tables **alone** — so the answer is unchanged after Epic 8
   * has deleted every Page Image row and every stored byte.
   */
  async statusFor(parentAccountId: string, sourceTestId: string): Promise<ExtractionStatusView> {
    // `requireReadable`, not `requireLive`: a Source Test's `expiresAt` is the
    // draft's 72-hour capture TTL and submit does not clear it, so proving
    // ownership against it would make a complete Extraction answer 404 three
    // days after the photograph was taken — the exact opposite of the rule that
    // an Extraction outlives its images.
    await this.sourceTests.requireReadable(parentAccountId, sourceTestId);

    // Both rows in one transaction: a re-enqueue landing between two separate
    // reads would report a fresh `Queued` beside the previous run's counts, and
    // a status that describes two different runs is worse than either.
    const snapshot = await this.prisma.withTransaction(async (tx) => {
      const job = await tx.extractionJob.findUnique({
        where: { sourceTestId },
        select: {
          status: true,
          failureKind: true,
          failureReason: true,
          retryable: true,
          completedAt: true,
        },
      });
      if (job === null) return null;

      const extraction = await tx.extraction.findUnique({
        where: { sourceTestId },
        select: { id: true, pageCount: true },
      });
      if (extraction === null) return { job, counts: null };

      const [questionCount, usableQuestionCount, uninterpretableRegionCount] = await Promise.all([
        tx.extractedQuestion.count({ where: { extractionId: extraction.id } }),
        tx.extractedQuestion.count({ where: { extractionId: extraction.id, usable: true } }),
        tx.uninterpretableRegion.count({ where: { extractionId: extraction.id } }),
      ]);
      return {
        job,
        counts: {
          pageCount: extraction.pageCount,
          questionCount,
          usableQuestionCount,
          uninterpretableRegionCount,
        },
      };
    });

    // A Source Test still in `Draft` has no job, and the read says so with the
    // same 404 an unknown id gets: there is nothing to report, and nothing
    // about the answer confirms which of the two it was.
    if (snapshot === null) throw new NotFoundException(EXTRACTION_NOT_FOUND);
    const { job, counts } = snapshot;

    return {
      status: job.status,
      pageCount: counts?.pageCount ?? null,
      questionCount: counts?.questionCount ?? null,
      usableQuestionCount: counts?.usableQuestionCount ?? null,
      uninterpretableRegionCount: counts?.uninterpretableRegionCount ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      failureKind: job.failureKind,
      failureReason: job.failureReason,
      retryable: job.retryable,
    };
  }

  // --- Internals ---------------------------------------------------------

  /**
   * The whole document and the job's success, in one transaction.
   *
   * The delete first is what makes a re-run a replacement rather than a second
   * reading: `Extraction.sourceTestId` is unique, and every child cascades from
   * it, so one statement removes the previous attempt entirely.
   */
  private async store(job: ClaimedJob, document: NormalizedExtraction): Promise<void> {
    const completedAt = new Date();
    // Row ids are minted here rather than by the database, which is what lets
    // every level go in as one `createMany`: a choice needs its question's id,
    // and a question needs its context's, and waiting for each parent's
    // returned id is what turns a ten-page document into sixty-odd sequential
    // round trips inside one transaction.
    const contextIds = new Map(document.contexts.map((context) => [context.ordinal, randomUUID()]));
    const questionIds = document.questions.map(() => randomUUID());

    await this.prisma.withTransaction(
      async (tx) => {
        // The delete first is what makes a re-run a replacement rather than a
        // second reading: `Extraction.sourceTestId` is unique, and every child
        // cascades from it, so one statement removes the previous attempt.
        await tx.extraction.deleteMany({ where: { sourceTestId: job.sourceTestId } });
        const extraction = await tx.extraction.create({
          data: { sourceTestId: job.sourceTestId, pageCount: document.pageCount, completedAt },
          select: { id: true },
        });

        await tx.extractedContext.createMany({
          data: document.contexts.map((context) => ({
            id: contextIds.get(context.ordinal)!,
            extractionId: extraction.id,
            ordinal: context.ordinal,
            kind: context.kind,
            body: context.body,
            startPageOrdinal: context.startPageOrdinal,
            endPageOrdinal: context.endPageOrdinal,
          })),
        });

        await tx.extractedQuestion.createMany({
          data: document.questions.map((question, index) => ({
            id: questionIds[index]!,
            extractionId: extraction.id,
            ordinal: question.ordinal,
            pageOrdinal: question.pageOrdinal,
            format: question.format,
            prompt: question.prompt,
            confidence: question.confidence,
            dependsOnUninterpretable: question.dependsOnUninterpretable,
            // Computed by the validation pass, never read from the payload
            // (AD-30).
            usable: question.usable,
            contextId:
              question.contextOrdinal === null
                ? null
                : (contextIds.get(question.contextOrdinal) ?? null),
          })),
        });

        await tx.extractedChoice.createMany({
          data: document.questions.flatMap((question, index) =>
            question.choices.map((body, choiceIndex) => ({
              questionId: questionIds[index]!,
              ordinal: choiceIndex + 1,
              body,
            })),
          ),
        });

        await tx.extractedTopicLabel.createMany({
          // Raw, as read. Canonicalization is Epic 7's (AD-11).
          data: document.questions.flatMap((question, index) =>
            question.topics.map((topic) => ({
              questionId: questionIds[index]!,
              label: topic.label,
              confidence: topic.confidence,
            })),
          ),
        });

        await tx.uninterpretableRegion.createMany({
          data: document.regions.map((region) => ({
            extractionId: extraction.id,
            pageOrdinal: region.pageOrdinal,
            kind: region.kind,
          })),
        });

        // The fence. A pass that took twice as long as its claim timeout comes
        // back to a job somebody else has since re-enqueued or reclaimed, and
        // writing its verdict would overwrite a newer run's. `attempts` is the
        // value this pass claimed with, so matching it is matching this pass.
        // Failing the match throws, which rolls the whole store back.
        const written = await tx.extractionJob.updateMany({
          where: { id: job.id, status: 'Running', attempts: job.attempts },
          data: {
            status: 'Succeeded',
            lockedAt: null,
            failureKind: null,
            failureReason: null,
            retryable: false,
            completedAt,
          },
        });
        if (written.count !== 1) throw new ExtractionFenced();
      },
      { timeout: STORE_TIMEOUT_MS, maxWait: STORE_MAX_WAIT_MS },
    );
  }

  /**
   * Fails the job, saying whose fault it was (AD-31).
   *
   * An upstream fault — transport, timeout, schema-invalid payload, post-hoc
   * violation — is retryable, because the same pages asked again may well be
   * read correctly. A client fault is not: every page came back
   * uninterpretable, and asking again would buy the same answer twice. That
   * distinction is exactly what a later retake prompt reads.
   *
   * The reason written is a **constant** from this module's policy file, never
   * the message an exception arrived with: a provider string could carry a
   * fragment of what it read (AD-20).
   */
  private async fail(job: ClaimedJob, cause: unknown): Promise<void> {
    // Superseded, not failed. Whatever moved the job row on is the run whose
    // verdict should stand, and this pass has already rolled its own writes
    // back.
    if (cause instanceof ExtractionFenced) {
      this.logger.warn(`Extraction job ${job.id} was superseded mid-run; its pass wrote nothing.`);
      return;
    }

    // The input's fault, and terminal either way (AD-31): pages nobody could
    // read, or pages that are no longer there. Neither is made better by a
    // retry, and each has its own sentence.
    const targetMissing =
      cause instanceof ExtractionTargetMissing || cause instanceof PageBytesUnavailable;
    const unusable = cause instanceof ExtractionInputUnusable || cause instanceof AiInputError;
    const clientFault = targetMissing || unusable;

    // A provider that refused the request outright — a bad key, a model this
    // account cannot use — is upstream, but retrying it buys the same refusal.
    const refused = cause instanceof AiRejectedError;

    const failureKind: AiFailureKind = clientFault ? 'ClientFault' : 'UpstreamFault';

    if (
      !clientFault &&
      !refused &&
      !(cause instanceof AiUpstreamError) &&
      !(cause instanceof ExtractionPayloadInvalid)
    ) {
      // Something this module did not anticipate. Reported as upstream so the
      // job is retryable, and named by its error class alone so the fault is
      // findable without a message that might carry content.
      this.logger.error(
        `Extraction job ${job.id} failed unexpectedly: ${(cause as Error)?.name ?? 'unknown'}.`,
      );
    }

    // `updateMany` and the same fence the success path uses: the job row may
    // have been re-enqueued, reclaimed, or cascaded away with its Source Test
    // while this pass was running, and `update` would answer a missing row with
    // a fault that escaped the method whose whole contract is that it does not
    // throw.
    const written = await this.prisma.extractionJob.updateMany({
      where: { id: job.id, status: 'Running', attempts: job.attempts },
      data: {
        status: 'Failed',
        lockedAt: null,
        failureKind,
        failureReason: targetMissing
          ? EXTRACTION_PAGES_GONE
          : unusable
            ? EXTRACTION_INPUT_UNUSABLE
            : refused
              ? EXTRACTION_UPSTREAM_REJECTED
              : EXTRACTION_FAILED,
        retryable: !clientFault && !refused,
        completedAt: new Date(),
      },
    });
    if (written.count !== 1) {
      this.logger.warn(`Extraction job ${job.id} failed, but its row had already moved on.`);
      return;
    }
    this.logger.warn(`Extraction job ${job.id} failed (${failureKind}).`);
  }
}
