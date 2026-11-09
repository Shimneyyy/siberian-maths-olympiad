CREATE TABLE "ConsentWithdrawalRequest" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMPTZ(3),
 CONSTRAINT "ConsentWithdrawalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ConsentWithdrawalRequest_dates_check" CHECK ("reviewedAt" IS NULL OR "reviewedAt" >= "createdAt")
);
CREATE INDEX "ConsentWithdrawalRequest_userId_createdAt_idx" ON "ConsentWithdrawalRequest"("userId", "createdAt");
CREATE UNIQUE INDEX "ConsentWithdrawalRequest_one_pending" ON "ConsentWithdrawalRequest"("userId") WHERE "reviewedAt" IS NULL;
