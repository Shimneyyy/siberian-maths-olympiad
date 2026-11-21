import { olympiadRequest } from "@/lib/olympiad-api";
import { db } from "@/lib/db";
import { resultDocuments } from "@/lib/result-documents";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>resultDocuments(db,actorId,body),16384);
