-- CreateEnum
CREATE TYPE "ResultKind" AS ENUM ('PRELIMINARY', 'FINAL');

-- CreateTable
CREATE TABLE "ResultImportBatch" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" "ResultKind" NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditionProblem" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "EditionProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndividualResult" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "kind" "ResultKind" NOT NULL,
    "total" INTEGER,
    "prize" VARCHAR(200),

    CONSTRAINT "IndividualResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultProblemScore" (
    "resultId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "score" INTEGER,

    CONSTRAINT "ResultProblemScore_pkey" PRIMARY KEY ("resultId","problemId")
);

-- CreateIndex
CREATE INDEX "ResultImportBatch_editionId_createdAt_idx" ON "ResultImportBatch"("editionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResultImportBatch_id_editionId_kind_key" ON "ResultImportBatch"("id", "editionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EditionProblem_editionId_ordinal_key" ON "EditionProblem"("editionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "EditionProblem_id_editionId_key" ON "EditionProblem"("id", "editionId");

-- CreateIndex
CREATE INDEX "IndividualResult_editionId_kind_idx" ON "IndividualResult"("editionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "IndividualResult_participationId_kind_key" ON "IndividualResult"("participationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "IndividualResult_id_editionId_key" ON "IndividualResult"("id", "editionId");

-- AddForeignKey
ALTER TABLE "ResultImportBatch" ADD CONSTRAINT "ResultImportBatch_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultImportBatch" ADD CONSTRAINT "ResultImportBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditionProblem" ADD CONSTRAINT "EditionProblem_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualResult" ADD CONSTRAINT "IndividualResult_participationId_editionId_fkey" FOREIGN KEY ("participationId", "editionId") REFERENCES "Participation"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualResult" ADD CONSTRAINT "IndividualResult_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualResult" ADD CONSTRAINT "IndividualResult_batchId_editionId_kind_fkey" FOREIGN KEY ("batchId", "editionId", "kind") REFERENCES "ResultImportBatch"("id", "editionId", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultProblemScore" ADD CONSTRAINT "ResultProblemScore_resultId_editionId_fkey" FOREIGN KEY ("resultId", "editionId") REFERENCES "IndividualResult"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultProblemScore" ADD CONSTRAINT "ResultProblemScore_problemId_editionId_fkey" FOREIGN KEY ("problemId", "editionId") REFERENCES "EditionProblem"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Technical bounds and cross-year FKs complement server validation.
ALTER TABLE "EditionProblem" ADD CONSTRAINT "EditionProblem_ordinal_check" CHECK ("ordinal" BETWEEN 1 AND 50);
ALTER TABLE "IndividualResult" ADD CONSTRAINT "IndividualResult_total_check" CHECK ("total" IS NULL OR "total" >= 0);
ALTER TABLE "ResultProblemScore" ADD CONSTRAINT "ResultProblemScore_score_check" CHECK ("score" IS NULL OR "score" >= 0);
ALTER TABLE "ResultImportBatch" ADD CONSTRAINT "ResultImportBatch_counts_check" CHECK ("importedCount" > 0 AND "rejectedCount" >= 0 AND "importedCount" + "rejectedCount" <= 10000);
-- E07 imports never overwrite. Publication will be a separate E08 resource.
CREATE FUNCTION protect_imported_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Imported result is immutable';
END;
$$;
CREATE TRIGGER result_batch_immutable BEFORE UPDATE OR DELETE ON "ResultImportBatch" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE TRIGGER result_immutable BEFORE UPDATE OR DELETE ON "IndividualResult" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE TRIGGER result_score_immutable BEFORE UPDATE OR DELETE ON "ResultProblemScore" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
CREATE TRIGGER result_problem_immutable BEFORE UPDATE OR DELETE ON "EditionProblem" FOR EACH ROW EXECUTE FUNCTION protect_imported_result();
