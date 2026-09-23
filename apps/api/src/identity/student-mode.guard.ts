import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PARENT_SESSION_ISSUER } from './auth-policy.js';
import { ParentAccountService } from './parent-account.service.js';
import { clearStudentModeCookie } from './student-mode.cookie.js';
import { STUDENT_MODE_AUDIENCE, STUDENT_MODE_COOKIE } from './student-mode-policy.js';
import { notBound } from './student-mode.service.js';
import { StudentProfileService } from './student-profile.service.js';

export interface StudentPrincipal {
  parentAccountId: string;
  studentProfileId: string;
}

export interface StudentRequest extends Request {
  student?: StudentPrincipal;
  cookies: Record<string, string | undefined>;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The Student Mode guard: cookie only. It never reads `Authorization`, so the
 * elevation bearer cannot even be presented to it — and the audiences differ,
 * so it would not verify here if it were.
 *
 * It is the session guard's shape plus one lookup: the profile the token names
 * must still be active and still owned by the account the token names. Every
 * refusal is the same 401, and every refusal **clears the cookie** — clearing
 * here rather than in an exception filter, because the guard is the only place
 * that knows the binding was examined and found dead, and a stale binding that
 * survives the read that rejected it would refuse again on every load.
 */
@Injectable()
export class StudentModeGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly accounts: ParentAccountService,
    private readonly students: StudentProfileService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StudentRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const refuse = (): never => {
      clearStudentModeCookie(response);
      throw notBound();
    };

    const token = request.cookies?.[STUDENT_MODE_COOKIE];
    // No cookie at all is not a stale binding, so there is nothing to clear —
    // but the refusal is the same sentence either way.
    if (!nonEmptyString(token)) throw notBound();

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        audience: STUDENT_MODE_AUDIENCE,
        issuer: PARENT_SESSION_ISSUER,
      });
    } catch {
      refuse();
    }

    // Claim by claim, exactly as the other two guards do: the separation must
    // not quietly decay into a single audience check.
    if (
      payload!.scope !== STUDENT_MODE_AUDIENCE ||
      !nonEmptyString(payload!.sub) ||
      !nonEmptyString(payload!.profile) ||
      typeof payload!.epoch !== 'number'
    ) {
      refuse();
    }

    const parentAccountId = payload!.sub as string;
    const studentProfileId = payload!.profile as string;

    const account = await this.accounts.findSessionSubject(parentAccountId);
    // A stale epoch is a binding a password reset has already ended — the same
    // rule the session and elevation guards apply, for the same reason.
    if (!account || account.sessionEpoch !== payload!.epoch) refuse();

    // Archived, deleted, or no longer this account's: all three are "no binding
    // exists", because archiving's whole observable effect is that the profile
    // leaves the list Student Mode may bind to.
    const profile = await this.students.findSelectable(parentAccountId, studentProfileId);
    if (profile === null) refuse();

    request.student = { parentAccountId, studentProfileId };
    return true;
  }
}
