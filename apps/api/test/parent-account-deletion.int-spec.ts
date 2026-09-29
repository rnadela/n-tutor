import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { storagePathFor, uploadRoot } = await import('../src/sourcetest/source-test-policy.js');
const { DELETION_INCOMPLETE, PASSWORD_INCORRECT } = await import(
  '../src/deletion/deletion-policy.js'
);
const { ExplanationService } = await import('../src/explanation/explanation.service.js');
const { PageIngestService } = await import('../src/sourcetest/page-ingest.service.js');
const { PARENT_SESSION_COOKIE } = await import('../src/identity/auth-policy.js');
const { STUDENT_MODE_COOKIE } = await import('../src/identity/student-mode-policy.js');
const {
  bearer,
  bindDevice,
  checkLegibility,
  createGradeLevel,
  createHarness,
  createSignedInParent,
  createStudentProfile,
  createSubject,
  elevate,
  resetParentAccounts,
  resetTaxonomy,
  seedAiCall,
  setPinFor,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';

/**
 * How many cost rows the fixture seeds for an account.
 *
 * More than one, so "the purge ran" is distinguishable from "one row happened to
 * go". They are seeded rather than earned because `ai_call` is the one `Restrict`
 * child of the account that is not profile-scoped: without rows here, the purge
 * that frees that edge could be missing and every assertion would still pass.
 */
const SEEDED_AI_CALLS = 2;

/** A real photo's bytes, varied per call so two pages are not one file. */
function photo(seed: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 40,
      height: 60,
      channels: 3,
      background: { r: seed % 256, g: (seed * 7) % 256, b: 128 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function fileExists(pageId: string): Promise<boolean> {
  try {
    await access(storagePathFor(pageId, uploadRoot()));
    return true;
  } catch {
    return false;
  }
}

/** Every `Set-Cookie` value for one cookie name, as the browser would read them. */
function setCookiesFor(response: { headers: Record<string, unknown> }, name: string): string[] {
  const raw = response.headers['set-cookie'];
  const values = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return values.filter((value) => value.startsWith(`${name}=`));
}

/**
 * FR-33, Story 8.4: a parent deletes the whole Parent Account — against real
 * rows, real files and the real routes.
 *
 * Everything here is here because it is not reachable in the unit tier: that the
 * bytes actually leave the disk, that the five `Restrict` edges are walked in an
 * order Postgres accepts, that the `Cascade` edges from the account row take the
 * consents, reset tokens, timezone history, uncommitted state and usage
 * tombstones with it, that `admin_audit` survives, that a **second account** is
 * untouched, and that the response clears both cookies so the browser stops
 * holding a credential for an account that no longer resolves.
 *
 * The upload is driven through the real routes, because what must be gone is the
 * file ingest actually wrote at the path ingest actually derived. Everything
 * downstream of it is seeded, because these cases are about what deletion removes
 * and not about producing the work.
 */
describe('a parent deletes the whole Parent Account', () => {
  let h: Harness;
  const server = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    h.mail.reset();
    h.ai.reset();
  });

  interface Child {
    profileId: string;
    sourceTestId: string;
    pageIds: string[];
    practiceTestId: string;
    attemptId: string;
    explanationId: string;
  }

  interface Account {
    parentAccountId: string;
    email: string;
    password: string;
    cookie: string;
    token: string;
    gradeLevelId: string;
    subjectId: string;
    children: Child[];
  }

  /** A signed-in, elevated parent with a Grade Level and a Subject to hand. */
  async function elevatedParent(): Promise<Account> {
    const gradeLevel = await createGradeLevel(h);
    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    return {
      parentAccountId: parent.parentAccountId,
      email: parent.email,
      password: parent.password,
      cookie: parent.cookie,
      token,
      gradeLevelId: gradeLevel.id,
      subjectId: subject.id,
      children: [],
    };
  }

  /** One child with an upload committed through the real routes, plus one of
   * everything the deletion has to take with it. */
  async function childOf(account: Account, pageCount = 2): Promise<Child> {
    const profile = await createStudentProfile(h, account.parentAccountId, {
      gradeLevelId: account.gradeLevelId,
    });

    const draft = await server()
      .post('/api/parent/source-tests')
      .set('Authorization', bearer(account.token))
      .send({ studentProfileId: profile.id })
      .expect(200);
    const sourceTestId: string = draft.body.id;

    await server()
      .patch(`/api/parent/source-tests/${sourceTestId}/classification`)
      .set('Authorization', bearer(account.token))
      .send({ subjectId: account.subjectId })
      .expect(200);

    for (let index = 0; index < pageCount; index += 1) {
      await server()
        .post(`/api/parent/source-tests/${sourceTestId}/pages`)
        .set('Authorization', bearer(account.token))
        .attach('file', await photo(index + 1), {
          filename: 'page.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
    }
    await checkLegibility(h, account.token, sourceTestId);
    await server()
      .post(`/api/parent/source-tests/${sourceTestId}/submit`)
      .set('Authorization', bearer(account.token))
      .expect(200);

    const pages = await h.prisma.pageImage.findMany({
      where: { sourceTestId },
      select: { id: true },
      orderBy: { ordinal: 'asc' },
    });

    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId: account.parentAccountId,
        sourceTestId,
        studentProfileId: profile.id,
        requestedCount: 1,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const practiceTest = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: account.parentAccountId,
        sourceTestId,
        studentProfileId: profile.id,
        generationJobId: job.id,
        status: 'Released',
        ordinal: 1,
        questionCount: 1,
        chargedAt: new Date(),
      },
      select: { id: true },
    });
    const question = await h.prisma.practiceTestQuestion.create({
      data: {
        practiceTestId: practiceTest.id,
        ordinal: 1,
        format: 'ShortAnswer',
        prompt: [{ kind: 'text', value: 'What is half of six?' }],
        answer: [{ kind: 'text', value: '3' }],
      },
      select: { id: true },
    });
    const attempt = await h.prisma.attempt.create({
      data: {
        practiceTestId: practiceTest.id,
        parentAccountId: account.parentAccountId,
        studentProfileId: profile.id,
        ordinal: 1,
        startedAt: new Date(Date.now() - 600_000),
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    await h.prisma.answer.create({
      data: { attemptId: attempt.id, questionId: question.id, value: 'four' },
    });
    const explanation = await h.prisma.explanation.create({
      data: {
        parentAccountId: account.parentAccountId,
        studentProfileId: profile.id,
        attemptId: attempt.id,
        questionId: question.id,
        body: [{ kind: 'text', value: 'Half of six is three.' }],
        chargedAt: new Date(),
      },
      select: { id: true },
    });
    // A pending report in the Admin queue, so the queue's own emptying is
    // observable and not merely assumed from the cascade.
    await h.prisma.explanationFlag.create({
      data: {
        explanationId: explanation.id,
        parentAccountId: account.parentAccountId,
        studentProfileId: profile.id,
        origin: 'Parent',
      },
    });
    const topic = await h.prisma.topic.create({
      data: {
        subjectId: account.subjectId,
        name: `Fractions ${randomUUID().slice(0, 8)}`,
        matchKey: randomUUID(),
        provisional: false,
      },
      select: { id: true },
    });
    await h.prisma.topicMastery.create({
      data: {
        studentProfileId: profile.id,
        topicId: topic.id,
        correct: 3,
        incorrect: 1,
        unanswered: 0,
        attemptsCounted: 1,
        value: 0.75,
      },
    });

    const child: Child = {
      profileId: profile.id,
      sourceTestId,
      pageIds: pages.map((page) => page.id),
      practiceTestId: practiceTest.id,
      attemptId: attempt.id,
      explanationId: explanation.id,
    };
    account.children.push(child);
    return child;
  }

  /**
   * An account with two children and every account-level row the deletion has to
   * take with it: a cost row, a reset token, uncommitted Parent View state, a
   * usage tombstone left behind by a Story 8.3 deletion, and an `admin_audit`
   * entry that must **survive**.
   *
   * The consents and the timezone row are already there, written by the sign-up
   * this fixture went through.
   */
  async function fullAccount(): Promise<Account> {
    const account = await elevatedParent();
    await childOf(account);
    await childOf(account);

    for (let index = 0; index < SEEDED_AI_CALLS; index += 1) {
      await seedAiCall(h, account.parentAccountId);
    }
    await h.prisma.passwordReset.create({
      data: {
        parentAccountId: account.parentAccountId,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await h.prisma.uncommittedState.create({
      data: {
        parentAccountId: account.parentAccountId,
        studentProfileId: account.children[0]!.profileId,
        kind: 'DraftEdit',
        scope: randomUUID(),
        payload: { note: 'half typed' },
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    // A tombstone of the kind Story 8.3 leaves behind: it must go with the
    // account rather than block it.
    await h.prisma.usageTombstone.create({
      data: {
        parentAccountId: account.parentAccountId,
        periodStart: new Date(Date.UTC(2026, 0, 1)),
        usageClass: 'Upload',
        count: 3,
      },
    });
    // An operator's record against this account, which must survive the deletion.
    await h.audit.record(
      h.prisma,
      h.operatorId,
      'parentAccount.tierChange',
      'ParentAccount',
      account.parentAccountId,
    );

    return account;
  }

  function deleteRequest(account: Account, password: string) {
    return server()
      .delete('/api/parent/account')
      .set('Authorization', bearer(account.token))
      .set('Cookie', account.cookie)
      .send({ password });
  }

  /** Every row of this account, by table, in one object a test can compare whole. */
  async function rowCounts(account: Account) {
    const parentAccountId = account.parentAccountId;
    const profileIds = account.children.map((child) => child.profileId);
    const [
      accounts,
      profiles,
      sourceTests,
      pages,
      jobs,
      tests,
      questions,
      attempts,
      explanations,
      flags,
      mastery,
      consents,
      resets,
      timezones,
      uncommitted,
      tombstones,
      aiCalls,
    ] = await Promise.all([
      h.prisma.parentAccount.count({ where: { id: parentAccountId } }),
      h.prisma.studentProfile.count({ where: { parentAccountId } }),
      h.prisma.sourceTest.count({ where: { parentAccountId } }),
      h.prisma.pageImage.count({ where: { sourceTest: { parentAccountId } } }),
      h.prisma.generationJob.count({ where: { parentAccountId } }),
      h.prisma.practiceTest.count({ where: { parentAccountId } }),
      h.prisma.practiceTestQuestion.count({
        where: { practiceTest: { parentAccountId } },
      }),
      h.prisma.attempt.count({ where: { parentAccountId } }),
      h.prisma.explanation.count({ where: { parentAccountId } }),
      h.prisma.explanationFlag.count({ where: { parentAccountId } }),
      h.prisma.topicMastery.count({ where: { studentProfileId: { in: profileIds } } }),
      h.prisma.accountConsent.count({ where: { parentAccountId } }),
      h.prisma.passwordReset.count({ where: { parentAccountId } }),
      h.prisma.accountTimezone.count({ where: { parentAccountId } }),
      h.prisma.uncommittedState.count({ where: { parentAccountId } }),
      h.prisma.usageTombstone.count({ where: { parentAccountId } }),
      h.prisma.aiCall.count({ where: { parentAccountId } }),
    ]);
    return {
      accounts,
      profiles,
      sourceTests,
      pages,
      jobs,
      tests,
      questions,
      attempts,
      explanations,
      flags,
      mastery,
      consents,
      resets,
      timezones,
      uncommitted,
      tombstones,
      aiCalls,
    };
  }

  const FULL = {
    accounts: 1,
    profiles: 2,
    sourceTests: 2,
    pages: 4,
    jobs: 2,
    tests: 2,
    questions: 2,
    attempts: 2,
    explanations: 2,
    flags: 2,
    mastery: 2,
    // One row, written by the sign-up: a consent row carries both versions.
    consents: 1,
    resets: 1,
    timezones: 1,
    uncommitted: 1,
    tombstones: 1,
  };

  const NOTHING = Object.fromEntries(Object.keys(FULL).map((key) => [key, 0]));

  /**
   * The row counts minus the cost rows.
   *
   * `ai_call` is deliberately out of the whole-object comparison: how many
   * provider calls an upload costs is another subsystem's business — the
   * legibility check spends one today — and a deletion test that hard-coded the
   * total would fail the day that changed. The cost rows are asserted on their
   * own terms instead: some before, none after.
   */
  function withoutCostRows(counts: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.entries(counts).filter(([table]) => table !== 'aiCalls'));
  }

  function pageIdsOf(account: Account): string[] {
    return account.children.flatMap((child) => child.pageIds);
  }

  describe('with the correct account password', () => {
    it('removes every row of the account and unlinks every stored photograph', async () => {
      const account = await fullAccount();
      for (const pageId of pageIdsOf(account)) expect(await fileExists(pageId)).toBe(true);
      // The consent row and the timezone row are the sign-up's own.
      const before = await rowCounts(account);
      expect(withoutCostRows(before)).toEqual(FULL);
      // Some cost rows exist to be erased: this path is the only one that erases
      // them, so a fixture with none could not tell "deleted" from "never there".
      expect(before.aiCalls).toBeGreaterThanOrEqual(SEEDED_AI_CALLS);

      await deleteRequest(account, account.password).expect(204);

      // Every `Restrict` child, every `Cascade` child, and the account row.
      const after = await rowCounts(account);
      expect(withoutCostRows(after)).toEqual(NOTHING);
      expect(after.aiCalls).toBe(0);
      for (const pageId of pageIdsOf(account)) expect(await fileExists(pageId)).toBe(false);
      // The Extraction cluster goes with the Source Tests it belongs to.
      expect(
        await h.prisma.extraction.count({
          where: { sourceTestId: { in: account.children.map((child) => child.sourceTestId) } },
        }),
      ).toBe(0);
    });

    it('leaves the operator’s audit trail in place, still carrying no child content', async () => {
      const account = await fullAccount();
      const before = await h.prisma.adminAudit.findMany({
        where: { targetId: account.parentAccountId },
      });
      expect(before.length).toBeGreaterThan(0);

      await deleteRequest(account, account.password).expect(204);

      // `AdminAudit` holds no foreign key at all, so it survives by construction
      // — which is the point: a record of what an operator did to an account must
      // not be erasable by that account.
      const after = await h.prisma.adminAudit.findMany({
        where: { targetId: account.parentAccountId },
      });
      expect(after).toHaveLength(before.length);
      const serialised = JSON.stringify(after);
      for (const child of account.children) {
        expect(serialised).not.toContain(child.profileId);
        expect(serialised).not.toContain(child.explanationId);
      }
      expect(serialised).not.toContain(account.email);
    });

    it('empties the Admin queue of every report that hung off the account', async () => {
      const account = await fullAccount();
      const explanations = h.moduleRef.get(ExplanationService);
      const flagged = await explanations.flaggedForAdmin();
      for (const child of account.children) {
        expect(flagged.some((entry) => entry.explanationId === child.explanationId)).toBe(true);
      }

      await deleteRequest(account, account.password).expect(204);

      const after = await explanations.flaggedForAdmin();
      for (const child of account.children) {
        expect(after.some((entry) => entry.explanationId === child.explanationId)).toBe(false);
      }
    });

    it('leaves a second account’s rows and files exactly as they were', async () => {
      const doomed = await fullAccount();
      const other = await fullAccount();

      await deleteRequest(doomed, doomed.password).expect(204);

      const survived = await rowCounts(other);
      expect(withoutCostRows(survived)).toEqual(FULL);
      expect(survived.aiCalls).toBeGreaterThanOrEqual(SEEDED_AI_CALLS);
      for (const pageId of pageIdsOf(other)) expect(await fileExists(pageId)).toBe(true);
    });

    it('clears both cookies, and the old session cookie is refused afterwards', async () => {
      const account = await elevatedParent();
      const child = await childOf(account);
      // The device is bound to a child of this account, so the binding cookie is
      // a credential for something that is about to stop existing.
      const studentCookie = await bindDevice(h, account.token, child.profileId);

      const response = await deleteRequest(account, account.password).expect(204);

      // Both, through the same helpers sign-out uses: the session cookie is
      // httpOnly and the web app cannot clear it itself.
      expect(setCookiesFor(response, PARENT_SESSION_COOKIE)).toHaveLength(1);
      expect(setCookiesFor(response, STUDENT_MODE_COOKIE)).toHaveLength(1);
      // And the cookie the browser was holding no longer resolves to anything.
      await server().get('/api/auth/me').set('Cookie', account.cookie).expect(401);
      await server().get('/api/student/session').set('Cookie', studentCookie).expect(401);
    });

    it('deletes an account with no children and nothing uploaded', async () => {
      const account = await elevatedParent();

      await deleteRequest(account, account.password).expect(204);

      // The account row and its consents and timezone history go; there was
      // never anything else.
      expect(withoutCostRows(await rowCounts(account))).toEqual(NOTHING);
    });
  });

  describe('when the deletion is refused', () => {
    it('answers a wrong password with 409 and removes nothing', async () => {
      const account = await fullAccount();

      const refused = await deleteRequest(account, 'not-the-password-at-all').expect(409);

      // 409 and never 401: a 401 is how the web client learns Parent View has
      // ended, and it would take the parent off the screen holding the refusal.
      expect(refused.body.message).toBe(PASSWORD_INCORRECT);
      const kept = await rowCounts(account);
      expect(withoutCostRows(kept)).toEqual(FULL);
      expect(kept.aiCalls).toBeGreaterThanOrEqual(SEEDED_AI_CALLS);
      for (const pageId of pageIdsOf(account)) expect(await fileExists(pageId)).toBe(true);
      // The parent is still signed in and still elevated.
      expect(setCookiesFor(refused, PARENT_SESSION_COOKIE)).toHaveLength(0);
      await server().get('/api/auth/me').set('Cookie', account.cookie).expect(200);
      await server()
        .get('/api/parent/account/deletion-preview')
        .set('Authorization', bearer(account.token))
        .expect(200);
    });

    it('answers an empty password the same way, with the same sentence', async () => {
      const account = await fullAccount();

      const refused = await deleteRequest(account, '').expect(409);

      expect(refused.body.message).toBe(PASSWORD_INCORRECT);
      expect((await rowCounts(account)).accounts).toBe(1);
    });

    it('refuses everything when a single unlink fails, and deletes nothing', async () => {
      const account = await fullAccount();
      const ingest = h.moduleRef.get(PageIngestService);
      const original = ingest.remove.bind(ingest);
      const doomedPage = pageIdsOf(account)[0]!;
      // A disk that refuses exactly one page. The others' bytes do come away —
      // which is the case that matters: a half-done delete must still leave every
      // row standing.
      ingest.remove = async (pageId: string) => (pageId === doomedPage ? false : original(pageId));

      try {
        const refused = await deleteRequest(account, account.password).expect(503);
        expect(refused.body.message).toBe(DELETION_INCOMPLETE);
      } finally {
        ingest.remove = original;
      }

      const after = await rowCounts(account);
      expect(after.accounts).toBe(1);
      expect(after.profiles).toBe(2);
      expect(after.pages).toBe(4);
      expect(after.aiCalls).toBeGreaterThanOrEqual(SEEDED_AI_CALLS);
      // The tombstone that was already there is still there: nothing was deleted.
      expect(after.tombstones).toBe(1);

      // **And the rows do not lie about what they hold.** Every page whose bytes
      // did come away before the refusal is marked exactly as the retention sweep
      // marks one — no `storagePath`, a `bytesDeletedAt`, and out of `Ready` — or
      // the next read of that page would raise `PageBytesUnavailable` in front of
      // a parent who was told nothing had happened. The page the disk refused
      // keeps its bytes and its row untouched.
      const released = pageIdsOf(account).filter((pageId) => pageId !== doomedPage);
      expect(released.length).toBeGreaterThan(0);
      for (const pageId of released) {
        const row = await h.prisma.pageImage.findUniqueOrThrow({
          where: { id: pageId },
          select: { state: true, storagePath: true, bytesDeletedAt: true },
        });
        expect(row.state).toBe('Deleted');
        expect(row.storagePath).toBeNull();
        expect(row.bytesDeletedAt).toBeInstanceOf(Date);
        expect(await fileExists(pageId)).toBe(false);
      }
      const spared = await h.prisma.pageImage.findUniqueOrThrow({
        where: { id: doomedPage },
        select: { state: true, storagePath: true, bytesDeletedAt: true },
      });
      expect(spared.state).not.toBe('Deleted');
      expect(spared.storagePath).not.toBeNull();
      expect(spared.bytesDeletedAt).toBeNull();
      expect(await fileExists(doomedPage)).toBe(true);
    });

    it('refuses the elevated routes to a parent who has not crossed the PIN', async () => {
      const account = await fullAccount();

      // The session cookie alone reaches neither route (AD-18).
      await server().get('/api/parent/account/deletion-preview').expect(401);
      await server()
        .delete('/api/parent/account')
        .set('Cookie', account.cookie)
        .send({ password: account.password })
        .expect(401);
      expect((await rowCounts(account)).accounts).toBe(1);
    });
  });

  describe('the deletion preview', () => {
    it('counts every kind the confirmation has to name, across every child', async () => {
      const account = await fullAccount();

      const preview = await server()
        .get('/api/parent/account/deletion-preview')
        .set('Authorization', bearer(account.token))
        .expect(200);

      expect(preview.body).toEqual({
        students: 2,
        sourceTests: 2,
        pageImages: 4,
        practiceTests: 2,
        attempts: 2,
        explanations: 2,
        masteryTopics: 2,
      });
    });

    it('answers zeroes for an account with nothing under it, and deletes nothing', async () => {
      const account = await elevatedParent();

      const preview = await server()
        .get('/api/parent/account/deletion-preview')
        .set('Authorization', bearer(account.token))
        .expect(200);

      expect(preview.body).toEqual({
        students: 0,
        sourceTests: 0,
        pageImages: 0,
        practiceTests: 0,
        attempts: 0,
        explanations: 0,
        masteryTopics: 0,
      });
      expect((await rowCounts(account)).accounts).toBe(1);
    });

    it('counts only the reading account, never another one’s work', async () => {
      const mine = await elevatedParent();
      const theirs = await fullAccount();

      const preview = await server()
        .get('/api/parent/account/deletion-preview')
        .set('Authorization', bearer(mine.token))
        .expect(200);

      expect(preview.body.students).toBe(0);
      expect((await rowCounts(theirs)).accounts).toBe(1);
    });
  });
});
