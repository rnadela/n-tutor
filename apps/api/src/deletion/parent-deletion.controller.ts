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
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ParentCredentialRoute } from '../identity/parent-credential-route.decorator.js';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import { clearSessionCookie } from '../identity/parent-session.cookie.js';
import { clearStudentModeCookie } from '../identity/student-mode.cookie.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { DeleteAccountDto } from './dto/delete-account.dto.js';
import { DeleteStudentProfileDto } from './dto/delete-student-profile.dto.js';
import type { AccountDeletionSummary, ProfileDeletionSummary } from './deletion-policy.js';
import { ProfileDeletionService } from './profile-deletion.service.js';

/**
 * The FR-33 deletion routes, mounted alongside the other parent routes at
 * `/api/parent`: two for one child, and two for the whole account.
 *
 * All four are behind `ParentElevationGuard`: the session cookie alone can never
 * reach any of them, and the account is taken from `req.elevated` and never from
 * the payload or the path (AD-18). The account routes carry no id at all, which
 * is the same rule with nothing left to get wrong.
 *
 * The deletes are `@ParentCredentialRoute()` and skip the default and login
 * buckets, exactly as the PIN routes do, because they run argon2 — and a route
 * that runs argon2 without spending the credential budget is a CPU denial of
 * service waiting to be found (AD-23). The previews run none, so they spend none.
 *
 * It is a controller of its own in a module of its own rather than two more
 * routes on `StudentProfileController`, because the orchestration behind it
 * reaches into four other modules and `identity` may not depend on any of them.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class ParentDeletionController {
  constructor(
    private readonly deletion: ProfileDeletionService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

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

  /** What deleting the whole account would destroy, by count and by kind. */
  @Get('account/deletion-preview')
  accountPreview(@Req() req: ElevatedRequest): Promise<AccountDeletionSummary> {
    return this.accountDeletion.previewFor(req.elevated!.parentAccountId);
  }

  /**
   * Erases the whole Parent Account, re-authenticated by the account password.
   *
   * No path parameter and no id in the body: the account is the elevated one and
   * can be no other (AD-18). `@ParentCredentialRoute()` and the skipped buckets
   * for the reason the sibling delete carries them — it runs argon2, and a route
   * that runs argon2 outside the credential budget is a CPU denial of service
   * waiting to be found (AD-23).
   *
   * **Both cookies are cleared on success.** The session cookie is `httpOnly`, so
   * the web app cannot clear it itself, and the Student Mode cookie binds this
   * device to a child of the account just erased. Sign-out already clears both
   * with these helpers; a 204 that left them set would leave the browser holding a
   * credential for an account that cannot be resolved — a 401 on the next
   * navigation rather than a sign-in screen.
   *
   * 204: there is nothing left to describe, and a body naming what went would be
   * a last copy of it.
   */
  @Delete('account')
  @ParentCredentialRoute()
  @SkipThrottle({ default: true, login: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @Req() req: ElevatedRequest,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.accountDeletion.delete(req.elevated!.parentAccountId, dto.password);
    // Only after the deletion has actually committed: a refusal must leave the
    // parent signed in and elevated, on the screen holding the reason.
    clearSessionCookie(res);
    clearStudentModeCookie(res);
  }
}
