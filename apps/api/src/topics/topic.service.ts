import { Injectable, Logger } from '@nestjs/common';
import { AiInputError, AiRejectedError, AiService, AiUpstreamError } from '../ai/ai.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import { topicMatchKey } from './topic-match-key.js';
import {
  MAX_TOPIC_LABEL_LENGTH,
  TOPIC_CANDIDATE_LIMIT,
  TOPIC_LABEL_REQUIRED,
  TOPIC_NAME_TAKEN,
  TOPIC_SIMILARITY_THRESHOLD,
  TOPIC_SUBJECT_UNKNOWN,
  TopicInputError,
  TopicNameConflictError,
} from './topic-policy.js';
import { buildTopicResolutionPrompt } from './topic-resolution-prompt.js';
import {
  TOPIC_NONE_FIT,
  TOPIC_RESOLUTION_SCHEMA_NAME,
  TopicResolutionPayload,
  type TopicCandidate,
  fakeTopicResolutionPayload,
} from './topic-resolution-schema.js';
import { bestTopicMatch, cosine, type TopicCandidateVector } from './topic-similarity.js';

/** One candidate as the cascade reads it: the stage-3 fields plus its vector. */
interface CandidateRow extends TopicCandidate {
  embedding: Prisma.JsonValue | null;
  embeddingModel: string | null;
  /** Read only to order the stage-3 candidate list; never returned to a caller. */
  createdAt: Date;
}

/** One label as `normalize` is asked about it. */
export interface TopicNormalizeRequest {
  /** The free-form label generation emitted. Never blank. */
  label: string;
  /** The Subject whose canonical set this is resolved against. */
  subjectId: string;
  /** Whose cost row any provider call lands on. */
  parentAccountId: string;
}

/** A label vector and the snapshot it came from, or the absence of one. */
type LabelVector = { vector: number[]; model: string } | null;

/**
 * What one canonical Topic is called, and which Subject's set it belongs to.
 *
 * The name is the row's stored spelling and never a re-derivation of it: a Topic's
 * name is the first label that arrived, and a dashboard that recomputed one would
 * relabel itself the day the match key changed. No `matchKey`, no embedding and no
 * counts — this is a name, not the Topic.
 */
export interface TopicDescription {
  topicId: string;
  name: string;
  subjectId: string;
  subjectName: string;
  /** Whether the cascade minted it rather than a human confirming it (Story 7.6). */
  provisional: boolean;
}

/**
 * One provisional Topic as the curation queue reads it: a description plus the
 * instant it was minted.
 *
 * `createdAt` is here and nowhere else in this module's reads, because it is the
 * queue's **order** rather than a fact about the concept — the oldest unreviewed
 * Topic is the one that has had the longest to accumulate near-duplicates behind
 * it. Still no `matchKey`, no embedding and no count: the key is stage 1's, the
 * vector is stage 2's, and a tagged-Question count is `grading`'s to state (AD-17).
 */
export interface ProvisionalTopic extends TopicDescription {
  createdAt: Date;
}

/**
 * The `topics` module: sole owner and sole writer of `Topic` (AD-17), and the one
 * implementation of the AD-11 canonicalization cascade.
 *
 * **There is exactly one way in to the cascade.** `normalize` is the whole of it,
 * and the three stages, the threshold, the vectors and the prompt are all private
 * behind it. That is the point of the design rather than a tidiness preference: a
 * second entry point — "just the exact match, please", "give me the candidates" —
 * is a second matching path, and the moment two callers canonicalize differently
 * the Mastery history fragments in a way no read can detect. The only thing a
 * caller may know is that a label maps to a Topic id.
 *
 * **`describe` is the one other public method, and it is not a second way in.**
 * Story 7.4's dashboard has to print a Topic's name beside its Mastery figure, and
 * `Topic` is this module's table (AD-17) — so the id-to-name read lives here rather
 * than in a surface reaching for the delegate. It matches nothing, mints nothing
 * and reaches no stage: it answers "what is this id called", which is a question
 * canonicalization has already finished asking.
 *
 * **It reads `Subject` read-only** and writes nothing but `topic`. It never
 * touches `practice_test_question_topic`: generation keeps emitting whatever it
 * emits, and this module is downstream of that, not a constraint on it.
 *
 * **It must be called before a transaction opens, never inside one.** `normalize`
 * makes provider calls, which can take seconds and can be retried; an open
 * transaction around one is a row lock held for the length of an outage. AD-10
 * governs Mastery recompute, not canonicalization: Story 7.2 resolves its Topic
 * ids first and then opens its transaction.
 */
@Injectable()
export class TopicService {
  private readonly logger = new Logger(TopicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /**
   * The canonical Topic id for one emitted label, within one Subject.
   *
   * The AD-11 cascade, cheapest stage first, and each stage only runs because the
   * one before it declined:
   *
   * 1. **Exact match** on the normalized key. No provider call at all, which is
   *    the case the overwhelming majority of labels land in once a Subject has
   *    been taught for a term.
   * 2. **Cached-embedding cosine** at or above `TOPIC_SIMILARITY_THRESHOLD`,
   *    computed in application code over the Subject's candidates. One embed call.
   * 3. **One `TopicNormalization` structured-output call** over the candidate
   *    list. The only stage that may mint, and the only stage that may conclude
   *    that none of the candidates fit.
   *
   * `parentAccountId` is whose cost row the provider calls land on, exactly as on
   * every other call in the system. It has no bearing on which Topic is returned:
   * the canonical set is the Subject's and is shared across every account, because
   * a per-account canonical set would be a per-account dashboard that could never
   * be compared with anything.
   *
   * **One object argument rather than three positional strings.** All three are
   * strings, so `normalize(subjectId, label, accountId)` type-checks perfectly and
   * fails at runtime with an unknown Subject — or, worse, mints a Topic named after
   * a uuid. The named form is the same shape `ai.run` and `ai.embed` already take.
   *
   * Returns an id and nothing else. Not the name, not whether it was minted, not
   * which stage answered — a caller that could read the stage would eventually
   * branch on it.
   */
  async normalize(request: TopicNormalizeRequest): Promise<string> {
    const { subjectId, parentAccountId } = request;
    // Both refusals happen before a single provider call: neither is a fact a
    // model could help with, and both are standing facts about the request.
    if (request.label.trim() === '') throw new TopicInputError(TOPIC_LABEL_REQUIRED);
    // Shortened once, here, so the name, the key, the embedded text and every later
    // prompt are all the same string. Shortening at any one of those four sites
    // would leave the others carrying the full label, and the key and the name would
    // stop agreeing about what this Topic is.
    const name = boundedLabel(request.label);
    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
      select: { id: true },
    });
    if (subject === null) throw new TopicInputError(TOPIC_SUBJECT_UNKNOWN);

    const matchKey = topicMatchKey(name);

    // --- Stage 1: the exact key ------------------------------------------
    const exact = await this.prisma.topic.findUnique({
      where: { subjectId_matchKey: { subjectId, matchKey } },
      select: { id: true },
    });
    if (exact !== null) return exact.id;

    // **Every canonical Topic of the Subject, uncapped.** The cap belongs to the
    // stage-3 prompt and to nothing else: the cosine is a dot product computed in
    // this process, so there is no cost to comparing against the whole set — and a
    // cap here would make every Topic past the cap invisible to matching, so
    // near-duplicates of them would mint without bound. That is precisely the
    // fragmentation this module exists to prevent, arriving silently the day a
    // Subject grows past the limit.
    //
    // `id` breaks the tie on `createdAt`, which is `TIMESTAMP(3)` and therefore can
    // and does tie for rows written in the same millisecond. Without it the order
    // is Postgres's choice and two identical normalizes can answer differently.
    const candidates: CandidateRow[] = await this.prisma.topic.findMany({
      where: { subjectId },
      select: { id: true, name: true, embedding: true, embeddingModel: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (candidates.length === 0) {
      // **The one exception to "only stage 3 may conclude that nothing fits", and
      // it is an exception only in appearance.** With an empty canonical set there
      // are no candidates to offer, so the answer is forced: a call would send a
      // list of nothing and be asked to pick from it. Nothing is being decided
      // here that a model could decide differently, so the Topic is minted with no
      // embed call and no stage-3 call. Every other "none of these fit" in this
      // file is stage 3's own verdict.
      return this.mint(subjectId, name, matchKey, null);
    }

    // --- Stage 2: cached-embedding cosine --------------------------------
    // **Comparability is checked before the embedding is bought, not after.** A
    // Subject whose every Topic was minted vectorless, or whose vectors were all
    // left stale by a re-pin, has nothing for a fresh vector to be compared with —
    // so embedding the label would be a paid call with no possible outcome. The
    // model in force is read from the seam rather than guessed, and re-read from the
    // answer afterwards, so a re-pin mid-flight is resolved by what was actually
    // sent.
    const embedded: LabelVector =
      this.comparableVectors(candidates, this.ai.embeddingModel).length > 0
        ? await this.embedLabel(name, parentAccountId)
        : null;
    if (embedded !== null) {
      const comparable = this.comparableVectors(candidates, embedded.model);
      const best = bestTopicMatch(embedded.vector, comparable, TOPIC_SIMILARITY_THRESHOLD);
      // Returned as it is: matching an existing Topic never rewrites its name and
      // never clears its `provisional` flag. A provisional Topic that turns out to
      // be the right answer four more times is still unconfirmed, and the first
      // spelling that arrived is no worse a name than the fifth.
      if (best !== null) return best.id;
    }

    // --- Stage 3: one structured-output call ------------------------------
    const offered = this.offer(candidates, embedded);
    const chosen = await this.resolve(name, offered, parentAccountId);
    if (chosen !== null) {
      await this.cacheVectorFor(chosen, candidates, parentAccountId);
      return chosen;
    }

    // A minted Topic carries a cached vector, so the next near-duplicate of it can
    // be settled by stage 2 instead of by another stage-3 call. When stage 2 was
    // skipped or failed there is no vector yet, and it is bought here: the call is
    // already committed to costing a mint, and a Topic minted vectorless is a Topic
    // stage 2 can never match for as long as it exists.
    const forMint = embedded ?? (await this.embedLabel(name, parentAccountId));
    return this.mint(subjectId, name, matchKey, forMint);
  }

  /**
   * What a set of Topic ids are called, keyed by id.
   *
   * **A reader and not a second way in to the cascade.** `normalize` remains the
   * only way a label becomes a Topic; this answers the different question a
   * surface downstream of it has — "what is this id's name?" — and it cannot
   * match, mint, or reach any stage of the cascade. It is here rather than in
   * `grading` or `analytics` because `topics` is the sole owner of `Topic`
   * (AD-17), and a dashboard reaching for the delegate itself would be the
   * ownership rule broken for the sake of one `select`.
   *
   * **One statement for the whole set**, with the Subject's name taken through
   * the relation in the same call, exactly as `releasedFor` takes its labels: one
   * read per row across a module boundary is an N+1 on a table whose whole point
   * is that a child accumulates rows in it.
   *
   * **An unknown id is simply absent from the map**, and an empty input never
   * reaches the database at all. Neither is an error: a stored Mastery row whose
   * Topic has since gone is a figure that is still true, and the caller renders it
   * with no name rather than dropping the row.
   *
   * No cost, tier, model name or embedding travels on this (AD-20, AD-26): a name
   * is all a reader is being told.
   */
  async describe(topicIds: readonly string[]): Promise<Map<string, TopicDescription>> {
    return this.describeWithin(this.prisma, topicIds);
  }

  /**
   * `describe`, inside the caller's open transaction.
   *
   * **The same statement, on the caller's snapshot**, and one implementation rather
   * than two: `describe` is this method against the pooled client. Story 7.6's
   * curation has to read the two Topics of a merge *within* the transaction that
   * re-points their tags — a read on a second connection would be a second snapshot,
   * and a cross-Subject merge could be admitted on a Subject id that had already
   * moved. It is the same read a caller outside a transaction makes, so it is the
   * same code.
   *
   * It exists because AD-17 makes `Topic` this module's table: an orchestrator that
   * reached for `tx.topic` to check a Subject id would be holding a delegate it may
   * not hold, for the sake of one `select`.
   */
  async describeWithin(
    tx: TransactionClient,
    topicIds: readonly string[],
  ): Promise<Map<string, TopicDescription>> {
    const ids = [...new Set(topicIds)];
    if (ids.length === 0) return new Map();
    const rows = await tx.topic.findMany({
      where: { id: { in: ids } },
      select: TOPIC_DESCRIPTION_FIELDS,
    });
    return new Map(rows.map((row) => [row.id, describedFrom(row)]));
  }

  // --- Curation (Story 7.6) ----------------------------------------------

  /**
   * Every Topic the cascade minted and nobody has judged, oldest first.
   *
   * **Across every Subject, deliberately.** The queue is a list of decisions waiting
   * on an operator, and a per-Subject queue would make "is there anything to review"
   * a question that has to be asked once per Subject — which is how an unreviewed
   * near-duplicate sits in a Subject nobody thought to open. The merge itself is
   * still scoped to one Subject; only the *queue* spans them.
   *
   * **`(createdAt asc, id asc)`, and never `createdAt` alone.** Two Topics minted by
   * one hand-in are written milliseconds apart and can tie on a `TIMESTAMP(3)`
   * column; on a tie the order is Postgres's choice, and a queue that reordered
   * itself between two reads is one an operator loses their place in. The id breaks
   * it, exactly as `submittedAttemptsFor` breaks its own tie.
   *
   * No `matchKey`, no embedding and no tagged-Question count: the first two are the
   * cascade's internals, and the third is a fact about `question_topic`, which is
   * `grading`'s table (AD-17) and is counted by its owner.
   */
  async listProvisional(): Promise<ProvisionalTopic[]> {
    const rows = await this.prisma.topic.findMany({
      where: { provisional: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { ...TOPIC_DESCRIPTION_FIELDS, createdAt: true },
    });
    return rows.map((row) => ({ ...describedFrom(row), createdAt: row.createdAt }));
  }

  /**
   * One Subject's whole canonical set, by name.
   *
   * **The merge target list, and it is the whole set rather than the provisional
   * part of it.** The ordinary merge is a provisional near-duplicate folded into the
   * confirmed Topic it should have matched, so a list of provisional rows alone would
   * hide every good target. The `provisional` flag travels with each row so the
   * operator can see which is which.
   *
   * `(name asc, id asc)`: two Topics of one Subject may legitimately share a name —
   * the unique index is on the *key*, and two different keys can render the same
   * spelling — so the id breaks the tie for the same reason the queue's does.
   *
   * An unknown Subject answers `[]` rather than refusing. Whether a Subject exists is
   * `admin`'s question, asked through the taxonomy's own reader; this module answers
   * "what is in that canonical set", and the answer for a set that does not exist is
   * that it holds nothing.
   */
  async listForSubject(subjectId: string): Promise<TopicDescription[]> {
    const rows = await this.prisma.topic.findMany({
      where: { subjectId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: TOPIC_DESCRIPTION_FIELDS,
    });
    return rows.map(describedFrom);
  }

  /**
   * Marks one Topic as judged by a human. Nothing else about it moves.
   *
   * **Confirm is the one action that means "a human has looked at this".** It does
   * not touch the name, the key, the vector or a single `TopicMastery` row: a
   * confirmed Topic is the same Topic, and a confirm that also tidied a spelling
   * would be a second, hidden decision inside the one an operator asked for.
   *
   * **Idempotent by doing nothing.** A second confirm on an already-confirmed row
   * issues no `UPDATE` at all, so `updatedAt` does not move either — "the row is
   * returned unchanged" is a fact about the row and not only about the columns the
   * caller happened to look at. The caller still audits it, because a redundant
   * action an operator took is still an action an operator took.
   *
   * `null` for an id with no row. Whether that is a 404 is the surface's call.
   */
  async confirm(tx: TransactionClient, topicId: string): Promise<TopicDescription | null> {
    const before = await tx.topic.findUnique({
      where: { id: topicId },
      select: TOPIC_DESCRIPTION_FIELDS,
    });
    if (before === null) return null;
    if (!before.provisional) return describedFrom(before);

    const after = await tx.topic.update({
      where: { id: topicId },
      data: { provisional: false },
      select: TOPIC_DESCRIPTION_FIELDS,
    });
    return describedFrom(after);
  }

  /**
   * Gives one Topic a new name, and with it a new match key and no cached vector.
   *
   * **The key is re-derived through `topicMatchKey` and never edited.** It is stage
   * 1's one derivation, used for the lookup and for the write alike, so a rename that
   * left the stored key behind would leave a Topic that goes on matching the spelling
   * it no longer has — silently, and for as long as the Subject is taught.
   *
   * **The cached vector is cleared, and that is not tidiness.** `embedding` is a
   * vector of the *name*. After a rename it describes a spelling the row no longer
   * has, and stage 2 would go on comparing against it with a cosine that looks
   * perfectly healthy. Cleared through `Prisma.DbNull` and not a bare `null`, for the
   * reason `mint` states: on a nullable `Json` column a bare `null` is the JSON value
   * `null`, which is a cached vector of nothing rather than no vector at all. The
   * model name goes with it, because a snapshot with no vector under it is a claim
   * about a row that no longer holds one. Stage 3 refills both, from the new name.
   *
   * **`provisional` is not touched.** Confirm is the action that means a human
   * judged this; a rename that also confirmed would perform a decision nobody made.
   * The queue row carries both controls, so fixing a spelling and confirming is two
   * clicks rather than one hidden one.
   *
   * The name is bounded exactly as a minted one is, through the same `boundedLabel`:
   * two paths to a `topic.name` with two different bounds is how a key outgrows its
   * btree. A name that is blank once trimmed is refused — a Topic with no name is not
   * a rename this module can perform.
   *
   * `null` for an id with no row; `TopicNameConflictError` when the new key is
   * already another Topic's within that Subject. No `TopicMastery` row and no
   * `QuestionTopic` row is read or written here: a Topic's spelling has no bearing on
   * what a child has shown.
   */
  async rename(
    tx: TransactionClient,
    topicId: string,
    name: string,
  ): Promise<TopicDescription | null> {
    const bounded = boundedLabel(name);
    if (bounded.length === 0) throw new TopicInputError(TOPIC_LABEL_REQUIRED);

    const before = await tx.topic.findUnique({ where: { id: topicId }, select: { id: true } });
    if (before === null) return null;

    try {
      const after = await tx.topic.update({
        where: { id: topicId },
        data: {
          name: bounded,
          matchKey: topicMatchKey(bounded),
          embedding: Prisma.DbNull,
          embeddingModel: null,
        },
        select: TOPIC_DESCRIPTION_FIELDS,
      });
      return describedFrom(after);
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw cause;
      throw new TopicNameConflictError(TOPIC_NAME_TAKEN);
    }
  }

  /**
   * Deletes the Topic a merge folded away, inside the caller's transaction.
   *
   * **The only deletion of a `Topic` row anywhere in the system**, and it exists for
   * one caller: a merge that has already re-pointed every tag off this row. Calling
   * it with tags still pointing here would take them with it — `question_topic.topic`
   * is `onDelete: Cascade` — which is a Mastery history deleted rather than moved. So
   * the order the orchestrator runs in is the contract, not a preference.
   *
   * The cascade on `topic_mastery` is the same edge and is wanted here: the merged
   * Topic's stored figures are about a Topic that no longer exists, and the survivor's
   * are recomputed from the window immediately afterwards, in this same transaction.
   *
   * It reads nothing first: the orchestrator has already resolved this row and its
   * Subject through `describeWithin` on this very `tx`.
   */
  async removeMerged(tx: TransactionClient, topicId: string): Promise<void> {
    await tx.topic.delete({ where: { id: topicId } });
  }

  // --- Internals ---------------------------------------------------------

  /**
   * The label's vector, or `null` when the embedding could not be had.
   *
   * **A failed embed skips stage 2 rather than failing the normalize.** The
   * cascade has a stage behind this one that answers the same question without a
   * vector, so an embeddings outage costs accuracy and a stage-3 call — never an
   * id. The warning names the call class and the fact that a stage was skipped,
   * and nothing else: no provider string, no model, no label (AD-20).
   *
   * An `AiInputError` is caught too. It cannot happen — `normalize` has already
   * refused a blank label — but a stage that is allowed to be absent should not be
   * the thing that turns an impossible argument into a failed canonicalization.
   */
  private async embedLabel(
    label: string,
    parentAccountId: string,
  ): Promise<{ vector: number[]; model: string } | null> {
    try {
      const { vector, usage } = await this.ai.embed({
        callClass: 'TopicNormalization',
        text: label,
        parentAccountId,
      });
      return { vector, model: usage.model };
    } catch (cause) {
      if (
        cause instanceof AiUpstreamError ||
        cause instanceof AiRejectedError ||
        cause instanceof AiInputError
      ) {
        this.logger.warn(
          'A TopicNormalization embedding could not be made. The similarity stage was skipped.',
        );
        return null;
      }
      throw cause;
    }
  }

  /**
   * The candidates whose cached vector may be compared with a fresh one.
   *
   * **Filtered by embedding model, not merely by presence.** Two vectors from two
   * different snapshots occupy different spaces, and their cosine is a number with
   * no meaning — high enough, often, to merge two unrelated Topics. So a re-pin
   * makes every previously cached vector stale and this stage silently stops
   * offering them, which is exactly the right behaviour: those Topics fall through
   * to stage 3, which reads their names and needs no vector at all.
   *
   * A `Json` column is `Prisma.JsonValue`, so the array shape is checked here
   * rather than assumed. A row holding something that is not an array of numbers
   * is dropped rather than repaired: `cosine` would answer zero for it anyway, and
   * a repair would be this module writing over a vector it did not produce.
   */
  private comparableVectors(
    candidates: readonly CandidateRow[],
    model: string,
  ): TopicCandidateVector[] {
    const comparable: TopicCandidateVector[] = [];
    for (const candidate of candidates) {
      if (candidate.embeddingModel !== model) continue;
      const embedding = candidate.embedding;
      if (!Array.isArray(embedding)) continue;
      if (!embedding.every((component) => typeof component === 'number')) continue;
      comparable.push({ id: candidate.id, embedding: embedding as number[] });
    }
    return comparable;
  }

  /**
   * The candidate list stage 3 is shown: the strongest first, capped.
   *
   * **This is the only place `TOPIC_CANDIDATE_LIMIT` applies.** A prompt cannot grow
   * without bound — fifty short names is a small call, five thousand is a cost row
   * nobody predicted and a list no model reads carefully — but a cap is only
   * defensible if what it keeps is what the answer is most likely to be in. So the
   * order is by strength rather than by age:
   *
   * - When a label vector exists, by cosine descending. A candidate with no
   *   comparable vector scores zero, which puts it behind every candidate that is
   *   measurably related and ahead of nothing — it is not *dis*preferred, it is
   *   simply unranked.
   * - When no label vector exists — stage 2 skipped or failed — by newest first,
   *   because the Topics a Subject has just started using are the ones a new label
   *   is most likely to be another spelling of.
   *
   * `id` ascending breaks every remaining tie, so the list is the same list twice for
   * the same input. Without it two identical normalizes could be shown two different
   * fifty-name windows and answer differently.
   */
  private offer(candidates: readonly CandidateRow[], embedded: LabelVector): TopicCandidate[] {
    const scored = candidates.map((candidate) => ({
      candidate,
      score: embedded === null ? 0 : this.scoreOf(candidate, embedded),
    }));
    scored.sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.createdAt.getTime() - left.candidate.createdAt.getTime() ||
        (left.candidate.id < right.candidate.id
          ? -1
          : left.candidate.id > right.candidate.id
            ? 1
            : 0),
    );
    return scored
      .slice(0, TOPIC_CANDIDATE_LIMIT)
      .map(({ candidate }) => ({ id: candidate.id, name: candidate.name }));
  }

  /** One candidate's cosine against the label, or `0` when it has no usable vector. */
  private scoreOf(candidate: CandidateRow, embedded: { vector: number[]; model: string }): number {
    const [comparable] = this.comparableVectors([candidate], embedded.model);
    return comparable === undefined ? 0 : cosine(embedded.vector, comparable.embedding);
  }

  /**
   * Caches a vector on a Topic that stage 3 matched and that had none.
   *
   * **This is what stops a vectorless Topic being vectorless forever.** The first
   * Topic of every Subject is minted with no embed call behind it, by the matrix row
   * that says so — so it can never be matched by stage 2, and every future spelling
   * of it costs a stage-3 call for the lifetime of the Subject. A re-pin leaves every
   * Topic in the same state. Embedding the *stored name* once, the first time stage 3
   * confirms that this Topic is what a label meant, converts that permanent cost into
   * a single one.
   *
   * It embeds the candidate's own name and never the label that matched it: the name
   * is what the canonical Topic *is*, and caching the label's vector on it would drift
   * the row towards whatever spelling happened to arrive first.
   *
   * Nothing here may fail the normalize. The id is already decided and already
   * correct; a cache that could not be filled is a future call this deployment will
   * pay for again, which is worth a log line and not a lost Mastery write.
   */
  private async cacheVectorFor(
    topicId: string,
    candidates: readonly CandidateRow[],
    parentAccountId: string,
  ): Promise<void> {
    const matched = candidates.find((candidate) => candidate.id === topicId);
    if (matched === undefined) return;
    if (this.comparableVectors([matched], this.ai.embeddingModel).length > 0) return;

    const embedded = await this.embedLabel(matched.name, parentAccountId);
    if (embedded === null) return;
    try {
      await this.prisma.topic.update({
        where: { id: topicId },
        data: { embedding: embedded.vector, embeddingModel: embedded.model },
      });
    } catch {
      this.logger.error(
        'A canonical topic vector could not be cached. The normalization stands and the comparison will be bought again.',
      );
    }
  }

  /**
   * Stage 3: the id of the candidate the model named, or `null` for "none fit".
   *
   * `null` is what sends the caller on to mint, and it covers two answers that are
   * one fact about this call: the explicit none-fit marker, and an id that is not
   * on the list it was given. **The second is checked here in code** (AD-30) —
   * rule 4 of the prompt says not to invent an id, and saying so is not trusting
   * it. An id off the list is treated as no match rather than as an error, because
   * the alternative is failing a canonicalization over a model's spelling mistake
   * when minting is a perfectly good answer.
   *
   * The call is a **text** call, stated and never defaulted, carrying no images.
   */
  private async resolve(
    label: string,
    offered: readonly TopicCandidate[],
    parentAccountId: string,
  ): Promise<string | null> {
    const { payload } = await this.ai.run({
      callClass: 'TopicNormalization',
      parentAccountId,
      modality: 'text',
      images: [],
      prompt: buildTopicResolutionPrompt({ label, candidates: offered }),
      schema: TopicResolutionPayload,
      schemaName: TOPIC_RESOLUTION_SCHEMA_NAME,
      // The fake's answer is a function of the label and the candidate names, so
      // the builder closes over them here rather than `ai` knowing what a Topic is
      // (AD-17, AD-22).
      fakePayload: fakeTopicResolutionPayload(label, offered),
    });
    if (payload.topicId === TOPIC_NONE_FIT) return null;
    const named = offered.find((candidate) => candidate.id === payload.topicId);
    if (named === undefined) {
      // The class of fault and nothing the model said (AD-20).
      this.logger.warn(
        'A TopicNormalization call named a topic that was not offered to it. Treated as no match.',
      );
      return null;
    }
    return named.id;
  }

  /**
   * A new canonical Topic, provisional, with whatever vector stage 2 already paid
   * for.
   *
   * **The unique index is what makes a race one row rather than two.** Two
   * concurrent normalizes of the same key against the same Subject both reach here;
   * one wins, and the loser is refused with P2002 on `(subjectId, matchKey)`. The
   * loser then re-reads by that exact pair — never by id, which it does not have,
   * and never by name, which the winner may have spelled differently — and returns
   * the winner's id. So both callers answer, with the same id, and the canonical set
   * holds one row.
   *
   * The re-read is asserted to have found something rather than coerced: a P2002 on
   * this key with no row behind it is impossible, and swallowing it would return a
   * non-id as if it were one.
   */
  private async mint(
    subjectId: string,
    name: string,
    matchKey: string,
    embedded: { vector: number[]; model: string } | null,
  ): Promise<string> {
    try {
      const created = await this.prisma.topic.create({
        data: {
          subjectId,
          // The label verbatim, trimmed. Never the key: a key is sorted, lowercased
          // and stripped, and a parent's dashboard would read "addition fraction".
          name,
          matchKey,
          // Stated rather than left to the column default, because it is the whole
          // meaning of a minted row: nothing here was confirmed by a human.
          provisional: true,
          // A nullable `Json` column takes SQL NULL through the client's own
          // sentinel; a bare `null` would be the JSON value `null`, which is a
          // cached vector of nothing rather than no vector at all.
          embedding: embedded?.vector ?? Prisma.DbNull,
          embeddingModel: embedded?.model ?? null,
        },
        select: { id: true },
      });
      return created.id;
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw cause;
      const winner = await this.prisma.topic.findUnique({
        where: { subjectId_matchKey: { subjectId, matchKey } },
        select: { id: true },
      });
      if (winner === null) throw cause;
      return winner.id;
    }
  }
}

/**
 * The label, trimmed and bounded to `MAX_TOPIC_LABEL_LENGTH`.
 *
 * Trimmed again after the cut, so a label shortened in the middle of a space does
 * not become a name with a trailing one. The cut is by code unit rather than by
 * grapheme: the bound exists to keep a btree key and a prompt line finite, and a
 * split surrogate pair at character 200 of a label that was never a Topic name is
 * not a problem worth a segmenter.
 */
function boundedLabel(label: string): string {
  return label.trim().slice(0, MAX_TOPIC_LABEL_LENGTH).trim();
}

/**
 * The columns every public read of this module answers with, stated once.
 *
 * One `select` shared by `describe`, the curation queue, the per-Subject set and both
 * writes, so no reader can quietly widen into `matchKey` or `embedding`: the key is
 * stage 1's internal and the vector is stage 2's, and neither is anything a surface
 * outside this module has business holding (AD-20). The Subject name travels through
 * the relation in the same statement, so no caller has an N+1 to write.
 */
const TOPIC_DESCRIPTION_FIELDS = {
  id: true,
  name: true,
  subjectId: true,
  provisional: true,
  subject: { select: { name: true } },
} as const;

/** One selected row as this module's callers read it. */
function describedFrom(row: {
  id: string;
  name: string;
  subjectId: string;
  provisional: boolean;
  subject: { name: string };
}): TopicDescription {
  return {
    topicId: row.id,
    name: row.name,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    provisional: row.provisional,
  };
}

/** The unique-constraint violation, as the client reports it. */
function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002';
}
