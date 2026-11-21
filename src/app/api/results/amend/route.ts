import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { amendResult } from "@/lib/result-documents";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>amendResult(db,actorId,body),16384);
