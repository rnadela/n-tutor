-- Story 6.4 gives a parent the two remedies FR-39 asks for: stop one Explanation
-- being served to their child, and get a replacement that costs nothing.
--
-- Two columns and one widened key, and that is the whole of the schema change.
--
-- **Suppression is a serving rule on a retained row.** There is no DELETE here, no
-- soft-delete column and no un-suppress route: the epic requires the suppressed record
-- kept, still readable by the parent and still in front of an operator, and overwriting
-- `body` would destroy exactly the prose the operator has to judge.
--
-- **No column is added for the free regeneration.** `charged_at IS NULL` is that flag
-- already -- `allowance.service.ts`'s explanation counter reads `chargedAt: { gte, lt }`
-- and its comment already names this story's regeneration as the null case. A second
-- counter or an `excluded_from_count` boolean would be a new place for the two to
-- disagree.

-- AlterTable
-- Nullable, with no DEFAULT and no backfill: every row already on disk is one a child
-- is still being served, and a default here would record a decision nobody made.
--
-- Written by `updateMany({ where: { id, suppressed_at IS NULL } })` and never by a
-- read-then-write, so two simultaneous presses cannot both win and the *first* instant
-- is final by the statement rather than by a check. There is deliberately no
-- `suppressed_by` -- the account is already on the row -- and no `suppression_reason`: a
-- column with no writer is a promise the next reader believes.
ALTER TABLE "explanation" ADD COLUMN "suppressedAt" TIMESTAMP(3);

-- AlterTable
-- Which explanation of this Question for this child a row is: 1 for the one the child
-- asked for, 2 for the first free replacement, and so on. This is what makes a
-- replacement a *distinct entry* rather than an overwrite.
--
-- `DEFAULT 1` and NOT NULL, so every row already on disk takes generation 1 without a
-- backfill statement -- and the widened unique index below is therefore satisfied by
-- every one of them, because they were already unique on the three columns it extends.
ALTER TABLE "explanation" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;

-- DropIndex
-- The old three-column cache key. It allowed exactly one row per (Attempt, Question,
-- child), which is what made a replacement impossible to express without destroying the
-- row it replaces.
DROP INDEX "explanation_attemptId_questionId_studentProfileId_key";

-- CreateIndex
-- The same cache key with the generation in it. A suppressed generation and its
-- replacement are two rows, each with its own body, its own flags, its own `charged_at`
-- and its own `suppressed_at`.
--
-- **At most one generation is live, and it follows from the two write rules rather than
-- from a partial index.** The student path only ever writes generation 1, and only into
-- an empty (Attempt, Question, child); the parent's regeneration only ever writes
-- `max + 1`, and only when the highest generation is suppressed. So a live row can only
-- ever be the highest one -- and this key is what refuses every racing loser, exactly as
-- the three-column one refused two first presses. A `WHERE suppressed_at IS NULL`
-- partial unique index would be a second statement of a rule the writes already make,
-- and the two would drift.
CREATE UNIQUE INDEX "explanation_attemptId_questionId_studentProfileId_generatio_key" ON "explanation"("attemptId", "questionId", "studentProfileId", "generation");
