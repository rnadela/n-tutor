import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { AllowanceService, type AccountConsumption } from './allowance.service.js';

/**
 * What this account has used this period, as one read.
 *
 * **The same method the Admin console reads, returned unchanged.** The epic asks
 * for a parent view and an admin view that can never disagree, and a
 * parent-shaped DTO would make that a property of two mappings staying aligned.
 * `GET /api/admin/parent-accounts/:id` composes its `consumption` from
 * `AllowanceService.consumptionFor`, and so does this route — so the two bodies
 * are equal field for field by construction, and one int-spec case can say so.
 *
 * **Reading charges nothing and is reachable at cap.** Usage is derived (AD-14):
 * `consumptionFor` resolves one period window and counts artifacts inside it. No
 * artifact-producing path is entered, no provider call is made, and there is no
 * cap to be refused at — an account at its Upload, Generation *and* Explanation
 * limits gets the same 200 with `used === limit` on all three, which is the whole
 * point of shipping a surface a parent can read *before* they hit a limit.
 *
 * **All three counters over one window.** They reset together because they are
 * one derivation of one window, not three reads that agree — so there is no code
 * path a partial reset could arrive through, and `resetAt` is that window's
 * exclusive end.
 *
 * **Behind `ParentElevationGuard` and nothing else.** The account comes off the
 * verified elevation and never off a path or body param (AD-18), so there is no
 * id to tamper with and nothing to enumerate. Not reachable from Student Mode: an
 * allowance figure and a tier label are parent-only facts (AD-20, AD-26).
 *
 * `GET parent/allowance/generation` in `practicetest` is untouched — it answers
 * one allowance shaped for the generate screen, including the per-request
 * ceiling that screen needs. This route answers the account's three, and lives in
 * `allowance` because that is the module that owns the composition.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentAllowanceController {
  constructor(private readonly allowance: AllowanceService) {}

  /** The account's tier, its three counters against their limits, and the reset. */
  @Get('allowances')
  allowances(@Req() req: ElevatedRequest): Promise<AccountConsumption> {
    return this.allowance.consumptionFor(req.elevated!.parentAccountId);
  }
}
