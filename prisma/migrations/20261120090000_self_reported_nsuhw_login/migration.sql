-- Existing logins (including formerly pending ones) remain available immediately.
-- No external ownership approval is performed by this application.
ALTER TABLE "LegacyNsuhwClaim" DROP CONSTRAINT "LegacyNsuhwClaim_state_check";
DROP INDEX "LegacyNsuhwClaim_approved_login_key";
DROP INDEX "LegacyNsuhwClaim_approvedAt_createdAt_idx";
ALTER TABLE "LegacyNsuhwClaim"
  DROP COLUMN "approvedAt", DROP COLUMN "approvedById", DROP COLUMN "approvedEditionId";
CREATE INDEX "LegacyNsuhwClaim_login_idx" ON "LegacyNsuhwClaim"("login");
