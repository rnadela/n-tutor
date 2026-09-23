-- AlterTable
ALTER TABLE "parent_account" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "sessionEpoch" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "account_consent" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_consent_parentAccountId_idx" ON "account_consent"("parentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokenHash_key" ON "password_reset"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_parentAccountId_idx" ON "password_reset"("parentAccountId");

-- AddForeignKey
ALTER TABLE "account_consent" ADD CONSTRAINT "account_consent_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
