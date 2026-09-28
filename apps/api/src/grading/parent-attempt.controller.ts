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
import { GradeOverrideDto } from './dto/grade-override.dto.js';
import { GradingService } from './grading.service.js';
import type { ParentAttemptResultsView } from './parent-results.js';

/**
 * The parent's Attempt surface: the answer key of a handed-in run of any child of this
 * account, the evidence each grade was reached on, and the one remedy FR-25 grants.
 *
 * **The read is its own method, and that replaced this file's earlier promise.** Until
 * Story 6.5 this route answered `AttemptResultsView` — the child's own shape — and said
 * it would never gain a rationale, because the absence of a shape one could travel in is
 * the whole reason `grading-results.ts` exists. FR-25 requires the parent to read exactly
 * that prose: a grading rationale is the evidence an override is decided on, and a parent
 * asked to change a grade without it would be guessing. So the response is
 * `ParentAttemptResultsView`, a **separate superset** composed by `parentResultsFor`, and
 * the child's shape is untouched. The invariant did not weaken — it moved from "this route
 * will not widen" to "the widening cannot reach the other surface", which is the stronger
 * of the two: one read serving two audiences with a nullable field and a scope check would
 * make a child's response one branch away from carrying a rationale, where two shapes make
 * it incapable of it.
 *
 * **Reading is still FR-22's retry**, exactly as it is for the child: `parentResultsFor`
 * runs `resolveUngraded` first, so a parent opening a run whose Questions nothing has
 * judged re-asks for them. The same trigger on the same rows, not a second one — and
 * grading is never gated by an allowance, so nothing here can be refused for want of
 * headroom.
 *
 * **The override is the only write, and it needs no dispute.** A parent who spots a harsh
 * grade themselves may fix it; requiring their child to object first would make the remedy
 * depend on the child having noticed, which is the opposite of the mitigation FR-25 asks
 * for. Where there *is* a dispute, this write is what resolves it — there is no separate
 * disposition control, because nothing in FR-25 or the epic authorizes a second outcome
 * and a dismiss control would be an invented one.
 *
 * The account comes off `req.elevated` and never from the path (AD-18), and no profile id
 * appears in any path here: the service is called with the account alone, which reads as
 * "any child of this account" and nothing wider. A foreign Attempt, an unknown id and one
 * still open all answer the one shared `PRACTICE_TEST_NOT_FOUND` 404, never a 403.
 *
 * `ParseUUIDPipe` on every id, as every other parent route carries. The responses hold no
 * cost, no tier, no model name and no allowance figure (AD-20, AD-26).
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
  ): Promise<ParentAttemptResultsView> {
    // The account alone. An absent `studentProfileId` is not "any child" — it is
    // "any child of this account", which is exactly what a parent may read.
    return this.grading.parentResultsFor(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
    );
  }

  /**
   * Records what the parent says one Question is worth, and the score that follows.
   *
   * **The flip and the recomputed score are one transaction** (AD-10), with the Mastery
   * recompute seam inside it — so no reader can ever see a row that changed beside a header
   * that did not. The original AI verdict and its rationale are retained and still on the
   * response afterwards: an override is a column beside the verdict and never an edit of it.
   *
   * **Two 409s and each has its own sentence**, which is the one place this surface departs
   * from a single refusal: the requested grade is already what counts, or the stored verdict
   * is not a judgement at all (`Unanswered` or `Ungraded`). Both are rules a parent is
   * entitled to know about, both name no child, no number and no tier, and neither is a 403 —
   * they are reading the row, which is how they came to press the control. Everything about
   * *ownership* is still the one shared 404.
   *
   * **The body is two words and a closed set.** `GradeOverrideDto` accepts `Correct` and
   * `Incorrect` and nothing else, so a third state dies in the validation pipe before an
   * ownership read and before any statement could write it. No reason field: there is no
   * column for one, and a body field with no writer is a promise the next reader believes.
   *
   * **200, not 201.** Nothing is created — the grade row already existed and this states what
   * it now counts as — and a second, different decision is an ordinary 200 too, because an
   * override is a statement about a grade that may legitimately be made again the other way.
   *
   * It answers the whole `ParentAttemptResultsView` rather than one row, so the screen redraws
   * the score and the row it changed from one response: a row-shaped answer would leave the
   * browser to decide what the new fraction is, which is a second denominator (FR-37).
   */
  @Post('attempts/:attemptId/questions/:questionId/grade-override')
  @HttpCode(HttpStatus.OK)
  overrideGrade(
    @Req() req: ElevatedRequest,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() body: GradeOverrideDto,
  ): Promise<ParentAttemptResultsView> {
    return this.grading.overrideGrade(
      { parentAccountId: req.elevated!.parentAccountId },
      attemptId,
      questionId,
      body.state,
    );
  }
}
