import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const {
  CLASSIFICATION_REQUIRED,
  GRADE_LEVEL_ID_INVALID,
  MAX_PAGES,
  MAX_PAGE_BYTES,
  NOTHING_TO_CLASSIFY,
  NO_PAGES_TO_SUBMIT,
  PAGE_LIMIT_REACHED,
  PAGE_NOT_FOUND,
  PAGE_ORDER_MISMATCH,
  SOURCE_TEST_NOT_DRAFT,
  SOURCE_TEST_NOT_FOUND,
  STORED_MIME,
  SUBJECT_ID_INVALID,
  SUBJECT_NOT_AVAILABLE,
  UNSUPPORTED_IMAGE_FORMAT,
  pageTooLarge,
  resetSourceTestRuntime,
} = await import('../src/sourcetest/source-test-policy.js');
const { GRADE_LEVEL_NOT_SELECTABLE, PROFILE_NOT_FOUND } = await import(
  '../src/identity/student-profile.service.js'
);
const {
  bearer,
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

/** A real photo's bytes, in a format the allow-list admits. */
function photo(options: { width?: number; height?: number; format?: 'jpeg' | 'png' } = {}) {
  const { width = 40, height = 60, format = 'jpeg' } = options;
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      // Varied per call, so "the bytes changed" is observable at all.
      background: { r: width % 256, g: height % 256, b: 128 },
    },
  });
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
}

/** The sha-256 of what is actually on disk at a path. */
async function digestOf(storagePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(storagePath))
    .digest('hex');
}

describe('Source Tests: page management before submit', () => {
  let h: Harness;
  const server = () => request(h.app.getHttpServer());

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    // Source Tests and their pages first, then profiles, then the accounts:
    // every relation down this chain but `page_image`'s is `Restrict`.
    await resetTaxonomy(h.prisma);
    await resetParentAccounts(h.prisma);
    h.mail.reset();
  });

  /** A parent standing inside Parent View, with the bearer its routes take. */
  async function elevatedParent(): Promise<{ parentAccountId: string; token: string }> {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    return { parentAccountId: parent.parentAccountId, token };
  }

  /** A parent, a child, and a draft Source Test open for that child. */
  async function openDraft(): Promise<{
    parentAccountId: string;
    token: string;
    studentProfileId: string;
    sourceTestId: string;
    /** The child's own Grade Level — what the draft is opened defaulted to. */
    gradeLevelId: string;
    gradeLevelName: string;
  }> {
    const parent = await elevatedParent();
    const gradeLevel = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const response = await server()
      .post('/api/parent/source-tests')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: profile.id })
      .expect(200);
    return {
      ...parent,
      studentProfileId: profile.id,
      sourceTestId: response.body.id,
      gradeLevelId: gradeLevel.id,
      gradeLevelName: gradeLevel.name,
    };
  }

  /** Adds one page through the real route, returning the Source Test after it. */
  function addPage(
    token: string,
    sourceTestId: string,
    bytes: Buffer,
    options: { filename?: string; contentType?: string } = {},
  ) {
    return server()
      .post(`/api/parent/source-tests/${sourceTestId}/pages`)
      .set('Authorization', bearer(token))
      .attach('file', bytes, {
        filename: options.filename ?? 'page.jpg',
        contentType: options.contentType ?? 'image/jpeg',
      });
  }

  /**
   * Classifies a draft with a Subject offered for the Grade Level it already
   * holds, through the real route.
   *
   * Submission is gated on the classification as well as the page count, so
   * every test whose subject is the *page* gate has to get past this one first.
   */
  async function classifyDraft(draft: {
    token: string;
    sourceTestId: string;
    gradeLevelId: string;
  }) {
    const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
    await server()
      .patch(`/api/parent/source-tests/${draft.sourceTestId}/classification`)
      .set('Authorization', bearer(draft.token))
      .send({ subjectId: subject.id })
      .expect(200);
    return subject;
  }

  /**
   * A rejection's messages, however it was raised: the validation pipe answers
   * with an array, a service exception with one string. Both are compared
   * against the exported constant, never a regex — a reworded message has to
   * fail something.
   */
  const messagesOf = (response: { body: { message?: unknown } }): string[] => {
    const message = response.body.message;
    return Array.isArray(message) ? (message as string[]) : [String(message)];
  };

  /** Every stored column of every page, in stored order — bytes included. */
  async function storedPages(sourceTestId: string) {
    const rows = await h.prisma.pageImage.findMany({
      where: { sourceTestId },
      orderBy: { ordinal: 'asc' },
      select: {
        id: true,
        ordinal: true,
        state: true,
        storagePath: true,
        mimeType: true,
        width: true,
        height: true,
        byteSize: true,
      },
    });
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        // The stored bytes themselves, hashed: the renumber-without-
        // reprocessing claim is about these, and nothing else is evidence of it.
        //
        // Null-safe: a row legitimately in `Uploading` has no path yet, and a
        // bug that left one there should surface as a failed assertion about
        // the row, not as a TypeError inside the harness.
        digest: row.storagePath === null ? null : await digestOf(row.storagePath),
      })),
    );
  }

  describe('opening a draft', () => {
    it('opens one draft per child and resumes it rather than opening a second', async () => {
      const draft = await openDraft();
      const again = await server()
        .post('/api/parent/source-tests')
        .set('Authorization', bearer(draft.token))
        .send({ studentProfileId: draft.studentProfileId })
        .expect(200);

      expect(again.body.id).toBe(draft.sourceTestId);
      expect(again.body.status).toBe('Draft');
      expect(again.body.maxPages).toBe(MAX_PAGES);
      expect(
        await h.prisma.sourceTest.count({ where: { studentProfileId: draft.studentProfileId } }),
      ).toBe(1);
    });

    it('expires 72 hours from creation, by the one TTL', async () => {
      const draft = await openDraft();
      const row = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: draft.sourceTestId },
        select: { createdAt: true, expiresAt: true },
      });
      const { SOURCE_TEST_TTL_MS } = await import('../src/sourcetest/source-test-policy.js');
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(SOURCE_TEST_TTL_MS);
    });

    it('refuses a child on another account with the profile 404', async () => {
      const mine = await elevatedParent();
      const theirs = await openDraft();
      const response = await server()
        .post('/api/parent/source-tests')
        .set('Authorization', bearer(mine.token))
        .send({ studentProfileId: theirs.studentProfileId })
        .expect(404);
      expect(messagesOf(response)).toContain(PROFILE_NOT_FOUND);
    });

    it('keeps the one-draft-per-child index the migration hand-wrote, since Prisma cannot express or defend it', async () => {
      const rows = await h.prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'source_test' AND indexname = 'source_test_one_draft_per_student'
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toContain('UNIQUE');
      expect(rows[0]?.indexdef).toMatch(/WHERE.*status = 'Draft'::/);
    });
  });

  describe('adding a page', () => {
    it('stores it normalized to JPEG, at the next ordinal, in state Ready', async () => {
      const draft = await openDraft();
      // A PNG in, so "re-encoded" is observable rather than coincidental.
      const response = await addPage(
        draft.token,
        draft.sourceTestId,
        await photo({ format: 'png' }),
      ).expect(201);

      expect(response.body.pages).toHaveLength(1);
      expect(response.body.pages[0].ordinal).toBe(1);
      expect(response.body.pages[0].state).toBe('Ready');
      // A path is never in a response body; bytes are never served (AD-20).
      expect(response.body.pages[0].storagePath).toBeUndefined();

      const [page] = await storedPages(draft.sourceTestId);
      expect(page!.mimeType).toBe(STORED_MIME);
      expect(page!.width).toBe(40);
      expect(page!.height).toBe(60);
      expect(page!.storagePath).toContain(page!.id);
    });

    it('converts a HEIC photograph through the route and stores it as JPEG', async () => {
      // The format an ordinary iPhone produces, proven at the wire rather than
      // only at the service: `sharp`'s prebuilt libvips decodes no HEIC on this
      // platform, so before the `heic-decode` branch existed this request was a
      // 415 and an iPhone photo could not be uploaded at all.
      const draft = await openDraft();
      const heic = await readFile(path.resolve(import.meta.dirname, 'fixtures/sample-page.heic'));

      const response = await addPage(draft.token, draft.sourceTestId, heic, {
        filename: 'page.heic',
        contentType: 'image/heic',
      }).expect(201);

      expect(response.body.pages).toHaveLength(1);
      expect(response.body.pages[0].state).toBe('Ready');
      const [page] = await storedPages(draft.sourceTestId);
      // Stored as the one format everything converges on, at the decoded size.
      expect(page!.mimeType).toBe(STORED_MIME);
      expect(page!.width).toBe(64);
      expect(page!.height).toBe(64);
      // And the bytes on disk really are a JPEG, not a HEIC under a JPEG's name.
      expect(page!.storagePath).not.toBeNull();
      const bytes = await readFile(page!.storagePath!);
      expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    });

    it('decides the format on the bytes, never on what the client declared', async () => {
      // A PNG announced as a PDF. The declared type is not read anywhere above
      // ingest, so the sniff admits it and the page lands — the mirror image of
      // the refusal below, where a declared `image/jpeg` does not save bytes that
      // are not an image.
      const draft = await openDraft();

      const response = await addPage(
        draft.token,
        draft.sourceTestId,
        await photo({ width: 48, height: 64, format: 'png' }),
        { filename: 'page.pdf', contentType: 'application/pdf' },
      ).expect(201);

      expect(response.body.pages[0].state).toBe('Ready');
      const [page] = await storedPages(draft.sourceTestId);
      expect(page!.mimeType).toBe(STORED_MIME);
      expect(page!.width).toBe(48);
      expect(page!.height).toBe(64);
    });

    it('refuses bytes that are not an allowed image, whatever the client declared', async () => {
      const draft = await openDraft();
      const response = await addPage(
        draft.token,
        draft.sourceTestId,
        Buffer.from('this is plainly not a photograph', 'utf8'),
        { filename: 'page.jpg', contentType: 'image/jpeg' },
      ).expect(415);

      expect(messagesOf(response)).toContain(UNSUPPORTED_IMAGE_FORMAT);
      // Not merely "no Ready row": no row at all. The `Uploading` row the
      // insert-before-bytes rule created is removed on the same failure path.
      expect(await h.prisma.pageImage.count({ where: { sourceTestId: draft.sourceTestId } })).toBe(
        0,
      );
    });

    it('refuses a request that carries no file part at all, the same as an unreadable one', async () => {
      const draft = await openDraft();
      const response = await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/pages`)
        .set('Authorization', bearer(draft.token))
        .expect(400);

      expect(messagesOf(response)).toContain(UNSUPPORTED_IMAGE_FORMAT);
      expect(await h.prisma.pageImage.count({ where: { sourceTestId: draft.sourceTestId } })).toBe(
        0,
      );
    });

    it('refuses an eleventh page without creating a row or writing a byte', async () => {
      const draft = await openDraft();
      for (let index = 0; index < MAX_PAGES; index += 1) {
        await addPage(draft.token, draft.sourceTestId, await photo({ height: 60 + index })).expect(
          201,
        );
      }
      const before = await storedPages(draft.sourceTestId);
      expect(before).toHaveLength(MAX_PAGES);

      const response = await addPage(
        draft.token,
        draft.sourceTestId,
        await photo({ height: 99 }),
      ).expect(409);
      expect(messagesOf(response)).toContain(PAGE_LIMIT_REACHED);
      expect(await storedPages(draft.sourceTestId)).toEqual(before);
    });
  });

  describe('reordering', () => {
    it('applies an explicit permutation without re-reading a single byte', async () => {
      const draft = await openDraft();
      await addPage(draft.token, draft.sourceTestId, await photo({ height: 60 })).expect(201);
      await addPage(draft.token, draft.sourceTestId, await photo({ height: 61 })).expect(201);
      const seeded = await addPage(
        draft.token,
        draft.sourceTestId,
        await photo({ height: 62 }),
      ).expect(201);

      const [a, b, c] = seeded.body.pages.map((page: { id: string }) => page.id);
      const before = await storedPages(draft.sourceTestId);

      const response = await server()
        .put(`/api/parent/source-tests/${draft.sourceTestId}/pages/order`)
        .set('Authorization', bearer(draft.token))
        .send({ pageIds: [c, a, b] })
        .expect(200);

      expect(response.body.pages.map((page: { id: string }) => page.id)).toEqual([c, a, b]);
      expect(response.body.pages.map((page: { ordinal: number }) => page.ordinal)).toEqual([
        1, 2, 3,
      ]);

      // Every stored column but the ordinal — the digest above all — is what it
      // was: reordering renumbers, and touches nothing else.
      const after = await storedPages(draft.sourceTestId);
      for (const page of after) {
        const original = before.find((candidate) => candidate.id === page.id)!;
        expect({ ...page, ordinal: 0 }).toEqual({ ...original, ordinal: 0 });
      }
    });

    it('rejects a body that is not a permutation, whole, leaving the order as it was', async () => {
      const draft = await openDraft();
      await addPage(draft.token, draft.sourceTestId, await photo({ height: 60 })).expect(201);
      const seeded = await addPage(
        draft.token,
        draft.sourceTestId,
        await photo({ height: 61 }),
      ).expect(201);
      const [a, b] = seeded.body.pages.map((page: { id: string }) => page.id);
      const before = await storedPages(draft.sourceTestId);

      for (const pageIds of [[a], [a, a], [a, randomUUID()], [a, b, randomUUID()]]) {
        const response = await server()
          .put(`/api/parent/source-tests/${draft.sourceTestId}/pages/order`)
          .set('Authorization', bearer(draft.token))
          .send({ pageIds })
          .expect(400);
        expect(messagesOf(response)).toContain(PAGE_ORDER_MISMATCH);
      }
      expect(await storedPages(draft.sourceTestId)).toEqual(before);
    });
  });

  describe('deleting a page', () => {
    it('renumbers the survivors without re-reading, re-encoding or re-writing them', async () => {
      const draft = await openDraft();
      await addPage(draft.token, draft.sourceTestId, await photo({ height: 60 })).expect(201);
      await addPage(draft.token, draft.sourceTestId, await photo({ height: 61 })).expect(201);
      const seeded = await addPage(
        draft.token,
        draft.sourceTestId,
        await photo({ height: 62 }),
      ).expect(201);
      const [first, middle, last] = seeded.body.pages.map((page: { id: string }) => page.id);
      const before = await storedPages(draft.sourceTestId);

      await server()
        .delete(`/api/parent/source-tests/${draft.sourceTestId}/pages/${middle}`)
        .set('Authorization', bearer(draft.token))
        .expect(204);

      const after = await storedPages(draft.sourceTestId);
      expect(after.map((page) => page.id)).toEqual([first, last]);
      expect(after.map((page) => page.ordinal)).toEqual([1, 2]);

      // Byte identity, column by column: the survivors' paths, formats,
      // dimensions and stored bytes are exactly what they were. Only `last`'s
      // ordinal moved, from 3 to 2.
      for (const page of after) {
        const original = before.find((candidate) => candidate.id === page.id)!;
        expect({ ...page, ordinal: 0 }).toEqual({ ...original, ordinal: 0 });
      }
      expect(before.find((page) => page.id === first)!.ordinal).toBe(1);
      expect(before.find((page) => page.id === last)!.ordinal).toBe(3);
    });

    it('takes the last remaining page, leaving a draft with none', async () => {
      const draft = await openDraft();
      const seeded = await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);
      const [only] = seeded.body.pages.map((page: { id: string }) => page.id);

      await server()
        .delete(`/api/parent/source-tests/${draft.sourceTestId}/pages/${only}`)
        .set('Authorization', bearer(draft.token))
        .expect(204);

      const read = await server()
        .get(`/api/parent/source-tests/${draft.sourceTestId}`)
        .set('Authorization', bearer(draft.token))
        .expect(200);
      expect(read.body.pages).toEqual([]);
      expect(read.body.status).toBe('Draft');
    });

    it('answers 404 for a page that is not on this Source Test', async () => {
      const draft = await openDraft();
      const response = await server()
        .delete(`/api/parent/source-tests/${draft.sourceTestId}/pages/${randomUUID()}`)
        .set('Authorization', bearer(draft.token))
        .expect(404);
      expect(messagesOf(response)).toContain(PAGE_NOT_FOUND);
    });
  });

  describe('retaking a page', () => {
    it('replaces that page alone, at the ordinal it already had', async () => {
      const draft = await openDraft();
      await addPage(draft.token, draft.sourceTestId, await photo({ height: 60 })).expect(201);
      const seeded = await addPage(
        draft.token,
        draft.sourceTestId,
        await photo({ height: 61 }),
      ).expect(201);
      const [first, second] = seeded.body.pages.map((page: { id: string }) => page.id);
      const before = await storedPages(draft.sourceTestId);

      await server()
        .put(`/api/parent/source-tests/${draft.sourceTestId}/pages/${second}`)
        .set('Authorization', bearer(draft.token))
        .attach('file', await photo({ width: 80, height: 120, format: 'png' }), {
          filename: 'retake.png',
          contentType: 'image/png',
        })
        .expect(200);

      const after = await storedPages(draft.sourceTestId);
      const retaken = after.find((page) => page.id === second)!;
      const original = before.find((page) => page.id === second)!;

      expect(retaken.ordinal).toBe(original.ordinal);
      expect(retaken.storagePath).toBe(original.storagePath);
      expect(retaken.digest).not.toBe(original.digest);
      expect(retaken.width).toBe(80);
      expect(retaken.height).toBe(120);
      expect(retaken.mimeType).toBe(STORED_MIME);
      // The sibling is untouched, down to its stored bytes.
      expect(after.find((page) => page.id === first)).toEqual(
        before.find((page) => page.id === first),
      );
    });

    it('leaves the page it could not replace exactly as it was', async () => {
      const draft = await openDraft();
      const seeded = await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);
      const [only] = seeded.body.pages.map((page: { id: string }) => page.id);
      const before = await storedPages(draft.sourceTestId);

      const response = await server()
        .put(`/api/parent/source-tests/${draft.sourceTestId}/pages/${only}`)
        .set('Authorization', bearer(draft.token))
        .attach('file', Buffer.from('still not a photograph', 'utf8'), {
          filename: 'retake.jpg',
          contentType: 'image/jpeg',
        })
        .expect(415);

      expect(messagesOf(response)).toContain(UNSUPPORTED_IMAGE_FORMAT);
      expect(await storedPages(draft.sourceTestId)).toEqual(before);
    });

    it('refuses a retake that carries no file part at all, leaving the page untouched', async () => {
      const draft = await openDraft();
      const seeded = await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);
      const [only] = seeded.body.pages.map((page: { id: string }) => page.id);
      const before = await storedPages(draft.sourceTestId);

      const response = await server()
        .put(`/api/parent/source-tests/${draft.sourceTestId}/pages/${only}`)
        .set('Authorization', bearer(draft.token))
        .expect(400);

      expect(messagesOf(response)).toContain(UNSUPPORTED_IMAGE_FORMAT);
      expect(await storedPages(draft.sourceTestId)).toEqual(before);
    });

    it('answers 404 for a page on another account, never 403', async () => {
      const mine = await elevatedParent();
      const theirs = await openDraft();
      const seeded = await addPage(theirs.token, theirs.sourceTestId, await photo()).expect(201);
      const [pageId] = seeded.body.pages.map((page: { id: string }) => page.id);
      const before = await storedPages(theirs.sourceTestId);

      const response = await server()
        .put(`/api/parent/source-tests/${theirs.sourceTestId}/pages/${pageId}`)
        .set('Authorization', bearer(mine.token))
        .attach('file', await photo({ height: 90 }), {
          filename: 'retake.jpg',
          contentType: 'image/jpeg',
        })
        .expect(404);

      expect(messagesOf(response)).toContain(SOURCE_TEST_NOT_FOUND);
      expect(await storedPages(theirs.sourceTestId)).toEqual(before);
    });
  });

  describe('submitting', () => {
    it('refuses a draft whose only page never left Uploading', async () => {
      const draft = await openDraft();
      // The state the insert-before-bytes rule creates (AD-15): a row with a
      // null `storagePath` and nothing on disk behind it. Written directly,
      // because no route can leave one behind — which is the point: the gate
      // must hold for a row that got stranded by a crash between the INSERT and
      // ingest, not only for ones the happy path produced.
      await h.prisma.pageImage.create({ data: { sourceTestId: draft.sourceTestId, ordinal: 1 } });
      const stored = await storedPages(draft.sourceTestId);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.state).toBe('Uploading');
      expect(stored[0]!.digest).toBeNull();

      const response = await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
        .set('Authorization', bearer(draft.token))
        .expect(400);
      expect(messagesOf(response)).toContain(NO_PAGES_TO_SUBMIT);
      expect(
        (
          await h.prisma.sourceTest.findUniqueOrThrow({
            where: { id: draft.sourceTestId },
            select: { status: true },
          })
        ).status,
      ).toBe('Draft');
    });

    it('refuses a draft with zero pages, independently of any client', async () => {
      const draft = await openDraft();
      const response = await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
        .set('Authorization', bearer(draft.token))
        .expect(400);

      expect(messagesOf(response)).toContain(NO_PAGES_TO_SUBMIT);
      const row = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: draft.sourceTestId },
        select: { status: true, submittedAt: true },
      });
      expect(row.status).toBe('Draft');
      expect(row.submittedAt).toBeNull();
    });

    it('accepts a draft holding at least one page', async () => {
      const draft = await openDraft();
      await classifyDraft(draft);
      await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);

      const response = await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
        .set('Authorization', bearer(draft.token))
        .expect(200);

      expect(response.body.status).toBe('Submitted');
      expect(response.body.submittedAt).not.toBeNull();
    });

    /**
     * The transaction rule (AD-5) proved where submit is already exercised,
     * rather than only in the Extraction spec: the enqueue lives inside this
     * method's own `withTransaction`, so a Submitted Source Test with no job is
     * unreachable and every refusal leaves none behind.
     */
    it('enqueues exactly one Extraction job in the same transaction', async () => {
      const draft = await openDraft();
      await classifyDraft(draft);
      await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);
      await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
        .set('Authorization', bearer(draft.token))
        .expect(200);

      const jobs = await h.prisma.extractionJob.findMany({
        where: { sourceTestId: draft.sourceTestId },
      });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.status).toBe('Queued');
    });

    it('leaves no Extraction job behind when the submit is refused', async () => {
      // The page gate and the classification gate, one after the other. Both
      // roll the whole transaction back, so neither writes a job row.
      const unclassified = await openDraft();
      await addPage(unclassified.token, unclassified.sourceTestId, await photo()).expect(201);
      await server()
        .post(`/api/parent/source-tests/${unclassified.sourceTestId}/submit`)
        .set('Authorization', bearer(unclassified.token))
        .expect(400);

      const pageless = await openDraft();
      await classifyDraft(pageless);
      await server()
        .post(`/api/parent/source-tests/${pageless.sourceTestId}/submit`)
        .set('Authorization', bearer(pageless.token))
        .expect(400);

      expect(await h.prisma.extractionJob.count()).toBe(0);
    });

    it('refuses every page-management write once it is submitted', async () => {
      const draft = await openDraft();
      await classifyDraft(draft);
      const seeded = await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);
      const [pageId] = seeded.body.pages.map((page: { id: string }) => page.id);
      await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
        .set('Authorization', bearer(draft.token))
        .expect(200);

      const base = `/api/parent/source-tests/${draft.sourceTestId}`;
      // Issued one at a time, and built one at a time: supertest binds a port
      // per request, so a pre-built array would hold several against the same
      // server at once.
      const refusals = [
        () => server().delete(`${base}/pages/${pageId}`).set('Authorization', bearer(draft.token)),
        () =>
          server()
            .put(`${base}/pages/order`)
            .set('Authorization', bearer(draft.token))
            .send({ pageIds: [pageId] }),
        () => server().post(`${base}/submit`).set('Authorization', bearer(draft.token)),
      ];
      for (const refusal of refusals) {
        const response = await refusal().expect(409);
        expect(messagesOf(response)).toContain(SOURCE_TEST_NOT_DRAFT);
      }
      // And the submitted Source Test is still readable, pages intact.
      const read = await server().get(base).set('Authorization', bearer(draft.token)).expect(200);
      expect(read.body.pages).toHaveLength(1);
    });
  });

  describe('a Source Test that is not the caller’s, or not there any more', () => {
    it('answers 404 for an expired draft, not a message about expiry', async () => {
      const draft = await openDraft();
      await h.prisma.sourceTest.update({
        where: { id: draft.sourceTestId },
        data: { expiresAt: new Date(Date.now() - 1) },
      });

      const response = await server()
        .get(`/api/parent/source-tests/${draft.sourceTestId}`)
        .set('Authorization', bearer(draft.token))
        .expect(404);
      expect(messagesOf(response)).toContain(SOURCE_TEST_NOT_FOUND);

      // Filtered out of reads, never swept: the row is still there, because
      // deletion and expiry semantics belong to Epic 8.
      expect(await h.prisma.sourceTest.count({ where: { id: draft.sourceTestId } })).toBe(1);
    });

    it('answers 404 for another account’s Source Test on every route', async () => {
      const mine = await elevatedParent();
      const theirs = await openDraft();
      const base = `/api/parent/source-tests/${theirs.sourceTestId}`;

      for (const refusal of [
        () => server().get(base).set('Authorization', bearer(mine.token)),
        () => server().post(`${base}/submit`).set('Authorization', bearer(mine.token)),
        () =>
          server()
            .put(`${base}/pages/order`)
            .set('Authorization', bearer(mine.token))
            .send({ pageIds: [randomUUID()] }),
        () =>
          server().delete(`${base}/pages/${randomUUID()}`).set('Authorization', bearer(mine.token)),
      ]) {
        const response = await refusal().expect(404);
        expect(messagesOf(response)).toContain(SOURCE_TEST_NOT_FOUND);
      }
    });

    it('answers 404 for an unknown id', async () => {
      const parent = await elevatedParent();
      await server()
        .get(`/api/parent/source-tests/${randomUUID()}`)
        .set('Authorization', bearer(parent.token))
        .expect(404);
    });
  });

  describe('the multipart ceiling', () => {
    /**
     * The runtime resolves its overrides once, at boot, so a test that wants a
     * different ceiling has to set the variable and forget what was resolved.
     * This is the one caller of that seam, and the reason it exists.
     */
    async function withMaxPageBytes<T>(bytes: number, run: () => Promise<T>): Promise<T> {
      const saved = process.env.MAX_PAGE_BYTES;
      process.env.MAX_PAGE_BYTES = String(bytes);
      resetSourceTestRuntime();
      try {
        return await run();
      } finally {
        if (saved === undefined) delete process.env.MAX_PAGE_BYTES;
        else process.env.MAX_PAGE_BYTES = saved;
        resetSourceTestRuntime();
      }
    }

    it('refuses an oversize photo with a stated limit, not a framework fault', async () => {
      const draft = await openDraft();
      const bytes = await photo({ width: 400, height: 400 });

      const response = await withMaxPageBytes(64, () =>
        addPage(draft.token, draft.sourceTestId, bytes).expect(413),
      );

      expect(messagesOf(response)).toContain(pageTooLarge(64));
      // Nothing was created: multer refuses before the handler is reached.
      expect(await h.prisma.pageImage.count({ where: { sourceTestId: draft.sourceTestId } })).toBe(
        0,
      );
    });

    it('translates a non-size multer failure to the format refusal, not the size one', async () => {
      const draft = await openDraft();

      const response = await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/pages`)
        .set('Authorization', bearer(draft.token))
        // Wrong field name: multer raises `LIMIT_UNEXPECTED_FILE`, not
        // `LIMIT_FILE_SIZE` -- the filter must not mistranslate this as 413.
        .attach('notTheFileField', Buffer.from('irrelevant'), {
          filename: 'page.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(messagesOf(response)).toContain(UNSUPPORTED_IMAGE_FORMAT);
      expect(await h.prisma.pageImage.count({ where: { sourceTestId: draft.sourceTestId } })).toBe(
        0,
      );
    });

    it('takes the same photo once the ceiling is back where it was', async () => {
      const draft = await openDraft();
      const bytes = await photo({ width: 400, height: 400 });
      expect(bytes.length).toBeLessThan(MAX_PAGE_BYTES);
      await addPage(draft.token, draft.sourceTestId, bytes).expect(201);
    });
  });

  describe('two requests at once', () => {
    it('opens exactly one draft per child, however many opens race', async () => {
      const parent = await elevatedParent();
      const gradeLevel = await createGradeLevel(h);
      const profile = await createStudentProfile(h, parent.parentAccountId, {
        gradeLevelId: gradeLevel.id,
      });

      const opened = await Promise.all(
        Array.from({ length: 4 }, () =>
          server()
            .post('/api/parent/source-tests')
            .set('Authorization', bearer(parent.token))
            .send({ studentProfileId: profile.id }),
        ),
      );

      for (const response of opened) expect(response.status).toBe(200);
      // One row, and every caller was handed it — not four drafts of which
      // three are silently stranded with whatever pages landed on them.
      const ids = new Set(opened.map((response) => response.body.id as string));
      expect(ids.size).toBe(1);
      expect(await h.prisma.sourceTest.count({ where: { studentProfileId: profile.id } })).toBe(1);
    });

    it('gives concurrent adds contiguous ordinals, and never a raw database fault', async () => {
      const draft = await openDraft();
      const bytes = await Promise.all([
        photo({ height: 60 }),
        photo({ height: 61 }),
        photo({ height: 62 }),
      ]);

      const added = await Promise.all(
        bytes.map((buffer) => addPage(draft.token, draft.sourceTestId, buffer)),
      );
      for (const response of added) expect(response.status).toBe(201);

      const stored = await storedPages(draft.sourceTestId);
      expect(stored.map((page) => page.ordinal)).toEqual([1, 2, 3]);
      expect(stored.every((page) => page.state === 'Ready')).toBe(true);
    });
  });

  describe('the elevation guard', () => {
    it('refuses an unelevated call with elevated: false, before anything is read', async () => {
      const draft = await openDraft();
      const parent = await createSignedInParent(h);
      const base = `/api/parent/source-tests/${draft.sourceTestId}`;

      for (const refusal of [
        () => server().get(base),
        () => server().get(base).set('Cookie', parent.cookie),
        () => server().post('/api/parent/source-tests').send({ studentProfileId: randomUUID() }),
        () => server().post(`${base}/submit`).set('Cookie', parent.cookie),
        () => server().delete(`${base}/pages/${randomUUID()}`),
        // The classification write, and the taxonomy read it is chosen from:
        // the guard stands in front of every route on this controller, and an
        // enumeration that stops short of the newest ones is an enumeration
        // that stops proving anything the moment a route is added.
        () => server().patch(`${base}/classification`).send({ subjectId: randomUUID() }),
        () =>
          server()
            .patch(`${base}/classification`)
            .set('Cookie', parent.cookie)
            .send({ gradeLevelId: randomUUID() }),
        () =>
          server().get('/api/parent/source-tests/subjects').query({ gradeLevelId: randomUUID() }),
        () =>
          server()
            .get('/api/parent/source-tests/subjects')
            .query({ gradeLevelId: randomUUID() })
            .set('Cookie', parent.cookie),
      ]) {
        const response = await refusal().expect(401);
        expect(response.body.elevated).toBe(false);
      }
    });
  });

  describe('classification', () => {
    /** The classification patch, through the real route. */
    function classify(token: string, sourceTestId: string, patch: Record<string, unknown>) {
      return server()
        .patch(`/api/parent/source-tests/${sourceTestId}/classification`)
        .set('Authorization', bearer(token))
        .send(patch);
    }

    /** The offered-Subjects read, through the real route. */
    function subjects(token: string, gradeLevelId: string) {
      return server()
        .get('/api/parent/source-tests/subjects')
        .query({ gradeLevelId })
        .set('Authorization', bearer(token));
    }

    /** The stored classification columns alone — what was actually written. */
    function storedClassification(sourceTestId: string) {
      return h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: sourceTestId },
        select: { subjectId: true, gradeLevelId: true },
      });
    }

    describe('the Grade Level a draft opens with', () => {
      it('is the child\u2019s own, resolved by name, with no Subject yet', async () => {
        const draft = await openDraft();
        const view = await server()
          .get(`/api/parent/source-tests/${draft.sourceTestId}`)
          .set('Authorization', bearer(draft.token))
          .expect(200);

        expect(view.body.gradeLevelId).toBe(draft.gradeLevelId);
        expect(view.body.gradeLevelName).toBe(draft.gradeLevelName);
        expect(view.body.subjectId).toBeNull();
        expect(view.body.subjectName).toBeNull();
      });

      it('is never re-defaulted when the draft is resumed after an override', async () => {
        const draft = await openDraft();
        const other = await createGradeLevel(h);
        await classify(draft.token, draft.sourceTestId, { gradeLevelId: other.id }).expect(200);

        const resumed = await server()
          .post('/api/parent/source-tests')
          .set('Authorization', bearer(draft.token))
          .send({ studentProfileId: draft.studentProfileId })
          .expect(200);

        expect(resumed.body.id).toBe(draft.sourceTestId);
        expect(resumed.body.gradeLevelId).toBe(other.id);
      });

      it('leaves the Student Profile exactly as it was', async () => {
        const draft = await openDraft();
        const other = await createGradeLevel(h);
        await classify(draft.token, draft.sourceTestId, { gradeLevelId: other.id }).expect(200);

        const profile = await h.prisma.studentProfile.findUniqueOrThrow({
          where: { id: draft.studentProfileId },
          select: { gradeLevelId: true },
        });
        expect(profile.gradeLevelId).toBe(draft.gradeLevelId);
      });
    });

    describe('the Subjects offered for a Grade Level', () => {
      it('is exactly the three-flag conjunction, by name', async () => {
        const draft = await openDraft();
        const offered = await createSubject(h, {
          name: 'Offered Subject',
          gradeLevelId: draft.gradeLevelId,
        });
        // Enabled everywhere, but not paired with this Grade Level at all.
        await createSubject(h, { name: 'Unpaired Subject' });
        // Paired, but the join row is disabled.
        await createSubject(h, {
          name: 'Withdrawn Pairing',
          gradeLevelId: draft.gradeLevelId,
          available: false,
        });
        // Paired and enabled for it, but the Subject itself is disabled.
        await createSubject(h, {
          name: 'Disabled Subject',
          gradeLevelId: draft.gradeLevelId,
          enabled: false,
        });

        const response = await subjects(draft.token, draft.gradeLevelId).expect(200);
        expect(response.body.map((item: { name: string }) => item.name)).toEqual([offered.name]);
      });

      it('is empty for a Grade Level an Admin has withdrawn', async () => {
        const draft = await openDraft();
        await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        const withdrawn = await createGradeLevel(h, { enabled: false });
        await createSubject(h, { gradeLevelId: withdrawn.id });

        const response = await subjects(draft.token, withdrawn.id).expect(200);
        expect(response.body).toEqual([]);
      });

      it('is a 404 for a Grade Level that does not exist', async () => {
        const draft = await openDraft();
        await subjects(draft.token, randomUUID()).expect(404);
      });

      it('is declared before the id route, so the literal path is not parsed as one', async () => {
        const draft = await openDraft();
        // Without the declaration order this answers 400 about "subjects"
        // failing `ParseUUIDPipe`, never 200.
        await subjects(draft.token, draft.gradeLevelId).expect(200);
      });

      it('refuses a missing or unparseable Grade Level before reading anything', async () => {
        const draft = await openDraft();
        // The query parameter is the whole question the route answers, so an
        // absent one is a shape fault and not an empty list.
        await server()
          .get('/api/parent/source-tests/subjects')
          .set('Authorization', bearer(draft.token))
          .expect(400);
        await server()
          .get('/api/parent/source-tests/subjects')
          .query({ gradeLevelId: 'grade five' })
          .set('Authorization', bearer(draft.token))
          .expect(400);
      });
    });

    describe('assigning a Subject', () => {
      it('sets it and resolves its name, against the stored Grade Level', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });

        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
        }).expect(200);

        expect(response.body.subjectId).toBe(subject.id);
        expect(response.body.subjectName).toBe(subject.name);
        expect(response.body.gradeLevelId).toBe(draft.gradeLevelId);
      });

      it('refuses one the Admin has disabled, and writes nothing', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, {
          gradeLevelId: draft.gradeLevelId,
          enabled: false,
        });

        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
        }).expect(400);

        expect(messagesOf(response)).toContain(SUBJECT_NOT_AVAILABLE);
        expect(await storedClassification(draft.sourceTestId)).toMatchObject({ subjectId: null });
      });

      it('refuses one not paired with this Grade Level, and writes nothing', async () => {
        const draft = await openDraft();
        const elsewhere = await createGradeLevel(h);
        const subject = await createSubject(h, { gradeLevelId: elsewhere.id });

        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
        }).expect(400);

        expect(messagesOf(response)).toContain(SUBJECT_NOT_AVAILABLE);
        expect(await storedClassification(draft.sourceTestId)).toMatchObject({ subjectId: null });
      });

      it('validates the pair that results, not the one already stored', async () => {
        const draft = await openDraft();
        const other = await createGradeLevel(h);
        // Offered for the draft's current Grade Level, and for no other.
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });

        // Sent together, the Subject is judged against the *new* Grade Level.
        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
          gradeLevelId: other.id,
        }).expect(400);

        expect(messagesOf(response)).toContain(SUBJECT_NOT_AVAILABLE);
        expect(await storedClassification(draft.sourceTestId)).toEqual({
          subjectId: null,
          gradeLevelId: draft.gradeLevelId,
        });
      });

      it('accepts a pair sent together when the resulting pair is offered', async () => {
        const draft = await openDraft();
        const other = await createGradeLevel(h);
        const subject = await createSubject(h, { gradeLevelId: other.id });

        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
          gradeLevelId: other.id,
        }).expect(200);

        expect(response.body).toMatchObject({ subjectId: subject.id, gradeLevelId: other.id });
      });

      it('answers 404 for a uuid that names no Subject row', async () => {
        const draft = await openDraft();
        await classify(draft.token, draft.sourceTestId, { subjectId: randomUUID() }).expect(404);
        expect(await storedClassification(draft.sourceTestId)).toMatchObject({ subjectId: null });
      });
    });

    describe('overriding the Grade Level', () => {
      it('keeps a Subject the new Grade Level still offers', async () => {
        const draft = await openDraft();
        const other = await createGradeLevel(h);
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await h.taxonomy.setAvailability(h.operatorId, subject.id, other.id, true);

        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);
        const response = await classify(draft.token, draft.sourceTestId, {
          gradeLevelId: other.id,
        }).expect(200);

        expect(response.body).toMatchObject({ subjectId: subject.id, gradeLevelId: other.id });
      });

      it('clears a Subject the new Grade Level does not offer, rather than refusing', async () => {
        const draft = await openDraft();
        const other = await createGradeLevel(h);
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });

        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);
        const response = await classify(draft.token, draft.sourceTestId, {
          gradeLevelId: other.id,
        }).expect(200);

        expect(response.body.gradeLevelId).toBe(other.id);
        expect(response.body.subjectId).toBeNull();
        expect(response.body.subjectName).toBeNull();
        expect(await storedClassification(draft.sourceTestId)).toEqual({
          subjectId: null,
          gradeLevelId: other.id,
        });
      });

      it('refuses a withdrawn Grade Level with 400, and writes nothing', async () => {
        const draft = await openDraft();
        const withdrawn = await createGradeLevel(h, { enabled: false });

        const response = await classify(draft.token, draft.sourceTestId, {
          gradeLevelId: withdrawn.id,
        }).expect(400);

        expect(messagesOf(response)).toContain(GRADE_LEVEL_NOT_SELECTABLE);
        expect(await storedClassification(draft.sourceTestId)).toMatchObject({
          gradeLevelId: draft.gradeLevelId,
        });
      });

      it('answers 404 for a uuid that names no Grade Level row', async () => {
        const draft = await openDraft();
        await classify(draft.token, draft.sourceTestId, { gradeLevelId: randomUUID() }).expect(404);
        // Nothing written: the seeded Grade Level from `openDraft` stands
        // unchanged, exactly as the sibling unknown-Subject case above asserts.
        expect(await storedClassification(draft.sourceTestId)).toMatchObject({
          gradeLevelId: draft.gradeLevelId,
        });
      });
    });

    describe('the patch itself', () => {
      it('refuses an empty body, rather than treating it as a no-op', async () => {
        const draft = await openDraft();
        const response = await classify(draft.token, draft.sourceTestId, {}).expect(400);
        expect(messagesOf(response)).toContain(NOTHING_TO_CLASSIFY);
      });

      it('refuses a value that is not a uuid, in this module’s own words', async () => {
        const draft = await openDraft();

        const subject = await classify(draft.token, draft.sourceTestId, {
          subjectId: 'maths',
        }).expect(400);
        // The sentence, not merely the status: a shape fault says which field
        // it is about, and says it in the wording this module owns rather than
        // class-validator's own English.
        expect(messagesOf(subject)).toContain(SUBJECT_ID_INVALID);

        const gradeLevel = await classify(draft.token, draft.sourceTestId, {
          gradeLevelId: 'grade five',
        }).expect(400);
        expect(messagesOf(gradeLevel)).toContain(GRADE_LEVEL_ID_INVALID);

        // A v1 uuid is a uuid but not one this system issues, so it is refused
        // as shape too, exactly as every sibling DTO refuses it.
        const v1 = await classify(draft.token, draft.sourceTestId, {
          subjectId: '2c1b814e-9a3f-11ee-b9d1-0242ac120002',
        }).expect(400);
        expect(messagesOf(v1)).toContain(SUBJECT_ID_INVALID);

        expect(await storedClassification(draft.sourceTestId)).toMatchObject({ subjectId: null });
      });

      it('treats an explicit null as nothing sent, and writes nothing', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);

        // `@IsOptional()` skips a null as well as an absent value, so these
        // reach the service validated against nothing. There is no unset route,
        // so they mean what an empty body means — and in particular they must
        // not clear what is stored.
        for (const patch of [
          { subjectId: null },
          { gradeLevelId: null },
          { subjectId: null, gradeLevelId: null },
        ]) {
          const response = await classify(draft.token, draft.sourceTestId, patch).expect(400);
          expect(messagesOf(response)).toContain(NOTHING_TO_CLASSIFY);
        }

        expect(await storedClassification(draft.sourceTestId)).toEqual({
          subjectId: subject.id,
          gradeLevelId: draft.gradeLevelId,
        });
      });

      it('refuses a Subject against a draft holding no Grade Level at all', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        // The state a draft opened before these columns existed is in: no Grade
        // Level, so nothing is offered, so no Subject can be first.
        await h.prisma.sourceTest.update({
          where: { id: draft.sourceTestId },
          data: { gradeLevelId: null },
        });

        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
        }).expect(400);

        expect(messagesOf(response)).toContain(SUBJECT_NOT_AVAILABLE);
        expect(await storedClassification(draft.sourceTestId)).toEqual({
          subjectId: null,
          gradeLevelId: null,
        });
      });

      it('answers the vanished-upload 404 for another account\u2019s Source Test', async () => {
        const mine = await elevatedParent();
        const theirs = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: theirs.gradeLevelId });

        const response = await classify(mine.token, theirs.sourceTestId, {
          subjectId: subject.id,
        }).expect(404);

        expect(messagesOf(response)).toContain(SOURCE_TEST_NOT_FOUND);
        expect(await storedClassification(theirs.sourceTestId)).toMatchObject({ subjectId: null });
      });

      it('refuses a submitted Source Test with the already-submitted 409', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);
        await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);
        await server()
          .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
          .set('Authorization', bearer(draft.token))
          .expect(200);

        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
        }).expect(409);
        expect(messagesOf(response)).toContain(SOURCE_TEST_NOT_DRAFT);
      });

      it('answers the vanished-upload 404 for an expired draft', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await h.prisma.sourceTest.update({
          where: { id: draft.sourceTestId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const response = await classify(draft.token, draft.sourceTestId, {
          subjectId: subject.id,
        }).expect(404);
        expect(messagesOf(response)).toContain(SOURCE_TEST_NOT_FOUND);
      });
    });

    describe('the submit gate', () => {
      it('refuses a draft with pages but no Subject, and leaves it a draft', async () => {
        const draft = await openDraft();
        await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);

        const response = await server()
          .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
          .set('Authorization', bearer(draft.token))
          .expect(400);

        expect(messagesOf(response)).toContain(CLASSIFICATION_REQUIRED);
        const row = await h.prisma.sourceTest.findUniqueOrThrow({
          where: { id: draft.sourceTestId },
          select: { status: true, submittedAt: true },
        });
        expect(row).toEqual({ status: 'Draft', submittedAt: null });
      });

      it('refuses a draft with a Subject but no Grade Level', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);
        await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);
        // There is no route that unsets a Grade Level — a draft predating the
        // columns is how this state arises — so the row is put into it here.
        await h.prisma.sourceTest.update({
          where: { id: draft.sourceTestId },
          data: { gradeLevelId: null },
        });

        const response = await server()
          .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
          .set('Authorization', bearer(draft.token))
          .expect(400);
        expect(messagesOf(response)).toContain(CLASSIFICATION_REQUIRED);
      });

      it('states the page requirement first when neither is met', async () => {
        const draft = await openDraft();
        const response = await server()
          .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
          .set('Authorization', bearer(draft.token))
          .expect(400);
        expect(messagesOf(response)).toContain(NO_PAGES_TO_SUBMIT);
      });

      it('admits a classified draft with pages', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);
        await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);

        const response = await server()
          .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
          .set('Authorization', bearer(draft.token))
          .expect(200);
        expect(response.body.status).toBe('Submitted');
        expect(response.body.subjectId).toBe(subject.id);
      });
    });

    describe('two classification patches at once', () => {
      it('never leaves a pair neither of them validated', async () => {
        const draft = await openDraft();
        // A Subject offered for the draft's own Grade Level and for nothing
        // else, and a second Grade Level that does not offer it. Sent
        // concurrently, the two patches validate against the same pre-write
        // state: the Subject is offered for the *stored* Grade Level, and the
        // Grade Level change sees no Subject to drop. Without a compare-and-set
        // the losing write still lands and the row ends up holding a pair that
        // was never offered.
        const onlyHere = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        const elsewhere = await createGradeLevel(h);

        const [setSubject, moveGradeLevel] = await Promise.all([
          classify(draft.token, draft.sourceTestId, { subjectId: onlyHere.id }),
          classify(draft.token, draft.sourceTestId, { gradeLevelId: elsewhere.id }),
        ]);
        // Neither is a server fault. A loser re-reads and re-validates against
        // what is now stored, so it either applies (200), is refused because
        // the pair it would now produce is not offered (400), or is refused as
        // the draft having moved out from under it twice (409). What it never
        // does is apply the pair it validated against a state that is gone.
        for (const response of [setSubject, moveGradeLevel]) {
          expect([200, 400, 409]).toContain(response.status);
        }
        // And at least one of the two was actually applied: a compare-and-set
        // that refused both would be safe and useless.
        expect([setSubject.status, moveGradeLevel.status]).toContain(200);

        const stored = await storedClassification(draft.sourceTestId);
        if (stored.subjectId !== null) {
          // Whatever order they resolved in, the stored Subject is offered for
          // the stored Grade Level — asked of the one service that knows.
          const offered = await h.taxonomy.listSelectableSubjects(stored.gradeLevelId!);
          expect(offered.map((item) => item.id)).toContain(stored.subjectId);
        }
      });
    });

    describe('a stored reference outlives the Admin action taken against it', () => {
      it('still resolves, still names, and still submits after the Subject is disabled', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);
        await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);

        // The Admin action, after the parent had already chosen.
        await h.taxonomy.setSubjectEnabled(h.operatorId, subject.id, false);

        const read = await server()
          .get(`/api/parent/source-tests/${draft.sourceTestId}`)
          .set('Authorization', bearer(draft.token))
          .expect(200);
        expect(read.body.subjectId).toBe(subject.id);
        expect(read.body.subjectName).toBe(subject.name);

        // And the gate asserts non-null, never enablement.
        const submitted = await server()
          .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
          .set('Authorization', bearer(draft.token))
          .expect(200);
        expect(submitted.body.status).toBe('Submitted');
        expect(submitted.body.subjectName).toBe(subject.name);
      });

      it('reads the renamed label without the Source Test row being written', async () => {
        const draft = await openDraft();
        const subject = await createSubject(h, { gradeLevelId: draft.gradeLevelId });
        await classify(draft.token, draft.sourceTestId, { subjectId: subject.id }).expect(200);
        const before = await h.prisma.sourceTest.findUniqueOrThrow({
          where: { id: draft.sourceTestId },
          select: { subjectId: true, updatedAt: true },
        });

        await h.taxonomy.renameSubject(h.operatorId, subject.id, 'Mathematics');

        const read = await server()
          .get(`/api/parent/source-tests/${draft.sourceTestId}`)
          .set('Authorization', bearer(draft.token))
          .expect(200);
        expect(read.body.subjectName).toBe('Mathematics');

        const after = await h.prisma.sourceTest.findUniqueOrThrow({
          where: { id: draft.sourceTestId },
          select: { subjectId: true, updatedAt: true },
        });
        expect(after).toEqual(before);
      });
    });
  });
});
