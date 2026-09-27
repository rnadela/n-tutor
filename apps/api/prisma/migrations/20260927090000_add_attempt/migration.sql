-- CreateTable
-- A new table, so there is nothing to backfill: a Practice Test with no rows
-- here has never been sat, which is exactly what "not started" means. The three
-- list conditions are derived from these rows and from no status column.
--
-- `submittedAt` nullable is the in-progress signal, and `updatedAt` carries no
-- default because Prisma's `@updatedAt` writes it on every statement — the
-- repo's own convention, everywhere else in this schema.
CREATE TABLE "attempt" (
    "id" TEXT NOT NULL,
    "practiceTestId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The one index the student list reads: this test's Attempts, and whether any
-- of them is still open.
CREATE INDEX "attempt_practiceTestId_submittedAt_idx" ON "attempt"("practiceTestId", "submittedAt");

-- AddForeignKey
-- Cascade, unlike `practice_test`'s own parents: an Attempt is a sitting of one
-- Practice Test and means nothing without it, where a Practice Test may already
-- be charged and so holds its account with Restrict.
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_practiceTestId_fkey" FOREIGN KEY ("practiceTestId") REFERENCES "practice_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
