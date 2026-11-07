-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "targetParticipationId" UUID NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainTransfer" (
    "teamId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "universityId" UUID NOT NULL,
    "targetParticipationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaptainTransfer_pkey" PRIMARY KEY ("teamId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvitation_teamId_targetParticipationId_key" ON "TeamInvitation"("teamId", "targetParticipationId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainTransfer_teamId_editionId_universityId_key" ON "CaptainTransfer"("teamId", "editionId", "universityId");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_id_editionId_key" ON "Participation"("id", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_editionId_key" ON "Team"("id", "editionId");

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_editionId_fkey" FOREIGN KEY ("teamId", "editionId") REFERENCES "Team"("id", "editionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_targetParticipationId_editionId_fkey" FOREIGN KEY ("targetParticipationId", "editionId") REFERENCES "Participation"("id", "editionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainTransfer" ADD CONSTRAINT "CaptainTransfer_teamId_editionId_universityId_fkey" FOREIGN KEY ("teamId", "editionId", "universityId") REFERENCES "Team"("id", "editionId", "universityId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainTransfer" ADD CONSTRAINT "CaptainTransfer_targetParticipationId_editionId_university_fkey" FOREIGN KEY ("targetParticipationId", "editionId", "universityId") REFERENCES "Participation"("id", "editionId", "universityId") ON DELETE CASCADE ON UPDATE CASCADE;

