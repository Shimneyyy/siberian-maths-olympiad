CREATE TABLE "PreparedExternalAccount" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "login" VARCHAR(254) NOT NULL,
 "credentialVersion" INTEGER NOT NULL DEFAULT 1, "keyVersion" VARCHAR(64) NOT NULL,
 "secretEnvelope" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "PreparedExternalAccount_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PreparedExternalAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "PreparedExternalAccount_version_check" CHECK ("credentialVersion" > 0 AND "revision" >= 0 AND length("login") > 0)
);
CREATE UNIQUE INDEX "PreparedExternalAccount_userId_key" ON "PreparedExternalAccount"("userId");
CREATE UNIQUE INDEX "PreparedExternalAccount_login_key" ON "PreparedExternalAccount"("login");
CREATE INDEX "PreparedExternalAccount_keyVersion_idx" ON "PreparedExternalAccount"("keyVersion");
