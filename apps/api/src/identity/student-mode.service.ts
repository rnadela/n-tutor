import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { PARENT_SESSION_ISSUER } from './auth-policy.js';
import { clearStudentModeCookie } from './student-mode.cookie.js';
import {
  NOT_BOUND,
  STUDENT_MODE_AUDIENCE,
  STUDENT_MODE_TTL_SECONDS,
} from './student-mode-policy.js';
import { StudentProfileService, type StudentProfileView } from './student-profile.service.js';
import type { StudentPrincipal } from './student-mode.guard.js';

export interface StudentModeBinding {
  token: string;
  /** Seconds; the cookie's `maxAge` matches it exactly. */
  ttlSeconds: number;
}

/**
 * The sole reader and writer of the device binding.
 *
 * No other method anywhere mints it, and no route accepts a profile id as the
 * thing it binds to without passing through the elevation guard first: there is
 * no unelevated path that changes what this device is handed to.
 */
@Injectable()
export class StudentModeService {
  constructor(
    private readonly jwt: JwtService,
    private readonly students: StudentProfileService,
  ) {}

  /**
   * Mints the binding credential: audience `student-mode`, the account as the
   * subject, the bound profile as its own claim, and the account's current
   * session epoch so a password reset ends the binding exactly as it ends the
   * session and elevation.
   *
   * It is `mintSession` plus a `profile` claim — deliberately the same shape,
   * so the third credential cannot drift away from its two siblings.
   */
  async mintBinding(input: {
    parentAccountId: string;
    studentProfileId: string;
    sessionEpoch: number;
  }): Promise<StudentModeBinding> {
    const ttlSeconds = STUDENT_MODE_TTL_SECONDS;
    const token = await this.jwt.signAsync(
      {
        scope: STUDENT_MODE_AUDIENCE,
        profile: input.studentProfileId,
        epoch: input.sessionEpoch,
      },
      {
        subject: input.parentAccountId,
        audience: STUDENT_MODE_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
        expiresIn: ttlSeconds,
      },
    );
    return { token, ttlSeconds };
  }

  /**
   * The bound profile, resolved through the sole owner of StudentProfile so the
   * Grade Level is read at its current name rather than copied.
   *
   * The guard has already checked the profile is active and owned; this repeats
   * the read because the gap between the two is where an archive lands, and a
   * refusal here clears the cookie for the same reason the guard's does — a
   * stale binding must not survive the first read that rejects it.
   */
  async boundProfile(principal: StudentPrincipal, res: Response): Promise<StudentProfileView> {
    const profile = await this.students.findSelectable(
      principal.parentAccountId,
      principal.studentProfileId,
    );
    if (profile === null) {
      clearStudentModeCookie(res);
      throw notBound();
    }
    return profile;
  }
}

/**
 * The binding's one rejection, carrying `bound: false`.
 *
 * The flag is what makes this 401 distinguishable from every other 401 the web
 * app can meet: without it the front door cannot tell "this device was never
 * set up" from "something went wrong", and would send a child to sign-in on a
 * dropped connection. The same shape the elevation guard's `elevated: false`
 * uses.
 */
export function notBound(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    message: NOT_BOUND,
    bound: false,
  });
}
