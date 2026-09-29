import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ParentCredentialRoute } from '../identity/parent-credential-route.decorator.js';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { DeleteStudentProfileDto } from './dto/delete-student-profile.dto.js';
import type { ProfileDeletionSummary } from './deletion-policy.js';
import { ProfileDeletionService } from './profile-deletion.service.js';

/**
 * The FR-33 deletion routes, mounted alongside the other parent routes at
 * `/api/parent`.
 *
 * Both are behind `ParentElevationGuard`: the session cookie alone can never
 * reach either, and the account is taken from `req.elevated` and never from the
 * payload or the path (AD-18).
 *
 * The delete is a `@ParentCredentialRoute()` and skips the default and admin
 * buckets, exactly as the PIN routes do, because it runs argon2 — and a route
 * that runs argon2 without spending the credential budget is a CPU denial of
 * service waiting to be found (AD-23). The preview runs none, so it spends none.
 *
 * It is a controller of its own in a module of its own rather than two more
 * routes on `StudentProfileController`, because the orchestration behind it
 * reaches into four other modules and `identity` may not depend on any of them.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentDeletionController {
  constructor(private readonly deletion: ProfileDeletionService) {}

  /** What deleting this child would destroy, by count and by kind. */
  @Get('students/:id/deletion-preview')
  preview(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProfileDeletionSummary> {
    return this.deletion.previewFor(req.elevated!.parentAccountId, id);
  }

  /**
   * Erases the profile and everything under it, re-authenticated by the account
   * password.
   *
   * 204: there is nothing left to describe. A body naming what went would be a
   * last copy of the thing that was just destroyed.
   */
  @Delete('students/:id')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteStudentProfileDto,
  ): Promise<void> {
    await this.deletion.delete(req.elevated!.parentAccountId, id, dto.password);
  }
}
