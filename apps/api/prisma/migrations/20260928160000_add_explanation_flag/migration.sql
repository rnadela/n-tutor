-- Story 6.2 adds the table a concern about an Explanation lives in: a parent read
-- what their child was told and recorded that one of those explanations is bad.
--
-- The row is the record, and that is the whole of it. Nothing here suppresses
-- anything, nothing here is a disposition, and nothing here changes what a child is
-- served -- those are Stories 6.4 and 6.3, and a column with no writer would be a
-- promise the next reader believes. The unique index below is what makes a second
-- press the *same* flag rather than a second row.

-- CreateEnum
-- **Both members now, one writer yet.** The parent route is this story's; the
-- student-originated flag is Story 6.3's. Declaring `Student` here means that story
-- adds a code path rather than an enum migration -- and Postgres will not let a
-- value added to an enum be used inside the transaction that added it, so the cost
-- of deferring is paid twice over.
CREATE TYPE "explanation_flag_origin" AS ENUM ('Parent', 'Student');

-- CreateTable
-- `parentAccountId` is a plain column with no foreign key, exactly as
-- `"explanation"."parentAccountId"` is: a flag must never be the thing that blocks
-- an account from being deleted, and a RESTRICT edge here would contradict the
-- cascading edge beside it. `studentProfileId` is denormalized for the same reason
-- the Explanation's is -- the Admin queue Story 6.3 builds reads by account and by
-- child without joining the Explanation.
--
-- There is deliberately no `dispositionedAt`, no `suppressedAt`, no `reason` and no
-- soft-delete column. There is also no DELETE route: a concern that was raised was
-- raised, so nothing here needs a way back.
CREATE TABLE "explanation_flag" (
    "id" TEXT NOT NULL,
    "explanationId" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "origin" "explanation_flag_origin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "explanation_flag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Idempotency, as a constraint rather than as an intention. A parent pressing twice
-- is one concern and lands on this key, which is why the write is an upsert and why
-- the first `createdAt` survives it. A parent and a child who each flag the same
-- Explanation are two people, two origins and two rows -- the origin is part of the
-- identity of a flag and not a label on it.
CREATE UNIQUE INDEX "explanation_flag_explanationId_origin_key" ON "explanation_flag"("explanationId", "origin");

-- CreateIndex
-- The one read index: this account's flags, newest first. Equality then range,
-- exactly as `explanation`'s own count index is ordered.
CREATE INDEX "explanation_flag_parentAccountId_createdAt_idx" ON "explanation_flag"("parentAccountId", "createdAt");

-- AddForeignKey
-- Cascade, like every child-scoped edge on `explanation` itself: a flag against a
-- row that is gone is a flag against nothing, and it leaves no tombstone behind it.
ALTER TABLE "explanation_flag" ADD CONSTRAINT "explanation_flag_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "explanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
