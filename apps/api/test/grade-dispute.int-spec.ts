import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { GRADE_ALREADY_RECORDED, GRADE_NOT_JUDGED } = await import(
  '../src/grading/grading-policy.js'
);
const { PRACTICE_TEST_NOT_FOUND } = await import('../src/practicetest/practice-test-policy.js');
const {
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
 * A child saying a grade is wrong and a parent changing it — end to end through the real
 * app and the real database.
 *
 * The **stateful** rows of the story's I/O matrix live here and can live nowhere else:
 * that a dispute writes one row and a second press writes none, that a dispute moves no
 * grade and no score, that the cross-account and still-open refusals are one sentence,
 * that both 409s refuse and write nothing, that the flip and the recomputed score arrive
 * together, that the AI's verdict and its rationale are still stored and still readable by
 * the parent afterwards, that the parent's list orders and nulls as promised, and that
 * **no** student-scoped response carries a rationale. The pure rows — the three override
 * decisions, effective-state resolution, both scores over a mixed Attempt — are unit specs
 * beside the code.
 *
 * The Attempt and everything under it are written straight to the tables, for the reason
 * `student-explanation-flag.int-spec.ts` gives: these cases are about a finished run's
 * grades, not about producing one, and driving the whole upload-extract-generate-release-
 * sit-hand-in flow per case would spend the setup's provider calls in the middle of
 * asserting that this story makes none.
 */
describe('Grade dispute and override: raised once, adjusted in one transaction', () => {
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
    /** An Attempt of this account that is still open. */
    openAttemptId: string;
    questionIds: string[];
  }

  /**
   * One account, two children, and behind the first a handed-in four-Question Attempt
   * whose grades are one of each state.
   *
   * One of each deliberately: `Correct` and `Incorrect` are the two an override moves
   * between, and `Unanswered` and `Ungraded` are the two it refuses — so a single fixture
   * covers both 409 arms and the mixed-Attempt score. The rationale sits on the
   * `Incorrect` row, because that is the row FR-25 is about.
   *
   * Two children, for the reason the flag suite has two: "a child reaches only their own
   * Attempt" is a claim a fixture with one child could not tell from "reaches anything of
   * the account".
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
        questionCount: 4,
        chargedAt: new Date(),
      },
      select: { id: true },
    });

    const questionIds: string[] = [];
    for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: practiceTest.id,
          ordinal,
          // Multiple Choice would be re-judged deterministically by `resolveUngraded`,
          // which is how the `Ungraded` row below would stop being `Ungraded` on the
          // first read. Short Answer with no stored answer is not askable either, so the
          // row stays exactly as this fixture wrote it.
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: `What is half of ${ordinal * 6}?` }],
          answer: ordinal === 4 ? undefined : [{ kind: 'text', value: `${ordinal * 3}` }],
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
    const open = await h.prisma.attempt.create({
      data: {
        practiceTestId: practiceTest.id,
        parentAccountId: parent.parentAccountId,
        studentProfileId: profile.id,
        ordinal: 2,
        startedAt: new Date(),
      },
      select: { id: true },
    });

    // One of each state, in ordinal order: Correct, Incorrect (with the rationale a
    // parent decides on), Unanswered, Ungraded.
    await h.prisma.answer.create({
      data: { attemptId: attempt.id, questionId: questionIds[0]!, value: 'three' },
    });
    await h.prisma.questionGrade.create({
      data: { attemptId: attempt.id, questionId: questionIds[0]!, state: 'Correct' },
    });
    await h.prisma.answer.create({
      data: { attemptId: attempt.id, questionId: questionIds[1]!, value: 'six halves' },
    });
    await h.prisma.questionGrade.create({
      data: {
        attemptId: attempt.id,
        questionId: questionIds[1]!,
        state: 'Incorrect',
        rationale: 'The answer names a fraction rather than the number six.',
      },
    });
    await h.prisma.questionGrade.create({
      data: { attemptId: attempt.id, questionId: questionIds[2]!, state: 'Unanswered' },
    });
    await h.prisma.answer.create({
      data: { attemptId: attempt.id, questionId: questionIds[3]!, value: 'twelve' },
    });
    await h.prisma.questionGrade.create({
      data: { attemptId: attempt.id, questionId: questionIds[3]!, state: 'Ungraded' },
    });

    h.ai.reset();
    return {
      parentAccountId: parent.parentAccountId,
      token,
      cookie,
      studentProfileId: profile.id,
      siblingProfileId: sibling.id,
      practiceTestId: practiceTest.id,
      attemptId: attempt.id,
      openAttemptId: open.id,
      questionIds,
    };
  }

  // --- The routes, spelled once -------------------------------------------

  /** The child's own results read. */
  function results(cookie: string, attemptId: string) {
    return server().get(`/api/student/attempts/${attemptId}/results`).set('Cookie', cookie);
  }

  /** The child objecting to one grade. */
  function dispute(cookie: string, attemptId: string, questionId: string) {
    return server()
      .post(`/api/student/attempts/${attemptId}/questions/${questionId}/grade-dispute`)
      .set('Cookie', cookie);
  }

  /** The child's home-screen run history: one entry per practice test they finished. */
  function runHistory(cookie: string) {
    return server().get('/api/student/practice-test-runs').set('Cookie', cookie);
  }

  /** The parent's own read of the same Attempt. */
  function parentResults(token: string, attemptId: string) {
    return server()
      .get(`/api/parent/attempts/${attemptId}/results`)
      .set('Authorization', bearer(token));
  }

  function override(token: string, attemptId: string, questionId: string, state: unknown) {
    return server()
      .post(`/api/parent/attempts/${attemptId}/questions/${questionId}/grade-override`)
      .set('Authorization', bearer(token))
      .send({ state });
  }

  function disputeList(token: string, studentProfileId: string) {
    return server()
      .get(`/api/parent/students/${studentProfileId}/grade-disputes`)
      .set('Authorization', bearer(token));
  }

  /** Every grade row of one Attempt, straight off the table. */
  function storedGrades(attemptId: string) {
    return h.prisma.questionGrade.findMany({
      where: { attemptId },
      orderBy: { question: { ordinal: 'asc' } },
      select: {
        questionId: true,
        state: true,
        rationale: true,
        overrideState: true,
        overriddenAt: true,
      },
    });
  }

  function storedDisputes(attemptId: string) {
    return h.prisma.gradeDispute.findMany({ where: { attemptId } });
  }

  // --- The child raising a hand -------------------------------------------

  describe('a child disputes a grade', () => {
    it('records the dispute and changes no grade, no score and no other row', async () => {
      const account = await sat();
      const before = await results(account.cookie, account.attemptId).expect(200);

      const response = await dispute(
        account.cookie,
        account.attemptId,
        account.questionIds[1]!,
      ).expect(200);

      // One row, and it names the child and the account off the scope rather than off a
      // request: nothing in the path said whose it was.
      const rows = await storedDisputes(account.attemptId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.questionId).toBe(account.questionIds[1]);
      expect(rows[0]!.studentProfileId).toBe(account.studentProfileId);
      expect(rows[0]!.parentAccountId).toBe(account.parentAccountId);

      // The row reads disputed and everything else about the Attempt is as it was. The
      // score in particular: a dispute is a record, and FR-25's remedy is the override.
      const row = (response.body.questions as { questionId: string; disputed: boolean }[]).find(
        (question) => question.questionId === account.questionIds[1],
      );
      expect(row?.disputed).toBe(true);
      expect(response.body.score).toEqual(before.body.score);
      expect(response.body.originalScore).toBeNull();
      expect(
        (response.body.questions as { state: string }[]).map((question) => question.state),
      ).toEqual((before.body.questions as { state: string }[]).map((question) => question.state));
      // No provider call: a dispute asks nothing of anybody upstream.
      expect(h.ai.sent).toHaveLength(0);
    });

    it('answers the same row with the first instant when it is pressed twice', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);
      const first = await storedDisputes(account.attemptId);

      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);

      // The same row, and the same `createdAt`: the unique key makes a second press the
      // same objection, and the upsert's empty `update` arm is what keeps the instant.
      const second = await storedDisputes(account.attemptId);
      expect(second).toHaveLength(1);
      expect(second[0]!.id).toBe(first[0]!.id);
      expect(second[0]!.createdAt.toISOString()).toBe(first[0]!.createdAt.toISOString());
    });

    it('disputes each Question separately and leaves the others alone', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
      const response = await dispute(
        account.cookie,
        account.attemptId,
        account.questionIds[1]!,
      ).expect(200);

      expect(await storedDisputes(account.attemptId)).toHaveLength(2);
      const disputed = (response.body.questions as { questionId: string; disputed: boolean }[])
        .filter((question) => question.disputed)
        .map((question) => question.questionId);
      expect(disputed).toEqual([account.questionIds[0], account.questionIds[1]]);
    });

    it('lets a child dispute an Unanswered or Ungraded row, and writes only the record', async () => {
      // There is no student-side rule about which states may be objected to, and
      // deliberately: the refusals that exist are the *parent's*, at the point a grade
      // would change. A child told "you may not say that" about a blank would be a
      // refusal explaining a mechanic they are never shown (AD-20).
      const account = await sat();

      await dispute(account.cookie, account.attemptId, account.questionIds[2]!).expect(200);
      await dispute(account.cookie, account.attemptId, account.questionIds[3]!).expect(200);

      expect(await storedDisputes(account.attemptId)).toHaveLength(2);
      const grades = await storedGrades(account.attemptId);
      expect(grades.every((grade) => grade.overrideState === null)).toBe(true);
    });

    it('refuses a foreign Attempt with the one shared sentence and writes nothing', async () => {
      const mine = await sat();
      const theirs = await sat();

      const response = await dispute(mine.cookie, theirs.attemptId, theirs.questionIds[1]!).expect(
        404,
      );

      expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(await storedDisputes(theirs.attemptId)).toHaveLength(0);
    });

    it('refuses a sibling’s Attempt with the same sentence, never a 403', async () => {
      const account = await sat();
      // The same account, a different child. The device is bound to the first.
      const sibling = await h.prisma.attempt.create({
        data: {
          practiceTestId: account.practiceTestId,
          parentAccountId: account.parentAccountId,
          studentProfileId: account.siblingProfileId,
          ordinal: 1,
          startedAt: new Date(Date.now() - 600_000),
          submittedAt: new Date(Date.now() - 300_000),
        },
        select: { id: true },
      });

      const response = await dispute(account.cookie, sibling.id, account.questionIds[1]!).expect(
        404,
      );

      expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(await storedDisputes(sibling.id)).toHaveLength(0);
    });

    it('refuses an unknown Attempt and an unknown Question with the same sentence', async () => {
      const account = await sat();

      const unknownAttempt = await dispute(
        account.cookie,
        UNKNOWN_UUID,
        account.questionIds[1]!,
      ).expect(404);
      const unknownQuestion = await dispute(account.cookie, account.attemptId, UNKNOWN_UUID).expect(
        404,
      );

      expect(unknownAttempt.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(unknownQuestion.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(await storedDisputes(account.attemptId)).toHaveLength(0);
    });

    it('refuses a malformed id with the same 404 rather than a 400', async () => {
      // No `ParseUUIDPipe` on this surface: a 400 on shape would be a second kind of
      // refusal where the whole discipline is one sentence.
      const account = await sat();

      const response = await dispute(account.cookie, 'not-a-uuid', 'also-not').expect(404);

      expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    });

    it('refuses an Attempt that is still open with the same sentence', async () => {
      const account = await sat();

      const response = await dispute(
        account.cookie,
        account.openAttemptId,
        account.questionIds[1]!,
      ).expect(404);

      expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      expect(await storedDisputes(account.openAttemptId)).toHaveLength(0);
    });
  });

  // --- Nothing parent-scoped on a student surface --------------------------

  describe('the student surface', () => {
    it('carries no rationale, override mechanics or billing figure, before or after either write', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);
      await override(account.token, account.attemptId, account.questionIds[1]!, 'Correct').expect(
        200,
      );

      // Every student-scoped response this story can produce, over an Attempt carrying a
      // dispute *and* an override — which is the state in which a leak would be easiest.
      const read = await results(account.cookie, account.attemptId).expect(200);
      const written = await dispute(
        account.cookie,
        account.attemptId,
        account.questionIds[0]!,
      ).expect(200);

      for (const body of [read.body, written.body]) {
        const serialized = JSON.stringify(body);
        for (const field of [
          'rationale',
          'aiState',
          'overrideState',
          'overriddenAt',
          'disputedAt',
          'disposition',
          'cost',
          'tier',
          'model',
          'allowance',
        ]) {
          expect(serialized).not.toMatch(new RegExp(`"${field}"\\s*:`, 'iu'));
        }
        // The rationale's own words, in case a future field carried them under another
        // name. The stored sentence is the fixture's, so this is exact rather than a guess.
        expect(serialized).not.toContain('names a fraction');
      }
    });

    it('states the adjusted grade and the score as a change, with nothing about who decided', async () => {
      const account = await sat();
      await override(account.token, account.attemptId, account.questionIds[1]!, 'Correct').expect(
        200,
      );

      const response = await results(account.cookie, account.attemptId).expect(200);

      const row = (
        response.body.questions as { questionId: string; state: string; parentAdjusted: boolean }[]
      ).find((question) => question.questionId === account.questionIds[1]);
      // The effective grade is the child's grade.
      expect(row?.state).toBe('Correct');
      expect(row?.parentAdjusted).toBe(true);
      // Two of four judged, one of which is now `Correct` — and the prior figure beside
      // it rather than instead of it.
      expect(response.body.score).toEqual({ correct: 2, denominator: 3, excludedUngraded: 1 });
      expect(response.body.originalScore).toEqual({
        correct: 1,
        denominator: 3,
        excludedUngraded: 1,
      });
    });

    it('reports the adjusted figure on the home screen too, not the recorded one', async () => {
      // **One denominator on every surface** (FR-37). The run history is a second read of
      // the same grades through a different path, and before Story 6.5 it selected only
      // the provider's verdict — so a child would have read one figure on their results
      // screen and a different one on their home screen for the same run, which is the
      // second denominator arrived at by forgetting a column rather than by writing a
      // second count.
      const account = await sat();
      const before = await runHistory(account.cookie).expect(200);
      expect(before.body[0].latest.score).toEqual({
        correct: 1,
        denominator: 3,
        excludedUngraded: 1,
      });

      await override(account.token, account.attemptId, account.questionIds[1]!, 'Correct').expect(
        200,
      );

      const read = await results(account.cookie, account.attemptId).expect(200);
      const after = await runHistory(account.cookie).expect(200);
      // The same figure, from two reads composed by two methods.
      expect(after.body[0].latest.score).toEqual(read.body.score);
      expect(after.body[0].latest.score).toEqual({
        correct: 2,
        denominator: 3,
        excludedUngraded: 1,
      });
      // And the first run is the same run here, so its figure moved with it.
      expect(after.body[0].first.score).toEqual(read.body.score);
      // Still no rationale or override mechanic on a student-scoped read.
      const serialized = JSON.stringify(after.body);
      for (const field of ['rationale', 'aiState', 'overrideState', 'overriddenAt']) {
        expect(serialized).not.toMatch(new RegExp(`"${field}"\\s*:`, 'iu'));
      }
    });

    it('states no prior score at all while nothing has been adjusted', async () => {
      const account = await sat();

      const response = await results(account.cookie, account.attemptId).expect(200);

      // Null, not an identical fraction: every surface would otherwise have to compare
      // two figures and decide for itself whether that counts as a change.
      expect(response.body.originalScore).toBeNull();
      expect(
        (response.body.questions as { parentAdjusted: boolean }[]).every(
          (question) => !question.parentAdjusted,
        ),
      ).toBe(true);
    });
  });

  // --- The parent's read --------------------------------------------------

  describe('the parent’s read', () => {
    it('carries the AI verdict and its rationale beside the effective grade', async () => {
      const account = await sat();
      await override(account.token, account.attemptId, account.questionIds[1]!, 'Correct').expect(
        200,
      );

      const response = await parentResults(account.token, account.attemptId).expect(200);

      const row = (
        response.body.questions as {
          questionId: string;
          state: string;
          aiState: string;
          rationale: string | null;
          parentAdjusted: boolean;
          overriddenAt: string | null;
        }[]
      ).find((question) => question.questionId === account.questionIds[1]);
      expect(row?.state).toBe('Correct');
      // Retained, never overwritten. This is FR-25's whole requirement.
      expect(row?.aiState).toBe('Incorrect');
      expect(row?.rationale).toBe('The answer names a fraction rather than the number six.');
      expect(row?.parentAdjusted).toBe(true);
      expect(row?.overriddenAt).not.toBeNull();
    });

    it('states aiState equal to state on a row nobody adjusted, and a null rationale where none was given', async () => {
      const account = await sat();

      const response = await parentResults(account.token, account.attemptId).expect(200);

      const rows = response.body.questions as {
        state: string;
        aiState: string;
        rationale: string | null;
        overriddenAt: string | null;
        disputedAt: string | null;
      }[];
      expect(rows.map((row) => row.state)).toEqual([
        'Correct',
        'Incorrect',
        'Unanswered',
        'Ungraded',
      ]);
      expect(rows.map((row) => row.aiState)).toEqual(rows.map((row) => row.state));
      // Null on the deterministic verdict, on the blank and on the ungraded row: a row
      // with no rationale is not a row whose rationale failed to load.
      expect(rows.map((row) => row.rationale === null)).toEqual([true, false, true, true]);
      expect(rows.every((row) => row.overriddenAt === null)).toBe(true);
      expect(rows.every((row) => row.disputedAt === null)).toBe(true);
    });

    it('carries the child’s objection with its instant', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);

      const response = await parentResults(account.token, account.attemptId).expect(200);

      const row = (
        response.body.questions as {
          questionId: string;
          disputed: boolean;
          disputedAt: string | null;
        }[]
      ).find((question) => question.questionId === account.questionIds[1]);
      expect(row?.disputed).toBe(true);
      expect(row?.disputedAt).not.toBeNull();
    });

    it('refuses a foreign, unknown and still-open Attempt with the one shared sentence', async () => {
      const mine = await sat();
      const theirs = await sat();

      for (const attemptId of [theirs.attemptId, UNKNOWN_UUID, mine.openAttemptId]) {
        const response = await parentResults(mine.token, attemptId).expect(404);
        expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      }
    });
  });

  // --- The override -------------------------------------------------------

  describe('a parent overrides a grade', () => {
    it('flips the row and states both scores, with the AI verdict still stored', async () => {
      const account = await sat();

      const response = await override(
        account.token,
        account.attemptId,
        account.questionIds[1]!,
        'Correct',
      ).expect(200);

      // The flip and the figure arrive on one response, which is what "a reader can never
      // see one without the other" looks like from outside the transaction.
      expect(response.body.score).toEqual({ correct: 2, denominator: 3, excludedUngraded: 1 });
      expect(response.body.originalScore).toEqual({
        correct: 1,
        denominator: 3,
        excludedUngraded: 1,
      });

      const grades = await storedGrades(account.attemptId);
      expect(grades[1]!.state).toBe('Incorrect');
      expect(grades[1]!.rationale).toBe('The answer names a fraction rather than the number six.');
      expect(grades[1]!.overrideState).toBe('Correct');
      expect(grades[1]!.overriddenAt).not.toBeNull();
      // No other row moved.
      expect(grades.map((grade) => grade.overrideState)).toEqual([null, 'Correct', null, null]);
    });

    it('stands on a Question with no dispute at all', async () => {
      // An override needs no dispute: a parent who spots a harsh grade themselves may fix
      // it, and requiring the child to object first would make the remedy depend on their
      // having noticed.
      const account = await sat();

      await override(account.token, account.attemptId, account.questionIds[1]!, 'Correct').expect(
        200,
      );

      expect(await storedDisputes(account.attemptId)).toHaveLength(0);
      expect((await storedGrades(account.attemptId))[1]!.overrideState).toBe('Correct');
    });

    it('flips a Correct to Incorrect as readily as the other way', async () => {
      const account = await sat();

      const response = await override(
        account.token,
        account.attemptId,
        account.questionIds[0]!,
        'Incorrect',
      ).expect(200);

      expect(response.body.score).toEqual({ correct: 0, denominator: 3, excludedUngraded: 1 });
      expect(response.body.originalScore).toEqual({
        correct: 1,
        denominator: 3,
        excludedUngraded: 1,
      });
    });

    it('lets a parent flip their own earlier override back, and moves the instant', async () => {
      const account = await sat();
      const first = await override(
        account.token,
        account.attemptId,
        account.questionIds[1]!,
        'Correct',
      ).expect(200);
      const firstAt = (await storedGrades(account.attemptId))[1]!.overriddenAt;

      await override(account.token, account.attemptId, account.questionIds[1]!, 'Incorrect').expect(
        200,
      );

      const grades = await storedGrades(account.attemptId);
      expect(grades[1]!.overrideState).toBe('Incorrect');
      expect(grades[1]!.overriddenAt!.getTime()).toBeGreaterThanOrEqual(firstAt!.getTime());
      // Still adjusted, so the prior figure is still stated — even though the two
      // fractions now agree. The rule is "does any row carry an override", not "do the
      // fractions differ": a grade that was touched is a fact the screen keeps.
      expect(first.body.originalScore).not.toBeNull();
    });

    it('refuses the grade that already counts with its own 409 and writes nothing', async () => {
      const account = await sat();

      const response = await override(
        account.token,
        account.attemptId,
        account.questionIds[0]!,
        'Correct',
      ).expect(409);

      expect(response.body.message).toBe(GRADE_ALREADY_RECORDED);
      // Names no child, no number and no tier.
      expect(response.body.message).not.toMatch(/\d/u);
      expect((await storedGrades(account.attemptId))[0]!.overriddenAt).toBeNull();
    });

    it('refuses the grade that already counts through an existing override', async () => {
      const account = await sat();
      await override(account.token, account.attemptId, account.questionIds[1]!, 'Correct').expect(
        200,
      );

      const response = await override(
        account.token,
        account.attemptId,
        account.questionIds[1]!,
        'Correct',
      ).expect(409);

      expect(response.body.message).toBe(GRADE_ALREADY_RECORDED);
    });

    it('refuses an Unanswered row with its own 409 and writes nothing', async () => {
      const account = await sat();

      const response = await override(
        account.token,
        account.attemptId,
        account.questionIds[2]!,
        'Correct',
      ).expect(409);

      expect(response.body.message).toBe(GRADE_NOT_JUDGED);
      expect((await storedGrades(account.attemptId))[2]!.overrideState).toBeNull();
    });

    it('refuses an Ungraded row with the same 409', async () => {
      const account = await sat();

      const response = await override(
        account.token,
        account.attemptId,
        account.questionIds[3]!,
        'Incorrect',
      ).expect(409);

      expect(response.body.message).toBe(GRADE_NOT_JUDGED);
      expect((await storedGrades(account.attemptId))[3]!.overrideState).toBeNull();
    });

    it('refuses a state outside the two before any row is read', async () => {
      // The DTO's closed set. `Unanswered` is a legal `GradeState` and an illegal
      // override, and it dies in the validation pipe rather than as a 409 about a body
      // that was never legal.
      const account = await sat();

      await override(
        account.token,
        account.attemptId,
        account.questionIds[1]!,
        'Unanswered',
      ).expect(400);
      await override(account.token, account.attemptId, account.questionIds[1]!, 'Perfect').expect(
        400,
      );

      expect((await storedGrades(account.attemptId))[1]!.overrideState).toBeNull();
    });

    it('refuses a foreign, unknown and still-open Attempt with the one shared 404', async () => {
      const mine = await sat();
      const theirs = await sat();

      for (const attempt of [
        { id: theirs.attemptId, questionId: theirs.questionIds[1]! },
        { id: UNKNOWN_UUID, questionId: mine.questionIds[1]! },
        { id: mine.openAttemptId, questionId: mine.questionIds[1]! },
      ]) {
        const response = await override(
          mine.token,
          attempt.id,
          attempt.questionId,
          'Correct',
        ).expect(404);
        expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
      }
      expect((await storedGrades(theirs.attemptId))[1]!.overrideState).toBeNull();
    });

    // **The one arm with no case here**, and deliberately: `updateMany` reporting zero
    // rows means the grade row vanished *between* the read inside the transaction and
    // the statement beside it — a cascading delete of the Attempt or the Question landing
    // inside that window. There is no request this suite can make that opens it, and a
    // case that reached in and deleted a row mid-transaction would be asserting on a
    // fixture's timing rather than on the API. The guard is still there, it still throws
    // the shared 404 from inside the transaction so nothing commits, and the case below
    // pins the reachable half: a Question with no grade row at all.

    it('refuses a Question with no grade row with the same 404', async () => {
      const account = await sat();
      await h.prisma.questionGrade.deleteMany({
        where: { attemptId: account.attemptId, questionId: account.questionIds[1]! },
      });

      const response = await override(
        account.token,
        account.attemptId,
        account.questionIds[1]!,
        'Correct',
      ).expect(404);

      expect(response.body.message).toBe(PRACTICE_TEST_NOT_FOUND);
    });

    it('leaves one row and one figure when two presses are in flight together', async () => {
      // `updateMany` on the pair, never a read-then-write: both statements land, the last
      // one wins, and the score each caller reads back describes the rows as they were in
      // its own transaction. What must not happen is a partial write — a flipped row with
      // a stale figure, or two override rows for one pair.
      const account = await sat();

      const [a, b] = await Promise.all([
        override(account.token, account.attemptId, account.questionIds[1]!, 'Correct'),
        override(account.token, account.attemptId, account.questionIds[0]!, 'Incorrect'),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      const grades = await storedGrades(account.attemptId);
      expect(grades[0]!.overrideState).toBe('Incorrect');
      expect(grades[1]!.overrideState).toBe('Correct');
      // One row per pair, by the unique key that was already there.
      expect(grades).toHaveLength(4);
    });

    it('needs elevation, and a bearer-less call reaches nothing', async () => {
      const account = await sat();

      await server()
        .post(
          `/api/parent/attempts/${account.attemptId}/questions/${account.questionIds[1]}/grade-override`,
        )
        .send({ state: 'Correct' })
        .expect(401);

      expect((await storedGrades(account.attemptId))[1]!.overrideState).toBeNull();
    });
  });

  // --- The parent's list --------------------------------------------------

  describe('the dispute list', () => {
    it('lists a child’s disputes newest first, with the context and the recorded grade', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[0]!).expect(200);
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);

      const response = await disputeList(account.token, account.studentProfileId).expect(200);

      const entries = response.body as {
        questionId: string;
        recordedState: string;
        effectiveState: string;
        overriddenAt: string | null;
        runOrdinal: number | null;
        questionOrdinal: number | null;
        subjectName: string | null;
      }[];
      // Newest first: the second objection leads.
      expect(entries.map((entry) => entry.questionId)).toEqual([
        account.questionIds[1],
        account.questionIds[0],
      ]);
      expect(entries[0]!.recordedState).toBe('Incorrect');
      // Awaiting is the absence of an override, not a value somebody wrote.
      expect(entries[0]!.effectiveState).toBe('Incorrect');
      expect(entries[0]!.overriddenAt).toBeNull();
      // The server's own figures, never derived from a position in this list.
      expect(entries[0]!.runOrdinal).toBe(1);
      expect(entries[0]!.questionOrdinal).toBe(2);
      expect(entries[1]!.questionOrdinal).toBe(1);
      expect(entries[0]!.subjectName).not.toBeNull();
    });

    it('keeps a resolved dispute listed, marked with its outcome', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);
      await override(account.token, account.attemptId, account.questionIds[1]!, 'Correct').expect(
        200,
      );

      const response = await disputeList(account.token, account.studentProfileId).expect(200);

      const entries = response.body as {
        recordedState: string;
        effectiveState: string;
        overriddenAt: string | null;
      }[];
      expect(entries).toHaveLength(1);
      // The record of what was objected to, and what counts now. The difference *is* the
      // resolution — there is no `resolution` column and no second writer of it.
      expect(entries[0]!.recordedState).toBe('Incorrect');
      expect(entries[0]!.effectiveState).toBe('Correct');
      expect(entries[0]!.overriddenAt).not.toBeNull();
    });

    it('answers nulls rather than a 404 for a context that no longer resolves', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);
      // Re-opening the run makes it one nothing can name: `flaggedQuestionContextsFor`
      // scopes to submitted Attempts, because a run still open has no results.
      await h.prisma.attempt.update({
        where: { id: account.attemptId },
        data: { submittedAt: null },
      });

      const response = await disputeList(account.token, account.studentProfileId).expect(200);

      const entry = (
        response.body as { runOrdinal: number | null; subjectName: string | null }[]
      )[0];
      expect(entry).toBeDefined();
      // The entry keeps its place and loses its labels: whether an objection was raised is
      // not contingent on being able to name what it was about.
      expect(entry!.runOrdinal).toBeNull();
      expect(entry!.subjectName).toBeNull();
    });

    it('answers an empty list for a child with nothing disputed', async () => {
      const account = await sat();

      const response = await disputeList(account.token, account.studentProfileId).expect(200);

      expect(response.body).toEqual([]);
    });

    it('answers an empty list for a sibling and for another account’s child, never a 404', async () => {
      const account = await sat();
      const theirs = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);

      // A 404 for an unknown id would be a confirmation for a known one (AD-18).
      expect((await disputeList(account.token, account.siblingProfileId).expect(200)).body).toEqual(
        [],
      );
      expect((await disputeList(theirs.token, account.studentProfileId).expect(200)).body).toEqual(
        [],
      );
      expect((await disputeList(account.token, UNKNOWN_UUID).expect(200)).body).toEqual([]);
    });

    it('carries no rationale, prose or billing figure', async () => {
      const account = await sat();
      await dispute(account.cookie, account.attemptId, account.questionIds[1]!).expect(200);

      const response = await disputeList(account.token, account.studentProfileId).expect(200);

      const serialized = JSON.stringify(response.body);
      for (const field of ['rationale', 'body', 'cost', 'tier', 'model', 'mastery', 'score']) {
        expect(serialized).not.toMatch(new RegExp(`"${field}"\\s*:`, 'iu'));
      }
    });

    it('needs elevation', async () => {
      const account = await sat();

      await server()
        .get(`/api/parent/students/${account.studentProfileId}/grade-disputes`)
        .expect(401);
    });
  });
});
