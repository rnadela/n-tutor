import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import type { RichText } from '../extraction/rich-text.js';
import {
  PracticeTestService,
  type ExplanationInput,
} from '../practicetest/practice-test.service.js';
import { remainingFor } from '../practicetest/practice-test-policy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExplanationPayloadInvalid, validateExplanationPayload } from './explanation-payload.js';
import { EXPLANATION_FAILED, NO_EXPLANATION_ALLOWANCE } from './explanation-policy.js';
import { buildExplanationPrompt } from './explanation-prompt.js';
import {
  EXPLANATION_SCHEMA_NAME,
  ExplanationPayload,
  fakeExplanationPayload,
} from './explanation-schema.js';

/**
 * A child asking about their own work, with **both** ids required.
 *
 * Both, and not optionally the profile: an Explanation is written for the child
 * who sat the Attempt and is cached under their id, so a caller without one has no
 * cache key to read and no register to pitch at. The parent-side reading surface
 * is Story 6.3's, and it will bring its own scope rather than widening this one.
 */
export interface StudentScope {
  parentAccountId: string;
  studentProfileId: string;
}

/** One Explanation as the child reading it gets it back. */
export interface ExplanationView {
  attemptId: string;
  questionId: string;
  /** The stored segments, exactly as stored (AD-32). */
  body: RichText;
}

/** An Explanation, and whether this call is what produced it. */
export interface ExplanationOutcome {
  view: ExplanationView;
  /**
   * True only when this call generated and wrote the row. The controller turns
   * it into 201 against 200, which is the whole observable difference between a
   * call that billed a provider and one that read a row.
   */
  generated: boolean;
}

/**
 * Every provider fault, absorbed into one sentence and one status.
 *
 * **503 rather than 500**, and rather than four statuses for four fault classes. A
 * timeout, a refusal on the merits, a request this service could not make and a
 * payload the post-hoc pass kept rejecting are four facts about a system, none of
 * them a fact about the Question or about the child — and 503 is the one that says
 * the honest thing to the only reader who matters here: not now, try again. It is
 * a `ServiceUnavailableException` rather than a plain error so nothing between here
 * and the wire has to remember to map it, and so no class of upstream fault can
 * survive into what a child reads (AD-20).
 *
 * Nothing retries it. The child pressing again is the retry.
 */
export class ExplanationUnavailable extends ServiceUnavailableException {
  constructor() {
    super(EXPLANATION_FAILED);
    this.name = 'ExplanationUnavailable';
  }
}

/**
 * The `explanation` module's one service: sole owner and sole writer of
 * `Explanation` (AD-17).
 *
 * Four rules hold every path here together.
 *
 * - **The stored row is read first, before `allowance` and before `ai`.** That is
 *   what makes "a re-read is free" a property of the code rather than a promise:
 *   a second ask for the same `(attemptId, questionId, studentProfileId)` cannot
 *   reach a provider call, because it returns two statements earlier.
 * - **Charging is the row.** There is no counter to debit and nothing to
 *   reconcile: `chargedAt` on the row *is* the charge, and counting rows in the
 *   period window is the usage (AD-14). Which is why the re-count and the insert
 *   share one transaction — outside it, two concurrent presses on a Free account
 *   with one unit left could each read "remaining = 1".
 * - **It holds no delegate of anybody else's tables.** One read crosses the
 *   boundary — `PracticeTestService.explanationInputFor` — and it brings the
 *   ownership proof, the Question, both answers and the Practice Test's Grade
 *   Level with it. There is no `practiceTest`, `attempt`, `answer`, `sourceTest`
 *   or taxonomy delegate here, and no `ai_call` write (AD-17).
 * - **Nothing it logs or throws carries a fragment of generated content, a cost,
 *   a model name, a tier or an allowance figure** (AD-20, AD-26). Identifiers and
 *   counts only.
 */
@Injectable()
export class ExplanationService {
  private readonly logger = new Logger(ExplanationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly allowance: AllowanceService,
    private readonly practiceTests: PracticeTestService,
  ) {}

  /**
   * One Question's Explanation: the stored one if there is one, a new one if
   * there is allowance for it, and one refusal each for the two ways there is not.
   *
   * The ownership proof happens **first**, through `explanationInputFor`, even on
   * the cached path. It is what turns a foreign Attempt, a sibling's, an unknown
   * id, one still open and an alien Question into the single
   * `PRACTICE_TEST_NOT_FOUND` sentence (AD-18) — and reading a stored row by its
   * three ids before proving the binding would answer a stranger's id with a 404
   * for one reason and a row for another, which is exactly the difference an
   * enumeration attack reads.
   */
  async explanationFor(
    scope: StudentScope,
    attemptId: string,
    questionId: string,
  ): Promise<ExplanationOutcome> {
    const input = await this.practiceTests.explanationInputFor(
      scope.parentAccountId,
      scope.studentProfileId,
      attemptId,
      questionId,
    );

    // The read-through cache, and the reason a re-read is provably free: nothing
    // below this line runs for a Question that already has one.
    const stored = await this.prisma.explanation.findUnique({
      where: {
        attemptId_questionId_studentProfileId: {
          attemptId,
          questionId,
          studentProfileId: scope.studentProfileId,
        },
      },
      select: { body: true },
    });
    if (stored !== null) {
      return {
        view: { attemptId, questionId, body: stored.body as RichText },
        generated: false,
      };
    }

    // Read before the provider call, so an account with nothing left is refused
    // without spending one. The authoritative check is the re-count inside the
    // write transaction below; this one exists so a capped account is told so
    // before a model is asked to write prose nobody will be given.
    const consumption = await this.allowance.consumptionFor(scope.parentAccountId);
    if (
      remainingFor(
        consumption.allowances.explanation.used,
        consumption.allowances.explanation.limit,
      ) === 0
    ) {
      throw new ConflictException(NO_EXPLANATION_ALLOWANCE);
    }

    // A Question whose stored prompt or correct answer could not be read degrades
    // to an empty span, and an explanation built around one is worse than none: it
    // would be invented, stored, charged and read by a child. Refused with the
    // same sentence every other fault gets, and nothing is charged for it. The
    // student's own answer is exempt — an empty string there is a real blank, not
    // a read failure.
    if (input.prompt.trim() === '' || input.correctAnswer.trim() === '') {
      this.logger.warn(
        `An explanation for question ${questionId} of attempt ${attemptId} was refused: the stored question or correct answer could not be read.`,
      );
      throw new ExplanationUnavailable();
    }

    const body = await this.write(scope.parentAccountId, input, attemptId, questionId);

    // Read again rather than reusing the figures above: a provider call takes
    // seconds to tens of seconds, and in that time the period can turn over or the
    // account's tier can change. Counting the window that was current when the
    // press started would charge a row into a period the count never measured.
    const authoritative = await this.allowance.consumptionFor(scope.parentAccountId);
    const limit = authoritative.allowances.explanation.limit;
    const windowStart = new Date(authoritative.periodStart);
    const windowEnd = new Date(authoritative.periodEnd);

    let row: { body: unknown };
    try {
      row = await this.prisma.withTransaction(async (tx) => {
        // Counted again, inside the transaction that writes the row. Derived from
        // charged rows — never a counter column, and never decremented (AD-14).
        // The same known, deferred gap `practicetest`'s own charging seam carries:
        // Postgres's default Read Committed isolation lets two concurrent requests
        // read the same pre-charge usage, so this narrows the window rather than
        // closing it.
        const charged = await tx.explanation.count({
          where: {
            parentAccountId: scope.parentAccountId,
            chargedAt: { gte: windowStart, lt: windowEnd },
          },
        });
        if (remainingFor(charged, limit) === 0) {
          throw new ConflictException(NO_EXPLANATION_ALLOWANCE);
        }
        return tx.explanation.create({
          data: {
            parentAccountId: scope.parentAccountId,
            studentProfileId: scope.studentProfileId,
            attemptId,
            questionId,
            body,
            // The durable marker the Explanation Allowance is counted from (AD-14).
            // Written here, in the transaction that writes the row, so a paid call
            // is never uncounted and a refused one never charges.
            chargedAt: new Date(),
          },
          select: { body: true },
        });
      });
    } catch (cause) {
      // Two first presses for the same Question at once: the unique key refuses
      // the loser, and the loser's answer is the winner's row. A child is never
      // shown a fault for having been quick, and this call's own body is dropped
      // rather than written as a second row. The re-read is outside the aborted
      // transaction, which cannot run another statement.
      if (!isUniqueViolation(cause)) throw cause;
      const winner = await this.prisma.explanation.findUniqueOrThrow({
        where: {
          attemptId_questionId_studentProfileId: {
            attemptId,
            questionId,
            studentProfileId: scope.studentProfileId,
          },
        },
        select: { body: true },
      });
      this.logger.log(
        `An explanation for question ${questionId} of attempt ${attemptId} was already written by a concurrent request.`,
      );
      return {
        view: { attemptId, questionId, body: winner.body as RichText },
        generated: false,
      };
    }

    // The Attempt, the Question, and nothing about what was written (AD-20).
    this.logger.log(
      `An explanation was written for question ${questionId} of attempt ${attemptId}.`,
    );
    return {
      view: { attemptId, questionId, body: row.body as RichText },
      generated: true,
    };
  }

  // --- Internals ---------------------------------------------------------

  /**
   * One `Explanation` call, re-issued while the post-hoc pass keeps rejecting what
   * came back, degrading to a refusal rather than to a guess.
   *
   * The retry is the same one `GradingService.judge` makes, for the same reason: a
   * body that holds no segments, or one that runs to a wall of text, is the
   * provider's fault (AD-31) and `AiService`'s own loop cannot see it, because the
   * payload parsed and the call returned. Bounded by the same `maxAttempts` figure
   * upstream faults are retried under.
   *
   * **Every failure class ends the same way**: `ExplanationUnavailable`, which the
   * controller turns into the single `EXPLANATION_FAILED` sentence. An
   * `AiInputError` and an `AiRejectedError` escape `AiService`'s own loop
   * immediately and are caught here; an exhausted `AiUpstreamError` and an
   * exhausted rejection arrive here too. Nothing is written and nothing is charged
   * on any of them — the charge is the row, and there is no row.
   */
  private async write(
    parentAccountId: string,
    input: ExplanationInput,
    attemptId: string,
    questionId: string,
  ): Promise<RichText> {
    const asked = {
      ordinal: input.ordinal,
      format: input.format,
      prompt: input.prompt,
      studentAnswer: input.studentAnswer,
      correctAnswer: input.correctAnswer,
      gradeLevelName: input.gradeLevelName,
    };
    const maxAttempts = this.ai.config.maxAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let payload: ExplanationPayload;
      try {
        ({ payload } = await this.ai.run({
          callClass: 'Explanation',
          // Whose cost row this is. The account the binding named, never a claim
          // on the request — `ai` is the sole writer of `ai_call` and this module
          // never touches it (AD-17, AD-20).
          parentAccountId,
          // Text in, text out: this call reads stored text, never a photograph.
          // Stated rather than inferred from an empty array.
          modality: 'text',
          images: [],
          prompt: buildExplanationPrompt(asked),
          schema: ExplanationPayload,
          schemaName: EXPLANATION_SCHEMA_NAME,
          fakePayload: ({ failure }) => fakeExplanationPayload({ ordinal: asked.ordinal, failure }),
        }));
      } catch (cause) {
        // The three fault classes, and all of them end here. The Attempt, the
        // Question and the class of fault; never a word the model wrote (AD-20).
        if (
          cause instanceof AiInputError ||
          cause instanceof AiRejectedError ||
          cause instanceof AiUpstreamError
        ) {
          this.logger.warn(
            `An explanation for question ${questionId} of attempt ${attemptId} could not be written (${cause.name}).`,
          );
          throw new ExplanationUnavailable();
        }
        throw cause;
      }

      try {
        return validateExplanationPayload(payload);
      } catch (cause) {
        // Only a post-hoc rejection is worth asking again for. Anything else is
        // this module's own fault and is not made better by repetition.
        if (!(cause instanceof ExplanationPayloadInvalid)) throw cause;
        // The ids and the attempt number. Never the rule that was broken in the
        // model's own words, and never a fragment of what it wrote (AD-20).
        this.logger.warn(
          `An explanation payload for question ${questionId} of attempt ${attemptId} was rejected after parsing on attempt ${attempt} of ${maxAttempts}.`,
        );
      }
    }
    this.logger.warn(
      `An explanation for question ${questionId} of attempt ${attemptId} was rejected on every attempt.`,
    );
    throw new ExplanationUnavailable();
  }
}

/**
 * Postgres's unique-violation code, as Prisma reports it.
 *
 * Read off the error's shape rather than by importing the Prisma error class,
 * which is the house pattern for a check that only ever asks one question of it.
 */
function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'P2002'
  );
}
