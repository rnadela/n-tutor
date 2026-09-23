/**
 * The single source of truth for every figure and message in the Student Mode
 * binding — the credential that names which child this device is handed to.
 *
 * It mirrors `pin-policy.ts`: an audience constant, a TTL constant, and one
 * message per rejection. Nothing here is restated anywhere else, and the web
 * app never sees any of it: the binding is httpOnly and is observable only
 * through `GET /api/student/session`.
 */

import { DEFAULT_PARENT_SESSION_TTL_SECONDS } from './auth-policy.js';

/**
 * The binding credential's own audience. Neither the session cookie's nor the
 * elevation bearer's ever matches it, so a token minted for one guard cannot be
 * presented to another — the issuer is shared precisely so the audience is the
 * discriminator (AD-13, AD-18).
 */
export const STUDENT_MODE_AUDIENCE = 'student-mode';

/** The second cookie. Named plainly; never written or read by the web app. */
export const STUDENT_MODE_COOKIE = 'student_mode';

/**
 * The binding's lifetime: a device stays bound until it is rebound, until the
 * parent signs out, or until this ceiling elapses — whichever comes first.
 *
 * It is a hard expiry, on both the JWT and the cookie, and nothing renews it:
 * a device left untouched for the whole period drops to sign-in on its next
 * read. That is deliberate for now — there is no idle clock and no sliding
 * refresh here (the idle behaviour is Story 1.5).
 *
 * The figure is the session cookie's ceiling, referenced rather than re-typed,
 * so the two cannot drift apart.
 */
export const STUDENT_MODE_TTL_SECONDS = DEFAULT_PARENT_SESSION_TTL_SECONDS;

/**
 * The guard's one rejection sentence. It says the device is not set up, never
 * that a profile was archived, deleted or belongs elsewhere: a child reading it
 * learns nothing about the account behind it.
 */
export const NOT_BOUND = 'This device is not set up for a student yet.';

/**
 * The create path could not mint a binding for an account it could not read.
 * Distinct from the profile's own 404, which would claim the profile is missing
 * when it has in fact just been created.
 */
export const BINDING_FAILED = 'The device could not be set up for this student.';
