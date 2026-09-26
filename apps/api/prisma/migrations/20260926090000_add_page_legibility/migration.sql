-- CreateEnum
CREATE TYPE "page_legibility" AS ENUM ('Low', 'Medium', 'High');

-- AlterTable
ALTER TABLE "source_test" ADD COLUMN     "legibilityCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "page_image" ADD COLUMN     "legibility" "page_legibility";

-- CreateIndex
CREATE INDEX "source_test_parentAccountId_status_submittedAt_idx" ON "source_test"("parentAccountId", "status", "submittedAt");

