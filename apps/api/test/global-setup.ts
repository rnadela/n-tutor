import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { DATABASE_NAMES } from '../src/common/database-url.js';
import { adminDatabaseUrl, testDatabaseUrl } from './test-env.js';

export default async function setup(): Promise<void> {
  const admin = new Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DATABASE_NAMES.test,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${DATABASE_NAMES.test}"`);
    }
  } finally {
    await admin.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}
