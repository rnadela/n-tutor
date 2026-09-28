import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { AdminFlaggedExplanationView } from '../explanation/admin-flag-queue.js';
import { ExplanationService } from '../explanation/explanation.service.js';
import { AdminAuthGuard } from './admin-auth.guard.js';

/**
 * The Flagged Explanations queue: every Explanation an operator has to judge.
 *
 * **It lives in `admin` and not in `explanation`.** `AdminAuthGuard` is constructed here
 * and deliberately not exported, so a controller behind it has to be in this module's
 * injector; and `admin` is imported by nothing but `app.module.ts`, so this module
 * importing `ExplanationModule` is the acyclic direction. The alternative — exporting the
 * guard so another module could mount an admin route — would make every module that
 * wanted one able to construct its own admin surface.
 *
 * **The filter is the service's and it is a `where`.** Nothing here narrows what comes
 * back: the queue contains parent-originated flags and parent-*confirmed* student flags
 * only, and an unconfirmed or dismissed student flag is excluded by the query rather than
 * by anything this controller or any browser does. A filter applied after the read is one
 * refactor away from being dropped while every screen still looks right.
 *
 * **One entry per Explanation, not per flag.** An operator judges the prose, once; the
 * entry names which routes raised it and when the earliest of them did.
 *
 * A `GET` that writes nothing, generates nothing and suppresses nothing. There is no
 * disposition route here and no un-flag: the parent's decision is the parent's, and
 * suppression is Story 6.4's.
 *
 * No token, or an invalid one, is a 401 from the guard's own refusal. No response carries
 * a child's display name, an account email, a cost, a tier, a model name, an allowance
 * figure or a grading rationale (AD-20, AD-26) — the prose and the identifiers are what
 * judging a paragraph takes.
 */
@Controller('admin/flagged-explanations')
@UseGuards(AdminAuthGuard)
@SkipThrottle({ login: true })
export class FlaggedExplanationController {
  constructor(private readonly explanations: ExplanationService) {}

  @Get()
  list(): Promise<AdminFlaggedExplanationView[]> {
    return this.explanations.flaggedForAdmin();
  }
}
