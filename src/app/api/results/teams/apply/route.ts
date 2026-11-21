import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { applyTeamResults } from "@/lib/team-results";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>applyTeamResults(db,actorId,body),1048576);
