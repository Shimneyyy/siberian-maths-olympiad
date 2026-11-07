-- CreateEnum
CREATE TYPE "OutboxEventKind" AS ENUM ('ANNOUNCEMENT', 'MAIL_BATCH', 'TRANSFER');

-- CreateEnum
CREATE TYPE "OutboxJobStatus" AS ENUM ('READY', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "kind" "OutboxEventKind" NOT NULL,
    "sourceId" UUID NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "editionVenueId" UUID,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "status" "OutboxJobStatus" NOT NULL DEFAULT 'READY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseToken" UUID,
    "lastErrorCode" VARCHAR(80),
    "providerMessageId" VARCHAR(500),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_kind_sourceId_sourceRevision_key" ON "OutboxEvent"("kind", "sourceId", "sourceRevision");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_id_editionId_key" ON "OutboxEvent"("id", "editionId");

-- CreateIndex
CREATE INDEX "OutboxJob_status_availableAt_idx" ON "OutboxJob"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxJob_eventId_participationId_key" ON "OutboxJob"("eventId", "participationId");

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_editionVenueId_editionId_fkey" FOREIGN KEY ("editionVenueId", "editionId") REFERENCES "EditionVenue"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_eventId_editionId_fkey" FOREIGN KEY ("eventId", "editionId") REFERENCES "OutboxEvent"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_participationId_editionId_fkey" FOREIGN KEY ("participationId", "editionId") REFERENCES "Participation"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_revision_check" CHECK ("sourceRevision" >= 0);
ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_attempts_check" CHECK ("attempts" >= 0),
 ADD CONSTRAINT "OutboxJob_lease_check" CHECK (
 ("status" = 'PROCESSING' AND "leaseUntil" IS NOT NULL AND "leaseToken" IS NOT NULL) OR
 ("status" <> 'PROCESSING' AND "leaseUntil" IS NULL AND "leaseToken" IS NULL));
