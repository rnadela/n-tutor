import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { TaxonomyItem } from '../admin/taxonomy.service.js';
import { BindStudentModeDto } from './dto/student-mode.dto.js';
import { CreateStudentProfileDto, UpdateStudentProfileDto } from './dto/student-profile.dto.js';
import { ParentAccountService } from './parent-account.service.js';
import { ParentElevationGuard, type ElevatedRequest } from './parent-elevation.guard.js';
import { setStudentModeCookie } from './student-mode.cookie.js';
import { BINDING_FAILED } from './student-mode-policy.js';
import { StudentModeService } from './student-mode.service.js';
import {
  PROFILE_NOT_FOUND,
  StudentProfileService,
  type StudentProfileView,
} from './student-profile.service.js';

/**
 * Student Profiles, mounted alongside the PIN routes at `/api/parent`.
 *
 * Every route is behind `ParentElevationGuard`: the session cookie alone can
 * never reach one, and the account is taken from `req.elevated`, never from the
 * payload or the path (AD-18). No route runs argon2, so none is a
 * `@ParentCredentialRoute()` and none spends the credential throttler budget.
 *
 * Two of them write the Story 1.4 device binding — the first-profile creation
 * and the deliberate exit from Parent View. Both are elevation-guarded, which
 * is the whole of the rule that nothing unelevated changes what this device is
 * handed to.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class StudentProfileController {
  private readonly logger = new Logger(StudentProfileController.name);

  constructor(
    private readonly students: StudentProfileService,
    private readonly studentMode: StudentModeService,
    private readonly accounts: ParentAccountService,
  ) {}

  /** Every profile on the account, archived ones included. */
  @Get('students')
  list(@Req() req: ElevatedRequest): Promise<StudentProfileView[]> {
    return this.students.list(req.elevated!.parentAccountId);
  }

  /** The active ones — what Student Mode may bind to (Story 1.4). */
  @Get('students/selectable')
  listSelectable(@Req() req: ElevatedRequest): Promise<StudentProfileView[]> {
    return this.students.listSelectable(req.elevated!.parentAccountId);
  }

  /** The Grade Levels a parent may choose, read through `admin`'s taxonomy. */
  @Get('grade-levels')
  gradeLevels(): Promise<TaxonomyItem[]> {
    return this.students.listGradeLevels();
  }

  /**
   * Creates a profile, and — when it is the account's only active one — binds
   * the device to it, so a parent who has just made their first profile has a
   * Student Mode to hand the device to without any further action.
   *
   * A second creation does not rebind: the binding then changes only through
   * the deliberate exit below.
   */
  @Post('students')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: ElevatedRequest,
    @Body() dto: CreateStudentProfileDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StudentProfileView> {
    const parentAccountId = req.elevated!.parentAccountId;
    const { profile, isFirst } = await this.students.create(parentAccountId, {
      displayName: dto.displayName,
      gradeLevelId: dto.gradeLevelId,
    });

    if (isFirst) {
      try {
        await this.bind(res, parentAccountId, profile.id);
      } catch (cause) {
        // The profile exists; saying otherwise would be a lie about the write
        // that just succeeded. The parent binds the device through the exit
        // control instead, and the fault is logged rather than swallowed.
        this.logger.warn(
          `Binding the device to the first profile failed: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
    }
    return profile;
  }

  /**
   * The deliberate exit from Parent View: the device is handed to this child.
   *
   * An archived, unknown or other-account profile is a 404 — never a 403, which
   * would confirm the row exists — and the existing binding is left exactly as
   * it was.
   */
  @Post('student-mode')
  @HttpCode(HttpStatus.NO_CONTENT)
  async bindStudentMode(
    @Req() req: ElevatedRequest,
    @Body() dto: BindStudentModeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const parentAccountId = req.elevated!.parentAccountId;
    const profile = await this.students.findSelectable(parentAccountId, dto.studentProfileId);
    if (profile === null) throw new NotFoundException(PROFILE_NOT_FOUND);
    await this.bind(res, parentAccountId, profile.id);
  }

  /** A rename, a Grade-Level change, or both. One row, one table. */
  @Patch('students/:id')
  update(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentProfileDto,
  ): Promise<StudentProfileView> {
    return this.students.update(req.elevated!.parentAccountId, id, {
      ...(dto.displayName === undefined ? {} : { displayName: dto.displayName }),
      ...(dto.gradeLevelId === undefined ? {} : { gradeLevelId: dto.gradeLevelId }),
    });
  }

  @Post('students/:id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.students.archive(req.elevated!.parentAccountId, id);
  }

  @Post('students/:id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.students.restore(req.elevated!.parentAccountId, id);
  }

  /**
   * Mints the binding at the account's **current** epoch and sets the cookie.
   *
   * The epoch is read here rather than carried on the elevation token, so a
   * binding minted moments after a password reset is already stale by the rule
   * the guard applies, instead of outliving the reset that ended everything
   * else.
   */
  private async bind(res: Response, parentAccountId: string, studentProfileId: string) {
    const account = await this.accounts.findSessionSubject(parentAccountId);
    // An account that cannot be read is not a missing profile: a 404 here would
    // claim the profile that was just validated does not exist.
    if (!account) throw new InternalServerErrorException(BINDING_FAILED);
    const binding = await this.studentMode.mintBinding({
      parentAccountId,
      studentProfileId,
      sessionEpoch: account.sessionEpoch,
    });
    setStudentModeCookie(res, binding.token, binding.ttlSeconds);
  }
}
