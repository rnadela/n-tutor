import { afterEach, describe, expect, it } from 'vitest';
import {
  REQUEST_BODY_LIMIT_BYTES,
  SCOPE_MAX_LENGTH,
  UNCOMMITTED_PAYLOAD_MAX_BYTES,
  UNCOMMITTED_STATE_TTL_MS,
  expiredAt,
  expiryFrom,
  isExpired,
  isWithinPayloadLimit,
  liveAt,
  payloadByteLength,
  payloadTooLarge,
  resetUncommittedStateRuntime,
  uncommittedPayloadMaxBytes,
  uncommittedStateRuntime,
  uncommittedStateTtlMs,
} from './uncommitted-state-policy.js';

const NOW = new Date('2026-09-24T10:00:00.000Z');

afterEach(() => {
  delete process.env.UNCOMMITTED_STATE_TTL_MS;
  delete process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES;
  resetUncommittedStateRuntime();
});

describe('the TTL', () => {
  it('is 72 hours, stated once', () => {
    expect(UNCOMMITTED_STATE_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });

  it('runs from the creation instant, not from any later activity', () => {
    expect(expiryFrom(NOW).toISOString()).toBe('2026-09-27T10:00:00.000Z');
  });

  it('is measured with whatever TTL it is handed, so an override moves it', () => {
    expect(expiryFrom(NOW, 1_000).getTime()).toBe(NOW.getTime() + 1_000);
  });
});

describe('expiry', () => {
  it('is exclusive at the instant itself, exactly as the elevation ceiling is', () => {
    const row = { expiresAt: expiryFrom(NOW) };
    // One millisecond short: still alive.
    expect(isExpired(row, new Date(row.expiresAt.getTime() - 1))).toBe(false);
    // At the instant: over.
    expect(isExpired(row, row.expiresAt)).toBe(true);
    expect(isExpired(row, new Date(row.expiresAt.getTime() + 1))).toBe(true);
  });

  it('holds a row created now as unexpired', () => {
    expect(isExpired({ expiresAt: expiryFrom(NOW) }, NOW)).toBe(false);
  });

  it('states the same boundary in the query filters the reads and sweep use', () => {
    // The predicate and the two filters are one rule. A filter that drifted
    // from the predicate would be a row the sweep deletes while a read still
    // returns it — or worse, the reverse.
    expect(expiredAt(NOW)).toEqual({ lte: NOW });
    expect(liveAt(NOW)).toEqual({ gt: NOW });

    // Exhaustive at the boundary: every instant is dead to exactly one of them.
    const at = expiryFrom(NOW);
    for (const offset of [-1, 0, 1]) {
      const now = new Date(at.getTime() + offset);
      const dead = isExpired({ expiresAt: at }, now);
      // `lte` catches it iff the predicate says dead; `gt` iff it says alive.
      expect(at.getTime() <= expiredAt(now).lte.getTime()).toBe(dead);
      expect(at.getTime() > liveAt(now).gt.getTime()).toBe(!dead);
    }
  });
});

describe('the payload ceiling', () => {
  it('measures the serialized form, not the key count', () => {
    const oneLongKey = { a: 'x'.repeat(1000) };
    const manyShortKeys = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`k${index}`, 1]),
    );
    expect(payloadByteLength(oneLongKey)).toBeGreaterThan(1000);
    expect(payloadByteLength(manyShortKeys)).toBeLessThan(1000);
    expect(Object.keys(manyShortKeys).length).toBeGreaterThan(Object.keys(oneLongKey).length);
  });

  it('counts bytes, not characters: a multi-byte character is more than one', () => {
    expect(payloadByteLength({ a: '€' })).toBeGreaterThan(payloadByteLength({ a: 'e' }));
  });

  it('accepts a payload at the ceiling and refuses one byte over it', () => {
    // `{"a":"…"}` is 9 bytes of envelope around the filler.
    const envelope = payloadByteLength({ a: '' });
    const atCeiling = { a: 'x'.repeat(UNCOMMITTED_PAYLOAD_MAX_BYTES - envelope) };
    const overCeiling = { a: 'x'.repeat(UNCOMMITTED_PAYLOAD_MAX_BYTES - envelope + 1) };

    expect(payloadByteLength(atCeiling)).toBe(UNCOMMITTED_PAYLOAD_MAX_BYTES);
    expect(isWithinPayloadLimit(atCeiling)).toBe(true);
    expect(isWithinPayloadLimit(overCeiling)).toBe(false);
  });

  it('treats a value JSON cannot represent as over the limit, never as empty', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isWithinPayloadLimit(cyclic)).toBe(false);
    expect(isWithinPayloadLimit(undefined)).toBe(false);
  });
});

describe('the scope bound', () => {
  it('lives here with the other figures this mechanism owns', () => {
    expect(SCOPE_MAX_LENGTH).toBeGreaterThan(0);
    // Long enough to hold the identifiers later epics will address a slot by —
    // a Practice Test id, an Attempt id — with room to spare.
    expect(SCOPE_MAX_LENGTH).toBeGreaterThanOrEqual(36);
  });
});

describe('the rejection message', () => {
  it('states the limit and quotes no payload content', () => {
    const message = payloadTooLarge(1234);
    expect(message).toContain('1234');
    expect(message).not.toContain('!');
  });
});

describe('the runtime', () => {
  it('falls back to the constants when nothing is overridden', () => {
    expect(uncommittedStateRuntime()).toEqual({
      ttlMs: UNCOMMITTED_STATE_TTL_MS,
      payloadMaxBytes: UNCOMMITTED_PAYLOAD_MAX_BYTES,
    });
  });

  it('reads both overrides', () => {
    process.env.UNCOMMITTED_STATE_TTL_MS = '1000';
    process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES = '32';
    resetUncommittedStateRuntime();
    expect(uncommittedStateTtlMs()).toBe(1000);
    expect(uncommittedPayloadMaxBytes()).toBe(32);
  });

  it('refuses a payload ceiling at or above the request body limit', () => {
    // A ceiling the framework would never let a request reach is not a ceiling:
    // the parent would get a bare 413 in place of the message stating the limit.
    process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES = String(REQUEST_BODY_LIMIT_BYTES);
    resetUncommittedStateRuntime();
    expect(() => uncommittedStateRuntime()).toThrow(/UNCOMMITTED_PAYLOAD_MAX_BYTES/);
  });

  it('ships a default ceiling that is comfortably reachable', () => {
    expect(UNCOMMITTED_PAYLOAD_MAX_BYTES).toBeLessThan(REQUEST_BODY_LIMIT_BYTES);
  });

  it('refuses a mistyped override rather than yielding NaN', () => {
    process.env.UNCOMMITTED_STATE_TTL_MS = 'three days';
    resetUncommittedStateRuntime();
    expect(() => uncommittedStateRuntime()).toThrow(/positive whole number/u);
  });

  it('resolves once, so a later environment change does not move it mid-process', () => {
    expect(uncommittedStateTtlMs()).toBe(UNCOMMITTED_STATE_TTL_MS);
    process.env.UNCOMMITTED_STATE_TTL_MS = '1000';
    expect(uncommittedStateTtlMs()).toBe(UNCOMMITTED_STATE_TTL_MS);
  });
});
