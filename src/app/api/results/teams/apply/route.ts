import { RESULT_IMPORT_BODY_LIMIT } from "@/lib/result-csv-limits";
import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { applyTeamResults } from "@/lib/team-results";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>applyTeamResults(db,actorId,body),RESULT_IMPORT_BODY_LIMIT);
