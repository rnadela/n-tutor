-- CreateEnum
CREATE TYPE "practice_test_status" AS ENUM ('Draft', 'Released', 'Discarded');

-- CreateEnum
CREATE TYPE "generation_job_status" AS ENUM ('Queued', 'Running', 'Succeeded', 'PartiallyComplete', 'Failed');

-- CreateTable
CREATE TABLE "generation_job" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "sourceTestId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "producedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "generation_job_status" NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "failureKind" "ai_failure_kind",
    "failureReason" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_test" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "sourceTestId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "generationJobId" TEXT NOT NULL,
    "status" "practice_test_status" NOT NULL DEFAULT 'Draft',
    "ordinal" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "chargedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_test_question" (
    "id" TEXT NOT NULL,
    "practiceTestId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "format" "question_format" NOT NULL,
    "prompt" JSONB NOT NULL,
    "answer" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_test_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_test_choice" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_test_choice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_test_question_topic" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_test_question_topic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_job_status_createdAt_idx" ON "generation_job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "generation_job_parentAccountId_sourceTestId_createdAt_idx" ON "generation_job"("parentAccountId", "sourceTestId", "createdAt");

-- CreateIndex
CREATE INDEX "practice_test_parentAccountId_chargedAt_idx" ON "practice_test"("parentAccountId", "chargedAt");

-- CreateIndex
CREATE INDEX "practice_test_sourceTestId_idx" ON "practice_test"("sourceTestId");

-- CreateIndex
CREATE INDEX "practice_test_studentProfileId_idx" ON "practice_test"("studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_test_generationJobId_ordinal_key" ON "practice_test"("generationJobId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "practice_test_question_practiceTestId_ordinal_key" ON "practice_test_question"("practiceTestId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "practice_test_choice_questionId_ordinal_key" ON "practice_test_choice"("questionId", "ordinal");

-- CreateIndex
CREATE INDEX "practice_test_question_topic_questionId_idx" ON "practice_test_question_topic"("questionId");

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "source_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test" ADD CONSTRAINT "practice_test_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test" ADD CONSTRAINT "practice_test_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "source_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test" ADD CONSTRAINT "practice_test_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test" ADD CONSTRAINT "practice_test_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test_question" ADD CONSTRAINT "practice_test_question_practiceTestId_fkey" FOREIGN KEY ("practiceTestId") REFERENCES "practice_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test_choice" ADD CONSTRAINT "practice_test_choice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "practice_test_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test_question_topic" ADD CONSTRAINT "practice_test_question_topic_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "practice_test_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
