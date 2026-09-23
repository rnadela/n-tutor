import { loadRootEnv } from '../src/common/env.js';
import { DATABASE_NAMES, siblingDatabaseUrl } from '../src/common/database-url.js';

function baseUrl(): string {
  loadRootEnv();
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Missing required environment variable: DATABASE_URL');
  return base;
}

/** Tier-1 tests run against a real Postgres (AD-22), on a database of their own. */
export function testDatabaseUrl(): string {
  return siblingDatabaseUrl(baseUrl(), DATABASE_NAMES.test);
}

export function adminDatabaseUrl(): string {
  return siblingDatabaseUrl(baseUrl(), DATABASE_NAMES.maintenance);
}
