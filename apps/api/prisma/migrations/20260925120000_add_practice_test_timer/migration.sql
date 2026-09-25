-- AlterTable
-- Nullable, so every existing row is already an untimed practice test without a
-- backfill: null already means exactly what "no timer" means, which is what the
-- timer being off by default (FR-15) amounts to.
ALTER TABLE "practice_test" ADD COLUMN     "timerMinutes" INTEGER;
