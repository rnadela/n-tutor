import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { TOPIC_LABEL_REQUIRED, TOPIC_SUBJECT_UNKNOWN, TopicInputError } = await import(
  '../src/topics/topic-policy.js'
);
const { AiService } = await import('../src/ai/ai.service.js');
const { fakeEmbedding } = await import('../src/ai/fake-embedding.js');
const { MAX_TOPIC_LABEL_LENGTH, TOPIC_CANDIDATE_LIMIT } = await import(
  '../src/topics/topic-policy.js'
);
const { createHarness, createParentAccount, createSubject, resetParentAccounts, resetTaxonomy } =
  await import('./harness.js');

type Harness = Awaited<ReturnType<typeof createHarness>>;

const UNKNOWN_UUID = '11111111-2222-4333-8444-555555555555';

/**
 * Topic canonicalization — the whole of the AD-11 cascade, against real Postgres
 * and the `fake` transport.
 *
 * **Every row of the story's I/O matrix is here, and the assertions are about
 * *which stage answered*.** That is the one thing a caller of `normalize` cannot
 * see and the one thing that decides what this costs: a cascade whose stage 1
 * quietly stopped matching would still return correct ids forever, while paying
 * for two provider calls per label. So each case reads the captured seam —
 * `h.ai.embedded` for stage 2's embed and `h.ai.sent` for stage 3's call — beside
 * the id it got back, and the cost table beside both.
 *
 * The cascade is driven through `TopicService` rather than through a route because
 * there is no route: canonicalization is an internal seam in this story, and Story
 * 7.6 is what gives the provisional set a surface.
 *
 * Almost nothing here is set up by writing a `topic` row directly. Every Topic in
 * every case arrives through `normalize`, which is the only writer of that table —
 * so the cached vectors these cases compare against are the ones production would
 * have cached, not ones a fixture invented. The two exceptions say so at their own
 * site and give their reason: a stale embedding snapshot cannot be produced through
 * the cascade at all, and filling a canonical set past the stage-3 cap through it
 * would spend sixty setup provider calls to assert something about the sixty-first.
 */
describe('Topic canonicalization: three stages, one interface', () => {
  let h: Harness;
  let parentAccountId: string;
  let subjectId: string;
  let stage3Model: string;
  let embeddingModel: string;

  beforeAll(async () => {
    h = await createHarness();
    const config = h.moduleRef.get(AiService).config;
    stage3Model = config.pins.TopicNormalization.model;
    embeddingModel = config.embeddingPin.model;
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetParentAccounts(h.prisma);
    await resetTaxonomy(h.prisma);
    h.ai.reset();
    parentAccountId = (await createParentAccount(h.identity)).id;
    subjectId = (await createSubject(h)).id;
  });

  /** Every Topic the Subject holds, oldest first — the canonical set itself. */
  const canonicalSet = () =>
    h.prisma.topic.findMany({ where: { subjectId }, orderBy: { createdAt: 'asc' } });

  const aiCalls = () => h.prisma.aiCall.findMany({ orderBy: { createdAt: 'asc' } });

  /** What the seam recorded since the last reset: one figure per stage. */
  const stages = () => ({ embeds: h.ai.embedded.length, resolutions: h.ai.sent.length });

  it('mints the first Topic of an empty canonical set with no provider call at all', async () => {
    const id = await h.topics.normalize({
      label: 'Long Division',
      subjectId: subjectId,
      parentAccountId,
    });

    // The documented single exception to "only stage 3 may conclude that nothing
    // fits": with no candidates the answer is forced, so there is nothing to embed
    // and nothing to ask.
    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
    expect(await aiCalls()).toHaveLength(0);

    const set = await canonicalSet();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({
      id,
      // The emitted label verbatim, never the key: a key is sorted, lowercased and
      // stripped, and a parent's dashboard would read "division long".
      name: 'Long Division',
      matchKey: 'division long',
      provisional: true,
    });
    // No embed call behind it, so no vector to cache.
    expect(set[0]!.embedding).toBeNull();
    expect(set[0]!.embeddingModel).toBeNull();
  });

  it('answers stage 1 from the normalized key, with no provider call and no new row', async () => {
    const existing = await h.topics.normalize({
      label: 'Long Division',
      subjectId: subjectId,
      parentAccountId,
    });
    h.ai.reset();

    const id = await h.topics.normalize({
      label: 'long  DIVISION!',
      subjectId: subjectId,
      parentAccountId,
    });

    expect(id).toBe(existing);
    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
    expect(await aiCalls()).toHaveLength(0);
    expect(await canonicalSet()).toHaveLength(1);
  });

  it('mints at stage 3 when candidates exist and none of them fit, caching the vector', async () => {
    await h.topics.normalize({ label: 'Long Division', subjectId: subjectId, parentAccountId });
    h.ai.reset();

    const id = await h.topics.normalize({
      label: 'Photosynthesis',
      subjectId: subjectId,
      parentAccountId,
    });

    // One embed, which stage 2 found nothing usable to compare against, then the one
    // call that is allowed to say "none of these fit".
    expect(stages()).toEqual({ embeds: 1, resolutions: 1 });
    expect(h.ai.embedded[0]!.text).toBe('Photosynthesis');
    expect(h.ai.sent[0]).toMatchObject({
      callClass: 'TopicNormalization',
      modality: 'text',
      imageCount: 0,
    });

    const set = await canonicalSet();
    expect(set).toHaveLength(2);
    const minted = set.find((topic) => topic.id === id)!;
    expect(minted).toMatchObject({ name: 'Photosynthesis', provisional: true, embeddingModel });
    expect(Array.isArray(minted.embedding)).toBe(true);
  });

  it('answers stage 2 from a cached vector, without reaching stage 3', async () => {
    // Both fixtures arrive through the cascade, so `Fraction Addition` carries the
    // vector its own stage-2 embed paid for — which is what stage 2 then matches.
    await h.topics.normalize({ label: 'Long Division', subjectId: subjectId, parentAccountId });
    const fractionAddition = await h.topics.normalize({
      label: 'Fraction Addition',
      subjectId: subjectId,
      parentAccountId,
    });
    h.ai.reset();

    const id = await h.topics.normalize({
      label: 'Fractions Addition',
      subjectId: subjectId,
      parentAccountId,
    });

    expect(id).toBe(fractionAddition);
    expect(stages()).toEqual({ embeds: 1, resolutions: 0 });
    expect(await canonicalSet()).toHaveLength(2);

    // Matching never renames and never confirms.
    const matched = await h.prisma.topic.findUniqueOrThrow({ where: { id } });
    expect(matched).toMatchObject({ name: 'Fraction Addition', provisional: true });
  });

  it('returns the candidate stage 3 names, and mints nothing', async () => {
    await h.topics.normalize({ label: 'Long Division', subjectId: subjectId, parentAccountId });
    const wordProblems = await h.topics.normalize({
      label: 'Fraction Word Problems',
      subjectId: subjectId,
      parentAccountId,
    });
    h.ai.reset();

    // Related enough to share a token, far enough apart to score well under the
    // threshold: stage 2 declines and stage 3 picks it out of the list.
    const id = await h.topics.normalize({
      label: 'Fraction Estimation',
      subjectId: subjectId,
      parentAccountId,
    });

    expect(id).toBe(wordProblems);
    expect(stages()).toEqual({ embeds: 1, resolutions: 1 });
    expect(await canonicalSet()).toHaveLength(2);
    // Every candidate name reaches the prompt as data, never as instruction.
    expect(h.ai.sent[0]!.prompt).toContain('<<<TOPIC NAME');
    expect(h.ai.sent[0]!.prompt).toContain('<<<NEW LABEL');
  });

  it('treats an id stage 3 was never offered as no match, and mints', async () => {
    await h.topics.normalize({ label: 'Long Division', subjectId: subjectId, parentAccountId });
    await h.topics.normalize({
      label: 'Fraction Word Problems',
      subjectId: subjectId,
      parentAccountId,
    });
    h.ai.reset();
    // The `unusable` latch spends the one meaningless failure mode a text call has
    // on the one provider misbehaviour that matters here: an invented id.
    h.ai.failNext('unusable');

    const id = await h.topics.normalize({
      label: 'Fraction Estimation',
      subjectId: subjectId,
      parentAccountId,
    });

    const set = await canonicalSet();
    expect(set).toHaveLength(3);
    expect(set.find((topic) => topic.id === id)).toMatchObject({
      name: 'Fraction Estimation',
      provisional: true,
    });
  });

  it('skips stage 2 when the embedding fails upstream, and still answers', async () => {
    await h.topics.normalize({ label: 'Long Division', subjectId: subjectId, parentAccountId });
    const fractionAddition = await h.topics.normalize({
      label: 'Fraction Addition',
      subjectId: subjectId,
      parentAccountId,
    });
    h.ai.reset();
    // The fixtures above paid for their own calls; cleared so the cost assertion
    // below is about this normalize alone.
    await h.prisma.aiCall.deleteMany();
    // Latched for the whole `embed`, retries included, so it genuinely exhausts.
    h.ai.failNextEmbed('transport');

    const id = await h.topics.normalize({
      label: 'Fractions Addition',
      subjectId: subjectId,
      parentAccountId,
    });

    // The pair stage 2 would have matched on its own; without a vector the question
    // falls through to stage 3, which answers it from the names.
    expect(id).toBe(fractionAddition);
    expect(stages()).toEqual({ embeds: 1, resolutions: 1 });
    expect(await canonicalSet()).toHaveLength(2);
    // An exhausted embed completed no call, so it is charged for nothing: the only
    // cost row is the stage-3 call's.
    const rows = await aiCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe(stage3Model);
  });

  it('is idempotent, and the repeat costs nothing', async () => {
    const first = await h.topics.normalize({
      label: 'Long Division',
      subjectId: subjectId,
      parentAccountId,
    });
    h.ai.reset();

    const second = await h.topics.normalize({
      label: 'Long Division',
      subjectId: subjectId,
      parentAccountId,
    });

    expect(second).toBe(first);
    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
    expect(await aiCalls()).toHaveLength(0);
    expect(await canonicalSet()).toHaveLength(1);
  });

  it('keys a label made only of stopwords on its own tokens rather than on nothing', async () => {
    const id = await h.topics.normalize({ label: 'the of', subjectId: subjectId, parentAccountId });

    const set = await canonicalSet();
    expect(set).toHaveLength(1);
    // Not the empty string: an empty key is a valid unique value, so every
    // all-stopword label would otherwise collide into one Topic.
    expect(set[0]!.matchKey).toBe('of the');

    // And it matches itself at stage 1, like any other key.
    h.ai.reset();
    expect(
      await h.topics.normalize({ label: 'THE  OF!', subjectId: subjectId, parentAccountId }),
    ).toBe(id);
    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
  });

  it('refuses a blank label before any provider call', async () => {
    for (const label of ['', '   ']) {
      await expect(
        h.topics.normalize({ label: label, subjectId: subjectId, parentAccountId }),
      ).rejects.toThrow(TopicInputError);
      await expect(
        h.topics.normalize({ label: label, subjectId: subjectId, parentAccountId }),
      ).rejects.toThrow(TOPIC_LABEL_REQUIRED);
    }
    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
    expect(await aiCalls()).toHaveLength(0);
    expect(await canonicalSet()).toHaveLength(0);
  });

  it('refuses an unknown Subject before any provider call', async () => {
    await expect(
      h.topics.normalize({ label: 'Long Division', subjectId: UNKNOWN_UUID, parentAccountId }),
    ).rejects.toThrow(TOPIC_SUBJECT_UNKNOWN);

    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
    expect(await aiCalls()).toHaveLength(0);
    expect(await h.prisma.topic.count()).toBe(0);
  });

  it('leaves one row and one id when two mints of the same key race', async () => {
    const [first, second] = await Promise.all([
      h.topics.normalize({ label: 'Long Division', subjectId: subjectId, parentAccountId }),
      h.topics.normalize({ label: 'long division', subjectId: subjectId, parentAccountId }),
    ]);

    // The unique index is what decides this, not a check: the loser catches its
    // violation and re-reads by `(subjectId, matchKey)`.
    expect(second).toBe(first);
    expect(await canonicalSet()).toHaveLength(1);
  });

  it('writes one cost row per provider call, under the model actually sent', async () => {
    await h.topics.normalize({ label: 'Long Division', subjectId: subjectId, parentAccountId });
    const label = 'Photosynthesis';
    await h.topics.normalize({ label: label, subjectId: subjectId, parentAccountId });

    const rows = await aiCalls();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.callClass === 'TopicNormalization')).toBe(true);
    expect(rows.every((row) => row.parentAccountId === parentAccountId)).toBe(true);
    // One call class, two models — and each row says which of the two it paid for.
    expect(rows.map((row) => row.model).sort()).toEqual([embeddingModel, stage3Model].sort());
    // An embedding returns a vector, not tokens.
    const embedRow = rows.find((row) => row.model === embeddingModel)!;
    expect(embedRow.outputTokens).toBe(0);
    expect(embedRow.inputTokens).toBeGreaterThan(0);
    // Not one row carries anything the model said, or anything it was asked (AD-20).
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') expect(value).not.toContain(label);
      }
    }
  });

  it('caches a vector on a vectorless Topic the moment stage 3 confirms it', async () => {
    // The first Topic of a Subject is minted with no embed call behind it, so stage 2
    // can never match it. Left alone it would cost a stage-3 call for every future
    // spelling of itself, for the lifetime of the Subject.
    const longDivision = await h.topics.normalize({
      label: 'Long Division',
      subjectId,
      parentAccountId,
    });
    expect((await canonicalSet())[0]!.embedding).toBeNull();
    h.ai.reset();

    const id = await h.topics.normalize({
      label: 'Division Practice',
      subjectId,
      parentAccountId,
    });

    expect(id).toBe(longDivision);
    // Stage 2 was skipped, not attempted: nothing in the set had a comparable vector,
    // so embedding the label would have been a paid call with no possible outcome.
    // The one embed is the backfill, and it embedded the *candidate's stored name*
    // rather than the label that matched it.
    expect(stages()).toEqual({ embeds: 1, resolutions: 1 });
    expect(h.ai.embedded[0]!.text).toBe('Long Division');

    const cached = await h.prisma.topic.findUniqueOrThrow({ where: { id: longDivision } });
    expect(cached.embedding).toEqual(fakeEmbedding('Long Division'));
    expect(cached.embeddingModel).toBe(embeddingModel);
    // A backfill is not a rename and not a confirmation.
    expect(cached).toMatchObject({ name: 'Long Division', provisional: true });
    expect(await canonicalSet()).toHaveLength(1);

    // And the point of it: the next near-duplicate is settled by stage 2 alone.
    h.ai.reset();
    expect(await h.topics.normalize({ label: 'Long Divisions', subjectId, parentAccountId })).toBe(
      longDivision,
    );
    expect(stages()).toEqual({ embeds: 1, resolutions: 0 });
  });

  it('buys no embedding when nothing in the set carries a comparable vector', async () => {
    await h.topics.normalize({ label: 'Long Division', subjectId, parentAccountId });
    h.ai.reset();
    await h.prisma.aiCall.deleteMany();

    // `Photosynthesis` fits nothing, so this reaches the mint — and the only embed it
    // pays for is the one that caches the minted row's own vector. Stage 2 never ran.
    await h.topics.normalize({ label: 'Photosynthesis', subjectId, parentAccountId });

    expect(stages()).toEqual({ embeds: 1, resolutions: 1 });
    expect(h.ai.embedded[0]!.text).toBe('Photosynthesis');
    expect(await aiCalls()).toHaveLength(2);
  });

  it('declines stage 2 when every cached vector came from another snapshot', async () => {
    // Written directly, and it is the one state the cascade cannot produce itself: a
    // vector cached under a snapshot that is no longer pinned. Without the model guard
    // this cosine would be computed and would match at ~0.89, so this case is the
    // difference between the guard working and the guard being decorative.
    const stale = await h.prisma.topic.create({
      data: {
        subjectId,
        name: 'Fraction Addition',
        matchKey: 'addition fraction',
        provisional: true,
        embedding: fakeEmbedding('Fraction Addition'),
        embeddingModel: 'text-embedding-from-a-previous-pin',
      },
      select: { id: true },
    });
    h.ai.reset();

    const id = await h.topics.normalize({
      label: 'Fractions Addition',
      subjectId,
      parentAccountId,
    });

    expect(id).toBe(stale.id);
    // Stage 2 declined without paying for a label embedding, and stage 3 answered from
    // the names. The one embed is the backfill onto the now-current snapshot.
    expect(stages()).toEqual({ embeds: 1, resolutions: 1 });
    expect(h.ai.embedded[0]!.text).toBe('Fraction Addition');
    expect(await canonicalSet()).toHaveLength(1);
    const refreshed = await h.prisma.topic.findUniqueOrThrow({ where: { id: stale.id } });
    expect(refreshed.embeddingModel).toBe(embeddingModel);
  });

  it('caps the stage-3 candidate list and offers the strongest candidates first', async () => {
    // Written directly, for the reason the docblock gives: filling the set past the cap
    // through the cascade would spend one provider call per filler to assert something
    // about the ordering of the list they are in.
    const fillers = Array.from({ length: TOPIC_CANDIDATE_LIMIT + 10 }, (_unused, index) => {
      const name = `Filler Topic ${index + 1}`;
      return {
        subjectId,
        name,
        matchKey: `${index + 1} filler topic`,
        provisional: true,
        embedding: fakeEmbedding(name),
        embeddingModel,
      };
    });
    await h.prisma.topic.createMany({ data: fillers });
    // Created **last**, so the old "oldest first, then take the cap" read would have
    // excluded it outright and this label would have minted a near-duplicate.
    const target = await h.prisma.topic.create({
      data: {
        subjectId,
        name: 'Fraction Word Problems',
        matchKey: 'fraction problems word',
        provisional: true,
        embedding: fakeEmbedding('Fraction Word Problems'),
        embeddingModel,
      },
      select: { id: true },
    });
    h.ai.reset();

    const id = await h.topics.normalize({
      label: 'Fraction Estimation',
      subjectId,
      parentAccountId,
    });

    // Related enough for stage 3 to recognise, far enough for stage 2 to decline.
    expect(id).toBe(target.id);
    expect(stages()).toEqual({ embeds: 1, resolutions: 1 });
    // Nothing minted: the newest Topic in an over-cap set is still reachable.
    expect(await canonicalSet()).toHaveLength(fillers.length + 1);

    const prompt = h.ai.sent[0]!.prompt;
    // The prompt is bounded by the cap, and the strongest candidate is inside it.
    expect(prompt.match(/^id: /gm)).toHaveLength(TOPIC_CANDIDATE_LIMIT);
    expect(prompt).toContain(`id: ${target.id}`);
    // Highest cosine first, so the one candidate with any measurable relation leads.
    expect(prompt.indexOf(`id: ${target.id}`)).toBe(prompt.indexOf('id: '));
  });

  it('shortens an over-long label instead of refusing it', async () => {
    // A label is model-written text with no bound on it, and it becomes a btree key.
    // Losing a Mastery write is worse than a shortened name, so it is cut, not refused.
    const label = `Adding Fractions ${'x'.repeat(MAX_TOPIC_LABEL_LENGTH * 3)}`;

    const id = await h.topics.normalize({ label, subjectId, parentAccountId });

    const set = await canonicalSet();
    expect(set).toHaveLength(1);
    expect(set[0]!.id).toBe(id);
    expect(set[0]!.name).toHaveLength(MAX_TOPIC_LABEL_LENGTH);
    expect(set[0]!.name.startsWith('Adding Fractions ')).toBe(true);
    // The key is derived from the same shortened string the name is, so the two never
    // disagree about what this Topic is.
    expect(set[0]!.matchKey.length).toBeLessThanOrEqual(MAX_TOPIC_LABEL_LENGTH);

    // And two labels that differ only past the cut are one Topic, by stage 1 alone.
    h.ai.reset();
    expect(
      await h.topics.normalize({ label: `${label}-and-more-still`, subjectId, parentAccountId }),
    ).toBe(id);
    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
  });

  it('keeps one canonical set per Subject and never shares it across Subjects', async () => {
    const otherSubjectId = (await createSubject(h)).id;

    const mine = await h.topics.normalize({
      label: 'Long Division',
      subjectId: subjectId,
      parentAccountId,
    });
    const theirs = await h.topics.normalize({
      label: 'Long Division',
      subjectId: otherSubjectId,
      parentAccountId,
    });

    // Scoped by Subject, so the same key in two Subjects is two Topics — and, being
    // the first in each set, neither of them cost a provider call.
    expect(theirs).not.toBe(mine);
    expect(stages()).toEqual({ embeds: 0, resolutions: 0 });
    expect(await canonicalSet()).toHaveLength(1);
    expect(await h.prisma.topic.count({ where: { subjectId: otherSubjectId } })).toBe(1);
  });
});
