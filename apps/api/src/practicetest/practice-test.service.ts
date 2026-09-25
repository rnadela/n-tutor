import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  AiFailureKind,
  GenerationJobStatus,
  PracticeTestStatus,
  QuestionFormat,
} from '../generated/prisma/enums.js';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import {
  EXTRACTION_READER,
  type ExtractionForGeneration,
  type ExtractionReader,
} from '../extraction/extraction-reader.js';
import {
  RICH_TEXT_EMPTY,
  isRichText,
  plainTextOf,
  richTextFromPlainText,
  type RichText,
} from '../extraction/rich-text.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { renumbered } from '../sourcetest/source-test-policy.js';
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
  PRACTICE_TEST_NOT_FOUND,
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
  ANSWER_FORBIDDEN,
  CHOICES_FORBIDDEN,
  CHOICES_MISMATCHED,
  EditedQuestionInvalid,
  GenerationPayloadInvalid,
  normalizePrompt,
  validateEditedQuestion,
  validateGenerationPayload,
  type EditedQuestion,
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
 * One row of Pending drafts: enough to recognise a draft and open it, and not
 * one word of what it holds.
 *
 * `studentProfileId` rather than a child's name: `practicetest` does not read
 * an identity table (AD-17), so the screen joins the name from the Student
 * Profile read it already makes.
 */
export interface PracticeTestDraftSummary {
  id: string;
  sourceTestId: string;
  studentProfileId: string;
  /** Its place within the job that produced it, 1-based — "draft 2 of 5". */
  ordinal: number;
  /** How many drafts of the same job are still drafts. The "of 5". */
  siblingCount: number;
  questionCount: number;
  createdAt: string;
}

/**
 * One row of the student-scoped list of released Practice Tests.
 *
 * An identifier and a count, and deliberately nothing else. "Becomes visible in
 * Student Mode" is a claim about visibility, and this epic ends there: taking
 * the test is Epic 5. A student-scoped read that already carried prompts,
 * options and *correct answers* would hand a child the answer key before any
 * surface existed to grade an Attempt against — the exact leak the human quality
 * gate exists to prevent. No prompt, no answer, no option body, no Topic label,
 * no allowance figure, no tier and no model name (AD-20, AD-26).
 */
export interface PracticeTestReleasedSummary {
  id: string;
  questionCount: number;
}

/** One generated option, in the order it is to be shown. */
export interface DraftChoiceView {
  ordinal: number;
  /**
   * The stored rich-text segment array, exactly as it was stored (AD-32). It is
   * not re-parsed on the way out: it was validated on the way in, and a second
   * parse would be a second chance for the two to disagree.
   */
  body: RichText;
  isCorrect: boolean;
}

/** One generated Question, with everything a parent reviews it by. */
export interface DraftQuestionView {
  id: string;
  ordinal: number;
  format: QuestionFormat;
  prompt: RichText;
  /**
   * The correct free-text answer, or null for MultipleChoice — where the answer
   * is the one choice flagged correct rather than a field of its own.
   */
  answer: RichText | null;
  /** Empty for every format but MultipleChoice. */
  choices: DraftChoiceView[];
  /** Raw as stored. Canonicalization is Epic 7's (AD-11). */
  topics: string[];
}

/**
 * One draft, whole: the review screen's entire answer.
 *
 * It carries `status` even though this read serves `Draft` rows and nothing
 * else, because Story 4.5 owns `Released` and `Discarded` and widening this
 * later should be an `in` clause rather than a redesign.
 */
export interface PracticeTestDraftView {
  id: string;
  sourceTestId: string;
  studentProfileId: string;
  status: PracticeTestStatus;
  ordinal: number;
  siblingCount: number;
  questionCount: number;
  createdAt: string;
  /** Every Question the draft holds, in stored `ordinal` order. Never a page. */
  questions: DraftQuestionView[];
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
   * Every draft this account is still holding, newest first.
   *
   * This is what makes the generation screen's "nothing is lost by leaving"
   * true: a parent who walked away from a running job finds the drafts they
   * paid for here, addressed by id and reachable without the URL they left.
   *
   * The account is the `where`, not a comparison after the read — which is what
   * makes another account's draft unreachable by construction rather than by
   * remembering to check. Nothing of what a draft *holds* is on this view: a
   * list is for finding one, and the questions are the full read's answer.
   *
   * The rows and their sibling counts are read in **one transaction**: a
   * sibling released or discarded between two separate reads would produce
   * "draft 2 of 1", and that figure is stated as authoritative precisely
   * because the browser has no way to check it.
   */
  async draftsFor(parentAccountId: string): Promise<PracticeTestDraftSummary[]> {
    const { drafts, countByJob } = await this.prisma.withTransaction(async (tx) => {
      const rows = await tx.practiceTest.findMany({
        where: { parentAccountId, status: 'Draft' },
        // `id` breaks a tie on `createdAt`: two drafts of one job can land
        // inside the same millisecond, and "newest first" must not mean
        // "whatever order Postgres happened to return".
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          sourceTestId: true,
          studentProfileId: true,
          generationJobId: true,
          ordinal: true,
          questionCount: true,
          createdAt: true,
        },
      });
      if (rows.length === 0) return { drafts: rows, countByJob: new Map<string, number>() };

      // "Draft 2 of 3" is a fact about the job, counted here in one grouped
      // read rather than by the browser fetching each job's whole draft set to
      // render a heading.
      const siblings = await tx.practiceTest.groupBy({
        by: ['generationJobId'],
        where: {
          parentAccountId,
          status: 'Draft',
          generationJobId: { in: [...new Set(rows.map((draft) => draft.generationJobId))] },
        },
        _count: { _all: true },
      });
      return {
        drafts: rows,
        countByJob: new Map(siblings.map((row) => [row.generationJobId, row._count._all])),
      };
    });

    return drafts.map((draft) => ({
      id: draft.id,
      sourceTestId: draft.sourceTestId,
      studentProfileId: draft.studentProfileId,
      ordinal: draft.ordinal,
      // The draft is its own sibling, so the grouped count always holds it and
      // the fallback is never reached — it exists so the view carries a real
      // figure rather than a `?? 0` that would read as "of 0".
      siblingCount: countByJob.get(draft.generationJobId) ?? 1,
      questionCount: draft.questionCount,
      createdAt: draft.createdAt.toISOString(),
    }));
  }

  /**
   * The Practice Tests one child can see: released, theirs, most recently *made*
   * first.
   *
   * The **only** cross-boundary read of a Practice Test that exists, and the
   * whole of what Student Home is drawn from. Both ids come from the binding the
   * Student Mode guard verified, never from a parameter, a query or a path — so
   * a device bound to one child cannot address another's release at all.
   *
   * `status: 'Released'` is in the `where` of the statement, which is how
   * discard's exclusion from every downstream surface is structural rather than
   * remembered: a `Discarded` row is not something a later reader must filter,
   * it is something this read cannot reach (AD-17).
   *
   * An identifier and a count per row. Not a prompt, not an answer, not an
   * option body, not a Topic label, and no allowance figure, tier or model name
   * — none of those is a student-scoped fact (AD-20, AD-26).
   *
   * Ordered server-side, `createdAt desc` with `id desc` breaking the tie, the
   * same rule `draftsFor` states and for the same reason: two rows made in one
   * millisecond must not be left in whatever order Postgres returned.
   *
   * `createdAt` is when the Practice Test was **generated**, not when it was
   * released, and the distinction is real: a test generated last week and released
   * today sorts below one generated this morning. There is no `releasedAt` column
   * and this story adds none — no new table, no new column, no migration — so the
   * made-at instant is the only stable ordering available, and it is stated as what
   * it is rather than described as release order it cannot express. Epic 5 owns the
   * list a student actually works from, and whatever sort band that surface needs
   * is its call to make, with whatever column it decides to carry.
   */
  async releasedFor(
    parentAccountId: string,
    studentProfileId: string,
  ): Promise<PracticeTestReleasedSummary[]> {
    const rows = await this.prisma.practiceTest.findMany({
      where: { parentAccountId, studentProfileId, status: 'Released' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, questionCount: true },
    });
    return rows.map((row) => ({ id: row.id, questionCount: row.questionCount }));
  }

  /**
   * One draft, whole — every Question in stored order, each with its answer,
   * its options and its Topics.
   *
   * Nothing is paginated and nothing is collapsed: "every Question" is the
   * epic's acceptance criterion, and this is the read it is met by. The whole
   * draft is one round trip because the screen shows the whole draft.
   *
   * `Draft` is in the `where` beside the account, so a `Released` or
   * `Discarded` row answers the same 404 an unknown id and a foreign id get —
   * those are Story 4.5's states and Story 4.5's surface, and a differently
   * flavoured refusal here would be this module answering a question that story
   * has not been asked yet (AD-18).
   *
   * The stored `Json` travels out as it is stored. It was parsed by
   * `parseRichText` on the way in; re-parsing on the way out would be a second
   * chance for the two readings to disagree about a row neither of them wrote.
   *
   * The draft and its sibling count are read in **one transaction**, for the
   * reason `draftsFor` states: a sibling discarded between two separate reads
   * would head the screen "draft 2 of 1".
   */
  async draftFor(parentAccountId: string, practiceTestId: string): Promise<PracticeTestDraftView> {
    return this.prisma.withTransaction((tx) =>
      this.draftViewIn(tx, parentAccountId, practiceTestId),
    );
  }

  /**
   * The draft view, read inside whatever transaction the caller is in.
   *
   * One reader for the read and for both mutations, rather than a second mapper
   * written beside each write: an edit that answered with a differently-shaped
   * draft than the read does would put the screen's re-render and its first load
   * out of step on exactly the rows that were just changed.
   *
   * `Draft` is in the `where` beside the account, so a `Released`, `Discarded`,
   * foreign or unknown id all answer the same 404 **by construction** rather
   * than by a check somebody has to remember to make (AD-18).
   */
  private async draftViewIn(
    tx: TransactionClient,
    parentAccountId: string,
    practiceTestId: string,
  ): Promise<PracticeTestDraftView> {
    const draft = await tx.practiceTest.findFirst({
      where: { id: practiceTestId, parentAccountId, status: 'Draft' },
      select: DRAFT_SELECT,
    });
    // The one sentence all three refusals share. Nothing about the answer
    // says which of them it was. Thrown inside the transaction, which — on the
    // read path — reads and writes nothing there is anything to roll back.
    if (draft === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

    const siblingCount = await tx.practiceTest.count({
      where: { parentAccountId, generationJobId: draft.generationJobId, status: 'Draft' },
    });
    return draftViewOf(draft, siblingCount);
  }

  /**
   * Rewrites one Question of a draft: its prompt, its free-text answer, its
   * option bodies, and which option is correct.
   *
   * The edited text **is** the Question. There is no second "original" column,
   * no revision history and no shadow copy: what is stored here is exactly what
   * the student will later be graded against, which is the whole reason a human
   * quality gate is worth having.
   *
   * Two things happen before a row is written. The plain text a parent typed
   * goes through `richTextFromPlainText` — the one inverse of `plainTextOf`
   * (AD-32) — so a fraction stays structure; and the *merged* result, stored
   * columns and edit together, goes through `validateEditedQuestion`, the same
   * invariants a generated payload satisfies. A Multiple Choice question that
   * would be left with no correct option is refused with the module's own
   * existing sentence, and nothing is written.
   *
   * `format` is not editable and Topics are not editable (AD-11, Epic 7), and
   * neither the Practice Test's `status` nor its `chargedAt` is touched: an
   * edit is not a transition and not a charge.
   */
  async editQuestion(
    parentAccountId: string,
    practiceTestId: string,
    questionId: string,
    input: EditQuestionInput,
  ): Promise<PracticeTestDraftView> {
    const view = await this.prisma.withTransaction(async (tx) => {
      const stored = await tx.practiceTestQuestion.findFirst({
        // The pair must match, and the Practice Test must be this account's own
        // draft: a valid question id belonging to a different Practice Test is
        // refused exactly as an unknown one is.
        where: {
          id: questionId,
          practiceTestId,
          practiceTest: { parentAccountId, status: 'Draft' },
        },
        select: {
          id: true,
          format: true,
          prompt: true,
          answer: true,
          choices: { orderBy: { ordinal: 'asc' }, select: { ordinal: true, body: true } },
        },
      });
      if (stored === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const multipleChoice = stored.format === 'MultipleChoice';
      // Shape refusals that do not need the merged question to be built first,
      // in the module's own sentences rather than a new one each.
      if (multipleChoice && input.answer !== undefined) refuseEdit(ANSWER_FORBIDDEN);
      if (!multipleChoice && (input.choices !== undefined || input.correctOrdinal !== undefined)) {
        refuseEdit(CHOICES_FORBIDDEN);
      }

      const storedOrdinals = stored.choices.map((choice) => choice.ordinal);
      const bodies = new Map(input.choices?.map((choice) => [choice.ordinal, choice.body]) ?? []);
      // An edit that names an ordinal twice is a restatement that contradicts
      // itself; the Map would silently keep the last one.
      if (bodies.size !== (input.choices?.length ?? 0)) refuseEdit(CHOICES_MISMATCHED);

      const edited = validatedEdit(
        {
          format: stored.format,
          prompt: input.prompt === undefined ? storedRichText(stored.prompt) : parsed(input.prompt),
          answer: multipleChoice
            ? null
            : input.answer === undefined
              ? stored.answer === null
                ? null
                : storedRichText(stored.answer)
              : parsed(input.answer),
          choices: stored.choices.map((choice) => ({
            ordinal: choice.ordinal,
            body:
              bodies.get(choice.ordinal) === undefined
                ? storedRichText(choice.body)
                : parsed(bodies.get(choice.ordinal)!),
            // Absent `correctOrdinal` on a Multiple Choice edit leaves no
            // option flagged and is refused below: an edit of the options
            // states which one is right, rather than inheriting an answer that
            // may no longer belong to the body it was flagged on.
            isCorrect: choice.ordinal === input.correctOrdinal,
          })),
        },
        // Restated in full or not at all — but only when it was restated: an
        // edit that touches no option leaves every stored body where it is.
        input.choices === undefined ? storedOrdinals : [...bodies.keys()],
      );

      const writtenQuestion = await tx.practiceTestQuestion.updateMany({
        where: { id: stored.id },
        data: {
          prompt: edited.prompt,
          // `DbNull` rather than a bare `null`, for the reason `land` states:
          // on a nullable Json column Prisma refuses an ambiguous `null`.
          answer: edited.answer ?? Prisma.DbNull,
        },
      });
      // Deleted between the read above and this statement: the same 404 the
      // choices loop below gives a removed option, not Prisma's own fault.
      if (writtenQuestion.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      for (const choice of edited.choices) {
        const written = await tx.practiceTestChoice.updateMany({
          where: { questionId: stored.id, ordinal: choice.ordinal },
          data: { body: choice.body, isCorrect: choice.isCorrect },
        });
        // A row that was not there to write is an option removed between the
        // read above and this statement. Answering 200 on a write that landed
        // nowhere would tell a parent their option was rewritten when it was
        // not, so the whole edit rolls back on the module's one sentence.
        if (written.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      }

      return this.draftViewIn(tx, parentAccountId, practiceTestId);
    });

    // After the commit, never inside it: a log line written in the transaction
    // survives a rollback and would assert an edit that never landed.
    // Identifiers only — not a word of the prompt, the option or the Topic that
    // was just rewritten (AD-20).
    this.logger.log(`Practice test ${practiceTestId} had question ${questionId} edited.`);
    return view;
  }

  /**
   * Deletes one Question of a draft, renumbers what is left, and discards the
   * Practice Test when nothing is left at all.
   *
   * One transaction, and it has to be: the delete, the renumber and the
   * `questionCount` rewrite are one fact about the draft, and committing any
   * two of them without the third leaves the stored count disagreeing with the
   * list, or leaves a gap in the heading numbers a parent reads as a Question
   * that vanished.
   *
   * Deleting the **last** Question sets `Discarded` here and by no other path —
   * the acceptance criterion names it, and `Released` has no path in this story
   * at all. `chargedAt` is neither cleared nor rewritten: a discard does not
   * refund (AD-14).
   */
  async deleteQuestion(
    parentAccountId: string,
    practiceTestId: string,
    questionId: string,
  ): Promise<PracticeTestDraftView> {
    const { view, discarded } = await this.prisma.withTransaction(async (tx) => {
      const removed = await tx.practiceTestQuestion.deleteMany({
        where: {
          id: questionId,
          practiceTestId,
          practiceTest: { parentAccountId, status: 'Draft' },
        },
      });
      // Nothing removed is the one refusal every other id shape gets: an
      // unknown question, one of another draft, a released draft, a foreign
      // account (AD-18). Scoped inside the statement, never checked before it.
      if (removed.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const survivors = await tx.practiceTestQuestion.findMany({
        where: { practiceTestId },
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      await this.rewriteQuestionOrdinals(
        tx,
        practiceTestId,
        survivors.map((question) => question.id),
      );

      await tx.practiceTest.update({
        where: { id: practiceTestId },
        data: {
          questionCount: survivors.length,
          // The last Question taken away leaves a Practice Test with nothing in
          // it, which is not a thing to release. `chargedAt` is absent on
          // purpose: a discard does not refund (AD-14).
          ...(survivors.length === 0 ? { status: 'Discarded' as PracticeTestStatus } : {}),
        },
        select: { id: true },
      });

      if (survivors.length > 0) {
        return {
          view: await this.draftViewIn(tx, parentAccountId, practiceTestId),
          discarded: false,
        };
      }

      // The draft is no longer a draft, so the `Draft`-scoped read above would
      // refuse it — correctly, and with the same sentence an unknown id gets.
      // The view is built here instead, carrying `status: 'Discarded'` and no
      // questions, because that is the honest answer to what just happened: the
      // screen reads the status and goes back to Pending drafts rather than
      // having to read a refusal as a success. A later read of the same id does
      // answer the ordinary 404, which is the acceptance criterion.
      const row = await tx.practiceTest.findFirst({
        where: { id: practiceTestId, parentAccountId },
        select: DRAFT_SELECT,
      });
      // The row this same transaction just discarded, gone by the time it is
      // read back: the module's one sentence, not Prisma's own missing-row fault.
      if (row === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      return {
        view: draftViewOf(
          row,
          await tx.practiceTest.count({
            where: { parentAccountId, generationJobId: row.generationJobId, status: 'Draft' },
          }),
        ),
        discarded: true,
      };
    });

    // Identifiers and counts. Never a word of what was deleted (AD-20).
    this.logger.log(
      discarded
        ? `Practice test ${practiceTestId} was discarded: its last question ${questionId} was deleted.`
        : `Practice test ${practiceTestId} had question ${questionId} deleted.`,
    );
    return view;
  }

  /**
   * Releases a draft: the gate opens, and the child it was made for can see it.
   *
   * One-way in v0. There is no route, flag or parameter anywhere that returns a
   * `Released` row to `Draft`, and the irreversibility is not a promise about
   * that — it is the `where` of the statement below. A second release matches no
   * row and answers the module's one sentence, indistinguishable from the answer
   * an unknown id, a foreign id or an already-discarded id gets (AD-18).
   *
   * `chargedAt` is untouched and no allowance figure is written: the derived
   * usage count counts rows that have *ever* reached draft, so neither
   * transition changes it (AD-14).
   */
  async release(parentAccountId: string, practiceTestId: string): Promise<PracticeTestDraftView> {
    return this.transitionTo(parentAccountId, practiceTestId, 'Released');
  }

  /**
   * Discards a draft: the child never sees it, and nothing downstream can reach
   * it.
   *
   * No refund (AD-14) — the confirmation said so in words before this was ever
   * called — and no `chargedAt` rewrite. Exclusion from Analytics is inherited
   * rather than implemented: `practicetest` owns these tables (AD-17) and the one
   * cross-boundary read of a Practice Test scopes `status: 'Released'`, so a
   * discarded row is unreachable rather than filtered.
   *
   * A `Released` row is refused here too: release is terminal, and discarding
   * something a child has already been shown is not a state this story owns.
   */
  async discard(parentAccountId: string, practiceTestId: string): Promise<PracticeTestDraftView> {
    return this.transitionTo(parentAccountId, practiceTestId, 'Discarded');
  }

  /**
   * The one shape both terminal transitions have, written once.
   *
   * `updateMany` with the state in the `where`, and not `update` after a check: a
   * row released by another tab between a read and this statement would make the
   * check stale, and `update` would surface Prisma's own missing-row fault as a
   * 500 rather than as this module's own answer.
   *
   * The answer is the full draft view carrying the **new** status, built here
   * exactly as `deleteQuestion`'s discard branch already builds it for a row that
   * is no longer a draft — the screen reads the status rather than inferring
   * success from a bare 204.
   */
  private async transitionTo(
    parentAccountId: string,
    practiceTestId: string,
    to: Extract<PracticeTestStatus, 'Released' | 'Discarded'>,
  ): Promise<PracticeTestDraftView> {
    const view = await this.prisma.withTransaction(async (tx) => {
      const moved = await tx.practiceTest.updateMany({
        where: { id: practiceTestId, parentAccountId, status: 'Draft' },
        // `chargedAt` is absent on purpose: neither transition refunds (AD-14).
        data: { status: to },
      });
      // Not a draft any more is indistinguishable from never having been this
      // account's, which is the whole point: a second sentence for one rule
      // would let the outside enumerate which of another account's ids exist.
      if (moved.count !== 1) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      // The row is no longer a draft, so the `Draft`-scoped reader would refuse
      // it — correctly. The view is built here instead, as `deleteQuestion`'s
      // discard branch already does.
      const row = await tx.practiceTest.findFirst({
        where: { id: practiceTestId, parentAccountId },
        select: DRAFT_SELECT,
      });
      // The row this same transaction just moved, gone by the time it is read
      // back: the module's one sentence, not Prisma's own missing-row fault.
      if (row === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);
      return draftViewOf(
        row,
        await tx.practiceTest.count({
          where: { parentAccountId, generationJobId: row.generationJobId, status: 'Draft' },
        }),
      );
    });

    // After the commit, never inside it: a log line written in the transaction
    // survives a rollback and would assert a transition that never landed.
    // Identifiers only — no Question text, no Topic label, no allowance figure,
    // no tier, no model name (AD-20).
    this.logger.log(
      to === 'Released'
        ? `Practice test ${practiceTestId} was released.`
        : `Practice test ${practiceTestId} was discarded.`,
    );
    return view;
  }

  /**
   * The two-phase ordinal rewrite `@@unique([practiceTestId, ordinal])` forces,
   * exactly as `source-test.service.ts` does it for pages.
   *
   * A straight rewrite collides mid-statement — moving question 3 to 2 hits the
   * row still sitting at 2 — so every ordinal is first moved out of the
   * positive range in one statement, then written back as `1..N`. Both phases
   * are inside the caller's transaction, so no other reader ever observes the
   * negative interval and the contiguity invariant holds at every committed
   * boundary.
   */
  private async rewriteQuestionOrdinals(
    tx: TransactionClient,
    practiceTestId: string,
    orderedIds: readonly string[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    await tx.$executeRaw`UPDATE "practice_test_question" SET "ordinal" = -"ordinal" WHERE "practiceTestId" = ${practiceTestId}`;
    for (const { id, ordinal } of renumbered(orderedIds)) {
      // `updateMany`, not `update`: a row removed between the read above and
      // this statement would make `update` throw Prisma's missing-row fault,
      // which would escape as a 500 rather than as this module's own answer.
      await tx.practiceTestQuestion.updateMany({
        where: { id, practiceTestId },
        data: { ordinal },
      });
    }
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
 * A stored rich-text column, on its way back out.
 *
 * A cast and nothing else, deliberately. Every one of these columns went
 * through `parseRichText` before it was written (AD-32, AD-30), so the shape is
 * already an invariant of the row; re-parsing here would be a second reading of
 * a value neither reading wrote, and a second place for the two to disagree.
 * The cast is named rather than sprinkled so there is exactly one line in the
 * module that asserts it.
 */
function storedRichText(value: Prisma.JsonValue): RichText {
  return value as unknown as RichText;
}

/**
 * Everything the review screen reads a draft by, selected in one place.
 *
 * One `select` for the read and for both mutations, so an edit's answer and a
 * first load are the same shape by construction rather than by two lists being
 * kept in step by hand.
 */
const DRAFT_SELECT = {
  id: true,
  sourceTestId: true,
  studentProfileId: true,
  status: true,
  generationJobId: true,
  ordinal: true,
  questionCount: true,
  createdAt: true,
  questions: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      ordinal: true,
      format: true,
      prompt: true,
      answer: true,
      choices: {
        orderBy: { ordinal: 'asc' },
        select: { ordinal: true, body: true, isCorrect: true },
      },
      topics: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { label: true },
      },
    },
  },
} as const satisfies Prisma.PracticeTestSelect;

type DraftRow = Prisma.PracticeTestGetPayload<{ select: typeof DRAFT_SELECT }>;

/**
 * The stored draft as the screen reads it.
 *
 * The stored `Json` travels out as it is stored. It was parsed by
 * `parseRichText` on the way in — by generation, or by the edit path's single
 * inverse — and re-parsing on the way out would be a second chance for the two
 * readings to disagree about a row neither of them wrote.
 */
function draftViewOf(draft: DraftRow, siblingCount: number): PracticeTestDraftView {
  return {
    id: draft.id,
    sourceTestId: draft.sourceTestId,
    studentProfileId: draft.studentProfileId,
    status: draft.status,
    ordinal: draft.ordinal,
    siblingCount,
    questionCount: draft.questionCount,
    createdAt: draft.createdAt.toISOString(),
    questions: draft.questions.map((question) => ({
      id: question.id,
      ordinal: question.ordinal,
      format: question.format,
      prompt: storedRichText(question.prompt),
      // A MultipleChoice question's column is SQL NULL, and Prisma reads it
      // back as `null` — the flagged choice is the answer.
      answer: question.answer === null ? null : storedRichText(question.answer),
      choices: question.choices.map((choice) => ({
        ordinal: choice.ordinal,
        body: storedRichText(choice.body),
        isCorrect: choice.isCorrect,
      })),
      topics: question.topics.map((topic) => topic.label),
    })),
  };
}

/**
 * One edit's whole payload, as the controller hands it over: plain text, and
 * nothing already turned into segments.
 *
 * Every field is optional and an absent field means "leave what is stored",
 * which is what makes editing one option body a one-field request rather than a
 * restatement of the whole Question.
 *
 * **One exception, and it is deliberate.** A Multiple Choice edit must always
 * restate `correctOrdinal`: an absent one leaves no option flagged and is
 * refused `ONE_CORRECT_CHOICE_REQUIRED`. Inheriting the stored flag would mean
 * an edit that rewrote the option bodies could silently leave "correct" on a
 * body that no longer says what it said when it was flagged.
 */
export interface EditQuestionInput {
  prompt?: string;
  answer?: string;
  choices?: { ordinal: number; body: string }[];
  correctOrdinal?: number;
}

/** A fixed sentence of this module's own, as the 400 a parent's edit gets. */
function refuseEdit(message: string): never {
  throw new BadRequestException(message);
}

/**
 * Plain text as the segments it will be stored as (AD-32).
 *
 * An empty field, a whitespace-only field and a zero denominator all throw out
 * of `parseRichText`, and each is a thing a parent typed rather than a fault of
 * this server — so each becomes a 400 carrying the rich-text module's own
 * sentence, and nothing is written.
 */
function parsed(text: string): RichText {
  try {
    return richTextFromPlainText(text);
  } catch (cause) {
    throw new BadRequestException(cause instanceof Error ? cause.message : RICH_TEXT_EMPTY);
  }
}

/**
 * The shared Question invariants, answered as the 400 an edit gets.
 *
 * The rules are the payload module's — one set for a generated payload and a
 * parent edit alike — and only the *fault* differs: nothing here is retried,
 * because no provider is at fault.
 */
function validatedEdit(edited: EditedQuestion, storedOrdinals: readonly number[]): EditedQuestion {
  try {
    return validateEditedQuestion(edited, storedOrdinals);
  } catch (cause) {
    if (cause instanceof EditedQuestionInvalid) throw new BadRequestException(cause.message);
    throw cause;
  }
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
