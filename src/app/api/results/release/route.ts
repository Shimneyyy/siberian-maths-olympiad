import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { releaseResult } from "@/lib/result-documents";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>releaseResult(db,actorId,body),16384);
