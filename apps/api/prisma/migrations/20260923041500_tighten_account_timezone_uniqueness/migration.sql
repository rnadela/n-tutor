-- DropIndex
DROP INDEX "account_timezone_parentAccountId_effectiveFrom_idx";

-- DropIndex
DROP INDEX "parent_account_email_idx";

-- CreateIndex
CREATE UNIQUE INDEX "account_timezone_parentAccountId_effectiveFrom_key" ON "account_timezone"("parentAccountId", "effectiveFrom");

