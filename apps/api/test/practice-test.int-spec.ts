import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  EXTRACTION_NOT_READY,
  GENERATION_CLOCK_ANOMALY,
  GENERATION_FAILED,
  GENERATION_INPUT_UNUSABLE,
  GENERATION_NOT_REQUESTED,
  GENERATION_SOURCE_GONE,
  GENERATION_UPSTREAM_REJECTED,
  MAX_JOB_ATTEMPTS,
  MAX_PER_REQUEST,
  MAX_TOPIC_LABEL_LENGTH,
  NO_GENERATION_ALLOWANCE,
  NO_USABLE_QUESTIONS,
  PRACTICE_TEST_NOT_FOUND,
  WEIGHTED_TOPIC_UNKNOWN,
  claimTimeoutMs,
  weightedTopicFloor,
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
const {
  ANSWER_FORBIDDEN,
  ANSWER_REQUIRED,
  CHOICES_FORBIDDEN,
  CHOICES_MISMATCHED,
  MAX_CHOICES,
  ONE_CORRECT_CHOICE_REQUIRED,
} = await import('../src/practicetest/practice-test-payload.js');
const { Prisma } = await import('../src/generated/prisma/client.js');

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

  /**
   * Raises the attempt budget for one case.
   *
   * `setup.ts` pins `AI_MAX_ATTEMPTS` to 1 for the whole suite, because most
   * specs want an injected fault to surface at once. Where the retry is the
   * thing under test, a case states its own figure — the same knob `AiService`
   * retries transport faults under, which is the point: every post-hoc retry is
   * bounded by the existing policy and not by a second one.
   */
  function withAttempts(attempts: number): () => void {
    const ai = h.moduleRef.get(AiService);
    const previous = ai.config.maxAttempts;
    ai.config.maxAttempts = attempts;
    return () => {
      ai.config.maxAttempts = previous;
    };
  }

  /**
   * Wraps `AiService.run` so a call selected by `shouldMutate(callNumber)` has
   * its payload passed through `mutate` before being returned to the caller.
   *
   * The fake transport always answers correctly by construction, so an
   * invalid payload has to be injected after it. Captures and restores the
   * *property*, not a bound copy of it — restoring `ai.run.bind(ai)` would
   * reinstate this seam's own wrapper, so sequential uses would accumulate
   * layers instead of unwinding them. Shared by both malformed-payload and
   * underweight-payload injection below, which differ only in what counts as
   * a call to mutate and what the mutation does.
   */
  function wrapAiRunForCalls(
    shouldMutate: (callNumber: number) => boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutate: (payload: any) => void,
  ): () => void {
    const ai = h.moduleRef.get(AiService);
    const previous = ai.run;
    const wrapped = previous.bind(ai);
    let seen = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (req: any): Promise<any> => {
      const result = await wrapped(req);
      seen += 1;
      if (shouldMutate(seen)) mutate(result.payload);
      return result;
    };
    return () => {
      ai.run = previous;
    };
  }

  function requestGeneration(ready: Ready, count: number, weightedTopic?: string) {
    return (
      server()
        .post(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(ready.token))
        // Omitted rather than sent as null when absent, so an unweighted request
        // is byte-for-byte the request Story 4.1 makes.
        .send(weightedTopic === undefined ? { count } : { count, weightedTopic })
    );
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
     * Replaces what the provider answered, for the first `times` calls, with
     * an answer whose MultipleChoice questions flag no correct option at all
     * — the canonical malformed case the epic names, and one the schema
     * happily admits.
     */
    function malformFirst(times: number): () => void {
      return wrapAiRunForCalls(
        (call) => call <= times,
        (payload) => {
          for (const question of payload.questions ?? []) {
            for (const choice of question.choices ?? []) choice.isCorrect = false;
          }
        },
      );
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
        weightedTopic: row.weightedTopic,
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
          weightedTopic: row.weightedTopic,
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
  // --- Story 4.2: topic weighting -------------------------------------

  describe('topic weighting', () => {
    /** The Topics the screen would offer, read from the route that offers them. */
    async function offeredTopics(ready: Ready): Promise<string[]> {
      const response = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/topics`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      return response.body.topics;
    }

    /** Every topic label stored against this account's generated questions. */
    async function landedTopics(): Promise<string[]> {
      const rows = await h.prisma.practiceTestQuestionTopic.findMany({ select: { label: true } });
      return rows.map((row) => row.label);
    }

    it('offers the Extraction own topic labels, de-duplicated and in first-appearance order', async () => {
      const ready = await generatable();
      const topics = await offeredTopics(ready);
      expect(topics.length).toBeGreaterThan(0);
      expect(new Set(topics).size).toBe(topics.length);
      // Raw labels, as the Extraction holds them. Nothing canonicalizes,
      // merges or sorts them (AD-11, Epic 7).
      const extracted = await h.prisma.extractedTopicLabel.findMany({ select: { label: true } });
      for (const topic of topics) {
        expect(extracted.map((row) => row.label)).toContain(topic);
      }
      // The fake extraction payload's only usable questions (the dependent
      // 'Diagram interpretation' question is unusable, per the uninterpretable
      // region it depends on) all carry 'Reading comprehension' — first-
      // appearance order, not sorted, observed with the one label this fixture
      // actually offers for generation.
      expect(topics).toEqual(['Reading comprehension']);
    });

    it('answers 404 for a foreign or unknown upload, never 403', async () => {
      const mine = await generatable();
      const theirs = await generatable();
      const refused = await server()
        .get(`/api/parent/source-tests/${theirs.sourceTestId}/practice-tests/topics`)
        .set('Authorization', bearer(mine.token))
        .expect(404);
      expect(refused.body.message).toBe(SOURCE_TEST_NOT_FOUND);
    });

    it('refuses the topics read when the upload has not finished being read', async () => {
      // The route's other 409: the Source Test is not `Submitted` yet, so
      // there is no Extraction to offer topics from. A distinct sentence from
      // the one below, and the matrix names both.
      const ready = await generatable();
      await h.prisma.sourceTest.update({
        where: { id: ready.sourceTestId },
        data: { status: 'Draft' },
      });
      const refused = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/topics`)
        .set('Authorization', bearer(ready.token))
        .expect(409);
      expect(refused.body.message).toBe(EXTRACTION_NOT_READY);
    });

    it('refuses the topics read when the Extraction holds nothing usable', async () => {
      const ready = await generatable();
      await h.prisma.extractedQuestion.updateMany({ data: { usable: false } });
      const refused = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/topics`)
        .set('Authorization', bearer(ready.token))
        .expect(409);
      expect(refused.body.message).toBe(NO_USABLE_QUESTIONS);
    });

    it('accepts a weighted request and stores the Extraction spelling, not the client', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      // Typed back in a different case and with stray spaces, exactly as a
      // client that round-tripped the label through anything might send it.
      const drifted = `  ${topic!.toUpperCase()} `;
      const response = await requestGeneration(ready, 2, drifted).expect(202);
      expect(response.body.weightedTopic).toBe(topic);
      expect(response.body.requestedCount).toBe(2);

      const stored = await h.prisma.generationJob.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { weightedTopic: true, requestedCount: true },
      });
      expect(stored.weightedTopic).toBe(topic);
      expect(stored.requestedCount).toBe(2);
    });

    it('refuses a topic the Extraction does not carry, enqueueing and charging nothing', async () => {
      const ready = await generatable();
      const refused = await requestGeneration(ready, 1, 'Astrophysics').expect(409);
      expect(refused.body.message).toBe(WEIGHTED_TOPIC_UNKNOWN);
      // The refusal names no topic at all: not the one asked for, and not the
      // ones available (AD-20).
      expect(refused.body.message).not.toContain('Astrophysics');
      expect(await h.prisma.generationJob.count()).toBe(0);
      expect(await generationUsed(ready.parentAccountId)).toBe(0);
    });

    it('prefers the unknown-topic refusal over the spent-allowance one', async () => {
      // Both refusals apply at once. The precedence is deliberate: a topic
      // this upload does not carry is malformed against it however much
      // allowance is left, and answering "no allowance remains" would send a
      // parent to wait for a period rollover that would refuse them again for
      // a reason nobody had stated.
      const ready = await generatable();
      await requestGeneration(ready, 2).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      expect(await generationUsed(ready.parentAccountId)).toBe(2);

      const refused = await requestGeneration(ready, 1, 'Astrophysics').expect(409);
      expect(refused.body.message).toBe(WEIGHTED_TOPIC_UNKNOWN);
      expect(refused.body.message).not.toBe(NO_GENERATION_ALLOWANCE);
      // And still nothing more enqueued or charged for it.
      expect(await h.prisma.generationJob.count()).toBe(1);
      expect(await generationUsed(ready.parentAccountId)).toBe(2);
    });

    it('refuses a blank or oversized topic on shape, before any row is read', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1, '').expect(400);
      // Whitespace-only refuses on shape too, rather than arriving at the
      // service as a topic nobody could carry.
      await requestGeneration(ready, 1, '   ').expect(400);
      await requestGeneration(ready, 1, 'x'.repeat(MAX_TOPIC_LABEL_LENGTH + 1)).expect(400);
      expect(await h.prisma.generationJob.count()).toBe(0);
    });

    it('judges the label itself, not the padding around it', async () => {
      // Trimmed before the length and emptiness rules: a genuine label that
      // arrived with a space on either end is the label, not one character
      // too long and not a different topic.
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      const response = await requestGeneration(ready, 1, `\n  ${topic}\t `).expect(202);
      expect(response.body.weightedTopic).toBe(topic);
    });

    it('trims before the length rule, so padding alone cannot push a genuine label over it', async () => {
      // If the length rule ran before the trim, this padded-but-short label
      // would refuse on shape even though the label itself is nowhere near
      // MAX_TOPIC_LABEL_LENGTH.
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      const padded =
        ' '.repeat(MAX_TOPIC_LABEL_LENGTH) + topic + ' '.repeat(MAX_TOPIC_LABEL_LENGTH);
      expect(padded.length).toBeGreaterThan(MAX_TOPIC_LABEL_LENGTH);
      const response = await requestGeneration(ready, 1, padded).expect(202);
      expect(response.body.weightedTopic).toBe(topic);
    });

    it('clamps and charges a weighted request exactly as an unweighted one', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      // Free tier, two remaining, five asked for: the clamp is the same clamp,
      // and weighting is irrelevant to it.
      const response = await requestGeneration(ready, 5, topic).expect(202);
      expect(response.body.requestedCount).toBe(2);

      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      const job = await h.prisma.generationJob.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(job.status).toBe('Succeeded');
      expect(job.producedCount).toBe(2);
      // One Generation Allowance unit per landed draft. Weighting changes what
      // is generated, never what it costs.
      expect(await generationUsed(ready.parentAccountId)).toBe(2);
      const charged = await h.prisma.practiceTest.findMany({ select: { chargedAt: true } });
      expect(charged).toHaveLength(2);
      expect(charged.every((row) => row.chargedAt !== null)).toBe(true);
    });

    it('refuses a weighted request with nothing left, exactly as an unweighted one', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      await requestGeneration(ready, 2).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const refused = await requestGeneration(ready, 1, topic).expect(409);
      expect(refused.body.message).toBe(NO_GENERATION_ALLOWANCE);
      expect(await generationUsed(ready.parentAccountId)).toBe(2);
    });

    it('lands drafts that meet the floor on the weighted topic', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      await requestGeneration(ready, 1, topic).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const draft = await h.prisma.practiceTest.findFirstOrThrow({
        select: { id: true, questionCount: true },
      });
      const floor = weightedTopicFloor(draft.questionCount);
      const labels = await landedTopics();
      const onTopic = labels.filter((label) => label === topic).length;
      // The rule the post-hoc pass enforces, observed on the rows that landed.
      expect(onTopic).toBeGreaterThanOrEqual(floor);
      expect(floor).toBeGreaterThanOrEqual(1);
    });

    it('names the weighted topic in the prompt, with the minimum count it must meet', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      await requestGeneration(ready, 1, topic).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const calls = h.ai.sent.filter((call) => call.callClass === 'Generation');
      expect(calls).toHaveLength(1);
      // The prompt states the topic and the minimum count, which is the same
      // figure the post-hoc pass counts against.
      const draft = await h.prisma.practiceTest.findFirstOrThrow({
        select: { questionCount: true },
      });
      expect(calls[0]!.prompt).toContain(topic);
      expect(calls[0]!.prompt).toContain(`At least ${weightedTopicFloor(draft.questionCount)} of`);
      // Named exactly once. The fake Extraction's usable questions all carry
      // one topic, so this is the single-topic branch: a sentence saying so,
      // rather than an instruction about "the other topics" trailing an empty
      // list.
      expect(calls[0]!.prompt.split(`- ${topic}`)).toHaveLength(2);
      expect(calls[0]!.prompt).toContain('It is the only topic this test covers');
      expect(calls[0]!.prompt).not.toContain('Give the remaining questions to the other topics');
    });

    it('offers the other topics for the remaining questions, weighted one excluded', async () => {
      // The multi-topic branch. The fake Extraction marks its diagram question
      // unusable, which leaves one topic; restoring it gives a second, so the
      // "spread the rest across the others" instruction is reachable. A count
      // of 3 keeps the floor (2) below the total, so there are genuinely
      // remaining questions to spread across the other topics.
      const ready = await generatable();
      await h.prisma.extractedQuestion.updateMany({ data: { usable: true } });
      const topics = await offeredTopics(ready);
      expect(topics.length).toBeGreaterThan(1);
      const [topic, ...others] = topics;
      expect(weightedTopicFloor(3)).toBeLessThan(3);

      await requestGeneration(ready, 3, topic).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const calls = h.ai.sent.filter((call) => call.callClass === 'Generation');
      const prompt = calls[0]!.prompt;
      expect(prompt).toContain('Give the remaining questions to the other topics below');
      // The weighted topic is named once, as the one to concentrate on — never
      // again in the list of others, which would be the instruction arguing
      // with itself.
      expect(prompt.split(`- ${topic}`)).toHaveLength(2);
      for (const other of others) {
        expect(prompt).toContain(`- ${other}`);
      }
    });

    it('gives every question to the weighted topic when the floor consumes the whole count, even on a multi-topic extraction', async () => {
      // A one-page source keeps the total at 2 questions, where the floor
      // equals the total (floor(2) = 2) even though the extraction carries
      // more than one topic. The prompt must not tell the model to spread
      // zero remaining questions across topics it names.
      const ready = await generatable(1);
      await h.prisma.extractedQuestion.updateMany({ data: { usable: true } });
      const topics = await offeredTopics(ready);
      expect(topics.length).toBeGreaterThan(1);
      const [topic] = topics;
      expect(weightedTopicFloor(2)).toBe(2);

      await requestGeneration(ready, 1, topic).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const calls = h.ai.sent.filter((call) => call.callClass === 'Generation');
      const prompt = calls[0]!.prompt;
      expect(prompt).toContain('give it every question');
      expect(prompt).not.toContain('Give the remaining questions to the other topics');
    });

    it('carries the weighted topic on the progress read a returning parent makes', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      await requestGeneration(ready, 1, topic).expect(202);

      const progress = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/job`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(progress.body.weightedTopic).toBe(topic);
    });

    /**
     * Puts every generated question on a topic that is *not* the weighted one,
     * for each call `underweight` selects by its number — exactly as
     * `malformFirst` injects the canonical malformed payload, over the same
     * seam. Only the topics are touched: the format mix, the prompts and the
     * choices come back untouched, so the *only* rule the payload can fail is
     * the weighted-topic floor, and a rejection therefore names that rule and
     * no other.
     */
    function underweightCalls(underweight: (callNumber: number) => boolean): () => void {
      return wrapAiRunForCalls(underweight, (payload) => {
        for (const question of payload.questions ?? []) {
          // Still a topic, so `TOPIC_REQUIRED` is satisfied — just never the
          // one the request was weighted on.
          question.topics = ['A topic nobody weighted on'];
        }
      });
    }

    it('re-issues the call when a draft comes back under the floor', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      const restoreAttempts = withAttempts(2);
      // The first call comes back under the floor; the second does not.
      const restoreAi = underweightCalls((call) => call === 1);
      try {
        await requestGeneration(ready, 1, topic).expect(202);
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        restoreAi();
        restoreAttempts();
      }

      // A model told to concentrate that spread evenly anyway is the provider's
      // fault, not the parent's: the call is re-issued under the existing
      // budget rather than the request being failed on one bad roll.
      expect(h.ai.sent.filter((call) => call.callClass === 'Generation')).toHaveLength(2);

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('Succeeded');
      expect(job.producedCount).toBe(1);
      expect(job.weightedTopic).toBe(topic);
      expect(await generationUsed(ready.parentAccountId)).toBe(1);

      // And the draft that did land meets the floor it was held to.
      const draft = await h.prisma.practiceTest.findFirstOrThrow({
        select: { questionCount: true },
      });
      const labels = await landedTopics();
      expect(labels.filter((label) => label === topic).length).toBeGreaterThanOrEqual(
        weightedTopicFloor(draft.questionCount),
      );
    });

    it('ends the job per policy once every attempt came back under the floor', async () => {
      const ready = await generatable();
      const [topic] = await offeredTopics(ready);
      const restoreAttempts = withAttempts(2);
      // The first call is left alone, so one draft lands and is charged before
      // the second draft exhausts its budget — which is what makes this the
      // `PartiallyComplete` outcome rather than a plain failure.
      const restoreAi = underweightCalls((call) => call > 1);
      try {
        await requestGeneration(ready, 2, topic).expect(202);
        expect(await h.practiceTestRunner.runOnce()).toBe(true);
      } finally {
        restoreAi();
        restoreAttempts();
      }

      // One good call, then the second draft's whole budget spent below the
      // floor. Bounded by the same figure, and no further.
      expect(h.ai.sent.filter((call) => call.callClass === 'Generation')).toHaveLength(3);

      const job = await h.prisma.generationJob.findFirstOrThrow();
      expect(job.status).toBe('PartiallyComplete');
      expect(job.producedCount).toBe(1);
      // The provider's fault, retryable, and the existing policy constant —
      // never a new sentence, and never the rule that was broken in the
      // model's own words.
      expect(job.failureKind).toBe('UpstreamFault');
      expect(job.failureReason).toBe(GENERATION_FAILED);
      expect(job.retryable).toBe(true);
      // Nothing about the failure names the topic or a fragment of what was
      // written (AD-20).
      expect(job.failureReason).not.toContain(topic);

      // What landed stays landed and stays charged.
      const landed = await h.prisma.practiceTest.findMany({ select: { chargedAt: true } });
      expect(landed).toHaveLength(1);
      expect(landed[0]!.chargedAt).not.toBeNull();
      expect(await generationUsed(ready.parentAccountId)).toBe(1);

      // And the upload is untouched: still submitted, still generatable
      // without a single new photograph.
      const sourceTest = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: ready.sourceTestId },
        select: { status: true },
      });
      expect(sourceTest.status).toBe('Submitted');
      await requestGeneration(ready, 1, topic).expect(202);
    });

    it('leaves an unweighted request exactly as Story 4.1 made it', async () => {
      const ready = await generatable();
      const response = await requestGeneration(ready, 1).expect(202);
      expect(response.body.weightedTopic).toBeNull();
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const calls = h.ai.sent.filter((call) => call.callClass === 'Generation');
      // The unweighted prompt says nothing about concentrating on anything.
      expect(calls[0]!.prompt).toContain(
        'Cover these topics as evenly as the question count allows',
      );
      expect(calls[0]!.prompt).not.toContain('Concentrate this test on one topic');
      const stored = await h.prisma.generationJob.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { weightedTopic: true },
      });
      expect(stored.weightedTopic).toBeNull();
    });
  });

  // --- Draft review ------------------------------------------------------
  //
  // The read half. Every row these cases read was landed by the real runner
  // through the real generator, because "every Question with its correct
  // answer, its distractors and its Topics" is a claim about what generation
  // actually wrote, not about what a hand-seeded row could be made to say.

  describe('the draft reads', () => {
    /** A parent standing on drafts that have actually landed. */
    async function withDrafts(count: number): Promise<Ready> {
      const ready = await generatable();
      await server()
        .post('/api/parent/source-tests/' + ready.sourceTestId + '/practice-tests')
        .set('Authorization', bearer(ready.token))
        .send({ count })
        .expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      return ready;
    }

    function listDrafts(token: string) {
      return server().get('/api/parent/practice-tests/drafts').set('Authorization', bearer(token));
    }

    function readDraft(token: string, id: string) {
      return server().get(`/api/parent/practice-tests/${id}`).set('Authorization', bearer(token));
    }

    it('lists every draft the account holds, newest first, with its place in its job', async () => {
      const ready = await withDrafts(2);
      const response = await listDrafts(ready.token).expect(200);

      expect(response.body).toHaveLength(2);
      for (const row of response.body) {
        expect(row.sourceTestId).toBe(ready.sourceTestId);
        expect(typeof row.studentProfileId).toBe('string');
        // Counted server-side: "draft 2 of 2" is a fact about the job, and the
        // browser holds one draft.
        expect(row.siblingCount).toBe(2);
        expect(row.questionCount).toBeGreaterThan(0);
        expect(typeof row.createdAt).toBe('string');
      }
      // Newest first, with `id` breaking a tie on `createdAt` — asserted as the
      // exact sequence the stored rows put them in. A sorted comparison would
      // pass for any permutation, which is to say it would pass with the
      // `orderBy` deleted.
      const stored = await h.prisma.practiceTest.findMany({
        where: { status: 'Draft' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, ordinal: true },
      });
      expect(response.body.map((row: { id: string }) => row.id)).toEqual(
        stored.map((row) => row.id),
      );
      expect(response.body.map((row: { ordinal: number }) => row.ordinal)).toEqual(
        stored.map((row) => row.ordinal),
      );
      // And both drafts of the job are there, whichever way round they landed.
      expect([...response.body].map((row: { ordinal: number }) => row.ordinal).sort()).toEqual([
        1, 2,
      ]);

      // A list is for finding a draft. Not a word of what one holds is on it.
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('prompt');
      expect(serialized).not.toContain('Practice 1.1');
    });

    it('answers an empty list, not a 404, for an account holding no drafts', async () => {
      const ready = await generatable();
      await listDrafts(ready.token).expect(200).expect([]);
    });

    it('leaves a released or discarded row out of the list entirely', async () => {
      const ready = await withDrafts(2);
      const [first] = await h.prisma.practiceTest.findMany({
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      await h.prisma.practiceTest.update({
        where: { id: first!.id },
        data: { status: 'Released' },
      });

      const response = await listDrafts(ready.token).expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).not.toBe(first!.id);
      // And the sibling count follows: "of 2" was true while both were drafts.
      expect(response.body[0].siblingCount).toBe(1);
    });

    it('reads one draft whole: every Question, in stored order, with its answer and Topics', async () => {
      const ready = await withDrafts(1);
      const stored = await h.prisma.practiceTest.findFirstOrThrow({
        select: { id: true, questionCount: true },
      });

      const response = await readDraft(ready.token, stored.id).expect(200);

      expect(response.body.id).toBe(stored.id);
      expect(response.body.status).toBe('Draft');
      expect(response.body.ordinal).toBe(1);
      expect(response.body.siblingCount).toBe(1);
      expect(response.body.questionCount).toBe(stored.questionCount);
      // Every Question, never a page of them.
      expect(response.body.questions).toHaveLength(stored.questionCount);
      expect(
        response.body.questions.map((question: { ordinal: number }) => question.ordinal),
      ).toEqual(Array.from({ length: stored.questionCount }, (_unused, index) => index + 1));
      for (const question of response.body.questions) {
        expect(Array.isArray(question.prompt)).toBe(true);
        expect(question.prompt.length).toBeGreaterThan(0);
        expect(question.topics.length).toBeGreaterThan(0);
      }
    });

    it('gives a Multiple Choice question its options in order, with exactly one flagged', async () => {
      const ready = await withDrafts(1);
      const stored = await h.prisma.practiceTest.findFirstOrThrow({ select: { id: true } });
      const response = await readDraft(ready.token, stored.id).expect(200);

      const choiceQuestions = response.body.questions.filter(
        (question: { format: string }) => question.format === 'MultipleChoice',
      );
      expect(choiceQuestions.length).toBeGreaterThan(0);
      for (const question of choiceQuestions) {
        // The answer is the flagged option, so the field is null rather than a
        // second, separately-maintained copy of it.
        expect(question.answer).toBeNull();
        expect(question.choices.length).toBeGreaterThanOrEqual(3);
        expect(question.choices.map((choice: { ordinal: number }) => choice.ordinal)).toEqual(
          Array.from({ length: question.choices.length }, (_unused, index) => index + 1),
        );
        expect(
          question.choices.filter((choice: { isCorrect: boolean }) => choice.isCorrect),
        ).toHaveLength(1);
      }
    });

    it('gives a non-Multiple-Choice question its stored answer and no options', async () => {
      // The fake Extraction yields only Multiple Choice usable questions, so
      // the free-text shape is written directly into a real landed draft. What
      // is under test here is the read's mapping of a stored row, not what the
      // generator chose to produce.
      const ready = await withDrafts(1);
      const stored = await h.prisma.practiceTest.findFirstOrThrow({
        select: { id: true, questionCount: true },
      });
      await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: stored.id,
          ordinal: stored.questionCount + 1,
          format: 'FillInTheBlank',
          prompt: [{ kind: 'text', value: 'Half of four is ___.' }],
          answer: [{ kind: 'text', value: 'two' }],
          topics: { create: [{ label: 'Fractions' }] },
        },
      });

      const response = await readDraft(ready.token, stored.id).expect(200);
      const written = response.body.questions.find(
        (question: { format: string }) => question.format === 'FillInTheBlank',
      );
      expect(written.answer).toEqual([{ kind: 'text', value: 'two' }]);
      expect(written.choices).toEqual([]);
      expect(written.topics).toEqual(['Fractions']);
    });

    it('returns a fraction as the structure it was stored as, unchanged', async () => {
      const ready = await withDrafts(1);
      const stored = await h.prisma.practiceTest.findFirstOrThrow({ select: { id: true } });
      const response = await readDraft(ready.token, stored.id).expect(200);

      const fractions = response.body.questions.flatMap(
        (question: { prompt: { kind: string }[] }) =>
          question.prompt.filter((segment) => segment.kind === 'fraction'),
      );
      expect(fractions.length).toBeGreaterThan(0);
      for (const fraction of fractions) {
        // Structure out, exactly as structure in (AD-32). A spoken reading
        // cannot be recovered from the glyph "1/2".
        expect(Object.keys(fraction).sort()).toEqual(['denominator', 'kind', 'numerator', 'whole']);
        expect(Number.isInteger(fraction.numerator)).toBe(true);
        expect(Number.isInteger(fraction.denominator)).toBe(true);
      }
      expect(JSON.stringify(response.body)).not.toMatch(/"[^"]*\d\/\d[^"]*"/u);
    });

    it("refuses another account's draft as though it did not exist", async () => {
      await withDrafts(1);
      const stored = await h.prisma.practiceTest.findFirstOrThrow({ select: { id: true } });

      const stranger = await createSignedInParent(h);
      await setPinFor(h, stranger.cookie, PIN);
      const strangerToken = await elevate(h, stranger.cookie, PIN);

      const refusal = await readDraft(strangerToken, stored.id).expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      // And it never appears in their list, either.
      await listDrafts(strangerToken).expect(200).expect([]);

      // The very same sentence an id that never existed gets — nothing about
      // the answer says which of the two it was (AD-18).
      const unknown = await readDraft(strangerToken, randomUUID()).expect(404);
      expect(unknown.body.message).toBe(refusal.body.message);
    });

    it('refuses a released or discarded id identically to an unknown one', async () => {
      const ready = await withDrafts(2);
      const rows = await h.prisma.practiceTest.findMany({
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      await h.prisma.practiceTest.update({
        where: { id: rows[0]!.id },
        data: { status: 'Released' },
      });
      await h.prisma.practiceTest.update({
        where: { id: rows[1]!.id },
        data: { status: 'Discarded' },
      });

      const released = await readDraft(ready.token, rows[0]!.id).expect(404);
      const discarded = await readDraft(ready.token, rows[1]!.id).expect(404);
      const unknown = await readDraft(ready.token, randomUUID()).expect(404);
      expect(released.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(discarded.body.message).toBe(released.body.message);
      expect(unknown.body.message).toBe(released.body.message);
    });

    it('refuses a malformed id on shape, before any row is read', async () => {
      const ready = await generatable();
      await readDraft(ready.token, 'not-a-uuid').expect(400);
    });

    it('keeps "drafts" a route rather than an id', async () => {
      // Declared above the id route, so the word is never handed to the UUID
      // pipe and refused with a 400 describing nothing the parent did.
      const ready = await generatable();
      await listDrafts(ready.token).expect(200);
    });

    it('refuses both reads without an elevation token, revealing nothing', async () => {
      const ready = await withDrafts(1);
      const stored = await h.prisma.practiceTest.findFirstOrThrow({ select: { id: true } });

      await server().get('/api/parent/practice-tests/drafts').expect(401);
      const refusal = await server().get(`/api/parent/practice-tests/${stored.id}`).expect(401);
      // Nothing about the account, the draft or what it holds is in the answer.
      expect(JSON.stringify(refusal.body)).not.toContain(ready.parentAccountId);
      expect(JSON.stringify(refusal.body)).not.toContain('Practice');
    });

    it('carries no content in the one sentence either read refuses with', async () => {
      // Identifiers and counts only (AD-20): no Question text, no Topic label,
      // no allowance figure, no tier, no model.
      expect(PRACTICE_TEST_NOT_FOUND).not.toMatch(/gpt|Free|Allowance|topic/iu);
    });
  });

  describe('draft editing', () => {
    /** A parent standing on one landed draft, with its id. */
    async function withOneDraft(): Promise<Ready & { practiceTestId: string }> {
      const ready = await generatable();
      await server()
        .post(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(ready.token))
        .send({ count: 1 })
        .expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      // Scoped to this parent's own draft and ordered explicitly: an unscoped
      // `findFirstOrThrow` would be relying on the table being empty and on
      // insertion order, and would pick the wrong row the moment a case ahead
      // of it leaves one behind.
      const stored = await h.prisma.practiceTest.findFirstOrThrow({
        where: { parentAccountId: ready.parentAccountId, sourceTestId: ready.sourceTestId },
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      return { ...ready, practiceTestId: stored.id };
    }

    function editQuestion(token: string, id: string, questionId: string) {
      return server()
        .patch(`/api/parent/practice-tests/${id}/questions/${questionId}`)
        .set('Authorization', bearer(token));
    }

    function deleteQuestion(token: string, id: string, questionId: string) {
      return server()
        .delete(`/api/parent/practice-tests/${id}/questions/${questionId}`)
        .set('Authorization', bearer(token));
    }

    /** The draft's questions as the API states them, in stored order. */
    async function questionsOf(token: string, id: string) {
      const response = await server()
        .get(`/api/parent/practice-tests/${id}`)
        .set('Authorization', bearer(token))
        .expect(200);
      return response.body.questions as {
        id: string;
        ordinal: number;
        format: string;
        prompt: unknown[];
        answer: unknown[] | null;
        choices: { ordinal: number; body: unknown[]; isCorrect: boolean }[];
      }[];
    }

    /** Writes a free-text question onto a landed draft and returns its id. */
    async function addFreeText(practiceTestId: string, ordinal: number): Promise<string> {
      const written = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId,
          ordinal,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'What is half of four?' }],
          answer: [{ kind: 'text', value: 'two' }],
          topics: { create: [{ label: 'Fractions' }] },
        },
        select: { id: true },
      });
      await h.prisma.practiceTest.update({
        where: { id: practiceTestId },
        data: { questionCount: { increment: 1 } },
      });
      return written.id;
    }

    it('stores an edited free-text prompt as the parsed segments, and answers with the draft', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      const questionId = await addFreeText(ready.practiceTestId, before.length + 1);

      const response = await editQuestion(ready.token, ready.practiceTestId, questionId)
        .send({ prompt: 'What is 1/2 of 8?' })
        .expect(200);

      const edited = response.body.questions.find((q: { id: string }) => q.id === questionId);
      // Text, then the fraction as structure, then text — never one "1/2"
      // string, which is the shape AD-32 exists to prevent.
      expect(edited.prompt).toEqual([
        { kind: 'text', value: 'What is ' },
        { kind: 'fraction', whole: null, numerator: 1, denominator: 2 },
        { kind: 'text', value: ' of 8?' },
      ]);
      // Stored exactly as it was answered: no second "original" column, no
      // revision row, no shadow copy.
      const stored = await h.prisma.practiceTestQuestion.findUniqueOrThrow({
        where: { id: questionId },
        select: { prompt: true },
      });
      expect(stored.prompt).toEqual(edited.prompt);
      // And the whole draft comes back, so the screen re-renders from the
      // server's own account of what is stored.
      expect(response.body.id).toBe(ready.practiceTestId);
      expect(response.body.questions).toHaveLength(before.length + 1);
    });

    it('stores a mixed number as one fraction carrying its whole part', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      const questionId = await addFreeText(ready.practiceTestId, before.length + 1);

      const response = await editQuestion(ready.token, ready.practiceTestId, questionId)
        .send({ answer: '2 3/4' })
        .expect(200);

      const edited = response.body.questions.find((q: { id: string }) => q.id === questionId);
      expect(edited.answer).toEqual([{ kind: 'fraction', whole: 2, numerator: 3, denominator: 4 }]);
    });

    it('rewrites option bodies and moves which option is correct, keeping the answer null', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.format === 'MultipleChoice',
      )!;
      expect(question.choices.length).toBeGreaterThanOrEqual(3);

      const response = await editQuestion(ready.token, ready.practiceTestId, question.id)
        .send({
          choices: question.choices.map((choice, index) => ({
            ordinal: choice.ordinal,
            body: index < 2 ? `Rewritten option ${index + 1}` : `Option ${choice.ordinal}`,
          })),
          correctOrdinal: 3,
        })
        .expect(200);

      const edited = response.body.questions.find((q: { id: string }) => q.id === question.id);
      expect(edited.answer).toBeNull();
      expect(edited.choices.map((c: { ordinal: number }) => c.ordinal)).toEqual(
        question.choices.map((choice) => choice.ordinal),
      );
      expect(edited.choices[0].body).toEqual([{ kind: 'text', value: 'Rewritten option 1' }]);
      const flagged = edited.choices.filter((c: { isCorrect: boolean }) => c.isCorrect);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].ordinal).toBe(3);
    });

    it('refuses an edit that would leave a Multiple Choice question without one correct option', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.format === 'MultipleChoice',
      )!;

      // No `correctOrdinal` at all.
      const none = await editQuestion(ready.token, ready.practiceTestId, question.id)
        .send({ prompt: 'A rewritten multiple choice prompt.' })
        .expect(400);
      expect(none.body.message).toBe(ONE_CORRECT_CHOICE_REQUIRED);

      // And one that is not any option's ordinal.
      const foreign = await editQuestion(ready.token, ready.practiceTestId, question.id)
        .send({ correctOrdinal: question.choices.length + 5 })
        .expect(400);
      expect(foreign.body.message).toBe(ONE_CORRECT_CHOICE_REQUIRED);

      // Nothing was written by either refusal.
      const after = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.id === question.id,
      )!;
      expect(after.prompt).toEqual(question.prompt);
      expect(after.choices).toEqual(question.choices);
    });

    it('refuses an answer on a Multiple Choice question, and options on one that has none', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      const multipleChoice = before.find((q) => q.format === 'MultipleChoice')!;
      const freeTextId = await addFreeText(ready.practiceTestId, before.length + 1);

      const answered = await editQuestion(ready.token, ready.practiceTestId, multipleChoice.id)
        .send({ answer: 'Four', correctOrdinal: 1 })
        .expect(400);
      expect(answered.body.message).toBe(ANSWER_FORBIDDEN);

      const optioned = await editQuestion(ready.token, ready.practiceTestId, freeTextId)
        .send({ choices: [{ ordinal: 1, body: 'Four' }] })
        .expect(400);
      expect(optioned.body.message).toBe(CHOICES_FORBIDDEN);
    });

    it('refuses an edit that does not restate exactly the stored options', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.format === 'MultipleChoice',
      )!;

      const partial = await editQuestion(ready.token, ready.practiceTestId, question.id)
        .send({ choices: [{ ordinal: 1, body: 'Only this one' }], correctOrdinal: 1 })
        .expect(400);
      expect(partial.body.message).toBe(CHOICES_MISMATCHED);
    });

    it('refuses a restatement that names one ordinal twice', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.format === 'MultipleChoice',
      )!;
      expect(question.choices).toHaveLength(3);

      // The set comparison alone would pass this: four entries collapse to
      // three distinct ordinals, and the last write of the repeated one would
      // silently win over the first.
      const refusal = await editQuestion(ready.token, ready.practiceTestId, question.id)
        .send({
          choices: [
            { ordinal: 1, body: 'Option one' },
            { ordinal: 2, body: 'Option two' },
            { ordinal: 3, body: 'Option three as C' },
            { ordinal: 3, body: 'Option three as D' },
          ],
          correctOrdinal: 1,
        })
        .expect(400);
      expect(refusal.body.message).toBe(CHOICES_MISMATCHED);

      // And nothing was written: every stored body is exactly what it was.
      const after = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.id === question.id,
      )!;
      expect(after.choices).toEqual(question.choices);
    });

    it('refuses a restatement beyond this module own ceiling on choices', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.format === 'MultipleChoice',
      )!;

      await editQuestion(ready.token, ready.practiceTestId, question.id)
        .send({
          choices: Array.from({ length: MAX_CHOICES + 1 }, (_, index) => ({
            ordinal: index + 1,
            body: `Option ${index + 1}`,
          })),
          correctOrdinal: 1,
        })
        .expect(400);

      // And nothing was written: every stored body is exactly what it was.
      const after = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.id === question.id,
      )!;
      expect(after.choices).toEqual(question.choices);
    });

    it('refuses an empty or whitespace-only field, writing nothing', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      const questionId = await addFreeText(ready.practiceTestId, before.length + 1);

      await editQuestion(ready.token, ready.practiceTestId, questionId)
        .send({ prompt: '   ' })
        .expect(400);
      const after = (await questionsOf(ready.token, ready.practiceTestId)).find(
        (q) => q.id === questionId,
      )!;
      expect(after.prompt).toEqual([{ kind: 'text', value: 'What is half of four?' }]);
    });

    it('refuses a field beyond the module ceilings, whole', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      const questionId = await addFreeText(ready.practiceTestId, before.length + 1);

      await editQuestion(ready.token, ready.practiceTestId, questionId)
        .send({ prompt: 'x'.repeat(5_001) })
        .expect(400);
    });

    it('refuses a free-text question left with no answer at all', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      const questionId = await addFreeText(ready.practiceTestId, before.length + 1);
      // A row whose answer column is somehow already null: the edit must not
      // be the thing that lets it through.
      await h.prisma.practiceTestQuestion.update({
        where: { id: questionId },
        data: { answer: Prisma.DbNull },
      });

      const refusal = await editQuestion(ready.token, ready.practiceTestId, questionId)
        .send({ prompt: 'A rewritten prompt.' })
        .expect(400);
      expect(refusal.body.message).toBe(ANSWER_REQUIRED);
    });

    it('deletes one Question, renumbers the survivors from 1, and rewrites the stored count', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      expect(before.length).toBeGreaterThanOrEqual(2);
      const removed = before[1]!;

      const response = await deleteQuestion(ready.token, ready.practiceTestId, removed.id).expect(
        200,
      );

      expect(response.body.status).toBe('Draft');
      expect(response.body.questions.map((q: { id: string }) => q.id)).toEqual(
        before.filter((q) => q.id !== removed.id).map((q) => q.id),
      );
      // Contiguous from one, in one transaction with the delete — a gap would
      // read as a Question that vanished.
      expect(response.body.questions.map((q: { ordinal: number }) => q.ordinal)).toEqual(
        Array.from({ length: before.length - 1 }, (_unused, index) => index + 1),
      );
      // And the stored column agrees with the list, rather than drifting.
      expect(response.body.questionCount).toBe(before.length - 1);
      const stored = await h.prisma.practiceTest.findUniqueOrThrow({
        where: { id: ready.practiceTestId },
        select: { questionCount: true, status: true },
      });
      expect(stored.questionCount).toBe(before.length - 1);
      expect(stored.status).toBe('Draft');
      const storedOrdinals = await h.prisma.practiceTestQuestion.findMany({
        where: { practiceTestId: ready.practiceTestId },
        orderBy: { ordinal: 'asc' },
        select: { ordinal: true },
      });
      expect(storedOrdinals.map((row) => row.ordinal)).toEqual(
        Array.from({ length: before.length - 1 }, (_unused, index) => index + 1),
      );
    });

    it('discards the Practice Test when the last Question is deleted, refunding nothing', async () => {
      const ready = await withOneDraft();
      const before = await questionsOf(ready.token, ready.practiceTestId);
      const charged = await h.prisma.practiceTest.findUniqueOrThrow({
        where: { id: ready.practiceTestId },
        select: { chargedAt: true },
      });
      const usedBefore = await generationUsed(ready.parentAccountId);

      // Down to one, then the last.
      for (const question of before.slice(0, -1)) {
        await deleteQuestion(ready.token, ready.practiceTestId, question.id).expect(200);
      }
      const last = before[before.length - 1]!;
      const response = await deleteQuestion(ready.token, ready.practiceTestId, last.id).expect(200);

      expect(response.body.status).toBe('Discarded');
      expect(response.body.questions).toEqual([]);
      const stored = await h.prisma.practiceTest.findUniqueOrThrow({
        where: { id: ready.practiceTestId },
        select: { status: true, questionCount: true, chargedAt: true },
      });
      expect(stored.status).toBe('Discarded');
      expect(stored.questionCount).toBe(0);
      // Never cleared and never rewritten: a discard does not refund (AD-14).
      expect(stored.chargedAt).toEqual(charged.chargedAt);
      expect(await generationUsed(ready.parentAccountId)).toBe(usedBefore);

      // And its id now answers the same 404 an unknown id gets.
      const refusal = await server()
        .get(`/api/parent/practice-tests/${ready.practiceTestId}`)
        .set('Authorization', bearer(ready.token))
        .expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    });

    it('refuses both mutations on a released or discarded draft, as though it did not exist', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId))[0]!;
      await h.prisma.practiceTest.update({
        where: { id: ready.practiceTestId },
        data: { status: 'Released' },
      });

      const edit = await editQuestion(ready.token, ready.practiceTestId, question.id)
        .send({ prompt: 'A rewritten prompt.' })
        .expect(404);
      const removal = await deleteQuestion(ready.token, ready.practiceTestId, question.id).expect(
        404,
      );
      const unknown = await server()
        .get(`/api/parent/practice-tests/${randomUUID()}`)
        .set('Authorization', bearer(ready.token))
        .expect(404);
      // The released-state write barrier, and it is the *same sentence* an
      // unknown id gets — nothing about the answer says which it was.
      expect(edit.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(removal.body.message).toBe(unknown.body.message);
      // And the row is untouched by either refusal.
      const stored = await h.prisma.practiceTestQuestion.findUniqueOrThrow({
        where: { id: question.id },
        select: { prompt: true },
      });
      expect(stored.prompt).toEqual(question.prompt);
    });

    it("refuses both mutations on another account's draft", async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId))[0]!;

      const stranger = await createSignedInParent(h);
      await setPinFor(h, stranger.cookie, PIN);
      const strangerToken = await elevate(h, stranger.cookie, PIN);

      const edit = await editQuestion(strangerToken, ready.practiceTestId, question.id)
        .send({ prompt: 'A rewritten prompt.' })
        .expect(404);
      await deleteQuestion(strangerToken, ready.practiceTestId, question.id).expect(404);
      expect(edit.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      // Still there, and still what it was.
      expect(await h.prisma.practiceTestQuestion.count({ where: { id: question.id } })).toBe(1);
    });

    it('refuses a Question that belongs to a different Practice Test', async () => {
      const ready = await generatable();
      await server()
        .post(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(ready.token))
        .send({ count: 2 })
        .expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      const [first, second] = await h.prisma.practiceTest.findMany({
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      const foreign = await h.prisma.practiceTestQuestion.findFirstOrThrow({
        where: { practiceTestId: second!.id },
        select: { id: true },
      });

      // A valid question id and a valid Practice Test id that are not a pair.
      const edit = await editQuestion(ready.token, first!.id, foreign.id)
        .send({ prompt: 'A rewritten prompt.' })
        .expect(404);
      await deleteQuestion(ready.token, first!.id, foreign.id).expect(404);
      expect(edit.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(await h.prisma.practiceTestQuestion.count({ where: { id: foreign.id } })).toBe(1);
    });

    it('refuses a malformed id on shape, before any row is read', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId))[0]!;
      await editQuestion(ready.token, 'not-a-uuid', question.id).send({ prompt: 'x' }).expect(400);
      await editQuestion(ready.token, ready.practiceTestId, 'not-a-uuid')
        .send({ prompt: 'x' })
        .expect(400);
      await deleteQuestion(ready.token, 'not-a-uuid', question.id).expect(400);
      await deleteQuestion(ready.token, ready.practiceTestId, 'not-a-uuid').expect(400);
    });

    it('refuses both mutations without an elevation token', async () => {
      const ready = await withOneDraft();
      const question = (await questionsOf(ready.token, ready.practiceTestId))[0]!;

      await server()
        .patch(`/api/parent/practice-tests/${ready.practiceTestId}/questions/${question.id}`)
        .send({ prompt: 'A rewritten prompt.' })
        .expect(401);
      await server()
        .delete(`/api/parent/practice-tests/${ready.practiceTestId}/questions/${question.id}`)
        .expect(401);
      // Nothing was written by either refusal.
      expect(await h.prisma.practiceTestQuestion.count({ where: { id: question.id } })).toBe(1);
    });

    it('never puts Question content in a refusal either mutation answers with', async () => {
      // Identifiers and fixed sentences only (AD-20).
      for (const sentence of [
        PRACTICE_TEST_NOT_FOUND,
        ONE_CORRECT_CHOICE_REQUIRED,
        ANSWER_FORBIDDEN,
        ANSWER_REQUIRED,
        CHOICES_FORBIDDEN,
        CHOICES_MISMATCHED,
      ]) {
        expect(sentence).not.toMatch(/gpt|Allowance|Free tier|Practice 1\.1|Fractions/iu);
      }
    });
  });
});
