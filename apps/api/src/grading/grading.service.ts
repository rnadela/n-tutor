import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PracticeTestService,
  type AttemptSubmissionView,
} from '../practicetest/practice-test.service.js';

/**
 * The `grading` module's service: sole owner and sole writer of `QuestionGrade`
 * (AD-6, AD-17).
 *
 * It reads `practicetest` through `PracticeTestService` and nothing reads it back:
 * the arrow is `grading -> practicetest`, one way, with no `forwardRef`. What that
 * arrow buys is the whole reason handing in lives here — closing an Attempt and
 * recording what its blanks mean have to be one transaction (AD-4, AD-10), and
 * grade state may only be written by this module.
 *
 * As of Story 5.4 exactly one grade literal is ever written, `Unanswered`, and only
 * for a blank on a manually submitted Attempt the server judged unexpired. No AI
 * call, no rationale, no score, no Mastery recompute: those are Story 5.5's.
 */
@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly practiceTests: PracticeTestService,
  ) {}

  /**
   * Hands one Attempt in: the child's raw answers, the instant it closed, and —
   * for a manual hand-in — a stored `Unanswered` for every Question left blank.
   *
   * **One transaction, opened here** (AD-10). `closeAttempt` is `practicetest`'s
   * half — the 404 on a foreign or unknown id, the conditional close behind the
   * 409, the raw answers, and the list of Questions it wrote no answer row for —
   * and it runs inside this transaction rather than one of its own. So there is no
   * instant at which an Attempt is handed in and its blanks are unrecorded, and a
   * failure anywhere rolls the whole hand-in back.
   *
   * **Which Questions are blank is the server's answer, never the browser's.** It
   * is the Questions on that Practice Test minus the answer rows this same
   * transaction wrote. A body that omitted `answers` entirely is a paper where
   * every Question is blank, and a body naming one of another test's Questions
   * makes no Question blank that was not already.
   *
   * **`Unanswered` only, and only when the server decided the Attempt had not
   * expired.** `expired` is the comparison `practicetest` made against its own
   * clock and its own column, and an expired Attempt gets **no grade row at all**
   * here: FR-37 grades the blanks of an Attempt whose time ran out `Incorrect`, and
   * that verdict is Story 5.5's to make. Nothing here judges an answer, calls a
   * provider, computes a score or writes `Correct`, `Incorrect` or `Ungraded`.
   *
   * The answer is `AttemptSubmissionView` unchanged: the same three fields, the
   * same 200, the same shape this route had before grade state existed. Not a
   * blank count, not a state, not a score — this surface tells a child nothing
   * about their work.
   */
  async submitAttempt(
    parentAccountId: string,
    studentProfileId: string,
    attemptId: string,
    answers: readonly { questionId: string; value: string }[],
  ): Promise<AttemptSubmissionView> {
    return this.prisma.withTransaction(async (tx) => {
      const closure = await this.practiceTests.closeAttempt(
        tx,
        parentAccountId,
        studentProfileId,
        attemptId,
        answers,
      );

      // A blank on an Attempt handed in while there was still time is a Question
      // the child *chose* to leave — which is what `Unanswered` means, and why it
      // is written here rather than derived later from an empty answer field that
      // looks identical on an Attempt whose time ran out (FR-37).
      if (!closure.expired && closure.blankQuestionIds.length > 0) {
        await tx.questionGrade.createMany({
          data: closure.blankQuestionIds.map((questionId) => ({
            attemptId,
            questionId,
            state: 'Unanswered' as const,
          })),
        });
      }

      // `blankQuestionIds` stops here. It was the reason for the transaction, not
      // something the response carries.
      return {
        submittedAt: closure.submittedAt,
        expired: closure.expired,
        gradeAt: closure.gradeAt,
      };
    });
  }
}
