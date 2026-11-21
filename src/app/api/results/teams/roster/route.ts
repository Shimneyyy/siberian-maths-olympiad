import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { teamResultRoster } from "@/lib/team-results";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>teamResultRoster(db,actorId,body),16384);
