import { olympiadRequest } from "@/lib/olympiad-api";
import { createEditionVenue, saveEditionVenue } from "@/lib/olympiad";
import { db } from "@/lib/db";
export const POST = (request: Request) => olympiadRequest(request, (actorId, body) => createEditionVenue(db, actorId, body));
export const PATCH = (request: Request) => olympiadRequest(request, (actorId, body) => saveEditionVenue(db, actorId, body));
