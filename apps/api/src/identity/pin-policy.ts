/**
 * The single source of truth for every Parent PIN and elevation figure, message
 * and predicate.
 *
 * The web app restates none of them: the shape, the attempt ceiling and the
 * cool-down reach it through `GET /api/auth/policy`. Everything here is pure or
 * reads one env override with the constant below as its fallback, so a test can
 * drive a short cool-down without a second definition of what the cool-down is.
 */

import { requireIntEnv } from '../common/env.js';

/** FR: a numeric PIN. Four digits, leading zeros included — it is a string. */
export const PIN_LENGTH = 4;
export const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

/** The third consecutive wrong entry locks the gate rather than being counted. */
export const MAX_PIN_ATTEMPTS = 3;

/**
 * The cool-down. Neither the PRD nor the UX names a duration — both say only
 * "a cool-down" — so the figure is a tunable constant here rather than a
 * decision scattered across the surfaces that state it.
 */
export const PIN_COOLDOWN_MS = 15 * 60 * 1000;

/** One elevation token lives 15 minutes; the parent refreshes while active. */
export const ELEVATION_TTL_SECONDS = 15 * 60;

/**
 * The absolute ceiling, measured from the PIN crossing itself. Reaching it is
 * not the same as expiring: an expired token is re-mintable, a token past the
 * ceiling is not, and the only way back is the PIN.
 */
export const ELEVATION_CEILING_MS = 8 * 60 * 60 * 1000;

/** The elevation credential's own audience. The session cookie's never matches. */
export const PARENT_ELEVATION_AUDIENCE = 'parent-elevation';

/**
 * One message per rejection. None of them carries a counter, an error code or
 * an exclamation mark, and none reveals whether the entered PIN was close.
 */
export const PIN_INCORRECT = 'That PIN is not correct.';
export const PIN_NOT_SET = 'No PIN is set for this account. Set one first.';
export const PIN_ALREADY_SET = 'A PIN is already set for this account. Change it instead.';
export const PIN_LOCKED = 'Parent View is locked for now. Try again after the time shown.';
export const NOT_ELEVATED = 'Not in Parent View.';

export interface PinRuntime {
  cooldownMs: number;
  elevationTtlSeconds: number;
  elevationCeilingMs: number;
}

let resolved: PinRuntime | null = null;

/**
 * Reads and checks the three overrides once.
 *
 * Resolved at boot (`IdentityModule` asks for it as it is constructed) rather
 * than per request, so a mistyped override is a process that refuses to start —
 * the way every other setting in `env.ts` behaves — and never a 500 the first
 * parent to touch the gate discovers.
 */
export function pinRuntime(): PinRuntime {
  if (resolved === null) resolved = resolvePinRuntime();
  return resolved;
}

function resolvePinRuntime(): PinRuntime {
  const runtime: PinRuntime = {
    cooldownMs: requireIntEnv('PIN_COOLDOWN_MS', PIN_COOLDOWN_MS),
    elevationTtlSeconds: requireIntEnv('ELEVATION_TTL_SECONDS', ELEVATION_TTL_SECONDS),
    elevationCeilingMs: requireIntEnv('ELEVATION_CEILING_MS', ELEVATION_CEILING_MS),
  };
  // A token that outlives the ceiling bounding it would make the ceiling
  // unreachable: elevation would end by expiry alone and the PIN would never be
  // required again within a single token's life.
  if (runtime.elevationTtlSeconds * 1000 > runtime.elevationCeilingMs) {
    throw new Error(
      'ELEVATION_TTL_SECONDS must not exceed ELEVATION_CEILING_MS: one elevation token cannot outlive the ceiling it is bounded by.',
    );
  }
  return runtime;
}

/** Test seam: forgets the resolved values so a new environment is read. */
export function resetPinRuntime(): void {
  resolved = null;
}

export function pinCooldownMs(): number {
  return pinRuntime().cooldownMs;
}

export function elevationTtlSeconds(): number {
  return pinRuntime().elevationTtlSeconds;
}

export function elevationCeilingMs(): number {
  return pinRuntime().elevationCeilingMs;
}

/** Whole minutes, for the copy that states how long a lock lasts. */
export function pinCooldownMinutes(): number {
  return Math.max(1, Math.round(pinCooldownMs() / 60_000));
}

/** Exactly `PIN_LENGTH` digits. A non-string is not a PIN, so it is not one here. */
export function isWellFormedPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

/** The lock lifts on the clock: at the instant itself the gate is open again. */
export function isLocked(state: { pinLockedUntil: Date | null }, now: Date): boolean {
  if (state.pinLockedUntil === null) return false;
  return state.pinLockedUntil.getTime() > now.getTime();
}

/**
 * When the gate closes, given the counter as it stands **after** the failure
 * was counted — `null` while the allowance still has room.
 *
 * Taking the post-increment count is what lets the counter be incremented
 * atomically by the database: the decision is then made on the value that
 * increment actually produced, so concurrent wrong entries reach the ceiling
 * instead of all writing the same number over each other.
 */
export function lockReachedAt(
  attemptsAfterFailure: number,
  now: Date,
  cooldownMs: number = pinCooldownMs(),
): Date | null {
  if (attemptsAfterFailure < MAX_PIN_ATTEMPTS) return null;
  return new Date(now.getTime() + cooldownMs);
}

export function elevationCeilingFrom(
  elevatedAt: Date,
  ceilingMs: number = elevationCeilingMs(),
): Date {
  return new Date(elevatedAt.getTime() + ceilingMs);
}

/**
 * Exclusive at the boundary, exactly as the reset token's expiry is: elevation
 * is over the instant it reaches the ceiling.
 */
export function isWithinCeiling(
  elevatedAt: Date,
  now: Date,
  ceilingMs: number = elevationCeilingMs(),
): boolean {
  return elevationCeilingFrom(elevatedAt, ceilingMs).getTime() > now.getTime();
}
