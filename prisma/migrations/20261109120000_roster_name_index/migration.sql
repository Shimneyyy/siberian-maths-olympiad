-- Default stable roster ordering should page through an index rather than sort
-- the entire edition on every 5-second poll. Existing scoped venue/count index stays.
CREATE INDEX "Participation_editionId_fullName_id_idx" ON "Participation"("editionId", "fullName", "id");
