import { Client } from 'pg';
import { e2eDatabaseUrl } from './database';

/** Starts every E2E run from an empty taxonomy. The database is provisioned by
 * `e2e/prepare.ts`, which runs before the API server is launched. */
export default async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE TABLE "subject_grade_level", "subject", "grade_level", "admin_audit" CASCADE',
    );
  } finally {
    await client.end();
  }
}
