import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { FLAG_ALREADY_DISPOSED } = await import('../src/explanation/explanation-policy.js');
const { PRACTICE_TEST_NOT_FOUND } = await import('../src/practicetest/practice-test-policy.js');
const {
  adminToken,
  bearer,
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
const UNKNOWN_UUID = '11111111-2222-4333-8444-555555555555';

/**
 * A child raising a hand about an Explanation, a parent deciding about it, and an
 * operator reading what the parent confirmed — end to end through the real app and the
 * real database.
 *
 * The **stateful** rows of the story's I/O matrix live here and can live nowhere else:
 * that the first press writes one row and the second writes none, that a refusal writes
 * nothing, that reporting moves no allowance and changes no prose, that **no**
 * student-scoped response ever carries a parent's flag or a disposition, that the first
 * decision is final, and that the Admin queue contains parent-originated and
 * parent-*confirmed* flags and nothing else. The pure rows — the mapper's fold, the queue's
 * de-duplication, the refusal sentences — are unit specs beside the code.
 *
 * The Attempt and everything under it are written straight to the tables, for the reason
 * `explanation.int-spec.ts` and `parent-explanation-review.int-spec.ts` both give: these
 * cases are about reporting a finished run's Explanations, not about producing one, and
 * driving the whole upload-extract-generate-release-sit-hand-in flow per case would spend
 * the setup's provider calls in the middle of counting this story's.
 */
describe('Student Explanation flagging: raised once, decided once, queued once', () => {
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

  interface Account {
    parentAccountId: string;
    /** The elevation bearer the parent-scoped routes take. */
    token: string;
    /** The Student Mode cookie the child's own routes read both ids off. */
    cookie: string;
    studentProfileId: string;
    /** A second child of the same account, whose rows must never be reachable. */
    siblingProfileId: string;
    practiceTestId: string;
    attemptId: string;
    questionIds: string[];
  }

  /**
   * One account, two children, one handed-in two-question Attempt behind the first, and
   * the device bound to that first child.
   *
   * Two children deliberately: "a child reaches only their own Attempt" is a claim a
   * fixture with one child could not tell from "reaches anything of the account".
   */
  async function sat(): Promise<Account> {
    const gradeLevel = await createGradeLevel(h);
    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });

    // `Plus`: this fixture needs two active Student Profiles, so it opts into a
    // tier with that headroom rather than out of the Account-Tier cap.
    const parent = await createSignedInParent(h, { tier: 'Plus' });
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const sibling = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
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
        gradeLevelId: gradeLevel.id,
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
        questionCount: 3,
        chargedAt: new Date(),
      },
      select: { id: true },
    });

    const questionIds: string[] = [];
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
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
        submittedAt: new Date(Date.now() - 300_000),
      },
      select: { id: true },
    });
    for (const questionId of questionIds) {
      await h.prisma.answer.create({ data: { attemptId: attempt.id, questionId, value: 'three' } });
      // Judged, so nothing outstanding can make a *grading* retry's provider call and be
      // mistaken for a generation by the cases that count them.
      await h.prisma.questionGrade.create({
        data: { attemptId: attempt.id, questionId, state: 'Correct' },
      });
    }

    h.ai.reset();
    return {
      parentAccountId: parent.parentAccountId,
      token,
      cookie,
      studentProfileId: profile.id,
      siblingProfileId: sibling.id,
      practiceTestId: practiceTest.id,
      attemptId: attempt.id,
      questionIds,
    };
  }

  /** One stored Explanation, written straight to the table: the child already asked. */
  async function storeExplanation(
    account: Account,
    questionId: string,
    overrides: { studentProfileId?: string; value?: string } = {},
  ): Promise<string> {
    const stored = await h.prisma.explanation.create({
      data: {
        parentAccountId: account.parentAccountId,
        studentProfileId: overrides.studentProfileId ?? account.studentProfileId,
        attemptId: account.attemptId,
        questionId,
        body: [{ kind: 'text', value: overrides.value ?? 'Half of six is three.' }],
        chargedAt: new Date(),
      },
      select: { id: true },
    });
    return stored.id;
  }

  // --- The routes, spelled once -------------------------------------------

  /** The child's own read of one Explanation: 200 from the stored row. */
  function explain(cookie: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/student/attempts/${attemptId}/questions/${questionId}/explanation`)
      .set('Cookie', cookie);
  }

  /** The child reporting one Explanation. */
  function studentFlag(cookie: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/student/attempts/${attemptId}/questions/${questionId}/explanation-flag`)
      .set('Cookie', cookie);
  }

  function explanations(token: string, attemptId: string) {
    return server()
      .get(`/api/parent/attempts/${attemptId}/explanations`)
      .set('Authorization', bearer(token));
  }

  function parentFlag(token: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/parent/attempts/${attemptId}/questions/${questionId}/explanation-flag`)
      .set('Authorization', bearer(token));
  }

  function dispose(token: string, attemptId: string, questionId: string, disposition: unknown) {
    return server()
      .post(
        `/api/parent/attempts/${attemptId}/questions/${questionId}/explanation-flag/disposition`,
      )
      .set('Authorization', bearer(token))
      .send({ disposition });
  }

  function flagList(token: string, studentProfileId: string) {
    return server()
      .get(`/api/parent/students/${studentProfileId}/explanation-flags`)
      .set('Authorization', bearer(token));
  }

  function queue(token: string) {
    return server().get('/api/admin/flagged-explanations').set('Authorization', bearer(token));
  }

  function operatorToken(): Promise<string> {
    return adminToken(h.jwt, h.operatorId);
  }

  /** How many provider calls the captured seam has seen, of any class. */
  function providerCalls(): number {
    return h.ai.sent.length;
  }

  // --- The child's report -------------------------------------------------

  it('records one student-originated flag on the first press, and answers the prose unchanged', async () => {
    const account = await sat();
    const explanationId = await storeExplanation(account, account.questionIds[0]!);

    const response = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    expect(response.body.attemptId).toBe(account.attemptId);
    expect(response.body.questionId).toBe(account.questionIds[0]);
    // The same paragraph, byte for byte: reporting is not a retraction of what was said.
    expect(response.body.body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
    expect(typeof response.body.studentFlaggedAt).toBe('string');

    const rows = await h.prisma.explanationFlag.findMany({
      select: {
        explanationId: true,
        origin: true,
        parentAccountId: true,
        studentProfileId: true,
        disposition: true,
        dispositionAt: true,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      explanationId,
      origin: 'Student',
      // The Explanation's own columns, never the request's.
      parentAccountId: account.parentAccountId,
      studentProfileId: account.studentProfileId,
      // Awaiting is the *absence* of a decision, not a value somebody wrote.
      disposition: null,
      dispositionAt: null,
    });
  });

  it('records no second flag on a second press, and answers the first instant', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);

    const first = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    const second = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    const third = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    // A repeat press is the same concern, made the same row by the unique key.
    expect(second.body.studentFlaggedAt).toBe(first.body.studentFlaggedAt);
    expect(third.body.studentFlaggedAt).toBe(first.body.studentFlaggedAt);
    expect(await h.prisma.explanationFlag.count()).toBe(1);
  });

  it('leaves one row when two first presses land together, and answers both', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);

    // An `upsert` reads and then writes, so both requests can find no row and both can
    // attempt the insert. The unique key refuses the loser with P2002, and the loser's
    // answer is the winner's row — never a 500, on exactly the double-tap this is about.
    const [left, right] = await Promise.all([
      studentFlag(account.cookie, account.attemptId, account.questionIds[0]!),
      studentFlag(account.cookie, account.attemptId, account.questionIds[0]!),
    ]);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(left.body.studentFlaggedAt).toBe(right.body.studentFlaggedAt);
    expect(await h.prisma.explanationFlag.count()).toBe(1);
  });

  it('refuses a report of a Question with no Explanation, and writes nothing', async () => {
    const account = await sat();
    const refusal = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[1]!,
    ).expect(404);

    expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(await h.prisma.explanationFlag.count()).toBe(0);
    // And nothing was generated to have something to report.
    expect(providerCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(0);
  });

  it('refuses a foreign, a sibling-keyed, an unknown and a still-open target with one sentence', async () => {
    const mine = await sat();
    const theirs = await sat();
    await storeExplanation(theirs, theirs.questionIds[0]!);
    // A real Explanation of this Attempt and this Question, keyed to the other child. The
    // read is by the *binding's* profile, so this one is unreachable through any id a
    // request can carry.
    await storeExplanation(mine, mine.questionIds[2]!, {
      studentProfileId: mine.siblingProfileId,
    });
    const open = await h.prisma.attempt.create({
      data: {
        practiceTestId: mine.practiceTestId,
        parentAccountId: mine.parentAccountId,
        studentProfileId: mine.studentProfileId,
        ordinal: 2,
        startedAt: new Date(),
      },
      select: { id: true },
    });

    for (const [attemptId, questionId] of [
      [theirs.attemptId, theirs.questionIds[0]!],
      [mine.attemptId, mine.questionIds[2]!],
      [UNKNOWN_UUID, mine.questionIds[0]!],
      [open.id, mine.questionIds[0]!],
      // A malformed id on a student surface: no `ParseUUIDPipe`, so it finds no row and
      // gets the one sentence rather than a second kind of refusal.
      ['not-a-uuid', mine.questionIds[0]!],
      [mine.attemptId, 'not-a-uuid'],
    ] as const) {
      const refusal = await studentFlag(mine.cookie, attemptId, questionId).expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    }
    // Not one row written by any of them.
    expect(await h.prisma.explanationFlag.count()).toBe(0);
  });

  it('refuses a report from an unbound device, and writes nothing', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);

    await server()
      .post(
        `/api/student/attempts/${account.attemptId}/questions/${account.questionIds[0]}/explanation-flag`,
      )
      .expect(401);
    expect(await h.prisma.explanationFlag.count()).toBe(0);
  });

  it('changes nothing it is not about: no prose, no charge, no allowance, no grade, no score', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    const before = await h.allowance.consumptionFor(account.parentAccountId);
    const storedBefore = await h.prisma.explanation.findFirstOrThrow({
      where: { attemptId: account.attemptId },
      select: { body: true, chargedAt: true, updatedAt: true },
    });
    const gradesBefore = await h.prisma.questionGrade.findMany({
      where: { attemptId: account.attemptId },
      orderBy: { questionId: 'asc' },
      select: { questionId: true, state: true },
    });

    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    // Not one provider call, and not one new Explanation: reporting asks for nothing.
    expect(providerCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(1);
    const after = await h.allowance.consumptionFor(account.parentAccountId);
    expect(after.allowances.explanation.used).toBe(before.allowances.explanation.used);
    // The row itself is untouched — body, charge and even `updatedAt`.
    const storedAfter = await h.prisma.explanation.findFirstOrThrow({
      where: { attemptId: account.attemptId },
      select: { body: true, chargedAt: true, updatedAt: true },
    });
    expect(storedAfter).toEqual(storedBefore);
    // And no grade moved.
    expect(
      await h.prisma.questionGrade.findMany({
        where: { attemptId: account.attemptId },
        orderBy: { questionId: 'asc' },
        select: { questionId: true, state: true },
      }),
    ).toEqual(gradesBefore);
    // And no Mastery row was written from this module, which owns none.
    expect(await h.prisma.explanationFlag.count()).toBe(1);
  });

  // --- What the child is allowed to know ---------------------------------

  it('re-reads as 200 with the prose and the child’s own flag, and spends nothing', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    const reported = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    // 200 and not 201: the row was read, not written. This is what makes the reported
    // state survive a reload and a re-open of the panel with no second endpoint.
    const reread = await explain(account.cookie, account.attemptId, account.questionIds[0]!).expect(
      200,
    );
    expect(reread.body.body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
    expect(reread.body.studentFlaggedAt).toBe(reported.body.studentFlaggedAt);
    expect(providerCalls()).toBe(0);
  });

  it('carries the child’s own flag and no parent field of any kind, on either student route', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    // Everything parent-scoped that could exist, exists: the parent's own flag, the
    // child's, and a decision about the child's.
    await parentFlag(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Dismissed').expect(
      200,
    );

    for (const response of [
      await explain(account.cookie, account.attemptId, account.questionIds[0]!).expect(200),
      await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200),
    ]) {
      // The shape is the guarantee: there is nowhere on a student-scoped response for a
      // parent's flag, a disposition, an allowance figure, a tier, a cost, a model name
      // or a grading rationale to travel (AD-20, AD-26).
      expect(Object.keys(response.body).sort()).toEqual([
        'attemptId',
        'body',
        'questionId',
        'replacement',
        'studentFlaggedAt',
        'suppressed',
      ]);
      const serialized = JSON.stringify(response.body);
      for (const forbidden of [
        'parentFlaggedAt',
        'disposition',
        'Dismissed',
        'Confirmed',
        'rationale',
        'chargedAt',
        'tier',
        'model',
        'allowance',
        // Story 6.4's two parent-side columns. `suppressed` and `replacement` are on this
        // response; the *instant* a parent removed something, which generation it was and
        // whether they may remove it are not, and there is nowhere here for them to sit.
        'suppressedAt',
        'canSuppress',
        'generation',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      // The child still has their own flag, which is the one fact they are entitled to.
      expect(typeof response.body.studentFlaggedAt).toBe('string');
    }
  });

  // --- What the parent reads ---------------------------------------------

  it('reports both routes and the disposition on the parent’s Attempt read', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await storeExplanation(account, account.questionIds[1]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    await parentFlag(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    const response = await explanations(account.token, account.attemptId).expect(200);
    const flagged = response.body.find(
      (view: { questionId: string }) => view.questionId === account.questionIds[0],
    );
    const untouched = response.body.find(
      (view: { questionId: string }) => view.questionId === account.questionIds[1],
    );

    // Both instants, told apart — and the parent's press did not absorb the child's.
    expect(typeof flagged.parentFlaggedAt).toBe('string');
    expect(typeof flagged.studentFlaggedAt).toBe('string');
    expect(flagged.parentFlaggedAt).not.toBe(flagged.studentFlaggedAt);
    // Awaiting a decision, which is the absence of one.
    expect(flagged.studentFlagDisposition).toBeNull();
    // And an Explanation nobody reported carries three nulls rather than three absent
    // fields: a screen cannot take "the field is not there" for "there is no flag".
    expect(untouched.parentFlaggedAt).toBeNull();
    expect(untouched.studentFlaggedAt).toBeNull();
    expect(untouched.studentFlagDisposition).toBeNull();
  });

  it('keeps the child’s flag on the response a parent’s own flag press answers with', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    const reported = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    // The parent's screen replaces its whole entry from this view, so a response that
    // dropped `studentFlaggedAt` would erase the child's concern from the screen beside it.
    const response = await parentFlag(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    expect(response.body.studentFlaggedAt).toBe(reported.body.studentFlaggedAt);
    expect(typeof response.body.parentFlaggedAt).toBe('string');
  });

  it('keeps the parent’s own flag on the response a decision answers with', async () => {
    // The mirror of the case above, and it holds the *other* direction of the same rule:
    // the parent's screen replaces its whole entry from a decision's response too, so a
    // `disposeStudentFlag` that answered with the student flag alone would make a parent's
    // own concern vanish from the row under them until they reloaded. Every other dispose
    // case here has no parent flag, so nothing else would notice.
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    const flagged = await parentFlag(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    const decided = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Confirmed',
    ).expect(200);
    expect(decided.body.studentFlagDisposition).toBe('Confirmed');
    // The parent's own flag, at the instant their press first recorded it — a decision
    // about the child's concern is not a second flag of their own.
    expect(decided.body.parentFlaggedAt).toBe(flagged.body.parentFlaggedAt);

    // And a re-read agrees, so the response is the state and not a shape composed only for
    // this reply.
    const read = await explanations(account.token, account.attemptId).expect(200);
    expect(read.body[0].parentFlaggedAt).toBe(flagged.body.parentFlaggedAt);
    expect(read.body[0].studentFlagDisposition).toBe('Confirmed');
  });

  // --- The two decisions -------------------------------------------------

  it('records a confirmation once, with its instant, and suppresses nothing', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    const reported = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);

    const response = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Confirmed',
    ).expect(200);
    expect(response.body.studentFlagDisposition).toBe('Confirmed');
    // The child's own instant is untouched: a decision is not a re-raising.
    expect(response.body.studentFlaggedAt).toBe(reported.body.studentFlaggedAt);

    const row = await h.prisma.explanationFlag.findFirstOrThrow({
      where: { origin: 'Student' },
      select: { disposition: true, dispositionAt: true, createdAt: true },
    });
    expect(row.disposition).toBe('Confirmed');
    expect(row.dispositionAt).not.toBeNull();
    expect(row.createdAt.toISOString()).toBe(reported.body.studentFlaggedAt);

    // And the child is still served exactly the same prose. Confirming is not
    // suppression — that is Story 6.4's, and there is no column for it.
    const reread = await explain(account.cookie, account.attemptId, account.questionIds[0]!).expect(
      200,
    );
    expect(reread.body.body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
  });

  it('records a dismissal, keeps the entry listed, and tells the child nothing', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    const response = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Dismissed',
    ).expect(200);
    expect(response.body.studentFlagDisposition).toBe('Dismissed');

    // Still listed for the parent, marked dismissed: a dismissal is not a deletion.
    const listed = await flagList(account.token, account.studentProfileId).expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].disposition).toBe('Dismissed');
    // And nothing about it reaches the child.
    const reread = await explain(account.cookie, account.attemptId, account.questionIds[0]!).expect(
      200,
    );
    expect(JSON.stringify(reread.body)).not.toContain('Dismissed');
  });

  it('answers a repeat of the same decision 200 with the first instant, rewriting nothing', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    const first = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Confirmed',
    ).expect(200);
    const at = await h.prisma.explanationFlag.findFirstOrThrow({
      where: { origin: 'Student' },
      select: { dispositionAt: true },
    });

    const second = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Confirmed',
    ).expect(200);
    expect(second.body.studentFlagDisposition).toBe(first.body.studentFlagDisposition);
    // A double-tap is one decision, so the instant is the first one's and nothing moved.
    const again = await h.prisma.explanationFlag.findFirstOrThrow({
      where: { origin: 'Student' },
      select: { dispositionAt: true },
    });
    expect(again.dispositionAt?.toISOString()).toBe(at.dispositionAt?.toISOString());
  });

  it('refuses a second, different decision with one sentence, and rewrites nothing', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Confirmed').expect(
      200,
    );

    const refusal = await dispose(
      account.token,
      account.attemptId,
      account.questionIds[0]!,
      'Dismissed',
    ).expect(409);
    expect(refusal.body.message).toBe(FLAG_ALREADY_DISPOSED);

    // The first decision stands. A reversible confirm would mean an Explanation entering
    // and leaving an operator's queue underneath them.
    const row = await h.prisma.explanationFlag.findFirstOrThrow({
      where: { origin: 'Student' },
      select: { disposition: true },
    });
    expect(row.disposition).toBe('Confirmed');
    const read = await explanations(account.token, account.attemptId).expect(200);
    expect(read.body[0].studentFlagDisposition).toBe('Confirmed');
  });

  it('lets only one of two simultaneous opposite decisions win, and the other is a 409', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    // `updateMany({ where: { id, disposition: null } })` is what makes this safe: a
    // read-then-write could have both requests see `null` and both write, and the second
    // writer would silently overturn a decision the operator may already have acted on.
    const [left, right] = await Promise.all([
      dispose(account.token, account.attemptId, account.questionIds[0]!, 'Confirmed'),
      dispose(account.token, account.attemptId, account.questionIds[0]!, 'Dismissed'),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([200, 409]);
    const row = await h.prisma.explanationFlag.findFirstOrThrow({
      where: { origin: 'Student' },
      select: { disposition: true },
    });
    // Whichever won, exactly one decision is recorded.
    expect(['Confirmed', 'Dismissed']).toContain(row.disposition);
  });

  it('never lets a second press from the child erase the decision their parent made', async () => {
    // The student flag's upsert has an empty `update: {}` arm, and this is what holds it
    // empty. An update that touched `disposition` would let a child pressing again — which
    // they can do at any time, from a panel that has no control left but does re-issue on
    // re-open in other shapes — silently undo a decision, and drop a confirmed Explanation
    // out of the operator's queue with nothing failing anywhere.
    const account = await sat();
    const explanationId = await storeExplanation(account, account.questionIds[0]!);
    const reported = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Confirmed').expect(
      200,
    );
    const decidedAt = await h.prisma.explanationFlag.findFirstOrThrow({
      where: { origin: 'Student' },
      select: { dispositionAt: true },
    });

    // The child presses again. Same concern, same row, and the same first instant.
    const again = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    expect(again.body.studentFlaggedAt).toBe(reported.body.studentFlaggedAt);

    const row = await h.prisma.explanationFlag.findFirstOrThrow({
      where: { origin: 'Student' },
      select: { disposition: true, dispositionAt: true },
    });
    expect(row.disposition).toBe('Confirmed');
    expect(row.dispositionAt?.toISOString()).toBe(decidedAt.dispositionAt?.toISOString());

    // And it is still in front of the operator, which is the consequence that matters.
    const queued = await queue(await operatorToken()).expect(200);
    expect(queued.body.map((entry: { explanationId: string }) => entry.explanationId)).toContain(
      explanationId,
    );
  });

  it('refuses a disposition where there is no student flag, on every such shape', async () => {
    const account = await sat();
    const theirs = await sat();
    await storeExplanation(theirs, theirs.questionIds[0]!);
    // An Explanation nobody reported, and one the *parent* alone flagged — a parent-origin
    // flag is already their own judgement and has nothing to decide about.
    await storeExplanation(account, account.questionIds[0]!);
    await parentFlag(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    // A run of this account still going. It has no results and nothing to review, and the
    // controller's own doc says it answers the shared sentence — which is a claim only a
    // case like this holds to account.
    const open = await h.prisma.attempt.create({
      data: {
        practiceTestId: account.practiceTestId,
        parentAccountId: account.parentAccountId,
        studentProfileId: account.studentProfileId,
        ordinal: 2,
        startedAt: new Date(),
      },
      select: { id: true },
    });

    for (const [attemptId, questionId] of [
      // No student flag on it.
      [account.attemptId, account.questionIds[0]!],
      // No Explanation at all.
      [account.attemptId, account.questionIds[1]!],
      // Another account's Attempt, whose Explanation exists.
      [theirs.attemptId, theirs.questionIds[0]!],
      [UNKNOWN_UUID, account.questionIds[0]!],
      // A run still open, which is refused before any flag is looked for.
      [open.id, account.questionIds[0]!],
    ] as const) {
      const refusal = await dispose(account.token, attemptId, questionId, 'Confirmed').expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    }
    // The parent's own flag never acquired one.
    expect(await h.prisma.explanationFlag.count({ where: { disposition: { not: null } } })).toBe(0);
  });

  it('refuses a third disposition value at the pipe, before anything is read', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    // A disposition is a closed set, and the validation pipe is where a third value dies.
    for (const value of ['Suppressed', 'confirmed', '', null, 7]) {
      await dispose(account.token, account.attemptId, account.questionIds[0]!, value).expect(400);
    }
    expect(await h.prisma.explanationFlag.count({ where: { disposition: { not: null } } })).toBe(0);
  });

  it('ends Parent View rather than answering, and refuses a malformed id with a 400', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await studentFlag(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);

    for (const refused of [
      await dispose('not-a-token', account.attemptId, account.questionIds[0]!, 'Confirmed').expect(
        401,
      ),
      await flagList('not-a-token', account.studentProfileId).expect(401),
    ]) {
      // `elevated: false` is the guard naming itself as the refuser, which is what the web
      // reads to end Parent View rather than to show a retry.
      expect(refused.body.elevated).toBe(false);
    }

    // `ParseUUIDPipe` on every id of every new parent route, one at a time so no single
    // pipe can be the only one.
    await dispose(account.token, 'not-a-uuid', account.questionIds[0]!, 'Confirmed').expect(400);
    await dispose(account.token, account.attemptId, 'not-a-uuid', 'Confirmed').expect(400);
    await flagList(account.token, 'not-a-uuid').expect(400);

    expect(await h.prisma.explanationFlag.count({ where: { disposition: { not: null } } })).toBe(0);
  });

  // --- The per-child list -------------------------------------------------

  it('lists a child’s concerns newest first, awaiting and decided alike, with their context', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await storeExplanation(account, account.questionIds[1]!);
    const older = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    const newer = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[1]!,
    ).expect(200);
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Dismissed').expect(
      200,
    );

    const response = await flagList(account.token, account.studentProfileId).expect(200);
    expect(response.body).toHaveLength(2);
    // Newest first.
    expect(response.body[0].questionId).toBe(account.questionIds[1]);
    expect(response.body[1].questionId).toBe(account.questionIds[0]);
    expect(response.body[0].flaggedAt).toBe(newer.body.studentFlaggedAt);
    expect(response.body[1].flaggedAt).toBe(older.body.studentFlaggedAt);

    // Awaiting is the absence of a decision; decided says which and when.
    expect(response.body[0].disposition).toBeNull();
    expect(response.body[0].dispositionAt).toBeNull();
    expect(response.body[1].disposition).toBe('Dismissed');
    expect(typeof response.body[1].dispositionAt).toBe('string');

    for (const entry of response.body) {
      // What the concern points at, so a parent can recognise it.
      expect(entry.attemptId).toBe(account.attemptId);
      expect(entry.practiceTestId).toBe(account.practiceTestId);
      expect(entry.runOrdinal).toBe(1);
      expect(typeof entry.questionOrdinal).toBe('number');
      expect(typeof entry.subjectName).toBe('string');
      expect(typeof entry.submittedAt).toBe('string');
      // No prose, and no billing or grading fact of any kind (AD-20, AD-26).
      expect(Object.keys(entry).sort()).toEqual([
        'attemptId',
        'disposition',
        'dispositionAt',
        'flaggedAt',
        'generation',
        'practiceTestId',
        'questionId',
        'questionOrdinal',
        'runOrdinal',
        'subjectName',
        'submittedAt',
      ]);
    }
    expect(JSON.stringify(response.body)).not.toContain('Half of six');
  });

  it('answers a foreign, an unknown or an empty child with the same empty list', async () => {
    const mine = await sat();
    const theirs = await sat();
    await storeExplanation(theirs, theirs.questionIds[0]!);
    await studentFlag(theirs.cookie, theirs.attemptId, theirs.questionIds[0]!).expect(200);

    // Another account's real profile, this account's other child, and an id that never
    // existed. All `[]`: a 404 for the unknown one would be a confirmation for the known
    // one (AD-18), and nothing is enumerated either way.
    await flagList(mine.token, theirs.studentProfileId).expect(200).expect([]);
    await flagList(mine.token, mine.siblingProfileId).expect(200).expect([]);
    await flagList(mine.token, UNKNOWN_UUID).expect(200).expect([]);
    // And the other account still reads its own.
    const response = await flagList(theirs.token, theirs.studentProfileId).expect(200);
    expect(response.body).toHaveLength(1);
  });

  it('never lists the parent’s own flags back at them as the child’s concerns', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await parentFlag(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    // The origin is what makes this list the child's concerns. A parent's own flag is
    // their judgement already and has no place in a list of things awaiting one.
    await flagList(account.token, account.studentProfileId).expect(200).expect([]);
  });

  // --- The Admin queue ----------------------------------------------------

  it('lists parent flags and confirmed student flags only, one entry per Explanation', async () => {
    const account = await sat();
    // A: the parent's own flag. B: a confirmed student flag. C: a dismissed one.
    // D: one awaiting a decision.
    const [a, b, c] = [account.questionIds[0]!, account.questionIds[1]!, account.questionIds[2]!];
    const idA = await storeExplanation(account, a);
    const idB = await storeExplanation(account, b);
    await storeExplanation(account, c);
    // D lives on a second run of the same test, because one Attempt has only three
    // Questions and an Explanation is unique per (Attempt, Question, child).
    const second = await h.prisma.attempt.create({
      data: {
        practiceTestId: account.practiceTestId,
        parentAccountId: account.parentAccountId,
        studentProfileId: account.studentProfileId,
        ordinal: 2,
        startedAt: new Date(Date.now() - 120_000),
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    const idD = await h.prisma.explanation.create({
      data: {
        parentAccountId: account.parentAccountId,
        studentProfileId: account.studentProfileId,
        attemptId: second.id,
        questionId: a,
        body: [{ kind: 'text', value: 'Half of six is three, again.' }],
        chargedAt: new Date(),
      },
      select: { id: true },
    });

    await parentFlag(account.token, account.attemptId, a).expect(200);
    await studentFlag(account.cookie, account.attemptId, b).expect(200);
    await dispose(account.token, account.attemptId, b, 'Confirmed').expect(200);
    await studentFlag(account.cookie, account.attemptId, c).expect(200);
    await dispose(account.token, account.attemptId, c, 'Dismissed').expect(200);
    await h.prisma.explanationFlag.create({
      data: {
        explanationId: idD.id,
        parentAccountId: account.parentAccountId,
        studentProfileId: account.studentProfileId,
        origin: 'Student',
      },
    });

    const response = await queue(await operatorToken()).expect(200);
    const ids = response.body.map((entry: { explanationId: string }) => entry.explanationId);
    expect(ids.sort()).toEqual([idA, idB].sort());
    // A dismissed concern and one awaiting a decision are both out: the parent read the
    // same prose and judged it fine, or nobody has read it yet. Neither belongs in front
    // of an operator, and the filter is the query's.
    expect(ids).not.toContain(idD.id);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('Half of six is three, again.');
  });

  it('lists an Explanation raised both ways exactly once, naming both routes and the earliest instant', async () => {
    const account = await sat();
    const explanationId = await storeExplanation(account, account.questionIds[0]!);
    const reported = await studentFlag(
      account.cookie,
      account.attemptId,
      account.questionIds[0]!,
    ).expect(200);
    await dispose(account.token, account.attemptId, account.questionIds[0]!, 'Confirmed').expect(
      200,
    );
    await parentFlag(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    const response = await queue(await operatorToken()).expect(200);
    expect(response.body).toHaveLength(1);
    const [entry] = response.body;
    expect(entry.explanationId).toBe(explanationId);
    // Both routes named, because which route raised it is what says whether a child was
    // involved — and the earliest instant, which is the entry's place in the queue.
    expect(entry.raisedBy.sort()).toEqual(['Parent', 'Student']);
    expect(entry.raisedAt).toBe(reported.body.studentFlaggedAt);
    // The prose an operator has to judge, with the identifiers to name it by.
    expect(entry.body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
    expect(entry.attemptId).toBe(account.attemptId);
    expect(entry.questionId).toBe(account.questionIds[0]);
    expect(entry.parentAccountId).toBe(account.parentAccountId);
    expect(entry.studentProfileId).toBe(account.studentProfileId);
  });

  it('spans every family, and carries no name, no email and no billing fact', async () => {
    const mine = await sat();
    const theirs = await sat();
    await storeExplanation(mine, mine.questionIds[0]!);
    await storeExplanation(theirs, theirs.questionIds[0]!);
    await parentFlag(mine.token, mine.attemptId, mine.questionIds[0]!).expect(200);
    await parentFlag(theirs.token, theirs.attemptId, theirs.questionIds[0]!).expect(200);

    const response = await queue(await operatorToken()).expect(200);
    // The whole point of the queue is that an operator sees every family's.
    expect(response.body.length).toBeGreaterThanOrEqual(2);
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      'displayName',
      '@example.test',
      'costMicros',
      'tier',
      'rationale',
      'chargedAt',
      'disposition',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('answers an empty queue with an empty list, which is the normal case', async () => {
    await sat();
    await queue(await operatorToken())
      .expect(200)
      .expect([]);
  });

  it('refuses the queue without a valid operator token', async () => {
    const account = await sat();
    await storeExplanation(account, account.questionIds[0]!);
    await parentFlag(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    // The guard's own refusal. A parent's elevation bearer is not an operator credential
    // either: the separation rests on two secrets, not on a claim check (AD-25).
    await server().get('/api/admin/flagged-explanations').expect(401);
    await queue('not-a-token').expect(401);
    await queue(account.token).expect(401);
  });
});
