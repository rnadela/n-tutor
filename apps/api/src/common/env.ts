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

/** Port numbers are bounded; an out-of-range value must not bind a random port. */
export function requirePortEnv(name: string, fallback: number): number {
  const port = requireIntEnv(name, fallback);
  if (port > 65_535) {
    throw new Error(`Environment variable ${name} must be a valid port, got "${port}".`);
  }
  return port;
}
