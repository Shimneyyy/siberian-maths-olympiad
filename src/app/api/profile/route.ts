import { olympiadRequest } from "@/lib/olympiad-api";
import { saveProfile, profileView } from "@/lib/corrections";
import { db } from "@/lib/db";
export const GET = (request: Request) => olympiadRequest(request, actorId => profileView(db, actorId));
export const PATCH = (request: Request) => olympiadRequest(request, (actorId, body) => saveProfile(db, actorId, body));
