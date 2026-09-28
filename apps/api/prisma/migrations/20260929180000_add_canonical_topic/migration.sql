-- Story 7.1 gives Epic 7 the thing every later story in it reads: a canonical Topic set,
-- scoped per Subject, that a free-form generated label maps onto.
--
-- One new table, one unique index, one lookup index and one foreign key. No enum, no
-- altered column, nothing rewritten on disk and no backfill: generation keeps writing
-- `practice_test_question_topic` exactly as it did, and this table starts empty.
--
-- **There is no database vector extension here, and that is a decision rather than an
-- omission.** No extension is created, no typed vector column and no ivfflat/hnsw index. A Subject's
-- canonical set is tens of rows; the cosine that stage 2 of the AD-11 cascade needs is a
-- dot product over tens of short arrays, which application code does for free. An
-- extension is a thing every database this deploys to must then have, forever, and it
-- would be bought to accelerate a scan that is already instant.

-- CreateTable
CREATE TABLE "topic" (
    "id" TEXT NOT NULL,
    -- Scoped by Subject and never by Grade Level: "Long Division" is one concept across
    -- grades, and a per-grade canonical set would fragment the history the Epic 7
    -- dashboard exists to show.
    "subjectId" TEXT NOT NULL,
    -- The emitted label verbatim on a minted row. Matching an existing row never rewrites
    -- it, so a parent's dashboard does not relabel itself as new spellings arrive.
    "name" TEXT NOT NULL,
    -- The stage-1 key: the name lowercased, stripped of punctuation, stopwords dropped,
    -- tokens deduped and sorted. A stored column rather than an expression, because it is
    -- what the unique index below is on and a derivation applied at query time is a scan.
    "matchKey" TEXT NOT NULL,
    -- Minting is the only way a row arrives today, so the default is true. The confirm /
    -- merge / rename surface is Story 7.6; until then nothing clears this flag, and
    -- matching an existing Topic deliberately leaves it alone.
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    -- The cached stage-2 vector as a plain JSON array of numbers. Nullable, because the
    -- first Topic in an empty canonical set is minted with no provider call behind it and
    -- therefore has no vector to cache.
    "embedding" JSONB,
    -- The snapshot that vector came from, recorded per row for the reason `ai_call.model`
    -- is: vectors from two models are not comparable, so a re-pin leaves old rows visibly
    -- stale instead of silently mixed into one cosine.
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Stage 1 of the cascade is a lookup on this key, and a concurrent mint is a loser on it
-- rather than a duplicate: the cascade catches the violation and re-reads by this exact
-- pair, so "one row exists and both callers get its id" is the index's promise and not a
-- check somebody has to remember to make.
CREATE UNIQUE INDEX "topic_subjectId_matchKey_key" ON "topic"("subjectId", "matchKey");

-- CreateIndex
-- Stage 2's own read is `subjectId` equality only — every Topic of the Subject, by
-- design (see topic.service.ts) — so today this index serves that read only by its
-- `subjectId` prefix. The `provisional` column earns its place once Story 7.6's
-- queue reads `(subjectId, provisional)` together.
CREATE INDEX "topic_subjectId_provisional_idx" ON "topic"("subjectId", "provisional");

-- AddForeignKey
-- `RESTRICT`, like every other edge onto a taxonomy row: a Subject is disabled and never
-- deleted (UJ-4), and a canonical set that could vanish would take every child's Mastery
-- history with it.
ALTER TABLE "topic" ADD CONSTRAINT "topic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
