-- AlterTable
ALTER TABLE "source_test" ADD COLUMN     "gradeLevelId" TEXT,
ADD COLUMN     "subjectId" TEXT;

-- CreateIndex
CREATE INDEX "source_test_gradeLevelId_idx" ON "source_test"("gradeLevelId");

-- AddForeignKey
ALTER TABLE "source_test" ADD CONSTRAINT "source_test_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_test" ADD CONSTRAINT "source_test_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "grade_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
