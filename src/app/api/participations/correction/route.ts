import { olympiadRequest } from "@/lib/olympiad-api";
import { correctParticipation } from "@/lib/corrections";
import { db } from "@/lib/db";
export const PATCH = (request: Request) => olympiadRequest(request, (actorId, body) => correctParticipation(db, actorId, body));
