import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_JWT_SECRET_LENGTH,
  optionalBoolEnv,
  PLACEHOLDER_JWT_SECRET,
  requireIntEnv,
  requireJwtSecret,
  requirePortEnv,
  requireWebOrigin,
} from './env.js';

const TEST_VAR = 'ENV_SPEC_TEST_VAR';

afterEach(() => {
  delete process.env[TEST_VAR];
});

describe('requireJwtSecret', () => {
  it('rejects the .env.example placeholder', () => {
    process.env[TEST_VAR] = PLACEHOLDER_JWT_SECRET;
    expect(() => requireJwtSecret(TEST_VAR)).toThrow('still the .env.example placeholder');
  });

  it('rejects a secret shorter than the minimum length', () => {
    process.env[TEST_VAR] = 'a'.repeat(MIN_JWT_SECRET_LENGTH - 1);
    expect(() => requireJwtSecret(TEST_VAR)).toThrow('must be at least');
  });

  it('accepts a real secret of sufficient length', () => {
    process.env[TEST_VAR] = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
    expect(requireJwtSecret(TEST_VAR)).toBe('a'.repeat(MIN_JWT_SECRET_LENGTH));
  });
});

describe('requireIntEnv', () => {
  it('returns the fallback when unset', () => {
    expect(requireIntEnv(TEST_VAR, 42)).toBe(42);
  });

  it('throws for a non-numeric value instead of yielding NaN', () => {
    process.env[TEST_VAR] = 'not-a-number';
    expect(() => requireIntEnv(TEST_VAR, 1)).toThrow('must be a positive whole number');
  });

  it('throws for zero', () => {
    process.env[TEST_VAR] = '0';
    expect(() => requireIntEnv(TEST_VAR, 1)).toThrow('must be a positive whole number');
  });

  it('throws for a negative value', () => {
    process.env[TEST_VAR] = '-5';
    expect(() => requireIntEnv(TEST_VAR, 1)).toThrow('must be a positive whole number');
  });
});

describe('requirePortEnv', () => {
  it('throws for a port above the valid range', () => {
    process.env[TEST_VAR] = '70000';
    expect(() => requirePortEnv(TEST_VAR, 3000)).toThrow('must be a valid port');
  });

  it('accepts a valid port', () => {
    process.env[TEST_VAR] = '3001';
    expect(requirePortEnv(TEST_VAR, 3000)).toBe(3001);
  });
});

describe('optionalBoolEnv', () => {
  it('returns the fallback when unset', () => {
    expect(optionalBoolEnv(TEST_VAR, true)).toBe(true);
    expect(optionalBoolEnv(TEST_VAR, false)).toBe(false);
  });

  it('reads "true" and "false", whatever the casing or padding', () => {
    process.env[TEST_VAR] = 'true';
    expect(optionalBoolEnv(TEST_VAR, false)).toBe(true);
    process.env[TEST_VAR] = ' FALSE ';
    expect(optionalBoolEnv(TEST_VAR, true)).toBe(false);
  });

  it('throws for anything else rather than treating it as false', () => {
    process.env[TEST_VAR] = 'yes';
    expect(() => optionalBoolEnv(TEST_VAR, true)).toThrow('must be "true" or "false"');
  });
});

describe('requireWebOrigin', () => {
  const withEnv = (values: Record<string, string | undefined>, run: () => void): void => {
    const saved = { ...process.env };
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      run();
    } finally {
      process.env = saved;
    }
  };

  it('refuses to default in production, because credentialed CORS would fail every call', () => {
    withEnv({ WEB_ORIGIN: undefined, NODE_ENV: 'production' }, () => {
      expect(() => requireWebOrigin()).toThrow('WEB_ORIGIN is required');
    });
  });

  it('falls back to localhost outside production', () => {
    withEnv({ WEB_ORIGIN: undefined, NODE_ENV: 'test' }, () => {
      expect(requireWebOrigin()).toBe('http://localhost:3000');
    });
  });

  it('strips a trailing slash, so a reset link never doubles one', () => {
    withEnv({ WEB_ORIGIN: 'https://app.example.test/', NODE_ENV: 'test' }, () => {
      expect(requireWebOrigin()).toBe('https://app.example.test');
    });
  });
});
