import { olympiadRequest } from "@/lib/olympiad-api";
import { nsuhwExportView } from "@/lib/nsuhw-export";
import { db } from "@/lib/db";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>nsuhwExportView(db,actorId,body));
