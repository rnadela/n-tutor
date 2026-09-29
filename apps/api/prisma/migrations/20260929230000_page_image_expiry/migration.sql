-- AlterEnum
ALTER TYPE "page_image_state" ADD VALUE 'Deleted';

-- AlterTable
ALTER TABLE "page_image" ADD COLUMN     "bytesDeletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "page_image_state_idx" ON "page_image"("state");
