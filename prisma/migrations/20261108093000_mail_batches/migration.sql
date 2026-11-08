CREATE TABLE "MailBatch" (
 "id" UUID NOT NULL, "editionId" UUID NOT NULL, "editionVenueId" UUID, "actorId" UUID NOT NULL,
 "repeatOf" UUID, "subjectTemplate" VARCHAR(200) NOT NULL, "bodyTemplate" TEXT NOT NULL,
 "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MailBatch_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "MailBatch_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "MailBatch_editionVenueId_editionId_fkey" FOREIGN KEY ("editionVenueId", "editionId") REFERENCES "EditionVenue"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "MailBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "MailBatch_repeatOf_fkey" FOREIGN KEY ("repeatOf") REFERENCES "MailBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "MailBatch_content_check" CHECK (length(trim("subjectTemplate")) > 0 AND length(trim("bodyTemplate")) BETWEEN 1 AND 5000)
);
CREATE INDEX "MailBatch_editionId_publishedAt_idx" ON "MailBatch"("editionId", "publishedAt");
CREATE TRIGGER "MailBatch_immutable" BEFORE UPDATE OR DELETE ON "MailBatch"
 FOR EACH ROW EXECUTE FUNCTION protect_published_announcement();
