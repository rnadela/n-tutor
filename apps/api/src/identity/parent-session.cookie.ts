import type { CookieOptions, Response } from 'express';
import { optionalBoolEnv } from '../common/env.js';
import { PARENT_SESSION_COOKIE } from './auth-policy.js';

/**
 * The cookie's attributes. `Secure` reads an explicit `COOKIE_SECURE`, never
 * `NODE_ENV`: the flag that decides whether a credential travels in the clear
 * must be stated, not inferred from a build mode.
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: optionalBoolEnv('COOKIE_SECURE', true),
    sameSite: 'strict',
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string, ttlSeconds: number): void {
  res.cookie(PARENT_SESSION_COOKIE, token, { ...baseOptions(), maxAge: ttlSeconds * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(PARENT_SESSION_COOKIE, baseOptions());
}
