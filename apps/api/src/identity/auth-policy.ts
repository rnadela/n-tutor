/**
 * The single source of truth for every figure, version and non-enumerating
 * message in the parent credential surface.
 *
 * The web app never restates any of these: it reads them from
 * `GET /api/auth/policy`. Changing the notice text is a version bump and a
 * string change here, not a code change anywhere else.
 */

import { MAX_PIN_ATTEMPTS, PIN_LENGTH, pinCooldownMinutes } from './pin-policy.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Bumping a version invalidates acceptances of the previous one at sign-up. */
export const TERMS_VERSION = '2026-09-23';
export const CHILD_DATA_CONSENT_VERSION = '2026-09-23';

export const TERMS_TEXT =
  'These terms cover how a Parent Account may be used, what the service does with uploaded work, and how the account can be closed. This is placeholder product copy for v0 and is pending legal review.';

/**
 * Placeholder notice pending legal review (a recorded v0 constraint). It is
 * served as versioned content so replacing it is a version bump, not a release.
 */
export const CHILD_DATA_CONSENT_TEXT =
  'A parent creates and controls every Student Profile on this account. Work a parent uploads on a child’s behalf is stored so it can be reviewed and explained, is never used to train models, and is deleted when the parent deletes the profile. This is placeholder product copy for v0 and is pending legal review.';

/**
 * One message per endpoint, for every rejection that endpoint can produce, so
 * no response reveals whether an email or a token exists.
 */
export const SIGN_UP_FAILED = 'The account could not be created. Check the details and try again.';
export const SIGN_IN_FAILED = 'Sign-in failed. Check the email and password and try again.';
export const RESET_FAILED = 'That link is no longer usable. Request a new one.';

/** A reset link is short-lived: one hour from the moment it is issued. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** The session credential's own audience. An admin token can never match it. */
export const PARENT_SESSION_AUDIENCE = 'parent-session';
export const PARENT_SESSION_ISSUER = 'n-test-reviewer';
export const PARENT_SESSION_COOKIE = 'parent_session';

/**
 * FR-1: the session persists until explicit sign-out. Thirty days is the
 * cookie's ceiling, not a policy window — it is **not** the 8-hour elevation
 * ceiling, which governs the Story 1.2 elevation token and nothing here.
 */
export const DEFAULT_PARENT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * An authenticated request made with a token older than this gets a freshly
 * minted cookie, so an active parent never reaches the ceiling at all.
 */
export const SESSION_REMINT_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AuthPolicy {
  passwordMinLength: number;
  passwordMaxLength: number;
  termsVersion: string;
  termsText: string;
  noticeVersion: string;
  noticeText: string;
  /** The PIN figures, so the web states the shape and the lock without a
   * literal of its own. Their source of truth is `pin-policy.ts`. */
  pinLength: number;
  pinMaxAttempts: number;
  pinCooldownMinutes: number;
}

export function currentAuthPolicy(): AuthPolicy {
  return {
    passwordMinLength: PASSWORD_MIN_LENGTH,
    passwordMaxLength: PASSWORD_MAX_LENGTH,
    termsVersion: TERMS_VERSION,
    termsText: TERMS_TEXT,
    noticeVersion: CHILD_DATA_CONSENT_VERSION,
    noticeText: CHILD_DATA_CONSENT_TEXT,
    pinLength: PIN_LENGTH,
    pinMaxAttempts: MAX_PIN_ATTEMPTS,
    pinCooldownMinutes: pinCooldownMinutes(),
  };
}

export function isAcceptablePassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/** Both acceptances must name the versions currently in force. */
export function acceptsCurrentVersions(input: {
  termsVersion: string;
  noticeVersion: string;
}): boolean {
  return input.termsVersion === TERMS_VERSION && input.noticeVersion === CHILD_DATA_CONSENT_VERSION;
}

export function resetTokenExpiryFrom(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + RESET_TOKEN_TTL_MS);
}

/**
 * A reset token is usable only while it is both unused and unexpired. Expiry is
 * exclusive at the boundary: a token is dead the instant it reaches `expiresAt`.
 */
export function isResetTokenUsable(
  token: { expiresAt: Date; usedAt: Date | null },
  now: Date,
): boolean {
  if (token.usedAt !== null) return false;
  return token.expiresAt.getTime() > now.getTime();
}

/** The link that goes in the email. The plaintext token exists only here. */
export function resetLinkFor(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/+$/, '')}/auth/reset/confirm?token=${encodeURIComponent(token)}`;
}

export const RESET_EMAIL_SUBJECT = 'Reset your password';

export function resetEmailText(link: string): string {
  return `Open this link to set a new password: ${link}`;
}

/** An alias for `identity`'s own JwtService, signing with `PARENT_JWT_SECRET`. */
export const PARENT_JWT = 'PARENT_JWT';
