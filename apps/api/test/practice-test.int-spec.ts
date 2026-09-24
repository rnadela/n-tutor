import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  GENERATION_CLOCK_ANOMALY,
  GENERATION_FAILED,
  GENERATION_INPUT_UNUSABLE,
  GENERATION_NOT_REQUESTED,
  GENERATION_SOURCE_GONE,
  GENERATION_UPSTREAM_REJECTED,
  MAX_JOB_ATTEMPTS,
  MAX_PER_REQUEST,
  NO_GENERATION_ALLOWANCE,
  NO_USABLE_QUESTIONS,
  claimTimeoutMs,
  resetPracticeTestRuntime,
} = await import('../src/practicetest/practice-test-policy.js');
const { PracticeTestService } = await import('../src/practicetest/practice-test.service.js');
const { AiService } = await import('../src/ai/ai.service.js');
const { SOURCE_TEST_NOT_FOUND } = await import('../src/sourcetest/source-test-policy.js');
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

describe('Practice Tests: bounded, priced, asynchronous generation', () => {
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

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPracticeTestRuntime();
  });

  interface Ready {
    parentAccountId: string;
    token: string;
    sourceTestId: string;
  }

  /**
   * A parent standing past a completed Extraction: pages photographed,
   * classified, submitted, and the extraction job driven to success.
   *
   * The Extraction is produced by the real pipeline rather than seeded, because
   * "generate from the persisted Extraction and from nothing else" is precisely
   * what these cases are about — a hand-written row would prove that the
   * generator reads *something*, not that it reads what extraction wrote.
   */
  async function generatable(pageCount = 2): Promise<Ready> {
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

    await server()
      .post(`/api/parent/source-tests/${sourceTestId}/submit`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(await h.extractionRunner.runOnce()).toBe(true);
    h.ai.reset();

    return { parentAccountId: parent.parentAccountId, token, sourceTestId };
  }

  /** How many Practice Tests the derived allowance count says were charged. */
  async function generationUsed(parentAccountId: string): Promise<number> {
    const consumption = await h.allowance.consumptionFor(parentAccountId);
    return consumption.allowances.generation.used;
  }

  function requestGeneration(ready: Ready, count: number) {
    return server()
      .post(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests`)
      .set('Authorization', bearer(ready.token))
      .send({ count });
  }

  // --- The bound -------------------------------------------------------

  describe('the allowance read', () => {
    it('states what is left, the per-request ceiling, and no tier or model', async () => {
      const ready = await generatable();
      const response = await server()
        .get('/api/parent/allowance/generation')
        .set('Authorization', bearer(ready.token))
        .expect(200);

      // Free tier: two of two remain, and the ceiling is stated by the API so
      // the web app holds no figure of its own.
      expect(response.body.used).toBe(0);
      expect(response.body.limit).toBe(2);
      expect(response.body.remaining).toBe(2);
      expect(response.body.maxPerRequest).toBe(MAX_PER_REQUEST);
      // Nothing about the tier or the provider reaches a parent surface.
      expect(Object.keys(response.body)).not.toContain('tier');
      expect(JSON.stringify(response.body)).not.toContain('gpt');
    });

    it('states the per-request ceiling as what remains on an unlimited tier', async () => {
      const ready = await generatable();
      await h.parentAccounts.assignTier(h.operatorId, ready.parentAccountId, 'Internal');
      const response = await server()
        .get('/api/parent/allowance/generation')
        .set('Authorization', bearer(ready.token))
        .expect(200);
      // `null` is unlimited and is never a sentinel number.
      expect(response.body.limit).toBeNull();
      expect(response.body.remaining).toBe(MAX_PER_REQUEST);
    });
  });

  describe('the request', () => {
    it('clamps an overreaching count server-side and states the clamped figure', async () => {
      const ready = await generatable();
      // The client asks for nine on a Free tier with two. The UI disabling a
      // radio button is a courtesy; this is the control.
      const response = await requestGeneration(ready, 9).expect(202);
      expect(response.body.requestedCount).toBe(2);
      expect(response.body.producedCount).toBe(0);
      expect(response.body.status).toBe('Queued');

      const stored = await h.prisma.generationJob.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { requestedCount: true },
      });
      expect(stored.requestedCount).toBe(2);
    });

    it('refuses once nothing remains, and charges nothing for the refusal', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 2).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      expect(await generationUsed(ready.parentAccountId)).toBe(2);

      const refused = await requestGeneration(ready, 1).expect(409);
      expect(refused.body.message).toBe(NO_GENERATION_ALLOWANCE);
      expect(await generationUsed(ready.parentAccountId)).toBe(2);
    });

    it('refuses an Extraction with nothing usable in it', async () => {
      const ready = await generatable();
      // Every usable question struck out: the Extraction exists and is intact,
      // and there is still nothing to generate from.
      await h.prisma.extractedQuestion.updateMany({ data: { usable: false } });
      const refused = await requestGeneration(ready, 1).expect(409);
      expect(refused.body.message).toBe(NO_USABLE_QUESTIONS);
      expect(await h.prisma.generationJob.count()).toBe(0);
    });

    it('answers 404 for a Source Test belonging to another account, never 403', async () => {
      const mine = await generatable();
      const theirs = await generatable();
      const response = await server()
        .post(`/api/parent/source-tests/${theirs.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(mine.token))
        .send({ count: 1 })
        .expect(404);
      expect(response.body.message).toBe(SOURCE_TEST_NOT_FOUND);
    });
  });

  // --- The run ---------------------------------------------------------

  describe('a job that runs to completion', () => {
    it('produces one draft per requested test, charging each as it lands', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 2).expect(202);

      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const job = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/job`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(job.body.status).toBe('Succeeded');
      expect(job.body.producedCount).toBe(2);
      expect(job.body.failureReason).toBeNull();

      const drafts = await h.prisma.practiceTest.findMany({
        where: { parentAccountId: ready.parentAccountId },
        orderBy: { ordinal: 'asc' },
      });
      expect(drafts).toHaveLength(2);
      expect(drafts.map((draft) => draft.ordinal)).toEqual([1, 2]);
      for (const draft of drafts) {
        expect(draft.status).toBe('Draft');
        // The durable marker the allowance is counted from. Every landed draft
        // carries one, written in the transaction that inserted it.
        expect(draft.chargedAt).not.toBeNull();
      }
      // Derived, never decremented: the count *is* the charged rows.
      expect(await generationUsed(ready.parentAccountId)).toBe(2);
    });

    it('reads the persisted Extraction with a text call carrying no images', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      await h.practiceTestRunner.runOnce();

      const calls = h.ai.sent.filter((call) => call.callClass === 'Generation');
      expect(calls).toHaveLength(1);
      // Never a photograph: the whole reason regeneration survives image
      // expiry is that this call carries none.
      expect(calls[0]!.modality).toBe('text');
      expect(calls[0]!.imageCount).toBe(0);
    });

    it('bills the Generation call rather than recording it free', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      await h.practiceTestRunner.runOnce();

      const cost = await h.prisma.aiCall.findFirstOrThrow({
        where: { parentAccountId: ready.parentAccountId, callClass: 'Generation' },
      });
      expect(cost.inputTokens).toBeGreaterThan(0);
      expect(cost.costMicros).toBeGreaterThan(0);
    });

    it('matches the source question count, the format mix, and the rich-text rule', async () => {
      const ready = await generatable(2);
      const source = await h.prisma.extractedQuestion.findMany({
        where: { usable: true },
        select: { format: true },
      });
      await requestGeneration(ready, 1).expect(202);
      await h.practiceTestRunner.runOnce();

      const draft = await h.prisma.practiceTest.findFirstOrThrow({
        include: { questions: { include: { choices: true, topics: true } } },
      });
      expect(draft.questionCount).toBe(source.length);
      expect(draft.questions).toHaveLength(source.length);

      // The format mix, counted rather than assumed.
      const produced = new Map<string, number>();
      for (const question of draft.questions) {
        produced.set(question.format, (produced.get(question.format) ?? 0) + 1);
      }
      const expected = new Map<string, number>();
      for (const question of source) {
        expected.set(question.format, (expected.get(question.format) ?? 0) + 1);
      }
      expect([...produced.entries()].sort()).toEqual([...expected.entries()].sort());

      for (const question of draft.questions) {
        expect(question.topics.length).toBeGreaterThanOrEqual(1);
        // Every text field is a segment array, never a string (AD-32).
        expect(Array.isArray(question.prompt)).toBe(true);
        if (question.format === 'MultipleChoice') {
          expect(question.choices.length).toBeGreaterThanOrEqual(3);
          expect(question.choices.filter((choice) => choice.isCorrect)).toHaveLength(1);
          expect(question.answer).toBeNull();
        } else {
          expect(question.choices).toHaveLength(0);
          expect(question.answer).not.toBeNull();
        }
      }
    });
  });

  // --- Failure ---------------------------------------------------------

  describe('partial success', () => {
    it('keeps and charges what landed, and reports the job partially complete', async () => {
      const ready = await generatable();
      await h.parentAccounts.assignTier(h.operatorId, ready.parentAccountId, 'Plus');
      await requestGeneration(ready, 3).expect(202);

      // The first call succeeds; the second fails upstream. The seam is wrapped
      // rather than latched through the environment, because `AI_FAKE_FAILURE`
      // is read per call and the runner makes its calls back to back inside one
      // pass — there is no moment between them for a test to set it.
      const { AiService, AiUpstreamError } = await import('../src/ai/ai.service.js');
      const ai = h.moduleRef.get(AiService);
      const wrapped = ai.run.bind(ai);
      let seen = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ai.run = async (req: any): Promise<any> => {
        seen += 1;
        if (seen === 2) throw new AiUpstreamError('Injected upstream fault.');
        return wrapped(req);
      };
      try {
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        ai.run = wrapped;
      }

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('PartiallyComplete');
      expect(job.producedCount).toBe(1);
      expect(job.failureKind).toBe('UpstreamFault');
      // A policy constant, never the message the exception arrived with.
      expect(job.failureReason).toBe(GENERATION_FAILED);
      expect(job.failureReason).not.toContain('Injected');

      // A landed draft is never rolled back by a later failure of the same job.
      const drafts = await h.prisma.practiceTest.findMany();
      expect(drafts).toHaveLength(1);
      expect(drafts[0]!.chargedAt).not.toBeNull();
      expect(await generationUsed(ready.parentAccountId)).toBe(1);
    });
  });

  describe('total failure', () => {
    it('charges nothing, leaves the Source Test submitted, and needs no new upload', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 2).expect(202);
      h.ai.failNext('transport');
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Failed');
      expect(job.producedCount).toBe(0);
      expect(job.failureReason).toBe(GENERATION_FAILED);
      expect(job.retryable).toBe(true);

      expect(await h.prisma.practiceTest.count()).toBe(0);
      expect(await generationUsed(ready.parentAccountId)).toBe(0);

      // The upload is intact and still committed: retrying costs no re-upload.
      const sourceTest = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: ready.sourceTestId },
        select: { status: true },
      });
      expect(sourceTest.status).toBe('Submitted');
      // And a second request is accepted against the same upload.
      await requestGeneration(ready, 2).expect(202);
    });

    it('records a schema-invalid payload as an upstream fault, retryably', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      h.ai.failNext('schema');
      await h.practiceTestRunner.runOnce();

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Failed');
      expect(job.failureKind).toBe('UpstreamFault');
      expect(job.retryable).toBe(true);
    });

    it('fails terminally, not retryably, when the provider refuses the request', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);

      const { AiService, AiRejectedError } = await import('../src/ai/ai.service.js');
      const ai = h.moduleRef.get(AiService);
      const wrapped = ai.run.bind(ai);
      ai.run = (async () => {
        throw new AiRejectedError('rejected', 401);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      try {
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        ai.run = wrapped;
      }

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Failed');
      expect(job.failureKind).toBe('UpstreamFault');
      expect(job.retryable).toBe(false);
      expect(job.failureReason).toBe(GENERATION_UPSTREAM_REJECTED);
      expect(await h.prisma.practiceTest.count()).toBe(0);
      // Terminal: a refusal is a standing fact, not an outage to retry.
      expect(await h.practiceTestRunner.runOnce()).toBe(false);
    });

    it('fails terminally, not retryably, on a clock or zone anomaly', async () => {
      // A window that never includes "now" is what land()'s own guard cannot
      // tell apart from a broken clock — the realistic trigger is out of this
      // test's reach, so the window itself is what is faked.
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);

      const { AllowanceService } = await import('../src/allowance/allowance.service.js');
      const allowance = h.moduleRef.get(AllowanceService);
      const wrapped = allowance.windowFor.bind(allowance);
      const past = new Date(Date.now() - 60 * 60 * 1000);
      allowance.windowFor = (async () => ({
        start: new Date(past.getTime() - 1000),
        end: past,
        timezone: 'UTC',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;
      try {
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        allowance.windowFor = wrapped;
      }

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Failed');
      expect(job.failureKind).toBe('UpstreamFault');
      expect(job.retryable).toBe(false);
      expect(job.failureReason).toBe(GENERATION_CLOCK_ANOMALY);
      expect(await h.prisma.practiceTest.count()).toBe(0);
      expect(await h.practiceTestRunner.runOnce()).toBe(false);
    });

    it('fails terminally when the Extraction is gone before the job runs', async () => {
      // The realistic race: the upload's Extraction removed (e.g. by Epic 8's
      // image-expiry sweep, or a re-run) between enqueue and claim.
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      await h.prisma.extraction.deleteMany({ where: { sourceTestId: ready.sourceTestId } });
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Failed');
      expect(job.failureKind).toBe('ClientFault');
      expect(job.retryable).toBe(false);
      expect(job.failureReason).toBe(GENERATION_SOURCE_GONE);
      expect(await h.prisma.practiceTest.count()).toBe(0);
      expect(await h.practiceTestRunner.runOnce()).toBe(false);
    });

    it('fails terminally when no usable question is left before the job runs', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      const extraction = await h.prisma.extraction.findUniqueOrThrow({
        where: { sourceTestId: ready.sourceTestId },
        select: { id: true },
      });
      await h.prisma.extractedQuestion.updateMany({
        where: { extractionId: extraction.id },
        data: { usable: false },
      });
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Failed');
      expect(job.failureKind).toBe('ClientFault');
      expect(job.retryable).toBe(false);
      expect(job.failureReason).toBe(GENERATION_INPUT_UNUSABLE);
      expect(await h.prisma.practiceTest.count()).toBe(0);
      expect(await h.practiceTestRunner.runOnce()).toBe(false);
    });
  });

  // --- The progress read -----------------------------------------------

  describe('the progress read', () => {
    it('answers 404 before anything has been requested', async () => {
      const ready = await generatable();
      const response = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/job`)
        .set('Authorization', bearer(ready.token))
        .expect(404);
      expect(response.body.message).toBe(GENERATION_NOT_REQUESTED);
    });

    it('reports the job own state, so leaving and returning loses nothing', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 2).expect(202);

      // Standing on the screen before the worker has taken the job.
      const queued = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/job`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(queued.body.status).toBe('Queued');
      expect(queued.body.requestedCount).toBe(2);
      expect(queued.body.producedCount).toBe(0);

      await h.practiceTestRunner.runOnce();

      // The same read, from nothing the browser was holding.
      const done = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/job`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(done.body.status).toBe('Succeeded');
      expect(done.body.producedCount).toBe(2);
    });

    it('carries no fragment of a generated question', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      await h.practiceTestRunner.runOnce();

      const question = await h.prisma.practiceTestQuestion.findFirstOrThrow();
      const promptText = JSON.stringify(question.prompt);
      const response = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/job`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(JSON.stringify(response.body)).not.toContain(promptText.slice(2, 30));

      // Nor does the cost row.
      const cost = await h.prisma.aiCall.findFirstOrThrow({ where: { callClass: 'Generation' } });
      expect(Object.values(cost).join(' ')).not.toContain('Practice');
    });
  });
  // --- Post-hoc rejection retries the call ------------------------------

  describe('a payload the deterministic pass rejects', () => {
    /**
     * Replaces what the provider answered, for the first `times` calls.
     *
     * The fake transport always answers correctly by construction, so a
     * malformed payload has to be injected after it: this wraps the seam and
     * hands back an answer whose MultipleChoice questions flag no correct
     * option at all — the canonical malformed case the epic names, and one the
     * schema happily admits.
     */
    function malformFirst(times: number): () => void {
      const ai = h.moduleRef.get(AiService);
      const wrapped = ai.run.bind(ai);
      let seen = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ai.run = async (req: any): Promise<any> => {
        const result = await wrapped(req);
        seen += 1;
        if (seen > times) return result;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = result.payload as any;
        for (const question of payload.questions ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const choice of question.choices ?? []) (choice as any).isCorrect = false;
        }
        return result;
      };
      return () => {
        ai.run = wrapped;
      };
    }

    /**
     * Raises the attempt budget for one case.
     *
     * `setup.ts` pins `AI_MAX_ATTEMPTS` to 1 for the whole suite, because most
     * specs want an injected fault to surface at once. The retry is the thing
     * under test here, so this case states its own figure — the same knob
     * `AiService` retries transport faults under, which is the point: the
     * post-hoc retry is bounded by the existing policy and not by a second one.
     */
    function withAttempts(attempts: number): () => void {
      const ai = h.moduleRef.get(AiService);
      const previous = ai.config.maxAttempts;
      ai.config.maxAttempts = attempts;
      return () => {
        ai.config.maxAttempts = previous;
      };
    }

    it('re-issues the generation call rather than failing the parent at once', async () => {
      const ready = await generatable();
      const restoreAttempts = withAttempts(2);
      const restoreAi = malformFirst(1);
      try {
        await requestGeneration(ready, 1).expect(202);
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        restoreAi();
        restoreAttempts();
      }

      // Two calls for one draft: the first was rejected after parsing, and the
      // model was asked again rather than the request being failed on one bad
      // roll of the dice.
      expect(h.ai.sent.filter((call) => call.callClass === 'Generation')).toHaveLength(2);

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Succeeded');
      expect(job.producedCount).toBe(1);
      expect(await generationUsed(ready.parentAccountId)).toBe(1);
    });

    it('fails the job per policy once the attempt budget is spent, charging nothing', async () => {
      const ready = await generatable();
      const restoreAttempts = withAttempts(2);
      const restoreAi = malformFirst(Number.MAX_SAFE_INTEGER);
      try {
        await requestGeneration(ready, 1).expect(202);
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        restoreAi();
        restoreAttempts();
      }

      // Bounded by the same figure, and no further.
      expect(h.ai.sent.filter((call) => call.callClass === 'Generation')).toHaveLength(2);

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Failed');
      expect(job.producedCount).toBe(0);
      // The provider's fault, retryable, and a policy constant — never the
      // rule that was broken in the model's own words.
      expect(job.failureKind).toBe('UpstreamFault');
      expect(job.failureReason).toBe(GENERATION_FAILED);
      expect(job.retryable).toBe(true);
      expect(await h.prisma.practiceTest.count()).toBe(0);
      expect(await generationUsed(ready.parentAccountId)).toBe(0);
    });
  });

  // --- The claim ---------------------------------------------------------

  describe('claiming', () => {
    const service = () => h.moduleRef.get(PracticeTestService);

    /** Puts the one job into a `Running` state whose claim is `ageMs` old. */
    async function heldFor(
      ageMs: number,
      overrides: { attempts?: number; producedCount?: number } = {},
    ): Promise<string> {
      const job = await h.prisma.generationJob.findFirstOrThrow({ select: { id: true } });
      await h.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: 'Running',
          lockedAt: new Date(Date.now() - ageMs),
          attempts: overrides.attempts ?? 1,
          producedCount: overrides.producedCount ?? 0,
        },
      });
      return job.id;
    }

    it('leaves a claim that is still inside the timeout alone', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      await heldFor(Math.floor(claimTimeoutMs() / 2));

      // A worker is still holding it. Taking it here would read — and pay for
      // — the same generation alongside the pass that is already running.
      expect(await service().claimNext()).toBeNull();
    });

    it('reclaims a job whose claim has outlived the timeout, counting the attempt', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      const id = await heldFor(claimTimeoutMs() + 1_000, { attempts: 1, producedCount: 0 });

      const claimed = await service().claimNext();
      // Without this a worker that died mid-run would strand its job forever.
      expect(claimed?.id).toBe(id);
      // Incremented by the claim, not by the run, so a worker that died
      // mid-run still counts its attempt.
      expect(claimed?.attempts).toBe(2);
    });

    it('gives up on a job that has used every attempt, keeping what it produced', async () => {
      const ready = await generatable();
      await h.parentAccounts.assignTier(h.operatorId, ready.parentAccountId, 'Plus');
      await requestGeneration(ready, 3).expect(202);
      const id = await heldFor(claimTimeoutMs() + 1_000, {
        attempts: MAX_JOB_ATTEMPTS,
        producedCount: 2,
      });

      expect(await service().claimNext()).toBeNull();
      const job = await h.prisma.generationJob.findUniqueOrThrow({ where: { id } });
      // Partially complete, not failed: two drafts landed and were charged,
      // and collapsing that into a failure would misreport what was spent.
      expect(job.status).toBe('PartiallyComplete');
      expect(job.producedCount).toBe(2);
      expect(job.retryable).toBe(false);
      expect(job.failureReason).toBe(GENERATION_FAILED);
    });

    it('fails a job that has used every attempt and produced nothing', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      const id = await heldFor(claimTimeoutMs() + 1_000, {
        attempts: MAX_JOB_ATTEMPTS,
        producedCount: 0,
      });

      expect(await service().claimNext()).toBeNull();
      const job = await h.prisma.generationJob.findUniqueOrThrow({ where: { id } });
      expect(job.status).toBe('Failed');
      expect(job.producedCount).toBe(0);
    });
  });

  // --- The fence ---------------------------------------------------------

  describe('a superseded pass', () => {
    const service = () => h.moduleRef.get(PracticeTestService);

    it('makes no provider call at all once its claim has moved on', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 2).expect(202);
      const row = await h.prisma.generationJob.findFirstOrThrow();
      await h.prisma.generationJob.update({
        where: { id: row.id },
        data: { status: 'Running', lockedAt: new Date(), attempts: 7 },
      });
      h.ai.reset();

      // A pass holding attempt 3 against a row that has moved to 7. Every call
      // it made would be money spent on a draft guaranteed to roll back.
      await service().runJob({
        id: row.id,
        parentAccountId: row.parentAccountId,
        sourceTestId: row.sourceTestId,
        studentProfileId: row.studentProfileId,
        requestedCount: 2,
        producedCount: 0,
        attempts: 3,
      });

      expect(h.ai.sent.filter((call) => call.callClass === 'Generation')).toHaveLength(0);
      expect(await h.prisma.practiceTest.count()).toBe(0);
      // And the newer claim's own state stands, untouched.
      const after = await h.prisma.generationJob.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe('Running');
      expect(after.attempts).toBe(7);
    });

    it('lands nothing and charges nothing when the claim moves on mid-draft', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      const row = await h.prisma.generationJob.findFirstOrThrow();
      await h.prisma.generationJob.update({
        where: { id: row.id },
        data: { status: 'Running', lockedAt: new Date(), attempts: 1 },
      });

      // The claim is reclaimed by "another worker" after the call returns and
      // before the draft lands — the window the fence inside the landing
      // transaction exists for.
      const ai = h.moduleRef.get(AiService);
      const wrapped = ai.run.bind(ai);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ai.run = async (req: any): Promise<any> => {
        const result = await wrapped(req);
        await h.prisma.generationJob.update({
          where: { id: row.id },
          data: { attempts: 2, lockedAt: new Date() },
        });
        return result;
      };
      try {
        await service().runJob({
          id: row.id,
          parentAccountId: row.parentAccountId,
          sourceTestId: row.sourceTestId,
          studentProfileId: row.studentProfileId,
          requestedCount: 1,
          producedCount: 0,
          attempts: 1,
        });
      } finally {
        ai.run = wrapped;
      }

      // The draft and its `chargedAt` rolled back together.
      expect(await h.prisma.practiceTest.count()).toBe(0);
      expect(await generationUsed(ready.parentAccountId)).toBe(0);
      // And the newer pass's verdict stands: nothing terminal was written over
      // it by the pass that was superseded.
      const after = await h.prisma.generationJob.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe('Running');
      expect(after.attempts).toBe(2);
      expect(after.producedCount).toBe(0);
      expect(after.failureReason).toBeNull();
    });
  });

  // --- Resuming ----------------------------------------------------------

  describe('a reclaimed job', () => {
    it('resumes from what landed rather than generating the whole request again', async () => {
      const ready = await generatable();
      await h.parentAccounts.assignTier(h.operatorId, ready.parentAccountId, 'Plus');
      await requestGeneration(ready, 2).expect(202);

      // The first pass lands one draft, then the provider goes away.
      const ai = h.moduleRef.get(AiService);
      const wrapped = ai.run.bind(ai);
      let seen = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ai.run = async (req: any): Promise<any> => {
        seen += 1;
        if (seen === 2) {
          const { AiUpstreamError } = await import('../src/ai/ai.service.js');
          throw new AiUpstreamError('Injected upstream fault.');
        }
        return wrapped(req);
      };
      try {
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        ai.run = wrapped;
      }
      expect(await h.prisma.practiceTest.count()).toBe(1);

      // The row is left as a stale claim, exactly as a dead worker would leave
      // it, and the next pass takes it.
      const row = await h.prisma.generationJob.findFirstOrThrow();
      await h.prisma.generationJob.update({
        where: { id: row.id },
        data: {
          status: 'Running',
          lockedAt: new Date(Date.now() - claimTimeoutMs() - 1_000),
          completedAt: null,
          failureKind: null,
          failureReason: null,
        },
      });
      h.ai.reset();
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      // One more call, not two: the request is finished, never restarted.
      expect(h.ai.sent.filter((call) => call.callClass === 'Generation')).toHaveLength(1);
      const job = await h.prisma.generationJob.findUniqueOrThrow({ where: { id: row.id } });
      expect(job.status).toBe('Succeeded');
      expect(job.producedCount).toBe(2);
      expect(await generationUsed(ready.parentAccountId)).toBe(2);

      // And the resumed draft differs from the one the earlier pass landed:
      // the must-differ list was read back from the rows, not from a variable
      // the dead worker took with it.
      const prompts = await h.prisma.practiceTestQuestion.findMany({ select: { prompt: true } });
      const rendered = prompts.map((question) => JSON.stringify(question.prompt));
      expect(new Set(rendered).size).toBe(rendered.length);
    });
  });
});
