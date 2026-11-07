import { olympiadRequest } from "@/lib/olympiad-api";
import { markAttendance } from "@/lib/attendance";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => markAttendance(db, actorId, body));
