CREATE TABLE "NsuhwImportBatch" (
 "id" UUID PRIMARY KEY, "editionId" UUID NOT NULL, "actorId" UUID NOT NULL,
 "sourceMac" CHAR(64) NOT NULL, "importedCount" INTEGER NOT NULL, "rejectedCount" INTEGER NOT NULL,
 "report" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "NsuhwImportBatch_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "NsuhwImportBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "NsuhwImportBatch_counts_check" CHECK ("importedCount" > 0 AND "rejectedCount" >= 0 AND "importedCount" + "rejectedCount" <= 1000 AND jsonb_typeof("report") = 'array' AND jsonb_array_length("report") = "importedCount" + "rejectedCount")
);
CREATE INDEX "NsuhwImportBatch_editionId_createdAt_idx" ON "NsuhwImportBatch"("editionId", "createdAt");
CREATE FUNCTION protect_nsuhw_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Account import is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "NsuhwImportBatch_immutable" BEFORE UPDATE OR DELETE ON "NsuhwImportBatch" FOR EACH ROW EXECUTE FUNCTION protect_nsuhw_import();
