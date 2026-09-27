-- Story 6.1 adds the table an Explanation lives in: prose written for one child
-- about one Question of one run they have already handed in.
--
-- The row is the cache and the row is the charge. The unique index below *is* the
-- cache key -- the first ask generates and writes, every later ask finds this row
-- and makes no provider call -- and `chargedAt` *is* the Explanation Allowance
-- (AD-14), counted by rows inside a period window rather than by a counter column
-- that would have to be reset, decremented and reconciled.

-- CreateTable
-- `body` is JSONB for the reason every other generated-text column is: an
-- Explanation is `RichText` segments (AD-32), never a flat string, because a
-- fraction flattened to a glyph has lost the reading "one half" that a child
-- listening to the page needs.
--
-- `parentAccountId` is a plain column with no foreign key, exactly as
-- `"attempt"."parentAccountId"` is: the edge would have to be RESTRICT to keep a
-- charge from being deleted out from under the count, which would contradict the
-- cascading edges the three child-scoped columns beside it carry.
--
-- `chargedAt` is nullable with no default and no backfill. There are no rows to
-- backfill, and null is the reading Story 6.4's free regeneration needs: "this row
-- cost nothing", not "this row is unfinished".
CREATE TABLE "explanation" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "chargedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "explanation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The cache key, as a constraint rather than as an intention. Two concurrent first
-- presses on one Question are refused one row by the index instead of producing two
-- explanations of one thing -- and two charges for them.
CREATE UNIQUE INDEX "explanation_attemptId_questionId_studentProfileId_key" ON "explanation"("attemptId", "questionId", "studentProfileId");

-- CreateIndex
-- The derived Explanation Allowance count (AD-14): this account's charged rows
-- whose `chargedAt` falls in the period window. Indexed because the count *is* the
-- charge -- there is no counter column to read instead -- so it runs on every
-- generation and on every surface that shows an allowance. Equality then range,
-- exactly as `practice_test`'s own count index is ordered.
CREATE INDEX "explanation_parentAccountId_chargedAt_idx" ON "explanation"("parentAccountId", "chargedAt");

-- AddForeignKey
-- Cascade on all three edges, like `question_grade`'s: an Explanation never blocks
-- a deletion and leaves no tombstone behind it. The charge it carried is already
-- spent, and deleting the row is not a refund path -- no such path exists.
ALTER TABLE "explanation" ADD CONSTRAINT "explanation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "explanation" ADD CONSTRAINT "explanation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "practice_test_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "explanation" ADD CONSTRAINT "explanation_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
