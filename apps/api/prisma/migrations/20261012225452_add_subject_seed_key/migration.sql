/*
  Warnings:

  - A unique constraint covering the columns `[seedKey]` on the table `subject` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "subject" ADD COLUMN     "seedKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "subject_seedKey_key" ON "subject"("seedKey");
