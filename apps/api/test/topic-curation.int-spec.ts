import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { GradingService } = await import('../src/grading/grading.service.js');
const { TopicCurationService } = await import('../src/admin/topic-curation.service.js');
const { topicMatchKey } = await import('../src/topics/topic-match-key.js');
const { MAX_TOPIC_LABEL_LENGTH } = await import('../src/topics/topic-policy.js');
const {
  adminToken,
  createGradeLevel,
  createHarness,
  createParentAccount,
  createStudentProfile,
  createStudentProfileWithHeadroom,
  createSubject,
  resetParentAccounts,
  resetTaxonomy,
} = await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const UNKNOWN_UUID = '11111111-2222-4333-8444-555555555555';

/**
 * Admin Topic curation — confirm, rename and merge, against real Postgres.
 *
 * **The merge's whole claim is a database fact**, and there is nowhere else it can
 * be made. That the re-point does not violate `(questionId, topicId)`, that deleting
 * the merged row does not take the tags with it under `onDelete: Cascade`, that the
 * survivor's `TopicMastery` ends up holding what the union of the two Topics'
 * evidence comes to, and that a failure part-way leaves every one of those rows
 * exactly as it was — none of it is observable without the indexes, the cascade and
 * the transaction being real.
 *
 * So the fixtures are real too: the Topics arrive through the AD-11 cascade and the
 * Mastery rows through a real `submitAttempt`, rather than being written into the
 * tables a merge is about to move. The papers themselves are written directly,
 * exactly as `mastery.int-spec.ts` writes its own — these cases are about what a
 * finished run's tags come to, and driving upload-extract-generate per case would
 * spend the setup's provider calls in the middle of counting this story's.
 *
 * The actions are driven over HTTP with an admin bearer, because the guard, the uuid
 * pipes and the validated bodies are part of what the I/O matrix states. The one
 * exception is the rollback case, which needs a failure injected mid-transaction and
 * says so at its own site.
 */
describe('Admin Topic curation: confirm, rename and merge', () => {
  let h: Harness;
  let token: string;
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
    vi.restoreAllMocks();
    await resetParentAccounts(h.prisma);
    await resetTaxonomy(h.prisma);
    h.ai.reset();
    token = await adminToken(h.jwt, h.operatorId);
    parentAccountId = (await createParentAccount(h.identity)).id;
    gradeLevelId = (await createGradeLevel(h)).id;
    subjectId = (await createSubject(h, { gradeLevelId })).id;
    studentProfileId = (await createStudentProfile(h, parentAccountId, { gradeLevelId })).id;
  });

  const api = () => request(h.app.getHttpServer());
  const auth = () => `Bearer ${token}`;

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
   * down — which is what makes each case's counts a statement about curation rather
   * than about the grader.
   *
   * `forProfile` defaults to the one child every single-profile case uses. The merge's
   * multi-profile case passes a second, because whose Mastery a merge moves is the one
   * thing a single child can never state.
   */
  async function paper(
    labels: readonly (readonly string[])[],
    forProfile: string = studentProfileId,
  ): Promise<Paper> {
    const sourceTest = await h.prisma.sourceTest.create({
      data: {
        parentAccountId,
        studentProfileId: forProfile,
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
        studentProfileId: forProfile,
        requestedCount: labels.length,
        status: 'Succeeded',
      },
      select: { id: true },
    });
    const practiceTest = await h.prisma.practiceTest.create({
      data: {
        parentAccountId,
        sourceTestId: sourceTest.id,
        studentProfileId: forProfile,
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
    practiceTestId: string,
    ordinal: number,
    forProfile: string = studentProfileId,
  ): Promise<string> {
    const attempt = await h.prisma.attempt.create({
      data: {
        practiceTestId,
        parentAccountId,
        studentProfileId: forProfile,
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

  const submit = (
    attemptId: string,
    answers: readonly { questionId: string; value: string }[],
    forProfile: string = studentProfileId,
  ) => h.grading.submitAttempt(parentAccountId, forProfile, attemptId, answers);

  const topicNamed = (name: string) =>
    h.prisma.topic.findFirstOrThrow({ where: { subjectId, name } });

  const masteryOn = (topicId: string, forProfile: string = studentProfileId) =>
    h.prisma.topicMastery.findUnique({
      where: { studentProfileId_topicId: { studentProfileId: forProfile, topicId } },
    });

  const tagsOn = (topicId: string) =>
    h.prisma.questionTopic.findMany({ where: { topicId }, orderBy: { questionId: 'asc' } });

  /**
   * The curation audit rows only.
   *
   * The taxonomy fixtures write their own — creating a Subject and enabling its
   * availability are audited actions — so an unfiltered read would be counting
   * somebody else's story.
   */
  const audits = () =>
    h.prisma.adminAudit.findMany({
      where: { action: { startsWith: 'topic.' } },
      orderBy: { createdAt: 'asc' },
    });

  /**
   * One graded paper that leaves the Subject holding two Topics, one Question
   * carrying both.
   *
   * That overlap is the case the merge exists to survive: two spellings of one
   * concept on one paper is exactly what makes a blanket `updateMany` a violation of
   * `(questionId, topicId)`.
   *
   * Q1 right, Q2 right, Q3 wrong — so before the merge `Fractions` is 2/2 and
   * `Photosynthesis` is 1/2, and after it the survivor is 2 correct and 1 incorrect.
   */
  async function overlappingPaper(): Promise<{
    fractionsId: string;
    photosynthesisId: string;
    questionIds: string[];
  }> {
    const { practiceTestId, questionIds } = await paper([
      ['Fractions', 'Photosynthesis'],
      ['Fractions'],
      ['Photosynthesis'],
    ]);
    const attemptId = await openAttempt(practiceTestId, 1);
    await submit(attemptId, [
      { questionId: questionIds[0]!, value: right(1) },
      { questionId: questionIds[1]!, value: right(2) },
      { questionId: questionIds[2]!, value: wrong },
    ]);
    return {
      fractionsId: (await topicNamed('Fractions')).id,
      photosynthesisId: (await topicNamed('Photosynthesis')).id,
      questionIds,
    };
  }

  // --- Reads -------------------------------------------------------------

  it('lists every provisional Topic with its Subject, instant and tagged-Question count', async () => {
    const { fractionsId, photosynthesisId } = await overlappingPaper();

    const response = await api()
      .get('/api/admin/topics/provisional')
      .set('authorization', auth())
      .expect(200);

    // Oldest first: the Topic that has had the longest to accumulate near-duplicates
    // behind it is the one an operator should judge first.
    expect(response.body).toHaveLength(2);
    expect(response.body.map((entry: { topicId: string }) => entry.topicId)).toEqual([
      fractionsId,
      photosynthesisId,
    ]);
    expect(response.body[0]).toMatchObject({
      name: 'Fractions',
      subjectId,
      // Two Questions carry it: the one that carries both, and the one that does not.
      taggedQuestionCount: 2,
    });
    expect(typeof response.body[0].subjectName).toBe('string');
    expect(Number.isNaN(Date.parse(response.body[0].createdAt))).toBe(false);
    // Neither the key nor the cached vector reaches a surface.
    expect(response.body[0].matchKey).toBeUndefined();
    expect(response.body[0].embedding).toBeUndefined();
  });

  it('answers an empty queue with an empty array, never a refusal', async () => {
    await api().get('/api/admin/topics/provisional').set('authorization', auth()).expect(200, []);
  });

  it('drops a Topic out of the queue once it is confirmed', async () => {
    const { fractionsId } = await overlappingPaper();

    await api()
      .post(`/api/admin/topics/${fractionsId}/confirm`)
      .set('authorization', auth())
      .expect(201);

    const response = await api()
      .get('/api/admin/topics/provisional')
      .set('authorization', auth())
      .expect(200);
    expect(response.body.map((entry: { topicId: string }) => entry.topicId)).toEqual([
      (await topicNamed('Photosynthesis')).id,
    ]);
  });

  it('lists one Subject’s whole canonical set by name, confirmed rows included', async () => {
    const { fractionsId } = await overlappingPaper();
    await api()
      .post(`/api/admin/topics/${fractionsId}/confirm`)
      .set('authorization', auth())
      .expect(201);

    const response = await api()
      .get(`/api/admin/topics/subjects/${subjectId}`)
      .set('authorization', auth())
      .expect(200);

    // The ordinary merge folds a provisional near-duplicate into the confirmed Topic
    // it should have matched, so a provisional-only list would hide every good target.
    expect(
      response.body.map((entry: { name: string; provisional: boolean }) => [
        entry.name,
        entry.provisional,
      ]),
    ).toEqual([
      ['Fractions', false],
      ['Photosynthesis', true],
    ]);
  });

  it('404s the canonical set of a Subject that does not exist', async () => {
    // An empty canonical set and an absent Subject are not the same answer, and a
    // screen that could not tell them apart would offer no targets and no reason.
    await api()
      .get(`/api/admin/topics/subjects/${UNKNOWN_UUID}`)
      .set('authorization', auth())
      .expect(404);
  });

  // --- Confirm -----------------------------------------------------------

  it('confirms a provisional Topic without moving one Mastery row', async () => {
    const { fractionsId } = await overlappingPaper();
    const before = await masteryOn(fractionsId);
    const topicBefore = await h.prisma.topic.findUniqueOrThrow({ where: { id: fractionsId } });

    const response = await api()
      .post(`/api/admin/topics/${fractionsId}/confirm`)
      .set('authorization', auth())
      .expect(201);

    expect(response.body).toMatchObject({ topicId: fractionsId, provisional: false });
    const after = await h.prisma.topic.findUniqueOrThrow({ where: { id: fractionsId } });
    expect(after.provisional).toBe(false);
    // Confirm means "a human has judged this" and nothing else: the name, the key and
    // the cached vector are the Topic, not the judgement.
    expect(after.name).toBe(topicBefore.name);
    expect(after.matchKey).toBe(topicBefore.matchKey);
    expect(after.embedding).toEqual(topicBefore.embedding);
    // Byte for byte, `updatedAt` included.
    expect(await masteryOn(fractionsId)).toEqual(before);

    const audit = (await audits()).at(-1)!;
    expect(audit).toMatchObject({
      actorId: h.operatorId,
      action: 'topic.confirm',
      targetType: 'Topic',
      targetId: fractionsId,
    });
    expect(audit.detail).toEqual({ subjectId, name: 'Fractions' });
  });

  it('is idempotent on an already-confirmed Topic, and audits the second call too', async () => {
    const { fractionsId } = await overlappingPaper();
    await api()
      .post(`/api/admin/topics/${fractionsId}/confirm`)
      .set('authorization', auth())
      .expect(201);
    const afterFirst = await h.prisma.topic.findUniqueOrThrow({ where: { id: fractionsId } });

    await api()
      .post(`/api/admin/topics/${fractionsId}/confirm`)
      .set('authorization', auth())
      .expect(201);

    // No second UPDATE, so not even `updatedAt` moves.
    expect(await h.prisma.topic.findUniqueOrThrow({ where: { id: fractionsId } })).toEqual(
      afterFirst,
    );
    // A redundant action an operator took is still an action an operator took.
    expect((await audits()).filter((row) => row.action === 'topic.confirm')).toHaveLength(2);
  });

  // --- Rename ------------------------------------------------------------

  it('renames a Topic, re-deriving the key and clearing the cached vector', async () => {
    const { photosynthesisId } = await overlappingPaper();
    const before = await h.prisma.topic.findUniqueOrThrow({ where: { id: photosynthesisId } });
    const masteryBefore = await masteryOn(photosynthesisId);
    // The fixture's second Topic is minted at stage 3, so it genuinely carries a
    // cached vector for the clearing to be a change rather than a no-op.
    expect(before.embedding).not.toBeNull();
    expect(before.embeddingModel).not.toBeNull();
    // The fixture's own stage-2 embed is not this case's; the claim below is that
    // curation adds none of its own.
    h.ai.reset();

    await api()
      .patch(`/api/admin/topics/${photosynthesisId}/name`)
      .set('authorization', auth())
      .send({ name: '  Photosynthesis in Plants  ' })
      .expect(200);

    const after = await h.prisma.topic.findUniqueOrThrow({ where: { id: photosynthesisId } });
    expect(after.name).toBe('Photosynthesis in Plants');
    expect(after.matchKey).toBe(topicMatchKey('Photosynthesis in Plants'));
    // A vector of the old spelling would go on matching a name the row no longer has.
    expect(after.embedding).toBeNull();
    expect(after.embeddingModel).toBeNull();
    // Confirm is the decision; a rename never makes it.
    expect(after.provisional).toBe(true);
    expect(await masteryOn(photosynthesisId)).toEqual(masteryBefore);
    // Curation makes no provider call of any kind.
    expect(h.ai.embedded).toHaveLength(0);

    const audit = (await audits()).at(-1)!;
    expect(audit).toMatchObject({ action: 'topic.rename', targetId: photosynthesisId });
    expect(audit.detail).toEqual({
      subjectId,
      from: 'Photosynthesis',
      to: 'Photosynthesis in Plants',
    });
  });

  it('409s a rename whose new key is already another Topic’s in that Subject', async () => {
    const { photosynthesisId } = await overlappingPaper();
    const auditsBefore = (await audits()).length;

    // `topicMatchKey` drops case and word order, so this collides with `Fractions`.
    await api()
      .patch(`/api/admin/topics/${photosynthesisId}/name`)
      .set('authorization', auth())
      .send({ name: 'fractions' })
      .expect(409);

    const after = await h.prisma.topic.findUniqueOrThrow({ where: { id: photosynthesisId } });
    expect(after.name).toBe('Photosynthesis');
    expect(await audits()).toHaveLength(auditsBefore);
  });

  it('400s a rename to a name that is blank once trimmed', async () => {
    const { photosynthesisId } = await overlappingPaper();
    await api()
      .patch(`/api/admin/topics/${photosynthesisId}/name`)
      .set('authorization', auth())
      .send({ name: '   ' })
      .expect(400);
  });

  // --- Merge -------------------------------------------------------------

  it('merges one Topic into another, moving the tags and the Mastery with them', async () => {
    const { fractionsId, photosynthesisId, questionIds } = await overlappingPaper();

    // Before: two Topics, one Question carrying both, and two separate figures.
    expect(await masteryOn(fractionsId)).toMatchObject({ correct: 2, incorrect: 0, value: 1 });
    expect(await masteryOn(photosynthesisId)).toMatchObject({
      correct: 1,
      incorrect: 1,
      value: 0.5,
    });

    const response = await api()
      .post(`/api/admin/topics/${photosynthesisId}/merge`)
      .set('authorization', auth())
      .send({ targetTopicId: fractionsId })
      .expect(201);

    // Q1 already carried the survivor, so its tag is deleted rather than moved; Q3's
    // is the one that re-points.
    expect(response.body).toMatchObject({
      mergedTopicId: photosynthesisId,
      targetTopicId: fractionsId,
      repointed: 1,
      profilesRecomputed: 1,
    });

    // No row references the merged Topic, and the Topic itself is gone.
    expect(await tagsOn(photosynthesisId)).toEqual([]);
    expect(await h.prisma.topic.findUnique({ where: { id: photosynthesisId } })).toBeNull();
    expect(await masteryOn(photosynthesisId)).toBeNull();

    // No Question carries a duplicate tag: three Questions, three rows.
    const survivorTags = await tagsOn(fractionsId);
    expect(survivorTags).toHaveLength(3);
    expect(new Set(survivorTags.map((tag) => tag.questionId))).toEqual(new Set(questionIds));

    // And the survivor's figure is what `recomputeMastery` makes of the union: Q1 and
    // Q2 right, Q3 wrong.
    expect(await masteryOn(fractionsId)).toMatchObject({
      correct: 2,
      incorrect: 1,
      unanswered: 0,
      attemptsCounted: 1,
      value: 2 / 3,
    });

    const audit = (await audits()).at(-1)!;
    expect(audit).toMatchObject({ action: 'topic.merge', targetId: photosynthesisId });
    expect(audit.detail).toEqual({
      targetTopicId: fractionsId,
      subjectId,
      mergedName: 'Photosynthesis',
      targetName: 'Fractions',
      repointed: 1,
      profilesRecomputed: 1,
    });
    // Counts and names, never a Question's prompt or a child's answer (AD-20).
    expect(JSON.stringify(audit.detail)).not.toContain('third of');
  });

  it('recomputes every affected profile, not just the first, over both halves of the union', async () => {
    // **The case a single-profile merge cannot state.** One child's merge is green
    // whether the orchestrator loops or calls the one recompute path once, so the
    // loop's whole reason — that a merge moves the figures of *everyone* who has sat a
    // paper carrying the Topic — is only observable with two.
    //
    // The two children qualify through **different halves** of the affected-profile
    // union, deliberately:
    //
    // - A holds a `TopicMastery` row on the merged Topic, so it would be found by the
    //   stored rows alone (half 2).
    // - B holds **no** `TopicMastery` row on either Topic and is findable only through
    //   a submitted Attempt on a paper carrying the merged Topic (half 1). That is the
    //   state half 1 exists for — a child with real evidence and no stored figure over
    //   it, which is what an all-`Ungraded` window at hand-in leaves behind, and what a
    //   `topic_mastery` read can never see.
    const { fractionsId, photosynthesisId } = await overlappingPaper();
    const profileB = (await createStudentProfileWithHeadroom(h, parentAccountId, { gradeLevelId }))
      .id;
    const bPaper = await paper([['Photosynthesis']], profileB);
    const bAttempt = await openAttempt(bPaper.practiceTestId, 1, profileB);
    await submit(bAttempt, [{ questionId: bPaper.questionIds[0]!, value: right(1) }], profileB);

    // B's stored figures are removed rather than never written, because the hand-in
    // writes one for any graded evidence and the state under test is the one where the
    // evidence outlives the row. Only B's rows, and only `topic_mastery` — the tag the
    // merge moves is left exactly as the hand-in resolved it.
    await h.prisma.topicMastery.deleteMany({ where: { studentProfileId: profileB } });
    expect(await masteryOn(photosynthesisId, profileB)).toBeNull();
    expect(await masteryOn(fractionsId, profileB)).toBeNull();

    // Spied through rather than replaced, so this states how many times the one
    // recompute path ran while the merge still really ran it (AD-12).
    const recompute = vi.spyOn(h.moduleRef.get(GradingService), 'recomputeMastery');

    const response = await api()
      .post(`/api/admin/topics/${photosynthesisId}/merge`)
      .set('authorization', auth())
      .send({ targetTopicId: fractionsId })
      .expect(201);

    // A's Q1 already carried the survivor and is deleted; A's Q3 and B's only Question
    // are the two that move.
    expect(response.body).toMatchObject({ repointed: 2, profilesRecomputed: 2 });

    // One call per affected profile, each over the survivor alone — never one call for
    // whichever profile happened to come back first.
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(
      recompute.mock.calls.map(([, profileId, topicIds]) => ({ profileId, topicIds })),
    ).toEqual(
      expect.arrayContaining([
        { profileId: studentProfileId, topicIds: [fractionsId] },
        { profileId: profileB, topicIds: [fractionsId] },
      ]),
    );

    // A's figure is the union of the two Topics' evidence on its own paper.
    expect(await masteryOn(fractionsId)).toMatchObject({
      correct: 2,
      incorrect: 1,
      attemptsCounted: 1,
      value: 2 / 3,
    });
    // And B's figure exists again, over the survivor, computed from the evidence the
    // stored row had been lost from. Nothing but the per-profile loop puts it here.
    expect(await masteryOn(fractionsId, profileB)).toMatchObject({
      correct: 1,
      incorrect: 0,
      attemptsCounted: 1,
      value: 1,
    });
    expect(await tagsOn(photosynthesisId)).toEqual([]);
    expect(
      (await tagsOn(fractionsId)).filter((tag) => tag.practiceTestId === bPaper.practiceTestId),
    ).toHaveLength(1);
  });

  it('merges a Topic with no tags: the row goes, nothing is re-pointed', async () => {
    await overlappingPaper();
    // Two Topics the cascade minted from labels nobody has handed a paper in on, so
    // neither carries a tag and neither carries a Mastery row.
    const orphanId = await h.topics.normalize({
      label: 'Tectonic Plates',
      subjectId,
      parentAccountId,
    });
    const survivorId = await h.topics.normalize({
      label: 'Volcanoes',
      subjectId,
      parentAccountId,
    });
    const masteryBefore = await h.prisma.topicMastery.findMany({ orderBy: { topicId: 'asc' } });

    const response = await api()
      .post(`/api/admin/topics/${orphanId}/merge`)
      .set('authorization', auth())
      .send({ targetTopicId: survivorId })
      .expect(201);

    // No tag to move and no profile to find: the affected set is a union of two
    // empty halves, and a recompute of nobody is the right amount of work.
    expect(response.body).toMatchObject({ repointed: 0, profilesRecomputed: 0 });
    expect(await h.prisma.topic.findUnique({ where: { id: orphanId } })).toBeNull();
    expect(await h.prisma.topic.findUnique({ where: { id: survivorId } })).not.toBeNull();
    // And nothing anywhere else moved.
    expect(await h.prisma.topicMastery.findMany({ orderBy: { topicId: 'asc' } })).toEqual(
      masteryBefore,
    );
  });

  it('400s a merge of a Topic into itself, and writes nothing', async () => {
    const { fractionsId } = await overlappingPaper();
    const before = await tagsOn(fractionsId);

    await api()
      .post(`/api/admin/topics/${fractionsId}/merge`)
      .set('authorization', auth())
      .send({ targetTopicId: fractionsId })
      .expect(400);

    // Admitting it would re-point every tag onto the row it is already on and then
    // delete that row, taking the tags with it under the cascade.
    expect(await h.prisma.topic.findUnique({ where: { id: fractionsId } })).not.toBeNull();
    expect(await tagsOn(fractionsId)).toEqual(before);
  });

  it('400s a merge whose target belongs to another Subject, and writes nothing', async () => {
    const { photosynthesisId } = await overlappingPaper();
    const otherSubject = await createSubject(h, { gradeLevelId, name: 'Geography' });
    const foreignId = await h.topics.normalize({
      label: 'Rivers',
      subjectId: otherSubject.id,
      parentAccountId,
    });
    const tagsBefore = await tagsOn(photosynthesisId);

    await api()
      .post(`/api/admin/topics/${photosynthesisId}/merge`)
      .set('authorization', auth())
      .send({ targetTopicId: foreignId })
      .expect(400);

    expect(await h.prisma.topic.findUnique({ where: { id: photosynthesisId } })).not.toBeNull();
    expect(await tagsOn(photosynthesisId)).toEqual(tagsBefore);
  });

  it('404s any action on an id with no row, and a merge whose target has none', async () => {
    const { fractionsId } = await overlappingPaper();

    await api()
      .post(`/api/admin/topics/${UNKNOWN_UUID}/confirm`)
      .set('authorization', auth())
      .expect(404);
    await api()
      .patch(`/api/admin/topics/${UNKNOWN_UUID}/name`)
      .set('authorization', auth())
      .send({ name: 'Anything' })
      .expect(404);
    await api()
      .post(`/api/admin/topics/${fractionsId}/merge`)
      .set('authorization', auth())
      .send({ targetTopicId: UNKNOWN_UUID })
      .expect(404);

    expect(await h.prisma.topic.findUnique({ where: { id: fractionsId } })).not.toBeNull();
  });

  it('rolls a failed merge back whole: tags, Topic row and every Mastery row', async () => {
    // Driven through the service rather than the route, because the claim is about a
    // failure *inside* the transaction and there is no request that produces one. The
    // failure is injected into the last step the merge takes before it commits, so
    // everything before it has already been written when the rollback happens.
    const { fractionsId, photosynthesisId } = await overlappingPaper();
    const curation = h.moduleRef.get(TopicCurationService);
    const grading = h.moduleRef.get(GradingService);

    const tagsBefore = [...(await tagsOn(photosynthesisId)), ...(await tagsOn(fractionsId))];
    const masteryBefore = await h.prisma.topicMastery.findMany({
      where: { studentProfileId },
      orderBy: { topicId: 'asc' },
    });

    vi.spyOn(grading, 'recomputeMastery').mockRejectedValueOnce(new Error('injected'));

    await expect(curation.merge(h.operatorId, photosynthesisId, fractionsId)).rejects.toThrow(
      'injected',
    );

    expect(await h.prisma.topic.findUnique({ where: { id: photosynthesisId } })).not.toBeNull();
    expect([...(await tagsOn(photosynthesisId)), ...(await tagsOn(fractionsId))]).toEqual(
      tagsBefore,
    );
    expect(
      await h.prisma.topicMastery.findMany({
        where: { studentProfileId },
        orderBy: { topicId: 'asc' },
      }),
    ).toEqual(masteryBefore);
    // The audit row is written on the same `tx`, so it goes back with everything else.
    expect((await audits()).filter((row) => row.action === 'topic.merge')).toEqual([]);
  });

  // --- The wire ----------------------------------------------------------

  /**
   * The refusals the controller itself exists to make: a path segment that is not a
   * uuid, and a body that is not the shape the action takes.
   *
   * **Stated here because they are the difference between a refusal and a fault.**
   * Without the `ParseUUIDPipe` an unparseable id reaches Prisma and comes back a 500;
   * without the DTO an absent `name` reaches `boundedLabel` as `undefined`, and an
   * over-long one would be silently truncated to a name the operator never asked for.
   * Every one of these is a 400 before a single row is read.
   */
  it('400s a path id that is not a uuid, on every route that takes one', async () => {
    await api()
      .post('/api/admin/topics/not-a-uuid/confirm')
      .set('authorization', auth())
      .expect(400);
    await api()
      .patch('/api/admin/topics/not-a-uuid/name')
      .set('authorization', auth())
      .send({ name: 'Anything' })
      .expect(400);
    await api()
      .post('/api/admin/topics/not-a-uuid/merge')
      .set('authorization', auth())
      .send({ targetTopicId: UNKNOWN_UUID })
      .expect(400);
    await api()
      .get('/api/admin/topics/subjects/not-a-uuid')
      .set('authorization', auth())
      .expect(400);
  });

  it('400s a merge target that is not a uuid, and writes nothing', async () => {
    const { photosynthesisId } = await overlappingPaper();
    const tagsBefore = await tagsOn(photosynthesisId);

    for (const targetTopicId of ['not-a-uuid', 42, null, undefined]) {
      await api()
        .post(`/api/admin/topics/${photosynthesisId}/merge`)
        .set('authorization', auth())
        .send({ targetTopicId })
        .expect(400);
    }

    expect(await h.prisma.topic.findUnique({ where: { id: photosynthesisId } })).not.toBeNull();
    expect(await tagsOn(photosynthesisId)).toEqual(tagsBefore);
    expect(await audits()).toEqual([]);
  });

  it('400s a rename whose name is absent or not a string', async () => {
    const { photosynthesisId } = await overlappingPaper();

    for (const body of [{}, { name: null }, { name: 42 }, { name: ['Photosynthesis'] }]) {
      await api()
        .patch(`/api/admin/topics/${photosynthesisId}/name`)
        .set('authorization', auth())
        .send(body)
        .expect(400);
    }

    const after = await h.prisma.topic.findUniqueOrThrow({ where: { id: photosynthesisId } });
    expect(after.name).toBe('Photosynthesis');
    expect(await audits()).toEqual([]);
  });

  it('400s a name longer than the bound rather than storing a truncation of it', async () => {
    const { photosynthesisId } = await overlappingPaper();
    // One character past the bound every minted name is already held to. Refused on the
    // wire, because a silently shortened name is a Topic the operator did not ask for —
    // and a key derived from a spelling nobody chose.
    const tooLong = 'a'.repeat(MAX_TOPIC_LABEL_LENGTH + 1);

    await api()
      .patch(`/api/admin/topics/${photosynthesisId}/name`)
      .set('authorization', auth())
      .send({ name: tooLong })
      .expect(400);

    const after = await h.prisma.topic.findUniqueOrThrow({ where: { id: photosynthesisId } });
    expect(after.name).toBe('Photosynthesis');
    expect(await audits()).toEqual([]);

    // And the bound itself is renamable: exactly at it is accepted, so the wire check
    // and `boundedLabel` cannot disagree about what fits.
    const atBound = 'b'.repeat(MAX_TOPIC_LABEL_LENGTH);
    await api()
      .patch(`/api/admin/topics/${photosynthesisId}/name`)
      .set('authorization', auth())
      .send({ name: atBound })
      .expect(200);
    expect((await h.prisma.topic.findUniqueOrThrow({ where: { id: photosynthesisId } })).name).toBe(
      atBound,
    );
  });

  // --- The guard ---------------------------------------------------------

  it('refuses every curation route with 401 before a Topic is read', async () => {
    const { fractionsId, photosynthesisId } = await overlappingPaper();
    const before = await h.prisma.topic.findMany({ orderBy: { id: 'asc' } });

    await api().get('/api/admin/topics/provisional').expect(401);
    await api().get(`/api/admin/topics/subjects/${subjectId}`).expect(401);
    await api().post(`/api/admin/topics/${fractionsId}/confirm`).expect(401);
    await api()
      .patch(`/api/admin/topics/${fractionsId}/name`)
      .send({ name: 'Anything' })
      .expect(401);
    await api()
      .post(`/api/admin/topics/${photosynthesisId}/merge`)
      .send({ targetTopicId: fractionsId })
      .expect(401);

    expect(await h.prisma.topic.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await audits()).toEqual([]);
  });
});
