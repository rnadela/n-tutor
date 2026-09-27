-- Story 5.3 extends the `attempt` table Story 5.1 created read-only, and adds
-- `answer`.
--
-- Nothing ever wrote an `attempt` row before this migration: Story 5.1 created
-- the table so the student list could derive "not started / in progress /
-- completed" from it, and explicitly left every write to Stories 5.2-5.4. So
-- there is no real history to preserve here, and the NOT NULL columns below can
-- be added without a default. The delete clears fixture rows only, and keeps
-- this migration applicable to a database that was migrated at Story 5.1.
DELETE FROM "attempt";

-- AlterTable
-- The clock and the ownership the Attempt may not take from a request body.
-- `startedAt` loses its default: it is written once by the server, from the
-- server's clock, at Attempt start, never by the database.
ALTER TABLE "attempt"
    ADD COLUMN "parentAccountId" TEXT NOT NULL,
    ADD COLUMN "studentProfileId" TEXT NOT NULL,
    ADD COLUMN "ordinal" INTEGER NOT NULL,
    ADD COLUMN "expiresAt" TIMESTAMP(3),
    ADD COLUMN "expired" BOOLEAN NOT NULL DEFAULT false,
    ALTER COLUMN "startedAt" DROP DEFAULT;

-- CreateTable
-- What the child answered, as raw text. No grade column and no correctness flag:
-- a blank Question simply has no row, and what a blank means is a later story's.
CREATE TABLE "answer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per child per run at a Practice Test, which is what makes "no second
-- open Attempt" a property of the table rather than of a check somebody writes.
CREATE UNIQUE INDEX "attempt_practiceTestId_studentProfileId_ordinal_key" ON "attempt"("practiceTestId", "studentProfileId", "ordinal");

-- CreateIndex
-- The open-Attempt lookup: this child's Attempts, filtered by submission.
CREATE INDEX "attempt_studentProfileId_submittedAt_idx" ON "attempt"("studentProfileId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "answer_attemptId_questionId_key" ON "answer"("attemptId", "questionId");

-- AddForeignKey
-- Cascade, like `attempt`'s edge to `practice_test`: an Attempt never blocks a
-- deletion and leaves no tombstone behind it. `parentAccountId` carries no
-- foreign key on purpose -- `practice_test`'s own edge to the account is
-- RESTRICT because the row may be charged (AD-14), and a second, cascading edge
-- would contradict it.
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer" ADD CONSTRAINT "answer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer" ADD CONSTRAINT "answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "practice_test_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
