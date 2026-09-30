import { describe, expect, it, vi } from 'vitest';
import type { AiService } from '../ai/ai.service.js';
import type { PracticeTestService } from '../practicetest/practice-test.service.js';
import type { PrismaService, TransactionClient } from '../prisma/prisma.service.js';
import type { TopicService } from '../topics/topic.service.js';
import { GradingService } from './grading.service.js';

/**
 * `repointTopicTags` — the two rules that decide whether a merge is lossless.
 *
 * **The collision partition.** `question_topic` is unique on `(questionId, topicId)`,
 * so a Question tagged with both Topics — the ordinary case for two spellings of one
 * concept on one paper — makes a blanket `updateMany` a constraint violation. The
 * colliding tags are deleted and the rest re-pointed, and the order matters: moving
 * first would put a row onto a pair a colliding row still occupies.
 *
 * **The affected-profile union.** Profiles come from the touched Practice Tests *and*
 * from every profile already holding a row on either Topic. Drop the first half and a
 * child whose window Questions were all `Ungraded` — no stored row to be found by —
 * keeps a stale figure. Drop the second and a row that outlived its evidence is never
 * revisited, while the merged Topic's is cascaded away beneath it.
 *
 * Asserted against a stubbed client because both rules are about *which statements are
 * issued with which arguments*, which a passing integration test can satisfy by
 * accident. `test/topic-curation.int-spec.ts` proves the resulting rows against real
 * Postgres, where the unique index is real.
 */

interface Tag {
  id: string;
  questionId: string;
  practiceTestId: string;
}

function serviceWith(options: {
  tags: Tag[];
  /** Questions of the target Topic that already carry it. */
  targetQuestionIds?: string[];
  /** Profiles holding a `TopicMastery` row on either Topic. */
  heldProfileIds?: string[];
  /** Profiles with a submitted Attempt at the touched Practice Tests. */
  attemptProfileIds?: string[];
}) {
  const findMany = vi
    .fn()
    // First call: the merged Topic's tags.
    .mockResolvedValueOnce(options.tags)
    // Second call: the target Topic's tags on the Questions in play.
    .mockResolvedValueOnce((options.targetQuestionIds ?? []).map((questionId) => ({ questionId })));
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  const masteryFindMany = vi
    .fn()
    .mockResolvedValue(
      (options.heldProfileIds ?? []).map((studentProfileId) => ({ studentProfileId })),
    );

  const tx = {
    questionTopic: { findMany, deleteMany, updateMany },
    topicMastery: { findMany: masteryFindMany },
  } as unknown as TransactionClient;

  const profilesWithSubmittedAttemptsOn = vi
    .fn()
    .mockResolvedValue(options.attemptProfileIds ?? []);
  const practiceTests = { profilesWithSubmittedAttemptsOn } as unknown as PracticeTestService;

  const service = new GradingService(
    {} as unknown as PrismaService,
    practiceTests,
    {} as unknown as AiService,
    {} as unknown as TopicService,
  );

  return {
    service,
    tx,
    findMany,
    deleteMany,
    updateMany,
    masteryFindMany,
    profilesWithSubmittedAttemptsOn,
  };
}

describe('the collision partition', () => {
  it('deletes the tag whose Question already carries the target and re-points the rest', async () => {
    const { service, tx, deleteMany, updateMany } = serviceWith({
      tags: [
        { id: 'tag-a', questionId: 'q-1', practiceTestId: 'pt-1' },
        { id: 'tag-b', questionId: 'q-2', practiceTestId: 'pt-1' },
      ],
      targetQuestionIds: ['q-1'],
    });

    const result = await service.repointTopicTags(tx, 'from', 'to');

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['tag-a'] } } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tag-b'] } },
      data: { topicId: 'to' },
    });
    // The count names what *moved*. A deleted collision is not a re-point, and an
    // audit row that counted it would overstate what the merge did.
    expect(result.repointed).toBe(1);
  });

  it('deletes before it re-points, so no move lands on a pair still occupied', async () => {
    const order: string[] = [];
    const { service, tx, deleteMany, updateMany } = serviceWith({
      tags: [
        { id: 'tag-a', questionId: 'q-1', practiceTestId: 'pt-1' },
        { id: 'tag-b', questionId: 'q-2', practiceTestId: 'pt-1' },
      ],
      targetQuestionIds: ['q-1'],
    });
    deleteMany.mockImplementation(async () => {
      order.push('delete');
      return { count: 1 };
    });
    updateMany.mockImplementation(async () => {
      order.push('update');
      return { count: 1 };
    });

    await service.repointTopicTags(tx, 'from', 'to');

    expect(order).toEqual(['delete', 'update']);
  });

  it('issues no statement for a partition half that is empty', async () => {
    // Nothing collides, so nothing is deleted — a `deleteMany` with an empty `in` is
    // a round trip inside a transaction that buys nothing.
    const { service, tx, deleteMany, updateMany } = serviceWith({
      tags: [{ id: 'tag-a', questionId: 'q-1', practiceTestId: 'pt-1' }],
      targetQuestionIds: [],
    });

    await service.repointTopicTags(tx, 'from', 'to');

    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('re-points nothing for a Topic with no tags, and never asks about the target', async () => {
    const { service, tx, findMany, deleteMany, updateMany } = serviceWith({ tags: [] });

    const result = await service.repointTopicTags(tx, 'from', 'to');

    expect(result.repointed).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    // One tag read only: there are no Questions in play to ask the target about.
    expect(findMany).toHaveBeenCalledOnce();
  });
});

describe('the affected-profile union', () => {
  it('takes the profiles of the touched Practice Tests and of the rows on either Topic', async () => {
    const { service, tx, masteryFindMany, profilesWithSubmittedAttemptsOn } = serviceWith({
      tags: [
        { id: 'tag-a', questionId: 'q-1', practiceTestId: 'pt-1' },
        { id: 'tag-b', questionId: 'q-2', practiceTestId: 'pt-2' },
        { id: 'tag-c', questionId: 'q-3', practiceTestId: 'pt-1' },
      ],
      attemptProfileIds: ['child-1', 'child-2'],
      heldProfileIds: ['child-2', 'child-3'],
    });

    const result = await service.repointTopicTags(tx, 'from', 'to');

    // Every Practice Test the tags sat on, deduped — the read is asked once, not once
    // per tag.
    expect(profilesWithSubmittedAttemptsOn).toHaveBeenCalledWith(tx, ['pt-1', 'pt-2']);
    // Both Topics: the merged one's rows are about to be cascaded away, and the
    // survivor's are about to become wrong.
    expect(masteryFindMany.mock.calls[0]![0]).toMatchObject({
      where: { topicId: { in: ['from', 'to'] } },
      distinct: ['studentProfileId'],
    });
    expect([...result.affectedProfileIds].sort()).toEqual(['child-1', 'child-2', 'child-3']);
  });

  it('names a profile once however many ways it qualifies', async () => {
    // Recomputing a profile twice in one transaction is harmless and wasteful; the
    // duplicate would also overstate the count the audit row carries.
    const { service, tx } = serviceWith({
      tags: [{ id: 'tag-a', questionId: 'q-1', practiceTestId: 'pt-1' }],
      attemptProfileIds: ['child-1'],
      heldProfileIds: ['child-1'],
    });

    const result = await service.repointTopicTags(tx, 'from', 'to');

    expect(result.affectedProfileIds).toEqual(['child-1']);
  });

  it('still finds the profiles of a Topic with no tags left to move', async () => {
    // A stored row can outlive the evidence behind it. Without this half, such a row
    // on the survivor is never revisited and the merged Topic's vanishes unrecorded.
    const { service, tx } = serviceWith({ tags: [], heldProfileIds: ['child-9'] });

    const result = await service.repointTopicTags(tx, 'from', 'to');

    expect(result).toEqual({ repointed: 0, affectedProfileIds: ['child-9'] });
  });

  it('reads the Mastery rows before it deletes anything', async () => {
    // The merged Topic's rows disappear under `onDelete: Cascade` the moment the
    // caller removes its row, so a read after the fact would find nothing.
    const order: string[] = [];
    const { service, tx, masteryFindMany, deleteMany } = serviceWith({
      tags: [{ id: 'tag-a', questionId: 'q-1', practiceTestId: 'pt-1' }],
      targetQuestionIds: ['q-1'],
    });
    masteryFindMany.mockImplementation(async () => {
      order.push('read-mastery');
      return [];
    });
    deleteMany.mockImplementation(async () => {
      order.push('delete');
      return { count: 1 };
    });

    await service.repointTopicTags(tx, 'from', 'to');

    expect(order).toEqual(['read-mastery', 'delete']);
  });
});

describe('what the repoint is not', () => {
  it('writes no Topic row and recomputes nothing itself', async () => {
    // `Topic` is `topics`' table (AD-17), and Mastery has one recompute path (AD-12).
    // This method moves tags and reports who was affected; the caller does the rest.
    const { service, tx } = serviceWith({
      tags: [{ id: 'tag-a', questionId: 'q-1', practiceTestId: 'pt-1' }],
    });
    const recompute = vi.spyOn(service, 'recomputeMastery');

    await service.repointTopicTags(tx, 'from', 'to');

    expect(recompute).not.toHaveBeenCalled();
    // The stub carries no `topic` delegate at all, so reaching for one would have
    // thrown rather than passed.
    expect((tx as unknown as Record<string, unknown>).topic).toBeUndefined();
  });
});

/**
 * `topicTagCounts` — the figure the curation queue states a merge's blast radius with.
 *
 * Its own spec, because the queue is what an operator decides from: a Topic reported
 * as carrying nothing is one they will fold away without a second thought, and a count
 * that came back per-row rather than in one `groupBy` would be N round trips behind one
 * screen. Neither is observable through `repointTopicTags`, which never calls it.
 */
function serviceCounting(rows: { topicId: string; count: number }[]) {
  const groupBy = vi
    .fn()
    .mockResolvedValue(rows.map((row) => ({ topicId: row.topicId, _count: { _all: row.count } })));
  const prisma = { questionTopic: { groupBy } } as unknown as PrismaService;
  const service = new GradingService(
    prisma,
    {} as unknown as PracticeTestService,
    {} as unknown as AiService,
    {} as unknown as TopicService,
  );
  return { service, groupBy };
}

describe('the tagged-Question counts', () => {
  it('asks once for the whole set, and answers a count per Topic', async () => {
    const { service, groupBy } = serviceCounting([
      { topicId: 'topic-a', count: 7 },
      { topicId: 'topic-b', count: 2 },
    ]);

    const counts = await service.topicTagCounts(['topic-a', 'topic-b']);

    expect(counts).toEqual(
      new Map([
        ['topic-a', 7],
        ['topic-b', 2],
      ]),
    );
    // One statement for the list, never one per row.
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['topicId'],
      where: { topicId: { in: ['topic-a', 'topic-b'] } },
      _count: { _all: true },
    });
  });

  it('leaves a Topic nothing is tagged with absent, which its caller reads as zero', async () => {
    // `groupBy` has no row to return for a Topic with no tags, and inventing a zero here
    // would be this method claiming a fact the database did not state.
    const { service } = serviceCounting([{ topicId: 'topic-a', count: 1 }]);

    const counts = await service.topicTagCounts(['topic-a', 'topic-untagged']);

    expect(counts.get('topic-untagged')).toBeUndefined();
    expect(counts.size).toBe(1);
  });

  it('asks about each Topic once however many times it is named', async () => {
    const { service, groupBy } = serviceCounting([{ topicId: 'topic-a', count: 1 }]);

    await service.topicTagCounts(['topic-a', 'topic-a', 'topic-b', 'topic-a']);

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { topicId: { in: ['topic-a', 'topic-b'] } } }),
    );
  });

  it('never reaches the database for an empty set', async () => {
    const { service, groupBy } = serviceCounting([]);

    expect(await service.topicTagCounts([])).toEqual(new Map());
    expect(groupBy).not.toHaveBeenCalled();
  });
});
