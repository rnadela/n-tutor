import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { EXPLANATION_FAILED, MAX_EXPLANATION_LENGTH } = await import(
  '../src/explanation/explanation-policy.js'
);
// The at-cap sentence is `allowance`'s, beside its Upload and Generation
// siblings. Built here from `TIER_LIMITS` and the account's own window rather
// than matched with a regex or a literal: a spec that spelled the words would be
// the second spelling this story exists to remove.
const { explanationAllowanceExhausted } = await import('../src/allowance/allowance-policy.js');
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

  /**
   * The refusal this account would be answered with, built the way the API builds
   * it: the tier's figure out of `TIER_LIMITS`, the reset instant and the zone out
   * of the account's own period window.
   */
  async function atCap(parentAccountId: string): Promise<string> {
    const window = await h.allowance.windowFor(parentAccountId);
    return explanationAllowanceExhausted({
      limit: TIER_LIMITS.Free.explanation!,
      resetAt: window.end,
      timezone: window.timezone,
    });
  }

  /** The practice test the fixture's Attempt was sat at. */
  async function practiceTestOf(attemptId: string): Promise<string> {
    return (
      await h.prisma.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        select: { practiceTestId: true },
      })
    ).practiceTestId;
  }

  /**
   * The ordinals `extraQuestion` hands out, allocated from here and never by a
   * caller.
   *
   * A case that fills a period twice — or fills one and then presses for a real
   * Explanation on a further Question — would otherwise have to pick two
   * non-overlapping ranges by hand, and two cases picking the same base is a
   * collision nothing would report as anything but a confusing count. It only ever
   * has to be past the fixture's own ordinals and monotonic, so it is never reset.
   */
  let nextOrdinal = 1000;

  /** One more Question on the fixture's test, so a charge has somewhere to go. */
  async function extraQuestion(attemptId: string): Promise<string> {
    nextOrdinal += 1;
    const question = await h.prisma.practiceTestQuestion.create({
      data: {
        practiceTestId: await practiceTestOf(attemptId),
        ordinal: nextOrdinal,
        format: 'ShortAnswer',
        prompt: [{ kind: 'text', value: 'Filler.' }],
        answer: [{ kind: 'text', value: 'Filler.' }],
      },
      select: { id: true },
    });
    return question.id;
  }

  /**
   * `rows` charged Explanations, written straight to the table.
   *
   * Driving real presses would need `rows` distinct Questions and `rows` provider
   * calls and would assert nothing the cases using this are about. `chargedAt`
   * defaults to now — the current period — and a case that wants last period's
   * charges hands its own instant in.
   */
  async function charge(run: Sat, rows: number, chargedAt: Date = new Date()): Promise<void> {
    for (let index = 0; index < rows; index += 1) {
      await h.prisma.explanation.create({
        data: {
          parentAccountId: run.parentAccountId,
          studentProfileId: run.studentProfileId,
          attemptId: run.attemptId,
          questionId: await extraQuestion(run.attemptId),
          body: [{ kind: 'text', value: 'Already paid for.' }],
          chargedAt,
        },
      });
    }
  }

  /**
   * Every way a student-scoped refusal could leak a billing fact, asserted on the
   * body that actually crossed the wire.
   *
   * The positive assertions compare against the builder's own output, so a leak
   * introduced *in* the builder would pass them. This is the boundary AD-20/AD-26
   * is promised at, so it is checked here rather than only in the policy's unit
   * spec.
   */
  function carriesNoBillingFact(message: string): void {
    for (const tier of ['Free', 'Plus', 'Family', 'Internal']) {
      expect(message).not.toContain(tier);
    }
    // No usage figure, in any of the spellings a counter reaches a reader in.
    expect(message).not.toMatch(/\d+\s*(of|\/)\s*\d+/u);
    expect(message).not.toMatch(/\bleft\b|remaining/iu);
    expect(message).not.toMatch(/cost|price|token|upgrade|\$/iu);
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
    // And the charge landed inside the period the cap was counted over. The window
    // and the stamp are derived from **one** instant in the service, which is what
    // keeps a press that spans a period rollover counted against the period it
    // charges into; a second `new Date()` at insert time would be a row a boundary
    // crossing could put in a period the count never measured.
    const window = await h.allowance.windowFor(run.parentAccountId);
    expect(stored[0]!.chargedAt!.getTime()).toBeGreaterThanOrEqual(window.start.getTime());
    expect(stored[0]!.chargedAt!.getTime()).toBeLessThan(window.end.getTime());
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
    // The rest of the period's charge, through the shared helper.
    await charge(run, limit - 1);
    h.ai.reset();

    const refused = await explain(run.cookie, run.attemptId, run.questionIds[1]!).expect(409);
    expect(refused.body.message).toBe(await atCap(run.parentAccountId));
    // And what the sentence may not carry, asserted on the body that crossed the
    // wire rather than only on the builder that produced it.
    carriesNoBillingFact(refused.body.message);
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
    // Far past the Free ceiling, and still generating. Real presses, so the row
    // lock is genuinely taken on each one and genuinely issues no count.
    for (let index = 0; index < TIER_LIMITS.Free.explanation! + 2; index += 1) {
      await explain(run.cookie, run.attemptId, await extraQuestion(run.attemptId)).expect(201);
    }
    expect(
      (await h.allowance.consumptionFor(run.parentAccountId)).allowances.explanation.limit,
    ).toBe(null);
  });

  it('counts an Explanation tombstone towards the cap, and refuses on it', async () => {
    // A deleted Explanation is not a refund (AD-14): the provider call was paid
    // for. A tombstone is what keeps it counted, and an account whose charged rows
    // plus tombstones reach the limit is at the limit.
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();
    const window = await h.allowance.windowFor(run.parentAccountId);
    await charge(run, limit - 1);
    await h.prisma.usageTombstone.create({
      data: {
        parentAccountId: run.parentAccountId,
        periodStart: window.start,
        usageClass: 'Explanation',
        count: 1,
      },
    });
    h.ai.reset();

    const refused = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(409);
    expect(refused.body.message).toBe(await atCap(run.parentAccountId));
    // Nothing generated and nothing written: the tombstone is the last unit.
    expect(explanationCalls()).toBe(0);
    expect(await chargedRows(run.parentAccountId)).toBe(limit - 1);
  });

  it('does not count last period’s charges against this period', async () => {
    // Usage is derived from a window, not from a running total: a full period
    // before this one leaves this one untouched, with no reset job to have run.
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();
    const window = await h.allowance.windowFor(run.parentAccountId);
    // One millisecond before this window opens is the previous period, whatever
    // month the suite runs in.
    await charge(run, limit, new Date(window.start.getTime() - 1));
    expect(
      (await h.allowance.consumptionFor(run.parentAccountId)).allowances.explanation.used,
    ).toBe(0);
    h.ai.reset();

    await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(201);
    expect(explanationCalls()).toBe(1);
  });

  it('lets exactly one of two concurrent presses take the last unit', async () => {
    // Two different Questions, so the unique key refuses neither and the only thing
    // that can serialise them is the account row lock inside the charging
    // transaction. Without it both would read the same pre-charge usage under READ
    // COMMITTED and both would charge.
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();
    await charge(run, limit - 1);
    h.ai.reset();

    // **A barrier, because `Promise.all` alone does not overlap the two charging
    // transactions.** Both presses pass the advisory pre-call check while there is
    // still a unit left, but left to themselves the first one commits before the
    // second gets as far as its own transaction — and then the *pre-call* check
    // refuses the second, which is a pass this case would score with the row lock
    // deleted. Holding the first press inside its provider call until the second
    // has also finished its own puts both of them in the transaction at once,
    // which is the state the lock exists for.
    const ai = h.app.get(AiService);
    const original = ai.run.bind(ai);
    let arrived = 0;
    let release = (): void => {};
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (request: any): Promise<any> => {
      const answer = await original(request);
      arrived += 1;
      if (arrived >= 2) release();
      else await both;
      return answer;
    };
    let first: Awaited<ReturnType<typeof explain>>;
    let second: Awaited<ReturnType<typeof explain>>;
    try {
      [first, second] = await Promise.all([
        explain(run.cookie, run.attemptId, run.questionIds[0]!),
        explain(run.cookie, run.attemptId, run.questionIds[1]!),
      ]);
    } finally {
      ai.run = original;
    }
    const statuses = [first.status, second.status].sort();
    // One charged, one refused — and the loser is refused, never a 500.
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.message).toBe(await atCap(run.parentAccountId));
    expect(await chargedRows(run.parentAccountId)).toBe(limit);

    // **The assertion that makes this case about the lock.** Both presses got past
    // the advisory pre-call check and both spent a provider call, so the 201/409
    // split can only have been decided inside the charging transaction. Without
    // this, a run where the loser's pre-call count happened to fall after the
    // winner's commit would satisfy every assertion above with the row lock
    // deleted.
    expect(explanationCalls()).toBe(2);

    // And the loser's prose was dropped rather than stored uncharged: a row with a
    // null `chargedAt` means exactly one thing in this schema — Story 6.4's free
    // replacement — and a second meaning for that null would make the counter's
    // own predicate ambiguous.
    const loserQuestionId = loser === first ? run.questionIds[0]! : run.questionIds[1]!;
    expect(await h.prisma.explanation.count({ where: { questionId: loserQuestionId } })).toBe(0);
  });

  it('refuses on the tier the locked row carries when the account is downgraded mid-call', async () => {
    // The pre-call check reads an unlimited tier and issues no count at all, so
    // the only figure the refusal can have been measured against is the one read
    // off the row the charging transaction locked. Carrying the pre-call limit
    // forward instead would generate, charge and store this press.
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();
    await h.parentAccounts.assignTier(h.operatorId, run.parentAccountId, 'Plus');
    // Past the Free ceiling, which an unlimited tier allows and Free does not.
    await charge(run, limit + 1);

    const ai = h.app.get(AiService);
    const original = ai.run.bind(ai);
    let downgraded = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (request: any): Promise<any> => {
      const answer = await original(request);
      if (!downgraded) {
        downgraded = true;
        // Standing in for an Admin tier change landing while the provider is out.
        await h.parentAccounts.assignTier(h.operatorId, run.parentAccountId, 'Free');
      }
      return answer;
    };
    try {
      const refused = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(409);
      expect(refused.body.message).toBe(await atCap(run.parentAccountId));
      carriesNoBillingFact(refused.body.message);
    } finally {
      ai.run = original;
    }

    // The provider call was spent — the pre-call check could not have refused this
    // — and nothing was charged or stored for it.
    expect(explanationCalls()).toBe(1);
    expect(await h.prisma.explanation.count({ where: { questionId: run.questionIds[0]! } })).toBe(
      0,
    );
    expect(await chargedRows(run.parentAccountId)).toBe(limit + 1);
  });

  it('grades an Attempt handed in by a child whose account is at its cap', async () => {
    // Nothing on the grading path reads an allowance. A cap on explaining work is
    // not a cap on doing it, and a child at the cap still gets every grade.
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();
    await charge(run, limit);
    const open = await h.prisma.attempt.create({
      data: {
        practiceTestId: await practiceTestOf(run.attemptId),
        parentAccountId: run.parentAccountId,
        studentProfileId: run.studentProfileId,
        ordinal: 2,
        startedAt: new Date(Date.now() - 300_000),
      },
      select: { id: true },
    });
    h.ai.reset();

    const handedIn = await server()
      .post(`/api/student/attempts/${open.id}/submit`)
      .set('Cookie', run.cookie)
      .send({ answers: [{ questionId: run.questionIds[0]!, value: '3' }] })
      .expect(200);
    expect(handedIn.body.submittedAt).toBeTruthy();

    const results = await server()
      .get(`/api/student/attempts/${open.id}/results`)
      .set('Cookie', run.cookie)
      .expect(200);
    // Every Question on the paper came back with a *named* grade state, and the
    // score is the concrete fraction. The paper is wider than the fixture's two:
    // filling the period added a Question per charged row, and each of them was sat
    // blank.
    const questions = await h.prisma.practiceTestQuestion.count({
      where: { practiceTestId: await practiceTestOf(run.attemptId) },
    });
    expect(results.body.questions).toHaveLength(questions);
    // The one Question answered, answered with its stored key, so the fake
    // grader's folded comparison makes it `Correct` deterministically.
    const answered = results.body.questions.find(
      (row: { questionId: string }) => row.questionId === run.questionIds[0]!,
    );
    expect(answered.state).toBe('Correct');
    // And every other Question is `Unanswered` — not `Ungraded`: a blank is a
    // state the server decides, so "every grade state stays reachable" is the
    // claim, and nothing was left unjudged because an allowance ran out.
    for (const row of results.body.questions) {
      if (row.questionId === run.questionIds[0]!) continue;
      expect(row.state).toBe('Unanswered');
    }
    expect(results.body.score).toEqual({
      correct: 1,
      // `Correct`, `Incorrect` and `Unanswered` all count; `Ungraded` does not, and
      // nothing here is Ungraded.
      denominator: questions,
      excludedUngraded: 0,
    });
    // And the charge did not move: grading reads no Explanation Allowance and
    // writes no `explanation` row.
    expect(await chargedRows(run.parentAccountId)).toBe(limit);
    expect(explanationCalls()).toBe(0);
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
    // Why the cap is stated at the charge and not only before the provider call:
    // a concurrent press can spend the last unit while this one is out at the
    // provider, and the pre-call check has no way to know. Standing in for that
    // other press, the period is filled *during* the AI call -- after the pre-call
    // check counted headroom, before the write. The refusal therefore can only
    // have come from the guard inside the transaction.
    const limit = TIER_LIMITS.Free.explanation!;
    const run = await sat();

    const ai = h.app.get(AiService);
    const original = ai.run.bind(ai);
    let filled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai.run = async (request: any): Promise<any> => {
      const answer = await original(request);
      if (!filled) {
        filled = true;
        await charge(run, limit);
      }
      return answer;
    };
    try {
      const refused = await explain(run.cookie, run.attemptId, run.questionIds[0]!).expect(409);
      expect(refused.body.message).toBe(await atCap(run.parentAccountId));
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
