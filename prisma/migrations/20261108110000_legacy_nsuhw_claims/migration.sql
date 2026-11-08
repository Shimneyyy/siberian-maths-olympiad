CREATE TABLE "LegacyNsuhwClaim" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "login" VARCHAR(254) NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "approvedAt" TIMESTAMPTZ(3), "approvedById" UUID, "approvedEditionId" UUID,
 CONSTRAINT "LegacyNsuhwClaim_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LegacyNsuhwClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LegacyNsuhwClaim_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LegacyNsuhwClaim_approvedEditionId_fkey" FOREIGN KEY ("approvedEditionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LegacyNsuhwClaim_state_check" CHECK (("approvedAt" IS NULL AND "approvedById" IS NULL AND "approvedEditionId" IS NULL) OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "approvedEditionId" IS NOT NULL)),
 CONSTRAINT "LegacyNsuhwClaim_login_check" CHECK (length(trim("login")) > 0 AND "revision" >= 0)
);
CREATE UNIQUE INDEX "LegacyNsuhwClaim_userId_key" ON "LegacyNsuhwClaim"("userId");
-- Pending declarations do not reserve a login or disclose another user's account.
CREATE UNIQUE INDEX "LegacyNsuhwClaim_approved_login_key" ON "LegacyNsuhwClaim"("login") WHERE "approvedAt" IS NOT NULL;
CREATE INDEX "LegacyNsuhwClaim_approvedAt_createdAt_idx" ON "LegacyNsuhwClaim"("approvedAt", "createdAt");
