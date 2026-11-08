ALTER TYPE "OutboxEventKind" ADD VALUE 'RESULTS_PUBLISHED';
CREATE TABLE "ResultPublication" (
 "batchId" UUID NOT NULL PRIMARY KEY,
 "actorId" UUID NOT NULL,
 "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ResultPublication_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ResultImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ResultPublication_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TRIGGER result_publication_immutable BEFORE UPDATE OR DELETE ON "ResultPublication" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
