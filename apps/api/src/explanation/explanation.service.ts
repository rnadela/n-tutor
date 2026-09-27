import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { AllowanceService } from '../allowance/allowance.service.js';
import type { RichText } from '../extraction/rich-text.js';
import {
  PracticeTestService,
  type ExplanationInput,
} from '../practicetest/practice-test.service.js';
import { remainingFor } from '../practicetest/practice-test-policy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PARENT_FLAG_ORIGIN,
  parentExplanationViews,
  type ParentExplanationView,
} from './explanation-flag.js';
import { ExplanationPayloadInvalid, validateExplanationPayload } from './explanation-payload.js';
import {
  EXPLANATION_FAILED,
  NO_EXPLANATION_ALLOWANCE,
  NO_EXPLANATION_TO_FLAG,
} from './explanation-policy.js';
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

/**
 * A parent reading or flagging their child's Explanations, with **only** the
 * account.
 *
 * Only the account, and deliberately not an optional profile beside it: a parent's
 * entitlement *is* the account, and the child whose rows are read is resolved from
 * the Attempt row through `attemptProfileFor`. A profile id that could be passed
 * here is a profile id that could be paired with another child's Attempt, and the
 * way to make that unexpressible is for the scope to have nowhere to put one.
 *
 * `GradingScope` makes the same distinction with an optional field, because the same
 * method there serves both parties. These two paths serve only the parent, so the
 * type says so.
 */
export interface ParentScope {
  parentAccountId: string;
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
 * - **It holds no delegate of anybody else's tables.** Two reads cross the
 *   boundary — `PracticeTestService.explanationInputFor` for the student path,
 *   which brings the ownership proof, the Question, both answers and the Practice
 *   Test's Grade Level with it, and `attemptProfileFor` for the parent paths,
 *   which brings the ownership proof and which child sat the Attempt. There is no
 *   `practiceTest`, `attempt`, `answer`, `sourceTest` or taxonomy delegate here,
 *   and no `ai_call` write (AD-17).
 * - **Since Story 6.2 it also owns `explanation_flag`, and is its sole writer**
 *   (AD-17). The parent paths below are pure reads and one idempotent record:
 *   neither generates, neither consumes allowance, and a flag changes nothing —
 *   not the prose, not what the child is served, not a grade, not a score.
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

  /**
   * Every Explanation stored for one handed-in Attempt, as the parent reads them.
   *
   * **A pure read.** No provider call, no allowance read, no `Explanation` write and
   * no `chargedAt` touched. An Explanation the child never asked for does not exist
   * and is not generated here: a parent opening an Attempt with ten unexplained
   * Questions would otherwise bill ten provider calls against their own Explanation
   * Allowance for prose nobody asked for, and the child's own screen would then find
   * it already there. So this method is `findMany` and nothing else, and it shares no
   * code path with `explanationFor`.
   *
   * **The profile is resolved first, and never passed.** `attemptProfileFor` is both
   * the ownership proof and the answer to "which child's rows": a foreign Attempt, an
   * unknown id and one still open all throw the single `PRACTICE_TEST_NOT_FOUND`
   * sentence from there, before this method reads a row (AD-18). The `where` below is
   * then `(attemptId, studentProfileId)` with the profile off the Attempt itself,
   * which is what makes a sibling's Explanation of the same Practice Test
   * unreachable — a sibling sat a *different* Attempt, and their rows are keyed to it.
   *
   * A Question with no stored row is **absent**, not an empty entry: the screen is
   * what says nothing was explained, and an invented entry would be
   * indistinguishable from prose that came back blank.
   *
   * Only the parent-originated flag is read. Story 6.3's student-originated one has
   * no reader here and Story 6.4's suppression has no column here, so neither can
   * leak into this response ahead of the story that owns it.
   */
  async explanationsForAttempt(
    scope: ParentScope,
    attemptId: string,
  ): Promise<ParentExplanationView[]> {
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );

    const rows = await this.prisma.explanation.findMany({
      where: { attemptId, studentProfileId },
      // The order the child asked in, which is a stable order and not a meaningful one:
      // the screen keys these by Question id onto answer-key rows that are already in
      // the order the child met them. It is stated so the response is deterministic
      // rather than whatever the planner returns, and nothing downstream reads it.
      orderBy: { createdAt: 'asc' },
      select: {
        questionId: true,
        body: true,
        // Filtered to the one origin this story writes, so the count of rows here is
        // 0 or 1 by the unique key rather than by a mapper's discipline. `chargedAt`
        // is deliberately not selected: what an Explanation cost is not a thing this
        // response carries (AD-20, AD-26).
        flags: { where: { origin: PARENT_FLAG_ORIGIN }, select: { createdAt: true } },
      },
    });
    return parentExplanationViews(rows);
  }

  /**
   * Records that a parent has a concern about one Explanation, and answers with the
   * instant it was first recorded.
   *
   * **Idempotent per (Explanation, origin), by the index and not by a check.** The
   * write is an `upsert` on `[explanationId, origin]` whose update arm sets nothing
   * that matters, so a second press finds the first row, keeps its `createdAt` and
   * answers the same instant. A parent pressing twice raised one concern; a `create`
   * with a preceding existence check would race itself into a unique violation on
   * exactly the double-tap this is about.
   *
   * **And the upsert is not atomic either**, which is why there is a P2002 arm below
   * it. It reads and then writes, so two presses landing together can both find no row
   * and both attempt the insert; the index refuses the loser, and the loser's answer is
   * the winner's row, re-read by the same key. So idempotency holds under concurrency
   * as well as in sequence, and the one case this method exists for cannot be the one
   * case that 500s.
   *
   * **It changes nothing else.** Not the Explanation's body, not what the child is
   * served, not the grade state, the Attempt's score or Mastery. There is no
   * suppression here (Story 6.4), no disposition (Story 6.3) and no grade override
   * (Story 6.5) — and no write to any other table, which is why this needs no
   * transaction: there is one row to write and nothing anywhere that has to stay
   * consistent with it.
   *
   * **The ownership proof runs first**, through `attemptProfileFor`, then the
   * Explanation is found by `(attemptId, questionId, studentProfileId)` with the
   * profile off the Attempt row. A Question the child never asked about has no row and
   * answers the same `PRACTICE_TEST_NOT_FOUND` sentence a foreign Attempt gets: a
   * flag is a record *about an Explanation*, so there is nothing to record against,
   * and a second sentence would let the outside tell "no Explanation" from "not your
   * Attempt".
   *
   * The two denormalized ids on the flag row are the **Explanation's own**, read back
   * from the row this write is about — never the scope's account and never a
   * parameter. They are the same by construction here, and taking them from the row
   * means a future path that got the scoping wrong writes an inconsistent flag rather
   * than a consistent lie.
   */
  async flagExplanation(
    scope: ParentScope,
    attemptId: string,
    questionId: string,
  ): Promise<ParentExplanationView> {
    const { studentProfileId } = await this.practiceTests.attemptProfileFor(
      scope.parentAccountId,
      attemptId,
    );

    const stored = await this.prisma.explanation.findUnique({
      where: {
        attemptId_questionId_studentProfileId: { attemptId, questionId, studentProfileId },
      },
      select: {
        id: true,
        questionId: true,
        body: true,
        parentAccountId: true,
        studentProfileId: true,
      },
    });
    // A Question nobody asked about, on an Attempt this parent may read. The same
    // sentence a foreign Attempt gets: there is no Explanation for a flag to be
    // about.
    if (stored === null) throw new NotFoundException(NO_EXPLANATION_TO_FLAG);

    const key = { explanationId: stored.id, origin: PARENT_FLAG_ORIGIN };
    let flag: { createdAt: Date };
    try {
      flag = await this.prisma.explanationFlag.upsert({
        where: { explanationId_origin: key },
        create: {
          explanationId: stored.id,
          // The Explanation's own columns, read back from the row above.
          parentAccountId: stored.parentAccountId,
          studentProfileId: stored.studentProfileId,
          origin: PARENT_FLAG_ORIGIN,
        },
        // Nothing. The second press is the same concern, and `createdAt` is the instant
        // it was first raised — an update arm that touched it would make a repeat press
        // rewrite the one fact this row holds. `updatedAt` moves, which is Prisma's and
        // is not read by anything.
        update: {},
        select: { createdAt: true },
      });
    } catch (cause) {
      // Two first presses at once. An `upsert` is a read and then a write, not one
      // atomic statement: both requests can find no row, both can attempt the insert,
      // and the unique key refuses the loser with P2002 — which is exactly the
      // double-tap this method exists to absorb, so answering 500 for it would be the
      // one case it was written for. The recovery is the same one `explanationFor`
      // makes for the same reason: the loser's answer is the winner's row.
      if (!isUniqueViolation(cause)) throw cause;
      flag = await this.prisma.explanationFlag.findUniqueOrThrow({
        where: { explanationId_origin: key },
        select: { createdAt: true },
      });
      this.logger.log(
        `A parent flag against the explanation of question ${questionId} of attempt ${attemptId} was already recorded by a concurrent request.`,
      );
    }

    // The Attempt, the Question and that a flag exists. Never a fragment of the
    // prose it is about, and never a cost, a tier or a model name (AD-20, AD-26).
    this.logger.log(
      `A parent flag is recorded against the explanation of question ${questionId} of attempt ${attemptId}.`,
    );

    const [view] = parentExplanationViews([
      { questionId: stored.questionId, body: stored.body, flags: [flag] },
    ]);
    // One row in, one row out. Stated rather than asserted away, so a future change
    // to the mapper cannot make a non-null assertion quietly wrong.
    if (view === undefined) throw new ExplanationUnavailable();
    return view;
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
