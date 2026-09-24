-- CreateEnum
CREATE TYPE "ai_call_class" AS ENUM ('Extraction', 'Generation', 'Grading', 'Explanation', 'Legibility', 'TopicNormalization');

-- CreateEnum
CREATE TYPE "extraction_job_status" AS ENUM ('Queued', 'Running', 'Succeeded', 'Failed');

-- CreateEnum
CREATE TYPE "ai_failure_kind" AS ENUM ('UpstreamFault', 'ClientFault');

-- CreateEnum
CREATE TYPE "question_format" AS ENUM ('MultipleChoice', 'FillInTheBlank', 'ShortAnswer');

-- CreateEnum
CREATE TYPE "extraction_confidence" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "extracted_context_kind" AS ENUM ('Passage', 'DataTable');

-- CreateEnum
CREATE TYPE "uninterpretable_kind" AS ENUM ('Diagram', 'Handwriting', 'Cropped', 'Other');

-- CreateTable
CREATE TABLE "ai_call" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "callClass" "ai_call_class" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicros" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_job" (
    "id" TEXT NOT NULL,
    "sourceTestId" TEXT NOT NULL,
    "status" "extraction_job_status" NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "failureKind" "ai_failure_kind",
    "failureReason" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extraction_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction" (
    "id" TEXT NOT NULL,
    "sourceTestId" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_context" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "extracted_context_kind" NOT NULL,
    "body" JSONB NOT NULL,
    "startPageOrdinal" INTEGER NOT NULL,
    "endPageOrdinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_context_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_question" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "pageOrdinal" INTEGER NOT NULL,
    "format" "question_format" NOT NULL,
    "prompt" JSONB NOT NULL,
    "confidence" "extraction_confidence" NOT NULL,
    "dependsOnUninterpretable" BOOLEAN NOT NULL,
    "usable" BOOLEAN NOT NULL,
    "contextId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_choice" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_choice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_topic_label" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" "extraction_confidence" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_topic_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uninterpretable_region" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "pageOrdinal" INTEGER NOT NULL,
    "kind" "uninterpretable_kind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uninterpretable_region_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_call_parentAccountId_createdAt_idx" ON "ai_call"("parentAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_call_createdAt_idx" ON "ai_call"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_job_sourceTestId_key" ON "extraction_job"("sourceTestId");

-- CreateIndex
CREATE INDEX "extraction_job_status_createdAt_idx" ON "extraction_job"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_sourceTestId_key" ON "extraction"("sourceTestId");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_context_extractionId_ordinal_key" ON "extracted_context"("extractionId", "ordinal");

-- CreateIndex
CREATE INDEX "extracted_question_extractionId_usable_idx" ON "extracted_question"("extractionId", "usable");

-- CreateIndex
CREATE INDEX "extracted_question_contextId_idx" ON "extracted_question"("contextId");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_question_extractionId_ordinal_key" ON "extracted_question"("extractionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_choice_questionId_ordinal_key" ON "extracted_choice"("questionId", "ordinal");

-- CreateIndex
CREATE INDEX "extracted_topic_label_questionId_idx" ON "extracted_topic_label"("questionId");

-- CreateIndex
CREATE INDEX "uninterpretable_region_extractionId_idx" ON "uninterpretable_region"("extractionId");

-- AddForeignKey
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_job" ADD CONSTRAINT "extraction_job_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "source_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction" ADD CONSTRAINT "extraction_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "source_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_context" ADD CONSTRAINT "extracted_context_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_question" ADD CONSTRAINT "extracted_question_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_question" ADD CONSTRAINT "extracted_question_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "extracted_context"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_choice" ADD CONSTRAINT "extracted_choice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "extracted_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_topic_label" ADD CONSTRAINT "extracted_topic_label_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "extracted_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uninterpretable_region" ADD CONSTRAINT "uninterpretable_region_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "extraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
