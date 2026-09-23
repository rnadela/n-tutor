import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StudentModeGuard, type StudentRequest } from './student-mode.guard.js';
import { StudentModeService } from './student-mode.service.js';
import type { StudentProfileView } from './student-profile.service.js';

/**
 * The whole of the student-scoped API: one read, mounted at `/api/student`.
 *
 * The bound profile comes from `req.student`, which the guard took from the
 * cookie — never from a parameter, a query, a body or a path. There is no
 * student-scoped write here at all: a child authors nothing, and the binding
 * itself is changed only through the elevation-guarded parent routes.
 */
@Controller('student')
@SkipThrottle({ login: true })
@UseGuards(StudentModeGuard)
export class StudentModeController {
  constructor(private readonly studentMode: StudentModeService) {}

  /**
   * What this device is bound to: one profile, with its Grade Level resolved at
   * its current name. Nothing parent-scoped is reachable from here.
   */
  @Get('session')
  async session(
    @Req() req: StudentRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ profile: StudentProfileView }> {
    return { profile: await this.studentMode.boundProfile(req.student!, res) };
  }
}
