-- Story 7.2 turns grade rows into a per-Topic Mastery value. Two new tables, both owned
-- and written by `grading` alone (AD-6): the canonical tag a generated Question resolves
-- to, and the stored figure one child has on one Topic.
--
-- No enum, no altered column, nothing rewritten on disk and no backfill. `topic_mastery`
-- starts empty and fills as work is handed in; `question_topic` starts empty and fills
-- beside each hand-in. Generation keeps writing `practice_test_question_topic` exactly as
-- it did — that table keeps the free-form evidence, and this one keeps the answer.
--
-- **Every foreign key here is `CASCADE`, deliberately.** Both tables hold derived facts:
-- a tag is a statement about a Question and a Topic, and a Mastery row is a statement
-- about runs that already cascade from the child. Neither is something Epic 8's deletion
-- path has to preserve, and neither may be a row that blocks one.
--
-- No background job, no schedule and no queue table: the recompute runs inside the
-- transaction that wrote the grade change (AD-10).

-- CreateTable
CREATE TABLE "question_topic" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    -- The owning Practice Test, denormalized off the Question so the recompute can ask
    -- "which of this child's runs included this Topic" from this table alone. Joining
    -- `practice_test_question` would mean `grading` reaching into a table `practicetest`
    -- owns (AD-17), and the column cannot drift: a Question never moves between tests.
    "practiceTestId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_mastery" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    -- Counts over the five most recent qualifying Attempts that included the Topic, by
    -- effective state, so a parent's override counts and the stored verdict does not.
    "correct" INTEGER NOT NULL,
    "incorrect" INTEGER NOT NULL,
    -- Blanks on an unexpired hand-in. Stored beside the counts because every Epic 7
    -- surface states a Mastery figure with its skipped count, and that count is a
    -- property of the same window as the value. In neither term of the fraction.
    "unanswered" INTEGER NOT NULL,
    -- How many Attempts of the window actually contributed, one to five.
    "attemptsCounted" INTEGER NOT NULL,
    -- `correct / (correct + incorrect)`, or NULL where that denominator is zero. Nullable
    -- rather than 0, because a window that was entirely skipped is not a child who got
    -- everything wrong. A row with no evidence at all is deleted rather than stored.
    "value" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_mastery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- What makes the tag idempotent: two labels on one Question that canonicalize to the same
-- Topic are one row, so the Question contributes once. The writer inserts with
-- `ON CONFLICT DO NOTHING` rather than checking first, so a concurrent second pass is a
-- loser on this index rather than a duplicate.
CREATE UNIQUE INDEX "question_topic_questionId_topicId_key" ON "question_topic"("questionId", "topicId");

-- CreateIndex
-- The recompute's own read, in its own shape: this Topic's tags, narrowed to the Practice
-- Tests of the Attempt window. Equality then equality, which is the whole of the `where`.
CREATE INDEX "question_topic_topicId_practiceTestId_idx" ON "question_topic"("topicId", "practiceTestId");

-- CreateIndex
-- One row per child and Topic, which is what makes the recompute an upsert rather than a
-- delete-and-insert a reader could observe half of.
CREATE UNIQUE INDEX "topic_mastery_studentProfileId_topicId_key" ON "topic_mastery"("studentProfileId", "topicId");

-- CreateIndex
-- Story 7.4's dashboard read: every Topic of one child.
CREATE INDEX "topic_mastery_studentProfileId_idx" ON "topic_mastery"("studentProfileId");

-- AddForeignKey
ALTER TABLE "question_topic" ADD CONSTRAINT "question_topic_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "practice_test_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_topic" ADD CONSTRAINT "question_topic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
