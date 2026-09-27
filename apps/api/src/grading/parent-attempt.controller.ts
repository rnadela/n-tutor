import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { GradingService } from './grading.service.js';
import type { AttemptResultsView } from './grading-results.js';

/**
 * The parent's one Attempt read: the answer key of a handed-in run of any child of
 * this account, with the one score FR-37 allows.
 *
 * **No service change, and deliberately no parent-specific read.**
 * `GradingScope.studentProfileId` has been optional since Story 5.6 *for this
 * reason* — "absent for a parent, whose entitlement is the account" — and
 * `answerKeyFor` has taken a nullable profile id for just as long. The parent path
 * was designed for there and left unmounted; this route mounts it. A
 * `parentResultsFor` beside `resultsFor` would be a second answer to FR-37's one
 * denominator, and the two would disagree the first time either was tuned.
 *
 * **It answers `AttemptResultsView`, unchanged and unwidened.** That view has no
 * `rationale` field, and it is not going to gain one here: the grading rationale is
 * Story 6.5's, and the absence of the shape it would travel in is the whole reason
 * `grading-results.ts` exists. The Explanations of the same Attempt are a *second*
 * call, to the module that owns them — widening this response with them would make
 * one read of two modules' rows.
 *
 * **Reading is still FR-22's retry**, exactly as it is for the child: `resultsFor`
 * runs `resolveUngraded` first, so a parent opening a run whose Questions nothing
 * has judged re-asks for them. That is the same trigger on the same rows, not a
 * second one — and grading is never gated by an allowance, so nothing here can be
 * refused for want of headroom.
 *
 * The account comes off `req.elevated` and never from the path (AD-18), and no
 * profile id appears in the path at all: `resultsFor` is called with the account
 * alone, which reads as "any child of this account" and nothing wider. A foreign
 * Attempt, an unknown id and one still open all answer the one shared
 * `PRACTICE_TEST_NOT_FOUND` 404, never a 403.
 *
 * `ParseUUIDPipe`, as every other parent route carries. The response holds no cost,
 * no tier, no model name and no allowance figure (AD-20, AD-26).
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentAttemptController {
  constructor(private readonly grading: GradingService) {}

  @Get('attempts/:attemptId/results')
  results(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ): Promise<AttemptResultsView> {
    // The account alone. An absent `studentProfileId` is not "any child" — it is
    // "any child of this account", which is exactly what a parent may read.
    return this.grading.resultsFor({ parentAccountId: req.elevated!.parentAccountId }, attemptId);
  }
}
