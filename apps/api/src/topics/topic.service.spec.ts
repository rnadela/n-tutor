import { describe, expect, it, vi } from 'vitest';
import type { AiService } from '../ai/ai.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService, TransactionClient } from '../prisma/prisma.service.js';
import { topicMatchKey } from './topic-match-key.js';
import {
  MAX_TOPIC_LABEL_LENGTH,
  TOPIC_LABEL_REQUIRED,
  TopicInputError,
  TopicNameConflictError,
} from './topic-policy.js';
import { TopicService } from './topic.service.js';

/**
 * The curation writes, asserted against a stubbed client.
 *
 * **What is being pinned here is not SQL — it is the four rules a later edit would
 * silently drop.** That a rename re-derives its key through `topicMatchKey` rather
 * than editing the stored one; that it clears the cached vector through
 * `Prisma.DbNull` and not a bare `null`; that a confirm on an already-confirmed row
 * writes nothing at all; and that not one of these paths reaches a cascade stage.
 * Each is invisible in a passing integration suite — a rename that left the key
 * behind stores a perfectly good row, and the damage only surfaces the next time a
 * near-duplicate arrives — so each is asserted on the statement itself.
 *
 * `test/topic-curation.int-spec.ts` proves the same writes against real Postgres,
 * where the unique index and the cascade are real. This file proves the arguments.
 */

/** The `ai` seam, which every assertion below expects to stay untouched. */
function aiStub(): {
  ai: AiService;
  run: ReturnType<typeof vi.fn>;
  embed: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn();
  const embed = vi.fn();
  return { ai: { run, embed } as unknown as AiService, run, embed };
}

/** A `Topic` row as the module's own `select` shape returns it. */
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'topic-1',
    name: 'Fractions',
    subjectId: 'subject-1',
    provisional: true,
    subject: { name: 'Mathematics' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** A transaction client stubbed down to the `topic` delegate these writes use. */
function txStub(delegate: Record<string, unknown>): {
  tx: TransactionClient;
  topic: Record<string, unknown>;
} {
  const topic = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...delegate,
  };
  return { tx: { topic } as unknown as TransactionClient, topic };
}

function serviceWith(prismaTopic: Record<string, unknown> = {}) {
  const { ai, run, embed } = aiStub();
  const topic = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...prismaTopic,
  };
  const prisma = { topic } as unknown as PrismaService;
  return { service: new TopicService(prisma, ai), prismaTopic: topic, run, embed };
}

/** The unique-constraint violation exactly as the client raises it. */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('renaming a canonical Topic', () => {
  it('re-derives the match key through `topicMatchKey` rather than storing the name', async () => {
    // The key is what stage 1 looks a label up by, and it is derived in exactly one
    // place. A rename that stored the name, or reduced it some second way, would
    // leave a Topic matching a spelling it no longer has — silently, and for as long
    // as the Subject is taught.
    const update = vi.fn().mockResolvedValue(row({ name: 'Adding Fractions' }));
    const { tx, topic } = txStub({
      findUnique: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      update,
    });
    const { service } = serviceWith();

    await service.rename(tx, 'topic-1', 'Adding Fractions');

    expect(topic.update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0]![0].data;
    expect(data.matchKey).toBe(topicMatchKey('Adding Fractions'));
    // And it is genuinely the reduction, not the name: sorted, lowercased, stopword
    // dropped.
    expect(data.matchKey).toBe('adding fractions');
    expect(data.name).toBe('Adding Fractions');
  });

  it('clears the cached vector through `Prisma.DbNull`, never a bare null', async () => {
    // `embedding` is a nullable `Json` column: a bare `null` is the JSON value
    // `null`, which is a cached vector of nothing rather than no vector at all —
    // and stage 2 would go on comparing against it with a healthy-looking cosine.
    const update = vi.fn().mockResolvedValue(row());
    const { tx } = txStub({ findUnique: vi.fn().mockResolvedValue({ id: 'topic-1' }), update });
    const { service } = serviceWith();

    await service.rename(tx, 'topic-1', 'Equivalent Fractions');

    const data = update.mock.calls[0]![0].data;
    expect(data.embedding).toBe(Prisma.DbNull);
    expect(data.embedding).not.toBeNull();
    // The snapshot goes with it: a model name with no vector under it is a claim
    // about a row that no longer holds one.
    expect(data.embeddingModel).toBeNull();
  });

  it('never touches `provisional`, because confirm is the decision and rename is not', async () => {
    // A rename that also confirmed would perform a judgement nobody made.
    const update = vi.fn().mockResolvedValue(row());
    const { tx } = txStub({ findUnique: vi.fn().mockResolvedValue({ id: 'topic-1' }), update });
    const { service } = serviceWith();

    await service.rename(tx, 'topic-1', 'Fractions of a Whole');

    expect(Object.keys(update.mock.calls[0]![0].data).sort()).toEqual([
      'embedding',
      'embeddingModel',
      'matchKey',
      'name',
    ]);
  });

  it('bounds the new name exactly as a minted one, and trims after the cut', async () => {
    // Two paths to a `topic.name` with two different bounds is how a match key
    // outgrows the btree index it sits in.
    const update = vi.fn().mockResolvedValue(row());
    const { tx } = txStub({ findUnique: vi.fn().mockResolvedValue({ id: 'topic-1' }), update });
    const { service } = serviceWith();

    await service.rename(tx, 'topic-1', `  ${'a'.repeat(MAX_TOPIC_LABEL_LENGTH + 50)}  `);

    expect(update.mock.calls[0]![0].data.name).toHaveLength(MAX_TOPIC_LABEL_LENGTH);
  });

  it('refuses a name that is blank once trimmed, before reading anything', async () => {
    const findUnique = vi.fn();
    const { tx } = txStub({ findUnique });
    const { service } = serviceWith();

    await expect(service.rename(tx, 'topic-1', '   ')).rejects.toBeInstanceOf(TopicInputError);
    await expect(service.rename(tx, 'topic-1', '   ')).rejects.toThrow(TOPIC_LABEL_REQUIRED);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('surfaces a taken key as a named conflict rather than a raw client fault', async () => {
    // The deliberate answer to "that name is already in use" is a merge, which is an
    // operator's decision — so this has to arrive as a refusal a surface can map,
    // not as a 500.
    const { tx } = txStub({
      findUnique: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      update: vi.fn().mockRejectedValue(uniqueViolation()),
    });
    const { service } = serviceWith();

    await expect(service.rename(tx, 'topic-1', 'Fractions')).rejects.toBeInstanceOf(
      TopicNameConflictError,
    );
  });

  it('answers null for an id with no row, and writes nothing', async () => {
    const update = vi.fn();
    const { tx } = txStub({ findUnique: vi.fn().mockResolvedValue(null), update });
    const { service } = serviceWith();

    await expect(service.rename(tx, 'gone', 'Anything')).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('confirming a canonical Topic', () => {
  it('flips `provisional` and nothing else', async () => {
    const update = vi.fn().mockResolvedValue(row({ provisional: false }));
    const { tx } = txStub({ findUnique: vi.fn().mockResolvedValue(row()), update });
    const { service } = serviceWith();

    const confirmed = await service.confirm(tx, 'topic-1');

    expect(update.mock.calls[0]![0].data).toEqual({ provisional: false });
    expect(confirmed).toEqual({
      topicId: 'topic-1',
      name: 'Fractions',
      subjectId: 'subject-1',
      subjectName: 'Mathematics',
      provisional: false,
    });
  });

  it('is idempotent by issuing no UPDATE at all on an already-confirmed row', async () => {
    // "Returned unchanged" is a fact about the row and not only about the columns the
    // caller looked at: a redundant `UPDATE` would still move `updatedAt`.
    const update = vi.fn();
    const { tx } = txStub({
      findUnique: vi.fn().mockResolvedValue(row({ provisional: false })),
      update,
    });
    const { service } = serviceWith();

    const confirmed = await service.confirm(tx, 'topic-1');

    expect(update).not.toHaveBeenCalled();
    expect(confirmed).toMatchObject({ topicId: 'topic-1', provisional: false });
  });

  it('answers null for an id with no row, and writes nothing', async () => {
    const update = vi.fn();
    const { tx } = txStub({ findUnique: vi.fn().mockResolvedValue(null), update });
    const { service } = serviceWith();

    await expect(service.confirm(tx, 'gone')).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('removing the Topic a merge folded away', () => {
  it('deletes by id and reads nothing first', async () => {
    // The orchestrator has already resolved this row and its Subject on this very
    // `tx`; a second read here would be a second answer to a settled question.
    const del = vi.fn().mockResolvedValue(row());
    const findUnique = vi.fn();
    const { tx } = txStub({ delete: del, findUnique });
    const { service } = serviceWith();

    await service.removeMerged(tx, 'topic-1');

    expect(del).toHaveBeenCalledWith({ where: { id: 'topic-1' } });
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('the curation reads', () => {
  it('orders the provisional queue oldest first, with the id breaking the tie', async () => {
    // Two Topics minted by one hand-in tie on a TIMESTAMP(3) column, and on a tie the
    // order is Postgres's choice — a queue that reordered itself between two reads is
    // one an operator loses their place in.
    const findMany = vi.fn().mockResolvedValue([row()]);
    const { service } = serviceWith({ findMany });

    const queue = await service.listProvisional();

    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { provisional: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(queue[0]).toMatchObject({ topicId: 'topic-1', createdAt: row().createdAt });
  });

  it('offers a Subject’s whole canonical set as merge targets, not only the provisional part', async () => {
    // The ordinary merge folds a provisional near-duplicate into the confirmed Topic
    // it should have matched, so a provisional-only list would hide every good target.
    const findMany = vi.fn().mockResolvedValue([row({ provisional: false })]);
    const { service } = serviceWith({ findMany });

    const set = await service.listForSubject('subject-1');

    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { subjectId: 'subject-1' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    expect(set[0]!.provisional).toBe(false);
  });

  it('never selects the match key or the cached vector into an answer', async () => {
    // Stage 1's key and stage 2's vector are the cascade's internals. A reader that
    // carried either would be a second matching path waiting to be written (AD-20).
    const findMany = vi.fn().mockResolvedValue([]);
    const { service } = serviceWith({ findMany });

    await service.listProvisional();
    await service.listForSubject('subject-1');

    for (const call of findMany.mock.calls) {
      const select = call[0].select as Record<string, unknown>;
      expect(select.matchKey).toBeUndefined();
      expect(select.embedding).toBeUndefined();
      expect(select.embeddingModel).toBeUndefined();
    }
  });
});

describe('what curation is not', () => {
  it('reaches no cascade stage: no embed call and no structured-output call', async () => {
    // Curation is downstream of matching and is never a second matching path (AD-11).
    // A `normalize` sneaking in here would put a provider call inside the transaction
    // a merge holds locks in.
    const { tx } = txStub({
      findUnique: vi.fn().mockResolvedValue(row()),
      update: vi.fn().mockResolvedValue(row()),
      delete: vi.fn().mockResolvedValue(row()),
    });
    const findMany = vi.fn().mockResolvedValue([]);
    const { service, run, embed } = serviceWith({ findMany });

    await service.listProvisional();
    await service.listForSubject('subject-1');
    await service.confirm(tx, 'topic-1');
    await service.rename(tx, 'topic-1', 'Fractions');
    await service.removeMerged(tx, 'topic-1');

    expect(run).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });
});
