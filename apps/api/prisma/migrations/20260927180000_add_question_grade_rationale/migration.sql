-- Story 5.5 adds the one column its own verdicts need: why a provider judged an
-- answer the way it did.
--
-- A column and not a log line, because it is the evidence a parent decides an FR-25
-- override on -- a reason that lived only in a log would be a reason nobody the
-- decision belongs to can read.
--
-- TEXT for the reason `"answer"."value"` is: a rationale is prose, not a label.

-- AlterTable
-- Nullable, and deliberately with no default and no backfill. Null is the honest
-- reading for every row that already exists and for most rows written from here on:
-- a deterministic Multiple Choice verdict, an `Unanswered` blank and an `Ungraded`
-- failure are none of them a judgement a provider explained, so there is no sentence
-- to store and an empty string would be a sentence that says nothing.
ALTER TABLE "question_grade" ADD COLUMN "rationale" TEXT;
