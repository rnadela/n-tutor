import { access } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { PAGE_IMAGE_RETENTION_MS, storagePathFor, uploadRoot } = await import(
  '../src/sourcetest/source-test-policy.js'
);
const { PageExpiryService } = await import('../src/sourcetest/page-expiry.service.js');
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
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * FR-32, against real rows and real files.
 *
 * Every case here drives `sweepExpired()` directly. That is the point of it
 * being a plain public method: the schedule is off in this tier, and a test that
 * waits on a cron is slow when it passes and flaky when it does not.
 */
describe('Page Images expire ninety days after the upload was committed', () => {
  let h: Harness;
  let expiry: InstanceType<typeof PageExpiryService>;
  const server = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createHarness();
    expiry = h.moduleRef.get(PageExpiryService);
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

  interface Submitted {
    parentAccountId: string;
    token: string;
    studentProfileId: string;
    sourceTestId: string;
    pageIds: string[];
  }

  /**
   * A parent, a child, and a Source Test photographed, classified, checked and
   * committed through the real routes.
   *
   * Real routes rather than seeded rows throughout: what the sweep removes is
   * the file ingest actually wrote, at the path ingest actually derived, and a
   * hand-written row would prove neither.
   */
  async function submitted(pageCount = 2): Promise<Submitted> {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);

    const gradeLevel = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const draft = await server()
      .post('/api/parent/source-tests')
      .set('Authorization', bearer(token))
      .send({ studentProfileId: profile.id })
      .expect(200);
    const sourceTestId: string = draft.body.id;

    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });
    await server()
      .patch(`/api/parent/source-tests/${sourceTestId}/classification`)
      .set('Authorization', bearer(token))
      .send({ subjectId: subject.id })
      .expect(200);

    for (let index = 0; index < pageCount; index += 1) {
      await server()
        .post(`/api/parent/source-tests/${sourceTestId}/pages`)
        .set('Authorization', bearer(token))
        .attach('file', await photo(index + 1), {
          filename: 'page.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
    }

    await checkLegibility(h, token, sourceTestId);
    await server()
      .post(`/api/parent/source-tests/${sourceTestId}/submit`)
      .set('Authorization', bearer(token))
      .expect(200);

    const pages = await h.prisma.pageImage.findMany({
      where: { sourceTestId },
      select: { id: true },
      orderBy: { ordinal: 'asc' },
    });
    return {
      parentAccountId: parent.parentAccountId,
      token,
      studentProfileId: profile.id,
      sourceTestId,
      pageIds: pages.map((page) => page.id),
    };
  }

  /** Moves the commit into the past. The clock is the thing under test. */
  function submittedDaysAgo(sourceTestId: string, days: number): Promise<unknown> {
    return h.prisma.sourceTest.update({
      where: { id: sourceTestId },
      data: { submittedAt: new Date(Date.now() - days * DAY_MS) },
    });
  }

  function pageRows(sourceTestId: string) {
    return h.prisma.pageImage.findMany({
      where: { sourceTestId },
      orderBy: { ordinal: 'asc' },
    });
  }

  describe('a Source Test committed more than ninety days ago', () => {
    it('loses its photographs from disk and says so on the row', async () => {
      const test = await submitted(2);
      await submittedDaysAgo(test.sourceTestId, 91);
      for (const pageId of test.pageIds) expect(await fileExists(pageId)).toBe(true);

      const now = new Date();
      expect(await expiry.sweepExpired(now)).toBe(2);

      for (const pageId of test.pageIds) expect(await fileExists(pageId)).toBe(false);
      const rows = await pageRows(test.sourceTestId);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.state).toBe('Deleted');
        expect(row.storagePath).toBeNull();
        expect(row.bytesDeletedAt?.toISOString()).toBe(now.toISOString());
        // The ordering survives: the row is retained precisely so the strip can
        // say which page is gone rather than showing a hole.
        expect(row.ordinal).toBeGreaterThan(0);
      }
    });

    it('leaves the Source Test, the Extraction and everything derived untouched', async () => {
      const test = await submitted(2);
      expect(await h.extractionRunner.runOnce()).toBe(true);

      const sourceBefore = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: test.sourceTestId },
      });
      const extractionBefore = await h.prisma.extraction.findFirstOrThrow({
        where: { sourceTestId: test.sourceTestId },
      });
      const questionsBefore = await h.prisma.extractedQuestion.findMany({
        where: { extractionId: extractionBefore.id },
        orderBy: { ordinal: 'asc' },
      });
      expect(questionsBefore.length).toBeGreaterThan(0);

      await submittedDaysAgo(test.sourceTestId, 91);
      const movedSource = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: test.sourceTestId },
      });
      expect(await expiry.sweepExpired(new Date())).toBe(2);

      // The Source Test itself still exists, and nothing but the clock this
      // test moved has changed on it.
      expect(
        await h.prisma.sourceTest.findUniqueOrThrow({ where: { id: test.sourceTestId } }),
      ).toEqual(movedSource);
      expect(sourceBefore.id).toBe(movedSource.id);
      expect(
        await h.prisma.extraction.findUniqueOrThrow({ where: { id: extractionBefore.id } }),
      ).toEqual(extractionBefore);
      expect(
        await h.prisma.extractedQuestion.findMany({
          where: { extractionId: extractionBefore.id },
          orderBy: { ordinal: 'asc' },
        }),
      ).toEqual(questionsBefore);
    });

    it('still generates a Practice Test, from the Extraction and never from a page', async () => {
      const test = await submitted(2);
      expect(await h.extractionRunner.runOnce()).toBe(true);
      h.ai.reset();

      await submittedDaysAgo(test.sourceTestId, 91);
      expect(await expiry.sweepExpired(new Date())).toBe(2);
      // Belt and braces: the files are gone, so a generator that reached for a
      // page would fail rather than quietly succeed on a cached buffer.
      for (const pageId of test.pageIds) expect(await fileExists(pageId)).toBe(false);

      await server()
        .post(`/api/parent/source-tests/${test.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(test.token))
        .send({ count: 1 })
        .expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const generated = await h.prisma.practiceTest.findMany({
        where: { sourceTestId: test.sourceTestId },
      });
      expect(generated).toHaveLength(1);
    });

    it('states the removal on the read, as a date and never as a path', async () => {
      const test = await submitted(1);
      await submittedDaysAgo(test.sourceTestId, 91);
      await expiry.sweepExpired(new Date());

      const response = await server()
        .get(`/api/parent/source-tests/${test.sourceTestId}`)
        .set('Authorization', bearer(test.token))
        .expect(200);

      expect(response.body.pages).toHaveLength(1);
      expect(response.body.pages[0].state).toBe('Deleted');
      expect(typeof response.body.pages[0].bytesDeletedAt).toBe('string');
      // AD-15/AD-20: not the path, not a URL, not under any name.
      const body = JSON.stringify(response.body);
      expect(body).not.toContain(uploadRoot());
      expect(body).not.toContain('storagePath');
    });
  });

  describe('what the sweep leaves alone', () => {
    it('does not touch a commit that is only eighty-nine days old', async () => {
      const test = await submitted(1);
      await submittedDaysAgo(test.sourceTestId, 89);

      expect(await expiry.sweepExpired(new Date())).toBe(0);
      expect(await fileExists(test.pageIds[0]!)).toBe(true);
      const [row] = await pageRows(test.sourceTestId);
      expect(row!.state).toBe('Ready');
      expect(row!.bytesDeletedAt).toBeNull();
      expect(row!.storagePath).not.toBeNull();
    });

    it('never touches a draft, however old, because the 72h TTL owns it', async () => {
      // A never-submitted draft with a `createdAt` two hundred days back. Put
      // under this clock as well it would gain a second, far longer life.
      const parent = await createSignedInParent(h);
      await setPinFor(h, parent.cookie, PIN);
      const token = await elevate(h, parent.cookie, PIN);
      const gradeLevel = await createGradeLevel(h);
      const profile = await createStudentProfile(h, parent.parentAccountId, {
        gradeLevelId: gradeLevel.id,
      });
      const draft = await server()
        .post('/api/parent/source-tests')
        .set('Authorization', bearer(token))
        .send({ studentProfileId: profile.id })
        .expect(200);
      await server()
        .post(`/api/parent/source-tests/${draft.body.id}/pages`)
        .set('Authorization', bearer(token))
        .attach('file', await photo(9), { filename: 'page.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await h.prisma.sourceTest.update({
        where: { id: draft.body.id },
        data: { createdAt: new Date(Date.now() - 200 * DAY_MS) },
      });

      expect(await expiry.sweepExpired(new Date())).toBe(0);
      const [row] = await pageRows(draft.body.id);
      expect(row!.state).toBe('Ready');
      expect(await h.prisma.sourceTest.findUnique({ where: { id: draft.body.id } })).not.toBeNull();
    });
  });

  describe('the sweep converges', () => {
    it('is a no-op the second time: an already-swept row is not selected again', async () => {
      const test = await submitted(2);
      await submittedDaysAgo(test.sourceTestId, 120);

      expect(await expiry.sweepExpired(new Date())).toBe(2);
      const afterFirst = await pageRows(test.sourceTestId);

      // Nothing is unlinked twice, nothing is re-dated, and the pass is free.
      expect(await expiry.sweepExpired(new Date())).toBe(0);
      expect(await pageRows(test.sourceTestId)).toEqual(afterFirst);
    });

    it('marks a row whose bytes were already gone, and converges after a crash', async () => {
      // Exactly the state a crash between the unlink and the mark leaves
      // behind: a `Ready` row whose file is already absent. The next pass
      // re-selects it, `remove()` treats ENOENT as success, and the row lands
      // where it should have.
      const test = await submitted(1);
      await submittedDaysAgo(test.sourceTestId, 91);
      const { rm } = await import('node:fs/promises');
      await rm(storagePathFor(test.pageIds[0]!, uploadRoot()));
      expect(await fileExists(test.pageIds[0]!)).toBe(false);

      expect(await expiry.sweepExpired(new Date())).toBe(1);
      const [row] = await pageRows(test.sourceTestId);
      expect(row!.state).toBe('Deleted');
      expect(row!.storagePath).toBeNull();
    });

    it('drains a whole backlog across successive passes and then stops', async () => {
      // The batch cap itself is unit-covered — a hundred and one real pages
      // through the real routes would be a minute of upload to state a figure.
      // What real rows state here is the loop the cap implies: passes repeat
      // until nothing is due and then cost nothing.
      const test = await submitted(4);
      await submittedDaysAgo(test.sourceTestId, 91);

      let swept = 0;
      let pass = 0;
      for (;;) {
        const marked = await expiry.sweepExpired(new Date());
        if (marked === 0) break;
        swept += marked;
        pass += 1;
        expect(pass).toBeLessThan(10);
      }
      expect(swept).toBe(4);
      expect((await pageRows(test.sourceTestId)).every((row) => row.state === 'Deleted')).toBe(
        true,
      );
    });
  });

  describe('reading an expired Source Test', () => {
    it('reads no bytes at all rather than failing on a missing file', async () => {
      const test = await submitted(2);
      await submittedDaysAgo(test.sourceTestId, 91);
      await expiry.sweepExpired(new Date());

      const sourceTests = h.moduleRef.get(
        (await import('../src/sourcetest/source-test.service.js')).SourceTestService,
      );
      // `readPageBytes` filters to `state: 'Ready'`, so a fully expired Source
      // Test yields an empty set and never touches the filesystem — no
      // `PageBytesUnavailable`, and nothing that carries a path.
      await expect(sourceTests.readPageBytes(test.sourceTestId)).resolves.toEqual([]);
    });
  });

  describe('the clock the sweep uses', () => {
    it('is ninety days, measured from the commit', async () => {
      // The boundary asserted through the real sweep rather than only through
      // the pure helper: a page one millisecond short of the window survives
      // the pass that a page one millisecond past it does not.
      const test = await submitted(1);
      const now = new Date();
      await h.prisma.sourceTest.update({
        where: { id: test.sourceTestId },
        data: { submittedAt: new Date(now.getTime() - PAGE_IMAGE_RETENTION_MS + 1) },
      });
      expect(await expiry.sweepExpired(now)).toBe(0);

      await h.prisma.sourceTest.update({
        where: { id: test.sourceTestId },
        data: { submittedAt: new Date(now.getTime() - PAGE_IMAGE_RETENTION_MS) },
      });
      expect(await expiry.sweepExpired(now)).toBe(1);
    });
  });
});
