import { Client } from 'pg';
import { createParentAccountFixture } from './fixtures';
import { e2eDatabaseUrl } from './database';

/**
 * Two Parent Accounts in different timezones, so the suite can assert that each
 * account's period is computed in its own zone. These are an **E2E fixture**,
 * created against the E2E database only — the production seed script never
 * creates a Parent Account.
 *
 * They are **read-only**: no test may change their tier, because another test
 * asserts that an unassigned account reads `Free`. A test that needs to change
 * a tier seeds its own account through `uniqueParentAccount`.
 */
export const PARENT_ACCOUNT_FIXTURES = [
  { email: 'ada@example.test', displayName: 'Ada', timezone: 'Asia/Manila' },
  { email: 'grace@example.test', displayName: 'Grace', timezone: 'America/New_York' },
] as const;

/** Starts every E2E run from an empty taxonomy and a known account base. The
 * database is provisioned by `e2e/prepare.ts`, which runs before the API server
 * is launched. */
export default async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE TABLE "subject_grade_level", "subject", "grade_level", "account_timezone", "parent_account", "admin_audit" CASCADE',
    );
  } finally {
    await client.end();
  }

  for (const fixture of PARENT_ACCOUNT_FIXTURES) {
    await createParentAccountFixture(fixture);
  }
}
