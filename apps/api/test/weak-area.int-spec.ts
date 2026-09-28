import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetWeakAreaRuntime } from '../src/grading/weak-area-policy.js';

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
 * Weak Area identification — the first read of `topic_mastery`, over rows a real
 * graded hand-in wrote.
 *
 * **The predicate itself is asserted without a database in `weak-area-policy.spec.ts`.**
 * What can only be asserted here is what this story is actually about: that
 * `masteryFor` reads the rows Story 7.2 stored, attaches the verdict to each, answers
 * `[]` rather than an invented zero row for a child with no history, and — the whole
 * point of deriving rather than storing — reclassifies the *same untouched rows* when
 * a threshold is retuned, with no recompute and no backfill.
 *
 * Driven through `GradingService` rather than routes for the reason
 * `mastery.int-spec.ts` gives: there is no route yet. Story 7.4 adds the dashboard and
 * its authorization on top of this view.
 *
 * The paper is written straight to the tables, exactly as `mastery.int-spec.ts` writes
 * its own: this case is about what a finished run's grades classify as, and driving
 * upload-extract-generate-release would spend the setup's provider calls in the middle
 * of it.
 */
describe('Weak Areas: classified on the way out of the stored row, never stored', () => {
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

  const SAVED_FLOOR = process.env.WEAK_AREA_ANSWERED_FLOOR;

  afterEach(() => {
    if (SAVED_FLOOR === undefined) delete process.env.WEAK_AREA_ANSWERED_FLOOR;
    else process.env.WEAK_AREA_ANSWERED_FLOOR = SAVED_FLOOR;
    resetWeakAreaRuntime();
  });

  /**
   * One released Practice Test, one entry per Question, each entry the raw labels
   * generation emitted for it. Every Question is Short Answer with a stored correct
   * answer of `ordinal * 3`, so the `fake` transport's verdict is decided entirely by
   * what the submission puts down.
   */
  async function paper(
    labels: readonly (readonly string[])[],
  ): Promise<{ practiceTestId: string; questionIds: string[] }> {
    const sourceTest = await h.prisma.sourceTest.create({
      data: {
        parentAccountId,
        studentProfileId,
        status: 'Submitted',
        expiresAt: new Date(Date.now() + 86_400_000),
        submittedAt: new Date(),
        subjectId,
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

  async function openAttempt(practiceTestId: string, ordinal: number): Promise<string> {
    const attempt = await h.prisma.attempt.create({
      data: {
        practiceTestId,
        parentAccountId,
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

  /** Topic name by id, so the assertions read in labels rather than in uuids. */
  async function namesById(): Promise<Map<string, string>> {
    const topics = await h.prisma.topic.findMany({
      where: { subjectId },
      select: { id: true, name: true },
    });
    return new Map(topics.map((topic) => [topic.id, topic.name]));
  }

  /** `masteryFor`'s answer, keyed by Topic name. */
  async function viewByName(profileId = studentProfileId) {
    const names = await namesById();
    const rows = await h.grading.masteryFor(profileId);
    return { rows, byName: new Map(rows.map((row) => [names.get(row.topicId)!, row])) };
  }

  /**
   * Fourteen Questions across three Topics, one hand-in:
   *
   * - `fractions`  — 2 of 5 right (40%): under the ceiling, at the floor. Weak.
   * - `decimals`   — 4 of 5 right (80%): over the ceiling. Healthy.
   * - `geometry`   — 1 of 4 right (25%): under the ceiling but under the floor, which
   *   is the row the retune below reclassifies without touching it.
   */
  async function handInOnePaper(): Promise<void> {
    const labels: string[][] = [
      ...Array.from({ length: 5 }, () => ['fractions']),
      ...Array.from({ length: 5 }, () => ['decimals']),
      ...Array.from({ length: 4 }, () => ['geometry']),
    ];
    const { practiceTestId, questionIds } = await paper(labels);
    const attemptId = await openAttempt(practiceTestId, 1);

    // Index 0-4 fractions: two right. 5-9 decimals: four right. 10-13 geometry: one.
    const correctIndexes = new Set([0, 1, 5, 6, 7, 8, 10]);
    await h.grading.submitAttempt(
      parentAccountId,
      studentProfileId,
      attemptId,
      questionIds.map((questionId, index) => ({
        questionId,
        value: correctIndexes.has(index) ? right(index + 1) : wrong,
      })),
    );
  }

  it('returns every stored Topic with its counts, its answered total and its verdict', async () => {
    await handInOnePaper();

    const { rows, byName } = await viewByName();
    expect(rows).toHaveLength(3);

    expect(byName.get('fractions')).toEqual({
      topicId: expect.any(String),
      correct: 2,
      incorrect: 3,
      unanswered: 0,
      answered: 5,
      attemptsCounted: 1,
      value: 0.4,
      isWeakArea: true,
    });
    // Over the ceiling: the same read, the opposite verdict.
    expect(byName.get('decimals')).toMatchObject({
      correct: 4,
      incorrect: 1,
      answered: 5,
      value: 0.8,
      isWeakArea: false,
    });
    // Worse than fractions and still not a Weak Area: four answered Questions is
    // less evidence than the floor asks for.
    expect(byName.get('geometry')).toMatchObject({
      correct: 1,
      incorrect: 3,
      answered: 4,
      value: 0.25,
      isWeakArea: false,
    });
  });

  it('is ordered by Topic id, so the answer is stable rather than insertion-ordered', async () => {
    // Twelve Topics rather than three: uuids arrive in no particular order, so a
    // handful of rows could come back sorted by luck even with no `orderBy` at all.
    // At twelve, insertion order happening to be sorted is one chance in 479 million.
    // Distinct *words*, not a numbered series: `topicMatchKey` strips digits, so
    // "topic 1" and "topic 2" would canonicalize to the one Topic.
    const labels = [
      ['fractions'],
      ['decimals'],
      ['geometry'],
      ['algebra'],
      ['measurement'],
      ['probability'],
      ['statistics'],
      ['perimeter'],
      ['symmetry'],
      ['rounding'],
      ['ratios'],
      ['sequences'],
    ];
    const { practiceTestId, questionIds } = await paper(labels);
    const attemptId = await openAttempt(practiceTestId, 1);
    await h.grading.submitAttempt(
      parentAccountId,
      studentProfileId,
      attemptId,
      questionIds.map((questionId, index) => ({ questionId, value: right(index + 1) })),
    );

    // Compared against the ids read independently and sorted here, rather than
    // against the read's own output re-sorted: the latter asserts only that a list
    // equals itself when both sides came out of the same statement.
    const expected = (
      await h.prisma.topicMastery.findMany({
        where: { studentProfileId },
        select: { topicId: true },
      })
    )
      .map((row) => row.topicId)
      .sort();
    expect(expected).toHaveLength(12);

    const rows = await h.grading.masteryFor(studentProfileId);
    expect(rows.map((row) => row.topicId)).toEqual(expected);
  });

  it('reads back a Topic the child skipped entirely: no fraction, nothing answered, not weak', async () => {
    // `hasEvidence` stores this row — the child was asked and skipped, which is a
    // fact a parent is entitled to see — so it is a row `masteryFor` really returns,
    // and the only one where `value`'s nullability reaches a consumer.
    const { practiceTestId, questionIds } = await paper([
      ['measurement'],
      ['measurement'],
      ['measurement'],
      ['decimals'],
    ]);
    const attemptId = await openAttempt(practiceTestId, 1);
    // Only the `decimals` Question is answered; the three `measurement` ones are
    // simply absent from the body, which is what a blank on an unexpired hand-in is.
    await h.grading.submitAttempt(parentAccountId, studentProfileId, attemptId, [
      { questionId: questionIds[3]!, value: right(4) },
    ]);

    const { byName } = await viewByName();
    expect(byName.get('measurement')).toMatchObject({
      correct: 0,
      incorrect: 0,
      unanswered: 3,
      answered: 0,
      attemptsCounted: 1,
      value: null,
      // Nothing was answered, so there is no fraction to be below the ceiling and no
      // evidence to clear the floor. A skipped Topic is not a failed one.
      isWeakArea: false,
    });
  });

  it('answers an empty list for a profile with no history — not an invented zero row', async () => {
    const sibling = await createStudentProfile(h, parentAccountId, { gradeLevelId });
    expect(await h.grading.masteryFor(sibling.id)).toEqual([]);

    // And still empty once a sibling has work of their own: the read is per profile.
    await handInOnePaper();
    expect(await h.grading.masteryFor(sibling.id)).toEqual([]);
  });

  it('reclassifies the very same stored rows when the floor is lowered, with no recompute', async () => {
    await handInOnePaper();
    const stored = await h.prisma.topicMastery.findMany({ where: { studentProfileId } });
    expect((await viewByName()).byName.get('geometry')!.isWeakArea).toBe(false);

    process.env.WEAK_AREA_ANSWERED_FLOOR = '3';
    resetWeakAreaRuntime();

    const after = await viewByName();
    // The row that was only healthy for want of evidence is now a Weak Area...
    expect(after.byName.get('geometry')!.isWeakArea).toBe(true);
    // ...the one that was already weak still is, and the healthy one is untouched by
    // a floor change, because its fraction was never the thing in question.
    expect(after.byName.get('fractions')!.isWeakArea).toBe(true);
    expect(after.byName.get('decimals')!.isWeakArea).toBe(false);

    // Byte for byte, `updatedAt` included: nothing was recomputed and nothing stored
    // a verdict. The rows are the same facts read against a different rule.
    expect(await h.prisma.topicMastery.findMany({ where: { studentProfileId } })).toEqual(stored);
  });
});
