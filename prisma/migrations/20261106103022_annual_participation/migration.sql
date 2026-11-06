-- CreateEnum
CREATE TYPE "ParticipationFormat" AS ENUM ('ONSITE', 'REMOTE');

-- CreateEnum
CREATE TYPE "RemoteZone" AS ENUM ('MSK', 'NSK');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('REGISTERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "EditionVenue" ADD COLUMN     "label" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OlympiadEdition" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationClosesAt" TIMESTAMPTZ(3),
ADD COLUMN     "registrationManuallyClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationOpensAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Participation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "format" "ParticipationFormat" NOT NULL,
    "editionVenueId" UUID,
    "remoteZone" "RemoteZone",
    "status" "ParticipationStatus" NOT NULL DEFAULT 'REGISTERED',
    "fullName" TEXT NOT NULL,
    "universityId" UUID NOT NULL,
    "universityName" TEXT NOT NULL,
    "universityAbbreviation" TEXT NOT NULL,
    "courseId" UUID NOT NULL,
    "courseLabel" TEXT NOT NULL,
    "consentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Participation_editionId_editionVenueId_id_idx" ON "Participation"("editionId", "editionVenueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_userId_editionId_key" ON "Participation"("userId", "editionId");

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_editionVenueId_editionId_fkey" FOREIGN KEY ("editionVenueId", "editionId") REFERENCES "EditionVenue"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "CourseOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one current edition, including concurrent requests.
CREATE UNIQUE INDEX "OlympiadEdition_one_current" ON "OlympiadEdition" ((true)) WHERE "isCurrent" = true;
ALTER TABLE "OlympiadEdition" ADD CONSTRAINT "OlympiadEdition_registration_window_check" CHECK (
  ("registrationOpensAt" IS NULL AND "registrationClosesAt" IS NULL) OR
  ("registrationOpensAt" IS NOT NULL AND "registrationClosesAt" IS NOT NULL AND "registrationOpensAt" < "registrationClosesAt")
);
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_format_check" CHECK (
  ("format" = 'ONSITE' AND "editionVenueId" IS NOT NULL AND "remoteZone" IS NULL) OR
  ("format" = 'REMOTE' AND "editionVenueId" IS NULL AND "remoteZone" IS NOT NULL)
);
