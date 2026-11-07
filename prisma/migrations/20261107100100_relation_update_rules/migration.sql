-- Match Prisma's explicit relation semantics without changing any stored data.
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_participationId_fkey",
 DROP CONSTRAINT "Attendance_markedById_fkey";
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_participationId_fkey"
 FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 ADD CONSTRAINT "Attendance_markedById_fkey"
 FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ParticipationCorrection" DROP CONSTRAINT "ParticipationCorrection_participationId_fkey",
 DROP CONSTRAINT "ParticipationCorrection_actorId_fkey";
ALTER TABLE "ParticipationCorrection" ADD CONSTRAINT "ParticipationCorrection_participationId_fkey"
 FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 ADD CONSTRAINT "ParticipationCorrection_actorId_fkey"
 FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
