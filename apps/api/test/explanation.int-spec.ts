import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { EXPLANATION_FAILED, MAX_EXPLANATION_LENGTH, NO_EXPLANATION_ALLOWANCE } = await import(
  '../src/explanation/explanation-policy.js'
);
const { PRACTICE_TEST_NOT_FOUND } = await import('../src/practicetest/practice-test-policy.js');
const { AiRejectedError, AiService } = await import('../src/ai/ai.service.js');
const { NO_ANSWER_GIVEN } = await import('../src/explanation/explanation-prompt.js');
const { TIER_LIMITS } = await import('../src/allowance/tiers.js');
const {
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

type Harness = Awaited<ReturnType<typeof createHarness>>;

const PIN = '4821';

/**
 * On-demand Explanations, end to end through the real app and the real database.
 *
 * The **stateful** rows of the story's I/O matrix live here and can live nowhere
 * else: that the first press bills exactly one provider call, that the second
 * press bills none, that a capped account is refused without one, and that a
 * foreign, a sibling's, an unknown and a still-open target are indistinguishable
 * from outside. The pure rows — the prompt's fencing and grade clause, the
 * payload bounds, the cap arithmetic — are unit specs beside the code.
 *
 * The Attempt and everything under it are written straight to the tables. These
 * cases are about explaining a finished run, not about producing one: driving the
 * whole upload-extract-generate-release-sit-hand-in flow for each of them would
 * spend the setup's provider calls in the middle of counting this story's.
 */
describe('Explanations: asked for once, generated once, charged once', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetParentAccounts(h.prisma);
    await resetTaxonomy(h.prisma);
    h.ai.reset();
  });

  function server() {
    return request(h.app.getHttpServer());
  }

  interface Sat {
    parentAccountId: string;
    studentProfileId: string;
    cookie: string;
    attemptId: string;
    questionIds: string[];
    /** The Grade Level the *Practice Test* was classified under. */
    testGradeLevelName: string;
    /** The Grade Level on the child's own profile, deliberately a different one. */
    profileGradeLevelName: string;
  }

  /**
   * One child, bound to this device, with one handed-in Attempt at a two-question
   * Practice Test behind them.
   *
   * The Practice Test's Grade Level is deliberately **not** the Student Profile's:
   * the register criterion is that the prompt reads the first and never the
   * second, and a fixture where the two agree could not tell them apart.
   */
  async function sat(overrides: { questionCount?: number } = {}): Promise<Sat> {
    const questionCount = overrides.questionCount ?? 2;
    // Named by the shared fixture counter rather than by this file, so two runs in
    // one case get two Grade Levels instead of colliding on the taxonomy's own
    // uniqueness rule. They only ever have to be *different* from each other.
    const profileGrade = await createGradeLevel(h);
    const testGrade = await createGradeLevel(h);
    const subject = await createSubject(h, { gradeLevelId: testGrade.id });

    const parent = await createSignedInParent(h);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: profileGrade.id,
    });
    const cookie = await bindDevice(h, token, profile.id);

    const sourceTest = await h.prisma.sourceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
        studentProfileId: profile.id,
        status: 'Submitted',
        expiresAt: new Date(Date.now() + 86_400_000),
        submittedAt: new Date(),
        subjectId: subject.id,
        gradeLevelId: testGrade.id,
      },
      select: { id: true },
    });
    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: profile.id,
        requestedCount: 1,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const practiceTest = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: parent.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: profile.id,
        generationJobId: job.id,
        status: 'Released',
        ordinal: 1,
        questionCount,
        // Charged, as every landed draft is. It is the *Generation* Allowance, and
        // it is here so a case asserting the Explanation count moved cannot be
        // reading a figure the fixture happened to leave at zero.
        chargedAt: new Date(),
      },
      select: { id: true },
    });

    const questionIds: string[] = [];
    for (let ordinal = 1; ordinal <= questionCount; ordinal += 1) {
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: practiceTest.id,
          ordinal,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: `What is half of ${ordinal * 6}?` }],
          answer: [{ kind: 'text', value: `${ordinal * 3}` }],
        },
        select: { id: true },
      });
      questionIds.push(question.id);
    }

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
      data: { attemptId: attempt.id, questionId: questionIds[0]!, value: 'four' },
    });

    h.ai.reset();
    return {
      parentAccountId: parent.parentAccountId,
      studentProfileId: profile.id,
      cookie,
      attemptId: attempt.id,
      questionIds,
      testGradeLevelName: testGrade.name,
      profileGradeLevelName: profileGrade.name,
    };
  }

  function explain(cookie: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/student/attempts/${attemptId}/questions/${questionId}/explanation`)
      .set('Cookie', cookie);
  }

  /** How many `Explanation` calls the captured seam has seen. */
  function explanationCalls(): number {
    return h.ai.sent.filter((call) => call.callClass === 'Explanation').length;
  }

  async function chargedRows(parentAccountId: string): Promise<number> {
    return h.prisma.explanation.count({
      where: { parentAccountId, chargedAt: { not: null } },
    });
  }

  it('writes one charged row and answers 201 with the segments on the first press', async () => {
    const run = await sat();
    const response = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);

    expect(response.body.attemptId).toBe(run.attemptId);
    expect(response.body.questionId).toBe(run.questionIds[0]);
    expect(Array.isArray(response.body.body)).toBe(true);
    expect(response.body.body.length).toBeGreaterThan(0);

    expect(explanationCalls()).toBe(1);
    const stored = await h.prisma.explanation.findMany({
      where: { attemptId: run.attemptId },
      select: { questionId: true, studentProfileId: true, chargedAt: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.questionId).toBe(run.questionIds[0]);
    expect(stored[0]!.studentProfileId).toBe(run.studentProfileId);
    expect(stored[0]!.chargedAt).not.toBeNull();
  });

  it('answers the stored row on every later press, with no second call and no second row', async () => {
    const run = await sat();
    const first = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const second = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(200);
    const third = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(200);

    // Byte for byte the same prose, and 200 rather than 201: the status is the one
    // observable difference between a call that billed and one that read a row.
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    expect(explanationCalls()).toBe(1);
    expect(await h.prisma.explanation.count({ where: { attemptId: run.attemptId } })).toBe(1);
    expect(await chargedRows(run.parentAccountId)).toBe(1);
  });

  it('explains each Question separately, and caches each one separately', async () => {
    const run = await sat();
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    await explain(run.cookie, run.attemptId, run.questionIds[1]!).expect(201);
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(200);

    expect(explanationCalls()).toBe(2);
    expect(await chargedRows(run.parentAccountId)).toBe(2);
  });

  it('moves the allowance readout, and counts it there and nowhere else', async () => {
    const run = await sat();
    const before = await h.allowance.consumptionFor(run.parentAccountId);
    expect(before.allowances.explanation.used).toBe(0);
    expect(before.allowances.explanation.limit).toBe(TIER_LIMITS.Free.explanation);

    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const after = await h.allowance.consumptionFor(run.parentAccountId);
    expect(after.allowances.explanation.used).toBe(1);

    // A re-read is free, and the figure says so.
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(200);
    expect(
      (await h.allowance.consumptionFor(run.parentAccountId)).allowances.explanation.used,
    ).toBe(1);
  });

  it('does not count a row whose charge is null', async () => {
    // Story 6.4's free regeneration needs somewhere to opt out, and `chargedAt`
    // nullable is it. Written here rather than through the endpoint, which always
    // charges, because the *counting* rule is what this pins.
    const run = await sat();
    await h.prisma.explanation.create({
      data: {
        parentAccountId: run.parentAccountId,
        studentProfileId: run.studentProfileId,
        attemptId: run.attemptId,
        questionId: run.questionIds[0]!,
        body: [{ kind: 'text', value: 'A row that cost nothing.' }],
        chargedAt: null,
      },
    });
    expect(
      (await h.allowance.consumptionFor(run.parentAccountId)).allowances.explanation.used,
    ).toBe(0);
  });

  it('refuses at the cap without generating anything, and keeps what is already written readable', async () => {
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();
    // One real Explanation, so the case can prove an already-generated one stays
    // readable after the cap is reached.
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    // The rest of the period's charge, written directly: driving `limit` real
    // presses would need `limit` distinct Questions and would assert nothing this
    // case is about.
    const filler = await h.prisma.attempt.findUniqueOrThrow({
      where: { id: run.attemptId },
      select: { practiceTestId: true },
    });
    for (let index = 1; index < limit; index += 1) {
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: filler.practiceTestId,
          ordinal: 100 + index,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'Filler.' }],
          answer: [{ kind: 'text', value: 'Filler.' }],
        },
        select: { id: true },
      });
      await h.prisma.explanation.create({
        data: {
          parentAccountId: run.parentAccountId,
          studentProfileId: run.studentProfileId,
          attemptId: run.attemptId,
          questionId: question.id,
          body: [{ kind: 'text', value: 'Already paid for.' }],
          chargedAt: new Date(),
        },
      });
    }
    h.ai.reset();

    const refused = await explain(run.cookie, run.attemptId, run.questionIds[1]!).expect(409);
    expect(refused.body.message).toBe(NO_EXPLANATION_ALLOWANCE);
    // Nothing generated and nothing written.
    expect(explanationCalls()).toBe(0);
    expect(await chargedRows(run.parentAccountId)).toBe(limit);

    // And the one already written is still there, still free, still readable.
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(200);
    expect(explanationCalls()).toBe(0);
  });

  it('never reports a cap on an unlimited tier', async () => {
    const run = await sat();
    await h.parentAccounts.assignTier(h.operatorId, run.parentAccountId, 'Plus');
    // Far past the Free ceiling, and still generating.
    for (let index = 0; index < TIER_LIMITS.Free.explanation! + 2; index += 1) {
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: (
            await h.prisma.attempt.findUniqueOrThrow({
              where: { id: run.attemptId },
              select: { practiceTestId: true },
            })
          ).practiceTestId,
          ordinal: 200 + index,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: 'Another one.' }],
          answer: [{ kind: 'text', value: 'Another answer.' }],
        },
        select: { id: true },
      });
      await explain(run.cookie, run.attemptId, question.id).expect(201);
    }
    expect(
      (await h.allowance.consumptionFor(run.parentAccountId)).allowances.explanation.limit,
    ).toBe(null);
  });

  it('pitches the register at the Practice Test’s Grade Level, not the child’s', async () => {
    const run = await sat();
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const call = h.ai.sent.find((sent) => sent.callClass === 'Explanation');
    expect(call).toBeDefined();
    expect(call!.prompt).toContain(run.testGradeLevelName);
    expect(call!.prompt).not.toContain(run.profileGradeLevelName);
  });

  it('generates with no grade clause when the Grade Level no longer resolves', async () => {
    // Degrades, never refuses: a taxonomy row nobody can see any more costs the
    // prompt a sentence and costs the child nothing.
    const run = await sat();
    const sourceTestId = (
      await h.prisma.practiceTest.findFirstOrThrow({
        where: { parentAccountId: run.parentAccountId },
        select: { sourceTestId: true },
      })
    ).sourceTestId;
    await h.prisma.sourceTest.update({
      where: { id: sourceTestId },
      data: { gradeLevelId: null },
    });

    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const call = h.ai.sent.find((sent) => sent.callClass === 'Explanation');
    expect(call!.prompt).not.toContain(run.testGradeLevelName);
    expect(call!.prompt).toContain('Write for a school student');
  });

  it('is a text call that carries no images', async () => {
    const run = await sat();
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const call = h.ai.sent.find((sent) => sent.callClass === 'Explanation');
    expect(call!.modality).toBe('text');
    expect(call!.imageCount).toBe(0);
  });

  it('answers the one 404 sentence for a sibling’s Attempt', async () => {
    const mine = await sat();
    const theirs = await sat();
    const refused = await explain(mine.cookie, theirs.attemptId, theirs.questionIds[0]!).expect(
      404,
    );
    expect(refused.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(explanationCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(0);
  });

  it('answers the same sentence for an id that never existed', async () => {
    const run = await sat();
    const refused = await explain(
      run.cookie,
      '00000000-0000-4000-8000-000000000000',
      run.questionIds[0]!,
    ).expect(404);
    expect(refused.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    // No `ParseUUIDPipe`: a malformed id finds no row and gets the same 404, not a
    // second flavour of refusal.
    const malformed = await explain(run.cookie, 'not-an-id', run.questionIds[0]!).expect(404);
    expect(malformed.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(explanationCalls()).toBe(0);
  });

  it('answers the same sentence for an Attempt that is still open', async () => {
    const run = await sat();
    await h.prisma.attempt.update({
      where: { id: run.attemptId },
      data: { submittedAt: null },
    });
    const refused = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(404);
    expect(refused.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(explanationCalls()).toBe(0);
  });

  it('answers the same sentence for a Question that is not on that Attempt’s test', async () => {
    const mine = await sat();
    const other = await sat();
    const refused = await explain(mine.cookie, mine.attemptId, other.questionIds[0]!).expect(404);
    expect(refused.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(explanationCalls()).toBe(0);
  });

  it('refuses an unbound device before it reaches any of this', async () => {
    const run = await sat();
    await server()
      .post(`/api/student/attempts/${run.attemptId}/questions/${run.questionIds[0]!}/explanation`)
      .expect(401);
    expect(explanationCalls()).toBe(0);
  });

  it('writes nothing and charges nothing when the provider faults', async () => {
    const run = await sat();
    h.ai.failNext('transport');
    const failed = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(503);
    expect(failed.body.message).toBe(EXPLANATION_FAILED);
    expect(await h.prisma.explanation.count()).toBe(0);
    expect(
      (await h.allowance.consumptionFor(run.parentAccountId)).allowances.explanation.used,
    ).toBe(0);

    // And a person pressing again still works: nothing latched.
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
  });

  it('writes nothing when the payload comes back empty', async () => {
    // The `unusable` latch lands on the one thing a text call's post-hoc pass can
    // reject: an explanation that explained nothing.
    const run = await sat();
    h.ai.failNext('unusable');
    const failed = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(503);
    expect(failed.body.message).toBe(EXPLANATION_FAILED);
    expect(await h.prisma.explanation.count()).toBe(0);
  });

  it('stores prose inside the stated ceiling', async () => {
    const run = await sat();
    const response = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const plain = response.body.body
      .map((segment: { kind: string; value?: string }) =>
        segment.kind === 'text' ? (segment.value ?? '') : '',
      )
      .join('');
    expect(plain.length).toBeLessThanOrEqual(MAX_EXPLANATION_LENGTH);
  });

  it('writes nothing and charges nothing when the provider refuses outright', async () => {
    // The fake transport's latches all raise transient faults. A terminal one --
    // the provider rejecting the request rather than failing to answer it -- has
    // to be driven at the seam, and it must reach the child as the same sentence:
    // whose fault it was is never the child's business (AD-20/AD-26).
    const run = await sat();
    const ai = h.app.get(AiService);
    const original = ai.run.bind(ai);
    let refuseOnce = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (request: any): Promise<any> => {
      if (refuseOnce) {
        refuseOnce = false;
        throw new AiRejectedError('refused', 400);
      }
      return original(request);
    };
    try {
      const failed = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(503);
      expect(failed.body.message).toBe(EXPLANATION_FAILED);
    } finally {
      ai.run = original;
    }
    expect(await h.prisma.explanation.count()).toBe(0);
    expect(await chargedRows(run.parentAccountId)).toBe(0);

    // And the seam did not latch: a later press still generates.
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
  });

  it('refuses when the cap is reached between the check and the write', async () => {
    // The whole reason the re-count shares a transaction with the insert: a
    // concurrent press can spend the last unit while this one is out at the
    // provider. Standing in for that other press, the period is filled *during*
    // the AI call -- after the pre-check read remaining, before the write.
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();
    const practiceTestId = (
      await h.prisma.attempt.findUniqueOrThrow({
        where: { id: run.attemptId },
        select: { practiceTestId: true },
      })
    ).practiceTestId;

    const ai = h.app.get(AiService);
    const original = ai.run.bind(ai);
    let filled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (request: any): Promise<any> => {
      const answer = await original(request);
      if (!filled) {
        filled = true;
        for (let index = 0; index < limit; index += 1) {
          const question = await h.prisma.practiceTestQuestion.create({
            data: {
              practiceTestId,
              ordinal: 200 + index,
              format: 'ShortAnswer',
              prompt: [{ kind: 'text', value: 'Filler.' }],
              answer: [{ kind: 'text', value: 'Filler.' }],
            },
            select: { id: true },
          });
          await h.prisma.explanation.create({
            data: {
              parentAccountId: run.parentAccountId,
              studentProfileId: run.studentProfileId,
              attemptId: run.attemptId,
              questionId: question.id,
              body: [{ kind: 'text', value: 'Spent by the other press.' }],
              chargedAt: new Date(),
            },
          });
        }
      }
      return answer;
    };
    try {
      const refused = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(409);
      expect(refused.body.message).toBe(NO_EXPLANATION_ALLOWANCE);
    } finally {
      ai.run = original;
    }

    // Nothing was written for the press that lost the race, and nothing beyond
    // what the other press had already charged.
    expect(await h.prisma.explanation.count({ where: { questionId: run.questionIds[0]! } })).toBe(
      0,
    );
    expect(await chargedRows(run.parentAccountId)).toBe(limit);
  });

  it('asks about the stored question, with both answers as they were stored', async () => {
    const run = await sat();
    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const call = h.ai.sent.find((sent) => sent.callClass === 'Explanation');
    // The fixture's own strings: the Question as it was asked, its stored key, and
    // the word the child actually typed.
    expect(call!.prompt).toContain('What is half of 6?');
    expect(call!.prompt).toContain('3');
    expect(call!.prompt).toContain('four');
  });

  it('says a Question was left blank rather than inventing an answer for it', async () => {
    // The second Question of the fixture has no Answer row at all.
    const run = await sat();
    await explain(run.cookie, run.attemptId, run.questionIds[1]!).expect(201);
    const call = h.ai.sent.find((sent) => sent.callClass === 'Explanation');
    expect(call!.prompt).toContain(NO_ANSWER_GIVEN);
  });

  it('asks again when the payload keeps coming back unusable, and gives up bounded', async () => {
    // `setup.ts` pins the whole suite to one attempt, so the re-ask this story's
    // matrix names can only be seen by a case that states its own figure.
    const run = await sat();
    const ai = h.app.get(AiService);
    const previousAttempts = ai.config.maxAttempts;
    const original = ai.run.bind(ai);
    ai.config.maxAttempts = 2;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (request: any): Promise<any> => ({
      ...(await original(request)),
      // A payload that parses and explains nothing: the one fault `AiService`'s
      // own loop cannot see, and the only one worth asking again for.
      payload: { body: [] },
    });
    try {
      const failed = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(503);
      expect(failed.body.message).toBe(EXPLANATION_FAILED);
    } finally {
      ai.run = original;
      ai.config.maxAttempts = previousAttempts;
    }
    // Asked twice, bounded by the same figure upstream faults are retried under,
    // and nothing written or charged for either ask.
    expect(explanationCalls()).toBe(2);
    expect(await h.prisma.explanation.count()).toBe(0);
    expect(await chargedRows(run.parentAccountId)).toBe(0);
  });

  it('answers the stored row when another press wrote it first', async () => {
    // Two first presses for the same Question at once. Standing in for the other
    // one, the row is written during this call's provider call -- after the cache
    // read missed, before the insert. The unique key refuses this insert, and the
    // child still gets an explanation rather than a fault.
    const run = await sat();
    const ai = h.app.get(AiService);
    const original = ai.run.bind(ai);
    let raced = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (request: any): Promise<any> => {
      const answer = await original(request);
      if (!raced) {
        raced = true;
        await h.prisma.explanation.create({
          data: {
            parentAccountId: run.parentAccountId,
            studentProfileId: run.studentProfileId,
            attemptId: run.attemptId,
            questionId: run.questionIds[0]!,
            body: [{ kind: 'text', value: 'Written by the other press.' }],
            chargedAt: new Date(),
          },
        });
      }
      return answer;
    };
    try {
      // 200, not 201: this call wrote nothing, so it bills nothing and says so.
      const response = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(200);
      expect(JSON.stringify(response.body.body)).toContain('Written by the other press.');
    } finally {
      ai.run = original;
    }
    // Exactly one row, charged exactly once.
    expect(await h.prisma.explanation.count({ where: { questionId: run.questionIds[0]! } })).toBe(
      1,
    );
    expect(await chargedRows(run.parentAccountId)).toBe(1);
  });

  it('refuses rather than explaining a Question whose text could not be read', async () => {
    const run = await sat();
    // A stored prompt that reads as nothing at all: the degrade path in
    // `explanationInputFor` hands an empty span through.
    await h.prisma.practiceTestQuestion.update({
      where: { id: run.questionIds[0]! },
      data: { prompt: [] },
    });
    const failed = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(503);
    expect(failed.body.message).toBe(EXPLANATION_FAILED);
    expect(explanationCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(0);
    expect(await chargedRows(run.parentAccountId)).toBe(0);
  });

  it('refuses rather than explaining a Question whose correct answer could not be read', async () => {
    const run = await sat();
    // The prompt reads back fine; it is the stored answer key that degrades to an
    // empty span. Guarding the prompt alone would still generate, store and charge
    // an explanation built around an invented "correct answer".
    await h.prisma.practiceTestQuestion.update({
      where: { id: run.questionIds[0]! },
      data: { answer: [] },
    });
    const failed = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(503);
    expect(failed.body.message).toBe(EXPLANATION_FAILED);
    expect(explanationCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(0);
    expect(await chargedRows(run.parentAccountId)).toBe(0);
  });

  it('says nothing about cost, tier, model or allowance in what it answers with', async () => {
    const run = await sat();
    const response = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    const body = JSON.stringify(response.body);
    for (const forbidden of [/cost/iu, /tier\b/iu, /model/iu, /token/iu, /allowance/iu, /gpt/iu]) {
      expect(body).not.toMatch(forbidden);
    }
    // `studentFlaggedAt` joined this view in Story 6.3: the child's **own** flag, and
    // the only flag fact a student-scoped response carries. There is still nowhere here
    // for a parent's flag, a disposition or a count of anything to travel — which the
    // flagging story's own spec holds to account against every parent-side state
    // existing at once (`test/student-explanation-flag.int-spec.ts`).
    expect(Object.keys(response.body).sort()).toEqual([
      'attemptId',
      'body',
      'questionId',
      'replacement',
      'studentFlaggedAt',
      'suppressed',
    ]);
    // The two facts Story 6.4 added, and the whole of what it added: that a parent removed
    // this one, and that a served one is a replacement. A freshly generated first
    // generation is neither.
    expect(response.body.suppressed).toBe(false);
    expect(response.body.replacement).toBe(false);
    // Null on a row nobody has reported, rather than an absent field: a panel reading
    // the state cannot take "the field is not there" for "there is no report".
    expect(response.body.studentFlaggedAt).toBeNull();
  });
});
