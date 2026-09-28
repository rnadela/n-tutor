import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { ExplanationService, type StudentFlagListEntry } from './explanation.service.js';

/**
 * One child's reported Explanations, as a list of their own.
 *
 * **A separate controller from `ParentExplanationController` because it is a separate
 * subject.** That one is rooted at an Attempt — everything on it takes an `attemptId`
 * and answers about one run — while this is rooted at a child and spans every run they
 * have sat. Hanging a `students/:id/...` route off a controller whose every other path
 * begins `attempts/:id` would make the file's own shape stop saying what it scopes by.
 *
 * **It exists because a flag the parent cannot find is a flag that did not surface.**
 * The Attempt-detail region shows a concern only to somebody who already opened that
 * Attempt; this is what makes a child's report reachable at all, and it is where "listed
 * for that child as awaiting a decision" is true.
 *
 * **It outlives the decision.** An awaiting concern and a decided one are both listed,
 * each marked with what it is: a list that dropped decided entries would make a parent's
 * own dismissal look like the concern never happened.
 *
 * `ParseUUIDPipe` on the profile id, as every other parent route carries. A **foreign or
 * unknown profile answers `[]`**, not a refusal — the same answer a child with no reports
 * gets, and the same answer `GET parent/students/:id/attempts` already gives: a 404 for
 * an unknown id would be a confirmation for a known one (AD-18). Nothing is enumerated
 * either way.
 *
 * It is a plain parent screen's read and **not the Analytics dashboard band**: Story 7.4
 * may later mount something like it there, and 6.5's dispute flags, grade overrides and
 * Mastery figures are not here and have no shape here to travel in. No prose either —
 * that is read next to the Question it is about, on the Attempt-detail screen.
 *
 * Nothing on this response carries a cost, a tier, a model name, an allowance figure or
 * a grading rationale (AD-20, AD-26).
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentExplanationFlagsController {
  constructor(private readonly explanations: ExplanationService) {}

  /** Every concern this child raised, newest first, awaiting and decided alike. */
  @Get('students/:studentProfileId/explanation-flags')
  studentExplanationFlags(
    @Req() req: ElevatedRequest,
    @Param('studentProfileId', ParseUUIDPipe) studentProfileId: string,
  ): Promise<StudentFlagListEntry[]> {
    return this.explanations.studentFlagsFor(
      { parentAccountId: req.elevated!.parentAccountId },
      studentProfileId,
    );
  }
}
