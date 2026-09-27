import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GradeState } from '../generated/prisma/enums.js';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { plainTextOf } from '../extraction/rich-text.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { PRACTICE_TEST_NOT_FOUND } from '../practicetest/practice-test-policy.js';
import {
  PracticeTestService,
  type AttemptGradingInput,
  type AttemptSubmissionView,
  type GradingQuestionInput,
} from '../practicetest/practice-test.service.js';
import { buildGradingPrompt, type GradingPromptQuestion } from './grading-prompt.js';
import {
  GradingPayloadInvalid,
  validateGradingPayload,
  type NormalizedVerdict,
} from './grading-payload.js';
import { GRADING_SCHEMA_NAME, GradingPayload, fakeGradingPayload } from './grading-schema.js';
import { scoreOf, type AttemptScore } from './grading-score.js';

/** Who is asking. A parent reaches an Attempt by account; a child by both ids. */
export interface GradingScope {
  parentAccountId: string;
  /**
   * The child's own profile, when the caller is the child. Absent for a parent,
   * whose entitlement is the account — and absent is not "any child", it is "any
   * child of this account", which is what a parent may read.
   */
  studentProfileId?: string;
}

/** What one retry pass came to, for the read that triggered it. */
export interface UngradedResolution {
  /** Recomputed over the stored states, by FR-37's one denominator. */
  score: AttemptScore;
  /**
   * The Questions **this pass** turned into a verdict, in stored ordinal order.
   * Empty when nothing was outstanding and empty when the re-ask failed.
   */
  newlyGradedQuestionIds: string[];
}

/** A row this service is about to write or update. */
interface GradeRow {
  questionId: string;
  state: GradeState;
  /** Null for every state but a provider's own verdict. */
  rationale: string | null;
}

/** The two formats FR-21/FR-22 send to a provider. */
function isFreeText(question: GradingQuestionInput): boolean {
  return question.format === 'FillInTheBlank' || question.format === 'ShortAnswer';
}

/**
 * The `grading` module's service: sole owner and sole writer of `QuestionGrade`
 * (AD-6, AD-17).
 *
 * It reads `practicetest` through `PracticeTestService` and nothing reads it back:
 * the arrow is `grading -> practicetest`, one way, with no `forwardRef`. What that
 * arrow buys is the whole reason handing in lives here — closing an Attempt and
 * recording what its answers came to have to be one transaction (AD-4, AD-10), and
 * grade state may only be written by this module.
 *
 * All four of FR-37's literals are written here and nowhere else, each by one rule:
 * `Correct`/`Incorrect` from the deterministic Multiple Choice comparison and from
 * a provider's verdict on answered free text, `Incorrect` for a blank on an Attempt
 * the server judged expired, `Unanswered` for a blank on a manual hand-in, and
 * `Ungraded` only where grading *failed*.
 *
 * No Mastery recompute: FR-26 is Epic 7's, and AD-10's "recompute inside the
 * transaction that changed a grade" is satisfied here by there being nothing yet to
 * recompute.
 */
@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly practiceTests: PracticeTestService,
    private readonly ai: AiService,
  ) {}

  /**
   * Hands one Attempt in and grades it: the child's raw answers, the instant it
   * closed, and a grade row for every Question the paper presented.
   *
   * **Two transactions with one provider call between them.** AD-4 makes
   * submission block on grading and AD-10 puts the recompute of whatever a grade
   * changes inside the transaction that changed it — and Mastery, the only thing
   * AD-10 would bind here, does not exist yet. Meanwhile `withTransaction`'s own
   * doc says Prisma's ceiling is five seconds, and one `Grading` call can retry
   * with backoff well past that. So the close and every verdict that needs no
   * network are one transaction, the call is made outside it, and what came back
   * is written in a short second one.
   *
   * A crash in between leaves those Questions **row-less on a submitted Attempt**,
   * which is why absence is still not a pending state and why `resolveUngraded`
   * scopes to row-less Questions as well as to stored `Ungraded` ones: the two are
   * the same fact.
   *
   * **The deterministic half, inside the closing transaction.** A blank grades
   * `Unanswered` when the server judged the Attempt unexpired and `Incorrect` when
   * it did not — FR-37's two readings of an empty answer field, decided by the
   * column rather than at display time. An answered Multiple Choice Question is
   * compared in code against the option flagged correct, with no AI call and no
   * network: an unparseable or unknown ordinal is `Incorrect`, never `Ungraded`,
   * because no provider was involved.
   *
   * **Which Questions are blank is the server's answer, never the browser's.** It
   * is the Questions on that Practice Test minus the answer rows this same
   * transaction wrote. A body that omitted `answers` entirely is a paper where
   * every Question is blank, and a body naming one of another test's Questions
   * makes no Question blank that was not already.
   *
   * **The AI half is one batched call**, for every answered Fill-in-the-Blank and
   * Short Answer Question together, and no call at all when there are none. A
   * blank is never named in it and consumes no model call. Every failure class —
   * an input fault, a provider refusal, an exhausted upstream retry, a payload the
   * post-hoc pass kept rejecting — writes `Ungraded` for the Questions it could
   * not judge and lets the hand-in stand. `Ungraded` is a failure and never a
   * queue: nothing polls it, and a later read is what re-asks.
   *
   * The answer is `AttemptSubmissionView` unchanged: the same three fields, the
   * same 200, the same shape this route had before grade state existed. Not a
   * grade, not a state, not a score, not a rationale — this surface tells a child
   * nothing about their work.
   */
  async submitAttempt(
    parentAccountId: string,
    studentProfileId: string,
    attemptId: string,
    answers: readonly { questionId: string; value: string }[],
  ): Promise<AttemptSubmissionView> {
    const { view, input } = await this.prisma.withTransaction(async (tx) => {
      const closure = await this.practiceTests.closeAttempt(
        tx,
        parentAccountId,
        studentProfileId,
        attemptId,
        answers,
      );

      // The answer key beside the child's raw answers, read in the same
      // transaction that wrote them, so nothing between the write and the grade
      // can change what is being graded.
      const graded = await this.practiceTests.gradingInputFor(
        tx,
        parentAccountId,
        studentProfileId,
        attemptId,
      );

      const rows = deterministicRows(graded, graded.questions);
      if (rows.length > 0) {
        // `createMany` rather than the guarded write below: this transaction just
        // closed the Attempt conditionally, so it is the only writer that can be
        // here and there is no row of its own to overwrite.
        await tx.questionGrade.createMany({
          data: rows.map((row) => ({ attemptId, ...row })),
        });
      }

      // `blankQuestionIds` stops here. It was the reason for the transaction, not
      // something the response carries.
      return {
        view: {
          submittedAt: closure.submittedAt,
          expired: closure.expired,
          gradeAt: closure.gradeAt,
        },
        input: graded,
      };
    });

    // Outside the transaction, and outside its failure domain — which is why
    // **nothing from here on may throw**. The hand-in is committed: an error
    // escaping now would answer a child 500 for work the server kept, and their
    // retry would meet the 409 the close already earned. `judge` swallows the
    // three Ai fault classes itself, but a lost race on the unique index, a
    // dropped connection or a fault class nobody anticipated would not be, so the
    // whole of it is guarded rather than the parts of it that were foreseen.
    try {
      const asked = input.questions.filter((question) => askable(question));
      if (asked.length > 0) {
        const verdicts = await this.judge(parentAccountId, attemptId, asked);
        await this.prisma.withTransaction((tx) =>
          this.writeGuarded(tx, attemptId, rowsFromVerdicts(asked, verdicts)),
        );
      }
    } catch (cause) {
      // The Attempt and the class of fault. Never a Question, an answer, a
      // rationale or a word the model wrote (AD-20).
      //
      // Those Questions are left row-less on a submitted Attempt, which is exactly
      // the state `resolveUngraded` treats as a stored `Ungraded` — so the work is
      // not lost, it is outstanding.
      this.logger.error(
        `Grading after the hand-in of attempt ${attemptId} failed (${faultNameOf(cause)}); its answered free-text questions are left unjudged.`,
      );
    }

    return view;
  }

  /**
   * Re-asks for exactly the Questions nothing has judged, and reports what that
   * came to.
   *
   * FR-22 makes **viewing** the trigger: there is no background job, no queue, no
   * scheduled retry and nothing polling, so this is what a results read calls on
   * its way to answering. It has no route of its own yet — the results surface is
   * Story 5.6's, and a route here would be this story guessing at its shape.
   *
   * The scope is a stored `Ungraded` **or no row at all**. On a submitted Attempt
   * those are one fact — nothing has judged this — because the deterministic
   * verdicts are written by the transaction that closed the Attempt, so a row-less
   * Question is one the provider call never delivered or never reached.
   *
   * Nothing outstanding makes no AI call at all and reports nothing newly graded.
   * A failed re-ask leaves the rows exactly as they were and **still answers**: a
   * read that could not improve a score is not a read that should refuse.
   *
   * Either party reaches it — a parent by account, a child by both ids — and a
   * foreign Attempt, another profile's Attempt and one that is still open all
   * answer the one shared 404.
   */
  async resolveUngraded(scope: GradingScope, attemptId: string): Promise<UngradedResolution> {
    const { input, outstanding } = await this.prisma.withTransaction(async (tx) => {
      const graded = await this.practiceTests.gradingInputFor(
        tx,
        scope.parentAccountId,
        scope.studentProfileId ?? null,
        attemptId,
      );
      // An open Attempt has nothing to re-grade and is not a different kind of
      // refusal: it answers the same sentence a foreign id does (AD-18).
      if (graded.submittedAt === null) throw new NotFoundException(PRACTICE_TEST_NOT_FOUND);

      const stored = await tx.questionGrade.findMany({
        where: { attemptId },
        select: { questionId: true, state: true },
      });
      const byQuestion = new Map(stored.map((row) => [row.questionId, row.state]));
      const unjudged = graded.questions.filter((question) => {
        const state = byQuestion.get(question.questionId);
        return state === undefined || state === 'Ungraded';
      });

      // A row-less or `Ungraded` Question that needs no provider is decided here
      // and now, in code: a crash between the two transactions of a hand-in is
      // the only way one of these exists, and re-deciding it costs no call.
      const deterministic = deterministicRows(graded, unjudged);
      if (deterministic.length > 0) await this.writeGuarded(tx, attemptId, deterministic);

      return { input: graded, outstanding: unjudged.filter((question) => askable(question)) };
    });

    // A results read calls this, and its own doc promises it still answers even
    // when a re-ask fails — so, exactly as in `submitAttempt`, nothing from here on
    // may throw. `judge` swallows the three Ai fault classes itself, but a lost
    // race on the unique index, a dropped connection or a fault class nobody
    // anticipated would not be, so the whole of it is guarded rather than the parts
    // that were foreseen.
    let newlyGradedQuestionIds: string[] = [];
    if (outstanding.length > 0) {
      try {
        const verdicts = await this.judge(scope.parentAccountId, attemptId, outstanding);
        const rows = rowsFromVerdicts(outstanding, verdicts);
        // Assigned from what the transaction *returns*, never pushed into from
        // inside its callback: a callback Prisma re-executes would append a second
        // copy of every id.
        //
        // Only what this pass actually turned into a verdict: a row it left
        // `Ungraded`, and a row it declined to overwrite, are neither of them newly
        // graded.
        newlyGradedQuestionIds = await this.prisma.withTransaction((tx) =>
          this.writeGuarded(tx, attemptId, rows),
        );
      } catch (cause) {
        // The Attempt and the class of fault. Never a Question, an answer, a
        // rationale or a word the model wrote (AD-20). Those Questions are left
        // exactly as they were — outstanding, not lost — for the next read to try.
        this.logger.error(
          `resolveUngraded for attempt ${attemptId} failed (${faultNameOf(cause)}); its outstanding questions are left unjudged.`,
        );
      }
    }

    // Read back rather than computed from what was just written: the score is a
    // statement about every presented Question, including the ones this pass never
    // touched.
    const score = await this.scoreFor(attemptId, input);
    return { score, newlyGradedQuestionIds };
  }

  // --- Internals ---------------------------------------------------------

  /**
   * One batched `Grading` call, re-issued while the post-hoc pass keeps rejecting
   * what came back, degrading to nothing rather than to a guess.
   *
   * The retry is the point, and it is the one `produceDraft` makes for the same
   * reason: a verdict list that does not answer exactly the ordinals asked is the
   * provider's fault (AD-31), and `AiService`'s own loop cannot see it because the
   * payload parsed and the call returned. Bounded by `AI_MAX_ATTEMPTS`, the same
   * figure upstream faults are retried under.
   *
   * **Every failure class ends the same way**: `null`, which the caller writes as
   * `Ungraded`. An `AiInputError` and an `AiRejectedError` escape `AiService`'s own
   * loop immediately and are caught here; an exhausted `AiUpstreamError` and an
   * exhausted rejection arrive here too. Grading is **never gated by an allowance**
   * and never blocked by one — an unaffordable grade would be a child punished for
   * a billing state — so there is no third outcome to distinguish.
   */
  private async judge(
    parentAccountId: string,
    attemptId: string,
    questions: readonly GradingQuestionInput[],
  ): Promise<Map<number, NormalizedVerdict> | null> {
    const asked: GradingPromptQuestion[] = questions.map((question) => ({
      ordinal: question.ordinal,
      format: question.format,
      prompt: plainTextOf(question.prompt),
      correctAnswer: correctAnswerOf(question),
      answerValue: question.answerValue ?? '',
      topics: question.topics,
    }));
    const askedOrdinals = asked.map((question) => question.ordinal);
    const maxAttempts = this.ai.config.maxAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let payload: GradingPayload;
      try {
        ({ payload } = await this.ai.run({
          callClass: 'Grading',
          parentAccountId,
          // Text in, text out: this call reads stored answers, never a photograph.
          // Stated rather than inferred from an empty array.
          modality: 'text',
          images: [],
          prompt: buildGradingPrompt(asked),
          schema: GradingPayload,
          schemaName: GRADING_SCHEMA_NAME,
          fakePayload: ({ failure }) =>
            fakeGradingPayload({
              questions: asked.map((question) => ({
                ordinal: question.ordinal,
                correctAnswer: question.correctAnswer,
                answerValue: question.answerValue,
              })),
              failure,
            }),
        }));
      } catch (cause) {
        // The three fault classes, and all of them end here. The Attempt id and
        // the class of fault; never a Question, an answer or a word the model
        // wrote (AD-20).
        if (
          cause instanceof AiInputError ||
          cause instanceof AiRejectedError ||
          cause instanceof AiUpstreamError
        ) {
          this.logger.warn(
            `Grading for attempt ${attemptId} could not be completed (${cause.name}); ${questions.length} questions are left ungraded.`,
          );
          return null;
        }
        throw cause;
      }

      try {
        const verdicts = validateGradingPayload(payload, askedOrdinals);
        return new Map(verdicts.map((verdict) => [verdict.ordinal, verdict]));
      } catch (cause) {
        // Only a post-hoc rejection is worth asking again for. Anything else is
        // this module's own fault and is not made better by repetition.
        if (!(cause instanceof GradingPayloadInvalid)) throw cause;
        // The Attempt and the attempt number. Never the rule that was broken in
        // the model's own words, and never a fragment of what it wrote (AD-20).
        this.logger.warn(
          `A Grading payload for attempt ${attemptId} was rejected after parsing on attempt ${attempt} of ${maxAttempts}.`,
        );
      }
    }
    this.logger.warn(
      `Grading for attempt ${attemptId} was rejected on every attempt; ${questions.length} questions are left ungraded.`,
    );
    return null;
  }

  /**
   * Writes rows without ever overwriting a judgement that already stands, and
   * without a read-then-write anybody can lose.
   *
   * The read tells this pass what is worth attempting; **the writes are what make
   * it safe**. An insert is a `createMany` with `skipDuplicates`, so a row that
   * appeared between the read and the write is skipped rather than surfacing a
   * P2002 out of a path — a results view — whose own doc promises it still
   * answers. An update is an `updateMany` carrying `state: 'Ungraded'` in its
   * `where`, so the guard is the statement rather than a decision made off a stale
   * snapshot. Two concurrent passes therefore both answer, and the loser writes
   * nothing.
   *
   * A stored `Unanswered`, `Correct` or `Incorrect` is left exactly as it was, down
   * to its `updatedAt` — the first two verdicts are facts a later pass has no new
   * information about, and `Unanswered` is the one state only the hand-in itself
   * can know. `Ungraded` over an already-`Ungraded` row is skipped too: it changes
   * nothing, and a Question nothing can ever judge would otherwise have its
   * `updatedAt` bumped by every results view for the rest of its life.
   *
   * Returns the Questions it actually wrote a verdict for, **from what the writes
   * reported** rather than from the read alone, in the order given — which is what
   * `newlyGradedQuestionIds` is honest about.
   */
  private async writeGuarded(
    tx: TransactionClient,
    attemptId: string,
    rows: readonly GradeRow[],
  ): Promise<string[]> {
    if (rows.length === 0) return [];
    const stored = await tx.questionGrade.findMany({
      where: { attemptId, questionId: { in: rows.map((row) => row.questionId) } },
      select: { questionId: true, state: true },
    });
    const byQuestion = new Map(stored.map((row) => [row.questionId, row.state]));

    const written: string[] = [];
    for (const row of rows) {
      const existing = byQuestion.get(row.questionId);
      // A verdict that already stands, or a blank the hand-in already named, is
      // never reconsidered.
      if (existing !== undefined && existing !== 'Ungraded') continue;
      // Nothing to say, so nothing to write.
      if (existing === 'Ungraded' && row.state === 'Ungraded') continue;

      if (existing === undefined) {
        const inserted = await tx.questionGrade.createMany({
          data: [
            {
              attemptId,
              questionId: row.questionId,
              state: row.state,
              rationale: row.rationale,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count === 1) {
          // `Ungraded` is not a verdict, so writing one is not grading anything.
          if (row.state !== 'Ungraded') written.push(row.questionId);
          continue;
        }
        // Somebody inserted between the read and here. A row now exists, so writing
        // `Ungraded` over it could only either churn an identical row or undo a
        // verdict the winner reached; a real verdict falls through to the guarded
        // update, which lands only on an `Ungraded` row.
        if (row.state === 'Ungraded') continue;
      }

      const updated = await tx.questionGrade.updateMany({
        where: { attemptId, questionId: row.questionId, state: 'Ungraded' },
        data: { state: row.state, rationale: row.rationale },
      });
      if (updated.count === 1 && row.state !== 'Ungraded') written.push(row.questionId);
    }
    return written;
  }

  /** FR-37's denominator, over one entry per presented Question. */
  private async scoreFor(attemptId: string, input: AttemptGradingInput): Promise<AttemptScore> {
    const stored = await this.prisma.questionGrade.findMany({
      where: { attemptId },
      select: { questionId: true, state: true },
    });
    const byQuestion = new Map(stored.map((row) => [row.questionId, row.state]));
    return scoreOf(input.questions.map((question) => byQuestion.get(question.questionId) ?? null));
  }
}

/**
 * Plain text of the stored correct answer.
 *
 * There is no options branch, because `askable` is the only gate `judge` lets a
 * Question through and it requires a readable stored free-text answer — a Multiple
 * Choice Question never reaches a provider at all.
 */
function correctAnswerOf(question: GradingQuestionInput): string {
  return question.answer === null ? '' : plainTextOf(question.answer);
}

/** A fault's class, for a log line that may carry nothing else (AD-20). */
function faultNameOf(cause: unknown): string {
  return cause instanceof Error ? cause.name : 'unknown fault';
}

/**
 * Whether this Question is one a provider is asked about: answered, free-text,
 * and with a stored correct answer to judge against.
 *
 * A Question whose stored answer cannot be read back is not sent — there is
 * nothing to compare with, so the call would be money spent on a guess — and it
 * falls through to `Ungraded`, which is exactly what that state is for.
 */
function askable(question: GradingQuestionInput): boolean {
  if (!isFreeText(question)) return false;
  if (question.answerValue === null || question.answerValue.trim().length === 0) return false;
  return question.answer !== null && plainTextOf(question.answer).trim().length > 0;
}

/**
 * Every verdict that needs no network, for the Questions given.
 *
 * The deterministic verdict, in one place. A blank is `Unanswered` on a manual
 * hand-in and `Incorrect` on an expired one; an answered Multiple Choice Question
 * is an **ordinal comparison, not a text one** — the browser submits the chosen
 * choice's ordinal as a string. Unparseable or unknown is `Incorrect`; `Ungraded`
 * would claim a provider was asked and could not answer.
 *
 * A Question this cannot decide without a provider gets no row here: either the
 * call will answer for it, or `Ungraded` will.
 */
function deterministicRows(
  input: AttemptGradingInput,
  questions: readonly GradingQuestionInput[],
): GradeRow[] {
  const rows: GradeRow[] = [];
  for (const question of questions) {
    // A blank is a Question with no answer row at all, or one whose value was
    // whitespace — which the write path never stored as an answer.
    if (question.answerValue === null || question.answerValue.trim().length === 0) {
      rows.push({
        questionId: question.questionId,
        // FR-37's two readings of an empty field, told apart by the column the
        // server wrote at submit rather than by anything a browser sent.
        state: input.expired ? 'Incorrect' : 'Unanswered',
        rationale: null,
      });
      continue;
    }
    if (question.format === 'MultipleChoice') {
      const raw = question.answerValue.trim();
      // **Digits and nothing else.** `Number.parseInt` reads `1abc`, `1.9` and `+1`
      // all as 1, so on a paper whose first option is the right one every one of
      // them would be credited `Correct` — and none of them is an ordinal the screen
      // could have submitted. The rule is that an unparseable or unknown ordinal is
      // `Incorrect`, so what is not an ordinal is refused before it is compared.
      const chosen = /^\d+$/u.test(raw) ? Number.parseInt(raw, 10) : null;
      rows.push({
        questionId: question.questionId,
        state:
          chosen !== null &&
          question.correctChoiceOrdinal !== null &&
          chosen === question.correctChoiceOrdinal
            ? 'Correct'
            : 'Incorrect',
        // No rationale: nothing explained this, a comparison decided it.
        rationale: null,
      });
      continue;
    }
    // Answered free text. Either the provider answers for it or `Ungraded` does,
    // and neither is this function's to write.
    if (!askable(question)) {
      rows.push({ questionId: question.questionId, state: 'Ungraded', rationale: null });
    }
  }
  return rows;
}

/**
 * The rows one batch's outcome comes to: a verdict where the call delivered one,
 * `Ungraded` where it did not.
 *
 * `null` verdicts — every failure class — makes every Question in the batch
 * `Ungraded` together. That is the cost of batching, and it is a state the retry
 * path already exists for.
 */
function rowsFromVerdicts(
  questions: readonly GradingQuestionInput[],
  verdicts: Map<number, NormalizedVerdict> | null,
): GradeRow[] {
  return questions.map((question) => {
    const verdict = verdicts?.get(question.ordinal);
    if (verdict === undefined) {
      return { questionId: question.questionId, state: 'Ungraded' as const, rationale: null };
    }
    return {
      questionId: question.questionId,
      state: verdict.correct ? ('Correct' as const) : ('Incorrect' as const),
      rationale: verdict.rationale,
    };
  });
}
