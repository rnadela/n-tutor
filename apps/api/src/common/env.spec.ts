import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_JWT_SECRET_LENGTH,
  PLACEHOLDER_JWT_SECRET,
  requireIntEnv,
  requireJwtSecret,
  requirePortEnv,
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
