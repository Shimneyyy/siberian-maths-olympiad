import { olympiadRequest } from "@/lib/olympiad-api";
import { nsuhwLoginNamesView,saveNsuhwLoginNames } from "@/lib/nsuhw-login-names";
import { db } from "@/lib/db";
export const GET=(request:Request)=>olympiadRequest(request,actorId=>nsuhwLoginNamesView(db,actorId));
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>saveNsuhwLoginNames(db,actorId,body));
