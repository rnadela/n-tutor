-- CreateTable
CREATE TABLE "student_profile" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "gradeLevelId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_profile_parentAccountId_archivedAt_idx" ON "student_profile"("parentAccountId", "archivedAt");

-- CreateIndex
CREATE INDEX "student_profile_gradeLevelId_idx" ON "student_profile"("gradeLevelId");

-- AddForeignKey
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "grade_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
