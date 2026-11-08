import { olympiadRequest } from "@/lib/olympiad-api";
import { prepareNsuhw,preparedNsuhwView } from "@/lib/prepare-nsuhw";
import { db } from "@/lib/db";
export const GET=(request:Request)=>olympiadRequest(request,actorId=>preparedNsuhwView(db,actorId));
export const POST=(request:Request)=>olympiadRequest(request,(actorId,body)=>prepareNsuhw(db,actorId,body));
