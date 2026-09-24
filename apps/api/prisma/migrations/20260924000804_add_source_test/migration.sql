-- CreateEnum
CREATE TYPE "source_test_status" AS ENUM ('Draft', 'Submitted');

-- CreateEnum
CREATE TYPE "page_image_state" AS ENUM ('Uploading', 'Ready');

-- CreateTable
CREATE TABLE "source_test" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "status" "source_test_status" NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "source_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_image" (
    "id" TEXT NOT NULL,
    "sourceTestId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "state" "page_image_state" NOT NULL DEFAULT 'Uploading',
    "storagePath" TEXT,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_test_parentAccountId_studentProfileId_status_idx" ON "source_test"("parentAccountId", "studentProfileId", "status");

-- CreateIndex
CREATE INDEX "source_test_expiresAt_idx" ON "source_test"("expiresAt");

-- CreateIndex
CREATE INDEX "page_image_sourceTestId_idx" ON "page_image"("sourceTestId");

-- CreateIndex
CREATE UNIQUE INDEX "page_image_sourceTestId_ordinal_key" ON "page_image"("sourceTestId", "ordinal");

-- AddForeignKey
ALTER TABLE "source_test" ADD CONSTRAINT "source_test_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_test" ADD CONSTRAINT "source_test_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_image" ADD CONSTRAINT "page_image_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "source_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One live draft per child, enforced rather than intended.
--
-- Prisma's schema language cannot express a partial index, so this is written
-- by hand and the model carries a doc comment pointing at it. Without it, two
-- concurrent opens — a double-tap, or a second tab — both find no draft and both
-- create one, and the read's `ORDER BY "createdAt" DESC` then silently strands
-- the older one with its pages still attached to it.
--
-- Partial on `status = 'Draft'` on purpose: a child may accumulate any number of
-- Submitted Source Tests, and only the uncommitted one is a singleton.
CREATE UNIQUE INDEX "source_test_one_draft_per_student" ON "source_test" ("parentAccountId", "studentProfileId") WHERE "status" = 'Draft';
