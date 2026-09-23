import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { DATABASE_NAMES, siblingDatabaseUrl } from '../apps/api/src/common/database-url';

export const repoRoot = path.resolve(__dirname, '..');

let loaded = false;

function baseUrl(): string {
  if (!loaded) {
    loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });
    loaded = true;
  }
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Missing required environment variable: DATABASE_URL');
  return base;
}

/** The E2E run gets its own database, never the developer's. */
export function e2eDatabaseUrl(): string {
  return siblingDatabaseUrl(baseUrl(), DATABASE_NAMES.e2e);
}

export function maintenanceDatabaseUrl(): string {
  return siblingDatabaseUrl(baseUrl(), DATABASE_NAMES.maintenance);
}

export const e2eDatabaseName = DATABASE_NAMES.e2e;
