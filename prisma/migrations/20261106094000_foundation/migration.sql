-- Foundation only: no authentication credentials, production consents or external secrets.
CREATE TYPE "Role" AS ENUM ('STUDENT', 'CHIEF_ORGANIZER', 'VENUE_ORGANIZER');
CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "emailVerifiedAt" TIMESTAMPTZ(3),
  "role" "Role" NOT NULL DEFAULT 'STUDENT',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "University" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "abbreviation" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CourseOption" (
  "id" UUID NOT NULL, "label" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CourseOption_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudentProfile" (
  "userId" UUID NOT NULL, "fullName" TEXT NOT NULL,
  "universityId" UUID NOT NULL, "courseId" UUID NOT NULL,
  CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId")
);
CREATE TABLE "ConsentRecord" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "purpose" TEXT NOT NULL,
  "textVersion" TEXT NOT NULL, "textHash" CHAR(64) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawnAt" TIMESTAMPTZ(3), CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OlympiadEdition" (
  "id" UUID NOT NULL, "year" INTEGER NOT NULL, "title" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Novosibirsk',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OlympiadEdition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "OlympiadEdition_year_key" ON "OlympiadEdition"("year");
CREATE INDEX "ConsentRecord_userId_purpose_idx" ON "ConsentRecord"("userId", "purpose");
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey"
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_universityId_fkey"
 FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_courseId_fkey"
 FOREIGN KEY ("courseId") REFERENCES "CourseOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey"
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
