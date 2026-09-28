import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StudentModeGuard, type StudentRequest } from '../identity/student-mode.guard.js';
import { ExplanationService, type StudentExplanationResponse } from './explanation.service.js';

/**
 * The student-scoped Explanation endpoints: ask for this Question's explanation, and
 * say that it is wrong.
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
 *
 * **Since Story 6.4 the explanation route answers a discriminated union, and the
 * suppressed arm is a 200 rather than a refusal.** Nothing failed: a parent decided their
 * child should not be shown that explanation, and a child is not handed an error for a
 * decision a grown-up made. The suppressed arm carries the two ids and the discriminant
 * and has **nowhere** for prose, a flag instant, a removal instant, a reason or a
 * disposition to sit — the union is what makes that the compiler's guarantee rather than a
 * discipline at each call site.
 *
 * The suppression list beside it is the third route here, and it exists so the screen
 * knows before it draws a control: a control a child can press is a parent's decision one
 * tap from being undone, and on Free an allowance unit spent doing it.
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
  ): Promise<StudentExplanationResponse> {
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

  /**
   * Records that the child thinks this explanation is wrong.
   *
   * **200 and never 201**, for the reason the parent's flag route is 200: a repeat press
   * is the same concern made the same row by the unique key `[explanationId, origin]`,
   * so there is nothing for a created-status to be honest about. The status is pinned
   * with `@HttpCode` rather than set from an outcome, because unlike the route above
   * there is no billing difference for it to describe.
   *
   * **The response is the same prose plus the child's own flag.** Nothing on screen
   * changes but the flag's own state: the panel stays open and the paragraph stays
   * rendered, because reporting an explanation is not a retraction of it.
   *
   * **The child's own flag, and nothing else.** No parent flag, no disposition and no
   * count of anything ever travels on this response — `StudentExplanationResponse` has
   * nowhere for one to sit, which is what makes that a property of the type rather than a
   * rule somebody keeps (AD-20, AD-26). Whether their parent later agrees or disagrees is a
   * parent-scoped fact and reaches no student surface.
   *
   * **A report against an explanation a parent has since removed answers the suppressed
   * arm and writes nothing.** It is the same 200 the read path gives, and the point is what
   * is *not* on it: a response carrying the prose would put an explanation a parent settled
   * back on a child's screen, which is the one thing suppression exists to prevent. Only a
   * stale tab can reach it, because the screen does not draw the control.
   *
   * Both ids come off `req.student`, never off the path or the body, and there is no
   * `ParseUUIDPipe` — a malformed id finds no row and gets the one shared
   * `PRACTICE_TEST_NOT_FOUND` 404, exactly as a foreign Attempt, a sibling's, an
   * unknown id, one still open and a Question with no Explanation all do (AD-18).
   */
  @Post('attempts/:attemptId/questions/:questionId/explanation-flag')
  @HttpCode(HttpStatus.OK)
  flagQuestionExplanation(
    @Req() req: StudentRequest,
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
  ): Promise<StudentExplanationResponse> {
    return this.explanations.flagExplanationAsStudent(
      {
        parentAccountId: req.student!.parentAccountId,
        studentProfileId: req.student!.studentProfileId,
      },
      attemptId,
      questionId,
    );
  }

  /**
   * Which Questions of this Attempt the child may not be shown an explanation for.
   *
   * **A `GET`, and the one read on this controller that writes nothing and bills
   * nothing.** It generates no explanation, consumes no allowance and touches no
   * `chargedAt`: it is a list of ids, read once per Attempt, so the results screen knows
   * before it draws a control.
   *
   * **It exists because the control has to be withheld, not disabled.** The panel is
   * mounted per row, so learning suppression at press time would leave a child one tap
   * from undoing their parent's decision — and on a Free account, one tap from spending an
   * allowance unit doing it. Asking per Question would be one request per row on load.
   *
   * `string[]`, and deliberately nothing more. Not a body, not an instant, not a reason
   * and not who decided: a student surface learns exactly that a parent removed this
   * explanation (AD-20, AD-26), and the sentence for that is the web's own words.
   *
   * **`[]` for a foreign or unknown Attempt**, which is the same answer a child with
   * nothing suppressed gets — never a 404 that would confirm an id exists (AD-18). Both
   * ids come off `req.student`, and there is no `ParseUUIDPipe`: a malformed id matches
   * nothing.
   *
   * **This list is the courtesy and not the guarantee.** A read that failed or went stale
   * leaves the control drawn, a press answers 200 suppressed, and nothing is generated and
   * nothing is charged — which is exactly why the serve-time check exists and why it is not
   * a cache trick.
   */
  @Get('attempts/:attemptId/suppressed-explanations')
  suppressedExplanations(
    @Req() req: StudentRequest,
    @Param('attemptId') attemptId: string,
  ): Promise<string[]> {
    return this.explanations.suppressedQuestionsFor(
      {
        parentAccountId: req.student!.parentAccountId,
        studentProfileId: req.student!.studentProfileId,
      },
      attemptId,
    );
  }
}
