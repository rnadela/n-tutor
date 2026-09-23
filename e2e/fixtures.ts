import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { e2eDatabaseUrl } from './database';
import { lastMailTo, resetLinkFrom } from './mail-sink';

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

/** An email nothing else in the run touches, sorting after the read-only fixtures. */
export function uniqueParentEmail(label: string): string {
  return `zz-${label}-${randomUUID().slice(0, 8)}@example.test`;
}

export interface GradeLevelFixture {
  id: string;
  name: string;
}

/**
 * An enabled Grade Level, seeded straight into the E2E database.
 *
 * There is no parent-facing route that creates one — the taxonomy is Admin's —
 * so a Parent-View test that needs a grade level to choose has to seed it. The
 * name is unique per call, so the suite stays order-independent and the Admin
 * taxonomy tests never see a row they did not create.
 */
export async function createGradeLevelFixture(label: string): Promise<GradeLevelFixture> {
  const name = `${label} ${randomUUID().slice(0, 8)}`;
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const id = randomUUID();
    await client.query(
      `INSERT INTO "grade_level" ("id", "name", "nameKey", "enabled", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [id, name, taxonomyNameKey(name)],
    );
    return { id, name };
  } finally {
    await client.end();
  }
}

/**
 * The uniqueness key exactly as `TaxonomyService` computes it: NFKC, internal
 * whitespace collapsed, trimmed, then lower-cased. Restated here because a
 * seeded row that keys itself differently from an Admin-created one would
 * collide, or fail to collide, for reasons no product rule explains.
 */
function taxonomyNameKey(name: string): string {
  return name.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * Withdraws a Grade Level the way Admin does — the flag alone, nothing deleted
 * — so a test can observe what a profile already stored against it then reads.
 */
export async function disableGradeLevelFixture(id: string): Promise<void> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      'UPDATE "grade_level" SET "enabled" = false, "updatedAt" = now() WHERE "id" = $1',
      [id],
    );
  } finally {
    await client.end();
  }
}

/**
 * The stored Student Profile row, straight from the database.
 *
 * The elevation bearer lives in the page's memory alone (AD-18), so a browser
 * test cannot call the parent-scoped API itself. What archiving did to the row
 * — nothing destroyed, one instant written — is therefore observed here, while
 * what it did to the screen is observed in the browser.
 */
export async function readStudentProfile(
  parentEmail: string,
  displayName: string,
): Promise<{ id: string; archivedAt: Date | null; createdAt: Date }> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    // Scoped to the account, because the product deliberately allows two
    // children to share a name — an unscoped lookup by name alone would read
    // some other test's row and quietly assert about it.
    const result = await client.query<{ id: string; archivedAt: Date | null; createdAt: Date }>(
      `SELECT p."id", p."archivedAt", p."createdAt"
       FROM "student_profile" p
       JOIN "parent_account" a ON a."id" = p."parentAccountId"
       WHERE a."email" = $1 AND p."displayName" = $2`,
      [parentEmail, displayName],
    );
    if (result.rows.length !== 1) {
      throw new Error(
        `Expected exactly one profile named ${displayName} on ${parentEmail}, found ${result.rows.length}.`,
      );
    }
    return result.rows[0]!;
  } finally {
    await client.end();
  }
}

/** How many reset rows exist for an email — zero is the assertion that matters. */
export async function countPasswordResetsFor(email: string): Promise<number> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM "password_reset" r
       JOIN "parent_account" a ON a."id" = r."parentAccountId"
       WHERE a."email" = $1`,
      [email],
    );
    return Number(result.rows[0]?.count ?? '0');
  } finally {
    await client.end();
  }
}

/**
 * The reset link the API actually emailed, read out of the E2E mail sink. The
 * plaintext token exists nowhere else — the stored row holds only its hash —
 * so this is the only way to complete the round trip in a browser.
 */
export async function waitForResetLink(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const message = lastMailTo(email);
    if (message) return resetLinkFrom(message);
    if (Date.now() > deadline) throw new Error(`No reset mail for ${email} within ${timeoutMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
