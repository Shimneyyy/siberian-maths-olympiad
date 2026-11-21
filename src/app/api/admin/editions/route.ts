import { olympiadRequest } from "@/lib/olympiad-api";
import { createAdminEdition } from "@/lib/admin";
import { db } from "@/lib/db";
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>createAdminEdition(db,actorId,body));
