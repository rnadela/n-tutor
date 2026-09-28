import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createGradeLevel,
  createHarness,
  createParentAccount,
  createStudentProfile,
  createSubject,
  resetParentAccounts,
  resetTaxonomy,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

/**
 * Mastery computation — every stateful row of the story's I/O matrix, against real
 * Postgres and the `fake` transport.
 *
 * **The window and the formula are asserted without a database in `mastery.spec.ts`.**
 * What can only be asserted here is everything the story is actually about: that the
 * canonical tag is written once per (Question, Topic) and stays that way over
 * re-reads, that each of the three triggers recomputes in the transaction that wrote
 * its grade change, that a retake changes nothing at all, that a rollback takes the
 * figure with the grade, and that neither an unclassified Source Test nor a failed
 * normalization can cost a child a committed hand-in.
 *
 * It is driven through `GradingService` rather than through routes, for the reason
 * `topic-normalization.int-spec.ts` gives: nothing reads Mastery in this story — the
 * dashboard is 7.4 — so the triggers are internal seams and the rows they write are
 * the whole of the observable behaviour. The submissions themselves are real
 * `submitAttempt` calls, because "which transaction wrote it" is precisely the claim.
 *
 * The papers are written straight to the tables, exactly as `grade-dispute.int-spec.ts`
 * writes its own: these cases are about what a finished run's grades come to, and
 * driving upload-extract-generate-release per case would spend the setup's provider
 * calls in the middle of counting this story's.
 */
describe('Mastery: recomputed from the window, in the transaction that changed the grade', () => {
  let h: Harness;
  let parentAccountId: string;
  let studentProfileId: string;
  let gradeLevelId: string;
  let subjectId: string;

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
    parentAccountId = (await createParentAccount(h.identity)).id;
    gradeLevelId = (await createGradeLevel(h)).id;
    subjectId = (await createSubject(h, { gradeLevelId })).id;
    studentProfileId = (await createStudentProfile(h, parentAccountId, { gradeLevelId })).id;
  });

  interface Paper {
    practiceTestId: string;
    /** In stored ordinal order, so `questionIds[0]` is Question 1. */
    questionIds: string[];
  }

  /**
   * One released Practice Test, one entry per Question, each entry the raw labels
   * generation emitted for it.
   *
   * Every Question is Short Answer with a stored correct answer of `ordinal * 3`, so
   * the `fake` transport's verdict is decided entirely by what the submission puts
   * down — which is what makes each case's counts a statement about this story rather
   * than about the grader.
   *
   * `classified: false` leaves the Source Test's `subjectId` null, which is the one
   * state that makes the unclassified case observable.
   */
  async function paper(
    labels: readonly (readonly string[])[],
    options: { classified?: boolean } = {},
  ): Promise<Paper> {
    const sourceTest = await h.prisma.sourceTest.create({
      data: {
        parentAccountId,
        studentProfileId,
        status: 'Submitted',
        expiresAt: new Date(Date.now() + 86_400_000),
        submittedAt: new Date(),
        subjectId: options.classified === false ? null : subjectId,
        gradeLevelId,
      },
      select: { id: true },
    });
    const job = await h.prisma.generationJob.create({
      data: {
        parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId,
        requestedCount: labels.length,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const practiceTest = await h.prisma.practiceTest.create({
      data: {
        parentAccountId,
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

  /** An open Attempt at this paper. `expiresAt` in the past is what makes one expire. */
  async function openAttempt(
    practiceTestId: string,
    ordinal: number,
    expiresAt: Date | null = null,
  ): Promise<string> {
    const attempt = await h.prisma.attempt.create({
      data: {
        practiceTestId,
        parentAccountId,
        studentProfileId,
        ordinal,
        startedAt: new Date(Date.now() - 600_000),
        expiresAt,
      },
      select: { id: true },
    });
    return attempt.id;
  }

  /** The answer the fake credits for Question `ordinal`, and one it never will. */
  const right = (ordinal: number) => `${ordinal * 3}`;
  const wrong = 'not the number asked for';

  function submit(
    attemptId: string,
    answers: readonly { questionId: string; value: string }[],
  ): Promise<unknown> {
    return h.grading.submitAttempt(parentAccountId, studentProfileId, attemptId, answers);
  }

  /** Every stored Mastery row of this child, with the ids stripped off. */
  async function mastery(): Promise<
    {
      correct: number;
      incorrect: number;
      unanswered: number;
      attemptsCounted: number;
      value: number | null;
    }[]
  > {
    const rows = await h.prisma.topicMastery.findMany({
      where: { studentProfileId },
      orderBy: { createdAt: 'asc' },
      select: {
        correct: true,
        incorrect: true,
        unanswered: true,
        attemptsCounted: true,
        value: true,
      },
    });
    return rows;
  }

  const tagCount = () => h.prisma.questionTopic.count();
  const topicCount = () => h.prisma.topic.count({ where: { subjectId } });
  /** Stage-3 calls only: the `Grading` call every submission makes is not one. */
  const normalizationCalls = () =>
    h.ai.sent.filter((call) => call.callClass === 'TopicNormalization').length;

  it('writes one tag per (Question, Topic) and one Mastery row on a first qualifying hand-in', async () => {
    const { practiceTestId, questionIds } = await paper([
      ['fractions'],
      ['fractions'],
      ['fractions'],
      ['fractions'],
    ]);
    const attemptId = await openAttempt(practiceTestId, 1);

    await submit(attemptId, [
      { questionId: questionIds[0]!, value: right(1) },
      { questionId: questionIds[1]!, value: right(2) },
      { questionId: questionIds[2]!, value: right(3) },
      { questionId: questionIds[3]!, value: wrong },
    ]);

    expect(await tagCount()).toBe(4);
    // One distinct label, so one Topic — and the first Topic of an empty canonical
    // set is minted with no provider call at all, which is what these two figures say
    // about "normalize was called once per *distinct* label".
    expect(await topicCount()).toBe(1);
    expect(h.ai.embedded).toHaveLength(0);
    expect(normalizationCalls()).toBe(0);

    expect(await mastery()).toEqual([
      { correct: 3, incorrect: 1, unanswered: 0, attemptsCounted: 1, value: 0.75 },
    ]);
  });

  it('tags idempotently over repeated results reads', async () => {
    const { practiceTestId, questionIds } = await paper([['fractions'], ['fractions']]);
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [
      { questionId: questionIds[0]!, value: right(1) },
      { questionId: questionIds[1]!, value: right(2) },
    ]);
    const tagsAfterSubmit = await tagCount();
    const topicsAfterSubmit = await topicCount();
    h.ai.reset();

    const scope = { parentAccountId, studentProfileId };
    await h.grading.resolveUngraded(scope, attemptId);
    await h.grading.resolveUngraded(scope, attemptId);

    expect(await tagCount()).toBe(tagsAfterSubmit);
    expect(await topicCount()).toBe(topicsAfterSubmit);
    // Stage 1 of the cascade answered both re-reads: an already-canonicalized label
    // costs a lookup and never a call.
    expect(h.ai.embedded).toHaveLength(0);
    expect(normalizationCalls()).toBe(0);
  });

  it('changes no Mastery row at all when a retake is handed in and graded', async () => {
    const { practiceTestId, questionIds } = await paper([['fractions']]);
    const first = await openAttempt(practiceTestId, 1);
    await submit(first, [{ questionId: questionIds[0]!, value: right(1) }]);
    const before = await h.prisma.topicMastery.findMany({ where: { studentProfileId } });
    expect(before).toHaveLength(1);

    const retake = await openAttempt(practiceTestId, 2);
    await submit(retake, [{ questionId: questionIds[0]!, value: wrong }]);

    // Byte for byte, `updatedAt` included: the recompute exits before any read, so
    // nothing was even rewritten with the same values.
    expect(await h.prisma.topicMastery.findMany({ where: { studentProfileId } })).toEqual(before);
    // The retake's own grade was still written — it is the Mastery that is untouched.
    expect(await h.prisma.questionGrade.count({ where: { attemptId: retake } })).toBe(1);
  });

  it('counts only the five newest qualifying Attempts that included the Topic', async () => {
    // Six papers, because a qualifying Attempt is a *first* run: six runs at one paper
    // would be one qualifying Attempt and five retakes.
    const papers: Paper[] = [];
    const attemptIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const built = await paper([['fractions']]);
      papers.push(built);
      const attemptId = await openAttempt(built.practiceTestId, 1);
      attemptIds.push(attemptId);
      // The oldest run is the only correct one, so an eviction that failed to happen
      // would be visible as a non-zero `correct`.
      await submit(attemptId, [
        { questionId: built.questionIds[0]!, value: index === 0 ? right(1) : wrong },
      ]);
    }

    // Spaced by a minute each and then recomputed through the public path, rather
    // than trusting six submissions to land in six distinct milliseconds. This also
    // exercises the entry point AD-12 reserves for Story 7.6's merge.
    for (const [index, attemptId] of attemptIds.entries()) {
      await h.prisma.attempt.update({
        where: { id: attemptId },
        data: { submittedAt: new Date(Date.UTC(2026, 0, 1, 9, index)) },
      });
    }
    const topic = await h.prisma.topic.findFirstOrThrow({ where: { subjectId } });
    await h.prisma.withTransaction((tx) =>
      h.grading.recomputeMastery(tx, studentProfileId, [topic.id]),
    );

    expect(await mastery()).toEqual([
      // The five newest are the five wrong ones; the sixth, oldest, correct run
      // contributes nothing.
      { correct: 0, incorrect: 5, unanswered: 0, attemptsCounted: 5, value: 0 },
    ]);
  });

  it('counts a blank on an unexpired hand-in as unanswered and divides by neither', async () => {
    const { practiceTestId, questionIds } = await paper([
      ['fractions'],
      ['fractions'],
      ['fractions'],
      ['fractions'],
    ]);
    const attemptId = await openAttempt(practiceTestId, 1);

    await submit(attemptId, [
      { questionId: questionIds[0]!, value: right(1) },
      { questionId: questionIds[1]!, value: wrong },
      // Questions 3 and 4 are simply absent from the body, which is what a blank is.
    ]);

    expect(await mastery()).toEqual([
      // The value is over the answered two, never over the four presented.
      { correct: 1, incorrect: 1, unanswered: 2, attemptsCounted: 1, value: 0.5 },
    ]);
  });

  it('counts a blank on an expired hand-in in the denominator and not as unanswered', async () => {
    const { practiceTestId, questionIds } = await paper([
      ['fractions'],
      ['fractions'],
      ['fractions'],
    ]);
    // The server's own column, already in the past when the submission arrives.
    const attemptId = await openAttempt(practiceTestId, 1, new Date(Date.now() - 60_000));

    await submit(attemptId, [{ questionId: questionIds[0]!, value: right(1) }]);

    const rows = await mastery();
    expect(rows).toEqual([
      { correct: 1, incorrect: 2, unanswered: 0, attemptsCounted: 1, value: rows[0]!.value },
    ]);
    expect(rows[0]!.value).toBeCloseTo(1 / 3, 10);
  });

  it('counts an Ungraded Question only once a results read has resolved it, in the same commit', async () => {
    const { practiceTestId, questionIds } = await paper([['fractions'], ['fractions']]);
    // Pre-minted so the cascade's stage 1 answers the label with a lookup: the failure
    // latch below must be spent by the grading call and not by a normalization.
    await h.topics.normalize({ label: 'fractions', subjectId, parentAccountId });
    const attemptId = await openAttempt(practiceTestId, 1);
    await h.prisma.attempt.update({
      where: { id: attemptId },
      data: { submittedAt: new Date(Date.now() - 300_000) },
    });
    // Question 1 judged wrong, Question 2 judged by nothing yet — the state a crash
    // between a hand-in's two transactions leaves, and the one a results read re-asks.
    await h.prisma.answer.createMany({
      data: [
        { attemptId, questionId: questionIds[0]!, value: wrong },
        { attemptId, questionId: questionIds[1]!, value: right(2) },
      ],
    });
    await h.prisma.questionGrade.createMany({
      data: [
        { attemptId, questionId: questionIds[0]!, state: 'Incorrect' },
        { attemptId, questionId: questionIds[1]!, state: 'Ungraded' },
      ],
    });
    h.ai.reset();

    const scope = { parentAccountId, studentProfileId };
    // The re-ask fails, so Question 2 stays `Ungraded` — and is in neither term.
    h.ai.failNext('transport');
    await h.grading.resolveUngraded(scope, attemptId);
    expect(await mastery()).toEqual([
      { correct: 0, incorrect: 1, unanswered: 0, attemptsCounted: 1, value: 0 },
    ]);

    // The next read is the retry, and the figure moves with the verdict it wrote.
    await h.grading.resolveUngraded(scope, attemptId);
    expect(
      await h.prisma.questionGrade.findFirst({
        where: { attemptId, questionId: questionIds[1]! },
        select: { state: true },
      }),
    ).toEqual({ state: 'Correct' });
    expect(await mastery()).toEqual([
      { correct: 1, incorrect: 1, unanswered: 0, attemptsCounted: 1, value: 0.5 },
    ]);
  });

  it("recomputes in a parent's override transaction, and rolls the figure back with the grade", async () => {
    const { practiceTestId, questionIds } = await paper([['fractions']]);
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [{ questionId: questionIds[0]!, value: wrong }]);
    expect(await mastery()).toEqual([
      { correct: 0, incorrect: 1, unanswered: 0, attemptsCounted: 1, value: 0 },
    ]);

    await h.grading.overrideGrade({ parentAccountId }, attemptId, questionIds[0]!, 'Correct');
    expect(await mastery()).toEqual([
      // Effective state, so the parent's decision counts and the stored verdict does not.
      { correct: 1, incorrect: 0, unanswered: 0, attemptsCounted: 1, value: 1 },
    ]);

    const topic = await h.prisma.topic.findFirstOrThrow({ where: { subjectId } });
    await expect(
      h.prisma.withTransaction(async (tx) => {
        await tx.questionGrade.updateMany({
          where: { attemptId },
          data: { overrideState: 'Incorrect' },
        });
        await h.grading.recomputeMastery(tx, studentProfileId, [topic.id]);
        throw new Error('the caller failed after the grade and the figure were written');
      }),
    ).rejects.toThrow('the caller failed after the grade and the figure were written');

    // Neither the grade nor the figure moved: one unit of work, one rollback.
    expect(
      await h.prisma.questionGrade.findFirst({
        where: { attemptId },
        select: { overrideState: true },
      }),
    ).toEqual({ overrideState: 'Correct' });
    expect(await mastery()).toEqual([
      { correct: 1, incorrect: 0, unanswered: 0, attemptsCounted: 1, value: 1 },
    ]);
  });

  it('leaves the grade unwritten and logs, rather than 500ing, when the hand-in transaction\'s own recompute fails', async () => {
    // `submitAttempt`'s guard is documented as never throwing past this point: a
    // recompute fault must be swallowed and logged, and because the recompute shares
    // the transaction that wrote the verdict (AD-10), the verdict rolls back with it —
    // leaving the Question row-less, which `resolveUngraded` treats as outstanding.
    const { practiceTestId, questionIds } = await paper([['fractions']]);
    const attemptId = await openAttempt(practiceTestId, 1);

    const errors: string[] = [];
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(function (this: Logger, message: unknown) {
        errors.push(String(message));
      });
    const recomputeSpy = vi
      .spyOn(h.grading, 'recomputeMastery')
      .mockRejectedValueOnce(new Error('a fault nobody anticipated'));
    try {
      await expect(submit(attemptId, [{ questionId: questionIds[0]!, value: right(1) }])).resolves.toBeDefined();
    } finally {
      recomputeSpy.mockRestore();
      errorSpy.mockRestore();
    }

    // The grade never committed — it was in the same transaction as the failed
    // recompute — so the Question is row-less, not `Incorrect` or `Ungraded`.
    expect(await h.prisma.questionGrade.count({ where: { attemptId } })).toBe(0);
    expect(await mastery()).toEqual([]);
    expect(errors.some((line) => line.includes(attemptId))).toBe(true);
    for (const line of errors) expect(line).not.toContain('fractions');
  });

  it('answers a results read with nothing outstanding even when its own recompute fails', async () => {
    // The nothing-outstanding branch has its own try/catch for exactly this reason: a
    // results read must still answer when Mastery recompute faults, per the same
    // never-throw rule `submitAttempt` documents.
    const { practiceTestId, questionIds } = await paper([['fractions']]);
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [{ questionId: questionIds[0]!, value: right(1) }]);
    expect(await mastery()).toEqual([
      { correct: 1, incorrect: 0, unanswered: 0, attemptsCounted: 1, value: 1 },
    ]);

    const errors: string[] = [];
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(function (this: Logger, message: unknown) {
        errors.push(String(message));
      });
    const recomputeSpy = vi
      .spyOn(h.grading, 'recomputeMastery')
      .mockRejectedValueOnce(new Error('a fault nobody anticipated'));
    try {
      await expect(
        h.grading.resolveUngraded({ parentAccountId, studentProfileId }, attemptId),
      ).resolves.toBeDefined();
    } finally {
      recomputeSpy.mockRestore();
      errorSpy.mockRestore();
    }

    // Nothing outstanding meant no verdict was at stake, so the prior figure is left
    // exactly as it was rather than partially recomputed.
    expect(await mastery()).toEqual([
      { correct: 1, incorrect: 0, unanswered: 0, attemptsCounted: 1, value: 1 },
    ]);
    expect(errors.some((line) => line.includes(attemptId))).toBe(true);
    for (const line of errors) expect(line).not.toContain('fractions');
  });

  it('excludes a retake sharing a Topic with another paper from that Topic\'s window', async () => {
    // AD-6's window filter (`countsTowardMastery`) is exercised end to end only when a
    // retake and a qualifying Attempt on a *different* paper share a Topic — every
    // existing multi-Attempt case uses first runs exclusively, so this is the one case
    // that would catch the filter silently dropping out.
    const first = await paper([['fractions']]);
    const firstAttempt = await openAttempt(first.practiceTestId, 1);
    await submit(firstAttempt, [{ questionId: first.questionIds[0]!, value: right(1) }]);

    const second = await paper([['fractions']]);
    const secondAttempt = await openAttempt(second.practiceTestId, 1);
    await submit(secondAttempt, [{ questionId: second.questionIds[0]!, value: wrong }]);
    const retake = await openAttempt(second.practiceTestId, 2);
    // Right on the retake: if the filter were dropped, this correct answer would leak
    // into the Topic's counts alongside the two qualifying runs above.
    await submit(retake, [{ questionId: second.questionIds[0]!, value: right(1) }]);

    expect(await mastery()).toEqual([
      { correct: 1, incorrect: 1, unanswered: 0, attemptsCounted: 2, value: 0.5 },
    ]);
  });

  it('stores a Mastery row of nothing but blanks for a paper handed in untouched', async () => {
    // Nothing answered means no free-text Question to ask a provider about, so the last
    // transaction that wrote a grade was the one that closed the Attempt — and the tags
    // did not exist when it committed. The recompute rides its own follow-on
    // transaction, and this is the case that proves that branch is wired.
    const { practiceTestId } = await paper([['fractions'], ['fractions'], ['fractions']]);
    const attemptId = await openAttempt(practiceTestId, 1);

    await submit(attemptId, []);

    // No provider call was made: a blank is never named in a grading call.
    expect(h.ai.sent.filter((call) => call.callClass === 'Grading')).toHaveLength(0);
    expect(await mastery()).toEqual([
      // Evidence, and reported — the child was asked and skipped — but a fraction over
      // nothing, which is what the nullable value is for.
      { correct: 0, incorrect: 0, unanswered: 3, attemptsCounted: 1, value: null },
    ]);
  });

  it('writes the Mastery row on a results read when the hand-in could not tag the paper', async () => {
    // The hand-in tags nothing, so there is no Topic for a figure to be about and its
    // recompute has nothing to do. The Questions are all graded by that same hand-in,
    // so the later results read has nothing outstanding either — which is exactly the
    // branch that would leave this child with no Mastery at all if it were not there.
    const { practiceTestId, questionIds } = await paper([['fractions'], ['fractions']], {
      classified: false,
    });
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [
      { questionId: questionIds[0]!, value: right(1) },
      { questionId: questionIds[1]!, value: wrong },
    ]);
    expect(await tagCount()).toBe(0);
    expect(await mastery()).toEqual([]);

    // The upload is classified afterwards, so the labels now have a Subject to
    // canonicalize against and the next read is the one that resolves them.
    const sourceTest = await h.prisma.practiceTest.findUniqueOrThrow({
      where: { id: practiceTestId },
      select: { sourceTestId: true },
    });
    await h.prisma.sourceTest.update({
      where: { id: sourceTest.sourceTestId },
      data: { subjectId },
    });

    const resolution = await h.grading.resolveUngraded(
      { parentAccountId, studentProfileId },
      attemptId,
    );
    // Nothing was outstanding, so no verdict moved — only the tags and the figure did.
    expect(resolution.newlyGradedQuestionIds).toEqual([]);
    expect(await tagCount()).toBe(2);
    expect(await mastery()).toEqual([
      { correct: 1, incorrect: 1, unanswered: 0, attemptsCounted: 1, value: 0.5 },
    ]);
  });

  it('picks the same window twice when every qualifying Attempt shares one submittedAt', async () => {
    // `submittedAt` is TIMESTAMP(3), so runs handed in within one millisecond tie — and
    // on a tie the order is Postgres's choice unless something breaks it. `id desc`
    // does, and this is the case that would catch it being dropped: without it two
    // recomputes over identical rows can answer differently.
    const correctByAttempt = new Map<string, boolean>();
    for (let index = 0; index < 6; index += 1) {
      const built = await paper([['fractions']]);
      const attemptId = await openAttempt(built.practiceTestId, 1);
      const isCorrect = index % 2 === 0;
      correctByAttempt.set(attemptId, isCorrect);
      await submit(attemptId, [
        { questionId: built.questionIds[0]!, value: isCorrect ? right(1) : wrong },
      ]);
    }

    const tied = new Date(Date.UTC(2026, 0, 1, 9, 0, 0, 0));
    await h.prisma.attempt.updateMany({
      where: { studentProfileId },
      data: { submittedAt: tied },
    });

    // The window the tiebreak dictates, computed here rather than assumed: the five
    // highest ids, in id order.
    const expectedWindow = [...correctByAttempt.keys()].sort().reverse().slice(0, 5);
    const expectedCorrect = expectedWindow.filter((id) => correctByAttempt.get(id) === true).length;

    const topic = await h.prisma.topic.findFirstOrThrow({ where: { subjectId } });
    const recompute = () =>
      h.prisma.withTransaction((tx) =>
        h.grading.recomputeMastery(tx, studentProfileId, [topic.id]),
      );

    await recompute();
    const first = await mastery();
    await recompute();
    const second = await mastery();

    expect(first).toEqual([
      {
        correct: expectedCorrect,
        incorrect: 5 - expectedCorrect,
        unanswered: 0,
        attemptsCounted: 5,
        value: expectedCorrect / 5,
      },
    ]);
    // The same answer the second time: the ordering is a rule, not a coincidence.
    expect(second).toEqual(first);
  });

  it('keeps no row for a Topic whose whole window is Ungraded, deleting one that existed', async () => {
    const { practiceTestId, questionIds } = await paper([['fractions']]);
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [{ questionId: questionIds[0]!, value: right(1) }]);
    expect(await mastery()).toHaveLength(1);

    // The one way a judged Question goes back to unjudged: nothing in the product does
    // it, and the case it stands for — a window that was never judged at all — must
    // leave no `0/0` row behind for Story 7.4's empty state to be confused by.
    await h.prisma.questionGrade.updateMany({
      where: { attemptId },
      data: { state: 'Ungraded', overrideState: null },
    });
    const topic = await h.prisma.topic.findFirstOrThrow({ where: { subjectId } });
    await h.prisma.withTransaction((tx) =>
      h.grading.recomputeMastery(tx, studentProfileId, [topic.id]),
    );

    expect(await mastery()).toEqual([]);
  });

  it('tags nothing and answers the hand-in when the Source Test carries no Subject', async () => {
    const { practiceTestId, questionIds } = await paper([['fractions']], { classified: false });
    const attemptId = await openAttempt(practiceTestId, 1);

    // The hand-in still answers, which is the whole of the promise.
    await expect(
      submit(attemptId, [{ questionId: questionIds[0]!, value: right(1) }]),
    ).resolves.toBeDefined();

    expect(await tagCount()).toBe(0);
    expect(await topicCount()).toBe(0);
    expect(await mastery()).toEqual([]);
    // No Topic to canonicalize against means no call was made looking for one.
    expect(h.ai.embedded).toHaveLength(0);
    expect(normalizationCalls()).toBe(0);
  });

  it('keeps the tags that did resolve when one label cannot be canonicalized', async () => {
    // A whitespace-only label is refused by `normalize` before any provider call —
    // `TopicInputError` — which is the cheapest faithful stand-in for any fault class
    // the cascade can raise, and the one that cannot flake.
    const { practiceTestId, questionIds } = await paper([['fractions'], ['   ']]);
    const attemptId = await openAttempt(practiceTestId, 1);

    await expect(
      submit(attemptId, [
        { questionId: questionIds[0]!, value: right(1) },
        { questionId: questionIds[1]!, value: right(2) },
      ]),
    ).resolves.toBeDefined();

    expect(await tagCount()).toBe(1);
    expect(await topicCount()).toBe(1);
    expect(await mastery()).toEqual([
      // Question 2 is graded and is simply about no Topic, so it feeds no figure.
      { correct: 1, incorrect: 0, unanswered: 0, attemptsCounted: 1, value: 1 },
    ]);
  });

  it('writes one tag and counts one contribution for two labels that canonicalize alike', async () => {
    const { practiceTestId, questionIds } = await paper([['fractions', 'Fractions.']]);
    const attemptId = await openAttempt(practiceTestId, 1);

    await submit(attemptId, [{ questionId: questionIds[0]!, value: right(1) }]);

    expect(await topicCount()).toBe(1);
    // The unique index absorbed the second pair rather than surfacing a violation.
    expect(await tagCount()).toBe(1);
    expect(await mastery()).toEqual([
      // One, not two: the Question contributes once however many ways it was spelled.
      { correct: 1, incorrect: 0, unanswered: 0, attemptsCounted: 1, value: 1 },
    ]);
  });

  it("lands both writers' rows when two first recomputes race the same pair's insert", async () => {
    // Both transactions compute the same window and both find no existing row, so
    // both attempt an insert; the loser's P2002 must fall through to the update the
    // winner's row now admits, rather than aborting the grade change that called it.
    const { practiceTestId, questionIds } = await paper([['fractions']]);
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [{ questionId: questionIds[0]!, value: right(1) }]);
    const topic = await h.prisma.topic.findFirstOrThrow({ where: { subjectId } });
    // The submission's own recompute already minted the row; delete it so the next
    // two recomputes both start from "nothing to update" and race the insert.
    await h.prisma.topicMastery.deleteMany({ where: { studentProfileId, topicId: topic.id } });

    await expect(
      Promise.all([
        h.prisma.withTransaction((tx) =>
          h.grading.recomputeMastery(tx, studentProfileId, [topic.id]),
        ),
        h.prisma.withTransaction((tx) =>
          h.grading.recomputeMastery(tx, studentProfileId, [topic.id]),
        ),
      ]),
    ).resolves.toBeDefined();

    expect(await mastery()).toEqual([
      { correct: 1, incorrect: 0, unanswered: 0, attemptsCounted: 1, value: 1 },
    ]);
  });

  it('recomputes every Topic of a shared paper in one call, not just the first', async () => {
    // The batching this method's doc justifies on "the Topics of one paper overlap
    // heavily" is only proven if a single call is ever asked for more than one.
    const { practiceTestId, questionIds } = await paper([['fractions'], ['decimals']]);
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [
      { questionId: questionIds[0]!, value: right(1) },
      { questionId: questionIds[1]!, value: wrong },
    ]);

    const topics = await h.prisma.topic.findMany({
      where: { subjectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    expect(topics).toHaveLength(2);
    // Both rows already exist from the hand-in's own recompute; deleting them and
    // recomputing both Topics in one call proves the batched read serves each Topic
    // its own counts rather than only the first.
    await h.prisma.topicMastery.deleteMany({ where: { studentProfileId } });
    await h.prisma.withTransaction((tx) =>
      h.grading.recomputeMastery(
        tx,
        studentProfileId,
        topics.map((t) => t.id),
      ),
    );

    const rows = await h.prisma.topicMastery.findMany({
      where: { studentProfileId },
      select: { topicId: true, correct: true, incorrect: true, value: true },
    });
    expect(rows).toHaveLength(2);
    const byTopic = new Map(rows.map((row) => [row.topicId, row]));
    expect(byTopic.get(topics[0]!.id)).toMatchObject({ correct: 1, incorrect: 0, value: 1 });
    expect(byTopic.get(topics[1]!.id)).toMatchObject({ correct: 0, incorrect: 1, value: 0 });
  });

  it('never logs a label, a Topic name or a Question when canonicalization fails (AD-20)', async () => {
    const warnings: string[] = [];
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(function (this: Logger, message: unknown) {
        warnings.push(String(message));
      });
    try {
      // A whitespace-only label is refused by `normalize` before any provider call,
      // and the Practice Test id and question prompts carry no such string either, so
      // any of the case's identifying names leaking into a log line would only be
      // able to arrive by way of the fault-handling code this test targets.
      const { practiceTestId, questionIds } = await paper([['fractions'], ['   ']]);
      const attemptId = await openAttempt(practiceTestId, 1);
      await submit(attemptId, [
        { questionId: questionIds[0]!, value: right(1) },
        { questionId: questionIds[1]!, value: right(2) },
      ]);
    } finally {
      warnSpy.mockRestore();
    }

    expect(warnings.length).toBeGreaterThan(0);
    for (const line of warnings) {
      expect(line).not.toContain('fractions');
      expect(line).not.toMatch(/\s{3}/);
    }
  });
});
