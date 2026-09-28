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
  MAX_TIMER_MINUTES,
  MAX_TOPIC_LABEL_LENGTH,
  MIN_TIMER_MINUTES,
  NO_GENERATION_ALLOWANCE,
  NO_USABLE_QUESTIONS,
  ATTEMPT_ALREADY_SUBMITTED,
  ATTEMPT_NOT_RETAKEABLE,
  MAX_ANSWERS_PER_SUBMISSION,
  MAX_ANSWER_LENGTH,
  MAX_QUESTION_ID_LENGTH,
  PRACTICE_TEST_NOT_FOUND,
  WEIGHTED_TOPIC_UNKNOWN,
  claimTimeoutMs,
  suggestedTimerMinutes,
  weightedTopicFloor,
  resetPracticeTestRuntime,
} = await import('../src/practicetest/practice-test-policy.js');
const { PracticeTestService } = await import('../src/practicetest/practice-test.service.js');
const { GradingService } = await import('../src/grading/grading.service.js');
const { AiService } = await import('../src/ai/ai.service.js');
const { SOURCE_TEST_NOT_FOUND } = await import('../src/sourcetest/source-test-policy.js');
const {
  bearer,
  checkLegibility,
  bindDevice,
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
    /**
     * The child every draft of this account is made for.
     *
     * Carried on the fixture since Story 4.5: the student-scoped read is scoped
     * by the *bound profile*, not by the account, so a case that releases a test
     * has to be able to bind the device to the profile it was released for — and
     * to a sibling, to prove the scoping is real.
     */
    studentProfileId: string;
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

    // The submit gate: the batch check has to have run over this page set.
    await checkLegibility(h, token, sourceTestId);
    await server()
      .post(`/api/parent/source-tests/${sourceTestId}/submit`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(await h.extractionRunner.runOnce()).toBe(true);
    h.ai.reset();

    return {
      parentAccountId: parent.parentAccountId,
      token,
      sourceTestId,
      studentProfileId: profile.id,
    };
  }

  /**
   * A released Practice Test belonging to **an existing profile on an existing
   * account**, whole pipeline and all.
   *
   * `generatable` opens a parent account of its own, which is exactly what a case
   * about two children under one parent cannot use. This runs the same flow with the
   * profile and elevation token it is handed, so both children's tests sit on one
   * `parentAccountId` and an account-scoped read cannot be mistaken for a
   * profile-scoped one.
   */
  async function releasedFor(
    token: string,
    studentProfileId: string,
    gradeLevelId: string,
    pageCount = 2,
  ): Promise<string> {
    const draft = await server()
      .post('/api/parent/source-tests')
      .set('Authorization', bearer(token))
      .send({ studentProfileId })
      .expect(200);
    const sourceTestId: string = draft.body.id;

    const subject = await createSubject(h, { gradeLevelId });
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
    expect(await h.extractionRunner.runOnce()).toBe(true);
    h.ai.reset();

    await server()
      .post(`/api/parent/source-tests/${sourceTestId}/practice-tests`)
      .set('Authorization', bearer(token))
      .send({ count: 1 })
      .expect(202);
    expect(await h.practiceTestRunner.runOnce()).toBe(true);

    const stored = await h.prisma.practiceTest.findMany({
      where: { sourceTestId },
      select: { id: true },
    });
    expect(stored).toHaveLength(1);
    const practiceTestId = stored[0]!.id;
    await server()
      .post(`/api/parent/practice-tests/${practiceTestId}/release`)
      .set('Authorization', bearer(token))
      .expect(200);
    return practiceTestId;
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

  // --- The drill-down's weighted target ---------------------------------

  describe('resolving a weighted target from evidence', () => {
    const service = () => h.moduleRef.get(PracticeTestService);

    /** Every generated Question of this account's drafts, newest paper first. */
    async function generatedQuestionIds(): Promise<string[]> {
      const rows = await h.prisma.practiceTestQuestion.findMany({
        orderBy: [{ practiceTest: { createdAt: 'desc' } }, { ordinal: 'asc' }],
        select: { id: true },
      });
      return rows.map((row) => row.id);
    }

    /** One raw label the generated Questions actually carry. */
    async function aLandedLabel(): Promise<string> {
      const row = await h.prisma.practiceTestQuestionTopic.findFirstOrThrow({
        select: { label: true },
      });
      return row.label;
    }

    it('resolves the upload behind the evidence, in the Extraction’s own spelling', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const target = await service().weightedTargetFor(
        ready.parentAccountId,
        await generatedQuestionIds(),
        // The canonical name a drill-down would hold, drifted in case and spacing
        // exactly as canonicalization may leave it.
        `  ${(await aLandedLabel()).toUpperCase()} `,
      );
      expect(target).not.toBeNull();
      expect(target!.sourceTestId).toBe(ready.sourceTestId);
      // The label is one the Extraction carries, which is the only thing `request()`
      // will accept — never the spelling it was asked with.
      const carried = await server()
        .get(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests/topics`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(carried.body.topics).toContain(target!.weightedTopic);
      expect(target!.subjectName).toEqual(expect.any(String));
      // The upload's own commit instant, and never absent for a Submitted one: it is
      // how the screen names which paper the practice would come from, and a null here
      // would silently drop the date from that sentence.
      expect(target!.submittedAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(target!.submittedAt!))).toBe(false);
    });

    it('produces a weighted job when its label is posted back, and never WEIGHTED_TOPIC_UNKNOWN', async () => {
      // The whole point of resolving server-side: the request cannot refuse the label
      // the drill-down was handed.
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      const target = await service().weightedTargetFor(
        ready.parentAccountId,
        await generatedQuestionIds(),
        await aLandedLabel(),
      );
      const response = await server()
        .post(`/api/parent/source-tests/${target!.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(ready.token))
        .send({ count: 1, weightedTopic: target!.weightedTopic })
        .expect(202);
      expect(response.body.weightedTopic).toBe(target!.weightedTopic);

      const stored = await h.prisma.generationJob.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { weightedTopic: true, requestedCount: true },
      });
      expect(stored.weightedTopic).toBe(target!.weightedTopic);
      expect(stored.requestedCount).toBe(1);
    });

    it('answers null when no Extraction behind the evidence carries the label', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      // The Extraction is intact and mentions something else entirely, and the
      // generated Questions' own raw labels no longer match it either.
      await h.prisma.extractedTopicLabel.updateMany({ data: { label: 'astrophysics' } });
      await h.prisma.practiceTestQuestionTopic.updateMany({ data: { label: 'palaeography' } });

      await expect(
        service().weightedTargetFor(
          ready.parentAccountId,
          await generatedQuestionIds(),
          'long division',
        ),
      ).resolves.toBeNull();
    });

    it('answers null over no Questions at all, without reading an Extraction', async () => {
      const ready = await generatable();
      await expect(
        service().weightedTargetFor(ready.parentAccountId, [], 'fractions'),
      ).resolves.toBeNull();
    });

    it('answers null for another account’s Questions, never another account’s upload', async () => {
      const mine = await generatable();
      const theirs = await generatable();
      await requestGeneration(theirs, 1).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);

      await expect(
        service().weightedTargetFor(
          mine.parentAccountId,
          await generatedQuestionIds(),
          await aLandedLabel(),
        ),
      ).resolves.toBeNull();
    });

    it('picks the newest upload carrying the label when the evidence spans two', async () => {
      const ready = await generatable();
      await requestGeneration(ready, 1).expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      const label = await aLandedLabel();
      const older = await generatedQuestionIds();

      // A second, later upload of the same account carrying the same label. Written
      // straight to the tables: this case is about which Source Test is chosen, and
      // driving a second upload-extract-generate would spend provider calls to stage
      // an ordering.
      const first = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: ready.sourceTestId },
        select: { subjectId: true, gradeLevelId: true },
      });
      const newerSource = await h.prisma.sourceTest.create({
        data: {
          parentAccountId: ready.parentAccountId,
          studentProfileId: ready.studentProfileId,
          status: 'Submitted',
          expiresAt: new Date(Date.now() + 86_400_000),
          submittedAt: new Date(),
          subjectId: first.subjectId,
          gradeLevelId: first.gradeLevelId,
        },
        select: { id: true },
      });
      const extraction = await h.prisma.extraction.create({
        data: { sourceTestId: newerSource.id, pageCount: 1 },
        select: { id: true },
      });
      await h.prisma.extractedQuestion.create({
        data: {
          extractionId: extraction.id,
          ordinal: 1,
          pageOrdinal: 1,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'A later source question' }],
          confidence: 'High',
          dependsOnUninterpretable: false,
          usable: true,
          topics: { create: [{ label, confidence: 'High' as const }] },
        },
      });
      const job = await h.prisma.generationJob.create({
        data: {
          parentAccountId: ready.parentAccountId,
          sourceTestId: newerSource.id,
          studentProfileId: ready.studentProfileId,
          requestedCount: 1,
          status: 'Succeeded',
        },
        select: { id: true },
      });
      const newerTest = await h.prisma.practiceTest.create({
        data: {
          parentAccountId: ready.parentAccountId,
          sourceTestId: newerSource.id,
          studentProfileId: ready.studentProfileId,
          generationJobId: job.id,
          status: 'Released',
          ordinal: 1,
          questionCount: 1,
          chargedAt: new Date(),
          // A whole day later, so "newest" is not left to two rows sharing a
          // millisecond.
          createdAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      });
      const newerQuestion = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: newerTest.id,
          ordinal: 1,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'What is a third of 9?' }],
          answer: [{ kind: 'text', value: '3' }],
          topics: { create: [{ label }] },
        },
        select: { id: true },
      });

      // Evidence spanning both uploads, handed over oldest-first so the ordering
      // cannot be the argument order.
      const target = await service().weightedTargetFor(
        ready.parentAccountId,
        [...older, newerQuestion.id],
        label,
      );
      expect(target!.sourceTestId).toBe(newerSource.id);
      expect(target!.weightedTopic).toBe(label);
    });
  });

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

  // --- Release or discard --------------------------------------------------
  //
  // The two terminal transitions, and the first student-scoped read of a
  // Practice Test. Every row here was landed by the real runner through the real
  // generator, because "the practice test is visible to that child" is a claim
  // about a row generation actually wrote.

  describe('timer configuration', () => {
    /** A parent standing on one landed draft, with its id. */
    async function withTimerDraft(): Promise<Ready & { draftId: string }> {
      const ready = await generatable();
      await server()
        .post(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(ready.token))
        .send({ count: 1 })
        .expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      const stored = await h.prisma.practiceTest.findMany({
        where: { parentAccountId: ready.parentAccountId, sourceTestId: ready.sourceTestId },
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      expect(stored).toHaveLength(1);
      return { ...ready, draftId: stored[0]!.id };
    }

    function setTimer(token: string, id: string, body: unknown) {
      return server()
        .put(`/api/parent/practice-tests/${id}/timer`)
        .set('Authorization', bearer(token))
        .send(body as object);
    }

    function readDraft(token: string, id: string) {
      return server().get(`/api/parent/practice-tests/${id}`).set('Authorization', bearer(token));
    }

    /** The whole row the barrier has to leave alone. */
    function storedRow(id: string) {
      return h.prisma.practiceTest.findUniqueOrThrow({
        where: { id },
        select: { status: true, chargedAt: true, questionCount: true, timerMinutes: true },
      });
    }

    it('reads a freshly generated draft as untimed, with the suggestion beside it', async () => {
      const ready = await withTimerDraft();
      const before = await storedRow(ready.draftId);
      // Nothing configured it, so nothing is stored — the suggestion is a
      // suggestion and generation writes no timer.
      expect(before.timerMinutes).toBeNull();

      const response = await readDraft(ready.token, ready.draftId).expect(200);
      expect(response.body.timerMinutes).toBeNull();
      // The server's own figure, from the stored count: `questionCount + 5`,
      // clamped. Asserted against the formula's one definition rather than a
      // second copy of it here.
      expect(response.body.suggestedTimerMinutes).toBe(suggestedTimerMinutes(before.questionCount));
      expect(response.body.suggestedTimerMinutes).toBe(before.questionCount + 5);
      expect(response.body.suggestedTimerMinutes).toBeLessThanOrEqual(MAX_TIMER_MINUTES);
      expect(response.body.suggestedTimerMinutes).toBeGreaterThanOrEqual(MIN_TIMER_MINUTES);
    });

    it('reproduces the PRD worked example, and never suggests above the ceiling', async () => {
      // 15 questions, 20 minutes (§UJ-2) — the example the formula was chosen to
      // reproduce rather than a second figure beside it.
      expect(suggestedTimerMinutes(15)).toBe(20);
      expect(suggestedTimerMinutes(MAX_TIMER_MINUTES)).toBe(MAX_TIMER_MINUTES);
      expect(suggestedTimerMinutes(10_000)).toBe(MAX_TIMER_MINUTES);
      expect(suggestedTimerMinutes(0)).toBe(5);
    });

    it('stores a duration, answers with the whole view, and moves neither status nor charge', async () => {
      const ready = await withTimerDraft();
      const before = await storedRow(ready.draftId);
      const usedBefore = await generationUsed(ready.parentAccountId);

      const response = await setTimer(ready.token, ready.draftId, { minutes: 20 }).expect(200);

      // The whole draft view, exactly as every other mutation in this module
      // answers with — the screen re-renders from this rather than from what it
      // hoped it wrote.
      expect(response.body.id).toBe(ready.draftId);
      expect(response.body.timerMinutes).toBe(20);
      expect(response.body.status).toBe('Draft');
      expect(response.body.questions.length).toBe(before.questionCount);

      const after = await storedRow(ready.draftId);
      expect(after.timerMinutes).toBe(20);
      // Setting a timer is not a transition and not a charge (AD-14).
      expect(after.status).toBe('Draft');
      expect(after.chargedAt).toEqual(before.chargedAt);
      expect(await generationUsed(ready.parentAccountId)).toBe(usedBefore);
      // And the ordinary read agrees with the mutation's own answer.
      const reread = await readDraft(ready.token, ready.draftId).expect(200);
      expect(reread.body.timerMinutes).toBe(20);
    });

    it('turns the timer back off, and off is null rather than a flag', async () => {
      const ready = await withTimerDraft();
      await setTimer(ready.token, ready.draftId, { minutes: 20 }).expect(200);

      const off = await setTimer(ready.token, ready.draftId, { minutes: null }).expect(200);
      expect(off.body.timerMinutes).toBeNull();
      expect((await storedRow(ready.draftId)).timerMinutes).toBeNull();
      // The suggestion is still offered; nothing about turning it off stores one.
      expect(off.body.suggestedTimerMinutes).toBeGreaterThanOrEqual(MIN_TIMER_MINUTES);
    });

    it('lets the figure be changed any number of times while it is a draft', async () => {
      const ready = await withTimerDraft();
      for (const minutes of [10, 45, 1, MAX_TIMER_MINUTES]) {
        const response = await setTimer(ready.token, ready.draftId, { minutes }).expect(200);
        expect(response.body.timerMinutes).toBe(minutes);
      }
      expect((await storedRow(ready.draftId)).timerMinutes).toBe(MAX_TIMER_MINUTES);
    });

    it('refuses a figure below the floor, above the ceiling, or not a whole number', async () => {
      const ready = await withTimerDraft();
      for (const minutes of [
        MIN_TIMER_MINUTES - 1,
        -5,
        MAX_TIMER_MINUTES + 1,
        12.5,
        'twenty',
        true,
      ]) {
        await setTimer(ready.token, ready.draftId, { minutes }).expect(400);
      }
      // Refused on shape, before a row was read: nothing was written by any of
      // them.
      expect((await storedRow(ready.draftId)).timerMinutes).toBeNull();
    });

    it('refuses a numeric string: the app does no implicit coercion on the way in', async () => {
      const ready = await withTimerDraft();
      // Pinned rather than assumed. The global pipe is
      // `{ whitelist, forbidNonWhitelisted, transform }` with no
      // `enableImplicitConversion`, and this DTO asks for no `@Type(() => Number)`
      // — so `'20'` reaches `@IsInt()` as a string and is refused. Recorded here
      // because a later pipe option that silently coerced it would change what
      // this route accepts without changing a line of this module.
      await setTimer(ready.token, ready.draftId, { minutes: '20' }).expect(400);
      expect((await storedRow(ready.draftId)).timerMinutes).toBeNull();
    });

    it('refuses a body carrying a second duration-ish field beside the minutes', async () => {
      const ready = await withTimerDraft();
      // There is **one** nullable column and no `enabled` flag, so there is no
      // second field for a flag to arrive in: `forbidNonWhitelisted` refuses the
      // whole request rather than storing the duration and dropping the flag,
      // which is what would let a caller believe the two were both honoured.
      for (const body of [
        { minutes: 20, timerEnabled: true },
        { minutes: 20, timerSeconds: 1200 },
        { minutes: null, timerEnabled: false },
      ]) {
        await setTimer(ready.token, ready.draftId, body).expect(400);
      }
      expect((await storedRow(ready.draftId)).timerMinutes).toBeNull();
    });

    it('refuses an absent field — null is explicit, and silence is not an instruction', async () => {
      const ready = await withTimerDraft();
      await setTimer(ready.token, ready.draftId, { minutes: 20 }).expect(200);

      // `{}` is a request that said nothing. A mutation that read it as "off" is
      // how a timer disappears without anybody asking.
      await setTimer(ready.token, ready.draftId, {}).expect(400);
      expect((await storedRow(ready.draftId)).timerMinutes).toBe(20);
    });

    it('refuses the write once the practice test has been released, and writes nothing', async () => {
      const ready = await withTimerDraft();
      await setTimer(ready.token, ready.draftId, { minutes: 20 }).expect(200);
      await server()
        .post(`/api/parent/practice-tests/${ready.draftId}/release`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      const before = await storedRow(ready.draftId);

      const refused = await setTimer(ready.token, ready.draftId, { minutes: 90 }).expect(404);
      // The same sentence an unknown id gets: `Draft` is in the `where` of the
      // statement that mutates, so "never after release" is a property of the
      // statement (AD-18).
      expect(refused.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      const unknown = await setTimer(ready.token, randomUUID(), { minutes: 90 }).expect(404);
      expect(unknown.body.message).toBe(refused.body.message);
      // A timer changed after release would retroactively change how expiry
      // graded past Attempts. Nothing moved — not the figure, not the status,
      // not the charge.
      const after = await storedRow(ready.draftId);
      expect(after.timerMinutes).toBe(before.timerMinutes);
      expect(after.status).toBe('Released');
      expect(after.chargedAt).toEqual(before.chargedAt);
      // And turning it off after release is refused exactly the same way.
      await setTimer(ready.token, ready.draftId, { minutes: null }).expect(404);
      expect((await storedRow(ready.draftId)).timerMinutes).toBe(before.timerMinutes);
    });

    it('refuses the write once the practice test has been discarded, and writes nothing', async () => {
      const ready = await withTimerDraft();
      await server()
        .post(`/api/parent/practice-tests/${ready.draftId}/discard`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      const before = await storedRow(ready.draftId);

      const refused = await setTimer(ready.token, ready.draftId, { minutes: 30 }).expect(404);
      expect(refused.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      const after = await storedRow(ready.draftId);
      expect(after.timerMinutes).toBeNull();
      expect(after.status).toBe('Discarded');
      expect(after.chargedAt).toEqual(before.chargedAt);
    });

    it('refuses another account’s draft as though it did not exist', async () => {
      const mine = await withTimerDraft();
      const theirs = await withTimerDraft();

      const refused = await setTimer(mine.token, theirs.draftId, { minutes: 20 }).expect(404);
      expect(refused.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      // Never 403, and nothing written: an id a parent may not write to is an id
      // that does not exist (AD-18).
      expect((await storedRow(theirs.draftId)).timerMinutes).toBeNull();
    });

    it('refuses a malformed id on shape, and an unelevated call at the guard', async () => {
      const ready = await withTimerDraft();
      await setTimer(ready.token, 'not-a-uuid', { minutes: 20 }).expect(400);
      await server()
        .put(`/api/parent/practice-tests/${ready.draftId}/timer`)
        .send({ minutes: 20 })
        .expect(401);
      expect((await storedRow(ready.draftId)).timerMinutes).toBeNull();
    });
  });

  describe('release and discard', () => {
    /** A parent standing on `count` landed drafts, with their ids in stored order. */
    async function withLandedDrafts(count: number): Promise<Ready & { draftIds: string[] }> {
      const ready = await generatable();
      await server()
        .post(`/api/parent/source-tests/${ready.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(ready.token))
        .send({ count })
        .expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      // Scoped to this parent's own source test and ordered explicitly: an
      // unscoped read would be relying on the table being empty and on insertion
      // order, and would pick the wrong row the moment a case ahead of it leaves
      // one behind.
      const stored = await h.prisma.practiceTest.findMany({
        where: { parentAccountId: ready.parentAccountId, sourceTestId: ready.sourceTestId },
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      expect(stored).toHaveLength(count);
      return { ...ready, draftIds: stored.map((row) => row.id) };
    }

    function release(token: string, id: string) {
      return server()
        .post(`/api/parent/practice-tests/${id}/release`)
        .set('Authorization', bearer(token));
    }

    function discard(token: string, id: string) {
      return server()
        .post(`/api/parent/practice-tests/${id}/discard`)
        .set('Authorization', bearer(token));
    }

    function readDraft(token: string, id: string) {
      return server().get(`/api/parent/practice-tests/${id}`).set('Authorization', bearer(token));
    }

    /** The student-scoped read, carrying a binding cookie and no bearer. */
    function readReleased(cookie: string) {
      return server().get('/api/student/practice-tests').set('Cookie', cookie);
    }

    /** One released test, whole, as the child's Take Test screen reads it. */
    function readReleasedTest(cookie: string, id: string) {
      return server().get(`/api/student/practice-tests/${id}`).set('Cookie', cookie);
    }

    /** One draft's stored state and charge marker, read straight from the row. */
    function storedRow(id: string) {
      return h.prisma.practiceTest.findUniqueOrThrow({
        where: { id },
        select: { status: true, chargedAt: true, questionCount: true },
      });
    }

    it('releases a draft, answers with the whole view, and leaves the charge alone', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      const before = await storedRow(id);
      const usedBefore = await generationUsed(ready.parentAccountId);

      const response = await release(ready.token, id).expect(200);

      // The screen reads the status rather than inferring success from a 204.
      expect(response.body.id).toBe(id);
      expect(response.body.status).toBe('Released');
      expect(response.body.questions.length).toBe(before.questionCount);
      const after = await storedRow(id);
      expect(after.status).toBe('Released');
      // Neither transition refunds, and neither writes an allowance figure: the
      // derived count counts rows that have ever reached draft (AD-14).
      expect(after.chargedAt).toEqual(before.chargedAt);
      expect(await generationUsed(ready.parentAccountId)).toBe(usedBefore);
    });

    it('refuses a second release with the same sentence an unknown id gets', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      await release(ready.token, id).expect(200);

      const again = await release(ready.token, id).expect(404);
      const unknown = await release(ready.token, randomUUID()).expect(404);
      // That identical refusal *is* the irreversibility: `Draft` is in the
      // `where` of the statement that mutates, so not being a draft any more is
      // indistinguishable from never having been this account's (AD-18).
      expect(again.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(unknown.body.message).toBe(again.body.message);
      // And nothing was written by the refusal.
      expect((await storedRow(id)).status).toBe('Released');
    });

    it('discards a draft, answers with the new status, and gives nothing back', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      const before = await storedRow(id);
      const usedBefore = await generationUsed(ready.parentAccountId);

      const response = await discard(ready.token, id).expect(200);

      expect(response.body.status).toBe('Discarded');
      const after = await storedRow(id);
      expect(after.status).toBe('Discarded');
      expect(after.chargedAt).toEqual(before.chargedAt);
      expect(await generationUsed(ready.parentAccountId)).toBe(usedBefore);
    });

    it('refuses to discard a released test — release is terminal', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      await release(ready.token, id).expect(200);

      const refusal = await discard(ready.token, id).expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect((await storedRow(id)).status).toBe('Released');
    });

    it('refuses every parent route on a released id, with one identical sentence', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      const { id: questionId, prompt: storedPrompt } =
        await h.prisma.practiceTestQuestion.findFirstOrThrow({
          where: { practiceTestId: id },
          orderBy: { ordinal: 'asc' },
          select: { id: true, prompt: true },
        });
      await release(ready.token, id).expect(200);

      // The read, the write barrier this story adds the tests for, and both
      // transitions: five refusals, one sentence, and nothing distinguishable
      // about any of them.
      const unknown = await readDraft(ready.token, randomUUID()).expect(404);
      for (const refusal of [
        await readDraft(ready.token, id).expect(404),
        await server()
          .patch(`/api/parent/practice-tests/${id}/questions/${questionId}`)
          .set('Authorization', bearer(ready.token))
          .send({ prompt: 'A rewritten prompt.' })
          .expect(404),
        await server()
          .delete(`/api/parent/practice-tests/${id}/questions/${questionId}`)
          .set('Authorization', bearer(ready.token))
          .expect(404),
        await release(ready.token, id).expect(404),
        await discard(ready.token, id).expect(404),
      ]) {
        expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
        expect(refusal.body.message).toBe(unknown.body.message);
      }
      // No row was written by any of them: the Question is exactly where it was.
      const untouched = await h.prisma.practiceTestQuestion.findUniqueOrThrow({
        where: { id: questionId },
        select: { prompt: true },
      });
      expect(untouched.prompt).toEqual(storedPrompt);
      expect((await storedRow(id)).status).toBe('Released');
    });

    it('refuses every parent route on a discarded id too, with that same sentence', async () => {
      // The controller and the service both assert that the two terminal states
      // behave identically. Proving it for `Released` alone would leave "a
      // `Released` *or* `Discarded` row answers the one 404" half-tested, and the
      // half that is about a row a parent deliberately threw away untested.
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      const { id: questionId, prompt: storedPrompt } =
        await h.prisma.practiceTestQuestion.findFirstOrThrow({
          where: { practiceTestId: id },
          orderBy: { ordinal: 'asc' },
          select: { id: true, prompt: true },
        });
      await discard(ready.token, id).expect(200);

      const unknown = await readDraft(ready.token, randomUUID()).expect(404);
      for (const refusal of [
        await readDraft(ready.token, id).expect(404),
        await server()
          .patch(`/api/parent/practice-tests/${id}/questions/${questionId}`)
          .set('Authorization', bearer(ready.token))
          .send({ prompt: 'A rewritten prompt.' })
          .expect(404),
        await server()
          .delete(`/api/parent/practice-tests/${id}/questions/${questionId}`)
          .set('Authorization', bearer(ready.token))
          .expect(404),
        await release(ready.token, id).expect(404),
        await discard(ready.token, id).expect(404),
      ]) {
        expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
        expect(refusal.body.message).toBe(unknown.body.message);
      }
      // Nothing was written by any of them, and a discard is never walked back.
      const untouched = await h.prisma.practiceTestQuestion.findUniqueOrThrow({
        where: { id: questionId },
        select: { prompt: true },
      });
      expect(untouched.prompt).toEqual(storedPrompt);
      expect((await storedRow(id)).status).toBe('Discarded');
    });

    it('takes a released row out of Pending drafts, and the sibling count with it', async () => {
      const ready = await withLandedDrafts(2);
      const [first, second] = ready.draftIds;
      await release(ready.token, first!).expect(200);

      const list = await server()
        .get('/api/parent/practice-tests/drafts')
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(second);
      // "of 2" was true while both were drafts. The remaining draft's figure
      // reflects the smaller set rather than the job's original size.
      expect(list.body[0].siblingCount).toBe(1);
    });

    it('takes a discarded row out of Pending drafts too, and the sibling count with it', async () => {
      // The same acceptance criterion as release's — "appears on no parent draft
      // surface" — proven for the other terminal state rather than assumed from it.
      const ready = await withLandedDrafts(2);
      const [first, second] = ready.draftIds;
      await discard(ready.token, first!).expect(200);

      const list = await server()
        .get('/api/parent/practice-tests/drafts')
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(second);
      expect(list.body[0].siblingCount).toBe(1);
    });

    it('refuses either transition on another account’s draft as though it were not there', async () => {
      const mine = await withLandedDrafts(1);
      const theirs = await withLandedDrafts(1);

      const releaseRefusal = await release(mine.token, theirs.draftIds[0]!).expect(404);
      const discardRefusal = await discard(mine.token, theirs.draftIds[0]!).expect(404);
      expect(releaseRefusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(discardRefusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      // Nothing about the other account is in the answer, and their draft is
      // still a draft.
      expect(JSON.stringify(releaseRefusal.body)).not.toContain(theirs.parentAccountId);
      expect((await storedRow(theirs.draftIds[0]!)).status).toBe('Draft');
    });

    it('refuses a malformed id on shape, before a row is read', async () => {
      const ready = await withLandedDrafts(1);
      await release(ready.token, 'not-a-uuid').expect(400);
      await discard(ready.token, 'not-a-uuid').expect(400);
      expect((await storedRow(ready.draftIds[0]!)).status).toBe('Draft');
    });

    it('refuses both transitions without an elevation bearer', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      await server().post(`/api/parent/practice-tests/${id}/release`).expect(401);
      await server().post(`/api/parent/practice-tests/${id}/discard`).expect(401);
      expect((await storedRow(id)).status).toBe('Draft');
    });

    it('carries no content in the body either transition actually refuses with', async () => {
      // Swept off the **responses**, not off the constant: the constant is not
      // changed by this story, so a check on it could not fail for any reason
      // related to release or discard. What matters is what a refused transition
      // puts on the wire.
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      // Read the real content first, so the sweep is against the very strings this
      // draft holds rather than against a guess at what a generator writes.
      const question = await h.prisma.practiceTestQuestion.findFirstOrThrow({
        where: { practiceTestId: id },
        orderBy: { ordinal: 'asc' },
        select: {
          prompt: true,
          answer: true,
          choices: { select: { body: true } },
          topics: { select: { label: true } },
        },
      });
      const plain = (value: unknown): string[] =>
        JSON.stringify(value ?? '').match(/[A-Za-z][A-Za-z ']{3,}/gu) ?? [];
      const content = [
        ...plain(question.prompt),
        ...plain(question.answer),
        ...question.choices.flatMap((choice) => plain(choice.body)),
        ...question.topics.map((topic) => topic.label),
      ].filter((text) => text.trim().length > 3);
      expect(content.length).toBeGreaterThan(0);

      // Release once so the second release and the discard are both refusals.
      await release(ready.token, id).expect(200);
      for (const refusal of [
        await release(ready.token, id).expect(404),
        await discard(ready.token, id).expect(404),
      ]) {
        const serialized = JSON.stringify(refusal.body);
        // Not a fragment of the Question, an option body or a Topic label.
        for (const text of content) expect(serialized).not.toContain(text);
        // And no allowance figure, tier label or model name (AD-20).
        expect(serialized).not.toMatch(/allowance|tier|free|unlimited|gpt|model/iu);
        // Identifiers only: the account is not named either.
        expect(serialized).not.toContain(ready.parentAccountId);
        // And no second sentence that would let the outside tell the refusals
        // apart — nothing says *which* state it was in.
        expect(serialized).not.toMatch(/released|discarded|already/iu);
      }
    });

    // --- The student-scoped read -------------------------------------------

    /**
     * A **second** Source Test on the same account and the same child,
     * classified under a different Subject and driven to a live Extraction.
     *
     * It exists so a list can hold two differently-classified rows without
     * fabricating a state no route can produce: re-pointing another account's
     * released test onto this child would encode exactly the crossing the
     * intent calls absent by construction. Everything here goes through the
     * parent's own routes, as a parent with two uploads would.
     */
    async function secondClassifiedSourceTest(
      ready: Ready,
    ): Promise<{ sourceTestId: string; subjectName: string }> {
      const profile = await h.prisma.studentProfile.findUniqueOrThrow({
        where: { id: ready.studentProfileId },
        select: { gradeLevelId: true },
      });
      const draft = await server()
        .post('/api/parent/source-tests')
        .set('Authorization', bearer(ready.token))
        .send({ studentProfileId: ready.studentProfileId })
        .expect(200);
      const sourceTestId: string = draft.body.id;

      const subject = await createSubject(h, { gradeLevelId: profile.gradeLevelId });
      await server()
        .patch(`/api/parent/source-tests/${sourceTestId}/classification`)
        .set('Authorization', bearer(ready.token))
        .send({ subjectId: subject.id })
        .expect(200);

      for (let index = 0; index < 2; index += 1) {
        await server()
          .post(`/api/parent/source-tests/${sourceTestId}/pages`)
          .set('Authorization', bearer(ready.token))
          .attach('file', await photo(index + 3), {
            filename: 'page.jpg',
            contentType: 'image/jpeg',
          })
          .expect(201);
      }
      await checkLegibility(h, ready.token, sourceTestId);
      await server()
        .post(`/api/parent/source-tests/${sourceTestId}/submit`)
        .set('Authorization', bearer(ready.token))
        .expect(200);
      expect(await h.extractionRunner.runOnce()).toBe(true);
      // The legibility check and the Extraction both went through the AI
      // double, so its recorded calls are fixture noise by the time a case
      // starts. Cleared here for the same reason `generatable` clears it: a
      // case asserting on what the generator asked for must not have to count
      // past the setup's calls first.
      h.ai.reset();
      return { sourceTestId, subjectName: subject.name };
    }

    /**
     * One sitting, written straight to the table.
     *
     * **A stand-in for the list's own writer**: these cases are about how a past
     * sitting reads on Student Home, not about how one is started, so they write
     * the row rather than driving `POST .../attempt` through the whole release
     * and binding dance for every band they need.
     *
     * The three ids the column set now requires are resolved from the Practice
     * Test itself rather than passed in, so every existing call site still reads
     * as "a sitting on this test", and `ordinal` is counted from what is already
     * there — a case seeding two sittings on one test (the retake and
     * most-recent-submission bands below) would otherwise collide on
     * `@@unique([practiceTestId, studentProfileId, ordinal])`.
     */
    async function seedAttempt(practiceTestId: string, submittedAt: Date | null) {
      const test = await h.prisma.practiceTest.findUniqueOrThrow({
        where: { id: practiceTestId },
        select: { parentAccountId: true, studentProfileId: true },
      });
      const ordinal =
        (await h.prisma.attempt.count({
          where: { practiceTestId, studentProfileId: test.studentProfileId },
        })) + 1;
      return h.prisma.attempt.create({
        data: {
          practiceTestId,
          parentAccountId: test.parentAccountId,
          studentProfileId: test.studentProfileId,
          ordinal,
          // The instants the server would have written. `startedAt` is only ever
          // read as "before the submission" by the list, so a fixed instant
          // ahead of nothing is enough; a submitted sitting keeps the instant
          // the case asserts on.
          startedAt: submittedAt ?? new Date('2026-01-01T00:00:00.000Z'),
          submittedAt,
        },
        select: { id: true },
      });
    }

    it('shows the bound child their released tests, as an id, a Subject, a count and a state', async () => {
      const ready = await withLandedDrafts(2);
      const [released, stillDraft] = ready.draftIds;
      const view = await release(ready.token, released!).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(released);
      expect(response.body[0].questionCount).toBe(view.body.questions.length);
      // The Subject the parent classified the upload under, resolved across the
      // `sourcetest` boundary rather than by a delegate this module must not
      // hold. A non-empty string, so a label silently degrading to null fails.
      expect(typeof response.body[0].subjectName).toBe('string');
      expect(response.body[0].subjectName.length).toBeGreaterThan(0);
      // Never sat, so not started — derived from the absence of Attempts.
      expect(response.body[0].state).toBe('NotStarted');
      // Those four and nothing else at all — not a field name, not a prompt,
      // not an option, not a Topic, not a figure about spending, and no
      // `timerMinutes`.
      expect(Object.keys(response.body[0]).sort()).toEqual([
        'id',
        'questionCount',
        'state',
        'subjectName',
      ]);
      expect(Object.keys(response.body[0])).not.toContain('timerMinutes');
      const serialized = JSON.stringify(response.body);
      for (const forbidden of [
        'prompt',
        'answer',
        'choices',
        'topics',
        'allowance',
        'tier',
        'gpt',
        'Practice 1.1',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      // And the draft is not on it: a draft never appears in Student Mode.
      expect(serialized).not.toContain(stillDraft!);
    });

    it('answers an empty list, not a 404, when the account holds drafts only', async () => {
      const ready = await withLandedDrafts(1);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);
      // Having nothing yet is a state Student Home renders, never a refusal.
      await readReleased(cookie).expect(200).expect([]);
    });

    it('scopes the read by the bound profile, not by the account', async () => {
      const ready = await withLandedDrafts(1);
      await release(ready.token, ready.draftIds[0]!).expect(200);
      // A sibling on the same account. The release was made for the other child,
      // and this device is bound to this one.
      const grade = await createGradeLevel(h);
      const sibling = await createStudentProfile(h, ready.parentAccountId, {
        gradeLevelId: grade.id,
      });
      const cookie = await bindDevice(h, ready.token, sibling.id);

      await readReleased(cookie).expect(200).expect([]);
    });

    it('leaves a discarded test out of the read entirely', async () => {
      const ready = await withLandedDrafts(2);
      const [discarded, released] = ready.draftIds;
      await discard(ready.token, discarded!).expect(200);
      await release(ready.token, released!).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);
      // Discard's exclusion from every downstream surface is structural:
      // `status: 'Released'` is in the `where`, so a discarded row is not
      // something a later reader must filter — it is one this read cannot reach.
      expect(response.body.map((row: { id: string }) => row.id)).toEqual([released]);
    });

    it('breaks a tie on the made-at instant with the id, descending', async () => {
      const ready = await withLandedDrafts(2);
      await release(ready.token, ready.draftIds[0]!).expect(200);
      await release(ready.token, ready.draftIds[1]!).expect(200);
      // Both rows forced to **one literal instant**, which is the only state in
      // which the `id: 'desc'` clause is reached at all: two drafts of one job can
      // land inside the same millisecond, and without the tiebreak the order is
      // whatever the planner happened to return. Left with distinct `createdAt`
      // values this case would pass with that clause deleted.
      await h.prisma.practiceTest.updateMany({
        where: { id: { in: ready.draftIds } },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);
      // Expected in the test's own terms, from the two ids it already holds — not
      // from a second query carrying the service's own `orderBy`, which would
      // agree with the implementation whatever the implementation said.
      expect(response.body.map((row: { id: string }) => row.id)).toEqual(
        [...ready.draftIds].sort().reverse(),
      );
    });

    it('calls a released test with an open Attempt in progress, and keeps it in the first band', async () => {
      const ready = await withLandedDrafts(2);
      const [inProgress, notStarted] = ready.draftIds;
      await release(ready.token, inProgress!).expect(200);
      await release(ready.token, notStarted!).expect(200);
      await seedAttempt(inProgress!, null);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);

      const byId = new Map(
        response.body.map((row: { id: string; state: string }) => [row.id, row.state]),
      );
      expect(byId.get(inProgress!)).toBe('InProgress');
      expect(byId.get(notStarted!)).toBe('NotStarted');
      // Both are work waiting, so both are in band 1 and only the date
      // separates them — in progress is not a band of its own.
      expect(response.body).toHaveLength(2);
    });

    it('calls a released test completed once every Attempt has been handed in', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      await release(ready.token, id).expect(200);
      await seedAttempt(id, new Date('2026-05-01T00:00:00.000Z'));
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);
      expect(response.body).toEqual([
        {
          id,
          subjectName: expect.any(String),
          questionCount: expect.any(Number),
          state: 'Completed',
        },
      ]);
    });

    it('puts everything there is still to do ahead of everything finished, whatever the dates say', async () => {
      const ready = await withLandedDrafts(2);
      const [done, todo] = ready.draftIds;
      await release(ready.token, done!).expect(200);
      await release(ready.token, todo!).expect(200);
      await seedAttempt(done!, new Date('2026-06-02T00:00:00.000Z'));
      // The finished one is also the *newest*, so a list ordered by date alone
      // would put it first. The band is what decides, not the instant.
      await h.prisma.practiceTest.update({
        where: { id: done! },
        data: { createdAt: new Date('2026-06-01T00:00:00.000Z') },
      });
      await h.prisma.practiceTest.update({
        where: { id: todo! },
        data: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      });
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);
      expect(response.body.map((row: { id: string }) => row.id)).toEqual([todo, done]);
    });

    it('treats an open retake as work to return to, ahead of what is finished', async () => {
      const ready = await withLandedDrafts(2);
      const [retaken, done] = ready.draftIds;
      await release(ready.token, retaken!).expect(200);
      await release(ready.token, done!).expect(200);
      // One submitted sitting and one still open, on the same test.
      await seedAttempt(retaken!, new Date('2026-01-01T00:00:00.000Z'));
      await seedAttempt(retaken!, null);
      await seedAttempt(done!, new Date('2026-06-01T00:00:00.000Z'));
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);
      // An open Attempt outranks a past submission: it is work to return to.
      expect(response.body[0].id).toBe(retaken);
      expect(response.body[0].state).toBe('InProgress');
      expect(response.body[1].id).toBe(done);
      expect(response.body[1].state).toBe('Completed');
    });

    it('orders the finished band by the most recent submission, not by the last row read', async () => {
      const ready = await withLandedDrafts(2);
      const [latest, earlier] = ready.draftIds;
      await release(ready.token, latest!).expect(200);
      await release(ready.token, earlier!).expect(200);
      // Two submissions on one test, seeded **newest first**, so the
      // most-recent reduce is actually exercised: a reduce that took the last
      // row it was handed would read 2026-01-01 here and flip the order below.
      await seedAttempt(latest!, new Date('2026-05-01T00:00:00.000Z'));
      await seedAttempt(latest!, new Date('2026-01-01T00:00:00.000Z'));
      await seedAttempt(earlier!, new Date('2026-03-01T00:00:00.000Z'));
      // And made-at disagrees with submitted-at, so a list still ordered by
      // `createdAt` in this band would fail too.
      await h.prisma.practiceTest.update({
        where: { id: latest! },
        data: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
      });
      await h.prisma.practiceTest.update({
        where: { id: earlier! },
        data: { createdAt: new Date('2026-12-01T00:00:00.000Z') },
      });
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleased(cookie).expect(200);
      expect(response.body.map((row: { id: string }) => row.id)).toEqual([latest, earlier]);
    });

    it('still lists a test completed years ago, with nothing on this path filtering by date', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      await release(ready.token, id).expect(200);
      await seedAttempt(id, new Date('2024-02-03T00:00:00.000Z'));
      await h.prisma.practiceTest.update({
        where: { id },
        data: { createdAt: new Date('2024-02-01T00:00:00.000Z') },
      });
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      // No cutoff, no archive flag and no date filter anywhere on this path:
      // a child's finished work stays where they left it.
      const response = await readReleased(cookie).expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(id);
      expect(response.body[0].state).toBe('Completed');
    });

    it('carries each row’s own Subject when one list holds two of them', async () => {
      // Two Source Tests classified under **different** Subjects, both on the
      // one account and the one child — the state a real parent can actually
      // reach. A single-row fixture cannot see a batched lookup that returns
      // the right labels against the wrong rows; this one can.
      const ready = await withLandedDrafts(1);
      const first = ready.draftIds[0]!;
      await release(ready.token, first).expect(200);
      const firstSubject = await h.prisma.sourceTest
        .findUniqueOrThrow({
          where: { id: ready.sourceTestId },
          select: { subject: { select: { name: true } } },
        })
        .then((row) => row.subject!.name);

      const second = await secondClassifiedSourceTest(ready);
      await server()
        .post(`/api/parent/source-tests/${second.sourceTestId}/practice-tests`)
        .set('Authorization', bearer(ready.token))
        .send({ count: 1 })
        .expect(202);
      expect(await h.practiceTestRunner.runOnce()).toBe(true);
      const secondDraft = await h.prisma.practiceTest.findFirstOrThrow({
        where: { sourceTestId: second.sourceTestId },
        select: { id: true },
      });
      await release(ready.token, secondDraft.id).expect(200);

      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);
      const response = await readReleased(cookie).expect(200);

      expect(firstSubject).not.toBe(second.subjectName);
      const labels = new Map(
        response.body.map((row: { id: string; subjectName: string | null }) => [
          row.id,
          row.subjectName,
        ]),
      );
      expect(labels.get(first)).toBe(firstSubject);
      expect(labels.get(secondDraft.id)).toBe(second.subjectName);
    });

    it('refuses the read on an unbound device, and on one carrying the parent’s bearer', async () => {
      const ready = await withLandedDrafts(1);
      await release(ready.token, ready.draftIds[0]!).expect(200);

      // No cookie at all: the guard's own refusal, which is what Student Home
      // reads as "this device is not set up for a child".
      const unbound = await server().get('/api/student/practice-tests').expect(401);
      expect(unbound.body.bound).toBe(false);
      // A stale binding is the same refusal.
      await server()
        .get('/api/student/practice-tests')
        .set('Cookie', 'student_mode=not-a-token')
        .expect(401);
      // And the elevation bearer is the wrong audience for this surface: the
      // guard never reads `Authorization`, so it cannot even be presented.
      await server()
        .get('/api/student/practice-tests')
        .set('Authorization', bearer(ready.token))
        .expect(401);
    });

    // --- The student-scoped read of one test -------------------------------

    it('hands the bound child every Question in stored order, and no correct answer', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      // Read what is actually stored first, so the sweep below is against this
      // draft's own strings rather than a guess at what the generator writes.
      const stored = await h.prisma.practiceTestQuestion.findMany({
        where: { practiceTestId: id },
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          ordinal: true,
          format: true,
          answer: true,
          choices: { orderBy: { ordinal: 'asc' }, select: { ordinal: true, isCorrect: true } },
        },
      });
      expect(stored.length).toBeGreaterThan(0);
      await release(ready.token, id).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleasedTest(cookie, id).expect(200);

      expect(Object.keys(response.body).sort()).toEqual(['id', 'questionCount', 'questions']);
      expect(response.body.id).toBe(id);
      expect(response.body.questionCount).toBe(stored.length);
      expect(response.body.questions).toHaveLength(stored.length);
      // Ascending ordinal, questions and choices alike — the order the child works
      // in is the stored one, not whatever the planner returned.
      expect(response.body.questions.map((q: { ordinal: number }) => q.ordinal)).toEqual(
        stored.map((question) => question.ordinal),
      );
      expect(response.body.questions.map((q: { id: string }) => q.id)).toEqual(
        stored.map((question) => question.id),
      );
      for (const [index, question] of response.body.questions.entries()) {
        expect(Object.keys(question).sort()).toEqual([
          'choices',
          'format',
          'id',
          'ordinal',
          'prompt',
        ]);
        expect(question.format).toBe(stored[index]!.format);
        expect(question.choices.map((c: { ordinal: number }) => c.ordinal)).toEqual(
          stored[index]!.choices.map((choice) => choice.ordinal),
        );
        for (const choice of question.choices) {
          expect(Object.keys(choice).sort()).toEqual(['body', 'ordinal']);
        }
        // A Multiple Choice question keeps all of its options — the child chooses
        // between them — and nothing on the wire says which one is right.
        if (stored[index]!.format === 'MultipleChoice') {
          expect(question.choices.length).toBeGreaterThan(1);
        }
      }

      // Over the raw JSON, not field by field: a field-by-field check passes on
      // exactly the shape it was written against and says nothing about a key a
      // later edit adds.
      const serialized = JSON.stringify(response.body);
      // No key of any of these names, anywhere in the tree. Matched as a *key*
      // rather than as a substring for the ones a prompt could legitimately say
      // in passing — a generated prompt really does name its Topic in its text,
      // and a bare `not.toContain('topic')` would be failing about content the
      // child is meant to read rather than about a field that leaked.
      for (const key of [
        'answer',
        'isCorrect',
        'topics',
        'topic',
        'cost',
        'tier',
        'model',
        'allowance',
        'timerMinutes',
        'status',
        'chargedAt',
        'studentProfileId',
        'parentAccountId',
      ]) {
        expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'iu'));
      }
      // `isCorrect` is not even a word on the wire, key or otherwise.
      expect(serialized).not.toContain('isCorrect');
      // A free-text answer sweep does not belong here: every Question the fake
      // extractor produces is MultipleChoice, whose `answer` column is null, so
      // a loop over it would run zero times and protect nothing. The case below
      // rewrites a draft into all three Formats and sweeps there, where there is
      // something to sweep.
      //
      // The flag itself is the thing a Multiple Choice question's answer *is*,
      // and the child's view is the same options with no way to tell them apart:
      // as many options as are stored, and nothing marking one of them.
      const flagged = stored.flatMap((question) =>
        question.choices.filter((choice) => choice.isCorrect),
      );
      expect(flagged.length).toBeGreaterThan(0);
      // The account is not named either: identifiers this child's device already
      // addressed, and nothing else.
      expect(serialized).not.toContain(ready.parentAccountId);
    });

    it('serves all three Formats, and the answer to none of them', async () => {
      // The fake extractor reads only Multiple Choice off a page, so a draft
      // generated through the real pipeline exercises one third of this route.
      // The stored rows are rewritten into the other two Formats first — exactly
      // the shape generation stores them in, a free-text `answer` and no choices
      // — so the sweep below has something to sweep and the route is actually
      // asked for a Question whose answer is a column rather than a flag.
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      const generated = await h.prisma.practiceTestQuestion.findMany({
        where: { practiceTestId: id },
        orderBy: { ordinal: 'asc' },
        select: { id: true, ordinal: true },
      });
      expect(generated.length).toBeGreaterThanOrEqual(2);
      const second = generated[1]!;

      await h.prisma.practiceTestChoice.deleteMany({ where: { questionId: second.id } });
      await h.prisma.practiceTestQuestion.update({
        where: { id: second.id },
        data: {
          format: 'FillInTheBlank',
          answer: [{ kind: 'text', value: 'three quarters of the whole' }],
        },
      });
      const thirdOrdinal = generated.length + 1;
      await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: id,
          ordinal: thirdOrdinal,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'Explain how you worked that out.' }],
          answer: [{ kind: 'text', value: 'Any reasoning that reaches it' }],
          topics: { create: [{ label: 'Fractions' }] },
        },
      });
      await h.prisma.practiceTest.update({
        where: { id },
        data: { questionCount: thirdOrdinal },
      });

      await release(ready.token, id).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const response = await readReleasedTest(cookie, id).expect(200);

      expect(response.body.questionCount).toBe(thirdOrdinal);
      expect(response.body.questions).toHaveLength(thirdOrdinal);
      const byFormat = new Map<string, { format: string; choices: unknown[] }>(
        response.body.questions.map((question: { format: string }) => [question.format, question]),
      );
      // All three arrive, each with the options its Format has and no others: a
      // Multiple Choice question is a choice between stored options, and the other
      // two are a blank the child fills in.
      expect([...byFormat.keys()].sort()).toEqual([
        'FillInTheBlank',
        'MultipleChoice',
        'ShortAnswer',
      ]);
      expect(byFormat.get('MultipleChoice')!.choices.length).toBeGreaterThan(1);
      expect(byFormat.get('FillInTheBlank')!.choices).toEqual([]);
      expect(byFormat.get('ShortAnswer')!.choices).toEqual([]);

      // Not one stored free-text answer, in its own words. The segment *values*
      // are swept rather than the stringified column, because the column's
      // structural keys (`kind`, `text`, `value`) are on this wire legitimately
      // — every prompt is made of them.
      const stored = await h.prisma.practiceTestQuestion.findMany({
        where: { practiceTestId: id },
        select: { answer: true },
      });
      const answerText = stored
        .flatMap((question) => (question.answer ?? []) as { kind: string; value?: string }[])
        .flatMap((segment) => (segment.kind === 'text' ? [segment.value ?? ''] : []))
        .filter((text) => text.trim().length > 3);
      // Non-vacuous by assertion, not by hope: a sweep with nothing to sweep is a
      // test that passes because it did nothing.
      expect(answerText.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(response.body);
      for (const text of answerText) expect(serialized).not.toContain(text);
      expect(serialized).not.toContain('isCorrect');
      expect(serialized).not.toMatch(/"answers?"\s*:/iu);
      expect(serialized).not.toContain('Fractions');
    });

    it('answers a draft, a discarded row and an unknown id with one identical sentence', async () => {
      const ready = await withLandedDrafts(2);
      const [stillDraft, discarded] = ready.draftIds;
      await discard(ready.token, discarded!).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      const unknown = await readReleasedTest(cookie, randomUUID()).expect(404);
      for (const refusal of [
        await readReleasedTest(cookie, stillDraft!).expect(404),
        await readReleasedTest(cookie, discarded!).expect(404),
        unknown,
      ]) {
        expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
        expect(refusal.body.message).toBe(unknown.body.message);
        // Nothing distinguishes the three: not a second sentence, not a hint at
        // which state it was in.
        const serialized = JSON.stringify(refusal.body);
        expect(serialized).not.toMatch(/draft|released|discarded|already/iu);
      }
      // And neither row moved: a refused read writes nothing.
      expect((await storedRow(stillDraft!)).status).toBe('Draft');
      expect((await storedRow(discarded!)).status).toBe('Discarded');
    });

    it('refuses a sibling’s released test as though it were not there', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      await release(ready.token, id).expect(200);
      // The release was made for one child; this device is bound to the other.
      const grade = await createGradeLevel(h);
      const sibling = await createStudentProfile(h, ready.parentAccountId, {
        gradeLevelId: grade.id,
      });
      const cookie = await bindDevice(h, ready.token, sibling.id);

      const refusal = await readReleasedTest(cookie, id).expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      // The profile is the binding's, never the path's: one child holding another's
      // id learns only that there is nothing there.
      expect(JSON.stringify(refusal.body)).not.toContain(ready.studentProfileId);
    });

    it('refuses another account’s released test with that same sentence', async () => {
      const mine = await withLandedDrafts(1);
      const theirs = await withLandedDrafts(1);
      await release(theirs.token, theirs.draftIds[0]!).expect(200);
      const cookie = await bindDevice(h, mine.token, mine.studentProfileId);

      const refusal = await readReleasedTest(cookie, theirs.draftIds[0]!).expect(404);
      const unknown = await readReleasedTest(cookie, randomUUID()).expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(refusal.body.message).toBe(unknown.body.message);
      expect(JSON.stringify(refusal.body)).not.toContain(theirs.parentAccountId);
    });

    it('refuses the detail read on an unbound device, and on one carrying the bearer', async () => {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      await release(ready.token, id).expect(200);

      const unbound = await server().get(`/api/student/practice-tests/${id}`).expect(401);
      expect(unbound.body.bound).toBe(false);
      await server()
        .get(`/api/student/practice-tests/${id}`)
        .set('Cookie', 'student_mode=not-a-token')
        .expect(401);
      // The elevation bearer is the wrong audience for this surface: the guard
      // never reads `Authorization`, so it cannot even be presented.
      await server()
        .get(`/api/student/practice-tests/${id}`)
        .set('Authorization', bearer(ready.token))
        .expect(401);
    });

    it('answers a malformed id with that same 404, not a refusal of its own', async () => {
      const ready = await withLandedDrafts(1);
      await release(ready.token, ready.draftIds[0]!).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      // Deliberately not the parent routes' 400-on-shape: a second kind of
      // refusal on this surface would tell a child *something*, and the whole
      // discipline here is that every refusal is the one sentence.
      const refusal = await readReleasedTest(cookie, 'not-a-uuid').expect(404);
      const unknown = await readReleasedTest(cookie, randomUUID()).expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(refusal.body.message).toBe(unknown.body.message);
    });

    // --- The Attempt: start, resume, and hand in ---------------------------

    /** Opens or resumes the Attempt, carrying the binding cookie and no bearer. */
    function startAttempt(cookie: string, practiceTestId: string) {
      return server()
        .post(`/api/student/practice-tests/${practiceTestId}/attempt`)
        .set('Cookie', cookie);
    }

    /** Hands one Attempt in. The body is answers and only answers. */
    function submitAttempt(
      cookie: string,
      attemptId: string,
      answers: { questionId: string; value: string }[],
    ) {
      return server()
        .post(`/api/student/attempts/${attemptId}/submit`)
        .set('Cookie', cookie)
        .send({ answers });
    }

    /** Sets the countdown the parent configured, which start snapshots. */
    function setTimerMinutes(token: string, id: string, minutes: number | null) {
      return server()
        .put(`/api/parent/practice-tests/${id}/timer`)
        .set('Authorization', bearer(token))
        .send({ minutes });
    }

    /** A released test this child is bound to, with its Question ids in order. */
    async function releasedForChild(timerMinutes: number | null): Promise<{
      ready: Ready & { draftIds: string[] };
      id: string;
      cookie: string;
      questionIds: string[];
    }> {
      const ready = await withLandedDrafts(1);
      const id = ready.draftIds[0]!;
      if (timerMinutes !== null) await setTimerMinutes(ready.token, id, timerMinutes).expect(200);
      await release(ready.token, id).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);
      const questions = await h.prisma.practiceTestQuestion.findMany({
        where: { practiceTestId: id },
        orderBy: { ordinal: 'asc' },
        select: { id: true },
      });
      return { ready, id, cookie, questionIds: questions.map((question) => question.id) };
    }

    it('starts a timed Attempt with a server startedAt and an expiresAt exactly that much later', async () => {
      const { id, cookie } = await releasedForChild(20);

      const before = Date.now();
      const response = await startAttempt(cookie, id).expect(201);
      const after = Date.now();

      expect(Object.keys(response.body).sort()).toEqual([
        'expiresAt',
        'id',
        'practiceTestId',
        'serverNow',
        'startedAt',
        'submittedAt',
      ]);
      expect(response.body.practiceTestId).toBe(id);
      expect(response.body.submittedAt).toBeNull();
      // The server's own clock, not a figure this test supplied: it simply has to
      // fall inside the window the request occupied.
      const startedAt = Date.parse(response.body.startedAt);
      expect(startedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(startedAt).toBeLessThanOrEqual(after + 1000);
      // Exactly `timerMinutes` later. Derived from the response's own `startedAt`,
      // so this asserts the *relationship* rather than agreeing with a clock.
      expect(Date.parse(response.body.expiresAt) - startedAt).toBe(20 * 60_000);
      // And the stored row says the same thing, so nothing is computed on the wire.
      const stored = await h.prisma.attempt.findUniqueOrThrow({
        where: { id: response.body.id },
        select: {
          startedAt: true,
          expiresAt: true,
          submittedAt: true,
          expired: true,
          ordinal: true,
        },
      });
      expect(stored.startedAt.toISOString()).toBe(response.body.startedAt);
      expect(stored.expiresAt!.toISOString()).toBe(response.body.expiresAt);
      expect(stored.submittedAt).toBeNull();
      expect(stored.expired).toBe(false);
      expect(stored.ordinal).toBe(1);
    });

    it('starts an untimed Attempt with no deadline at all', async () => {
      const { id, cookie } = await releasedForChild(null);

      const response = await startAttempt(cookie, id).expect(201);

      // Null already means exactly what "no timer" means: there is no deadline to
      // render and none to reach.
      expect(response.body.expiresAt).toBeNull();
      expect(typeof response.body.startedAt).toBe('string');
      const stored = await h.prisma.attempt.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { expiresAt: true },
      });
      expect(stored.expiresAt).toBeNull();
    });

    it('resumes the open Attempt on a second start, with both instants untouched', async () => {
      const { id, cookie } = await releasedForChild(20);
      const first = await startAttempt(cookie, id).expect(201);

      const again = await startAttempt(cookie, id).expect(201);

      // The same row, and the same two instants. A reload that handed out a fresh
      // deadline would make the timer the parent configured mean nothing.
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.startedAt).toBe(first.body.startedAt);
      expect(again.body.expiresAt).toBe(first.body.expiresAt);
      // And exactly one row exists: resuming is reading, not inserting.
      expect(await h.prisma.attempt.count({ where: { practiceTestId: id } })).toBe(1);
    });

    it('returns the handed-in Attempt on a re-open rather than starting a retake', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const first = await startAttempt(cookie, id).expect(201);
      const submitted = await submitAttempt(cookie, first.body.id, [
        { questionId: questionIds[0]!, value: 'in' },
      ]).expect(200);

      const again = await startAttempt(cookie, id).expect(201);

      // The same row, carrying its `submittedAt` — which is how the screen knows to
      // state that the work is in. A second row would be a retake, and retakes are
      // Story 5.7's: the only way to get one is a story that deliberately adds it.
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.startedAt).toBe(first.body.startedAt);
      expect(again.body.expiresAt).toBe(first.body.expiresAt);
      expect(again.body.submittedAt).toBe(submitted.body.submittedAt);
      expect(await h.prisma.attempt.count({ where: { practiceTestId: id } })).toBe(1);
      // And the answers already recorded were not touched by the re-open.
      expect(await h.prisma.answer.count({ where: { attemptId: first.body.id } })).toBe(1);
    });

    it('refuses to start on a draft, a discarded row, a sibling’s, a stranger’s or an unknown id', async () => {
      const mine = await withLandedDrafts(2);
      const [stillDraft, discarded] = mine.draftIds;
      await discard(mine.token, discarded!).expect(200);
      const cookie = await bindDevice(h, mine.token, mine.studentProfileId);

      // A sibling's release, on this same account.
      const sibling = await releasedForChild(20);
      const grade = await createGradeLevel(h);
      const other = await createStudentProfile(h, sibling.ready.parentAccountId, {
        gradeLevelId: grade.id,
      });
      const siblingCookie = await bindDevice(h, sibling.ready.token, other.id);

      // And another account's.
      const strangers = await releasedForChild(20);

      const unknown = await startAttempt(cookie, randomUUID()).expect(404);
      for (const refusal of [
        await startAttempt(cookie, stillDraft!).expect(404),
        await startAttempt(cookie, discarded!).expect(404),
        await startAttempt(siblingCookie, sibling.id).expect(404),
        await startAttempt(cookie, strangers.id).expect(404),
        await startAttempt(cookie, 'not-a-uuid').expect(404),
        unknown,
      ]) {
        expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
        expect(refusal.body.message).toBe(unknown.body.message);
        // Nothing distinguishes them: the statement that looked cannot tell them
        // apart either.
        expect(JSON.stringify(refusal.body)).not.toMatch(/draft|released|discarded|already/iu);
      }
      // And not one Attempt row was written by any of them.
      expect(await h.prisma.attempt.count({ where: { practiceTestId: stillDraft! } })).toBe(0);
      expect(await h.prisma.attempt.count({ where: { practiceTestId: strangers.id } })).toBe(0);
    });

    it('refuses to start on an unbound device, and on one carrying the parent’s bearer', async () => {
      const { id, ready } = await releasedForChild(20);

      const unbound = await server().post(`/api/student/practice-tests/${id}/attempt`).expect(401);
      expect(unbound.body.bound).toBe(false);
      await server()
        .post(`/api/student/practice-tests/${id}/attempt`)
        .set('Cookie', 'student_mode=not-a-token')
        .expect(401);
      // The elevation bearer is the wrong audience for this surface entirely.
      await server()
        .post(`/api/student/practice-tests/${id}/attempt`)
        .set('Authorization', bearer(ready.token))
        .expect(401);
      expect(await h.prisma.attempt.count({ where: { practiceTestId: id } })).toBe(0);
    });

    it('hands the work in, stores the raw answers, and closes the Attempt', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);
      const answers = questionIds.map((questionId, position) => ({
        questionId,
        value: position === 0 ? '3/4' : `answer ${position}`,
      }));

      const response = await submitAttempt(cookie, attempt.body.id, answers).expect(200);

      expect(Object.keys(response.body).sort()).toEqual(['expired', 'gradeAt', 'submittedAt']);
      expect(response.body.expired).toBe(false);
      // Not expired, so the work is judged at the instant it arrived.
      expect(response.body.gradeAt).toBe(response.body.submittedAt);
      const stored = await h.prisma.attempt.findUniqueOrThrow({
        where: { id: attempt.body.id },
        select: { submittedAt: true, expired: true, startedAt: true, expiresAt: true },
      });
      expect(stored.submittedAt!.toISOString()).toBe(response.body.submittedAt);
      expect(stored.expired).toBe(false);
      // Neither instant moved: submission closes an Attempt, it does not re-time it.
      expect(stored.startedAt.toISOString()).toBe(attempt.body.startedAt);
      expect(stored.expiresAt!.toISOString()).toBe(attempt.body.expiresAt);

      // Raw, and exactly what was sent — no fraction parsed, nothing normalized.
      const rows = await h.prisma.answer.findMany({
        where: { attemptId: attempt.body.id },
        select: { questionId: true, value: true },
      });
      expect(rows).toHaveLength(answers.length);
      expect([...rows].sort((a, b) => a.questionId.localeCompare(b.questionId))).toEqual(
        [...answers].sort((a, b) => a.questionId.localeCompare(b.questionId)),
      );
    });

    it('ignores a question that is not on this test, and a value that is blank', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      // A stale id in a browser's store is not a reason to lose a child's whole
      // paper, and an emptied field is a Question left blank rather than a 400.
      const strangers = await releasedForChild(null);
      const foreignQuestion = strangers.questionIds[0]!;

      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: '3/4' },
        { questionId: questionIds[1]!, value: '   ' },
        { questionId: foreignQuestion, value: 'from another test' },
        { questionId: randomUUID(), value: 'from nowhere' },
      ]).expect(200);

      const rows = await h.prisma.answer.findMany({
        where: { attemptId: attempt.body.id },
        select: { questionId: true, value: true },
      });
      expect(rows).toEqual([{ questionId: questionIds[0]!, value: '3/4' }]);
    });

    it('refuses a second hand-in with a stated reason, and the first result stands', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);
      const first = await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'kept' },
      ]).expect(200);

      // 409, not the shared 404: "already handed in" is a rule the child is
      // entitled to know about, where a 404 would make a successful hand-in look
      // like a lost one and invite the screen to send it again.
      const again = await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'overwritten' },
      ]).expect(409);
      expect(again.body.message).toBe(ATTEMPT_ALREADY_SUBMITTED);
      expect(again.body.message).not.toBe(PRACTICE_TEST_NOT_FOUND);

      // The first result stands, down to the stored value.
      const stored = await h.prisma.attempt.findUniqueOrThrow({
        where: { id: attempt.body.id },
        select: { submittedAt: true },
      });
      expect(stored.submittedAt!.toISOString()).toBe(first.body.submittedAt);
      const rows = await h.prisma.answer.findMany({
        where: { attemptId: attempt.body.id },
        select: { value: true },
      });
      expect(rows).toEqual([{ value: 'kept' }]);
    });

    it('judges an expired Attempt at its deadline rather than at the instant it arrived', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);
      // The deadline moved into the past, which is the state a submission that
      // crossed a network outage arrives in. Written straight to the column,
      // because nothing on the wire can move it — which is the point.
      const deadline = new Date(Date.now() - 60_000);
      await h.prisma.attempt.update({
        where: { id: attempt.body.id },
        data: { expiresAt: deadline },
      });

      const response = await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'entered before the outage' },
      ]).expect(200);

      expect(response.body.expired).toBe(true);
      // Judged at the expiry instant, not the arrival one.
      expect(response.body.gradeAt).toBe(deadline.toISOString());
      expect(response.body.gradeAt).not.toBe(response.body.submittedAt);
      expect(Date.parse(response.body.submittedAt)).toBeGreaterThan(deadline.getTime());
      const stored = await h.prisma.attempt.findUniqueOrThrow({
        where: { id: attempt.body.id },
        select: { expired: true },
      });
      expect(stored.expired).toBe(true);
      // And every answer entered before the outage is in the persisted set.
      expect(
        await h.prisma.answer.findMany({
          where: { attemptId: attempt.body.id },
          select: { value: true },
        }),
      ).toEqual([{ value: 'entered before the outage' }]);
    });

    it('leaves an untimed Attempt unexpired however long it is held open', async () => {
      const { id, cookie } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);

      const response = await submitAttempt(cookie, attempt.body.id, []).expect(200);

      expect(response.body.expired).toBe(false);
      expect(response.body.gradeAt).toBe(response.body.submittedAt);
    });

    it('refuses a hand-in of a sibling’s or a stranger’s Attempt with the shared sentence', async () => {
      const mine = await releasedForChild(20);
      const theirs = await releasedForChild(20);
      const theirAttempt = await startAttempt(theirs.cookie, theirs.id).expect(201);
      // A sibling on this same account, working on their own release.
      const grade = await createGradeLevel(h);
      const sibling = await createStudentProfile(h, mine.ready.parentAccountId, {
        gradeLevelId: grade.id,
      });
      const siblingCookie = await bindDevice(h, mine.ready.token, sibling.id);

      const unknown = await submitAttempt(mine.cookie, randomUUID(), []).expect(404);
      for (const refusal of [
        await submitAttempt(mine.cookie, theirAttempt.body.id, []).expect(404),
        await submitAttempt(siblingCookie, theirAttempt.body.id, []).expect(404),
        await submitAttempt(mine.cookie, 'not-a-uuid', []).expect(404),
        unknown,
      ]) {
        expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
        expect(refusal.body.message).toBe(unknown.body.message);
      }
      // And the Attempt somebody else's device addressed is untouched: still open.
      expect(
        (
          await h.prisma.attempt.findUniqueOrThrow({
            where: { id: theirAttempt.body.id },
            select: { submittedAt: true },
          })
        ).submittedAt,
      ).toBeNull();
    });

    it('refuses a hand-in on an unbound device', async () => {
      const { id, cookie } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);

      const unbound = await server()
        .post(`/api/student/attempts/${attempt.body.id}/submit`)
        .send({ answers: [] })
        .expect(401);
      expect(unbound.body.bound).toBe(false);
      expect(
        (
          await h.prisma.attempt.findUniqueOrThrow({
            where: { id: attempt.body.id },
            select: { submittedAt: true },
          })
        ).submittedAt,
      ).toBeNull();
    });

    it('bounds the one student-authored body it accepts', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);

      // A body that said nothing is malformed; `[]` is a legitimate hand-in.
      await submitAttempt(cookie, attempt.body.id, undefined as never).expect(400);
      // Values bounded by length, and the array by size. One past each ceiling.
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'x'.repeat(MAX_ANSWER_LENGTH + 1) },
      ]).expect(400);
      await submitAttempt(
        cookie,
        attempt.body.id,
        Array.from({ length: MAX_ANSWERS_PER_SUBMISSION + 1 }, () => ({
          questionId: questionIds[0]!,
          value: 'x',
        })),
      ).expect(400);
      // And an id longer than an id can be. Its own ceiling, not the answer's.
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: 'q'.repeat(MAX_QUESTION_ID_LENGTH + 1), value: 'x' },
      ]).expect(400);
      // None of them wrote anything.
      expect(await h.prisma.answer.count({ where: { attemptId: attempt.body.id } })).toBe(0);
      expect(
        (
          await h.prisma.attempt.findUniqueOrThrow({
            where: { id: attempt.body.id },
            select: { submittedAt: true },
          })
        ).submittedAt,
      ).toBeNull();
    });

    it('accepts a body at the very edge of every bound rather than refusing it in transport', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);

      // **Exactly** the maximum, not one past it: the ceiling the DTO allows has to be
      // a ceiling the transport allows too. Express defaults to a 100KB JSON body,
      // which this is far beyond — so without `MAX_JSON_BODY_BYTES` raising it, the
      // largest legitimate paper a child can hand in is refused as a 413 before
      // validation ever sees it. The screen reads that as the generic failure and the
      // child presses Hand in forever on work that will never be taken.
      //
      // The real question ids are reused round-robin, so every answer is one the
      // service keeps: this measures the accepted body, not the ignored one.
      const answers = Array.from({ length: MAX_ANSWERS_PER_SUBMISSION }, (_unused, at) => ({
        questionId: questionIds[at % questionIds.length]!,
        value: 'x'.repeat(MAX_ANSWER_LENGTH),
      }));
      expect(JSON.stringify({ answers }).length).toBeGreaterThan(100 * 1024);

      const response = await submitAttempt(cookie, attempt.body.id, answers).expect(200);

      expect(response.body.expired).toBe(false);
      // One row per distinct Question, because the map keys by Question: the point of
      // the case is that the body was accepted, not how many rows it came to.
      expect(await h.prisma.answer.count({ where: { attemptId: attempt.body.id } })).toBe(
        questionIds.length,
      );
    });

    it('refuses the loser of two simultaneous hand-ins with the 409, never a 500', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);

      // Both in flight together, so both read `submittedAt: null`. Under
      // read-committed isolation the up-front check cannot separate them — the
      // conditional close is what does, and without it the loser collides on
      // `answer_attemptId_questionId_key` and surfaces as a 500.
      const [first, second] = await Promise.all([
        submitAttempt(cookie, attempt.body.id, [{ questionId: questionIds[0]!, value: 'one' }]),
        submitAttempt(cookie, attempt.body.id, [{ questionId: questionIds[0]!, value: 'two' }]),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(loser.body.message).toBe(ATTEMPT_ALREADY_SUBMITTED);
      // Exactly one hand-in landed, and exactly one set of answers with it.
      const rows = await h.prisma.answer.findMany({
        where: { attemptId: attempt.body.id },
        select: { value: true },
      });
      expect(rows).toHaveLength(1);
      expect(['one', 'two']).toContain(rows[0]!.value);
    });

    it('resumes rather than faulting when two starts race for the same Attempt', async () => {
      const { id, cookie } = await releasedForChild(20);

      // Two tabs opening the same test. Both find no row and both insert `ordinal: 1`;
      // the unique index refuses the loser, which then resumes the winner's row. The
      // method's own promise is that a second tab resumes, so a 500 here would be that
      // promise broken at exactly the moment it is needed.
      const [first, second] = await Promise.all([
        startAttempt(cookie, id),
        startAttempt(cookie, id),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      // One row, one deadline: whichever request lost, it came back with the same
      // instants the winner wrote rather than a second Attempt of its own.
      expect(first.body.id).toBe(second.body.id);
      expect(first.body.startedAt).toBe(second.body.startedAt);
      expect(first.body.expiresAt).toBe(second.body.expiresAt);
      expect(await h.prisma.attempt.count({ where: { practiceTestId: id } })).toBe(1);
    });

    it('carries no answer, no correctness, no topic and no parent-scoped figure on either route', async () => {
      const { id, cookie, questionIds, ready } = await releasedForChild(20);

      const started = await startAttempt(cookie, id).expect(201);
      const submitted = await submitAttempt(cookie, started.body.id, [
        { questionId: questionIds[0]!, value: '3/4' },
      ]).expect(200);

      // Over the raw JSON of both, not field by field: a field-by-field check
      // passes on exactly the shape it was written against and says nothing about a
      // key a later edit adds.
      for (const body of [started.body, submitted.body]) {
        const serialized = JSON.stringify(body);
        for (const key of [
          'answer',
          'answers',
          'isCorrect',
          'topics',
          'topic',
          'cost',
          'tier',
          'model',
          'allowance',
          'timerMinutes',
          'score',
          'studentProfileId',
          'parentAccountId',
        ]) {
          expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'iu'));
        }
        expect(serialized).not.toContain('isCorrect');
        expect(serialized).not.toMatch(/allowance|tier|free|unlimited|gpt|model/iu);
        // Not one grade or score word, and not the account's own id.
        expect(serialized).not.toMatch(/grade(?!At)|score|correct|wrong/iu);
        expect(serialized).not.toContain(ready.parentAccountId);
        expect(serialized).not.toContain(ready.studentProfileId);
      }
    });

    // --- What a blank means, once the work is in ---------------------------
    //
    // Story 5.4's own cases. Every one of them goes over the **unchanged** HTTP
    // path: the route moved from `practicetest` into `grading` and nothing about
    // its contract did, which is why the cases above still pin it untouched.
    //
    // A grade row is a fact no student-scoped response carries, so it is read
    // straight from the table — the only place it can be seen.

    /** This Attempt's grade rows, by Question. Nothing on any surface shows one. */
    async function gradesOf(attemptId: string): Promise<Map<string, string>> {
      const rows = await h.prisma.questionGrade.findMany({
        where: { attemptId },
        select: { questionId: true, state: true },
      });
      return new Map(rows.map((row) => [row.questionId, row.state]));
    }

    /** The same rows, whole: the state **and** the rationale beside it. */
    async function gradeRowsOf(
      attemptId: string,
    ): Promise<Map<string, { state: string; rationale: string | null }>> {
      const rows = await h.prisma.questionGrade.findMany({
        where: { attemptId },
        select: { questionId: true, state: true, rationale: true },
      });
      return new Map(
        rows.map((row) => [row.questionId, { state: row.state, rationale: row.rationale }]),
      );
    }

    /**
     * Every `Grading` call the seam recorded, so "exactly one" and "none at all"
     * are both claims about the wire rather than about a row.
     *
     * Filtered by class, because the fixtures above make Extraction, Legibility
     * and Generation calls of their own on the way to a released test.
     */
    function gradingCalls() {
      return h.ai.sent.filter((call) => call.callClass === 'Grading');
    }

    /** The ordinal of the option flagged correct on a Multiple Choice Question. */
    async function correctOrdinalOf(questionId: string): Promise<number> {
      const choice = await h.prisma.practiceTestChoice.findFirstOrThrow({
        where: { questionId, isCorrect: true },
        select: { ordinal: true },
      });
      return choice.ordinal;
    }

    /**
     * Rewrites one Question of a released test into a free-text one with a stored
     * answer.
     *
     * The fake Extraction yields only Multiple Choice usable questions, so the
     * free-text shape is written straight onto a real landed row — exactly as the
     * released-detail cases above do it. What is under test is how an answer to a
     * free-text Question grades, not what the generator chose to produce.
     */
    async function asFreeText(
      questionId: string,
      format: 'FillInTheBlank' | 'ShortAnswer',
      answer: string,
    ): Promise<void> {
      await h.prisma.practiceTestChoice.deleteMany({ where: { questionId } });
      await h.prisma.practiceTestQuestion.update({
        where: { id: questionId },
        data: { format, answer: [{ kind: 'text', value: answer }] },
      });
    }

    /** The engine, reached through the module: no route mounts it until Story 5.6. */
    function grading() {
      return h.moduleRef.get(GradingService);
    }

    it('records one Unanswered per blank Question on an untimed hand-in, and a verdict for the answered one', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const [answered, ...blanks] = questionIds;
      expect(blanks.length).toBeGreaterThan(0);

      await submitAttempt(cookie, attempt.body.id, [
        { questionId: answered!, value: '3/4' },
      ]).expect(200);

      // Persisted, not derived: FR-37 forbids reading a blank off an empty answer
      // field at display time, because a blank on an Attempt whose time ran out
      // means something else entirely.
      const grades = await gradesOf(attempt.body.id);
      expect(grades.size).toBe(questionIds.length);
      for (const blank of blanks) expect(grades.get(blank)).toBe('Unanswered');
      // The answered Question is Multiple Choice and `3/4` is not one of its
      // ordinals, so it is `Incorrect` — never `Ungraded`, because no provider was
      // asked and none could have failed.
      expect(grades.get(answered!)).toBe('Incorrect');
      expect(gradingCalls()).toHaveLength(0);
    });

    it('records the same rows on a timed test whose deadline has not passed', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);

      const response = await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'done' },
      ]).expect(200);

      // Timed or untimed makes no difference while there was still time: what
      // decides is `expired`, and the server said false.
      expect(response.body.expired).toBe(false);
      const grades = await gradesOf(attempt.body.id);
      expect(grades.size).toBe(questionIds.length);
      for (const blank of questionIds.slice(1)) expect(grades.get(blank)).toBe('Unanswered');
      expect(grades.get(questionIds[0]!)).toBe('Incorrect');
    });

    it('records one verdict per Question and no Unanswered when every Question was answered', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);

      await submitAttempt(
        cookie,
        attempt.body.id,
        questionIds.map((questionId, position) => ({ questionId, value: `answer ${position}` })),
      ).expect(200);

      // Every Question presented carries exactly one row, and there is no blank to
      // record — so not one of them is `Unanswered`.
      const grades = await gradesOf(attempt.body.id);
      expect(grades.size).toBe(questionIds.length);
      expect([...grades.values()]).toEqual(questionIds.map(() => 'Incorrect'));
      expect(await h.prisma.answer.count({ where: { attemptId: attempt.body.id } })).toBe(
        questionIds.length,
      );
    });

    it('records one Unanswered per Question when the body answers nothing', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);

      // `[]` is a legitimate hand-in: a child may hand a blank paper in, having
      // been asked about it on the screen first.
      await submitAttempt(cookie, attempt.body.id, []).expect(200);

      expect(await h.prisma.answer.count({ where: { attemptId: attempt.body.id } })).toBe(0);
      const grades = await gradesOf(attempt.body.id);
      expect(grades.size).toBe(questionIds.length);
      for (const questionId of questionIds) expect(grades.get(questionId)).toBe('Unanswered');
    });

    it('grades every blank Incorrect once the deadline has passed, and nothing Unanswered', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);
      const deadline = new Date(Date.now() - 60_000);
      await h.prisma.attempt.update({
        where: { id: attempt.body.id },
        data: { expiresAt: deadline },
      });

      const response = await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'entered before the outage' },
      ]).expect(200);

      // FR-37 grades the blanks of an Attempt whose time ran out `Incorrect`, and
      // nothing is `Unanswered` on this path: `Unanswered` is a Question the child
      // *chose* to leave, and the clock chose for them here.
      expect(response.body.expired).toBe(true);
      expect(response.body.gradeAt).toBe(deadline.toISOString());
      const grades = await gradesOf(attempt.body.id);
      expect(grades.size).toBe(questionIds.length);
      expect([...grades.values()]).toEqual(questionIds.map(() => 'Incorrect'));
    });

    it('counts a whitespace-only value as a blank and grades it Unanswered', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);

      // Dropped by the write path as today — and the Question it named is blank,
      // because a field emptied back to spaces is a Question left blank.
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: '   ' },
        { questionId: questionIds[1]!, value: 'real' },
      ]).expect(200);

      expect(
        await h.prisma.answer.findMany({
          where: { attemptId: attempt.body.id },
          select: { questionId: true },
        }),
      ).toEqual([{ questionId: questionIds[1]! }]);
      const grades = await gradesOf(attempt.body.id);
      expect(grades.get(questionIds[0]!)).toBe('Unanswered');
      // The Question that was really answered is judged, not left row-less.
      expect(grades.get(questionIds[1]!)).toBe('Incorrect');
      expect(grades.size).toBe(questionIds.length);
    });

    it('lets a stale foreign question id neither write an answer nor suppress a real blank', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const strangers = await releasedForChild(null);

      // A stale id in a browser's store names a Question that is not on this test,
      // so it writes nothing — and it cannot make any Question of *this* test look
      // answered either. Which Questions are blank is the server's own subtraction.
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: strangers.questionIds[0]!, value: 'from another test' },
        { questionId: randomUUID(), value: 'from nowhere' },
      ]).expect(200);

      expect(await h.prisma.answer.count({ where: { attemptId: attempt.body.id } })).toBe(0);
      const grades = await gradesOf(attempt.body.id);
      expect(grades.size).toBe(questionIds.length);
      for (const questionId of questionIds) expect(grades.get(questionId)).toBe('Unanswered');
      // And no row was written against a Question of the other child's test.
      expect(grades.has(strangers.questionIds[0]!)).toBe(false);
    });

    it('writes one answer and no blank for a Question the body names twice', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const [twice, ...blanks] = questionIds;

      // A browser that restated one Question twice is not a submission to lose: the
      // write path keys by Question, so the last value stands as one row — and that
      // Question is answered, so it is not among the blanks the subtraction finds.
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: twice!, value: 'first' },
        { questionId: twice!, value: 'second' },
      ]).expect(200);

      const answers = await h.prisma.answer.findMany({
        where: { attemptId: attempt.body.id },
        select: { questionId: true, value: true },
      });
      expect(answers).toEqual([{ questionId: twice!, value: 'second' }]);
      const grades = await gradesOf(attempt.body.id);
      // One row for it, not two: the unique index says a grade is a fact about one
      // (Attempt, Question) pair however many times the body named it.
      expect(grades.get(twice!)).toBe('Incorrect');
      expect(grades.size).toBe(blanks.length + 1);
      for (const blank of blanks) expect(grades.get(blank)).toBe('Unanswered');
    });

    it('leaves exactly one set of grade rows when two hand-ins race, and refuses the loser', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);

      // Both in flight together. The close is conditional, so exactly one
      // transaction closes the Attempt — and the other rolls back before it could
      // write a grade row, which is what keeps the unique index from surfacing as
      // a 500 in place of the stated refusal.
      const [first, second] = await Promise.all([
        submitAttempt(cookie, attempt.body.id, [{ questionId: questionIds[0]!, value: 'one' }]),
        submitAttempt(cookie, attempt.body.id, [{ questionId: questionIds[0]!, value: 'two' }]),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(loser.body.message).toBe(ATTEMPT_ALREADY_SUBMITTED);
      const grades = await gradesOf(attempt.body.id);
      expect(grades.size).toBe(questionIds.length);
      for (const blank of questionIds.slice(1)) expect(grades.get(blank)).toBe('Unanswered');
      expect(grades.get(questionIds[0]!)).toBe('Incorrect');
    });

    it('re-refuses a second hand-in without rewriting the grade rows the first wrote', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'kept' },
      ]).expect(200);
      const stored = await h.prisma.questionGrade.findMany({
        where: { attemptId: attempt.body.id },
        select: { id: true, questionId: true, state: true, updatedAt: true },
        orderBy: { questionId: 'asc' },
      });

      const again = await submitAttempt(cookie, attempt.body.id, []).expect(409);

      expect(again.body.message).toBe(ATTEMPT_ALREADY_SUBMITTED);
      // The same rows, down to the ids and the update instants: the refusal comes
      // before anything is written, so nothing was re-written.
      expect(
        await h.prisma.questionGrade.findMany({
          where: { attemptId: attempt.body.id },
          select: { id: true, questionId: true, state: true, updatedAt: true },
          orderBy: { questionId: 'asc' },
        }),
      ).toEqual(stored);
    });

    it('carries no grade, state, score or rationale on the hand-in it answers with', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);

      // Every Question blank, so the grade rows definitely exist — and the body
      // still says nothing about them. Asserted over the raw JSON rather than field
      // by field, so a key a later edit adds is caught too.
      const response = await submitAttempt(cookie, attempt.body.id, []).expect(200);

      expect(await h.prisma.questionGrade.count({ where: { attemptId: attempt.body.id } })).toBe(
        questionIds.length,
      );
      const serialized = JSON.stringify(response.body);
      expect(Object.keys(response.body).sort()).toEqual(['expired', 'gradeAt', 'submittedAt']);
      for (const key of ['state', 'grades', 'grade', 'score', 'rationale', 'blankQuestionIds']) {
        expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'iu'));
      }
      expect(serialized).not.toMatch(/unanswered|incorrect|ungraded|correct/iu);
    });

    // --- What an answer came to: Story 5.5's engine ------------------------
    //
    // Every case here goes over the **unchanged** HTTP path as well. The route did
    // not move and its body did not change; what changed is that the transaction
    // behind it now grades, and a grade is still a fact no student-scoped response
    // carries — so it is read straight from the table.

    it('grades an answered Multiple Choice on the flagged option Correct, with no rationale and no AI call', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const correct = await correctOrdinalOf(questionIds[0]!);

      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: String(correct) },
      ]).expect(200);

      const rows = await gradeRowsOf(attempt.body.id);
      expect(rows.get(questionIds[0]!)).toEqual({ state: 'Correct', rationale: null });
      // Decided in code, deterministically: not one provider call was made, and a
      // rationale would be a reason nothing gave.
      expect(gradingCalls()).toHaveLength(0);
    });

    it('grades another ordinal and a value that is no ordinal at all Incorrect, and never Ungraded', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const correct = await correctOrdinalOf(questionIds[0]!);
      const attempt = await startAttempt(cookie, id).expect(201);

      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: String(correct + 1) },
        { questionId: questionIds[1]!, value: 'not an ordinal' },
      ]).expect(200);

      const rows = await gradeRowsOf(attempt.body.id);
      expect(rows.get(questionIds[0]!)).toEqual({ state: 'Incorrect', rationale: null });
      // `Ungraded` would claim a provider was asked and could not answer. None was.
      expect(rows.get(questionIds[1]!)).toEqual({ state: 'Incorrect', rationale: null });
      expect(gradingCalls()).toHaveLength(0);
    });

    it('credits nothing to a value that merely starts with the right digits', async () => {
      // `Number.parseInt` reads every one of these as the flagged ordinal, and none
      // of them is a value the screen could have submitted. The rule is that what is
      // not an ordinal is `Incorrect` — so the comparison refuses it before it is
      // made rather than crediting a near miss.
      const { id, cookie, questionIds } = await releasedForChild(null);
      // Both Questions' right option is the first one, so `1abc` and `1.9` would
      // each be credited if the value were merely parsed rather than checked.
      expect(await correctOrdinalOf(questionIds[0]!)).toBe(1);
      expect(await correctOrdinalOf(questionIds[1]!)).toBe(1);
      const attempt = await startAttempt(cookie, id).expect(201);

      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: '1abc' },
        { questionId: questionIds[1]!, value: '1.9' },
      ]).expect(200);

      const rows = await gradeRowsOf(attempt.body.id);
      expect(rows.get(questionIds[0]!)).toEqual({ state: 'Incorrect', rationale: null });
      expect(rows.get(questionIds[1]!)).toEqual({ state: 'Incorrect', rationale: null });
      expect(gradingCalls()).toHaveLength(0);

      // And the flagged ordinal itself, padded, still reads as the choice it is:
      // what is refused is a value that is not a number, not one with spaces round
      // one.
      const other = await releasedForChild(null);
      const padded = await startAttempt(other.cookie, other.id).expect(201);
      await submitAttempt(other.cookie, padded.body.id, [
        { questionId: other.questionIds[0]!, value: ' 1 ' },
      ]).expect(200);
      expect((await gradesOf(padded.body.id)).get(other.questionIds[0]!)).toBe('Correct');
    });

    it('grades answered free text through exactly one Grading call, each with a persisted rationale', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      expect(questionIds.length).toBeGreaterThan(1);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      await asFreeText(questionIds[1]!, 'ShortAnswer', 'Because it is half of the whole');
      const attempt = await startAttempt(cookie, id).expect(201);

      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
        { questionId: questionIds[1]!, value: 'Because it is half of the whole' },
      ]).expect(200);

      // One call for both of them together, not one per Question: submission blocks
      // on grading, and a paper's worth of sequential round trips is a screen a
      // child is waiting at.
      const calls = gradingCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.modality).toBe('text');
      expect(calls[0]!.imageCount).toBe(0);
      const rows = await gradeRowsOf(attempt.body.id);
      for (const questionId of [questionIds[0]!, questionIds[1]!]) {
        expect(rows.get(questionId)!.state).toBe('Correct');
        // A rationale on its own row, for the parent to read later. A rationale
        // written only to a log would not satisfy this.
        expect(rows.get(questionId)!.rationale!.trim().length).toBeGreaterThan(0);
      }
    });

    it('names no blank Question in the call, and makes none at all when nothing free-text was answered', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);

      // The free-text Question is the blank one, and the answered Question is
      // Multiple Choice — so there is nothing to ask about and nothing is asked.
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[1]!, value: '1' },
      ]).expect(200);

      expect(gradingCalls()).toHaveLength(0);
      const rows = await gradeRowsOf(attempt.body.id);
      // The blank free-text Question is `Unanswered` and never `Ungraded`: nothing
      // failed, because nothing was asked.
      expect(rows.get(questionIds[0]!)).toEqual({ state: 'Unanswered', rationale: null });
      expect(rows.get(questionIds[1]!)!.rationale).toBeNull();
      expect(rows.size).toBe(questionIds.length);
    });

    it('tolerates casing and whitespace on a free-text answer, and marks a wrong one Incorrect with a rationale', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Answer for 1.2');
      await asFreeText(questionIds[1]!, 'ShortAnswer', 'Answer for 1.3');
      const attempt = await startAttempt(cookie, id).expect(201);

      await submitAttempt(cookie, attempt.body.id, [
        // The same answer, written differently. Casing, whitespace, notation and
        // phrasing are tolerated; the child still knew it.
        { questionId: questionIds[0]!, value: '  answer for 1.2 ' },
        { questionId: questionIds[1]!, value: 'something else entirely' },
      ]).expect(200);

      const rows = await gradeRowsOf(attempt.body.id);
      expect(rows.get(questionIds[0]!)!.state).toBe('Correct');
      expect(rows.get(questionIds[1]!)!.state).toBe('Incorrect');
      // A wrong answer is explained too: the rationale is what a parent decides an
      // override on, and it is needed most where the verdict went against the child.
      expect(rows.get(questionIds[1]!)!.rationale!.trim().length).toBeGreaterThan(0);
      expect(gradingCalls()).toHaveLength(1);
    });

    it('still hands in with its usual 200 and shape when grading is unavailable, leaving the free text Ungraded', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const correct = await correctOrdinalOf(questionIds[1]!);
      const attempt = await startAttempt(cookie, id).expect(201);

      h.ai.failNext('transport');
      const response = await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
        { questionId: questionIds[1]!, value: String(correct) },
      ]).expect(200);

      // The hand-in stands. A child who did the work does not lose it because a
      // provider was down.
      expect(Object.keys(response.body).sort()).toEqual(['expired', 'gradeAt', 'submittedAt']);
      const rows = await gradeRowsOf(attempt.body.id);
      // `Ungraded` and not `Incorrect`: nothing is marked wrong for want of a
      // provider, and no rationale is invented for a verdict nothing reached.
      expect(rows.get(questionIds[0]!)).toEqual({ state: 'Ungraded', rationale: null });
      // And the deterministic verdict stands, because it never needed the network.
      expect(rows.get(questionIds[1]!)).toEqual({ state: 'Correct', rationale: null });
    });

    it('re-asks only the Ungraded Questions on resolveUngraded, reports the recomputed score, and re-asks nothing twice', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      h.ai.failNext('transport');
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);
      expect((await gradesOf(attempt.body.id)).get(questionIds[0]!)).toBe('Ungraded');
      const callsAfterSubmit = gradingCalls().length;

      const first = await grading().resolveUngraded(
        { parentAccountId: ready.parentAccountId, studentProfileId: ready.studentProfileId },
        attempt.body.id,
      );

      // Exactly the Question that was outstanding, and the score over the gradable
      // ones with nothing excluded any more.
      expect(first.newlyGradedQuestionIds).toEqual([questionIds[0]!]);
      expect(first.score).toEqual({
        correct: 1,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
      const rows = await gradeRowsOf(attempt.body.id);
      expect(rows.get(questionIds[0]!)!.state).toBe('Correct');
      expect(rows.get(questionIds[0]!)!.rationale!.trim().length).toBeGreaterThan(0);
      expect(gradingCalls()).toHaveLength(callsAfterSubmit + 1);

      const second = await grading().resolveUngraded(
        { parentAccountId: ready.parentAccountId },
        attempt.body.id,
      );

      // Nothing outstanding: no AI call at all, nothing newly graded, the score as
      // stored. And a parent reaches it by account alone.
      expect(second.newlyGradedQuestionIds).toEqual([]);
      expect(second.score).toEqual(first.score);
      expect(gradingCalls()).toHaveLength(callsAfterSubmit + 1);
    });

    it('leaves the rows Ungraded and still answers when the re-ask fails too', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      h.ai.failNext('transport');
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);

      h.ai.failNext('transport');
      const resolved = await grading().resolveUngraded(
        { parentAccountId: ready.parentAccountId },
        attempt.body.id,
      );

      // A read that could not improve a score is not a read that should refuse.
      expect(resolved.newlyGradedQuestionIds).toEqual([]);
      expect(resolved.score).toEqual({
        correct: 0,
        denominator: questionIds.length - 1,
        excludedUngraded: 1,
      });
      expect((await gradeRowsOf(attempt.body.id)).get(questionIds[0]!)).toEqual({
        state: 'Ungraded',
        rationale: null,
      });
    });

    it('re-asks a payload that judged nothing, and takes the verdict the second answer carried', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);

      // `unusable` has no meaning for a text call, so the fake answers with an
      // empty verdict list — a payload that parsed and judged nothing, which is
      // the post-hoc rejection this loop exists for. One call is latched, so the
      // re-ask is answered properly.
      const restore = withAttempts(2);
      h.ai.failNext('unusable');
      try {
        await submitAttempt(cookie, attempt.body.id, [
          { questionId: questionIds[0]!, value: 'Two halves' },
        ]).expect(200);
      } finally {
        restore();
      }

      // Asked twice, graded once: the rejection cost a round trip, not a verdict.
      expect(gradingCalls()).toHaveLength(2);
      const row = (await gradeRowsOf(attempt.body.id)).get(questionIds[0]!)!;
      expect(row.state).toBe('Correct');
      expect(row.rationale!.trim().length).toBeGreaterThan(0);
    });

    it('leaves a Question Ungraded once every re-ask was rejected after parsing', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const correct = await correctOrdinalOf(questionIds[1]!);
      const attempt = await startAttempt(cookie, id).expect(201);
      const maxAttempts = 2;
      const restore = withAttempts(maxAttempts);

      // Latched for the whole hand-in rather than for one call, which is what
      // makes this exhaustion rather than the recovery above.
      const saved = process.env.AI_FAKE_FAILURE;
      process.env.AI_FAKE_FAILURE = 'unusable';
      try {
        await submitAttempt(cookie, attempt.body.id, [
          { questionId: questionIds[0]!, value: 'Two halves' },
          { questionId: questionIds[1]!, value: String(correct) },
        ]).expect(200);
      } finally {
        if (saved === undefined) delete process.env.AI_FAKE_FAILURE;
        else process.env.AI_FAKE_FAILURE = saved;
        restore();
      }

      // Bounded by the same figure `AiService` retries an upstream fault under.
      expect(gradingCalls()).toHaveLength(maxAttempts);
      const rows = await gradeRowsOf(attempt.body.id);
      // Degraded, not guessed: `Ungraded` with no rationale, and the deterministic
      // verdict beside it untouched.
      expect(rows.get(questionIds[0]!)).toEqual({ state: 'Ungraded', rationale: null });
      expect(rows.get(questionIds[1]!)).toEqual({ state: 'Correct', rationale: null });
    });

    it('never overwrites an Unanswered, a Correct or an Incorrect', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Answer for 1.2');
      // A third Question, so all three of the states this case is about are on one
      // Attempt: the fake Extraction yields only Multiple Choice usable questions,
      // so a free-text Question to leave blank is written onto the row directly.
      await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: id,
          ordinal: questionIds.length + 1,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'Explain how you worked that out.' }],
          answer: [{ kind: 'text', value: 'Any reasoning that reaches it' }],
          topics: { create: [{ label: 'Fractions' }] },
        },
      });
      const attempt = await startAttempt(cookie, id).expect(201);
      // One free-text answer judged wrong by a provider, one Multiple Choice answer
      // judged right in code, and one Question left blank.
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'wrong on purpose' },
        { questionId: questionIds[1]!, value: String(await correctOrdinalOf(questionIds[1]!)) },
      ]).expect(200);
      const select = {
        questionId: true,
        state: true,
        rationale: true,
        updatedAt: true,
      } as const;
      const before = await h.prisma.questionGrade.findMany({
        where: { attemptId: attempt.body.id },
        select,
        orderBy: { questionId: 'asc' },
      });
      expect(new Set(before.map((row) => row.state))).toEqual(
        new Set(['Incorrect', 'Correct', 'Unanswered']),
      );
      const callsBefore = gradingCalls().length;

      const resolved = await grading().resolveUngraded(
        { parentAccountId: ready.parentAccountId },
        attempt.body.id,
      );

      // Not one row touched, down to the update instants — and no provider asked,
      // because nothing was outstanding to ask about.
      expect(resolved.newlyGradedQuestionIds).toEqual([]);
      expect(gradingCalls()).toHaveLength(callsBefore);
      expect(
        await h.prisma.questionGrade.findMany({
          where: { attemptId: attempt.body.id },
          select,
          orderBy: { questionId: 'asc' },
        }),
      ).toEqual(before);
    });

    it("answers the one shared 404 for a foreign Attempt, another profile's, and one still open", async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      const strangers = await releasedForChild(null);
      const open = await startAttempt(cookie, id).expect(201);
      await submitAttempt(cookie, open.body.id, [
        { questionId: questionIds[0]!, value: '1' },
      ]).expect(200);
      const stillOpen = await startAttempt(strangers.cookie, strangers.id).expect(201);

      // Another account's Attempt.
      await expect(
        grading().resolveUngraded({ parentAccountId: ready.parentAccountId }, stillOpen.body.id),
      ).rejects.toThrow(PRACTICE_TEST_NOT_FOUND);
      // This account's own Attempt, asked for under another profile's binding.
      await expect(
        grading().resolveUngraded(
          {
            parentAccountId: ready.parentAccountId,
            studentProfileId: strangers.ready.studentProfileId,
          },
          open.body.id,
        ),
      ).rejects.toThrow(PRACTICE_TEST_NOT_FOUND);
      // And an Attempt that is still open: nothing has been handed in to grade, and
      // that is not a different flavour of refusal (AD-18).
      await expect(
        grading().resolveUngraded(
          { parentAccountId: strangers.ready.parentAccountId },
          stillOpen.body.id,
        ),
      ).rejects.toThrow(PRACTICE_TEST_NOT_FOUND);
      // An unknown id answers the same sentence.
      await expect(
        grading().resolveUngraded({ parentAccountId: ready.parentAccountId }, randomUUID()),
      ).rejects.toThrow(PRACTICE_TEST_NOT_FOUND);
    });

    it('bills the Grading call rather than recording it free', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);

      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);

      // The sibling of the Generation billing case, and it has to be asserted here
      // rather than inferred from the seam: `AiService` swallows a cost row it could
      // not write, so a `Grading` class that was never billed would look exactly
      // like one that was.
      const costs = await h.prisma.aiCall.findMany({
        where: { parentAccountId: ready.parentAccountId, callClass: 'Grading' },
      });
      expect(costs).toHaveLength(1);
      expect(costs[0]!.inputTokens).toBeGreaterThan(0);
      expect(costs[0]!.costMicros).toBeGreaterThan(0);
      // Identifiers, counts and money only: nothing the child wrote and nothing the
      // model said reaches the row (AD-20).
      expect(Object.values(costs[0]!).join(' ')).not.toContain('Two halves');
    });

    it('re-decides a row-less Question of a manually handed-in Attempt with no provider call', async () => {
      // The branch the crash-recovery doc rests on: a hand-in whose second
      // transaction never landed leaves those Questions **row-less** on a submitted
      // Attempt, which `resolveUngraded` treats exactly as a stored `Ungraded`. The
      // rows are deleted to stand in for that crash.
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const correct = await correctOrdinalOf(questionIds[0]!);
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: String(correct) },
      ]).expect(200);
      const handedIn = await gradesOf(attempt.body.id);
      await h.prisma.questionGrade.deleteMany({ where: { attemptId: attempt.body.id } });
      const callsBefore = gradingCalls().length;

      const resolved = await grading().resolveUngraded(
        { parentAccountId: ready.parentAccountId },
        attempt.body.id,
      );

      // Exactly the states the hand-in wrote, decided again in code — the blanks
      // `Unanswered`, because the server judged this Attempt unexpired.
      expect(await gradesOf(attempt.body.id)).toEqual(handedIn);
      expect((await gradesOf(attempt.body.id)).get(questionIds[0]!)).toBe('Correct');
      expect(
        [...(await gradesOf(attempt.body.id)).values()].filter((state) => state === 'Unanswered'),
      ).toHaveLength(questionIds.length - 1);
      // Not one provider call: nothing free-text was answered, so there was nothing
      // to ask about.
      expect(gradingCalls()).toHaveLength(callsBefore);
      // Deterministic rows are not a verdict this pass reached on the child's behalf,
      // so nothing is reported as newly graded.
      expect(resolved.newlyGradedQuestionIds).toEqual([]);
      expect(resolved.score).toEqual({
        correct: 1,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
    });

    it('re-decides a row-less blank of an expired Attempt Incorrect, with no provider call', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(20);
      const attempt = await startAttempt(cookie, id).expect(201);
      await h.prisma.attempt.update({
        where: { id: attempt.body.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const response = await submitAttempt(cookie, attempt.body.id, []).expect(200);
      expect(response.body.expired).toBe(true);
      await h.prisma.questionGrade.deleteMany({ where: { attemptId: attempt.body.id } });
      const callsBefore = gradingCalls().length;

      const resolved = await grading().resolveUngraded(
        { parentAccountId: ready.parentAccountId },
        attempt.body.id,
      );

      // The stored `expired` decides, not the clock at the moment of this read: a
      // blank on an Attempt whose time ran out is `Incorrect`, and re-deciding it
      // later must reach the same verdict the hand-in did.
      const rows = await gradeRowsOf(attempt.body.id);
      expect(rows.size).toBe(questionIds.length);
      expect([...rows.values()]).toEqual(
        questionIds.map(() => ({ state: 'Incorrect', rationale: null })),
      );
      expect(gradingCalls()).toHaveLength(callsBefore);
      expect(resolved.newlyGradedQuestionIds).toEqual([]);
      expect(resolved.score).toEqual({
        correct: 0,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
    });

    it('carries no grade, state, score, rationale or correct answer on a hand-in that graded answers', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Answer for 1.2');
      const attempt = await startAttempt(cookie, id).expect(201);

      const response = await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Answer for 1.2' },
      ]).expect(200);

      // Every Question graded, and the body still says nothing about any of it.
      expect(await h.prisma.questionGrade.count({ where: { attemptId: attempt.body.id } })).toBe(
        questionIds.length,
      );
      const serialized = JSON.stringify(response.body);
      expect(Object.keys(response.body).sort()).toEqual(['expired', 'gradeAt', 'submittedAt']);
      for (const key of ['state', 'grades', 'grade', 'score', 'rationale', 'correct', 'verdicts']) {
        expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'iu'));
      }
      expect(serialized).not.toMatch(/unanswered|incorrect|ungraded|correct/iu);
      expect(serialized).not.toContain('Answer for 1.2');
    });

    it('reads Completed on Student Home once the Attempt has been handed in', async () => {
      const { id, cookie } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      // In progress until it is in: the band is derived from Attempts, not stored.
      expect((await readReleased(cookie).expect(200)).body[0].state).toBe('InProgress');

      await submitAttempt(cookie, attempt.body.id, []).expect(200);

      const response = await readReleased(cookie).expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(id);
      // Derived, with no `Completed` member on `PracticeTestStatus` and no status
      // write on submit: the stored row is still `Released`.
      expect(response.body[0].state).toBe('Completed');
      expect(
        (
          await h.prisma.practiceTest.findUniqueOrThrow({
            where: { id },
            select: { status: true },
          })
        ).status,
      ).toBe('Released');
    });

    // --- What the work came to: Story 5.6's answer key ---------------------
    //
    // The first student-scoped read of a grade anywhere in the product, and every
    // case here goes over the real HTTP path. It is a `GET` that legitimately
    // writes: FR-22 makes viewing the trigger, so opening results is what re-asks
    // for anything nothing has judged.

    /** The results read, carrying the binding cookie and no bearer. */
    function readResults(cookie: string, attemptId: string) {
      return server().get(`/api/student/attempts/${attemptId}/results`).set('Cookie', cookie);
    }

    /** The flagged option of a Multiple Choice Question: its ordinal and its body. */
    function correctChoiceOf(questionId: string) {
      return h.prisma.practiceTestChoice.findFirstOrThrow({
        where: { questionId, isCorrect: true },
        select: { ordinal: true, body: true },
      });
    }

    /** The Subject name actually classified onto a released test's source, read straight from storage. */
    async function subjectNameOf(practiceTestId: string): Promise<string> {
      const practiceTest = await h.prisma.practiceTest.findUniqueOrThrow({
        where: { id: practiceTestId },
        select: { sourceTestId: true },
      });
      const sourceTest = await h.prisma.sourceTest.findUniqueOrThrow({
        where: { id: practiceTest.sourceTestId },
        select: { subjectId: true },
      });
      const subject = await h.prisma.subject.findUniqueOrThrow({
        where: { id: sourceTest.subjectId! },
        select: { name: true },
      });
      return subject.name;
    }

    it('answers a fully answered Attempt with one row per Question in ordinal order, as option bodies', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const flagged = await Promise.all(
        questionIds.map((questionId) => correctChoiceOf(questionId)),
      );
      await submitAttempt(
        cookie,
        attempt.body.id,
        questionIds.map((questionId, at) => ({ questionId, value: String(flagged[at]!.ordinal) })),
      ).expect(200);

      const response = await readResults(cookie, attempt.body.id).expect(200);

      expect(response.body.attemptId).toBe(attempt.body.id);
      expect(response.body.practiceTestId).toBe(id);
      expect(response.body.questionCount).toBe(questionIds.length);
      // Proves `readSubjectLabels` is actually wired to this read, not just
      // present as a key on the wire.
      expect(response.body.subjectName).toBe(await subjectNameOf(id));
      // Every presented Question, in the order the child was shown them.
      expect(response.body.questions.map((row: { questionId: string }) => row.questionId)).toEqual(
        questionIds,
      );
      expect(response.body.questions.map((row: { ordinal: number }) => row.ordinal)).toEqual(
        questionIds.map((_, at) => at + 1),
      );
      // **Option bodies on both sides, never a bare ordinal**: the browser submits
      // `2` and a child cannot read `2` as an answer.
      for (const [at, row] of response.body.questions.entries()) {
        expect(row.state).toBe('Correct');
        expect(row.studentAnswer).toEqual(flagged[at]!.body);
        expect(row.correctAnswer).toEqual(flagged[at]!.body);
        expect(row.newlyGraded).toBe(false);
        // The direct claim: the answer is the option's **stored body**, which is a
        // segment array carrying the option's words — and specifically not the
        // one-text-segment form a bare ordinal would have travelled as.
        expect(Array.isArray(row.studentAnswer)).toBe(true);
        expect(row.studentAnswer).not.toEqual([
          { kind: 'text', value: String(flagged[at]!.ordinal) },
        ]);
        expect(row.studentAnswer[0].value).toContain('Option A for');
      }
      // The presented count, with nothing excluded and nothing newly graded.
      expect(response.body.score).toEqual({
        correct: questionIds.length,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
    });

    it('reads a blank on a manual hand-in as Unanswered, with no answer of its own, and still counts it', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const flagged = await correctChoiceOf(questionIds[0]!);
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: String(flagged.ordinal) },
      ]).expect(200);

      const response = await readResults(cookie, attempt.body.id).expect(200);

      const blanks = response.body.questions.slice(1);
      expect(blanks.length).toBeGreaterThan(0);
      for (const row of blanks) {
        expect(row.state).toBe('Unanswered');
        // Null rather than an empty string: the blank is the fact.
        expect(row.studentAnswer).toBeNull();
        // The answer is still shown — this is the answer key, and a Question the
        // child skipped is a Question they most need the answer to.
        expect(row.correctAnswer).not.toBeNull();
      }
      // `Unanswered` is in the denominator and earns no credit: a Question left
      // blank is one they got no marks for.
      expect(response.body.score).toEqual({
        correct: 1,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
    });

    it('resolves Ungraded rows on the first results read and reports the same score on the second', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      h.ai.failNext('transport');
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);
      expect((await gradesOf(attempt.body.id)).get(questionIds[0]!)).toBe('Ungraded');
      const callsBefore = gradingCalls().length;

      const first = await readResults(cookie, attempt.body.id).expect(200);

      // **The read is the retry.** One provider call, made by the view.
      expect(gradingCalls()).toHaveLength(callsBefore + 1);
      const resolved = first.body.questions.find(
        (row: { questionId: string }) => row.questionId === questionIds[0],
      );
      expect(resolved.state).toBe('Correct');
      expect(resolved.newlyGraded).toBe(true);
      // Its own typed words, not an ordinal: this is a free-text Question.
      expect(resolved.studentAnswer).toEqual([{ kind: 'text', value: 'Two halves' }]);
      // Exactly one row newly graded, and the denominator now covers the paper.
      expect(
        first.body.questions.filter((row: { newlyGraded: boolean }) => row.newlyGraded),
      ).toHaveLength(1);
      expect(first.body.score).toEqual({
        correct: 1,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });

      const second = await readResults(cookie, attempt.body.id).expect(200);

      // Nothing outstanding: no second provider call, nothing newly graded, and the
      // same score — `newlyGraded` is about the response it is on and nothing else.
      expect(gradingCalls()).toHaveLength(callsBefore + 1);
      expect(second.body.score).toEqual(first.body.score);
      expect(
        second.body.questions.filter((row: { newlyGraded: boolean }) => row.newlyGraded),
      ).toEqual([]);
    });

    it('still answers 200 with the gap named when the re-ask fails again', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      h.ai.failNext('transport');
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);

      h.ai.failNext('transport');
      const response = await readResults(cookie, attempt.body.id).expect(200);

      // A read that could not improve a score is not a read that should refuse.
      const stuck = response.body.questions.find(
        (row: { questionId: string }) => row.questionId === questionIds[0],
      );
      expect(stuck.state).toBe('Ungraded');
      expect(stuck.newlyGraded).toBe(false);
      // The gap is named rather than folded into the fraction: the score is over
      // the gradable Questions only, and `excludedUngraded` says how many were left
      // out.
      expect(response.body.score).toEqual({
        correct: 0,
        denominator: questionIds.length - 1,
        excludedUngraded: 1,
      });
    });

    it('reads a row-less Question as Ungraded once nothing can judge it', async () => {
      // The crash between a hand-in's two transactions: the rows are deleted to
      // stand in for it, and the free-text answer is then unaskable because the
      // provider keeps failing. A Question with no row and a stored `Ungraded` are
      // the same fact on the wire.
      const { id, cookie, questionIds } = await releasedForChild(null);
      await asFreeText(questionIds[0]!, 'FillInTheBlank', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      h.ai.failNext('transport');
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);
      await h.prisma.questionGrade.deleteMany({ where: { attemptId: attempt.body.id } });

      h.ai.failNext('transport');
      const response = await readResults(cookie, attempt.body.id).expect(200);

      // The deterministic verdicts were rewritten by the retry; the one Question
      // that needed a provider is still `Ungraded`, which is what "nothing has
      // judged this" reads as.
      expect(response.body.questions).toHaveLength(questionIds.length);
      const byQuestion = new Map(
        response.body.questions.map((row: { questionId: string; state: string }) => [
          row.questionId,
          row.state,
        ]),
      );
      expect(byQuestion.get(questionIds[0]!)).toBe('Ungraded');
      for (const blank of questionIds.slice(1)) expect(byQuestion.get(blank)).toBe('Unanswered');
      expect(response.body.score.excludedUngraded).toBe(1);
    });

    it('still answers 200 with null text when a stored prompt and answer cannot be read back', async () => {
      // The degrade-don't-throw branch, which is documented and would otherwise be
      // unexercised: a schema change or a bad write leaves a row whose stored `Json`
      // no longer passes `isRichText`, and the Attempt is already closed — so a
      // refusal here would make work that is safely graded unreadable for good. The
      // row is mutated straight through Prisma, as `asFreeText` does.
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const flagged = await correctChoiceOf(questionIds[0]!);
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: String(flagged.ordinal) },
      ]).expect(200);
      const graded = await gradesOf(attempt.body.id);
      expect(graded.get(questionIds[1]!)).toBe('Unanswered');
      // An empty array is not rich text — `parseRichText` refuses it as "a field the
      // model declined to fill while claiming to have filled it" — so both fields on
      // this Question now fail the check. The choice bodies go the same way, which is
      // what takes `correctAnswer` with them.
      await h.prisma.practiceTestQuestion.update({
        where: { id: questionIds[1]! },
        data: { prompt: [], answer: [] },
      });
      await h.prisma.practiceTestChoice.updateMany({
        where: { questionId: questionIds[1]! },
        data: { body: [] },
      });

      const response = await readResults(cookie, attempt.body.id).expect(200);

      const row = response.body.questions.find(
        (each: { questionId: string }) => each.questionId === questionIds[1],
      );
      expect(row.prompt).toBeNull();
      expect(row.correctAnswer).toBeNull();
      // The grade is untouched: the work was judged, and only the words are gone.
      expect(row.state).toBe('Unanswered');
      // And every other row is exactly as it was, so one unreadable Question costs
      // one row's text rather than the whole answer key.
      expect(response.body.questions).toHaveLength(questionIds.length);
      expect(
        response.body.questions.find(
          (each: { questionId: string }) => each.questionId === questionIds[0],
        ).correctAnswer,
      ).not.toBeNull();
      expect(response.body.score.denominator).toBe(questionIds.length);
    });

    it('answers a Multiple Choice value that matches no option with the raw stored string', async () => {
      // The other documented branch. The child's own answer is the one thing the row
      // must not invent, and `null` would tell them they did not answer — which is a
      // different fact with a different state beside it. The stored value is rewritten
      // to an ordinal this Question has no option for, standing in for a renumbered or
      // deleted choice.
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const flagged = await correctChoiceOf(questionIds[0]!);
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: '99' },
      ]).expect(200);
      // An ordinal no option carries is judged `Incorrect` by the comparison, never
      // `Ungraded`: no provider was asked and none could have failed.
      expect((await gradesOf(attempt.body.id)).get(questionIds[0]!)).toBe('Incorrect');

      const response = await readResults(cookie, attempt.body.id).expect(200);

      const row = response.body.questions[0];
      expect(row.state).toBe('Incorrect');
      // The raw string, as one text segment. Not null, and not a resolved body.
      expect(row.studentAnswer).toEqual([{ kind: 'text', value: '99' }]);
      // The answer key beside it still resolves, because that option does exist.
      expect(row.correctAnswer).toEqual(flagged.body);
    });

    it('answers null, not the raw ordinal, for a chosen Multiple Choice option whose stored body cannot be read back', async () => {
      // The degrade-don't-throw branch for a matched choice specifically: an ordinal
      // that resolves to a real option but whose stored `body` fails `isRichText`
      // must not fall through to the raw stored string -- that fallback is reserved
      // for the other branch, where the ordinal matches no option at all. Only the
      // chosen option is corrupted; the flagged option supplying `correctAnswer` is
      // untouched, so the two failure modes stay distinguishable.
      const { id, cookie, questionIds } = await releasedForChild(null);
      const attempt = await startAttempt(cookie, id).expect(201);
      const flagged = await correctChoiceOf(questionIds[0]!);
      const wrong = await h.prisma.practiceTestChoice.findFirstOrThrow({
        where: { questionId: questionIds[0]!, isCorrect: false },
        select: { id: true, ordinal: true },
      });
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: String(wrong.ordinal) },
      ]).expect(200);
      expect((await gradesOf(attempt.body.id)).get(questionIds[0]!)).toBe('Incorrect');
      await h.prisma.practiceTestChoice.update({
        where: { id: wrong.id },
        data: { body: [] },
      });

      const response = await readResults(cookie, attempt.body.id).expect(200);

      const row = response.body.questions[0];
      // The grade already written is untouched by an unreadable body.
      expect(row.state).toBe('Incorrect');
      expect(row.studentAnswer).toBeNull();
      // The correct answer is unaffected -- only the chosen option was corrupted.
      expect(row.correctAnswer).toEqual(flagged.body);
    });

    it('answers the one shared 404 for an open Attempt, a sibling’s, another account’s and a malformed id', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      const strangers = await releasedForChild(null);
      const open = await startAttempt(cookie, id).expect(201);
      const grade = await createGradeLevel(h);
      const sibling = await createStudentProfile(h, ready.parentAccountId, {
        gradeLevelId: grade.id,
      });
      const siblingCookie = await bindDevice(h, ready.token, sibling.id);

      // Still open: nothing has been handed in, and that is not a different flavour
      // of refusal (AD-18).
      const stillOpen = await readResults(cookie, open.body.id).expect(404);
      await submitAttempt(cookie, open.body.id, [
        { questionId: questionIds[0]!, value: '1' },
      ]).expect(200);
      // This account's own Attempt, asked for under a sibling's binding.
      const wrongChild = await readResults(siblingCookie, open.body.id).expect(404);
      // Another account's Attempt entirely.
      const strangerAttempt = await startAttempt(strangers.cookie, strangers.id).expect(201);
      await submitAttempt(strangers.cookie, strangerAttempt.body.id, []).expect(200);
      const foreign = await readResults(cookie, strangerAttempt.body.id).expect(404);
      // A malformed id, and an id that never existed. Deliberately not a 400: a
      // second kind of refusal here would tell a child *something*.
      const malformed = await readResults(cookie, 'not-a-uuid').expect(404);
      const unknown = await readResults(cookie, randomUUID()).expect(404);

      for (const refusal of [stillOpen, wrongChild, foreign, malformed, unknown]) {
        expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      }
    });

    it('carries no rationale, Topic, cost, tier or model on the results it answers with', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      // A free-text Question the provider does judge, so a rationale genuinely
      // exists in the table while the body says nothing about it.
      await asFreeText(questionIds[0]!, 'ShortAnswer', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);
      const stored = await gradeRowsOf(attempt.body.id);
      expect(stored.get(questionIds[0]!)!.rationale!.trim().length).toBeGreaterThan(0);

      const response = await readResults(cookie, attempt.body.id).expect(200);

      // Asserted over the raw JSON rather than field by field, so a key a later edit
      // adds is caught too.
      const serialized = JSON.stringify(response.body);
      expect(Object.keys(response.body).sort()).toEqual(
        [
          'attemptId',
          'practiceTestId',
          'questionCount',
          'score',
          // Story 6.5's second figure: what the Attempt came to *before* any parent
          // adjustment, and null while there is none. It is `scoreOf` over the stored
          // verdicts rather than a stored column, so it is not a second denominator —
          // and it is on the student's view because a grade that silently changed
          // between two visits would be a child doubting what they read the first time.
          'originalScore',
          'subjectName',
          'questions',
        ].sort(),
      );
      for (const key of [
        'rationale',
        'topic',
        'topics',
        'cost',
        'costMicros',
        'tier',
        'model',
        'allowance',
        'isCorrect',
        'timerMinutes',
        'studentProfileId',
        'parentAccountId',
      ]) {
        expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'iu'));
      }
      // And not the model's own words anywhere in the body, under any key.
      expect(serialized).not.toContain(stored.get(questionIds[0]!)!.rationale);
      expect(serialized).not.toMatch(/allowance|tier|unlimited|gpt|model/iu);
    });

    // --- A second run: Story 5.7's retake and run history -------------------
    //
    // Every case here goes over the real HTTP path, and every one of them is about a
    // *row that already exists staying exactly as it is*: a retake inserts, and it
    // is the only thing in the product that ever gives a child a second Attempt at
    // one Practice Test.

    /** Opens the next run, carrying the binding cookie and no bearer. */
    function retake(cookie: string, practiceTestId: string) {
      return server()
        .post(`/api/student/practice-tests/${practiceTestId}/retake`)
        .set('Cookie', cookie);
    }

    /** This child's run history: one entry per test they have finished at least once. */
    function readRuns(cookie: string) {
      return server().get('/api/student/practice-test-runs').set('Cookie', cookie);
    }

    /** One Attempt's whole stored row, so "unchanged" can be asserted field by field. */
    function attemptRowOf(attemptId: string) {
      return h.prisma.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        select: {
          id: true,
          ordinal: true,
          startedAt: true,
          expiresAt: true,
          submittedAt: true,
          expired: true,
        },
      });
    }

    /** The answers stored against one Attempt, by Question. */
    async function answersOf(attemptId: string): Promise<Map<string, string>> {
      const rows = await h.prisma.answer.findMany({
        where: { attemptId },
        select: { questionId: true, value: true },
      });
      return new Map(rows.map((row) => [row.questionId, row.value]));
    }

    /** How many Attempts exist at all for this child at this test. */
    function attemptCountFor(practiceTestId: string, studentProfileId: string) {
      return h.prisma.attempt.count({ where: { practiceTestId, studentProfileId } });
    }

    /** Answers every Question of a test with the flagged option, and hands it in. */
    async function answerWholeAndSubmit(
      cookie: string,
      attemptId: string,
      questionIds: string[],
    ): Promise<void> {
      const flagged = await Promise.all(questionIds.map((id) => correctChoiceOf(id)));
      await submitAttempt(
        cookie,
        attemptId,
        questionIds.map((questionId, at) => ({
          questionId,
          value: String(flagged[at]!.ordinal),
        })),
      ).expect(200);
    }

    it('inserts a second Attempt at ordinal 2 and leaves the first run byte-identical', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      const first = await startAttempt(cookie, id).expect(201);
      await answerWholeAndSubmit(cookie, first.body.id, questionIds);
      // Read *before* the retake, so "unchanged" is a comparison rather than a hope.
      const firstRowBefore = await attemptRowOf(first.body.id);
      const firstAnswersBefore = await answersOf(first.body.id);
      const firstGradesBefore = await gradeRowsOf(first.body.id);
      expect(firstAnswersBefore.size).toBe(questionIds.length);
      expect(firstGradesBefore.size).toBe(questionIds.length);

      const before = Date.now();
      const response = await retake(cookie, id).expect(201);
      const after = Date.now();

      // The same view shape the start route answers with, so a screen begins the new
      // run from what it already knows how to read.
      expect(Object.keys(response.body).sort()).toEqual([
        'expiresAt',
        'id',
        'practiceTestId',
        'serverNow',
        'startedAt',
        'submittedAt',
      ]);
      expect(response.body.id).not.toBe(first.body.id);
      expect(response.body.practiceTestId).toBe(id);
      expect(response.body.submittedAt).toBeNull();
      // Untimed, so no deadline at all -- and the instants are the server's own.
      expect(response.body.expiresAt).toBeNull();
      const startedAt = Date.parse(response.body.startedAt);
      expect(startedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(startedAt).toBeLessThanOrEqual(after + 1000);

      const retakeRow = await attemptRowOf(response.body.id);
      expect(retakeRow.ordinal).toBe(2);
      // Exactly two rows: a retake inserts one, and nothing else.
      expect(await attemptCountFor(id, ready.studentProfileId)).toBe(2);

      // And the first run, untouched: its row, its answers and its grades.
      expect(await attemptRowOf(first.body.id)).toEqual(firstRowBefore);
      expect(await answersOf(first.body.id)).toEqual(firstAnswersBefore);
      expect(await gradeRowsOf(first.body.id)).toEqual(firstGradesBefore);
      // The retake carries no answers and no grades of its own yet.
      expect((await answersOf(response.body.id)).size).toBe(0);
      expect((await gradeRowsOf(response.body.id)).size).toBe(0);
    });

    it('resumes the retake from the start route, never the earlier Attempt', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const first = await startAttempt(cookie, id).expect(201);
      await answerWholeAndSubmit(cookie, first.body.id, questionIds);
      const second = await retake(cookie, id).expect(201);

      const resumed = await startAttempt(cookie, id).expect(201);

      // The latest row by `ordinal desc`, with its own instants and still open.
      expect(resumed.body.id).toBe(second.body.id);
      expect(resumed.body.id).not.toBe(first.body.id);
      expect(resumed.body.startedAt).toBe(second.body.startedAt);
      expect(resumed.body.submittedAt).toBeNull();
      // And resuming inserted nothing: the promise the start route makes is unchanged.
      expect(await h.prisma.attempt.count({ where: { practiceTestId: id } })).toBe(2);
    });

    it('presents the same Questions in the same order, and grades each run on its own rows', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const first = await startAttempt(cookie, id).expect(201);
      const flagged = await Promise.all(questionIds.map((qid) => correctChoiceOf(qid)));
      // Everything right on the first run.
      await submitAttempt(
        cookie,
        first.body.id,
        questionIds.map((questionId, at) => ({
          questionId,
          value: String(flagged[at]!.ordinal),
        })),
      ).expect(200);

      const second = await retake(cookie, id).expect(201);
      // The detail read is unchanged by a retake: same Questions, same stored order.
      const detail = await readReleasedTest(cookie, id).expect(200);
      expect(detail.body.questions.map((q: { id: string }) => q.id)).toEqual(questionIds);
      // Everything wrong on the second: the flagged option is ordinal 1, so 2 is a
      // wrong answer the child actually gave.
      await submitAttempt(
        cookie,
        second.body.id,
        questionIds.map((questionId) => ({ questionId, value: '2' })),
      ).expect(200);

      const firstResults = await readResults(cookie, first.body.id).expect(200);
      const secondResults = await readResults(cookie, second.body.id).expect(200);

      // The same Questions, in the same order, on both runs.
      for (const results of [firstResults, secondResults]) {
        expect(results.body.practiceTestId).toBe(id);
        expect(results.body.questions.map((row: { questionId: string }) => row.questionId)).toEqual(
          questionIds,
        );
      }
      // Each run's own answers and its own verdicts.
      expect(firstResults.body.score).toEqual({
        correct: questionIds.length,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
      expect(secondResults.body.score).toEqual({
        correct: 0,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
      for (const row of firstResults.body.questions) expect(row.state).toBe('Correct');
      for (const row of secondResults.body.questions) expect(row.state).toBe('Incorrect');
    });

    it('answers the winner’s Attempt when two retake presses race, never a third row', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);
      const first = await startAttempt(cookie, id).expect(201);
      await answerWholeAndSubmit(cookie, first.body.id, questionIds);

      // Two presses of one control. Both read `ordinal: 1` as the latest and both
      // insert `ordinal: 2`; the unique index refuses the loser, which then re-reads
      // the latest row rather than re-running its own decision. Re-running would
      // compute `ordinal + 2` and leave a child who pressed once with two open runs.
      const [a, b] = await Promise.all([retake(cookie, id), retake(cookie, id)]);

      // Whether the two transactions genuinely interleave is the database's business,
      // not this case's: they may collide on the unique index, and the loser then
      // re-reads the winner's row; or they may serialize, and the second press simply
      // finds the retake already open and is refused like any other press at an open
      // run. Both are correct, and asserting one of them would make this case a test
      // of the scheduler. What is *never* correct is a third row, and that is what is
      // asserted here.
      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(201);
      expect([201, 409]).toContain(statuses[1]);
      const winner = a.status === 201 ? a : b;
      expect((await attemptRowOf(winner.body.id)).ordinal).toBe(2);
      expect(winner.body.submittedAt).toBeNull();
      if (statuses[1] === 201) {
        // The collision happened: one insert landed and the loser came back with the
        // winner's row and the winner's instants, never `ordinal + 2`.
        expect(a.body.id).toBe(b.body.id);
        expect(a.body.startedAt).toBe(b.body.startedAt);
        expect(a.body.expiresAt).toBe(b.body.expiresAt);
      } else {
        const loser = a.status === 409 ? a : b;
        expect(loser.body.message).toBe(ATTEMPT_NOT_RETAKEABLE);
      }
      // Two rows in total, either way: the finished first run and the one retake they
      // asked for.
      expect(await attemptCountFor(id, ready.studentProfileId)).toBe(2);
    });

    it('refuses a retake while a run is open and on a test never sat, with the one sentence', async () => {
      const { ready, id, cookie, questionIds } = await releasedForChild(null);

      // Never sat: there is nothing to retake.
      const neverSat = await retake(cookie, id).expect(409);
      expect(await attemptCountFor(id, ready.studentProfileId)).toBe(0);

      const open = await startAttempt(cookie, id).expect(201);
      // A run still going: two open Attempts would give the resume read two answers.
      const stillOpen = await retake(cookie, id).expect(409);
      expect(await attemptCountFor(id, ready.studentProfileId)).toBe(1);

      // One sentence for both, because "you have not finished this" is the same true
      // statement about each and a child can already see which it is.
      expect(neverSat.body.message).toBe(ATTEMPT_NOT_RETAKEABLE);
      expect(stillOpen.body.message).toBe(neverSat.body.message);
      // And it is not the ownership refusal: the test is on their screen.
      expect(neverSat.body.message).not.toBe(PRACTICE_TEST_NOT_FOUND);

      // Handed in, and now it is allowed -- so the refusal was about the rule and not
      // about the route.
      await submitAttempt(cookie, open.body.id, [
        { questionId: questionIds[0]!, value: '1' },
      ]).expect(200);
      await retake(cookie, id).expect(201);
      expect(await attemptCountFor(id, ready.studentProfileId)).toBe(2);
    });

    it('answers the one shared 404 for a sibling’s test, another account’s, a draft and a malformed id', async () => {
      const ready = await withLandedDrafts(2);
      const releasedId = ready.draftIds[0]!;
      const draftId = ready.draftIds[1]!;
      await release(ready.token, releasedId).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);
      const strangers = await releasedForChild(null);
      const grade = await createGradeLevel(h);
      const sibling = await createStudentProfile(h, ready.parentAccountId, {
        gradeLevelId: grade.id,
      });
      const siblingCookie = await bindDevice(h, ready.token, sibling.id);

      // A draft is not a released test, so it is simply absent from this surface.
      const draft = await retake(cookie, draftId).expect(404);
      // This account's own released test, asked for under a sibling's binding.
      const wrongChild = await retake(siblingCookie, releasedId).expect(404);
      // Another account's test entirely.
      const foreign = await retake(cookie, strangers.id).expect(404);
      // Deliberately not a 400 on shape: a second kind of refusal would tell a child
      // *something* on a surface whose discipline is one sentence.
      const malformed = await retake(cookie, 'not-a-uuid').expect(404);
      const unknown = await retake(cookie, randomUUID()).expect(404);

      for (const refusal of [draft, wrongChild, foreign, malformed, unknown]) {
        expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      }
      // Nothing was inserted by any of them, on either test.
      expect(await h.prisma.attempt.count({ where: { practiceTestId: draftId } })).toBe(0);
      expect(await h.prisma.attempt.count({ where: { practiceTestId: releasedId } })).toBe(0);
    });

    it('states one child’s runs and never a sibling’s, on one account with two profiles', async () => {
      const ready = await withLandedDrafts(1);
      const mine = ready.draftIds[0]!;
      await release(ready.token, mine).expect(200);
      const cookie = await bindDevice(h, ready.token, ready.studentProfileId);

      // A second child on the **same** account, with a released test of their own.
      // Two profiles under one parent is the only state that can tell this read's
      // profile scoping apart from its ownership scoping: an account filter alone
      // answers identically for a single-profile account, so a case built on one
      // would pass with `studentProfileId` dropped from the query.
      const grade = await createGradeLevel(h);
      const sibling = await createStudentProfile(h, ready.parentAccountId, {
        gradeLevelId: grade.id,
      });
      const siblingCookie = await bindDevice(h, ready.token, sibling.id);
      const theirs = await releasedFor(ready.token, sibling.id, grade.id);

      const questionsOf = async (practiceTestId: string) =>
        (
          await h.prisma.practiceTestQuestion.findMany({
            where: { practiceTestId },
            orderBy: { ordinal: 'asc' },
            select: { id: true },
          })
        ).map((question) => question.id);
      const myAttempt = await startAttempt(cookie, mine).expect(201);
      await answerWholeAndSubmit(cookie, myAttempt.body.id, await questionsOf(mine));
      const theirAttempt = await startAttempt(siblingCookie, theirs).expect(201);
      await answerWholeAndSubmit(siblingCookie, theirAttempt.body.id, await questionsOf(theirs));

      const own = await readRuns(cookie).expect(200);
      const other = await readRuns(siblingCookie).expect(200);

      expect(own.body).toHaveLength(1);
      expect(own.body[0].practiceTestId).toBe(mine);
      expect(own.body[0].first.attemptId).toBe(myAttempt.body.id);
      expect(other.body).toHaveLength(1);
      expect(other.body[0].practiceTestId).toBe(theirs);
      expect(other.body[0].first.attemptId).toBe(theirAttempt.body.id);
      // Over the raw JSON too, so a leak under any key is caught rather than only one
      // that happens to land in the entry this case reads.
      expect(JSON.stringify(own.body)).not.toContain(theirAttempt.body.id);
      expect(JSON.stringify(own.body)).not.toContain(theirs);
      expect(JSON.stringify(other.body)).not.toContain(myAttempt.body.id);
      expect(JSON.stringify(other.body)).not.toContain(mine);
    });

    it('snapshots the timer as it stands now rather than copying the first run’s deadline', async () => {
      const { id, cookie, questionIds } = await releasedForChild(20);
      const first = await startAttempt(cookie, id).expect(201);
      expect(Date.parse(first.body.expiresAt) - Date.parse(first.body.startedAt)).toBe(20 * 60_000);
      await submitAttempt(cookie, first.body.id, [
        { questionId: questionIds[0]!, value: '1' },
      ]).expect(200);

      // Written straight to the column: `PUT .../timer` is a draft-only write and
      // answers 404 once a test is released (Epic 4's write barrier), so no route can
      // produce this state. The claim under test is unchanged -- the retake reads the
      // column *as it stands now* instead of shifting the first run's instants.
      await h.prisma.practiceTest.update({ where: { id }, data: { timerMinutes: 35 } });

      const second = await retake(cookie, id).expect(201);

      expect(Date.parse(second.body.expiresAt) - Date.parse(second.body.startedAt)).toBe(
        35 * 60_000,
      );
      // And not the earlier deadline moved: both instants are new.
      expect(second.body.startedAt).not.toBe(first.body.startedAt);
      expect(second.body.expiresAt).not.toBe(first.body.expiresAt);
      // The first run's stored deadline is untouched by any of it.
      const firstRow = await attemptRowOf(first.body.id);
      expect(firstRow.expiresAt!.toISOString()).toBe(first.body.expiresAt);
    });

    it('states the run history over two finished runs, marking only the first as counting', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const first = await startAttempt(cookie, id).expect(201);
      await answerWholeAndSubmit(cookie, first.body.id, questionIds);
      const second = await retake(cookie, id).expect(201);
      // Everything wrong on the second run, so the two figures differ.
      await submitAttempt(
        cookie,
        second.body.id,
        questionIds.map((questionId) => ({ questionId, value: '2' })),
      ).expect(200);

      const response = await readRuns(cookie).expect(200);

      expect(response.body).toHaveLength(1);
      const entry = response.body[0];
      expect(entry.practiceTestId).toBe(id);
      expect(entry.attemptCount).toBe(2);
      expect(entry.first.attemptId).toBe(first.body.id);
      expect(entry.first.ordinal).toBe(1);
      expect(entry.first.countsTowardMastery).toBe(true);
      expect(entry.first.score).toEqual({
        correct: questionIds.length,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
      expect(entry.latest.attemptId).toBe(second.body.id);
      expect(entry.latest.ordinal).toBe(2);
      // A retake is excluded by being a later run, not by a filter at a call site.
      expect(entry.latest.countsTowardMastery).toBe(false);
      expect(entry.latest.score).toEqual({
        correct: 0,
        denominator: questionIds.length,
        excludedUngraded: 0,
      });
    });

    it('names the same Attempt as first and latest for a single finished run', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      const only = await startAttempt(cookie, id).expect(201);
      await answerWholeAndSubmit(cookie, only.body.id, questionIds);

      const response = await readRuns(cookie).expect(200);

      expect(response.body).toHaveLength(1);
      const entry = response.body[0];
      expect(entry.attemptCount).toBe(1);
      // The shape the card tells the two cases apart by, without arithmetic.
      expect(entry.first.attemptId).toBe(only.body.id);
      expect(entry.latest.attemptId).toBe(entry.first.attemptId);
      expect(entry.latest).toEqual(entry.first);
      expect(entry.first.countsTowardMastery).toBe(true);
      expect(entry.latest.countsTowardMastery).toBe(true);
    });

    it('leaves a test out entirely while its only run is still open', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);

      // Nothing sat at all: an empty list, never a 404.
      const nothing = await readRuns(cookie).expect(200);
      expect(nothing.body).toEqual([]);

      const open = await startAttempt(cookie, id).expect(201);
      // A run still going is not a figure and is not counted.
      const stillOpen = await readRuns(cookie).expect(200);
      expect(stillOpen.body).toEqual([]);

      await submitAttempt(cookie, open.body.id, [
        { questionId: questionIds[0]!, value: '1' },
      ]).expect(200);
      const afterHandIn = await readRuns(cookie).expect(200);
      expect(afterHandIn.body).toHaveLength(1);
      expect(afterHandIn.body[0].practiceTestId).toBe(id);
    });

    it('reports a run’s Ungraded Questions as excluded rather than folding them in', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      // One free-text Question the provider is asked about, and a transport fault on
      // the way -- so the row lands `Ungraded` and nothing has judged it.
      await asFreeText(questionIds[0]!, 'ShortAnswer', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      h.ai.failNext('transport');
      const flagged = await Promise.all(questionIds.slice(1).map((qid) => correctChoiceOf(qid)));
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
        ...questionIds.slice(1).map((questionId, at) => ({
          questionId,
          value: String(flagged[at]!.ordinal),
        })),
      ]).expect(200);
      expect((await gradeRowsOf(attempt.body.id)).get(questionIds[0]!)!.state).toBe('Ungraded');

      // Read through the history, which never re-asks -- so the row is still
      // `Ungraded` when the figure is computed.
      const response = await readRuns(cookie).expect(200);

      const entry = response.body[0];
      expect(entry.first.score).toEqual({
        correct: questionIds.length - 1,
        denominator: questionIds.length - 1,
        excludedUngraded: 1,
      });
      // The history is not FR-22's trigger: the results screen is, and this read must
      // not spend a provider call per card on every visit to a child's home screen.
      const callsBefore = gradingCalls().length;
      await readRuns(cookie).expect(200);
      expect(gradingCalls()).toHaveLength(callsBefore);
    });

    it('carries no rationale, Topic, cost, tier or model on the run history', async () => {
      const { id, cookie, questionIds } = await releasedForChild(null);
      // A free-text Question the provider does judge, so a rationale genuinely exists
      // in the table while the body says nothing about it.
      await asFreeText(questionIds[0]!, 'ShortAnswer', 'Two halves');
      const attempt = await startAttempt(cookie, id).expect(201);
      await submitAttempt(cookie, attempt.body.id, [
        { questionId: questionIds[0]!, value: 'Two halves' },
      ]).expect(200);
      const stored = await gradeRowsOf(attempt.body.id);
      expect(stored.get(questionIds[0]!)!.rationale!.trim().length).toBeGreaterThan(0);

      const response = await readRuns(cookie).expect(200);

      expect(response.body[0].practiceTestId).toBe(id);
      // Asserted over the raw JSON rather than field by field, so a key a later edit
      // adds is caught too.
      const serialized = JSON.stringify(response.body);
      expect(Object.keys(response.body[0]).sort()).toEqual(
        ['practiceTestId', 'attemptCount', 'first', 'latest'].sort(),
      );
      // Both named runs, not only the first: a key added to one view is a key on the
      // other, and asserting one of the two would say nothing about the other.
      for (const run of [response.body[0].first, response.body[0].latest]) {
        expect(Object.keys(run).sort()).toEqual(
          ['attemptId', 'ordinal', 'submittedAt', 'score', 'countsTowardMastery'].sort(),
        );
      }
      for (const key of [
        'rationale',
        'topic',
        'topics',
        'cost',
        'costMicros',
        'tier',
        'model',
        'allowance',
        'isCorrect',
        'timerMinutes',
        'studentProfileId',
        'parentAccountId',
        'questions',
        'prompt',
      ]) {
        expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'iu'));
      }
      // And not the model's own words anywhere in the body, under any key.
      expect(serialized).not.toContain(stored.get(questionIds[0]!)!.rationale);
      expect(serialized).not.toMatch(/allowance|tier|unlimited|gpt/iu);
    });
  });
});
