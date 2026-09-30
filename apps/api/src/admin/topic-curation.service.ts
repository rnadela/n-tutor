import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GradingService } from '../grading/grading.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TopicInputError, TopicNameConflictError } from '../topics/topic-policy.js';
import { TopicService } from '../topics/topic.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { TaxonomyService } from './taxonomy.service.js';

/** The Topic named in the path, or named as a merge target, has no row. */
const TOPIC_NOT_FOUND = 'Topic not found.';

/**
 * A Topic cannot be merged into itself.
 *
 * Refused before the transaction opens, because it is a fact about the request and
 * not about any row. Allowing it would re-point every tag onto the Topic it is
 * already on and then delete that Topic, taking the tags with it under the cascade —
 * a whole concept's history lost to one mis-selected row in a dropdown.
 */
const MERGE_INTO_ITSELF = 'A topic cannot be merged into itself.';

/**
 * A merge whose two Topics belong to different Subjects.
 *
 * The canonical set is per Subject (AD-11), so a cross-Subject merge is not a
 * curation decision an operator can make — it would move one Subject's Mastery
 * history under another's dashboard, where nothing would ever reconcile it. 400 and
 * not 404: both rows exist, and the pairing is what is wrong.
 */
const CROSS_SUBJECT_MERGE = 'Two topics of different subjects cannot be merged.';

/** One provisional Topic awaiting judgement, as the queue states it. */
export interface ProvisionalTopicEntry {
  topicId: string;
  name: string;
  subjectId: string;
  subjectName: string;
  /** ISO-8601. The queue's order, oldest first. */
  createdAt: string;
  /** How many Questions carry this Topic — a merge's blast radius, stated up front. */
  taggedQuestionCount: number;
}

/** One member of a Subject's canonical set, as the merge-target list states it. */
export interface CanonicalTopicEntry {
  topicId: string;
  name: string;
  subjectId: string;
  subjectName: string;
  provisional: boolean;
}

/** What a merge came to. Counts and ids only. */
export interface TopicMergeResult {
  mergedTopicId: string;
  targetTopicId: string;
  /** Tags moved onto the survivor. Tags whose Question already carried it are not here. */
  repointed: number;
  /** How many Student Profiles had their Mastery recomputed in the same transaction. */
  profilesRecomputed: number;
}

/**
 * Topic curation: confirm, rename and merge, orchestrated and never performed here.
 *
 * **Why this lives in `admin` and not in `topics`.** A merge writes three tables
 * owned by two modules, and `grading -> topics` already exists — so putting the
 * orchestration in `topics` would need `topics -> grading` and close the cycle.
 * `admin` is imported by nothing but `app.module.ts`, which makes it the only place
 * both arrows can point out of. It holds **no Prisma delegate** of `Topic`,
 * `QuestionTopic` or `TopicMastery`: it holds the transaction and calls the two
 * owners, exactly as it already reaches `explanation` for the flagged queue.
 *
 * **Every action is one transaction, and the audit row is inside it** (AD-10,
 * AD-25). For a merge that is the whole claim: re-pointing the tags and recomputing
 * the survivor's Mastery are one commit, so no reader can ever see moved tags beside
 * stale figures, and a failure part-way leaves the canonical set exactly as it was.
 *
 * **A merge reuses `GradingService.recomputeMastery` unchanged** (AD-12). There is
 * no second window definition here, no second formula and no recompute job — this
 * service decides *whose* Mastery to recompute and asks the one path to do it.
 *
 * **No `ai` call of any kind.** Curation is downstream of the AD-11 cascade and is
 * never a second matching path: nothing here normalizes, embeds or resolves. A
 * rename re-derives the match key through `topicMatchKey` inside `topics`, which is
 * arithmetic on a string.
 */
@Injectable()
export class TopicCurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topics: TopicService,
    private readonly grading: GradingService,
    private readonly taxonomy: TaxonomyService,
    private readonly audit: AdminAuditService,
  ) {}

  // --- Reads -------------------------------------------------------------

  /**
   * The queue: every provisional Topic across every Subject, oldest first, each with
   * how many Questions carry it.
   *
   * Two reads and no more, each from the module that owns the table: the Topics from
   * `topics`, the counts from `grading`. A count per row would be N round trips
   * behind one screen.
   *
   * Read-only, so no audit row — nothing was decided by looking.
   */
  async listProvisional(): Promise<ProvisionalTopicEntry[]> {
    const topics = await this.topics.listProvisional();
    if (topics.length === 0) return [];
    const counts = await this.grading.topicTagCounts(topics.map((topic) => topic.topicId));
    return topics.map((topic) => ({
      topicId: topic.topicId,
      name: topic.name,
      subjectId: topic.subjectId,
      subjectName: topic.subjectName,
      createdAt: topic.createdAt.toISOString(),
      // Absent from the map is a Topic nothing is tagged with, which is zero.
      taggedQuestionCount: counts.get(topic.topicId) ?? 0,
    }));
  }

  /**
   * One Subject's whole canonical set: the merge targets an operator may choose from.
   *
   * **The Subject is resolved first**, through the taxonomy's own reader, so an
   * unknown Subject is a 404 rather than an empty list. The two answers are not the
   * same thing: an empty canonical set is a Subject nothing has been generated for
   * yet, and a screen that could not tell them apart would offer an operator no
   * targets and no reason.
   */
  async listForSubject(subjectId: string): Promise<CanonicalTopicEntry[]> {
    // Throws NotFoundException for an unknown id.
    await this.taxonomy.resolveSubject(subjectId);
    const topics = await this.topics.listForSubject(subjectId);
    return topics.map((topic) => ({
      topicId: topic.topicId,
      name: topic.name,
      subjectId: topic.subjectId,
      subjectName: topic.subjectName,
      provisional: topic.provisional,
    }));
  }

  // --- Writes ------------------------------------------------------------

  /**
   * Confirms one provisional Topic as it stands.
   *
   * Nothing but the flag moves: not the name, not the key, not the cached vector, and
   * not one `TopicMastery` row. A second confirm on an already-confirmed Topic writes
   * no `UPDATE` and is still audited — a redundant action an operator took is still
   * an action an operator took, and an audit trail that dropped it would make the
   * record disagree with the request log.
   */
  async confirm(actorId: string, topicId: string): Promise<CanonicalTopicEntry> {
    return this.prisma.withTransaction(async (tx) => {
      const topic = await this.topics.confirm(tx, topicId);
      if (topic === null) throw new NotFoundException(TOPIC_NOT_FOUND);

      await this.audit.record(tx, actorId, 'topic.confirm', 'Topic', topicId, {
        subjectId: topic.subjectId,
        name: topic.name,
      });
      return {
        topicId: topic.topicId,
        name: topic.name,
        subjectId: topic.subjectId,
        subjectName: topic.subjectName,
        provisional: topic.provisional,
      };
    });
  }

  /**
   * Renames one Topic, re-deriving its match key and clearing its cached vector.
   *
   * `provisional` is deliberately untouched, and no Mastery row is read or written:
   * a Topic's spelling has no bearing on what a child has shown.
   *
   * **The two refusals `topics` raises are mapped here and not thrown there**,
   * because `topics` has no route of its own: a name that is blank once trimmed is a
   * 400, and a new key already taken by another Topic of that Subject is a 409. The
   * second is not a fault to retry — the operator asked for a spelling that is
   * already in use, and the deliberate answer is a merge.
   */
  async rename(actorId: string, topicId: string, name: string): Promise<CanonicalTopicEntry> {
    return this.prisma.withTransaction(async (tx) => {
      const before = await this.topics.describeWithin(tx, [topicId]);
      const previous = before.get(topicId);
      if (previous === undefined) throw new NotFoundException(TOPIC_NOT_FOUND);

      let topic;
      try {
        topic = await this.topics.rename(tx, topicId, name);
      } catch (cause) {
        if (cause instanceof TopicNameConflictError) throw new ConflictException(cause.message);
        if (cause instanceof TopicInputError) throw new BadRequestException(cause.message);
        throw cause;
      }
      if (topic === null) throw new NotFoundException(TOPIC_NOT_FOUND);

      await this.audit.record(tx, actorId, 'topic.rename', 'Topic', topicId, {
        subjectId: topic.subjectId,
        from: previous.name,
        to: topic.name,
      });
      return {
        topicId: topic.topicId,
        name: topic.name,
        subjectId: topic.subjectId,
        subjectName: topic.subjectName,
        provisional: topic.provisional,
      };
    });
  }

  /**
   * Folds one Topic into another of the same Subject.
   *
   * **The order inside the transaction is the contract, not a preference:**
   *
   * 1. `repointTopicTags` — read the merged Topic's tags and the profiles they can
   *    have moved, delete the tags whose Question already carries the target,
   *    re-point the rest. The profile set is read *here*, before anything is deleted,
   *    because the merged Topic's own Mastery rows disappear with its row.
   * 2. `topics.removeMerged` — delete the `Topic` row, now that nothing points at it.
   *    Doing this first would take every tag with it under `onDelete: Cascade`, which
   *    is a history deleted rather than moved.
   * 3. `recomputeMastery(tx, profile, [target])` per affected profile — the one
   *    recompute path (AD-12), over the survivor, on this same `tx`.
   * 4. The audit row, on this same `tx`.
   *
   * All four commit or roll back together (AD-10), so a failure part-way leaves the
   * tags, the `Topic` row and every Mastery row exactly as they were.
   *
   * **Both refusals are decided before a single row is written.** A merge into itself
   * never reaches the database at all; a cross-Subject merge is refused on the two
   * Topics read inside the transaction, so it cannot be admitted on a stale snapshot.
   */
  async merge(actorId: string, topicId: string, targetTopicId: string): Promise<TopicMergeResult> {
    // A fact about the request rather than about any row, so it is answered without
    // opening a transaction.
    if (topicId === targetTopicId) throw new BadRequestException(MERGE_INTO_ITSELF);

    return this.prisma.withTransaction(async (tx) => {
      const described = await this.topics.describeWithin(tx, [topicId, targetTopicId]);
      const merged = described.get(topicId);
      const target = described.get(targetTopicId);
      if (merged === undefined || target === undefined) {
        throw new NotFoundException(TOPIC_NOT_FOUND);
      }
      if (merged.subjectId !== target.subjectId) {
        throw new BadRequestException(CROSS_SUBJECT_MERGE);
      }

      const { repointed, affectedProfileIds } = await this.grading.repointTopicTags(
        tx,
        topicId,
        targetTopicId,
      );
      await this.topics.removeMerged(tx, topicId);

      // Sequential and not `Promise.all`: these share one transaction, and one
      // connection cannot run them at once. The survivor alone is recomputed — the
      // merged Topic no longer exists, and its rows went with it.
      for (const studentProfileId of affectedProfileIds) {
        await this.grading.recomputeMastery(tx, studentProfileId, [targetTopicId]);
      }

      await this.audit.record(tx, actorId, 'topic.merge', 'Topic', topicId, {
        targetTopicId,
        subjectId: merged.subjectId,
        mergedName: merged.name,
        targetName: target.name,
        repointed,
        profilesRecomputed: affectedProfileIds.length,
      });

      return {
        mergedTopicId: topicId,
        targetTopicId,
        repointed,
        profilesRecomputed: affectedProfileIds.length,
      };
    });
  }
}
