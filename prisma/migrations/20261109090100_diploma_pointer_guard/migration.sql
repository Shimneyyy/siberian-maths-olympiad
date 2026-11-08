CREATE FUNCTION validate_diploma_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."revision"<>0 OR NEW."currentVersionId" IS NOT NULL THEN RAISE EXCEPTION 'Diploma starts unpublished'; END IF;
 ELSE
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."editionId" IS DISTINCT FROM OLD."editionId" OR NEW."participationId" IS DISTINCT FROM OLD."participationId"
   OR NEW."revision"<>OLD."revision"+1 OR NEW."currentVersionId" IS NOT DISTINCT FROM OLD."currentVersionId" THEN RAISE EXCEPTION 'Invalid diploma revision'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "DiplomaVersion" v JOIN "DiplomaItem" i ON i."id"=v."itemId" JOIN "DiplomaBatch" b ON b."id"=i."batchId"
   WHERE v."id"=NEW."currentVersionId" AND v."documentId"=NEW."id" AND v."baseRevision"=OLD."revision" AND b."publishedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Unpublished or stale diploma version'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER diploma_document_pointer BEFORE INSERT OR UPDATE ON "DiplomaDocument" FOR EACH ROW EXECUTE FUNCTION validate_diploma_pointer();
