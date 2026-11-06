import { olympiadRequest } from "@/lib/olympiad-api";
import { saveEdition } from "@/lib/olympiad";
import { organizerOlympiadView } from "@/lib/olympiad-view";
import { db } from "@/lib/db";
export const GET = (request: Request) => olympiadRequest(request, (actorId) => organizerOlympiadView(db, actorId));
export const PATCH = (request: Request) => olympiadRequest(request, (actorId, body) => saveEdition(db, actorId, body));
