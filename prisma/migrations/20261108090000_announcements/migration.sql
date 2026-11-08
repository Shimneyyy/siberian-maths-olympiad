CREATE TABLE "Announcement" (
 "id" UUID NOT NULL, "editionId" UUID NOT NULL, "editionVenueId" UUID,
 "authorId" UUID NOT NULL, "title" VARCHAR(200) NOT NULL, "body" TEXT NOT NULL,
 "important" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 0,
 "publishedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "Announcement_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "OlympiadEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Announcement_editionVenueId_editionId_fkey" FOREIGN KEY ("editionVenueId", "editionId") REFERENCES "EditionVenue"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Announcement_content_check" CHECK (length(trim("title")) > 0 AND length(trim("body")) BETWEEN 1 AND 5000 AND "revision" >= 0)
);
CREATE INDEX "Announcement_editionId_publishedAt_idx" ON "Announcement"("editionId", "publishedAt");
CREATE FUNCTION protect_published_announcement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."publishedAt" IS NOT NULL THEN
   RAISE EXCEPTION 'Published announcement is immutable' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Announcement_immutable" BEFORE UPDATE OR DELETE ON "Announcement"
 FOR EACH ROW EXECUTE FUNCTION protect_published_announcement();
