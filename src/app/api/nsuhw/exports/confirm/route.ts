import { olympiadRequest } from "@/lib/olympiad-api";
import { confirmNsuhwExport } from "@/lib/nsuhw-export";
import { db } from "@/lib/db";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>confirmNsuhwExport(db,actorId,body));
