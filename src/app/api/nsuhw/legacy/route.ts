import { olympiadRequest } from "@/lib/olympiad-api";
import { legacyNsuhwView, submitLegacyNsuhw, correctLegacyNsuhw } from "@/lib/legacy-nsuhw";
import { db } from "@/lib/db";
export const GET = (request:Request) => olympiadRequest(request,actorId=>legacyNsuhwView(db,actorId));
export const POST = (request:Request) => olympiadRequest(request,(actorId,body)=>submitLegacyNsuhw(db,actorId,body));

export const PATCH = (request:Request) => olympiadRequest(request,(actorId,body)=>correctLegacyNsuhw(db,actorId,body));
