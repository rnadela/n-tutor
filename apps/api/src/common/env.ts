import path from 'node:path';
import { config as loadEnv } from 'dotenv';

let loaded = false;

/** Loads the single workspace-root `.env`. Idempotent. */
export function loadRootEnv(): void {
  if (loaded) return;
  loadEnv({
    path: path.resolve(import.meta.dirname, '..', '..', '..', '..', '.env'),
    quiet: true,
  });
  loaded = true;
}

export function requireEnv(name: string): string {
  loadRootEnv();
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  loadRootEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

/** Reads a positive integer, failing fast rather than yielding NaN. */
export function requireIntEnv(name: string, fallback: number): number {
  loadRootEnv();
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`Environment variable ${name} must be a positive whole number, got "${raw}".`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive whole number, got "${raw}".`);
  }
  return value;
}

/** The placeholder shipped in `.env.example`; never valid at runtime. */
export const PLACEHOLDER_JWT_SECRET = 'change-me-in-every-environment';

export const MIN_JWT_SECRET_LENGTH = 32;

export function requireJwtSecret(name: string): string {
  const secret = requireEnv(name);
  if (secret === PLACEHOLDER_JWT_SECRET) {
    throw new Error(`${name} is still the .env.example placeholder. Set a real secret.`);
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_JWT_SECRET_LENGTH} characters.`);
  }
  return secret;
}

/**
 * The parent session secret, which must not be the admin secret.
 *
 * The two-surface separation (AD-25) is the reason a parent token cannot be
 * verified by the admin guard at all. Sharing one secret collapses that to a
 * claim check, so it fails at boot rather than resting on an operator's care.
 */
export function requireParentJwtSecret(): string {
  const secret = requireJwtSecret('PARENT_JWT_SECRET');
  if (secret === requireJwtSecret('ADMIN_JWT_SECRET')) {
    throw new Error(
      'PARENT_JWT_SECRET must differ from ADMIN_JWT_SECRET: the parent and admin surfaces are separate credentials.',
    );
  }
  return secret;
}

/** `true`/`false` only; anything else is a configuration mistake, not a default. */
export function optionalBoolEnv(name: string, fallback: boolean): boolean {
  loadRootEnv();
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Environment variable ${name} must be "true" or "false", got "${raw}".`);
}

/**
 * The browser origin. Credentialed CORS against a wrong origin fails every
 * call, so production must state it rather than inherit a localhost default.
 */
export function requireWebOrigin(): string {
  loadRootEnv();
  const value = process.env.WEB_ORIGIN;
  if (value === undefined || value === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('WEB_ORIGIN is required when NODE_ENV=production.');
    }
    return 'http://localhost:3000';
  }
  return value.replace(/\/+$/, '');
}

/** Port numbers are bounded; an out-of-range value must not bind a random port. */
export function requirePortEnv(name: string, fallback: number): number {
  const port = requireIntEnv(name, fallback);
  if (port > 65_535) {
    throw new Error(`Environment variable ${name} must be a valid port, got "${port}".`);
  }
  return port;
}
