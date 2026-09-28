import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { DisposeFlagDto } from './dto/dispose-flag.dto.js';
import type { ParentExplanationView } from './explanation-flag.js';
import { ExplanationService } from './explanation.service.js';

/**
 * The parent's Explanation routes: read what this Attempt's Explanations say, record
 * that one of them is bad, and decide about a concern the child raised.
 *
 * **A `GET` that writes nothing.** The student route beside it is a `POST` because
 * its first call bills a provider; this one is a read and stays one. Opening a
 * parent's Attempt detail generates nothing, consumes no Explanation Allowance and
 * touches no `chargedAt` — an Explanation the child never asked for does not exist
 * here, and a parent who opened a whole Attempt would otherwise be billed for every
 * Question on it.
 *
 * **The flag is a `POST` that answers 200, not 201.** The second press is not a
 * second flag and not a conflict: it is the same concern, made the same row by the
 * unique key `[explanationId, origin]`. So there is nothing for a created-status to
 * be honest about, and the response is the state — the Explanation and the instant a
 * parent first flagged it — rather than a receipt for this particular press.
 *
 * The account comes off `req.elevated` and never from the path or the body (AD-18),
 * and there is **no profile id anywhere in either path**: which child sat the
 * Attempt is resolved server-side from the Attempt row, so a profile id cannot be
 * paired with another child's Attempt because there is nowhere to put one. A foreign
 * Attempt, an unknown id, one still open and a Question with no stored Explanation
 * all answer the one shared `PRACTICE_TEST_NOT_FOUND` 404 — never a 403, and never
 * four sentences.
 *
 * **`ParseUUIDPipe` on both ids**, as every other parent route carries: a malformed
 * id on a parent surface is a fault in the caller and a 400 says so. The student
 * routes deliberately omit it, because a child's surface answers every refusal with
 * one sentence.
 *
 * Neither response carries a cost, a tier, a model name, an allowance figure or a
 * grading rationale (AD-20, AD-26). The rationale is Story 6.5's and
 * `ParentExplanationView` has nowhere for one to sit; suppression is Story 6.4's and
 * there is no column for it yet.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentExplanationController {
  constructor(private readonly explanations: ExplanationService) {}

  /**
   * Every Explanation stored for this Attempt — one entry per stored row, and
   * nothing for a Question the child never asked about.
   *
   * An Attempt whose Questions were all worked through unasked answers `[]`, which
   * is a state the screen renders and never a refusal: having asked for nothing is
   * not a fault.
   */
  @Get('attempts/:attemptId/explanations')
  attemptExplanations(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ): Promise<ParentExplanationView[]> {
    return this.explanations.explanationsForAttempt(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
    );
  }

  /**
   * Records a parent's concern about one Explanation, and answers with the state.
   *
   * 200 on the first press and on every later one, with the same
   * `parentFlaggedAt` each time: the instant the concern was **first** recorded.
   */
  @Post('attempts/:attemptId/questions/:questionId/explanation-flag')
  @HttpCode(HttpStatus.OK)
  flag(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<ParentExplanationView> {
    return this.explanations.flagExplanation(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
      questionId,
    );
  }

  /**
   * Records what the parent decided about the concern **their child** raised.
   *
   * 200 on the first decision and on a repeat of the same one, each time with the
   * instant the decision was first recorded: a double-tap is one decision. A *different*
   * decision answers 409 with the one `FLAG_ALREADY_DISPOSED` sentence and rewrites
   * nothing — the first decision stands, because reversal is not in FR-38 and a
   * reversible confirm would mean an Explanation entering and leaving an operator's
   * queue underneath them.
   *
   * **There is no un-flag, no undo and no toggle here**, and no route that could become
   * one: the only body field is a member of a closed two-value enum, which the validation
   * pipe checks before anything is read.
   *
   * A Question with no Explanation, one whose Explanation the child never reported, a
   * foreign Attempt, an unknown id and one still open all answer the one shared 404. A
   * parent's *own* flag has no disposition and needs none, so an Explanation carrying
   * only that answers the same 404 as well.
   *
   * **Confirming does not suppress.** The child is served exactly the same prose
   * afterwards; what confirming does is put the Explanation in front of an operator, and
   * the screen says so in words.
   */
  @Post('attempts/:attemptId/questions/:questionId/explanation-flag/disposition')
  @HttpCode(HttpStatus.OK)
  disposeFlag(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: DisposeFlagDto,
  ): Promise<ParentExplanationView> {
    return this.explanations.disposeStudentFlag(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
      questionId,
      dto.disposition,
    );
  }
}
