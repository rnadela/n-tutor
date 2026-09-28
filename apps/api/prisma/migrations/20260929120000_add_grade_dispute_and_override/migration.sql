-- Story 6.5 gives FR-25 its two halves: the child can say a grade is wrong, and the
-- parent can change it.
--
-- Two nullable columns, one new table and its three indexes. **No new enum** -- an
-- override is one of the four grade states and reuses `grade_state`, which is also why
-- nothing here has to worry about Postgres refusing a value added to an enum inside the
-- transaction that first uses it.
--
-- It applies to a database already carrying Story 6.4's rows: every statement below is
-- either an added nullable column or a new object, so nothing on disk is rewritten and
-- no backfill is needed.

-- AlterTable
-- **The override is a column beside the verdict, not an edit of it.** `state` and
-- `rationale` keep the provider's own verdict and the sentence it gave for it, because
-- the original grade *and* its reason are exactly what an override is decided against --
-- FR-25 requires both to remain readable afterwards. Effective state is
-- `override_state ?? state`, resolved in one function (`grading-override.ts`), so no
-- surface computes its own answer to "what counts". There is no second score column and
-- no second denominator: the prior figure is `scoreOf` over stored states and the
-- adjusted one is `scoreOf` over effective states.
--
-- Nullable, with no DEFAULT and no backfill: every row already on disk is one no parent
-- has adjusted, and a default here would record a decision nobody made.
--
-- Written by an `updateMany` guarded on the (attempt, question) pair, inside the same
-- transaction that reads the recomputed score back (AD-10) -- never by a read-then-write,
-- so two simultaneous presses both answer and the flip and the figure commit together.
--
-- There is deliberately no `override_by` -- the account is reachable through the
-- Attempt -- and no `override_reason`: a column with no writer is a promise the next
-- reader believes.
ALTER TABLE "question_grade" ADD COLUMN "overrideState" "grade_state";

-- AlterTable
-- Always written in the same statement as `overrideState`, so no reader ever has to
-- handle half an override. Unlike `explanation.suppressedAt` this one *moves*: an
-- override is a statement about a grade rather than an irreversible removal, so a parent
-- who flips a Question back records a new instant for the new decision.
ALTER TABLE "question_grade" ADD COLUMN "overriddenAt" TIMESTAMP(3);

-- CreateTable
-- The record of a raised hand, modelled on `explanation_flag` for its reasons.
--
-- `parentAccountId` is a plain column with no foreign key, exactly as
-- `"explanation_flag"."parentAccountId"` is: a dispute must never be the thing that
-- blocks an account from being deleted, and a RESTRICT edge here would contradict the
-- cascading edges beside it. `studentProfileId` is denormalized for the reason the flag's
-- is -- the parent's per-child list reads by it without joining the Attempt.
--
-- **There are deliberately no disposition columns.** No `resolved_at`, no `resolution`,
-- no `reason` and no soft-delete column. FR-25 grants the parent exactly one remedy --
-- the override -- so a dispute is resolved exactly when its Question carries one, and a
-- `resolved_at` here would be a second writer of a fact `question_grade` already states.
-- There is also no DELETE route: a hand that was raised was raised.
CREATE TABLE "grade_dispute" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Idempotency, as a constraint rather than as an intention. A child pressing twice is one
-- objection and lands on this key, which is why the write is an upsert and why the first
-- `createdAt` survives it. The child is not in the key because an Attempt belongs to
-- exactly one Student Profile: the pair already names one child, and a third column that
-- can never vary is a column that teaches the next reader it can.
CREATE UNIQUE INDEX "grade_dispute_attemptId_questionId_key" ON "grade_dispute"("attemptId", "questionId");

-- CreateIndex
-- The parent's per-child list, in that read's own shape: this child's disputes, newest
-- first. Equality then range, exactly as `explanation_flag`'s is ordered.
CREATE INDEX "grade_dispute_studentProfileId_createdAt_idx" ON "grade_dispute"("studentProfileId", "createdAt");

-- CreateIndex
-- The same shape by account, for a reader holding an account and no child -- and so a
-- dispute is never found by scanning the table.
CREATE INDEX "grade_dispute_parentAccountId_createdAt_idx" ON "grade_dispute"("parentAccountId", "createdAt");

-- AddForeignKey
-- Cascade, like every child-scoped edge on the grade row beside it: a dispute about an
-- Attempt that is gone is a dispute about nothing, and it leaves no tombstone behind it.
ALTER TABLE "grade_dispute" ADD CONSTRAINT "grade_dispute_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade, for the reason above.
ALTER TABLE "grade_dispute" ADD CONSTRAINT "grade_dispute_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "practice_test_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
