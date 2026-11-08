ALTER TYPE "OutboxEventKind" ADD VALUE 'EXTERNAL_ACCOUNT_READY';
ALTER TABLE "PreparedExternalAccount" ADD COLUMN "confirmedAt" TIMESTAMPTZ(3), ADD COLUMN "confirmedById" UUID, ADD COLUMN "confirmedEditionId" UUID;
ALTER TABLE "PreparedExternalAccount" ADD CONSTRAINT "PreparedExternalAccount_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PreparedExternalAccount" ADD CONSTRAINT "PreparedExternalAccount_confirmedEditionId_fkey" FOREIGN KEY ("confirmedEditionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PreparedExternalAccount" ADD CONSTRAINT "PreparedExternalAccount_confirmation_check" CHECK (("confirmedAt" IS NULL AND "confirmedById" IS NULL AND "confirmedEditionId" IS NULL) OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL AND "confirmedEditionId" IS NOT NULL));
CREATE TABLE "NsuhwExportBatch" (
 "id" UUID NOT NULL, "editionId" UUID NOT NULL, "actorId" UUID NOT NULL, "items" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "confirmedAt" TIMESTAMPTZ(3), "confirmedById" UUID,
 CONSTRAINT "NsuhwExportBatch_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "NsuhwExportBatch_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "NsuhwExportBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "NsuhwExportBatch_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "NsuhwExportBatch_items_check" CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") > 0),
 CONSTRAINT "NsuhwExportBatch_confirmation_check" CHECK (("confirmedAt" IS NULL) = ("confirmedById" IS NULL))
);
CREATE INDEX "NsuhwExportBatch_editionId_createdAt_idx" ON "NsuhwExportBatch"("editionId", "createdAt");
CREATE FUNCTION protect_nsuhw_export_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."confirmedAt" IS NOT NULL OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."editionId" IS DISTINCT FROM OLD."editionId" OR NEW."actorId" IS DISTINCT FROM OLD."actorId" OR NEW."items" IS DISTINCT FROM OLD."items" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
  RAISE EXCEPTION 'Export source is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "NsuhwExportBatch_source_immutable" BEFORE UPDATE ON "NsuhwExportBatch" FOR EACH ROW EXECUTE FUNCTION protect_nsuhw_export_source();
CREATE FUNCTION protect_nsuhw_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."login" IS DISTINCT FROM OLD."login" OR (OLD."confirmedAt" IS NOT NULL AND (NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt" OR NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById" OR NEW."confirmedEditionId" IS DISTINCT FROM OLD."confirmedEditionId")) THEN
  RAISE EXCEPTION 'Account identity and creation confirmation are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PreparedExternalAccount_identity_immutable" BEFORE UPDATE ON "PreparedExternalAccount" FOR EACH ROW EXECUTE FUNCTION protect_nsuhw_account_identity();
