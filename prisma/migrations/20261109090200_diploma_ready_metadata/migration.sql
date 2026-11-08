ALTER TABLE "DiplomaItem" DROP CONSTRAINT "DiplomaItem_ready_check";
ALTER TABLE "DiplomaItem" ADD CONSTRAINT "DiplomaItem_ready_check" CHECK (
 "error" IS NOT NULL OR ("participationId" IS NOT NULL AND "fileKey" IS NOT NULL AND "fileHash" IS NOT NULL AND "size" IS NOT NULL AND "pages" IS NOT NULL AND "size" BETWEEN 1 AND 10485760 AND "pages" BETWEEN 1 AND 100 AND "inspectedAt" IS NOT NULL)
);
