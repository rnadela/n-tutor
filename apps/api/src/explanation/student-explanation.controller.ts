import { Controller, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StudentModeGuard, type StudentRequest } from '../identity/student-mode.guard.js';
import { ExplanationService, type ExplanationView } from './explanation.service.js';

/**
 * The one student-scoped Explanation endpoint: ask for this Question's
 * explanation, and get it.
 *
 * **`POST`, because the first call bills a provider.** Story 5.6's results read is
 * a `GET` that writes, and it had to justify itself at length: FR-22 makes
 * *viewing* the trigger there, so the navigation is the request. Nothing about
 * opening a results screen asks for an explanation — a child presses a control,
 * deliberately, once per Question — so the method that says "this changes
 * something and costs something" is the honest one. Nothing polls it, nothing
 * queues behind it, nothing prefetches it and nothing retries it on a timer.
 *
 * **201 when it generated, 200 when it read the stored row.** The one observable
 * difference between a call that billed and a call that did not, stated in the
 * status rather than in a field of the body — which is why the status is set from
 * the outcome instead of pinned with `@HttpCode`. A body carrying "this was
 * cached" would be this surface talking about billing to the one reader who must
 * never be shown it (AD-26).
 *
 * Both ids come off `req.student`, never off the path or the body. So a foreign
 * Attempt, a sibling's, an unknown id, an Attempt still open and a Question that
 * is not on that Attempt's test all answer the one shared `PRACTICE_TEST_NOT_FOUND`
 * 404 — by construction rather than by a check somebody has to remember (AD-18).
 *
 * **No `ParseUUIDPipe`**, for the reason every other student route carries none: a
 * 400 on shape would be a second kind of refusal on a surface whose whole
 * discipline is that a refusal is one sentence. A malformed id finds no row and
 * gets the 404.
 *
 * The response carries the segments and the two ids they belong to, and nothing
 * else: no cost, no model name, no tier, no allowance figure, no grading rationale
 * and no count of how many explanations are left (AD-20, AD-26). The one refusal
 * that names a limit is the 409, whose sentence blames the plan and states no
 * number.
 */
@Controller('student')
@SkipThrottle({ login: true })
@UseGuards(StudentModeGuard)
export class StudentExplanationController {
  constructor(private readonly explanations: ExplanationService) {}

  @Post('attempts/:attemptId/questions/:questionId/explanation')
  async explainQuestion(
    @Req() req: StudentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
  ): Promise<ExplanationView> {
    const outcome = await this.explanations.explanationFor(
      {
        parentAccountId: req.student!.parentAccountId,
        studentProfileId: req.student!.studentProfileId,
      },
      attemptId,
      questionId,
    );
    // `passthrough`, so Nest still serializes the returned view: the status is the
    // only thing taken over here, and the body stays the framework's to write.
    res.status(outcome.generated ? HttpStatus.CREATED : HttpStatus.OK);
    return outcome.view;
  }
}
