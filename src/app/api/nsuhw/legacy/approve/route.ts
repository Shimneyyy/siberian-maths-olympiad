import { olympiadRequest } from "@/lib/olympiad-api";
import { approveLegacyNsuhw } from "@/lib/legacy-nsuhw";
import { db } from "@/lib/db";
export const POST = (request:Request) => olympiadRequest(request,(actorId,body)=>approveLegacyNsuhw(db,actorId,body));
