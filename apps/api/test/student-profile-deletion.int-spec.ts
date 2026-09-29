import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { storagePathFor, uploadRoot } = await import('../src/sourcetest/source-test-policy.js');
const { DELETION_INCOMPLETE, PASSWORD_INCORRECT } = await import(
  '../src/deletion/deletion-policy.js'
);
const { PROFILE_NOT_FOUND } = await import('../src/identity/student-profile.service.js');
const { ExplanationService } = await import('../src/explanation/explanation.service.js');
const { PageIngestService } = await import('../src/sourcetest/page-ingest.service.js');
const {
  bearer,
  checkLegibility,
  createGradeLevel,
  createHarness,
  createSignedInParent,
  createStudentProfile,
  createSubject,
  elevate,
  resetParentAccounts,
  resetTaxonomy,
  setPinFor,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';

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

/**
 * FR-33: a parent deletes a Student Profile and everything under it — against
 * real rows, real files and the real routes.
 *
 * Everything in this tier is here because it cannot be reached anywhere else:
 * that the bytes actually leave the disk, that the `Restrict` edges are walked
 * in an order Postgres accepts, that the cascades take what the schema says they
 * take, that a sibling on the same account is untouched, and that the three
 * derived allowances read the same figure across the delete.
 *
 * The upload is driven through the real routes, because what must be gone is the
 * file ingest actually wrote at the path ingest actually derived, and a
 * hand-written row would prove neither. Everything downstream of it — the
 * generated test, the run, the Explanation, the Mastery — is seeded, because
 * these cases are about what deletion removes and not about producing the work.
 */
describe('a parent deletes a Student Profile and everything under it', () => {
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
    parentAccountId: string;
    password: string;
    token: string;
    profileId: string;
    sourceTestId: string;
    pageIds: string[];
    practiceTestId: string;
    attemptId: string;
    explanationId: string;
    topicId: string;
  }

  interface Parent {
    parentAccountId: string;
    password: string;
    token: string;
    gradeLevelId: string;
    subjectId: string;
  }

  /** A signed-in, elevated parent with a Grade Level and a Subject to hand. */
  async function elevatedParent(): Promise<Parent> {
    const gradeLevel = await createGradeLevel(h);
    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    return {
      parentAccountId: parent.parentAccountId,
      password: parent.password,
      token,
      gradeLevelId: gradeLevel.id,
      subjectId: subject.id,
    };
  }

  /**
   * One child with an upload committed through the real routes, and one of
   * everything the deletion has to take with it.
   *
   * The Source Test is committed, so it is a *charged* Upload; the Practice Test
   * and the Explanation both carry a `chargedAt`, so the two other allowances
   * are non-zero before the delete. A fixture whose figures were all zero could
   * not tell "unchanged" from "refunded".
   */
  async function childOf(parent: Parent, pageCount = 2): Promise<Child> {
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: parent.gradeLevelId,
    });

    const draft = await server()
      .post('/api/parent/source-tests')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: profile.id })
      .expect(200);
    const sourceTestId: string = draft.body.id;

    await server()
      .patch(`/api/parent/source-tests/${sourceTestId}/classification`)
      .set('Authorization', bearer(parent.token))
      .send({ subjectId: parent.subjectId })
      .expect(200);

    for (let index = 0; index < pageCount; index += 1) {
      await server()
        .post(`/api/parent/source-tests/${sourceTestId}/pages`)
        .set('Authorization', bearer(parent.token))
        .attach('file', await photo(index + 1), {
          filename: 'page.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
    }
    await checkLegibility(h, parent.token, sourceTestId);
    await server()
      .post(`/api/parent/source-tests/${sourceTestId}/submit`)
      .set('Authorization', bearer(parent.token))
      .expect(200);

    const pages = await h.prisma.pageImage.findMany({
      where: { sourceTestId },
      select: { id: true },
      orderBy: { ordinal: 'asc' },
    });

    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId,
        studentProfileId: profile.id,
        requestedCount: 1,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const practiceTest = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
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
        parentAccountId: parent.parentAccountId,
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
        parentAccountId: parent.parentAccountId,
        studentProfileId: profile.id,
        attemptId: attempt.id,
        questionId: question.id,
        body: [{ kind: 'text', value: 'Half of six is three.' }],
        chargedAt: new Date(),
      },
      select: { id: true },
    });
    // A pending report in the Admin queue, so the queue's own emptying is
    // observable and not merely assumed from the cascade. Parent-origin,
    // because that is the origin the queue lists unconditionally — a
    // student-origin flag only appears once a parent has confirmed it.
    await h.prisma.explanationFlag.create({
      data: {
        explanationId: explanation.id,
        parentAccountId: parent.parentAccountId,
        studentProfileId: profile.id,
        origin: 'Parent',
      },
    });
    const topic = await h.prisma.topic.create({
      data: {
        subjectId: parent.subjectId,
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

    return {
      parentAccountId: parent.parentAccountId,
      password: parent.password,
      token: parent.token,
      profileId: profile.id,
      sourceTestId,
      pageIds: pages.map((page) => page.id),
      practiceTestId: practiceTest.id,
      attemptId: attempt.id,
      explanationId: explanation.id,
      topicId: topic.id,
    };
  }

  function deleteRequest(child: Child, password: string) {
    return server()
      .delete(`/api/parent/students/${child.profileId}`)
      .set('Authorization', bearer(child.token))
      .send({ password });
  }

  async function rowCounts(child: Child) {
    const [
      profile,
      sourceTests,
      pages,
      jobs,
      tests,
      questions,
      attempts,
      answers,
      explanations,
      flags,
      mastery,
    ] = await Promise.all([
      h.prisma.studentProfile.count({ where: { id: child.profileId } }),
      h.prisma.sourceTest.count({ where: { studentProfileId: child.profileId } }),
      h.prisma.pageImage.count({ where: { sourceTestId: child.sourceTestId } }),
      h.prisma.generationJob.count({ where: { studentProfileId: child.profileId } }),
      h.prisma.practiceTest.count({ where: { studentProfileId: child.profileId } }),
      h.prisma.practiceTestQuestion.count({ where: { practiceTestId: child.practiceTestId } }),
      h.prisma.attempt.count({ where: { studentProfileId: child.profileId } }),
      h.prisma.answer.count({ where: { attemptId: child.attemptId } }),
      h.prisma.explanation.count({ where: { studentProfileId: child.profileId } }),
      h.prisma.explanationFlag.count({ where: { studentProfileId: child.profileId } }),
      h.prisma.topicMastery.count({ where: { studentProfileId: child.profileId } }),
    ]);
    return {
      profile,
      sourceTests,
      pages,
      jobs,
      tests,
      questions,
      attempts,
      answers,
      explanations,
      flags,
      mastery,
    };
  }

  describe('with the correct account password', () => {
    it('removes every row and unlinks every stored photograph', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);
      for (const pageId of child.pageIds) expect(await fileExists(pageId)).toBe(true);
      expect(await rowCounts(child)).toEqual({
        profile: 1,
        sourceTests: 1,
        pages: 2,
        jobs: 1,
        tests: 1,
        questions: 1,
        attempts: 1,
        answers: 1,
        explanations: 1,
        flags: 1,
        mastery: 1,
      });

      await deleteRequest(child, parent.password).expect(204);

      expect(await rowCounts(child)).toEqual({
        profile: 0,
        sourceTests: 0,
        pages: 0,
        jobs: 0,
        tests: 0,
        questions: 0,
        attempts: 0,
        answers: 0,
        explanations: 0,
        flags: 0,
        mastery: 0,
      });
      // No file remains at any of those pages' storage paths.
      for (const pageId of child.pageIds) expect(await fileExists(pageId)).toBe(false);
      // The Extraction cluster goes with the Source Test it belongs to.
      expect(await h.prisma.extraction.count({ where: { sourceTestId: child.sourceTestId } })).toBe(
        0,
      );
    });

    it('deletes an archived profile like any other', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);
      await server()
        .post(`/api/parent/students/${child.profileId}/archive`)
        .set('Authorization', bearer(child.token))
        .expect(204);

      await deleteRequest(child, parent.password).expect(204);

      expect((await rowCounts(child)).profile).toBe(0);
    });

    it('empties the Admin queue of the reports that hung off it', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);
      const explanations = h.moduleRef.get(ExplanationService);
      expect(
        (await explanations.flaggedForAdmin()).some(
          (entry) => entry.explanationId === child.explanationId,
        ),
      ).toBe(true);

      await deleteRequest(child, parent.password).expect(204);

      expect(
        (await explanations.flaggedForAdmin()).some(
          (entry) => entry.explanationId === child.explanationId,
        ),
      ).toBe(false);
    });

    it('leaves a sibling profile on the same account completely untouched', async () => {
      const parent = await elevatedParent();
      const doomed = await childOf(parent);
      const sibling = await childOf(parent);

      await deleteRequest(doomed, parent.password).expect(204);

      expect(await rowCounts(sibling)).toEqual({
        profile: 1,
        sourceTests: 1,
        pages: 2,
        jobs: 1,
        tests: 1,
        questions: 1,
        attempts: 1,
        answers: 1,
        explanations: 1,
        flags: 1,
        mastery: 1,
      });
      for (const pageId of sibling.pageIds) expect(await fileExists(pageId)).toBe(true);
    });
  });

  describe('the account’s usage', () => {
    it('reads the same three figures before and after the deletion', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);
      const before = await h.allowance.consumptionFor(parent.parentAccountId);
      // A fixture whose figures were all zero could not tell "unchanged" from
      // "refunded", so every one of the three is non-zero first.
      expect(before.allowances.upload.used).toBeGreaterThan(0);
      expect(before.allowances.generation.used).toBeGreaterThan(0);
      expect(before.allowances.explanation.used).toBeGreaterThan(0);

      await deleteRequest(child, parent.password).expect(204);

      const after = await h.allowance.consumptionFor(parent.parentAccountId);
      expect(after.allowances.upload.used).toBe(before.allowances.upload.used);
      expect(after.allowances.generation.used).toBe(before.allowances.generation.used);
      expect(after.allowances.explanation.used).toBe(before.allowances.explanation.used);
    });

    it('does not fall when a fresh profile is created and deleted again', async () => {
      // Delete-and-recreate must not be a path to unlimited free generation.
      const parent = await elevatedParent();
      const first = await childOf(parent);
      const before = await h.allowance.consumptionFor(parent.parentAccountId);
      await deleteRequest(first, parent.password).expect(204);

      const second = await childOf(parent);
      await deleteRequest(second, parent.password).expect(204);

      const after = await h.allowance.consumptionFor(parent.parentAccountId);
      expect(after.allowances.upload.used).toBe(before.allowances.upload.used * 2);
      expect(after.allowances.generation.used).toBe(before.allowances.generation.used * 2);
      expect(after.allowances.explanation.used).toBe(before.allowances.explanation.used * 2);
    });

    it('leaves behind rows naming only an account, a period, a class and a count', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);

      await deleteRequest(child, parent.password).expect(204);

      const tombstones = await h.prisma.usageTombstone.findMany({
        where: { parentAccountId: parent.parentAccountId },
      });
      expect(tombstones.length).toBeGreaterThan(0);
      const serialised = JSON.stringify(tombstones);
      // Nothing a child could be read out of: no student id, no artifact id, no
      // title and no text.
      expect(serialised).not.toContain(child.profileId);
      expect(serialised).not.toContain(child.sourceTestId);
      expect(serialised).not.toContain(child.practiceTestId);
      expect(serialised).not.toContain(child.explanationId);
      for (const row of tombstones) {
        expect(Object.keys(row).sort()).toEqual([
          'count',
          'createdAt',
          'id',
          'parentAccountId',
          'periodStart',
          'usageClass',
        ]);
      }
    });

    it('writes one row per class, counting exactly what the child was charged for', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);
      // The fixture charges one of each: one committed Source Test, one
      // Practice Test with a `chargedAt`, one Explanation with a `chargedAt`.
      const window = await h.allowance.windowFor(parent.parentAccountId);

      await deleteRequest(child, parent.password).expect(204);

      const tombstones = await h.prisma.usageTombstone.findMany({
        where: { parentAccountId: parent.parentAccountId },
        orderBy: { usageClass: 'asc' },
        select: { usageClass: true, periodStart: true, count: true },
      });
      // Ordered by the enum's own declaration order, which is what Postgres
      // sorts an enum column by — not alphabetically.
      expect(tombstones).toEqual([
        { usageClass: 'Upload', periodStart: window.start, count: 1 },
        { usageClass: 'Generation', periodStart: window.start, count: 1 },
        { usageClass: 'Explanation', periodStart: window.start, count: 1 },
      ]);
    });

    it('increments the one row rather than inserting beside it on a second deletion', async () => {
      const parent = await elevatedParent();
      const first = await childOf(parent);
      const second = await childOf(parent);
      const window = await h.allowance.windowFor(parent.parentAccountId);

      await deleteRequest(first, parent.password).expect(204);
      await deleteRequest(second, parent.password).expect(204);

      // `@@unique([parentAccountId, periodStart, usageClass])` plus the upsert's
      // increment branch is the whole reason the table works: two rows for one
      // account, period and class would be a figure a reader has to remember to
      // sum, and the first one that forgot would under-count the month.
      const tombstones = await h.prisma.usageTombstone.findMany({
        where: { parentAccountId: parent.parentAccountId },
        orderBy: { usageClass: 'asc' },
        select: { usageClass: true, periodStart: true, count: true },
      });
      // Ordered by the enum's own declaration order, which is what Postgres
      // sorts an enum column by — not alphabetically.
      expect(tombstones).toEqual([
        { usageClass: 'Upload', periodStart: window.start, count: 2 },
        { usageClass: 'Generation', periodStart: window.start, count: 2 },
        { usageClass: 'Explanation', periodStart: window.start, count: 2 },
      ]);
      expect(tombstones).toHaveLength(3);
    });

    it('counts every charged artifact of a child, not merely one per class', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);
      // A second charged Explanation on the same run, so a tombstone that
      // recorded "a class was charged" rather than "how often" would show 1.
      const question = await h.prisma.practiceTestQuestion.findFirstOrThrow({
        where: { practiceTestId: child.practiceTestId },
        select: { id: true },
      });
      await h.prisma.explanation.create({
        data: {
          parentAccountId: parent.parentAccountId,
          studentProfileId: child.profileId,
          attemptId: child.attemptId,
          questionId: question.id,
          generation: 2,
          body: [{ kind: 'text', value: 'Another way to see it.' }],
          chargedAt: new Date(),
        },
      });

      await deleteRequest(child, parent.password).expect(204);

      const explanationTombstone = await h.prisma.usageTombstone.findFirstOrThrow({
        where: { parentAccountId: parent.parentAccountId, usageClass: 'Explanation' },
        select: { count: true },
      });
      expect(explanationTombstone.count).toBe(2);
    });

    it('writes no tombstone for a profile that was never charged for anything', async () => {
      const parent = await elevatedParent();
      const bare = await createStudentProfile(h, parent.parentAccountId, {
        gradeLevelId: parent.gradeLevelId,
      });

      await server()
        .delete(`/api/parent/students/${bare.id}`)
        .set('Authorization', bearer(parent.token))
        .send({ password: parent.password })
        .expect(204);

      expect(
        await h.prisma.usageTombstone.count({
          where: { parentAccountId: parent.parentAccountId },
        }),
      ).toBe(0);
    });
  });

  describe('when the deletion is refused', () => {
    it('answers a wrong password with 409 and removes nothing', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);

      const refused = await deleteRequest(child, 'not-the-password-at-all').expect(409);

      // 409 and never 401: a 401 is how the web client learns that Parent View
      // has ended, and it would sign the parent out of the screen holding the
      // refusal they need to read.
      expect(refused.body.message).toBe(PASSWORD_INCORRECT);
      expect(await rowCounts(child)).toEqual({
        profile: 1,
        sourceTests: 1,
        pages: 2,
        jobs: 1,
        tests: 1,
        questions: 1,
        attempts: 1,
        answers: 1,
        explanations: 1,
        flags: 1,
        mastery: 1,
      });
      for (const pageId of child.pageIds) expect(await fileExists(pageId)).toBe(true);
      expect(
        await h.prisma.usageTombstone.count({ where: { parentAccountId: child.parentAccountId } }),
      ).toBe(0);
    });

    it('answers another account’s profile id with 404, never 403', async () => {
      const mine = await elevatedParent();
      const theirs = await elevatedParent();
      const child = await childOf(theirs);

      const refused = await server()
        .delete(`/api/parent/students/${child.profileId}`)
        .set('Authorization', bearer(mine.token))
        .send({ password: mine.password })
        .expect(404);

      expect(refused.body.message).toBe(PROFILE_NOT_FOUND);
      expect((await rowCounts(child)).profile).toBe(1);
    });

    it('refuses everything when a single unlink fails, and deletes nothing', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);
      const ingest = h.moduleRef.get(PageIngestService);
      const original = ingest.remove.bind(ingest);
      const doomedPage = child.pageIds[0]!;
      // A disk that refuses exactly one page. The other page's bytes do come
      // away — which is the case that matters: a half-done delete must still
      // leave every row standing.
      ingest.remove = async (pageId: string) => (pageId === doomedPage ? false : original(pageId));

      try {
        const refused = await deleteRequest(child, parent.password).expect(503);
        expect(refused.body.message).toBe(DELETION_INCOMPLETE);
      } finally {
        ingest.remove = original;
      }

      expect((await rowCounts(child)).profile).toBe(1);
      expect((await rowCounts(child)).pages).toBe(2);
      expect(
        await h.prisma.usageTombstone.count({ where: { parentAccountId: child.parentAccountId } }),
      ).toBe(0);
    });
  });

  describe('the deletion preview', () => {
    it('counts every kind the confirmation has to name', async () => {
      const parent = await elevatedParent();
      const child = await childOf(parent);

      const preview = await server()
        .get(`/api/parent/students/${child.profileId}/deletion-preview`)
        .set('Authorization', bearer(child.token))
        .expect(200);

      expect(preview.body).toEqual({
        sourceTests: 1,
        pageImages: 2,
        practiceTests: 1,
        attempts: 1,
        explanations: 1,
        masteryTopics: 1,
      });
    });

    it('answers another account’s profile id with 404', async () => {
      const mine = await elevatedParent();
      const theirs = await elevatedParent();
      const child = await childOf(theirs);

      await server()
        .get(`/api/parent/students/${child.profileId}/deletion-preview`)
        .set('Authorization', bearer(mine.token))
        .expect(404);
    });
  });
});
