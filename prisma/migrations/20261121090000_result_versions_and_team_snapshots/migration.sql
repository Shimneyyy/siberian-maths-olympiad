-- CreateEnum
CREATE TYPE "ResultReleaseAction" AS ENUM ('PUBLISH', 'REVOKE');

-- CreateTable
CREATE TABLE "ResultDocument" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "sourceResultId" UUID,
    "kind" "ResultKind" NOT NULL,
    "teamKey" UUID,
    "teamName" TEXT,
    "teamBatchId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentVersionId" UUID,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ResultDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultVersion" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "scores" JSONB NOT NULL,
    "total" INTEGER,
    "prize" VARCHAR(200),
    "reason" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultRecipient" (
    "documentId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "courseLabel" TEXT NOT NULL,
    "universityName" TEXT NOT NULL,

    CONSTRAINT "ResultRecipient_pkey" PRIMARY KEY ("documentId","participationId")
);

-- CreateTable
CREATE TABLE "ResultRelease" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" "ResultReleaseAction" NOT NULL,
    "reason" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamResultImport" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "kind" "ResultKind" NOT NULL,
    "actorId" UUID NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamResultImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResultDocument_sourceResultId_key" ON "ResultDocument"("sourceResultId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultDocument_currentVersionId_key" ON "ResultDocument"("currentVersionId");

-- CreateIndex
CREATE INDEX "ResultDocument_editionId_kind_idx" ON "ResultDocument"("editionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ResultDocument_id_editionId_key" ON "ResultDocument"("id", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultDocument_teamKey_kind_key" ON "ResultDocument"("teamKey", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ResultDocument_sourceResultId_editionId_key" ON "ResultDocument"("sourceResultId", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultDocument_currentVersionId_id_key" ON "ResultDocument"("currentVersionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ResultVersion_id_documentId_key" ON "ResultVersion"("id", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultVersion_id_editionId_key" ON "ResultVersion"("id", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultVersion_documentId_number_key" ON "ResultVersion"("documentId", "number");

-- CreateIndex
CREATE INDEX "ResultRecipient_participationId_idx" ON "ResultRecipient"("participationId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultRelease_documentId_revision_key" ON "ResultRelease"("documentId", "revision");

-- CreateIndex
CREATE INDEX "TeamResultImport_editionId_createdAt_idx" ON "TeamResultImport"("editionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamResultImport_id_editionId_kind_key" ON "TeamResultImport"("id", "editionId", "kind");

-- AddForeignKey
ALTER TABLE "ResultDocument" ADD CONSTRAINT "ResultDocument_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultDocument" ADD CONSTRAINT "ResultDocument_sourceResultId_editionId_fkey" FOREIGN KEY ("sourceResultId", "editionId") REFERENCES "IndividualResult"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultDocument" ADD CONSTRAINT "ResultDocument_teamBatchId_editionId_kind_fkey" FOREIGN KEY ("teamBatchId", "editionId", "kind") REFERENCES "TeamResultImport"("id", "editionId", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultDocument" ADD CONSTRAINT "ResultDocument_currentVersionId_id_fkey" FOREIGN KEY ("currentVersionId", "id") REFERENCES "ResultVersion"("id", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultVersion" ADD CONSTRAINT "ResultVersion_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultVersion" ADD CONSTRAINT "ResultVersion_documentId_editionId_fkey" FOREIGN KEY ("documentId", "editionId") REFERENCES "ResultDocument"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultVersion" ADD CONSTRAINT "ResultVersion_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRecipient" ADD CONSTRAINT "ResultRecipient_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRecipient" ADD CONSTRAINT "ResultRecipient_documentId_editionId_fkey" FOREIGN KEY ("documentId", "editionId") REFERENCES "ResultDocument"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRecipient" ADD CONSTRAINT "ResultRecipient_participationId_editionId_fkey" FOREIGN KEY ("participationId", "editionId") REFERENCES "Participation"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRelease" ADD CONSTRAINT "ResultRelease_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRelease" ADD CONSTRAINT "ResultRelease_documentId_editionId_fkey" FOREIGN KEY ("documentId", "editionId") REFERENCES "ResultDocument"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRelease" ADD CONSTRAINT "ResultRelease_versionId_documentId_fkey" FOREIGN KEY ("versionId", "documentId") REFERENCES "ResultVersion"("id", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRelease" ADD CONSTRAINT "ResultRelease_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamResultImport" ADD CONSTRAINT "TeamResultImport_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamResultImport" ADD CONSTRAINT "TeamResultImport_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill every original import without changing its immutable rows.
INSERT INTO "ResultDocument" ("id","editionId","sourceResultId","kind")
 SELECT "id","editionId","id","kind" FROM "IndividualResult";
INSERT INTO "ResultVersion" ("id","documentId","editionId","actorId","number","scores","total","prize")
 SELECT gen_random_uuid(),r."id",r."editionId",b."actorId",1,
 COALESCE((SELECT jsonb_agg(s."score" ORDER BY p."ordinal") FROM "ResultProblemScore" s JOIN "EditionProblem" p ON p."id"=s."problemId" WHERE s."resultId"=r."id"),'[]'::jsonb),r."total",r."prize"
 FROM "IndividualResult" r JOIN "ResultImportBatch" b ON b."id"=r."batchId";
INSERT INTO "ResultRecipient" ("documentId","editionId","participationId","fullName","courseLabel","universityName")
 SELECT r."id",r."editionId",p."id",p."fullName",p."courseLabel",p."universityName" FROM "IndividualResult" r JOIN "Participation" p ON p."id"=r."participationId";
INSERT INTO "ResultRelease" ("id","documentId","editionId","versionId","actorId","revision","action","createdAt")
 SELECT gen_random_uuid(),r."id",r."editionId",v."id",pub."actorId",1,'PUBLISH',pub."publishedAt"
 FROM "IndividualResult" r JOIN "ResultVersion" v ON v."documentId"=r."id" JOIN "ResultPublication" pub ON pub."batchId"=r."batchId";
UPDATE "ResultDocument" d SET "currentVersionId"=x."versionId","revision"=1 FROM "ResultRelease" x WHERE x."documentId"=d."id";
CREATE FUNCTION valid_result_scores(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value)='array' AND jsonb_array_length(value) BETWEEN 1 AND 50
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value) x WHERE x<>'null'::jsonb AND (jsonb_typeof(x)<>'number' OR x::text !~ '^[0-9]+$' OR (x::text)::numeric>2147483647));
$$;
ALTER TABLE "ResultVersion" ADD CONSTRAINT "ResultVersion_content_check" CHECK(valid_result_scores("scores") AND "number">=1 AND ("total" IS NULL OR "total">=0) AND ("number"=1 OR ("reason" IS NOT NULL AND length(trim("reason"))>=3)));
ALTER TABLE "ResultDocument" ADD CONSTRAINT "ResultDocument_subject_check" CHECK("revision">=0 AND (("sourceResultId" IS NOT NULL AND "teamKey" IS NULL AND "teamBatchId" IS NULL) OR ("sourceResultId" IS NULL AND "teamKey" IS NOT NULL AND "teamBatchId" IS NOT NULL AND "teamName" IS NOT NULL AND length(trim("teamName"))>0)) AND (NOT "withdrawn" OR "currentVersionId" IS NOT NULL));
ALTER TABLE "ResultRelease" ADD CONSTRAINT "ResultRelease_reason_check" CHECK("revision">0 AND ("action"<>'REVOKE' OR ("reason" IS NOT NULL AND length(trim("reason"))>=3)));
ALTER TABLE "TeamResultImport" ADD CONSTRAINT "TeamResultImport_counts_check" CHECK("importedCount">=0 AND "rejectedCount">=0);
CREATE TRIGGER result_version_immutable BEFORE UPDATE OR DELETE ON "ResultVersion" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE TRIGGER result_recipient_immutable BEFORE UPDATE OR DELETE ON "ResultRecipient" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE TRIGGER result_release_immutable BEFORE UPDATE OR DELETE ON "ResultRelease" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE TRIGGER team_result_import_immutable BEFORE UPDATE OR DELETE ON "TeamResultImport" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE FUNCTION guard_result_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Result document retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."sourceResultId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "IndividualResult" r WHERE r."id"=NEW."sourceResultId" AND r."editionId"=NEW."editionId" AND r."kind"=NEW."kind") THEN RAISE EXCEPTION 'Result subject mismatch'; END IF;
  IF NEW."teamKey" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Team" t WHERE t."id"=NEW."teamKey" AND t."editionId"=NEW."editionId") THEN RAISE EXCEPTION 'Team subject mismatch'; END IF;
  IF NEW."currentVersionId" IS NOT NULL OR NEW."withdrawn" OR NEW."revision"<>0 THEN RAISE EXCEPTION 'Result must start unpublished'; END IF;
 ELSE
  IF ROW(NEW."id",NEW."editionId",NEW."sourceResultId",NEW."kind",NEW."teamKey",NEW."teamName",NEW."teamBatchId") IS DISTINCT FROM ROW(OLD."id",OLD."editionId",OLD."sourceResultId",OLD."kind",OLD."teamKey",OLD."teamName",OLD."teamBatchId") OR NEW."revision"<>OLD."revision"+1 THEN RAISE EXCEPTION 'Result identity/revision mismatch'; END IF;
  IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId" OR NEW."withdrawn" IS DISTINCT FROM OLD."withdrawn" THEN
   IF NOT EXISTS(SELECT 1 FROM "ResultRelease" x WHERE x."documentId"=NEW."id" AND x."revision"=NEW."revision" AND x."versionId"=NEW."currentVersionId" AND x."action"=CASE WHEN NEW."withdrawn" THEN 'REVOKE'::"ResultReleaseAction" ELSE 'PUBLISH'::"ResultReleaseAction" END) THEN RAISE EXCEPTION 'Explicit result release required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER result_document_guard BEFORE INSERT OR UPDATE OR DELETE ON "ResultDocument" FOR EACH ROW EXECUTE FUNCTION guard_result_document();
CREATE FUNCTION guard_result_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "ResultDocument" d LEFT JOIN "IndividualResult" r ON r."id"=d."sourceResultId" WHERE d."id"=NEW."documentId" AND ((d."sourceResultId" IS NOT NULL AND r."participationId"=NEW."participationId") OR (d."teamKey" IS NOT NULL AND EXISTS(SELECT 1 FROM "TeamMember" m WHERE m."teamId"=d."teamKey" AND m."participationId"=NEW."participationId")))) THEN RAISE EXCEPTION 'Recipient not in result subject'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER result_recipient_subject BEFORE INSERT ON "ResultRecipient" FOR EACH ROW EXECUTE FUNCTION guard_result_recipient();
