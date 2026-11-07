ALTER TABLE "StudentProfile" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0);
ALTER TABLE "Participation" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0);
CREATE TABLE "ParticipationCorrection" (
 "id" UUID PRIMARY KEY,
 "participationId" UUID NOT NULL REFERENCES "Participation"("id") ON DELETE CASCADE,
 "actorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
