import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { previewTeamResults } from "@/lib/team-results";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>previewTeamResults(db,actorId,body),1048576);
