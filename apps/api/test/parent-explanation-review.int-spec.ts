import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { PRACTICE_TEST_NOT_FOUND } = await import('../src/practicetest/practice-test-policy.js');
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
const UNKNOWN_UUID = '11111111-2222-4333-8444-555555555555';

/**
 * A parent reading what their child was told, and recording that one of it is bad —
 * end to end through the real app and the real database.
 *
 * The **stateful** rows of the story's I/O matrix live here and can live nowhere
 * else: that a foreign profile is indistinguishable from a child with no runs, that a
 * foreign, unknown or still-open Attempt is refused with one sentence, that a
 * sibling's Explanation of the same Attempt is never returned, that reading
 * Explanations bills no provider call and moves no allowance, and that the second
 * press of the flag control writes no second row and answers the first instant. The
 * pure rows — the view mapping, the origin, the refusal sentence — are unit specs
 * beside the code.
 *
 * The Attempt and everything under it are written straight to the tables, for the
 * reason `explanation.int-spec.ts` gives: these cases are about reviewing a finished
 * run, not about producing one, and driving the whole
 * upload-extract-generate-release-sit-hand-in flow per case would spend the setup's
 * provider calls in the middle of counting this story's.
 */
describe('Parent review of Explanations: read what the child was told, record a concern', () => {
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
    token: string;
    /** The child whose runs every case reads. */
    studentProfileId: string;
    /** A second child of the same account, whose rows must never be returned. */
    siblingProfileId: string;
    practiceTestId: string;
    attemptId: string;
    questionIds: string[];
  }

  /**
   * One account, two children, and one handed-in Attempt behind the first of them.
   *
   * Two children deliberately: "the Explanations of an Attempt are scoped to that
   * Attempt's own profile" is a claim a fixture with one child could not tell from
   * "scoped to the account".
   */
  async function reviewable(): Promise<Account> {
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
        questionCount: 2,
        chargedAt: new Date(),
      },
      select: { id: true },
    });

    const questionIds: string[] = [];
    for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
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
    await h.prisma.answer.create({
      data: { attemptId: attempt.id, questionId: questionIds[0]!, value: 'three' },
    });
    // Both Questions judged, so the results read has nothing outstanding to re-ask
    // for: a provider call made by the *grading* retry would be counted by the
    // "reading explains nothing" cases below and mistaken for a generation.
    for (const questionId of questionIds) {
      await h.prisma.questionGrade.create({
        data: { attemptId: attempt.id, questionId, state: 'Correct' },
      });
    }

    h.ai.reset();
    return {
      parentAccountId: parent.parentAccountId,
      token,
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

  /** A second retake of the same test, handed in later than the first. */
  async function retake(account: Account): Promise<string> {
    const attempt = await h.prisma.attempt.create({
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
    return attempt.id;
  }

  function runs(token: string, studentProfileId: string) {
    return server()
      .get(`/api/parent/students/${studentProfileId}/attempts`)
      .set('Authorization', bearer(token));
  }

  function results(token: string, attemptId: string) {
    return server()
      .get(`/api/parent/attempts/${attemptId}/results`)
      .set('Authorization', bearer(token));
  }

  function explanations(token: string, attemptId: string) {
    return server()
      .get(`/api/parent/attempts/${attemptId}/explanations`)
      .set('Authorization', bearer(token));
  }

  function flag(token: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/parent/attempts/${attemptId}/questions/${questionId}/explanation-flag`)
      .set('Authorization', bearer(token));
  }

  /** How many provider calls the captured seam has seen, of any class. */
  function providerCalls(): number {
    return h.ai.sent.length;
  }

  // --- The run list ------------------------------------------------------

  it('lists a child’s handed-in runs newest first, with the Subject on each', async () => {
    const account = await reviewable();
    const second = await retake(account);

    const response = await runs(account.token, account.studentProfileId).expect(200);
    expect(response.body).toHaveLength(2);
    // Newest first: the retake was handed in after the first run.
    expect(response.body[0].attemptId).toBe(second);
    expect(response.body[0].ordinal).toBe(2);
    expect(response.body[1].attemptId).toBe(account.attemptId);
    expect(response.body[1].ordinal).toBe(1);
    for (const row of response.body) {
      expect(typeof row.submittedAt).toBe('string');
      expect(row.questionCount).toBe(2);
      expect(typeof row.subjectName).toBe('string');
      // No grade, no score and no billing fact anywhere on a run row.
      expect(Object.keys(row).sort()).toEqual([
        'attemptId',
        'ordinal',
        'practiceTestId',
        'questionCount',
        'subjectName',
        'submittedAt',
      ]);
    }
  });

  it('answers an empty list for a child with nothing handed in', async () => {
    const account = await reviewable();
    // The sibling exists and has sat nothing: a state the screen renders, not a fault.
    await runs(account.token, account.siblingProfileId).expect(200).expect([]);
  });

  it('leaves an open run out of the list entirely', async () => {
    const account = await reviewable();
    await h.prisma.attempt.create({
      data: {
        practiceTestId: account.practiceTestId,
        parentAccountId: account.parentAccountId,
        studentProfileId: account.studentProfileId,
        ordinal: 2,
        startedAt: new Date(),
      },
    });
    const response = await runs(account.token, account.studentProfileId).expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].attemptId).toBe(account.attemptId);
  });

  it('answers a foreign or unknown profile with the same empty list, never a refusal', async () => {
    const mine = await reviewable();
    const theirs = await reviewable();

    // Another account's real profile, and an id that never existed. Both `[]`: a 404
    // for the unknown one would be a confirmation for the known one.
    await runs(mine.token, theirs.studentProfileId).expect(200).expect([]);
    await runs(mine.token, UNKNOWN_UUID).expect(200).expect([]);
    // And the other account still reads its own.
    const response = await runs(theirs.token, theirs.studentProfileId).expect(200);
    expect(response.body).toHaveLength(1);
  });

  // --- The Attempt detail ------------------------------------------------

  it('reads one Attempt’s whole answer key and its score, by account alone', async () => {
    const account = await reviewable();
    const response = await results(account.token, account.attemptId).expect(200);

    expect(response.body.attemptId).toBe(account.attemptId);
    expect(response.body.questions).toHaveLength(2);
    expect(response.body.questions.map((row: { ordinal: number }) => row.ordinal)).toEqual([1, 2]);
    expect(response.body.score.correct).toBe(2);
    expect(response.body.score.denominator).toBe(2);
    // **This route answers the parent's superset shape since Story 6.5**, which carries
    // the rationale FR-25 makes a parent decide an override on. Story 6.2 asserted its
    // absence here; that promise was "this route will not widen", and 6.5 replaced it
    // with the stronger one — the widening lives on `ParentAttemptResultsView` and
    // cannot reach the child's `AttemptResultsView`, which is asserted where that shape
    // is composed and over the student routes themselves in `grade-dispute.int-spec.ts`.
    // What this case still pins is that the rationale field exists on a parent response
    // rather than being smuggled onto the shared row: the Questions here were graded
    // deterministically, so every value is null and no prose is on the wire.
    expect(
      (response.body.questions as { rationale: string | null }[]).every(
        (row) => row.rationale === null,
      ),
    ).toBe(true);
  });

  it('refuses a foreign, unknown or still-open Attempt with the one shared sentence', async () => {
    const mine = await reviewable();
    const theirs = await reviewable();
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

    for (const attemptId of [theirs.attemptId, UNKNOWN_UUID, open.id]) {
      const refusal = await results(mine.token, attemptId).expect(404);
      expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      const second = await explanations(mine.token, attemptId).expect(404);
      expect(second.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    }
  });

  it('ends Parent View rather than answering on every route, the write included', async () => {
    const account = await reviewable();
    await storeExplanation(account, account.questionIds[0]!);

    // All four, and the flag in particular: it is the one route in this story that
    // writes, so an elevation check it did not carry would be the one that mattered.
    for (const refused of [
      await runs('not-a-token', account.studentProfileId).expect(401),
      await results('not-a-token', account.attemptId).expect(401),
      await explanations('not-a-token', account.attemptId).expect(401),
      await flag('not-a-token', account.attemptId, account.questionIds[0]!).expect(401),
    ]) {
      // `elevated: false` is the guard naming itself as the refuser, which is what the
      // web reads to end Parent View rather than to show a retry.
      expect(refused.body.elevated).toBe(false);
    }
    // And the refused press wrote nothing.
    expect(await h.prisma.explanationFlag.count()).toBe(0);
  });

  it('refuses a malformed id on every new parent route, before reading anything', async () => {
    const account = await reviewable();
    await storeExplanation(account, account.questionIds[0]!);

    // A 400 on shape, which is what `ParseUUIDPipe` is for and what every other parent
    // route already does: a malformed id on a parent surface is a fault in the caller.
    // The student routes deliberately carry no pipe, because a child's surface answers
    // every refusal with one sentence — so this is a difference worth asserting rather
    // than assuming.
    await runs(account.token, 'not-a-uuid').expect(400);
    await results(account.token, 'not-a-uuid').expect(400);
    await explanations(account.token, 'not-a-uuid').expect(400);
    // Both ids on the flag route, one at a time, so neither pipe can be the only one.
    await flag(account.token, 'not-a-uuid', account.questionIds[0]!).expect(400);
    await flag(account.token, account.attemptId, 'not-a-uuid').expect(400);

    expect(await h.prisma.explanationFlag.count()).toBe(0);
  });

  // --- The Explanation read ----------------------------------------------

  it('returns one entry per stored Explanation and nothing for an unasked Question', async () => {
    const account = await reviewable();
    await storeExplanation(account, account.questionIds[0]!);

    const response = await explanations(account.token, account.attemptId).expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].questionId).toBe(account.questionIds[0]);
    expect(response.body[0].body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
    expect(response.body[0].parentFlaggedAt).toBeNull();
    // The second Question is absent, not an empty entry: the screen is what says
    // nothing was explained.
    expect(
      response.body.some(
        (view: { questionId: string }) => view.questionId === account.questionIds[1],
      ),
    ).toBe(false);
  });

  it('generates nothing and spends nothing when a parent reads', async () => {
    const account = await reviewable();
    await storeExplanation(account, account.questionIds[0]!);
    const before = await h.allowance.consumptionFor(account.parentAccountId);

    await results(account.token, account.attemptId).expect(200);
    await explanations(account.token, account.attemptId).expect(200);

    // Not one provider call of any class, and not one new row: an Explanation the
    // child never asked for does not exist and is not generated here.
    expect(providerCalls()).toBe(0);
    expect(await h.prisma.explanation.count({ where: { attemptId: account.attemptId } })).toBe(1);
    const after = await h.allowance.consumptionFor(account.parentAccountId);
    expect(after.allowances.explanation.used).toBe(before.allowances.explanation.used);
  });

  it('never returns a sibling’s Explanation of the same Attempt', async () => {
    const account = await reviewable();
    await storeExplanation(account, account.questionIds[0]!);
    // The same Attempt and the same Question, keyed to the other child. The rows are
    // read by this Attempt's *own* profile, resolved from the Attempt row, so this
    // one is unreachable through any id a request can carry.
    await storeExplanation(account, account.questionIds[0]!, {
      studentProfileId: account.siblingProfileId,
      value: 'The sibling’s prose.',
    });

    const response = await explanations(account.token, account.attemptId).expect(200);
    expect(response.body).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain('sibling');
  });

  it('answers an Attempt nobody asked anything about with an empty list', async () => {
    const account = await reviewable();
    await explanations(account.token, account.attemptId).expect(200).expect([]);
  });

  it('reads a student-originated flag as no parent flag, and flags beside it', async () => {
    // The origin is **part of the identity of a flag**, not a label on it, and this is
    // the case that holds both halves of that to account: the read's
    // `where: { origin: 'Parent' }` and the `origin` component of
    // `@@unique([explanationId, origin])`. Without a `Student` row in the database
    // either could be deleted with every other case here still green — and Story 6.3,
    // which adds the student route, would find the parent's surface already reporting
    // the child's own concerns as the parent's.
    const account = await reviewable();
    const explanationId = await storeExplanation(account, account.questionIds[0]!);
    const studentFlaggedAt = new Date('2026-09-20T08:00:00.000Z');
    await h.prisma.explanationFlag.create({
      data: {
        explanationId,
        parentAccountId: account.parentAccountId,
        studentProfileId: account.studentProfileId,
        origin: 'Student',
        createdAt: studentFlaggedAt,
      },
    });

    // A flag exists, and it is not the parent's. `parentFlaggedAt` is about the parent.
    const before = await explanations(account.token, account.attemptId).expect(200);
    expect(before.body).toHaveLength(1);
    expect(before.body[0].parentFlaggedAt).toBeNull();

    // The parent's press writes its **own** row rather than being absorbed by the
    // student's: two people raised a concern, and the unique key is per origin.
    const response = await flag(account.token, account.attemptId, account.questionIds[0]!).expect(
      200,
    );
    expect(typeof response.body.parentFlaggedAt).toBe('string');
    expect(response.body.parentFlaggedAt).not.toBe(studentFlaggedAt.toISOString());

    const rows = await h.prisma.explanationFlag.findMany({
      where: { explanationId },
      orderBy: { origin: 'asc' },
      select: { origin: true, createdAt: true },
    });
    expect(rows.map((row) => row.origin)).toEqual(['Parent', 'Student']);
    // The child's instant is untouched: the parent's press is not an update of it.
    expect(rows[1]!.createdAt.toISOString()).toBe(studentFlaggedAt.toISOString());
    // And the read now states the parent's own instant, still not the child's.
    const after = await explanations(account.token, account.attemptId).expect(200);
    expect(after.body[0].parentFlaggedAt).toBe(response.body.parentFlaggedAt);
  });

  // --- The flag ----------------------------------------------------------

  it('records one parent-originated flag on the first press', async () => {
    const account = await reviewable();
    const explanationId = await storeExplanation(account, account.questionIds[0]!);

    const response = await flag(account.token, account.attemptId, account.questionIds[0]!).expect(
      200,
    );
    expect(response.body.questionId).toBe(account.questionIds[0]);
    expect(typeof response.body.parentFlaggedAt).toBe('string');

    const rows = await h.prisma.explanationFlag.findMany({
      select: { explanationId: true, origin: true, parentAccountId: true, studentProfileId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      explanationId,
      origin: 'Parent',
      parentAccountId: account.parentAccountId,
      studentProfileId: account.studentProfileId,
    });

    // And the read now states it.
    const read = await explanations(account.token, account.attemptId).expect(200);
    expect(read.body[0].parentFlaggedAt).toBe(response.body.parentFlaggedAt);
  });

  it('records no second flag on a second press, and answers the first instant', async () => {
    const account = await reviewable();
    await storeExplanation(account, account.questionIds[0]!);

    const first = await flag(account.token, account.attemptId, account.questionIds[0]!).expect(200);
    const second = await flag(account.token, account.attemptId, account.questionIds[0]!).expect(
      200,
    );
    const third = await flag(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    expect(second.body.parentFlaggedAt).toBe(first.body.parentFlaggedAt);
    expect(third.body.parentFlaggedAt).toBe(first.body.parentFlaggedAt);
    expect(await h.prisma.explanationFlag.count()).toBe(1);
  });

  it('changes nothing but the flag row: not the prose, not the grade, not the score', async () => {
    const account = await reviewable();
    await storeExplanation(account, account.questionIds[0]!);
    const before = await results(account.token, account.attemptId).expect(200);
    const prose = await explanations(account.token, account.attemptId).expect(200);

    await flag(account.token, account.attemptId, account.questionIds[0]!).expect(200);

    const after = await results(account.token, account.attemptId).expect(200);
    expect(after.body.score).toEqual(before.body.score);
    expect(after.body.questions).toEqual(before.body.questions);
    const again = await explanations(account.token, account.attemptId).expect(200);
    expect(again.body[0].body).toEqual(prose.body[0].body);
    // The stored row itself is untouched apart from having a flag beside it.
    const stored = await h.prisma.explanation.findFirstOrThrow({
      where: { attemptId: account.attemptId, studentProfileId: account.studentProfileId },
      select: { body: true, chargedAt: true },
    });
    expect(stored.body).toEqual([{ kind: 'text', value: 'Half of six is three.' }]);
    expect(stored.chargedAt).not.toBeNull();
  });

  it('refuses a flag on a Question with no Explanation, and writes nothing', async () => {
    const account = await reviewable();
    const refusal = await flag(account.token, account.attemptId, account.questionIds[1]!).expect(
      404,
    );
    expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(await h.prisma.explanationFlag.count()).toBe(0);
    // And nothing was generated to have something to flag.
    expect(providerCalls()).toBe(0);
    expect(await h.prisma.explanation.count()).toBe(0);
  });

  it('refuses a flag on another account’s Attempt, and writes nothing', async () => {
    const mine = await reviewable();
    const theirs = await reviewable();
    await storeExplanation(theirs, theirs.questionIds[0]!);

    const refusal = await flag(mine.token, theirs.attemptId, theirs.questionIds[0]!).expect(404);
    expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(await h.prisma.explanationFlag.count()).toBe(0);
  });

  it('refuses a flag on a sibling-keyed Explanation of a readable Attempt', async () => {
    const account = await reviewable();
    // The only stored row for this Question belongs to the other child. The flag path
    // reads by this Attempt's own profile, so there is nothing here to flag.
    await storeExplanation(account, account.questionIds[0]!, {
      studentProfileId: account.siblingProfileId,
    });

    const refusal = await flag(account.token, account.attemptId, account.questionIds[0]!).expect(
      404,
    );
    expect(refusal.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    expect(await h.prisma.explanationFlag.count()).toBe(0);
  });
});
