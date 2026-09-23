import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { DATABASE_NAMES, siblingDatabaseUrl } from '../apps/api/src/common/database-url.ts';

/**
 * Provisions the E2E database before the API server starts. Playwright launches
 * its web servers before `globalSetup` runs, and the API's readiness probe now
 * checks the database, so this has to happen first.
 */
const repoRoot = path.resolve(import.meta.dirname, '..');
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });

const base = process.env.DATABASE_URL;
if (!base) throw new Error('Missing required environment variable: DATABASE_URL');

const databaseUrl = siblingDatabaseUrl(base, DATABASE_NAMES.e2e);

const admin = new Client({
  connectionString: siblingDatabaseUrl(base, DATABASE_NAMES.maintenance),
});
await admin.connect();
try {
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    DATABASE_NAMES.e2e,
  ]);
  if (existing.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${DATABASE_NAMES.e2e}"`);
  }
} finally {
  await admin.end();
}

const env = { ...process.env, DATABASE_URL: databaseUrl };
execFileSync('pnpm', ['--filter', 'api', 'exec', 'prisma', 'migrate', 'deploy'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
});
execFileSync('pnpm', ['--filter', 'api', 'run', 'seed'], { cwd: repoRoot, env, stdio: 'inherit' });
