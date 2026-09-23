import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { TaxonomyItem } from '../admin/taxonomy.service.js';
import { CreateStudentProfileDto, UpdateStudentProfileDto } from './dto/student-profile.dto.js';
import { ParentElevationGuard, type ElevatedRequest } from './parent-elevation.guard.js';
import { StudentProfileService, type StudentProfileView } from './student-profile.service.js';

/**
 * Student Profiles, mounted alongside the PIN routes at `/api/parent`.
 *
 * Every route is behind `ParentElevationGuard`: the session cookie alone can
 * never reach one, and the account is taken from `req.elevated`, never from the
 * payload or the path (AD-18). No route runs argon2, so none is a
 * `@ParentCredentialRoute()` and none spends the credential throttler budget.
 */
@Controller('parent')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class StudentProfileController {
  constructor(private readonly students: StudentProfileService) {}

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

  @Post('students')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: ElevatedRequest,
    @Body() dto: CreateStudentProfileDto,
  ): Promise<StudentProfileView> {
    return this.students.create(req.elevated!.parentAccountId, {
      displayName: dto.displayName,
      gradeLevelId: dto.gradeLevelId,
    });
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
}
