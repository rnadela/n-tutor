import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  EXTRACTION_FAILED,
  EXTRACTION_INPUT_UNUSABLE,
  EXTRACTION_NOT_FOUND,
  EXTRACTION_PAGES_GONE,
  EXTRACTION_UPSTREAM_REJECTED,
  MAX_JOB_ATTEMPTS,
  claimTimeoutMs,
  resetExtractionRuntime,
} = await import('../src/extraction/extraction-policy.js');
const { SOURCE_TEST_NOT_FOUND } = await import('../src/sourcetest/source-test-policy.js');
const { ExtractionService } = await import('../src/extraction/extraction.service.js');
const { AiService, AiRejectedError } = await import('../src/ai/ai.service.js');
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

describe('Source Tests: structured extraction', () => {
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

  // Every env knob a case drives is restored here rather than by hand, so a
  // failed assertion mid-case cannot leak the override into the next one.
  afterEach(() => {
    vi.unstubAllEnvs();
    resetExtractionRuntime();
  });

  /** A parent standing inside Parent View, with the bearer its routes take. */
  async function elevatedParent(): Promise<{ parentAccountId: string; token: string }> {
    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    return { parentAccountId: parent.parentAccountId, token: await elevate(h, parent.cookie, PIN) };
  }

  /** A classified draft carrying `pageCount` Ready pages, ready to submit. */
  async function readyDraft(pageCount = 3): Promise<{
    parentAccountId: string;
    token: string;
    sourceTestId: string;
  }> {
    const parent = await elevatedParent();
    const gradeLevel = await createGradeLevel(h);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const draft = await server()
      .post('/api/parent/source-tests')
      .set('Authorization', bearer(parent.token))
      .send({ studentProfileId: profile.id })
      .expect(200);
    const sourceTestId: string = draft.body.id;

    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });
    await server()
      .patch(`/api/parent/source-tests/${sourceTestId}/classification`)
      .set('Authorization', bearer(parent.token))
      .send({ subjectId: subject.id })
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
    return { ...parent, sourceTestId };
  }

  /** A draft, submitted through the real route. */
  async function submitted(pageCount = 3) {
    const draft = await readyDraft(pageCount);
    await server()
      .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
      .set('Authorization', bearer(draft.token))
      .expect(200);
    return draft;
  }

  const jobFor = (sourceTestId: string) =>
    h.prisma.extractionJob.findUnique({ where: { sourceTestId } });

  const statusOf = (token: string, sourceTestId: string) =>
    server()
      .get(`/api/parent/source-tests/${sourceTestId}/extraction`)
      .set('Authorization', bearer(token));

  /** The whole stored document, read back without touching a Page Image. */
  async function storedExtraction(sourceTestId: string) {
    const extraction = await h.prisma.extraction.findUnique({
      where: { sourceTestId },
      select: {
        id: true,
        pageCount: true,
        completedAt: true,
        contexts: { orderBy: { ordinal: 'asc' } },
        uninterpretable: true,
        questions: {
          orderBy: { ordinal: 'asc' },
          include: {
            choices: { orderBy: { ordinal: 'asc' } },
            topics: true,
          },
        },
      },
    });
    return extraction;
  }

  describe('enqueueing inside the submit transaction', () => {
    it('writes exactly one Queued job when the submit commits', async () => {
      const draft = await submitted();
      const job = await jobFor(draft.sourceTestId);
      expect(job).not.toBeNull();
      expect(job!.status).toBe('Queued');
      expect(job!.attempts).toBe(0);
      expect(job!.retryable).toBe(false);
      expect(await h.prisma.extractionJob.count()).toBe(1);
    });

    it('leaves no job behind when the submit is refused', async () => {
      // Zero pages: the page gate refuses, and the whole transaction rolls
      // back — so the job the enqueue would have written is not there either.
      const draft = await readyDraft(0);
      await server()
        .post(`/api/parent/source-tests/${draft.sourceTestId}/submit`)
        .set('Authorization', bearer(draft.token))
        .expect(400);
      expect(await jobFor(draft.sourceTestId)).toBeNull();
    });
  });

  describe('one worker pass', () => {
    it('reads every page as one document and stores what came back', async () => {
      const draft = await submitted(3);
      expect(await h.extractionRunner.runOnce()).toBe(true);

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Succeeded');
      expect(job!.attempts).toBe(1);
      expect(job!.failureKind).toBeNull();
      expect(job!.completedAt).not.toBeNull();

      // One provider call, carrying all three pages.
      expect(h.ai.sent).toEqual([{ callClass: 'Extraction', modality: 'vision', imageCount: 3 }]);

      const extraction = await storedExtraction(draft.sourceTestId);
      expect(extraction!.pageCount).toBe(3);
      expect(extraction!.questions.length).toBeGreaterThan(0);
      for (const question of extraction!.questions) {
        // Exactly one format and at least one topic, on every question (AD-30).
        expect(['MultipleChoice', 'FillInTheBlank', 'ShortAnswer']).toContain(question.format);
        expect(question.topics.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('writes exactly one cost row, carrying no content', async () => {
      const draft = await submitted(3);
      await h.extractionRunner.runOnce();

      const calls = await h.prisma.aiCall.findMany();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        parentAccountId: draft.parentAccountId,
        callClass: 'Extraction',
      });
      expect(calls[0]!.costMicros).toBeGreaterThan(0);
      expect(Number.isInteger(calls[0]!.costMicros)).toBe(true);
      // A worker-run job is not request-scoped, so it carries no correlation id.
      expect(calls[0]!.correlationId).toBeNull();
    });

    it('stores a cross-page context once, referenced by questions on two pages', async () => {
      const draft = await submitted(3);
      await h.extractionRunner.runOnce();

      const extraction = await storedExtraction(draft.sourceTestId);
      expect(extraction!.contexts).toHaveLength(1);
      const context = extraction!.contexts[0]!;
      expect(context.startPageOrdinal).toBe(1);
      expect(context.endPageOrdinal).toBe(3);

      const referring = extraction!.questions.filter((q) => q.contextId === context.id);
      expect(referring.length).toBeGreaterThanOrEqual(2);
      // Including a question printed on a later page than the context starts on.
      expect(new Set(referring.map((q) => q.pageOrdinal)).size).toBeGreaterThanOrEqual(2);
      expect(Math.max(...referring.map((q) => q.pageOrdinal))).toBeGreaterThan(
        context.startPageOrdinal,
      );
    });

    it('stores a fraction as structure and never as a string', async () => {
      const draft = await submitted(2);
      await h.extractionRunner.runOnce();

      const extraction = await storedExtraction(draft.sourceTestId);
      const prompts = extraction!.questions.map((question) => question.prompt);
      const fractions = prompts
        .flatMap((prompt) => prompt as { kind: string }[])
        .filter((segment) => segment.kind === 'fraction');
      expect(fractions.length).toBeGreaterThan(0);
      expect(fractions[0]).toMatchObject({ kind: 'fraction', numerator: 1, denominator: 2 });
      // And nowhere in the stored document is the string form.
      expect(JSON.stringify(prompts)).not.toContain('1/2');
    });

    it('records an uninterpretable region and marks exactly the dependent question unusable', async () => {
      const draft = await submitted(3);
      await h.extractionRunner.runOnce();

      const extraction = await storedExtraction(draft.sourceTestId);
      expect(extraction!.uninterpretable).toHaveLength(1);
      expect(extraction!.uninterpretable[0]!.pageOrdinal).toBe(3);

      const unusable = extraction!.questions.filter((question) => !question.usable);
      expect(unusable).toHaveLength(1);
      expect(unusable[0]!.dependsOnUninterpretable).toBe(true);
      // Everything else stayed usable.
      expect(extraction!.questions.filter((question) => question.usable)).toHaveLength(3);
    });

    it('claims nothing when the queue is empty', async () => {
      expect(await h.extractionRunner.runOnce()).toBe(false);
    });
  });

  describe('two workers racing one job', () => {
    it('lets exactly one claim it, and makes exactly one provider call', async () => {
      const draft = await submitted(2);
      const extraction = h.moduleRef.get(ExtractionService);

      const [first, second] = await Promise.all([extraction.claimNext(), extraction.claimNext()]);
      const winners = [first, second].filter((claim) => claim !== null);
      expect(winners).toHaveLength(1);

      await extraction.runJob(winners[0]!);
      expect(h.ai.sent).toHaveLength(1);
      expect((await jobFor(draft.sourceTestId))!.status).toBe('Succeeded');
    });
  });

  describe('failures', () => {
    it('fails retryably on a transport fault, storing nothing', async () => {
      const draft = await submitted(2);
      h.ai.failNext('transport');
      await h.extractionRunner.runOnce();

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Failed');
      expect(job!.failureKind).toBe('UpstreamFault');
      expect(job!.retryable).toBe(true);
      expect(job!.failureReason).toBe(EXTRACTION_FAILED);
      expect(await storedExtraction(draft.sourceTestId)).toBeNull();
      expect(await h.prisma.aiCall.count()).toBe(0);
    });

    it("treats a schema-invalid payload as the provider's fault too", async () => {
      const draft = await submitted(2);
      h.ai.failNext('schema');
      await h.extractionRunner.runOnce();

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Failed');
      expect(job!.failureKind).toBe('UpstreamFault');
      expect(job!.retryable).toBe(true);
      expect(await storedExtraction(draft.sourceTestId)).toBeNull();
      expect(await h.prisma.aiCall.count()).toBe(0);
    });

    it('rejects a post-hoc violation whole, rather than storing the rest', async () => {
      const draft = await submitted(2);
      const ai = h.moduleRef.get(AiService);
      const wrapped = ai.run.bind(ai);
      // Schema-valid and rule-breaking: a question with no topic at all, which
      // no shape check can catch and the deterministic pass must (AD-30).
      ai.run = (async () => ({
        payload: {
          pages: [
            { ordinal: 1, interpretable: true },
            { ordinal: 2, interpretable: true },
          ],
          contexts: [],
          questions: [
            {
              pageOrdinal: 1,
              format: 'ShortAnswer',
              prompt: [{ kind: 'text', value: 'A question with no topic.' }],
              choices: [],
              topics: [],
              confidence: 'High',
              contextId: null,
              dependsOnUninterpretable: false,
            },
          ],
          uninterpretable: [],
        },
        usage: {
          model: 'stub',
          inputTokens: 0,
          outputTokens: 0,
          costMicros: 0,
          latencyMs: 0,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;
      try {
        await h.extractionRunner.runOnce();
      } finally {
        ai.run = wrapped;
      }

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Failed');
      expect(job!.failureKind).toBe('UpstreamFault');
      expect(job!.retryable).toBe(true);
      expect(await storedExtraction(draft.sourceTestId)).toBeNull();
    });

    it('fails terminally, not retryably, when the provider refuses the request', async () => {
      const draft = await submitted(2);
      const ai = h.moduleRef.get(AiService);
      const wrapped = ai.run.bind(ai);
      ai.run = (async () => {
        throw new AiRejectedError('rejected', 401);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      try {
        await h.extractionRunner.runOnce();
      } finally {
        ai.run = wrapped;
      }

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Failed');
      expect(job!.failureKind).toBe('UpstreamFault');
      expect(job!.retryable).toBe(false);
      expect(job!.failureReason).toBe(EXTRACTION_UPSTREAM_REJECTED);
      expect(await storedExtraction(draft.sourceTestId)).toBeNull();
      // Terminal: a refusal is a standing fact, not an outage to retry.
      expect(await h.extractionRunner.runOnce()).toBe(false);
    });

    it('fails terminally when no page could be read', async () => {
      const draft = await submitted(2);
      h.ai.failNext('unusable');
      await h.extractionRunner.runOnce();

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Failed');
      expect(job!.failureKind).toBe('ClientFault');
      expect(job!.retryable).toBe(false);
      expect(job!.failureReason).toBe(EXTRACTION_INPUT_UNUSABLE);
      // And a further pass does not pick it up again: terminal means terminal.
      expect(await h.extractionRunner.runOnce()).toBe(false);
    });

    it('fails terminally, not retryably, when the pages are gone before the job runs', async () => {
      // The realistic race the code guards against: Epic 8's image-expiry sweep
      // (or any other removal) landing between enqueue and claim.
      const draft = await submitted(2);
      await h.prisma.pageImage.deleteMany({ where: { sourceTestId: draft.sourceTestId } });
      await h.extractionRunner.runOnce();

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Failed');
      expect(job!.failureKind).toBe('ClientFault');
      expect(job!.retryable).toBe(false);
      expect(job!.failureReason).toBe(EXTRACTION_PAGES_GONE);
      expect(await storedExtraction(draft.sourceTestId)).toBeNull();
      expect(await h.prisma.aiCall.count()).toBe(0);
      // Terminal: a further pass does not pick it up and pay for nothing again.
      expect(await h.extractionRunner.runOnce()).toBe(false);
    });
  });

  describe('re-running', () => {
    it('returns the single job row to Queued rather than adding a second', async () => {
      const draft = await submitted(2);
      h.ai.failNext('transport');
      await h.extractionRunner.runOnce();
      expect((await jobFor(draft.sourceTestId))!.status).toBe('Failed');

      await h.prisma.withTransaction((tx) =>
        h.moduleRef.get(ExtractionService).enqueue(tx, draft.sourceTestId),
      );

      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Queued');
      expect(job!.failureKind).toBeNull();
      expect(job!.retryable).toBe(false);
      expect(await h.prisma.extractionJob.count()).toBe(1);

      await h.extractionRunner.runOnce();
      expect((await jobFor(draft.sourceTestId))!.status).toBe('Succeeded');
    });

    it('replaces a prior Extraction whole rather than accumulating one', async () => {
      const draft = await submitted(2);
      await h.extractionRunner.runOnce();
      const first = await storedExtraction(draft.sourceTestId);

      await h.prisma.withTransaction((tx) =>
        h.moduleRef.get(ExtractionService).enqueue(tx, draft.sourceTestId),
      );
      await h.extractionRunner.runOnce();

      const second = await storedExtraction(draft.sourceTestId);
      expect(await h.prisma.extraction.count()).toBe(1);
      expect(second!.id).not.toBe(first!.id);
      // The children went with it: nothing is orphaned by the replacement.
      expect(await h.prisma.extractedQuestion.count()).toBe(second!.questions.length);
      expect(await h.prisma.extractedContext.count()).toBe(second!.contexts.length);
    });
  });

  describe('the status read', () => {
    it('reports Queued with no counts before the job runs', async () => {
      const draft = await submitted(2);
      const response = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(response.body).toMatchObject({
        status: 'Queued',
        pageCount: null,
        questionCount: null,
        usableQuestionCount: null,
        uninterpretableRegionCount: null,
      });
    });

    it('reports the counts and nothing else after the job succeeds', async () => {
      const draft = await submitted(3);
      await h.extractionRunner.runOnce();

      const response = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(response.body.status).toBe('Succeeded');
      expect(response.body.pageCount).toBe(3);
      expect(response.body.questionCount).toBe(4);
      expect(response.body.usableQuestionCount).toBe(3);
      expect(response.body.uninterpretableRegionCount).toBe(1);
      expect(response.body.completedAt).not.toBeNull();

      // Not one word of what the model read reaches the body.
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('passage');
      expect(body).not.toContain('Reading comprehension');
      expect(body).not.toContain('prompt');
    });

    it('calls a two-page upload that yielded too little thin, and states both counts', async () => {
      // The default fake puts one usable question on each page, against a
      // threshold of two per page — so two pages yielding two usable questions
      // is exactly the case the warning exists for.
      const draft = await submitted(2);
      await h.extractionRunner.runOnce();

      const response = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(response.body.status).toBe('Succeeded');
      expect(response.body.pageCount).toBe(2);
      // Both counts: the rule is about the *usable* ones, and the fake's one
      // dependent question is exactly what makes the two differ.
      expect(response.body.questionCount).toBe(3);
      expect(response.body.usableQuestionCount).toBe(2);
      expect(response.body.thin).toBe(true);

      // The verdict rides the status read and carries nothing with it.
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('prompt');
      expect(body).not.toContain('passage');
      expect(body).not.toContain('Reading comprehension');
    });

    it('calls the same upload healthy once its pages yield enough', async () => {
      vi.stubEnv('AI_FAKE_QUESTIONS_PER_PAGE', '3');
      const draft = await submitted(2);
      await h.extractionRunner.runOnce();

      const response = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(response.body.status).toBe('Succeeded');
      expect(response.body.pageCount).toBe(2);
      // Three usable a page plus the one dependent question the fake always
      // adds, so the usable-versus-total distinction is checked on this side
      // of the verdict too.
      expect(response.body.questionCount).toBe(7);
      expect(response.body.usableQuestionCount).toBe(6);
      expect(response.body.thin).toBe(false);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('prompt');
    });

    it('measures the verdict against the configured figure, not the default constant', async () => {
      // The same Extraction, read twice under two thresholds. Without this,
      // `statusFor` could pass DEFAULT_MIN_USABLE_QUESTIONS_PER_PAGE straight
      // to the rule and every other case would stay green.
      const draft = await submitted(2);
      await h.extractionRunner.runOnce();

      const thin = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(thin.body.usableQuestionCount).toBe(2);
      expect(thin.body.thin).toBe(true);

      // One usable question a page is enough under a threshold of one.
      vi.stubEnv('EXTRACTION_MIN_USABLE_PER_PAGE', '1');
      resetExtractionRuntime();
      try {
        const healthy = await statusOf(draft.token, draft.sourceTestId).expect(200);
        expect(healthy.body.pageCount).toBe(2);
        expect(healthy.body.usableQuestionCount).toBe(2);
        expect(healthy.body.thin).toBe(false);
      } finally {
        vi.unstubAllEnvs();
        // The memoised runtime outlives the stub, so the next test would read
        // the overridden figure from cache rather than the default.
        resetExtractionRuntime();
      }
    });

    it('has no verdict at all while the job is still Queued', async () => {
      const draft = await submitted(2);
      const response = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(response.body.status).toBe('Queued');
      expect(response.body.usableQuestionCount).toBeNull();
      // Not `false`: there is no Extraction to be thin or healthy yet, and a
      // screen reading `false` would show "no warning needed" before anything
      // had been read.
      expect(response.body.thin).toBeNull();
    });

    it('has no verdict on a job that failed', async () => {
      const draft = await submitted(2);
      h.ai.failNext('transport');
      await h.extractionRunner.runOnce();

      const response = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(response.body.status).toBe('Failed');
      expect(response.body.thin).toBeNull();
      expect(response.body.failureReason).toBe(EXTRACTION_FAILED);
    });

    it("names whose fault a failure was, and only the provider's is retryable", async () => {
      const upstream = await submitted(2);
      h.ai.failNext('transport');
      await h.extractionRunner.runOnce();
      const upstreamBody = (await statusOf(upstream.token, upstream.sourceTestId).expect(200)).body;
      expect(upstreamBody).toMatchObject({
        status: 'Failed',
        failureKind: 'UpstreamFault',
        retryable: true,
      });

      const client = await submitted(2);
      h.ai.failNext('unusable');
      await h.extractionRunner.runOnce();
      const clientBody = (await statusOf(client.token, client.sourceTestId).expect(200)).body;
      expect(clientBody).toMatchObject({
        status: 'Failed',
        failureKind: 'ClientFault',
        retryable: false,
      });
    });

    it('is unchanged once every Page Image row and byte is gone', async () => {
      const draft = await submitted(3);
      await h.extractionRunner.runOnce();
      const before = (await statusOf(draft.token, draft.sourceTestId).expect(200)).body;

      // Epic 8's expiry, in one statement.
      await h.prisma.pageImage.deleteMany({ where: { sourceTestId: draft.sourceTestId } });
      expect(await h.prisma.pageImage.count({ where: { sourceTestId: draft.sourceTestId } })).toBe(
        0,
      );

      const after = (await statusOf(draft.token, draft.sourceTestId).expect(200)).body;
      expect(after).toEqual(before);

      // And the document itself is still whole.
      const extraction = await storedExtraction(draft.sourceTestId);
      expect(extraction!.pageCount).toBe(3);
      expect(extraction!.questions).toHaveLength(4);
    });

    it('answers 404 for a Source Test that has not been submitted', async () => {
      const draft = await readyDraft(1);
      const response = await statusOf(draft.token, draft.sourceTestId).expect(404);
      expect(String(response.body.message)).toBe(EXTRACTION_NOT_FOUND);
    });

    it("answers 404 for another account's Source Test, never 403", async () => {
      const mine = await submitted(1);
      const other = await elevatedParent();
      const response = await statusOf(other.token, mine.sourceTestId).expect(404);
      expect(String(response.body.message)).toBe(SOURCE_TEST_NOT_FOUND);
    });

    it('answers 404 for an id that names nothing', async () => {
      const parent = await elevatedParent();
      await statusOf(parent.token, randomUUID()).expect(404);
    });

    it('answers 200 for a Submitted Source Test whose draft TTL has passed', async () => {
      const draft = await submitted(2);
      await h.extractionRunner.runOnce();

      // `expiresAt` is the *draft's* 72-hour capture TTL and submit never
      // clears it. Honouring it here would make a complete Extraction vanish
      // three days after the photograph was taken — the exact opposite of the
      // rule that an Extraction outlives its images.
      await h.prisma.sourceTest.update({
        where: { id: draft.sourceTestId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const response = await statusOf(draft.token, draft.sourceTestId).expect(200);
      expect(response.body.status).toBe('Succeeded');
      expect(response.body.pageCount).toBe(2);
    });

    it('still answers 404 for a Draft whose TTL has passed', async () => {
      const draft = await readyDraft(1);
      await h.prisma.sourceTest.update({
        where: { id: draft.sourceTestId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      // An expired draft genuinely is over, and the read says so exactly as
      // every other Source Test read does.
      await statusOf(draft.token, draft.sourceTestId).expect(404);
    });

    it('refuses a caller who is not elevated', async () => {
      const draft = await submitted(1);
      await server().get(`/api/parent/source-tests/${draft.sourceTestId}/extraction`).expect(401);
    });
  });

  describe('a claim that went stale', () => {
    /** Moves a claim back in time, as a worker that died would leave it. */
    function ageClaim(sourceTestId: string, byMs: number) {
      return h.prisma.extractionJob.update({
        where: { sourceTestId },
        data: { lockedAt: new Date(Date.now() - byMs) },
      });
    }

    it('is left alone while it is still inside the timeout', async () => {
      const draft = await submitted(1);
      const extraction = h.moduleRef.get(ExtractionService);
      const claimed = await extraction.claimNext();
      expect(claimed).not.toBeNull();

      // A fresh claim is somebody's live work; taking it would read — and pay
      // for — the same pages twice.
      expect(await extraction.claimNext()).toBeNull();
      expect((await jobFor(draft.sourceTestId))!.attempts).toBe(1);
    });

    it('is reclaimed once the timeout has passed, and runs to Succeeded', async () => {
      const draft = await submitted(2);
      const claimed = await h.moduleRef.get(ExtractionService).claimNext();
      expect(claimed).not.toBeNull();
      // The worker that took it never came back.
      await ageClaim(draft.sourceTestId, claimTimeoutMs() + 1_000);

      expect(await h.extractionRunner.runOnce()).toBe(true);
      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Succeeded');
      expect(job!.attempts).toBe(2);
    });

    it('is given up on once it has used every attempt', async () => {
      const draft = await submitted(1);
      // A job that has killed its worker on every pass. Left claimable it would
      // be read, and billed for, on every pass forever.
      await h.prisma.extractionJob.update({
        where: { sourceTestId: draft.sourceTestId },
        data: {
          status: 'Running',
          attempts: MAX_JOB_ATTEMPTS,
          lockedAt: new Date(Date.now() - claimTimeoutMs() - 1_000),
        },
      });

      expect(await h.extractionRunner.runOnce()).toBe(false);
      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Failed');
      expect(job!.failureKind).toBe('UpstreamFault');
      expect(job!.retryable).toBe(false);
      expect(h.ai.sent).toHaveLength(0);
    });

    it('leaves a Running job alone when it is re-enqueued', async () => {
      const draft = await submitted(1);
      const extraction = h.moduleRef.get(ExtractionService);
      const claimed = await extraction.claimNext();
      expect(claimed).not.toBeNull();

      await h.prisma.withTransaction((tx) => extraction.enqueue(tx, draft.sourceTestId));

      // Still Running, still claimed: re-queueing it would clear a live claim
      // and let a second worker read the same pages alongside the first.
      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Running');
      expect(job!.attempts).toBe(1);
      expect(job!.lockedAt).not.toBeNull();
    });

    it('does not let a superseded pass overwrite a newer verdict', async () => {
      const draft = await submitted(1);
      const extraction = h.moduleRef.get(ExtractionService);
      const stale = await extraction.claimNext();
      expect(stale).not.toBeNull();

      // While that pass is notionally still running, the job is reclaimed and
      // finished by somebody else.
      await ageClaim(draft.sourceTestId, claimTimeoutMs() + 1_000);
      await h.extractionRunner.runOnce();
      expect((await jobFor(draft.sourceTestId))!.status).toBe('Succeeded');

      // The zombie now comes back and tries to write its own answer.
      await extraction.runJob(stale!);
      const job = await jobFor(draft.sourceTestId);
      expect(job!.status).toBe('Succeeded');
      expect(job!.attempts).toBe(2);
      expect(await h.prisma.extraction.count()).toBe(1);
    });
  });
});
