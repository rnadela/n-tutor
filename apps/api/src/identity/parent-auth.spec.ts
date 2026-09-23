import { afterEach, describe, expect, it } from 'vitest';
import * as argon2 from 'argon2';
import {
  DUMMY_HASH,
  generateResetToken,
  hashResetToken,
  parentSessionTtlSeconds,
} from './parent-auth.service.js';
import { DEFAULT_PARENT_SESSION_TTL_SECONDS } from './auth-policy.js';
import { requireParentJwtSecret } from '../common/env.js';

describe('reset tokens', () => {
  it('are 32 random bytes, distinct on every call', () => {
    const token = generateResetToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateResetToken()).not.toBe(token);
  });

  it('are stored hashed, so a stored value is not a usable link', () => {
    const token = generateResetToken();
    const hash = hashResetToken(token);
    expect(hash).not.toBe(token);
    expect(hashResetToken(token)).toBe(hash);
    expect(hashResetToken(generateResetToken())).not.toBe(hash);
  });
});

describe('the unknown-email hash', () => {
  it('is a real argon2 hash, so the unknown path costs what a wrong password costs', async () => {
    await expect(argon2.verify(DUMMY_HASH, 'anything at all')).resolves.toBe(false);
  });

  it('is local to identity, never imported from admin', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./parent-auth.service.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/from '\.\.\/admin\//);
  });
});

describe('the parent session secret', () => {
  const withEnv = async (values: Record<string, string>, run: () => void): Promise<void> => {
    const saved = { ...process.env };
    Object.assign(process.env, values);
    try {
      run();
    } finally {
      process.env = saved;
    }
  };

  it('refuses a value equal to the admin secret', async () => {
    const shared = 'a'.repeat(48);
    await withEnv({ PARENT_JWT_SECRET: shared, ADMIN_JWT_SECRET: shared }, () => {
      expect(() => requireParentJwtSecret()).toThrow(/must differ from ADMIN_JWT_SECRET/);
    });
  });

  it('accepts two distinct secrets', async () => {
    await withEnv({ PARENT_JWT_SECRET: 'p'.repeat(48), ADMIN_JWT_SECRET: 'a'.repeat(48) }, () => {
      expect(requireParentJwtSecret()).toBe('p'.repeat(48));
    });
  });
});

describe('the session lifetime', () => {
  const saved = process.env.PARENT_SESSION_TTL_SECONDS;

  afterEach(() => {
    if (saved === undefined) delete process.env.PARENT_SESSION_TTL_SECONDS;
    else process.env.PARENT_SESSION_TTL_SECONDS = saved;
  });

  it('defaults to the 30-day session TTL, never the elevation ceiling', () => {
    delete process.env.PARENT_SESSION_TTL_SECONDS;
    expect(parentSessionTtlSeconds()).toBe(DEFAULT_PARENT_SESSION_TTL_SECONDS);
    expect(parentSessionTtlSeconds()).not.toBe(8 * 60 * 60);
  });

  it('reads an explicit value', () => {
    process.env.PARENT_SESSION_TTL_SECONDS = '3600';
    expect(parentSessionTtlSeconds()).toBe(3600);
  });

  it('refuses a non-positive value, which would expire every session instantly', () => {
    process.env.PARENT_SESSION_TTL_SECONDS = '0';
    expect(() => parentSessionTtlSeconds()).toThrow('must be a positive whole number');
    process.env.PARENT_SESSION_TTL_SECONDS = '-1';
    expect(() => parentSessionTtlSeconds()).toThrow('must be a positive whole number');
  });
});
