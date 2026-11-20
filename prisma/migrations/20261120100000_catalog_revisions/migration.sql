ALTER TABLE "University" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CourseOption" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "University" ADD CONSTRAINT "University_revision_check" CHECK ("revision">=0);
ALTER TABLE "CourseOption" ADD CONSTRAINT "CourseOption_revision_check" CHECK ("revision">=0);
