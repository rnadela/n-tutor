import type { CookieOptions, Response } from 'express';
import { optionalBoolEnv } from '../common/env.js';
import { STUDENT_MODE_COOKIE } from './student-mode-policy.js';

/**
 * The binding cookie's attributes — the same block `parent-session.cookie.ts`
 * states for the session cookie, deliberately written out again rather than
 * generalised into a parameterised writer: two named cookies stated plainly
 * beat one helper whose call sites have to be read to learn which cookie is
 * being set.
 *
 * `Secure` reads an explicit `COOKIE_SECURE`, never `NODE_ENV`.
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: optionalBoolEnv('COOKIE_SECURE', true),
    sameSite: 'strict',
    path: '/',
  };
}

export function setStudentModeCookie(res: Response, token: string, ttlSeconds: number): void {
  res.cookie(STUDENT_MODE_COOKIE, token, { ...baseOptions(), maxAge: ttlSeconds * 1000 });
}

export function clearStudentModeCookie(res: Response): void {
  res.clearCookie(STUDENT_MODE_COOKIE, baseOptions());
}
