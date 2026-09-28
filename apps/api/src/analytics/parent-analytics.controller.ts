import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { AnalyticsService } from './analytics.service.js';
import type { ProfileAnalyticsView } from './analytics-view.js';

/**
 * One child's dashboard, as one read.
 *
 * **One route, because the dashboard is one answer.** Splitting it into a Mastery
 * call, a trend call and a digest call would let a screen render three figures
 * taken at three instants and read as one picture — and would make "the empty
 * dashboard" three separate empty answers a surface has to agree about.
 *
 * **Behind the PIN and nothing else.** `ParentElevationGuard` is the whole of the
 * authorization *at this layer*: the account comes off the verified elevation and
 * is handed to a service whose every read carries it in its own `where`. A check
 * here that the profile belongs to the account would be a check the reads no
 * longer need, sitting where somebody could later delete it.
 *
 * **A foreign or unknown profile answers an empty dashboard**, not a refusal: the
 * same answer `GET parent/students/:id/grade-disputes` and
 * `.../explanation-flags` already give, for AD-18's reason — a 404 for an unknown
 * id is a confirmation for a known one. Nothing is enumerated either way.
 *
 * `ParseUUIDPipe` on the profile id, as every other parent route carries, so a
 * malformed id is refused before it reaches a query.
 *
 * **It decides nothing and offers no way on.** The drill-down, the missed-Question
 * list and "generate more on this" are Story 7.5, and the Topic curation surface
 * is 7.6; nothing on this response has a shape for any of them to travel in.
 *
 * Nothing here carries a cost, a tier, a model name or a grading rationale (AD-20,
 * AD-26).
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Everything the dashboard states about one child, in one answer. */
  @Get('students/:studentProfileId/analytics')
  analyticsFor(
    @Req() req: ElevatedRequest,
    @Param('studentProfileId', ParseUUIDPipe) studentProfileId: string,
  ): Promise<ProfileAnalyticsView> {
    return this.analytics.profileAnalyticsFor(req.elevated!.parentAccountId, studentProfileId);
  }
}
