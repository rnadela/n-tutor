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

export interface SubjectFixture {
  id: string;
  name: string;
}

/**
 * An enabled Subject, plus the enabled `subject_grade_level` join row that
 * makes it *offered* for one Grade Level.
 *
 * Both rows, because selectability is the conjunction of three independent
 * flags: the Subject's, the Grade Level's, and the join row's. A Subject seeded
 * without the join row is enabled and offered nowhere, which is not the state a
 * capture test needs. `taxonomyNameKey` is reused for the same reason
 * `createGradeLevelFixture` uses it — a seeded row that keys itself differently
 * from an Admin-created one would collide, or fail to collide, for reasons no
 * product rule explains.
 */
export async function createSubjectFixture(
  label: string,
  gradeLevelId: string,
): Promise<SubjectFixture> {
  const name = `${label} ${randomUUID().slice(0, 8)}`;
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const id = randomUUID();
    await client.query(
      `INSERT INTO "subject" ("id", "name", "nameKey", "enabled", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [id, name, taxonomyNameKey(name)],
    );
    await client.query(
      `INSERT INTO "subject_grade_level" ("id", "subjectId", "gradeLevelId", "enabled", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [randomUUID(), id, gradeLevelId],
    );
    return { id, name };
  } finally {
    await client.end();
  }
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

/**
 * Sets an account's tier the way the Admin console does — the column alone,
 * nothing else touched.
 *
 * It exists because the bound this epic is about is a *function* of the tier,
 * and the tier is Admin's to set: there is no parent-facing route that could
 * change it, so a Parent-View test that needs anything but the Free default has
 * to seed it. No limit figure is restated here; the limits live in the API's
 * one tiers table and the screen reads every one of them off the response.
 */
export async function setParentTierFixture(email: string, tier: string): Promise<void> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      'UPDATE "parent_account" SET "tier" = $2::"account_tier", "updatedAt" = now() WHERE "email" = $1',
      [email, tier],
    );
  } finally {
    await client.end();
  }
}

/**
 * Spends part of an account's Generation Allowance without generating anything.
 *
 * Usage is *derived* — it is the count of Practice Tests charged inside the
 * period window (AD-14) — so "already used one" is expressed as the row that
 * charge lives on and in no other way. A counter column would be the wrong
 * shape to seed because no such column exists.
 *
 * The rows hang off a real Source Test and generation job, because every one of
 * those columns is `NOT NULL` and a fixture that faked them would be asserting
 * about a shape the product cannot produce.
 */
export async function chargeGenerationAllowanceFixture(
  parentEmail: string,
  count: number,
): Promise<void> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const target = await client.query<{
      id: string;
      parentAccountId: string;
      studentProfileId: string;
    }>(
      `SELECT s."id", s."parentAccountId", s."studentProfileId"
       FROM "source_test" s
       JOIN "parent_account" a ON a."id" = s."parentAccountId"
       WHERE a."email" = $1
       ORDER BY s."createdAt" DESC
       LIMIT 1`,
      [parentEmail],
    );
    const row = target.rows[0];
    if (!row) throw new Error(`No Source Test on ${parentEmail} to charge against.`);

    const jobId = randomUUID();
    await client.query(
      `INSERT INTO "generation_job"
         ("id", "parentAccountId", "sourceTestId", "studentProfileId", "requestedCount",
          "producedCount", "status", "createdAt", "updatedAt", "completedAt")
       VALUES ($1, $2, $3, $4, $5, $5, 'Succeeded'::"generation_job_status", now(), now(), now())`,
      [jobId, row.parentAccountId, row.id, row.studentProfileId, count],
    );
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      await client.query(
        `INSERT INTO "practice_test"
           ("id", "parentAccountId", "sourceTestId", "studentProfileId", "generationJobId",
            "status", "ordinal", "questionCount", "chargedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'Draft'::"practice_test_status", $6, 1, now(), now(), now())`,
        [randomUUID(), row.parentAccountId, row.id, row.studentProfileId, jobId, ordinal],
      );
    }
  } finally {
    await client.end();
  }
}

/** How many Practice Tests were actually generated for an account. */
/**
 * The weighted Topic the server actually stored for this parent's newest
 * generation job, or null for an unweighted request.
 *
 * Read from the row rather than from the screen: what is being proved is that
 * the choice left the browser, was resolved against the Extraction and was
 * persisted — none of which a sentence rendered from this page's own state
 * could show.
 */
export async function weightedTopicOfNewestJobFor(parentEmail: string): Promise<string | null> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ weightedTopic: string | null }>(
      `SELECT j."weightedTopic"
       FROM "generation_job" j
       JOIN "parent_account" a ON a."id" = j."parentAccountId"
       WHERE a."email" = $1
       ORDER BY j."createdAt" DESC, j."id" DESC
       LIMIT 1`,
      [parentEmail],
    );
    return result.rows[0]?.weightedTopic ?? null;
  } finally {
    await client.end();
  }
}

/**
 * Every Topic label stored against this parent's generated Questions.
 *
 * The labels on the rows that actually landed, which is what makes "the draft
 * was written against the Topic that was chosen" observable end to end.
 */
export async function generatedTopicLabelsFor(parentEmail: string): Promise<string[]> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ label: string }>(
      `SELECT t."label"
       FROM "practice_test_question_topic" t
       JOIN "practice_test_question" q ON q."id" = t."questionId"
       JOIN "practice_test" p ON p."id" = q."practiceTestId"
       JOIN "parent_account" a ON a."id" = p."parentAccountId"
       WHERE a."email" = $1`,
      [parentEmail],
    );
    return result.rows.map((row) => row.label);
  } finally {
    await client.end();
  }
}

export async function countPracticeTestsFor(parentEmail: string): Promise<number> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM "practice_test" p
       JOIN "parent_account" a ON a."id" = p."parentAccountId"
       WHERE a."email" = $1 AND p."chargedAt" IS NOT NULL`,
      [parentEmail],
    );
    return Number(result.rows[0]?.count ?? '0');
  } finally {
    await client.end();
  }
}

/**
 * Spreads the newest draft's Questions across all three Formats.
 *
 * The fake Extraction reads only Multiple Choice questions off a page, so every
 * generated draft is Multiple Choice throughout — and the Take Test screen's
 * other two controls would never be reached by a test that drove the real
 * pipeline and nothing else. This rewrites the stored rows directly, which is
 * honest about what it is: the API's contract says a Question carries one of
 * three Formats, and this is how a browser test gets a draft that holds all of
 * them.
 *
 * Nothing about the *student* path is faked — the row is stored exactly as
 * generation would store it, and everything the test then asserts goes through
 * the real release, the real binding and the real read.
 */
export async function spreadPracticeTestFormatsFixture(parentEmail: string): Promise<number> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const draft = await client.query<{ id: string }>(
      `SELECT p."id"
         FROM "practice_test" p
         JOIN "parent_account" a ON a."id" = p."parentAccountId"
        WHERE a."email" = $1 AND p."status" = 'Draft'
        ORDER BY p."createdAt" DESC, p."id" DESC
        LIMIT 1`,
      [parentEmail],
    );
    const practiceTestId = draft.rows[0]?.id;
    if (practiceTestId === undefined) throw new Error('No draft practice test to spread.');

    const questions = await client.query<{ id: string; ordinal: number }>(
      `SELECT "id", "ordinal" FROM "practice_test_question"
        WHERE "practiceTestId" = $1 ORDER BY "ordinal" ASC`,
      [practiceTestId],
    );
    if (questions.rows.length < 2) throw new Error('A draft with fewer than two Questions.');

    // The second becomes the fill-in-the-blank: its options go, and the free-text
    // answer arrives — the shape every non-MultipleChoice Question is stored in.
    const second = questions.rows[1]!;
    await client.query('DELETE FROM "practice_test_choice" WHERE "questionId" = $1', [second.id]);
    await client.query(
      `UPDATE "practice_test_question"
          SET "format" = 'FillInTheBlank',
              "prompt" = $2::jsonb,
              "answer" = $3::jsonb
        WHERE "id" = $1`,
      [
        second.id,
        JSON.stringify([{ kind: 'text', value: 'What fraction of the whole is shaded?' }]),
        JSON.stringify([{ kind: 'fraction', whole: null, numerator: 3, denominator: 4 }]),
      ],
    );

    // A third is appended for short answer, so all three controls are on the
    // path the test walks.
    const thirdId = randomUUID();
    const thirdOrdinal = questions.rows.length + 1;
    await client.query(
      `INSERT INTO "practice_test_question"
         ("id", "practiceTestId", "ordinal", "format", "prompt", "answer", "createdAt")
       VALUES ($1, $2, $3, 'ShortAnswer', $4::jsonb, $5::jsonb, now())`,
      [
        thirdId,
        practiceTestId,
        thirdOrdinal,
        JSON.stringify([{ kind: 'text', value: 'Explain how you worked that out.' }]),
        JSON.stringify([{ kind: 'text', value: 'Any reasoning that reaches it.' }]),
      ],
    );
    await client.query(
      'INSERT INTO "practice_test_question_topic" ("id", "questionId", "label", "createdAt") VALUES ($1, $2, $3, now())',
      [randomUUID(), thirdId, 'Reading comprehension'],
    );

    await client.query('UPDATE "practice_test" SET "questionCount" = $2 WHERE "id" = $1', [
      practiceTestId,
      thirdOrdinal,
    ]);
    return thirdOrdinal;
  } finally {
    await client.end();
  }
}
