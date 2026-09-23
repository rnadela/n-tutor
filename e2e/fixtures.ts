import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { e2eDatabaseUrl } from './database';

export interface ParentAccountFixture {
  email: string;
  displayName: string;
  timezone: string;
}

/**
 * Creates a Parent Account directly in the E2E database.
 *
 * There is deliberately no account-creation route in the Admin console, so a
 * test that needs an account it may mutate has to seed one. Each mutating test
 * takes its own account through `uniqueParentAccount`, which is what keeps the
 * suite order-independent: no test changes a tier another test asserts on.
 *
 * The `tier` column is left alone so the schema default (`Free`) is what tests
 * observe — no tier figure is restated here.
 */
export async function createParentAccountFixture(fixture: ParentAccountFixture): Promise<string> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const accountId = randomUUID();
    await client.query(
      'INSERT INTO "parent_account" ("id", "email", "displayName", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())',
      [accountId, fixture.email, fixture.displayName],
    );
    // Effective well before the current period's start: a zone that only took
    // effect mid-period would (correctly) not apply to the running period.
    await client.query(
      `INSERT INTO "account_timezone" ("id", "parentAccountId", "timezone", "effectiveFrom")
       VALUES ($1, $2, $3, now() - interval '1 year')`,
      [randomUUID(), accountId, fixture.timezone],
    );
    return accountId;
  } finally {
    await client.end();
  }
}

/**
 * An account nothing else in the run touches. The email sorts after the
 * read-only fixtures, so the list's email ordering stays predictable.
 */
export async function uniqueParentAccount(
  label: string,
  timezone = 'UTC',
): Promise<ParentAccountFixture> {
  const fixture: ParentAccountFixture = {
    email: `zz-${label}-${randomUUID().slice(0, 8)}@example.test`,
    displayName: label,
    timezone,
  };
  await createParentAccountFixture(fixture);
  return fixture;
}
