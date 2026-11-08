-- AlterEnum
ALTER TYPE "OutboxEventKind" ADD VALUE 'DIPLOMAS_PUBLISHED';

-- CreateTable
CREATE TABLE "DiplomaBatch" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "archiveHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMPTZ(3),
    "selectionHash" CHAR(64),
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DiplomaBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiplomaItem" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "participationId" UUID,
    "error" TEXT,
    "fileKey" UUID,
    "fileHash" CHAR(64),
    "size" INTEGER,
    "pages" INTEGER,
    "inspectedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DiplomaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiplomaDocument" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentVersionId" UUID,

    CONSTRAINT "DiplomaDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiplomaVersion" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "baseRevision" INTEGER NOT NULL,

    CONSTRAINT "DiplomaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiplomaBatch_editionId_createdAt_idx" ON "DiplomaBatch"("editionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaBatch_id_editionId_key" ON "DiplomaBatch"("id", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaItem_batchId_ordinal_key" ON "DiplomaItem"("batchId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaItem_id_editionId_key" ON "DiplomaItem"("id", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaDocument_currentVersionId_key" ON "DiplomaDocument"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaDocument_currentVersionId_id_key" ON "DiplomaDocument"("currentVersionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaDocument_id_editionId_key" ON "DiplomaDocument"("id", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaVersion_itemId_key" ON "DiplomaVersion"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaVersion_itemId_editionId_key" ON "DiplomaVersion"("itemId", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaVersion_id_documentId_key" ON "DiplomaVersion"("id", "documentId");

-- AddForeignKey
ALTER TABLE "DiplomaBatch" ADD CONSTRAINT "DiplomaBatch_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaBatch" ADD CONSTRAINT "DiplomaBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaItem" ADD CONSTRAINT "DiplomaItem_batchId_editionId_fkey" FOREIGN KEY ("batchId", "editionId") REFERENCES "DiplomaBatch"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaItem" ADD CONSTRAINT "DiplomaItem_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaItem" ADD CONSTRAINT "DiplomaItem_participationId_editionId_fkey" FOREIGN KEY ("participationId", "editionId") REFERENCES "Participation"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaDocument" ADD CONSTRAINT "DiplomaDocument_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaDocument" ADD CONSTRAINT "DiplomaDocument_participationId_editionId_fkey" FOREIGN KEY ("participationId", "editionId") REFERENCES "Participation"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaDocument" ADD CONSTRAINT "DiplomaDocument_currentVersionId_id_fkey" FOREIGN KEY ("currentVersionId", "id") REFERENCES "DiplomaVersion"("id", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaVersion" ADD CONSTRAINT "DiplomaVersion_documentId_editionId_fkey" FOREIGN KEY ("documentId", "editionId") REFERENCES "DiplomaDocument"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaVersion" ADD CONSTRAINT "DiplomaVersion_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaVersion" ADD CONSTRAINT "DiplomaVersion_itemId_editionId_fkey" FOREIGN KEY ("itemId", "editionId") REFERENCES "DiplomaItem"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiplomaItem" ADD CONSTRAINT "DiplomaItem_ready_check" CHECK (
 "error" IS NOT NULL OR ("participationId" IS NOT NULL AND "fileKey" IS NOT NULL AND "fileHash" IS NOT NULL AND "size" BETWEEN 1 AND 10485760 AND "pages" BETWEEN 1 AND 100 AND "inspectedAt" IS NOT NULL)
);
ALTER TABLE "DiplomaBatch" ADD CONSTRAINT "DiplomaBatch_steps_check" CHECK (("appliedAt" IS NULL) = ("selectionHash" IS NULL) AND ("publishedAt" IS NULL OR "appliedAt" IS NOT NULL));
CREATE TRIGGER diploma_item_immutable BEFORE UPDATE OR DELETE ON "DiplomaItem" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE TRIGGER diploma_version_immutable BEFORE UPDATE OR DELETE ON "DiplomaVersion" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE FUNCTION protect_diploma_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Diploma batch is retained'; END IF;
 IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."editionId" IS DISTINCT FROM OLD."editionId" OR NEW."actorId" IS DISTINCT FROM OLD."actorId" OR NEW."archiveHash" IS DISTINCT FROM OLD."archiveHash" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
 OR (OLD."appliedAt" IS NOT NULL AND (NEW."appliedAt" IS DISTINCT FROM OLD."appliedAt" OR NEW."selectionHash" IS DISTINCT FROM OLD."selectionHash"))
 OR (OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt") THEN RAISE EXCEPTION 'Diploma batch identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER diploma_batch_guard BEFORE UPDATE OR DELETE ON "DiplomaBatch" FOR EACH ROW EXECUTE FUNCTION protect_diploma_batch();
CREATE FUNCTION validate_diploma_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; source UUID;
BEGIN
 SELECT "participationId" INTO target FROM "DiplomaDocument" WHERE "id"=NEW."documentId";
 SELECT "participationId" INTO source FROM "DiplomaItem" WHERE "id"=NEW."itemId" AND "error" IS NULL;
 IF target IS NULL OR source IS DISTINCT FROM target THEN RAISE EXCEPTION 'Diploma owner mismatch'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER diploma_version_owner BEFORE INSERT ON "DiplomaVersion" FOR EACH ROW EXECUTE FUNCTION validate_diploma_version();
