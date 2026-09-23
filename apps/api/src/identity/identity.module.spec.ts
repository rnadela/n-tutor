import { afterEach, describe, expect, it } from 'vitest';
import { IdentityModule } from './identity.module.js';
import { resetPinRuntime } from './pin-policy.js';

/**
 * `IdentityModule`'s constructor resolves `pinRuntime()` so a mistyped PIN or
 * elevation override fails the process at boot rather than the first request
 * that touches the gate — this pins that wiring itself, not just the pure
 * `resolvePinRuntime()` logic `pin-policy.spec.ts` already covers.
 */
describe('IdentityModule construction', () => {
  const savedTtl = process.env.ELEVATION_TTL_SECONDS;
  const savedCeiling = process.env.ELEVATION_CEILING_MS;

  afterEach(() => {
    if (savedTtl === undefined) delete process.env.ELEVATION_TTL_SECONDS;
    else process.env.ELEVATION_TTL_SECONDS = savedTtl;
    if (savedCeiling === undefined) delete process.env.ELEVATION_CEILING_MS;
    else process.env.ELEVATION_CEILING_MS = savedCeiling;
    resetPinRuntime();
  });

  it('refuses to construct when an elevation override is invalid', () => {
    process.env.ELEVATION_TTL_SECONDS = '3600';
    process.env.ELEVATION_CEILING_MS = '60000';
    resetPinRuntime();
    expect(() => new IdentityModule()).toThrow(/ELEVATION_TTL_SECONDS/);
  });

  it('constructs cleanly with a valid environment', () => {
    delete process.env.ELEVATION_TTL_SECONDS;
    delete process.env.ELEVATION_CEILING_MS;
    resetPinRuntime();
    expect(() => new IdentityModule()).not.toThrow();
  });
});
