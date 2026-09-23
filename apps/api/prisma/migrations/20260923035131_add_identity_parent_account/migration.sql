-- CreateEnum
CREATE TYPE "account_tier" AS ENUM ('Free', 'Plus', 'Family', 'Internal');

-- CreateTable
CREATE TABLE "parent_account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "tier" "account_tier" NOT NULL DEFAULT 'Free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parent_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_timezone" (
    "id" TEXT NOT NULL,
    "parentAccountId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_timezone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parent_account_email_key" ON "parent_account"("email");

-- CreateIndex
CREATE INDEX "parent_account_email_idx" ON "parent_account"("email");

-- CreateIndex
CREATE INDEX "account_timezone_parentAccountId_effectiveFrom_idx" ON "account_timezone"("parentAccountId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "account_timezone" ADD CONSTRAINT "account_timezone_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "parent_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
