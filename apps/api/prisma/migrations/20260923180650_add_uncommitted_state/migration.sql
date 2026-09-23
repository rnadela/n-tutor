-- CreateEnum
CREATE TYPE "uncommitted_state_kind" AS ENUM ('DraftEdit', 'GradeOverride', 'PartialUpload');

-- CreateTable
CREATE TABLE "uncommitted_state" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "kind" "uncommitted_state_kind" NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uncommitted_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uncommitted_state_expiresAt_idx" ON "uncommitted_state"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "uncommitted_state_parentAccountId_studentProfileId_kind_sco_key" ON "uncommitted_state"("parentAccountId", "studentProfileId", "kind", "scope");

-- AddForeignKey
ALTER TABLE "uncommitted_state" ADD CONSTRAINT "uncommitted_state_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uncommitted_state" ADD CONSTRAINT "uncommitted_state_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
