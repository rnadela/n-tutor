import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { GradingService } from './grading.service.js';
import type { GradeDisputeListEntry } from './parent-results.js';

/**
 * One child's disputed grades, as a list of their own.
 *
 * **A separate controller from `ParentAttemptController` because it is a separate
 * subject**, exactly as `ParentExplanationFlagsController` is separate from the
 * Attempt-rooted explanation routes. That one is rooted at an Attempt — everything on it
 * takes an `attemptId` and answers about one run — while this is rooted at a child and
 * spans every run they have sat. Hanging a `students/:id/...` route off a controller whose
 * every other path begins `attempts/:id` would make the file's own shape stop saying what
 * it scopes by.
 *
 * **It exists because a dispute the parent cannot find is a dispute that did not surface.**
 * The Attempt-detail row shows an objection only to somebody who already opened that
 * Attempt; this is what makes a child's raised hand reachable at all, and it is where
 * "listed for their parent per Student Profile" is true.
 *
 * **It outlives the decision.** A resolved dispute is still listed, marked with its
 * outcome, and one awaiting a decision is listed as awaiting — which is the *absence* of an
 * override and not a value somebody wrote. A list that dropped resolved entries would make
 * a parent's own adjustment look like the objection never happened.
 *
 * **It decides nothing.** The override is taken next to the Question it is about, on the
 * Attempt-detail screen, because adjusting a grade without having read the rationale is the
 * one thing this feature must not make easy. So every entry's way on is a link, and the
 * write lives on the other controller.
 *
 * `ParseUUIDPipe` on the profile id, as every other parent route carries. A **foreign or
 * unknown profile answers `[]`**, not a refusal — the same answer a child with no disputes
 * gets, and the same answer `GET parent/students/:id/explanation-flags` and
 * `.../attempts` already give: a 404 for an unknown id would be a confirmation for a known
 * one (AD-18). Nothing is enumerated either way.
 *
 * It is a plain parent screen's read and **not the Analytics dashboard band**: Story 7.4
 * may later mount something like it there, and no Mastery table, Mastery value, Weak Area
 * or analytics figure is here or has a shape here to travel in. No prose either — a
 * rationale is read next to the Question it is about.
 *
 * Nothing on this response carries a cost, a tier, a model name or an allowance figure
 * (AD-20, AD-26).
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentGradeDisputesController {
  constructor(private readonly grading: GradingService) {}

  /** Every grade this child objected to, newest first, awaiting and resolved alike. */
  @Get('students/:studentProfileId/grade-disputes')
  gradeDisputes(
    @Req() req: ElevatedRequest,
    @Param('studentProfileId', ParseUUIDPipe) studentProfileId: string,
  ): Promise<GradeDisputeListEntry[]> {
    return this.grading.gradeDisputesFor(
      { parentAccountId: req.elevated!.parentAccountId },
      studentProfileId,
    );
  }
}
