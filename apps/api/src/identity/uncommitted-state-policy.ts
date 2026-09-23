/**
 * The single source of truth for every figure the uncommitted-state mechanism
 * owns: how long a slot lives, how large its payload may be, and how long the
 * caller-supplied `scope` that addresses it may be.
 *
 * Nothing else states any of them. Everything here is pure or reads one env
 * override with the constant below as its fallback, resolved once at boot by
 * the same `requireIntEnv` pattern `pin-policy.ts` uses — so a test can drive a
 * one-second TTL without a second definition of what the TTL is.
 */

import { requireIntEnv } from '../common/env.js';

/**
 * 72 hours, measured from row creation and never extended by an update
 * (AD-16). The alternative turns an actively re-saved slot into an indefinite
 * store of children's schoolwork that no clock reaches, which is exactly what
 * the TTL exists to prevent.
 */
export const UNCOMMITTED_STATE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * The serialized payload ceiling. The payload is opaque JSON that carries no
 * bytes — Page Images are `PageImage` rows referenced by id (AD-15) — so this
 * bounds a structured draft, not an upload.
 */
export const UNCOMMITTED_PAYLOAD_MAX_BYTES = 64 * 1024;

/**
 * The longest a `scope` may be. It is an opaque caller-supplied discriminator —
 * a Practice Test id, say — so the bound is on its length alone; nothing here
 * has an opinion about what it means. It lives with the other two figures
 * because it is equally one this mechanism owns.
 */
export const SCOPE_MAX_LENGTH = 200;

/**
 * Express's default JSON body limit. Not a figure this mechanism owns — it is
 * the framework's — but the payload ceiling has to stay under it, or an
 * override above it would silently yield a framework 413 in place of this
 * module's own 400, and the parent would be told nothing useful at all.
 */
export const REQUEST_BODY_LIMIT_BYTES = 100 * 1024;

/**
 * One message per rejection, and none quotes any payload content (AD-20): the
 * limit is stated, what was sent is not.
 */
export function payloadTooLarge(maxBytes: number = uncommittedPayloadMaxBytes()): string {
  return `That draft is too large to hold. The limit is ${maxBytes} bytes once stored.`;
}
export const PAYLOAD_NOT_AN_OBJECT = 'The payload must be a JSON object.';

/**
 * The by-id read's one and only rejection.
 *
 * Every way that read can fail — the row is under a sibling profile, the row is
 * unknown, the row has expired, the named profile is archived, foreign or
 * unknown — answers with exactly this. One message for all of them is what
 * makes them indistinguishable, so nothing about the read confirms that a row
 * exists somewhere (AD-33: a row is refused into a different profile, never
 * silently rebound).
 */
export const UNCOMMITTED_STATE_NOT_FOUND = 'Nothing saved under that id.';

export interface UncommittedStateRuntime {
  ttlMs: number;
  payloadMaxBytes: number;
}

let resolved: UncommittedStateRuntime | null = null;

/**
 * Reads and checks both overrides once.
 *
 * Resolved at boot (`IdentityModule` asks for it as it is constructed), so a
 * mistyped override is a process that refuses to start rather than a 500 the
 * first parent to save a draft discovers.
 */
export function uncommittedStateRuntime(): UncommittedStateRuntime {
  if (resolved === null) resolved = resolveUncommittedStateRuntime();
  return resolved;
}

function resolveUncommittedStateRuntime(): UncommittedStateRuntime {
  const runtime: UncommittedStateRuntime = {
    ttlMs: requireIntEnv('UNCOMMITTED_STATE_TTL_MS', UNCOMMITTED_STATE_TTL_MS),
    payloadMaxBytes: requireIntEnv('UNCOMMITTED_PAYLOAD_MAX_BYTES', UNCOMMITTED_PAYLOAD_MAX_BYTES),
  };
  // A ceiling at or above the body limit is unreachable: the request carrying
  // such a payload is refused by the framework before any validator sees it, so
  // the parent gets a bare 413 instead of the message that states the limit.
  // The envelope around the payload — the profile id, the kind, the scope —
  // costs bytes too, so the ceiling must sit strictly below the limit.
  if (runtime.payloadMaxBytes >= REQUEST_BODY_LIMIT_BYTES) {
    throw new Error(
      `UNCOMMITTED_PAYLOAD_MAX_BYTES must stay below the ${REQUEST_BODY_LIMIT_BYTES}-byte request body limit: a larger ceiling could never be reached, and an oversized payload would be refused by the framework rather than by the stated limit.`,
    );
  }
  return runtime;
}

/** Test seam: forgets the resolved values so a new environment is read. */
export function resetUncommittedStateRuntime(): void {
  resolved = null;
}

export function uncommittedStateTtlMs(): number {
  return uncommittedStateRuntime().ttlMs;
}

export function uncommittedPayloadMaxBytes(): number {
  return uncommittedStateRuntime().payloadMaxBytes;
}

/** Created-at plus the TTL. Written once; a later save never moves it. */
export function expiryFrom(createdAt: Date, ttlMs: number = uncommittedStateTtlMs()): Date {
  return new Date(createdAt.getTime() + ttlMs);
}

/**
 * Exclusive at the boundary, exactly as the elevation ceiling is: a row is over
 * the instant the clock reaches its expiry, not a millisecond after.
 */
export function isExpired(row: { expiresAt: Date }, now: Date): boolean {
  return row.expiresAt.getTime() <= now.getTime();
}

/**
 * The `expiresAt` comparison that selects the dead rows, for the sweep.
 *
 * It exists so the boundary is stated once and `isExpired` is not shadowed by a
 * query that restates it inline: these two and the one below are the same rule,
 * and a query path that drifted from the predicate would be a row the sweep
 * deletes while a read still returns it.
 */
export function expiredAt(now: Date): { lte: Date } {
  return { lte: now };
}

/** Its complement: the comparison every read filters on. */
export function liveAt(now: Date): { gt: Date } {
  return { gt: now };
}

/**
 * How many bytes the payload serializes to — which is what the size rule is
 * applied against, and very nearly what is stored.
 *
 * Measured on the serialized form rather than on key count: a single key
 * holding a novel is not a small payload. It measures the object as given, so
 * `JSON.stringify`'s own rules apply — an `undefined` property is dropped and a
 * `toJSON` method is honoured — which is exactly what the database would store
 * anyway.
 *
 * A value JSON cannot represent (a cycle, a BigInt) has no serialized length,
 * so it is reported as over the limit rather than as zero bytes.
 */
export function payloadByteLength(payload: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (serialized === undefined) return Number.POSITIVE_INFINITY;
  return Buffer.byteLength(serialized, 'utf8');
}

/** At the ceiling passes; one byte over does not. */
export function isWithinPayloadLimit(
  payload: unknown,
  maxBytes: number = uncommittedPayloadMaxBytes(),
): boolean {
  return payloadByteLength(payload) <= maxBytes;
}
