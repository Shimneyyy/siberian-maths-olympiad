CREATE TYPE "AttendanceStatus" AS ENUM ('UNMARKED', 'PRESENT', 'ABSENT');
CREATE TABLE "Attendance" (
 "participationId" UUID PRIMARY KEY REFERENCES "Participation"("id") ON DELETE CASCADE,
 "status" "AttendanceStatus" NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "markedById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
