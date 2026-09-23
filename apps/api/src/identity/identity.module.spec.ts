import { afterEach, describe, expect, it } from 'vitest';
import { IdentityModule } from './identity.module.js';
import { resetPinRuntime } from './pin-policy.js';
import { resetUncommittedStateRuntime } from './uncommitted-state-policy.js';

/**
 * `IdentityModule`'s constructor resolves `pinRuntime()` and
 * `uncommittedStateRuntime()` so a mistyped PIN, elevation or uncommitted-state
 * override fails the process at boot rather than the first request that touches
 * the gate — this pins that wiring itself, not just the pure resolver logic the
 * two policy specs already cover.
 */
describe('IdentityModule construction', () => {
  const savedTtl = process.env.ELEVATION_TTL_SECONDS;
  const savedCeiling = process.env.ELEVATION_CEILING_MS;
  const savedStateTtl = process.env.UNCOMMITTED_STATE_TTL_MS;
  const savedPayloadMax = process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES;

  afterEach(() => {
    if (savedTtl === undefined) delete process.env.ELEVATION_TTL_SECONDS;
    else process.env.ELEVATION_TTL_SECONDS = savedTtl;
    if (savedCeiling === undefined) delete process.env.ELEVATION_CEILING_MS;
    else process.env.ELEVATION_CEILING_MS = savedCeiling;
    if (savedStateTtl === undefined) delete process.env.UNCOMMITTED_STATE_TTL_MS;
    else process.env.UNCOMMITTED_STATE_TTL_MS = savedStateTtl;
    if (savedPayloadMax === undefined) delete process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES;
    else process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES = savedPayloadMax;
    resetPinRuntime();
    resetUncommittedStateRuntime();
  });

  it('refuses to construct when an elevation override is invalid', () => {
    process.env.ELEVATION_TTL_SECONDS = '3600';
    process.env.ELEVATION_CEILING_MS = '60000';
    resetPinRuntime();
    expect(() => new IdentityModule()).toThrow(/ELEVATION_TTL_SECONDS/);
  });

  it('refuses to construct when the uncommitted-state TTL is not a number', () => {
    process.env.UNCOMMITTED_STATE_TTL_MS = 'three days';
    resetUncommittedStateRuntime();
    expect(() => new IdentityModule()).toThrow(/UNCOMMITTED_STATE_TTL_MS/);
  });

  it('refuses to construct when the payload ceiling could never be reached', () => {
    // Above the request body limit: the framework would refuse such a payload
    // before the validator that states the limit ever saw it.
    process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES = String(1024 * 1024);
    resetUncommittedStateRuntime();
    expect(() => new IdentityModule()).toThrow(/UNCOMMITTED_PAYLOAD_MAX_BYTES/);
  });

  it('constructs cleanly with a valid environment', () => {
    delete process.env.ELEVATION_TTL_SECONDS;
    delete process.env.ELEVATION_CEILING_MS;
    delete process.env.UNCOMMITTED_STATE_TTL_MS;
    delete process.env.UNCOMMITTED_PAYLOAD_MAX_BYTES;
    resetPinRuntime();
    resetUncommittedStateRuntime();
    expect(() => new IdentityModule()).not.toThrow();
  });
});
