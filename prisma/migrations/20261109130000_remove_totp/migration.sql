-- Retire second factors without changing accounts, passwords, grants or sessions.
DROP TABLE "TwoFactor";
ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
