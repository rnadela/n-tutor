import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { AnalyticsService } from './analytics.service.js';
import type { ProfileAnalyticsView, TopicDrillDownView } from './analytics-view.js';

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
 * **The dashboard read still decides nothing and still carries no way on.** The
 * drill-down is a *second* route below, reached with a Topic id the table already
 * holds — nothing was added to the dashboard's own response for it to travel in, and
 * the Topic curation surface is 7.6.
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

  /**
   * One Topic's evidence and the one thing a parent can do about it, in one answer.
   *
   * **One route, because the drill-down is one read.** The figure, the missed
   * Questions, the blanks and the generation target are one picture: split across
   * calls, a screen could state a percentage taken at one instant beside rows taken
   * at another — and the empty drill-down would become four empty answers a surface
   * has to agree about.
   *
   * **It still generates nothing.** The fire the screen offers is Story 4.2's
   * `POST parent/source-tests/:id/practice-tests`, unchanged; this read only resolves
   * *which* upload and *which* label that request may be made with. There is no
   * generation route here and no second cost computation anywhere on this path.
   *
   * Both params through `ParseUUIDPipe`, as every other parent route carries, so a
   * malformed id is refused before it reaches a query. A foreign or unknown profile —
   * and a Topic this child has no figure for — answer an empty drill-down, never a
   * refusal and never a 404 (AD-18).
   */
  @Get('students/:studentProfileId/analytics/topics/:topicId')
  topicDrillDownFor(
    @Req() req: ElevatedRequest,
    @Param('studentProfileId', ParseUUIDPipe) studentProfileId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ): Promise<TopicDrillDownView> {
    return this.analytics.topicDrillDownFor(
      req.elevated!.parentAccountId,
      studentProfileId,
      topicId,
    );
  }
}
