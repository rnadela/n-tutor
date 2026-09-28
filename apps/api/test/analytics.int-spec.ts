import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { MASTERY_ATTEMPT_WINDOW } = await import('../src/grading/mastery.js');
const { weakAreaRuntime } = await import('../src/grading/weak-area-policy.js');
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
 * The Parent View dashboard — one read, through the real app and the real
 * database.
 *
 * **The stateful claims live here and can live nowhere else**: that the ranked
 * table carries names and skipped counts off rows a real hand-in wrote, that the
 * trend excludes retakes and caps at the window, that the activity tally and both
 * awaiting counts come out right, that the allowance is the *account's* figure and
 * states unlimited as an absence, that a child with no history gets an empty
 * dashboard rather than a row of zeroes, and — the one this story exists to close
 * — that a **foreign** profile id answers an empty dashboard rather than another
 * parent's figures. The ranking rules themselves are `src/analytics/
 * analytics-view.spec.ts`'s, asserted with no database.
 *
 * The papers are written straight to the tables, exactly as `weak-area.int-spec.ts`
 * writes its own: these cases are about what a finished run's grades come to, and
 * driving upload-extract-generate-release per case would spend the setup's provider
 * calls in the middle of asserting that this read makes none.
 */
describe('Analytics dashboard: one parent-scoped composition behind the PIN', () => {
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
    cookie: string;
    /** The elevation bearer every parent-scoped route takes. */
    token: string;
    studentProfileId: string;
    /** A second child of the same account, with no work of their own. */
    siblingProfileId: string;
    gradeLevelId: string;
    subjectId: string;
  }

  /** One account past the PIN, with two children and a Subject to hang Topics on. */
  async function account(overrides: { email?: string } = {}): Promise<Account> {
    const gradeLevel = await createGradeLevel(h);
    const subject = await createSubject(h, { gradeLevelId: gradeLevel.id });
    const parent = await createSignedInParent(h, overrides);
    await setPinFor(h, parent.cookie, PIN);
    const token = await elevate(h, parent.cookie, PIN);
    const profile = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    const sibling = await createStudentProfile(h, parent.parentAccountId, {
      gradeLevelId: gradeLevel.id,
    });
    return {
      parentAccountId: parent.parentAccountId,
      cookie: parent.cookie,
      token,
      studentProfileId: profile.id,
      siblingProfileId: sibling.id,
      gradeLevelId: gradeLevel.id,
      subjectId: subject.id,
    };
  }

  /**
   * One released Practice Test, one entry per Question, each carrying the raw
   * labels generation emitted. Every Question is Short Answer with a stored
   * answer of `ordinal * 3`, so the `fake` transport's verdict is decided entirely
   * by what the submission puts down.
   */
  async function paper(
    a: Account,
    labels: readonly (readonly string[])[],
    /** Whose paper it is. Defaults to the first child; the sibling cases pass theirs. */
    studentProfileId: string = a.studentProfileId,
  ): Promise<{ practiceTestId: string; questionIds: string[] }> {
    const sourceTest = await h.prisma.sourceTest.create({
      data: {
        parentAccountId: a.parentAccountId,
        studentProfileId,
        status: 'Submitted',
        expiresAt: new Date(Date.now() + 86_400_000),
        submittedAt: new Date(),
        subjectId: a.subjectId,
        gradeLevelId: a.gradeLevelId,
      },
      select: { id: true },
    });
    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId: a.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId,
        requestedCount: labels.length,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const practiceTest = await h.prisma.practiceTest.create({
      data: {
        parentAccountId: a.parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId,
        generationJobId: job.id,
        status: 'Released',
        ordinal: 1,
        questionCount: labels.length,
        chargedAt: new Date(),
      },
      select: { id: true },
    });

    const questionIds: string[] = [];
    for (const [index, questionLabels] of labels.entries()) {
      const ordinal = index + 1;
      const question = await h.prisma.practiceTestQuestion.create({
        data: {
          practiceTestId: practiceTest.id,
          ordinal,
          format: 'ShortAnswer',
          prompt: [{ kind: 'text', value: `What is a third of ${ordinal * 9}?` }],
          answer: [{ kind: 'text', value: `${ordinal * 3}` }],
          topics: { create: questionLabels.map((label) => ({ label })) },
        },
        select: { id: true },
      });
      questionIds.push(question.id);
    }
    return { practiceTestId: practiceTest.id, questionIds };
  }

  async function openAttempt(
    a: Account,
    practiceTestId: string,
    ordinal: number,
    studentProfileId: string = a.studentProfileId,
  ): Promise<string> {
    const attempt = await h.prisma.attempt.create({
      data: {
        practiceTestId,
        parentAccountId: a.parentAccountId,
        studentProfileId,
        ordinal,
        startedAt: new Date(Date.now() - 600_000),
        expiresAt: null,
      },
      select: { id: true },
    });
    return attempt.id;
  }

  /** The answer the fake credits for Question `ordinal`, and one it never will. */
  const right = (ordinal: number) => `${ordinal * 3}`;
  const wrong = 'not the number asked for';

  /** The dashboard, read exactly as the web app reads it. */
  async function dashboard(a: Account, profileId = a.studentProfileId) {
    const response = await server()
      .get(`/api/parent/students/${profileId}/analytics`)
      .set('Authorization', bearer(a.token))
      .expect(200);
    return response.body;
  }

  /**
   * Fourteen Questions across three Topics, handed in as one run:
   *
   * - `fractions` — 2 of 5 right (40%): under the ceiling and at the floor. Weak.
   * - `decimals`  — 4 of 5 right (80%): over the ceiling. Healthy.
   * - `geometry`  — 1 of 4 right (25%): under the ceiling, under the floor. Healthy
   *   for want of evidence, which is what makes the ranking's second clause visible.
   */
  async function handInOnePaper(a: Account): Promise<string> {
    const labels: string[][] = [
      ...Array.from({ length: 5 }, () => ['fractions']),
      ...Array.from({ length: 5 }, () => ['decimals']),
      ...Array.from({ length: 4 }, () => ['geometry']),
    ];
    const { practiceTestId, questionIds } = await paper(a, labels);
    const attemptId = await openAttempt(a, practiceTestId, 1);
    const correctIndexes = new Set([0, 1, 5, 6, 7, 8, 10]);
    await h.grading.submitAttempt(
      a.parentAccountId,
      a.studentProfileId,
      attemptId,
      questionIds.map((questionId, index) => ({
        questionId,
        value: correctIndexes.has(index) ? right(index + 1) : wrong,
      })),
    );
    return attemptId;
  }

  describe('the Mastery table', () => {
    it('ranks the Weak Area first and carries every Topic name and skipped count', async () => {
      const a = await account();
      await handInOnePaper(a);

      const body = await dashboard(a);
      // Weakest-first, and the verdict is on the weak row alone. `geometry` is
      // worse than `fractions` and still not weak: four answered Questions is less
      // evidence than the floor asks for, and the ranking honours the verdict
      // rather than re-deriving one from the percentages.
      expect(body.topics.map((row: { topicName: string }) => row.topicName)).toEqual([
        'fractions',
        'geometry',
        'decimals',
      ]);
      expect(body.topics.map((row: { isWeakArea: boolean }) => row.isWeakArea)).toEqual([
        true,
        false,
        false,
      ]);
      expect(body.topics[0]).toMatchObject({
        topicName: 'fractions',
        subjectName: expect.any(String),
        correct: 2,
        incorrect: 3,
        unanswered: 0,
        answered: 5,
        attemptsCounted: 1,
        value: 0.4,
      });
    });

    it('carries the skipped count on a Topic the child left blank', async () => {
      // The count travels with the figure wherever it is rendered: a percentage
      // read without it is a percentage over an unstated denominator.
      const a = await account();
      const { practiceTestId, questionIds } = await paper(a, [
        ['measurement'],
        ['measurement'],
        ['measurement'],
        ['decimals'],
        ['decimals'],
      ]);
      const attemptId = await openAttempt(a, practiceTestId, 1);
      // Only the two `decimals` Questions are answered; the three `measurement`
      // ones are simply absent, which is what a blank on an unexpired hand-in is.
      await h.grading.submitAttempt(a.parentAccountId, a.studentProfileId, attemptId, [
        { questionId: questionIds[3]!, value: right(4) },
        { questionId: questionIds[4]!, value: wrong },
      ]);

      const body = await dashboard(a);
      const byName = new Map(body.topics.map((row: { topicName: string }) => [row.topicName, row]));
      expect(byName.get('measurement')).toMatchObject({
        correct: 0,
        incorrect: 0,
        unanswered: 3,
        answered: 0,
        value: null,
        isWeakArea: false,
      });
      // And a Topic with no fraction never leads the table, whatever else is on it.
      expect(body.topics.at(-1)).toMatchObject({ topicName: 'measurement' });
    });

    it('names a Topic through the one reader, and answers nothing for an id that is gone', async () => {
      // The name lookup is a second statement after the Mastery read, which is
      // what makes `topicName: null` reachable at all: a Topic deleted between
      // the two comes back unnamed rather than dropping the figure. It cannot be
      // staged by deleting one here — `topic_mastery.topicId` cascades, so the
      // figure goes with the name — so what is asserted against the real database
      // is the half that *is* stageable: the reader omits an id it cannot find,
      // and `describedTopics` turns that omission into a null (unit-specced).
      const a = await account();
      await handInOnePaper(a);
      const known = await h.prisma.topic.findFirstOrThrow({
        where: { name: 'decimals' },
        select: { id: true },
      });

      const described = await h.topics.describe([known.id, UNKNOWN_UUID]);
      expect(described.get(known.id)).toMatchObject({ name: 'decimals', provisional: true });
      expect(described.has(UNKNOWN_UUID)).toBe(false);
      // And an empty ask is an empty map rather than a read.
      expect(await h.topics.describe([])).toEqual(new Map());

      // Every row the dashboard states is named, because every Topic still exists.
      expect(
        (await dashboard(a)).topics.every(
          (row: { topicName: string | null }) => typeof row.topicName === 'string',
        ),
      ).toBe(true);
    });

    it('sends the two tunables the verdict was resolved against, so no surface restates one', async () => {
      const a = await account();
      expect((await dashboard(a)).weakArea).toEqual(weakAreaRuntime());
    });
  });

  describe('the trend', () => {
    /**
     * `count` first-run papers of three Questions each, handed in oldest-first.
     *
     * A **different Topic per paper**, so a run that is on the trend is not
     * automatically in any one Topic's Mastery window: the two windows selecting
     * different Attempts is the case the last assertion in this block is about.
     * Distinct words rather than a numbered series, because `topicMatchKey` strips
     * digits and "topic 1" and "topic 2" would canonicalize to one Topic.
     */
    const RUN_TOPICS = [
      'algebra',
      'measurement',
      'probability',
      'statistics',
      'perimeter',
      'symmetry',
      'rounding',
      'sequences',
    ];

    async function handInRuns(a: Account, count: number): Promise<string[]> {
      const attemptIds: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const label = RUN_TOPICS[index]!;
        const { practiceTestId, questionIds } = await paper(a, [[label], [label], [label]]);
        const attemptId = await openAttempt(a, practiceTestId, 1);
        await h.grading.submitAttempt(
          a.parentAccountId,
          a.studentProfileId,
          attemptId,
          questionIds.map((questionId, ordinal) => ({ questionId, value: right(ordinal + 1) })),
        );
        // Spread the hand-in instants, so "the five most recent by `submittedAt`"
        // is a claim about the column rather than about insertion luck.
        await h.prisma.attempt.update({
          where: { id: attemptId },
          data: { submittedAt: new Date(Date.UTC(2026, 0, index + 1)) },
        });
        attemptIds.push(attemptId);
      }
      return attemptIds;
    }

    it('plots the first runs only and never a retake', async () => {
      const a = await account();
      const firsts = await handInRuns(a, 3);
      // Four retakes of the first paper. Every one is at a higher ordinal, and
      // `countsTowardMastery` answers false for all of them.
      const first = await h.prisma.attempt.findFirstOrThrow({
        where: { id: firsts[0]! },
        select: { practiceTestId: true },
      });
      const questions = await h.prisma.practiceTestQuestion.findMany({
        where: { practiceTestId: first.practiceTestId },
        orderBy: { ordinal: 'asc' },
        select: { id: true, ordinal: true },
      });
      for (let ordinal = 2; ordinal <= 5; ordinal += 1) {
        const retakeId = await openAttempt(a, first.practiceTestId, ordinal);
        await h.grading.submitAttempt(
          a.parentAccountId,
          a.studentProfileId,
          retakeId,
          questions.map((question) => ({
            questionId: question.id,
            value: right(question.ordinal),
          })),
        );
      }

      const body = await dashboard(a);
      expect(body.trend.points.map((point: { attemptId: string }) => point.attemptId)).toEqual(
        firsts,
      );
    });

    it('caps at the Mastery window and returns the most recent, oldest-first', async () => {
      const a = await account();
      const handed = await handInRuns(a, 8);

      const body = await dashboard(a);
      expect(body.trend.windowSize).toBe(MASTERY_ATTEMPT_WINDOW);
      expect(body.trend.points).toHaveLength(MASTERY_ATTEMPT_WINDOW);
      // The five most recent by `submittedAt`, oldest-first — which is the tail of
      // the hand-in order, in the order it happened.
      expect(body.trend.points.map((point: { attemptId: string }) => point.attemptId)).toEqual(
        handed.slice(-MASTERY_ATTEMPT_WINDOW),
      );
      expect(body.trend.points[0]).toMatchObject({
        correct: 3,
        denominator: 3,
        excludedUngraded: 0,
      });
    });

    it('states its own window rather than a Topic’s, and reconciles nothing', async () => {
      // One paper on `fractions` and four on other Topics. `fractions`' Mastery is
      // over the one run that mentioned it; the trend is over all five. Both
      // figures are stated and neither is adjusted to agree with the other.
      const a = await account();
      const { practiceTestId, questionIds } = await paper(a, [['fractions'], ['fractions']]);
      const attemptId = await openAttempt(a, practiceTestId, 1);
      await h.grading.submitAttempt(a.parentAccountId, a.studentProfileId, attemptId, [
        { questionId: questionIds[0]!, value: right(1) },
        { questionId: questionIds[1]!, value: wrong },
      ]);
      await handInRuns(a, 4);

      const body = await dashboard(a);
      const fractions = body.topics.find(
        (row: { topicName: string }) => row.topicName === 'fractions',
      );
      expect(fractions.attemptsCounted).toBe(1);
      expect(body.trend.points).toHaveLength(5);
    });
  });

  describe('the activity summary and the digest', () => {
    it('tallies the released tests by the state each is actually in', async () => {
      const a = await account();
      // Five released papers: two never opened, one open, two handed in.
      const papers = [];
      for (let index = 0; index < 5; index += 1) {
        papers.push(await paper(a, [['fractions'], ['fractions']]));
      }
      const open = await openAttempt(a, papers[2]!.practiceTestId, 1);
      expect(open).toEqual(expect.any(String));
      for (const index of [3, 4]) {
        const sheet = papers[index]!;
        const attemptId = await openAttempt(a, sheet.practiceTestId, 1);
        await h.grading.submitAttempt(
          a.parentAccountId,
          a.studentProfileId,
          attemptId,
          sheet.questionIds.map((questionId, ordinal) => ({
            questionId,
            value: right(ordinal + 1),
          })),
        );
      }

      expect((await dashboard(a)).activity).toEqual({
        released: 5,
        unstarted: 2,
        inProgress: 1,
        completed: 2,
      });
    });

    it('counts only what is still awaiting a decision, on both lists', async () => {
      const a = await account();
      const attemptId = await handInOnePaper(a);
      const grades = await h.prisma.questionGrade.findMany({
        where: { attemptId },
        orderBy: { questionId: 'asc' },
        select: { questionId: true, state: true },
      });
      const incorrect = grades.filter((grade) => grade.state === 'Incorrect');
      expect(incorrect.length).toBeGreaterThanOrEqual(2);

      // Two disputes, one of them then overridden: one is left awaiting.
      for (const grade of incorrect.slice(0, 2)) {
        await h.grading.disputeGrade(
          { parentAccountId: a.parentAccountId, studentProfileId: a.studentProfileId },
          attemptId,
          grade.questionId,
        );
      }
      // The trend's score **before** the override, so the assertion below is
      // about the adjustment and not about the fixture.
      const before = (await dashboard(a)).trend.points.find(
        (point: { attemptId: string }) => point.attemptId === attemptId,
      );
      expect(before).toBeDefined();

      await h.grading.overrideGrade(
        { parentAccountId: a.parentAccountId },
        attemptId,
        incorrect[0]!.questionId,
        'Correct',
      );

      // **The trend is over *effective* states.** Without `effectiveStateOf` in
      // `qualifyingScoresFor` this point would not move, and a parent's own
      // adjustment would be the child's mark on every surface but this one —
      // which is the second denominator FR-37 forbids, reached by a read that
      // forgot the override column.
      const after = (await dashboard(a)).trend.points.find(
        (point: { attemptId: string }) => point.attemptId === attemptId,
      );
      expect(after.correct).toBe(before.correct + 1);
      expect(after.denominator).toBe(before.denominator);

      // Three reported Explanations, one of them then disposed: two are awaiting.
      // Written straight to the tables rather than generated, for the reason the
      // papers are: this case is about counting concerns, not producing prose,
      // and a generated Explanation would spend a provider call per row.
      for (const [index, grade] of grades.slice(0, 3).entries()) {
        const explanation = await h.prisma.explanation.create({
          data: {
            parentAccountId: a.parentAccountId,
            studentProfileId: a.studentProfileId,
            attemptId,
            questionId: grade.questionId,
            body: [{ kind: 'text', value: 'Because a third of nine is three.' }],
            generation: 1,
            chargedAt: new Date(),
          },
          select: { id: true },
        });
        await h.prisma.explanationFlag.create({
          data: {
            explanationId: explanation.id,
            parentAccountId: a.parentAccountId,
            studentProfileId: a.studentProfileId,
            origin: 'Student',
            // The disposed one. Awaiting is the absence of a decision on the other
            // two, never a value anybody wrote.
            ...(index === 0 ? { disposition: 'Dismissed', dispositionAt: new Date() } : {}),
          },
        });
      }

      expect((await dashboard(a)).digest).toEqual({
        disputesAwaiting: 1,
        explanationFlagsAwaiting: 2,
      });
    });
  });

  describe('the digest is this child’s, not the account’s', () => {
    /**
     * Two children of one account, each with concerns of their own.
     *
     * The account is the parent's entitlement, so a read scoped only by account
     * would answer both children's figures on either child's dashboard — and the
     * digest would send a parent off to decide something about a child whose page
     * they are not on. Two children each with their own paper is the only fixture
     * that can tell "this child's" apart from "this account's": the unique index
     * on `(attemptId, questionId)` means one Attempt cannot carry two children's
     * disputes, so the sibling needs a run of their own.
     */
    async function raiseConcernsFor(
      a: Account,
      studentProfileId: string,
      disputes: number,
      flags: number,
    ): Promise<void> {
      const { practiceTestId, questionIds } = await paper(
        a,
        Array.from({ length: Math.max(disputes, flags) }, () => ['fractions']),
        studentProfileId,
      );
      const attemptId = await openAttempt(a, practiceTestId, 1, studentProfileId);
      await h.prisma.attempt.update({
        where: { id: attemptId },
        data: { submittedAt: new Date() },
      });

      for (const questionId of questionIds.slice(0, disputes)) {
        await h.prisma.gradeDispute.create({
          data: { attemptId, questionId, parentAccountId: a.parentAccountId, studentProfileId },
        });
      }
      for (const questionId of questionIds.slice(0, flags)) {
        const explanation = await h.prisma.explanation.create({
          data: {
            parentAccountId: a.parentAccountId,
            studentProfileId,
            attemptId,
            questionId,
            body: [{ kind: 'text', value: 'Because a third of nine is three.' }],
            generation: 1,
            chargedAt: new Date(),
          },
          select: { id: true },
        });
        await h.prisma.explanationFlag.create({
          data: {
            explanationId: explanation.id,
            parentAccountId: a.parentAccountId,
            studentProfileId,
            origin: 'Student',
          },
        });
      }
    }

    it('leaves a sibling’s disputes and reports out of both counts', async () => {
      const a = await account();
      await raiseConcernsFor(a, a.studentProfileId, 1, 1);
      await raiseConcernsFor(a, a.siblingProfileId, 2, 3);

      // This child's own concerns, and not one of the sibling's five.
      expect((await dashboard(a)).digest).toEqual({
        disputesAwaiting: 1,
        explanationFlagsAwaiting: 1,
      });
      // The mirror image on the sibling's dashboard, which is what makes the
      // assertion above about scoping rather than about a fixture that happened
      // to write too little.
      expect((await dashboard(a, a.siblingProfileId)).digest).toEqual({
        disputesAwaiting: 2,
        explanationFlagsAwaiting: 3,
      });
    });
  });

  describe('what the read costs', () => {
    it('makes no provider call of any kind', async () => {
      // The docblock says this read generates nothing. Without this, it is a
      // sentence rather than a property: a later composition that reached for
      // `normalize` to name a Topic would charge a parent for opening a page.
      const a = await account();
      await handInOnePaper(a);
      h.ai.reset();

      await dashboard(a);
      await dashboard(a, a.siblingProfileId);

      expect(h.ai.sent).toEqual([]);
      expect(h.ai.embedded).toEqual([]);
    });
  });

  describe('the Explanation Allowance', () => {
    it('is the account’s figure, with its own reset instant and zone', async () => {
      const a = await account();
      const consumption = await h.allowance.consumptionFor(a.parentAccountId);

      const body = await dashboard(a);
      expect(body.explanationAllowance).toEqual({
        used: consumption.allowances.explanation.used,
        limit: consumption.allowances.explanation.limit,
        resetAt: consumption.resetAt,
        timezone: consumption.timezone,
      });
      expect(typeof body.explanationAllowance.limit).toBe('number');
      // The same figure for either child, because it is not a per-child figure.
      expect((await dashboard(a, a.siblingProfileId)).explanationAllowance).toEqual(
        body.explanationAllowance,
      );
    });

    it('states an unlimited ceiling as an absence, never as a number', async () => {
      // `limit: null` and not `0`: a tier with no Explanation ceiling has to read
      // as unlimited, and a zero would read as "nothing left".
      const a = await account();
      await h.parentAccounts.assignTier(h.operatorId, a.parentAccountId, 'Plus');
      expect((await dashboard(a)).explanationAllowance.limit).toBeNull();
    });

    it('carries no tier, cost or model name onto the response', async () => {
      const a = await account();
      await handInOnePaper(a);
      const body = JSON.stringify(await dashboard(a));
      expect(body).not.toMatch(/tier|Free|Plus|Family|costCents|model/iu);
    });
  });

  describe('what a parent is answered when there is nothing, or nothing of theirs', () => {
    it('answers an empty dashboard for a child with no history, not a row of zeroes', async () => {
      const a = await account();
      const body = await dashboard(a, a.siblingProfileId);
      expect(body.topics).toEqual([]);
      expect(body.trend.points).toEqual([]);
      expect(body.activity).toEqual({ released: 0, unstarted: 0, inProgress: 0, completed: 0 });
      expect(body.digest).toEqual({ disputesAwaiting: 0, explanationFlagsAwaiting: 0 });
      // The allowance is still there: it is the account's, and the empty state has
      // to be able to state it.
      expect(body.explanationAllowance.resetAt).toEqual(expect.any(String));
    });

    it('answers an empty dashboard for another account’s child — 200, never 404 or 403', async () => {
      // The IDOR this story closes. A 404 for an unknown id would be a
      // confirmation for a known one, so both answer alike (AD-18).
      const mine = await account();
      const theirs = await account({ email: 'other-parent@example.test' });
      await handInOnePaper(theirs);
      expect((await dashboard(theirs)).topics).not.toEqual([]);

      const body = await dashboard(mine, theirs.studentProfileId);
      expect(body.topics).toEqual([]);
      expect(body.trend.points).toEqual([]);
      expect(body.activity.released).toBe(0);
      expect(body.digest).toEqual({ disputesAwaiting: 0, explanationFlagsAwaiting: 0 });
      // And the allowance is the *asking* account's, not the other parent's.
      expect(body.explanationAllowance).toEqual((await dashboard(mine)).explanationAllowance);
    });

    it('answers the same empty dashboard for a profile id that exists nowhere', async () => {
      const a = await account();
      const body = await dashboard(a, UNKNOWN_UUID);
      expect(body.topics).toEqual([]);
      expect(body.studentProfileId).toBe(UNKNOWN_UUID);
    });

    it('refuses a malformed profile id before it reaches a query', async () => {
      const a = await account();
      await server()
        .get('/api/parent/students/not-a-uuid/analytics')
        .set('Authorization', bearer(a.token))
        .expect(400);
    });
  });

  describe('the gate', () => {
    it('needs elevation, and a bearer-less call reaches nothing', async () => {
      const a = await account();
      await server().get(`/api/parent/students/${a.studentProfileId}/analytics`).expect(401);
    });

    it('refuses a session cookie standing in for the elevation bearer', async () => {
      const a = await account();
      await server()
        .get(`/api/parent/students/${a.studentProfileId}/analytics`)
        .set('Cookie', a.cookie)
        .expect(401);
    });
  });
});
