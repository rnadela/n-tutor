-- Story 8.3 lets a parent delete a Student Profile and everything under it. One table
-- and one enum, both owned by nobody's entity cluster: `usage_tombstone` is the record
-- that a charge *happened*, kept after the artifact that carried it is gone.
--
-- **Why the row exists.** The three allowances are derived (AD-14): `allowance` counts
-- Source Tests committed, Practice Tests charged and Explanations charged inside the
-- account's period window, and never decrements a stored counter. Deleting a child's
-- artifacts therefore lowers those counts — which would refund the account's month and
-- make delete-and-recreate a path to unlimited free generation. Before any row goes,
-- the charged artifacts are collapsed into rows here, in the same transaction as the
-- deletes, and `allowance` adds them to its live counts. A crash between the two would
-- be exactly the refund this table exists to prevent, which is why it is one transaction.
--
-- **Why it carries no child data.** A Parent Account, a period start, a usage class and
-- a number. No student id, no artifact id, no title and no text: what survives is the
-- count, not the thing counted. Nothing here can be read back as a fact about a child,
-- which is what makes it compatible with "deletion erases".
--
-- `periodStart` is stable after the fact because `resolveWindow` is deterministic for a
-- past instant — the effective-dated timezone history says which zone was in force when
-- the artifact was charged, so a later zone change cannot move a tombstone into another
-- period.
--
-- The foreign key is `CASCADE`, unlike every other edge Epic 8 walks: a tombstone is a
-- statement *about* an account, so Story 8.4's account deletion erases it rather than
-- being blocked by it. No backfill: the table starts empty and fills only as profiles
-- are deleted.

-- CreateEnum
CREATE TYPE "usage_class" AS ENUM ('Upload', 'Generation', 'Explanation');

-- CreateTable
CREATE TABLE "usage_tombstone" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    -- The window start the collapsed charges fell in, as `resolveWindow` computed it for
    -- each artifact's own charging instant.
    "periodStart" TIMESTAMP(3) NOT NULL,
    "usageClass" "usage_class" NOT NULL,
    -- How many charged artifacts this row stands in for.
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_tombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per account, period and class. That is what makes the write an upsert with an
-- increment rather than an insert a second deletion in the same period could duplicate.
CREATE UNIQUE INDEX "usage_tombstone_parentAccountId_periodStart_usageClass_key" ON "usage_tombstone"("parentAccountId", "periodStart", "usageClass");

-- CreateIndex
-- The read `allowance` makes on every consumption: this account's tombstones inside one
-- half-open window.
CREATE INDEX "usage_tombstone_parentAccountId_periodStart_idx" ON "usage_tombstone"("parentAccountId", "periodStart");

-- AddForeignKey
ALTER TABLE "usage_tombstone" ADD CONSTRAINT "usage_tombstone_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
