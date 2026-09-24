-- DropForeignKey
ALTER TABLE "generation_job" DROP CONSTRAINT "generation_job_sourceTestId_fkey";

-- DropForeignKey
ALTER TABLE "practice_test" DROP CONSTRAINT "practice_test_sourceTestId_fkey";

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "source_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_test" ADD CONSTRAINT "practice_test_sourceTestId_fkey" FOREIGN KEY ("sourceTestId") REFERENCES "source_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
