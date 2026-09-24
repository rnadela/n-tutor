-- AlterTable
-- Nullable, so every existing row is an unweighted request without a backfill:
-- null already means exactly what an unweighted request means.
ALTER TABLE "generation_job" ADD COLUMN     "weightedTopic" TEXT;
