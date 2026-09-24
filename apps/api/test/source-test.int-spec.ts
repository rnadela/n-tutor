import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const {
  MAX_PAGES,
  MAX_PAGE_BYTES,
  NO_PAGES_TO_SUBMIT,
  PAGE_LIMIT_REACHED,
  PAGE_NOT_FOUND,
  PAGE_ORDER_MISMATCH,
  SOURCE_TEST_NOT_DRAFT,
  SOURCE_TEST_NOT_FOUND,
  STORED_MIME,
  UNSUPPORTED_IMAGE_FORMAT,
  pageTooLarge,
  resetSourceTestRuntime,
} = await import('../src/sourcetest/source-test-policy.js');
const { PROFILE_NOT_FOUND } = await import('../src/identity/student-profile.service.js');
const {
  bearer,
  createGradeLevel,
  createHarness,
  createSignedInParent,
  createStudentProfile,
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
    return { ...parent, studentProfileId: profile.id, sourceTestId: response.body.id };
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
      await addPage(draft.token, draft.sourceTestId, await photo()).expect(201);

      const response = await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
        .set('Authorization', bearer(draft.token))
        .expect(200);

      expect(response.body.status).toBe('Submitted');
      expect(response.body.submittedAt).not.toBeNull();
    });

    it('refuses every page-management write once it is submitted', async () => {
      const draft = await openDraft();
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
      ]) {
        const response = await refusal().expect(401);
        expect(response.body.elevated).toBe(false);
      }
    });
  });
});
