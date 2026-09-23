import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SaveUncommittedStateDto, UncommittedStateQueryDto } from './dto/uncommitted-state.dto.js';
import { ParentElevationGuard, type ElevatedRequest } from './parent-elevation.guard.js';
import { UncommittedStateService, type UncommittedStateView } from './uncommitted-state.service.js';

/**
 * Retained uncommitted parent input, mounted alongside the PIN and profile
 * routes at `/api/parent`.
 *
 * The class-level `ParentElevationGuard` is the whole of the access rule, and
 * it is what makes "restoration happens strictly after PIN verification" true
 * by construction rather than by convention: the session cookie alone, the
 * Student Mode cookie, and no credential at all are refused identically, so a
 * device sitting in Student Mode can reach none of this. The account comes from
 * `req.elevated`, never from the path or the payload (AD-18).
 *
 * No route runs argon2, so none is a `@ParentCredentialRoute()` and none spends
 * the credential throttler budget.
 *
 * Nothing in the product calls these yet — Story 1.6 is the mechanism, and the
 * epics that add a `kind` add the callers with it.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class UncommittedStateController {
  constructor(private readonly uncommitted: UncommittedStateService) {}

  /**
   * Writes the slot. A `PUT` because it is the slot that is addressed — account,
   * profile, kind and scope — not a new row each time.
   */
  @Put('uncommitted')
  @HttpCode(HttpStatus.OK)
  save(
    @Req() req: ElevatedRequest,
    @Body() dto: SaveUncommittedStateDto,
  ): Promise<UncommittedStateView> {
    return this.uncommitted.save(req.elevated!.parentAccountId, {
      studentProfileId: dto.studentProfileId,
      kind: dto.kind,
      scope: dto.scope ?? '',
      payload: dto.payload,
    });
  }

  /** What is still restorable for the named profile, newest first. */
  @Get('uncommitted')
  list(
    @Req() req: ElevatedRequest,
    @Query() query: UncommittedStateQueryDto,
  ): Promise<UncommittedStateView[]> {
    return this.uncommitted.restorableFor(req.elevated!.parentAccountId, query.studentProfileId);
  }

  /**
   * One retained slot by id, restored into the profile the caller names.
   *
   * The profile is required rather than inferred from the row: naming it is
   * what lets a mismatch be refused. A row saved under a sibling answers 404,
   * never a 200 that quietly rebinds it into whichever child the device is in
   * front of now (AD-33).
   */
  @Get('uncommitted/:id')
  item(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: UncommittedStateQueryDto,
  ): Promise<UncommittedStateView> {
    return this.uncommitted.restorableItem(
      req.elevated!.parentAccountId,
      id,
      query.studentProfileId,
    );
  }

  /** Discard after commit. Idempotent: a second call is a 204 as well. */
  @Delete('uncommitted/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discard(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.uncommitted.discard(req.elevated!.parentAccountId, id);
  }
}
