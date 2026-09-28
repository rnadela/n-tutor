-- Story 6.3 adds what a parent *decided* about a concern their child raised, and the
-- index the Admin Flagged Explanations queue reads through.
--
-- No enum migration for the origin itself: `explanation_flag_origin` already declares
-- both `Parent` and `Student`, which Story 6.2 paid for on purpose so the student
-- route is a code path rather than a migration Postgres would not let the same
-- transaction use.
--
-- Nothing here suppresses anything. Confirming puts an Explanation in front of an
-- operator and changes nothing a child is served -- suppression is Story 6.4's, and
-- there is still no column for it.

-- CreateEnum
-- Two members and no third. "Nobody has decided yet" is the *absence* of a
-- disposition, not one of them: a `Pending` member would make an awaiting flag a row
-- somebody has to remember to write, and an unwritten one would then be
-- indistinguishable from a bug.
CREATE TYPE "explanation_flag_disposition" AS ENUM ('Confirmed', 'Dismissed');

-- AlterTable
-- Both columns nullable, and the null carries two readings that are the same absence:
-- a parent-origin flag has no disposition and needs none -- it is already the parent's
-- own judgement -- and a student-origin flag nobody has read yet has not got one yet.
-- Which reading applies is `origin`, never a third value.
--
-- `dispositionAt` is written in the same statement as `disposition` and never on its
-- own: a decision with no instant beside it is a decision nobody can date. There is
-- deliberately no `dispositionedBy` -- a disposition is recorded by the parent whose
-- account the flag belongs to, which is already on the row.
--
-- No DEFAULT and no backfill. Every existing row is parent-origin (the student route
-- ships with this migration), and a default would write a decision nobody made.
ALTER TABLE "explanation_flag" ADD COLUMN "disposition" "explanation_flag_disposition";
ALTER TABLE "explanation_flag" ADD COLUMN "dispositionAt" TIMESTAMP(3);

-- CreateIndex
-- The Admin queue's read, in the shape the read itself has: "parent-origin, or
-- student-origin confirmed, oldest qualifying first". Two equality columns and then
-- the ordering one, which is the same equality-then-range shape the account index
-- beside it already has. A confirmed flag is the only student-origin row the queue may
-- ever see, so the disposition belongs in the index and not in a filter after it.
CREATE INDEX "explanation_flag_origin_disposition_createdAt_idx" ON "explanation_flag"("origin", "disposition", "createdAt");
