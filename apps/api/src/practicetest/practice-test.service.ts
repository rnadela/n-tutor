import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  AiFailureKind,
  GenerationJobStatus,
  QuestionFormat,
} from '../generated/prisma/enums.js';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import {
  EXTRACTION_READER,
  type ExtractionForGeneration,
  type ExtractionReader,
} from '../extraction/extraction-reader.js';
import { isRichText, plainTextOf, type RichText } from '../extraction/rich-text.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SOURCE_TEST_READER, type SourceTestReader } from '../sourcetest/source-test-reader.js';
import {
  EXTRACTION_NOT_READY,
  GENERATION_CLOCK_ANOMALY,
  GENERATION_FAILED,
  GENERATION_INPUT_UNUSABLE,
  GENERATION_NOT_REQUESTED,
  GENERATION_REQUEST_REJECTED,
  GENERATION_SOURCE_GONE,
  GENERATION_UPSTREAM_REJECTED,
  MAX_JOB_ATTEMPTS,
  MAX_PER_REQUEST,
  NO_GENERATION_ALLOWANCE,
  NO_USABLE_QUESTIONS,
  WEIGHTED_TOPIC_UNKNOWN,
  claimTimeoutMs,
  clampCount,
  formatTargets,
  normalizeTopicLabel,
  remainingFor,
  weightingFor,
  type GenerationWeighting,
} from './practice-test-policy.js';
import {
  GenerationPayloadInvalid,
  normalizePrompt,
  validateGenerationPayload,
  type NormalizedPracticeTest,
} from './practice-test-payload.js';
import { buildGenerationPrompt } from './practice-test-prompt.js';
import {
  PRACTICE_TEST_SCHEMA_NAME,
  PracticeTestPayload,
  fakePracticeTestPayload,
  type FakeFormatTarget,
} from './practice-test-schema.js';

/**
 * The Extraction this job was to generate from is no longer there, or never had
 * anything usable in it. Terminal: a retry reads the same nothing.
 */
export class GenerationTargetMissing extends Error {
  constructor(readonly gone: boolean) {
    super(gone ? GENERATION_SOURCE_GONE : GENERATION_INPUT_UNUSABLE);
    this.name = 'GenerationTargetMissing';
  }
}

/**
 * This pass was superseded: the job row has moved on since it was claimed —
 * reclaimed after this pass's lock went stale, most likely. Thrown to roll the
 * *current draft* back with its charge, and deliberately silent afterwards,
 * because whatever moved the row on is the run whose verdict should stand.
 *
 * Note what it does **not** roll back: drafts that already landed in their own
 * committed transactions stay landed and stay charged. That is the whole point
 * of charging incrementally — a parent who got three Practice Tests has three
 * Practice Tests, whatever happened to the fourth.
 */
export class GenerationFenced extends Error {
  constructor() {
    super('This generation pass was superseded by a newer one.');
    this.name = 'GenerationFenced';
  }
}

/**
 * The instant a draft landed on fell outside the period window computed for
 * that same instant — arithmetically impossible without a clock or timezone
 * anomaly on this machine.
 *
 * Terminal and never retried, and that is the whole reason it is not simply an
 * upstream fault: a retry would be run against the same broken clock, and every
 * attempt would spend another provider call to reach the same impossible
 * arithmetic. Better to stop and be visible than to bill in a loop.
 */
export class GenerationClockAnomaly extends Error {
  constructor() {
    super(GENERATION_CLOCK_ANOMALY);
    this.name = 'GenerationClockAnomaly';
  }
}

/**
 * How long one draft's landing gets. The provider call is already paid for by
 * the time a row is written, so a five-second default that aborts a forty-
 * question draft is a transaction limit deciding to spend the money again.
 */
const LAND_TIMEOUT_MS = 30_000;
const LAND_MAX_WAIT_MS = 10_000;

/** A job as the claim pass hands it to the run. Identifiers and counts only. */
export interface ClaimedGenerationJob {
  id: string;
  parentAccountId: string;
  sourceTestId: string;
  studentProfileId: string;
  requestedCount: number;
  producedCount: number;
  attempts: number;
  /**
   * The Topic this job was asked to concentrate on, in the Extraction's own
   * spelling, or null for an unweighted request. Carried into the run because
   * the run happens later than the request that chose it.
   *
   * A Topic label is content read off a parent's page, so it travels here to be
   * put in a prompt and counted against — never into a log line (AD-20).
   */
  weightedTopic: string | null;
}

/**
 * What a parent is told about their Generation Allowance before they spend it.
 *
 * `limit` is `null` for unlimited and is never a sentinel number; `remaining`
 * is what one request may actually ask for, which on an unlimited tier is the
 * per-request ceiling. Every figure a screen shows arrives from here, so the
 * web app holds none of them.
 */
export interface GenerationAllowanceView {
  used: number;
  limit: number | null;
  remaining: number;
  maxPerRequest: number;
  resetAt: string;
  timezone: string;
}

/**
 * The Topics a request may be weighted on: the Extraction's own labels, raw and
 * de-duplicated, in first-appearance order.
 *
 * A list and nothing else — no counts, no mastery, no ordering by how often a
 * Topic appears. Anything more would be an Analytics figure on a generate
 * screen, and that surface is Epic 7's (FR-11, FR-29).
 */
export interface GenerationTopicsView {
  topics: string[];
}

/** The progress read's whole answer: where the job stands, and how much landed. */
export interface GenerationJobView {
  id: string;
  status: GenerationJobStatus;
  /** Already clamped. What the client asked for is never stored or reported. */
  requestedCount: number;
  /**
   * The Topic the request was weighted on, in the Extraction's own spelling, or
   * null for an unweighted request. It travels on the view so a parent
   * returning to the URL reads the request they actually made.
   */
  weightedTopic: string | null;
  producedCount: number;
  completedAt: string | null;
  failureKind: AiFailureKind | null;
  failureReason: string | null;
  retryable: boolean;
}

/**
 * Sole owner and sole writer of every Practice Test table (AD-17), and the
 * owner of the generation prompt.
 *
 * Four rules hold it together:
 *
 * - It reads the source material **through `ExtractionReader`** and never
 *   through a Prisma delegate of its own, a Page Image row or a storage path
 *   (AD-15, AD-28). That is what makes generation survive image expiry.
 * - It makes provider calls **through `AiService`** and never constructs a
 *   client, a pin, a retry policy or a cost row (AD-17, AD-20).
 * - Each draft lands in **its own** transaction, fenced against the job row and
 *   carrying its own `chargedAt`. A landed draft is never rolled back by a
 *   later failure of the same job.
 * - Nothing it logs, throws or stores outside a Practice Test row carries a
 *   fragment of generated content. Identifiers, counts and money only (AD-20).
 */
@Injectable()
export class PracticeTestService {
  private readonly logger = new Logger(PracticeTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly allowance: AllowanceService,
    // Both injected by token against a type-only interface, never against the
    // class: under ESM two services importing each other as values cannot both
    // be decorated, whatever `forwardRef` says. `source-test-reader.ts`
    // explains why in full.
    @Inject(SOURCE_TEST_READER)
    private readonly sourceTests: SourceTestReader,
    @Inject(EXTRACTION_READER)
    private readonly extraction: ExtractionReader,
  ) {}

  /**
   * What this account has left to spend, and the ceiling one request may ask
   * for. Read by the generate screen before anything is chosen.
   */
  async allowanceFor(parentAccountId: string): Promise<GenerationAllowanceView> {
    const consumption = await this.allowance.consumptionFor(parentAccountId);
    const { used, limit } = consumption.allowances.generation;
    return {
      used,
      limit,
      remaining: remainingFor(used, limit),
      maxPerRequest: MAX_PER_REQUEST,
      resetAt: consumption.resetAt,
      timezone: consumption.timezone,
    };
  }

  /**
   * The Topics this Source Test's Extraction actually carries, which are the
   * only Topics a request may be weighted on.
   *
   * In first-appearance order, and de-duplicated by the **same** comparison
   * `request()` resolves against, so the offered list and the resolver cannot
   * disagree: two raw labels differing only by case or spacing are one option
   * here, and choosing it resolves to the spelling offered. Nothing
   * canonicalizes, merges or sorts beyond that — the labels are raw as they
   * were read (AD-11, Epic 7), and the screen offers them as they are.
   *
   * Its refusals mirror `request()`'s, and for the same reason: a screen that
   * could list Topics for an upload the request would refuse would be offering
   * a choice that cannot be made.
   */
  async topicsFor(parentAccountId: string, sourceTestId: string): Promise<GenerationTopicsView> {
    const sourceTest = await this.sourceTests.requireReadable(parentAccountId, sourceTestId);
    if (sourceTest.status !== 'Submitted') throw new ConflictException(EXTRACTION_NOT_READY);

    const extraction = await this.extraction.readForGeneration(sourceTestId);
    if (extraction === null) throw new ConflictException(EXTRACTION_NOT_READY);
    if (extraction.questions.length === 0) throw new ConflictException(NO_USABLE_QUESTIONS);

    return { topics: topicsOf(extraction) };
  }

  /**
   * Accepts a generation request and enqueues the job, or refuses it.
   *
   * The count is clamped **here**, against a count of charged rows read inside
   * the same transaction that writes the job. What the client sent is an
   * opening bid and nothing more: the UI disabling a radio button is a
   * courtesy, and a direct call simply does not have to respect it.
   *
   * The refusals are ordered so the parent reads the most actionable fact: an
   * upload that has not finished being read, then one with nothing usable in
   * it, then a weighting on a Topic the upload does not carry, then an
   * allowance that is spent. A foreign or unknown id answers 404 through
   * `sourcetest` before any of them (AD-18).
   *
   * The weighted Topic is deliberately decided **before** the allowance, and
   * the ordering is not incidental: a request naming a Topic that does not
   * exist is malformed against this upload however much allowance is left, and
   * telling such a parent "no allowance remains" would send them to wait for a
   * period rollover that would refuse them again for a reason nobody stated.
   * The unknown Topic is the fact they can act on, so it is the fact they get.
   */
  async request(
    parentAccountId: string,
    sourceTestId: string,
    count: number,
    weightedTopic?: string | null,
  ): Promise<GenerationJobView> {
    // `requireReadable`, not `requireLive`: a submitted Source Test's
    // `expiresAt` is the draft's capture TTL and is never cleared, so honouring
    // it here would make generation impossible three days after the photograph
    // — the exact opposite of the rule that an Extraction outlives its images.
    const sourceTest = await this.sourceTests.requireReadable(parentAccountId, sourceTestId);
    if (sourceTest.status !== 'Submitted') throw new ConflictException(EXTRACTION_NOT_READY);

    const extraction = await this.extraction.readForGeneration(sourceTestId);
    if (extraction === null) throw new ConflictException(EXTRACTION_NOT_READY);
    if (extraction.questions.length === 0) throw new ConflictException(NO_USABLE_QUESTIONS);

    // Resolved here, before the transaction and before anything is enqueued or
    // charged, and resolved to the **Extraction's** spelling rather than the
    // client's. The prompt asks the model to write Topics in the words it is
    // given, and the post-hoc pass counts generated labels against this one, so
    // persisting what a browser happened to send would put a third spelling
    // into a loop that only works while there is one.
    const resolvedTopic = resolveWeightedTopic(extraction, weightedTopic ?? null);

    const consumption = await this.allowance.consumptionFor(parentAccountId);
    const { limit } = consumption.allowances.generation;
    const windowStart = new Date(consumption.periodStart);
    const windowEnd = new Date(consumption.periodEnd);

    return this.prisma.withTransaction(async (tx) => {
      // Counted inside the transaction that writes the job. Derived from
      // charged rows — never a counter column, and never decremented (AD-14).
      // This does not serialize two concurrent requests against each other
      // (Postgres's default Read Committed isolation lets both read the same
      // pre-charge usage and both be accepted) — a known, deferred gap; see
      // the `deferred` entry on concurrent-request overspend.
      const used = await tx.practiceTest.count({
        where: {
          parentAccountId,
          chargedAt: { gte: windowStart, lt: windowEnd },
        },
      });
      const requestedCount = clampCount(count, remainingFor(used, limit));
      if (requestedCount === 0) throw new ConflictException(NO_GENERATION_ALLOWANCE);

      const job = await tx.generationJob.create({
        data: {
          parentAccountId,
          sourceTestId,
          studentProfileId: sourceTest.studentProfileId,
          requestedCount,
          weightedTopic: resolvedTopic,
        },
        select: JOB_VIEW_FIELDS,
      });
      this.logger.log(
        `Generation job ${job.id} enqueued for source test ${sourceTestId}, ${requestedCount} requested.`,
      );
      return viewOf(job);
    });
  }

  /**
   * Where this account's newest generation job for a Source Test stands.
   *
   * Newest, because a parent may generate again (Story 4.2) and the screen they
   * are standing on is about the request they just made. Ownership is proven by
   * `sourcetest`, which is what makes a foreign or unknown id a 404 rather than
   * a 403 (AD-18).
   */
  async statusFor(parentAccountId: string, sourceTestId: string): Promise<GenerationJobView> {
    await this.sourceTests.requireReadable(parentAccountId, sourceTestId);
    const job = await this.prisma.generationJob.findFirst({
      where: { parentAccountId, sourceTestId },
      // `id` breaks a tie on `createdAt`, which two jobs enqueued in the same
      // millisecond would otherwise leave to whatever order Postgres happens
      // to return — this is "the newest job", not "an arbitrary tied job".
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: JOB_VIEW_FIELDS,
    });
    // No job answers the same 404 an unknown id gets: there is nothing to
    // report, and nothing about the answer confirms which of the two it was.
    if (job === null) throw new NotFoundException(GENERATION_NOT_REQUESTED);
    return viewOf(job);
  }

  /**
   * Takes the oldest claimable job, or nothing.
   *
   * `FOR UPDATE SKIP LOCKED` is the whole of the concurrency control, exactly
   * as it is for extraction: two workers running the same pass at the same
   * instant cannot both take the same row, and the loser skips it rather than
   * blocking on it.
   */
  async claimNext(): Promise<ClaimedGenerationJob | null> {
    const staleBefore = new Date(Date.now() - claimTimeoutMs());
    return this.prisma.withTransaction(async (tx) => {
      // A job that has used every attempt is given up on, once, before anything
      // claims it again. Whatever it produced stays produced and stays charged
      // — that is what `PartiallyComplete` is for.
      const exhausted = await tx.generationJob.findMany({
        where: {
          status: 'Running',
          lockedAt: { lte: staleBefore },
          attempts: { gte: MAX_JOB_ATTEMPTS },
        },
        select: { id: true, producedCount: true },
      });
      for (const job of exhausted) {
        await tx.generationJob.updateMany({
          where: { id: job.id, status: 'Running' },
          data: {
            status: job.producedCount > 0 ? 'PartiallyComplete' : 'Failed',
            lockedAt: null,
            failureKind: 'UpstreamFault',
            failureReason: GENERATION_FAILED,
            // Not retryable by the worker: it has already tried. A parent
            // asking again is a new request and a new job.
            retryable: false,
            completedAt: new Date(),
          },
        });
      }

      // The comparison is against the enum type rather than a cast to text, so
      // `@@index([status, createdAt])` is actually usable: under `FOR UPDATE
      // SKIP LOCKED` a sequential scan locks its way through the table.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "generation_job"
        WHERE "attempts" < ${MAX_JOB_ATTEMPTS}
          AND ("status" = 'Queued'::"generation_job_status"
            OR ("status" = 'Running'::"generation_job_status"
                AND "lockedAt" IS NOT NULL
                AND "lockedAt" <= ${staleBefore}))
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const id = rows[0]?.id;
      if (id === undefined) return null;
      return tx.generationJob.update({
        where: { id },
        data: { status: 'Running', lockedAt: new Date(), attempts: { increment: 1 } },
        select: {
          id: true,
          parentAccountId: true,
          sourceTestId: true,
          studentProfileId: true,
          requestedCount: true,
          producedCount: true,
          attempts: true,
          weightedTopic: true,
        },
      });
    });
  }

  /**
   * Produces the drafts this job still owes, one AI call and one committed
   * transaction each.
   *
   * Never throws: a worker loop that has to catch is a worker loop that will
   * one day fail to, and a job whose failure escaped is a job that stays
   * `Running` until its claim expires.
   *
   * It resumes from `producedCount` rather than starting over, which is what
   * makes a reclaimed job finish the request instead of charging for it twice.
   */
  async runJob(job: ClaimedGenerationJob): Promise<void> {
    let produced = job.producedCount;
    try {
      const extraction = await this.extraction.readForGeneration(job.sourceTestId);
      if (extraction === null) throw new GenerationTargetMissing(true);
      if (extraction.questions.length === 0) throw new GenerationTargetMissing(false);

      const plan = planFor(extraction, job.weightedTopic);
      // Seeded with the source's own prompts, then grown with everything this
      // job has landed — including drafts a previous pass of the same job
      // landed, which is why it is read from the rows rather than kept in
      // memory. Plain text only; it never leaves this method.
      const landedPrompts = await this.landedPromptsFor(job.id);

      while (produced < job.requestedCount) {
        const draftOrdinal = produced + 1;
        const draft = await this.produceDraft(job, draftOrdinal, plan, extraction, landedPrompts);
        await this.land(job, draftOrdinal, draft);
        produced = draftOrdinal;
        for (const question of draft.questions) {
          landedPrompts.push(plainTextOf(question.prompt));
        }
      }

      await this.complete(job, produced);
    } catch (cause) {
      await this.fail(job, cause, produced);
    }
  }

  // --- Internals ---------------------------------------------------------

  /**
   * One draft: the provider call, then the deterministic pass, re-issued while
   * the pass keeps rejecting what came back.
   *
   * The retry is the point. A post-hoc rejection — a MultipleChoice question
   * with no correct option, a prompt that reproduces a source question — is the
   * provider's fault (AD-31): the model was asked for a shape and answered with
   * another. `AiService`'s own loop cannot see it, because the payload parsed
   * and the call returned, so without this the first malformed answer would
   * fail the parent's whole request on one bad roll of the dice.
   *
   * Bounded by `AI_MAX_ATTEMPTS`, the same figure `AiService` retries transport
   * faults under, so one draft's worst case is the figure the claim-timeout
   * invariant in `practice-test-policy.ts` is already computed against. On
   * exhaustion the last rejection is rethrown and `fail` treats it exactly as
   * it treats any other upstream fault.
   */
  private async produceDraft(
    job: ClaimedGenerationJob,
    draftOrdinal: number,
    plan: GenerationPlan,
    extraction: ExtractionForGeneration,
    landedPrompts: readonly string[],
  ): Promise<NormalizedPracticeTest> {
    const forbiddenPrompts = new Set([
      ...plan.sourcePrompts,
      ...landedPrompts.map((text) => normalizePrompt(text)),
    ]);
    const maxAttempts = this.ai.config.maxAttempts;
    let lastRejection: GenerationPayloadInvalid | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Before the call, not only before the write: a pass whose claim expired
      // can never land anything, so every provider call it goes on to make is
      // money spent on a draft that is guaranteed to be rolled back. The check
      // is one indexed count against the row this pass claimed.
      await this.requireFence(job);

      const { payload } = await this.ai.run({
        callClass: 'Generation',
        parentAccountId: job.parentAccountId,
        // Text in, text out: this call reads the persisted Extraction, never
        // a photograph. Stated rather than inferred from an empty array.
        modality: 'text',
        images: [],
        prompt: buildGenerationPrompt({
          sourceQuestions: extraction.questions,
          targets: plan.targets,
          topics: plan.topics,
          weighting: plan.weighting,
          alreadyGenerated: landedPrompts,
        }),
        schema: PracticeTestPayload,
        schemaName: PRACTICE_TEST_SCHEMA_NAME,
        fakePayload: ({ failure }) =>
          fakePracticeTestPayload({
            targets: plan.fakeTargets,
            topics: plan.topics,
            weighting: plan.weighting,
            draftOrdinal,
            failure,
          }),
      });

      try {
        return validateGenerationPayload(payload, {
          targets: plan.targets,
          forbiddenPrompts,
          weighting: plan.weighting,
        });
      } catch (cause) {
        // Only a post-hoc rejection is worth asking again for. Anything else
        // is this module's own fault and is not made better by repetition.
        if (!(cause instanceof GenerationPayloadInvalid)) throw cause;
        lastRejection = cause;
        // The job, the draft and the attempt number. Never the rule that was
        // broken in the model's own words, and never a fragment of what it
        // wrote (AD-20).
        this.logger.warn(
          `Generation job ${job.id} draft ${draftOrdinal} was rejected after parsing on attempt ${attempt} of ${maxAttempts}.`,
        );
      }
    }
    throw lastRejection!;
  }

  /**
   * Asserts this pass still holds the claim it was handed, and throws if not.
   *
   * The same three columns `land` fences on, read rather than written, so the
   * fence can be checked at a point where there is nothing to roll back.
   */
  private async requireFence(job: ClaimedGenerationJob): Promise<void> {
    const held = await this.prisma.generationJob.count({
      where: { id: job.id, status: 'Running', attempts: job.attempts },
    });
    if (held !== 1) throw new GenerationFenced();
  }

  /** Plain text of every prompt this job has already landed, oldest first. */
  private async landedPromptsFor(generationJobId: string): Promise<string[]> {
    const questions = await this.prisma.practiceTestQuestion.findMany({
      where: { practiceTest: { generationJobId } },
      orderBy: [{ practiceTest: { ordinal: 'asc' } }, { ordinal: 'asc' }],
      select: { prompt: true },
    });
    const prompts: string[] = [];
    for (const question of questions) {
      // Checked, never cast past `JsonValue`. A row written before a schema
      // change would otherwise throw here — and this runs *after* drafts have
      // landed and been charged, so a throw would fail a job whose spent money
      // is already spent. A prompt this cannot read is dropped from the
      // must-differ list instead, which costs a little material difference and
      // keeps the run alive.
      if (isRichText(question.prompt)) {
        prompts.push(plainTextOf(question.prompt as RichText));
        continue;
      }
      this.logger.warn(
        `Generation job ${generationJobId} holds a question whose prompt could not be read back; it is not in the must-differ list.`,
      );
    }
    return prompts;
  }

  /**
   * One draft and its charge, in one transaction.
   *
   * The fence is the whole reason this is a transaction at all. A pass that
   * took longer than its claim timeout comes back to a job somebody else has
   * since reclaimed, and writing a draft against it would charge the account
   * for work another pass is also producing. `attempts` is the value this pass
   * claimed with, so matching it is matching this pass; failing the match
   * throws, and the draft and its `chargedAt` roll back together.
   */
  private async land(
    job: ClaimedGenerationJob,
    ordinal: number,
    draft: NormalizedPracticeTest,
  ): Promise<void> {
    // Re-read rather than computed once at the top of the run: a job may span a
    // period boundary, and the charge belongs to the window the draft actually
    // landed in, not the one the request was made in. Both the window and the
    // charge are derived from the same instant so a period boundary crossing
    // the gap between two separate clock reads can never manufacture a false
    // anomaly.
    const chargedAt = new Date();
    const window = await this.allowance.windowFor(job.parentAccountId, chargedAt);
    if (chargedAt < window.start || chargedAt >= window.end) {
      // The window is computed from this instant, so this cannot happen without
      // a clock or zone anomaly. Refusing beats writing a charge that no period
      // would ever count — and refusing *terminally*, because a retry would be
      // run against the same broken clock and would spend another provider
      // call to reach the same impossible arithmetic.
      throw new GenerationClockAnomaly();
    }

    // Row ids are minted here rather than by the database, which is what lets
    // every level go in as one `createMany`: a choice needs its question's id,
    // and waiting for each parent's returned id turns a forty-question draft
    // into eighty sequential round trips inside one transaction.
    const practiceTestId = randomUUID();
    const questionIds = draft.questions.map(() => randomUUID());

    await this.prisma.withTransaction(
      async (tx) => {
        await tx.practiceTest.create({
          data: {
            id: practiceTestId,
            parentAccountId: job.parentAccountId,
            sourceTestId: job.sourceTestId,
            studentProfileId: job.studentProfileId,
            generationJobId: job.id,
            ordinal,
            questionCount: draft.questions.length,
            // The durable marker the Generation Allowance is counted from
            // (AD-14). Written once, here, and never rewritten: a Practice Test
            // charges on first reaching draft and never again.
            chargedAt,
          },
          select: { id: true },
        });

        await tx.practiceTestQuestion.createMany({
          data: draft.questions.map((question, index) => ({
            id: questionIds[index]!,
            practiceTestId,
            ordinal: question.ordinal,
            format: question.format,
            prompt: question.prompt,
            // `DbNull` rather than a bare `null`: on a nullable Json column
            // Prisma reads `null` as ambiguous between "the SQL NULL" and "the
            // JSON value null", and refuses it outright. A MultipleChoice
            // question's answer is the flagged option, so the column is SQL
            // NULL and says so.
            answer: question.answer ?? Prisma.DbNull,
          })),
        });

        await tx.practiceTestChoice.createMany({
          data: draft.questions.flatMap((question, index) =>
            question.choices.map((choice) => ({
              questionId: questionIds[index]!,
              ordinal: choice.ordinal,
              body: choice.body,
              isCorrect: choice.isCorrect,
            })),
          ),
        });

        await tx.practiceTestQuestionTopic.createMany({
          // Raw, as written. Canonicalization is Epic 7's (AD-11).
          data: draft.questions.flatMap((question, index) =>
            question.topics.map((label) => ({ questionId: questionIds[index]!, label })),
          ),
        });

        const fenced = await tx.generationJob.updateMany({
          where: { id: job.id, status: 'Running', attempts: job.attempts },
          data: { producedCount: { increment: 1 } },
        });
        if (fenced.count !== 1) throw new GenerationFenced();
      },
      { timeout: LAND_TIMEOUT_MS, maxWait: LAND_MAX_WAIT_MS },
    );

    // Identifiers and counts. Not a word of what was written (AD-20).
    this.logger.log(
      `Generation job ${job.id} landed draft ${ordinal} of ${job.requestedCount} with ${draft.questions.length} questions.`,
    );
  }

  /** The job's success, behind the same fence every terminal write uses. */
  private async complete(job: ClaimedGenerationJob, produced: number): Promise<void> {
    const written = await this.prisma.generationJob.updateMany({
      where: { id: job.id, status: 'Running', attempts: job.attempts },
      data: {
        status: 'Succeeded',
        lockedAt: null,
        failureKind: null,
        failureReason: null,
        retryable: false,
        completedAt: new Date(),
      },
    });
    if (written.count !== 1) {
      this.logger.warn(`Generation job ${job.id} finished, but its row had already moved on.`);
      return;
    }
    this.logger.log(`Generation job ${job.id} succeeded with ${produced} drafts.`);
  }

  /**
   * Fails the job, saying whose fault it was and keeping what landed (AD-31).
   *
   * The classification is exactly `extraction.service.ts`'s, because it is the
   * same distinction: an upstream fault — transport, timeout, schema-invalid
   * payload, post-hoc violation — is retryable, and a client fault is not.
   *
   * What differs is the terminal status. A job that produced nothing failed; a
   * job that produced something is `PartiallyComplete`, and its drafts stay
   * committed and stay charged. Collapsing the two would misreport what the
   * parent was charged, which is the one thing this story may not get wrong.
   *
   * The reason written is a **constant** from this module's policy file, never
   * the message an exception arrived with: a provider string could carry a
   * fragment of what it wrote (AD-20).
   */
  private async fail(job: ClaimedGenerationJob, cause: unknown, produced: number): Promise<void> {
    // Superseded, not failed. Whatever moved the job row on is the run whose
    // verdict should stand, and this pass has already rolled back the one draft
    // it was mid-way through.
    if (cause instanceof GenerationFenced) {
      this.logger.warn(
        `Generation job ${job.id} was superseded mid-run; ${produced} drafts had already landed and stay charged.`,
      );
      return;
    }

    const targetMissing = cause instanceof GenerationTargetMissing;
    // The input's fault, and the only branch that asks a parent to do
    // something: the Extraction held nothing usable by the time the job ran.
    const unusable = targetMissing && !(cause as GenerationTargetMissing).gone;
    // This service asked for a call it cannot make. Also terminal, but never
    // the sentence above: the pages were fine, and telling a parent to
    // photograph them again would send them to do work that cannot help.
    const requestRejected = cause instanceof AiInputError;
    // A clock or zone anomaly on this machine. Terminal for its own reason.
    const clockAnomaly = cause instanceof GenerationClockAnomaly;
    const clientFault = targetMissing || requestRejected;

    // A provider that refused the request outright — a bad key, a model this
    // account cannot use — is upstream, but retrying it buys the same refusal.
    const refused = cause instanceof AiRejectedError;

    const failureKind: AiFailureKind = clientFault ? 'ClientFault' : 'UpstreamFault';

    if (
      !clientFault &&
      !refused &&
      !clockAnomaly &&
      !(cause instanceof AiUpstreamError) &&
      !(cause instanceof GenerationPayloadInvalid)
    ) {
      // Something this module did not anticipate. Reported as upstream so the
      // job is retryable, and named by its error class alone so the fault is
      // findable without a message that might carry content.
      this.logger.error(
        `Generation job ${job.id} failed unexpectedly: ${(cause as Error)?.name ?? 'unknown'}.`,
      );
    }

    const status: GenerationJobStatus = produced > 0 ? 'PartiallyComplete' : 'Failed';
    const written = await this.prisma.generationJob.updateMany({
      where: { id: job.id, status: 'Running', attempts: job.attempts },
      data: {
        status,
        lockedAt: null,
        failureKind,
        failureReason:
          targetMissing && (cause as GenerationTargetMissing).gone
            ? GENERATION_SOURCE_GONE
            : unusable
              ? GENERATION_INPUT_UNUSABLE
              : requestRejected
                ? GENERATION_REQUEST_REJECTED
                : clockAnomaly
                  ? GENERATION_CLOCK_ANOMALY
                  : refused
                    ? GENERATION_UPSTREAM_REJECTED
                    : GENERATION_FAILED,
        // A clock anomaly is nobody's *input* and nobody's provider, but the
        // enum has two values and this is not the parent's upload at fault, so
        // it is reported upstream — and, like a refusal, never retryable.
        retryable: !clientFault && !refused && !clockAnomaly,
        completedAt: new Date(),
      },
    });
    if (written.count !== 1) {
      this.logger.warn(`Generation job ${job.id} failed, but its row had already moved on.`);
      return;
    }
    this.logger.warn(`Generation job ${job.id} ended ${status} (${failureKind}) with ${produced}.`);
  }
}

/** The columns every job view is built from, selected in one place. */
const JOB_VIEW_FIELDS = {
  id: true,
  status: true,
  requestedCount: true,
  weightedTopic: true,
  producedCount: true,
  completedAt: true,
  failureKind: true,
  failureReason: true,
  retryable: true,
} as const;

interface JobRow {
  id: string;
  status: GenerationJobStatus;
  requestedCount: number;
  weightedTopic: string | null;
  producedCount: number;
  completedAt: Date | null;
  failureKind: AiFailureKind | null;
  failureReason: string | null;
  retryable: boolean;
}

function viewOf(job: JobRow): GenerationJobView {
  return {
    id: job.id,
    status: job.status,
    requestedCount: job.requestedCount,
    weightedTopic: job.weightedTopic,
    producedCount: job.producedCount,
    completedAt: job.completedAt?.toISOString() ?? null,
    failureKind: job.failureKind,
    failureReason: job.failureReason,
    retryable: job.retryable,
  };
}

/**
 * Everything derived from the Extraction that is the same for every draft of
 * one job: the per-format targets, the Topics to cover, and the source prompts
 * no generated prompt may collide with.
 *
 * Computed once per run rather than per draft — it cannot change between two
 * calls of the same job, and recomputing it would be a second chance for the
 * targets the payload is checked against to differ from the targets the prompt
 * asked for.
 */
interface GenerationPlan {
  targets: Map<QuestionFormat, number>;
  fakeTargets: FakeFormatTarget[];
  topics: string[];
  sourcePrompts: Set<string>;
  /**
   * The Topic to concentrate on and how many questions must carry it, or null
   * when nothing is weighted. One value, so the prompt, the fake and the
   * validator are all handed the same indivisible rule.
   */
  weighting: GenerationWeighting | null;
}

function planFor(
  extraction: ExtractionForGeneration,
  weightedTopic: string | null,
): GenerationPlan {
  // Each generated Practice Test defaults its Question count from the Source
  // Test's own usable count — the epic's rule, stated here as the one place the
  // total comes from.
  const total = extraction.questions.length;
  const targets = formatTargets(
    extraction.questions.map((question) => question.format),
    total,
  );
  const topics = topicsOf(extraction);
  const sourcePrompts = new Set(
    extraction.questions.map((question) => normalizePrompt(plainTextOf(question.prompt))),
  );
  const fakeTargets = [...targets.entries()]
    .filter(([, count]) => count > 0)
    .map(([format, count]) => ({ format, count }));
  // Taken from the row as it was stored, not re-resolved: `request()` already
  // matched it against this same `readForGeneration` and persisted the
  // Extraction's own spelling, and resolving a second time would be a second
  // chance for the Topic the prompt names to differ from the Topic the
  // post-hoc pass counts.
  return {
    targets,
    fakeTargets,
    topics,
    sourcePrompts,
    weighting: weightingFor(weightedTopic, total),
  };
}

/**
 * The Extraction's Topic labels, in first-appearance order, de-duplicated by
 * the same comparison the resolver uses.
 *
 * Not a plain `Set`: labels are stored raw (AD-11), so one Extraction can
 * genuinely hold `Fractions` and `  fractions ` as two rows. A plain `Set`
 * keeps both, the screen offers both, and `matchTopic` resolves both to the
 * first — leaving the second option unselectable in a way nothing explains.
 * Folding them here, keeping the first spelling, makes the list the screen
 * offers and the list the resolver searches literally the same list.
 */
function topicsOf(extraction: ExtractionForGeneration): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const label of extraction.questions.flatMap((question) => question.topics)) {
    const key = normalizeTopicLabel(label);
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(label);
  }
  return topics;
}

/** The Extraction's own spelling of a label, or undefined if it carries none. */
function matchTopic(topics: readonly string[], wanted: string): string | undefined {
  const normalized = normalizeTopicLabel(wanted);
  return topics.find((label) => normalizeTopicLabel(label) === normalized);
}

/**
 * Turns what the client asked to weight into what is stored, or refuses.
 *
 * Absent stays absent, which is Story 4.1's request unchanged in every respect.
 * A label the Extraction does carry resolves to **its** spelling. Anything else
 * is a 409 before the transaction opens, so nothing is enqueued and nothing is
 * charged for a request that could never have been satisfied.
 */
function resolveWeightedTopic(
  extraction: ExtractionForGeneration,
  wanted: string | null,
): string | null {
  if (wanted === null) return null;
  const matched = matchTopic(topicsOf(extraction), wanted);
  if (matched === undefined) throw new ConflictException(WEIGHTED_TOPIC_UNKNOWN);
  return matched;
}
